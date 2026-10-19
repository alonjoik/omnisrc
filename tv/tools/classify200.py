#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""classify200.py — 鉴别 http-200 判死源：WAF 挑战页 / 真实列表页 / 薄页

按 ext 分类url 实拉分类页（cateId 取分类串第一个 id），按内容特征分三类：
  WAF挑战页   = _guard/challenge/jsluid 等守卫标记 → 壳实质不可用
  真实列表页  = 页面大且含 vod/module/stui 等列表标记 → 站活源死（模板选择器失配，可救）
  薄页        = 站在但返回过短/异常内容 → 待定
"""
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

if hasattr(__import__("sys").stdout, "reconfigure"):
    __import__("sys").stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def cat_url(e: dict) -> str:
    ext = e.get("ext")
    if isinstance(ext, str):
        try:
            ext = json.loads(ext)
        except Exception:
            return ""
    u = ext.get("分类url", "")
    cls = ext.get("分类", "")
    m = re.search(r"\$(\w+)", cls.split("#")[0]) if cls else None
    cid = m.group(1) if m else "1"
    for ph, v in [("{cateId}", cid), ("{catePg}", "1"), ("{area}", ""), ("{by}", ""), ("{class}", ""), ("{year}", "")]:
        u = u.replace(ph, v)
    return u


def probe(k: str, e: dict) -> tuple[str, str]:
    u = cat_url(e)
    if not u:
        return k, "no-caturl"
    try:
        req = urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read(300000).decode("utf-8", "ignore")
        if "_guard" in body or "challenge" in body.lower() or "jsluid" in body.lower():
            return k, f"WAF挑战页({len(body)}B)"
        if len(body) > 15000 and re.search(r"(vod|module|stui|voda|card)", body):
            return k, f"真实列表页({len(body)}B)"
        return k, f"薄页({len(body)}B)"
    except Exception as ex:
        return k, f"FAIL:{type(ex).__name__}"


def main() -> int:
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    reach = json.loads((TV_DIR / "tools" / "reach_result.json").read_text(encoding="utf-8"))
    ok200 = [k for k, v in reach.items() if v["reach"] == "http-200"]
    out = {}
    with ThreadPoolExecutor(8) as ex:
        for k, st in ex.map(lambda k: probe(k, entries[k]), ok200):
            out[k] = st
            print(f"{k:14s} {st}")
    (TV_DIR / "tools" / "classify200_result.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    __import__("sys").exit(main())
