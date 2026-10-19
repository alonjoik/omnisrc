#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dead_recheck.py — dead 条目壳内复核 v2（category 真拉列表数据才算活）

home 的分类来自 ext 静态配置（xbpq）或失败兜底（maccms），不触网也能返回——
必须调 category 实际拉取列表页/接口，断言返回非空 list 才是真活。
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
    dead = [r for r in results if r.get("status") == "dead"]
    print(f"复核 {len(dead)} 条 dead（壳 CLI category 实拉数据）")
    alive = 0
    for i, r in enumerate(dead):
        e = entries.get(r["key"])
        if not e or not e.get("tpl"):
            api = r.get("api", "")
            args = [str(CLI), f"maccms:{api}", "category", "1", "1"] if api.startswith("http") else None
        else:
            ext = e.get("ext", "null")
            if isinstance(ext, dict):
                ext = json.dumps(ext, ensure_ascii=False)
            f = Path(tempfile.gettempdir()) / "ibox_dead_check.json"
            f.write_text(json.dumps({"kind": "jsdrpy", "api": f"js://tpl/{e['tpl']}", "ext": ext}, ensure_ascii=False), encoding="utf-8")
            args = [str(CLI), f"srcfile:{f}", "category", "1", "1"]
        if not args:
            r["cli"] = "skipped"
            continue
        t0 = time.monotonic()
        try:
            p = subprocess.run(args, cwd=str(APP_ROOT), capture_output=True, text=True,
                               timeout=30, encoding="utf-8", errors="ignore")
            ms = int((time.monotonic() - t0) * 1000)
            # 真数据判据：category 返回的 list 数组非空（站点实际给出了影片列表）
            n = 0
            try:
                n = len(json.loads(p.stdout).get("list", []))
            except Exception:
                pass
            ok = p.returncode == 0 and n > 0
            r["cli"] = "alive" if ok else "dead"
            r["cli_n"] = n
            r["cli_ms"] = ms
            if ok:
                alive += 1
            print(f"  [{i+1}/{len(dead)}] {r['key'][:14]} {'真活✓' if ok else '死✗'} list={n} ({ms}ms)")
        except subprocess.TimeoutExpired:
            r["cli"] = "dead"
            r["cli_n"] = 0
            print(f"  [{i+1}/{len(dead)}] {r['key'][:14]} 超时✗ (30s)")
    (TV_DIR / "probe_result.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n结论: 壳内 category 实拉可用 {alive}/{len(dead)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
