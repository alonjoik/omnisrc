#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ab_check.py — 模板 A/B 对照：同源分别在 旧版(xbpq_old.js)/新版(xbpq.js) 模板下跑 category+search"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
APP_ROOT = TV_DIR.parent.parent
CLI = APP_ROOT / "src-tauri" / "target" / "debug" / "ibox-cli.exe"


def run(srcfile: Path, entry: str, *args: str) -> str:
    try:
        p = subprocess.run([str(CLI), f"srcfile:{srcfile}", entry, *args],
                           cwd=str(APP_ROOT), capture_output=True, text=True,
                           timeout=35, encoding="utf-8", errors="ignore")
        return p.stdout if p.returncode == 0 else ""
    except subprocess.TimeoutExpired:
        return ""


def alive_n(out: str) -> int:
    try:
        return len(json.loads(out).get("list", []))
    except Exception:
        return 0


def main() -> int:
    keys = sys.argv[1:]
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    f = Path(tempfile.gettempdir()) / "ibox_ab.json"
    for k in keys:
        e = entries[k]
        ext = e.get("ext", "null")
        if isinstance(ext, dict):
            ext = json.dumps(ext, ensure_ascii=False)
        row = [k, e.get("name", "")[:12]]
        for label, api in [("旧", "js://xbpq_old.js"), ("新", "js://tpl/xbpq.js")]:
            f.write_text(json.dumps({"kind": "jsdrpy", "api": api, "ext": ext}, ensure_ascii=False), encoding="utf-8")
            n = alive_n(run(f, "category", "1", "1"))
            if n == 0:
                n = alive_n(run(f, "search", "爱"))
            row.append(f"{label}={n}")
        print("  ".join(row))
    return 0


if __name__ == "__main__":
    sys.exit(main())
