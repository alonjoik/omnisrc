#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export_from_conf.py — 壳包内清单 → 仓库主数据初版（一次性归类导出）

读 src-tauri/conf/sources.json，取影视侧 jsdrpy 条目归入仓库 sources.json：
  范围: group ∈ {影视,短剧,少儿,动漫,体育,iBox在播}
  排除: duanju_agg（壳短剧聚合功能源——包内保留，TVBox 生态无壳引擎不适用）
  听书/直播组一概不动（壳自有通道）
模板条目 api js://tpl/X.js → {"tpl": "X.js"}；名称剥 [xx ms|分类] 活水前缀（对齐壳 strip_speed_tag）
用法: python tools/export_from_conf.py   （在 ibox-app 根或任意位置，路径内置）
"""
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
CONF = TV_DIR.parent.parent / "src-tauri" / "conf" / "sources.json"
OUT = TV_DIR / "sources.json"

IN_SCOPE = {"影视", "短剧", "少儿", "动漫", "体育", "iBox在播"}
EXCLUDE_IDS = {"duanju_agg"}
SPEED_RE = re.compile(r"^\[([^\]]+)\]\s*")
MS_RE = re.compile(r"(?i)\d+\s*ms\|?")


def strip_speed_tag(name: str) -> str:
    """对齐壳 strip_speed_tag：前缀 [tag] 内含 ms 延迟或纯分类 tag 时剥离"""
    m = SPEED_RE.match(name)
    if not m:
        return name
    rest = name[m.end():].strip()
    if not rest:
        return name
    return rest


def main() -> int:
    conf = json.loads(CONF.read_text(encoding="utf-8"))["sources"]
    out, skipped = [], []
    for s in conf:
        if s.get("kind") != "jsdrpy":
            continue
        if s.get("group") not in IN_SCOPE:
            continue
        if s["id"] in EXCLUDE_IDS:
            skipped.append(s["id"])
            continue
        api = s["api"]
        e: dict = {
            "key": s["id"],
            "name": strip_speed_tag(s["name"]),
            "group": s["group"],
        }
        m = re.match(r"^js://tpl/(.+\.js)$", api)
        if m:
            e["tpl"] = m.group(1)
        else:
            skipped.append(f"{s['id']}(非tpl api: {api})")
            continue
        # ext：JSON 串还原为对象（主数据可读，gen_config 再序列化回 TVBox 字符串）
        try:
            ext = json.loads(s["ext"]) if s.get("ext") not in (None, "", "null") else None
        except json.JSONDecodeError:
            ext = None
        if ext:
            e["ext"] = ext
        if not s.get("searchable", True):
            e["searchable"] = 0
        if s.get("filterable", False):
            e["filterable"] = 1
        out.append(e)
    OUT.write_text(
        json.dumps({"sources": out}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"导出 {len(out)} 条 → {OUT}")
    if skipped:
        print(f"跳过 {len(skipped)} 条: {', '.join(map(str, skipped))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
