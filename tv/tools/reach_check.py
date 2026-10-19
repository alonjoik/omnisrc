#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""reach_check.py — 判死源域名级独立通道复核（DNS / HTTP 可达性）

与壳 CLI（reqwest+drpy 引擎）完全独立的通道：
  dns-fail      = 域名已失效（最强死证）
  conn-fail     = 域名在但服务器不可达（死/墙）
  http-4xx/5xx  = 服务器活着（可能加 WAF/防盗链，源不一定死）
  http-2xx/3xx  = 服务器正常响应
仅判 dead 条目 ext 里的第一个 URL（xbpq=站点 host，xyqh=规则地址）。
"""
import json
import re
import socket
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

if hasattr(__import__("sys").stdout, "reconfigure"):
    __import__("sys").stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def first_url(e: dict) -> str:
    ext = e.get("ext")
    if isinstance(ext, dict):
        ext = json.dumps(ext, ensure_ascii=False)
    if not isinstance(ext, str):
        return ""
    m = re.search(r"https?://[^\"'\\\s]+", ext)
    return m.group(0).rstrip(".,;)}]") if m else ""


def check(url: str) -> str:
    host = re.match(r"https?://([^/:]+)", url).group(1)
    try:
        socket.getaddrinfo(host, None)
    except Exception:
        return "dns-fail"
    try:
        req = urllib.request.Request(url[:150], headers=UA)
        with urllib.request.urlopen(req, timeout=8) as r:
            return f"http-{r.status}"
    except urllib.error.HTTPError as ex:
        return f"http-{ex.code}"
    except Exception as ex:
        return f"conn-fail:{type(ex).__name__}"


def main() -> int:
    entries = {e["key"]: e for e in json.loads((TV_DIR / "sources.json").read_text(encoding="utf-8"))["sources"]}
    results = json.loads((TV_DIR / "probe_result.json").read_text(encoding="utf-8"))
    snap = json.loads((TV_DIR / "tools" / "deep_snapshot.json").read_text(encoding="utf-8"))
    dead_keys = [k for k, v in snap.items() if v == "dead"]
    out = {}
    jobs = {}
    for k in dead_keys:
        e = entries.get(k)
        u = first_url(e) if e else ""
        if u:
            jobs[k] = u
    print(f"域名级复核 {len(jobs)}/{len(dead_keys)} 条（DNS→HTTP 独立通道）")
    with ThreadPoolExecutor(12) as ex:
        for k, st in zip(jobs, ex.map(check, jobs.values())):
            out[k] = {"url": jobs[k], "reach": st}
            print(f"  {k[:20]:22s} {st}")
    # 3 条无 URL 的说明（hardcoded 之类）
    (TV_DIR / "tools" / "reach_result.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter
    dist = Counter(v["reach"].split(":")[0] if ":" in v["reach"] else v["reach"] for v in out.values())
    print("分布:", dict(dist))
    return 0


if __name__ == "__main__":
    __import__("sys").exit(main())
