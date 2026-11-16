"""rooti-bot: the commands Hermes, the plugin and the container's services run."""
import argparse
import json
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Guayaquil")
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def context(chat: str) -> str:
    """What the model gets at the start of each turn: the clock and the farmer's lot, so a first answer needs no
    tool round trip."""
    from rooti_bot import store, tools
    now = datetime.now(TZ)
    lines = [f"Ahora: {WEEKDAYS[now.weekday()]} {now:%d/%m/%Y %H:%M} (Ecuador)."]
    farmer = store.get(chat)
    if farmer is None:
        lines.append("Agricultor nuevo: todavía no sabes nada de su lote. Preséntate en una frase y pídele la "
                     "ubicación del lote.")
        return "\n".join(lines)
    lot = tools.my_lot(chat, {})
    lines.append("Su lote: " + json.dumps({k: v for k, v in lot["lote"].items() if v not in (None, "", [])},
                                          ensure_ascii=False))
    if lot["falta_saber"]:
        lines.append("Falta preguntarle: " + ", ".join(lot["falta_saber"]) + ".")
    lines.append("Plan calculado: sí (léelo con plan_recomendado)." if lot["plan_listo"] else "Plan calculado: todavía no.")
    pages = store.sent_buttons(chat, time.time() - 86400)
    if pages:
        lines.append("Botones que ya le llegaron hoy: " + ", ".join(
            f"«{b['label']}» (hace {max(1, round((time.time() - b['sent_at']) / 60))} min)" for b in pages)
            + ". No se los mandes otra vez si no te los pide.")
    asked = store.web_turns(time.time() - 86400, phone=chat)[-3:]
    if asked:
        lines.append("En la página web también habló con Rooti (no lo repitas, sigue desde ahí): " + " | ".join(
            f"hace {max(1, round((time.time() - t['at']) / 60))} min preguntó «{t['question'][:200]}» y Rooti le "
            f"dijo «{t['answer'][:300]}»" for t in asked))
    chosen = farmer.get("chosen")
    if chosen:
        lines.append(f"En la página «Ver mi plan» eligió «{chosen['name']}»: {chosen.get('route') or ''}")
        if not farmer["alerts_ok"]:
            lines.append("Al elegirlo, Rooti le preguntó en el chat si quiere avisos de lluvia fuerte y de siembra: si "
                         "dice que sí, guárdalo con guardar_lote (alerts_ok).")
    return "\n".join(lines)


def redeem(chat: str, code: str) -> dict:
    """A lot made on the website, brought to this chat by its code (the farmer sends «mi lote es RT-XXXX»)."""
    from rooti_bot import lots, store
    fields = store.redeem_handoff(code, chat)
    if fields is None:
        return {"ok": False}
    store.update(chat, **fields)
    return {"ok": True, "lote": lots.describe(fields)}


def times(days: int) -> str:
    """Median and p90 seconds from the farmer's message to Rooti's first text and first voice note."""
    import statistics
    from rooti_bot import config
    path = config.data_dir() / "tiempos.jsonl"
    since = time.time() - days * 86400
    rows = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("a", 0) >= since:
                rows.append(row)
    lines = [f"Últimos {days} días: {len({(r['chat'], r['a']) for r in rows})} mensajes de agricultores."]
    for asked, answer, label in (("texto", "texto", "texto → texto"), ("voz", "texto", "audio → texto"),
                                 ("voz", "voz", "audio → nota de voz")):
        secs = sorted(r["segundos"] for r in rows if r["en"] == asked and r["respuesta"] == answer)
        if secs:
            p90 = secs[min(len(secs) - 1, int(len(secs) * 0.9))]
            lines.append(f"  {label}: mediana {statistics.median(secs):.1f} s, p90 {p90:.1f} s ({len(secs)})")
        else:
            lines.append(f"  {label}: sin datos")
    return "\n".join(lines)


def web_turns(days: int, last: int) -> str:
    """How Rooti on the website is doing: questions, seconds to a full answer, tools that failed, the latest ones."""
    import statistics
    from collections import Counter
    from rooti_bot import store
    rows = store.web_turns(time.time() - days * 86400)
    if not rows:
        return f"Últimos {days} días: nadie le preguntó a Rooti en la web."
    secs = sorted(r["seconds"] for r in rows)
    used = Counter(t["name"] for r in rows for t in r["tools"])
    broke = Counter(f"{t['name']}: {t['error']}" for r in rows for t in r["tools"] if t["error"])
    lines = [f"Últimos {days} días: {len(rows)} preguntas en la web, {sum(r['voice'] for r in rows)} por voz, "
             f"{len({r['phone'] for r in rows if r['phone']})} de agricultores que vinieron de WhatsApp.",
             f"  respuesta completa: mediana {statistics.median(secs):.1f} s, "
             f"p90 {secs[min(len(secs) - 1, int(len(secs) * 0.9))]:.1f} s",
             f"  sin respuesta: {sum(r['failed'] for r in rows)}",
             "  herramientas: " + (", ".join(f"{n} {c}" for n, c in used.most_common()) or "ninguna")]
    if broke:
        lines.append("  herramientas que fallaron: " + "; ".join(f"{e} ({c})" for e, c in broke.most_common(8)))
    if last:
        lines.append(f"Las últimas {min(last, len(rows))}:")
        for r in rows[-last:]:
            when = datetime.fromtimestamp(r["at"], TZ).strftime("%d/%m %H:%M")
            tools = ", ".join(t["name"] for t in r["tools"])
            lines.append(f"  {when} [{r['screen']}] «{r['question'][:120]}» → «{r['answer'][:160]}»"
                         + (f" ({tools})" if tools else "") + f" {r['seconds']:.1f} s")
    return "\n".join(lines)


def serve_alerts(every: int) -> int:
    from rooti_bot import alerts
    while True:
        try:
            for sent in alerts.run():
                print(f"[avisos] {sent['kind']} → {sent['phone'][:6]}…", flush=True)
        except Exception as exc:
            print(f"[avisos] falló una pasada: {exc}", file=sys.stderr, flush=True)
        time.sleep(every)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="rooti-bot")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("mcp", help="las herramientas de Rooti para Hermes (stdio)")
    ctx = sub.add_parser("contexto", help="el contexto de un turno (lo pide el plugin)")
    ctx.add_argument("--chat", required=True)
    rd = sub.add_parser("canjear", help="trae al chat el lote hecho en la web, con su código (lo pide el plugin)")
    rd.add_argument("--chat", required=True)
    rd.add_argument("--codigo", required=True)
    bt = sub.add_parser("botones", help="manda los botones que esperan la respuesta de Rooti (lo pide el plugin)")
    bt.add_argument("--chat", required=True)
    sub.add_parser("hermes-perfil", help="escribe el Hermes de Rooti (cada arranque)")
    link = sub.add_parser("whatsapp-vincular", help="vincula el número de Rooti con un código")
    link.add_argument("numero", nargs="?")
    av = sub.add_parser("avisos", help="una pasada de avisos (o --servicio: cada --cada segundos)")
    av.add_argument("--probar", action="store_true", help="muestra lo que mandaría, sin mandar nada")
    av.add_argument("--servicio", action="store_true")
    av.add_argument("--cada", type=int, default=1800)
    tm = sub.add_parser("tiempos", help="cuánto tarda Rooti en responder (mediana y p90)")
    tm.add_argument("--dias", type=int, default=7)
    wt = sub.add_parser("web-turnos", help="cómo le va a Rooti en la web: preguntas, tiempos, herramientas que fallan")
    wt.add_argument("--dias", type=int, default=7)
    wt.add_argument("--ultimas", type=int, default=10, help="cuántas preguntas recientes mostrar")
    srv = sub.add_parser("web", help="la web de Rooti, las páginas de WhatsApp y su API")
    srv.add_argument("--host", default="0.0.0.0")
    srv.add_argument("--puerto", type=int, default=7860)
    args = parser.parse_args(argv)

    if args.cmd == "mcp":
        from rooti_bot import mcp_server
        return mcp_server.serve()
    if args.cmd == "contexto":
        try:
            print(json.dumps({"contexto": context(args.chat)}, ensure_ascii=False))
        except Exception as exc:
            print(json.dumps({"contexto": None, "error": str(exc)}))
        return 0
    if args.cmd == "canjear":
        try:
            print(json.dumps(redeem(args.chat, args.codigo), ensure_ascii=False))
        except Exception as exc:
            print(json.dumps({"ok": False, "error": str(exc)}))
        return 0
    if args.cmd == "botones":
        from rooti_bot import tools
        print(json.dumps({"enviados": tools.send_queued(args.chat)}))
        return 0
    if args.cmd == "hermes-perfil":
        from rooti_bot import hermes_setup
        return hermes_setup.run()
    if args.cmd == "whatsapp-vincular":
        from rooti_bot import hermes_setup
        return hermes_setup.link_number(args.numero)
    if args.cmd == "avisos":
        if args.servicio:
            return serve_alerts(args.cada)
        from rooti_bot import alerts
        print(json.dumps(alerts.run(dry_run=args.probar), ensure_ascii=False, indent=1))
        return 0
    if args.cmd == "tiempos":
        print(times(args.dias))
        return 0
    if args.cmd == "web-turnos":
        print(web_turns(args.dias, args.ultimas))
        return 0
    if args.cmd == "web":
        from rooti_bot import server
        return server.serve(args.host, args.puerto)
    return 2


if __name__ == "__main__":
    sys.exit(main())
