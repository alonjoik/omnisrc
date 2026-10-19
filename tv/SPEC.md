# 源编写规范（SPEC）

本仓库的 JS 源遵循 **drpy qjs 兼容子集**：规范基准 = TVBox/影视仓现行 QuickJS drpy 运行时的公共原语面。
PanBox 壳侧 `drpy_host.js` 负责补齐对齐——**同一份源文件在壳内与 TVBox qjs 环境均应可用**。

## 六入口契约

全局函数，**同步**返回 JSON 字符串（禁止 async/顶层 await）：

| 入口 | 签名 | 返回 |
|---|---|---|
| `home(filter)` | → JSON 串 | `{class:[{type_id,type_name}], filters:{...}}` |
| `homeVod()` | → JSON 串 | `{list:[推荐卡片]}`（可空） |
| `category(tid, pg, filter, ext)` | → JSON 串 | `{list:[...]}` |
| `detail(ids)` | 逗号分隔 id | `{list:[{vod_id,vod_name,vod_play_from,vod_play_url}]}` |
| `play(flag, id, flags)` | → JSON 串 | `{parse:0/1, url:"直链或网页", header:{...}}` |
| `search(wd, quick)` | → JSON 串 | `{list:[...]}` |

模板型源（推荐）：定义全局 `rule` 对象 + `class_parse`/`cateManual` 等约定字段，宿主按模板驱动六入口，
源码只写差异逻辑。独立爬虫源：自行实现六入口。

## 原语白名单

**公共面（TVBox qjs 亦有，放心用）**：

- 网络：`req(url, opt)` / `request = req` / `fetch(url, params)`；opt 支持 `{headers, timeout, method, body}`，返回 `{content, headers, status}`
- HTML 解析：`pdfh(html, rule)` / `pdfa(html, rule)` / `pd(html, rule, base)` / `jsp.{pdfh,pd,pdfa}`
- 编码：`md5(s)` / `base64Encode(s)` / `base64Decode(s)`
- 存储/环境：`getItem(k)` / `setItem(k, v)` / `getEnv(k, def)`
- 工具：`buildUrl(url, obj)` / `print/log` / `fetch_params`

**壳增强面（仅 PanBox 内可用——必须 `typeof` 探测 + 缺失降级，导出兼容红线）**：

- `__panJson`（网盘凭证中心）、`__proxyBase()`（本地代理）、`CryptoJS` 薄壳、`__aes*`/`__rsa*` 系列
- 用法示例：`if (typeof __panJson !== 'undefined') { ... } else { /* 降级：读 getItem 或报错 */ }`

**禁用**：Node API（fs/req/puppeteer 等 drpy-node 专有）、顶层 await、async 入口、QuickJS 专有扩展。

## 模板条目 ext 字段约定

TVBox sites 条目 `type:3` + `api=<模板文件URL>` + `ext=<JSON字符串>`：

- maccms 模板：`{"api":"<采集站 provide/vod 地址>"}`
- xbpq（页面爬取）模板：`{"主页url":"...","分类url":".../id/{cateId}/page/{catePg}.html","分类":"...","数组":"...","图片":"...","简介":"..."}`（占位符 `{cateId}/{catePg}` 必须保留原样）
- 其余模板按模板文件头注释的 ext 契约填写

## 提交前自测

壳 CLI 全链路直测（模板条目示例）：

```bash
cd src-tauri
cargo build --bin ibox-cli
# 远程 js 源（仓库 URL 直测——走 rawjs_ 缓存 + ghproxy 镜像链）
./target/debug/ibox-cli "src:jsdrpy|https://raw.githubusercontent.com/<user>/omnisrc/main/js/maccms.js|{\"api\":\"https://cai.example/api.php/provide/vod\"}||" home
# 爬取模板条目（ext 含 | 时用 srcfile 通道）
./target/debug/ibox-cli "srcfile:/tmp/xbpq_one.json" home   # 文件: {"kind":"jsdrpy","api":"js://tpl/xbpq.js","ext":"{...}"}
```

跨运行时验证 = 壳 CLI 全绿 + TVBox qjs 人工标定（首批各模板至少一源在 TVBox 实跑 home/category/play）。

## 分发流水线

改 `sources.json`（主数据）→ `python tools/gen_config.py --check` → `python tools/gen_config.py` 生成三份配置 → `python tools/probe.py` 探活 → commit。探活判定见 `tools/probe.py` 头注释（maccms 协议探针 / 爬取页 HTTP 判活 / 反爬站标 unknown 人工甄别）。
