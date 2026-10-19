# omnisrc 源仓库

PanBox 影视/短剧/音乐源全部外置——本仓库即源分发地：**视频一条链接导入，音乐一条链接导入**，TVBox 系客户端同样可用。

## 导入

**视频 / 短剧源**（PanBox App：「我的 → 源管理 → 同步源仓库」粘贴）：

```
https://raw.githubusercontent.com/alonjoik/omnisrc/main/config.json
```

TVBox / 影视仓等客户端：直接把上面链接填入配置地址（TVBox 多仓格式）。

**音乐源**（PanBox App「我的 → 洛雪源」粘贴导入；洛雪音乐桌面/手机版亦可直接导入）：

```
https://raw.githubusercontent.com/alonjoik/omnisrc/main/music/ibox_music.js
```

导入内容：酷我 / 酷狗 / QQ / 网易 / 咪咕五平台（搜索·榜单·歌词·取链）+ 蜻蜓电台 + 听友音乐。
模块拆分版与第三方源在 [music/](music/)：`ibox_qtfm.js` 蜻蜓电台、`ibox_tingyou.js` 听友音乐、`sound_1010.js` 1010聚合音源（MIT © Lincoln）。

- 同步 = 清 js 缓存重新拉取，仓库更新后重按一次「同步源仓库」即跟随，**App 无需发版**
- 音乐脚本导入后持久缓存，仓库更新后在脚本列表点「检查更新」即跟随
- GitHub 直连不稳时 App 自动走镜像（ghproxy 链）；导入的 js 源持久缓存，离线可用

## 组成

```
config.json              TVBox 多仓入口（storeHouse → 下面两份）
vod.json                 影视 sites（maccms 采集 / 模板条目）
duanju.json              短剧 sites
js/                      drpy 模板与源文件（qjs 兼容子集，见 SPEC.md）
music/
  ibox_music.js          音乐聚合单文件（构建产物，勿手改）
  ibox_qtfm.js           蜻蜓电台适配器
  ibox_tingyou.js        听友音乐适配器
  sound_1010.js          第三方聚合音源（MIT）
sources.json             源条目主数据（gen_config.py 的输入，增删源改这里）
tools/
  gen_config.py          主数据 → 三份分发配置（--check 校验）
  export_from_conf.py    壳包内清单 → 主数据（一次性迁移用）
  probe.py               采集站批量探活
README.md                本文件
SPEC.md                  源编写规范（六入口契约 + 原语白名单 + ext 约定）
```

## 维护

- **增删改源**：改 `sources.json` → `gen_config.py --check` → 重新生成 → `probe.py` 探活 → 提交
- **视频模板更新**：改 `js/*.js`（模板一改全站生效），跑 `probe.py` + CLI 直测后提交
- **音乐源更新**：`ibox_music.js` 为构建生成（构建源 `src-tauri/js/musicSdk-build/src/`），适配器可直接改 `music/*.js`；洛雪上游更新后重跑 `musicSdk-build/build.mjs` 再提交，全程不重编 App
- 探活报告 `probe_result.json` 仅供维护参考，不参与分发

格式规范见 [SPEC.md](SPEC.md)。新源提交流程与判活标准也在其中。
