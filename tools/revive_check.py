#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""revive_check.py — 模板修复后复活验证（home 取 tid → category 实拉）

对指定源列表逐条：home 取第一个真实 type_id → category(tid,1) 实拉，
list>0 判活并打印首条片名。
"""
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
        p = subprocess.run(
            [str(CLI), f"srcfile:{srcfile}", entry, *args],
            cwd=str(APP_ROOT), capture_output=True, text=True,
            timeout=30, encoding="utf-8", errors="ignore",
        )
        return p.stdout if p.returncode == 0 else ""
    except subprocess.TimeoutExpired:
        return ""


def main() -> int:
    keys = sys.argv[1:]
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    f = Path(tempfile.gettempdir()) / "ibox_revive.json"
    alive = 0
    for k in keys:
        e = entries.get(k)
        if not e:
            print(f"{k}: 不在 sources.json")
            continue
        ext = e.get("ext", "null")
        if isinstance(ext, dict):
            ext = json.dumps(ext, ensure_ascii=False)
        f.write_text(json.dumps({"kind": "jsdrpy", "api": f"js://tpl/{e['tpl']}", "ext": ext}, ensure_ascii=False), encoding="utf-8")
        t0 = time.monotonic()
        first = ""
        verdict = "dead"
        out = run(f, "home")
        tid = "1"
        try:
            cls = json.loads(out).get("class", [])
            if cls and cls[0].get("type_id") is not None:
                tid = str(cls[0]["type_id"])
        except Exception:
            pass
        out = run(f, "category", tid, "1")
        try:
            lst = json.loads(out).get("list", [])
            if lst:
                verdict = "alive"
                first = lst[0].get("vod_name", "")
        except Exception:
            pass
        if verdict == "dead":  # search 兜底（对齐 deep_recheck 终审判据）
            out = run(f, "search", "爱")
            try:
                lst = json.loads(out).get("list", [])
                if lst:
                    verdict = "alive"
                    first = f"search:{lst[0].get('vod_name','')}"
            except Exception:
                pass
        ms = int((time.monotonic() - t0) * 1000)
        if verdict == "alive":
            alive += 1
        print(f"{k} {e.get('name','')[:16]:18s} {verdict} tid={tid} 首条={first[:14]} ({ms}ms)")
    print(f"\n复活 {alive}/{len(keys)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
