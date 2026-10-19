#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deep_recheck.py — 判死源深度复核（三轮通道：home×分类→category×3→search 兜底）

对 probe_result.json 里 cli=dead 或 status=dead 的条目：
  1. home 取前 3 个真实 type_id（各源分类编号体系不同）
  2. 逐个 category(tid,1) 实拉，任一 list>0 即活
  3. 全空再用 search("爱") 兜底——搜索出数据同样证明站点可用
结果写 deep 字段（alive/dead），并输出终审清单。
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


def run(srcfile: Path, entry: str, *args: str) -> tuple[int, str]:
    try:
        p = subprocess.run(
            [str(CLI), f"srcfile:{srcfile}", entry, *args],
            cwd=str(APP_ROOT), capture_output=True, text=True,
            timeout=20, encoding="utf-8", errors="ignore",
        )
        return p.returncode, p.stdout
    except subprocess.TimeoutExpired:
        return -1, ""


def list_n(out: str) -> int:
    try:
        return len(json.loads(out).get("list", []))
    except Exception:
        return 0


def main() -> int:
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    results = json.loads((TV_DIR / "probe_result.json").read_text(encoding="utf-8"))
    todo = [r for r in results if r.get("cli") == "dead" or (r.get("status") == "dead" and "cli" not in r)]
    print(f"深度复核 {len(todo)} 条判死源（home×分类 → category×3 → search 兜底）")
    alive_cnt = 0
    f = Path(tempfile.gettempdir()) / "ibox_deep_check.json"
    for i, r in enumerate(todo):
        e = entries.get(r["key"])
        if not e or not e.get("tpl"):
            r["deep"] = "skipped(no-tpl)"
            continue
        ext = e.get("ext", "null")
        if isinstance(ext, dict):
            ext = json.dumps(ext, ensure_ascii=False)
        f.write_text(json.dumps({"kind": "jsdrpy", "api": f"js://tpl/{e['tpl']}", "ext": ext}, ensure_ascii=False), encoding="utf-8")

        t0 = time.monotonic()
        verdict, how = "dead", ""
        rc, out = run(f, "home")
        tids = []
        try:
            cls = json.loads(out).get("class", [])
            tids = [str(c.get("type_id")) for c in cls[:3] if c.get("type_id") is not None]
        except Exception:
            pass
        if not tids:
            tids = ["1"]
        for tid in tids:
            rc, out = run(f, "category", tid, "1")
            n = list_n(out)
            if n > 0:
                verdict, how = "alive", f"category(tid={tid}) list={n}"
                break
        if verdict == "dead":
            rc, out = run(f, "search", "爱")
            n = list_n(out)
            if n > 0:
                verdict, how = "alive", f"search list={n}"
        ms = int((time.monotonic() - t0) * 1000)
        r["deep"] = verdict
        r["deep_how"] = how
        r["deep_ms"] = ms
        if verdict == "alive":
            alive_cnt += 1
        print(f"  [{i+1}/{len(todo)}] {r['key'][:14]} {verdict} {how} ({ms}ms)")
    (TV_DIR / "probe_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n深度复核: 活 {alive_cnt} / 死 {len(todo) - alive_cnt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
