#!/usr/bin/env python3
"""Hook UserPromptSubmit de Claude Code: anota cada pedido a la IA en SI_USAGE.md.

Sirve para llenar el campo "Use of Super Intelligence (SI)" de la entrega de Space Apps.
Activarlo en el .claude/settings.json del proyecto (ver README.md de esta carpeta).
"""
import datetime
import json
import os
import sys

data = json.load(sys.stdin)
prompt = (data.get("prompt") or "").strip().replace("\n", " ")
if prompt:
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or "."
    path = os.path.join(root, "SI_USAGE.md")
    new = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as f:
        if new:
            f.write("# SI usage log (Claude Code)\n\n| Time | Request |\n|---|---|\n")
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        f.write(f"| {ts} | {prompt[:300].replace('|', '/')} |\n")
sys.exit(0)
