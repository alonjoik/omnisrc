#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_config.py — 源清单主数据 → TVBox 分发配置生成器

输入 sources.json 条目两种形态：
  模板条目: {"key","name","group","tpl","ext"}          # tpl=js/ 下模板文件名；ext=JSON 串或对象
  协议条目: {"key","name","group","type","api"}          # type: 1=maccms-json 0=maccms-xml

输出（仓库根）:
  vod.json     影视 sites（group != 短剧）
  duanju.json  短剧 sites（group == 短剧）
  config.json  TVBox 多仓 storeHouse（指向上面两份）

用法:
  python tools/gen_config.py                       # 用默认 raw 基址生成
  python tools/gen_config.py --raw-base https://raw.githubusercontent.com/<user>/omnisrc/main
  python tools/gen_config.py --check               # 仅校验：必填字段/tpl 存在性/key 重复
"""
import argparse
import json
import sys
from pathlib import Path

# Windows GBK 控制台下中文输出乱码假象修正（管道捕获按 UTF-8）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TV_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RAW_BASE = "https://raw.githubusercontent.com/alonjoik/omnisrc/main"


def load_entries(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data["sources"] if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise SystemExit("sources.json 顶层必须是数组或 {sources:[...]}")
    return entries


def entry_to_site(e: dict, raw_base: str, errors: list, ctx: str) -> dict | None:
    """主数据条目 → TVBox site；非法条目记入 errors 返回 None"""
    key = e.get("key", "").strip()
    name = e.get("name", "").strip()
    group = e.get("group", "影视")
    if not key or not name:
        errors.append(f"{ctx}: key/name 必填")
        return None
    site: dict = {"key": key, "name": name, "searchable": e.get("searchable", 1)}
    if "tpl" in e:
        tpl = e["tpl"]
        if not (TV_DIR / "js" / tpl).is_file():
            errors.append(f"{ctx}: 模板文件 js/{tpl} 不存在")
            return None
        site.update({"type": 3, "api": f"{raw_base}/js/{tpl}", "filterable": e.get("filterable", 1)})
        ext = e.get("ext")
        if ext is not None:
            # TVBox 惯例：ext 为 JSON 字符串（qjs 源直接读 ext 参数）
            site["ext"] = ext if isinstance(ext, str) else json.dumps(ext, ensure_ascii=False)
    elif "api" in e:
        site.update({"type": int(e.get("type", 1)), "api": e["api"]})
        if e.get("filterable"):
            site["filterable"] = 1
    else:
        errors.append(f"{ctx}: 缺 tpl 或 api 字段")
        return None
    return site


def main() -> int:
    ap = argparse.ArgumentParser(description="源清单 → TVBox 分发配置")
    ap.add_argument("--sources", default=str(TV_DIR / "sources.json"))
    ap.add_argument("--raw-base", default=DEFAULT_RAW_BASE, help="仓库 raw 根（无 /js 尾段）")
    ap.add_argument("--check", action="store_true", help="仅校验不生成")
    ap.add_argument("--out", default=str(TV_DIR), help="输出目录（默认仓库根）")
    args = ap.parse_args()

    entries = load_entries(Path(args.sources))
    errors: list = []
    seen: set = set()
    sites: list = []
    for i, e in enumerate(entries):
        key = e.get("key", "")
        if key and key in seen:
            errors.append(f"#{i}: key 重复 {key}")
        seen.add(key)
        site = entry_to_site(e, args.raw_base.rstrip("/"), errors, f"#{i} {key}")
        if site:
            sites.append(site)

    if args.check:
        if errors:
            print("\n".join(f"[ERR] {x}" for x in errors))
            return 1
        print(f"check OK: {len(sites)}/{len(entries)} 条目合法，key 无重复")
        return 0
    if errors:
        print("\n".join(f"[ERR] {x}" for x in errors))
        return 1

    # 按主数据 group 分流：短剧单独成仓，其余进影视
    vod_sites, dj_sites = [], []
    for e, s in zip(entries, sites):
        if s is None:
            continue
        (dj_sites if e.get("group") == "短剧" else vod_sites).append(s)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "vod.json").write_text(
        json.dumps({"sites": vod_sites}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "duanju.json").write_text(
        json.dumps({"sites": dj_sites}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    rb = args.raw_base.rstrip("/")
    store = {
        "storeHouse": [
            {"sourceName": "影视源", "sourceUrl": f"{rb}/vod.json"},
            {"sourceName": "短剧源", "sourceUrl": f"{rb}/duanju.json"},
        ]
    }
    (out / "config.json").write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    n_dj = len(dj_sites)
    print(f"生成完成: vod.json {len(vod_sites)} 源 / duanju.json {n_dj} 源 / config.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
