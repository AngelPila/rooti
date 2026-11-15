"""Rooti on WhatsApp, end to end: the real Hermes gateway with Rooti's profile, plugin and tools, the real planner on
live NASA POWER data, the real alert service and the real call server; WhatsApp, the model and the weather forecast
are stand-ins (fakes.py). One farmer in Daule:

1. writes «hola»: the turn opens with what Rooti knows (nothing yet) and Rooti asks for the plot's location;
2. shares the location, then says what they grow: the lot is saved and its plan computed;
3. asks when to sow rice: the answer comes from cuando_sembrar on that plan;
4. asks to talk: the «📞 Hablar con Rooti» button arrives, with a signed link;
5. a group message gets no answer; «/ayuda» is chat, not a Hermes command; when the model fails, the farmer gets a
   short apology, never Hermes' English error;
6. agrees to alerts; a 55 mm day in the forecast sends a voice note and the call button;
7. opening that call (a WebRTC offer, as the page sends: call_probe.py) is answered and marks the alert opened,
   so no reminder follows.

The pages farmers open from those buttons (the web app at the root, bot/src/rooti_bot/web.py), as the app calls them:
8. «Marcar mi lote» and «Ver mi plan» arrive as buttons signed for this farmer; the page reads the lot, saves the plot
   drawn on the map, and Rooti confirms in the chat with the plan button; picking a plan reaches the chat and the
   next turn's context;
9. the alert's «Ver el aviso» page reads the alert and counts as opened;
10. a lot made on the public website comes to WhatsApp as a code: a new farmer sends it and Rooti already knows the lot.
"""
import contextlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
import yaml

from fakes import FakeForecast, FakeWhatsApp, ScriptedLLM

BOT_DIR = Path(__file__).resolve().parents[2]
BIN = BOT_DIR / ".venv" / "bin" / "rooti-bot"
CALL_BIN = BOT_DIR / ".venv-call" / "bin"
FARMER = "593981234567@s.whatsapp.net"
NEWCOMER = "593987654321@s.whatsapp.net"
DAULE = (-1.86, -79.98)
# The plot's soil and slope as SoilGrids and Open-Meteo gave them: SoilGrids takes up to a minute, NASA POWER is live.
TERRAIN = {"elevation": 1, "slopePct": 1.5, "soil": {"clay": 33.4, "sand": 45.2, "phh2o": 6.2, "soc": 32.5,
                                                    "nitrogen": 2.3, "offsetKm": 6}}


def find_hermes() -> str | None:
    candidates = [os.environ.get("HERMES_BIN")]
    for facts in sorted(Path.home().glob(".hermes/installs/*/facts.json")):
        with contextlib.suppress(Exception):
            candidates.append(str(Path(json.loads(facts.read_text())["packages"]["venv"]["environment"]) / "bin" / "hermes"))
    candidates.append(shutil.which("hermes"))
    return next((c for c in candidates if c and Path(c).is_file() and os.access(c, os.X_OK)), None)


def tool(req: dict, suffix: str) -> str:
    names = [t["function"]["name"] for t in req.get("tools") or []]
    found = [n for n in names if n.endswith(suffix)]
    assert found, f"no tool ending in {suffix}: {names}"
    return found[0]


def text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content or "")


def tool_payload(text: str) -> dict:
    """A tool's JSON as the model gets it: Hermes wraps MCP results in an untrusted block as {"result": "<json>"}."""
    outer = json.loads(text[text.index("{"):text.rindex("}") + 1])
    inner = outer.get("result", outer)
    return json.loads(inner) if isinstance(inner, str) else inner


def http(method: str, url: str, body: dict | None = None, token: str = "") -> tuple[int, dict | str]:
    """What the app's link.js sends: JSON, with the signed link in X-Rooti-Token."""
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"X-Rooti-Token": token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if "json" in res.headers.get("Content-Type", "") else raw
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def token_of(url: str) -> str:
    """The signed link in a button, in the fragment (#t=) of the app's pages and of the call page."""
    parts = urlsplit(url)
    return (parse_qs(parts.query).get("t") or parse_qs(parts.fragment).get("t"))[0]


def script(req: dict) -> dict:
    """The model, scripted: it answers what the farmer last said, or reads the tool result it just got."""
    messages = req["messages"]
    last = messages[-1]
    if last["role"] == "tool":
        result = tool_payload(text_of(last))
        if "cultivos" in result and isinstance(result["cultivos"], list):
            rice = next(c for c in result["cultivos"] if c["crop"] == "arroz")
            return {"content": f"Para el arroz, el mejor mes para sembrar es {rice['best_month']}."}
        if result.get("enviado") is True:
            return {"content": "Le mandé el botón."}
        if result.get("plan") == "listo":
            return {"content": "Listo, ya revisé su lote con los datos de la NASA."}
        return {"content": "Anotado."}
    said = text_of(last)
    if "Nota de Rooti" in said:  # the plugin's note under a website code
        return {"content": "¡Buenas, veci! Ya tengo su lote de la página." if "ya quedó guardado" in said
                else "Ese código no me sirve, marque su lote otra vez."}
    if "cómo le mando" in said:
        return {"tool_calls": [(tool(req, "boton_lote"), {})]}
    if "mándeme el plan" in said:
        return {"tool_calls": [(tool(req, "boton_plan"), {})]}
    if "[Location:" in said:
        lat, lon = map(float, re.search(r"(-?\d+\.\d+),(-?\d+\.\d+)", said).groups())
        return {"tool_calls": [(tool(req, "guardar_lote"), {"lat": lat, "lon": lon, "place": "Daule"})]}
    if "siembro arroz" in said:
        return {"tool_calls": [(tool(req, "guardar_lote"), {"crops": ["rice", "maize", "soybean"], "current": ["rice"],
                                                            "area": 3, "unit": "cuadra", "waterlog": False})]}
    if "cuándo siembro" in said:
        return {"tool_calls": [(tool(req, "cuando_sembrar"), {"cultivo": "rice"})]}
    if "hablar" in said:
        return {"tool_calls": [(tool(req, "boton_llamada"), {})]}
    if "/ayuda" in said:  # plain chat, not a Hermes command
        return {"content": "Le ayudo a ver qué sembrar y cuándo. ¿Me manda la ubicación de su lote?"}
    if "prueba de falla" in said:
        return {"status": 401, "error": "Invalid API key: this is not an OpenRouter API key."}
    if "avíseme" in said:
        return {"tool_calls": [(tool(req, "guardar_lote"), {"alerts_ok": True})]}
    return {"content": "¡Buenas, veci! Aquí Rooti 🌱 ¿Me manda la ubicación de su lote con el clip?"}


class Gateway:
    def __init__(self, hermes, env, log):
        self.proc = subprocess.Popen([hermes, "gateway", "run"], env=env, cwd=env["HOME"], stdin=subprocess.DEVNULL,
                                     stdout=log.open("w"), stderr=subprocess.STDOUT, start_new_session=True)

    def stop(self):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)


def test_farmer_on_whatsapp(tmp_path):
    hermes = find_hermes()
    if hermes is None:
        pytest.skip("Hermes Agent no está instalado")
    assert BIN.exists() and (CALL_BIN / "python").exists(), "corre: uv venv .venv && uv pip install -e . (y .venv-call)"
    home, data = tmp_path / "home", tmp_path / "datos"
    hermes_home = home / ".hermes"
    stand_in = tmp_path / "whatsapp-bridge"
    (stand_in / "node_modules").mkdir(parents=True)
    (stand_in / "bridge.js").write_text("// E2E: el puente lo hace FakeWhatsApp\n")
    (stand_in / "package.json").write_text("{}\n")
    import hashlib
    (stand_in / "node_modules" / ".hermes-pkg-hash").write_text(hashlib.sha256(b"{}\n").hexdigest()[:16])
    session = hermes_home / "platforms" / "whatsapp" / "session"
    session.mkdir(parents=True)
    (session / "creds.json").write_text(json.dumps({"me": {"id": f"{FakeWhatsApp.BOT.split('@')[0]}:7@s.whatsapp.net"}}))
    data.mkdir()
    (data / "engine-cache.json").write_text(json.dumps({f"rooti:terrain:{DAULE[0]:.3f},{DAULE[1]:.3f}": json.dumps(TERRAIN)}))
    voice_note = tmp_path / "voz.ogg"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a",
                    "libopus", str(voice_note)], check=True)
    wav = tmp_path / "pregunta.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-ar", "48000",
                    str(wav)], check=True)
    rain_day = (date.today() + timedelta(days=2)).isoformat()

    with contextlib.ExitStack() as stack:
        wa = stack.enter_context(FakeWhatsApp(stand_in / "bridge.js"))
        llm = stack.enter_context(ScriptedLLM(script))
        forecast = stack.enter_context(FakeForecast([(date.today().isoformat(), 3.0), (rain_day, 55.0)]))
        call_port = 17000 + os.getpid() % 1000
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HERMES_", "ROOTI_", "PYTEST_"))}
        env.update({
            "HOME": str(home), "HERMES_HOME": str(hermes_home), "ROOTI_DATA": str(data),
            "ROOTI_TEST_BRIDGE": wa.base, "ROOTI_TEST_SCRIPT": str(stand_in / "bridge.js"), "ROOTI_BRIDGE": wa.base,
            "ROOTI_PROVIDER": "fakellm", "ROOTI_MODEL": "fake",
            "ROOTI_CALL_URL": f"http://127.0.0.1:{call_port}", "ROOTI_FORECAST_URL": f"{forecast.base}/v1/forecast",
            "ROOTI_NOW": f"{date.today().isoformat()}T09:00:00", "GROQ_API_KEY": "e2e", "DEEPSEEK_API_KEY": "e2e",
            "HERMES_STATE_DB_GUARD_BYPASS": "1", "PYTHONUNBUFFERED": "1",
        })
        if (Path.home() / ".hermes" / "tools").is_dir():  # Hermes' Python and Node, not a copy per test
            env["HERMES_RUNTIME_DIR"] = str(Path.home() / ".hermes" / "tools")
        env["PATH"] = f"{BIN.parent}:{env['PATH']}"
        locales = Path(hermes).resolve().parents[2] / "workspace" / "locales"
        if not locales.is_dir() and (Path.home() / ".hermes" / "hermes-agent" / "locales").is_dir():
            env["HERMES_BUNDLED_LOCALES"] = str(Path.home() / ".hermes" / "hermes-agent" / "locales")

        # The Hermes image seeds OpenRouter as the model endpoint: left in place, every model call goes there.
        hermes_home.mkdir(parents=True, exist_ok=True)
        (hermes_home / "config.yaml").write_text(yaml.safe_dump(
            {"model": {"provider": "openrouter", "default": "anthropic/claude-opus-4.6",
                       "base_url": "https://openrouter.ai/api/v1"}}))
        setup = subprocess.run([str(BIN), "hermes-perfil"], env=env, capture_output=True, text=True, check=True)
        assert "Hermes de Rooti" in setup.stdout, setup.stdout
        cfg_file = hermes_home / "config.yaml"
        cfg = yaml.safe_load(cfg_file.read_text())
        assert cfg["voice"]["auto_tts"] is True and cfg["tts"]["edge"]["voice"] == "es-EC-LuisNeural"
        assert "memory" in cfg["agent"]["disabled_toolsets"], "la memoria de Hermes mezclaría a los agricultores"
        cfg["providers"] = {"fakellm": {"api": f"{llm.base}/v1", "api_key": "e2e", "discover_models": False,
                                        "models": ["fake"]}}
        cfg["model"]["context_length"] = 256_000
        cfg["stt"]["enabled"] = False
        cfg["tts"] = {"provider": "e2e", "providers": {"e2e": {"type": "command", "output_format": "ogg",
                                                              "command": f"cp {voice_note} {{output_path}}",
                                                              "voice_compatible": True}}}
        cfg_file.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False))

        gateway = Gateway(hermes, env, tmp_path / "gateway.log")
        stack.callback(gateway.stop)
        call_log = (tmp_path / "llamada.log").open("w")
        call = subprocess.Popen([str(CALL_BIN / "rooti-bot"), "llamada", "--host", "127.0.0.1", "--puerto", str(call_port)],
                                env=env, stdout=call_log, stderr=subprocess.STDOUT, start_new_session=True)
        stack.callback(lambda: os.killpg(call.pid, signal.SIGTERM))

        def reply(text_or_action, timeout=120, chat=FARMER):
            mark = wa.mark()
            text_or_action()
            got = wa.wait_for(lambda: [m for m in wa.messages_to(chat, mark) if m["path"] != "send-media"], timeout)
            assert got, f"Rooti no respondió.\n{(tmp_path / 'gateway.log').read_text()[-4000:]}"
            return got

        def button_reply(text):
            """The button a tool sends, once the model's closing text is in too, so it never spills into the next step."""
            mark = wa.mark()
            wa.say(FARMER, text)
            done = lambda ms: ms if any(m["path"] == "send-url-button" for m in ms) and ms[-1]["path"] == "send" else None
            got = wa.wait_for(lambda: done(wa.messages_to(FARMER, mark)), 120)
            assert got, f"no button.\n{(tmp_path / 'gateway.log').read_text()[-3000:]}"
            return next(m for m in got if m["path"] == "send-url-button")

        # 1. A new farmer: the turn starts with what Rooti knows, and it asks for the plot's location.
        first = reply(lambda: wa.say(FARMER, "hola"), timeout=180)
        assert [m["message"] for m in first] == ["¡Buenas, veci! Aquí Rooti 🌱 ¿Me manda la ubicación de su lote con el clip?"], \
            "solo la respuesta de Rooti: ningún aviso de Hermes"
        turns = [r for r in llm.requests if r.get("tools")]  # not Hermes' own side calls (the session title)
        first_turn = "\n".join(text_of(m) for m in turns[0]["messages"])
        assert "Agricultor nuevo" in first_turn, "el turno empieza con el contexto del lote (rooti-bot contexto)"
        assert "/help" not in first_turn, "la nota de primer contacto de Hermes pide mencionar /help"

        # A «/» is chat for Rooti, never a Hermes command.
        helped = reply(lambda: wa.say(FARMER, "/ayuda"))
        assert [m["message"] for m in helped] == ["Le ayudo a ver qué sembrar y cuándo. ¿Me manda la ubicación de su lote?"]

        report = subprocess.run([str(BIN), "tiempos"], env=env, capture_output=True, text=True, check=True).stdout
        assert re.search(r"texto → texto: mediana \d+\.\d s", report), report

        # 2. The location, then the crops: the lot is saved and its plan computed (live NASA POWER).
        reply(lambda: wa.location(FARMER, *DAULE))
        done = reply(lambda: wa.say(FARMER, "siembro arroz y a veces maíz, son 3 cuadras y no se encharca."), timeout=180)
        assert "revisé su lote" in done[-1]["message"]
        db = sqlite3.connect(data / "rooti.db")
        lot = db.execute("SELECT lat, lon, crops, area, unit, waterlog FROM farmers WHERE phone = ?", (FARMER,)).fetchone()
        assert lot == (DAULE[0], DAULE[1], '["rice", "maize", "soybean"]', 3.0, "cuadra", 0), lot
        assert db.execute("SELECT COUNT(*) FROM plans WHERE phone = ?", (FARMER,)).fetchone()[0] == 1

        # 3. When to sow rice: straight from the saved plan, in month words.
        sow = reply(lambda: wa.say(FARMER, "¿y cuándo siembro el arroz?"))
        assert re.search(r"mejor mes para sembrar es (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|"
                         r"octubre|noviembre|diciembre) \d{4}", sow[-1]["message"]), sow
        tool_calls = [c["function"]["name"] for r in llm.requests for m in r["messages"]
                      for c in m.get("tool_calls") or []]
        assert any(n.endswith("cuando_sembrar") for n in tool_calls)
        assert not any("_canal" in json.dumps(t) for t in turns[-1].get("tools") or []), \
            "el modelo nunca ve de qué chat es el lote"

        # 4. The call button, with a link signed for this farmer.
        button = button_reply("mejor quiero hablar con usted")
        assert button["buttonText"] == "📞 Hablar con Rooti" and button["url"].startswith(env["ROOTI_CALL_URL"] + "/llamada#t=")

        # 8. The pages: «Marcar mi lote» and «Ver mi plan», signed for this farmer.
        site = env["ROOTI_CALL_URL"]
        mark_btn = button_reply("¿cómo le mando mi lote?")
        assert mark_btn["buttonText"] == "Marcar mi lote" and mark_btn["url"].startswith(f"{site}/#t=")
        assert mark_btn["url"].endswith("&r=planear/1"), "the signed link rides in the fragment, never in a log"
        plan_btn = button_reply("mándeme el plan")
        assert plan_btn["buttonText"] == "Ver mi plan" and plan_btn["url"].endswith("&r=plan")
        page_token = token_of(plan_btn["url"])
        status, html = http("GET", f"{site}/")
        assert status == 200 and 'src="main.js' in html, "the page is the web app itself"
        assert http("GET", f"{site}/llamada")[0] == 200 and http("GET", f"{site}/app/")[0] == 200
        assert http("GET", f"{site}/data/bot.json")[1] == {"url": "", "whatsapp": FakeWhatsApp.BOT.split("@")[0]}
        assert http("GET", f"{site}/api/lot", token=page_token[:-2] + "xx")[0] == 403, "an edited link opens nothing"
        status, page = http("GET", f"{site}/api/lot", token=page_token)
        assert status == 200 and page["plan"]["place"]["lat"] == DAULE[0] and page["plan"]["crops"] == ["rice", "maize", "soybean"]
        assert page["plan"]["unit"] == "cuadra" and page["plan"]["waterlog"] == "no" and page["alert"] is None

        # The farmer draws the plot on the map and corrects the size: saved, and Rooti confirms in the chat.
        corners = [[-79.9805, -1.8595], [-79.9790, -1.8595], [-79.9790, -1.8610], [-79.9805, -1.8610]]
        drawn = {**page["plan"], "area": 4, "lot": corners}
        mark = wa.mark()
        assert http("PUT", f"{site}/api/lot", drawn, token=page_token)[0] == 200
        confirmed = wa.wait_for(lambda: [m for m in wa.messages_to(FARMER, mark) if m["path"] == "send-url-button"], 120)
        assert confirmed, wa.messages_to(FARMER, mark)
        assert "recibí su lote: 4 cuadras en Daule, con arroz, maíz duro amarillo y soya" in confirmed[0]["message"], confirmed
        assert confirmed[0]["buttonText"] == "Ver mi plan"
        lot = db.execute("SELECT area, plot FROM farmers WHERE phone = ?", (FARMER,)).fetchone()
        assert lot[0] == 4 and json.loads(lot[1]) == corners

        # The farmer picks a plan on the page: the chat confirms it and asks about alerts; the model hears it.
        mark = wa.mark()
        assert http("POST", f"{site}/api/choice", {"key": "safe", "name": "El más seguro",
                                                  "route": "Maíz, diciembre a marzo"}, token=page_token)[0] == 200
        picked = wa.wait_for(lambda: wa.messages_to(FARMER, mark), 30)
        assert picked and picked[0]["message"].startswith("Anotado: eligió «El más seguro». Maíz, diciembre a marzo.")
        assert "¿Quiere que le avise" in picked[0]["message"]

        # 5. A group is not one farmer's lot: no answer.
        mark = wa.mark()
        wa.say("120363000000000000@g.us", "rooti, ¿qué siembro?", group=True, sender=FARMER)
        time.sleep(8)
        assert not [m for m in wa.sent[mark:] if m.get("chatId", "").endswith("@g.us")]

        # 5b. The model fails (a revoked key): a short apology in Spanish, never Hermes' own error.
        failed = reply(lambda: wa.say(FARMER, "prueba de falla"))
        assert [m["message"] for m in failed] == ["Disculpe, ahorita no le pude responder. ¿Me escribe de nuevo en un ratito?"], \
            failed

        # 6. Alerts: only after the farmer agrees; heavy rain in the forecast sends a voice note and the call button.
        reply(lambda: wa.say(FARMER, "sí, avíseme cuando venga lluvia"))
        assert db.execute("SELECT alerts_ok FROM farmers WHERE phone = ?", (FARMER,)).fetchone()[0] == 1
        mark = wa.mark()
        sent = subprocess.run([str(BIN), "avisos"], env=env, capture_output=True, text=True, timeout=120)
        assert sent.returncode == 0, sent.stderr
        assert json.loads(sent.stdout)[0]["kind"] == "heavy_rain", sent.stdout
        alert_msgs = wa.messages_to(FARMER, mark)
        assert [m["path"] for m in alert_msgs] == ["send-media", "send-url-button"], alert_msgs
        assert alert_msgs[0]["mediaType"] == "audio" and Path(alert_msgs[0]["filePath"]).stat().st_size > 1000
        assert "55 milímetros" in alert_msgs[1]["message"]
        assert alert_msgs[1]["buttonText"] == "Ver el aviso" and alert_msgs[1]["url"].endswith("&r=aviso")
        sim = [r for r in llm.requests if r.get("tools")][-1]
        assert "eligió «El más seguro»" in "\n".join(text_of(m) for m in sim["messages"]), \
            "the plan picked on the page is in the turn's context"
        again = subprocess.run([str(BIN), "avisos"], env=env, capture_output=True, text=True, timeout=120)
        assert json.loads(again.stdout) == [], "el mismo aviso no sale dos veces"

        # 9. The alert's page: it reads the alert, and opening it counts as heard.
        token = token_of(alert_msgs[1]["url"])
        status, page = http("GET", f"{site}/api/lot", token=token)
        assert status == 200 and page["alert"]["kind"] == "heavy_rain" and page["alert"]["key"] == rain_day
        assert page["call"].startswith(f"{site}/llamada#t=")
        assert db.execute("SELECT call_opened_at FROM alerts WHERE phone = ?", (FARMER,)).fetchone()[0] is not None
        db.execute("UPDATE alerts SET call_opened_at = NULL")  # so the call below is what marks it again
        db.commit()

        # 7. Opening the alert's call: the page's offer is answered and the alert counts as heard.
        probe = subprocess.run([str(CALL_BIN / "python"), str(Path(__file__).parent / "call_probe.py"),
                                env["ROOTI_CALL_URL"], token, str(wav)], env=env, capture_output=True, text=True,
                               timeout=90)
        assert probe.returncode == 0, probe.stderr[-3000:]
        result = json.loads(probe.stdout.strip().splitlines()[-1])
        assert result == {"type": "answer", "state": "connected"}, result
        opened = db.execute("SELECT call_opened_at FROM alerts WHERE phone = ?", (FARMER,)).fetchone()[0]
        assert opened is not None
        later = dict(env, ROOTI_NOW=f"{date.today().isoformat()}T15:00:00")
        mark = wa.mark()
        subprocess.run([str(BIN), "avisos"], env=later, capture_output=True, text=True, timeout=120, check=True)
        assert not wa.messages_to(FARMER, mark), "quien ya abrió la llamada no recibe recordatorio"

        # 10. The public website hands a lot to WhatsApp: a code the newcomer sends, and Rooti already has the lot.
        website = {"place": {"name": "Daule", "lat": DAULE[0], "lon": DAULE[1]}, "crops": ["maize", "soybean"],
                   "current": ["maize"], "area": 2, "unit": "ha", "irrigation": False, "waterlog": "sometimes",
                   "lot": corners}
        status, handed = http("POST", f"{site}/api/handoff", website)
        assert status == 200 and re.fullmatch(r"RT-[A-HJ-NP-Z2-9]{4}", handed["code"]), handed
        welcome = reply(lambda: wa.say(NEWCOMER, f"Hola Rooti, mi lote es {handed['code']}"), chat=NEWCOMER)
        assert welcome[-1]["message"] == "¡Buenas, veci! Ya tengo su lote de la página.", welcome
        lot = db.execute("SELECT lat, crops, area, unit, waterlog, plot FROM farmers WHERE phone = ?", (NEWCOMER,)).fetchone()
        assert lot == (DAULE[0], '["maize", "soybean"]', 2.0, "ha", 1, json.dumps(corners)), lot
        stranger = "593980000001@s.whatsapp.net"
        again = reply(lambda: wa.say(stranger, f"mi lote es {handed['code']}"), chat=stranger)
        assert again[-1]["message"] == "Ese código no me sirve, marque su lote otra vez.", "a code brings a lot only once"
