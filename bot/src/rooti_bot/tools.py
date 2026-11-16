"""Rooti's tools, the same for the WhatsApp agent (mcp_server.py) and the live call (call_server.py). Each one acts
on the farmer of the conversation, which the caller passes in; the model never names whose lot it is."""
import contextvars
import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable

from rooti_bot import calls, config, engine, store

log = logging.getLogger("rooti.tools")
ON_CHAT = contextvars.ContextVar("on_chat", default=False)  # a WhatsApp turn (mcp_server), not the live call
WAIT_TEXT = "Déjeme revisar su lote con los datos de la NASA, un ratito 🌱"
WAIT_AFTER_S = 2.5  # a plan from fetched data is ready well before this
WAIT_EVERY_S = 300  # a second plan try right after a slow first one does not repeat the same sentence
BUTTON_FALLBACK_S = 120  # a turn that ends without text still gets its button
_waited: dict[str, float] = {}

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
    lot = {k: f[k] for k in ("name", "place", "lat", "lon", "crops", "current", "area", "unit", "irrigation", "waterlog",
                             "alerts_ok", "notes")}
    # «soil» is the default and nobody is asked for a priority (DESIGN.md): shown, the model takes it for the farmer's.
    if f["priority"] != "soil":
        lot["priority"] = f["priority"]
    return {"lote": lot, "falta_saber": _missing(f), "plan_listo": bool(saved)}


def _crops(values, field) -> list[str]:
    if values is None:
        return None
    bad = [v for v in values if v not in CROP_IDS]
    if bad:
        raise ToolError(f"{field}: no conozco {', '.join(bad)}. Usa estos ids: {CROP_LIST}, mulch (dejar la paja).")
    return list(dict.fromkeys(values))


def _plan(farmer: dict) -> dict:
    """The saved plan; when computing it waits on NASA (up to a minute and a half), the farmer hears so first: the
    model's own words only go out once the turn is over. With the data already fetched it takes a fraction of a
    second, and no wait message goes out."""
    if not (ON_CHAT.get() and farmer.get("lat") is not None and farmer.get("crops") and engine.cold(farmer)):
        return engine.plan_for(farmer)
    timer = threading.Timer(WAIT_AFTER_S, _say_wait, (farmer["phone"],))
    timer.daemon = True
    timer.start()
    try:
        return engine.plan_for(farmer)
    finally:
        timer.cancel()


def _say_wait(phone: str) -> None:
    if time.time() - _waited.get(phone, 0) <= WAIT_EVERY_S:
        return
    from rooti_bot import bridge
    _waited[phone] = time.time()
    try:
        bridge.send_text(phone, WAIT_TEXT)
    except Exception as exc:
        log.warning("no pude avisar que espere: %s", exc)


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
            _plan(f)
            out["plan"] = "listo"
        except engine.EngineError as exc:
            out["plan"] = f"no se pudo calcular todavía: {exc}"
    return out


def recommended_plan(farmer_id: str, _args: dict) -> dict:
    f = _farmer(farmer_id)
    try:
        r = _plan(f)
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    out = {k: r.get(k) for k in ("from", "to", "tested_on", "why_these_years", "plans", "soil", "limits")}
    return {**out, "followed": (engine.followed(r, f) or {}).get("name")}


def when_to_sow(farmer_id: str, args: dict) -> dict:
    f = _farmer(farmer_id)
    try:
        r = _plan(f)
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    sow = r.get("sow") or []
    if args.get("cultivo"):
        name = CROPS.get(args["cultivo"], {}).get("name_es", args["cultivo"]).lower()
        sow = [s for s in sow if s["crop"] == name] or sow
    plan = engine.followed(r, f) or {}
    sowings = [{"crop": p["crop"], "month": p["from"], "land": plot["land"]}
               for plot in plan.get("plots", []) for p in plot["plantings"]]
    return {"desde": r["from"], "hasta": r["to"], "probado_en": r["tested_on"], "cultivos": sow,
            "followed": {"name": plan.get("name"), "sowings": sowings}}


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
        base = _plan(_farmer(farmer_id))
    except engine.EngineError as exc:
        raise ToolError(str(exc)) from None
    return {"probado_en": trial["tested_on"], "con_el_cambio": engine.followed(trial, f),
            "plan_actual": engine.followed(base, f)}


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


def _button(farmer_id: str, text: str, label: str, url_of) -> dict:
    """A button goes after Rooti's answer, as a person sends a link after explaining: the plugin sends it once the
    turn's text is out (rooti-bot botones), the timer when the turn ends without one."""
    try:
        url = url_of()
    except Exception as exc:
        raise ToolError(f"No pude armar el botón: {exc}") from None
    button_id = store.queue_button(farmer_id, label, text, url)
    timer = threading.Timer(BUTTON_FALLBACK_S, send_queued, (farmer_id, [button_id]))
    timer.daemon = True
    timer.start()
    return {"enviado": True, "nota": "El botón le llega justo después de su respuesta: no pegues el enlace."}


def send_queued(phone: str, ids: list[int] | None = None) -> int:
    from rooti_bot import bridge
    sent = 0
    for button in store.claim_buttons(phone, ids):
        try:
            bridge.send_button(phone, button["text"], button["label"], button["url"], log=False)
            sent += 1
        except Exception as exc:
            log.error("no pude mandar el botón %s: %s", button["label"], exc)
    return sent


def call_button(farmer_id: str, args: dict) -> dict:
    return _button(farmer_id, args.get("texto") or "Toque el botón y conversamos en vivo, como una llamada.",
                   "📞 Hablar con Rooti", lambda: calls.link(farmer_id))


def lot_button(farmer_id: str, args: dict) -> dict:
    return _button(farmer_id, args.get("texto") or "Toque el botón, marque su lote en el mapa y dígame qué siembra.",
                   "Marcar mi lote", lambda: calls.page(farmer_id, "planear/1"))


def plan_button(farmer_id: str, args: dict) -> dict:
    if not store.saved_plan(farmer_id):
        raise ToolError("Todavía no hay plan: primero guarda la ubicación y los cultivos del lote.")
    return _button(farmer_id, args.get("texto") or "Aquí tiene su plan, con los tres caminos para comparar.",
                   "Ver mi plan", lambda: calls.page(farmer_id, "resumen"))


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
    Tool("plan_recomendado", "Los planes de la página «Ver mi plan», en el mismo orden, y lo que hace hoy: qué sembrar, "
                             "cuándo y en cuánta tierra los próximos 12 meses, probado en años reales. «followed» es el "
                             "que sigue el agricultor.", recommended_plan, {}),
    Tool("cuando_sembrar", "Los mejores meses para sembrar cada cultivo del lote, y cuándo siembra cada uno en el plan "
                           "que sigue.", when_to_sow,
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
    Tool("boton_llamada", "Manda, después de tu respuesta, el botón «📞 Hablar con Rooti» para conversar en vivo. "
                          "Solo si el agricultor quiere hablar, o si la conversación se enreda por escrito.",
         call_button,
         {"texto": {"type": "string", "description": "la frase corta que va sobre el botón"}}),
    Tool("boton_lote", "Manda, después de tu respuesta, el botón «Marcar mi lote»: una página donde marca el lote en "
                       "el mapa y elige sus cultivos. Para un agricultor nuevo que todavía no te dio su lote, salvo "
                       "que prefiera escribir.",
         lot_button, {"texto": {"type": "string", "description": "la frase corta que va sobre el botón"}}),
    Tool("boton_plan", "Manda, después de tu respuesta, el botón «Ver mi plan»: lo que toca sembrar ahora, la ruta "
                       "del año y los caminos para elegir uno. Solo si quiere verlo, compararlo o elegir; nunca en "
                       "lugar de explicarle tú.", plan_button,
         {"texto": {"type": "string", "description": "la frase corta que va sobre el botón"}}),
]
CHAT_ONLY = {"boton_llamada", "boton_lote", "boton_plan"}  # the live call has no chat to put a button in
BY_NAME = {t.name: t for t in TOOLS}


def call(name: str, farmer_id: str, args: dict, *, chat: bool = False) -> object:
    tool = BY_NAME.get(name)
    if tool is None:
        raise ToolError(f"No existe la herramienta «{name}».")
    unknown = set(args) - set(tool.properties)
    if unknown:
        raise ToolError(f"Argumentos desconocidos para {name}: {', '.join(sorted(unknown))}.")
    token = ON_CHAT.set(chat)
    try:
        return tool.handler(farmer_id, args)
    finally:
        ON_CHAT.reset(token)
