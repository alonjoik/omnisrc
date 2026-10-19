#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""page_anatomy.py — 站活源死条目页面解剖：分类页实拉 + 列表结构特征诊断"""
import json
import re
import sys
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}


def cat_url(ext: dict) -> str:
    u = ext.get("分类url", "")
    cls = ext.get("分类", "")
    m = re.search(r"\$(\w+)", cls.split("#")[0]) if cls else None
    cid = m.group(1) if m else "1"
    for ph, v in [("{cateId}", cid), ("{catePg}", "1"), ("{wd}", "爱"), ("{pg}", "1"),
                  ("{area}", ""), ("{by}", ""), ("{class}", ""), ("{year}", ""), ("{lang}", ""), ("{letter}", "")]:
        u = u.replace(ph, v)
    return u


def analyze(name: str, url: str):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=12) as r:
            body = r.read(500000).decode("utf-8", "ignore")
    except Exception as ex:
        print(f"{name}: FAIL {type(ex).__name__} {str(ex)[:70]}")
        return
    print(f"{name}: {len(body)}B")
    if "_guard" in body or "challenge" in body.lower():
        print("  → WAF 挑战页")
        return
    # 详情链接形态统计
    pats = {
        "vod/detail": r'href="(/vod/detail/[^"]+)"',
        "voddetail": r'href="(/voddetail[^"]+)"',
        "detail-id": r'href="(/detail/[^"]+)"',
        "xktype-rel": r'href="(/xkdetail[^"]+|/xktype[^"]*detail[^"]*)"',
        "movie-id": r'href="(/movie/[^"]+|/v_play[^"]+)"',
        "绝对url详情": r'href="(https?://[^"]*(?:detail|dplay|play)[^"]*)"',
        "video链接": r'href="([^"]*video[^"]*)"',
    }
    for label, pat in pats.items():
        hits = re.findall(pat, body)
        if hits:
            print(f"  {label}: {len(hits)} 例 {hits[0][:60]}")
    # 列表容器类名候选
    for c in ["module-poster-item", "module-item-pic", "stui-vodlist__item", "myui-vodlist__thumb",
              "voda", "video-listing", "card", "list-unstyled", "thumb", "item-title", "xk"]:
        n = body.count(c)
        if n:
            print(f"  容器候选 {c}: {n}")
    if len(body) < 8000:
        print(f"  薄页头部: {body[:200]!r}")


def main() -> int:
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    for k in sys.argv[1:]:
        e = entries.get(k)
        if not e:
            continue
        ext = e.get("ext")
        if isinstance(ext, str):
            try:
                ext = json.loads(ext)
            except Exception:
                ext = {}
        print(f"── {k} {e.get('name','')}")
        analyze(k, cat_url(ext))
    return 0


if __name__ == "__main__":
    sys.exit(main())
