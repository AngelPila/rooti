"""A lot as the web app keeps it (state.plan in app/main.js) and as rooti.db keeps it, both ways. The app's plan pages
and the website's «Continuar en WhatsApp» code both go through here, so a lot looks the same wherever it was made."""
import json
from datetime import date

from rooti_bot import config

CROP_IDS = set(json.loads((config.REPO / "app" / "data" / "crops.json").read_text(encoding="utf-8"))["crops"]) | {"mulch"}
UNITS = {"ha", "cuadra", "m2", "acre"}
UNIT_WORDS = {"ha": ("hectárea", "hectáreas"), "cuadra": ("cuadra", "cuadras"), "m2": ("m²", "m²"),
              "acre": ("acre", "acres")}


class LotError(ValueError):
    pass


def _crops(values) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(str(v) for v in values if str(v) in CROP_IDS))[:12]


def _plot(corners) -> list[list[float]]:
    if not isinstance(corners, list):
        return []
    out = []
    for c in corners[:40]:
        try:
            lon, lat = float(c[0]), float(c[1])
        except (TypeError, ValueError, IndexError):
            return []
        if -180 <= lon <= 180 and -90 <= lat <= 90:
            out.append([round(lon, 6), round(lat, 6)])
    return out if len(out) >= 3 else []


def from_app(plan: dict) -> dict:
    """The fields rooti.db keeps, from the app's plan. Raises LotError when the page sent no usable place."""
    place = plan.get("place") or {}
    try:
        lat, lon = float(place["lat"]), float(place["lon"])
    except (KeyError, TypeError, ValueError):
        raise LotError("falta la ubicación del lote") from None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise LotError("esa ubicación no es válida")
    fields = {"lat": round(lat, 5), "lon": round(lon, 5),
              "place": str(place.get("name") or "")[:80] or None,
              "crops": _crops(plan.get("crops")), "current": _crops(plan.get("current")),
              "irrigation": bool(plan.get("irrigation")), "plot": _plot(plan.get("lot"))}
    unit = plan.get("unit") if plan.get("unit") in UNITS else "ha"
    try:
        area = float(plan.get("area"))
        if area > 0:
            fields["area"], fields["unit"] = round(area, 2), unit
    except (TypeError, ValueError):
        pass
    waterlog = plan.get("waterlog")
    if waterlog in ("yes", "sometimes", "no"):
        fields["waterlog"] = waterlog != "no"
    return fields


def to_app(farmer: dict | None) -> dict | None:
    """The app's plan for a farmer Rooti knows: the next 12 months, like the plan Rooti talks about on WhatsApp."""
    if not farmer or farmer.get("lat") is None:
        return None
    today = date.today()
    start = date(today.year + (today.month == 12), today.month % 12 + 1, 1)
    end = date(start.year + 1, start.month, 1)
    waterlog = farmer.get("waterlog")
    return {
        "place": {"name": farmer.get("place") or f"{farmer['lat']:.2f}, {farmer['lon']:.2f}", "lat": farmer["lat"],
                  "lon": farmer["lon"]},
        "start": start.isoformat(), "end": date.fromordinal(end.toordinal() - 1).isoformat(),
        "crops": farmer.get("crops") or [], "current": farmer.get("current") or [],
        "irrigation": bool(farmer.get("irrigation")), "area": farmer.get("area") or 1,
        "unit": farmer.get("unit") or "cuadra",
        "waterlog": None if waterlog is None else ("yes" if waterlog else "no"),
        "lot": farmer.get("plot") or None,
    }


def describe(fields: dict) -> str:
    """«3 cuadras en Daule, con arroz, maíz y soya»: the lot in one line of chat."""
    crops = json.loads((config.REPO / "app" / "data" / "crops.json").read_text(encoding="utf-8"))["crops"]
    names = [("paja sin quemar" if c == "mulch" else crops[c]["name_es"].split(" / ")[0].lower())
             for c in fields.get("crops") or []]
    parts = []
    if fields.get("area"):
        one, many = UNIT_WORDS.get(fields.get("unit") or "ha", UNIT_WORDS["ha"])
        area = fields["area"]
        parts.append(f"{area:g} {one if area == 1 else many}".replace(".", ","))
    if fields.get("place"):
        parts.append(f"en {fields['place']}")
    text = " ".join(parts)
    if names:
        text += (", " if text else "") + "con " + (names[0] if len(names) == 1 else ", ".join(names[:-1]) + " y " + names[-1])
    return text
