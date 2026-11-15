"""Alerts Rooti sends first, without the model (Vinci's poll pattern): heavy rain ahead and the time to sow, each as
a voice note plus the «📞 Hablar con Rooti» button. Only to farmers who said yes (alerts_ok), by day, at most
MAX_PER_WEEK a week, and a short reminder when nobody opened the call."""
import asyncio
import json
import logging
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from rooti_bot import bridge, calls, store, voice

TZ = ZoneInfo("America/Guayaquil")
FORECAST = os.environ.get("ROOTI_FORECAST_URL", "https://api.open-meteo.com/v1/forecast")  # E2E: a stand-in
# A prototype threshold, still to be checked against INAMHI's warning levels (docs/REFERENCES.md).
HEAVY_MM = 40
FORECAST_DAYS = 3
SOW_LEAD_DAYS = 10  # the sowing alert goes out this many days before the month the plan sows in
MAX_PER_WEEK = 2
REMIND_AFTER_H = 4
DAY_HOURS = range(7, 19)  # no message before 7:00 or after 18:59
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre"]
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
log = logging.getLogger("rooti.alerts")


def _forecast(lat: float, lon: float) -> list[tuple[str, float]]:
    query = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "daily": "precipitation_sum",
                                    "timezone": "America/Guayaquil", "forecast_days": FORECAST_DAYS})
    with urllib.request.urlopen(f"{FORECAST}?{query}", timeout=20) as response:
        daily = json.loads(response.read())["daily"]
    return list(zip(daily["time"], [v or 0 for v in daily["precipitation_sum"]]))


def heavy_rain(farmer: dict, forecast=_forecast) -> tuple[str, str] | None:
    days = [(d, mm) for d, mm in forecast(farmer["lat"], farmer["lon"]) if mm >= HEAVY_MM]
    if not days:
        return None
    day, mm = max(days, key=lambda x: x[1])
    weekday = WEEKDAYS[datetime.fromisoformat(day).weekday()]
    place = f" en {farmer['place']}" if farmer.get("place") else " por su lote"
    return day, (f"¡Pilas, veci! Aquí Rooti. Para el {weekday} vienen unos {round(mm)} milímetros de lluvia{place}: es "
                 f"lluvia fuerte. Si tiene algo recién sembrado o el lote se encharca, toca prepararse.")


def sow_window(farmer: dict, plan: dict | None, today=None) -> tuple[str, str] | None:
    if not plan or not plan.get("farm"):
        return None
    today = today or datetime.now(TZ).date()
    soon = today + timedelta(days=SOW_LEAD_DAYS)
    if soon.month == today.month:
        return None  # only in the last days before a new month starts
    month = f"{MONTHS[soon.month - 1]} {soon.year}"
    crops = [p["crop"] for plot in plan["farm"]["plots"] for p in plot["plantings"][:1] if p["from"] == month]
    if not crops:
        return None
    crop = crops[0]
    return f"{crop}@{month}", (f"¡Buenas, veci! Aquí Rooti. Según su plan, en {MONTHS[soon.month - 1]} toca sembrar {crop}. "
                               f"Antes de sembrar, veamos cómo viene la lluvia.")


def _send(phone: str, alert_id: int, text: str, at: float) -> None:
    ogg = asyncio.run(voice.synthesize(text))
    bridge.send_voice(phone, ogg)
    bridge.send_button(phone, text + "\n\nToque el botón y le explico qué hacer.", "📞 Hablar con Rooti",
                       calls.link(phone, alert_id))
    store.mark_alert(alert_id, "sent_at", at)


def run(*, dry_run: bool = False, now: datetime | None = None) -> list[dict]:
    """One pass: new alerts for every farmer who wants them, then reminders. Returns what it sent (or would)."""
    if now is None and os.environ.get("ROOTI_NOW"):  # E2E: the test's clock
        now = datetime.fromisoformat(os.environ["ROOTI_NOW"]).replace(tzinfo=TZ)
    now = now or datetime.now(TZ)
    if now.hour not in DAY_HOURS:
        return []
    out = []
    for farmer in store.all_with_alerts():
        phone = farmer["phone"]
        if store.alerts_sent_since(phone, now.timestamp() - 7 * 86400) >= MAX_PER_WEEK:
            continue
        saved = store.saved_plan(phone)
        for kind, check in (("heavy_rain", lambda: heavy_rain(farmer)),
                            ("sow_window", lambda: sow_window(farmer, saved[1] if saved else None, now.date()))):
            try:
                found = check()
            except Exception as exc:  # one farmer's failed forecast never stops the others
                log.warning("%s de %s: %s", kind, phone, exc)
                continue
            if not found:
                continue
            key, text = found
            if dry_run:
                out.append({"phone": phone, "kind": kind, "text": text})
                continue
            alert_id = store.add_alert(phone, kind, key, text)
            if alert_id is None:
                continue  # already sent
            try:
                _send(phone, alert_id, text, now.timestamp())
                out.append({"phone": phone, "kind": kind, "text": text})
            except Exception as exc:
                log.error("no pude mandar el aviso %s a %s: %s", alert_id, phone, exc)
            break  # one alert per farmer per pass
    if not dry_run:
        for alert in store.unopened_alerts(now.timestamp() - REMIND_AFTER_H * 3600):
            try:
                bridge.send_button(alert["phone"], "¿Pudo escuchar mi aviso? Si quiere, conversamos un momento.",
                                   "📞 Hablar con Rooti", calls.link(alert["phone"], alert["id"]))
                store.mark_alert(alert["id"], "reminded_at", now.timestamp())
            except Exception as exc:
                log.error("no pude recordar el aviso %s: %s", alert["id"], exc)
    return out
