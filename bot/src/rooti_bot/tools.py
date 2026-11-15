"""Rooti's tools, the same for the WhatsApp agent (mcp_server.py) and the live call (call_server.py). Each one acts
on the farmer of the conversation, which the caller passes in; the model never names whose lot it is."""
import json
from dataclasses import dataclass
from typing import Callable

from rooti_bot import calls, config, engine, store

CROPS = json.loads((config.REPO / "app" / "data" / "crops.json").read_text(encoding="utf-8"))["crops"]
CROP_IDS = sorted(CROPS) + ["mulch"]
CROP_LIST = ", ".join(f"{k} ({v['name_es'].split(' / ')[0].lower()})" for k, v in sorted(CROPS.items()))
MODES = {"all": "todos los años desde 1981", "nino": "solo años de El Niño fuerte", "dry": "solo años secos",
         "wet": "solo años lluviosos"}
GLOSSARY = {
    "evapotranspiracion": "El agua que el sol y el viento sacan del suelo y de las hojas cada día. Si llueve menos "
                          "que eso, la planta pasa sed.",
    "et": "Lo mismo que evapotranspiración: el agua que el sol y el viento sacan del suelo y de las plantas.",
    "humedad del suelo": "Cuánta agua guarda la tierra para la raíz. Una anomalía es cuando hay más o menos de lo "
                         "normal para ese mes.",
    "ndvi": "Un número que mide desde el satélite qué tan verde está el campo: alto es cultivo sano y tupido, bajo "
            "es suelo pelado o planta seca.",
    "balance hidrico": "La cuenta del agua: lo que llueve menos lo que la planta y el sol se llevan. Si sale "
                       "negativo, falta riego.",
    "el nino": "Cuando el mar frente a la costa se calienta: en la costa de Ecuador suele traer inviernos mucho más "
               "lluviosos, con inundaciones, como 1983 y 1998.",
    "rotacion": "Sembrar cultivos distintos uno tras otro en el mismo lote, por ejemplo arroz y después soya, para "
                "cortar plagas y que el suelo descanse.",
    "suelo desnudo": "Tierra sin nada sembrado ni paja encima. La lluvia fuerte se la lleva y el sol la reseca.",
    "nasa power": "Datos de clima de la NASA desde 1981, calculados para cuadros de unos 50 km: dicen cómo es la "
                  "zona, no el lote exacto.",
}


class ToolError(Exception):
    """A failure the model should read and explain."""


@dataclass
class Tool:
    name: str
    description: str
    handler: Callable[[str, dict], object]
    properties: dict
    required: tuple = ()

    def schema(self) -> dict:
        return {"type": "object", "properties": self.properties, "required": list(self.required),
                "additionalProperties": False}


def _farmer(farmer_id: str) -> dict:
    return store.get(farmer_id) or store.update(farmer_id)


def _missing(f: dict) -> list[str]:
    need = {"ubicación del lote": f.get("lat") is None, "cultivos": not f.get("crops"),
            "tamaño del lote": not f.get("area"), "si se encharca": f.get("waterlog") is None}
    return [k for k, v in need.items() if v]


def my_lot(farmer_id: str, _args: dict) -> dict:
    f = _farmer(farmer_id)
    saved = store.saved_plan(farmer_id)
    return {"lote": {k: f[k] for k in ("name", "place", "lat", "lon", "crops", "current", "area", "unit", "irrigation",
                                       "waterlog", "priority", "alerts_ok", "notes")},
            "falta_saber": _missing(f), "plan_listo": bool(saved)}


def _crops(values, field) -> list[str]:
    if values is None:
        return None
    bad = [v for v in values if v not in CROP_IDS]
    if bad:
        raise ToolError(f"{field}: no conozco {', '.join(bad)}. Usa estos ids: {CROP_LIST}, mulch (dejar la paja).")
    return list(dict.fromkeys(values))


def save_lot(farmer_id: str, args: dict) -> dict:
    fields = {k: v for k, v in args.items() if v is not None}
    for key in ("crops", "current"):
        if key in fields:
            fields[key] = _crops(fields[key], key)
    if "lat" in fields and not (-90 <= fields["lat"] <= 90 and -180 <= fields.get("lon", 0) <= 180):
        raise ToolError("Esa ubicación no es válida.")
    f = store.update(farmer_id, **fields)
    out = {"guardado": sorted(fields), "falta_saber": _missing(f)}
    if f.get("lat") is not None and f.get("crops"):
        try:
            engine.plan_for(f)
            out["plan"] = "listo"
        except engine.EngineError as exc:
            out["plan"] = f"no se pudo calcular todavía: {exc}"
    return out


def recommended_plan(farmer_id: str, _args: dict) -> dict:
    try:
        r = engine.plan_for(_farmer(farmer_id))
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    return {k: r.get(k) for k in ("from", "to", "tested_on", "farm", "today", "soil", "limits")}


def when_to_sow(farmer_id: str, args: dict) -> dict:
    try:
        r = engine.plan_for(_farmer(farmer_id))
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    sow = r.get("sow") or []
    if args.get("cultivo"):
        name = CROPS.get(args["cultivo"], {}).get("name_es", args["cultivo"]).lower()
        sow = [s for s in sow if s["crop"] == name] or sow
    return {"desde": r["from"], "hasta": r["to"], "probado_en": r["tested_on"], "cultivos": sow}


def try_change(farmer_id: str, args: dict) -> dict:
    f = dict(_farmer(farmer_id))
    if args.get("cultivos") is not None:
        f["crops"] = _crops(args["cultivos"], "cultivos")
    if args.get("riego") is not None:
        f["irrigation"] = bool(args["riego"])
    mode = args.get("anios") or "auto"
    if mode != "auto" and mode not in MODES:
        raise ToolError(f"anios: usa uno de {', '.join(MODES)}.")
    try:
        trial = engine.plan_for(f, fresh=True, mode=mode)
        base = engine.plan_for(_farmer(farmer_id))
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    return {"probado_en": trial["tested_on"], "con_el_cambio": trial.get("farm"), "plan_actual": base.get("farm")}


def this_year(farmer_id: str, _args: dict) -> dict:
    f = _farmer(farmer_id)
    if f.get("lat") is None:
        raise ToolError("Todavía no sé dónde está el lote.")
    try:
        return engine.this_year(f)
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None


def explain(_farmer_id: str, args: dict) -> dict:
    import unicodedata
    plain = "".join(c for c in unicodedata.normalize("NFD", str(args.get("termino", "")).lower())
                    if unicodedata.category(c) != "Mn").strip()
    hit = next((v for k, v in GLOSSARY.items() if k in plain or plain in k), None)
    return {"explicacion": hit} if hit else {"explicacion": None, "conocidos": sorted(GLOSSARY)}


def call_button(farmer_id: str, args: dict) -> dict:
    from rooti_bot import bridge
    try:
        url = calls.link(farmer_id)
        bridge.send_button(farmer_id, args.get("texto") or "Toca el botón y conversamos en vivo, como una llamada.",
                           "📞 Hablar con Rooti", url)
    except Exception as exc:
        raise ToolError(f"No pude mandar el botón: {exc}") from None
    return {"enviado": True, "nota": "El botón ya está en el chat: no repitas el enlace."}


LOT_PROPS = {
    "name": {"type": "string", "description": "cómo se llama el agricultor"},
    "lat": {"type": "number"}, "lon": {"type": "number"},
    "place": {"type": "string", "description": "recinto, cantón o provincia"},
    "crops": {"type": "array", "items": {"type": "string"},
              "description": f"cultivos que podría sembrar, por id: {CROP_LIST}, mulch (dejar la paja sin quemar)"},
    "current": {"type": "array", "items": {"type": "string"}, "description": "lo que siembra hoy, mismos ids"},
    "area": {"type": "number", "description": "tamaño del lote en la unidad de «unit»"},
    "unit": {"type": "string", "enum": ["cuadra", "ha", "m2", "acre"]},
    "irrigation": {"type": "boolean", "description": "tiene riego"},
    "waterlog": {"type": "boolean", "description": "el lote se encharca en invierno"},
    "priority": {"type": "string", "enum": ["soil", "water", "income"],
                 "description": "qué le importa más: cuidar el suelo, ahorrar agua o ganar más"},
    "alerts_ok": {"type": "boolean", "description": "aceptó que Rooti le escriba primero con avisos"},
    "notes": {"type": "string", "description": "algo del lote que conviene recordar (plagas que tuvo, su técnico)"},
}

TOOLS = [
    Tool("mi_lote", "Lo que Rooti sabe del lote de este agricultor y qué falta preguntarle. Úsala al empezar.",
         my_lot, {}),
    Tool("guardar_lote", "Guarda o corrige datos del lote (solo los que cambian). Con ubicación y cultivos calcula el "
                         "plan; la primera vez tarda hasta un minuto.", save_lot, LOT_PROPS),
    Tool("plan_recomendado", "Qué sembrar, cuándo y en cuánta tierra para los próximos 12 meses, comparado con lo que "
                             "hace hoy, probado en años reales.", recommended_plan, {}),
    Tool("cuando_sembrar", "Los mejores meses para sembrar cada cultivo del lote.", when_to_sow,
         {"cultivo": {"type": "string", "description": "id de un cultivo, si pregunta por uno"}}),
    Tool("probar", "Qué pasaría con otros cultivos, con riego, o en años secos, lluviosos o de El Niño, sin cambiar "
                   "el plan guardado.", try_change,
         {"cultivos": {"type": "array", "items": {"type": "string"}, "description": "ids de cultivos a probar"},
          "riego": {"type": "boolean"},
          "anios": {"type": "string", "enum": [*MODES, "auto"], "description": "qué años usar en la prueba"}}),
    Tool("como_va_este_anio", "La lluvia de los últimos meses en la zona del lote frente a lo normal.", this_year, {}),
    Tool("explicar", "Explica un término (evapotranspiración, humedad del suelo, NDVI, balance hídrico, El Niño…) en "
                     "palabras simples.", explain,
         {"termino": {"type": "string"}}, ("termino",)),
    Tool("boton_llamada", "Manda al chat el botón «📞 Hablar con Rooti» para conversar en vivo, como una llamada. "
                          "Úsalo cuando la pregunta es larga o el agricultor prefiere hablar.", call_button,
         {"texto": {"type": "string", "description": "la frase corta que va sobre el botón"}}),
]
CHAT_ONLY = {"boton_llamada"}  # the live call has no chat to put a button in
BY_NAME = {t.name: t for t in TOOLS}


def call(name: str, farmer_id: str, args: dict) -> object:
    tool = BY_NAME.get(name)
    if tool is None:
        raise ToolError(f"No existe la herramienta «{name}».")
    unknown = set(args) - set(tool.properties)
    if unknown:
        raise ToolError(f"Argumentos desconocidos para {name}: {', '.join(sorted(unknown))}.")
    return tool.handler(farmer_id, args)
