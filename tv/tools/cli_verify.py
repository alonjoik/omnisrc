#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cli_verify.py — unknown 源壳内批量复核（探活 unknown → 壳 CLI home 实测）

对 probe_result.json 里 status=unknown 的条目逐个走壳 CLI（真实 qjs 引擎 + reqwest 网络），
实测 home 出数则 alive；失败/超时则 dead。结果写回 probe_result.json 的 cli 字段。
用法: python tools/cli_verify.py   （需先 cargo build --bin ibox-cli）
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


def main() -> int:
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    results = json.loads((TV_DIR / "probe_result.json").read_text(encoding="utf-8"))
    todo = [r for r in results if r.get("status") == "unknown"]
    print(f"待复核 {len(todo)} 条")
    ok = dead = 0
    for i, r in enumerate(todo):
        e = entries.get(r["key"])
        if not e:
            r["cli"] = "dead"
            continue
        spec = {"kind": "jsdrpy", "api": f"js://tpl/{e['tpl']}", "ext": e.get("ext", "null")}
        if isinstance(spec["ext"], dict):
            spec["ext"] = json.dumps(spec["ext"], ensure_ascii=False)
        f = Path(tempfile.gettempdir()) / "ibox_cli_verify.json"
        f.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        t0 = time.monotonic()
        try:
            # 两步：home 取真实 type_id（各源分类编号体系不同，盲传 tid=1 会假死）
            p1 = subprocess.run(
                [str(CLI), f"srcfile:{f}", "home"],
                cwd=str(APP_ROOT), capture_output=True, text=True, timeout=30, encoding="utf-8", errors="ignore",
            )
            tid = "1"
            try:
                cls = json.loads(p1.stdout).get("class", [])
                if cls:
                    tid = str(cls[0].get("type_id", "1"))
            except Exception:
                pass
            p = subprocess.run(
                [str(CLI), f"srcfile:{f}", "category", tid, "1"],
                cwd=str(APP_ROOT), capture_output=True, text=True, timeout=45, encoding="utf-8", errors="ignore",
            )
            ms = int((time.monotonic() - t0) * 1000)
            n = 0
            try:
                n = len(json.loads(p.stdout).get("list", []))
            except Exception:
                pass
            alive = p.returncode == 0 and n > 0
            r["cli_n"] = n
            r["cli_tid"] = tid
            r["cli"] = "alive" if alive else "dead"
            r["cli_ms"] = ms
            if alive:
                ok += 1
            else:
                dead += 1
                r["cli_err"] = (p.stderr or p.stdout)[:100]
        except subprocess.TimeoutExpired:
            dead += 1
            r["cli"] = "dead"
            r["cli_err"] = "CLI 超时 30s"
        print(f"  [{i+1}/{len(todo)}] {r['key'][:14]} {r['cli']} ({r.get('cli_ms', '-')}ms)")
    (TV_DIR / "probe_result.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"复核完成: 壳内可用 {ok} / 壳内死 {dead}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
