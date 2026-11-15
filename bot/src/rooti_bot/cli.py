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
    sub.add_parser("hermes-perfil", help="escribe el Hermes de Rooti (cada arranque)")
    link = sub.add_parser("whatsapp-vincular", help="vincula el número de Rooti con un código")
    link.add_argument("numero", nargs="?")
    av = sub.add_parser("avisos", help="una pasada de avisos (o --servicio: cada --cada segundos)")
    av.add_argument("--probar", action="store_true", help="muestra lo que mandaría, sin mandar nada")
    av.add_argument("--servicio", action="store_true")
    av.add_argument("--cada", type=int, default=1800)
    call = sub.add_parser("llamada", help="la página y el servidor de la llamada en vivo")
    call.add_argument("--host", default="0.0.0.0")
    call.add_argument("--puerto", type=int, default=7860)
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
    if args.cmd == "llamada":
        from rooti_bot import call_server
        return call_server.serve(args.host, args.puerto)
    return 2


if __name__ == "__main__":
    sys.exit(main())
