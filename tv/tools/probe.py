#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe.py — 采集站批量探活（maccms 协议标准探针）

对 sources.json 每条源：取数据 api（模板条目读 ext.api / 协议条目读 api），
请求 `?ac=list`（json/xml 通用），判活=HTTP 200 + 响应含 list/class 数据痕迹。
输出 probe_result.json（key/api/ok/ms/err），并打印存活汇总。

用法: python tools/probe.py [--timeout 8] [--workers 16]
"""
import argparse
import concurrent.futures as cf
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
# 判活痕迹：maccms-json 的 list/class 字段、xml 协议的 rss/list 节点（宽松含匹配，空列表也算活）
ALIVE_MARKS = ('"list"', '"class"', "<list>", "<class>", "<rss", '"code"')
# 爬取页（xbpq）判活痕迹：HTML 文档特征
HTML_MARKS = ("<html", "<body", "<!doctype", "vod")


def probe_target(e: dict) -> tuple[str, str]:
    """条目 → (探活 URL, 模式)；模式: maccms(协议api)/html(爬取页)/rule(远程规则)；空串=skipped"""
    ext = e.get("ext")
    # ext 为 http 字符串：XYQHiker 等远程规则地址，探 URL 本身
    if isinstance(ext, str) and ext.startswith("http"):
        return ext, "rule"
    if ext:
        try:
            o = json.loads(ext) if isinstance(ext, str) else ext
        except json.JSONDecodeError:
            return "", "skipped"
        if isinstance(o, dict):
            if o.get("api"):
                return o["api"], "maccms"
            # xbpq 爬取规则：优先主页url，否则分类url 剥占位符
            url = o.get("主页url") or o.get("分类url") or ""
            if url.startswith("http"):
                for k in ("catePg", "cateId", "area", "by", "class", "lang", "letter", "year"):
                    url = url.replace("{" + k + "}", "1")
                url = url.replace("{", "").replace("}", "")  # 其余未知占位符剥壳
                return url, "html"
    if e.get("api"):
        return e["api"], "maccms"
    return "", "skipped"


def probe_one(key: str, url: str, mode: str, timeout: float) -> dict:
    probe_url = url
    if mode == "maccms":
        probe_url = url + ("&" if "?" in url else "?") + "ac=list"
    t0 = time.monotonic()
    try:
        req = urllib.request.Request(probe_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(200_000).decode("utf-8", "ignore")
        ms = int((time.monotonic() - t0) * 1000)
        low = body.lower()
        if mode == "html":
            # 爬取页：HTTP 200 即活（反爬站可能出验证页，剔除死站为目的宁宽勿严）
            return {"key": key, "api": url, "status": "alive", "ms": ms, "err": ""}
        ok = resp.status == 200 and any(m in low or m in body for m in ALIVE_MARKS)
        if ok:
            return {"key": key, "api": url, "status": "alive", "ms": ms, "err": ""}
        if mode == "rule" and ("github" in url or "ghproxy" in url):
            # GitHub 拦截页/被墙页 200 ≠ 规则死（壳内有镜像链），归人工甄别
            return {"key": key, "api": url, "status": "unknown", "ms": ms, "err": "github 直连受限"}
        return {"key": key, "api": url, "status": "dead", "ms": ms, "err": "响应无判活痕迹"}
    except urllib.error.HTTPError as exc:
        ms = int((time.monotonic() - t0) * 1000)
        if mode == "html" and exc.code in (403, 444, 405, 406, 429, 503):
            # 爬取页被反爬拦（urllib TLS 指纹被拒），壳内 reqwest 可能仍可用 → 人工甄别
            return {"key": key, "api": url, "status": "unknown", "ms": ms, "err": f"HTTP {exc.code}(反爬疑似)"}
        return {"key": key, "api": url, "status": "dead", "ms": ms, "err": f"HTTP {exc.code}"}
    except Exception as exc:  # noqa: BLE001 探活吞一切异常记入 err
        ms = int((time.monotonic() - t0) * 1000)
        msg = str(exc)[:120]
        githubish = "github" in url or "ghproxy" in url
        if mode == "html" and ("SSL" in msg or "handshake" in msg or "closed connection" in msg):
            return {"key": key, "api": url, "status": "unknown", "ms": ms, "err": msg + "(反爬疑似)"}
        if githubish and mode == "rule":
            # GitHub 直连被墙 ≠ 规则死（壳内有镜像链），归人工甄别
            return {"key": key, "api": url, "status": "unknown", "ms": ms, "err": msg + "(github 直连受限)"}
        return {"key": key, "api": url, "status": "dead", "ms": ms, "err": msg}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=str(TV_DIR / "sources.json"))
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    entries = json.loads(Path(args.sources).read_text(encoding="utf-8"))["sources"]
    jobs = []
    for e in entries:
        url, mode = probe_target(e)
        jobs.append((e["key"], url, mode))

    results = []
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = {
            ex.submit(probe_one, k, a, m, args.timeout): k
            for k, a, m in jobs
            if a
        }
        for k, a, _m in jobs:
            if not a:
                results.append({"key": k, "api": "", "status": "skipped", "ms": 0, "err": "无数据api(模板硬编码)"})
        for f in cf.as_completed(futs):
            results.append(f.result())

    results.sort(key=lambda r: r["key"])
    (TV_DIR / "probe_result.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    by = {s: [r for r in results if r["status"] == s] for s in ("alive", "dead", "unknown", "skipped")}
    print(
        f"探活完成: alive {len(by['alive'])} / dead {len(by['dead'])} / "
        f"unknown {len(by['unknown'])} / skipped {len(by['skipped'])}"
    )
    for r in by["dead"]:
        print(f"  [DEAD] {r['key']} {r['api']} — {r['err']} ({r['ms']}ms)")
    for r in by["unknown"]:
        print(f"  [UNKNOWN] {r['key']} {r['api']} — {r['err']} ({r['ms']}ms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
