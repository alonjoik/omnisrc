/**
 * @name PanBox音源
 * @description 一条链接全量音乐源：五平台(酷我/酷狗/QQ/网易/咪咕)搜索·榜单·歌词·取链 + 蜻蜓电台 + 听友音乐
 * @version 2.0.1
 * @author PanBox（内核 SDK © lyswhut lx-music；取链聚合 © Lincoln 六音音源 MIT）
 * @homepage https://github.com/lyswhut/lx-music-mobile
 */
/* eslint-disable */
// __LX_SDK_CORE_BEGIN —— lxsdk_core（构建产物，勿手改）
;(function () {
  const __cap = { handler: null };
/*!
 * @name 1010🎵音源
 * @description 五大平台(wy/tx/kw/kg/mg)聚合直链音源｜每条链路均经真实取链实测(HTTP Range 206 音频校验)筛选｜优先级并发 + 串行兜底｜链路健康度自动降权｜结果缓存
 * @version 1.0.0
 * @author Lincoln
 * @license MIT
 * @update 2026-10-10
 * @changelog
 *   - 以「全豆要[聚合音源] v9.3」架构为骨架重写
 *   - 剔除 v9.3 中已失效的 Huibq / 聆川 / 汽水VIP(api.vsaa.cn) 链路
 *   - 剔除 v9.3 中实测已 404/403 的念心、长青海棠、溯音QQ 链路
 *   - 新增实测可用后端：网易官方、酷我官方三重(mobi/nmobi/antiserver)、Vkeys、Vkeys-FLAC、流云BaiMusic、溯音咪咕
 *   - 新增链路健康度降权、结果缓存、歌手匹配校验(mg)、可播放性预检
 */

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const request = globalThis.lx.request;
  const on = (n, h) => { if (n === 'request') __cap.handler = h };
  const send = () => {};

// ==================== 可调参数 ====================
const CFG = {
  reqTimeout: 8000,      // 单条链路超时(ms) —— v9.3 硬编码 2000 过短，易误杀慢链路
  concurrent: 3,         // 首批并发链路数
  cacheTTL: 3 * 60 * 60 * 1000,  // 缓存有效期 3 小时
  cacheMax: 600,         // 缓存最大条目
  failThreshold: 3,      // 连续失败多少次后降权
  cooldown: 10 * 60 * 1000,      // 降权冷却时间 10 分钟
  enablePrecheck: true,  // 对取到的直链做可播放性预检
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ==================== 平台与音质 ====================
const PLATFORM_NAMES = { wy: '网易云音乐', tx: 'QQ音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐' }

const PLATFORM_QUALITY = {
  wy: ['flac', '320k', '192k', '128k'],
  tx: ['flac', '320k', '128k'],
  kw: ['flac', '320k', '192k', '128k'],
  kg: ['flac', '320k', '128k'],
  mg: ['320k', '128k'],
}

const HIRES = new Set(['24bit', 'flac', 'flac24bit', 'hires', 'master', 'atmos'])

// ==================== HTTP 层 ====================
function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      method: opts.method || 'GET',
      timeout: opts.timeout || CFG.reqTimeout,
      headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
    }
    if (opts.body) options.body = opts.body
    request(url, options, (err, res) => {
      if (err) return reject(new Error('请求失败:' + (err && err.message ? err.message : err)))
      const status = (res && res.statusCode) || 0
      if (status >= 400) return reject(new Error('HTTP ' + status))
      let body = res && res.body
      if (typeof body === 'string') {
        const t = body.trim()
        if (t.charAt(0) === '{' || t.charAt(0) === '[' || t.charAt(0) === '"') {
          try { body = JSON.parse(t) } catch (e) { /* 保持原始字符串 */ }
        }
      }
      resolve(body)
    })
  })
}

// ==================== 通用工具 ====================
const BAD_EXT = /\.(jpe?g|png|gif|webp|svg|ico|css|js|json|html?|txt|xml)(\?|$)/i

/** 从任意响应体中递归挑出第一个"像音频直链"的 URL */
function pickUrl(body, depth = 0) {
  if (!body || depth > 6) return null
  if (typeof body === 'string') {
    const t = body.trim()
    if (/^https?:\/\/\S+$/.test(t) && !BAD_EXT.test(t)) return t
    const m = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]{20,800}/.exec(t)
    if (m) {
      const u = m[0].replace(/["'\\)\]}>,]+$/g, '')
      if (!BAD_EXT.test(u)) return u
    }
    return null
  }
  if (Array.isArray(body)) {
    for (const v of body) { const r = pickUrl(v, depth + 1); if (r) return r }
    return null
  }
  if (typeof body === 'object') {
    const preferred = ['url', 'musicUrl', 'music_url', 'playUrl', 'play_url', 'link', 'song_url', 'mp3', 'src', 'audio', 'download', 'data']
    for (const k of preferred) if (body[k] != null) { const r = pickUrl(body[k], depth + 1); if (r) return r }
    for (const k of Object.keys(body)) {
      if (preferred.indexOf(k) >= 0) continue
      const r = pickUrl(body[k], depth + 1)
      if (r) return r
    }
  }
  return null
}

function isLikelyAudio(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length > 15 && !BAD_EXT.test(url)
}

/** 取字段：按候选名依次命中 */
function pickField(obj, names) {
  if (!obj) return ''
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && String(obj[n]) !== '') return String(obj[n])
  }
  return ''
}

/** 各平台从 musicInfo 取歌曲 ID */
function getSongId(platform, mi) {
  if (!mi) return ''
  switch (platform) {
    case 'kg': return pickField(mi, ['hash', 'songmid', 'id', 'mhash'])
    case 'tx': return pickField(mi, ['songmid', 'mid', 'strMediaMid', 'id'])
    case 'kw': return pickField(mi, ['songmid', 'rid', 'id'])
    case 'mg': return pickField(mi, ['songmid', 'copyrightId', 'id'])
    default: return pickField(mi, ['songmid', 'id'])
  }
}

function getSongName(mi) { return pickField(mi, ['name', 'songName', 'title']) }
function getSinger(mi) {
  const s = pickField(mi, ['singer', 'artist', 'author'])
  if (s && s !== 'Unknown') return s
  const arr = mi && (mi.singers || mi.artists)
  if (Array.isArray(arr) && arr.length) {
    return arr.map(x => (typeof x === 'string' ? x : (x && (x.name || x.singer)) || '')).filter(Boolean).join('、')
  }
  return ''
}

/** 歌手粗匹配：用于 mg（按歌名搜索）防串歌 */
function singerHit(a, b) {
  if (!a || !b) return true
  const norm = s => String(s).replace(/[\s、,，·.。&/]/g, '').toLowerCase()
  const A = norm(a), B = norm(b)
  if (!A || !B) return true
  return A.indexOf(B) >= 0 || B.indexOf(A) >= 0
}

/** 音质选择：请求音质不存在时向下取最接近档位 */
function selectQuality(requested, list) {
  const q = String(requested || '128k').toLowerCase()
  if (list.indexOf(q) >= 0) return q
  const order = ['flac24bit', 'flac', '320k', '192k', '128k']
  const idx = order.indexOf(q)
  if (idx >= 0) {
    for (let i = idx; i < order.length; i++) if (list.indexOf(order[i]) >= 0) return order[i]
  }
  return list[list.length - 1]
}

// ==================== 音质参数映射 ====================
const WY_BR = { flac: '999000', '320k': '320000', '192k': '192000', '128k': '128000' }
const GD_BR = { flac: '999', '320k': '320', '192k': '192', '128k': '128' }
const KW_BR = { flac: '2000kflac', '320k': '320kmp3', '192k': '192kmp3', '128k': '128kmp3' }
const HYW_Q = { flac: 'flac', '320k': '320k', '192k': '192k', '128k': '128k' }

const enc = v => encodeURIComponent(String(v === undefined || v === null ? '' : v))

// ==================== 链路定义 ====================
// 每条链路：{ name, build(ctx) -> url, parse(body, ctx) -> url|null, headers? }
// 顺序即优先级；实测通过率高的排前面。
const CHAIN = {
  wy: [
    {
      name: '网易官方',
      build: c => `https://music.163.com/api/song/enhance/player/url?id=${enc(c.id)}&ids=%5B${enc(c.id)}%5D&br=${WY_BR[c.q] || '320000'}`,
      parse: b => pickUrl(b),
      headers: { Referer: 'https://music.163.com/' },
    },
    {
      name: '星海GD',
      build: c => `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${enc(c.id)}&br=${GD_BR[c.q] || '320'}`,
      parse: b => pickUrl(b),
    },
    {
      name: '溯音163',
      build: c => `https://oiapi.net/api/Music_163?id=${enc(c.id)}`,
      parse: b => pickUrl(b),
    },
    {
      name: '笒鬼鬼',
      build: c => `https://api.cenguigui.cn/api/netease/music_v1.php?id=${enc(c.id)}`,
      parse: b => pickUrl(b),
    },
    {
      name: 'HYW',
      build: c => `http://103.79.184.97/api/music/url?source=wy&songId=${enc(c.id)}&quality=${HYW_Q[c.q] || '320k'}&key=6C1F-53W0-GRKI-EVFG`,
      parse: b => pickUrl(b),
    },
    {
      name: 'Bugpk外链',
      build: c => `https://api.bugpk.com/api/163_music?type=json&ids=${enc(c.id)}`,
      parse: b => pickUrl(b),
    },
  ],
  tx: [
    {
      name: 'Vkeys',
      build: c => `https://api.vkeys.cn/v2/music/tencent/geturl?mid=${enc(c.id)}`,
      parse: b => pickUrl(b),
    },
    {
      name: 'Vkeys无损',
      build: c => `https://api.vkeys.cn/music/tencent/song/link?mid=${enc(c.id)}`,
      parse: b => pickUrl(b),
      hiresOnly: true, // 返回 flac，仅在高音质请求时优先尝试
    },
    {
      name: 'HYW',
      build: c => `http://103.79.184.97/api/music/url?source=tx&songId=${enc(c.id)}&quality=${HYW_Q[c.q] || '320k'}&key=6C1F-53W0-GRKI-EVFG`,
      parse: b => pickUrl(b),
    },
    {
      name: '流云BaiMusic',
      build: c => `https://api.liuyunidc.cn/baimusic/musicurl.php?source=tx&musicId=${enc(c.id)}`,
      parse: b => pickUrl(b),
    },
  ],
  kw: [
    {
      name: '酷我官方nmobi',
      build: c => `https://nmobi.kuwo.cn/mobi.s?f=web&user=0&source=kwplayerhd_ar_4.3.0.8_tianbao_T1A_qirui.apk&type=convert_url_with_sign&rid=${enc(c.id)}&br=${KW_BR[c.q] || '320kmp3'}`,
      parse: b => pickUrl(b),
    },
    {
      name: '酷我官方mobi',
      build: c => `https://mobi.kuwo.cn/mobi.s?f=web&type=convert_url_with_sign&rid=${enc(c.id)}&br=${KW_BR[c.q] || '320kmp3'}`,
      parse: b => pickUrl(b),
    },
    {
      name: '酷我antiserver',
      build: c => `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${enc(c.id)}&format=mp3&response=url`,
      parse: b => pickUrl(b),
    },
    {
      name: 'HYW',
      build: c => `http://103.79.184.97/api/music/url?source=kw&songId=${enc(c.id)}&quality=${HYW_Q[c.q] || '320k'}&key=6C1F-53W0-GRKI-EVFG`,
      parse: b => pickUrl(b),
    },
  ],
  kg: [
    {
      name: 'HYW',
      build: c => `http://103.79.184.97/api/music/url?source=kg&songId=${enc(c.id)}&quality=${HYW_Q[c.q] || '320k'}&key=6C1F-53W0-GRKI-EVFG`,
      parse: b => pickUrl(b),
    },
    {
      name: '海棠备用',
      build: c => `https://music.haitangw.cc/kgqq/kg.php?type=mp3&id=${enc(c.id)}&level=${enc(c.q)}`,
      parse: b => pickUrl(b),
    },
    {
      name: '念心备用',
      build: c => `https://music.nxinxz.com/kgqq/kg.php?id=${enc(c.id)}&level=${enc(c.q)}&type=mp3`,
      parse: b => pickUrl(b),
    },
  ],
  mg: [
    {
      name: '溯音咪咕',
      build: c => `https://oiapi.net/api/MiGu_Music?msg=${enc(c.name)}&n=1&type=json`,
      // 该接口按歌名搜索，必须校验歌手，防止串歌
      parse: (b, c) => {
        const d = b && b.data
        if (!d) return pickUrl(b)
        const got = pickField(d, ['singer', 'singers', 'artist'])
        if (!singerHit(got, c.singer)) return null
        return pickField(d, ['url', 'musicUrl', 'playUrl']) || pickUrl(d)
      },
    },
    {
      name: '溯音咪咕(歌手)',
      build: c => `https://oiapi.net/api/MiGu_Music?msg=${enc(c.name + ' ' + c.singer)}&n=1&type=json`,
      parse: (b, c) => {
        const d = b && b.data
        if (!d) return pickUrl(b)
        return pickField(d, ['url', 'musicUrl', 'playUrl']) || pickUrl(d)
      },
    },
    {
      name: 'XCVTS咪咕',
      build: c => `https://api.xcvts.cn/api/music/migu?gm=${enc(c.name)}`,
      parse: b => pickUrl(b),
    },
  ],
}

// ==================== 链路健康度 ====================
const health = Object.create(null)   // name -> { fail:number, until:number }
function isCooling(name) {
  const h = health[name]
  if (!h) return false
  return h.fail >= CFG.failThreshold && Date.now() < h.until
}
function markOk(name) { if (health[name]) health[name].fail = 0 }
function markFail(name) {
  const h = health[name] || (health[name] = { fail: 0, until: 0 })
  h.fail += 1
  if (h.fail >= CFG.failThreshold) h.until = Date.now() + CFG.cooldown
}

// ==================== 缓存 ====================
const cache = new Map()
function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.t > CFG.cacheTTL) { cache.delete(key); return null }
  return hit.url
}
function cacheSet(key, url) {
  cache.set(key, { url, t: Date.now() })
  if (cache.size > CFG.cacheMax) {
    const first = cache.keys().next().value
    cache.delete(first)
  }
}

// ==================== 可播放性预检 ====================
function precheck(url) {
  if (!CFG.enablePrecheck) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const done = v => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(true), 4000) // 预检超时视为可用，不阻塞
    try {
      request(url, { method: 'GET', timeout: 3500, headers: { 'User-Agent': UA, Range: 'bytes=0-511' } }, (err, res) => {
        clearTimeout(timer)
        if (err) return done(true)
        const code = (res && res.statusCode) || 0
        if (code === 0 || code >= 400) return done(false)
        const body = res && res.body
        if (typeof body === 'string' && (/^\s*<(!doctype|html)/i.test(body) || /^\s*\{/.test(body))) return done(false)
        done(true)
      })
    } catch (e) { clearTimeout(timer); done(true) }
  })
}

// ==================== 单链路执行 ====================
async function runLink(link, ctx) {
  const url = link.build(ctx)
  const body = await httpGet(url, { headers: link.headers, timeout: CFG.reqTimeout })
  const direct = link.parse ? link.parse(body, ctx) : pickUrl(body)
  if (!isLikelyAudio(direct)) throw new Error('未取到直链')
  if (!(await precheck(direct))) throw new Error('直链不可播放')
  return direct
}

// ==================== 调度：优先级并发 + 串行兜底 ====================
async function getUrl(platform, musicInfo, requestedQuality) {
  const qualitys = PLATFORM_QUALITY[platform]
  if (!qualitys) throw new Error('不支持的平台: ' + platform)
  const q = selectQuality(requestedQuality, qualitys)
  const id = getSongId(platform, musicInfo)
  const name = getSongName(musicInfo)
  const singer = getSinger(musicInfo)
  if (!id && platform !== 'mg') throw new Error('缺少歌曲 ID')
  if (!name && platform === 'mg') throw new Error('缺少歌曲名')

  const ctx = { id, name, singer, q, platform, hires: HIRES.has(String(requestedQuality || '').toLowerCase()) }

  const ck = platform + ':' + id + ':' + q
  const cached = cacheGet(ck)
  if (cached) return cached

  let links = (CHAIN[platform] || []).filter(l => !isCooling(l.name))
  // 高音质请求时把 hiresOnly 链路提前
  if (ctx.hires) {
    links = links.filter(l => l.hiresOnly).concat(links.filter(l => !l.hiresOnly))
  } else {
    links = links.filter(l => !l.hiresOnly) // 非高音质不浪费请求在纯无损链路上
  }
  if (!links.length) links = (CHAIN[platform] || []).slice()

  const errors = []
  const batch = links.slice(0, CFG.concurrent)
  if (batch.length) {
    const results = await Promise.allSettled(batch.map(l =>
      runLink(l, ctx).then(u => { markOk(l.name); return { link: l, url: u } })
    ))
    // 严格按数组顺序取首个成功者，尊重链路优先级
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') { cacheSet(ck, r.value.url); return r.value.url }
      markFail(batch[i].name)
      errors.push(batch[i].name + ':' + ((r.reason && r.reason.message) || '失败'))
    }
  }
  // 串行兜底剩余链路
  for (const l of links.slice(CFG.concurrent)) {
    try {
      const u = await runLink(l, ctx)
      markOk(l.name)
      cacheSet(ck, u)
      return u
    } catch (e) {
      markFail(l.name)
      errors.push(l.name + ':' + (e.message || '失败'))
    }
  }
  throw new Error('全部链路失败 → ' + errors.join(' | '))
}

// ==================== 注册 ====================
const sourceConfig = {}
Object.keys(PLATFORM_QUALITY).forEach(p => {
  sourceConfig[p] = {
    name: PLATFORM_NAMES[p],
    type: 'music',
    actions: ['musicUrl'],
    qualitys: PLATFORM_QUALITY[p],
  }
})

on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action !== 'musicUrl') return Promise.reject(new Error('action not support'))
  if (!sourceConfig[source]) return Promise.reject(new Error('source not support'))
  const musicInfo = info && info.musicInfo
  if (!musicInfo) return Promise.reject(new Error('请求参数不完整'))
  return getUrl(source, musicInfo, (info && info.type) || '128k')
})

send(EVENT_NAMES.inited, { openDevTools: false, sources: sourceConfig })

console.log('1010🎵音源 v1.0.0 已加载 —— 平台: wy/tx/kw/kg/mg')

  globalThis.__PANBOX_SOUND = __cap.handler;
})();
;(function () {
  const __cap = { handler: null };
/**
 * @name 蜻蜓电台
 * @description PanBox 内置广播电台源
 * @version 1.0.0
 * @author PanBox Reborn
 */
// panbox_qtfm.js — 蜻蜓 FM 电台（落雪扩展 action 适配器；蓝本 qtfm.js，协议零变化）
// 协议：GraphQL POST https://webbff.qtfm.cn/www {radioPage(cid,page){contents} / searchResultsPage}；
//       详情 GET webapi.qtfm.cn/api/pc/radio/{id} → album；播放直链 lhttp-hw.qtfm.cn/live/{id}/64k.mp3
// 扩展 action（宿主契约）：home → {class}；category → {list,page,pagecount}；search → {list}；
//                          detail → {list:[vod]}；musicUrl → url 字符串（info.musicInfo.songmid=电台id）
const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const request = globalThis.lx.request;
  const on = (n, h) => { if (n === 'request') __cap.handler = h };
  const send = () => {};

const QT_CATS = [
    ['3', '北京'], ['5', '天津'], ['7', '河北'], ['19', '山西'], ['31', '内蒙古'], ['44', '辽宁'],
    ['59', '吉林'], ['69', '黑龙江'], ['217', '广东'], ['83', '上海'], ['99', '浙江'], ['85', '江苏'],
    ['111', '安徽'], ['129', '福建'], ['139', '江西'], ['151', '山东'], ['169', '河南'], ['187', '湖北'],
    ['202', '湖南'], ['239', '广西'], ['254', '海南'], ['257', '重庆'], ['259', '四川'], ['281', '贵州'],
    ['291', '云南'], ['316', '陕西'], ['327', '甘肃'], ['351', '宁夏'], ['357', '新疆'], ['308', '西藏'],
    ['342', '青海'], ['433', '资讯'], ['442', '音乐'], ['429', '交通'], ['439', '经济'], ['432', '文艺'],
    ['441', '都市'], ['430', '体育'], ['431', '双语'], ['438', '综合'], ['435', '生活'], ['436', '旅游'],
    ['434', '曲艺'], ['440', '方言'],
]

const QT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Referer': 'https://www.qtfm.cn',
}

function qt_req(url, opt) {
    return new Promise(function (resolve, reject) {
        request(url, opt || {}, function (err, resp) {
            if (err) return reject(new Error(String(err)))
            resolve(resp && resp.body)
        })
    })
}

function qt_gql(query) {
    return qt_req('https://webbff.qtfm.cn/www', {
        method: 'POST',
        body: JSON.stringify({ query: query }),
        headers: Object.assign({ 'content-type': 'application/json' }, QT_HEADERS),
    })
}

function qt_pic(u) {
    const s = String(u || '')
    return s.indexOf('//') === 0 ? 'https:' + s : s
}

function qt_cards(arr, detailMode) {
    const out = []
    if (!arr || !arr.length) return out
    for (let i = 0; i < arr.length; i++) {
        const o = arr[i]
        out.push({
            vod_id: String(o.id || ''),
            vod_name: o.title || '',
            vod_pic: qt_pic(detailMode ? o.cover : o.imgUrl),
            vod_remarks: String((detailMode ? o.description : o.desc) || '').slice(0, 40),
        })
    }
    return out
}

on(EVENT_NAMES.request, function (req) {
    const source = req.source
    const action = req.action
    const info = req.info || {}
    return new Promise(function (resolve, reject) {
        switch (action) {
            case 'musicUrl': {
                const id = (info.musicInfo && (info.musicInfo.songmid || info.musicInfo.hash)) || ''
                if (!id) return reject(new Error('蜻蜓电台 id 为空'))
                resolve('https://lhttp-hw.qtfm.cn/live/' + id + '/64k.mp3')
                break
            }
            case 'home':
                resolve({ class: QT_CATS.map(function (c) { return { type_id: c[0], type_name: c[1] } }) })
                break
            case 'category': {
                const tid = String(info.cate || '3')
                const pg = parseInt(info.page, 10) || 1
                qt_gql('{\n    radioPage(cid:' + tid + ', page:' + pg + '){\n      contents\n    }\n  }').then(function (d) {
                    let items = null
                    try { items = d.data.radioPage.contents.items } catch (e) { }
                    resolve({ list: qt_cards(items, false), page: pg, pagecount: (items && items.length >= 12) ? pg + 1 : pg })
                }).catch(reject)
                break
            }
            case 'search': {
                const kw = String(info.wd || '').replace(/"/g, '')
                const pg = parseInt(info.page, 10) || 1
                qt_gql('{\n        searchResultsPage(keyword:"' + kw + '", page:' + pg + ', include:"channel_live" ) {\n          tdk,\n          searchData,\n          numFound\n        }\n      }').then(function (d) {
                    let arr = null
                    try { arr = d.data.searchResultsPage.searchData } catch (e) { }
                    resolve({ list: qt_cards(arr, true) })
                }).catch(reject)
                break
            }
            case 'detail': {
                const id = String(info.id || '')
                qt_req('https://webapi.qtfm.cn/api/pc/radio/' + encodeURIComponent(id), { headers: QT_HEADERS }).then(function (body) {
                    const a = (body && body.album) || {}
                    resolve({ list: [{
                        vod_id: id,
                        vod_name: a.title || '',
                        vod_pic: qt_pic(a.cover),
                        vod_content: a.description || '',
                        vod_play_from: '蜻蜓FM',
                        vod_play_url: (a.title || '直播') + '$' + (a.id || id),
                    }] })
                }).catch(reject)
                break
            }
            default:
                reject(new Error('蜻蜓电台不支持 action: ' + action))
        }
    })
})

send(EVENT_NAMES.inited, {
    status: true,
    sources: {
        panbox_qtfm: {
            name: '蜻蜓电台',
            type: 'music',
            actions: ['musicUrl', 'home', 'category', 'search', 'detail'],
            qualitys: ['128k'],
        },
    },
})

  globalThis.__PANBOX_QTFM = __cap.handler;
})();
;(function () {
  const __cap = { handler: null };
/**
 * @name 听友音乐
 * @description 听友FM音乐模块：分类/专辑/曲目/直链
 * @version 1.1.0
 * @author PanBox
 * @homepage https://tingyou.fm
 */
// 协议（tingyou.fm 音乐模块，tv/call 加密网关；与站点前端 JS 对齐）：
//   请求体 = 裸 AES-256-CBC(Pkcs7) 密文 b64；响应 = 同密体系 b64
//   X-Post-Signature = Base64(HMAC-SHA256(密文b64, hex hmac_key))
//   游客 /web/user/register/temp 换 JWT accessToken；业务 /web/v1/tv/call {operation,params,query}
//   operation 白名单（站点 bN 集合）：music.sections（分类）/ music.albums（专辑集合+搜索，query:
//   {section,page,page_size,q?}）/ music.album（单专辑头，params:{album_id}）/ music.tracks（曲表，
//   params:{album_id}，chapters[] 与 tracks[] 同构 {title,artist,album,duration,index,resource_id}）/
//   music.playback_session（直链，params:{album_id,index}+idempotency_key）
//   搜索 = 站点 searchMusic 同构：对全部 5 个 section 并行查 music.albums(+q) 合并（section:'all' 非法）
//   协议无歌词字段：lyric 返回空串（前端显示「暂时没有歌词」）
// 行契约：分类/搜索返回专辑集合 mode:'albums'（前端渲染专辑卡片网格），详情返回曲目单曲表。
// 可移植性：仅用洛雪标准 API（request / utils.crypto.aesEn / aesDe）；HMAC-SHA256 不在标准 API，
//   内嵌纯 JS 实现并 init 自测，脚本可直接拿到洛雪桌面版跑（sources key 为 iBox 扩展形态）。
const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const request = globalThis.lx.request;
  const on = (n, h) => { if (n === 'request') __cap.handler = h };
  const send = () => {};

var TV_API = 'https://api-preview.toulaopao.cc/api'
var TV_KEY = '11059a4c989dd9d4837778b013d164baa0ad4d7b0076e722369f6f085814293f'
var TV_IV = 'dd3ea319024c649d2ebcd1bda551a307'
var TV_HMAC = '51c5b55800a7efd1'
var TV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'

var TV_dev = ''
var TV_token = ''

// ── 纯 JS SHA-256 + HMAC-SHA256（标准 API 无 HMAC；init 自测防手抄常量错） ──
var __shaK = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function __u8(str) {
  // utf8 string → byte array
  var u = encodeURIComponent(str)
  var out = []
  for (var i = 0; i < u.length; i++) {
    if (u[i] === '%') { out.push(parseInt(u.substr(i + 1, 2), 16)); i += 2 } else { out.push(u.charCodeAt(i)) }
  }
  return out
}

function __sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  var bitLen = bytes.length * 8
  var msg = bytes.slice()
  msg.push(0x80)
  while (msg.length % 64 !== 56) msg.push(0)
  msg.push(0, 0, 0, 0, (bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255)
  var w = new Array(64)
  function rr(x, n) { return (x >>> n) | (x << (32 - n)) }
  for (var off = 0; off < msg.length; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = ((msg[off + 4 * i] << 24) | (msg[off + 4 * i + 1] << 16) | (msg[off + 4 * i + 2] << 8) | msg[off + 4 * i + 3]) | 0
    for (var i = 16; i < 64; i++) {
      var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      var s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (var i = 0; i < 64; i++) {
      var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)
      var ch = (e & f) ^ (~e & g)
      var t1 = (h + S1 + ch + __shaK[i] + w[i]) | 0
      var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)
      var mj = (a & b) ^ (a & c) ^ (b & c)
      var t2 = (S0 + mj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }
  var out = []
  for (var i = 0; i < 8; i++) out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255)
  return out
}

function __hmacSha256B64(message, keyHex) {
  var key = []
  for (var i = 0; i < keyHex.length; i += 2) key.push(parseInt(keyHex.substr(i, 2), 16))
  if (key.length > 64) key = __sha256Bytes(key)
  while (key.length < 64) key.push(0)
  var ip = [], op = []
  for (var i = 0; i < 64; i++) { ip.push(key[i] ^ 0x36); op.push(key[i] ^ 0x5c) }
  var inner = __sha256Bytes(ip.concat(__u8(message)))
  var mac = __sha256Bytes(op.concat(inner))
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  var out = ''
  for (var i = 0; i < mac.length; i += 3) {
    var b0 = mac[i], b1 = mac[i + 1], b2 = mac[i + 2]
    out += chars[b0 >> 2] + chars[((b0 & 3) << 4) | ((b1 || 0) >> 4)]
    out += b1 === undefined ? '=' : chars[((b1 & 15) << 2) | ((b2 || 0) >> 6)]
    out += b2 === undefined ? '=' : chars[b2 & 63]
  }
  return out
}

// init 自测：sha256('abc') 与 HMAC-RFC4231 向量，错则初始化失败（常量手抄错当场暴露）
;(function __selftest() {
  function hexOf(arr) { return arr.map(function (x) { return ('0' + x.toString(16)).slice(-2) }).join('') }
  var h = hexOf(__sha256Bytes(__u8('abc')))
  if (h !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
    throw new Error('听友音乐 SHA-256 自测失败: ' + h)
  }
  var kb = ''
  for (var i = 0; i < 20; i++) kb += '0b'
  var hm = __hmacSha256B64('Hi There', kb)
  if (hm !== 'sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c=') {
    throw new Error('听友音乐 HMAC-SHA256 自测失败: ' + hm)
  }
})()

// ── 网关协议 ──
function TV_uuid() {
  var s = ''
  for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s.substring(0, 8) + '-' + s.substring(8, 12) + '-4' + s.substring(13, 16) + '-a' + s.substring(17, 20) + '-' + s.substring(20, 32)
}

function TV_common() {
  return '"appVer":"-1","brand":"BROWSER","device_id":"' + TV_dev + '","model":"UNKNOWN","osVer":"1","timestamp":' + Math.floor(Date.now() / 1000)
}

function TV_post(path, inner, withToken) {
  var ct = lx.utils.crypto.aesEn(inner, 'aes-256-cbc', TV_KEY, TV_IV)
  var sig = __hmacSha256B64(ct, TV_HMAC)
  var headers = {
    'User-Agent': TV_UA,
    'Content-Type': 'application/json',
    'X-Post-Signature': sig,
    'X-Device-Id': TV_dev,
    'Origin': 'https://tingyou.fm',
    'Referer': 'https://tingyou.fm/',
  }
  if (withToken) headers['Authorization'] = 'Bearer ' + TV_token
  return new Promise(function (resolve, reject) {
    request(TV_API + path, { method: 'POST', headers: headers, body: ct, timeout: 15000 }, function (err, resp) {
      if (err) return reject(new Error(String(err)))
      try {
        var b64 = String(resp.body || '').trim().replace(/-/g, '+').replace(/_/g, '/')
        var plain = lx.utils.crypto.aesDe(b64, 'aes-256-cbc', TV_KEY, TV_IV)
        resolve(JSON.parse(plain))
      } catch (e) { reject(new Error('听友音乐 响应解密失败: ' + String((e && e.message) || e))) }
    })
  })
}

function TV_register() {
  TV_dev = TV_uuid()
  return TV_post('/web/user/register/temp', '{' + TV_common() + '}', false).then(function (v) {
    if (v.code !== 200) throw new Error('听友音乐 注册失败: ' + (v.message || v.code))
    TV_token = (v.data && v.data.tokens && v.data.tokens.accessToken) || ''
    if (!TV_token) throw new Error('听友音乐 注册无 token')
  })
}

function TV_ensure() {
  return TV_token ? Promise.resolve() : TV_register()
}

// 业务调用；401（token 过期）重注册重试一次
function TV_call(op, params, query, extra) {
  return TV_ensure().then(function () {
    var inner = '{' + (extra ? extra + ',' : '') + '"operation":"' + op + '","params":' + JSON.stringify(params) + ',"query":' + JSON.stringify(query) + ',' + TV_common() + '}'
    return TV_post('/web/v1/tv/call', inner, true).then(function (v) {
      if (v.code === 401) {
        TV_token = ''
        return TV_register().then(function () {
          var inner2 = '{' + (extra ? extra + ',' : '') + '"operation":"' + op + '","params":' + JSON.stringify(params) + ',"query":' + JSON.stringify(query) + ',' + TV_common() + '}'
          return TV_post('/web/v1/tv/call', inner2, true)
        })
      }
      return v
    })
  }).then(function (v) {
    if (v.code !== 200) throw new Error('听友音乐 ' + op + ' 失败: ' + (v.message || v.code))
    return v
  })
}

// ── action 实现 ──
// 站点为 5 个平级栏目（热歌/新歌/歌手/榜单/歌单），条目点击统一进专辑详情页。
// 宿主左栏是「榜单|歌单」二级 tab：榜单 tab 放浏览栏目（热歌/新歌/歌手/榜单），
// 歌单 tab 走 playlist_cats/playlist_list/playlist_detail 入口承载真实歌单——榜单归榜单，歌单归歌单。
function tv_home() {
  return TV_call('music.sections', {}, {}).then(function (v) {
    var items = (v.data && v.data.items) || []
    var classes = []
    for (var i = 0; i < items.length; i++) {
      var id = items[i].id || ''
      if (id === 'playlist') continue // 歌单栏目走宿主「歌单」tab（playlist_list）
      classes.push({ type_id: id, type_name: items[i].name || '栏目' })
    }
    return { class: classes }
  })
}

// 宿主音乐模块行契约（对齐 music.rs 五平台）：vod_id 点播 / vod_name 歌名 / vod_pic 封面 /
// vod_remarks 歌手列 / vod_content 专辑列 / vod_album_id 专辑列可点进详情。
// 听友分类/搜索返回专辑集合（mode:'albums'，前端渲染专辑卡片网格）：
// 行 vod_id=album__1（快捷播第 1 首），vod_album_id 进曲目详情。
function albumRow(a) {
  var aid = a.album_id || a.id || ''
  return {
    vod_id: aid + '__1',
    vod_album_id: aid,
    vod_name: a.title || '',
    vod_pic: a.cover_url || '',
    vod_remarks: a.author || a.teller || '',
    vod_content: a.subtitle || '',
    vod_track_count: a.count || 0,
    vod_duration: 0,
  }
}

function tv_albums(section, q, page) {
  var query = { section: section, page: String(page || 1), page_size: '30' }
  if (q) query.q = q
  return TV_call('music.albums', {}, query).then(function (v) {
    var items = (v.data && v.data.items) || []
    var total = (v.data && v.data.total) || 0
    var list = []
    for (var i = 0; i < items.length; i++) list.push(albumRow(items[i] || {}))
    return { mode: 'albums', list: list, total: total, page: page || 1, pagecount: Math.max(1, Math.ceil(total / 30)) }
  })
}

function tv_category(cate, page) { return tv_albums(cate || 'hot', '', page) }

// 站点 searchMusic 同构：全部 section 并行查 +q，按 section 顺序合并去重
var TV_SECTIONS = ['hot', 'new', 'artist', 'ranking', 'playlist']
function tv_search(wd, page) {
  var q = String(wd || '').trim()
  if (!q) return Promise.resolve({ mode: 'albums', list: [], total: 0, page: page || 1 })
  return Promise.all(TV_SECTIONS.map(function (sec) {
    return TV_call('music.albums', {}, { section: sec, page: String(page || 1), page_size: '30', q: q })
      .then(function (v) { return (v.data && v.data.items) || [] })
      .catch(function () { return [] })
  })).then(function (groups) {
    var seen = {}
    var list = []
    for (var g = 0; g < groups.length; g++) {
      var items = groups[g] || []
      for (var i = 0; i < items.length; i++) {
        var row = albumRow(items[i] || {})
        var key = row.vod_album_id
        if (!key || seen[key]) continue
        seen[key] = 1
        list.push(row)
      }
    }
    return { mode: 'albums', list: list, total: list.length, page: page || 1 }
  })
}

// 详情 = music.album（单专辑头）+ music.tracks（曲表；chapters/tracks 同构）
function tv_detail(id) {
  var aid = String(id || '').split('__')[0]
  return TV_call('music.album', { album_id: aid }, {}).then(function (r1) {
    var a = r1.data || {}
    return TV_call('music.tracks', { album_id: aid }, {}).then(function (r2) {
      var d = r2.data || {}
      var cs = d.chapters || d.tracks || []
      var list = []
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i] || {}
        list.push({
          vod_id: aid + '__' + (c.index || i + 1),
          vod_name: c.title || '曲目',
          vod_pic: '',
          vod_remarks: c.artist || '',
          vod_content: c.album || '',
          vod_duration: c.duration || 0,
        })
      }
      return {
        info: {
          name: a.title || '',
          img: a.cover_url || '',
          author: a.author || a.teller || '',
          desc: a.description || a.subtitle || '',
        },
        list: list,
      }
    })
  })
}

function tv_play(id) {
  var parts = String(id || '').split('__')
  var aid = parts[0], idx = parts[1] || '1'
  // playback_session 必须带 idempotency_key（UUID v4）
  var extra = '"idempotency_key":"' + TV_uuid() + '"'
  return TV_call('music.playback_session', { album_id: aid, index: idx }, {}, extra).then(function (v) {
    var url = (v.data && v.data.play_url) || ''
    if (!url) throw new Error('听友音乐 无播放地址')
    return url
  })
}

on(EVENT_NAMES.request, function (req) {
  var action = req.action, info = req.info || {}
  switch (action) {
    case 'musicUrl': return tv_play(info.musicInfo && info.musicInfo.songmid)
    case 'home': return tv_home()
    case 'category': return tv_category(info.cate, info.page)
    case 'search': return tv_search(info.wd, info.page)
    case 'detail': return tv_detail(info.id)
    case 'album': return tv_detail(info.id)
    // 歌单栏目（宿主「歌单」tab）：cats 固定单分类；list=playlist section 专辑集合；detail 同专辑详情
    case 'playlist_cats': return Promise.resolve({ class: [{ type_id: 'playlist', type_name: '歌单' }] })
    case 'playlist_list': return tv_albums('playlist', '', info.page)
    case 'playlist_detail': return tv_detail(info.id)
    case 'lyric': return Promise.resolve('') // 听友协议无歌词字段
    default: return Promise.reject(new Error('听友音乐 不支持 action: ' + action))
  }
})

send(EVENT_NAMES.inited, {
  sources: {
    panbox_tingyou: {
      name: '听友音乐',
      type: 'music',
      actions: ['musicUrl', 'home', 'category', 'search', 'detail', 'playlist_cats', 'playlist_list', 'playlist_detail', 'lyric'],
      qualitys: ['128k'],
    },
  },
})

  globalThis.__PANBOX_TINGYOU = __cap.handler;
})();
"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/shims/request.js
  function hostHasSync() {
    return typeof __lxRequestSync === "function";
  }
  function lxApiRequest(url, options) {
    return new Promise((resolve, reject) => {
      globalThis.lx.request(url, options, (err, resp) => {
        if (err) return reject(new Error(String(err)));
        resolve(resp);
      });
    });
  }
  async function hostRequest(url, options) {
    const method = (options.method || "get").toUpperCase();
    const headers = {};
    const h = options.headers;
    if (h) for (const k in h) headers[k] = String(h[k]);
    let body;
    if (options.form !== void 0 && options.form !== null) {
      const enc = (s) => encodeURIComponent(String(s)).replace(/%20/g, "+");
      body = Object.keys(options.form).map((k) => enc(k) + "=" + enc(options.form[k])).join("&");
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (options.body !== void 0 && options.body !== null) {
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (options.headers && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }
    const isBinary = options.binary === true;
    const raw = JSON.parse(__lxRequestSync(url, JSON.stringify({ method, headers, body: body || void 0, timeout: options.timeout || 12e3, binary: isBinary })));
    if (raw.error) throw new Error(raw.error);
    let parsed;
    if (isBinary) {
      const CH2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const out = [];
      let bits = 0, acc = 0;
      for (const c of raw.bytes_b64 || "") {
        const v = CH2.indexOf(c);
        if (v < 0) continue;
        acc = acc << 6 | v;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          out.push(acc >> bits & 255);
        }
      }
      parsed = new Uint8Array(out);
      console.log("[shim:binary] bytes=", out.length, "head=", out.slice(0, 8).map((x) => String.fromCharCode(x)).join(""));
    } else {
      parsed = raw.text;
      try {
        parsed = JSON.parse(raw.text);
      } catch (e) {
      }
    }
    return { statusCode: raw.status, headers: raw.headers || {}, body: parsed, raw: raw.text, url: raw.final_url };
  }
  async function lxRequestBin(url, options) {
    const resp = await lxApiRequest(url, options);
    let body = resp.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
      }
    }
    return { statusCode: resp.statusCode ?? resp.status, headers: resp.headers || {}, body, raw: resp.raw ?? "", url: resp.url ?? url };
  }
  function httpFetch(url, options = {}) {
    const promise = hostHasSync() ? hostRequest(url, options) : lxRequestBin(url, options);
    return { promise, cancelHttp() {
    } };
  }
  var init_request = __esm({
    "src/shims/request.js"() {
      "use strict";
    }
  });

  // src/musicSdk/kw/tipSearch.js
  var tipSearch_default;
  var init_tipSearch = __esm({
    "src/musicSdk/kw/tipSearch.js"() {
      "use strict";
      init_request();
      tipSearch_default = {
        regExps: {
          relWord: /RELWORD=(.+)/
        },
        requestObj: null,
        async tipSearchBySong(str) {
          this.cancelTipSearch();
          this.requestObj = httpFetch(`https://tips.kuwo.cn/t.s?corp=kuwo&newver=3&p2p=1&notrace=0&c=mbox&w=${encodeURIComponent(str)}&encoding=utf8&rformat=json`, {
            Referer: "http://www.kuwo.cn/"
          });
          return this.requestObj.promise.then(({ body, statusCode }) => {
            if (statusCode != 200 || !body.WORDITEMS) return Promise.reject(new Error("请求失败"));
            return body.WORDITEMS;
          });
        },
        handleResult(rawData) {
          return rawData.map((item) => item.RELWORD);
        },
        cancelTipSearch() {
          if (this.requestObj && this.requestObj.cancelHttp) this.requestObj.cancelHttp();
        },
        async search(str) {
          return this.tipSearchBySong(str).then((result) => this.handleResult(result));
        }
      };
    }
  });

  // src/shims/utils_index.js
  function decodeName(str = "") {
    if (!str) return "";
    return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
      if (g[0] === "#") {
        const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return ENT[g.toLowerCase()] ?? m;
    });
  }
  function sizeFormate(size) {
    if (!size) return "0 B";
    if (size > 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(2) + " G";
    if (size > 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + " M";
    if (size > 1024) return (size / 1024).toFixed(1) + " K";
    return size + " B";
  }
  function formatPlayTime(time) {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }
  function dateFormat() {
    return "";
  }
  function dateFormat2(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts) || ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function formatPlayCount(n) {
    const v = Number(n) || 0;
    return v >= 1e8 ? Math.floor(v / 1e8) + "亿" : v >= 1e4 ? Math.floor(v / 1e4) + "万" : String(v);
  }
  var ENT;
  var init_utils_index = __esm({
    "src/shims/utils_index.js"() {
      "use strict";
      ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
    }
  });

  // src/shims/buffer.js
  function utf8bytes(s) {
    const u = encodeURIComponent(s);
    const out = [];
    for (let i = 0; i < u.length; i++) {
      if (u[i] === "%") {
        out.push(parseInt(u.substr(i + 1, 2), 16));
        i += 2;
      } else out.push(u.charCodeAt(i));
    }
    return out;
  }
  function btoa(s) {
    const b = utf8bytes(s);
    let out = "";
    for (let i = 0; i < b.length; i += 3) {
      const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2];
      out += CH[b0 >> 2] + CH[(b0 & 3) << 4 | (b1 || 0) >> 4];
      out += b1 === void 0 ? "=" : CH[(b1 & 15) << 2 | (b2 || 0) >> 6];
      out += b2 === void 0 ? "=" : CH[b2 & 63];
    }
    return out;
  }
  function b64bytes(s) {
    const out = [];
    let bits = 0, acc = 0;
    for (let i = 0; i < s.length; i++) {
      const v = CH.indexOf(s[i]);
      if (v < 0) continue;
      acc = acc << 6 | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push(acc >> bits & 255);
      }
    }
    return out;
  }
  function bytesToStr(bytes, start = 0, end = bytes.length) {
    let out = "";
    let i = start;
    while (i < end) {
      const b = bytes[i];
      if (b < 128) {
        out += String.fromCharCode(b);
        i++;
        continue;
      }
      let len = 0, cp = 0;
      if (b >= 194 && b <= 223) {
        len = 2;
        cp = b & 31;
      } else if (b >= 224 && b <= 239) {
        len = 3;
        cp = b & 15;
      } else if (b >= 240 && b <= 244) {
        len = 4;
        cp = b & 7;
      }
      if (!len || i + len > end) {
        out += "�";
        i++;
        continue;
      }
      let ok = true;
      for (let k = 1; k < len; k++) {
        const c = bytes[i + k];
        if ((c & 192) !== 128) {
          ok = false;
          break;
        }
        cp = cp << 6 | c & 63;
      }
      if (!ok) {
        out += "�";
        i++;
        continue;
      }
      out += String.fromCodePoint(cp);
      i += len;
    }
    return out;
  }
  var CH, Buf, Buffer2;
  var init_buffer = __esm({
    "src/shims/buffer.js"() {
      "use strict";
      CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      Buf = class _Buf extends Array {
        toString(enc = "utf8", start = 0, end) {
          const e = end === void 0 ? this.length : Math.min(end, this.length);
          if (enc === "base64") return btoa(bytesToStr(this, start, e));
          if (enc === "hex") return this.slice(start, e).map((x) => x.toString(16).padStart(2, "0")).join("");
          return bytesToStr(this, start, e);
        }
        subarray(start = 0, end) {
          return _Buf.from(this.slice(start, end === void 0 ? this.length : end));
        }
        slice(start = 0, end) {
          const a = super.slice(start, end === void 0 ? this.length : end);
          return _Buf.from(a);
        }
        indexOf(needle, from = 0) {
          if (typeof needle === "number") return super.indexOf(needle, from);
          const nb = utf8bytes(needle);
          outer: for (let i = Math.max(0, from); i <= this.length - nb.length; i++) {
            for (let j = 0; j < nb.length; j++) if (this[i + j] !== nb[j]) continue outer;
            return i;
          }
          return -1;
        }
        reverse() {
          const a = Array.from(this);
          a.reverse();
          return _Buf.from(a);
        }
        toJSON() {
          return bytesToStr(this);
        }
      };
      Buffer2 = {
        from(data, enc = "utf8") {
          if (typeof data === "string") {
            if (enc === "base64") return Buf.from(b64bytes(data));
            if (enc === "hex") return Buf.from((data.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
            return Buf.from(utf8bytes(data));
          }
          if (data instanceof Buf) return Buf.from(Array.from(data));
          return Buf.from(Array.from(data));
        },
        isBuffer: (x) => x instanceof Buf,
        concat(arrs) {
          const out = [];
          for (const a of arrs) for (const b of a) out.push(b);
          return Buf.from(out);
        },
        alloc(n, fill = 0) {
          return Buf.from(new Array(n).fill(fill));
        }
      };
    }
  });

  // src/shims/md5.js
  var stringMd5;
  var init_md5 = __esm({
    "src/shims/md5.js"() {
      "use strict";
      stringMd5 = (s) => typeof __lxMd5 === "function" ? __lxMd5(s) : globalThis.lx.utils.crypto.md5(s);
    }
  });

  // src/musicSdk/utils.js
  var toMD5, formatSingerName;
  var init_utils = __esm({
    "src/musicSdk/utils.js"() {
      "use strict";
      init_md5();
      init_utils_index();
      toMD5 = (str) => stringMd5(str);
      formatSingerName = (singers, nameKey = "name", join = "、") => {
        if (Array.isArray(singers)) {
          const singer = [];
          singers.forEach((item) => {
            let name = item[nameKey];
            if (!name) return;
            singer.push(name);
          });
          return decodeName(singer.join(join));
        }
        return decodeName(String(singers ?? ""));
      };
    }
  });

  // (disabled):crypto
  var require_crypto = __commonJS({
    "(disabled):crypto"() {
    }
  });

  // node_modules/crypto-js/core.js
  var require_core = __commonJS({
    "node_modules/crypto-js/core.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory();
        } else if (typeof define === "function" && define.amd) {
          define([], factory);
        } else {
          root.CryptoJS = factory();
        }
      })(exports, function() {
        var CryptoJS2 = CryptoJS2 || (function(Math2, undefined2) {
          var crypto;
          if (typeof window !== "undefined" && window.crypto) {
            crypto = window.crypto;
          }
          if (typeof self !== "undefined" && self.crypto) {
            crypto = self.crypto;
          }
          if (typeof globalThis !== "undefined" && globalThis.crypto) {
            crypto = globalThis.crypto;
          }
          if (!crypto && typeof window !== "undefined" && window.msCrypto) {
            crypto = window.msCrypto;
          }
          if (!crypto && typeof global !== "undefined" && global.crypto) {
            crypto = global.crypto;
          }
          if (!crypto && typeof __require === "function") {
            try {
              crypto = require_crypto();
            } catch (err) {
            }
          }
          var cryptoSecureRandomInt = function() {
            if (crypto) {
              if (typeof crypto.getRandomValues === "function") {
                try {
                  return crypto.getRandomValues(new Uint32Array(1))[0];
                } catch (err) {
                }
              }
              if (typeof crypto.randomBytes === "function") {
                try {
                  return crypto.randomBytes(4).readInt32LE();
                } catch (err) {
                }
              }
            }
            throw new Error("Native crypto module could not be used to get secure random number.");
          };
          var create = Object.create || /* @__PURE__ */ (function() {
            function F() {
            }
            return function(obj) {
              var subtype;
              F.prototype = obj;
              subtype = new F();
              F.prototype = null;
              return subtype;
            };
          })();
          var C = {};
          var C_lib = C.lib = {};
          var Base = C_lib.Base = /* @__PURE__ */ (function() {
            return {
              /**
               * Creates a new object that inherits from this object.
               *
               * @param {Object} overrides Properties to copy into the new object.
               *
               * @return {Object} The new object.
               *
               * @static
               *
               * @example
               *
               *     var MyType = CryptoJS.lib.Base.extend({
               *         field: 'value',
               *
               *         method: function () {
               *         }
               *     });
               */
              extend: function(overrides) {
                var subtype = create(this);
                if (overrides) {
                  subtype.mixIn(overrides);
                }
                if (!subtype.hasOwnProperty("init") || this.init === subtype.init) {
                  subtype.init = function() {
                    subtype.$super.init.apply(this, arguments);
                  };
                }
                subtype.init.prototype = subtype;
                subtype.$super = this;
                return subtype;
              },
              /**
               * Extends this object and runs the init method.
               * Arguments to create() will be passed to init().
               *
               * @return {Object} The new object.
               *
               * @static
               *
               * @example
               *
               *     var instance = MyType.create();
               */
              create: function() {
                var instance = this.extend();
                instance.init.apply(instance, arguments);
                return instance;
              },
              /**
               * Initializes a newly created object.
               * Override this method to add some logic when your objects are created.
               *
               * @example
               *
               *     var MyType = CryptoJS.lib.Base.extend({
               *         init: function () {
               *             // ...
               *         }
               *     });
               */
              init: function() {
              },
              /**
               * Copies properties into this object.
               *
               * @param {Object} properties The properties to mix in.
               *
               * @example
               *
               *     MyType.mixIn({
               *         field: 'value'
               *     });
               */
              mixIn: function(properties) {
                for (var propertyName in properties) {
                  if (properties.hasOwnProperty(propertyName)) {
                    this[propertyName] = properties[propertyName];
                  }
                }
                if (properties.hasOwnProperty("toString")) {
                  this.toString = properties.toString;
                }
              },
              /**
               * Creates a copy of this object.
               *
               * @return {Object} The clone.
               *
               * @example
               *
               *     var clone = instance.clone();
               */
              clone: function() {
                return this.init.prototype.extend(this);
              }
            };
          })();
          var WordArray = C_lib.WordArray = Base.extend({
            /**
             * Initializes a newly created word array.
             *
             * @param {Array} words (Optional) An array of 32-bit words.
             * @param {number} sigBytes (Optional) The number of significant bytes in the words.
             *
             * @example
             *
             *     var wordArray = CryptoJS.lib.WordArray.create();
             *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607]);
             *     var wordArray = CryptoJS.lib.WordArray.create([0x00010203, 0x04050607], 6);
             */
            init: function(words, sigBytes) {
              words = this.words = words || [];
              if (sigBytes != undefined2) {
                this.sigBytes = sigBytes;
              } else {
                this.sigBytes = words.length * 4;
              }
            },
            /**
             * Converts this word array to a string.
             *
             * @param {Encoder} encoder (Optional) The encoding strategy to use. Default: CryptoJS.enc.Hex
             *
             * @return {string} The stringified word array.
             *
             * @example
             *
             *     var string = wordArray + '';
             *     var string = wordArray.toString();
             *     var string = wordArray.toString(CryptoJS.enc.Utf8);
             */
            toString: function(encoder) {
              return (encoder || Hex).stringify(this);
            },
            /**
             * Concatenates a word array to this word array.
             *
             * @param {WordArray} wordArray The word array to append.
             *
             * @return {WordArray} This word array.
             *
             * @example
             *
             *     wordArray1.concat(wordArray2);
             */
            concat: function(wordArray) {
              var thisWords = this.words;
              var thatWords = wordArray.words;
              var thisSigBytes = this.sigBytes;
              var thatSigBytes = wordArray.sigBytes;
              this.clamp();
              if (thisSigBytes % 4) {
                for (var i = 0; i < thatSigBytes; i++) {
                  var thatByte = thatWords[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                  thisWords[thisSigBytes + i >>> 2] |= thatByte << 24 - (thisSigBytes + i) % 4 * 8;
                }
              } else {
                for (var j = 0; j < thatSigBytes; j += 4) {
                  thisWords[thisSigBytes + j >>> 2] = thatWords[j >>> 2];
                }
              }
              this.sigBytes += thatSigBytes;
              return this;
            },
            /**
             * Removes insignificant bits.
             *
             * @example
             *
             *     wordArray.clamp();
             */
            clamp: function() {
              var words = this.words;
              var sigBytes = this.sigBytes;
              words[sigBytes >>> 2] &= 4294967295 << 32 - sigBytes % 4 * 8;
              words.length = Math2.ceil(sigBytes / 4);
            },
            /**
             * Creates a copy of this word array.
             *
             * @return {WordArray} The clone.
             *
             * @example
             *
             *     var clone = wordArray.clone();
             */
            clone: function() {
              var clone = Base.clone.call(this);
              clone.words = this.words.slice(0);
              return clone;
            },
            /**
             * Creates a word array filled with random bytes.
             *
             * @param {number} nBytes The number of random bytes to generate.
             *
             * @return {WordArray} The random word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.lib.WordArray.random(16);
             */
            random: function(nBytes) {
              var words = [];
              for (var i = 0; i < nBytes; i += 4) {
                words.push(cryptoSecureRandomInt());
              }
              return new WordArray.init(words, nBytes);
            }
          });
          var C_enc = C.enc = {};
          var Hex = C_enc.Hex = {
            /**
             * Converts a word array to a hex string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The hex string.
             *
             * @static
             *
             * @example
             *
             *     var hexString = CryptoJS.enc.Hex.stringify(wordArray);
             */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var hexChars = [];
              for (var i = 0; i < sigBytes; i++) {
                var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                hexChars.push((bite >>> 4).toString(16));
                hexChars.push((bite & 15).toString(16));
              }
              return hexChars.join("");
            },
            /**
             * Converts a hex string to a word array.
             *
             * @param {string} hexStr The hex string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Hex.parse(hexString);
             */
            parse: function(hexStr) {
              var hexStrLength = hexStr.length;
              var words = [];
              for (var i = 0; i < hexStrLength; i += 2) {
                words[i >>> 3] |= parseInt(hexStr.substr(i, 2), 16) << 24 - i % 8 * 4;
              }
              return new WordArray.init(words, hexStrLength / 2);
            }
          };
          var Latin1 = C_enc.Latin1 = {
            /**
             * Converts a word array to a Latin1 string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The Latin1 string.
             *
             * @static
             *
             * @example
             *
             *     var latin1String = CryptoJS.enc.Latin1.stringify(wordArray);
             */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var latin1Chars = [];
              for (var i = 0; i < sigBytes; i++) {
                var bite = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                latin1Chars.push(String.fromCharCode(bite));
              }
              return latin1Chars.join("");
            },
            /**
             * Converts a Latin1 string to a word array.
             *
             * @param {string} latin1Str The Latin1 string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Latin1.parse(latin1String);
             */
            parse: function(latin1Str) {
              var latin1StrLength = latin1Str.length;
              var words = [];
              for (var i = 0; i < latin1StrLength; i++) {
                words[i >>> 2] |= (latin1Str.charCodeAt(i) & 255) << 24 - i % 4 * 8;
              }
              return new WordArray.init(words, latin1StrLength);
            }
          };
          var Utf8 = C_enc.Utf8 = {
            /**
             * Converts a word array to a UTF-8 string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The UTF-8 string.
             *
             * @static
             *
             * @example
             *
             *     var utf8String = CryptoJS.enc.Utf8.stringify(wordArray);
             */
            stringify: function(wordArray) {
              try {
                return decodeURIComponent(escape(Latin1.stringify(wordArray)));
              } catch (e) {
                throw new Error("Malformed UTF-8 data");
              }
            },
            /**
             * Converts a UTF-8 string to a word array.
             *
             * @param {string} utf8Str The UTF-8 string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Utf8.parse(utf8String);
             */
            parse: function(utf8Str) {
              return Latin1.parse(unescape(encodeURIComponent(utf8Str)));
            }
          };
          var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm = Base.extend({
            /**
             * Resets this block algorithm's data buffer to its initial state.
             *
             * @example
             *
             *     bufferedBlockAlgorithm.reset();
             */
            reset: function() {
              this._data = new WordArray.init();
              this._nDataBytes = 0;
            },
            /**
             * Adds new data to this block algorithm's buffer.
             *
             * @param {WordArray|string} data The data to append. Strings are converted to a WordArray using UTF-8.
             *
             * @example
             *
             *     bufferedBlockAlgorithm._append('data');
             *     bufferedBlockAlgorithm._append(wordArray);
             */
            _append: function(data) {
              if (typeof data == "string") {
                data = Utf8.parse(data);
              }
              this._data.concat(data);
              this._nDataBytes += data.sigBytes;
            },
            /**
             * Processes available data blocks.
             *
             * This method invokes _doProcessBlock(offset), which must be implemented by a concrete subtype.
             *
             * @param {boolean} doFlush Whether all blocks and partial blocks should be processed.
             *
             * @return {WordArray} The processed data.
             *
             * @example
             *
             *     var processedData = bufferedBlockAlgorithm._process();
             *     var processedData = bufferedBlockAlgorithm._process(!!'flush');
             */
            _process: function(doFlush) {
              var processedWords;
              var data = this._data;
              var dataWords = data.words;
              var dataSigBytes = data.sigBytes;
              var blockSize = this.blockSize;
              var blockSizeBytes = blockSize * 4;
              var nBlocksReady = dataSigBytes / blockSizeBytes;
              if (doFlush) {
                nBlocksReady = Math2.ceil(nBlocksReady);
              } else {
                nBlocksReady = Math2.max((nBlocksReady | 0) - this._minBufferSize, 0);
              }
              var nWordsReady = nBlocksReady * blockSize;
              var nBytesReady = Math2.min(nWordsReady * 4, dataSigBytes);
              if (nWordsReady) {
                for (var offset = 0; offset < nWordsReady; offset += blockSize) {
                  this._doProcessBlock(dataWords, offset);
                }
                processedWords = dataWords.splice(0, nWordsReady);
                data.sigBytes -= nBytesReady;
              }
              return new WordArray.init(processedWords, nBytesReady);
            },
            /**
             * Creates a copy of this object.
             *
             * @return {Object} The clone.
             *
             * @example
             *
             *     var clone = bufferedBlockAlgorithm.clone();
             */
            clone: function() {
              var clone = Base.clone.call(this);
              clone._data = this._data.clone();
              return clone;
            },
            _minBufferSize: 0
          });
          var Hasher = C_lib.Hasher = BufferedBlockAlgorithm.extend({
            /**
             * Configuration options.
             */
            cfg: Base.extend(),
            /**
             * Initializes a newly created hasher.
             *
             * @param {Object} cfg (Optional) The configuration options to use for this hash computation.
             *
             * @example
             *
             *     var hasher = CryptoJS.algo.SHA256.create();
             */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
              this.reset();
            },
            /**
             * Resets this hasher to its initial state.
             *
             * @example
             *
             *     hasher.reset();
             */
            reset: function() {
              BufferedBlockAlgorithm.reset.call(this);
              this._doReset();
            },
            /**
             * Updates this hasher with a message.
             *
             * @param {WordArray|string} messageUpdate The message to append.
             *
             * @return {Hasher} This hasher.
             *
             * @example
             *
             *     hasher.update('message');
             *     hasher.update(wordArray);
             */
            update: function(messageUpdate) {
              this._append(messageUpdate);
              this._process();
              return this;
            },
            /**
             * Finalizes the hash computation.
             * Note that the finalize operation is effectively a destructive, read-once operation.
             *
             * @param {WordArray|string} messageUpdate (Optional) A final message update.
             *
             * @return {WordArray} The hash.
             *
             * @example
             *
             *     var hash = hasher.finalize();
             *     var hash = hasher.finalize('message');
             *     var hash = hasher.finalize(wordArray);
             */
            finalize: function(messageUpdate) {
              if (messageUpdate) {
                this._append(messageUpdate);
              }
              var hash = this._doFinalize();
              return hash;
            },
            blockSize: 512 / 32,
            /**
             * Creates a shortcut function to a hasher's object interface.
             *
             * @param {Hasher} hasher The hasher to create a helper for.
             *
             * @return {Function} The shortcut function.
             *
             * @static
             *
             * @example
             *
             *     var SHA256 = CryptoJS.lib.Hasher._createHelper(CryptoJS.algo.SHA256);
             */
            _createHelper: function(hasher) {
              return function(message, cfg) {
                return new hasher.init(cfg).finalize(message);
              };
            },
            /**
             * Creates a shortcut function to the HMAC's object interface.
             *
             * @param {Hasher} hasher The hasher to use in this HMAC helper.
             *
             * @return {Function} The shortcut function.
             *
             * @static
             *
             * @example
             *
             *     var HmacSHA256 = CryptoJS.lib.Hasher._createHmacHelper(CryptoJS.algo.SHA256);
             */
            _createHmacHelper: function(hasher) {
              return function(message, key) {
                return new C_algo.HMAC.init(hasher, key).finalize(message);
              };
            }
          });
          var C_algo = C.algo = {};
          return C;
        })(Math);
        return CryptoJS2;
      });
    }
  });

  // node_modules/crypto-js/x64-core.js
  var require_x64_core = __commonJS({
    "node_modules/crypto-js/x64-core.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(undefined2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var X32WordArray = C_lib.WordArray;
          var C_x64 = C.x64 = {};
          var X64Word = C_x64.Word = Base.extend({
            /**
             * Initializes a newly created 64-bit word.
             *
             * @param {number} high The high 32 bits.
             * @param {number} low The low 32 bits.
             *
             * @example
             *
             *     var x64Word = CryptoJS.x64.Word.create(0x00010203, 0x04050607);
             */
            init: function(high, low) {
              this.high = high;
              this.low = low;
            }
            /**
             * Bitwise NOTs this word.
             *
             * @return {X64Word} A new x64-Word object after negating.
             *
             * @example
             *
             *     var negated = x64Word.not();
             */
            // not: function () {
            // var high = ~this.high;
            // var low = ~this.low;
            // return X64Word.create(high, low);
            // },
            /**
             * Bitwise ANDs this word with the passed word.
             *
             * @param {X64Word} word The x64-Word to AND with this word.
             *
             * @return {X64Word} A new x64-Word object after ANDing.
             *
             * @example
             *
             *     var anded = x64Word.and(anotherX64Word);
             */
            // and: function (word) {
            // var high = this.high & word.high;
            // var low = this.low & word.low;
            // return X64Word.create(high, low);
            // },
            /**
             * Bitwise ORs this word with the passed word.
             *
             * @param {X64Word} word The x64-Word to OR with this word.
             *
             * @return {X64Word} A new x64-Word object after ORing.
             *
             * @example
             *
             *     var ored = x64Word.or(anotherX64Word);
             */
            // or: function (word) {
            // var high = this.high | word.high;
            // var low = this.low | word.low;
            // return X64Word.create(high, low);
            // },
            /**
             * Bitwise XORs this word with the passed word.
             *
             * @param {X64Word} word The x64-Word to XOR with this word.
             *
             * @return {X64Word} A new x64-Word object after XORing.
             *
             * @example
             *
             *     var xored = x64Word.xor(anotherX64Word);
             */
            // xor: function (word) {
            // var high = this.high ^ word.high;
            // var low = this.low ^ word.low;
            // return X64Word.create(high, low);
            // },
            /**
             * Shifts this word n bits to the left.
             *
             * @param {number} n The number of bits to shift.
             *
             * @return {X64Word} A new x64-Word object after shifting.
             *
             * @example
             *
             *     var shifted = x64Word.shiftL(25);
             */
            // shiftL: function (n) {
            // if (n < 32) {
            // var high = (this.high << n) | (this.low >>> (32 - n));
            // var low = this.low << n;
            // } else {
            // var high = this.low << (n - 32);
            // var low = 0;
            // }
            // return X64Word.create(high, low);
            // },
            /**
             * Shifts this word n bits to the right.
             *
             * @param {number} n The number of bits to shift.
             *
             * @return {X64Word} A new x64-Word object after shifting.
             *
             * @example
             *
             *     var shifted = x64Word.shiftR(7);
             */
            // shiftR: function (n) {
            // if (n < 32) {
            // var low = (this.low >>> n) | (this.high << (32 - n));
            // var high = this.high >>> n;
            // } else {
            // var low = this.high >>> (n - 32);
            // var high = 0;
            // }
            // return X64Word.create(high, low);
            // },
            /**
             * Rotates this word n bits to the left.
             *
             * @param {number} n The number of bits to rotate.
             *
             * @return {X64Word} A new x64-Word object after rotating.
             *
             * @example
             *
             *     var rotated = x64Word.rotL(25);
             */
            // rotL: function (n) {
            // return this.shiftL(n).or(this.shiftR(64 - n));
            // },
            /**
             * Rotates this word n bits to the right.
             *
             * @param {number} n The number of bits to rotate.
             *
             * @return {X64Word} A new x64-Word object after rotating.
             *
             * @example
             *
             *     var rotated = x64Word.rotR(7);
             */
            // rotR: function (n) {
            // return this.shiftR(n).or(this.shiftL(64 - n));
            // },
            /**
             * Adds this word with the passed word.
             *
             * @param {X64Word} word The x64-Word to add with this word.
             *
             * @return {X64Word} A new x64-Word object after adding.
             *
             * @example
             *
             *     var added = x64Word.add(anotherX64Word);
             */
            // add: function (word) {
            // var low = (this.low + word.low) | 0;
            // var carry = (low >>> 0) < (this.low >>> 0) ? 1 : 0;
            // var high = (this.high + word.high + carry) | 0;
            // return X64Word.create(high, low);
            // }
          });
          var X64WordArray = C_x64.WordArray = Base.extend({
            /**
             * Initializes a newly created word array.
             *
             * @param {Array} words (Optional) An array of CryptoJS.x64.Word objects.
             * @param {number} sigBytes (Optional) The number of significant bytes in the words.
             *
             * @example
             *
             *     var wordArray = CryptoJS.x64.WordArray.create();
             *
             *     var wordArray = CryptoJS.x64.WordArray.create([
             *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
             *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
             *     ]);
             *
             *     var wordArray = CryptoJS.x64.WordArray.create([
             *         CryptoJS.x64.Word.create(0x00010203, 0x04050607),
             *         CryptoJS.x64.Word.create(0x18191a1b, 0x1c1d1e1f)
             *     ], 10);
             */
            init: function(words, sigBytes) {
              words = this.words = words || [];
              if (sigBytes != undefined2) {
                this.sigBytes = sigBytes;
              } else {
                this.sigBytes = words.length * 8;
              }
            },
            /**
             * Converts this 64-bit word array to a 32-bit word array.
             *
             * @return {CryptoJS.lib.WordArray} This word array's data as a 32-bit word array.
             *
             * @example
             *
             *     var x32WordArray = x64WordArray.toX32();
             */
            toX32: function() {
              var x64Words = this.words;
              var x64WordsLength = x64Words.length;
              var x32Words = [];
              for (var i = 0; i < x64WordsLength; i++) {
                var x64Word = x64Words[i];
                x32Words.push(x64Word.high);
                x32Words.push(x64Word.low);
              }
              return X32WordArray.create(x32Words, this.sigBytes);
            },
            /**
             * Creates a copy of this word array.
             *
             * @return {X64WordArray} The clone.
             *
             * @example
             *
             *     var clone = x64WordArray.clone();
             */
            clone: function() {
              var clone = Base.clone.call(this);
              var words = clone.words = this.words.slice(0);
              var wordsLength = words.length;
              for (var i = 0; i < wordsLength; i++) {
                words[i] = words[i].clone();
              }
              return clone;
            }
          });
        })();
        return CryptoJS2;
      });
    }
  });

  // node_modules/crypto-js/lib-typedarrays.js
  var require_lib_typedarrays = __commonJS({
    "node_modules/crypto-js/lib-typedarrays.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          if (typeof ArrayBuffer != "function") {
            return;
          }
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var superInit = WordArray.init;
          var subInit = WordArray.init = function(typedArray) {
            if (typedArray instanceof ArrayBuffer) {
              typedArray = new Uint8Array(typedArray);
            }
            if (typedArray instanceof Int8Array || typeof Uint8ClampedArray !== "undefined" && typedArray instanceof Uint8ClampedArray || typedArray instanceof Int16Array || typedArray instanceof Uint16Array || typedArray instanceof Int32Array || typedArray instanceof Uint32Array || typedArray instanceof Float32Array || typedArray instanceof Float64Array) {
              typedArray = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
            }
            if (typedArray instanceof Uint8Array) {
              var typedArrayByteLength = typedArray.byteLength;
              var words = [];
              for (var i = 0; i < typedArrayByteLength; i++) {
                words[i >>> 2] |= typedArray[i] << 24 - i % 4 * 8;
              }
              superInit.call(this, words, typedArrayByteLength);
            } else {
              superInit.apply(this, arguments);
            }
          };
          subInit.prototype = WordArray;
        })();
        return CryptoJS2.lib.WordArray;
      });
    }
  });

  // node_modules/crypto-js/enc-utf16.js
  var require_enc_utf16 = __commonJS({
    "node_modules/crypto-js/enc-utf16.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          var Utf16BE = C_enc.Utf16 = C_enc.Utf16BE = {
            /**
             * Converts a word array to a UTF-16 BE string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The UTF-16 BE string.
             *
             * @static
             *
             * @example
             *
             *     var utf16String = CryptoJS.enc.Utf16.stringify(wordArray);
             */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var utf16Chars = [];
              for (var i = 0; i < sigBytes; i += 2) {
                var codePoint = words[i >>> 2] >>> 16 - i % 4 * 8 & 65535;
                utf16Chars.push(String.fromCharCode(codePoint));
              }
              return utf16Chars.join("");
            },
            /**
             * Converts a UTF-16 BE string to a word array.
             *
             * @param {string} utf16Str The UTF-16 BE string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Utf16.parse(utf16String);
             */
            parse: function(utf16Str) {
              var utf16StrLength = utf16Str.length;
              var words = [];
              for (var i = 0; i < utf16StrLength; i++) {
                words[i >>> 1] |= utf16Str.charCodeAt(i) << 16 - i % 2 * 16;
              }
              return WordArray.create(words, utf16StrLength * 2);
            }
          };
          C_enc.Utf16LE = {
            /**
             * Converts a word array to a UTF-16 LE string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The UTF-16 LE string.
             *
             * @static
             *
             * @example
             *
             *     var utf16Str = CryptoJS.enc.Utf16LE.stringify(wordArray);
             */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var utf16Chars = [];
              for (var i = 0; i < sigBytes; i += 2) {
                var codePoint = swapEndian(words[i >>> 2] >>> 16 - i % 4 * 8 & 65535);
                utf16Chars.push(String.fromCharCode(codePoint));
              }
              return utf16Chars.join("");
            },
            /**
             * Converts a UTF-16 LE string to a word array.
             *
             * @param {string} utf16Str The UTF-16 LE string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Utf16LE.parse(utf16Str);
             */
            parse: function(utf16Str) {
              var utf16StrLength = utf16Str.length;
              var words = [];
              for (var i = 0; i < utf16StrLength; i++) {
                words[i >>> 1] |= swapEndian(utf16Str.charCodeAt(i) << 16 - i % 2 * 16);
              }
              return WordArray.create(words, utf16StrLength * 2);
            }
          };
          function swapEndian(word) {
            return word << 8 & 4278255360 | word >>> 8 & 16711935;
          }
        })();
        return CryptoJS2.enc.Utf16;
      });
    }
  });

  // node_modules/crypto-js/enc-base64.js
  var require_enc_base64 = __commonJS({
    "node_modules/crypto-js/enc-base64.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          var Base64 = C_enc.Base64 = {
            /**
             * Converts a word array to a Base64 string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @return {string} The Base64 string.
             *
             * @static
             *
             * @example
             *
             *     var base64String = CryptoJS.enc.Base64.stringify(wordArray);
             */
            stringify: function(wordArray) {
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var map = this._map;
              wordArray.clamp();
              var base64Chars = [];
              for (var i = 0; i < sigBytes; i += 3) {
                var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
                var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
                var triplet = byte1 << 16 | byte2 << 8 | byte3;
                for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                  base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                while (base64Chars.length % 4) {
                  base64Chars.push(paddingChar);
                }
              }
              return base64Chars.join("");
            },
            /**
             * Converts a Base64 string to a word array.
             *
             * @param {string} base64Str The Base64 string.
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Base64.parse(base64String);
             */
            parse: function(base64Str) {
              var base64StrLength = base64Str.length;
              var map = this._map;
              var reverseMap = this._reverseMap;
              if (!reverseMap) {
                reverseMap = this._reverseMap = [];
                for (var j = 0; j < map.length; j++) {
                  reverseMap[map.charCodeAt(j)] = j;
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                var paddingIndex = base64Str.indexOf(paddingChar);
                if (paddingIndex !== -1) {
                  base64StrLength = paddingIndex;
                }
              }
              return parseLoop(base64Str, base64StrLength, reverseMap);
            },
            _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
          };
          function parseLoop(base64Str, base64StrLength, reverseMap) {
            var words = [];
            var nBytes = 0;
            for (var i = 0; i < base64StrLength; i++) {
              if (i % 4) {
                var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
                var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
                var bitsCombined = bits1 | bits2;
                words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
                nBytes++;
              }
            }
            return WordArray.create(words, nBytes);
          }
        })();
        return CryptoJS2.enc.Base64;
      });
    }
  });

  // node_modules/crypto-js/enc-base64url.js
  var require_enc_base64url = __commonJS({
    "node_modules/crypto-js/enc-base64url.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_enc = C.enc;
          var Base64url = C_enc.Base64url = {
            /**
             * Converts a word array to a Base64url string.
             *
             * @param {WordArray} wordArray The word array.
             *
             * @param {boolean} urlSafe Whether to use url safe
             *
             * @return {string} The Base64url string.
             *
             * @static
             *
             * @example
             *
             *     var base64String = CryptoJS.enc.Base64url.stringify(wordArray);
             */
            stringify: function(wordArray, urlSafe) {
              if (urlSafe === void 0) {
                urlSafe = true;
              }
              var words = wordArray.words;
              var sigBytes = wordArray.sigBytes;
              var map = urlSafe ? this._safe_map : this._map;
              wordArray.clamp();
              var base64Chars = [];
              for (var i = 0; i < sigBytes; i += 3) {
                var byte1 = words[i >>> 2] >>> 24 - i % 4 * 8 & 255;
                var byte2 = words[i + 1 >>> 2] >>> 24 - (i + 1) % 4 * 8 & 255;
                var byte3 = words[i + 2 >>> 2] >>> 24 - (i + 2) % 4 * 8 & 255;
                var triplet = byte1 << 16 | byte2 << 8 | byte3;
                for (var j = 0; j < 4 && i + j * 0.75 < sigBytes; j++) {
                  base64Chars.push(map.charAt(triplet >>> 6 * (3 - j) & 63));
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                while (base64Chars.length % 4) {
                  base64Chars.push(paddingChar);
                }
              }
              return base64Chars.join("");
            },
            /**
             * Converts a Base64url string to a word array.
             *
             * @param {string} base64Str The Base64url string.
             *
             * @param {boolean} urlSafe Whether to use url safe
             *
             * @return {WordArray} The word array.
             *
             * @static
             *
             * @example
             *
             *     var wordArray = CryptoJS.enc.Base64url.parse(base64String);
             */
            parse: function(base64Str, urlSafe) {
              if (urlSafe === void 0) {
                urlSafe = true;
              }
              var base64StrLength = base64Str.length;
              var map = urlSafe ? this._safe_map : this._map;
              var reverseMap = this._reverseMap;
              if (!reverseMap) {
                reverseMap = this._reverseMap = [];
                for (var j = 0; j < map.length; j++) {
                  reverseMap[map.charCodeAt(j)] = j;
                }
              }
              var paddingChar = map.charAt(64);
              if (paddingChar) {
                var paddingIndex = base64Str.indexOf(paddingChar);
                if (paddingIndex !== -1) {
                  base64StrLength = paddingIndex;
                }
              }
              return parseLoop(base64Str, base64StrLength, reverseMap);
            },
            _map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
            _safe_map: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
          };
          function parseLoop(base64Str, base64StrLength, reverseMap) {
            var words = [];
            var nBytes = 0;
            for (var i = 0; i < base64StrLength; i++) {
              if (i % 4) {
                var bits1 = reverseMap[base64Str.charCodeAt(i - 1)] << i % 4 * 2;
                var bits2 = reverseMap[base64Str.charCodeAt(i)] >>> 6 - i % 4 * 2;
                var bitsCombined = bits1 | bits2;
                words[nBytes >>> 2] |= bitsCombined << 24 - nBytes % 4 * 8;
                nBytes++;
              }
            }
            return WordArray.create(words, nBytes);
          }
        })();
        return CryptoJS2.enc.Base64url;
      });
    }
  });

  // node_modules/crypto-js/md5.js
  var require_md5 = __commonJS({
    "node_modules/crypto-js/md5.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var T = [];
          (function() {
            for (var i = 0; i < 64; i++) {
              T[i] = Math2.abs(Math2.sin(i + 1)) * 4294967296 | 0;
            }
          })();
          var MD5 = C_algo.MD5 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                1732584193,
                4023233417,
                2562383102,
                271733878
              ]);
            },
            _doProcessBlock: function(M, offset) {
              for (var i = 0; i < 16; i++) {
                var offset_i = offset + i;
                var M_offset_i = M[offset_i];
                M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
              }
              var H = this._hash.words;
              var M_offset_0 = M[offset + 0];
              var M_offset_1 = M[offset + 1];
              var M_offset_2 = M[offset + 2];
              var M_offset_3 = M[offset + 3];
              var M_offset_4 = M[offset + 4];
              var M_offset_5 = M[offset + 5];
              var M_offset_6 = M[offset + 6];
              var M_offset_7 = M[offset + 7];
              var M_offset_8 = M[offset + 8];
              var M_offset_9 = M[offset + 9];
              var M_offset_10 = M[offset + 10];
              var M_offset_11 = M[offset + 11];
              var M_offset_12 = M[offset + 12];
              var M_offset_13 = M[offset + 13];
              var M_offset_14 = M[offset + 14];
              var M_offset_15 = M[offset + 15];
              var a = H[0];
              var b = H[1];
              var c = H[2];
              var d = H[3];
              a = FF(a, b, c, d, M_offset_0, 7, T[0]);
              d = FF(d, a, b, c, M_offset_1, 12, T[1]);
              c = FF(c, d, a, b, M_offset_2, 17, T[2]);
              b = FF(b, c, d, a, M_offset_3, 22, T[3]);
              a = FF(a, b, c, d, M_offset_4, 7, T[4]);
              d = FF(d, a, b, c, M_offset_5, 12, T[5]);
              c = FF(c, d, a, b, M_offset_6, 17, T[6]);
              b = FF(b, c, d, a, M_offset_7, 22, T[7]);
              a = FF(a, b, c, d, M_offset_8, 7, T[8]);
              d = FF(d, a, b, c, M_offset_9, 12, T[9]);
              c = FF(c, d, a, b, M_offset_10, 17, T[10]);
              b = FF(b, c, d, a, M_offset_11, 22, T[11]);
              a = FF(a, b, c, d, M_offset_12, 7, T[12]);
              d = FF(d, a, b, c, M_offset_13, 12, T[13]);
              c = FF(c, d, a, b, M_offset_14, 17, T[14]);
              b = FF(b, c, d, a, M_offset_15, 22, T[15]);
              a = GG(a, b, c, d, M_offset_1, 5, T[16]);
              d = GG(d, a, b, c, M_offset_6, 9, T[17]);
              c = GG(c, d, a, b, M_offset_11, 14, T[18]);
              b = GG(b, c, d, a, M_offset_0, 20, T[19]);
              a = GG(a, b, c, d, M_offset_5, 5, T[20]);
              d = GG(d, a, b, c, M_offset_10, 9, T[21]);
              c = GG(c, d, a, b, M_offset_15, 14, T[22]);
              b = GG(b, c, d, a, M_offset_4, 20, T[23]);
              a = GG(a, b, c, d, M_offset_9, 5, T[24]);
              d = GG(d, a, b, c, M_offset_14, 9, T[25]);
              c = GG(c, d, a, b, M_offset_3, 14, T[26]);
              b = GG(b, c, d, a, M_offset_8, 20, T[27]);
              a = GG(a, b, c, d, M_offset_13, 5, T[28]);
              d = GG(d, a, b, c, M_offset_2, 9, T[29]);
              c = GG(c, d, a, b, M_offset_7, 14, T[30]);
              b = GG(b, c, d, a, M_offset_12, 20, T[31]);
              a = HH(a, b, c, d, M_offset_5, 4, T[32]);
              d = HH(d, a, b, c, M_offset_8, 11, T[33]);
              c = HH(c, d, a, b, M_offset_11, 16, T[34]);
              b = HH(b, c, d, a, M_offset_14, 23, T[35]);
              a = HH(a, b, c, d, M_offset_1, 4, T[36]);
              d = HH(d, a, b, c, M_offset_4, 11, T[37]);
              c = HH(c, d, a, b, M_offset_7, 16, T[38]);
              b = HH(b, c, d, a, M_offset_10, 23, T[39]);
              a = HH(a, b, c, d, M_offset_13, 4, T[40]);
              d = HH(d, a, b, c, M_offset_0, 11, T[41]);
              c = HH(c, d, a, b, M_offset_3, 16, T[42]);
              b = HH(b, c, d, a, M_offset_6, 23, T[43]);
              a = HH(a, b, c, d, M_offset_9, 4, T[44]);
              d = HH(d, a, b, c, M_offset_12, 11, T[45]);
              c = HH(c, d, a, b, M_offset_15, 16, T[46]);
              b = HH(b, c, d, a, M_offset_2, 23, T[47]);
              a = II(a, b, c, d, M_offset_0, 6, T[48]);
              d = II(d, a, b, c, M_offset_7, 10, T[49]);
              c = II(c, d, a, b, M_offset_14, 15, T[50]);
              b = II(b, c, d, a, M_offset_5, 21, T[51]);
              a = II(a, b, c, d, M_offset_12, 6, T[52]);
              d = II(d, a, b, c, M_offset_3, 10, T[53]);
              c = II(c, d, a, b, M_offset_10, 15, T[54]);
              b = II(b, c, d, a, M_offset_1, 21, T[55]);
              a = II(a, b, c, d, M_offset_8, 6, T[56]);
              d = II(d, a, b, c, M_offset_15, 10, T[57]);
              c = II(c, d, a, b, M_offset_6, 15, T[58]);
              b = II(b, c, d, a, M_offset_13, 21, T[59]);
              a = II(a, b, c, d, M_offset_4, 6, T[60]);
              d = II(d, a, b, c, M_offset_11, 10, T[61]);
              c = II(c, d, a, b, M_offset_2, 15, T[62]);
              b = II(b, c, d, a, M_offset_9, 21, T[63]);
              H[0] = H[0] + a | 0;
              H[1] = H[1] + b | 0;
              H[2] = H[2] + c | 0;
              H[3] = H[3] + d | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              var nBitsTotalH = Math2.floor(nBitsTotal / 4294967296);
              var nBitsTotalL = nBitsTotal;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = (nBitsTotalH << 8 | nBitsTotalH >>> 24) & 16711935 | (nBitsTotalH << 24 | nBitsTotalH >>> 8) & 4278255360;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotalL << 8 | nBitsTotalL >>> 24) & 16711935 | (nBitsTotalL << 24 | nBitsTotalL >>> 8) & 4278255360;
              data.sigBytes = (dataWords.length + 1) * 4;
              this._process();
              var hash = this._hash;
              var H = hash.words;
              for (var i = 0; i < 4; i++) {
                var H_i = H[i];
                H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
              }
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          function FF(a, b, c, d, x, s, t) {
            var n = a + (b & c | ~b & d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function GG(a, b, c, d, x, s, t) {
            var n = a + (b & d | c & ~d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function HH(a, b, c, d, x, s, t) {
            var n = a + (b ^ c ^ d) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          function II(a, b, c, d, x, s, t) {
            var n = a + (c ^ (b | ~d)) + x + t;
            return (n << s | n >>> 32 - s) + b;
          }
          C.MD5 = Hasher._createHelper(MD5);
          C.HmacMD5 = Hasher._createHmacHelper(MD5);
        })(Math);
        return CryptoJS2.MD5;
      });
    }
  });

  // node_modules/crypto-js/sha1.js
  var require_sha1 = __commonJS({
    "node_modules/crypto-js/sha1.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var W = [];
          var SHA1 = C_algo.SHA1 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                1732584193,
                4023233417,
                2562383102,
                271733878,
                3285377520
              ]);
            },
            _doProcessBlock: function(M, offset) {
              var H = this._hash.words;
              var a = H[0];
              var b = H[1];
              var c = H[2];
              var d = H[3];
              var e = H[4];
              for (var i = 0; i < 80; i++) {
                if (i < 16) {
                  W[i] = M[offset + i] | 0;
                } else {
                  var n = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
                  W[i] = n << 1 | n >>> 31;
                }
                var t = (a << 5 | a >>> 27) + e + W[i];
                if (i < 20) {
                  t += (b & c | ~b & d) + 1518500249;
                } else if (i < 40) {
                  t += (b ^ c ^ d) + 1859775393;
                } else if (i < 60) {
                  t += (b & c | b & d | c & d) - 1894007588;
                } else {
                  t += (b ^ c ^ d) - 899497514;
                }
                e = d;
                d = c;
                c = b << 30 | b >>> 2;
                b = a;
                a = t;
              }
              H[0] = H[0] + a | 0;
              H[1] = H[1] + b | 0;
              H[2] = H[2] + c | 0;
              H[3] = H[3] + d | 0;
              H[4] = H[4] + e | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              return this._hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          C.SHA1 = Hasher._createHelper(SHA1);
          C.HmacSHA1 = Hasher._createHmacHelper(SHA1);
        })();
        return CryptoJS2.SHA1;
      });
    }
  });

  // node_modules/crypto-js/sha256.js
  var require_sha256 = __commonJS({
    "node_modules/crypto-js/sha256.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var H = [];
          var K = [];
          (function() {
            function isPrime(n2) {
              var sqrtN = Math2.sqrt(n2);
              for (var factor = 2; factor <= sqrtN; factor++) {
                if (!(n2 % factor)) {
                  return false;
                }
              }
              return true;
            }
            function getFractionalBits(n2) {
              return (n2 - (n2 | 0)) * 4294967296 | 0;
            }
            var n = 2;
            var nPrime = 0;
            while (nPrime < 64) {
              if (isPrime(n)) {
                if (nPrime < 8) {
                  H[nPrime] = getFractionalBits(Math2.pow(n, 1 / 2));
                }
                K[nPrime] = getFractionalBits(Math2.pow(n, 1 / 3));
                nPrime++;
              }
              n++;
            }
          })();
          var W = [];
          var SHA256 = C_algo.SHA256 = Hasher.extend({
            _doReset: function() {
              this._hash = new WordArray.init(H.slice(0));
            },
            _doProcessBlock: function(M, offset) {
              var H2 = this._hash.words;
              var a = H2[0];
              var b = H2[1];
              var c = H2[2];
              var d = H2[3];
              var e = H2[4];
              var f = H2[5];
              var g = H2[6];
              var h = H2[7];
              for (var i = 0; i < 64; i++) {
                if (i < 16) {
                  W[i] = M[offset + i] | 0;
                } else {
                  var gamma0x = W[i - 15];
                  var gamma0 = (gamma0x << 25 | gamma0x >>> 7) ^ (gamma0x << 14 | gamma0x >>> 18) ^ gamma0x >>> 3;
                  var gamma1x = W[i - 2];
                  var gamma1 = (gamma1x << 15 | gamma1x >>> 17) ^ (gamma1x << 13 | gamma1x >>> 19) ^ gamma1x >>> 10;
                  W[i] = gamma0 + W[i - 7] + gamma1 + W[i - 16];
                }
                var ch = e & f ^ ~e & g;
                var maj = a & b ^ a & c ^ b & c;
                var sigma0 = (a << 30 | a >>> 2) ^ (a << 19 | a >>> 13) ^ (a << 10 | a >>> 22);
                var sigma1 = (e << 26 | e >>> 6) ^ (e << 21 | e >>> 11) ^ (e << 7 | e >>> 25);
                var t1 = h + sigma1 + ch + K[i] + W[i];
                var t2 = sigma0 + maj;
                h = g;
                g = f;
                f = e;
                e = d + t1 | 0;
                d = c;
                c = b;
                b = a;
                a = t1 + t2 | 0;
              }
              H2[0] = H2[0] + a | 0;
              H2[1] = H2[1] + b | 0;
              H2[2] = H2[2] + c | 0;
              H2[3] = H2[3] + d | 0;
              H2[4] = H2[4] + e | 0;
              H2[5] = H2[5] + f | 0;
              H2[6] = H2[6] + g | 0;
              H2[7] = H2[7] + h | 0;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = Math2.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 15] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              return this._hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          C.SHA256 = Hasher._createHelper(SHA256);
          C.HmacSHA256 = Hasher._createHmacHelper(SHA256);
        })(Math);
        return CryptoJS2.SHA256;
      });
    }
  });

  // node_modules/crypto-js/sha224.js
  var require_sha224 = __commonJS({
    "node_modules/crypto-js/sha224.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_sha256());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./sha256"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var SHA256 = C_algo.SHA256;
          var SHA224 = C_algo.SHA224 = SHA256.extend({
            _doReset: function() {
              this._hash = new WordArray.init([
                3238371032,
                914150663,
                812702999,
                4144912697,
                4290775857,
                1750603025,
                1694076839,
                3204075428
              ]);
            },
            _doFinalize: function() {
              var hash = SHA256._doFinalize.call(this);
              hash.sigBytes -= 4;
              return hash;
            }
          });
          C.SHA224 = SHA256._createHelper(SHA224);
          C.HmacSHA224 = SHA256._createHmacHelper(SHA224);
        })();
        return CryptoJS2.SHA224;
      });
    }
  });

  // node_modules/crypto-js/sha512.js
  var require_sha512 = __commonJS({
    "node_modules/crypto-js/sha512.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_x64_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./x64-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Hasher = C_lib.Hasher;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var X64WordArray = C_x64.WordArray;
          var C_algo = C.algo;
          function X64Word_create() {
            return X64Word.create.apply(X64Word, arguments);
          }
          var K = [
            X64Word_create(1116352408, 3609767458),
            X64Word_create(1899447441, 602891725),
            X64Word_create(3049323471, 3964484399),
            X64Word_create(3921009573, 2173295548),
            X64Word_create(961987163, 4081628472),
            X64Word_create(1508970993, 3053834265),
            X64Word_create(2453635748, 2937671579),
            X64Word_create(2870763221, 3664609560),
            X64Word_create(3624381080, 2734883394),
            X64Word_create(310598401, 1164996542),
            X64Word_create(607225278, 1323610764),
            X64Word_create(1426881987, 3590304994),
            X64Word_create(1925078388, 4068182383),
            X64Word_create(2162078206, 991336113),
            X64Word_create(2614888103, 633803317),
            X64Word_create(3248222580, 3479774868),
            X64Word_create(3835390401, 2666613458),
            X64Word_create(4022224774, 944711139),
            X64Word_create(264347078, 2341262773),
            X64Word_create(604807628, 2007800933),
            X64Word_create(770255983, 1495990901),
            X64Word_create(1249150122, 1856431235),
            X64Word_create(1555081692, 3175218132),
            X64Word_create(1996064986, 2198950837),
            X64Word_create(2554220882, 3999719339),
            X64Word_create(2821834349, 766784016),
            X64Word_create(2952996808, 2566594879),
            X64Word_create(3210313671, 3203337956),
            X64Word_create(3336571891, 1034457026),
            X64Word_create(3584528711, 2466948901),
            X64Word_create(113926993, 3758326383),
            X64Word_create(338241895, 168717936),
            X64Word_create(666307205, 1188179964),
            X64Word_create(773529912, 1546045734),
            X64Word_create(1294757372, 1522805485),
            X64Word_create(1396182291, 2643833823),
            X64Word_create(1695183700, 2343527390),
            X64Word_create(1986661051, 1014477480),
            X64Word_create(2177026350, 1206759142),
            X64Word_create(2456956037, 344077627),
            X64Word_create(2730485921, 1290863460),
            X64Word_create(2820302411, 3158454273),
            X64Word_create(3259730800, 3505952657),
            X64Word_create(3345764771, 106217008),
            X64Word_create(3516065817, 3606008344),
            X64Word_create(3600352804, 1432725776),
            X64Word_create(4094571909, 1467031594),
            X64Word_create(275423344, 851169720),
            X64Word_create(430227734, 3100823752),
            X64Word_create(506948616, 1363258195),
            X64Word_create(659060556, 3750685593),
            X64Word_create(883997877, 3785050280),
            X64Word_create(958139571, 3318307427),
            X64Word_create(1322822218, 3812723403),
            X64Word_create(1537002063, 2003034995),
            X64Word_create(1747873779, 3602036899),
            X64Word_create(1955562222, 1575990012),
            X64Word_create(2024104815, 1125592928),
            X64Word_create(2227730452, 2716904306),
            X64Word_create(2361852424, 442776044),
            X64Word_create(2428436474, 593698344),
            X64Word_create(2756734187, 3733110249),
            X64Word_create(3204031479, 2999351573),
            X64Word_create(3329325298, 3815920427),
            X64Word_create(3391569614, 3928383900),
            X64Word_create(3515267271, 566280711),
            X64Word_create(3940187606, 3454069534),
            X64Word_create(4118630271, 4000239992),
            X64Word_create(116418474, 1914138554),
            X64Word_create(174292421, 2731055270),
            X64Word_create(289380356, 3203993006),
            X64Word_create(460393269, 320620315),
            X64Word_create(685471733, 587496836),
            X64Word_create(852142971, 1086792851),
            X64Word_create(1017036298, 365543100),
            X64Word_create(1126000580, 2618297676),
            X64Word_create(1288033470, 3409855158),
            X64Word_create(1501505948, 4234509866),
            X64Word_create(1607167915, 987167468),
            X64Word_create(1816402316, 1246189591)
          ];
          var W = [];
          (function() {
            for (var i = 0; i < 80; i++) {
              W[i] = X64Word_create();
            }
          })();
          var SHA512 = C_algo.SHA512 = Hasher.extend({
            _doReset: function() {
              this._hash = new X64WordArray.init([
                new X64Word.init(1779033703, 4089235720),
                new X64Word.init(3144134277, 2227873595),
                new X64Word.init(1013904242, 4271175723),
                new X64Word.init(2773480762, 1595750129),
                new X64Word.init(1359893119, 2917565137),
                new X64Word.init(2600822924, 725511199),
                new X64Word.init(528734635, 4215389547),
                new X64Word.init(1541459225, 327033209)
              ]);
            },
            _doProcessBlock: function(M, offset) {
              var H = this._hash.words;
              var H0 = H[0];
              var H1 = H[1];
              var H2 = H[2];
              var H3 = H[3];
              var H4 = H[4];
              var H5 = H[5];
              var H6 = H[6];
              var H7 = H[7];
              var H0h = H0.high;
              var H0l = H0.low;
              var H1h = H1.high;
              var H1l = H1.low;
              var H2h = H2.high;
              var H2l = H2.low;
              var H3h = H3.high;
              var H3l = H3.low;
              var H4h = H4.high;
              var H4l = H4.low;
              var H5h = H5.high;
              var H5l = H5.low;
              var H6h = H6.high;
              var H6l = H6.low;
              var H7h = H7.high;
              var H7l = H7.low;
              var ah = H0h;
              var al = H0l;
              var bh = H1h;
              var bl = H1l;
              var ch = H2h;
              var cl = H2l;
              var dh = H3h;
              var dl = H3l;
              var eh = H4h;
              var el = H4l;
              var fh = H5h;
              var fl = H5l;
              var gh = H6h;
              var gl = H6l;
              var hh = H7h;
              var hl = H7l;
              for (var i = 0; i < 80; i++) {
                var Wil;
                var Wih;
                var Wi = W[i];
                if (i < 16) {
                  Wih = Wi.high = M[offset + i * 2] | 0;
                  Wil = Wi.low = M[offset + i * 2 + 1] | 0;
                } else {
                  var gamma0x = W[i - 15];
                  var gamma0xh = gamma0x.high;
                  var gamma0xl = gamma0x.low;
                  var gamma0h = (gamma0xh >>> 1 | gamma0xl << 31) ^ (gamma0xh >>> 8 | gamma0xl << 24) ^ gamma0xh >>> 7;
                  var gamma0l = (gamma0xl >>> 1 | gamma0xh << 31) ^ (gamma0xl >>> 8 | gamma0xh << 24) ^ (gamma0xl >>> 7 | gamma0xh << 25);
                  var gamma1x = W[i - 2];
                  var gamma1xh = gamma1x.high;
                  var gamma1xl = gamma1x.low;
                  var gamma1h = (gamma1xh >>> 19 | gamma1xl << 13) ^ (gamma1xh << 3 | gamma1xl >>> 29) ^ gamma1xh >>> 6;
                  var gamma1l = (gamma1xl >>> 19 | gamma1xh << 13) ^ (gamma1xl << 3 | gamma1xh >>> 29) ^ (gamma1xl >>> 6 | gamma1xh << 26);
                  var Wi7 = W[i - 7];
                  var Wi7h = Wi7.high;
                  var Wi7l = Wi7.low;
                  var Wi16 = W[i - 16];
                  var Wi16h = Wi16.high;
                  var Wi16l = Wi16.low;
                  Wil = gamma0l + Wi7l;
                  Wih = gamma0h + Wi7h + (Wil >>> 0 < gamma0l >>> 0 ? 1 : 0);
                  Wil = Wil + gamma1l;
                  Wih = Wih + gamma1h + (Wil >>> 0 < gamma1l >>> 0 ? 1 : 0);
                  Wil = Wil + Wi16l;
                  Wih = Wih + Wi16h + (Wil >>> 0 < Wi16l >>> 0 ? 1 : 0);
                  Wi.high = Wih;
                  Wi.low = Wil;
                }
                var chh = eh & fh ^ ~eh & gh;
                var chl = el & fl ^ ~el & gl;
                var majh = ah & bh ^ ah & ch ^ bh & ch;
                var majl = al & bl ^ al & cl ^ bl & cl;
                var sigma0h = (ah >>> 28 | al << 4) ^ (ah << 30 | al >>> 2) ^ (ah << 25 | al >>> 7);
                var sigma0l = (al >>> 28 | ah << 4) ^ (al << 30 | ah >>> 2) ^ (al << 25 | ah >>> 7);
                var sigma1h = (eh >>> 14 | el << 18) ^ (eh >>> 18 | el << 14) ^ (eh << 23 | el >>> 9);
                var sigma1l = (el >>> 14 | eh << 18) ^ (el >>> 18 | eh << 14) ^ (el << 23 | eh >>> 9);
                var Ki = K[i];
                var Kih = Ki.high;
                var Kil = Ki.low;
                var t1l = hl + sigma1l;
                var t1h = hh + sigma1h + (t1l >>> 0 < hl >>> 0 ? 1 : 0);
                var t1l = t1l + chl;
                var t1h = t1h + chh + (t1l >>> 0 < chl >>> 0 ? 1 : 0);
                var t1l = t1l + Kil;
                var t1h = t1h + Kih + (t1l >>> 0 < Kil >>> 0 ? 1 : 0);
                var t1l = t1l + Wil;
                var t1h = t1h + Wih + (t1l >>> 0 < Wil >>> 0 ? 1 : 0);
                var t2l = sigma0l + majl;
                var t2h = sigma0h + majh + (t2l >>> 0 < sigma0l >>> 0 ? 1 : 0);
                hh = gh;
                hl = gl;
                gh = fh;
                gl = fl;
                fh = eh;
                fl = el;
                el = dl + t1l | 0;
                eh = dh + t1h + (el >>> 0 < dl >>> 0 ? 1 : 0) | 0;
                dh = ch;
                dl = cl;
                ch = bh;
                cl = bl;
                bh = ah;
                bl = al;
                al = t1l + t2l | 0;
                ah = t1h + t2h + (al >>> 0 < t1l >>> 0 ? 1 : 0) | 0;
              }
              H0l = H0.low = H0l + al;
              H0.high = H0h + ah + (H0l >>> 0 < al >>> 0 ? 1 : 0);
              H1l = H1.low = H1l + bl;
              H1.high = H1h + bh + (H1l >>> 0 < bl >>> 0 ? 1 : 0);
              H2l = H2.low = H2l + cl;
              H2.high = H2h + ch + (H2l >>> 0 < cl >>> 0 ? 1 : 0);
              H3l = H3.low = H3l + dl;
              H3.high = H3h + dh + (H3l >>> 0 < dl >>> 0 ? 1 : 0);
              H4l = H4.low = H4l + el;
              H4.high = H4h + eh + (H4l >>> 0 < el >>> 0 ? 1 : 0);
              H5l = H5.low = H5l + fl;
              H5.high = H5h + fh + (H5l >>> 0 < fl >>> 0 ? 1 : 0);
              H6l = H6.low = H6l + gl;
              H6.high = H6h + gh + (H6l >>> 0 < gl >>> 0 ? 1 : 0);
              H7l = H7.low = H7l + hl;
              H7.high = H7h + hh + (H7l >>> 0 < hl >>> 0 ? 1 : 0);
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 128 >>> 10 << 5) + 30] = Math.floor(nBitsTotal / 4294967296);
              dataWords[(nBitsLeft + 128 >>> 10 << 5) + 31] = nBitsTotal;
              data.sigBytes = dataWords.length * 4;
              this._process();
              var hash = this._hash.toX32();
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            },
            blockSize: 1024 / 32
          });
          C.SHA512 = Hasher._createHelper(SHA512);
          C.HmacSHA512 = Hasher._createHmacHelper(SHA512);
        })();
        return CryptoJS2.SHA512;
      });
    }
  });

  // node_modules/crypto-js/sha384.js
  var require_sha384 = __commonJS({
    "node_modules/crypto-js/sha384.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_x64_core(), require_sha512());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./x64-core", "./sha512"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var X64WordArray = C_x64.WordArray;
          var C_algo = C.algo;
          var SHA512 = C_algo.SHA512;
          var SHA384 = C_algo.SHA384 = SHA512.extend({
            _doReset: function() {
              this._hash = new X64WordArray.init([
                new X64Word.init(3418070365, 3238371032),
                new X64Word.init(1654270250, 914150663),
                new X64Word.init(2438529370, 812702999),
                new X64Word.init(355462360, 4144912697),
                new X64Word.init(1731405415, 4290775857),
                new X64Word.init(2394180231, 1750603025),
                new X64Word.init(3675008525, 1694076839),
                new X64Word.init(1203062813, 3204075428)
              ]);
            },
            _doFinalize: function() {
              var hash = SHA512._doFinalize.call(this);
              hash.sigBytes -= 16;
              return hash;
            }
          });
          C.SHA384 = SHA512._createHelper(SHA384);
          C.HmacSHA384 = SHA512._createHmacHelper(SHA384);
        })();
        return CryptoJS2.SHA384;
      });
    }
  });

  // node_modules/crypto-js/sha3.js
  var require_sha3 = __commonJS({
    "node_modules/crypto-js/sha3.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_x64_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./x64-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_x64 = C.x64;
          var X64Word = C_x64.Word;
          var C_algo = C.algo;
          var RHO_OFFSETS = [];
          var PI_INDEXES = [];
          var ROUND_CONSTANTS = [];
          (function() {
            var x = 1, y = 0;
            for (var t = 0; t < 24; t++) {
              RHO_OFFSETS[x + 5 * y] = (t + 1) * (t + 2) / 2 % 64;
              var newX = y % 5;
              var newY = (2 * x + 3 * y) % 5;
              x = newX;
              y = newY;
            }
            for (var x = 0; x < 5; x++) {
              for (var y = 0; y < 5; y++) {
                PI_INDEXES[x + 5 * y] = y + (2 * x + 3 * y) % 5 * 5;
              }
            }
            var LFSR = 1;
            for (var i = 0; i < 24; i++) {
              var roundConstantMsw = 0;
              var roundConstantLsw = 0;
              for (var j = 0; j < 7; j++) {
                if (LFSR & 1) {
                  var bitPosition = (1 << j) - 1;
                  if (bitPosition < 32) {
                    roundConstantLsw ^= 1 << bitPosition;
                  } else {
                    roundConstantMsw ^= 1 << bitPosition - 32;
                  }
                }
                if (LFSR & 128) {
                  LFSR = LFSR << 1 ^ 113;
                } else {
                  LFSR <<= 1;
                }
              }
              ROUND_CONSTANTS[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
            }
          })();
          var T = [];
          (function() {
            for (var i = 0; i < 25; i++) {
              T[i] = X64Word.create();
            }
          })();
          var SHA3 = C_algo.SHA3 = Hasher.extend({
            /**
             * Configuration options.
             *
             * @property {number} outputLength
             *   The desired number of bits in the output hash.
             *   Only values permitted are: 224, 256, 384, 512.
             *   Default: 512
             */
            cfg: Hasher.cfg.extend({
              outputLength: 512
            }),
            _doReset: function() {
              var state = this._state = [];
              for (var i = 0; i < 25; i++) {
                state[i] = new X64Word.init();
              }
              this.blockSize = (1600 - 2 * this.cfg.outputLength) / 32;
            },
            _doProcessBlock: function(M, offset) {
              var state = this._state;
              var nBlockSizeLanes = this.blockSize / 2;
              for (var i = 0; i < nBlockSizeLanes; i++) {
                var M2i = M[offset + 2 * i];
                var M2i1 = M[offset + 2 * i + 1];
                M2i = (M2i << 8 | M2i >>> 24) & 16711935 | (M2i << 24 | M2i >>> 8) & 4278255360;
                M2i1 = (M2i1 << 8 | M2i1 >>> 24) & 16711935 | (M2i1 << 24 | M2i1 >>> 8) & 4278255360;
                var lane = state[i];
                lane.high ^= M2i1;
                lane.low ^= M2i;
              }
              for (var round = 0; round < 24; round++) {
                for (var x = 0; x < 5; x++) {
                  var tMsw = 0, tLsw = 0;
                  for (var y = 0; y < 5; y++) {
                    var lane = state[x + 5 * y];
                    tMsw ^= lane.high;
                    tLsw ^= lane.low;
                  }
                  var Tx = T[x];
                  Tx.high = tMsw;
                  Tx.low = tLsw;
                }
                for (var x = 0; x < 5; x++) {
                  var Tx4 = T[(x + 4) % 5];
                  var Tx1 = T[(x + 1) % 5];
                  var Tx1Msw = Tx1.high;
                  var Tx1Lsw = Tx1.low;
                  var tMsw = Tx4.high ^ (Tx1Msw << 1 | Tx1Lsw >>> 31);
                  var tLsw = Tx4.low ^ (Tx1Lsw << 1 | Tx1Msw >>> 31);
                  for (var y = 0; y < 5; y++) {
                    var lane = state[x + 5 * y];
                    lane.high ^= tMsw;
                    lane.low ^= tLsw;
                  }
                }
                for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                  var tMsw;
                  var tLsw;
                  var lane = state[laneIndex];
                  var laneMsw = lane.high;
                  var laneLsw = lane.low;
                  var rhoOffset = RHO_OFFSETS[laneIndex];
                  if (rhoOffset < 32) {
                    tMsw = laneMsw << rhoOffset | laneLsw >>> 32 - rhoOffset;
                    tLsw = laneLsw << rhoOffset | laneMsw >>> 32 - rhoOffset;
                  } else {
                    tMsw = laneLsw << rhoOffset - 32 | laneMsw >>> 64 - rhoOffset;
                    tLsw = laneMsw << rhoOffset - 32 | laneLsw >>> 64 - rhoOffset;
                  }
                  var TPiLane = T[PI_INDEXES[laneIndex]];
                  TPiLane.high = tMsw;
                  TPiLane.low = tLsw;
                }
                var T0 = T[0];
                var state0 = state[0];
                T0.high = state0.high;
                T0.low = state0.low;
                for (var x = 0; x < 5; x++) {
                  for (var y = 0; y < 5; y++) {
                    var laneIndex = x + 5 * y;
                    var lane = state[laneIndex];
                    var TLane = T[laneIndex];
                    var Tx1Lane = T[(x + 1) % 5 + 5 * y];
                    var Tx2Lane = T[(x + 2) % 5 + 5 * y];
                    lane.high = TLane.high ^ ~Tx1Lane.high & Tx2Lane.high;
                    lane.low = TLane.low ^ ~Tx1Lane.low & Tx2Lane.low;
                  }
                }
                var lane = state[0];
                var roundConstant = ROUND_CONSTANTS[round];
                lane.high ^= roundConstant.high;
                lane.low ^= roundConstant.low;
              }
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              var blockSizeBits = this.blockSize * 32;
              dataWords[nBitsLeft >>> 5] |= 1 << 24 - nBitsLeft % 32;
              dataWords[(Math2.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits >>> 5) - 1] |= 128;
              data.sigBytes = dataWords.length * 4;
              this._process();
              var state = this._state;
              var outputLengthBytes = this.cfg.outputLength / 8;
              var outputLengthLanes = outputLengthBytes / 8;
              var hashWords = [];
              for (var i = 0; i < outputLengthLanes; i++) {
                var lane = state[i];
                var laneMsw = lane.high;
                var laneLsw = lane.low;
                laneMsw = (laneMsw << 8 | laneMsw >>> 24) & 16711935 | (laneMsw << 24 | laneMsw >>> 8) & 4278255360;
                laneLsw = (laneLsw << 8 | laneLsw >>> 24) & 16711935 | (laneLsw << 24 | laneLsw >>> 8) & 4278255360;
                hashWords.push(laneLsw);
                hashWords.push(laneMsw);
              }
              return new WordArray.init(hashWords, outputLengthBytes);
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              var state = clone._state = this._state.slice(0);
              for (var i = 0; i < 25; i++) {
                state[i] = state[i].clone();
              }
              return clone;
            }
          });
          C.SHA3 = Hasher._createHelper(SHA3);
          C.HmacSHA3 = Hasher._createHmacHelper(SHA3);
        })(Math);
        return CryptoJS2.SHA3;
      });
    }
  });

  // node_modules/crypto-js/ripemd160.js
  var require_ripemd160 = __commonJS({
    "node_modules/crypto-js/ripemd160.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(Math2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var Hasher = C_lib.Hasher;
          var C_algo = C.algo;
          var _zl = WordArray.create([
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
            7,
            4,
            13,
            1,
            10,
            6,
            15,
            3,
            12,
            0,
            9,
            5,
            2,
            14,
            11,
            8,
            3,
            10,
            14,
            4,
            9,
            15,
            8,
            1,
            2,
            7,
            0,
            6,
            13,
            11,
            5,
            12,
            1,
            9,
            11,
            10,
            0,
            8,
            12,
            4,
            13,
            3,
            7,
            15,
            14,
            5,
            6,
            2,
            4,
            0,
            5,
            9,
            7,
            12,
            2,
            10,
            14,
            1,
            3,
            8,
            11,
            6,
            15,
            13
          ]);
          var _zr = WordArray.create([
            5,
            14,
            7,
            0,
            9,
            2,
            11,
            4,
            13,
            6,
            15,
            8,
            1,
            10,
            3,
            12,
            6,
            11,
            3,
            7,
            0,
            13,
            5,
            10,
            14,
            15,
            8,
            12,
            4,
            9,
            1,
            2,
            15,
            5,
            1,
            3,
            7,
            14,
            6,
            9,
            11,
            8,
            12,
            2,
            10,
            0,
            4,
            13,
            8,
            6,
            4,
            1,
            3,
            11,
            15,
            0,
            5,
            12,
            2,
            13,
            9,
            7,
            10,
            14,
            12,
            15,
            10,
            4,
            1,
            5,
            8,
            7,
            6,
            2,
            13,
            14,
            0,
            3,
            9,
            11
          ]);
          var _sl = WordArray.create([
            11,
            14,
            15,
            12,
            5,
            8,
            7,
            9,
            11,
            13,
            14,
            15,
            6,
            7,
            9,
            8,
            7,
            6,
            8,
            13,
            11,
            9,
            7,
            15,
            7,
            12,
            15,
            9,
            11,
            7,
            13,
            12,
            11,
            13,
            6,
            7,
            14,
            9,
            13,
            15,
            14,
            8,
            13,
            6,
            5,
            12,
            7,
            5,
            11,
            12,
            14,
            15,
            14,
            15,
            9,
            8,
            9,
            14,
            5,
            6,
            8,
            6,
            5,
            12,
            9,
            15,
            5,
            11,
            6,
            8,
            13,
            12,
            5,
            12,
            13,
            14,
            11,
            8,
            5,
            6
          ]);
          var _sr = WordArray.create([
            8,
            9,
            9,
            11,
            13,
            15,
            15,
            5,
            7,
            7,
            8,
            11,
            14,
            14,
            12,
            6,
            9,
            13,
            15,
            7,
            12,
            8,
            9,
            11,
            7,
            7,
            12,
            7,
            6,
            15,
            13,
            11,
            9,
            7,
            15,
            11,
            8,
            6,
            6,
            14,
            12,
            13,
            5,
            14,
            13,
            13,
            7,
            5,
            15,
            5,
            8,
            11,
            14,
            14,
            6,
            14,
            6,
            9,
            12,
            9,
            12,
            5,
            15,
            8,
            8,
            5,
            12,
            9,
            12,
            5,
            14,
            6,
            8,
            13,
            6,
            5,
            15,
            13,
            11,
            11
          ]);
          var _hl = WordArray.create([0, 1518500249, 1859775393, 2400959708, 2840853838]);
          var _hr = WordArray.create([1352829926, 1548603684, 1836072691, 2053994217, 0]);
          var RIPEMD160 = C_algo.RIPEMD160 = Hasher.extend({
            _doReset: function() {
              this._hash = WordArray.create([1732584193, 4023233417, 2562383102, 271733878, 3285377520]);
            },
            _doProcessBlock: function(M, offset) {
              for (var i = 0; i < 16; i++) {
                var offset_i = offset + i;
                var M_offset_i = M[offset_i];
                M[offset_i] = (M_offset_i << 8 | M_offset_i >>> 24) & 16711935 | (M_offset_i << 24 | M_offset_i >>> 8) & 4278255360;
              }
              var H = this._hash.words;
              var hl = _hl.words;
              var hr = _hr.words;
              var zl = _zl.words;
              var zr = _zr.words;
              var sl = _sl.words;
              var sr = _sr.words;
              var al, bl, cl, dl, el;
              var ar, br, cr, dr, er;
              ar = al = H[0];
              br = bl = H[1];
              cr = cl = H[2];
              dr = dl = H[3];
              er = el = H[4];
              var t;
              for (var i = 0; i < 80; i += 1) {
                t = al + M[offset + zl[i]] | 0;
                if (i < 16) {
                  t += f1(bl, cl, dl) + hl[0];
                } else if (i < 32) {
                  t += f2(bl, cl, dl) + hl[1];
                } else if (i < 48) {
                  t += f3(bl, cl, dl) + hl[2];
                } else if (i < 64) {
                  t += f4(bl, cl, dl) + hl[3];
                } else {
                  t += f5(bl, cl, dl) + hl[4];
                }
                t = t | 0;
                t = rotl(t, sl[i]);
                t = t + el | 0;
                al = el;
                el = dl;
                dl = rotl(cl, 10);
                cl = bl;
                bl = t;
                t = ar + M[offset + zr[i]] | 0;
                if (i < 16) {
                  t += f5(br, cr, dr) + hr[0];
                } else if (i < 32) {
                  t += f4(br, cr, dr) + hr[1];
                } else if (i < 48) {
                  t += f3(br, cr, dr) + hr[2];
                } else if (i < 64) {
                  t += f2(br, cr, dr) + hr[3];
                } else {
                  t += f1(br, cr, dr) + hr[4];
                }
                t = t | 0;
                t = rotl(t, sr[i]);
                t = t + er | 0;
                ar = er;
                er = dr;
                dr = rotl(cr, 10);
                cr = br;
                br = t;
              }
              t = H[1] + cl + dr | 0;
              H[1] = H[2] + dl + er | 0;
              H[2] = H[3] + el + ar | 0;
              H[3] = H[4] + al + br | 0;
              H[4] = H[0] + bl + cr | 0;
              H[0] = t;
            },
            _doFinalize: function() {
              var data = this._data;
              var dataWords = data.words;
              var nBitsTotal = this._nDataBytes * 8;
              var nBitsLeft = data.sigBytes * 8;
              dataWords[nBitsLeft >>> 5] |= 128 << 24 - nBitsLeft % 32;
              dataWords[(nBitsLeft + 64 >>> 9 << 4) + 14] = (nBitsTotal << 8 | nBitsTotal >>> 24) & 16711935 | (nBitsTotal << 24 | nBitsTotal >>> 8) & 4278255360;
              data.sigBytes = (dataWords.length + 1) * 4;
              this._process();
              var hash = this._hash;
              var H = hash.words;
              for (var i = 0; i < 5; i++) {
                var H_i = H[i];
                H[i] = (H_i << 8 | H_i >>> 24) & 16711935 | (H_i << 24 | H_i >>> 8) & 4278255360;
              }
              return hash;
            },
            clone: function() {
              var clone = Hasher.clone.call(this);
              clone._hash = this._hash.clone();
              return clone;
            }
          });
          function f1(x, y, z) {
            return x ^ y ^ z;
          }
          function f2(x, y, z) {
            return x & y | ~x & z;
          }
          function f3(x, y, z) {
            return (x | ~y) ^ z;
          }
          function f4(x, y, z) {
            return x & z | y & ~z;
          }
          function f5(x, y, z) {
            return x ^ (y | ~z);
          }
          function rotl(x, n) {
            return x << n | x >>> 32 - n;
          }
          C.RIPEMD160 = Hasher._createHelper(RIPEMD160);
          C.HmacRIPEMD160 = Hasher._createHmacHelper(RIPEMD160);
        })(Math);
        return CryptoJS2.RIPEMD160;
      });
    }
  });

  // node_modules/crypto-js/hmac.js
  var require_hmac = __commonJS({
    "node_modules/crypto-js/hmac.js"(exports, module) {
      (function(root, factory) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var C_enc = C.enc;
          var Utf8 = C_enc.Utf8;
          var C_algo = C.algo;
          var HMAC = C_algo.HMAC = Base.extend({
            /**
             * Initializes a newly created HMAC.
             *
             * @param {Hasher} hasher The hash algorithm to use.
             * @param {WordArray|string} key The secret key.
             *
             * @example
             *
             *     var hmacHasher = CryptoJS.algo.HMAC.create(CryptoJS.algo.SHA256, key);
             */
            init: function(hasher, key) {
              hasher = this._hasher = new hasher.init();
              if (typeof key == "string") {
                key = Utf8.parse(key);
              }
              var hasherBlockSize = hasher.blockSize;
              var hasherBlockSizeBytes = hasherBlockSize * 4;
              if (key.sigBytes > hasherBlockSizeBytes) {
                key = hasher.finalize(key);
              }
              key.clamp();
              var oKey = this._oKey = key.clone();
              var iKey = this._iKey = key.clone();
              var oKeyWords = oKey.words;
              var iKeyWords = iKey.words;
              for (var i = 0; i < hasherBlockSize; i++) {
                oKeyWords[i] ^= 1549556828;
                iKeyWords[i] ^= 909522486;
              }
              oKey.sigBytes = iKey.sigBytes = hasherBlockSizeBytes;
              this.reset();
            },
            /**
             * Resets this HMAC to its initial state.
             *
             * @example
             *
             *     hmacHasher.reset();
             */
            reset: function() {
              var hasher = this._hasher;
              hasher.reset();
              hasher.update(this._iKey);
            },
            /**
             * Updates this HMAC with a message.
             *
             * @param {WordArray|string} messageUpdate The message to append.
             *
             * @return {HMAC} This HMAC instance.
             *
             * @example
             *
             *     hmacHasher.update('message');
             *     hmacHasher.update(wordArray);
             */
            update: function(messageUpdate) {
              this._hasher.update(messageUpdate);
              return this;
            },
            /**
             * Finalizes the HMAC computation.
             * Note that the finalize operation is effectively a destructive, read-once operation.
             *
             * @param {WordArray|string} messageUpdate (Optional) A final message update.
             *
             * @return {WordArray} The HMAC.
             *
             * @example
             *
             *     var hmac = hmacHasher.finalize();
             *     var hmac = hmacHasher.finalize('message');
             *     var hmac = hmacHasher.finalize(wordArray);
             */
            finalize: function(messageUpdate) {
              var hasher = this._hasher;
              var innerHash = hasher.finalize(messageUpdate);
              hasher.reset();
              var hmac = hasher.finalize(this._oKey.clone().concat(innerHash));
              return hmac;
            }
          });
        })();
      });
    }
  });

  // node_modules/crypto-js/pbkdf2.js
  var require_pbkdf2 = __commonJS({
    "node_modules/crypto-js/pbkdf2.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_sha256(), require_hmac());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./sha256", "./hmac"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var SHA256 = C_algo.SHA256;
          var HMAC = C_algo.HMAC;
          var PBKDF2 = C_algo.PBKDF2 = Base.extend({
            /**
             * Configuration options.
             *
             * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
             * @property {Hasher} hasher The hasher to use. Default: SHA256
             * @property {number} iterations The number of iterations to perform. Default: 250000
             */
            cfg: Base.extend({
              keySize: 128 / 32,
              hasher: SHA256,
              iterations: 25e4
            }),
            /**
             * Initializes a newly created key derivation function.
             *
             * @param {Object} cfg (Optional) The configuration options to use for the derivation.
             *
             * @example
             *
             *     var kdf = CryptoJS.algo.PBKDF2.create();
             *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8 });
             *     var kdf = CryptoJS.algo.PBKDF2.create({ keySize: 8, iterations: 1000 });
             */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
            },
            /**
             * Computes the Password-Based Key Derivation Function 2.
             *
             * @param {WordArray|string} password The password.
             * @param {WordArray|string} salt A salt.
             *
             * @return {WordArray} The derived key.
             *
             * @example
             *
             *     var key = kdf.compute(password, salt);
             */
            compute: function(password, salt) {
              var cfg = this.cfg;
              var hmac = HMAC.create(cfg.hasher, password);
              var derivedKey = WordArray.create();
              var blockIndex = WordArray.create([1]);
              var derivedKeyWords = derivedKey.words;
              var blockIndexWords = blockIndex.words;
              var keySize = cfg.keySize;
              var iterations = cfg.iterations;
              while (derivedKeyWords.length < keySize) {
                var block = hmac.update(salt).finalize(blockIndex);
                hmac.reset();
                var blockWords = block.words;
                var blockWordsLength = blockWords.length;
                var intermediate = block;
                for (var i = 1; i < iterations; i++) {
                  intermediate = hmac.finalize(intermediate);
                  hmac.reset();
                  var intermediateWords = intermediate.words;
                  for (var j = 0; j < blockWordsLength; j++) {
                    blockWords[j] ^= intermediateWords[j];
                  }
                }
                derivedKey.concat(block);
                blockIndexWords[0]++;
              }
              derivedKey.sigBytes = keySize * 4;
              return derivedKey;
            }
          });
          C.PBKDF2 = function(password, salt, cfg) {
            return PBKDF2.create(cfg).compute(password, salt);
          };
        })();
        return CryptoJS2.PBKDF2;
      });
    }
  });

  // node_modules/crypto-js/evpkdf.js
  var require_evpkdf = __commonJS({
    "node_modules/crypto-js/evpkdf.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_sha1(), require_hmac());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./sha1", "./hmac"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var C_algo = C.algo;
          var MD5 = C_algo.MD5;
          var EvpKDF = C_algo.EvpKDF = Base.extend({
            /**
             * Configuration options.
             *
             * @property {number} keySize The key size in words to generate. Default: 4 (128 bits)
             * @property {Hasher} hasher The hash algorithm to use. Default: MD5
             * @property {number} iterations The number of iterations to perform. Default: 1
             */
            cfg: Base.extend({
              keySize: 128 / 32,
              hasher: MD5,
              iterations: 1
            }),
            /**
             * Initializes a newly created key derivation function.
             *
             * @param {Object} cfg (Optional) The configuration options to use for the derivation.
             *
             * @example
             *
             *     var kdf = CryptoJS.algo.EvpKDF.create();
             *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8 });
             *     var kdf = CryptoJS.algo.EvpKDF.create({ keySize: 8, iterations: 1000 });
             */
            init: function(cfg) {
              this.cfg = this.cfg.extend(cfg);
            },
            /**
             * Derives a key from a password.
             *
             * @param {WordArray|string} password The password.
             * @param {WordArray|string} salt A salt.
             *
             * @return {WordArray} The derived key.
             *
             * @example
             *
             *     var key = kdf.compute(password, salt);
             */
            compute: function(password, salt) {
              var block;
              var cfg = this.cfg;
              var hasher = cfg.hasher.create();
              var derivedKey = WordArray.create();
              var derivedKeyWords = derivedKey.words;
              var keySize = cfg.keySize;
              var iterations = cfg.iterations;
              while (derivedKeyWords.length < keySize) {
                if (block) {
                  hasher.update(block);
                }
                block = hasher.update(password).finalize(salt);
                hasher.reset();
                for (var i = 1; i < iterations; i++) {
                  block = hasher.finalize(block);
                  hasher.reset();
                }
                derivedKey.concat(block);
              }
              derivedKey.sigBytes = keySize * 4;
              return derivedKey;
            }
          });
          C.EvpKDF = function(password, salt, cfg) {
            return EvpKDF.create(cfg).compute(password, salt);
          };
        })();
        return CryptoJS2.EvpKDF;
      });
    }
  });

  // node_modules/crypto-js/cipher-core.js
  var require_cipher_core = __commonJS({
    "node_modules/crypto-js/cipher-core.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_evpkdf());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./evpkdf"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.lib.Cipher || (function(undefined2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var Base = C_lib.Base;
          var WordArray = C_lib.WordArray;
          var BufferedBlockAlgorithm = C_lib.BufferedBlockAlgorithm;
          var C_enc = C.enc;
          var Utf8 = C_enc.Utf8;
          var Base64 = C_enc.Base64;
          var C_algo = C.algo;
          var EvpKDF = C_algo.EvpKDF;
          var Cipher = C_lib.Cipher = BufferedBlockAlgorithm.extend({
            /**
             * Configuration options.
             *
             * @property {WordArray} iv The IV to use for this operation.
             */
            cfg: Base.extend(),
            /**
             * Creates this cipher in encryption mode.
             *
             * @param {WordArray} key The key.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {Cipher} A cipher instance.
             *
             * @static
             *
             * @example
             *
             *     var cipher = CryptoJS.algo.AES.createEncryptor(keyWordArray, { iv: ivWordArray });
             */
            createEncryptor: function(key, cfg) {
              return this.create(this._ENC_XFORM_MODE, key, cfg);
            },
            /**
             * Creates this cipher in decryption mode.
             *
             * @param {WordArray} key The key.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {Cipher} A cipher instance.
             *
             * @static
             *
             * @example
             *
             *     var cipher = CryptoJS.algo.AES.createDecryptor(keyWordArray, { iv: ivWordArray });
             */
            createDecryptor: function(key, cfg) {
              return this.create(this._DEC_XFORM_MODE, key, cfg);
            },
            /**
             * Initializes a newly created cipher.
             *
             * @param {number} xformMode Either the encryption or decryption transormation mode constant.
             * @param {WordArray} key The key.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @example
             *
             *     var cipher = CryptoJS.algo.AES.create(CryptoJS.algo.AES._ENC_XFORM_MODE, keyWordArray, { iv: ivWordArray });
             */
            init: function(xformMode, key, cfg) {
              this.cfg = this.cfg.extend(cfg);
              this._xformMode = xformMode;
              this._key = key;
              this.reset();
            },
            /**
             * Resets this cipher to its initial state.
             *
             * @example
             *
             *     cipher.reset();
             */
            reset: function() {
              BufferedBlockAlgorithm.reset.call(this);
              this._doReset();
            },
            /**
             * Adds data to be encrypted or decrypted.
             *
             * @param {WordArray|string} dataUpdate The data to encrypt or decrypt.
             *
             * @return {WordArray} The data after processing.
             *
             * @example
             *
             *     var encrypted = cipher.process('data');
             *     var encrypted = cipher.process(wordArray);
             */
            process: function(dataUpdate) {
              this._append(dataUpdate);
              return this._process();
            },
            /**
             * Finalizes the encryption or decryption process.
             * Note that the finalize operation is effectively a destructive, read-once operation.
             *
             * @param {WordArray|string} dataUpdate The final data to encrypt or decrypt.
             *
             * @return {WordArray} The data after final processing.
             *
             * @example
             *
             *     var encrypted = cipher.finalize();
             *     var encrypted = cipher.finalize('data');
             *     var encrypted = cipher.finalize(wordArray);
             */
            finalize: function(dataUpdate) {
              if (dataUpdate) {
                this._append(dataUpdate);
              }
              var finalProcessedData = this._doFinalize();
              return finalProcessedData;
            },
            keySize: 128 / 32,
            ivSize: 128 / 32,
            _ENC_XFORM_MODE: 1,
            _DEC_XFORM_MODE: 2,
            /**
             * Creates shortcut functions to a cipher's object interface.
             *
             * @param {Cipher} cipher The cipher to create a helper for.
             *
             * @return {Object} An object with encrypt and decrypt shortcut functions.
             *
             * @static
             *
             * @example
             *
             *     var AES = CryptoJS.lib.Cipher._createHelper(CryptoJS.algo.AES);
             */
            _createHelper: /* @__PURE__ */ (function() {
              function selectCipherStrategy(key) {
                if (typeof key == "string") {
                  return PasswordBasedCipher;
                } else {
                  return SerializableCipher;
                }
              }
              return function(cipher) {
                return {
                  encrypt: function(message, key, cfg) {
                    return selectCipherStrategy(key).encrypt(cipher, message, key, cfg);
                  },
                  decrypt: function(ciphertext, key, cfg) {
                    return selectCipherStrategy(key).decrypt(cipher, ciphertext, key, cfg);
                  }
                };
              };
            })()
          });
          var StreamCipher = C_lib.StreamCipher = Cipher.extend({
            _doFinalize: function() {
              var finalProcessedBlocks = this._process(true);
              return finalProcessedBlocks;
            },
            blockSize: 1
          });
          var C_mode = C.mode = {};
          var BlockCipherMode = C_lib.BlockCipherMode = Base.extend({
            /**
             * Creates this mode for encryption.
             *
             * @param {Cipher} cipher A block cipher instance.
             * @param {Array} iv The IV words.
             *
             * @static
             *
             * @example
             *
             *     var mode = CryptoJS.mode.CBC.createEncryptor(cipher, iv.words);
             */
            createEncryptor: function(cipher, iv2) {
              return this.Encryptor.create(cipher, iv2);
            },
            /**
             * Creates this mode for decryption.
             *
             * @param {Cipher} cipher A block cipher instance.
             * @param {Array} iv The IV words.
             *
             * @static
             *
             * @example
             *
             *     var mode = CryptoJS.mode.CBC.createDecryptor(cipher, iv.words);
             */
            createDecryptor: function(cipher, iv2) {
              return this.Decryptor.create(cipher, iv2);
            },
            /**
             * Initializes a newly created mode.
             *
             * @param {Cipher} cipher A block cipher instance.
             * @param {Array} iv The IV words.
             *
             * @example
             *
             *     var mode = CryptoJS.mode.CBC.Encryptor.create(cipher, iv.words);
             */
            init: function(cipher, iv2) {
              this._cipher = cipher;
              this._iv = iv2;
            }
          });
          var CBC = C_mode.CBC = (function() {
            var CBC2 = BlockCipherMode.extend();
            CBC2.Encryptor = CBC2.extend({
              /**
               * Processes the data block at offset.
               *
               * @param {Array} words The data words to operate on.
               * @param {number} offset The offset where the block starts.
               *
               * @example
               *
               *     mode.processBlock(data.words, offset);
               */
              processBlock: function(words, offset) {
                var cipher = this._cipher;
                var blockSize = cipher.blockSize;
                xorBlock.call(this, words, offset, blockSize);
                cipher.encryptBlock(words, offset);
                this._prevBlock = words.slice(offset, offset + blockSize);
              }
            });
            CBC2.Decryptor = CBC2.extend({
              /**
               * Processes the data block at offset.
               *
               * @param {Array} words The data words to operate on.
               * @param {number} offset The offset where the block starts.
               *
               * @example
               *
               *     mode.processBlock(data.words, offset);
               */
              processBlock: function(words, offset) {
                var cipher = this._cipher;
                var blockSize = cipher.blockSize;
                var thisBlock = words.slice(offset, offset + blockSize);
                cipher.decryptBlock(words, offset);
                xorBlock.call(this, words, offset, blockSize);
                this._prevBlock = thisBlock;
              }
            });
            function xorBlock(words, offset, blockSize) {
              var block;
              var iv2 = this._iv;
              if (iv2) {
                block = iv2;
                this._iv = undefined2;
              } else {
                block = this._prevBlock;
              }
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= block[i];
              }
            }
            return CBC2;
          })();
          var C_pad = C.pad = {};
          var Pkcs7 = C_pad.Pkcs7 = {
            /**
             * Pads data using the algorithm defined in PKCS #5/7.
             *
             * @param {WordArray} data The data to pad.
             * @param {number} blockSize The multiple that the data should be padded to.
             *
             * @static
             *
             * @example
             *
             *     CryptoJS.pad.Pkcs7.pad(wordArray, 4);
             */
            pad: function(data, blockSize) {
              var blockSizeBytes = blockSize * 4;
              var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
              var paddingWord = nPaddingBytes << 24 | nPaddingBytes << 16 | nPaddingBytes << 8 | nPaddingBytes;
              var paddingWords = [];
              for (var i = 0; i < nPaddingBytes; i += 4) {
                paddingWords.push(paddingWord);
              }
              var padding = WordArray.create(paddingWords, nPaddingBytes);
              data.concat(padding);
            },
            /**
             * Unpads data that had been padded using the algorithm defined in PKCS #5/7.
             *
             * @param {WordArray} data The data to unpad.
             *
             * @static
             *
             * @example
             *
             *     CryptoJS.pad.Pkcs7.unpad(wordArray);
             */
            unpad: function(data) {
              var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
              data.sigBytes -= nPaddingBytes;
            }
          };
          var BlockCipher = C_lib.BlockCipher = Cipher.extend({
            /**
             * Configuration options.
             *
             * @property {Mode} mode The block mode to use. Default: CBC
             * @property {Padding} padding The padding strategy to use. Default: Pkcs7
             */
            cfg: Cipher.cfg.extend({
              mode: CBC,
              padding: Pkcs7
            }),
            reset: function() {
              var modeCreator;
              Cipher.reset.call(this);
              var cfg = this.cfg;
              var iv2 = cfg.iv;
              var mode = cfg.mode;
              if (this._xformMode == this._ENC_XFORM_MODE) {
                modeCreator = mode.createEncryptor;
              } else {
                modeCreator = mode.createDecryptor;
                this._minBufferSize = 1;
              }
              if (this._mode && this._mode.__creator == modeCreator) {
                this._mode.init(this, iv2 && iv2.words);
              } else {
                this._mode = modeCreator.call(mode, this, iv2 && iv2.words);
                this._mode.__creator = modeCreator;
              }
            },
            _doProcessBlock: function(words, offset) {
              this._mode.processBlock(words, offset);
            },
            _doFinalize: function() {
              var finalProcessedBlocks;
              var padding = this.cfg.padding;
              if (this._xformMode == this._ENC_XFORM_MODE) {
                padding.pad(this._data, this.blockSize);
                finalProcessedBlocks = this._process(true);
              } else {
                finalProcessedBlocks = this._process(true);
                padding.unpad(finalProcessedBlocks);
              }
              return finalProcessedBlocks;
            },
            blockSize: 128 / 32
          });
          var CipherParams = C_lib.CipherParams = Base.extend({
            /**
             * Initializes a newly created cipher params object.
             *
             * @param {Object} cipherParams An object with any of the possible cipher parameters.
             *
             * @example
             *
             *     var cipherParams = CryptoJS.lib.CipherParams.create({
             *         ciphertext: ciphertextWordArray,
             *         key: keyWordArray,
             *         iv: ivWordArray,
             *         salt: saltWordArray,
             *         algorithm: CryptoJS.algo.AES,
             *         mode: CryptoJS.mode.CBC,
             *         padding: CryptoJS.pad.PKCS7,
             *         blockSize: 4,
             *         formatter: CryptoJS.format.OpenSSL
             *     });
             */
            init: function(cipherParams) {
              this.mixIn(cipherParams);
            },
            /**
             * Converts this cipher params object to a string.
             *
             * @param {Format} formatter (Optional) The formatting strategy to use.
             *
             * @return {string} The stringified cipher params.
             *
             * @throws Error If neither the formatter nor the default formatter is set.
             *
             * @example
             *
             *     var string = cipherParams + '';
             *     var string = cipherParams.toString();
             *     var string = cipherParams.toString(CryptoJS.format.OpenSSL);
             */
            toString: function(formatter) {
              return (formatter || this.formatter).stringify(this);
            }
          });
          var C_format = C.format = {};
          var OpenSSLFormatter = C_format.OpenSSL = {
            /**
             * Converts a cipher params object to an OpenSSL-compatible string.
             *
             * @param {CipherParams} cipherParams The cipher params object.
             *
             * @return {string} The OpenSSL-compatible string.
             *
             * @static
             *
             * @example
             *
             *     var openSSLString = CryptoJS.format.OpenSSL.stringify(cipherParams);
             */
            stringify: function(cipherParams) {
              var wordArray;
              var ciphertext = cipherParams.ciphertext;
              var salt = cipherParams.salt;
              if (salt) {
                wordArray = WordArray.create([1398893684, 1701076831]).concat(salt).concat(ciphertext);
              } else {
                wordArray = ciphertext;
              }
              return wordArray.toString(Base64);
            },
            /**
             * Converts an OpenSSL-compatible string to a cipher params object.
             *
             * @param {string} openSSLStr The OpenSSL-compatible string.
             *
             * @return {CipherParams} The cipher params object.
             *
             * @static
             *
             * @example
             *
             *     var cipherParams = CryptoJS.format.OpenSSL.parse(openSSLString);
             */
            parse: function(openSSLStr) {
              var salt;
              var ciphertext = Base64.parse(openSSLStr);
              var ciphertextWords = ciphertext.words;
              if (ciphertextWords[0] == 1398893684 && ciphertextWords[1] == 1701076831) {
                salt = WordArray.create(ciphertextWords.slice(2, 4));
                ciphertextWords.splice(0, 4);
                ciphertext.sigBytes -= 16;
              }
              return CipherParams.create({ ciphertext, salt });
            }
          };
          var SerializableCipher = C_lib.SerializableCipher = Base.extend({
            /**
             * Configuration options.
             *
             * @property {Formatter} format The formatting strategy to convert cipher param objects to and from a string. Default: OpenSSL
             */
            cfg: Base.extend({
              format: OpenSSLFormatter
            }),
            /**
             * Encrypts a message.
             *
             * @param {Cipher} cipher The cipher algorithm to use.
             * @param {WordArray|string} message The message to encrypt.
             * @param {WordArray} key The key.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {CipherParams} A cipher params object.
             *
             * @static
             *
             * @example
             *
             *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key);
             *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv });
             *     var ciphertextParams = CryptoJS.lib.SerializableCipher.encrypt(CryptoJS.algo.AES, message, key, { iv: iv, format: CryptoJS.format.OpenSSL });
             */
            encrypt: function(cipher, message, key, cfg) {
              cfg = this.cfg.extend(cfg);
              var encryptor = cipher.createEncryptor(key, cfg);
              var ciphertext = encryptor.finalize(message);
              var cipherCfg = encryptor.cfg;
              return CipherParams.create({
                ciphertext,
                key,
                iv: cipherCfg.iv,
                algorithm: cipher,
                mode: cipherCfg.mode,
                padding: cipherCfg.padding,
                blockSize: cipher.blockSize,
                formatter: cfg.format
              });
            },
            /**
             * Decrypts serialized ciphertext.
             *
             * @param {Cipher} cipher The cipher algorithm to use.
             * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
             * @param {WordArray} key The key.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {WordArray} The plaintext.
             *
             * @static
             *
             * @example
             *
             *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, key, { iv: iv, format: CryptoJS.format.OpenSSL });
             *     var plaintext = CryptoJS.lib.SerializableCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, key, { iv: iv, format: CryptoJS.format.OpenSSL });
             */
            decrypt: function(cipher, ciphertext, key, cfg) {
              cfg = this.cfg.extend(cfg);
              ciphertext = this._parse(ciphertext, cfg.format);
              var plaintext = cipher.createDecryptor(key, cfg).finalize(ciphertext.ciphertext);
              return plaintext;
            },
            /**
             * Converts serialized ciphertext to CipherParams,
             * else assumed CipherParams already and returns ciphertext unchanged.
             *
             * @param {CipherParams|string} ciphertext The ciphertext.
             * @param {Formatter} format The formatting strategy to use to parse serialized ciphertext.
             *
             * @return {CipherParams} The unserialized ciphertext.
             *
             * @static
             *
             * @example
             *
             *     var ciphertextParams = CryptoJS.lib.SerializableCipher._parse(ciphertextStringOrParams, format);
             */
            _parse: function(ciphertext, format) {
              if (typeof ciphertext == "string") {
                return format.parse(ciphertext, this);
              } else {
                return ciphertext;
              }
            }
          });
          var C_kdf = C.kdf = {};
          var OpenSSLKdf = C_kdf.OpenSSL = {
            /**
             * Derives a key and IV from a password.
             *
             * @param {string} password The password to derive from.
             * @param {number} keySize The size in words of the key to generate.
             * @param {number} ivSize The size in words of the IV to generate.
             * @param {WordArray|string} salt (Optional) A 64-bit salt to use. If omitted, a salt will be generated randomly.
             *
             * @return {CipherParams} A cipher params object with the key, IV, and salt.
             *
             * @static
             *
             * @example
             *
             *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32);
             *     var derivedParams = CryptoJS.kdf.OpenSSL.execute('Password', 256/32, 128/32, 'saltsalt');
             */
            execute: function(password, keySize, ivSize, salt, hasher) {
              if (!salt) {
                salt = WordArray.random(64 / 8);
              }
              if (!hasher) {
                var key = EvpKDF.create({ keySize: keySize + ivSize }).compute(password, salt);
              } else {
                var key = EvpKDF.create({ keySize: keySize + ivSize, hasher }).compute(password, salt);
              }
              var iv2 = WordArray.create(key.words.slice(keySize), ivSize * 4);
              key.sigBytes = keySize * 4;
              return CipherParams.create({ key, iv: iv2, salt });
            }
          };
          var PasswordBasedCipher = C_lib.PasswordBasedCipher = SerializableCipher.extend({
            /**
             * Configuration options.
             *
             * @property {KDF} kdf The key derivation function to use to generate a key and IV from a password. Default: OpenSSL
             */
            cfg: SerializableCipher.cfg.extend({
              kdf: OpenSSLKdf
            }),
            /**
             * Encrypts a message using a password.
             *
             * @param {Cipher} cipher The cipher algorithm to use.
             * @param {WordArray|string} message The message to encrypt.
             * @param {string} password The password.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {CipherParams} A cipher params object.
             *
             * @static
             *
             * @example
             *
             *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password');
             *     var ciphertextParams = CryptoJS.lib.PasswordBasedCipher.encrypt(CryptoJS.algo.AES, message, 'password', { format: CryptoJS.format.OpenSSL });
             */
            encrypt: function(cipher, message, password, cfg) {
              cfg = this.cfg.extend(cfg);
              var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, cfg.salt, cfg.hasher);
              cfg.iv = derivedParams.iv;
              var ciphertext = SerializableCipher.encrypt.call(this, cipher, message, derivedParams.key, cfg);
              ciphertext.mixIn(derivedParams);
              return ciphertext;
            },
            /**
             * Decrypts serialized ciphertext using a password.
             *
             * @param {Cipher} cipher The cipher algorithm to use.
             * @param {CipherParams|string} ciphertext The ciphertext to decrypt.
             * @param {string} password The password.
             * @param {Object} cfg (Optional) The configuration options to use for this operation.
             *
             * @return {WordArray} The plaintext.
             *
             * @static
             *
             * @example
             *
             *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, formattedCiphertext, 'password', { format: CryptoJS.format.OpenSSL });
             *     var plaintext = CryptoJS.lib.PasswordBasedCipher.decrypt(CryptoJS.algo.AES, ciphertextParams, 'password', { format: CryptoJS.format.OpenSSL });
             */
            decrypt: function(cipher, ciphertext, password, cfg) {
              cfg = this.cfg.extend(cfg);
              ciphertext = this._parse(ciphertext, cfg.format);
              var derivedParams = cfg.kdf.execute(password, cipher.keySize, cipher.ivSize, ciphertext.salt, cfg.hasher);
              cfg.iv = derivedParams.iv;
              var plaintext = SerializableCipher.decrypt.call(this, cipher, ciphertext, derivedParams.key, cfg);
              return plaintext;
            }
          });
        })();
      });
    }
  });

  // node_modules/crypto-js/mode-cfb.js
  var require_mode_cfb = __commonJS({
    "node_modules/crypto-js/mode-cfb.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.mode.CFB = (function() {
          var CFB = CryptoJS2.lib.BlockCipherMode.extend();
          CFB.Encryptor = CFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
              this._prevBlock = words.slice(offset, offset + blockSize);
            }
          });
          CFB.Decryptor = CFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var thisBlock = words.slice(offset, offset + blockSize);
              generateKeystreamAndEncrypt.call(this, words, offset, blockSize, cipher);
              this._prevBlock = thisBlock;
            }
          });
          function generateKeystreamAndEncrypt(words, offset, blockSize, cipher) {
            var keystream;
            var iv2 = this._iv;
            if (iv2) {
              keystream = iv2.slice(0);
              this._iv = void 0;
            } else {
              keystream = this._prevBlock;
            }
            cipher.encryptBlock(keystream, 0);
            for (var i = 0; i < blockSize; i++) {
              words[offset + i] ^= keystream[i];
            }
          }
          return CFB;
        })();
        return CryptoJS2.mode.CFB;
      });
    }
  });

  // node_modules/crypto-js/mode-ctr.js
  var require_mode_ctr = __commonJS({
    "node_modules/crypto-js/mode-ctr.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.mode.CTR = (function() {
          var CTR = CryptoJS2.lib.BlockCipherMode.extend();
          var Encryptor = CTR.Encryptor = CTR.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv2 = this._iv;
              var counter = this._counter;
              if (iv2) {
                counter = this._counter = iv2.slice(0);
                this._iv = void 0;
              }
              var keystream = counter.slice(0);
              cipher.encryptBlock(keystream, 0);
              counter[blockSize - 1] = counter[blockSize - 1] + 1 | 0;
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          CTR.Decryptor = Encryptor;
          return CTR;
        })();
        return CryptoJS2.mode.CTR;
      });
    }
  });

  // node_modules/crypto-js/mode-ctr-gladman.js
  var require_mode_ctr_gladman = __commonJS({
    "node_modules/crypto-js/mode-ctr-gladman.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.mode.CTRGladman = (function() {
          var CTRGladman = CryptoJS2.lib.BlockCipherMode.extend();
          function incWord(word) {
            if ((word >> 24 & 255) === 255) {
              var b1 = word >> 16 & 255;
              var b2 = word >> 8 & 255;
              var b3 = word & 255;
              if (b1 === 255) {
                b1 = 0;
                if (b2 === 255) {
                  b2 = 0;
                  if (b3 === 255) {
                    b3 = 0;
                  } else {
                    ++b3;
                  }
                } else {
                  ++b2;
                }
              } else {
                ++b1;
              }
              word = 0;
              word += b1 << 16;
              word += b2 << 8;
              word += b3;
            } else {
              word += 1 << 24;
            }
            return word;
          }
          function incCounter(counter) {
            if ((counter[0] = incWord(counter[0])) === 0) {
              counter[1] = incWord(counter[1]);
            }
            return counter;
          }
          var Encryptor = CTRGladman.Encryptor = CTRGladman.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv2 = this._iv;
              var counter = this._counter;
              if (iv2) {
                counter = this._counter = iv2.slice(0);
                this._iv = void 0;
              }
              incCounter(counter);
              var keystream = counter.slice(0);
              cipher.encryptBlock(keystream, 0);
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          CTRGladman.Decryptor = Encryptor;
          return CTRGladman;
        })();
        return CryptoJS2.mode.CTRGladman;
      });
    }
  });

  // node_modules/crypto-js/mode-ofb.js
  var require_mode_ofb = __commonJS({
    "node_modules/crypto-js/mode-ofb.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.mode.OFB = (function() {
          var OFB = CryptoJS2.lib.BlockCipherMode.extend();
          var Encryptor = OFB.Encryptor = OFB.extend({
            processBlock: function(words, offset) {
              var cipher = this._cipher;
              var blockSize = cipher.blockSize;
              var iv2 = this._iv;
              var keystream = this._keystream;
              if (iv2) {
                keystream = this._keystream = iv2.slice(0);
                this._iv = void 0;
              }
              cipher.encryptBlock(keystream, 0);
              for (var i = 0; i < blockSize; i++) {
                words[offset + i] ^= keystream[i];
              }
            }
          });
          OFB.Decryptor = Encryptor;
          return OFB;
        })();
        return CryptoJS2.mode.OFB;
      });
    }
  });

  // node_modules/crypto-js/mode-ecb.js
  var require_mode_ecb = __commonJS({
    "node_modules/crypto-js/mode-ecb.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.mode.ECB = (function() {
          var ECB = CryptoJS2.lib.BlockCipherMode.extend();
          ECB.Encryptor = ECB.extend({
            processBlock: function(words, offset) {
              this._cipher.encryptBlock(words, offset);
            }
          });
          ECB.Decryptor = ECB.extend({
            processBlock: function(words, offset) {
              this._cipher.decryptBlock(words, offset);
            }
          });
          return ECB;
        })();
        return CryptoJS2.mode.ECB;
      });
    }
  });

  // node_modules/crypto-js/pad-ansix923.js
  var require_pad_ansix923 = __commonJS({
    "node_modules/crypto-js/pad-ansix923.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.pad.AnsiX923 = {
          pad: function(data, blockSize) {
            var dataSigBytes = data.sigBytes;
            var blockSizeBytes = blockSize * 4;
            var nPaddingBytes = blockSizeBytes - dataSigBytes % blockSizeBytes;
            var lastBytePos = dataSigBytes + nPaddingBytes - 1;
            data.clamp();
            data.words[lastBytePos >>> 2] |= nPaddingBytes << 24 - lastBytePos % 4 * 8;
            data.sigBytes += nPaddingBytes;
          },
          unpad: function(data) {
            var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
            data.sigBytes -= nPaddingBytes;
          }
        };
        return CryptoJS2.pad.Ansix923;
      });
    }
  });

  // node_modules/crypto-js/pad-iso10126.js
  var require_pad_iso10126 = __commonJS({
    "node_modules/crypto-js/pad-iso10126.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.pad.Iso10126 = {
          pad: function(data, blockSize) {
            var blockSizeBytes = blockSize * 4;
            var nPaddingBytes = blockSizeBytes - data.sigBytes % blockSizeBytes;
            data.concat(CryptoJS2.lib.WordArray.random(nPaddingBytes - 1)).concat(CryptoJS2.lib.WordArray.create([nPaddingBytes << 24], 1));
          },
          unpad: function(data) {
            var nPaddingBytes = data.words[data.sigBytes - 1 >>> 2] & 255;
            data.sigBytes -= nPaddingBytes;
          }
        };
        return CryptoJS2.pad.Iso10126;
      });
    }
  });

  // node_modules/crypto-js/pad-iso97971.js
  var require_pad_iso97971 = __commonJS({
    "node_modules/crypto-js/pad-iso97971.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.pad.Iso97971 = {
          pad: function(data, blockSize) {
            data.concat(CryptoJS2.lib.WordArray.create([2147483648], 1));
            CryptoJS2.pad.ZeroPadding.pad(data, blockSize);
          },
          unpad: function(data) {
            CryptoJS2.pad.ZeroPadding.unpad(data);
            data.sigBytes--;
          }
        };
        return CryptoJS2.pad.Iso97971;
      });
    }
  });

  // node_modules/crypto-js/pad-zeropadding.js
  var require_pad_zeropadding = __commonJS({
    "node_modules/crypto-js/pad-zeropadding.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.pad.ZeroPadding = {
          pad: function(data, blockSize) {
            var blockSizeBytes = blockSize * 4;
            data.clamp();
            data.sigBytes += blockSizeBytes - (data.sigBytes % blockSizeBytes || blockSizeBytes);
          },
          unpad: function(data) {
            var dataWords = data.words;
            var i = data.sigBytes - 1;
            for (var i = data.sigBytes - 1; i >= 0; i--) {
              if (dataWords[i >>> 2] >>> 24 - i % 4 * 8 & 255) {
                data.sigBytes = i + 1;
                break;
              }
            }
          }
        };
        return CryptoJS2.pad.ZeroPadding;
      });
    }
  });

  // node_modules/crypto-js/pad-nopadding.js
  var require_pad_nopadding = __commonJS({
    "node_modules/crypto-js/pad-nopadding.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        CryptoJS2.pad.NoPadding = {
          pad: function() {
          },
          unpad: function() {
          }
        };
        return CryptoJS2.pad.NoPadding;
      });
    }
  });

  // node_modules/crypto-js/format-hex.js
  var require_format_hex = __commonJS({
    "node_modules/crypto-js/format-hex.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function(undefined2) {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var CipherParams = C_lib.CipherParams;
          var C_enc = C.enc;
          var Hex = C_enc.Hex;
          var C_format = C.format;
          var HexFormatter = C_format.Hex = {
            /**
             * Converts the ciphertext of a cipher params object to a hexadecimally encoded string.
             *
             * @param {CipherParams} cipherParams The cipher params object.
             *
             * @return {string} The hexadecimally encoded string.
             *
             * @static
             *
             * @example
             *
             *     var hexString = CryptoJS.format.Hex.stringify(cipherParams);
             */
            stringify: function(cipherParams) {
              return cipherParams.ciphertext.toString(Hex);
            },
            /**
             * Converts a hexadecimally encoded ciphertext string to a cipher params object.
             *
             * @param {string} input The hexadecimally encoded string.
             *
             * @return {CipherParams} The cipher params object.
             *
             * @static
             *
             * @example
             *
             *     var cipherParams = CryptoJS.format.Hex.parse(hexString);
             */
            parse: function(input) {
              var ciphertext = Hex.parse(input);
              return CipherParams.create({ ciphertext });
            }
          };
        })();
        return CryptoJS2.format.Hex;
      });
    }
  });

  // node_modules/crypto-js/aes.js
  var require_aes = __commonJS({
    "node_modules/crypto-js/aes.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          var SBOX = [];
          var INV_SBOX = [];
          var SUB_MIX_0 = [];
          var SUB_MIX_1 = [];
          var SUB_MIX_2 = [];
          var SUB_MIX_3 = [];
          var INV_SUB_MIX_0 = [];
          var INV_SUB_MIX_1 = [];
          var INV_SUB_MIX_2 = [];
          var INV_SUB_MIX_3 = [];
          (function() {
            var d = [];
            for (var i = 0; i < 256; i++) {
              if (i < 128) {
                d[i] = i << 1;
              } else {
                d[i] = i << 1 ^ 283;
              }
            }
            var x = 0;
            var xi = 0;
            for (var i = 0; i < 256; i++) {
              var sx = xi ^ xi << 1 ^ xi << 2 ^ xi << 3 ^ xi << 4;
              sx = sx >>> 8 ^ sx & 255 ^ 99;
              SBOX[x] = sx;
              INV_SBOX[sx] = x;
              var x2 = d[x];
              var x4 = d[x2];
              var x8 = d[x4];
              var t = d[sx] * 257 ^ sx * 16843008;
              SUB_MIX_0[x] = t << 24 | t >>> 8;
              SUB_MIX_1[x] = t << 16 | t >>> 16;
              SUB_MIX_2[x] = t << 8 | t >>> 24;
              SUB_MIX_3[x] = t;
              var t = x8 * 16843009 ^ x4 * 65537 ^ x2 * 257 ^ x * 16843008;
              INV_SUB_MIX_0[sx] = t << 24 | t >>> 8;
              INV_SUB_MIX_1[sx] = t << 16 | t >>> 16;
              INV_SUB_MIX_2[sx] = t << 8 | t >>> 24;
              INV_SUB_MIX_3[sx] = t;
              if (!x) {
                x = xi = 1;
              } else {
                x = x2 ^ d[d[d[x8 ^ x2]]];
                xi ^= d[d[xi]];
              }
            }
          })();
          var RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
          var AES = C_algo.AES = BlockCipher.extend({
            _doReset: function() {
              var t;
              if (this._nRounds && this._keyPriorReset === this._key) {
                return;
              }
              var key = this._keyPriorReset = this._key;
              var keyWords = key.words;
              var keySize = key.sigBytes / 4;
              var nRounds = this._nRounds = keySize + 6;
              var ksRows = (nRounds + 1) * 4;
              var keySchedule = this._keySchedule = [];
              for (var ksRow = 0; ksRow < ksRows; ksRow++) {
                if (ksRow < keySize) {
                  keySchedule[ksRow] = keyWords[ksRow];
                } else {
                  t = keySchedule[ksRow - 1];
                  if (!(ksRow % keySize)) {
                    t = t << 8 | t >>> 24;
                    t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                    t ^= RCON[ksRow / keySize | 0] << 24;
                  } else if (keySize > 6 && ksRow % keySize == 4) {
                    t = SBOX[t >>> 24] << 24 | SBOX[t >>> 16 & 255] << 16 | SBOX[t >>> 8 & 255] << 8 | SBOX[t & 255];
                  }
                  keySchedule[ksRow] = keySchedule[ksRow - keySize] ^ t;
                }
              }
              var invKeySchedule = this._invKeySchedule = [];
              for (var invKsRow = 0; invKsRow < ksRows; invKsRow++) {
                var ksRow = ksRows - invKsRow;
                if (invKsRow % 4) {
                  var t = keySchedule[ksRow];
                } else {
                  var t = keySchedule[ksRow - 4];
                }
                if (invKsRow < 4 || ksRow <= 4) {
                  invKeySchedule[invKsRow] = t;
                } else {
                  invKeySchedule[invKsRow] = INV_SUB_MIX_0[SBOX[t >>> 24]] ^ INV_SUB_MIX_1[SBOX[t >>> 16 & 255]] ^ INV_SUB_MIX_2[SBOX[t >>> 8 & 255]] ^ INV_SUB_MIX_3[SBOX[t & 255]];
                }
              }
            },
            encryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._keySchedule, SUB_MIX_0, SUB_MIX_1, SUB_MIX_2, SUB_MIX_3, SBOX);
            },
            decryptBlock: function(M, offset) {
              var t = M[offset + 1];
              M[offset + 1] = M[offset + 3];
              M[offset + 3] = t;
              this._doCryptBlock(M, offset, this._invKeySchedule, INV_SUB_MIX_0, INV_SUB_MIX_1, INV_SUB_MIX_2, INV_SUB_MIX_3, INV_SBOX);
              var t = M[offset + 1];
              M[offset + 1] = M[offset + 3];
              M[offset + 3] = t;
            },
            _doCryptBlock: function(M, offset, keySchedule, SUB_MIX_02, SUB_MIX_12, SUB_MIX_22, SUB_MIX_32, SBOX2) {
              var nRounds = this._nRounds;
              var s0 = M[offset] ^ keySchedule[0];
              var s1 = M[offset + 1] ^ keySchedule[1];
              var s2 = M[offset + 2] ^ keySchedule[2];
              var s3 = M[offset + 3] ^ keySchedule[3];
              var ksRow = 4;
              for (var round = 1; round < nRounds; round++) {
                var t0 = SUB_MIX_02[s0 >>> 24] ^ SUB_MIX_12[s1 >>> 16 & 255] ^ SUB_MIX_22[s2 >>> 8 & 255] ^ SUB_MIX_32[s3 & 255] ^ keySchedule[ksRow++];
                var t1 = SUB_MIX_02[s1 >>> 24] ^ SUB_MIX_12[s2 >>> 16 & 255] ^ SUB_MIX_22[s3 >>> 8 & 255] ^ SUB_MIX_32[s0 & 255] ^ keySchedule[ksRow++];
                var t2 = SUB_MIX_02[s2 >>> 24] ^ SUB_MIX_12[s3 >>> 16 & 255] ^ SUB_MIX_22[s0 >>> 8 & 255] ^ SUB_MIX_32[s1 & 255] ^ keySchedule[ksRow++];
                var t3 = SUB_MIX_02[s3 >>> 24] ^ SUB_MIX_12[s0 >>> 16 & 255] ^ SUB_MIX_22[s1 >>> 8 & 255] ^ SUB_MIX_32[s2 & 255] ^ keySchedule[ksRow++];
                s0 = t0;
                s1 = t1;
                s2 = t2;
                s3 = t3;
              }
              var t0 = (SBOX2[s0 >>> 24] << 24 | SBOX2[s1 >>> 16 & 255] << 16 | SBOX2[s2 >>> 8 & 255] << 8 | SBOX2[s3 & 255]) ^ keySchedule[ksRow++];
              var t1 = (SBOX2[s1 >>> 24] << 24 | SBOX2[s2 >>> 16 & 255] << 16 | SBOX2[s3 >>> 8 & 255] << 8 | SBOX2[s0 & 255]) ^ keySchedule[ksRow++];
              var t2 = (SBOX2[s2 >>> 24] << 24 | SBOX2[s3 >>> 16 & 255] << 16 | SBOX2[s0 >>> 8 & 255] << 8 | SBOX2[s1 & 255]) ^ keySchedule[ksRow++];
              var t3 = (SBOX2[s3 >>> 24] << 24 | SBOX2[s0 >>> 16 & 255] << 16 | SBOX2[s1 >>> 8 & 255] << 8 | SBOX2[s2 & 255]) ^ keySchedule[ksRow++];
              M[offset] = t0;
              M[offset + 1] = t1;
              M[offset + 2] = t2;
              M[offset + 3] = t3;
            },
            keySize: 256 / 32
          });
          C.AES = BlockCipher._createHelper(AES);
        })();
        return CryptoJS2.AES;
      });
    }
  });

  // node_modules/crypto-js/tripledes.js
  var require_tripledes = __commonJS({
    "node_modules/crypto-js/tripledes.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var WordArray = C_lib.WordArray;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          var PC1 = [
            57,
            49,
            41,
            33,
            25,
            17,
            9,
            1,
            58,
            50,
            42,
            34,
            26,
            18,
            10,
            2,
            59,
            51,
            43,
            35,
            27,
            19,
            11,
            3,
            60,
            52,
            44,
            36,
            63,
            55,
            47,
            39,
            31,
            23,
            15,
            7,
            62,
            54,
            46,
            38,
            30,
            22,
            14,
            6,
            61,
            53,
            45,
            37,
            29,
            21,
            13,
            5,
            28,
            20,
            12,
            4
          ];
          var PC2 = [
            14,
            17,
            11,
            24,
            1,
            5,
            3,
            28,
            15,
            6,
            21,
            10,
            23,
            19,
            12,
            4,
            26,
            8,
            16,
            7,
            27,
            20,
            13,
            2,
            41,
            52,
            31,
            37,
            47,
            55,
            30,
            40,
            51,
            45,
            33,
            48,
            44,
            49,
            39,
            56,
            34,
            53,
            46,
            42,
            50,
            36,
            29,
            32
          ];
          var BIT_SHIFTS = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];
          var SBOX_P = [
            {
              0: 8421888,
              268435456: 32768,
              536870912: 8421378,
              805306368: 2,
              1073741824: 512,
              1342177280: 8421890,
              1610612736: 8389122,
              1879048192: 8388608,
              2147483648: 514,
              2415919104: 8389120,
              2684354560: 33280,
              2952790016: 8421376,
              3221225472: 32770,
              3489660928: 8388610,
              3758096384: 0,
              4026531840: 33282,
              134217728: 0,
              402653184: 8421890,
              671088640: 33282,
              939524096: 32768,
              1207959552: 8421888,
              1476395008: 512,
              1744830464: 8421378,
              2013265920: 2,
              2281701376: 8389120,
              2550136832: 33280,
              2818572288: 8421376,
              3087007744: 8389122,
              3355443200: 8388610,
              3623878656: 32770,
              3892314112: 514,
              4160749568: 8388608,
              1: 32768,
              268435457: 2,
              536870913: 8421888,
              805306369: 8388608,
              1073741825: 8421378,
              1342177281: 33280,
              1610612737: 512,
              1879048193: 8389122,
              2147483649: 8421890,
              2415919105: 8421376,
              2684354561: 8388610,
              2952790017: 33282,
              3221225473: 514,
              3489660929: 8389120,
              3758096385: 32770,
              4026531841: 0,
              134217729: 8421890,
              402653185: 8421376,
              671088641: 8388608,
              939524097: 512,
              1207959553: 32768,
              1476395009: 8388610,
              1744830465: 2,
              2013265921: 33282,
              2281701377: 32770,
              2550136833: 8389122,
              2818572289: 514,
              3087007745: 8421888,
              3355443201: 8389120,
              3623878657: 0,
              3892314113: 33280,
              4160749569: 8421378
            },
            {
              0: 1074282512,
              16777216: 16384,
              33554432: 524288,
              50331648: 1074266128,
              67108864: 1073741840,
              83886080: 1074282496,
              100663296: 1073758208,
              117440512: 16,
              134217728: 540672,
              150994944: 1073758224,
              167772160: 1073741824,
              184549376: 540688,
              201326592: 524304,
              218103808: 0,
              234881024: 16400,
              251658240: 1074266112,
              8388608: 1073758208,
              25165824: 540688,
              41943040: 16,
              58720256: 1073758224,
              75497472: 1074282512,
              92274688: 1073741824,
              109051904: 524288,
              125829120: 1074266128,
              142606336: 524304,
              159383552: 0,
              176160768: 16384,
              192937984: 1074266112,
              209715200: 1073741840,
              226492416: 540672,
              243269632: 1074282496,
              260046848: 16400,
              268435456: 0,
              285212672: 1074266128,
              301989888: 1073758224,
              318767104: 1074282496,
              335544320: 1074266112,
              352321536: 16,
              369098752: 540688,
              385875968: 16384,
              402653184: 16400,
              419430400: 524288,
              436207616: 524304,
              452984832: 1073741840,
              469762048: 540672,
              486539264: 1073758208,
              503316480: 1073741824,
              520093696: 1074282512,
              276824064: 540688,
              293601280: 524288,
              310378496: 1074266112,
              327155712: 16384,
              343932928: 1073758208,
              360710144: 1074282512,
              377487360: 16,
              394264576: 1073741824,
              411041792: 1074282496,
              427819008: 1073741840,
              444596224: 1073758224,
              461373440: 524304,
              478150656: 0,
              494927872: 16400,
              511705088: 1074266128,
              528482304: 540672
            },
            {
              0: 260,
              1048576: 0,
              2097152: 67109120,
              3145728: 65796,
              4194304: 65540,
              5242880: 67108868,
              6291456: 67174660,
              7340032: 67174400,
              8388608: 67108864,
              9437184: 67174656,
              10485760: 65792,
              11534336: 67174404,
              12582912: 67109124,
              13631488: 65536,
              14680064: 4,
              15728640: 256,
              524288: 67174656,
              1572864: 67174404,
              2621440: 0,
              3670016: 67109120,
              4718592: 67108868,
              5767168: 65536,
              6815744: 65540,
              7864320: 260,
              8912896: 4,
              9961472: 256,
              11010048: 67174400,
              12058624: 65796,
              13107200: 65792,
              14155776: 67109124,
              15204352: 67174660,
              16252928: 67108864,
              16777216: 67174656,
              17825792: 65540,
              18874368: 65536,
              19922944: 67109120,
              20971520: 256,
              22020096: 67174660,
              23068672: 67108868,
              24117248: 0,
              25165824: 67109124,
              26214400: 67108864,
              27262976: 4,
              28311552: 65792,
              29360128: 67174400,
              30408704: 260,
              31457280: 65796,
              32505856: 67174404,
              17301504: 67108864,
              18350080: 260,
              19398656: 67174656,
              20447232: 0,
              21495808: 65540,
              22544384: 67109120,
              23592960: 256,
              24641536: 67174404,
              25690112: 65536,
              26738688: 67174660,
              27787264: 65796,
              28835840: 67108868,
              29884416: 67109124,
              30932992: 67174400,
              31981568: 4,
              33030144: 65792
            },
            {
              0: 2151682048,
              65536: 2147487808,
              131072: 4198464,
              196608: 2151677952,
              262144: 0,
              327680: 4198400,
              393216: 2147483712,
              458752: 4194368,
              524288: 2147483648,
              589824: 4194304,
              655360: 64,
              720896: 2147487744,
              786432: 2151678016,
              851968: 4160,
              917504: 4096,
              983040: 2151682112,
              32768: 2147487808,
              98304: 64,
              163840: 2151678016,
              229376: 2147487744,
              294912: 4198400,
              360448: 2151682112,
              425984: 0,
              491520: 2151677952,
              557056: 4096,
              622592: 2151682048,
              688128: 4194304,
              753664: 4160,
              819200: 2147483648,
              884736: 4194368,
              950272: 4198464,
              1015808: 2147483712,
              1048576: 4194368,
              1114112: 4198400,
              1179648: 2147483712,
              1245184: 0,
              1310720: 4160,
              1376256: 2151678016,
              1441792: 2151682048,
              1507328: 2147487808,
              1572864: 2151682112,
              1638400: 2147483648,
              1703936: 2151677952,
              1769472: 4198464,
              1835008: 2147487744,
              1900544: 4194304,
              1966080: 64,
              2031616: 4096,
              1081344: 2151677952,
              1146880: 2151682112,
              1212416: 0,
              1277952: 4198400,
              1343488: 4194368,
              1409024: 2147483648,
              1474560: 2147487808,
              1540096: 64,
              1605632: 2147483712,
              1671168: 4096,
              1736704: 2147487744,
              1802240: 2151678016,
              1867776: 4160,
              1933312: 2151682048,
              1998848: 4194304,
              2064384: 4198464
            },
            {
              0: 128,
              4096: 17039360,
              8192: 262144,
              12288: 536870912,
              16384: 537133184,
              20480: 16777344,
              24576: 553648256,
              28672: 262272,
              32768: 16777216,
              36864: 537133056,
              40960: 536871040,
              45056: 553910400,
              49152: 553910272,
              53248: 0,
              57344: 17039488,
              61440: 553648128,
              2048: 17039488,
              6144: 553648256,
              10240: 128,
              14336: 17039360,
              18432: 262144,
              22528: 537133184,
              26624: 553910272,
              30720: 536870912,
              34816: 537133056,
              38912: 0,
              43008: 553910400,
              47104: 16777344,
              51200: 536871040,
              55296: 553648128,
              59392: 16777216,
              63488: 262272,
              65536: 262144,
              69632: 128,
              73728: 536870912,
              77824: 553648256,
              81920: 16777344,
              86016: 553910272,
              90112: 537133184,
              94208: 16777216,
              98304: 553910400,
              102400: 553648128,
              106496: 17039360,
              110592: 537133056,
              114688: 262272,
              118784: 536871040,
              122880: 0,
              126976: 17039488,
              67584: 553648256,
              71680: 16777216,
              75776: 17039360,
              79872: 537133184,
              83968: 536870912,
              88064: 17039488,
              92160: 128,
              96256: 553910272,
              100352: 262272,
              104448: 553910400,
              108544: 0,
              112640: 553648128,
              116736: 16777344,
              120832: 262144,
              124928: 537133056,
              129024: 536871040
            },
            {
              0: 268435464,
              256: 8192,
              512: 270532608,
              768: 270540808,
              1024: 268443648,
              1280: 2097152,
              1536: 2097160,
              1792: 268435456,
              2048: 0,
              2304: 268443656,
              2560: 2105344,
              2816: 8,
              3072: 270532616,
              3328: 2105352,
              3584: 8200,
              3840: 270540800,
              128: 270532608,
              384: 270540808,
              640: 8,
              896: 2097152,
              1152: 2105352,
              1408: 268435464,
              1664: 268443648,
              1920: 8200,
              2176: 2097160,
              2432: 8192,
              2688: 268443656,
              2944: 270532616,
              3200: 0,
              3456: 270540800,
              3712: 2105344,
              3968: 268435456,
              4096: 268443648,
              4352: 270532616,
              4608: 270540808,
              4864: 8200,
              5120: 2097152,
              5376: 268435456,
              5632: 268435464,
              5888: 2105344,
              6144: 2105352,
              6400: 0,
              6656: 8,
              6912: 270532608,
              7168: 8192,
              7424: 268443656,
              7680: 270540800,
              7936: 2097160,
              4224: 8,
              4480: 2105344,
              4736: 2097152,
              4992: 268435464,
              5248: 268443648,
              5504: 8200,
              5760: 270540808,
              6016: 270532608,
              6272: 270540800,
              6528: 270532616,
              6784: 8192,
              7040: 2105352,
              7296: 2097160,
              7552: 0,
              7808: 268435456,
              8064: 268443656
            },
            {
              0: 1048576,
              16: 33555457,
              32: 1024,
              48: 1049601,
              64: 34604033,
              80: 0,
              96: 1,
              112: 34603009,
              128: 33555456,
              144: 1048577,
              160: 33554433,
              176: 34604032,
              192: 34603008,
              208: 1025,
              224: 1049600,
              240: 33554432,
              8: 34603009,
              24: 0,
              40: 33555457,
              56: 34604032,
              72: 1048576,
              88: 33554433,
              104: 33554432,
              120: 1025,
              136: 1049601,
              152: 33555456,
              168: 34603008,
              184: 1048577,
              200: 1024,
              216: 34604033,
              232: 1,
              248: 1049600,
              256: 33554432,
              272: 1048576,
              288: 33555457,
              304: 34603009,
              320: 1048577,
              336: 33555456,
              352: 34604032,
              368: 1049601,
              384: 1025,
              400: 34604033,
              416: 1049600,
              432: 1,
              448: 0,
              464: 34603008,
              480: 33554433,
              496: 1024,
              264: 1049600,
              280: 33555457,
              296: 34603009,
              312: 1,
              328: 33554432,
              344: 1048576,
              360: 1025,
              376: 34604032,
              392: 33554433,
              408: 34603008,
              424: 0,
              440: 34604033,
              456: 1049601,
              472: 1024,
              488: 33555456,
              504: 1048577
            },
            {
              0: 134219808,
              1: 131072,
              2: 134217728,
              3: 32,
              4: 131104,
              5: 134350880,
              6: 134350848,
              7: 2048,
              8: 134348800,
              9: 134219776,
              10: 133120,
              11: 134348832,
              12: 2080,
              13: 0,
              14: 134217760,
              15: 133152,
              2147483648: 2048,
              2147483649: 134350880,
              2147483650: 134219808,
              2147483651: 134217728,
              2147483652: 134348800,
              2147483653: 133120,
              2147483654: 133152,
              2147483655: 32,
              2147483656: 134217760,
              2147483657: 2080,
              2147483658: 131104,
              2147483659: 134350848,
              2147483660: 0,
              2147483661: 134348832,
              2147483662: 134219776,
              2147483663: 131072,
              16: 133152,
              17: 134350848,
              18: 32,
              19: 2048,
              20: 134219776,
              21: 134217760,
              22: 134348832,
              23: 131072,
              24: 0,
              25: 131104,
              26: 134348800,
              27: 134219808,
              28: 134350880,
              29: 133120,
              30: 2080,
              31: 134217728,
              2147483664: 131072,
              2147483665: 2048,
              2147483666: 134348832,
              2147483667: 133152,
              2147483668: 32,
              2147483669: 134348800,
              2147483670: 134217728,
              2147483671: 134219808,
              2147483672: 134350880,
              2147483673: 134217760,
              2147483674: 134219776,
              2147483675: 0,
              2147483676: 133120,
              2147483677: 2080,
              2147483678: 131104,
              2147483679: 134350848
            }
          ];
          var SBOX_MASK = [
            4160749569,
            528482304,
            33030144,
            2064384,
            129024,
            8064,
            504,
            2147483679
          ];
          var DES = C_algo.DES = BlockCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              var keyBits = [];
              for (var i = 0; i < 56; i++) {
                var keyBitPos = PC1[i] - 1;
                keyBits[i] = keyWords[keyBitPos >>> 5] >>> 31 - keyBitPos % 32 & 1;
              }
              var subKeys = this._subKeys = [];
              for (var nSubKey = 0; nSubKey < 16; nSubKey++) {
                var subKey = subKeys[nSubKey] = [];
                var bitShift = BIT_SHIFTS[nSubKey];
                for (var i = 0; i < 24; i++) {
                  subKey[i / 6 | 0] |= keyBits[(PC2[i] - 1 + bitShift) % 28] << 31 - i % 6;
                  subKey[4 + (i / 6 | 0)] |= keyBits[28 + (PC2[i + 24] - 1 + bitShift) % 28] << 31 - i % 6;
                }
                subKey[0] = subKey[0] << 1 | subKey[0] >>> 31;
                for (var i = 1; i < 7; i++) {
                  subKey[i] = subKey[i] >>> (i - 1) * 4 + 3;
                }
                subKey[7] = subKey[7] << 5 | subKey[7] >>> 27;
              }
              var invSubKeys = this._invSubKeys = [];
              for (var i = 0; i < 16; i++) {
                invSubKeys[i] = subKeys[15 - i];
              }
            },
            encryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._subKeys);
            },
            decryptBlock: function(M, offset) {
              this._doCryptBlock(M, offset, this._invSubKeys);
            },
            _doCryptBlock: function(M, offset, subKeys) {
              this._lBlock = M[offset];
              this._rBlock = M[offset + 1];
              exchangeLR.call(this, 4, 252645135);
              exchangeLR.call(this, 16, 65535);
              exchangeRL.call(this, 2, 858993459);
              exchangeRL.call(this, 8, 16711935);
              exchangeLR.call(this, 1, 1431655765);
              for (var round = 0; round < 16; round++) {
                var subKey = subKeys[round];
                var lBlock = this._lBlock;
                var rBlock = this._rBlock;
                var f = 0;
                for (var i = 0; i < 8; i++) {
                  f |= SBOX_P[i][((rBlock ^ subKey[i]) & SBOX_MASK[i]) >>> 0];
                }
                this._lBlock = rBlock;
                this._rBlock = lBlock ^ f;
              }
              var t = this._lBlock;
              this._lBlock = this._rBlock;
              this._rBlock = t;
              exchangeLR.call(this, 1, 1431655765);
              exchangeRL.call(this, 8, 16711935);
              exchangeRL.call(this, 2, 858993459);
              exchangeLR.call(this, 16, 65535);
              exchangeLR.call(this, 4, 252645135);
              M[offset] = this._lBlock;
              M[offset + 1] = this._rBlock;
            },
            keySize: 64 / 32,
            ivSize: 64 / 32,
            blockSize: 64 / 32
          });
          function exchangeLR(offset, mask) {
            var t = (this._lBlock >>> offset ^ this._rBlock) & mask;
            this._rBlock ^= t;
            this._lBlock ^= t << offset;
          }
          function exchangeRL(offset, mask) {
            var t = (this._rBlock >>> offset ^ this._lBlock) & mask;
            this._lBlock ^= t;
            this._rBlock ^= t << offset;
          }
          C.DES = BlockCipher._createHelper(DES);
          var TripleDES = C_algo.TripleDES = BlockCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              if (keyWords.length !== 2 && keyWords.length !== 4 && keyWords.length < 6) {
                throw new Error("Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.");
              }
              var key1 = keyWords.slice(0, 2);
              var key2 = keyWords.length < 4 ? keyWords.slice(0, 2) : keyWords.slice(2, 4);
              var key3 = keyWords.length < 6 ? keyWords.slice(0, 2) : keyWords.slice(4, 6);
              this._des1 = DES.createEncryptor(WordArray.create(key1));
              this._des2 = DES.createEncryptor(WordArray.create(key2));
              this._des3 = DES.createEncryptor(WordArray.create(key3));
            },
            encryptBlock: function(M, offset) {
              this._des1.encryptBlock(M, offset);
              this._des2.decryptBlock(M, offset);
              this._des3.encryptBlock(M, offset);
            },
            decryptBlock: function(M, offset) {
              this._des3.decryptBlock(M, offset);
              this._des2.encryptBlock(M, offset);
              this._des1.decryptBlock(M, offset);
            },
            keySize: 192 / 32,
            ivSize: 64 / 32,
            blockSize: 64 / 32
          });
          C.TripleDES = BlockCipher._createHelper(TripleDES);
        })();
        return CryptoJS2.TripleDES;
      });
    }
  });

  // node_modules/crypto-js/rc4.js
  var require_rc4 = __commonJS({
    "node_modules/crypto-js/rc4.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var RC4 = C_algo.RC4 = StreamCipher.extend({
            _doReset: function() {
              var key = this._key;
              var keyWords = key.words;
              var keySigBytes = key.sigBytes;
              var S = this._S = [];
              for (var i = 0; i < 256; i++) {
                S[i] = i;
              }
              for (var i = 0, j = 0; i < 256; i++) {
                var keyByteIndex = i % keySigBytes;
                var keyByte = keyWords[keyByteIndex >>> 2] >>> 24 - keyByteIndex % 4 * 8 & 255;
                j = (j + S[i] + keyByte) % 256;
                var t = S[i];
                S[i] = S[j];
                S[j] = t;
              }
              this._i = this._j = 0;
            },
            _doProcessBlock: function(M, offset) {
              M[offset] ^= generateKeystreamWord.call(this);
            },
            keySize: 256 / 32,
            ivSize: 0
          });
          function generateKeystreamWord() {
            var S = this._S;
            var i = this._i;
            var j = this._j;
            var keystreamWord = 0;
            for (var n = 0; n < 4; n++) {
              i = (i + 1) % 256;
              j = (j + S[i]) % 256;
              var t = S[i];
              S[i] = S[j];
              S[j] = t;
              keystreamWord |= S[(S[i] + S[j]) % 256] << 24 - n * 8;
            }
            this._i = i;
            this._j = j;
            return keystreamWord;
          }
          C.RC4 = StreamCipher._createHelper(RC4);
          var RC4Drop = C_algo.RC4Drop = RC4.extend({
            /**
             * Configuration options.
             *
             * @property {number} drop The number of keystream words to drop. Default 192
             */
            cfg: RC4.cfg.extend({
              drop: 192
            }),
            _doReset: function() {
              RC4._doReset.call(this);
              for (var i = this.cfg.drop; i > 0; i--) {
                generateKeystreamWord.call(this);
              }
            }
          });
          C.RC4Drop = StreamCipher._createHelper(RC4Drop);
        })();
        return CryptoJS2.RC4;
      });
    }
  });

  // node_modules/crypto-js/rabbit.js
  var require_rabbit = __commonJS({
    "node_modules/crypto-js/rabbit.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var S = [];
          var C_ = [];
          var G = [];
          var Rabbit = C_algo.Rabbit = StreamCipher.extend({
            _doReset: function() {
              var K = this._key.words;
              var iv2 = this.cfg.iv;
              for (var i = 0; i < 4; i++) {
                K[i] = (K[i] << 8 | K[i] >>> 24) & 16711935 | (K[i] << 24 | K[i] >>> 8) & 4278255360;
              }
              var X = this._X = [
                K[0],
                K[3] << 16 | K[2] >>> 16,
                K[1],
                K[0] << 16 | K[3] >>> 16,
                K[2],
                K[1] << 16 | K[0] >>> 16,
                K[3],
                K[2] << 16 | K[1] >>> 16
              ];
              var C2 = this._C = [
                K[2] << 16 | K[2] >>> 16,
                K[0] & 4294901760 | K[1] & 65535,
                K[3] << 16 | K[3] >>> 16,
                K[1] & 4294901760 | K[2] & 65535,
                K[0] << 16 | K[0] >>> 16,
                K[2] & 4294901760 | K[3] & 65535,
                K[1] << 16 | K[1] >>> 16,
                K[3] & 4294901760 | K[0] & 65535
              ];
              this._b = 0;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
              for (var i = 0; i < 8; i++) {
                C2[i] ^= X[i + 4 & 7];
              }
              if (iv2) {
                var IV = iv2.words;
                var IV_0 = IV[0];
                var IV_1 = IV[1];
                var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
                var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
                var i1 = i0 >>> 16 | i2 & 4294901760;
                var i3 = i2 << 16 | i0 & 65535;
                C2[0] ^= i0;
                C2[1] ^= i1;
                C2[2] ^= i2;
                C2[3] ^= i3;
                C2[4] ^= i0;
                C2[5] ^= i1;
                C2[6] ^= i2;
                C2[7] ^= i3;
                for (var i = 0; i < 4; i++) {
                  nextState.call(this);
                }
              }
            },
            _doProcessBlock: function(M, offset) {
              var X = this._X;
              nextState.call(this);
              S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
              S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
              S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
              S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
              for (var i = 0; i < 4; i++) {
                S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
                M[offset + i] ^= S[i];
              }
            },
            blockSize: 128 / 32,
            ivSize: 64 / 32
          });
          function nextState() {
            var X = this._X;
            var C2 = this._C;
            for (var i = 0; i < 8; i++) {
              C_[i] = C2[i];
            }
            C2[0] = C2[0] + 1295307597 + this._b | 0;
            C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
            C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
            C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
            C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
            C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
            C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
            C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
            this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
            for (var i = 0; i < 8; i++) {
              var gx = X[i] + C2[i];
              var ga = gx & 65535;
              var gb = gx >>> 16;
              var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
              var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
              G[i] = gh ^ gl;
            }
            X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
            X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
            X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
            X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
            X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
            X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
            X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
            X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
          }
          C.Rabbit = StreamCipher._createHelper(Rabbit);
        })();
        return CryptoJS2.Rabbit;
      });
    }
  });

  // node_modules/crypto-js/rabbit-legacy.js
  var require_rabbit_legacy = __commonJS({
    "node_modules/crypto-js/rabbit-legacy.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var StreamCipher = C_lib.StreamCipher;
          var C_algo = C.algo;
          var S = [];
          var C_ = [];
          var G = [];
          var RabbitLegacy = C_algo.RabbitLegacy = StreamCipher.extend({
            _doReset: function() {
              var K = this._key.words;
              var iv2 = this.cfg.iv;
              var X = this._X = [
                K[0],
                K[3] << 16 | K[2] >>> 16,
                K[1],
                K[0] << 16 | K[3] >>> 16,
                K[2],
                K[1] << 16 | K[0] >>> 16,
                K[3],
                K[2] << 16 | K[1] >>> 16
              ];
              var C2 = this._C = [
                K[2] << 16 | K[2] >>> 16,
                K[0] & 4294901760 | K[1] & 65535,
                K[3] << 16 | K[3] >>> 16,
                K[1] & 4294901760 | K[2] & 65535,
                K[0] << 16 | K[0] >>> 16,
                K[2] & 4294901760 | K[3] & 65535,
                K[1] << 16 | K[1] >>> 16,
                K[3] & 4294901760 | K[0] & 65535
              ];
              this._b = 0;
              for (var i = 0; i < 4; i++) {
                nextState.call(this);
              }
              for (var i = 0; i < 8; i++) {
                C2[i] ^= X[i + 4 & 7];
              }
              if (iv2) {
                var IV = iv2.words;
                var IV_0 = IV[0];
                var IV_1 = IV[1];
                var i0 = (IV_0 << 8 | IV_0 >>> 24) & 16711935 | (IV_0 << 24 | IV_0 >>> 8) & 4278255360;
                var i2 = (IV_1 << 8 | IV_1 >>> 24) & 16711935 | (IV_1 << 24 | IV_1 >>> 8) & 4278255360;
                var i1 = i0 >>> 16 | i2 & 4294901760;
                var i3 = i2 << 16 | i0 & 65535;
                C2[0] ^= i0;
                C2[1] ^= i1;
                C2[2] ^= i2;
                C2[3] ^= i3;
                C2[4] ^= i0;
                C2[5] ^= i1;
                C2[6] ^= i2;
                C2[7] ^= i3;
                for (var i = 0; i < 4; i++) {
                  nextState.call(this);
                }
              }
            },
            _doProcessBlock: function(M, offset) {
              var X = this._X;
              nextState.call(this);
              S[0] = X[0] ^ X[5] >>> 16 ^ X[3] << 16;
              S[1] = X[2] ^ X[7] >>> 16 ^ X[5] << 16;
              S[2] = X[4] ^ X[1] >>> 16 ^ X[7] << 16;
              S[3] = X[6] ^ X[3] >>> 16 ^ X[1] << 16;
              for (var i = 0; i < 4; i++) {
                S[i] = (S[i] << 8 | S[i] >>> 24) & 16711935 | (S[i] << 24 | S[i] >>> 8) & 4278255360;
                M[offset + i] ^= S[i];
              }
            },
            blockSize: 128 / 32,
            ivSize: 64 / 32
          });
          function nextState() {
            var X = this._X;
            var C2 = this._C;
            for (var i = 0; i < 8; i++) {
              C_[i] = C2[i];
            }
            C2[0] = C2[0] + 1295307597 + this._b | 0;
            C2[1] = C2[1] + 3545052371 + (C2[0] >>> 0 < C_[0] >>> 0 ? 1 : 0) | 0;
            C2[2] = C2[2] + 886263092 + (C2[1] >>> 0 < C_[1] >>> 0 ? 1 : 0) | 0;
            C2[3] = C2[3] + 1295307597 + (C2[2] >>> 0 < C_[2] >>> 0 ? 1 : 0) | 0;
            C2[4] = C2[4] + 3545052371 + (C2[3] >>> 0 < C_[3] >>> 0 ? 1 : 0) | 0;
            C2[5] = C2[5] + 886263092 + (C2[4] >>> 0 < C_[4] >>> 0 ? 1 : 0) | 0;
            C2[6] = C2[6] + 1295307597 + (C2[5] >>> 0 < C_[5] >>> 0 ? 1 : 0) | 0;
            C2[7] = C2[7] + 3545052371 + (C2[6] >>> 0 < C_[6] >>> 0 ? 1 : 0) | 0;
            this._b = C2[7] >>> 0 < C_[7] >>> 0 ? 1 : 0;
            for (var i = 0; i < 8; i++) {
              var gx = X[i] + C2[i];
              var ga = gx & 65535;
              var gb = gx >>> 16;
              var gh = ((ga * ga >>> 17) + ga * gb >>> 15) + gb * gb;
              var gl = ((gx & 4294901760) * gx | 0) + ((gx & 65535) * gx | 0);
              G[i] = gh ^ gl;
            }
            X[0] = G[0] + (G[7] << 16 | G[7] >>> 16) + (G[6] << 16 | G[6] >>> 16) | 0;
            X[1] = G[1] + (G[0] << 8 | G[0] >>> 24) + G[7] | 0;
            X[2] = G[2] + (G[1] << 16 | G[1] >>> 16) + (G[0] << 16 | G[0] >>> 16) | 0;
            X[3] = G[3] + (G[2] << 8 | G[2] >>> 24) + G[1] | 0;
            X[4] = G[4] + (G[3] << 16 | G[3] >>> 16) + (G[2] << 16 | G[2] >>> 16) | 0;
            X[5] = G[5] + (G[4] << 8 | G[4] >>> 24) + G[3] | 0;
            X[6] = G[6] + (G[5] << 16 | G[5] >>> 16) + (G[4] << 16 | G[4] >>> 16) | 0;
            X[7] = G[7] + (G[6] << 8 | G[6] >>> 24) + G[5] | 0;
          }
          C.RabbitLegacy = StreamCipher._createHelper(RabbitLegacy);
        })();
        return CryptoJS2.RabbitLegacy;
      });
    }
  });

  // node_modules/crypto-js/blowfish.js
  var require_blowfish = __commonJS({
    "node_modules/crypto-js/blowfish.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_enc_base64(), require_md5(), require_evpkdf(), require_cipher_core());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./enc-base64", "./md5", "./evpkdf", "./cipher-core"], factory);
        } else {
          factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        (function() {
          var C = CryptoJS2;
          var C_lib = C.lib;
          var BlockCipher = C_lib.BlockCipher;
          var C_algo = C.algo;
          const N = 16;
          const ORIG_P = [
            608135816,
            2242054355,
            320440878,
            57701188,
            2752067618,
            698298832,
            137296536,
            3964562569,
            1160258022,
            953160567,
            3193202383,
            887688300,
            3232508343,
            3380367581,
            1065670069,
            3041331479,
            2450970073,
            2306472731
          ];
          const ORIG_S = [
            [
              3509652390,
              2564797868,
              805139163,
              3491422135,
              3101798381,
              1780907670,
              3128725573,
              4046225305,
              614570311,
              3012652279,
              134345442,
              2240740374,
              1667834072,
              1901547113,
              2757295779,
              4103290238,
              227898511,
              1921955416,
              1904987480,
              2182433518,
              2069144605,
              3260701109,
              2620446009,
              720527379,
              3318853667,
              677414384,
              3393288472,
              3101374703,
              2390351024,
              1614419982,
              1822297739,
              2954791486,
              3608508353,
              3174124327,
              2024746970,
              1432378464,
              3864339955,
              2857741204,
              1464375394,
              1676153920,
              1439316330,
              715854006,
              3033291828,
              289532110,
              2706671279,
              2087905683,
              3018724369,
              1668267050,
              732546397,
              1947742710,
              3462151702,
              2609353502,
              2950085171,
              1814351708,
              2050118529,
              680887927,
              999245976,
              1800124847,
              3300911131,
              1713906067,
              1641548236,
              4213287313,
              1216130144,
              1575780402,
              4018429277,
              3917837745,
              3693486850,
              3949271944,
              596196993,
              3549867205,
              258830323,
              2213823033,
              772490370,
              2760122372,
              1774776394,
              2652871518,
              566650946,
              4142492826,
              1728879713,
              2882767088,
              1783734482,
              3629395816,
              2517608232,
              2874225571,
              1861159788,
              326777828,
              3124490320,
              2130389656,
              2716951837,
              967770486,
              1724537150,
              2185432712,
              2364442137,
              1164943284,
              2105845187,
              998989502,
              3765401048,
              2244026483,
              1075463327,
              1455516326,
              1322494562,
              910128902,
              469688178,
              1117454909,
              936433444,
              3490320968,
              3675253459,
              1240580251,
              122909385,
              2157517691,
              634681816,
              4142456567,
              3825094682,
              3061402683,
              2540495037,
              79693498,
              3249098678,
              1084186820,
              1583128258,
              426386531,
              1761308591,
              1047286709,
              322548459,
              995290223,
              1845252383,
              2603652396,
              3431023940,
              2942221577,
              3202600964,
              3727903485,
              1712269319,
              422464435,
              3234572375,
              1170764815,
              3523960633,
              3117677531,
              1434042557,
              442511882,
              3600875718,
              1076654713,
              1738483198,
              4213154764,
              2393238008,
              3677496056,
              1014306527,
              4251020053,
              793779912,
              2902807211,
              842905082,
              4246964064,
              1395751752,
              1040244610,
              2656851899,
              3396308128,
              445077038,
              3742853595,
              3577915638,
              679411651,
              2892444358,
              2354009459,
              1767581616,
              3150600392,
              3791627101,
              3102740896,
              284835224,
              4246832056,
              1258075500,
              768725851,
              2589189241,
              3069724005,
              3532540348,
              1274779536,
              3789419226,
              2764799539,
              1660621633,
              3471099624,
              4011903706,
              913787905,
              3497959166,
              737222580,
              2514213453,
              2928710040,
              3937242737,
              1804850592,
              3499020752,
              2949064160,
              2386320175,
              2390070455,
              2415321851,
              4061277028,
              2290661394,
              2416832540,
              1336762016,
              1754252060,
              3520065937,
              3014181293,
              791618072,
              3188594551,
              3933548030,
              2332172193,
              3852520463,
              3043980520,
              413987798,
              3465142937,
              3030929376,
              4245938359,
              2093235073,
              3534596313,
              375366246,
              2157278981,
              2479649556,
              555357303,
              3870105701,
              2008414854,
              3344188149,
              4221384143,
              3956125452,
              2067696032,
              3594591187,
              2921233993,
              2428461,
              544322398,
              577241275,
              1471733935,
              610547355,
              4027169054,
              1432588573,
              1507829418,
              2025931657,
              3646575487,
              545086370,
              48609733,
              2200306550,
              1653985193,
              298326376,
              1316178497,
              3007786442,
              2064951626,
              458293330,
              2589141269,
              3591329599,
              3164325604,
              727753846,
              2179363840,
              146436021,
              1461446943,
              4069977195,
              705550613,
              3059967265,
              3887724982,
              4281599278,
              3313849956,
              1404054877,
              2845806497,
              146425753,
              1854211946
            ],
            [
              1266315497,
              3048417604,
              3681880366,
              3289982499,
              290971e4,
              1235738493,
              2632868024,
              2414719590,
              3970600049,
              1771706367,
              1449415276,
              3266420449,
              422970021,
              1963543593,
              2690192192,
              3826793022,
              1062508698,
              1531092325,
              1804592342,
              2583117782,
              2714934279,
              4024971509,
              1294809318,
              4028980673,
              1289560198,
              2221992742,
              1669523910,
              35572830,
              157838143,
              1052438473,
              1016535060,
              1802137761,
              1753167236,
              1386275462,
              3080475397,
              2857371447,
              1040679964,
              2145300060,
              2390574316,
              1461121720,
              2956646967,
              4031777805,
              4028374788,
              33600511,
              2920084762,
              1018524850,
              629373528,
              3691585981,
              3515945977,
              2091462646,
              2486323059,
              586499841,
              988145025,
              935516892,
              3367335476,
              2599673255,
              2839830854,
              265290510,
              3972581182,
              2759138881,
              3795373465,
              1005194799,
              847297441,
              406762289,
              1314163512,
              1332590856,
              1866599683,
              4127851711,
              750260880,
              613907577,
              1450815602,
              3165620655,
              3734664991,
              3650291728,
              3012275730,
              3704569646,
              1427272223,
              778793252,
              1343938022,
              2676280711,
              2052605720,
              1946737175,
              3164576444,
              3914038668,
              3967478842,
              3682934266,
              1661551462,
              3294938066,
              4011595847,
              840292616,
              3712170807,
              616741398,
              312560963,
              711312465,
              1351876610,
              322626781,
              1910503582,
              271666773,
              2175563734,
              1594956187,
              70604529,
              3617834859,
              1007753275,
              1495573769,
              4069517037,
              2549218298,
              2663038764,
              504708206,
              2263041392,
              3941167025,
              2249088522,
              1514023603,
              1998579484,
              1312622330,
              694541497,
              2582060303,
              2151582166,
              1382467621,
              776784248,
              2618340202,
              3323268794,
              2497899128,
              2784771155,
              503983604,
              4076293799,
              907881277,
              423175695,
              432175456,
              1378068232,
              4145222326,
              3954048622,
              3938656102,
              3820766613,
              2793130115,
              2977904593,
              26017576,
              3274890735,
              3194772133,
              1700274565,
              1756076034,
              4006520079,
              3677328699,
              720338349,
              1533947780,
              354530856,
              688349552,
              3973924725,
              1637815568,
              332179504,
              3949051286,
              53804574,
              2852348879,
              3044236432,
              1282449977,
              3583942155,
              3416972820,
              4006381244,
              1617046695,
              2628476075,
              3002303598,
              1686838959,
              431878346,
              2686675385,
              1700445008,
              1080580658,
              1009431731,
              832498133,
              3223435511,
              2605976345,
              2271191193,
              2516031870,
              1648197032,
              4164389018,
              2548247927,
              300782431,
              375919233,
              238389289,
              3353747414,
              2531188641,
              2019080857,
              1475708069,
              455242339,
              2609103871,
              448939670,
              3451063019,
              1395535956,
              2413381860,
              1841049896,
              1491858159,
              885456874,
              4264095073,
              4001119347,
              1565136089,
              3898914787,
              1108368660,
              540939232,
              1173283510,
              2745871338,
              3681308437,
              4207628240,
              3343053890,
              4016749493,
              1699691293,
              1103962373,
              3625875870,
              2256883143,
              3830138730,
              1031889488,
              3479347698,
              1535977030,
              4236805024,
              3251091107,
              2132092099,
              1774941330,
              1199868427,
              1452454533,
              157007616,
              2904115357,
              342012276,
              595725824,
              1480756522,
              206960106,
              497939518,
              591360097,
              863170706,
              2375253569,
              3596610801,
              1814182875,
              2094937945,
              3421402208,
              1082520231,
              3463918190,
              2785509508,
              435703966,
              3908032597,
              1641649973,
              2842273706,
              3305899714,
              1510255612,
              2148256476,
              2655287854,
              3276092548,
              4258621189,
              236887753,
              3681803219,
              274041037,
              1734335097,
              3815195456,
              3317970021,
              1899903192,
              1026095262,
              4050517792,
              356393447,
              2410691914,
              3873677099,
              3682840055
            ],
            [
              3913112168,
              2491498743,
              4132185628,
              2489919796,
              1091903735,
              1979897079,
              3170134830,
              3567386728,
              3557303409,
              857797738,
              1136121015,
              1342202287,
              507115054,
              2535736646,
              337727348,
              3213592640,
              1301675037,
              2528481711,
              1895095763,
              1721773893,
              3216771564,
              62756741,
              2142006736,
              835421444,
              2531993523,
              1442658625,
              3659876326,
              2882144922,
              676362277,
              1392781812,
              170690266,
              3921047035,
              1759253602,
              3611846912,
              1745797284,
              664899054,
              1329594018,
              3901205900,
              3045908486,
              2062866102,
              2865634940,
              3543621612,
              3464012697,
              1080764994,
              553557557,
              3656615353,
              3996768171,
              991055499,
              499776247,
              1265440854,
              648242737,
              3940784050,
              980351604,
              3713745714,
              1749149687,
              3396870395,
              4211799374,
              3640570775,
              1161844396,
              3125318951,
              1431517754,
              545492359,
              4268468663,
              3499529547,
              1437099964,
              2702547544,
              3433638243,
              2581715763,
              2787789398,
              1060185593,
              1593081372,
              2418618748,
              4260947970,
              69676912,
              2159744348,
              86519011,
              2512459080,
              3838209314,
              1220612927,
              3339683548,
              133810670,
              1090789135,
              1078426020,
              1569222167,
              845107691,
              3583754449,
              4072456591,
              1091646820,
              628848692,
              1613405280,
              3757631651,
              526609435,
              236106946,
              48312990,
              2942717905,
              3402727701,
              1797494240,
              859738849,
              992217954,
              4005476642,
              2243076622,
              3870952857,
              3732016268,
              765654824,
              3490871365,
              2511836413,
              1685915746,
              3888969200,
              1414112111,
              2273134842,
              3281911079,
              4080962846,
              172450625,
              2569994100,
              980381355,
              4109958455,
              2819808352,
              2716589560,
              2568741196,
              3681446669,
              3329971472,
              1835478071,
              660984891,
              3704678404,
              4045999559,
              3422617507,
              3040415634,
              1762651403,
              1719377915,
              3470491036,
              2693910283,
              3642056355,
              3138596744,
              1364962596,
              2073328063,
              1983633131,
              926494387,
              3423689081,
              2150032023,
              4096667949,
              1749200295,
              3328846651,
              309677260,
              2016342300,
              1779581495,
              3079819751,
              111262694,
              1274766160,
              443224088,
              298511866,
              1025883608,
              3806446537,
              1145181785,
              168956806,
              3641502830,
              3584813610,
              1689216846,
              3666258015,
              3200248200,
              1692713982,
              2646376535,
              4042768518,
              1618508792,
              1610833997,
              3523052358,
              4130873264,
              2001055236,
              3610705100,
              2202168115,
              4028541809,
              2961195399,
              1006657119,
              2006996926,
              3186142756,
              1430667929,
              3210227297,
              1314452623,
              4074634658,
              4101304120,
              2273951170,
              1399257539,
              3367210612,
              3027628629,
              1190975929,
              2062231137,
              2333990788,
              2221543033,
              2438960610,
              1181637006,
              548689776,
              2362791313,
              3372408396,
              3104550113,
              3145860560,
              296247880,
              1970579870,
              3078560182,
              3769228297,
              1714227617,
              3291629107,
              3898220290,
              166772364,
              1251581989,
              493813264,
              448347421,
              195405023,
              2709975567,
              677966185,
              3703036547,
              1463355134,
              2715995803,
              1338867538,
              1343315457,
              2802222074,
              2684532164,
              233230375,
              2599980071,
              2000651841,
              3277868038,
              1638401717,
              4028070440,
              3237316320,
              6314154,
              819756386,
              300326615,
              590932579,
              1405279636,
              3267499572,
              3150704214,
              2428286686,
              3959192993,
              3461946742,
              1862657033,
              1266418056,
              963775037,
              2089974820,
              2263052895,
              1917689273,
              448879540,
              3550394620,
              3981727096,
              150775221,
              3627908307,
              1303187396,
              508620638,
              2975983352,
              2726630617,
              1817252668,
              1876281319,
              1457606340,
              908771278,
              3720792119,
              3617206836,
              2455994898,
              1729034894,
              1080033504
            ],
            [
              976866871,
              3556439503,
              2881648439,
              1522871579,
              1555064734,
              1336096578,
              3548522304,
              2579274686,
              3574697629,
              3205460757,
              3593280638,
              3338716283,
              3079412587,
              564236357,
              2993598910,
              1781952180,
              1464380207,
              3163844217,
              3332601554,
              1699332808,
              1393555694,
              1183702653,
              3581086237,
              1288719814,
              691649499,
              2847557200,
              2895455976,
              3193889540,
              2717570544,
              1781354906,
              1676643554,
              2592534050,
              3230253752,
              1126444790,
              2770207658,
              2633158820,
              2210423226,
              2615765581,
              2414155088,
              3127139286,
              673620729,
              2805611233,
              1269405062,
              4015350505,
              3341807571,
              4149409754,
              1057255273,
              2012875353,
              2162469141,
              2276492801,
              2601117357,
              993977747,
              3918593370,
              2654263191,
              753973209,
              36408145,
              2530585658,
              25011837,
              3520020182,
              2088578344,
              530523599,
              2918365339,
              1524020338,
              1518925132,
              3760827505,
              3759777254,
              1202760957,
              3985898139,
              3906192525,
              674977740,
              4174734889,
              2031300136,
              2019492241,
              3983892565,
              4153806404,
              3822280332,
              352677332,
              2297720250,
              60907813,
              90501309,
              3286998549,
              1016092578,
              2535922412,
              2839152426,
              457141659,
              509813237,
              4120667899,
              652014361,
              1966332200,
              2975202805,
              55981186,
              2327461051,
              676427537,
              3255491064,
              2882294119,
              3433927263,
              1307055953,
              942726286,
              933058658,
              2468411793,
              3933900994,
              4215176142,
              1361170020,
              2001714738,
              2830558078,
              3274259782,
              1222529897,
              1679025792,
              2729314320,
              3714953764,
              1770335741,
              151462246,
              3013232138,
              1682292957,
              1483529935,
              471910574,
              1539241949,
              458788160,
              3436315007,
              1807016891,
              3718408830,
              978976581,
              1043663428,
              3165965781,
              1927990952,
              4200891579,
              2372276910,
              3208408903,
              3533431907,
              1412390302,
              2931980059,
              4132332400,
              1947078029,
              3881505623,
              4168226417,
              2941484381,
              1077988104,
              1320477388,
              886195818,
              18198404,
              3786409e3,
              2509781533,
              112762804,
              3463356488,
              1866414978,
              891333506,
              18488651,
              661792760,
              1628790961,
              3885187036,
              3141171499,
              876946877,
              2693282273,
              1372485963,
              791857591,
              2686433993,
              3759982718,
              3167212022,
              3472953795,
              2716379847,
              445679433,
              3561995674,
              3504004811,
              3574258232,
              54117162,
              3331405415,
              2381918588,
              3769707343,
              4154350007,
              1140177722,
              4074052095,
              668550556,
              3214352940,
              367459370,
              261225585,
              2610173221,
              4209349473,
              3468074219,
              3265815641,
              314222801,
              3066103646,
              3808782860,
              282218597,
              3406013506,
              3773591054,
              379116347,
              1285071038,
              846784868,
              2669647154,
              3771962079,
              3550491691,
              2305946142,
              453669953,
              1268987020,
              3317592352,
              3279303384,
              3744833421,
              2610507566,
              3859509063,
              266596637,
              3847019092,
              517658769,
              3462560207,
              3443424879,
              370717030,
              4247526661,
              2224018117,
              4143653529,
              4112773975,
              2788324899,
              2477274417,
              1456262402,
              2901442914,
              1517677493,
              1846949527,
              2295493580,
              3734397586,
              2176403920,
              1280348187,
              1908823572,
              3871786941,
              846861322,
              1172426758,
              3287448474,
              3383383037,
              1655181056,
              3139813346,
              901632758,
              1897031941,
              2986607138,
              3066810236,
              3447102507,
              1393639104,
              373351379,
              950779232,
              625454576,
              3124240540,
              4148612726,
              2007998917,
              544563296,
              2244738638,
              2330496472,
              2058025392,
              1291430526,
              424198748,
              50039436,
              29584100,
              3605783033,
              2429876329,
              2791104160,
              1057563949,
              3255363231,
              3075367218,
              3463963227,
              1469046755,
              985887462
            ]
          ];
          var BLOWFISH_CTX = {
            pbox: [],
            sbox: []
          };
          function F(ctx, x) {
            let a = x >> 24 & 255;
            let b = x >> 16 & 255;
            let c = x >> 8 & 255;
            let d = x & 255;
            let y = ctx.sbox[0][a] + ctx.sbox[1][b];
            y = y ^ ctx.sbox[2][c];
            y = y + ctx.sbox[3][d];
            return y;
          }
          function BlowFish_Encrypt(ctx, left, right) {
            let Xl = left;
            let Xr = right;
            let temp;
            for (let i = 0; i < N; ++i) {
              Xl = Xl ^ ctx.pbox[i];
              Xr = F(ctx, Xl) ^ Xr;
              temp = Xl;
              Xl = Xr;
              Xr = temp;
            }
            temp = Xl;
            Xl = Xr;
            Xr = temp;
            Xr = Xr ^ ctx.pbox[N];
            Xl = Xl ^ ctx.pbox[N + 1];
            return { left: Xl, right: Xr };
          }
          function BlowFish_Decrypt(ctx, left, right) {
            let Xl = left;
            let Xr = right;
            let temp;
            for (let i = N + 1; i > 1; --i) {
              Xl = Xl ^ ctx.pbox[i];
              Xr = F(ctx, Xl) ^ Xr;
              temp = Xl;
              Xl = Xr;
              Xr = temp;
            }
            temp = Xl;
            Xl = Xr;
            Xr = temp;
            Xr = Xr ^ ctx.pbox[1];
            Xl = Xl ^ ctx.pbox[0];
            return { left: Xl, right: Xr };
          }
          function BlowFishInit(ctx, key, keysize) {
            for (let Row = 0; Row < 4; Row++) {
              ctx.sbox[Row] = [];
              for (let Col = 0; Col < 256; Col++) {
                ctx.sbox[Row][Col] = ORIG_S[Row][Col];
              }
            }
            let keyIndex = 0;
            for (let index = 0; index < N + 2; index++) {
              ctx.pbox[index] = ORIG_P[index] ^ key[keyIndex];
              keyIndex++;
              if (keyIndex >= keysize) {
                keyIndex = 0;
              }
            }
            let Data1 = 0;
            let Data2 = 0;
            let res = 0;
            for (let i = 0; i < N + 2; i += 2) {
              res = BlowFish_Encrypt(ctx, Data1, Data2);
              Data1 = res.left;
              Data2 = res.right;
              ctx.pbox[i] = Data1;
              ctx.pbox[i + 1] = Data2;
            }
            for (let i = 0; i < 4; i++) {
              for (let j = 0; j < 256; j += 2) {
                res = BlowFish_Encrypt(ctx, Data1, Data2);
                Data1 = res.left;
                Data2 = res.right;
                ctx.sbox[i][j] = Data1;
                ctx.sbox[i][j + 1] = Data2;
              }
            }
            return true;
          }
          var Blowfish = C_algo.Blowfish = BlockCipher.extend({
            _doReset: function() {
              if (this._keyPriorReset === this._key) {
                return;
              }
              var key = this._keyPriorReset = this._key;
              var keyWords = key.words;
              var keySize = key.sigBytes / 4;
              BlowFishInit(BLOWFISH_CTX, keyWords, keySize);
            },
            encryptBlock: function(M, offset) {
              var res = BlowFish_Encrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
              M[offset] = res.left;
              M[offset + 1] = res.right;
            },
            decryptBlock: function(M, offset) {
              var res = BlowFish_Decrypt(BLOWFISH_CTX, M[offset], M[offset + 1]);
              M[offset] = res.left;
              M[offset + 1] = res.right;
            },
            blockSize: 64 / 32,
            keySize: 128 / 32,
            ivSize: 64 / 32
          });
          C.Blowfish = BlockCipher._createHelper(Blowfish);
        })();
        return CryptoJS2.Blowfish;
      });
    }
  });

  // node_modules/crypto-js/index.js
  var require_crypto_js = __commonJS({
    "node_modules/crypto-js/index.js"(exports, module) {
      (function(root, factory, undef) {
        if (typeof exports === "object") {
          module.exports = exports = factory(require_core(), require_x64_core(), require_lib_typedarrays(), require_enc_utf16(), require_enc_base64(), require_enc_base64url(), require_md5(), require_sha1(), require_sha256(), require_sha224(), require_sha512(), require_sha384(), require_sha3(), require_ripemd160(), require_hmac(), require_pbkdf2(), require_evpkdf(), require_cipher_core(), require_mode_cfb(), require_mode_ctr(), require_mode_ctr_gladman(), require_mode_ofb(), require_mode_ecb(), require_pad_ansix923(), require_pad_iso10126(), require_pad_iso97971(), require_pad_zeropadding(), require_pad_nopadding(), require_format_hex(), require_aes(), require_tripledes(), require_rc4(), require_rabbit(), require_rabbit_legacy(), require_blowfish());
        } else if (typeof define === "function" && define.amd) {
          define(["./core", "./x64-core", "./lib-typedarrays", "./enc-utf16", "./enc-base64", "./enc-base64url", "./md5", "./sha1", "./sha256", "./sha224", "./sha512", "./sha384", "./sha3", "./ripemd160", "./hmac", "./pbkdf2", "./evpkdf", "./cipher-core", "./mode-cfb", "./mode-ctr", "./mode-ctr-gladman", "./mode-ofb", "./mode-ecb", "./pad-ansix923", "./pad-iso10126", "./pad-iso97971", "./pad-zeropadding", "./pad-nopadding", "./format-hex", "./aes", "./tripledes", "./rc4", "./rabbit", "./rabbit-legacy", "./blowfish"], factory);
        } else {
          root.CryptoJS = factory(root.CryptoJS);
        }
      })(exports, function(CryptoJS2) {
        return CryptoJS2;
      });
    }
  });

  // src/shims/crypto.js
  function sha1Bytes(msgBytes) {
    const ml = msgBytes.length;
    const withOne = msgBytes.concat([128]);
    while (withOne.length % 64 !== 56) withOne.push(0);
    const bitLenHi = Math.floor(ml / 536870912);
    const bitLenLo = ml << 3 >>> 0;
    withOne.push(bitLenHi >>> 24 & 255, bitLenHi >>> 16 & 255, bitLenHi >>> 8 & 255, bitLenHi & 255);
    withOne.push(bitLenLo >>> 24 & 255, bitLenLo >>> 16 & 255, bitLenLo >>> 8 & 255, bitLenLo & 255);
    let h0 = 1732584193 | 0, h1 = 4023233417 | 0, h2 = 2562383102 | 0, h3 = 271733878 | 0, h4 = 3285377520 | 0;
    const w = new Array(80);
    const rr = (x, n) => x << n | x >>> 32 - n | 0;
    for (let off = 0; off < withOne.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = withOne[off + i * 4] << 24 | withOne[off + i * 4 + 1] << 16 | withOne[off + i * 4 + 2] << 8 | withOne[off + i * 4 + 3] | 0;
      }
      for (let i = 16; i < 80; i++) w[i] = rr(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = b & c | ~b & d;
          k = 1518500249;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 1859775393;
        } else if (i < 60) {
          f = b & c | b & d | c & d;
          k = 2400959708;
        } else {
          f = b ^ c ^ d;
          k = 3395469782;
        }
        const t = rr(a, 5) + f + e + k + w[i] | 0;
        e = d;
        d = c;
        c = rr(b, 30);
        b = a;
        a = t;
      }
      h0 = h0 + a | 0;
      h1 = h1 + b | 0;
      h2 = h2 + c | 0;
      h3 = h3 + d | 0;
      h4 = h4 + e | 0;
    }
    const out = [];
    for (const h of [h0, h1, h2, h3, h4]) out.push(h >>> 24 & 255, h >>> 16 & 255, h >>> 8 & 255, h & 255);
    return out;
  }
  function hashSHA1(str) {
    if (typeof __lxSha1 === "function") return Promise.resolve(__lxSha1(str));
    const u = encodeURIComponent(String(str));
    const bytes = [];
    for (let i = 0; i < u.length; i++) {
      if (u[i] === "%") {
        bytes.push(parseInt(u.substr(i + 1, 2), 16));
        i += 2;
      } else bytes.push(u.charCodeAt(i));
    }
    const hex = sha1Bytes(bytes).map((x) => x.toString(16).padStart(2, "0")).join("");
    return Promise.resolve(hex);
  }
  function aesEncryptSync(dataB64, keyB64, ivB64, mode) {
    const key = import_crypto_js.default.enc.Base64.parse(keyB64);
    if (mode === AES_MODE.ECB_128_NoPadding) {
      const data2 = import_crypto_js.default.enc.Base64.parse(dataB64);
      const enc2 = import_crypto_js.default.AES.encrypt(data2, key, { mode: import_crypto_js.default.mode.ECB, padding: import_crypto_js.default.pad.Pkcs7 });
      return import_crypto_js.default.enc.Base64.stringify(enc2.ciphertext);
    }
    const iv2 = import_crypto_js.default.enc.Base64.parse(ivB64);
    const data = import_crypto_js.default.enc.Base64.parse(dataB64);
    const enc = import_crypto_js.default.AES.encrypt(data, key, { iv: iv2, mode: import_crypto_js.default.mode.CBC, padding: import_crypto_js.default.pad.Pkcs7 });
    return import_crypto_js.default.enc.Base64.stringify(enc.ciphertext);
  }
  function aesDecryptSync(dataB64, keyB64, ivB64, mode) {
    const key = import_crypto_js.default.enc.Base64.parse(keyB64);
    if (mode === AES_MODE.ECB_128_NoPadding) {
      const ct = import_crypto_js.default.enc.Base64.parse(dataB64);
      const dec2 = import_crypto_js.default.AES.decrypt({ ciphertext: ct }, key, { mode: import_crypto_js.default.mode.ECB, padding: import_crypto_js.default.pad.Pkcs7 });
      return import_crypto_js.default.enc.Base64.stringify(dec2);
    }
    const iv2 = import_crypto_js.default.enc.Base64.parse(ivB64);
    const dec = import_crypto_js.default.AES.decrypt({ ciphertext: import_crypto_js.default.enc.Base64.parse(dataB64) }, key, { iv: iv2, mode: import_crypto_js.default.mode.CBC, padding: import_crypto_js.default.pad.Pkcs7 });
    return import_crypto_js.default.enc.Base64.stringify(dec);
  }
  function derInts(der) {
    const ints = [];
    let i = 0;
    while (i + 2 <= der.length) {
      const tag = der[i];
      if (tag !== 2) {
        i++;
        continue;
      }
      let len = der[i + 1];
      let hdr = 2;
      if (len & 128) {
        const n = len & 127;
        len = 0;
        for (let k = 0; k < n; k++) len = len * 256 + der[i + 2 + k];
        hdr = 2 + n;
      }
      if (i + hdr + len > der.length) break;
      ints.push(der.slice(i + hdr, i + hdr + len));
      i += hdr + len;
    }
    return ints;
  }
  function pemBody(pem) {
    const b64 = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    return b64bytes(b64);
  }
  function modPow(base, exp, mod) {
    let b = BigInt("0x" + base.map((x) => x.toString(16).padStart(2, "0")).join(""));
    let e = BigInt("0x" + exp.map((x) => x.toString(16).padStart(2, "0")).join(""));
    const m = BigInt("0x" + mod.map((x) => x.toString(16).padStart(2, "0")).join(""));
    let r = 1n;
    b %= m;
    while (e > 0n) {
      if (e & 1n) r = r * b % m;
      b = b * b % m;
      e >>= 1n;
    }
    const hex = r.toString(16).padStart(256, "0");
    const out = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
  function rsaEncryptSync(dataB64, publicKeyPem, padding) {
    if (padding !== RSA_PADDING.NoPadding) throw new Error("shim RSA 仅支持 NoPadding");
    const der = pemBody(publicKeyPem);
    const ints = derInts(der).filter((v) => v.length > 2);
    const n = ints.find((v) => v[0] === 0) ?? ints[0];
    const e = ints.find((v) => v !== n) ?? [1, 0, 1];
    const data = b64bytes(dataB64);
    const out = modPow(data, e, n);
    return btoa(out.map((x) => String.fromCharCode(x)).join(""));
  }
  var import_crypto_js, AES_MODE, RSA_PADDING;
  var init_crypto = __esm({
    "src/shims/crypto.js"() {
      "use strict";
      import_crypto_js = __toESM(require_crypto_js());
      init_buffer();
      AES_MODE = {
        CBC_128_PKCS7Padding: "aes-128-cbc-pkcs7",
        ECB_128_NoPadding: "aes-128-ecb-nopad"
      };
      RSA_PADDING = { NoPadding: "no", PKCS1: "pkcs1" };
    }
  });

  // node_modules/pako/dist/pako.cjs.js
  var require_pako_cjs = __commonJS({
    "node_modules/pako/dist/pako.cjs.js"(exports) {
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      var Z_FIXED2 = 4;
      var Z_BINARY2 = 0;
      var Z_TEXT2 = 1;
      var Z_UNKNOWN2 = 2;
      function zero$12(buf) {
        let len = buf.length;
        while (--len >= 0) buf[len] = 0;
      }
      var STORED_BLOCK2 = 0;
      var STATIC_TREES2 = 1;
      var DYN_TREES2 = 2;
      var LENGTH_CODES2 = 29;
      var LITERALS2 = 256;
      var L_CODES2 = 286;
      var D_CODES2 = 30;
      var BL_CODES2 = 19;
      var HEAP_SIZE$12 = 573;
      var MAX_BITS2 = 15;
      var Buf_size2 = 16;
      var MAX_BL_BITS = 7;
      var END_BLOCK2 = 256;
      var REP_3_62 = 16;
      var REPZ_3_102 = 17;
      var REPZ_11_1382 = 18;
      var extra_lbits2 = new Uint8Array([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        2,
        2,
        2,
        2,
        3,
        3,
        3,
        3,
        4,
        4,
        4,
        4,
        5,
        5,
        5,
        5,
        0
      ]);
      var extra_dbits2 = new Uint8Array([
        0,
        0,
        0,
        0,
        1,
        1,
        2,
        2,
        3,
        3,
        4,
        4,
        5,
        5,
        6,
        6,
        7,
        7,
        8,
        8,
        9,
        9,
        10,
        10,
        11,
        11,
        12,
        12,
        13,
        13
      ]);
      var extra_blbits2 = new Uint8Array([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        3,
        7
      ]);
      var bl_order2 = new Uint8Array([
        16,
        17,
        18,
        0,
        8,
        7,
        9,
        6,
        10,
        5,
        11,
        4,
        12,
        3,
        13,
        2,
        14,
        1,
        15
      ]);
      var DIST_CODE_LEN2 = 512;
      var static_ltree2 = new Array(288 * 2);
      zero$12(static_ltree2);
      var static_dtree2 = new Array(D_CODES2 * 2);
      zero$12(static_dtree2);
      var _dist_code2 = new Array(DIST_CODE_LEN2);
      zero$12(_dist_code2);
      var _length_code2 = new Array(256);
      zero$12(_length_code2);
      var base_length2 = new Array(LENGTH_CODES2);
      zero$12(base_length2);
      var base_dist2 = new Array(D_CODES2);
      zero$12(base_dist2);
      var StaticTreeDesc = class {
        constructor(static_tree, extra_bits, extra_base, elems, max_length) {
          this.static_tree = static_tree;
          this.extra_bits = extra_bits;
          this.extra_base = extra_base;
          this.elems = elems;
          this.max_length = max_length;
          this.has_stree = static_tree && static_tree.length;
        }
      };
      var static_l_desc;
      var static_d_desc;
      var static_bl_desc;
      var TreeDesc = class {
        constructor(dyn_tree, stat_desc) {
          this.dyn_tree = dyn_tree;
          this.max_code = 0;
          this.stat_desc = stat_desc;
        }
      };
      var d_code2 = (dist) => {
        return dist < 256 ? _dist_code2[dist] : _dist_code2[256 + (dist >>> 7)];
      };
      var put_short2 = (s, w) => {
        s.pending_buf[s.pending++] = w & 255;
        s.pending_buf[s.pending++] = w >>> 8 & 255;
      };
      var send_bits2 = (s, value, length) => {
        if (s.bi_valid > Buf_size2 - length) {
          s.bi_buf |= value << s.bi_valid & 65535;
          put_short2(s, s.bi_buf);
          s.bi_buf = value >> Buf_size2 - s.bi_valid;
          s.bi_valid += length - Buf_size2;
        } else {
          s.bi_buf |= value << s.bi_valid & 65535;
          s.bi_valid += length;
        }
      };
      var send_code2 = (s, c, tree) => {
        send_bits2(s, tree[c * 2], tree[c * 2 + 1]);
      };
      var bi_reverse2 = (code, len) => {
        let res = 0;
        do {
          res |= code & 1;
          code >>>= 1;
          res <<= 1;
        } while (--len > 0);
        return res >>> 1;
      };
      var bi_flush = (s) => {
        if (s.bi_valid === 16) {
          put_short2(s, s.bi_buf);
          s.bi_buf = 0;
          s.bi_valid = 0;
        } else if (s.bi_valid >= 8) {
          s.pending_buf[s.pending++] = s.bi_buf & 255;
          s.bi_buf >>= 8;
          s.bi_valid -= 8;
        }
      };
      var gen_bitlen2 = (s, desc) => {
        const tree = desc.dyn_tree;
        const max_code = desc.max_code;
        const stree = desc.stat_desc.static_tree;
        const has_stree = desc.stat_desc.has_stree;
        const extra = desc.stat_desc.extra_bits;
        const base = desc.stat_desc.extra_base;
        const max_length = desc.stat_desc.max_length;
        let h;
        let n, m;
        let bits;
        let xbits;
        let f;
        let overflow = 0;
        for (bits = 0; bits <= MAX_BITS2; bits++) s.bl_count[bits] = 0;
        tree[s.heap[s.heap_max] * 2 + 1] = 0;
        for (h = s.heap_max + 1; h < HEAP_SIZE$12; h++) {
          n = s.heap[h];
          bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
          if (bits > max_length) {
            bits = max_length;
            overflow++;
          }
          tree[n * 2 + 1] = bits;
          if (n > max_code) continue;
          s.bl_count[bits]++;
          xbits = 0;
          if (n >= base) xbits = extra[n - base];
          f = tree[n * 2];
          s.opt_len += f * (bits + xbits);
          if (has_stree) s.static_len += f * (stree[n * 2 + 1] + xbits);
        }
        if (overflow === 0) return;
        do {
          bits = max_length - 1;
          while (s.bl_count[bits] === 0) bits--;
          s.bl_count[bits]--;
          s.bl_count[bits + 1] += 2;
          s.bl_count[max_length]--;
          overflow -= 2;
        } while (overflow > 0);
        for (bits = max_length; bits !== 0; bits--) {
          n = s.bl_count[bits];
          while (n !== 0) {
            m = s.heap[--h];
            if (m > max_code) continue;
            if (tree[m * 2 + 1] !== bits) {
              s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
              tree[m * 2 + 1] = bits;
            }
            n--;
          }
        }
      };
      var gen_codes2 = (tree, max_code, bl_count) => {
        const next_code = new Array(16);
        let code = 0;
        let bits;
        let n;
        for (bits = 1; bits <= MAX_BITS2; bits++) {
          code = code + bl_count[bits - 1] << 1;
          next_code[bits] = code;
        }
        for (n = 0; n <= max_code; n++) {
          let len = tree[n * 2 + 1];
          if (len === 0) continue;
          tree[n * 2] = bi_reverse2(next_code[len]++, len);
        }
      };
      var tr_static_init = () => {
        let n;
        let bits;
        let length;
        let code;
        let dist;
        const bl_count = new Array(16);
        length = 0;
        for (code = 0; code < LENGTH_CODES2 - 1; code++) {
          base_length2[code] = length;
          for (n = 0; n < 1 << extra_lbits2[code]; n++) _length_code2[length++] = code;
        }
        _length_code2[length - 1] = code;
        dist = 0;
        for (code = 0; code < 16; code++) {
          base_dist2[code] = dist;
          for (n = 0; n < 1 << extra_dbits2[code]; n++) _dist_code2[dist++] = code;
        }
        dist >>= 7;
        for (; code < D_CODES2; code++) {
          base_dist2[code] = dist << 7;
          for (n = 0; n < 1 << extra_dbits2[code] - 7; n++) _dist_code2[256 + dist++] = code;
        }
        for (bits = 0; bits <= MAX_BITS2; bits++) bl_count[bits] = 0;
        n = 0;
        while (n <= 143) {
          static_ltree2[n * 2 + 1] = 8;
          n++;
          bl_count[8]++;
        }
        while (n <= 255) {
          static_ltree2[n * 2 + 1] = 9;
          n++;
          bl_count[9]++;
        }
        while (n <= 279) {
          static_ltree2[n * 2 + 1] = 7;
          n++;
          bl_count[7]++;
        }
        while (n <= 287) {
          static_ltree2[n * 2 + 1] = 8;
          n++;
          bl_count[8]++;
        }
        gen_codes2(static_ltree2, 287, bl_count);
        for (n = 0; n < D_CODES2; n++) {
          static_dtree2[n * 2 + 1] = 5;
          static_dtree2[n * 2] = bi_reverse2(n, 5);
        }
        static_l_desc = new StaticTreeDesc(static_ltree2, extra_lbits2, 257, L_CODES2, MAX_BITS2);
        static_d_desc = new StaticTreeDesc(static_dtree2, extra_dbits2, 0, D_CODES2, MAX_BITS2);
        static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits2, 0, BL_CODES2, MAX_BL_BITS);
      };
      var init_block2 = (s) => {
        let n;
        for (n = 0; n < L_CODES2; n++) s.dyn_ltree[n * 2] = 0;
        for (n = 0; n < D_CODES2; n++) s.dyn_dtree[n * 2] = 0;
        for (n = 0; n < BL_CODES2; n++) s.bl_tree[n * 2] = 0;
        s.dyn_ltree[END_BLOCK2 * 2] = 1;
        s.opt_len = s.static_len = 0;
        s.sym_next = s.matches = 0;
      };
      var bi_windup2 = (s) => {
        if (s.bi_valid > 8) put_short2(s, s.bi_buf);
        else if (s.bi_valid > 0) s.pending_buf[s.pending++] = s.bi_buf;
        s.bi_buf = 0;
        s.bi_valid = 0;
      };
      var smaller2 = (tree, n, m, depth) => {
        const _n2 = n * 2;
        const _m2 = m * 2;
        return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
      };
      var pqdownheap2 = (s, tree, k) => {
        const v = s.heap[k];
        let j = k << 1;
        while (j <= s.heap_len) {
          if (j < s.heap_len && smaller2(tree, s.heap[j + 1], s.heap[j], s.depth)) j++;
          if (smaller2(tree, v, s.heap[j], s.depth)) break;
          s.heap[k] = s.heap[j];
          k = j;
          j <<= 1;
        }
        s.heap[k] = v;
      };
      var compress_block2 = (s, ltree, dtree) => {
        let dist;
        let lc;
        let sx = 0;
        let code;
        let extra;
        if (s.sym_next !== 0) do {
          dist = s.pending_buf[s.sym_buf + sx++] & 255;
          dist += (s.pending_buf[s.sym_buf + sx++] & 255) << 8;
          lc = s.pending_buf[s.sym_buf + sx++];
          if (dist === 0) send_code2(s, lc, ltree);
          else {
            code = _length_code2[lc];
            send_code2(s, code + LITERALS2 + 1, ltree);
            extra = extra_lbits2[code];
            if (extra !== 0) {
              lc -= base_length2[code];
              send_bits2(s, lc, extra);
            }
            dist--;
            code = d_code2(dist);
            send_code2(s, code, dtree);
            extra = extra_dbits2[code];
            if (extra !== 0) {
              dist -= base_dist2[code];
              send_bits2(s, dist, extra);
            }
          }
        } while (sx < s.sym_next);
        send_code2(s, END_BLOCK2, ltree);
      };
      var build_tree2 = (s, desc) => {
        const tree = desc.dyn_tree;
        const stree = desc.stat_desc.static_tree;
        const has_stree = desc.stat_desc.has_stree;
        const elems = desc.stat_desc.elems;
        let n, m;
        let max_code = -1;
        let node;
        s.heap_len = 0;
        s.heap_max = HEAP_SIZE$12;
        for (n = 0; n < elems; n++) if (tree[n * 2] !== 0) {
          s.heap[++s.heap_len] = max_code = n;
          s.depth[n] = 0;
        } else tree[n * 2 + 1] = 0;
        while (s.heap_len < 2) {
          node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
          tree[node * 2] = 1;
          s.depth[node] = 0;
          s.opt_len--;
          if (has_stree) s.static_len -= stree[node * 2 + 1];
        }
        desc.max_code = max_code;
        for (n = s.heap_len >> 1; n >= 1; n--) pqdownheap2(s, tree, n);
        node = elems;
        do {
          n = s.heap[1];
          s.heap[1] = s.heap[s.heap_len--];
          pqdownheap2(s, tree, 1);
          m = s.heap[1];
          s.heap[--s.heap_max] = n;
          s.heap[--s.heap_max] = m;
          tree[node * 2] = tree[n * 2] + tree[m * 2];
          s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
          tree[n * 2 + 1] = tree[m * 2 + 1] = node;
          s.heap[1] = node++;
          pqdownheap2(s, tree, 1);
        } while (s.heap_len >= 2);
        s.heap[--s.heap_max] = s.heap[1];
        gen_bitlen2(s, desc);
        gen_codes2(tree, max_code, s.bl_count);
      };
      var scan_tree2 = (s, tree, max_code) => {
        let n;
        let prevlen = -1;
        let curlen;
        let nextlen = tree[1];
        let count = 0;
        let max_count = 7;
        let min_count = 4;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }
        tree[(max_code + 1) * 2 + 1] = 65535;
        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];
          if (++count < max_count && curlen === nextlen) continue;
          else if (count < min_count) s.bl_tree[curlen * 2] += count;
          else if (curlen !== 0) {
            if (curlen !== prevlen) s.bl_tree[curlen * 2]++;
            s.bl_tree[REP_3_62 * 2]++;
          } else if (count <= 10) s.bl_tree[REPZ_3_102 * 2]++;
          else s.bl_tree[REPZ_11_1382 * 2]++;
          count = 0;
          prevlen = curlen;
          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      };
      var send_tree2 = (s, tree, max_code) => {
        let n;
        let prevlen = -1;
        let curlen;
        let nextlen = tree[1];
        let count = 0;
        let max_count = 7;
        let min_count = 4;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }
        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];
          if (++count < max_count && curlen === nextlen) continue;
          else if (count < min_count) do
            send_code2(s, curlen, s.bl_tree);
          while (--count !== 0);
          else if (curlen !== 0) {
            if (curlen !== prevlen) {
              send_code2(s, curlen, s.bl_tree);
              count--;
            }
            send_code2(s, REP_3_62, s.bl_tree);
            send_bits2(s, count - 3, 2);
          } else if (count <= 10) {
            send_code2(s, REPZ_3_102, s.bl_tree);
            send_bits2(s, count - 3, 3);
          } else {
            send_code2(s, REPZ_11_1382, s.bl_tree);
            send_bits2(s, count - 11, 7);
          }
          count = 0;
          prevlen = curlen;
          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      };
      var build_bl_tree2 = (s) => {
        let max_blindex;
        scan_tree2(s, s.dyn_ltree, s.l_desc.max_code);
        scan_tree2(s, s.dyn_dtree, s.d_desc.max_code);
        build_tree2(s, s.bl_desc);
        for (max_blindex = BL_CODES2 - 1; max_blindex >= 3; max_blindex--) if (s.bl_tree[bl_order2[max_blindex] * 2 + 1] !== 0) break;
        s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
        return max_blindex;
      };
      var send_all_trees2 = (s, lcodes, dcodes, blcodes) => {
        let rank2;
        send_bits2(s, lcodes - 257, 5);
        send_bits2(s, dcodes - 1, 5);
        send_bits2(s, blcodes - 4, 4);
        for (rank2 = 0; rank2 < blcodes; rank2++) send_bits2(s, s.bl_tree[bl_order2[rank2] * 2 + 1], 3);
        send_tree2(s, s.dyn_ltree, lcodes - 1);
        send_tree2(s, s.dyn_dtree, dcodes - 1);
      };
      var detect_data_type2 = (s) => {
        let block_mask = 4093624447;
        let n;
        for (n = 0; n <= 31; n++, block_mask >>>= 1) if (block_mask & 1 && s.dyn_ltree[n * 2] !== 0) return Z_BINARY2;
        if (s.dyn_ltree[18] !== 0 || s.dyn_ltree[20] !== 0 || s.dyn_ltree[26] !== 0) return Z_TEXT2;
        for (n = 32; n < LITERALS2; n++) if (s.dyn_ltree[n * 2] !== 0) return Z_TEXT2;
        return Z_BINARY2;
      };
      var static_init_done = false;
      var _tr_init = (s) => {
        if (!static_init_done) {
          tr_static_init();
          static_init_done = true;
        }
        s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
        s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
        s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
        s.bi_buf = 0;
        s.bi_valid = 0;
        init_block2(s);
      };
      var _tr_stored_block2 = (s, buf, stored_len, last) => {
        send_bits2(s, (STORED_BLOCK2 << 1) + (last ? 1 : 0), 3);
        bi_windup2(s);
        put_short2(s, stored_len);
        put_short2(s, ~stored_len);
        if (stored_len) s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
        s.pending += stored_len;
      };
      var _tr_align = (s) => {
        send_bits2(s, STATIC_TREES2 << 1, 3);
        send_code2(s, END_BLOCK2, static_ltree2);
        bi_flush(s);
      };
      var _tr_flush_block2 = (s, buf, stored_len, last) => {
        let opt_lenb, static_lenb;
        let max_blindex = 0;
        if (s.level > 0) {
          if (s.strm.data_type === Z_UNKNOWN2) s.strm.data_type = detect_data_type2(s);
          build_tree2(s, s.l_desc);
          build_tree2(s, s.d_desc);
          max_blindex = build_bl_tree2(s);
          opt_lenb = s.opt_len + 3 + 7 >>> 3;
          static_lenb = s.static_len + 3 + 7 >>> 3;
          if (static_lenb <= opt_lenb || s.strategy === Z_FIXED2) opt_lenb = static_lenb;
        } else opt_lenb = static_lenb = stored_len + 5;
        if (stored_len + 4 <= opt_lenb && buf !== -1) _tr_stored_block2(s, buf, stored_len, last);
        else if (s.strategy === Z_FIXED2 || static_lenb === opt_lenb) {
          send_bits2(s, (STATIC_TREES2 << 1) + (last ? 1 : 0), 3);
          compress_block2(s, static_ltree2, static_dtree2);
        } else {
          send_bits2(s, (DYN_TREES2 << 1) + (last ? 1 : 0), 3);
          send_all_trees2(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
          compress_block2(s, s.dyn_ltree, s.dyn_dtree);
        }
        init_block2(s);
        if (last) bi_windup2(s);
      };
      var _tr_tally2 = (s, dist, lc) => {
        s.pending_buf[s.sym_buf + s.sym_next++] = dist;
        s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
        s.pending_buf[s.sym_buf + s.sym_next++] = lc;
        if (dist === 0) s.dyn_ltree[lc * 2]++;
        else {
          s.matches++;
          dist--;
          s.dyn_ltree[(_length_code2[lc] + LITERALS2 + 1) * 2]++;
          s.dyn_dtree[d_code2(dist) * 2]++;
        }
        return s.sym_next === s.sym_end;
      };
      var adler322 = (adler, buf, len, pos) => {
        let s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
        while (len !== 0) {
          n = len > 2e3 ? 2e3 : len;
          len -= n;
          do {
            s1 = s1 + buf[pos++] | 0;
            s2 = s2 + s1 | 0;
          } while (--n);
          s1 %= 65521;
          s2 %= 65521;
        }
        return s1 | s2 << 16 | 0;
      };
      var makeTable2 = () => {
        let c, table = [];
        for (var n = 0; n < 256; n++) {
          c = n;
          for (var k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
          table[n] = c;
        }
        return table;
      };
      var crcTable2 = new Uint32Array(makeTable2());
      var crc322 = (crc, buf, len, pos) => {
        const t = crcTable2;
        const end = pos + len;
        crc ^= -1;
        for (let i = pos; i < end; i++) crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
        return crc ^ -1;
      };
      var messages_default2 = {
        2: "need dictionary",
        1: "stream end",
        0: "",
        "-1": "file error",
        "-2": "stream error",
        "-3": "data error",
        "-4": "insufficient memory",
        "-5": "buffer error",
        "-6": "incompatible version"
      };
      var Z_NO_FLUSH = 0;
      var Z_PARTIAL_FLUSH = 1;
      var Z_SYNC_FLUSH = 2;
      var Z_FULL_FLUSH = 3;
      var Z_FINISH = 4;
      var Z_BLOCK = 5;
      var Z_TREES = 6;
      var Z_OK = 0;
      var Z_STREAM_END = 1;
      var Z_NEED_DICT = 2;
      var Z_ERRNO = -1;
      var Z_STREAM_ERROR = -2;
      var Z_DATA_ERROR = -3;
      var Z_MEM_ERROR = -4;
      var Z_BUF_ERROR = -5;
      var MAX_MEM_LEVEL = 9;
      var MAX_WBITS = 15;
      var DEF_MEM_LEVEL = 8;
      var HEAP_SIZE = 573;
      var MIN_MATCH2 = 3;
      var MAX_MATCH2 = 258;
      var MIN_LOOKAHEAD2 = 262;
      var PRESET_DICT = 32;
      var INIT_STATE = 42;
      var GZIP_STATE = 57;
      var EXTRA_STATE = 69;
      var NAME_STATE = 73;
      var COMMENT_STATE = 91;
      var HCRC_STATE = 103;
      var BUSY_STATE = 113;
      var FINISH_STATE = 666;
      var BS_NEED_MORE2 = 1;
      var BS_BLOCK_DONE2 = 2;
      var BS_FINISH_STARTED2 = 3;
      var BS_FINISH_DONE2 = 4;
      var OS_CODE = 3;
      var err = (strm, errorCode) => {
        strm.msg = messages_default2[errorCode];
        return errorCode;
      };
      var rank = (f) => {
        return f * 2 - (f > 4 ? 9 : 0);
      };
      var zero = (buf) => {
        let len = buf.length;
        while (--len >= 0) buf[len] = 0;
      };
      var slide_hash2 = (s) => {
        let n, m;
        let p;
        let wsize = s.w_size;
        n = s.hash_size;
        p = n;
        do {
          m = s.head[--p];
          s.head[p] = m >= wsize ? m - wsize : 0;
        } while (--n);
        n = wsize;
        p = n;
        do {
          m = s.prev[--p];
          s.prev[p] = m >= wsize ? m - wsize : 0;
        } while (--n);
      };
      var HASH2 = (s, prev, data) => (prev << s.hash_shift ^ data) & s.hash_mask;
      var INSERT_STRING2 = (s, str) => {
        let h;
        if (s.legacy_hash) h = s.ins_h = HASH2(s, s.ins_h, s.window[str + MIN_MATCH2 - 1]);
        else {
          const w = s.window;
          const value = w[str] | w[str + 1] << 8 | w[str + 2] << 16 | w[str + 3] << 24;
          h = s.ins_h = Math.imul(value, 66521) + 66521 >>> 16 & s.hash_mask;
        }
        const hash_head = s.prev[str & s.w_mask] = s.head[h];
        s.head[h] = str;
        return hash_head;
      };
      var flush_pending2 = (strm) => {
        const s = strm.state;
        let len = s.pending;
        if (len > strm.avail_out) len = strm.avail_out;
        if (len === 0) return;
        strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
        strm.next_out += len;
        s.pending_out += len;
        strm.total_out += len;
        strm.avail_out -= len;
        s.pending -= len;
        if (s.pending === 0) s.pending_out = 0;
      };
      var flush_block_only2 = (s, last) => {
        _tr_flush_block2(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
        s.block_start = s.strstart;
        flush_pending2(s.strm);
      };
      var put_byte = (s, b) => {
        s.pending_buf[s.pending++] = b;
      };
      var putShortMSB = (s, b) => {
        s.pending_buf[s.pending++] = b >>> 8 & 255;
        s.pending_buf[s.pending++] = b & 255;
      };
      var read_buf2 = (strm, buf, start, size) => {
        let len = strm.avail_in;
        if (len > size) len = size;
        if (len === 0) return 0;
        strm.avail_in -= len;
        buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
        if (strm.state.wrap === 1) strm.adler = adler322(strm.adler, buf, len, start);
        else if (strm.state.wrap === 2) strm.adler = crc322(strm.adler, buf, len, start);
        strm.next_in += len;
        strm.total_in += len;
        return len;
      };
      var longest_match2 = (s, cur_match) => {
        let chain_length = s.max_chain_length;
        let scan = s.strstart;
        let match;
        let len;
        let best_len = s.prev_length;
        let nice_match = s.nice_match;
        const limit = s.strstart > s.w_size - MIN_LOOKAHEAD2 ? s.strstart - (s.w_size - MIN_LOOKAHEAD2) : 0;
        const _win = s.window;
        const wmask = s.w_mask;
        const prev = s.prev;
        const strend = s.strstart + MAX_MATCH2;
        let scan_end1 = _win[scan + best_len - 1];
        let scan_end = _win[scan + best_len];
        if (s.prev_length >= s.good_match) chain_length >>= 2;
        if (nice_match > s.lookahead) nice_match = s.lookahead;
        do {
          match = cur_match;
          if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) continue;
          scan += 2;
          match++;
          do
            ;
          while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
          len = MAX_MATCH2 - (strend - scan);
          scan = strend - MAX_MATCH2;
          if (len > best_len) {
            s.match_start = cur_match;
            best_len = len;
            if (len >= nice_match) break;
            scan_end1 = _win[scan + best_len - 1];
            scan_end = _win[scan + best_len];
          }
        } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
        if (best_len <= s.lookahead) return best_len;
        return s.lookahead;
      };
      var fill_window2 = (s) => {
        const _w_size = s.w_size;
        let n, more, str;
        do {
          more = s.window_size - s.lookahead - s.strstart;
          if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD2)) {
            s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
            s.match_start -= _w_size;
            s.strstart -= _w_size;
            s.block_start -= _w_size;
            if (s.insert > s.strstart) s.insert = s.strstart;
            slide_hash2(s);
            more += _w_size;
          }
          if (s.strm.avail_in === 0) break;
          n = read_buf2(s.strm, s.window, s.strstart + s.lookahead, more);
          s.lookahead += n;
          if (!s.legacy_hash) {
            if (s.lookahead + s.insert > MIN_MATCH2) {
              str = s.strstart - s.insert;
              while (s.insert) {
                INSERT_STRING2(s, str);
                str++;
                s.insert--;
                if (s.lookahead + s.insert <= MIN_MATCH2) break;
              }
            }
          } else if (s.lookahead + s.insert >= MIN_MATCH2) {
            str = s.strstart - s.insert;
            s.ins_h = s.window[str];
            s.ins_h = HASH2(s, s.ins_h, s.window[str + 1]);
            while (s.insert) {
              INSERT_STRING2(s, str);
              str++;
              s.insert--;
              if (s.lookahead + s.insert < MIN_MATCH2) break;
            }
          }
        } while (s.lookahead < MIN_LOOKAHEAD2 && s.strm.avail_in !== 0);
      };
      var deflate_stored2 = (s, flush) => {
        let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;
        let len, left, have, last = 0;
        let used = s.strm.avail_in;
        do {
          len = 65535;
          have = s.bi_valid + 42 >> 3;
          if (s.strm.avail_out < have) break;
          have = s.strm.avail_out - have;
          left = s.strstart - s.block_start;
          if (len > left + s.strm.avail_in) len = left + s.strm.avail_in;
          if (len > have) len = have;
          if (len < min_block && (len === 0 && flush !== 4 || flush === 0 || len !== left + s.strm.avail_in)) break;
          last = flush === 4 && len === left + s.strm.avail_in ? 1 : 0;
          _tr_stored_block2(s, 0, 0, last);
          s.pending_buf[s.pending - 4] = len;
          s.pending_buf[s.pending - 3] = len >> 8;
          s.pending_buf[s.pending - 2] = ~len;
          s.pending_buf[s.pending - 1] = ~len >> 8;
          flush_pending2(s.strm);
          if (left) {
            if (left > len) left = len;
            s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
            s.strm.next_out += left;
            s.strm.avail_out -= left;
            s.strm.total_out += left;
            s.block_start += left;
            len -= left;
          }
          if (len) {
            read_buf2(s.strm, s.strm.output, s.strm.next_out, len);
            s.strm.next_out += len;
            s.strm.avail_out -= len;
            s.strm.total_out += len;
          }
        } while (last === 0);
        used -= s.strm.avail_in;
        if (used) {
          if (used >= s.w_size) {
            s.matches = 2;
            s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
            s.strstart = s.w_size;
            s.insert = s.strstart;
          } else {
            if (s.window_size - s.strstart <= used) {
              s.strstart -= s.w_size;
              s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
              if (s.matches < 2) s.matches++;
              if (s.insert > s.strstart) s.insert = s.strstart;
            }
            s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
            s.strstart += used;
            s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
          }
          s.block_start = s.strstart;
        }
        if (s.high_water < s.strstart) s.high_water = s.strstart;
        if (last) return BS_FINISH_DONE2;
        if (flush !== 0 && flush !== 4 && s.strm.avail_in === 0 && s.strstart === s.block_start) return BS_BLOCK_DONE2;
        have = s.window_size - s.strstart;
        if (s.strm.avail_in > have && s.block_start >= s.w_size) {
          s.block_start -= s.w_size;
          s.strstart -= s.w_size;
          s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
          if (s.matches < 2) s.matches++;
          have += s.w_size;
          if (s.insert > s.strstart) s.insert = s.strstart;
        }
        if (have > s.strm.avail_in) have = s.strm.avail_in;
        if (have) {
          read_buf2(s.strm, s.window, s.strstart, have);
          s.strstart += have;
          s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
        }
        if (s.high_water < s.strstart) s.high_water = s.strstart;
        have = s.bi_valid + 42 >> 3;
        have = s.pending_buf_size - have > 65535 ? 65535 : s.pending_buf_size - have;
        min_block = have > s.w_size ? s.w_size : have;
        left = s.strstart - s.block_start;
        if (left >= min_block || (left || flush === 4) && flush !== 0 && s.strm.avail_in === 0 && left <= have) {
          len = left > have ? have : left;
          last = flush === 4 && s.strm.avail_in === 0 && len === left ? 1 : 0;
          _tr_stored_block2(s, s.block_start, len, last);
          s.block_start += len;
          flush_pending2(s.strm);
        }
        return last ? BS_FINISH_STARTED2 : BS_NEED_MORE2;
      };
      var deflate_fast2 = (s, flush) => {
        let hash_head;
        let bflush;
        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD2) {
            fill_window2(s);
            if (s.lookahead < MIN_LOOKAHEAD2 && flush === 0) return BS_NEED_MORE2;
            if (s.lookahead === 0) break;
          }
          hash_head = 0;
          if (s.lookahead >= MIN_MATCH2) hash_head = INSERT_STRING2(s, s.strstart);
          if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD2) s.match_length = longest_match2(s, hash_head);
          if (s.match_length >= MIN_MATCH2) {
            bflush = _tr_tally2(s, s.strstart - s.match_start, s.match_length - MIN_MATCH2);
            s.lookahead -= s.match_length;
            if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH2) {
              s.match_length--;
              do {
                s.strstart++;
                hash_head = INSERT_STRING2(s, s.strstart);
              } while (--s.match_length !== 0);
              s.strstart++;
            } else {
              s.strstart += s.match_length;
              s.match_length = 0;
              if (s.legacy_hash) {
                s.ins_h = s.window[s.strstart];
                s.ins_h = HASH2(s, s.ins_h, s.window[s.strstart + 1]);
              }
            }
          } else {
            bflush = _tr_tally2(s, 0, s.window[s.strstart]);
            s.lookahead--;
            s.strstart++;
          }
          if (bflush) {
            flush_block_only2(s, false);
            if (s.strm.avail_out === 0) return BS_NEED_MORE2;
          }
        }
        s.insert = s.strstart < MIN_MATCH2 - 1 ? s.strstart : MIN_MATCH2 - 1;
        if (flush === 4) {
          flush_block_only2(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED2;
          return BS_FINISH_DONE2;
        }
        if (s.sym_next) {
          flush_block_only2(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE2;
        }
        return BS_BLOCK_DONE2;
      };
      var deflate_slow2 = (s, flush) => {
        let hash_head;
        let bflush;
        let max_insert;
        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD2) {
            fill_window2(s);
            if (s.lookahead < MIN_LOOKAHEAD2 && flush === 0) return BS_NEED_MORE2;
            if (s.lookahead === 0) break;
          }
          hash_head = 0;
          if (s.lookahead >= MIN_MATCH2) hash_head = INSERT_STRING2(s, s.strstart);
          s.prev_length = s.match_length;
          s.prev_match = s.match_start;
          s.match_length = MIN_MATCH2 - 1;
          if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD2) {
            s.match_length = longest_match2(s, hash_head);
            if (s.match_length <= 5 && (s.strategy === 1 || s.match_length === MIN_MATCH2 && s.strstart - s.match_start > 4096)) s.match_length = MIN_MATCH2 - 1;
          }
          if (s.prev_length >= MIN_MATCH2 && s.match_length <= s.prev_length) {
            max_insert = s.strstart + s.lookahead - MIN_MATCH2;
            bflush = _tr_tally2(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH2);
            s.lookahead -= s.prev_length - 1;
            s.prev_length -= 2;
            do
              if (++s.strstart <= max_insert) hash_head = INSERT_STRING2(s, s.strstart);
            while (--s.prev_length !== 0);
            s.match_available = 0;
            s.match_length = MIN_MATCH2 - 1;
            s.strstart++;
            if (bflush) {
              flush_block_only2(s, false);
              if (s.strm.avail_out === 0) return BS_NEED_MORE2;
            }
          } else if (s.match_available) {
            bflush = _tr_tally2(s, 0, s.window[s.strstart - 1]);
            if (bflush)
              flush_block_only2(s, false);
            s.strstart++;
            s.lookahead--;
            if (s.strm.avail_out === 0) return BS_NEED_MORE2;
          } else {
            s.match_available = 1;
            s.strstart++;
            s.lookahead--;
          }
        }
        if (s.match_available) {
          bflush = _tr_tally2(s, 0, s.window[s.strstart - 1]);
          s.match_available = 0;
        }
        s.insert = s.strstart < MIN_MATCH2 - 1 ? s.strstart : MIN_MATCH2 - 1;
        if (flush === 4) {
          flush_block_only2(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED2;
          return BS_FINISH_DONE2;
        }
        if (s.sym_next) {
          flush_block_only2(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE2;
        }
        return BS_BLOCK_DONE2;
      };
      var deflate_rle = (s, flush) => {
        let bflush;
        let prev;
        let scan, strend;
        const _win = s.window;
        for (; ; ) {
          if (s.lookahead <= MAX_MATCH2) {
            fill_window2(s);
            if (s.lookahead <= MAX_MATCH2 && flush === 0) return BS_NEED_MORE2;
            if (s.lookahead === 0) break;
          }
          s.match_length = 0;
          if (s.lookahead >= MIN_MATCH2 && s.strstart > 0) {
            scan = s.strstart - 1;
            prev = _win[scan];
            if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
              strend = s.strstart + MAX_MATCH2;
              do
                ;
              while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);
              s.match_length = MAX_MATCH2 - (strend - scan);
              if (s.match_length > s.lookahead) s.match_length = s.lookahead;
            }
          }
          if (s.match_length >= MIN_MATCH2) {
            bflush = _tr_tally2(s, 1, s.match_length - MIN_MATCH2);
            s.lookahead -= s.match_length;
            s.strstart += s.match_length;
            s.match_length = 0;
          } else {
            bflush = _tr_tally2(s, 0, s.window[s.strstart]);
            s.lookahead--;
            s.strstart++;
          }
          if (bflush) {
            flush_block_only2(s, false);
            if (s.strm.avail_out === 0) return BS_NEED_MORE2;
          }
        }
        s.insert = 0;
        if (flush === 4) {
          flush_block_only2(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED2;
          return BS_FINISH_DONE2;
        }
        if (s.sym_next) {
          flush_block_only2(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE2;
        }
        return BS_BLOCK_DONE2;
      };
      var deflate_huff = (s, flush) => {
        let bflush;
        for (; ; ) {
          if (s.lookahead === 0) {
            fill_window2(s);
            if (s.lookahead === 0) {
              if (flush === 0) return BS_NEED_MORE2;
              break;
            }
          }
          s.match_length = 0;
          bflush = _tr_tally2(s, 0, s.window[s.strstart]);
          s.lookahead--;
          s.strstart++;
          if (bflush) {
            flush_block_only2(s, false);
            if (s.strm.avail_out === 0) return BS_NEED_MORE2;
          }
        }
        s.insert = 0;
        if (flush === 4) {
          flush_block_only2(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED2;
          return BS_FINISH_DONE2;
        }
        if (s.sym_next) {
          flush_block_only2(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE2;
        }
        return BS_BLOCK_DONE2;
      };
      var Config2 = class {
        constructor(good_length, max_lazy, nice_length, max_chain, func) {
          this.good_length = good_length;
          this.max_lazy = max_lazy;
          this.nice_length = nice_length;
          this.max_chain = max_chain;
          this.func = func;
        }
      };
      var configuration_table2 = [
        new Config2(0, 0, 0, 0, deflate_stored2),
        new Config2(4, 4, 8, 4, deflate_fast2),
        new Config2(4, 5, 16, 8, deflate_fast2),
        new Config2(4, 6, 32, 32, deflate_fast2),
        new Config2(4, 4, 16, 16, deflate_slow2),
        new Config2(8, 16, 32, 32, deflate_slow2),
        new Config2(8, 16, 128, 128, deflate_slow2),
        new Config2(8, 32, 128, 256, deflate_slow2),
        new Config2(32, 128, 258, 1024, deflate_slow2),
        new Config2(32, 258, 258, 4096, deflate_slow2)
      ];
      var lm_init = (s) => {
        s.window_size = 2 * s.w_size;
        zero(s.head);
        s.max_lazy_match = configuration_table2[s.level].max_lazy;
        s.good_match = configuration_table2[s.level].good_length;
        s.nice_match = configuration_table2[s.level].nice_length;
        s.max_chain_length = configuration_table2[s.level].max_chain;
        s.strstart = 0;
        s.block_start = 0;
        s.lookahead = 0;
        s.insert = 0;
        s.match_length = s.prev_length = MIN_MATCH2 - 1;
        s.match_available = 0;
        s.ins_h = 0;
      };
      var DeflateState = class {
        constructor() {
          this.strm = null;
          this.status = 0;
          this.pending_buf = null;
          this.pending_buf_size = 0;
          this.pending_out = 0;
          this.pending = 0;
          this.wrap = 0;
          this.gzhead = null;
          this.gzindex = 0;
          this.method = 8;
          this.last_flush = -1;
          this.w_size = 0;
          this.w_bits = 0;
          this.w_mask = 0;
          this.window = null;
          this.window_size = 0;
          this.prev = null;
          this.head = null;
          this.ins_h = 0;
          this.legacy_hash = 0;
          this.hash_size = 0;
          this.hash_bits = 0;
          this.hash_mask = 0;
          this.hash_shift = 0;
          this.block_start = 0;
          this.match_length = 0;
          this.prev_match = 0;
          this.match_available = 0;
          this.strstart = 0;
          this.match_start = 0;
          this.lookahead = 0;
          this.prev_length = 0;
          this.max_chain_length = 0;
          this.max_lazy_match = 0;
          this.level = 0;
          this.strategy = 0;
          this.good_match = 0;
          this.nice_match = 0;
          this.dyn_ltree = new Uint16Array(HEAP_SIZE * 2);
          this.dyn_dtree = /* @__PURE__ */ new Uint16Array(122);
          this.bl_tree = /* @__PURE__ */ new Uint16Array(78);
          zero(this.dyn_ltree);
          zero(this.dyn_dtree);
          zero(this.bl_tree);
          this.l_desc = null;
          this.d_desc = null;
          this.bl_desc = null;
          this.bl_count = /* @__PURE__ */ new Uint16Array(16);
          this.heap = /* @__PURE__ */ new Uint16Array(573);
          zero(this.heap);
          this.heap_len = 0;
          this.heap_max = 0;
          this.depth = /* @__PURE__ */ new Uint16Array(573);
          zero(this.depth);
          this.sym_buf = 0;
          this.lit_bufsize = 0;
          this.sym_next = 0;
          this.sym_end = 0;
          this.opt_len = 0;
          this.static_len = 0;
          this.matches = 0;
          this.insert = 0;
          this.bi_buf = 0;
          this.bi_valid = 0;
        }
      };
      var deflateStateCheck = (strm) => {
        if (!strm) return 1;
        const s = strm.state;
        if (!s || s.strm !== strm || s.status !== INIT_STATE && s.status !== GZIP_STATE && s.status !== EXTRA_STATE && s.status !== NAME_STATE && s.status !== COMMENT_STATE && s.status !== HCRC_STATE && s.status !== BUSY_STATE && s.status !== FINISH_STATE) return 1;
        return 0;
      };
      var deflateResetKeep = (strm) => {
        if (deflateStateCheck(strm)) return err(strm, -2);
        strm.total_in = strm.total_out = 0;
        strm.data_type = 2;
        const s = strm.state;
        s.pending = 0;
        s.pending_out = 0;
        if (s.wrap < 0) s.wrap = -s.wrap;
        s.status = s.wrap === 2 ? GZIP_STATE : s.wrap ? INIT_STATE : BUSY_STATE;
        strm.adler = s.wrap === 2 ? 0 : 1;
        s.last_flush = -2;
        _tr_init(s);
        return 0;
      };
      var deflateReset = (strm) => {
        const ret = deflateResetKeep(strm);
        if (ret === 0) lm_init(strm.state);
        return ret;
      };
      var deflateSetHeader = (strm, head) => {
        if (deflateStateCheck(strm) || strm.state.wrap !== 2) return -2;
        strm.state.gzhead = head;
        return 0;
      };
      var deflateInit2 = (strm, level, method, windowBits, memLevel, strategy, legacyHash) => {
        if (!strm) return -2;
        let wrap = 1;
        if (level === -1) level = 6;
        if (windowBits < 0) {
          wrap = 0;
          windowBits = -windowBits;
        } else if (windowBits > 15) {
          wrap = 2;
          windowBits -= 16;
        }
        if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== 8 || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > 4 || windowBits === 8 && wrap !== 1) return err(strm, -2);
        if (windowBits === 8) windowBits = 9;
        const s = new DeflateState();
        strm.state = s;
        s.strm = strm;
        s.status = INIT_STATE;
        s.wrap = wrap;
        s.gzhead = null;
        s.w_bits = windowBits;
        s.w_size = 1 << s.w_bits;
        s.w_mask = s.w_size - 1;
        s.legacy_hash = legacyHash ? 1 : 0;
        s.hash_bits = memLevel + 7;
        if (!s.legacy_hash && s.hash_bits < 15) s.hash_bits = 15;
        s.hash_size = 1 << s.hash_bits;
        s.hash_mask = s.hash_size - 1;
        s.hash_shift = ~~((s.hash_bits + MIN_MATCH2 - 1) / MIN_MATCH2);
        s.window = new Uint8Array(s.w_size * 2);
        s.head = new Uint16Array(s.hash_size);
        s.prev = new Uint16Array(s.w_size);
        s.lit_bufsize = 1 << memLevel + 6;
        s.pending_buf_size = s.lit_bufsize * 4;
        s.pending_buf = new Uint8Array(s.pending_buf_size);
        s.sym_buf = s.lit_bufsize;
        s.sym_end = (s.lit_bufsize - 1) * 3;
        s.level = level;
        s.strategy = strategy;
        s.method = method;
        return deflateReset(strm);
      };
      var deflateInit = (strm, level) => {
        return deflateInit2(strm, level, 8, MAX_WBITS, DEF_MEM_LEVEL, 0);
      };
      var deflate$1 = (strm, flush) => {
        if (deflateStateCheck(strm) || flush > 5 || flush < 0) return strm ? err(strm, -2) : -2;
        const s = strm.state;
        if (!strm.output || strm.avail_in !== 0 && !strm.input || s.status === FINISH_STATE && flush !== 4) return err(strm, strm.avail_out === 0 ? -5 : -2);
        const old_flush = s.last_flush;
        s.last_flush = flush;
        if (s.pending !== 0) {
          flush_pending2(strm);
          if (strm.avail_out === 0) {
            s.last_flush = -1;
            return 0;
          }
        } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== 4) return err(strm, -5);
        if (s.status === FINISH_STATE && strm.avail_in !== 0) return err(strm, -5);
        if (s.status === INIT_STATE && s.wrap === 0) s.status = BUSY_STATE;
        if (s.status === INIT_STATE) {
          let header = 8 + (s.w_bits - 8 << 4) << 8;
          let level_flags = -1;
          if (s.strategy >= 2 || s.level < 2) level_flags = 0;
          else if (s.level < 6) level_flags = 1;
          else if (s.level === 6) level_flags = 2;
          else level_flags = 3;
          header |= level_flags << 6;
          if (s.strstart !== 0) header |= PRESET_DICT;
          header += 31 - header % 31;
          putShortMSB(s, header);
          if (s.strstart !== 0) {
            putShortMSB(s, strm.adler >>> 16);
            putShortMSB(s, strm.adler & 65535);
          }
          strm.adler = 1;
          s.status = BUSY_STATE;
          flush_pending2(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return 0;
          }
        }
        if (s.status === GZIP_STATE) {
          strm.adler = 0;
          put_byte(s, 31);
          put_byte(s, 139);
          put_byte(s, 8);
          if (!s.gzhead) {
            put_byte(s, 0);
            put_byte(s, 0);
            put_byte(s, 0);
            put_byte(s, 0);
            put_byte(s, 0);
            put_byte(s, s.level === 9 ? 2 : s.strategy >= 2 || s.level < 2 ? 4 : 0);
            put_byte(s, OS_CODE);
            s.status = BUSY_STATE;
            flush_pending2(strm);
            if (s.pending !== 0) {
              s.last_flush = -1;
              return 0;
            }
          } else {
            put_byte(s, (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16));
            put_byte(s, s.gzhead.time & 255);
            put_byte(s, s.gzhead.time >> 8 & 255);
            put_byte(s, s.gzhead.time >> 16 & 255);
            put_byte(s, s.gzhead.time >> 24 & 255);
            put_byte(s, s.level === 9 ? 2 : s.strategy >= 2 || s.level < 2 ? 4 : 0);
            put_byte(s, s.gzhead.os & 255);
            if (s.gzhead.extra && s.gzhead.extra.length) {
              put_byte(s, s.gzhead.extra.length & 255);
              put_byte(s, s.gzhead.extra.length >> 8 & 255);
            }
            if (s.gzhead.hcrc) strm.adler = crc322(strm.adler, s.pending_buf, s.pending, 0);
            s.gzindex = 0;
            s.status = EXTRA_STATE;
          }
        }
        if (s.status === EXTRA_STATE) {
          if (s.gzhead.extra) {
            let beg = s.pending;
            let left = (s.gzhead.extra.length & 65535) - s.gzindex;
            while (s.pending + left > s.pending_buf_size) {
              let copy = s.pending_buf_size - s.pending;
              s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
              s.pending = s.pending_buf_size;
              if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
              s.gzindex += copy;
              flush_pending2(strm);
              if (s.pending !== 0) {
                s.last_flush = -1;
                return 0;
              }
              beg = 0;
              left -= copy;
            }
            let gzhead_extra = new Uint8Array(s.gzhead.extra);
            s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
            s.pending += left;
            if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
            s.gzindex = 0;
          }
          s.status = NAME_STATE;
        }
        if (s.status === NAME_STATE) {
          if (s.gzhead.name) {
            let beg = s.pending;
            let val;
            do {
              if (s.pending === s.pending_buf_size) {
                if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
                flush_pending2(strm);
                if (s.pending !== 0) {
                  s.last_flush = -1;
                  return 0;
                }
                beg = 0;
              }
              if (s.gzindex < s.gzhead.name.length) val = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
              else val = 0;
              put_byte(s, val);
            } while (val !== 0);
            if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
            s.gzindex = 0;
          }
          s.status = COMMENT_STATE;
        }
        if (s.status === COMMENT_STATE) {
          if (s.gzhead.comment) {
            let beg = s.pending;
            let val;
            do {
              if (s.pending === s.pending_buf_size) {
                if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
                flush_pending2(strm);
                if (s.pending !== 0) {
                  s.last_flush = -1;
                  return 0;
                }
                beg = 0;
              }
              if (s.gzindex < s.gzhead.comment.length) val = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
              else val = 0;
              put_byte(s, val);
            } while (val !== 0);
            if (s.gzhead.hcrc && s.pending > beg) strm.adler = crc322(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          s.status = HCRC_STATE;
        }
        if (s.status === HCRC_STATE) {
          if (s.gzhead.hcrc) {
            if (s.pending + 2 > s.pending_buf_size) {
              flush_pending2(strm);
              if (s.pending !== 0) {
                s.last_flush = -1;
                return 0;
              }
            }
            put_byte(s, strm.adler & 255);
            put_byte(s, strm.adler >> 8 & 255);
            strm.adler = 0;
          }
          s.status = BUSY_STATE;
          flush_pending2(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return 0;
          }
        }
        if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== 0 && s.status !== FINISH_STATE) {
          let bstate = s.level === 0 ? deflate_stored2(s, flush) : s.strategy === 2 ? deflate_huff(s, flush) : s.strategy === 3 ? deflate_rle(s, flush) : configuration_table2[s.level].func(s, flush);
          if (bstate === BS_FINISH_STARTED2 || bstate === BS_FINISH_DONE2) s.status = FINISH_STATE;
          if (bstate === BS_NEED_MORE2 || bstate === BS_FINISH_STARTED2) {
            if (strm.avail_out === 0) s.last_flush = -1;
            return 0;
          }
          if (bstate === BS_BLOCK_DONE2) {
            if (flush === 1) _tr_align(s);
            else if (flush !== 5) {
              _tr_stored_block2(s, 0, 0, false);
              if (flush === 3) {
                zero(s.head);
                if (s.lookahead === 0) {
                  s.strstart = 0;
                  s.block_start = 0;
                  s.insert = 0;
                }
              }
            }
            flush_pending2(strm);
            if (strm.avail_out === 0) {
              s.last_flush = -1;
              return 0;
            }
          }
        }
        if (flush !== 4) return 0;
        if (s.wrap <= 0) return 1;
        if (s.wrap === 2) {
          put_byte(s, strm.adler & 255);
          put_byte(s, strm.adler >> 8 & 255);
          put_byte(s, strm.adler >> 16 & 255);
          put_byte(s, strm.adler >> 24 & 255);
          put_byte(s, strm.total_in & 255);
          put_byte(s, strm.total_in >> 8 & 255);
          put_byte(s, strm.total_in >> 16 & 255);
          put_byte(s, strm.total_in >> 24 & 255);
        } else {
          putShortMSB(s, strm.adler >>> 16);
          putShortMSB(s, strm.adler & 65535);
        }
        flush_pending2(strm);
        if (s.wrap > 0) s.wrap = -s.wrap;
        return s.pending !== 0 ? 0 : 1;
      };
      var deflateEnd = (strm) => {
        if (deflateStateCheck(strm)) return -2;
        const status = strm.state.status;
        strm.state = null;
        return status === BUSY_STATE ? err(strm, -3) : 0;
      };
      var deflateSetDictionary = (strm, dictionary) => {
        let dictLength = dictionary.length;
        if (deflateStateCheck(strm)) return -2;
        const s = strm.state;
        const wrap = s.wrap;
        if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) return -2;
        if (wrap === 1) strm.adler = adler322(strm.adler, dictionary, dictLength, 0);
        s.wrap = 0;
        if (dictLength >= s.w_size) {
          if (wrap === 0) {
            zero(s.head);
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }
          let tmpDict = new Uint8Array(s.w_size);
          tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
          dictionary = tmpDict;
          dictLength = s.w_size;
        }
        const avail = strm.avail_in;
        const next = strm.next_in;
        const input = strm.input;
        strm.avail_in = dictLength;
        strm.next_in = 0;
        strm.input = dictionary;
        fill_window2(s);
        while (s.lookahead >= MIN_MATCH2) {
          let str = s.strstart;
          let n = s.lookahead - (MIN_MATCH2 - 1);
          do {
            INSERT_STRING2(s, str);
            str++;
          } while (--n);
          s.strstart = str;
          s.lookahead = MIN_MATCH2 - 1;
          fill_window2(s);
        }
        s.strstart += s.lookahead;
        s.block_start = s.strstart;
        s.insert = s.lookahead;
        s.lookahead = 0;
        s.match_length = s.prev_length = MIN_MATCH2 - 1;
        s.match_available = 0;
        strm.next_in = next;
        strm.input = input;
        strm.avail_in = avail;
        s.wrap = wrap;
        return 0;
      };
      var BAD$12 = 16209;
      var TYPE$12 = 16191;
      function inflate_fast2(strm, start) {
        let _in;
        let last;
        let _out;
        let beg;
        let end;
        let dmax;
        let wsize;
        let whave;
        let wnext;
        let s_window;
        let hold;
        let bits;
        let lcode;
        let dcode;
        let lmask;
        let dmask;
        let here;
        let op;
        let len;
        let dist;
        let from;
        let from_source;
        let input, output;
        const state = strm.state;
        _in = strm.next_in;
        input = strm.input;
        last = _in + (strm.avail_in - 5);
        _out = strm.next_out;
        output = strm.output;
        beg = _out - (start - strm.avail_out);
        end = _out + (strm.avail_out - 257);
        dmax = state.dmax;
        wsize = state.wsize;
        whave = state.whave;
        wnext = state.wnext;
        s_window = state.window;
        hold = state.hold;
        bits = state.bits;
        lcode = state.lencode;
        dcode = state.distcode;
        lmask = (1 << state.lenbits) - 1;
        dmask = (1 << state.distbits) - 1;
        top: do {
          if (bits < 15) {
            hold += input[_in++] << bits;
            bits += 8;
            hold += input[_in++] << bits;
            bits += 8;
          }
          here = lcode[hold & lmask];
          dolen: for (; ; ) {
            op = here >>> 24;
            hold >>>= op;
            bits -= op;
            op = here >>> 16 & 255;
            if (op === 0) output[_out++] = here & 65535;
            else if (op & 16) {
              len = here & 65535;
              op &= 15;
              if (op) {
                if (bits < op) {
                  hold += input[_in++] << bits;
                  bits += 8;
                }
                len += hold & (1 << op) - 1;
                hold >>>= op;
                bits -= op;
              }
              if (bits < 15) {
                hold += input[_in++] << bits;
                bits += 8;
                hold += input[_in++] << bits;
                bits += 8;
              }
              here = dcode[hold & dmask];
              dodist: for (; ; ) {
                op = here >>> 24;
                hold >>>= op;
                bits -= op;
                op = here >>> 16 & 255;
                if (op & 16) {
                  dist = here & 65535;
                  op &= 15;
                  if (bits < op) {
                    hold += input[_in++] << bits;
                    bits += 8;
                    if (bits < op) {
                      hold += input[_in++] << bits;
                      bits += 8;
                    }
                  }
                  dist += hold & (1 << op) - 1;
                  if (dist > dmax) {
                    strm.msg = "invalid distance too far back";
                    state.mode = BAD$12;
                    break top;
                  }
                  hold >>>= op;
                  bits -= op;
                  op = _out - beg;
                  if (dist > op) {
                    op = dist - op;
                    if (op > whave) {
                      if (state.sane) {
                        strm.msg = "invalid distance too far back";
                        state.mode = BAD$12;
                        break top;
                      }
                    }
                    from = 0;
                    from_source = s_window;
                    if (wnext === 0) {
                      from += wsize - op;
                      if (op < len) {
                        len -= op;
                        do
                          output[_out++] = s_window[from++];
                        while (--op);
                        from = _out - dist;
                        from_source = output;
                      }
                    } else if (wnext < op) {
                      from += wsize + wnext - op;
                      op -= wnext;
                      if (op < len) {
                        len -= op;
                        do
                          output[_out++] = s_window[from++];
                        while (--op);
                        from = 0;
                        if (wnext < len) {
                          op = wnext;
                          len -= op;
                          do
                            output[_out++] = s_window[from++];
                          while (--op);
                          from = _out - dist;
                          from_source = output;
                        }
                      }
                    } else {
                      from += wnext - op;
                      if (op < len) {
                        len -= op;
                        do
                          output[_out++] = s_window[from++];
                        while (--op);
                        from = _out - dist;
                        from_source = output;
                      }
                    }
                    while (len > 2) {
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      len -= 3;
                    }
                    if (len) {
                      output[_out++] = from_source[from++];
                      if (len > 1) output[_out++] = from_source[from++];
                    }
                  } else {
                    from = _out - dist;
                    do {
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      len -= 3;
                    } while (len > 2);
                    if (len) {
                      output[_out++] = output[from++];
                      if (len > 1) output[_out++] = output[from++];
                    }
                  }
                } else if ((op & 64) === 0) {
                  here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                  continue dodist;
                } else {
                  strm.msg = "invalid distance code";
                  state.mode = BAD$12;
                  break top;
                }
                break;
              }
            } else if ((op & 64) === 0) {
              here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
              continue dolen;
            } else if (op & 32) {
              state.mode = TYPE$12;
              break top;
            } else {
              strm.msg = "invalid literal/length code";
              state.mode = BAD$12;
              break top;
            }
            break;
          }
        } while (_in < last && _out < end);
        len = bits >> 3;
        _in -= len;
        bits -= len << 3;
        hold &= (1 << bits) - 1;
        strm.next_in = _in;
        strm.next_out = _out;
        strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
        strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
        state.hold = hold;
        state.bits = bits;
      }
      var MAXBITS2 = 15;
      var ENOUGH_LENS$12 = 852;
      var ENOUGH_DISTS$12 = 592;
      var CODES$12 = 0;
      var LENS$12 = 1;
      var DISTS$12 = 2;
      var lbase2 = new Uint16Array([
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        13,
        15,
        17,
        19,
        23,
        27,
        31,
        35,
        43,
        51,
        59,
        67,
        83,
        99,
        115,
        131,
        163,
        195,
        227,
        258,
        0,
        0
      ]);
      var lext2 = new Uint8Array([
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        17,
        17,
        17,
        17,
        18,
        18,
        18,
        18,
        19,
        19,
        19,
        19,
        20,
        20,
        20,
        20,
        21,
        21,
        21,
        21,
        16,
        199,
        75
      ]);
      var dbase2 = new Uint16Array([
        1,
        2,
        3,
        4,
        5,
        7,
        9,
        13,
        17,
        25,
        33,
        49,
        65,
        97,
        129,
        193,
        257,
        385,
        513,
        769,
        1025,
        1537,
        2049,
        3073,
        4097,
        6145,
        8193,
        12289,
        16385,
        24577,
        0,
        0
      ]);
      var dext2 = new Uint8Array([
        16,
        16,
        16,
        16,
        17,
        17,
        18,
        18,
        19,
        19,
        20,
        20,
        21,
        21,
        22,
        22,
        23,
        23,
        24,
        24,
        25,
        25,
        26,
        26,
        27,
        27,
        28,
        28,
        29,
        29,
        64,
        64
      ]);
      var inflate_table2 = (type, lens, lens_index, codes, table, table_index, work, opts) => {
        const bits = opts.bits;
        let len = 0;
        let sym = 0;
        let min = 0, max = 0;
        let root = 0;
        let curr = 0;
        let drop = 0;
        let left = 0;
        let used = 0;
        let huff = 0;
        let incr;
        let fill;
        let low;
        let mask;
        let next;
        let base = null;
        let match;
        const count = /* @__PURE__ */ new Uint16Array(16);
        const offs = /* @__PURE__ */ new Uint16Array(16);
        let extra = null;
        let here_bits, here_op, here_val;
        for (len = 0; len <= MAXBITS2; len++) count[len] = 0;
        for (sym = 0; sym < codes; sym++) count[lens[lens_index + sym]]++;
        root = bits;
        for (max = MAXBITS2; max >= 1; max--) if (count[max] !== 0) break;
        if (root > max) root = max;
        if (max === 0) {
          table[table_index++] = 20971520;
          table[table_index++] = 20971520;
          opts.bits = 1;
          return 0;
        }
        for (min = 1; min < max; min++) if (count[min] !== 0) break;
        if (root < min) root = min;
        left = 1;
        for (len = 1; len <= MAXBITS2; len++) {
          left <<= 1;
          left -= count[len];
          if (left < 0) return -1;
        }
        if (left > 0 && (type === CODES$12 || max !== 1)) return -1;
        offs[1] = 0;
        for (len = 1; len < MAXBITS2; len++) offs[len + 1] = offs[len] + count[len];
        for (sym = 0; sym < codes; sym++) if (lens[lens_index + sym] !== 0) work[offs[lens[lens_index + sym]]++] = sym;
        if (type === CODES$12) {
          base = extra = work;
          match = 20;
        } else if (type === LENS$12) {
          base = lbase2;
          extra = lext2;
          match = 257;
        } else {
          base = dbase2;
          extra = dext2;
          match = 0;
        }
        huff = 0;
        sym = 0;
        len = min;
        next = table_index;
        curr = root;
        drop = 0;
        low = -1;
        used = 1 << root;
        mask = used - 1;
        if (type === LENS$12 && used > ENOUGH_LENS$12 || type === DISTS$12 && used > ENOUGH_DISTS$12) return 1;
        for (; ; ) {
          here_bits = len - drop;
          if (work[sym] + 1 < match) {
            here_op = 0;
            here_val = work[sym];
          } else if (work[sym] >= match) {
            here_op = extra[work[sym] - match];
            here_val = base[work[sym] - match];
          } else {
            here_op = 96;
            here_val = 0;
          }
          incr = 1 << len - drop;
          fill = 1 << curr;
          min = fill;
          do {
            fill -= incr;
            table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
          } while (fill !== 0);
          incr = 1 << len - 1;
          while (huff & incr) incr >>= 1;
          if (incr !== 0) {
            huff &= incr - 1;
            huff += incr;
          } else huff = 0;
          sym++;
          if (--count[len] === 0) {
            if (len === max) break;
            len = lens[lens_index + work[sym]];
          }
          if (len > root && (huff & mask) !== low) {
            if (drop === 0) drop = root;
            next += min;
            curr = len - drop;
            left = 1 << curr;
            while (curr + drop < max) {
              left -= count[curr + drop];
              if (left <= 0) break;
              curr++;
              left <<= 1;
            }
            used += 1 << curr;
            if (type === LENS$12 && used > ENOUGH_LENS$12 || type === DISTS$12 && used > ENOUGH_DISTS$12) return 1;
            low = huff & mask;
            table[low] = root << 24 | curr << 16 | next - table_index | 0;
          }
        }
        if (huff !== 0) table[next + huff] = len - drop << 24 | 4194304;
        opts.bits = root;
        return 0;
      };
      var CODES2 = 0;
      var LENS2 = 1;
      var DISTS2 = 2;
      var HEAD2 = 16180;
      var FLAGS2 = 16181;
      var TIME2 = 16182;
      var OS2 = 16183;
      var EXLEN2 = 16184;
      var EXTRA2 = 16185;
      var NAME2 = 16186;
      var COMMENT2 = 16187;
      var HCRC2 = 16188;
      var DICTID2 = 16189;
      var DICT2 = 16190;
      var TYPE2 = 16191;
      var TYPEDO2 = 16192;
      var STORED2 = 16193;
      var COPY_2 = 16194;
      var COPY2 = 16195;
      var TABLE2 = 16196;
      var LENLENS2 = 16197;
      var CODELENS2 = 16198;
      var LEN_2 = 16199;
      var LEN2 = 16200;
      var LENEXT2 = 16201;
      var DIST2 = 16202;
      var DISTEXT2 = 16203;
      var MATCH2 = 16204;
      var LIT2 = 16205;
      var CHECK2 = 16206;
      var LENGTH2 = 16207;
      var DONE2 = 16208;
      var BAD2 = 16209;
      var MEM2 = 16210;
      var SYNC2 = 16211;
      var ENOUGH_LENS2 = 852;
      var ENOUGH_DISTS2 = 592;
      var DEF_WBITS = 15;
      var zswap322 = (q) => {
        return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
      };
      var InflateState2 = class {
        constructor() {
          this.strm = null;
          this.mode = 0;
          this.last = false;
          this.wrap = 0;
          this.havedict = false;
          this.flags = 0;
          this.dmax = 0;
          this.check = 0;
          this.total = 0;
          this.head = null;
          this.wbits = 0;
          this.wsize = 0;
          this.whave = 0;
          this.wnext = 0;
          this.window = null;
          this.hold = 0;
          this.bits = 0;
          this.length = 0;
          this.offset = 0;
          this.extra = 0;
          this.lencode = null;
          this.distcode = null;
          this.lenbits = 0;
          this.distbits = 0;
          this.ncode = 0;
          this.nlen = 0;
          this.ndist = 0;
          this.have = 0;
          this.next = null;
          this.lens = /* @__PURE__ */ new Uint16Array(320);
          this.work = /* @__PURE__ */ new Uint16Array(288);
          this.lendyn = null;
          this.distdyn = null;
          this.sane = 0;
          this.back = 0;
          this.was = 0;
        }
      };
      var inflateStateCheck2 = (strm) => {
        if (!strm) return 1;
        const state = strm.state;
        if (!state || state.strm !== strm || state.mode < HEAD2 || state.mode > SYNC2) return 1;
        return 0;
      };
      var inflateResetKeep2 = (strm) => {
        if (inflateStateCheck2(strm)) return -2;
        const state = strm.state;
        strm.total_in = strm.total_out = state.total = 0;
        strm.msg = "";
        if (state.wrap) strm.adler = state.wrap & 1;
        state.mode = HEAD2;
        state.last = 0;
        state.havedict = 0;
        state.flags = -1;
        state.dmax = 32768;
        state.head = null;
        state.hold = 0;
        state.bits = 0;
        state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS2);
        state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS2);
        state.sane = 1;
        state.back = -1;
        return 0;
      };
      var inflateReset3 = (strm) => {
        if (inflateStateCheck2(strm)) return -2;
        const state = strm.state;
        state.wsize = 0;
        state.whave = 0;
        state.wnext = 0;
        return inflateResetKeep2(strm);
      };
      var inflateReset22 = (strm, windowBits) => {
        let wrap;
        if (inflateStateCheck2(strm)) return -2;
        const state = strm.state;
        if (windowBits < 0) {
          wrap = 0;
          windowBits = -windowBits;
        } else {
          wrap = (windowBits >> 4) + 5;
          if (windowBits < 48) windowBits &= 15;
        }
        if (windowBits && (windowBits < 8 || windowBits > 15)) return -2;
        if (state.window !== null && state.wbits !== windowBits) state.window = null;
        state.wrap = wrap;
        state.wbits = windowBits;
        return inflateReset3(strm);
      };
      var inflateInit22 = (strm, windowBits) => {
        if (!strm) return -2;
        const state = new InflateState2();
        strm.state = state;
        state.strm = strm;
        state.window = null;
        state.mode = HEAD2;
        const ret = inflateReset22(strm, windowBits);
        if (ret !== 0) strm.state = null;
        return ret;
      };
      var inflateInit = (strm) => {
        return inflateInit22(strm, DEF_WBITS);
      };
      var virgin2 = true;
      var lenfix2;
      var distfix2;
      var fixedtables2 = (state) => {
        if (virgin2) {
          lenfix2 = /* @__PURE__ */ new Int32Array(512);
          distfix2 = /* @__PURE__ */ new Int32Array(32);
          let sym = 0;
          while (sym < 144) state.lens[sym++] = 8;
          while (sym < 256) state.lens[sym++] = 9;
          while (sym < 280) state.lens[sym++] = 7;
          while (sym < 288) state.lens[sym++] = 8;
          inflate_table2(LENS2, state.lens, 0, 288, lenfix2, 0, state.work, { bits: 9 });
          sym = 0;
          while (sym < 32) state.lens[sym++] = 5;
          inflate_table2(DISTS2, state.lens, 0, 32, distfix2, 0, state.work, { bits: 5 });
          virgin2 = false;
        }
        state.lencode = lenfix2;
        state.lenbits = 9;
        state.distcode = distfix2;
        state.distbits = 5;
      };
      var updatewindow2 = (strm, src, end, copy) => {
        let dist;
        const state = strm.state;
        if (state.window === null) state.window = new Uint8Array(1 << state.wbits);
        if (state.wsize === 0) {
          state.wsize = 1 << state.wbits;
          state.wnext = 0;
          state.whave = 0;
        }
        if (copy >= state.wsize) {
          state.window.set(src.subarray(end - state.wsize, end), 0);
          state.wnext = 0;
          state.whave = state.wsize;
        } else {
          dist = state.wsize - state.wnext;
          if (dist > copy) dist = copy;
          state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
          copy -= dist;
          if (copy) {
            state.window.set(src.subarray(end - copy, end), 0);
            state.wnext = copy;
            state.whave = state.wsize;
          } else {
            state.wnext += dist;
            if (state.wnext === state.wsize) state.wnext = 0;
            if (state.whave < state.wsize) state.whave += dist;
          }
        }
        return 0;
      };
      var inflate$12 = (strm, flush) => {
        let state;
        let input, output;
        let next;
        let put;
        let have, left;
        let hold;
        let bits;
        let _in, _out;
        let copy;
        let from;
        let from_source;
        let here = 0;
        let here_bits, here_op, here_val;
        let last_bits, last_op, last_val;
        let len;
        let ret;
        const hbuf = /* @__PURE__ */ new Uint8Array(4);
        let opts;
        let n;
        const order = new Uint8Array([
          16,
          17,
          18,
          0,
          8,
          7,
          9,
          6,
          10,
          5,
          11,
          4,
          12,
          3,
          13,
          2,
          14,
          1,
          15
        ]);
        if (inflateStateCheck2(strm) || !strm.output || !strm.input && strm.avail_in !== 0) return -2;
        state = strm.state;
        if (state.mode === TYPE2) state.mode = TYPEDO2;
        put = strm.next_out;
        output = strm.output;
        left = strm.avail_out;
        next = strm.next_in;
        input = strm.input;
        have = strm.avail_in;
        hold = state.hold;
        bits = state.bits;
        _in = have;
        _out = left;
        ret = 0;
        inf_leave: for (; ; ) switch (state.mode) {
          case HEAD2:
            if (state.wrap === 0) {
              state.mode = TYPEDO2;
              break;
            }
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.wrap & 2 && hold === 35615) {
              if (state.wbits === 0) state.wbits = 15;
              state.check = 0;
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc322(state.check, hbuf, 2, 0);
              hold = 0;
              bits = 0;
              state.mode = FLAGS2;
              break;
            }
            if (state.head) state.head.done = false;
            if (!(state.wrap & 1) || (((hold & 255) << 8) + (hold >> 8)) % 31) {
              strm.msg = "incorrect header check";
              state.mode = BAD2;
              break;
            }
            if ((hold & 15) !== 8) {
              strm.msg = "unknown compression method";
              state.mode = BAD2;
              break;
            }
            hold >>>= 4;
            bits -= 4;
            len = (hold & 15) + 8;
            if (state.wbits === 0) state.wbits = len;
            if (len > 15 || len > state.wbits) {
              strm.msg = "invalid window size";
              state.mode = BAD2;
              break;
            }
            state.dmax = 1 << state.wbits;
            state.flags = 0;
            strm.adler = state.check = 1;
            state.mode = hold & 512 ? DICTID2 : TYPE2;
            hold = 0;
            bits = 0;
            break;
          case FLAGS2:
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.flags = hold;
            if ((state.flags & 255) !== 8) {
              strm.msg = "unknown compression method";
              state.mode = BAD2;
              break;
            }
            if (state.flags & 57344) {
              strm.msg = "unknown header flags set";
              state.mode = BAD2;
              break;
            }
            if (state.head) state.head.text = hold >> 8 & 1;
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc322(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = TIME2;
          case TIME2:
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) state.head.time = hold >>> 0;
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              hbuf[2] = hold >>> 16 & 255;
              hbuf[3] = hold >>> 24 & 255;
              state.check = crc322(state.check, hbuf, 4, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = OS2;
          case OS2:
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) {
              state.head.xflags = hold & 255;
              state.head.os = hold >> 8;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc322(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = EXLEN2;
          case EXLEN2:
            if (state.flags & 1024) {
              while (bits < 16) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length = hold;
              if (state.head) state.head.extra_len = hold;
              if (state.flags & 512 && state.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state.check = crc322(state.check, hbuf, 2, 0);
              }
              hold = 0;
              bits = 0;
            } else if (state.head) state.head.extra = null;
            state.mode = EXTRA2;
          case EXTRA2:
            if (state.flags & 1024) {
              copy = state.length;
              if (copy > have) copy = have;
              if (copy) {
                if (state.head) {
                  len = state.head.extra_len - state.length;
                  if (!state.head.extra) state.head.extra = new Uint8Array(state.head.extra_len);
                  state.head.extra.set(input.subarray(next, next + copy), len);
                }
                if (state.flags & 512 && state.wrap & 4) state.check = crc322(state.check, input, copy, next);
                have -= copy;
                next += copy;
                state.length -= copy;
              }
              if (state.length) break inf_leave;
            }
            state.length = 0;
            state.mode = NAME2;
          case NAME2:
            if (state.flags & 2048) {
              if (have === 0) break inf_leave;
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) state.head.name += String.fromCharCode(len);
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) state.check = crc322(state.check, input, copy, next);
              have -= copy;
              next += copy;
              if (len) break inf_leave;
            } else if (state.head) state.head.name = null;
            state.length = 0;
            state.mode = COMMENT2;
          case COMMENT2:
            if (state.flags & 4096) {
              if (have === 0) break inf_leave;
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) state.head.comment += String.fromCharCode(len);
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) state.check = crc322(state.check, input, copy, next);
              have -= copy;
              next += copy;
              if (len) break inf_leave;
            } else if (state.head) state.head.comment = null;
            state.mode = HCRC2;
          case HCRC2:
            if (state.flags & 512) {
              while (bits < 16) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.check & 65535)) {
                strm.msg = "header crc mismatch";
                state.mode = BAD2;
                break;
              }
              hold = 0;
              bits = 0;
            }
            if (state.head) {
              state.head.hcrc = state.flags >> 9 & 1;
              state.head.done = true;
            }
            strm.adler = state.check = 0;
            state.mode = TYPE2;
            break;
          case DICTID2:
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            strm.adler = state.check = zswap322(hold);
            hold = 0;
            bits = 0;
            state.mode = DICT2;
          case DICT2:
            if (state.havedict === 0) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              return 2;
            }
            strm.adler = state.check = 1;
            state.mode = TYPE2;
          case TYPE2:
            if (flush === 5 || flush === 6) break inf_leave;
          case TYPEDO2:
            if (state.last) {
              hold >>>= bits & 7;
              bits -= bits & 7;
              state.mode = CHECK2;
              break;
            }
            while (bits < 3) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.last = hold & 1;
            hold >>>= 1;
            bits -= 1;
            switch (hold & 3) {
              case 0:
                state.mode = STORED2;
                break;
              case 1:
                fixedtables2(state);
                state.mode = LEN_2;
                if (flush === 6) {
                  hold >>>= 2;
                  bits -= 2;
                  break inf_leave;
                }
                break;
              case 2:
                state.mode = TABLE2;
                break;
              case 3:
                strm.msg = "invalid block type";
                state.mode = BAD2;
            }
            hold >>>= 2;
            bits -= 2;
            break;
          case STORED2:
            hold >>>= bits & 7;
            bits -= bits & 7;
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
              strm.msg = "invalid stored block lengths";
              state.mode = BAD2;
              break;
            }
            state.length = hold & 65535;
            hold = 0;
            bits = 0;
            state.mode = COPY_2;
            if (flush === 6) break inf_leave;
          case COPY_2:
            state.mode = COPY2;
          case COPY2:
            copy = state.length;
            if (copy) {
              if (copy > have) copy = have;
              if (copy > left) copy = left;
              if (copy === 0) break inf_leave;
              output.set(input.subarray(next, next + copy), put);
              have -= copy;
              next += copy;
              left -= copy;
              put += copy;
              state.length -= copy;
              break;
            }
            state.mode = TYPE2;
            break;
          case TABLE2:
            while (bits < 14) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.nlen = (hold & 31) + 257;
            hold >>>= 5;
            bits -= 5;
            state.ndist = (hold & 31) + 1;
            hold >>>= 5;
            bits -= 5;
            state.ncode = (hold & 15) + 4;
            hold >>>= 4;
            bits -= 4;
            if (state.nlen > 286 || state.ndist > 30) {
              strm.msg = "too many length or distance symbols";
              state.mode = BAD2;
              break;
            }
            state.have = 0;
            state.mode = LENLENS2;
          case LENLENS2:
            while (state.have < state.ncode) {
              while (bits < 3) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.lens[order[state.have++]] = hold & 7;
              hold >>>= 3;
              bits -= 3;
            }
            while (state.have < 19) state.lens[order[state.have++]] = 0;
            state.lencode = state.lendyn;
            state.lenbits = 7;
            opts = { bits: state.lenbits };
            ret = inflate_table2(CODES2, state.lens, 0, 19, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid code lengths set";
              state.mode = BAD2;
              break;
            }
            state.have = 0;
            state.mode = CODELENS2;
          case CODELENS2:
            while (state.have < state.nlen + state.ndist) {
              for (; ; ) {
                here = state.lencode[hold & (1 << state.lenbits) - 1];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (here_val < 16) {
                hold >>>= here_bits;
                bits -= here_bits;
                state.lens[state.have++] = here_val;
              } else {
                if (here_val === 16) {
                  n = here_bits + 2;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  if (state.have === 0) {
                    strm.msg = "invalid bit length repeat";
                    state.mode = BAD2;
                    break;
                  }
                  len = state.lens[state.have - 1];
                  copy = 3 + (hold & 3);
                  hold >>>= 2;
                  bits -= 2;
                } else if (here_val === 17) {
                  n = here_bits + 3;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 3 + (hold & 7);
                  hold >>>= 3;
                  bits -= 3;
                } else {
                  n = here_bits + 7;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 11 + (hold & 127);
                  hold >>>= 7;
                  bits -= 7;
                }
                if (state.have + copy > state.nlen + state.ndist) {
                  strm.msg = "invalid bit length repeat";
                  state.mode = BAD2;
                  break;
                }
                while (copy--) state.lens[state.have++] = len;
              }
            }
            if (state.mode === BAD2) break;
            if (state.lens[256] === 0) {
              strm.msg = "invalid code -- missing end-of-block";
              state.mode = BAD2;
              break;
            }
            state.lenbits = 9;
            opts = { bits: state.lenbits };
            ret = inflate_table2(LENS2, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid literal/lengths set";
              state.mode = BAD2;
              break;
            }
            state.distbits = 6;
            state.distcode = state.distdyn;
            opts = { bits: state.distbits };
            ret = inflate_table2(DISTS2, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
            state.distbits = opts.bits;
            if (ret) {
              strm.msg = "invalid distances set";
              state.mode = BAD2;
              break;
            }
            state.mode = LEN_2;
            if (flush === 6) break inf_leave;
          case LEN_2:
            state.mode = LEN2;
          case LEN2:
            if (have >= 6 && left >= 258) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              inflate_fast2(strm, _out);
              put = strm.next_out;
              output = strm.output;
              left = strm.avail_out;
              next = strm.next_in;
              input = strm.input;
              have = strm.avail_in;
              hold = state.hold;
              bits = state.bits;
              if (state.mode === TYPE2) state.back = -1;
              break;
            }
            state.back = 0;
            for (; ; ) {
              here = state.lencode[hold & (1 << state.lenbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) break;
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (here_op && (here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            state.length = here_val;
            if (here_op === 0) {
              state.mode = LIT2;
              break;
            }
            if (here_op & 32) {
              state.back = -1;
              state.mode = TYPE2;
              break;
            }
            if (here_op & 64) {
              strm.msg = "invalid literal/length code";
              state.mode = BAD2;
              break;
            }
            state.extra = here_op & 15;
            state.mode = LENEXT2;
          case LENEXT2:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            state.was = state.length;
            state.mode = DIST2;
          case DIST2:
            for (; ; ) {
              here = state.distcode[hold & (1 << state.distbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) break;
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            if (here_op & 64) {
              strm.msg = "invalid distance code";
              state.mode = BAD2;
              break;
            }
            state.offset = here_val;
            state.extra = here_op & 15;
            state.mode = DISTEXT2;
          case DISTEXT2:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.offset += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            if (state.offset > state.dmax) {
              strm.msg = "invalid distance too far back";
              state.mode = BAD2;
              break;
            }
            state.mode = MATCH2;
          case MATCH2:
            if (left === 0) break inf_leave;
            copy = _out - left;
            if (state.offset > copy) {
              copy = state.offset - copy;
              if (copy > state.whave) {
                if (state.sane) {
                  strm.msg = "invalid distance too far back";
                  state.mode = BAD2;
                  break;
                }
              }
              if (copy > state.wnext) {
                copy -= state.wnext;
                from = state.wsize - copy;
              } else from = state.wnext - copy;
              if (copy > state.length) copy = state.length;
              from_source = state.window;
            } else {
              from_source = output;
              from = put - state.offset;
              copy = state.length;
            }
            if (copy > left) copy = left;
            left -= copy;
            state.length -= copy;
            do
              output[put++] = from_source[from++];
            while (--copy);
            if (state.length === 0) state.mode = LEN2;
            break;
          case LIT2:
            if (left === 0) break inf_leave;
            output[put++] = state.length;
            left--;
            state.mode = LEN2;
            break;
          case CHECK2:
            if (state.wrap) {
              while (bits < 32) {
                if (have === 0) break inf_leave;
                have--;
                hold |= input[next++] << bits;
                bits += 8;
              }
              _out -= left;
              strm.total_out += _out;
              state.total += _out;
              if (state.wrap & 4 && _out) strm.adler = state.check = state.flags ? crc322(state.check, output, _out, put - _out) : adler322(state.check, output, _out, put - _out);
              _out = left;
              if (state.wrap & 4 && (state.flags ? hold : zswap322(hold)) !== state.check) {
                strm.msg = "incorrect data check";
                state.mode = BAD2;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = LENGTH2;
          case LENGTH2:
            if (state.wrap && state.flags) {
              while (bits < 32) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.total & 4294967295)) {
                strm.msg = "incorrect length check";
                state.mode = BAD2;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = DONE2;
          case DONE2:
            ret = 1;
            break inf_leave;
          case BAD2:
            ret = -3;
            break inf_leave;
          case MEM2:
            return -4;
          case SYNC2:
          default:
            return -2;
        }
        strm.next_out = put;
        strm.avail_out = left;
        strm.next_in = next;
        strm.avail_in = have;
        state.hold = hold;
        state.bits = bits;
        if (state.wsize || _out !== strm.avail_out && state.mode < BAD2 && (state.mode < CHECK2 || flush !== 4)) {
          if (updatewindow2(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
            state.mode = MEM2;
            return -4;
          }
        }
        _in -= strm.avail_in;
        _out -= strm.avail_out;
        strm.total_in += _in;
        strm.total_out += _out;
        state.total += _out;
        if (state.wrap & 4 && _out) strm.adler = state.check = state.flags ? crc322(state.check, output, _out, strm.next_out - _out) : adler322(state.check, output, _out, strm.next_out - _out);
        strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE2 ? 128 : 0) + (state.mode === LEN_2 || state.mode === COPY_2 ? 256 : 0);
        if ((_in === 0 && _out === 0 || flush === 4) && ret === 0) ret = -5;
        return ret;
      };
      var inflateEnd2 = (strm) => {
        if (inflateStateCheck2(strm)) return -2;
        let state = strm.state;
        if (state.window) state.window = null;
        strm.state = null;
        return 0;
      };
      var inflateGetHeader = (strm, head) => {
        if (inflateStateCheck2(strm)) return -2;
        const state = strm.state;
        if ((state.wrap & 2) === 0) return -2;
        state.head = head;
        head.done = false;
        return 0;
      };
      var inflateSetDictionary2 = (strm, dictionary) => {
        const dictLength = dictionary.length;
        let state;
        let dictid;
        let ret;
        if (inflateStateCheck2(strm)) return -2;
        state = strm.state;
        if (state.wrap !== 0 && state.mode !== DICT2) return -2;
        if (state.mode === DICT2) {
          dictid = 1;
          dictid = adler322(dictid, dictionary, dictLength, 0);
          if (dictid !== state.check) return -3;
        }
        ret = updatewindow2(strm, dictionary, dictLength, dictLength);
        if (ret) {
          state.mode = MEM2;
          return -4;
        }
        state.havedict = 1;
        return 0;
      };
      var ZStream2 = class {
        constructor() {
          this.input = null;
          this.next_in = 0;
          this.avail_in = 0;
          this.total_in = 0;
          this.output = null;
          this.next_out = 0;
          this.avail_out = 0;
          this.total_out = 0;
          this.msg = "";
          this.state = null;
          this.data_type = 2;
          this.adler = 0;
        }
      };
      var GZheader = class {
        constructor() {
          this.text = 0;
          this.time = 0;
          this.xflags = 0;
          this.os = 0;
          this.extra = null;
          this.extra_len = 0;
          this.name = "";
          this.comment = "";
          this.hcrc = 0;
          this.done = false;
        }
      };
      var flattenChunks2 = (chunks) => {
        const result = new Uint8Array(chunks.reduce((len, chunk) => len + chunk.length, 0));
        let pos = 0;
        for (const chunk of chunks) {
          result.set(chunk, pos);
          pos += chunk.length;
        }
        return result;
      };
      function _typeof(o) {
        "@babel/helpers - typeof";
        return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }
      function toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];
        if (void 0 !== e) {
          var i = e.call(t, r || "default");
          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return ("string" === r ? String : Number)(t);
      }
      function toPropertyKey(t) {
        var i = toPrimitive(t, "string");
        return "symbol" == _typeof(i) ? i : i + "";
      }
      function _defineProperty(e, r, t) {
        return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
          value: t,
          enumerable: true,
          configurable: true,
          writable: true
        }) : e[r] = t, e;
      }
      var toString$1 = Object.prototype.toString;
      var defaultOptions$1 = {
        level: -1,
        chunkSize: 16384,
        windowBits: 15,
        memLevel: 8,
        strategy: 0,
        raw: false,
        gzip: false,
        legacyHash: false,
        dictionary: /* @__PURE__ */ new Uint8Array(0)
      };
      var Deflate = class {
        /**
        * Creates a new deflator instance with the specified params. Throws an
        * exception on bad params. See {@link DeflateOptions} for the list of
        * supported options.
        *
        * @example
        * ```javascript
        * import { Deflate } from 'pako'
        *
        * const chunk1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
        * const chunk2 = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
        *
        * const deflate = new Deflate({ level: 3 })
        *
        * deflate.push(chunk1, false)
        * deflate.push(chunk2, true)  // true -> last chunk
        *
        * if (deflate.err) throw new Error(deflate.err)
        *
        * console.log(deflate.result)
        * ```
        */
        constructor(options = {}) {
          _defineProperty(this, "options", void 0);
          _defineProperty(
            this,
            /**
            * Error code after deflate finishes. {@link Z_OK} on success.
            * You will not need it in real life, because deflate errors
            * are possible only on wrong options or bad custom `onData` / `onEnd`
            * handlers.
            */
            "err",
            void 0
          );
          _defineProperty(
            this,
            /** Error message, if {@link Deflate.err} is not {@link Z_OK}. */
            "msg",
            void 0
          );
          _defineProperty(this, "ended", void 0);
          _defineProperty(this, "started", void 0);
          _defineProperty(
            this,
            /**
            * Chunks of output data, if {@link Deflate.onData} not overridden.
            * @internal
            */
            "chunks",
            void 0
          );
          _defineProperty(this, "strm", void 0);
          _defineProperty(
            this,
            /**
            * Compressed result, generated by default {@link Deflate.onData}
            * and {@link Deflate.onEnd} handlers. Filled after you push last chunk
            * (call {@link Deflate.push} with {@link Z_FINISH} / `true` param).
            */
            "result",
            void 0
          );
          this.options = Object.assign({}, defaultOptions$1, options);
          const opt = this.options;
          if (opt.raw && opt.windowBits > 0) opt.windowBits = -opt.windowBits;
          else if (opt.gzip && opt.windowBits > 0 && opt.windowBits < 16) opt.windowBits += 16;
          this.err = 0;
          this.msg = "";
          this.ended = false;
          this.started = false;
          this.chunks = [];
          this.result = /* @__PURE__ */ new Uint8Array(0);
          this.strm = new ZStream2();
          this.strm.avail_out = 0;
          let status = deflateInit2(this.strm, opt.level, 8, opt.windowBits, opt.memLevel, opt.strategy, opt.legacyHash);
          if (status !== 0) throw new Error(messages_default2[status]);
          if (toString$1.call(opt.dictionary) === "[object ArrayBuffer]") opt.dictionary = new Uint8Array(opt.dictionary);
          const dictionary = opt.dictionary;
          if (dictionary.length) {
            if (opt.gzip) throw new Error("dictionary is not supported with gzip");
            status = deflateSetDictionary(this.strm, dictionary);
            if (status !== 0) throw new Error(messages_default2[status]);
          }
        }
        /**
        * Sends input data to the deflate pipe, generating {@link Deflate.onData} calls
        * with new compressed chunks. Returns `true` on success. The last data block must
        * have `flush_mode` {@link Z_FINISH} (or `true`). That will flush the internal
        * pending buffers and call {@link Deflate.onEnd}.
        *
        * On failure, calls {@link Deflate.onEnd} with the error code and returns false.
        *
        * @param data input data. Strings will be converted to utf8 byte sequence.
        * @param flush_mode 0..6 for corresponding {@link Z_NO_FLUSH}..{@link Z_TREES} modes.
        *   See constants. Skipped or `false` means {@link Z_NO_FLUSH}, `true` means {@link Z_FINISH}.
        *
        * @example
        * ```javascript
        * push(chunk, false) // push one of data chunks
        * ...
        * push(chunk, true)  // push last chunk
        * ```
        */
        push(data, flush_mode = false) {
          const strm = this.strm;
          const chunkSize = this.options.chunkSize;
          let status;
          let _flush_mode;
          if (this.ended) return false;
          if (typeof flush_mode === "number") _flush_mode = flush_mode;
          else _flush_mode = flush_mode === true ? 4 : 0;
          if (typeof data === "string") strm.input = new TextEncoder().encode(data);
          else if (toString$1.call(data) === "[object ArrayBuffer]") strm.input = new Uint8Array(data);
          else strm.input = data;
          strm.next_in = 0;
          strm.avail_in = strm.input.length;
          if (!this.started) {
            this.started = true;
            this.onStart(strm);
          }
          for (; ; ) {
            if (strm.avail_out === 0) {
              strm.output = new Uint8Array(chunkSize);
              strm.next_out = 0;
              strm.avail_out = chunkSize;
            }
            if ((_flush_mode === 2 || _flush_mode === 3) && strm.avail_out <= 6) {
              this.onData(strm.output.subarray(0, strm.next_out));
              strm.avail_out = 0;
              continue;
            }
            status = deflate$1(strm, _flush_mode);
            if (status === -2) break;
            if (status === 1) {
              if (strm.next_out > 0) this.onData(strm.output.subarray(0, strm.next_out));
              status = deflateEnd(this.strm);
              break;
            }
            if (strm.avail_out === 0) {
              this.onData(strm.output);
              continue;
            }
            if (_flush_mode > 0 && strm.next_out > 0) {
              this.onData(strm.output.subarray(0, strm.next_out));
              strm.avail_out = 0;
              continue;
            }
            if (strm.avail_in === 0) return true;
          }
          this.err = status;
          this.msg = strm.msg || messages_default2[status];
          this.ended = true;
          this.onEnd(status);
          return status === 0;
        }
        /**
        * Called once before the first low-level deflate call.
        */
        onStart(strm) {
        }
        /**
        * By default, stores data blocks in the {@link Deflate.chunks} property and glues
        * them in {@link Deflate.onEnd}. Override this handler if you need another behaviour.
        */
        onData(chunk) {
          this.chunks.push(chunk);
        }
        /**
        * Called once after you tell deflate that the input stream is
        * complete ({@link Z_FINISH}). By default, joins the collected {@link Deflate.chunks}
        * into the {@link Deflate.result} property.
        *
        * @param status deflate status. {@link Z_OK} on success, other if not.
        */
        onEnd(status) {
          if (status === 0) this.result = flattenChunks2(this.chunks);
          this.chunks = [];
        }
      };
      function deflate(input, options = {}) {
        const deflator = new Deflate(options);
        deflator.push(input, true);
        if (deflator.err) throw new Error(deflator.msg);
        return deflator.result;
      }
      function deflateRaw(input, options = {}) {
        return deflate(input, Object.assign({}, options, { raw: true }));
      }
      function gzip(input, options = {}) {
        return deflate(input, Object.assign({}, options, { gzip: true }));
      }
      function ownKeys(e, r) {
        var t = Object.keys(e);
        if (Object.getOwnPropertySymbols) {
          var o = Object.getOwnPropertySymbols(e);
          r && (o = o.filter(function(r2) {
            return Object.getOwnPropertyDescriptor(e, r2).enumerable;
          })), t.push.apply(t, o);
        }
        return t;
      }
      function _objectSpread2(e) {
        for (var r = 1; r < arguments.length; r++) {
          var t = null != arguments[r] ? arguments[r] : {};
          r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
            _defineProperty(e, r2, t[r2]);
          }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
            Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
          });
        }
        return e;
      }
      var toString2 = Object.prototype.toString;
      var defaultOptions2 = {
        chunkSize: 1024 * 64,
        windowBits: 15,
        raw: false,
        dictionary: /* @__PURE__ */ new Uint8Array(0)
      };
      var Inflate2 = class {
        /**
        * Creates a new inflator instance with the specified params. Throws an
        * exception on bad params. See {@link InflateOptions} for the list of
        * supported options.
        *
        * By default, when no options are set, the deflate/gzip data format is
        * autodetected via the wrapper header.
        *
        * @example
        * ```javascript
        * import { Inflate } from 'pako'
        *
        * const chunk1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
        * const chunk2 = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
        *
        * const inflate = new Inflate({ level: 3 })
        *
        * inflate.push(chunk1, false)
        * inflate.push(chunk2, true)  // true -> last chunk
        *
        * if (inflate.err) throw new Error(inflate.err)
        *
        * console.log(inflate.result)
        * ```
        */
        constructor(options = {}) {
          _defineProperty(this, "options", void 0);
          _defineProperty(
            this,
            /**
            * Error code after inflate finishes. {@link Z_OK} on success.
            * Should be checked when broken data is possible.
            */
            "err",
            void 0
          );
          _defineProperty(
            this,
            /** Error message, if {@link Inflate.err} is not {@link Z_OK}. */
            "msg",
            void 0
          );
          _defineProperty(
            this,
            /**
            * `true` once the compressed stream has ended. A stream may end before the
            * caller's data does (trailing bytes), so check this to know when to stop
            * pushing - further {@link Inflate.push} calls are no-ops.
            */
            "ended",
            void 0
          );
          _defineProperty(this, "started", void 0);
          _defineProperty(
            this,
            /**
            * Chunks of output data, if {@link Inflate.onData} not overridden.
            * @internal
            */
            "chunks",
            void 0
          );
          _defineProperty(this, "strm", void 0);
          _defineProperty(
            this,
            /**
            * Uncompressed result, generated by default {@link Inflate.onData}
            * and {@link Inflate.onEnd} handlers. Filled after you push last chunk
            * (call {@link Inflate.push} with {@link Z_FINISH} / `true` param).
            */
            "result",
            void 0
          );
          this.options = Object.assign({}, defaultOptions2, options);
          const opt = this.options;
          if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
            opt.windowBits = -opt.windowBits;
            if (opt.windowBits === 0) opt.windowBits = -15;
          }
          if (opt.windowBits >= 0 && opt.windowBits < 16 && !options.windowBits) opt.windowBits += 32;
          if (opt.windowBits > 15 && opt.windowBits < 48) {
            if ((opt.windowBits & 15) === 0) opt.windowBits |= 15;
          }
          this.err = 0;
          this.msg = "";
          this.ended = false;
          this.started = false;
          this.chunks = [];
          this.result = /* @__PURE__ */ new Uint8Array(0);
          this.strm = new ZStream2();
          this.strm.avail_out = 0;
          let status = inflateInit22(this.strm, opt.windowBits);
          if (status !== 0) throw new Error(messages_default2[status]);
          if (toString2.call(opt.dictionary) === "[object ArrayBuffer]") opt.dictionary = new Uint8Array(opt.dictionary);
          const dictionary = opt.dictionary;
          if (opt.raw && dictionary.length) {
            status = inflateSetDictionary2(this.strm, dictionary);
            if (status !== 0) throw new Error(messages_default2[status]);
          }
        }
        /**
        * Sends input data to the inflate pipe, generating {@link Inflate.onData} calls
        * with new output chunks. Returns `true` on success. If end of stream is
        * detected, {@link Inflate.onEnd} will be called.
        *
        * `flush_mode` is not needed for normal operation, because end of stream
        * is detected automatically. Pass {@link Z_SYNC_FLUSH} to force the decoder
        * to emit all currently available output — handy when you need to decode
        * data frame-by-frame from a long-running stream.
        *
        * On failure, calls {@link Inflate.onEnd} with the error code and returns false.
        *
        * Once the stream has ended (a compressed stream may end before your data
        * does), further `push` calls are no-ops and return whether the decode
        * finished successfully. The final outcome is in {@link Inflate.result},
        * {@link Inflate.err} and {@link Inflate.msg}.
        *
        * @param flush_mode 0..6 for corresponding {@link Z_NO_FLUSH}..{@link Z_TREES}
        *   flush modes. See constants. Skipped or `false` means {@link Z_NO_FLUSH},
        *   `true` means {@link Z_FINISH}.
        *
        * @example
        * ```javascript
        * push(chunk, false) // push one of data chunks
        * ...
        * push(chunk, true)  // push last chunk
        * ```
        */
        push(data, flush_mode = false) {
          const strm = this.strm;
          const chunkSize = this.options.chunkSize;
          let status;
          let _flush_mode;
          let last_avail_out;
          if (this.ended) return this.err === 0;
          if (typeof flush_mode === "number") _flush_mode = flush_mode;
          else _flush_mode = flush_mode === true ? 4 : 0;
          if (toString2.call(data) === "[object ArrayBuffer]") strm.input = new Uint8Array(data);
          else strm.input = data;
          strm.next_in = 0;
          strm.avail_in = strm.input.length;
          if (!this.started) {
            this.started = true;
            this.onStart(strm);
          }
          for (; ; ) {
            if (strm.avail_out === 0) {
              strm.output = new Uint8Array(chunkSize);
              strm.next_out = 0;
              strm.avail_out = chunkSize;
            }
            status = inflate$12(strm, _flush_mode);
            if (status === 2) {
              const dictionary = this.options.dictionary;
              if (dictionary.length) {
                status = inflateSetDictionary2(strm, dictionary);
                if (status === 0) status = inflate$12(strm, _flush_mode);
                else if (status === -3) status = 2;
              }
            }
            while (strm.avail_in > 0 && status === 1 && strm.state.wrap & 2 && strm.state.flags !== 0 && strm.input[strm.next_in] !== 0) {
              inflateReset3(strm);
              status = inflate$12(strm, _flush_mode);
            }
            if (status === -2 || status === -3 || status === 2 || status === -4) break;
            last_avail_out = strm.avail_out;
            if (strm.next_out) {
              if (strm.avail_out === 0 || status === 1 || _flush_mode > 0) {
                this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
                strm.avail_out = 0;
                strm.next_out = 0;
              }
            }
            if ((status === 0 || status === -5) && last_avail_out === 0) continue;
            if (status === 1) {
              status = inflateEnd2(this.strm);
              break;
            }
            if (strm.avail_in === 0) {
              if (_flush_mode === 4) {
                status = inflateEnd2(this.strm);
                if (status === 0) status = -5;
                break;
              }
              return true;
            }
          }
          this.err = status;
          this.msg = strm.msg || messages_default2[status];
          this.ended = true;
          this.onEnd(status);
          return status === 0;
        }
        /**
        * Called once before the first low-level inflate call.
        *
        * Override this handler to attach low-level inflate state, for example to read
        * gzip header metadata:
        *
        * ```javascript
        * import { Inflate, GZheader, zlibInflateGetHeader } from 'pako'
        *
        * const inflator = new Inflate()
        *
        * inflator.onStart = function (strm) {
        *   this.header = new GZheader()
        *   zlibInflateGetHeader(strm, this.header)
        * }
        *
        * inflator.push(data, true)
        * console.log(inflator.header.name)
        * ```
        */
        onStart(strm) {
        }
        /**
        * By default, stores data blocks in the {@link Inflate.chunks} property and glues
        * them in {@link Inflate.onEnd}. Override this handler if you need another behaviour.
        *
        * @param chunk output data.
        */
        onData(chunk) {
          this.chunks.push(chunk);
        }
        /**
        * Called after you tell inflate that the input stream is
        * complete ({@link Z_FINISH}). By default, joins the collected {@link Inflate.chunks},
        * frees memory and fills the {@link Inflate.result} property.
        *
        * @param status inflate status. {@link Z_OK} on success, other if not.
        */
        onEnd(status) {
          if (status === 0) this.result = flattenChunks2(this.chunks);
          this.chunks = [];
        }
      };
      function inflate3(input, options = {}) {
        const inflator = new Inflate2(options);
        inflator.push(input, true);
        if (inflator.err) throw new Error(inflator.msg);
        const result = inflator.result;
        return options.toText ? new TextDecoder().decode(result) : result;
      }
      function inflateRaw(input, options = {}) {
        return inflate3(input, _objectSpread2(_objectSpread2({}, options), {}, { raw: true }));
      }
      exports.Deflate = Deflate;
      exports.GZheader = GZheader;
      exports.Inflate = Inflate2;
      exports.ZStream = ZStream2;
      exports.Z_BLOCK = Z_BLOCK;
      exports.Z_BUF_ERROR = Z_BUF_ERROR;
      exports.Z_DATA_ERROR = Z_DATA_ERROR;
      exports.Z_ERRNO = Z_ERRNO;
      exports.Z_FINISH = Z_FINISH;
      exports.Z_FULL_FLUSH = Z_FULL_FLUSH;
      exports.Z_MEM_ERROR = Z_MEM_ERROR;
      exports.Z_NEED_DICT = Z_NEED_DICT;
      exports.Z_NO_FLUSH = Z_NO_FLUSH;
      exports.Z_OK = Z_OK;
      exports.Z_PARTIAL_FLUSH = Z_PARTIAL_FLUSH;
      exports.Z_STREAM_END = Z_STREAM_END;
      exports.Z_STREAM_ERROR = Z_STREAM_ERROR;
      exports.Z_SYNC_FLUSH = Z_SYNC_FLUSH;
      exports.Z_TREES = Z_TREES;
      exports.deflate = deflate;
      exports.deflateRaw = deflateRaw;
      exports.gzip = gzip;
      exports.inflate = inflate3;
      exports.inflateRaw = inflateRaw;
      exports.ungzip = inflate3;
      exports.zlibDeflate = deflate$1;
      exports.zlibDeflateEnd = deflateEnd;
      exports.zlibDeflateInit = deflateInit;
      exports.zlibDeflateInit2 = deflateInit2;
      exports.zlibDeflateReset = deflateReset;
      exports.zlibDeflateResetKeep = deflateResetKeep;
      exports.zlibDeflateSetDictionary = deflateSetDictionary;
      exports.zlibDeflateSetHeader = deflateSetHeader;
      exports.zlibInflate = inflate$12;
      exports.zlibInflateEnd = inflateEnd2;
      exports.zlibInflateGetHeader = inflateGetHeader;
      exports.zlibInflateInit = inflateInit;
      exports.zlibInflateInit2 = inflateInit22;
      exports.zlibInflateReset = inflateReset3;
      exports.zlibInflateReset2 = inflateReset22;
      exports.zlibInflateResetKeep = inflateResetKeep2;
      exports.zlibInflateSetDictionary = inflateSetDictionary2;
    }
  });

  // src/musicSdk/kw/decodeLyric.js
  var inflate, handleInflate, buf_key, buf_key_len, decodeLyric, decodeLyric_default;
  var init_decodeLyric = __esm({
    "src/musicSdk/kw/decodeLyric.js"() {
      "use strict";
      init_buffer();
      ({ inflate } = require_pako_cjs());
      handleInflate = (data) => new Promise((resolve, reject) => {
        resolve(Buffer2.from(inflate(data)));
      });
      buf_key = Buffer2.from("yeelion");
      buf_key_len = buf_key.length;
      decodeLyric = async (rawData, isGetLyricx) => {
        const buf = Buffer2.isBuffer(rawData) ? rawData : Buffer2.from(rawData);
        if (buf.toString("utf8", 0, 10).toLowerCase() !== "tp=content") return "";
        const lrcData = await handleInflate(buf.subarray(buf.indexOf("\r\n\r\n") + 4));
        if (!isGetLyricx) return lrcData.toString("utf8");
        const buf_str = Buffer2.from(lrcData.toString(), "base64");
        const buf_str_len = buf_str.length;
        const output = new Uint8Array(buf_str_len);
        let i = 0;
        while (i < buf_str_len) {
          let j = 0;
          while (j < buf_key_len && i < buf_str_len) {
            output[i] = buf_str[i] ^ buf_key[j];
            i++;
            j++;
          }
        }
        return Buffer2.from(output).toString("utf8");
      };
      decodeLyric_default = async ({ lrcBuffer, isGetLyricx }) => {
        const lrc = await decodeLyric(lrcBuffer, isGetLyricx);
        return lrc;
      };
    }
  });

  // src/musicSdk/kw/util.js
  var objStr2JSON, formatSinger, lrcTools, wbdCrypto;
  var init_util = __esm({
    "src/musicSdk/kw/util.js"() {
      "use strict";
      init_buffer();
      init_utils();
      init_crypto();
      init_decodeLyric();
      objStr2JSON = (str) => {
        return JSON.parse(str.replace(/('(?=(,\s*')))|('(?=:))|((?<=([:,]\s*))')|((?<={)')|('(?=}))/g, '"'));
      };
      formatSinger = (rawData) => rawData.replace(/&/g, "、");
      lrcTools = {
        rxps: {
          wordLine: /^(\[\d{1,2}:.*\d{1,4}\])\s*(\S+(?:\s+\S+)*)?\s*/,
          tagLine: /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*\]/,
          wordTimeAll: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g,
          wordTime: /<(-?\d+),(-?\d+)(?:,-?\d+)?>/
        },
        offset: 1,
        offset2: 1,
        isOK: false,
        lines: [],
        tags: [],
        getWordInfo(str, str2, prevWord) {
          const offset = parseInt(str);
          const offset2 = parseInt(str2);
          let startTime = Math.trunc(Math.abs((offset + offset2) / (this.offset * 2)));
          let endTime = Math.trunc(Math.abs((offset - offset2) / (this.offset2 * 2)) + startTime);
          if (prevWord) {
            if (startTime < prevWord.endTime) {
              prevWord.endTime = startTime;
              if (prevWord.startTime > prevWord.endTime) {
                prevWord.startTime = prevWord.endTime;
              }
              prevWord.newTimeStr = `<${prevWord.startTime},${Math.trunc(prevWord.endTime - prevWord.startTime)}>`;
            }
          }
          return {
            startTime,
            endTime,
            timeStr: `<${startTime},${Math.trunc(endTime - startTime)}>`
          };
        },
        parseLine(line) {
          if (line.length < 6) return;
          let result = this.rxps.wordLine.exec(line);
          if (result) {
            const time = result[1];
            let words = result[2];
            if (words == null) {
              words = "";
            }
            const wordTimes = words.match(this.rxps.wordTimeAll);
            if (!wordTimes) return;
            let preTimeInfo;
            for (const timeStr of wordTimes) {
              const result2 = this.rxps.wordTime.exec(timeStr);
              const wordInfo = this.getWordInfo(result2[1], result2[2], preTimeInfo);
              words = words.replace(timeStr, wordInfo.timeStr);
              if (preTimeInfo?.newTimeStr) words = words.replace(preTimeInfo.timeStr, preTimeInfo.newTimeStr);
              preTimeInfo = wordInfo;
            }
            this.lines.push(time + words);
            return;
          }
          result = this.rxps.tagLine.exec(line);
          if (!result) return;
          if (result[1] == "kuwo") {
            let content = result[2];
            if (content != null && content.includes("][")) {
              content = content.substring(0, content.indexOf("]["));
            }
            const valueOf = parseInt(content, 8);
            this.offset = Math.trunc(valueOf / 10);
            this.offset2 = Math.trunc(valueOf % 10);
            if (this.offset == 0 || Number.isNaN(this.offset) || this.offset2 == 0 || Number.isNaN(this.offset2)) {
              this.isOK = false;
            }
          } else {
            this.tags.push(line);
          }
        },
        parse(lrc) {
          const lines = lrc.split(/\r\n|\r|\n/);
          const tools = Object.create(this);
          tools.isOK = true;
          tools.offset = 1;
          tools.offset2 = 1;
          tools.lines = [];
          tools.tags = [];
          for (const line of lines) {
            if (!tools.isOK) throw new Error("failed");
            tools.parseLine(line);
          }
          if (!tools.lines.length) return "";
          let lrcs = tools.lines.join("\n");
          if (tools.tags.length) lrcs = `${tools.tags.join("\n")}
${lrcs}`;
          return lrcs;
        }
      };
      wbdCrypto = {
        aesMode: "aes-128-ecb",
        // aesKey: __LXBUF.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228], 'binary'),
        aesKey: "cFcnPcf6Kb85RC1y3V6M5A==",
        aesIv: "",
        appId: "y67sprxhhpws",
        decodeData(base64Result) {
          const data = decodeURIComponent(base64Result);
          return JSON.parse(Buffer2.from(aesDecryptSync(data, this.aesKey, this.aesIv, AES_MODE.ECB_128_NoPadding), "base64").toString("utf8"));
        },
        createSign(data, time) {
          const str = `${this.appId}${data}${time}`;
          return toMD5(str).toUpperCase();
        },
        buildParam(jsonData) {
          const data = Buffer2.from(JSON.stringify(jsonData)).toString("base64");
          const time = Date.now();
          const encodeData = aesEncryptSync(data, this.aesKey, this.aesIv, AES_MODE.ECB_128_NoPadding);
          const sign = this.createSign(encodeData, time);
          return `data=${encodeURIComponent(encodeData)}&time=${time}&appId=${this.appId}&sign=${sign}`;
        }
      };
    }
  });

  // src/musicSdk/kw/musicSearch.js
  var musicSearch_default;
  var init_musicSearch = __esm({
    "src/musicSdk/kw/musicSearch.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_util();
      musicSearch_default = {
        regExps: {
          mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/
        },
        limit: 30,
        total: 0,
        page: 0,
        allPage: 1,
        // cancelFn: null,
        musicSearch(str, page, limit) {
          const musicSearchRequestObj = httpFetch(`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`);
          return musicSearchRequestObj.promise;
        },
        // getImg(songId) {
        //   return httpGet(`http://player.kuwo.cn/webmusic/sj/dtflagdate?flag=6&rid=MUSIC_${songId}`)
        // },
        // getLrc(songId) {
        //   return httpGet(`http://mobile.kuwo.cn/mpage/html5/songinfoandlrc?mid=${songId}&flag=0`)
        // },
        handleResult(rawData) {
          const result = [];
          if (!rawData) return result;
          for (let i = 0; i < rawData.length; i++) {
            const info = rawData[i];
            let songId = info.MUSICRID.replace("MUSIC_", "");
            if (!info.N_MINFO) {
              console.log("N_MINFO is undefined");
              return null;
            }
            const types = [];
            const _types = {};
            let infoArr = info.N_MINFO.split(";");
            for (let info2 of infoArr) {
              info2 = info2.match(this.regExps.mInfo);
              if (info2) {
                switch (info2[2]) {
                  case "4000":
                    types.push({ type: "flac24bit", size: info2[4] });
                    _types.flac24bit = {
                      size: info2[4].toLocaleUpperCase()
                    };
                    break;
                  case "2000":
                    types.push({ type: "flac", size: info2[4] });
                    _types.flac = {
                      size: info2[4].toLocaleUpperCase()
                    };
                    break;
                  case "320":
                    types.push({ type: "320k", size: info2[4] });
                    _types["320k"] = {
                      size: info2[4].toLocaleUpperCase()
                    };
                    break;
                  case "128":
                    types.push({ type: "128k", size: info2[4] });
                    _types["128k"] = {
                      size: info2[4].toLocaleUpperCase()
                    };
                    break;
                }
              }
            }
            types.reverse();
            let interval = parseInt(info.DURATION);
            result.push({
              name: decodeName(info.SONGNAME),
              singer: formatSinger(decodeName(info.ARTIST)),
              source: "kw",
              // img = (info.album.name === '' || info.album.name === '空')
              //   ? `http://player.kuwo.cn/webmusic/sj/dtflagdate?flag=6&rid=MUSIC_160911.jpg`
              //   : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${info.album.mid}.jpg`
              songmid: songId,
              albumId: decodeName(info.ALBUMID || ""),
              interval: Number.isNaN(interval) ? 0 : formatPlayTime(interval),
              albumName: info.ALBUM ? decodeName(info.ALBUM) : "",
              lrc: null,
              // r.s 行内 web_albumpic_short 是相对路径（如 120/s3s94/93/xx.jpg），需拼专辑图域前缀
              img: info.web_albumpic_short ? "https://img4.kuwo.cn/star/albumcover/" + info.web_albumpic_short : null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            });
          }
          return result;
        },
        search(str, page = 1, limit, retryNum = 0) {
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          if (limit == null) limit = this.limit;
          return this.musicSearch(str, page, limit).then(({ body: result }) => {
            if (!result || result.TOTAL !== "0" && result.SHOW === "0") return this.search(str, page, limit, ++retryNum);
            let list = this.handleResult(result.abslist);
            if (list == null) return this.search(str, page, limit, ++retryNum);
            this.total = parseInt(result.TOTAL);
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return Promise.resolve({
              list,
              allPage: this.allPage,
              total: this.total,
              limit,
              source: "kw"
            });
          });
        }
      };
    }
  });

  // src/musicSdk/kw/leaderboard.js
  var boardList, sortQualityArray, leaderboard_default;
  var init_leaderboard = __esm({
    "src/musicSdk/kw/leaderboard.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_util();
      boardList = [{ id: "kw__93", name: "飙升榜", bangid: "93" }, { id: "kw__17", name: "新歌榜", bangid: "17" }, { id: "kw__16", name: "热歌榜", bangid: "16" }, { id: "kw__158", name: "抖音热歌榜", bangid: "158" }, { id: "kw__292", name: "铃声榜", bangid: "292" }, { id: "kw__284", name: "热评榜", bangid: "284" }, { id: "kw__290", name: "ACG新歌榜", bangid: "290" }, { id: "kw__286", name: "台湾KKBOX榜", bangid: "286" }, { id: "kw__279", name: "冬日暖心榜", bangid: "279" }, { id: "kw__281", name: "巴士随身听榜", bangid: "281" }, { id: "kw__255", name: "KTV点唱榜", bangid: "255" }, { id: "kw__280", name: "家务进行曲榜", bangid: "280" }, { id: "kw__282", name: "熬夜修仙榜", bangid: "282" }, { id: "kw__283", name: "枕边轻音乐榜", bangid: "283" }, { id: "kw__278", name: "古风音乐榜", bangid: "278" }, { id: "kw__264", name: "Vlog音乐榜", bangid: "264" }, { id: "kw__242", name: "电音榜", bangid: "242" }, { id: "kw__187", name: "流行趋势榜", bangid: "187" }, { id: "kw__204", name: "现场音乐榜", bangid: "204" }, { id: "kw__186", name: "ACG神曲榜", bangid: "186" }, { id: "kw__185", name: "最强翻唱榜", bangid: "185" }, { id: "kw__26", name: "经典怀旧榜", bangid: "26" }, { id: "kw__104", name: "华语榜", bangid: "104" }, { id: "kw__182", name: "粤语榜", bangid: "182" }, { id: "kw__22", name: "欧美榜", bangid: "22" }, { id: "kw__184", name: "韩语榜", bangid: "184" }, { id: "kw__183", name: "日语榜", bangid: "183" }, { id: "kw__145", name: "会员畅听榜", bangid: "145" }, { id: "kw__153", name: "网红新歌榜", bangid: "153" }, { id: "kw__64", name: "影视金曲榜", bangid: "64" }, { id: "kw__176", name: "DJ嗨歌榜", bangid: "176" }, { id: "kw__106", name: "真声音", bangid: "106" }, { id: "kw__12", name: "Billboard榜", bangid: "12" }, { id: "kw__49", name: "iTunes音乐榜", bangid: "49" }, { id: "kw__180", name: "beatport电音榜", bangid: "180" }, { id: "kw__13", name: "英国UK榜", bangid: "13" }, { id: "kw__164", name: "百大DJ榜", bangid: "164" }, { id: "kw__246", name: "YouTube音乐排行榜", bangid: "246" }, { id: "kw__265", name: "韩国Genie榜", bangid: "265" }, { id: "kw__14", name: "韩国M-net榜", bangid: "14" }, { id: "kw__8", name: "香港电台榜", bangid: "8" }, { id: "kw__15", name: "日本公信榜", bangid: "15" }, { id: "kw__151", name: "腾讯音乐人原创榜", bangid: "151" }];
      sortQualityArray = (array) => {
        const qualityMap = {
          flac24bit: 4,
          flac: 3,
          "320k": 2,
          "128k": 1
        };
        const rawQualityArray = [];
        const newQualityArray = [];
        array.forEach((item, index) => {
          const type = qualityMap[item.type];
          if (!type) return;
          rawQualityArray.push({ type, index });
        });
        rawQualityArray.sort((a, b) => a.type - b.type);
        rawQualityArray.forEach((item) => {
          newQualityArray.push(array[item.index]);
        });
        return newQualityArray;
      };
      leaderboard_default = {
        list: [
          {
            id: "kwbiaosb",
            name: "飙升榜",
            bangid: 93
          },
          {
            id: "kwregb",
            name: "热歌榜",
            bangid: 16
          },
          {
            id: "kwhuiyb",
            name: "会员榜",
            bangid: 145
          },
          {
            id: "kwdouyb",
            name: "抖音榜",
            bangid: 158
          },
          {
            id: "kwqsb",
            name: "趋势榜",
            bangid: 187
          },
          {
            id: "kwhuaijb",
            name: "怀旧榜",
            bangid: 26
          },
          {
            id: "kwhuayb",
            name: "华语榜",
            bangid: 104
          },
          {
            id: "kwyueyb",
            name: "粤语榜",
            bangid: 182
          },
          {
            id: "kwoumb",
            name: "欧美榜",
            bangid: 22
          },
          {
            id: "kwhanyb",
            name: "韩语榜",
            bangid: 184
          },
          {
            id: "kwriyb",
            name: "日语榜",
            bangid: 183
          }
        ],
        // getUrl: (p, l, id) => `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${p - 1}&rn=${l}&type=bang&data=content&id=${id}&show_copyright_off=0&pcmp4=1&isbang=1`,
        regExps: {
          mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/
        },
        limit: 100,
        _requestBoardsObj: null,
        getBoardsData() {
          if (this._requestBoardsObj) this._requestBoardsObj.cancelHttp();
          this._requestBoardsObj = httpFetch("http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2");
          return this._requestBoardsObj.promise;
        },
        getData(url) {
          const requestDataObj = httpFetch(url);
          return requestDataObj.promise;
        },
        filterData(rawList) {
          return rawList.map((item) => {
            let types = [];
            const _types = {};
            const qualitys = /* @__PURE__ */ new Set();
            item.n_minfo.split(";").forEach((i) => {
              const info = i.match(this.regExps.mInfo);
              if (!info) return;
              const quality = info[2];
              const size = info[4].toLocaleUpperCase();
              if (qualitys.has(quality)) return;
              qualitys.add(quality);
              switch (quality) {
                case "4000":
                  types.push({ type: "flac24bit", size });
                  _types.flac24bit = { size };
                  break;
                case "2000":
                  types.push({ type: "flac", size });
                  _types.flac = { size };
                  break;
                case "320":
                  types.push({ type: "320k", size });
                  _types["320k"] = { size };
                  break;
                case "128":
                  types.push({ type: "128k", size });
                  _types["128k"] = { size };
                  break;
              }
            });
            types = sortQualityArray(types);
            return {
              singer: formatSinger(decodeName(item.artist)),
              name: decodeName(item.name),
              albumName: decodeName(item.album),
              albumId: item.albumId,
              songmid: item.id,
              source: "kw",
              interval: formatPlayTime(parseInt(item.duration)),
              img: item.pic,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        filterBoardsData(rawList) {
          let list = [];
          for (const board of rawList) {
            if (board.source != "1") continue;
            list.push({
              id: "kw__" + board.sourceid,
              name: board.name,
              bangid: String(board.sourceid)
            });
          }
          return list;
        },
        async getBoards(retryNum = 0) {
          this.list = boardList;
          return {
            list: boardList,
            source: "kw"
          };
        },
        getList(id, page, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          const requestBody = { uid: "", devId: "", sFrom: "kuwo_sdk", user_type: "AP", carSource: "kwplayercar_ar_6.0.1.0_apk_keluze.apk", id, pn: page - 1, rn: this.limit };
          const requestUrl = `https://wbd.kuwo.cn/api/bd/bang/bang_info?${wbdCrypto.buildParam(requestBody)}`;
          const request = httpFetch(requestUrl, { cache: "default" }).promise;
          return request.then(({ statusCode, body }) => {
            const rawData = wbdCrypto.decodeData(body);
            const data = rawData.data;
            if (statusCode !== 200 || rawData.code != 200 || !data.musiclist) return this.getList(id, page, retryNum);
            const total = parseInt(data.total);
            const list = this.filterData(data.musiclist);
            return {
              total,
              list,
              limit: this.limit,
              page,
              source: "kw"
            };
          });
        }
        // getDetailPageUrl(id) {
        //   return `http://www.kuwo.cn/rankList/${id}`
        // },
      };
    }
  });

  // src/musicSdk/kw/lyric.js
  var timeExp, existTimeExp, lyricxTag, lyric_default;
  var init_lyric = __esm({
    "src/musicSdk/kw/lyric.js"() {
      "use strict";
      init_buffer();
      init_request();
      init_util();
      init_utils_index();
      timeExp = /^\[([\d:.]*)\]{1}/g;
      existTimeExp = /\[\d{1,2}:.*\d{1,4}]/;
      lyricxTag = /^<-?\d+,-?\d+>/;
      lyric_default = {
        /* sortLrcArr(arr) {
            const lrcSet = new Set()
            let lrc = []
            let lrcT = []
            let markIndex = []
            for (const item of arr) {
              if (lrcSet.has(item.time)) {
                if (lrc.length < 2) continue
                const index = lrc.findIndex(l => l.time == item.time)
                markIndex.push(index)
                if (index == lrc.length - 1) {
                  lrcT.push({ ...lrc[index], time: item.time })
                  lrc.push(item)
                } else {
                  lrcT.push({ ...lrc[index], time: lrc[index + 1].time })
                  if (item.text) {
                    //   const lastIndex = lrc.length - 1
                    //   markIndex.push(lastIndex)
                    //   lrcT.push({ ...lrc[lastIndex], time: lrc[lastIndex - 1].time })
                    lrc.push(item)
                  }
                }
              } else {
                lrc.push(item)
                lrcSet.add(item.time)
              }
            }
        
            // console.log(markIndex)
            markIndex = Array.from(new Set(markIndex))
            for (let index = markIndex.length - 1; index >= 0; index--) {
              lrc.splice(markIndex[index], 1)
            }
        
            // if (lrcT.length) {
            //   if (lrc.length * 0.4 < lrcT.length) { // 翻译数量需大于歌词数量的0.4倍，否则认为没有翻译
            //     const tItem = lrc.pop()
            //     tItem.time = lrc[lrc.length - 1].time
            //     lrcT.push(tItem)
            //   } else {
            //     lrc = arr
            //     lrcT = []
            //   }
            // }
        
            console.log(lrc, lrcT)
        
            return {
              lrc,
              lrcT,
            }
          }, */
        sortLrcArr(arr) {
          const lrcSet = /* @__PURE__ */ new Set();
          let lrc = [];
          let lrcT = [];
          let isLyricx = false;
          for (const item of arr) {
            if (lrcSet.has(item.time)) {
              if (lrc.length < 2) continue;
              const tItem = lrc.pop();
              tItem.time = lrc[lrc.length - 1].time;
              lrcT.push(tItem);
              lrc.push(item);
            } else {
              lrc.push(item);
              lrcSet.add(item.time);
            }
            if (!isLyricx && lyricxTag.test(item.text)) isLyricx = true;
          }
          if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) {
            throw new Error("failed");
          }
          return {
            lrc,
            lrcT
          };
        },
        transformLrc(tags, lrclist) {
          return `${tags.join("\n")}
${lrclist ? lrclist.map((l) => `[${l.time}]${l.text}
`).join("") : "暂无歌词"}`;
        },
        parseLrc(lrc) {
          const lines = lrc.split(/\r\n|\r|\n/);
          let tags = [];
          let lrcArr = [];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            let result = timeExp.exec(line);
            if (result) {
              const text = line.replace(timeExp, "").trim();
              let time = result[1];
              if (/\.\d\d$/.test(time)) time += "0";
              lrcArr.push({
                time,
                text
              });
            } else if (lrcTools.rxps.tagLine.test(line)) {
              tags.push(line);
            }
          }
          const lrcInfo = this.sortLrcArr(lrcArr);
          return {
            lyric: decodeName(this.transformLrc(tags, lrcInfo.lrc)),
            tlyric: lrcInfo.lrcT.length ? decodeName(this.transformLrc(tags, lrcInfo.lrcT)) : ""
          };
        },
        // getLyric2(musicInfo, isGetLyricx = true) {
        //   const requestObj = httpFetch(`http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(musicInfo.songmid, isGetLyricx)}`)
        //   requestObj.promise = requestObj.promise.then(({ statusCode, body, raw }) => {
        //     if (statusCode != 200) return Promise.reject(new Error(JSON.stringify(body)))
        //     return decodeLyric({ lrcBase64: raw.toString('base64'), isGetLyricx }).then(base64Data => {
        //       let lrcInfo
        //       console.log(__LXBUF.from(base64Data, 'base64').toString())
        //       try {
        //         lrcInfo = this.parseLrc(__LXBUF.from(base64Data, 'base64').toString())
        //       } catch {
        //         return Promise.reject(new Error('Get lyric failed'))
        //       }
        //       if (lrcInfo.tlyric) lrcInfo.tlyric = lrcInfo.tlyric.replace(lrcTools.rxps.wordTimeAll, '')
        //       lrcInfo.lxlyric = lrcTools.parse(lrcInfo.lyric)
        //       // console.log(lrcInfo.lyric)
        //       // console.log(lrcInfo.tlyric)
        //       // console.log(lrcInfo.lxlyric)
        //       // console.log(JSON.stringify(lrcInfo))
        //     })
        //   })
        //   return requestObj
        // },
        getLyric(musicInfo, isGetLyricx = true) {
          const requestObj = httpFetch(`http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=${isGetLyricx ? 1 : 0}&rid=${musicInfo.songmid}&encode=utf8`, {
            cache: false,
            binary: true
          });
          requestObj.promise = requestObj.promise.then(async ({ statusCode, body }) => {
            if (statusCode != 200) return Promise.reject(new Error(JSON.stringify(body)));
            const lrcText = await decodeLyric_default({ lrcBuffer: body, isGetLyricx });
            let lrcInfo;
            try {
              lrcInfo = this.parseLrc(lrcText);
            } catch {
              return Promise.reject(new Error("Get lyric failed"));
            }
            if (lrcInfo.tlyric) lrcInfo.tlyric = lrcInfo.tlyric.replace(lrcTools.rxps.wordTimeAll, "");
            try {
              lrcInfo.lxlyric = lrcTools.parse(lrcInfo.lyric);
            } catch {
              lrcInfo.lxlyric = "";
            }
            lrcInfo.lyric = lrcInfo.lyric.replace(lrcTools.rxps.wordTimeAll, "");
            if (!existTimeExp.test(lrcInfo.lyric)) return Promise.reject(new Error("Get lyric failed"));
            return lrcInfo;
          });
          return requestObj;
        }
      };
    }
  });

  // src/musicSdk/kw/pic.js
  var pic_default;
  var init_pic = __esm({
    "src/musicSdk/kw/pic.js"() {
      "use strict";
      init_request();
      pic_default = {
        getPic({ songmid }) {
          const requestObj = httpFetch(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`);
          requestObj.promise = requestObj.promise.then(({ body }) => /^http/.test(body) ? body : null);
          return requestObj.promise;
        }
      };
    }
  });

  // src/musicSdk/api-source-info.ts
  var sources, api_source_info_default;
  var init_api_source_info = __esm({
    "src/musicSdk/api-source-info.ts"() {
      "use strict";
      sources = [];
      api_source_info_default = sources;
    }
  });

  // src/shims/env.js
  function dateFormat3() {
    return "";
  }
  function dateFormat22(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts) || ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function formatPlayCount2(n) {
    const v = Number(n) || 0;
    return v >= 1e8 ? Math.floor(v / 1e8) + "亿" : v >= 1e4 ? Math.floor(v / 1e4) + "万" : String(v);
  }
  function toMD52(str) {
    return typeof __lxMd5 === "function" ? __lxMd5(String(str)) : globalThis.lx.utils.crypto.md5(String(str));
  }
  var isWin, isMac, isLinux, isMobile, isNavigator, settingState, debug, env_default;
  var init_env = __esm({
    "src/shims/env.js"() {
      "use strict";
      isWin = true;
      isMac = false;
      isLinux = false;
      isMobile = false;
      isNavigator = true;
      globalThis.__lxQualityList = globalThis.__lxQualityList || {
        kw: ["flac24bit", "flac", "320k", "128k"],
        kg: ["flac", "320k", "128k"],
        tx: ["flac", "320k", "128k"],
        wy: ["flac", "320k", "128k"],
        mg: ["flac", "320k", "128k"]
      };
      settingState = new Proxy({}, { get: () => "" });
      debug = () => {
      };
      env_default = { isWin, isMac, isLinux, isMobile, isNavigator, settingState, dateFormat: dateFormat3, dateFormat2: dateFormat22, formatPlayCount: formatPlayCount2, debug, toMD5: toMD52 };
    }
  });

  // src/musicSdk/api-source.js
  var apiList, supportQuality, getAPI, apis;
  var init_api_source = __esm({
    "src/musicSdk/api-source.js"() {
      "use strict";
      init_api_source_info();
      init_env();
      apiList = {
        // temp_api_kw,
        // // test_api_bd: require('./bd/api-test'),
        // test_api_kg,
        // test_api_kw,
        // test_api_tx,
        // test_api_wy,
        // test_api_mg,
        // direct_api_kg,
        // direct_api_kw,
        // direct_api_tx,
        // direct_api_wy,
        // direct_api_mg,
        // test_api_tx: require('./tx/api-test'),
        // test_api_wy: require('./wy/api-test'),
        // test_api_xm: require('./xm/api-test'),
      };
      supportQuality = {};
      for (const api of api_source_info_default) {
        supportQuality[api.id] = api.supportQualitys;
      }
      getAPI = (source) => apiList[`${env_default.setting["common.apiSource"]}_api_${source}`];
      apis = (source) => {
        if (/^user_api/.test(env_default.setting["common.apiSource"])) return global.lx.apis[source];
        const api = getAPI(source);
        if (api) return api;
        throw new Error("Api is not found");
      };
    }
  });

  // src/musicSdk/kw/album.js
  var album_default;
  var init_album = __esm({
    "src/musicSdk/kw/album.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_util();
      album_default = {
        limit_list: 36,
        limit_song: 1e3,
        filterListDetail(rawList, albumName, albumId) {
          return rawList.map((item, inedx) => {
            let formats = item.formats.split("|");
            let types = [];
            let _types = {};
            if (formats.includes("MP3128")) {
              types.push({ type: "128k", size: null });
              _types["128k"] = {
                size: null
              };
            }
            if (formats.includes("MP3H")) {
              types.push({ type: "320k", size: null });
              _types["320k"] = {
                size: null
              };
            }
            if (formats.includes("ALFLAC")) {
              types.push({ type: "flac", size: null });
              _types.flac = {
                size: null
              };
            }
            if (formats.includes("HIRFLAC")) {
              types.push({ type: "flac24bit", size: null });
              _types.flac24bit = {
                size: null
              };
            }
            return {
              singer: formatSinger(decodeName(item.artist)),
              name: decodeName(item.name),
              albumName,
              albumId,
              songmid: item.id,
              source: "kw",
              interval: null,
              img: item.pic,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        /**
         * 格式化播放数量
         * @param {*} num
         */
        formatPlayCount(num) {
          if (num > 1e8) return parseInt(num / 1e7) / 10 + "亿";
          if (num > 1e4) return parseInt(num / 1e3) / 10 + "万";
          return num;
        },
        getAlbumListDetail(id, page, retryNum = 0) {
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj_listDetail = httpFetch(`http://search.kuwo.cn/r.s?pn=${page - 1}&rn=${this.limit_song}&stype=albuminfo&albumid=${id}&show_copyright_off=0&encoding=utf&vipver=MUSIC_9.1.0`);
          return requestObj_listDetail.promise.then(({ statusCode, body }) => {
            if (statusCode !== 200) return this.getAlbumListDetail(id, page, ++retryNum);
            body = objStr2JSON(body);
            if (!body.musiclist) return this.getAlbumListDetail(id, page, ++retryNum);
            body.name = decodeName(body.name);
            return {
              list: this.filterListDetail(body.musiclist, body.name, body.albumid),
              page,
              limit: this.limit_song,
              total: parseInt(body.songnum),
              source: "kw",
              info: {
                name: body.name,
                img: body.img || body.hts_img,
                desc: decodeName(body.info),
                author: decodeName(body.artist)
                // play_count: this.formatPlayCount(body.playnum),
              }
            };
          });
        }
        // getAlbumListDetail(id, page, retryNum = 0) {
        //   if (retryNum > 2) return Promise.reject(new Error('try max num'))
        //   return tokenRequest(`http://www.kuwo.cn/api/www/album/albumInfo?albumId=${id}&pn=${page}&rn=${this.limit_song}&httpsStatus=1`).then((resp) => {
        //     return resp.promise.then(({ statusCode, body }) => {
        //       console.log(body)
        //       return Promise.reject(new Error('failed'))
        //       // if (statusCode !== 200) return this.getAlbumListDetail(id, page, ++retryNum)
        //       // const data = body.data
        //       // console.log(data)
        //       // if (!data.musicList) return this.getAlbumListDetail(id, page, ++retryNum)
        //       // return {
        //       //   list: this.filterListDetail(data.musiclist),
        //       //   page,
        //       //   limit: this.limit_song,
        //       //   total: data.total,
        //       //   source: 'kw',
        //       //   info: {
        //       //     name: data.album,
        //       //     img: data.pic,
        //       //     desc: data.albuminfo,
        //       //     author: data.artist,
        //       //     play_count: this.formatPlayCount(data.playCnt),
        //       //   },
        //       // }
        //     })
        //   })
        // },
      };
    }
  });

  // src/musicSdk/kw/songList.js
  var songList_default;
  var init_songList = __esm({
    "src/musicSdk/kw/songList.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_util();
      init_album();
      songList_default = {
        _requestObj_tags: null,
        _requestObj_hotTags: null,
        _requestObj_list: null,
        limit_list: 36,
        limit_song: 1e3,
        successCode: 200,
        sortList: [
          {
            name: "最新",
            tid: "new",
            id: "new"
          },
          {
            name: "最热",
            tid: "hot",
            id: "hot"
          }
        ],
        regExps: {
          mInfo: /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/,
          // http://www.kuwo.cn/playlist_detail/2886046289
          // https://m.kuwo.cn/h5app/playlist/2736267853?t=qqfriend
          listDetailLink: /^.+\/playlist(?:_detail)?\/(\d+)(?:\?.*|&.*$|#.*$|$)/
        },
        tagsUrl: "http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0&vipver=9.0.5.0&source=kwplayer_pc_9.0.5.0&loginUid=0&loginSid=0&appUid=76039576",
        hotTagUrl: "http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmTagList?loginUid=0&loginSid=0&appUid=76039576",
        getListUrl({ sortId, id, type, page }) {
          if (!id) return `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&&pn=${page}&rn=${this.limit_list}&order=${sortId}`;
          switch (type) {
            case "10000":
              return `http://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&id=${id}&rn=${this.limit_list}`;
            case "43":
              return `http://mobileinterfaces.kuwo.cn/er.s?type=get_pc_qz_data&f=web&id=${id}&prod=pc`;
          }
        },
        getListDetailUrl(id, page) {
          return `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page - 1}&rn=${this.limit_song}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
        },
        // http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=2849349915&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1
        // 获取标签
        getTag(tryNum = 0) {
          if (this._requestObj_tags) this._requestObj_tags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_tags = httpFetch(this.tagsUrl);
          return this._requestObj_tags.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getTag(++tryNum);
            return this.filterTagInfo(body.data);
          });
        },
        // 获取标签
        getHotTag(tryNum = 0) {
          if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_hotTags = httpFetch(this.hotTagUrl);
          return this._requestObj_hotTags.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getHotTag(++tryNum);
            return this.filterInfoHotTag(body.data[0].data);
          });
        },
        filterInfoHotTag(rawList) {
          return rawList.map((item) => ({
            id: `${item.id}-${item.digest}`,
            name: item.name,
            source: "kw"
          }));
        },
        filterTagInfo(rawList) {
          return rawList.map((type) => ({
            name: type.name,
            list: type.data.map((item) => ({
              parent_id: type.id,
              parent_name: type.name,
              id: `${item.id}-${item.digest}`,
              name: item.name,
              source: "kw"
            }))
          }));
        },
        // 获取列表数据
        getList(sortId, tagId, page, tryNum = 0) {
          if (this._requestObj_list) this._requestObj_list.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          let id;
          let type;
          if (tagId) {
            let arr = tagId.split("-");
            id = arr[0];
            type = arr[1];
          } else {
            id = null;
          }
          this._requestObj_list = httpFetch(this.getListUrl({ sortId, id, type, page }));
          return this._requestObj_list.promise.then(({ body }) => {
            if (!id || type == "10000") {
              if (body.code !== this.successCode) return this.getList(sortId, tagId, page, ++tryNum);
              return {
                list: this.filterList(body.data.data),
                total: body.data.total,
                page: body.data.pn,
                limit: body.data.rn,
                source: "kw"
              };
            } else if (!body.length) {
              return this.getList(sortId, tagId, page, ++tryNum);
            }
            return {
              list: this.filterList2(body),
              total: 1e3,
              page,
              limit: 1e3,
              source: "kw"
            };
          });
        },
        /**
         * 格式化播放数量
         * @param {*} num
         */
        formatPlayCount(num) {
          if (num > 1e8) return parseInt(num / 1e7) / 10 + "亿";
          if (num > 1e4) return parseInt(num / 1e3) / 10 + "万";
          return num;
        },
        filterList(rawData) {
          return rawData.map((item) => ({
            play_count: this.formatPlayCount(item.listencnt),
            id: `digest-${item.digest}__${item.id}`,
            author: item.uname,
            name: item.name,
            // time: item.publish_time,
            total: item.total,
            img: item.img,
            grade: item.favorcnt / 10,
            desc: item.desc,
            source: "kw"
          }));
        },
        filterList2(rawData) {
          const list = [];
          const allowedTypes = ["songlist", "list", "album"];
          rawData.forEach((item) => {
            item.list.forEach((item2) => {
              if (!allowedTypes.includes(item2.type)) return;
              list.push({
                play_count: item2.play_count && this.formatPlayCount(item2.listencnt),
                id: `digest-${item2.digest}__${item2.id}`,
                author: item2.uname,
                name: item2.name,
                total: item2.total,
                // time: item.publish_time,
                img: item2.img,
                grade: item2.favorcnt && item2.favorcnt / 10,
                desc: item2.desc,
                source: "kw"
              });
            });
          });
          return list;
        },
        getListDetailDigest8(id, page, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj = httpFetch(this.getListDetailUrl(id, page));
          return requestObj.promise.then(({ body }) => {
            if (body.result !== "ok") return this.getListDetail(id, page, ++tryNum);
            return {
              list: this.filterListDetail(body.musiclist),
              page,
              limit: body.rn,
              total: body.total,
              source: "kw",
              info: {
                name: body.title,
                img: body.pic,
                desc: body.info,
                author: body.uname,
                play_count: this.formatPlayCount(body.playnum)
              }
            };
          });
        },
        getListDetailDigest5Info(id, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj = httpFetch(`http://qukudata.kuwo.cn/q.k?op=query&cont=ninfo&node=${id}&pn=0&rn=1&fmt=json&src=mbox&level=2`);
          return requestObj.promise.then(({ statusCode, body }) => {
            if (statusCode != 200 || !body.child) return this.getListDetail(id, ++tryNum);
            return body.child.length ? body.child[0].sourceid : null;
          });
        },
        getListDetailDigest5Music(id, page, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj = httpFetch(`http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page - 1}}&rn=${this.limit_song}&encode=utf-8&keyset=pl2012&identity=kuwo&pcmp4=1`);
          return requestObj.promise.then(({ body }) => {
            if (body.result !== "ok") return this.getListDetail(id, page, ++tryNum);
            return {
              list: this.filterListDetail(body.musiclist),
              page,
              limit: body.rn,
              total: body.total,
              source: "kw",
              info: {
                name: body.title,
                img: body.pic,
                desc: body.info,
                author: body.uname,
                play_count: this.formatPlayCount(body.playnum)
              }
            };
          });
        },
        async getListDetailDigest5(id, page, retryNum) {
          const detailId = await this.getListDetailDigest5Info(id, retryNum);
          return this.getListDetailDigest5Music(detailId, page, retryNum);
        },
        filterBDListDetail(rawList) {
          return rawList.map((item) => {
            let types = [];
            let _types = {};
            for (let info of item.audios) {
              info.size = info.size?.toLocaleUpperCase();
              switch (info.bitrate) {
                case "4000":
                  types.push({ type: "flac24bit", size: info.size });
                  _types.flac24bit = {
                    size: info.size
                  };
                  break;
                case "2000":
                  types.push({ type: "flac", size: info.size });
                  _types.flac = {
                    size: info.size
                  };
                  break;
                case "320":
                  types.push({ type: "320k", size: info.size });
                  _types["320k"] = {
                    size: info.size
                  };
                  break;
                case "128":
                  types.push({ type: "128k", size: info.size });
                  _types["128k"] = {
                    size: info.size
                  };
                  break;
              }
            }
            types.reverse();
            return {
              singer: item.artists.map((s) => s.name).join("、"),
              name: item.name,
              albumName: item.album,
              albumId: item.albumId,
              songmid: item.id,
              source: "kw",
              interval: formatPlayTime(item.duration),
              img: item.albumPic,
              releaseDate: item.releaseDate,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        getReqId() {
          function t() {
            return (65536 * (1 + Math.random()) | 0).toString(16).substring(1);
          }
          return t() + t() + t() + t() + t() + t() + t() + t();
        },
        async getListDetailMusicListByBDListInfo(id, source) {
          const { body: infoData } = await httpFetch(`https://bd-api.kuwo.cn/api/service/playlist/info/${id}?reqId=${this.getReqId()}&source=${source}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
              plat: "h5"
            }
          }).promise.catch(() => ({ code: 0 }));
          if (infoData.code != 200) return null;
          return {
            name: infoData.data.name,
            img: infoData.data.pic,
            desc: infoData.data.description,
            author: infoData.data.creatorName,
            play_count: infoData.data.playNum
          };
        },
        async getListDetailMusicListByBDUserPub(id) {
          const { body: infoData } = await httpFetch(`https://bd-api.kuwo.cn/api/ucenter/users/pub/${id}?reqId=${this.getReqId()}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
              plat: "h5"
            }
          }).promise.catch(() => ({ code: 0 }));
          if (infoData.code != 200) return null;
          return {
            name: infoData.data.userInfo.nickname + "喜欢的音乐",
            img: infoData.data.userInfo.headImg,
            desc: "",
            author: infoData.data.userInfo.nickname,
            play_count: ""
          };
        },
        async getListDetailMusicListByBDList(id, source, page, tryNum = 0) {
          const { body: listData } = await httpFetch(`https://bd-api.kuwo.cn/api/service/playlist/${id}/musicList?reqId=${this.getReqId()}&source=${source}&pn=${page}&rn=${this.limit_song}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
              plat: "h5"
            }
          }).promise.catch(() => {
            if (tryNum > 2) return Promise.reject(new Error("try max num"));
            return this.getListDetailMusicListByBDList(id, source, page, ++tryNum);
          });
          if (listData.code !== 200) return Promise.reject(new Error("failed"));
          return {
            list: this.filterBDListDetail(listData.data.list),
            page,
            limit: listData.data.pageSize,
            total: listData.data.total,
            source: "kw"
          };
        },
        async getListDetailMusicListByBD(id, page) {
          const uid = /uid=(\d+)/.exec(id)?.[1];
          const listId = /playlistId=(\d+)/.exec(id)?.[1];
          const source = /source=(\d+)/.exec(id)?.[1];
          if (!listId) return Promise.reject(new Error("failed"));
          const task = [this.getListDetailMusicListByBDList(listId, source, page)];
          switch (source) {
            case "4":
              task.push(this.getListDetailMusicListByBDListInfo(listId, source));
              break;
            case "5":
              task.push(this.getListDetailMusicListByBDUserPub(uid ?? listId));
              break;
          }
          const [listData, info] = await Promise.all(task);
          listData.info = info ?? {
            name: "",
            img: "",
            desc: "",
            author: "",
            play_count: ""
          };
          return listData;
        },
        // 获取歌曲列表内的音乐
        getListDetail(id, page, retryNum = 0) {
          if (/\/bodian\//.test(id)) return this.getListDetailMusicListByBD(id, page);
          if (/[?&:/]/.test(id)) id = id.replace(this.regExps.listDetailLink, "$1");
          else if (/^digest-/.test(id)) {
            let [digest, _id] = id.split("__");
            digest = digest.replace("digest-", "");
            id = _id;
            switch (digest) {
              case "8":
                break;
              case "13":
                return album_default.getAlbumListDetail(id, page, retryNum);
              case "5":
              default:
                return this.getListDetailDigest5(id, page, retryNum);
            }
          }
          return this.getListDetailDigest8(id, page, retryNum);
        },
        filterListDetail(rawData) {
          return rawData.map((item) => {
            let infoArr = item.N_MINFO.split(";");
            let types = [];
            let _types = {};
            for (let info of infoArr) {
              info = info.match(this.regExps.mInfo);
              if (info) {
                switch (info[2]) {
                  case "4000":
                    types.push({ type: "flac24bit", size: info[4] });
                    _types.flac24bit = {
                      size: info[4].toLocaleUpperCase()
                    };
                    break;
                  case "2000":
                    types.push({ type: "flac", size: info[4] });
                    _types.flac = {
                      size: info[4].toLocaleUpperCase()
                    };
                    break;
                  case "320":
                    types.push({ type: "320k", size: info[4] });
                    _types["320k"] = {
                      size: info[4].toLocaleUpperCase()
                    };
                    break;
                  case "128":
                    types.push({ type: "128k", size: info[4] });
                    _types["128k"] = {
                      size: info[4].toLocaleUpperCase()
                    };
                    break;
                }
              }
            }
            types.reverse();
            return {
              singer: formatSinger(decodeName(item.artist)),
              name: decodeName(item.name),
              albumName: decodeName(item.album),
              albumId: item.albumid,
              songmid: item.id,
              source: "kw",
              interval: formatPlayTime(parseInt(item.duration)),
              img: null,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        getTags() {
          return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: "kw" }));
        },
        getDetailPageUrl(id) {
          if (/[?&:/]/.test(id)) id = id.replace(this.regExps.listDetailLink, "$1");
          else if (/^digest-/.test(id)) {
            let result = id.split("__");
            id = result[1];
          }
          return `http://www.kuwo.cn/playlist_detail/${id}`;
        },
        search(text, page, limit = 20) {
          return httpFetch(`http://search.kuwo.cn/r.s?all=${encodeURIComponent(text)}&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0`).promise.then(({ body }) => {
            body = objStr2JSON(body);
            return {
              list: body.abslist.map((item) => {
                return {
                  play_count: this.formatPlayCount(item.playcnt),
                  id: item.playlistid,
                  author: decodeName(item.nickname),
                  name: decodeName(item.name),
                  total: item.songnum,
                  // time: item.publish_time,
                  img: item.pic,
                  desc: decodeName(item.intro),
                  source: "kw"
                };
              }),
              limit,
              total: parseInt(body.TOTAL),
              source: "kw"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/kw/hotSearch.js
  var hotSearch_default;
  var init_hotSearch = __esm({
    "src/musicSdk/kw/hotSearch.js"() {
      "use strict";
      init_request();
      hotSearch_default = {
        _requestObj: null,
        async getList(retryNum = 0) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const _requestObj = httpFetch("http://hotword.kuwo.cn/hotword.s?prod=kwplayer_ar_9.3.0.1&corp=kuwo&newver=2&vipver=9.3.0.1&source=kwplayer_ar_9.3.0.1_40.apk&p2p=1&notrace=0&uid=0&plat=kwplayer_ar&rformat=json&encoding=utf8&tabid=1", {
            headers: {
              "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9;)"
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.status !== "ok") throw new Error("获取热搜词失败");
          return { source: "kw", list: this.filterList(body.tagvalue) };
        },
        filterList(rawList) {
          return rawList.map((item) => item.key);
        }
      };
    }
  });

  // src/musicSdk/kw/comment.js
  var comment_default;
  var init_comment = __esm({
    "src/musicSdk/kw/comment.js"() {
      "use strict";
      init_request();
      init_utils_index();
      comment_default = {
        _requestObj: null,
        _requestObj2: null,
        async getComment({ songmid }, page = 1, limit = 20) {
          if (this._requestObj) this._requestObj.cancelHttp();
          const _requestObj = httpFetch(`http://ncomment.kuwo.cn/com.s?f=web&type=get_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid=${songmid}&start=${limit * (page - 1)}&msgflag=1&count=${limit}&newver=3&uid=0`, {
            headers: {
              "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9;)"
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code != "200") throw new Error("获取评论失败");
          const total = body.comments_counts;
          return {
            source: "kw",
            comments: this.filterComment(body.comments),
            total,
            page,
            limit,
            maxPage: Math.ceil(total / limit) || 1
          };
        },
        async getHotComment({ songmid }, page = 1, limit = 100) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          const _requestObj2 = httpFetch(`http://ncomment.kuwo.cn/com.s?f=web&type=get_rec_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid=${songmid}&start=${limit * (page - 1)}&msgflag=1&count=${limit}&newver=3&uid=0`, {
            headers: {
              "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 9;)"
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.code != "200") throw new Error("获取热门评论失败");
          const total = body.hot_comments_counts;
          return {
            source: "kw",
            comments: this.filterComment(body.hot_comments),
            total,
            page,
            limit,
            maxPage: Math.ceil(total / limit) || 1
          };
        },
        filterComment(rawList) {
          if (!rawList) return [];
          return rawList.map((item) => {
            return {
              id: item.id,
              text: item.msg,
              time: item.time,
              timeStr: dateFormat2(Number(item.time) * 1e3),
              userName: item.u_name,
              avatar: item.u_pic,
              userId: item.u_id,
              likedCount: item.like_num,
              images: item.mpic ? [decodeURIComponent(item.mpic)] : [],
              reply: item.child_comments ? item.child_comments.map((i) => {
                return {
                  id: i.id,
                  text: i.msg,
                  time: i.time,
                  timeStr: dateFormat2(Number(i.time) * 1e3),
                  userName: i.u_name,
                  avatar: i.u_pic,
                  userId: i.u_id,
                  likedCount: i.like_num,
                  images: i.mpic ? [i.mpic] : []
                };
              }) : []
            };
          });
        }
      };
    }
  });

  // src/musicSdk/kw/index.js
  var kw, kw_default;
  var init_kw = __esm({
    "src/musicSdk/kw/index.js"() {
      "use strict";
      init_request();
      init_tipSearch();
      init_musicSearch();
      init_util();
      init_leaderboard();
      init_lyric();
      init_pic();
      init_api_source();
      init_songList();
      init_hotSearch();
      init_comment();
      kw = {
        _musicInfoRequestObj: null,
        _musicInfoPromiseCancelFn: null,
        _musicPicRequestObj: null,
        _musicPicPromiseCancelFn: null,
        // context: null,
        // init(context) {
        //   if (this.isInited) return
        //   this.isInited = true
        //   this.context = context
        //   // this.musicSearch.search('我又想你了').then(res => {
        //   //   console.log(res)
        //   // })
        //   // this.getMusicUrl('62355680', '320k').then(url => {
        //   //   console.log(url)
        //   // })
        // },
        tipSearch: tipSearch_default,
        musicSearch: musicSearch_default,
        leaderboard: leaderboard_default,
        songList: songList_default,
        hotSearch: hotSearch_default,
        comment: comment_default,
        getLyric(songInfo, isGetLyricx) {
          return lyric_default.getLyric(songInfo, isGetLyricx);
        },
        handleMusicInfo(songInfo) {
          return this.getMusicInfo(songInfo).then((info) => {
            songInfo.name = info.name;
            songInfo.singer = formatSinger(info.artist);
            songInfo.img = info.pic;
            songInfo.albumName = info.album;
            return songInfo;
          });
        },
        getMusicUrl(songInfo, type) {
          return apis("kw").getMusicUrl(songInfo, type);
        },
        getMusicInfo(songInfo) {
          if (this._musicInfoRequestObj) this._musicInfoRequestObj.cancelHttp();
          this._musicInfoRequestObj = httpFetch(`http://www.kuwo.cn/api/www/music/musicInfo?mid=${songInfo.songmid}`);
          return this._musicInfoRequestObj.promise.then(({ body }) => {
            return body.code === 200 ? body.data : Promise.reject(new Error(body.msg));
          });
        },
        getMusicUrls(musicInfo, cb) {
          let tasks = [];
          let songId = musicInfo.songmid;
          musicInfo.types.forEach((type) => {
            tasks.push(kw.getMusicUrl(songId, type.type).promise);
          });
          Promise.all(tasks).then((urlInfo) => {
            let typeUrl = {};
            urlInfo.forEach((info) => {
              typeUrl[info.type] = info.url;
            });
            cb(typeUrl);
          });
        },
        getPic(songInfo) {
          return pic_default.getPic(songInfo);
        },
        getMusicDetailPageUrl(songInfo) {
          return `http://www.kuwo.cn/play_detail/${songInfo.songmid}`;
        }
        // init() {
        //   return getToken()
        // },
      };
      kw_default = kw;
    }
  });

  // src/musicSdk/kg/leaderboard.js
  var boardList2, leaderboard_default2;
  var init_leaderboard2 = __esm({
    "src/musicSdk/kg/leaderboard.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_utils();
      boardList2 = [{ id: "kg__8888", name: "TOP500", bangid: "8888" }, { id: "kg__6666", name: "飙升榜", bangid: "6666" }, { id: "kg__59703", name: "蜂鸟流行音乐榜", bangid: "59703" }, { id: "kg__52144", name: "抖音热歌榜", bangid: "52144" }, { id: "kg__52767", name: "快手热歌榜", bangid: "52767" }, { id: "kg__24971", name: "DJ热歌榜", bangid: "24971" }, { id: "kg__23784", name: "网络红歌榜", bangid: "23784" }, { id: "kg__44412", name: "说唱先锋榜", bangid: "44412" }, { id: "kg__31308", name: "内地榜", bangid: "31308" }, { id: "kg__33160", name: "电音榜", bangid: "33160" }, { id: "kg__31313", name: "香港地区榜", bangid: "31313" }, { id: "kg__51341", name: "民谣榜", bangid: "51341" }, { id: "kg__54848", name: "台湾地区榜", bangid: "54848" }, { id: "kg__31310", name: "欧美榜", bangid: "31310" }, { id: "kg__33162", name: "ACG新歌榜", bangid: "33162" }, { id: "kg__31311", name: "韩国榜", bangid: "31311" }, { id: "kg__31312", name: "日本榜", bangid: "31312" }, { id: "kg__49225", name: "80后热歌榜", bangid: "49225" }, { id: "kg__49223", name: "90后热歌榜", bangid: "49223" }, { id: "kg__49224", name: "00后热歌榜", bangid: "49224" }, { id: "kg__33165", name: "粤语金曲榜", bangid: "33165" }, { id: "kg__33166", name: "欧美金曲榜", bangid: "33166" }, { id: "kg__33163", name: "影视金曲榜", bangid: "33163" }, { id: "kg__51340", name: "伤感榜", bangid: "51340" }, { id: "kg__35811", name: "会员专享榜", bangid: "35811" }, { id: "kg__37361", name: "雷达榜", bangid: "37361" }, { id: "kg__21101", name: "分享榜", bangid: "21101" }, { id: "kg__46910", name: "综艺新歌榜", bangid: "46910" }, { id: "kg__30972", name: "酷狗音乐人原创榜", bangid: "30972" }, { id: "kg__60170", name: "闽南语榜", bangid: "60170" }, { id: "kg__65234", name: "儿歌榜", bangid: "65234" }, { id: "kg__4681", name: "美国BillBoard榜", bangid: "4681" }, { id: "kg__25028", name: "Beatport电子舞曲榜", bangid: "25028" }, { id: "kg__4680", name: "英国单曲榜", bangid: "4680" }, { id: "kg__38623", name: "韩国Melon音乐榜", bangid: "38623" }, { id: "kg__42807", name: "joox本地热歌榜", bangid: "42807" }, { id: "kg__36107", name: "小语种热歌榜", bangid: "36107" }, { id: "kg__4673", name: "日本公信榜", bangid: "4673" }, { id: "kg__46868", name: "日本SPACE SHOWER榜", bangid: "46868" }, { id: "kg__42808", name: "KKBOX风云榜", bangid: "42808" }, { id: "kg__60171", name: "越南语榜", bangid: "60171" }, { id: "kg__60172", name: "泰语榜", bangid: "60172" }, { id: "kg__59895", name: "R&B榜", bangid: "59895" }, { id: "kg__59896", name: "摇滚榜", bangid: "59896" }, { id: "kg__59897", name: "爵士榜", bangid: "59897" }, { id: "kg__59898", name: "乡村音乐榜", bangid: "59898" }, { id: "kg__59900", name: "纯音乐榜", bangid: "59900" }, { id: "kg__59899", name: "古典榜", bangid: "59899" }, { id: "kg__22603", name: "5sing音乐榜", bangid: "22603" }, { id: "kg__21335", name: "繁星音乐榜", bangid: "21335" }, { id: "kg__33161", name: "古风新歌榜", bangid: "33161" }];
      leaderboard_default2 = {
        listDetailLimit: 100,
        list: [
          {
            id: "kgtop500",
            name: "TOP500",
            bangid: "8888"
          },
          {
            id: "kgwlhgb",
            name: "网络榜",
            bangid: "23784"
          },
          {
            id: "kgbsb",
            name: "飙升榜",
            bangid: "6666"
          },
          {
            id: "kgfxb",
            name: "分享榜",
            bangid: "21101"
          },
          {
            id: "kgcyyb",
            name: "纯音乐榜",
            bangid: "33164"
          },
          {
            id: "kggfjqb",
            name: "古风榜",
            bangid: "33161"
          },
          {
            id: "kgyyjqb",
            name: "粤语榜",
            bangid: "33165"
          },
          {
            id: "kgomjqb",
            name: "欧美榜",
            bangid: "33166"
          },
          {
            id: "kgdyrgb",
            name: "电音榜",
            bangid: "33160"
          },
          {
            id: "kgjdrgb",
            name: "DJ热歌榜",
            bangid: "24971"
          },
          {
            id: "kghyxgb",
            name: "华语新歌榜",
            bangid: "31308"
          }
        ],
        getUrl(p, id, limit) {
          return `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${limit}&area_code=1&page=${p}&rankid=${id}&with_res_tag=0&show_portrait_mv=1`;
        },
        regExps: {
          total: /total: '(\d+)',/,
          page: /page: '(\d+)',/,
          limit: /pagesize: '(\d+)',/,
          listData: /global\.features = (\[.+\]);/
        },
        _requestBoardsObj: null,
        getBoardsData() {
          if (this._requestBoardsObj) this._requestBoardsObj.cancelHttp();
          this._requestBoardsObj = httpFetch("http://mobilecdnbj.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1");
          return this._requestBoardsObj.promise;
        },
        getData(url) {
          const requestDataObj = httpFetch(url);
          return requestDataObj.promise;
        },
        getSinger(singers) {
          let arr = [];
          singers.forEach((singer) => {
            arr.push(singer.author_name);
          });
          return arr.join("、");
        },
        filterData(rawList) {
          return rawList.map((item) => {
            const types = [];
            const _types = {};
            if (item.filesize !== 0) {
              let size = sizeFormate(item.filesize);
              types.push({ type: "128k", size, hash: item.hash });
              _types["128k"] = {
                size,
                hash: item.hash
              };
            }
            if (item["320filesize"] !== 0) {
              let size = sizeFormate(item["320filesize"]);
              types.push({ type: "320k", size, hash: item["320hash"] });
              _types["320k"] = {
                size,
                hash: item["320hash"]
              };
            }
            if (item.sqfilesize !== 0) {
              let size = sizeFormate(item.sqfilesize);
              types.push({ type: "flac", size, hash: item.sqhash });
              _types.flac = {
                size,
                hash: item.sqhash
              };
            }
            if (item.filesize_high !== 0) {
              let size = sizeFormate(item.filesize_high);
              types.push({ type: "flac24bit", size, hash: item.hash_high });
              _types.flac24bit = {
                size,
                hash: item.hash_high
              };
            }
            return {
              singer: formatSingerName(item.authors, "author_name"),
              name: decodeName(item.songname),
              albumName: decodeName(item.remark),
              albumId: item.album_id,
              songmid: item.audio_id,
              source: "kg",
              interval: formatPlayTime(item.duration),
              // 行内 album_sizable_cover 为专辑可变尺寸封面（默认返回，{size} 占位）（{size} 占位，480 适合播放器条清晰度）
              img: item.album_sizable_cover && item.album_sizable_cover.replace("{size}", "480") || null,
              lrc: null,
              hash: item.hash,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        filterBoardsData(rawList) {
          let list = [];
          for (const board of rawList) {
            if (board.isvol != 1) continue;
            list.push({
              id: "kg__" + board.rankid,
              name: board.rankname,
              bangid: String(board.rankid)
            });
          }
          return list;
        },
        async getBoards(retryNum = 0) {
          this.list = boardList2;
          return {
            list: boardList2,
            source: "kg"
          };
        },
        async getList(bangid, page, retryNum = 0) {
          if (++retryNum > 3) throw new Error("try max num");
          const { body } = await this.getData(this.getUrl(page, bangid, this.listDetailLimit));
          if (body.errcode != 0) return this.getList(bangid, page, retryNum);
          let total = body.data.total;
          let limit = 100;
          let listData = this.filterData(body.data.info);
          return {
            total,
            list: listData,
            limit,
            page,
            source: "kg"
          };
        },
        getDetailPageUrl(id) {
          if (typeof id == "string") id = id.replace("kg__", "");
          return `https://www.kugou.com/yy/rank/home/1-${id}.html`;
        }
      };
    }
  });

  // src/musicSdk/kg/vendors/infSign.min.js
  var require_infSign_min = __commonJS({
    "src/musicSdk/kg/vendors/infSign.min.js"(exports, module) {
      "use strict";
      !(function(t, n) {
        "object" == typeof exports && "undefined" != typeof module ? module.exports = n() : "function" == typeof define && define.amd ? define(n) : (t = t || self, t.infSign = n());
      })(exports, function() {
        "use strict";
        function t(t2, n2, r2) {
          return n2 in t2 ? Object.defineProperty(t2, n2, { value: r2, enumerable: true, configurable: true, writable: true }) : t2[n2] = r2, t2;
        }
        function n(t2, n2) {
          var r2 = Object.keys(t2);
          if (Object.getOwnPropertySymbols) {
            var e2 = Object.getOwnPropertySymbols(t2);
            n2 && (e2 = e2.filter(function(n3) {
              return Object.getOwnPropertyDescriptor(t2, n3).enumerable;
            })), r2.push.apply(r2, e2);
          }
          return r2;
        }
        function r(r2) {
          for (var e2 = 1; e2 < arguments.length; e2++) {
            var o2 = null != arguments[e2] ? arguments[e2] : {};
            e2 % 2 ? n(o2, true).forEach(function(n2) {
              t(r2, n2, o2[n2]);
            }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(r2, Object.getOwnPropertyDescriptors(o2)) : n(o2).forEach(function(t2) {
              Object.defineProperty(r2, t2, Object.getOwnPropertyDescriptor(o2, t2));
            });
          }
          return r2;
        }
        function e(t2, n2) {
          return n2 = { exports: {} }, t2(n2, n2.exports), n2.exports;
        }
        function o(t2) {
          return !!t2.constructor && "function" == typeof t2.constructor.isBuffer && t2.constructor.isBuffer(t2);
        }
        function i(t2) {
          return "function" == typeof t2.readFloatLE && "function" == typeof t2.slice && o(t2.slice(0, 0));
        }
        function c() {
          var t2, n2 = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : {}, e2 = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : "", o2 = arguments.length > 2 && void 0 !== arguments[2] ? arguments[2] : {}, i2 = false, c2 = false, a2 = "json", l2 = r({}, n2), u2 = s.isInClient();
          "function" == typeof o2 ? t2 = o2 : (t2 = o2.callback, i2 = o2.useH5 || false, a2 = o2.postType || "json", c2 = o2.isCDN || false), e2 && ("[object Object]" != Object.prototype.toString.call(e2) ? u2 = false : "urlencoded" == a2 && (u2 = false));
          var f2 = function() {
            var n3 = (/* @__PURE__ */ new Date()).getTime(), i3 = [], s2 = [], u3 = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt", f3 = { srcappid: "2919", clientver: "20000", clienttime: n3, mid: n3, uuid: n3, dfid: "-" };
            c2 && (delete f3.clienttime, delete f3.mid, delete f3.uuid, delete f3.dfid), l2 = r({}, f3, {}, l2);
            for (var g2 in l2) i3.push(g2);
            if (i3.sort(), i3.forEach(function(t3) {
              s2.push(t3 + "=" + l2[t3]);
            }), e2) if ("[object Object]" == Object.prototype.toString.call(e2)) if ("json" == a2) s2.push(JSON.stringify(e2));
            else {
              var b = [];
              for (var g2 in e2) b.push(g2 + "=" + e2[g2]);
              s2.push(b.join("&"));
            }
            else s2.push(e2);
            s2.unshift(u3), s2.push(u3), l2.signature = d(s2.join("")), o2.log && (console.log("H5签名前参数", s2), console.log("H5签名后返回", l2)), e2 ? t2 && t2(l2, "[object Object]" == Object.prototype.toString.call(e2) && "json" == a2 ? JSON.stringify(e2) : e2) : t2 && t2(l2);
          };
          if (u2 && !i2) {
            var g = false;
            s.mobileCall(764, { get: l2, post: e2 }, function(n3) {
              return !g && (g = true, n3 && n3.status ? (delete n3.status, o2.log && (console.log("客户端签名前参数", { get: l2, post: e2 }), console.log("客户端签名后返回", r({}, l2, {}, n3))), l2 = r({}, l2, {}, n3), e2 ? t2 && t2(l2, "[object Object]" == Object.prototype.toString.call(e2) && "json" == a2 ? JSON.stringify(e2) : e2) : t2 && t2(l2), false) : (u2 = false, void f2()));
            });
          } else u2 = false, f2();
        }
        "undefined" != typeof globalThis ? globalThis : "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self && self;
        var s = e(function(t2, n2) {
          !(function(n3, r2) {
            t2.exports = (function() {
              var t3 = { str2Json: function(t4) {
                var n4 = {};
                if ("[object String]" === Object.prototype.toString.call(t4)) try {
                  n4 = JSON.parse(t4);
                } catch (t5) {
                  n4 = {};
                }
                return n4;
              }, json2Str: function(t4) {
                var n4 = t4;
                if ("string" != typeof t4) try {
                  n4 = JSON.stringify(t4);
                } catch (t5) {
                  n4 = "";
                }
                return n4;
              }, _extend: function(t4, n4) {
                if (n4) for (var r3 in t4) n4.hasOwnProperty(r3) || (n4[r3] = t4[r3]);
                return n4;
              }, formatURL: { browser: "", url: "" }, formatSong: { filename: "", filesize: "", hash: "", bitrate: "", extname: "", duration: "", mvhash: "", m4afilesize: "", "320hash": "", "320filesize": "", sqhash: "", sqfilesize: 0, feetype: 0, isfirst: 0 }, formatMV: { filename: "", singername: "", hash: "", imgurl: "" }, formatShare: { shareName: "", topicName: "", hash: "", listID: "", type: "", suid: "", slid: "", imgUrl: "", filename: "", duration: "", shareData: { linkUrl: "", picUrl: "", content: "", title: "" } }, cbNum: 0, isIOS: false, isKugouAndroid: false, isAndroid: true, loadUrl: function(t4) {
                var n4 = document.createElement("iframe");
                n4.setAttribute("src", t4), n4.setAttribute("style", "display:none;"), n4.setAttribute("height", "0px"), n4.setAttribute("width", "0px"), n4.setAttribute("frameborder", "0"), document.body.appendChild(n4), n4.parentNode.removeChild(n4), n4 = null;
              }, callCmd: function(n4) {
                var r3 = t3;
                if (r3.isKugouAndroid) {
                  var e2 = {}, o2 = "";
                  if (n4.cmd && (e2.cmd = n4.cmd), n4.jsonStr && (e2.jsonStr = n4.jsonStr), n4.callback && (o2 = "kgandroidmobilecall" + ++r3.cbNum + Math.random().toString().substr(2, 9), e2.callback = o2, window[o2] = function(t4, e3) {
                    void 0 !== t4 && ("[object String]" === Object.prototype.toString.call(t4) ? (t4 = "#" === e3 ? decodeURIComponent(t4) : decodeURIComponent(decodeURIComponent(t4)), n4.callback(r3.str2Json(t4))) : n4.callback(t4));
                  }), n4.AndroidCallback) {
                    var i2 = r3.str2Json(n4.jsonStr);
                    i2.AndroidCallback = o2, n4.jsonStr = r3.json2Str(i2), n4.jsonStr && (e2.jsonStr = n4.jsonStr);
                  }
                  var c2 = encodeURIComponent(JSON.stringify(e2)), s2 = "kugoujsbridge://start.kugou_jsbridge/?".concat(c2);
                  r3.loadUrl(s2);
                } else if (r3.isAndroid) {
                  var a2 = "", l2 = "";
                  if (n4.jsonStr) {
                    if (n4.callback && "" !== n4.callback && true === n4.AndroidCallback) {
                      l2 = "kgmobilecall" + ++r3.cbNum + Math.random().toString().substr(2, 9), window[l2] = function(t4, e3) {
                        void 0 !== t4 && ("[object String]" === Object.prototype.toString.call(t4) ? (t4 = "#" === e3 ? decodeURIComponent(t4) : decodeURIComponent(decodeURIComponent(t4)), n4.callback(r3.str2Json(t4))) : n4.callback(t4));
                      };
                      var u2 = r3.str2Json(n4.jsonStr);
                      u2.AndroidCallback = l2, n4.jsonStr = r3.json2Str(u2);
                    }
                    try {
                      a2 = external.superCall(n4.cmd, n4.jsonStr);
                    } catch (t4) {
                    }
                  } else try {
                    a2 = external.superCall(n4.cmd);
                  } catch (t4) {
                  }
                  n4.callback && "" !== n4.callback && "AndroidCallback" != a2 && (a2 = r3.str2Json(a2), n4.callback(a2));
                } else {
                  var f2 = "", d2 = "";
                  n4.callback && (d2 = "kgmobilecall" + ++r3.cbNum + Math.random().toString().substr(2, 9), window[d2] = function(t4) {
                    void 0 !== t4 && n4.callback && ("[object String]" === Object.prototype.toString.call(t4) ? n4.callback(r3.str2Json(t4)) : n4.callback(t4));
                  }), d2 && "" != d2 && n4.jsonStr && (f2 = 'kugouurl://start.music/?{"cmd":' + n4.cmd + ', "jsonStr":' + n4.jsonStr + ', "callback":"' + d2 + '"}'), d2 && "" != d2 && !n4.jsonStr && (f2 = 'kugouurl://start.music/?{"cmd":' + n4.cmd + ', "callback":"' + d2 + '"}'), "" == d2 && n4.jsonStr && (f2 = 'kugouurl://start.music/?{"cmd":' + n4.cmd + ', "jsonStr":' + n4.jsonStr + "}"), "" != d2 || n4.jsonStr || (f2 = 'kugouurl://start.music/?{"cmd":' + n4.cmd + "}"), r3.loadUrl(f2);
                }
              }, formartData: function(n4, r3) {
                n4 && 123 == n4 && r3 && (r3 = t3._extend(t3.formatURL, r3)), n4 && 123 == n4 && r3 && (r3 = t3._extend(t3.formatURL, r3));
              } };
              return { isIOS: t3.isIOS, isKugouAndroid: t3.isKugouAndroid, isAndroid: t3.isAndroid, isInClient: function() {
                return !(!t3.isAndroid && !t3.isKugouAndroid && !t3.isIOS);
              }, mobileCall: function(n4, r3, e2) {
                var o2 = "";
                if (r3 && (o2 = t3.json2Str(r3)), !n4) return console.error("请输入命令号！"), false;
                var i2 = {};
                n4 && (i2.cmd = n4), "" != o2 && (i2.jsonStr = o2), e2 && (i2.callback = e2), n4 && 186 == n4 && e2 && (i2.AndroidCallback = true), t3.callCmd(i2);
              }, KgWebMobileCall: function(t4, n4) {
                if (t4) try {
                  var r3 = t4.split(".");
                  r3.reduce(function(e2, o2) {
                    if (e2[o2]) {
                      if (o2 === r3[r3.length - 1]) {
                        var i2 = e2[o2];
                        return "function" == typeof i2 ? (e2[o2] = function(t5) {
                          i2 && i2(t5), n4 && n4(t5);
                        }, e2[o2]) : (console.error("请检查，当前环境变量已注册了对象：" + t4 + "，且该对象不是方法"), null);
                      }
                      return e2[o2];
                    }
                    return o2 === r3[r3.length - 1] ? e2[o2] = function(t5) {
                      n4 && n4(t5);
                    } : e2[o2] = new Object(), e2[o2];
                  }, window);
                } catch (t5) {
                }
              } };
            })();
          })();
        }), a = e(function(t2) {
          !(function() {
            var n2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", r2 = { rotl: function(t3, n3) {
              return t3 << n3 | t3 >>> 32 - n3;
            }, rotr: function(t3, n3) {
              return t3 << 32 - n3 | t3 >>> n3;
            }, endian: function(t3) {
              if (t3.constructor == Number) return 16711935 & r2.rotl(t3, 8) | 4278255360 & r2.rotl(t3, 24);
              for (var n3 = 0; n3 < t3.length; n3++) t3[n3] = r2.endian(t3[n3]);
              return t3;
            }, randomBytes: function(t3) {
              for (var n3 = []; t3 > 0; t3--) n3.push(Math.floor(256 * Math.random()));
              return n3;
            }, bytesToWords: function(t3) {
              for (var n3 = [], r3 = 0, e2 = 0; r3 < t3.length; r3++, e2 += 8) n3[e2 >>> 5] |= t3[r3] << 24 - e2 % 32;
              return n3;
            }, wordsToBytes: function(t3) {
              for (var n3 = [], r3 = 0; r3 < 32 * t3.length; r3 += 8) n3.push(t3[r3 >>> 5] >>> 24 - r3 % 32 & 255);
              return n3;
            }, bytesToHex: function(t3) {
              for (var n3 = [], r3 = 0; r3 < t3.length; r3++) n3.push((t3[r3] >>> 4).toString(16)), n3.push((15 & t3[r3]).toString(16));
              return n3.join("");
            }, hexToBytes: function(t3) {
              for (var n3 = [], r3 = 0; r3 < t3.length; r3 += 2) n3.push(parseInt(t3.substr(r3, 2), 16));
              return n3;
            }, bytesToBase64: function(t3) {
              for (var r3 = [], e2 = 0; e2 < t3.length; e2 += 3) for (var o2 = t3[e2] << 16 | t3[e2 + 1] << 8 | t3[e2 + 2], i2 = 0; i2 < 4; i2++) 8 * e2 + 6 * i2 <= 8 * t3.length ? r3.push(n2.charAt(o2 >>> 6 * (3 - i2) & 63)) : r3.push("=");
              return r3.join("");
            }, base64ToBytes: function(t3) {
              t3 = t3.replace(/[^A-Z0-9+\/]/gi, "");
              for (var r3 = [], e2 = 0, o2 = 0; e2 < t3.length; o2 = ++e2 % 4) 0 != o2 && r3.push((n2.indexOf(t3.charAt(e2 - 1)) & Math.pow(2, -2 * o2 + 8) - 1) << 2 * o2 | n2.indexOf(t3.charAt(e2)) >>> 6 - 2 * o2);
              return r3;
            } };
            t2.exports = r2;
          })();
        }), l = { utf8: { stringToBytes: function(t2) {
          return l.bin.stringToBytes(unescape(encodeURIComponent(t2)));
        }, bytesToString: function(t2) {
          return decodeURIComponent(escape(l.bin.bytesToString(t2)));
        } }, bin: { stringToBytes: function(t2) {
          for (var n2 = [], r2 = 0; r2 < t2.length; r2++) n2.push(255 & t2.charCodeAt(r2));
          return n2;
        }, bytesToString: function(t2) {
          for (var n2 = [], r2 = 0; r2 < t2.length; r2++) n2.push(String.fromCharCode(t2[r2]));
          return n2.join("");
        } } }, u = l, f = function(t2) {
          return null != t2 && (o(t2) || i(t2) || !!t2._isBuffer);
        }, d = e(function(t2) {
          !(function() {
            var n2 = a, r2 = u.utf8, e2 = f, o2 = u.bin, i2 = function(t3, c2) {
              t3.constructor == String ? t3 = c2 && "binary" === c2.encoding ? o2.stringToBytes(t3) : r2.stringToBytes(t3) : e2(t3) ? t3 = Array.prototype.slice.call(t3, 0) : Array.isArray(t3) || (t3 = t3.toString());
              for (var s2 = n2.bytesToWords(t3), a2 = 8 * t3.length, l2 = 1732584193, u2 = -271733879, f2 = -1732584194, d2 = 271733878, g = 0; g < s2.length; g++) s2[g] = 16711935 & (s2[g] << 8 | s2[g] >>> 24) | 4278255360 & (s2[g] << 24 | s2[g] >>> 8);
              s2[a2 >>> 5] |= 128 << a2 % 32, s2[14 + (a2 + 64 >>> 9 << 4)] = a2;
              for (var b = i2._ff, p = i2._gg, h = i2._hh, m = i2._ii, g = 0; g < s2.length; g += 16) {
                var y = l2, j = u2, S = f2, v = d2;
                u2 = m(u2 = m(u2 = m(u2 = m(u2 = h(u2 = h(u2 = h(u2 = h(u2 = p(u2 = p(u2 = p(u2 = p(u2 = b(u2 = b(u2 = b(u2 = b(u2, f2 = b(f2, d2 = b(d2, l2 = b(l2, u2, f2, d2, s2[g + 0], 7, -680876936), u2, f2, s2[g + 1], 12, -389564586), l2, u2, s2[g + 2], 17, 606105819), d2, l2, s2[g + 3], 22, -1044525330), f2 = b(f2, d2 = b(d2, l2 = b(l2, u2, f2, d2, s2[g + 4], 7, -176418897), u2, f2, s2[g + 5], 12, 1200080426), l2, u2, s2[g + 6], 17, -1473231341), d2, l2, s2[g + 7], 22, -45705983), f2 = b(f2, d2 = b(d2, l2 = b(l2, u2, f2, d2, s2[g + 8], 7, 1770035416), u2, f2, s2[g + 9], 12, -1958414417), l2, u2, s2[g + 10], 17, -42063), d2, l2, s2[g + 11], 22, -1990404162), f2 = b(f2, d2 = b(d2, l2 = b(l2, u2, f2, d2, s2[g + 12], 7, 1804603682), u2, f2, s2[g + 13], 12, -40341101), l2, u2, s2[g + 14], 17, -1502002290), d2, l2, s2[g + 15], 22, 1236535329), f2 = p(f2, d2 = p(d2, l2 = p(l2, u2, f2, d2, s2[g + 1], 5, -165796510), u2, f2, s2[g + 6], 9, -1069501632), l2, u2, s2[g + 11], 14, 643717713), d2, l2, s2[g + 0], 20, -373897302), f2 = p(f2, d2 = p(d2, l2 = p(l2, u2, f2, d2, s2[g + 5], 5, -701558691), u2, f2, s2[g + 10], 9, 38016083), l2, u2, s2[g + 15], 14, -660478335), d2, l2, s2[g + 4], 20, -405537848), f2 = p(f2, d2 = p(d2, l2 = p(l2, u2, f2, d2, s2[g + 9], 5, 568446438), u2, f2, s2[g + 14], 9, -1019803690), l2, u2, s2[g + 3], 14, -187363961), d2, l2, s2[g + 8], 20, 1163531501), f2 = p(f2, d2 = p(d2, l2 = p(l2, u2, f2, d2, s2[g + 13], 5, -1444681467), u2, f2, s2[g + 2], 9, -51403784), l2, u2, s2[g + 7], 14, 1735328473), d2, l2, s2[g + 12], 20, -1926607734), f2 = h(f2, d2 = h(d2, l2 = h(l2, u2, f2, d2, s2[g + 5], 4, -378558), u2, f2, s2[g + 8], 11, -2022574463), l2, u2, s2[g + 11], 16, 1839030562), d2, l2, s2[g + 14], 23, -35309556), f2 = h(f2, d2 = h(d2, l2 = h(l2, u2, f2, d2, s2[g + 1], 4, -1530992060), u2, f2, s2[g + 4], 11, 1272893353), l2, u2, s2[g + 7], 16, -155497632), d2, l2, s2[g + 10], 23, -1094730640), f2 = h(f2, d2 = h(d2, l2 = h(l2, u2, f2, d2, s2[g + 13], 4, 681279174), u2, f2, s2[g + 0], 11, -358537222), l2, u2, s2[g + 3], 16, -722521979), d2, l2, s2[g + 6], 23, 76029189), f2 = h(f2, d2 = h(d2, l2 = h(l2, u2, f2, d2, s2[g + 9], 4, -640364487), u2, f2, s2[g + 12], 11, -421815835), l2, u2, s2[g + 15], 16, 530742520), d2, l2, s2[g + 2], 23, -995338651), f2 = m(f2, d2 = m(d2, l2 = m(l2, u2, f2, d2, s2[g + 0], 6, -198630844), u2, f2, s2[g + 7], 10, 1126891415), l2, u2, s2[g + 14], 15, -1416354905), d2, l2, s2[g + 5], 21, -57434055), f2 = m(f2, d2 = m(d2, l2 = m(l2, u2, f2, d2, s2[g + 12], 6, 1700485571), u2, f2, s2[g + 3], 10, -1894986606), l2, u2, s2[g + 10], 15, -1051523), d2, l2, s2[g + 1], 21, -2054922799), f2 = m(f2, d2 = m(d2, l2 = m(l2, u2, f2, d2, s2[g + 8], 6, 1873313359), u2, f2, s2[g + 15], 10, -30611744), l2, u2, s2[g + 6], 15, -1560198380), d2, l2, s2[g + 13], 21, 1309151649), f2 = m(f2, d2 = m(d2, l2 = m(l2, u2, f2, d2, s2[g + 4], 6, -145523070), u2, f2, s2[g + 11], 10, -1120210379), l2, u2, s2[g + 2], 15, 718787259), d2, l2, s2[g + 9], 21, -343485551), l2 = l2 + y >>> 0, u2 = u2 + j >>> 0, f2 = f2 + S >>> 0, d2 = d2 + v >>> 0;
              }
              return n2.endian([l2, u2, f2, d2]);
            };
            i2._ff = function(t3, n3, r3, e3, o3, i3, c2) {
              var s2 = t3 + (n3 & r3 | ~n3 & e3) + (o3 >>> 0) + c2;
              return (s2 << i3 | s2 >>> 32 - i3) + n3;
            }, i2._gg = function(t3, n3, r3, e3, o3, i3, c2) {
              var s2 = t3 + (n3 & e3 | r3 & ~e3) + (o3 >>> 0) + c2;
              return (s2 << i3 | s2 >>> 32 - i3) + n3;
            }, i2._hh = function(t3, n3, r3, e3, o3, i3, c2) {
              var s2 = t3 + (n3 ^ r3 ^ e3) + (o3 >>> 0) + c2;
              return (s2 << i3 | s2 >>> 32 - i3) + n3;
            }, i2._ii = function(t3, n3, r3, e3, o3, i3, c2) {
              var s2 = t3 + (r3 ^ (n3 | ~e3)) + (o3 >>> 0) + c2;
              return (s2 << i3 | s2 >>> 32 - i3) + n3;
            }, i2._blocksize = 16, i2._digestsize = 16, t2.exports = function(t3, r3) {
              if (void 0 === t3 || null === t3) throw new Error("Illegal argument " + t3);
              var e3 = n2.wordsToBytes(i2(t3, r3));
              return r3 && r3.asBytes ? e3 : r3 && r3.asString ? o2.bytesToString(e3) : n2.bytesToHex(e3);
            };
          })();
        });
        return c;
      });
    }
  });

  // node_modules/pako/dist/pako.mjs
  function zero$1(buf) {
    let len = buf.length;
    while (--len >= 0) buf[len] = 0;
  }
  function inflate_fast(strm, start) {
    let _in;
    let last;
    let _out;
    let beg;
    let end;
    let dmax;
    let wsize;
    let whave;
    let wnext;
    let s_window;
    let hold;
    let bits;
    let lcode;
    let dcode;
    let lmask;
    let dmask;
    let here;
    let op;
    let len;
    let dist;
    let from;
    let from_source;
    let input, output;
    const state = strm.state;
    _in = strm.next_in;
    input = strm.input;
    last = _in + (strm.avail_in - 5);
    _out = strm.next_out;
    output = strm.output;
    beg = _out - (start - strm.avail_out);
    end = _out + (strm.avail_out - 257);
    dmax = state.dmax;
    wsize = state.wsize;
    whave = state.whave;
    wnext = state.wnext;
    s_window = state.window;
    hold = state.hold;
    bits = state.bits;
    lcode = state.lencode;
    dcode = state.distcode;
    lmask = (1 << state.lenbits) - 1;
    dmask = (1 << state.distbits) - 1;
    top: do {
      if (bits < 15) {
        hold += input[_in++] << bits;
        bits += 8;
        hold += input[_in++] << bits;
        bits += 8;
      }
      here = lcode[hold & lmask];
      dolen: for (; ; ) {
        op = here >>> 24;
        hold >>>= op;
        bits -= op;
        op = here >>> 16 & 255;
        if (op === 0) output[_out++] = here & 65535;
        else if (op & 16) {
          len = here & 65535;
          op &= 15;
          if (op) {
            if (bits < op) {
              hold += input[_in++] << bits;
              bits += 8;
            }
            len += hold & (1 << op) - 1;
            hold >>>= op;
            bits -= op;
          }
          if (bits < 15) {
            hold += input[_in++] << bits;
            bits += 8;
            hold += input[_in++] << bits;
            bits += 8;
          }
          here = dcode[hold & dmask];
          dodist: for (; ; ) {
            op = here >>> 24;
            hold >>>= op;
            bits -= op;
            op = here >>> 16 & 255;
            if (op & 16) {
              dist = here & 65535;
              op &= 15;
              if (bits < op) {
                hold += input[_in++] << bits;
                bits += 8;
                if (bits < op) {
                  hold += input[_in++] << bits;
                  bits += 8;
                }
              }
              dist += hold & (1 << op) - 1;
              if (dist > dmax) {
                strm.msg = "invalid distance too far back";
                state.mode = BAD$1;
                break top;
              }
              hold >>>= op;
              bits -= op;
              op = _out - beg;
              if (dist > op) {
                op = dist - op;
                if (op > whave) {
                  if (state.sane) {
                    strm.msg = "invalid distance too far back";
                    state.mode = BAD$1;
                    break top;
                  }
                }
                from = 0;
                from_source = s_window;
                if (wnext === 0) {
                  from += wsize - op;
                  if (op < len) {
                    len -= op;
                    do
                      output[_out++] = s_window[from++];
                    while (--op);
                    from = _out - dist;
                    from_source = output;
                  }
                } else if (wnext < op) {
                  from += wsize + wnext - op;
                  op -= wnext;
                  if (op < len) {
                    len -= op;
                    do
                      output[_out++] = s_window[from++];
                    while (--op);
                    from = 0;
                    if (wnext < len) {
                      op = wnext;
                      len -= op;
                      do
                        output[_out++] = s_window[from++];
                      while (--op);
                      from = _out - dist;
                      from_source = output;
                    }
                  }
                } else {
                  from += wnext - op;
                  if (op < len) {
                    len -= op;
                    do
                      output[_out++] = s_window[from++];
                    while (--op);
                    from = _out - dist;
                    from_source = output;
                  }
                }
                while (len > 2) {
                  output[_out++] = from_source[from++];
                  output[_out++] = from_source[from++];
                  output[_out++] = from_source[from++];
                  len -= 3;
                }
                if (len) {
                  output[_out++] = from_source[from++];
                  if (len > 1) output[_out++] = from_source[from++];
                }
              } else {
                from = _out - dist;
                do {
                  output[_out++] = output[from++];
                  output[_out++] = output[from++];
                  output[_out++] = output[from++];
                  len -= 3;
                } while (len > 2);
                if (len) {
                  output[_out++] = output[from++];
                  if (len > 1) output[_out++] = output[from++];
                }
              }
            } else if ((op & 64) === 0) {
              here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
              continue dodist;
            } else {
              strm.msg = "invalid distance code";
              state.mode = BAD$1;
              break top;
            }
            break;
          }
        } else if ((op & 64) === 0) {
          here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
          continue dolen;
        } else if (op & 32) {
          state.mode = TYPE$1;
          break top;
        } else {
          strm.msg = "invalid literal/length code";
          state.mode = BAD$1;
          break top;
        }
        break;
      }
    } while (_in < last && _out < end);
    len = bits >> 3;
    _in -= len;
    bits -= len << 3;
    hold &= (1 << bits) - 1;
    strm.next_in = _in;
    strm.next_out = _out;
    strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
    strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
    state.hold = hold;
    state.bits = bits;
  }
  function inflate2(input, options = {}) {
    const inflator = new Inflate(options);
    inflator.push(input, true);
    if (inflator.err) throw new Error(inflator.msg);
    const result = inflator.result;
    return options.toText ? new TextDecoder().decode(result) : result;
  }
  var Z_FIXED, Z_BINARY, Z_TEXT, Z_UNKNOWN, STORED_BLOCK, STATIC_TREES, DYN_TREES, LENGTH_CODES, LITERALS, L_CODES, D_CODES, BL_CODES, HEAP_SIZE$1, MAX_BITS, Buf_size, END_BLOCK, REP_3_6, REPZ_3_10, REPZ_11_138, extra_lbits, extra_dbits, extra_blbits, bl_order, DIST_CODE_LEN, static_ltree, static_dtree, _dist_code, _length_code, base_length, base_dist, d_code, put_short, send_bits, send_code, bi_reverse, gen_bitlen, gen_codes, init_block, bi_windup, smaller, pqdownheap, compress_block, build_tree, scan_tree, send_tree, build_bl_tree, send_all_trees, detect_data_type, _tr_stored_block, _tr_flush_block, _tr_tally, adler32, makeTable, crcTable, crc32, messages_default, MIN_MATCH, MAX_MATCH, MIN_LOOKAHEAD, BS_NEED_MORE, BS_BLOCK_DONE, BS_FINISH_STARTED, BS_FINISH_DONE, slide_hash, HASH, INSERT_STRING, flush_pending, flush_block_only, read_buf, longest_match, fill_window, deflate_stored, deflate_fast, deflate_slow, Config, configuration_table, BAD$1, TYPE$1, MAXBITS, ENOUGH_LENS$1, ENOUGH_DISTS$1, CODES$1, LENS$1, DISTS$1, lbase, lext, dbase, dext, inflate_table, CODES, LENS, DISTS, HEAD, FLAGS, TIME, OS, EXLEN, EXTRA, NAME, COMMENT, HCRC, DICTID, DICT, TYPE, TYPEDO, STORED, COPY_, COPY, TABLE, LENLENS, CODELENS, LEN_, LEN, LENEXT, DIST, DISTEXT, MATCH, LIT, CHECK, LENGTH, DONE, BAD, MEM, SYNC, ENOUGH_LENS, ENOUGH_DISTS, zswap32, InflateState, inflateStateCheck, inflateResetKeep, inflateReset, inflateReset2, inflateInit2, virgin, lenfix, distfix, fixedtables, updatewindow, inflate$1, inflateEnd, inflateSetDictionary, ZStream, flattenChunks, toString, defaultOptions, Inflate;
  var init_pako = __esm({
    "node_modules/pako/dist/pako.mjs"() {
      Z_FIXED = 4;
      Z_BINARY = 0;
      Z_TEXT = 1;
      Z_UNKNOWN = 2;
      STORED_BLOCK = 0;
      STATIC_TREES = 1;
      DYN_TREES = 2;
      LENGTH_CODES = 29;
      LITERALS = 256;
      L_CODES = 286;
      D_CODES = 30;
      BL_CODES = 19;
      HEAP_SIZE$1 = 573;
      MAX_BITS = 15;
      Buf_size = 16;
      END_BLOCK = 256;
      REP_3_6 = 16;
      REPZ_3_10 = 17;
      REPZ_11_138 = 18;
      extra_lbits = new Uint8Array([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        2,
        2,
        2,
        2,
        3,
        3,
        3,
        3,
        4,
        4,
        4,
        4,
        5,
        5,
        5,
        5,
        0
      ]);
      extra_dbits = new Uint8Array([
        0,
        0,
        0,
        0,
        1,
        1,
        2,
        2,
        3,
        3,
        4,
        4,
        5,
        5,
        6,
        6,
        7,
        7,
        8,
        8,
        9,
        9,
        10,
        10,
        11,
        11,
        12,
        12,
        13,
        13
      ]);
      extra_blbits = new Uint8Array([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        3,
        7
      ]);
      bl_order = new Uint8Array([
        16,
        17,
        18,
        0,
        8,
        7,
        9,
        6,
        10,
        5,
        11,
        4,
        12,
        3,
        13,
        2,
        14,
        1,
        15
      ]);
      DIST_CODE_LEN = 512;
      static_ltree = new Array(288 * 2);
      zero$1(static_ltree);
      static_dtree = new Array(D_CODES * 2);
      zero$1(static_dtree);
      _dist_code = new Array(DIST_CODE_LEN);
      zero$1(_dist_code);
      _length_code = new Array(256);
      zero$1(_length_code);
      base_length = new Array(LENGTH_CODES);
      zero$1(base_length);
      base_dist = new Array(D_CODES);
      zero$1(base_dist);
      d_code = (dist) => {
        return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
      };
      put_short = (s, w) => {
        s.pending_buf[s.pending++] = w & 255;
        s.pending_buf[s.pending++] = w >>> 8 & 255;
      };
      send_bits = (s, value, length) => {
        if (s.bi_valid > Buf_size - length) {
          s.bi_buf |= value << s.bi_valid & 65535;
          put_short(s, s.bi_buf);
          s.bi_buf = value >> Buf_size - s.bi_valid;
          s.bi_valid += length - Buf_size;
        } else {
          s.bi_buf |= value << s.bi_valid & 65535;
          s.bi_valid += length;
        }
      };
      send_code = (s, c, tree) => {
        send_bits(s, tree[c * 2], tree[c * 2 + 1]);
      };
      bi_reverse = (code, len) => {
        let res = 0;
        do {
          res |= code & 1;
          code >>>= 1;
          res <<= 1;
        } while (--len > 0);
        return res >>> 1;
      };
      gen_bitlen = (s, desc) => {
        const tree = desc.dyn_tree;
        const max_code = desc.max_code;
        const stree = desc.stat_desc.static_tree;
        const has_stree = desc.stat_desc.has_stree;
        const extra = desc.stat_desc.extra_bits;
        const base = desc.stat_desc.extra_base;
        const max_length = desc.stat_desc.max_length;
        let h;
        let n, m;
        let bits;
        let xbits;
        let f;
        let overflow = 0;
        for (bits = 0; bits <= MAX_BITS; bits++) s.bl_count[bits] = 0;
        tree[s.heap[s.heap_max] * 2 + 1] = 0;
        for (h = s.heap_max + 1; h < HEAP_SIZE$1; h++) {
          n = s.heap[h];
          bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;
          if (bits > max_length) {
            bits = max_length;
            overflow++;
          }
          tree[n * 2 + 1] = bits;
          if (n > max_code) continue;
          s.bl_count[bits]++;
          xbits = 0;
          if (n >= base) xbits = extra[n - base];
          f = tree[n * 2];
          s.opt_len += f * (bits + xbits);
          if (has_stree) s.static_len += f * (stree[n * 2 + 1] + xbits);
        }
        if (overflow === 0) return;
        do {
          bits = max_length - 1;
          while (s.bl_count[bits] === 0) bits--;
          s.bl_count[bits]--;
          s.bl_count[bits + 1] += 2;
          s.bl_count[max_length]--;
          overflow -= 2;
        } while (overflow > 0);
        for (bits = max_length; bits !== 0; bits--) {
          n = s.bl_count[bits];
          while (n !== 0) {
            m = s.heap[--h];
            if (m > max_code) continue;
            if (tree[m * 2 + 1] !== bits) {
              s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
              tree[m * 2 + 1] = bits;
            }
            n--;
          }
        }
      };
      gen_codes = (tree, max_code, bl_count) => {
        const next_code = new Array(16);
        let code = 0;
        let bits;
        let n;
        for (bits = 1; bits <= MAX_BITS; bits++) {
          code = code + bl_count[bits - 1] << 1;
          next_code[bits] = code;
        }
        for (n = 0; n <= max_code; n++) {
          let len = tree[n * 2 + 1];
          if (len === 0) continue;
          tree[n * 2] = bi_reverse(next_code[len]++, len);
        }
      };
      init_block = (s) => {
        let n;
        for (n = 0; n < L_CODES; n++) s.dyn_ltree[n * 2] = 0;
        for (n = 0; n < D_CODES; n++) s.dyn_dtree[n * 2] = 0;
        for (n = 0; n < BL_CODES; n++) s.bl_tree[n * 2] = 0;
        s.dyn_ltree[END_BLOCK * 2] = 1;
        s.opt_len = s.static_len = 0;
        s.sym_next = s.matches = 0;
      };
      bi_windup = (s) => {
        if (s.bi_valid > 8) put_short(s, s.bi_buf);
        else if (s.bi_valid > 0) s.pending_buf[s.pending++] = s.bi_buf;
        s.bi_buf = 0;
        s.bi_valid = 0;
      };
      smaller = (tree, n, m, depth) => {
        const _n2 = n * 2;
        const _m2 = m * 2;
        return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
      };
      pqdownheap = (s, tree, k) => {
        const v = s.heap[k];
        let j = k << 1;
        while (j <= s.heap_len) {
          if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) j++;
          if (smaller(tree, v, s.heap[j], s.depth)) break;
          s.heap[k] = s.heap[j];
          k = j;
          j <<= 1;
        }
        s.heap[k] = v;
      };
      compress_block = (s, ltree, dtree) => {
        let dist;
        let lc;
        let sx = 0;
        let code;
        let extra;
        if (s.sym_next !== 0) do {
          dist = s.pending_buf[s.sym_buf + sx++] & 255;
          dist += (s.pending_buf[s.sym_buf + sx++] & 255) << 8;
          lc = s.pending_buf[s.sym_buf + sx++];
          if (dist === 0) send_code(s, lc, ltree);
          else {
            code = _length_code[lc];
            send_code(s, code + LITERALS + 1, ltree);
            extra = extra_lbits[code];
            if (extra !== 0) {
              lc -= base_length[code];
              send_bits(s, lc, extra);
            }
            dist--;
            code = d_code(dist);
            send_code(s, code, dtree);
            extra = extra_dbits[code];
            if (extra !== 0) {
              dist -= base_dist[code];
              send_bits(s, dist, extra);
            }
          }
        } while (sx < s.sym_next);
        send_code(s, END_BLOCK, ltree);
      };
      build_tree = (s, desc) => {
        const tree = desc.dyn_tree;
        const stree = desc.stat_desc.static_tree;
        const has_stree = desc.stat_desc.has_stree;
        const elems = desc.stat_desc.elems;
        let n, m;
        let max_code = -1;
        let node;
        s.heap_len = 0;
        s.heap_max = HEAP_SIZE$1;
        for (n = 0; n < elems; n++) if (tree[n * 2] !== 0) {
          s.heap[++s.heap_len] = max_code = n;
          s.depth[n] = 0;
        } else tree[n * 2 + 1] = 0;
        while (s.heap_len < 2) {
          node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
          tree[node * 2] = 1;
          s.depth[node] = 0;
          s.opt_len--;
          if (has_stree) s.static_len -= stree[node * 2 + 1];
        }
        desc.max_code = max_code;
        for (n = s.heap_len >> 1; n >= 1; n--) pqdownheap(s, tree, n);
        node = elems;
        do {
          n = s.heap[1];
          s.heap[1] = s.heap[s.heap_len--];
          pqdownheap(s, tree, 1);
          m = s.heap[1];
          s.heap[--s.heap_max] = n;
          s.heap[--s.heap_max] = m;
          tree[node * 2] = tree[n * 2] + tree[m * 2];
          s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
          tree[n * 2 + 1] = tree[m * 2 + 1] = node;
          s.heap[1] = node++;
          pqdownheap(s, tree, 1);
        } while (s.heap_len >= 2);
        s.heap[--s.heap_max] = s.heap[1];
        gen_bitlen(s, desc);
        gen_codes(tree, max_code, s.bl_count);
      };
      scan_tree = (s, tree, max_code) => {
        let n;
        let prevlen = -1;
        let curlen;
        let nextlen = tree[1];
        let count = 0;
        let max_count = 7;
        let min_count = 4;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }
        tree[(max_code + 1) * 2 + 1] = 65535;
        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];
          if (++count < max_count && curlen === nextlen) continue;
          else if (count < min_count) s.bl_tree[curlen * 2] += count;
          else if (curlen !== 0) {
            if (curlen !== prevlen) s.bl_tree[curlen * 2]++;
            s.bl_tree[REP_3_6 * 2]++;
          } else if (count <= 10) s.bl_tree[REPZ_3_10 * 2]++;
          else s.bl_tree[REPZ_11_138 * 2]++;
          count = 0;
          prevlen = curlen;
          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      };
      send_tree = (s, tree, max_code) => {
        let n;
        let prevlen = -1;
        let curlen;
        let nextlen = tree[1];
        let count = 0;
        let max_count = 7;
        let min_count = 4;
        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }
        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];
          if (++count < max_count && curlen === nextlen) continue;
          else if (count < min_count) do
            send_code(s, curlen, s.bl_tree);
          while (--count !== 0);
          else if (curlen !== 0) {
            if (curlen !== prevlen) {
              send_code(s, curlen, s.bl_tree);
              count--;
            }
            send_code(s, REP_3_6, s.bl_tree);
            send_bits(s, count - 3, 2);
          } else if (count <= 10) {
            send_code(s, REPZ_3_10, s.bl_tree);
            send_bits(s, count - 3, 3);
          } else {
            send_code(s, REPZ_11_138, s.bl_tree);
            send_bits(s, count - 11, 7);
          }
          count = 0;
          prevlen = curlen;
          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      };
      build_bl_tree = (s) => {
        let max_blindex;
        scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
        scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
        build_tree(s, s.bl_desc);
        for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) break;
        s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
        return max_blindex;
      };
      send_all_trees = (s, lcodes, dcodes, blcodes) => {
        let rank;
        send_bits(s, lcodes - 257, 5);
        send_bits(s, dcodes - 1, 5);
        send_bits(s, blcodes - 4, 4);
        for (rank = 0; rank < blcodes; rank++) send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1], 3);
        send_tree(s, s.dyn_ltree, lcodes - 1);
        send_tree(s, s.dyn_dtree, dcodes - 1);
      };
      detect_data_type = (s) => {
        let block_mask = 4093624447;
        let n;
        for (n = 0; n <= 31; n++, block_mask >>>= 1) if (block_mask & 1 && s.dyn_ltree[n * 2] !== 0) return Z_BINARY;
        if (s.dyn_ltree[18] !== 0 || s.dyn_ltree[20] !== 0 || s.dyn_ltree[26] !== 0) return Z_TEXT;
        for (n = 32; n < LITERALS; n++) if (s.dyn_ltree[n * 2] !== 0) return Z_TEXT;
        return Z_BINARY;
      };
      _tr_stored_block = (s, buf, stored_len, last) => {
        send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
        bi_windup(s);
        put_short(s, stored_len);
        put_short(s, ~stored_len);
        if (stored_len) s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
        s.pending += stored_len;
      };
      _tr_flush_block = (s, buf, stored_len, last) => {
        let opt_lenb, static_lenb;
        let max_blindex = 0;
        if (s.level > 0) {
          if (s.strm.data_type === Z_UNKNOWN) s.strm.data_type = detect_data_type(s);
          build_tree(s, s.l_desc);
          build_tree(s, s.d_desc);
          max_blindex = build_bl_tree(s);
          opt_lenb = s.opt_len + 3 + 7 >>> 3;
          static_lenb = s.static_len + 3 + 7 >>> 3;
          if (static_lenb <= opt_lenb || s.strategy === Z_FIXED) opt_lenb = static_lenb;
        } else opt_lenb = static_lenb = stored_len + 5;
        if (stored_len + 4 <= opt_lenb && buf !== -1) _tr_stored_block(s, buf, stored_len, last);
        else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {
          send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
          compress_block(s, static_ltree, static_dtree);
        } else {
          send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
          send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
          compress_block(s, s.dyn_ltree, s.dyn_dtree);
        }
        init_block(s);
        if (last) bi_windup(s);
      };
      _tr_tally = (s, dist, lc) => {
        s.pending_buf[s.sym_buf + s.sym_next++] = dist;
        s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
        s.pending_buf[s.sym_buf + s.sym_next++] = lc;
        if (dist === 0) s.dyn_ltree[lc * 2]++;
        else {
          s.matches++;
          dist--;
          s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]++;
          s.dyn_dtree[d_code(dist) * 2]++;
        }
        return s.sym_next === s.sym_end;
      };
      adler32 = (adler, buf, len, pos) => {
        let s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;
        while (len !== 0) {
          n = len > 2e3 ? 2e3 : len;
          len -= n;
          do {
            s1 = s1 + buf[pos++] | 0;
            s2 = s2 + s1 | 0;
          } while (--n);
          s1 %= 65521;
          s2 %= 65521;
        }
        return s1 | s2 << 16 | 0;
      };
      makeTable = () => {
        let c, table = [];
        for (var n = 0; n < 256; n++) {
          c = n;
          for (var k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
          table[n] = c;
        }
        return table;
      };
      crcTable = new Uint32Array(makeTable());
      crc32 = (crc, buf, len, pos) => {
        const t = crcTable;
        const end = pos + len;
        crc ^= -1;
        for (let i = pos; i < end; i++) crc = crc >>> 8 ^ t[(crc ^ buf[i]) & 255];
        return crc ^ -1;
      };
      messages_default = {
        2: "need dictionary",
        1: "stream end",
        0: "",
        "-1": "file error",
        "-2": "stream error",
        "-3": "data error",
        "-4": "insufficient memory",
        "-5": "buffer error",
        "-6": "incompatible version"
      };
      MIN_MATCH = 3;
      MAX_MATCH = 258;
      MIN_LOOKAHEAD = 262;
      BS_NEED_MORE = 1;
      BS_BLOCK_DONE = 2;
      BS_FINISH_STARTED = 3;
      BS_FINISH_DONE = 4;
      slide_hash = (s) => {
        let n, m;
        let p;
        let wsize = s.w_size;
        n = s.hash_size;
        p = n;
        do {
          m = s.head[--p];
          s.head[p] = m >= wsize ? m - wsize : 0;
        } while (--n);
        n = wsize;
        p = n;
        do {
          m = s.prev[--p];
          s.prev[p] = m >= wsize ? m - wsize : 0;
        } while (--n);
      };
      HASH = (s, prev, data) => (prev << s.hash_shift ^ data) & s.hash_mask;
      INSERT_STRING = (s, str) => {
        let h;
        if (s.legacy_hash) h = s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);
        else {
          const w = s.window;
          const value = w[str] | w[str + 1] << 8 | w[str + 2] << 16 | w[str + 3] << 24;
          h = s.ins_h = Math.imul(value, 66521) + 66521 >>> 16 & s.hash_mask;
        }
        const hash_head = s.prev[str & s.w_mask] = s.head[h];
        s.head[h] = str;
        return hash_head;
      };
      flush_pending = (strm) => {
        const s = strm.state;
        let len = s.pending;
        if (len > strm.avail_out) len = strm.avail_out;
        if (len === 0) return;
        strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
        strm.next_out += len;
        s.pending_out += len;
        strm.total_out += len;
        strm.avail_out -= len;
        s.pending -= len;
        if (s.pending === 0) s.pending_out = 0;
      };
      flush_block_only = (s, last) => {
        _tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
        s.block_start = s.strstart;
        flush_pending(s.strm);
      };
      read_buf = (strm, buf, start, size) => {
        let len = strm.avail_in;
        if (len > size) len = size;
        if (len === 0) return 0;
        strm.avail_in -= len;
        buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
        if (strm.state.wrap === 1) strm.adler = adler32(strm.adler, buf, len, start);
        else if (strm.state.wrap === 2) strm.adler = crc32(strm.adler, buf, len, start);
        strm.next_in += len;
        strm.total_in += len;
        return len;
      };
      longest_match = (s, cur_match) => {
        let chain_length = s.max_chain_length;
        let scan = s.strstart;
        let match;
        let len;
        let best_len = s.prev_length;
        let nice_match = s.nice_match;
        const limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
        const _win = s.window;
        const wmask = s.w_mask;
        const prev = s.prev;
        const strend = s.strstart + MAX_MATCH;
        let scan_end1 = _win[scan + best_len - 1];
        let scan_end = _win[scan + best_len];
        if (s.prev_length >= s.good_match) chain_length >>= 2;
        if (nice_match > s.lookahead) nice_match = s.lookahead;
        do {
          match = cur_match;
          if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) continue;
          scan += 2;
          match++;
          do
            ;
          while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);
          len = MAX_MATCH - (strend - scan);
          scan = strend - MAX_MATCH;
          if (len > best_len) {
            s.match_start = cur_match;
            best_len = len;
            if (len >= nice_match) break;
            scan_end1 = _win[scan + best_len - 1];
            scan_end = _win[scan + best_len];
          }
        } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);
        if (best_len <= s.lookahead) return best_len;
        return s.lookahead;
      };
      fill_window = (s) => {
        const _w_size = s.w_size;
        let n, more, str;
        do {
          more = s.window_size - s.lookahead - s.strstart;
          if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
            s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
            s.match_start -= _w_size;
            s.strstart -= _w_size;
            s.block_start -= _w_size;
            if (s.insert > s.strstart) s.insert = s.strstart;
            slide_hash(s);
            more += _w_size;
          }
          if (s.strm.avail_in === 0) break;
          n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
          s.lookahead += n;
          if (!s.legacy_hash) {
            if (s.lookahead + s.insert > MIN_MATCH) {
              str = s.strstart - s.insert;
              while (s.insert) {
                INSERT_STRING(s, str);
                str++;
                s.insert--;
                if (s.lookahead + s.insert <= MIN_MATCH) break;
              }
            }
          } else if (s.lookahead + s.insert >= MIN_MATCH) {
            str = s.strstart - s.insert;
            s.ins_h = s.window[str];
            s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
            while (s.insert) {
              INSERT_STRING(s, str);
              str++;
              s.insert--;
              if (s.lookahead + s.insert < MIN_MATCH) break;
            }
          }
        } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
      };
      deflate_stored = (s, flush) => {
        let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;
        let len, left, have, last = 0;
        let used = s.strm.avail_in;
        do {
          len = 65535;
          have = s.bi_valid + 42 >> 3;
          if (s.strm.avail_out < have) break;
          have = s.strm.avail_out - have;
          left = s.strstart - s.block_start;
          if (len > left + s.strm.avail_in) len = left + s.strm.avail_in;
          if (len > have) len = have;
          if (len < min_block && (len === 0 && flush !== 4 || flush === 0 || len !== left + s.strm.avail_in)) break;
          last = flush === 4 && len === left + s.strm.avail_in ? 1 : 0;
          _tr_stored_block(s, 0, 0, last);
          s.pending_buf[s.pending - 4] = len;
          s.pending_buf[s.pending - 3] = len >> 8;
          s.pending_buf[s.pending - 2] = ~len;
          s.pending_buf[s.pending - 1] = ~len >> 8;
          flush_pending(s.strm);
          if (left) {
            if (left > len) left = len;
            s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
            s.strm.next_out += left;
            s.strm.avail_out -= left;
            s.strm.total_out += left;
            s.block_start += left;
            len -= left;
          }
          if (len) {
            read_buf(s.strm, s.strm.output, s.strm.next_out, len);
            s.strm.next_out += len;
            s.strm.avail_out -= len;
            s.strm.total_out += len;
          }
        } while (last === 0);
        used -= s.strm.avail_in;
        if (used) {
          if (used >= s.w_size) {
            s.matches = 2;
            s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
            s.strstart = s.w_size;
            s.insert = s.strstart;
          } else {
            if (s.window_size - s.strstart <= used) {
              s.strstart -= s.w_size;
              s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
              if (s.matches < 2) s.matches++;
              if (s.insert > s.strstart) s.insert = s.strstart;
            }
            s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
            s.strstart += used;
            s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
          }
          s.block_start = s.strstart;
        }
        if (s.high_water < s.strstart) s.high_water = s.strstart;
        if (last) return BS_FINISH_DONE;
        if (flush !== 0 && flush !== 4 && s.strm.avail_in === 0 && s.strstart === s.block_start) return BS_BLOCK_DONE;
        have = s.window_size - s.strstart;
        if (s.strm.avail_in > have && s.block_start >= s.w_size) {
          s.block_start -= s.w_size;
          s.strstart -= s.w_size;
          s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
          if (s.matches < 2) s.matches++;
          have += s.w_size;
          if (s.insert > s.strstart) s.insert = s.strstart;
        }
        if (have > s.strm.avail_in) have = s.strm.avail_in;
        if (have) {
          read_buf(s.strm, s.window, s.strstart, have);
          s.strstart += have;
          s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
        }
        if (s.high_water < s.strstart) s.high_water = s.strstart;
        have = s.bi_valid + 42 >> 3;
        have = s.pending_buf_size - have > 65535 ? 65535 : s.pending_buf_size - have;
        min_block = have > s.w_size ? s.w_size : have;
        left = s.strstart - s.block_start;
        if (left >= min_block || (left || flush === 4) && flush !== 0 && s.strm.avail_in === 0 && left <= have) {
          len = left > have ? have : left;
          last = flush === 4 && s.strm.avail_in === 0 && len === left ? 1 : 0;
          _tr_stored_block(s, s.block_start, len, last);
          s.block_start += len;
          flush_pending(s.strm);
        }
        return last ? BS_FINISH_STARTED : BS_NEED_MORE;
      };
      deflate_fast = (s, flush) => {
        let hash_head;
        let bflush;
        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD) {
            fill_window(s);
            if (s.lookahead < MIN_LOOKAHEAD && flush === 0) return BS_NEED_MORE;
            if (s.lookahead === 0) break;
          }
          hash_head = 0;
          if (s.lookahead >= MIN_MATCH) hash_head = INSERT_STRING(s, s.strstart);
          if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) s.match_length = longest_match(s, hash_head);
          if (s.match_length >= MIN_MATCH) {
            bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
            s.lookahead -= s.match_length;
            if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
              s.match_length--;
              do {
                s.strstart++;
                hash_head = INSERT_STRING(s, s.strstart);
              } while (--s.match_length !== 0);
              s.strstart++;
            } else {
              s.strstart += s.match_length;
              s.match_length = 0;
              if (s.legacy_hash) {
                s.ins_h = s.window[s.strstart];
                s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);
              }
            }
          } else {
            bflush = _tr_tally(s, 0, s.window[s.strstart]);
            s.lookahead--;
            s.strstart++;
          }
          if (bflush) {
            flush_block_only(s, false);
            if (s.strm.avail_out === 0) return BS_NEED_MORE;
          }
        }
        s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
        if (flush === 4) {
          flush_block_only(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED;
          return BS_FINISH_DONE;
        }
        if (s.sym_next) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE;
        }
        return BS_BLOCK_DONE;
      };
      deflate_slow = (s, flush) => {
        let hash_head;
        let bflush;
        let max_insert;
        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD) {
            fill_window(s);
            if (s.lookahead < MIN_LOOKAHEAD && flush === 0) return BS_NEED_MORE;
            if (s.lookahead === 0) break;
          }
          hash_head = 0;
          if (s.lookahead >= MIN_MATCH) hash_head = INSERT_STRING(s, s.strstart);
          s.prev_length = s.match_length;
          s.prev_match = s.match_start;
          s.match_length = MIN_MATCH - 1;
          if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
            s.match_length = longest_match(s, hash_head);
            if (s.match_length <= 5 && (s.strategy === 1 || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) s.match_length = MIN_MATCH - 1;
          }
          if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
            max_insert = s.strstart + s.lookahead - MIN_MATCH;
            bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
            s.lookahead -= s.prev_length - 1;
            s.prev_length -= 2;
            do
              if (++s.strstart <= max_insert) hash_head = INSERT_STRING(s, s.strstart);
            while (--s.prev_length !== 0);
            s.match_available = 0;
            s.match_length = MIN_MATCH - 1;
            s.strstart++;
            if (bflush) {
              flush_block_only(s, false);
              if (s.strm.avail_out === 0) return BS_NEED_MORE;
            }
          } else if (s.match_available) {
            bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
            if (bflush)
              flush_block_only(s, false);
            s.strstart++;
            s.lookahead--;
            if (s.strm.avail_out === 0) return BS_NEED_MORE;
          } else {
            s.match_available = 1;
            s.strstart++;
            s.lookahead--;
          }
        }
        if (s.match_available) {
          bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);
          s.match_available = 0;
        }
        s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
        if (flush === 4) {
          flush_block_only(s, true);
          if (s.strm.avail_out === 0) return BS_FINISH_STARTED;
          return BS_FINISH_DONE;
        }
        if (s.sym_next) {
          flush_block_only(s, false);
          if (s.strm.avail_out === 0) return BS_NEED_MORE;
        }
        return BS_BLOCK_DONE;
      };
      Config = class {
        constructor(good_length, max_lazy, nice_length, max_chain, func) {
          this.good_length = good_length;
          this.max_lazy = max_lazy;
          this.nice_length = nice_length;
          this.max_chain = max_chain;
          this.func = func;
        }
      };
      configuration_table = [
        new Config(0, 0, 0, 0, deflate_stored),
        new Config(4, 4, 8, 4, deflate_fast),
        new Config(4, 5, 16, 8, deflate_fast),
        new Config(4, 6, 32, 32, deflate_fast),
        new Config(4, 4, 16, 16, deflate_slow),
        new Config(8, 16, 32, 32, deflate_slow),
        new Config(8, 16, 128, 128, deflate_slow),
        new Config(8, 32, 128, 256, deflate_slow),
        new Config(32, 128, 258, 1024, deflate_slow),
        new Config(32, 258, 258, 4096, deflate_slow)
      ];
      BAD$1 = 16209;
      TYPE$1 = 16191;
      MAXBITS = 15;
      ENOUGH_LENS$1 = 852;
      ENOUGH_DISTS$1 = 592;
      CODES$1 = 0;
      LENS$1 = 1;
      DISTS$1 = 2;
      lbase = new Uint16Array([
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        13,
        15,
        17,
        19,
        23,
        27,
        31,
        35,
        43,
        51,
        59,
        67,
        83,
        99,
        115,
        131,
        163,
        195,
        227,
        258,
        0,
        0
      ]);
      lext = new Uint8Array([
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        17,
        17,
        17,
        17,
        18,
        18,
        18,
        18,
        19,
        19,
        19,
        19,
        20,
        20,
        20,
        20,
        21,
        21,
        21,
        21,
        16,
        199,
        75
      ]);
      dbase = new Uint16Array([
        1,
        2,
        3,
        4,
        5,
        7,
        9,
        13,
        17,
        25,
        33,
        49,
        65,
        97,
        129,
        193,
        257,
        385,
        513,
        769,
        1025,
        1537,
        2049,
        3073,
        4097,
        6145,
        8193,
        12289,
        16385,
        24577,
        0,
        0
      ]);
      dext = new Uint8Array([
        16,
        16,
        16,
        16,
        17,
        17,
        18,
        18,
        19,
        19,
        20,
        20,
        21,
        21,
        22,
        22,
        23,
        23,
        24,
        24,
        25,
        25,
        26,
        26,
        27,
        27,
        28,
        28,
        29,
        29,
        64,
        64
      ]);
      inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) => {
        const bits = opts.bits;
        let len = 0;
        let sym = 0;
        let min = 0, max = 0;
        let root = 0;
        let curr = 0;
        let drop = 0;
        let left = 0;
        let used = 0;
        let huff = 0;
        let incr;
        let fill;
        let low;
        let mask;
        let next;
        let base = null;
        let match;
        const count = /* @__PURE__ */ new Uint16Array(16);
        const offs = /* @__PURE__ */ new Uint16Array(16);
        let extra = null;
        let here_bits, here_op, here_val;
        for (len = 0; len <= MAXBITS; len++) count[len] = 0;
        for (sym = 0; sym < codes; sym++) count[lens[lens_index + sym]]++;
        root = bits;
        for (max = MAXBITS; max >= 1; max--) if (count[max] !== 0) break;
        if (root > max) root = max;
        if (max === 0) {
          table[table_index++] = 20971520;
          table[table_index++] = 20971520;
          opts.bits = 1;
          return 0;
        }
        for (min = 1; min < max; min++) if (count[min] !== 0) break;
        if (root < min) root = min;
        left = 1;
        for (len = 1; len <= MAXBITS; len++) {
          left <<= 1;
          left -= count[len];
          if (left < 0) return -1;
        }
        if (left > 0 && (type === CODES$1 || max !== 1)) return -1;
        offs[1] = 0;
        for (len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + count[len];
        for (sym = 0; sym < codes; sym++) if (lens[lens_index + sym] !== 0) work[offs[lens[lens_index + sym]]++] = sym;
        if (type === CODES$1) {
          base = extra = work;
          match = 20;
        } else if (type === LENS$1) {
          base = lbase;
          extra = lext;
          match = 257;
        } else {
          base = dbase;
          extra = dext;
          match = 0;
        }
        huff = 0;
        sym = 0;
        len = min;
        next = table_index;
        curr = root;
        drop = 0;
        low = -1;
        used = 1 << root;
        mask = used - 1;
        if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) return 1;
        for (; ; ) {
          here_bits = len - drop;
          if (work[sym] + 1 < match) {
            here_op = 0;
            here_val = work[sym];
          } else if (work[sym] >= match) {
            here_op = extra[work[sym] - match];
            here_val = base[work[sym] - match];
          } else {
            here_op = 96;
            here_val = 0;
          }
          incr = 1 << len - drop;
          fill = 1 << curr;
          min = fill;
          do {
            fill -= incr;
            table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
          } while (fill !== 0);
          incr = 1 << len - 1;
          while (huff & incr) incr >>= 1;
          if (incr !== 0) {
            huff &= incr - 1;
            huff += incr;
          } else huff = 0;
          sym++;
          if (--count[len] === 0) {
            if (len === max) break;
            len = lens[lens_index + work[sym]];
          }
          if (len > root && (huff & mask) !== low) {
            if (drop === 0) drop = root;
            next += min;
            curr = len - drop;
            left = 1 << curr;
            while (curr + drop < max) {
              left -= count[curr + drop];
              if (left <= 0) break;
              curr++;
              left <<= 1;
            }
            used += 1 << curr;
            if (type === LENS$1 && used > ENOUGH_LENS$1 || type === DISTS$1 && used > ENOUGH_DISTS$1) return 1;
            low = huff & mask;
            table[low] = root << 24 | curr << 16 | next - table_index | 0;
          }
        }
        if (huff !== 0) table[next + huff] = len - drop << 24 | 4194304;
        opts.bits = root;
        return 0;
      };
      CODES = 0;
      LENS = 1;
      DISTS = 2;
      HEAD = 16180;
      FLAGS = 16181;
      TIME = 16182;
      OS = 16183;
      EXLEN = 16184;
      EXTRA = 16185;
      NAME = 16186;
      COMMENT = 16187;
      HCRC = 16188;
      DICTID = 16189;
      DICT = 16190;
      TYPE = 16191;
      TYPEDO = 16192;
      STORED = 16193;
      COPY_ = 16194;
      COPY = 16195;
      TABLE = 16196;
      LENLENS = 16197;
      CODELENS = 16198;
      LEN_ = 16199;
      LEN = 16200;
      LENEXT = 16201;
      DIST = 16202;
      DISTEXT = 16203;
      MATCH = 16204;
      LIT = 16205;
      CHECK = 16206;
      LENGTH = 16207;
      DONE = 16208;
      BAD = 16209;
      MEM = 16210;
      SYNC = 16211;
      ENOUGH_LENS = 852;
      ENOUGH_DISTS = 592;
      zswap32 = (q) => {
        return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
      };
      InflateState = class {
        constructor() {
          this.strm = null;
          this.mode = 0;
          this.last = false;
          this.wrap = 0;
          this.havedict = false;
          this.flags = 0;
          this.dmax = 0;
          this.check = 0;
          this.total = 0;
          this.head = null;
          this.wbits = 0;
          this.wsize = 0;
          this.whave = 0;
          this.wnext = 0;
          this.window = null;
          this.hold = 0;
          this.bits = 0;
          this.length = 0;
          this.offset = 0;
          this.extra = 0;
          this.lencode = null;
          this.distcode = null;
          this.lenbits = 0;
          this.distbits = 0;
          this.ncode = 0;
          this.nlen = 0;
          this.ndist = 0;
          this.have = 0;
          this.next = null;
          this.lens = /* @__PURE__ */ new Uint16Array(320);
          this.work = /* @__PURE__ */ new Uint16Array(288);
          this.lendyn = null;
          this.distdyn = null;
          this.sane = 0;
          this.back = 0;
          this.was = 0;
        }
      };
      inflateStateCheck = (strm) => {
        if (!strm) return 1;
        const state = strm.state;
        if (!state || state.strm !== strm || state.mode < HEAD || state.mode > SYNC) return 1;
        return 0;
      };
      inflateResetKeep = (strm) => {
        if (inflateStateCheck(strm)) return -2;
        const state = strm.state;
        strm.total_in = strm.total_out = state.total = 0;
        strm.msg = "";
        if (state.wrap) strm.adler = state.wrap & 1;
        state.mode = HEAD;
        state.last = 0;
        state.havedict = 0;
        state.flags = -1;
        state.dmax = 32768;
        state.head = null;
        state.hold = 0;
        state.bits = 0;
        state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
        state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);
        state.sane = 1;
        state.back = -1;
        return 0;
      };
      inflateReset = (strm) => {
        if (inflateStateCheck(strm)) return -2;
        const state = strm.state;
        state.wsize = 0;
        state.whave = 0;
        state.wnext = 0;
        return inflateResetKeep(strm);
      };
      inflateReset2 = (strm, windowBits) => {
        let wrap;
        if (inflateStateCheck(strm)) return -2;
        const state = strm.state;
        if (windowBits < 0) {
          wrap = 0;
          windowBits = -windowBits;
        } else {
          wrap = (windowBits >> 4) + 5;
          if (windowBits < 48) windowBits &= 15;
        }
        if (windowBits && (windowBits < 8 || windowBits > 15)) return -2;
        if (state.window !== null && state.wbits !== windowBits) state.window = null;
        state.wrap = wrap;
        state.wbits = windowBits;
        return inflateReset(strm);
      };
      inflateInit2 = (strm, windowBits) => {
        if (!strm) return -2;
        const state = new InflateState();
        strm.state = state;
        state.strm = strm;
        state.window = null;
        state.mode = HEAD;
        const ret = inflateReset2(strm, windowBits);
        if (ret !== 0) strm.state = null;
        return ret;
      };
      virgin = true;
      fixedtables = (state) => {
        if (virgin) {
          lenfix = /* @__PURE__ */ new Int32Array(512);
          distfix = /* @__PURE__ */ new Int32Array(32);
          let sym = 0;
          while (sym < 144) state.lens[sym++] = 8;
          while (sym < 256) state.lens[sym++] = 9;
          while (sym < 280) state.lens[sym++] = 7;
          while (sym < 288) state.lens[sym++] = 8;
          inflate_table(LENS, state.lens, 0, 288, lenfix, 0, state.work, { bits: 9 });
          sym = 0;
          while (sym < 32) state.lens[sym++] = 5;
          inflate_table(DISTS, state.lens, 0, 32, distfix, 0, state.work, { bits: 5 });
          virgin = false;
        }
        state.lencode = lenfix;
        state.lenbits = 9;
        state.distcode = distfix;
        state.distbits = 5;
      };
      updatewindow = (strm, src, end, copy) => {
        let dist;
        const state = strm.state;
        if (state.window === null) state.window = new Uint8Array(1 << state.wbits);
        if (state.wsize === 0) {
          state.wsize = 1 << state.wbits;
          state.wnext = 0;
          state.whave = 0;
        }
        if (copy >= state.wsize) {
          state.window.set(src.subarray(end - state.wsize, end), 0);
          state.wnext = 0;
          state.whave = state.wsize;
        } else {
          dist = state.wsize - state.wnext;
          if (dist > copy) dist = copy;
          state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
          copy -= dist;
          if (copy) {
            state.window.set(src.subarray(end - copy, end), 0);
            state.wnext = copy;
            state.whave = state.wsize;
          } else {
            state.wnext += dist;
            if (state.wnext === state.wsize) state.wnext = 0;
            if (state.whave < state.wsize) state.whave += dist;
          }
        }
        return 0;
      };
      inflate$1 = (strm, flush) => {
        let state;
        let input, output;
        let next;
        let put;
        let have, left;
        let hold;
        let bits;
        let _in, _out;
        let copy;
        let from;
        let from_source;
        let here = 0;
        let here_bits, here_op, here_val;
        let last_bits, last_op, last_val;
        let len;
        let ret;
        const hbuf = /* @__PURE__ */ new Uint8Array(4);
        let opts;
        let n;
        const order = new Uint8Array([
          16,
          17,
          18,
          0,
          8,
          7,
          9,
          6,
          10,
          5,
          11,
          4,
          12,
          3,
          13,
          2,
          14,
          1,
          15
        ]);
        if (inflateStateCheck(strm) || !strm.output || !strm.input && strm.avail_in !== 0) return -2;
        state = strm.state;
        if (state.mode === TYPE) state.mode = TYPEDO;
        put = strm.next_out;
        output = strm.output;
        left = strm.avail_out;
        next = strm.next_in;
        input = strm.input;
        have = strm.avail_in;
        hold = state.hold;
        bits = state.bits;
        _in = have;
        _out = left;
        ret = 0;
        inf_leave: for (; ; ) switch (state.mode) {
          case HEAD:
            if (state.wrap === 0) {
              state.mode = TYPEDO;
              break;
            }
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.wrap & 2 && hold === 35615) {
              if (state.wbits === 0) state.wbits = 15;
              state.check = 0;
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32(state.check, hbuf, 2, 0);
              hold = 0;
              bits = 0;
              state.mode = FLAGS;
              break;
            }
            if (state.head) state.head.done = false;
            if (!(state.wrap & 1) || (((hold & 255) << 8) + (hold >> 8)) % 31) {
              strm.msg = "incorrect header check";
              state.mode = BAD;
              break;
            }
            if ((hold & 15) !== 8) {
              strm.msg = "unknown compression method";
              state.mode = BAD;
              break;
            }
            hold >>>= 4;
            bits -= 4;
            len = (hold & 15) + 8;
            if (state.wbits === 0) state.wbits = len;
            if (len > 15 || len > state.wbits) {
              strm.msg = "invalid window size";
              state.mode = BAD;
              break;
            }
            state.dmax = 1 << state.wbits;
            state.flags = 0;
            strm.adler = state.check = 1;
            state.mode = hold & 512 ? DICTID : TYPE;
            hold = 0;
            bits = 0;
            break;
          case FLAGS:
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.flags = hold;
            if ((state.flags & 255) !== 8) {
              strm.msg = "unknown compression method";
              state.mode = BAD;
              break;
            }
            if (state.flags & 57344) {
              strm.msg = "unknown header flags set";
              state.mode = BAD;
              break;
            }
            if (state.head) state.head.text = hold >> 8 & 1;
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = TIME;
          case TIME:
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) state.head.time = hold >>> 0;
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              hbuf[2] = hold >>> 16 & 255;
              hbuf[3] = hold >>> 24 & 255;
              state.check = crc32(state.check, hbuf, 4, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = OS;
          case OS:
            while (bits < 16) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (state.head) {
              state.head.xflags = hold & 255;
              state.head.os = hold >> 8;
            }
            if (state.flags & 512 && state.wrap & 4) {
              hbuf[0] = hold & 255;
              hbuf[1] = hold >>> 8 & 255;
              state.check = crc32(state.check, hbuf, 2, 0);
            }
            hold = 0;
            bits = 0;
            state.mode = EXLEN;
          case EXLEN:
            if (state.flags & 1024) {
              while (bits < 16) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length = hold;
              if (state.head) state.head.extra_len = hold;
              if (state.flags & 512 && state.wrap & 4) {
                hbuf[0] = hold & 255;
                hbuf[1] = hold >>> 8 & 255;
                state.check = crc32(state.check, hbuf, 2, 0);
              }
              hold = 0;
              bits = 0;
            } else if (state.head) state.head.extra = null;
            state.mode = EXTRA;
          case EXTRA:
            if (state.flags & 1024) {
              copy = state.length;
              if (copy > have) copy = have;
              if (copy) {
                if (state.head) {
                  len = state.head.extra_len - state.length;
                  if (!state.head.extra) state.head.extra = new Uint8Array(state.head.extra_len);
                  state.head.extra.set(input.subarray(next, next + copy), len);
                }
                if (state.flags & 512 && state.wrap & 4) state.check = crc32(state.check, input, copy, next);
                have -= copy;
                next += copy;
                state.length -= copy;
              }
              if (state.length) break inf_leave;
            }
            state.length = 0;
            state.mode = NAME;
          case NAME:
            if (state.flags & 2048) {
              if (have === 0) break inf_leave;
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) state.head.name += String.fromCharCode(len);
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) state.check = crc32(state.check, input, copy, next);
              have -= copy;
              next += copy;
              if (len) break inf_leave;
            } else if (state.head) state.head.name = null;
            state.length = 0;
            state.mode = COMMENT;
          case COMMENT:
            if (state.flags & 4096) {
              if (have === 0) break inf_leave;
              copy = 0;
              do {
                len = input[next + copy++];
                if (state.head && len && state.length < 65536) state.head.comment += String.fromCharCode(len);
              } while (len && copy < have);
              if (state.flags & 512 && state.wrap & 4) state.check = crc32(state.check, input, copy, next);
              have -= copy;
              next += copy;
              if (len) break inf_leave;
            } else if (state.head) state.head.comment = null;
            state.mode = HCRC;
          case HCRC:
            if (state.flags & 512) {
              while (bits < 16) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.check & 65535)) {
                strm.msg = "header crc mismatch";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            if (state.head) {
              state.head.hcrc = state.flags >> 9 & 1;
              state.head.done = true;
            }
            strm.adler = state.check = 0;
            state.mode = TYPE;
            break;
          case DICTID:
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            strm.adler = state.check = zswap32(hold);
            hold = 0;
            bits = 0;
            state.mode = DICT;
          case DICT:
            if (state.havedict === 0) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              return 2;
            }
            strm.adler = state.check = 1;
            state.mode = TYPE;
          case TYPE:
            if (flush === 5 || flush === 6) break inf_leave;
          case TYPEDO:
            if (state.last) {
              hold >>>= bits & 7;
              bits -= bits & 7;
              state.mode = CHECK;
              break;
            }
            while (bits < 3) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.last = hold & 1;
            hold >>>= 1;
            bits -= 1;
            switch (hold & 3) {
              case 0:
                state.mode = STORED;
                break;
              case 1:
                fixedtables(state);
                state.mode = LEN_;
                if (flush === 6) {
                  hold >>>= 2;
                  bits -= 2;
                  break inf_leave;
                }
                break;
              case 2:
                state.mode = TABLE;
                break;
              case 3:
                strm.msg = "invalid block type";
                state.mode = BAD;
            }
            hold >>>= 2;
            bits -= 2;
            break;
          case STORED:
            hold >>>= bits & 7;
            bits -= bits & 7;
            while (bits < 32) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
              strm.msg = "invalid stored block lengths";
              state.mode = BAD;
              break;
            }
            state.length = hold & 65535;
            hold = 0;
            bits = 0;
            state.mode = COPY_;
            if (flush === 6) break inf_leave;
          case COPY_:
            state.mode = COPY;
          case COPY:
            copy = state.length;
            if (copy) {
              if (copy > have) copy = have;
              if (copy > left) copy = left;
              if (copy === 0) break inf_leave;
              output.set(input.subarray(next, next + copy), put);
              have -= copy;
              next += copy;
              left -= copy;
              put += copy;
              state.length -= copy;
              break;
            }
            state.mode = TYPE;
            break;
          case TABLE:
            while (bits < 14) {
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            state.nlen = (hold & 31) + 257;
            hold >>>= 5;
            bits -= 5;
            state.ndist = (hold & 31) + 1;
            hold >>>= 5;
            bits -= 5;
            state.ncode = (hold & 15) + 4;
            hold >>>= 4;
            bits -= 4;
            if (state.nlen > 286 || state.ndist > 30) {
              strm.msg = "too many length or distance symbols";
              state.mode = BAD;
              break;
            }
            state.have = 0;
            state.mode = LENLENS;
          case LENLENS:
            while (state.have < state.ncode) {
              while (bits < 3) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.lens[order[state.have++]] = hold & 7;
              hold >>>= 3;
              bits -= 3;
            }
            while (state.have < 19) state.lens[order[state.have++]] = 0;
            state.lencode = state.lendyn;
            state.lenbits = 7;
            opts = { bits: state.lenbits };
            ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid code lengths set";
              state.mode = BAD;
              break;
            }
            state.have = 0;
            state.mode = CODELENS;
          case CODELENS:
            while (state.have < state.nlen + state.ndist) {
              for (; ; ) {
                here = state.lencode[hold & (1 << state.lenbits) - 1];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (here_val < 16) {
                hold >>>= here_bits;
                bits -= here_bits;
                state.lens[state.have++] = here_val;
              } else {
                if (here_val === 16) {
                  n = here_bits + 2;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  if (state.have === 0) {
                    strm.msg = "invalid bit length repeat";
                    state.mode = BAD;
                    break;
                  }
                  len = state.lens[state.have - 1];
                  copy = 3 + (hold & 3);
                  hold >>>= 2;
                  bits -= 2;
                } else if (here_val === 17) {
                  n = here_bits + 3;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 3 + (hold & 7);
                  hold >>>= 3;
                  bits -= 3;
                } else {
                  n = here_bits + 7;
                  while (bits < n) {
                    if (have === 0) break inf_leave;
                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }
                  hold >>>= here_bits;
                  bits -= here_bits;
                  len = 0;
                  copy = 11 + (hold & 127);
                  hold >>>= 7;
                  bits -= 7;
                }
                if (state.have + copy > state.nlen + state.ndist) {
                  strm.msg = "invalid bit length repeat";
                  state.mode = BAD;
                  break;
                }
                while (copy--) state.lens[state.have++] = len;
              }
            }
            if (state.mode === BAD) break;
            if (state.lens[256] === 0) {
              strm.msg = "invalid code -- missing end-of-block";
              state.mode = BAD;
              break;
            }
            state.lenbits = 9;
            opts = { bits: state.lenbits };
            ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
            state.lenbits = opts.bits;
            if (ret) {
              strm.msg = "invalid literal/lengths set";
              state.mode = BAD;
              break;
            }
            state.distbits = 6;
            state.distcode = state.distdyn;
            opts = { bits: state.distbits };
            ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
            state.distbits = opts.bits;
            if (ret) {
              strm.msg = "invalid distances set";
              state.mode = BAD;
              break;
            }
            state.mode = LEN_;
            if (flush === 6) break inf_leave;
          case LEN_:
            state.mode = LEN;
          case LEN:
            if (have >= 6 && left >= 258) {
              strm.next_out = put;
              strm.avail_out = left;
              strm.next_in = next;
              strm.avail_in = have;
              state.hold = hold;
              state.bits = bits;
              inflate_fast(strm, _out);
              put = strm.next_out;
              output = strm.output;
              left = strm.avail_out;
              next = strm.next_in;
              input = strm.input;
              have = strm.avail_in;
              hold = state.hold;
              bits = state.bits;
              if (state.mode === TYPE) state.back = -1;
              break;
            }
            state.back = 0;
            for (; ; ) {
              here = state.lencode[hold & (1 << state.lenbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) break;
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if (here_op && (here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            state.length = here_val;
            if (here_op === 0) {
              state.mode = LIT;
              break;
            }
            if (here_op & 32) {
              state.back = -1;
              state.mode = TYPE;
              break;
            }
            if (here_op & 64) {
              strm.msg = "invalid literal/length code";
              state.mode = BAD;
              break;
            }
            state.extra = here_op & 15;
            state.mode = LENEXT;
          case LENEXT:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.length += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            state.was = state.length;
            state.mode = DIST;
          case DIST:
            for (; ; ) {
              here = state.distcode[hold & (1 << state.distbits) - 1];
              here_bits = here >>> 24;
              here_op = here >>> 16 & 255;
              here_val = here & 65535;
              if (here_bits <= bits) break;
              if (have === 0) break inf_leave;
              have--;
              hold += input[next++] << bits;
              bits += 8;
            }
            if ((here_op & 240) === 0) {
              last_bits = here_bits;
              last_op = here_op;
              last_val = here_val;
              for (; ; ) {
                here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                here_bits = here >>> 24;
                here_op = here >>> 16 & 255;
                here_val = here & 65535;
                if (last_bits + here_bits <= bits) break;
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              hold >>>= last_bits;
              bits -= last_bits;
              state.back += last_bits;
            }
            hold >>>= here_bits;
            bits -= here_bits;
            state.back += here_bits;
            if (here_op & 64) {
              strm.msg = "invalid distance code";
              state.mode = BAD;
              break;
            }
            state.offset = here_val;
            state.extra = here_op & 15;
            state.mode = DISTEXT;
          case DISTEXT:
            if (state.extra) {
              n = state.extra;
              while (bits < n) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              state.offset += hold & (1 << state.extra) - 1;
              hold >>>= state.extra;
              bits -= state.extra;
              state.back += state.extra;
            }
            if (state.offset > state.dmax) {
              strm.msg = "invalid distance too far back";
              state.mode = BAD;
              break;
            }
            state.mode = MATCH;
          case MATCH:
            if (left === 0) break inf_leave;
            copy = _out - left;
            if (state.offset > copy) {
              copy = state.offset - copy;
              if (copy > state.whave) {
                if (state.sane) {
                  strm.msg = "invalid distance too far back";
                  state.mode = BAD;
                  break;
                }
              }
              if (copy > state.wnext) {
                copy -= state.wnext;
                from = state.wsize - copy;
              } else from = state.wnext - copy;
              if (copy > state.length) copy = state.length;
              from_source = state.window;
            } else {
              from_source = output;
              from = put - state.offset;
              copy = state.length;
            }
            if (copy > left) copy = left;
            left -= copy;
            state.length -= copy;
            do
              output[put++] = from_source[from++];
            while (--copy);
            if (state.length === 0) state.mode = LEN;
            break;
          case LIT:
            if (left === 0) break inf_leave;
            output[put++] = state.length;
            left--;
            state.mode = LEN;
            break;
          case CHECK:
            if (state.wrap) {
              while (bits < 32) {
                if (have === 0) break inf_leave;
                have--;
                hold |= input[next++] << bits;
                bits += 8;
              }
              _out -= left;
              strm.total_out += _out;
              state.total += _out;
              if (state.wrap & 4 && _out) strm.adler = state.check = state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out);
              _out = left;
              if (state.wrap & 4 && (state.flags ? hold : zswap32(hold)) !== state.check) {
                strm.msg = "incorrect data check";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = LENGTH;
          case LENGTH:
            if (state.wrap && state.flags) {
              while (bits < 32) {
                if (have === 0) break inf_leave;
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              if (state.wrap & 4 && hold !== (state.total & 4294967295)) {
                strm.msg = "incorrect length check";
                state.mode = BAD;
                break;
              }
              hold = 0;
              bits = 0;
            }
            state.mode = DONE;
          case DONE:
            ret = 1;
            break inf_leave;
          case BAD:
            ret = -3;
            break inf_leave;
          case MEM:
            return -4;
          case SYNC:
          default:
            return -2;
        }
        strm.next_out = put;
        strm.avail_out = left;
        strm.next_in = next;
        strm.avail_in = have;
        state.hold = hold;
        state.bits = bits;
        if (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== 4)) {
          if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
            state.mode = MEM;
            return -4;
          }
        }
        _in -= strm.avail_in;
        _out -= strm.avail_out;
        strm.total_in += _in;
        strm.total_out += _out;
        state.total += _out;
        if (state.wrap & 4 && _out) strm.adler = state.check = state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out);
        strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
        if ((_in === 0 && _out === 0 || flush === 4) && ret === 0) ret = -5;
        return ret;
      };
      inflateEnd = (strm) => {
        if (inflateStateCheck(strm)) return -2;
        let state = strm.state;
        if (state.window) state.window = null;
        strm.state = null;
        return 0;
      };
      inflateSetDictionary = (strm, dictionary) => {
        const dictLength = dictionary.length;
        let state;
        let dictid;
        let ret;
        if (inflateStateCheck(strm)) return -2;
        state = strm.state;
        if (state.wrap !== 0 && state.mode !== DICT) return -2;
        if (state.mode === DICT) {
          dictid = 1;
          dictid = adler32(dictid, dictionary, dictLength, 0);
          if (dictid !== state.check) return -3;
        }
        ret = updatewindow(strm, dictionary, dictLength, dictLength);
        if (ret) {
          state.mode = MEM;
          return -4;
        }
        state.havedict = 1;
        return 0;
      };
      ZStream = class {
        constructor() {
          this.input = null;
          this.next_in = 0;
          this.avail_in = 0;
          this.total_in = 0;
          this.output = null;
          this.next_out = 0;
          this.avail_out = 0;
          this.total_out = 0;
          this.msg = "";
          this.state = null;
          this.data_type = 2;
          this.adler = 0;
        }
      };
      flattenChunks = (chunks) => {
        const result = new Uint8Array(chunks.reduce((len, chunk) => len + chunk.length, 0));
        let pos = 0;
        for (const chunk of chunks) {
          result.set(chunk, pos);
          pos += chunk.length;
        }
        return result;
      };
      toString = Object.prototype.toString;
      defaultOptions = {
        chunkSize: 1024 * 64,
        windowBits: 15,
        raw: false,
        dictionary: /* @__PURE__ */ new Uint8Array(0)
      };
      Inflate = class {
        options;
        /**
        * Error code after inflate finishes. {@link Z_OK} on success.
        * Should be checked when broken data is possible.
        */
        err;
        /** Error message, if {@link Inflate.err} is not {@link Z_OK}. */
        msg;
        /**
        * `true` once the compressed stream has ended. A stream may end before the
        * caller's data does (trailing bytes), so check this to know when to stop
        * pushing - further {@link Inflate.push} calls are no-ops.
        */
        ended;
        started;
        /**
        * Chunks of output data, if {@link Inflate.onData} not overridden.
        * @internal
        */
        chunks;
        strm;
        /**
        * Uncompressed result, generated by default {@link Inflate.onData}
        * and {@link Inflate.onEnd} handlers. Filled after you push last chunk
        * (call {@link Inflate.push} with {@link Z_FINISH} / `true` param).
        */
        result;
        /**
        * Creates a new inflator instance with the specified params. Throws an
        * exception on bad params. See {@link InflateOptions} for the list of
        * supported options.
        *
        * By default, when no options are set, the deflate/gzip data format is
        * autodetected via the wrapper header.
        *
        * @example
        * ```javascript
        * import { Inflate } from 'pako'
        *
        * const chunk1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
        * const chunk2 = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
        *
        * const inflate = new Inflate({ level: 3 })
        *
        * inflate.push(chunk1, false)
        * inflate.push(chunk2, true)  // true -> last chunk
        *
        * if (inflate.err) throw new Error(inflate.err)
        *
        * console.log(inflate.result)
        * ```
        */
        constructor(options = {}) {
          this.options = Object.assign({}, defaultOptions, options);
          const opt = this.options;
          if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
            opt.windowBits = -opt.windowBits;
            if (opt.windowBits === 0) opt.windowBits = -15;
          }
          if (opt.windowBits >= 0 && opt.windowBits < 16 && !options.windowBits) opt.windowBits += 32;
          if (opt.windowBits > 15 && opt.windowBits < 48) {
            if ((opt.windowBits & 15) === 0) opt.windowBits |= 15;
          }
          this.err = 0;
          this.msg = "";
          this.ended = false;
          this.started = false;
          this.chunks = [];
          this.result = /* @__PURE__ */ new Uint8Array(0);
          this.strm = new ZStream();
          this.strm.avail_out = 0;
          let status = inflateInit2(this.strm, opt.windowBits);
          if (status !== 0) throw new Error(messages_default[status]);
          if (toString.call(opt.dictionary) === "[object ArrayBuffer]") opt.dictionary = new Uint8Array(opt.dictionary);
          const dictionary = opt.dictionary;
          if (opt.raw && dictionary.length) {
            status = inflateSetDictionary(this.strm, dictionary);
            if (status !== 0) throw new Error(messages_default[status]);
          }
        }
        /**
        * Sends input data to the inflate pipe, generating {@link Inflate.onData} calls
        * with new output chunks. Returns `true` on success. If end of stream is
        * detected, {@link Inflate.onEnd} will be called.
        *
        * `flush_mode` is not needed for normal operation, because end of stream
        * is detected automatically. Pass {@link Z_SYNC_FLUSH} to force the decoder
        * to emit all currently available output — handy when you need to decode
        * data frame-by-frame from a long-running stream.
        *
        * On failure, calls {@link Inflate.onEnd} with the error code and returns false.
        *
        * Once the stream has ended (a compressed stream may end before your data
        * does), further `push` calls are no-ops and return whether the decode
        * finished successfully. The final outcome is in {@link Inflate.result},
        * {@link Inflate.err} and {@link Inflate.msg}.
        *
        * @param flush_mode 0..6 for corresponding {@link Z_NO_FLUSH}..{@link Z_TREES}
        *   flush modes. See constants. Skipped or `false` means {@link Z_NO_FLUSH},
        *   `true` means {@link Z_FINISH}.
        *
        * @example
        * ```javascript
        * push(chunk, false) // push one of data chunks
        * ...
        * push(chunk, true)  // push last chunk
        * ```
        */
        push(data, flush_mode = false) {
          const strm = this.strm;
          const chunkSize = this.options.chunkSize;
          let status;
          let _flush_mode;
          let last_avail_out;
          if (this.ended) return this.err === 0;
          if (typeof flush_mode === "number") _flush_mode = flush_mode;
          else _flush_mode = flush_mode === true ? 4 : 0;
          if (toString.call(data) === "[object ArrayBuffer]") strm.input = new Uint8Array(data);
          else strm.input = data;
          strm.next_in = 0;
          strm.avail_in = strm.input.length;
          if (!this.started) {
            this.started = true;
            this.onStart(strm);
          }
          for (; ; ) {
            if (strm.avail_out === 0) {
              strm.output = new Uint8Array(chunkSize);
              strm.next_out = 0;
              strm.avail_out = chunkSize;
            }
            status = inflate$1(strm, _flush_mode);
            if (status === 2) {
              const dictionary = this.options.dictionary;
              if (dictionary.length) {
                status = inflateSetDictionary(strm, dictionary);
                if (status === 0) status = inflate$1(strm, _flush_mode);
                else if (status === -3) status = 2;
              }
            }
            while (strm.avail_in > 0 && status === 1 && strm.state.wrap & 2 && strm.state.flags !== 0 && strm.input[strm.next_in] !== 0) {
              inflateReset(strm);
              status = inflate$1(strm, _flush_mode);
            }
            if (status === -2 || status === -3 || status === 2 || status === -4) break;
            last_avail_out = strm.avail_out;
            if (strm.next_out) {
              if (strm.avail_out === 0 || status === 1 || _flush_mode > 0) {
                this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
                strm.avail_out = 0;
                strm.next_out = 0;
              }
            }
            if ((status === 0 || status === -5) && last_avail_out === 0) continue;
            if (status === 1) {
              status = inflateEnd(this.strm);
              break;
            }
            if (strm.avail_in === 0) {
              if (_flush_mode === 4) {
                status = inflateEnd(this.strm);
                if (status === 0) status = -5;
                break;
              }
              return true;
            }
          }
          this.err = status;
          this.msg = strm.msg || messages_default[status];
          this.ended = true;
          this.onEnd(status);
          return status === 0;
        }
        /**
        * Called once before the first low-level inflate call.
        *
        * Override this handler to attach low-level inflate state, for example to read
        * gzip header metadata:
        *
        * ```javascript
        * import { Inflate, GZheader, zlibInflateGetHeader } from 'pako'
        *
        * const inflator = new Inflate()
        *
        * inflator.onStart = function (strm) {
        *   this.header = new GZheader()
        *   zlibInflateGetHeader(strm, this.header)
        * }
        *
        * inflator.push(data, true)
        * console.log(inflator.header.name)
        * ```
        */
        onStart(strm) {
        }
        /**
        * By default, stores data blocks in the {@link Inflate.chunks} property and glues
        * them in {@link Inflate.onEnd}. Override this handler if you need another behaviour.
        *
        * @param chunk output data.
        */
        onData(chunk) {
          this.chunks.push(chunk);
        }
        /**
        * Called after you tell inflate that the input stream is
        * complete ({@link Z_FINISH}). By default, joins the collected {@link Inflate.chunks},
        * frees memory and fills the {@link Inflate.result} property.
        *
        * @param status inflate status. {@link Z_OK} on success, other if not.
        */
        onEnd(status) {
          if (status === 0) this.result = flattenChunks(this.chunks);
          this.chunks = [];
        }
      };
    }
  });

  // src/musicSdk/kg/util.js
  var enc_key, decodeLyric2, signatureParams;
  var init_util2 = __esm({
    "src/musicSdk/kg/util.js"() {
      "use strict";
      init_buffer();
      init_pako();
      init_buffer();
      init_utils();
      init_request();
      enc_key = Buffer2.from([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105], "binary");
      decodeLyric2 = (str) => new Promise((resolve, reject) => {
        if (!str.length) return;
        const buf_str = Buffer2.from(str, "base64").slice(4);
        for (let i = 0, len = buf_str.length; i < len; i++) {
          buf_str[i] = buf_str[i] ^ enc_key[i % 16];
        }
        const result = inflate2(buf_str, { to: "string" });
        resolve(result);
      });
      signatureParams = (params, platform = "android", body = "") => {
        let keyparam = "OIlwieks28dk2k092lksi2UIkp";
        if (platform === "web") keyparam = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
        let param_list = params.split("&");
        param_list.sort();
        let sign_params = `${keyparam}${param_list.join("")}${body}${keyparam}`;
        return toMD5(sign_params);
      };
    }
  });

  // src/musicSdk/kg/songList.js
  var import_infSign, handleSignature, songList_default2;
  var init_songList2 = __esm({
    "src/musicSdk/kg/songList.js"() {
      "use strict";
      init_request();
      init_utils_index();
      import_infSign = __toESM(require_infSign_min());
      init_util2();
      handleSignature = (id, page, limit) => new Promise((resolve, reject) => {
        (0, import_infSign.default)({ appid: 1058, type: 0, module: "playlist", page, pagesize: limit, specialid: id }, null, {
          useH5: true,
          isCDN: true,
          callback(i) {
            resolve(i.signature);
          }
        });
      });
      songList_default2 = {
        _requestObj_tags: null,
        _requestObj_listInfo: null,
        _requestObj_list: null,
        _requestObj_listRecommend: null,
        listDetailLimit: 1e4,
        currentTagInfo: {
          id: void 0,
          info: void 0
        },
        sortList: [
          {
            name: "推荐",
            tid: "recommend",
            id: "5"
          },
          {
            name: "最热",
            tid: "hot",
            id: "6"
          },
          {
            name: "最新",
            tid: "new",
            id: "7"
          },
          {
            name: "热藏",
            tid: "hot_collect",
            id: "3"
          },
          {
            name: "飙升",
            tid: "rise",
            id: "8"
          }
        ],
        cache: /* @__PURE__ */ new Map(),
        regExps: {
          listData: /global\.data = (\[.+\]);/,
          listInfo: /global = {[\s\S]+?name: "(.+)"[\s\S]+?pic: "(.+)"[\s\S]+?};/,
          // https://www.kugou.com/yy/special/single/1067062.html
          listDetailLink: /^.+\/(\d+)\.html(?:\?.*|&.*$|#.*$|$)/
        },
        // async getGlobalSpecialId(specialId) {
        //   return httpFetch(`http://mobilecdnbj.kugou.com/api/v5/special/info?specialid=${specialId}`, {
        //     headers: {
        //       'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HLK-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.102 Mobile Safari/537.36 EdgA/104.0.1293.70',
        //     },
        //   }).promise.then(({ body }) => {
        //     // console.log(body)
        //     if (!body.data.global_specialid) Promise.reject(new Error('Failed to get global collection id.'))
        //     return body.data.global_specialid
        //   })
        // },
        // async getListInfoBySpecialId(special_id, retry = 0) {
        //   if (++retry > 2) throw new Error('failed')
        //   return httpFetch(`https://m.kugou.com/plist/list/${special_id}/?json=true`, {
        //     headers: {
        //       'User-Agent': 'Mozilla/5.0 (Linux; Android 10; HLK-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.5112.102 Mobile Safari/537.36 EdgA/104.0.1293.70',
        //     },
        //     follow_max: 2,
        //   }).promise.then(({ body }) => {
        //     // console.log(body)
        //     if (!body.info.list) return this.getListInfoBySpecialId(special_id, retry)
        //     let listinfo = body.info.list
        //     return {
        //       listInfo: {
        //         name: listinfo.specialname,
        //         image: listinfo.imgurl.replace('{size}', '150'),
        //         intro: listinfo.intro,
        //         author: listinfo.nickname,
        //         playcount: listinfo.playcount,
        //         total: listinfo.songcount,
        //       },
        //       globalSpecialId: listinfo.global_specialid,
        //     }
        //   })
        // },
        // async getSongListDetailByGlobalSpecialId(id, page, limit = 100, retry = 0) {
        //   if (++retry > 2) throw new Error('failed')
        //   console.log(id)
        //   const params = `specialid=0&need_sort=1&module=CloudMusic&clientver=11409&pagesize=${limit}&global_collection_id=${id}&userid=0&page=${page}&type=1&area_code=1&appid=1005`
        //   return httpFetch(`http://pubsongscdn.tx.kugou.com/v2/get_other_list_file?${params}&signature=${signatureParams(params)}`).promise.then(({ body }) => {
        //     // console.log(body)
        //     if (body.data?.info == null) return this.getSongListDetailByGlobalSpecialId(id, page, limit, retry)
        //     return body.data.info
        //   })
        // },
        parseHtmlDesc(html) {
          const prefix = '<div class="pc_specail_text pc_singer_tab_content" id="specailIntroduceWrap">';
          let index = html.indexOf(prefix);
          if (index < 0) return null;
          const afterStr = html.substring(index + prefix.length);
          index = afterStr.indexOf("</div>");
          if (index < 0) return null;
          return decodeName(afterStr.substring(0, index));
        },
        async getListDetailBySpecialId(id, page, tryNum = 0) {
          if (tryNum > 2) throw new Error("try max num");
          const { body } = await httpFetch(this.getSongListDetailUrl(id)).promise;
          let listData = body.match(this.regExps.listData);
          let listInfo = body.match(this.regExps.listInfo);
          if (!listData) return this.getListDetailBySpecialId(id, page, ++tryNum);
          let list = await this.getMusicInfos(JSON.parse(listData[1]));
          let name;
          let pic;
          if (listInfo) {
            name = listInfo[1];
            pic = listInfo[2];
          }
          let desc = this.parseHtmlDesc(body);
          return {
            list,
            page: 1,
            limit: 1e4,
            total: list.length,
            source: "kg",
            info: {
              name,
              img: pic,
              desc
              // author: body.result.info.userinfo.username,
              // play_count: formatPlayCount(body.result.listen_num),
            }
          };
        },
        getInfoUrl(tagId) {
          return tagId ? `http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&cdn=cdn&t=5&c=${tagId}` : "http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&";
        },
        getSongListUrl(sortId, tagId, page) {
          if (tagId == null) tagId = "";
          return `http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=${sortId}&c=${tagId}&p=${page}`;
        },
        getSongListDetailUrl(id) {
          return `http://www2.kugou.kugou.com/yueku/v9/special/single/${id}-5-9999.html`;
        },
        filterInfoHotTag(rawData) {
          const result = [];
          if (rawData.status !== 1) return result;
          for (const key of Object.keys(rawData.data)) {
            let tag = rawData.data[key];
            result.push({
              id: tag.special_id,
              name: tag.special_name,
              source: "kg"
            });
          }
          return result;
        },
        filterTagInfo(rawData) {
          const result = [];
          for (const name of Object.keys(rawData)) {
            result.push({
              name,
              list: rawData[name].data.map((tag) => ({
                parent_id: tag.parent_id,
                parent_name: tag.pname,
                id: tag.id,
                name: tag.name,
                source: "kg"
              }))
            });
          }
          return result;
        },
        getSongList(sortId, tagId, page, tryNum = 0) {
          if (this._requestObj_list) this._requestObj_list.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_list = httpFetch(
            this.getSongListUrl(sortId, tagId, page)
          );
          return this._requestObj_list.promise.then(({ body }) => {
            if (!body || body.status !== 1) return this.getSongList(sortId, tagId, page, ++tryNum);
            return this.filterList(body.special_db);
          });
        },
        getSongListRecommend(tryNum = 0) {
          if (this._requestObj_listRecommend) this._requestObj_listRecommend.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_listRecommend = httpFetch(
            "http://everydayrec.service.kugou.com/guess_special_recommend",
            {
              method: "post",
              headers: {
                "User-Agent": "KuGou2012-8275-web_browser_event_handler"
              },
              body: {
                appid: 1001,
                clienttime: 1566798337219,
                clientver: 8275,
                key: "f1f93580115bb106680d2375f8032d96",
                mid: "21511157a05844bd085308bc76ef3343",
                platform: "pc",
                userid: "262643156",
                return_min: 6,
                return_max: 15
              }
            }
          );
          return this._requestObj_listRecommend.promise.then(({ body }) => {
            if (body.status !== 1) return this.getSongListRecommend(++tryNum);
            return this.filterList(body.data.special_list);
          });
        },
        filterList(rawData) {
          return rawData.map((item) => ({
            play_count: item.total_play_count || formatPlayCount(item.play_count),
            id: "id_" + item.specialid,
            author: item.nickname,
            name: item.specialname,
            time: dateFormat(item.publish_time || item.publishtime, "Y-M-D"),
            img: item.img || item.imgurl,
            total: item.songcount,
            grade: item.grade,
            desc: item.intro,
            source: "kg"
          }));
        },
        async createHttp(url, options, retryNum = 0) {
          if (retryNum > 2) throw new Error("try max num");
          let result;
          options.cache = "default";
          try {
            result = await httpFetch(url, options).promise;
          } catch (err) {
            console.log(err);
            return this.createHttp(url, options, ++retryNum);
          }
          if (result.statusCode !== 200 || (result.body.error_code !== void 0 ? result.body.error_code : result.body.errcode !== void 0 ? result.body.errcode : result.body.err_code) !== 0) return this.createHttp(url, options, ++retryNum);
          if (result.body.data) return result.body.data;
          if (Array.isArray(result.body.info)) return result.body;
          return result.body.info;
        },
        createTask(hashs) {
          let data = {
            area_code: "1",
            show_privilege: 1,
            show_album_info: "1",
            is_publish: "",
            appid: 1005,
            clientver: 11451,
            mid: "1",
            dfid: "-",
            clienttime: Date.now(),
            key: "OIlwieks28dk2k092lksi2UIkp",
            fields: "album_info,author_name,audio_info,ori_audio_name,base,songname"
          };
          let list = hashs;
          let tasks = [];
          while (list.length) {
            tasks.push(Object.assign({ data: list.slice(0, 100) }, data));
            if (list.length < 100) break;
            list = list.slice(100);
          }
          let url = "http://gateway.kugou.com/v2/album_audio/audio";
          return tasks.map((task) => this.createHttp(url, {
            method: "POST",
            body: task,
            headers: {
              "KG-THash": "13a3164",
              "KG-RC": "1",
              "KG-Fake": "0",
              "KG-RF": "00869891",
              "User-Agent": "Android712-AndroidPhone-11451-376-0-FeeCacheUpdate-wifi",
              "x-router": "kmr.service.kugou.com"
            }
          }).then((data2) => data2.map((s) => s[0])));
        },
        async getMusicInfos(list) {
          return this.filterData2(
            await Promise.all(
              this.createTask(
                this.deDuplication(list).map((item) => ({ hash: item.hash }))
              )
            ).then(([...datas]) => datas.flat())
          );
        },
        async getUserListDetailByCode(id) {
          const songInfo = await this.createHttp("http://t.kugou.com/command/", {
            method: "POST",
            headers: {
              "KG-RC": 1,
              "KG-THash": "network_super_call.cpp:3676261689:379",
              "User-Agent": ""
            },
            body: { appid: 1001, clientver: 9020, mid: "21511157a05844bd085308bc76ef3343", clienttime: 640612895, key: "36164c4015e704673c588ee202b9ecb8", data: id }
          });
          let songList;
          let info = songInfo.info;
          switch (info.type) {
            case 2:
              if (!info.global_collection_id) return this.getListDetailBySpecialId(info.id);
              break;
            default:
              break;
          }
          if (info.global_collection_id) return this.getUserListDetail2(info.global_collection_id);
          if (info.userid != null) {
            songList = await this.createHttp("http://www2.kugou.kugou.com/apps/kucodeAndShare/app/", {
              method: "POST",
              headers: {
                "KG-RC": 1,
                "KG-THash": "network_super_call.cpp:3676261689:379",
                "User-Agent": ""
              },
              body: { appid: 1001, clientver: 9020, mid: "21511157a05844bd085308bc76ef3343", clienttime: 640612895, key: "36164c4015e704673c588ee202b9ecb8", data: { id: info.id, type: 3, userid: info.userid, collect_type: 0, page: 1, pagesize: info.count } }
            });
          }
          let list = await this.getMusicInfos(songList || songInfo.list);
          return {
            list,
            page: 1,
            limit: info.count,
            total: list.length,
            source: "kg",
            info: {
              name: info.name,
              img: info.img_size && info.img_size.replace("{size}", 240) || info.img,
              // desc: body.result.info.list_desc,
              author: info.username
              // play_count: formatPlayCount(info.count),
            }
          };
        },
        async getUserListDetail3(chain, page) {
          const songInfo = await this.createHttp(`http://m.kugou.com/schain/transfer?pagesize=${this.listDetailLimit}&chain=${chain}&su=1&page=${page}&n=0.7928855356604456`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1"
            }
          });
          if (!songInfo.list) {
            if (songInfo.global_collection_id) {
              return this.getListDetailByGcidChain(songInfo.global_collection_id, chain).catch(() => this.getUserListDetail2(songInfo.global_collection_id));
            } else return this.getUserListDetail4(songInfo, chain, page).catch(() => this.getUserListDetail5(chain));
          }
          let list = await this.getMusicInfos(songInfo.list);
          return {
            list,
            page: 1,
            limit: this.listDetailLimit,
            total: list.length,
            source: "kg",
            info: {
              name: songInfo.info.name,
              img: songInfo.info.img,
              // desc: body.result.info.list_desc,
              author: songInfo.info.username
              // play_count: formatPlayCount(info.count),
            }
          };
        },
        deDuplication(datas) {
          let ids = /* @__PURE__ */ new Set();
          return datas.filter(({ hash }) => {
            if (ids.has(hash)) return false;
            ids.add(hash);
            return true;
          });
        },
        async decodeGcid(gcid) {
          const params = "dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-";
          const body = {
            ret_info: 1,
            data: [
              {
                id: gcid,
                id_type: 2
              }
            ]
          };
          const result = await this.createHttp(`https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${signatureParams(params, "android", JSON.stringify(body))}`, {
            method: "POST",
            headers: {
              "User-Agent": "Mozilla/5.0 (Linux; Android 10; HUAWEI HMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
              Referer: "https://m.kugou.com/"
            },
            body
          });
          return result.list[0].global_collection_id;
        },
        async getUserListDetailByLink({ info }, link) {
          let listInfo = info["0"];
          let total = listInfo.count;
          let tasks = [];
          let page = 0;
          while (total) {
            const limit = total > 90 ? 90 : total;
            total -= limit;
            page += 1;
            tasks.push(this.createHttp(link.replace(/pagesize=\d+/, "pagesize=" + limit).replace(/page=\d+/, "page=" + page), {
              headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1",
                Referer: link
              }
            }).then((data) => data.list.info));
          }
          let result = await Promise.all(tasks).then(([...datas]) => datas.flat());
          result = await this.getMusicInfos(result);
          return {
            list: result,
            page,
            limit: this.listDetailLimit,
            total: result.length,
            source: "kg",
            info: {
              name: listInfo.name,
              img: listInfo.pic && listInfo.pic.replace("{size}", 240),
              // desc: body.result.info.list_desc,
              author: listInfo.list_create_username
              // play_count: formatPlayCount(listInfo.count),
            }
          };
        },
        createGetListDetail2Task(id, total) {
          let tasks = [];
          let page = 0;
          while (total) {
            const limit = total > 300 ? 300 : total;
            total -= limit;
            page += 1;
            const params = "appid=1058&global_specialid=" + id + "&specialid=0&plat=0&version=8000&page=" + page + "&pagesize=" + limit + "&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-";
            tasks.push(this.createHttp(`https://mobiles.kugou.com/api/v5/special/song_v2?${params}&signature=${signatureParams(params, "web")}`, {
              headers: {
                mid: "1586163263991",
                Referer: "https://m3ws.kugou.com/share/index.php",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
                dfid: "-",
                clienttime: "1586163263991"
              }
            }).then((data) => data.info));
          }
          return Promise.all(tasks).then(([...datas]) => datas.flat());
        },
        async getListDetailByGcidChain(id, chain) {
          const params = "srcappid=2919&clientver=20000&clienttime=1789566751657&mid=1789566751657&uuid=1789566751657&dfid=-&listid=15&type=0&pagesize=50&global_collection_id=" + id + "&page=1&share_type=collect&appid=1058&chain=" + chain;
          const data = await this.createHttp(`https://m3ws.kugou.com/v2/zlist/list?${params}&signature=${signatureParams(params, "web")}`, {
            headers: {
              mid: "1586163263991",
              Referer: "https://m3ws.kugou.com/share/index.php",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
              dfid: "-",
              clienttime: "1586163263991"
            }
          });
          const info = data.info[0];
          if (!info) throw new Error("get list error");
          let tasks = [Promise.resolve(data.list.info)];
          let page = 1;
          let totalPage = Math.ceil(info.count / 50);
          while (page < totalPage) {
            const limit = 50;
            page += 1;
            const params2 = "srcappid=2919&clientver=20000&clienttime=1789566751657&mid=1789566751657&uuid=1789566751657&dfid=-&listid=15&type=0&pagesize=" + limit + "&global_collection_id=" + id + "&page=" + page + "&share_type=collect&appid=1058&chain=" + chain;
            tasks.push(this.createHttp(`https://m3ws.kugou.com/v2/zlist/list?${params2}&signature=${signatureParams(params2, "web")}`, {
              headers: {
                mid: "1586163263991",
                Referer: "https://m3ws.kugou.com/share/index.php",
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
                dfid: "-",
                clienttime: "1586163263991"
              }
            }).then((data2) => data2.list.info));
          }
          const hashs = await Promise.all(tasks).then(([...datas]) => datas.flat());
          let list = await this.getMusicInfos(hashs);
          return {
            list,
            page: 1,
            limit: this.listDetailLimit,
            total: info.count,
            source: "kg",
            info: {
              name: info.name,
              img: info.pic && info.pic.replace("{size}", 240),
              desc: info.intro,
              author: info.list_create_username
              // play_count: formatPlayCount(info.playcount),
            }
          };
        },
        async getUserListDetail2(global_collection_id) {
          let id = global_collection_id;
          if (id.length > 1e3) throw new Error("get list error");
          const params = "appid=1058&specialid=0&global_specialid=" + id + "&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-";
          let info = await this.createHttp(`https://mobiles.kugou.com/api/v5/special/info_v2?${params}&signature=${signatureParams(params, "web")}`, {
            headers: {
              mid: "1586163242519",
              Referer: "https://m3ws.kugou.com/share/index.php",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
              dfid: "-",
              clienttime: "1586163242519"
            }
          });
          const songInfo = await this.createGetListDetail2Task(id, info.songcount);
          let list = await this.getMusicInfos(songInfo);
          return {
            list,
            page: 1,
            limit: this.listDetailLimit,
            total: list.length,
            source: "kg",
            info: {
              name: info.specialname,
              img: info.imgurl && info.imgurl.replace("{size}", 240),
              desc: info.intro,
              author: info.nickname,
              play_count: formatPlayCount(info.playcount)
            }
          };
        },
        async getListInfoByChain(chain) {
          if (this.cache.has(chain)) return this.cache.get(chain);
          const { body } = await httpFetch(`https://m.kugou.com/share/?chain=${chain}&id=${chain}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"
            }
          }).promise;
          let result = body.match(/var\sphpParam\s=\s({.+?});/);
          if (result) result = JSON.parse(result[1]);
          this.cache.set(chain, result);
          return result;
        },
        async getUserListDetailByPcChain(chain) {
          let key = `${chain}_pc_list`;
          if (this.cache.has(key)) return this.cache.get(key);
          const { body } = await httpFetch(`http://www.kugou.com/share/${chain}.html`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36"
            }
          }).promise;
          let result = body.match(/var\sdataFromSmarty\s=\s(\[.+?\])/);
          if (result) result = JSON.parse(result[1]);
          this.cache.set(chain, result);
          result = await this.getMusicInfos(result);
          return result;
        },
        async getUserListDetail4(songInfo, chain, page) {
          const limit = 100;
          const [listInfo, list] = await Promise.all([
            this.getListInfoByChain(chain),
            this.getUserListDetailById(songInfo.id, page, limit)
          ]);
          return {
            list: list || [],
            page,
            limit,
            total: list.length ?? 0,
            source: "kg",
            info: {
              name: listInfo.specialname,
              img: listInfo.imgurl && listInfo.imgurl.replace("{size}", 240),
              // desc: body.result.info.list_desc,
              author: listInfo.nickname
              // play_count: formatPlayCount(info.count),
            }
          };
        },
        async getUserListDetail5(chain) {
          const [listInfo, list] = await Promise.all([
            this.getListInfoByChain(chain),
            this.getUserListDetailByPcChain(chain)
          ]);
          return {
            list: list || [],
            page: 1,
            limit: this.listDetailLimit,
            total: list.length ?? 0,
            source: "kg",
            info: {
              name: listInfo.specialname,
              img: listInfo.imgurl && listInfo.imgurl.replace("{size}", 240),
              // desc: body.result.info.list_desc,
              author: listInfo.nickname
              // play_count: formatPlayCount(info.count),
            }
          };
        },
        async getUserListDetailById(id, page, limit) {
          const signature = await handleSignature(id, page, limit);
          let info = await this.createHttp(`https://pubsongscdn.kugou.com/v2/get_other_list_file?srcappid=2919&clientver=20000&appid=1058&type=0&module=playlist&page=${page}&pagesize=${limit}&specialid=${id}&signature=${signature}`, {
            headers: {
              Referer: "https://m3ws.kugou.com/share/index.php",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
              dfid: "-"
            }
          });
          let result = await this.getMusicInfos(info.info);
          return result;
        },
        async getUserListDetail(link, page, retryNum = 0) {
          if (retryNum > 3) return Promise.reject(new Error("link try max num"));
          if (link.includes("#")) link = link.replace(/#.*$/, "");
          if (link.includes("global_collection_id") && link.includes("chain")) {
            return this.getListDetailByGcidChain(link.replace(/^.*?global_collection_id=(\w+)(?:&.*$|#.*$|$)/, "$1"), link.replace(/^.*?chain=(\w+)(?:&.*$|#.*$|$)/, "$1"));
          }
          if (link.includes("chain=")) return this.getUserListDetail3(link.replace(/^.*?chain=(\w+)(?:&.*$|#.*$|$)/, "$1"), page);
          if (link.includes("gcid_")) {
            let gcid = link.match(/gcid_\w+/)?.[0];
            if (gcid) {
              const global_collection_id = await this.decodeGcid(gcid);
              if (global_collection_id) return this.getUserListDetail2(global_collection_id);
            }
          }
          if (link.includes(".html")) {
            if (link.includes("zlist.html")) {
              link = link.replace(/^(.*)zlist\.html/, "https://m3ws.kugou.com/zlist/list");
              if (link.includes("pagesize")) {
                link = link.replace("pagesize=30", "pagesize=" + this.listDetailLimit).replace("page=1", "page=" + page);
              } else {
                link += `&pagesize=${this.listDetailLimit}&page=${page}`;
              }
            } else if (!link.includes("song.html")) return this.getUserListDetail3(link.replace(/.+\/(\w+).html(?:\?.*|&.*$|#.*$|$)/, "$1"), page);
          }
          if (link.includes("global_collection_id")) return this.getUserListDetail2(link.replace(/^.*?global_collection_id=(\w+)(?:&.*$|#.*$|$)/, "$1"));
          const requestObj_listDetailLink = httpFetch(link, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1",
              Referer: link
            }
          });
          const { url: location, statusCode, body } = await requestObj_listDetailLink.promise;
          if (statusCode > 400) return this.getUserListDetail(link, page, ++retryNum);
          if (location.split("?")[0] != link.split("?")[0]) {
            if (location.includes("global_collection_id") && location.includes("chain")) {
              return this.getListDetailByGcidChain(location.replace(/^.*?global_collection_id=(\w+)(?:&.*$|#.*$|$)/, "$1"), location.replace(/^.*?chain=(\w+)(?:&.*$|#.*$|$)/, "$1"));
            }
            if (location.includes("chain=")) return this.getUserListDetail3(location.replace(/^.*?chain=(\w+)(?:&.*$|#.*$|$)/, "$1"), page);
            if (location.includes("gcid_")) {
              let gcid = location.match(/gcid_\w+/)?.[0];
              if (gcid) {
                const global_collection_id = await this.decodeGcid(gcid);
                if (global_collection_id) return this.getUserListDetail2(global_collection_id);
              }
            }
            if (location.includes(".html")) {
              if (location.includes("zlist.html")) {
                let link2 = location.replace(/^(.*)zlist\.html/, "https://m3ws.kugou.com/zlist/list");
                if (link2.includes("pagesize")) {
                  link2 = link2.replace("pagesize=30", "pagesize=" + this.listDetailLimit).replace("page=1", "page=" + page);
                } else {
                  link2 += `&pagesize=${this.listDetailLimit}&page=${page}`;
                }
                return this.getUserListDetail(link2, page, ++retryNum);
              } else return this.getUserListDetail3(location.replace(/.+\/(\w+).html(?:\?.*|&.*$|#.*$|$)/, "$1"), page);
            }
            if (location.includes("global_collection_id")) return this.getUserListDetail2(location.replace(/^.*?global_collection_id=(\w+)(?:&.*$|#.*$|$)/, "$1"));
          }
          if (typeof body == "string") return this.getUserListDetail2(body.replace(/^[\s\S]+?"global_collection_id":"(\w+)"[\s\S]+?$/, "$1"));
          if (body.errcode !== 0) return this.getUserListDetail(link, page, ++retryNum);
          return this.getUserListDetailByLink(body, link);
        },
        async getListDetail(id, page) {
          id = id.toString();
          if (id.includes("special/single/")) {
            id = id.replace(this.regExps.listDetailLink, "$1");
          } else if (/https?:/.test(id)) {
            return this.getUserListDetail(id.replace(/^.*?http/, "http"), page);
          } else if (/^\d+$/.test(id)) {
            return this.getUserListDetailByCode(id);
          } else if (id.startsWith("id_")) {
            id = id.replace("id_", "");
          }
          return this.getListDetailBySpecialId(id, page);
        },
        filterData(rawList) {
          return rawList.map((item) => {
            const types = [];
            const _types = {};
            if (item.filesize !== 0) {
              let size = sizeFormate(item.filesize);
              types.push({ type: "128k", size, hash: item.hash });
              _types["128k"] = {
                size,
                hash: item.hash
              };
            }
            if (item.filesize_320 !== 0) {
              let size = sizeFormate(item.filesize_320);
              types.push({ type: "320k", size, hash: item.hash_320 });
              _types["320k"] = {
                size,
                hash: item.hash_320
              };
            }
            if (item.filesize_ape !== 0) {
              let size = sizeFormate(item.filesize_ape);
              types.push({ type: "ape", size, hash: item.hash_ape });
              _types.ape = {
                size,
                hash: item.hash_ape
              };
            }
            if (item.filesize_flac !== 0) {
              let size = sizeFormate(item.filesize_flac);
              types.push({ type: "flac", size, hash: item.hash_flac });
              _types.flac = {
                size,
                hash: item.hash_flac
              };
            }
            return {
              singer: decodeName(item.singername),
              name: decodeName(item.songname),
              albumName: decodeName(item.album_name),
              albumId: item.album_id,
              songmid: item.audio_id,
              source: "kg",
              interval: formatPlayTime(item.duration / 1e3),
              img: null,
              lrc: null,
              hash: item.hash,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        // getSinger(singers) {
        //   let arr = []
        //   singers?.forEach(singer => {
        //     arr.push(singer.name)
        //   })
        //   return arr.join('、')
        // },
        // v9 API
        // filterDatav9(rawList) {
        //   console.log(rawList)
        //   return rawList.map(item => {
        //     const types = []
        //     const _types = {}
        //     item.relate_goods.forEach(qualityObj => {
        //       if (qualityObj.level === 2) {
        //         let size = sizeFormate(qualityObj.size)
        //         types.push({ type: '128k', size, hash: qualityObj.hash })
        //         _types['128k'] = {
        //           size,
        //           hash: qualityObj.hash,
        //         }
        //       } else if (qualityObj.level === 4) {
        //         let size = sizeFormate(qualityObj.size)
        //         types.push({ type: '320k', size, hash: qualityObj.hash })
        //         _types['320k'] = {
        //           size,
        //           hash: qualityObj.hash,
        //         }
        //       } else if (qualityObj.level === 5) {
        //         let size = sizeFormate(qualityObj.size)
        //         types.push({ type: 'flac', size, hash: qualityObj.hash })
        //         _types.flac = {
        //           size,
        //           hash: qualityObj.hash,
        //         }
        //       } else if (qualityObj.level === 6) {
        //         let size = sizeFormate(qualityObj.size)
        //         types.push({ type: 'flac24bit', size, hash: qualityObj.hash })
        //         _types.flac24bit = {
        //           size,
        //           hash: qualityObj.hash,
        //         }
        //       }
        //     })
        //     const nameInfo = item.name.split(' - ')
        //     return {
        //       singer: this.getSinger(item.singerinfo),
        //       name: decodeName((nameInfo[1] ?? nameInfo[0]).trim()),
        //       albumName: decodeName(item.albuminfo.name),
        //       albumId: item.albuminfo.id,
        //       songmid: item.audio_id,
        //       source: 'kg',
        //       interval: formatPlayTime(item.timelen / 1000),
        //       img: null,
        //       lrc: null,
        //       hash: item.hash,
        //       types,
        //       _types,
        //       typeUrl: {},
        //     }
        //   })
        // },
        // hash list filter
        filterData2(rawList) {
          let ids = /* @__PURE__ */ new Set();
          let list = [];
          rawList.forEach((item) => {
            if (!item) return;
            if (ids.has(item.audio_info.audio_id)) return;
            ids.add(item.audio_info.audio_id);
            const types = [];
            const _types = {};
            if (item.audio_info.filesize !== "0") {
              let size = sizeFormate(parseInt(item.audio_info.filesize));
              types.push({ type: "128k", size, hash: item.audio_info.hash });
              _types["128k"] = {
                size,
                hash: item.audio_info.hash
              };
            }
            if (item.audio_info.filesize_320 !== "0") {
              let size = sizeFormate(parseInt(item.audio_info.filesize_320));
              types.push({ type: "320k", size, hash: item.audio_info.hash_320 });
              _types["320k"] = {
                size,
                hash: item.audio_info.hash_320
              };
            }
            if (item.audio_info.filesize_flac !== "0") {
              let size = sizeFormate(parseInt(item.audio_info.filesize_flac));
              types.push({ type: "flac", size, hash: item.audio_info.hash_flac });
              _types.flac = {
                size,
                hash: item.audio_info.hash_flac
              };
            }
            if (item.audio_info.filesize_high !== "0") {
              let size = sizeFormate(parseInt(item.audio_info.filesize_high));
              types.push({ type: "flac24bit", size, hash: item.audio_info.hash_high });
              _types.flac24bit = {
                size,
                hash: item.audio_info.hash_high
              };
            }
            list.push({
              singer: decodeName(item.author_name),
              name: decodeName(item.songname),
              albumName: decodeName(item.album_info.album_name),
              albumId: item.album_info.album_id,
              songmid: item.audio_info.audio_id,
              source: "kg",
              interval: formatPlayTime(parseInt(item.audio_info.timelength) / 1e3),
              // gateway album_audio 的 album_info.sizable_cover 为专辑封面（{size} 占位）——歌单/歌单码详情歌曲行补图
              img: item.album_info && item.album_info.sizable_cover && item.album_info.sizable_cover.replace("{size}", "480") || null,
              lrc: null,
              hash: item.audio_info.hash,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            });
          });
          return list;
        },
        // 获取列表信息
        getListInfo(tagId, tryNum = 0) {
          if (this._requestObj_listInfo) this._requestObj_listInfo.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_listInfo = httpFetch(this.getInfoUrl(tagId));
          return this._requestObj_listInfo.promise.then(({ body }) => {
            if (body.status !== 1) return this.getListInfo(tagId, ++tryNum);
            return {
              limit: body.data.params.pagesize,
              page: body.data.params.p,
              total: body.data.params.total,
              source: "kg"
            };
          });
        },
        // 获取列表数据
        getList(sortId, tagId, page) {
          let tasks = [this.getSongList(sortId, tagId, page)];
          tasks.push(
            this.currentTagInfo.id === tagId ? Promise.resolve(this.currentTagInfo.info) : this.getListInfo(tagId).then((info) => {
              this.currentTagInfo.id = tagId;
              this.currentTagInfo.info = Object.assign({}, info);
              return info;
            })
          );
          if (!tagId && page === 1 && sortId === this.sortList[0].id) tasks.push(this.getSongListRecommend());
          return Promise.all(tasks).then(([list, info, recommendList]) => {
            if (recommendList) list.unshift(...recommendList);
            return {
              list,
              ...info
            };
          });
        },
        // 获取标签
        getTags(tryNum = 0) {
          if (this._requestObj_tags) this._requestObj_tags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_tags = httpFetch(this.getInfoUrl());
          return this._requestObj_tags.promise.then(({ body }) => {
            if (body.status !== 1) return this.getTags(++tryNum);
            return {
              hotTag: this.filterInfoHotTag(body.data.hotTag),
              tags: this.filterTagInfo(body.data.tagids),
              source: "kg"
            };
          });
        },
        getDetailPageUrl(id) {
          if (typeof id == "string") {
            if (/^https?:\/\//.test(id)) return id;
            id = id.replace("id_", "");
          }
          return `https://www.kugou.com/yy/special/single/${id}.html`;
        },
        search(text, page, limit = 20) {
          return httpFetch(`http://msearchretry.kugou.com/api/v3/search/special?keyword=${encodeURIComponent(text)}&page=${page}&pagesize=${limit}&showtype=10&filter=0&version=7910&sver=2`).promise.then(({ body }) => {
            if (body.errcode != 0) throw new Error("filed");
            return {
              list: body.data.info.map((item) => {
                return {
                  play_count: formatPlayCount(item.playcount),
                  id: "id_" + item.specialid,
                  author: item.nickname,
                  name: item.specialname,
                  time: dateFormat(item.publishtime, "Y-M-D"),
                  img: item.imgurl,
                  grade: item.grade,
                  desc: item.intro,
                  total: item.songcount,
                  source: "kg"
                };
              }),
              limit,
              total: body.data.total,
              source: "kg"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/kg/musicSearch.js
  var musicSearch_default2;
  var init_musicSearch2 = __esm({
    "src/musicSdk/kg/musicSearch.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_utils();
      musicSearch_default2 = {
        limit: 30,
        total: 0,
        page: 0,
        allPage: 1,
        musicSearch(str, page, limit) {
          const searchRequest = httpFetch(`https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`);
          return searchRequest.promise.then(({ body }) => body);
        },
        filterData(rawData) {
          const types = [];
          const _types = {};
          if (rawData.FileSize !== 0) {
            let size = sizeFormate(rawData.FileSize);
            types.push({ type: "128k", size, hash: rawData.FileHash });
            _types["128k"] = {
              size,
              hash: rawData.FileHash
            };
          }
          if (rawData.HQFileSize !== 0) {
            let size = sizeFormate(rawData.HQFileSize);
            types.push({ type: "320k", size, hash: rawData.HQFileHash });
            _types["320k"] = {
              size,
              hash: rawData.HQFileHash
            };
          }
          if (rawData.SQFileSize !== 0) {
            let size = sizeFormate(rawData.SQFileSize);
            types.push({ type: "flac", size, hash: rawData.SQFileHash });
            _types.flac = {
              size,
              hash: rawData.SQFileHash
            };
          }
          if (rawData.ResFileSize !== 0) {
            let size = sizeFormate(rawData.ResFileSize);
            types.push({ type: "flac24bit", size, hash: rawData.ResFileHash });
            _types.flac24bit = {
              size,
              hash: rawData.ResFileHash
            };
          }
          return {
            singer: decodeName(formatSingerName(rawData.Singers, "name")),
            name: decodeName(`${rawData.OriSongName}${rawData.Suffix ? ` ${rawData.Suffix}` : ""}`),
            albumName: decodeName(rawData.AlbumName),
            albumId: rawData.AlbumID,
            songmid: rawData.Audioid,
            source: "kg",
            interval: formatPlayTime(rawData.Duration),
            _interval: rawData.Duration,
            // song_search_v2 行内 Image 为专辑封面（{size} 占位）
            img: rawData.Image && rawData.Image.replace("{size}", "480") || null,
            lrc: null,
            otherSource: null,
            hash: rawData.FileHash,
            types,
            _types,
            typeUrl: {}
          };
        },
        handleResult(rawData) {
          let ids = /* @__PURE__ */ new Set();
          const list = [];
          rawData.forEach((item) => {
            const key = item.Audioid + item.FileHash;
            if (ids.has(key)) return;
            ids.add(key);
            list.push(this.filterData(item));
            for (const childItem of item.Grp) {
              const key2 = item.Audioid + item.FileHash;
              if (ids.has(key2)) continue;
              ids.add(key2);
              list.push(this.filterData(childItem));
            }
          });
          return list;
        },
        search(str, page = 1, limit, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          if (limit == null) limit = this.limit;
          return this.musicSearch(str, page, limit).then((result) => {
            if (!result || result.error_code !== 0) return this.search(str, page, limit, retryNum);
            let list = this.handleResult(result.data.lists);
            if (list == null) return this.search(str, page, limit, retryNum);
            this.total = result.data.total;
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return Promise.resolve({
              list,
              allPage: this.allPage,
              limit,
              total: this.total,
              source: "kg"
            });
          });
        }
      };
    }
  });

  // src/musicSdk/kg/pic.js
  var pic_default2;
  var init_pic2 = __esm({
    "src/musicSdk/kg/pic.js"() {
      "use strict";
      init_request();
      pic_default2 = {
        getPic(songInfo) {
          const requestObj = httpFetch(
            "http://media.store.kugou.com/v1/get_res_privilege",
            {
              method: "POST",
              headers: {
                "KG-RC": 1,
                "KG-THash": "expand_search_manager.cpp:852736169:451",
                "User-Agent": "KuGou2012-9020-ExpandSearchManager"
              },
              body: {
                appid: 1001,
                area_code: "1",
                behavior: "play",
                clientver: "9020",
                need_hash_offset: 1,
                relate: 1,
                resource: [
                  {
                    album_audio_id: songInfo.songmid.length == 32 ? songInfo.audioId.split("_")[0] : songInfo.songmid,
                    album_id: songInfo.albumId,
                    hash: songInfo.hash,
                    id: 0,
                    name: `${songInfo.singer} - ${songInfo.name}.mp3`,
                    type: "audio"
                  }
                ],
                token: "",
                userid: 2626431536,
                vip: 1
              }
            }
          );
          return requestObj.promise.then(({ body }) => {
            if (body.error_code !== 0) return Promise.reject(new Error("图片获取失败"));
            let info = body.data[0].info;
            const img = info.imgsize ? info.image.replace("{size}", info.imgsize[0]) : info.image;
            if (!img) return Promise.reject(new Error("Pic get failed"));
            return img;
          });
        }
      };
    }
  });

  // src/musicSdk/kg/lyric.js
  var headExp, parseLyric, lyric_default2;
  var init_lyric2 = __esm({
    "src/musicSdk/kg/lyric.js"() {
      "use strict";
      init_buffer();
      init_request();
      init_util2();
      init_utils_index();
      headExp = /^.*\[id:\$\w+\]\n/;
      parseLyric = (str) => {
        str = str.replace(/\r/g, "");
        if (headExp.test(str)) str = str.replace(headExp, "");
        let trans = str.match(/\[language:([\w=\\/+]+)\]/);
        let lyric;
        let rlyric;
        let tlyric;
        if (trans) {
          str = str.replace(/\[language:[\w=\\/+]+\]\n/, "");
          let json = JSON.parse(Buffer2.from(trans[1], "base64").toString());
          for (const item of json.content) {
            switch (item.type) {
              case 0:
                rlyric = item.lyricContent;
                break;
              case 1:
                tlyric = item.lyricContent;
                break;
            }
          }
        }
        let i = 0;
        let lxlyric = str.replace(/\[((\d+),\d+)\].*/g, (str2) => {
          let result = str2.match(/\[((\d+),\d+)\].*/);
          let time = parseInt(result[2]);
          let ms = (time % 1e3).toString().padStart(3, "0");
          time /= 1e3;
          let m = parseInt(time / 60).toString().padStart(2, "0");
          time %= 60;
          let s = parseInt(time).toString().padStart(2, "0");
          time = `${m}:${s}.${ms}`;
          if (rlyric) rlyric[i] = `[${time}]${rlyric[i]?.join("") ?? ""}`;
          if (tlyric) tlyric[i] = `[${time}]${tlyric[i]?.join("") ?? ""}`;
          i++;
          return str2.replace(result[1], time);
        });
        rlyric = rlyric ? rlyric.join("\n") : "";
        tlyric = tlyric ? tlyric.join("\n") : "";
        lxlyric = lxlyric.replace(/<(\d+,\d+),\d+>/g, "<$1>");
        lxlyric = decodeName(lxlyric);
        lyric = lxlyric.replace(/<\d+,\d+>/g, "");
        rlyric = decodeName(rlyric);
        tlyric = decodeName(tlyric);
        return {
          lyric,
          tlyric,
          rlyric,
          lxlyric
        };
      };
      lyric_default2 = {
        getIntv(interval) {
          if (!interval) return 0;
          let intvArr = interval.split(":");
          let intv = 0;
          let unit = 1;
          while (intvArr.length) {
            intv += intvArr.pop() * unit;
            unit *= 60;
          }
          return parseInt(intv);
        },
        // getLyric(songInfo, tryNum = 0) {
        //   let requestObj = httpFetch(`http://m.kugou.com/app/i/krc.php?cmd=100&keyword=${encodeURIComponent(songInfo.name)}&hash=${songInfo.hash}&timelength=${songInfo._interval || this.getIntv(songInfo.interval)}&d=0.38664927426725626`, {
        //     headers: {
        //       'KG-RC': 1,
        //       'KG-THash': 'expand_search_manager.cpp:852736169:451',
        //       'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
        //     },
        //   })
        //   requestObj.promise = requestObj.promise.then(({ body, statusCode }) => {
        //     if (statusCode !== 200) {
        //       if (tryNum > 5) return Promise.reject(new Error('歌词获取失败'))
        //       let tryRequestObj = this.getLyric(songInfo, ++tryNum)
        //       requestObj.cancelHttp = tryRequestObj.cancelHttp.bind(tryRequestObj)
        //       return tryRequestObj.promise
        //     }
        //     return {
        //       lyric: body,
        //       tlyric: '',
        //     }
        //   })
        //   return requestObj
        // },
        searchLyric(name, hash, time, tryNum = 0) {
          let requestObj = httpFetch(`http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name)}&hash=${hash}&timelength=${time}&lrctxt=1`, {
            headers: {
              "KG-RC": 1,
              "KG-THash": "expand_search_manager.cpp:852736169:451",
              "User-Agent": "KuGou2012-9020-ExpandSearchManager"
            }
          });
          requestObj.promise = requestObj.promise.then(({ body, statusCode }) => {
            if (statusCode !== 200) {
              if (tryNum > 5) return Promise.reject(new Error("歌词获取失败"));
              let tryRequestObj = this.searchLyric(name, hash, time, ++tryNum);
              requestObj.cancelHttp = tryRequestObj.cancelHttp.bind(tryRequestObj);
              return tryRequestObj.promise;
            }
            if (body.candidates.length) {
              let info = body.candidates[0];
              return { id: info.id, accessKey: info.accesskey, fmt: info.krctype == 1 && info.contenttype != 1 ? "krc" : "lrc" };
            }
            return null;
          });
          return requestObj;
        },
        getLyricDownload(id, accessKey, fmt, tryNum = 0) {
          let requestObj = httpFetch(`http://lyrics.kugou.com/download?ver=1&client=pc&id=${id}&accesskey=${accessKey}&fmt=${fmt}&charset=utf8`, {
            headers: {
              "KG-RC": 1,
              "KG-THash": "expand_search_manager.cpp:852736169:451",
              "User-Agent": "KuGou2012-9020-ExpandSearchManager"
            }
          });
          requestObj.promise = requestObj.promise.then(({ body, statusCode }) => {
            if (statusCode !== 200) {
              if (tryNum > 5) return Promise.reject(new Error("歌词获取失败"));
              let tryRequestObj = this.getLyric(id, accessKey, fmt, ++tryNum);
              requestObj.cancelHttp = tryRequestObj.cancelHttp.bind(tryRequestObj);
              return tryRequestObj.promise;
            }
            switch (body.fmt) {
              case "krc":
                return decodeLyric2(body.content).then((result) => parseLyric(result));
              case "lrc":
                return {
                  lyric: Buffer2.from(body.content, "base64").toString("utf-8"),
                  tlyric: "",
                  rlyric: "",
                  lxlyric: ""
                };
              default:
                return Promise.reject(new Error(`未知歌词格式: ${body.fmt}`));
            }
          });
          return requestObj;
        },
        getLyric(songInfo, tryNum = 0) {
          let requestObj = this.searchLyric(songInfo.name, songInfo.hash, songInfo._interval || this.getIntv(songInfo.interval));
          requestObj.promise = requestObj.promise.then((result) => {
            if (!result) return Promise.reject(new Error("Get lyric failed"));
            let requestObj2 = this.getLyricDownload(result.id, result.accessKey, result.fmt);
            requestObj.cancelHttp = requestObj2.cancelHttp.bind(requestObj2);
            return requestObj2.promise;
          });
          return requestObj;
        }
      };
    }
  });

  // src/musicSdk/kg/hotSearch.js
  var hotSearch_default2;
  var init_hotSearch2 = __esm({
    "src/musicSdk/kg/hotSearch.js"() {
      "use strict";
      init_request();
      init_utils_index();
      hotSearch_default2 = {
        _requestObj: null,
        async getList(retryNum = 0) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const _requestObj = httpFetch("http://gateway.kugou.com/api/v3/search/hot_tab?signature=ee44edb9d7155821412d220bcaf509dd&appid=1005&clientver=10026&plat=0", {
            method: "get",
            cache: null,
            headers: {
              dfid: "1ssiv93oVqMp27cirf2CvoF1",
              mid: "156798703528610303473757548878786007104",
              clienttime: 1584257267,
              "x-router": "msearch.kugou.com",
              "user-agent": "Android9-AndroidPhone-10020-130-0-searchrecommendprotocol-wifi",
              "kg-rc": 1
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.errcode !== 0) throw new Error("获取热搜词失败");
          return { source: "kg", list: this.filterList(body.data.list) };
        },
        filterList(rawList) {
          const list = [];
          rawList.forEach((item) => {
            item.keywords.map((k) => list.push(decodeName(k.keyword)));
          });
          return list;
        }
      };
    }
  });

  // src/musicSdk/kg/comment.js
  var comment_default2;
  var init_comment2 = __esm({
    "src/musicSdk/kg/comment.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_util2();
      comment_default2 = {
        _requestObj: null,
        _requestObj2: null,
        async getComment({ hash }, page = 1, limit = 20) {
          if (this._requestObj) this._requestObj.cancelHttp();
          let timestamp = Date.now();
          const params = `dfid=0&mid=16249512204336365674023395779019&clienttime=${timestamp}&uuid=0&extdata=${hash}&appid=1005&code=fc4be23b4e972707f36b8a828a93ba8a&schash=${hash}&clientver=11409&p=${page}&clienttoken=&pagesize=${limit}&ver=10&kugouid=0`;
          const _requestObj = httpFetch(`http://m.comment.service.kugou.com/r/v1/rank/newest?${params}&signature=${signatureParams(params)}`, {
            cache: "default",
            headers: {
              "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.24"
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.err_code !== 0) throw new Error("获取评论失败");
          const total = body.count ?? 0;
          return { source: "kg", comments: this.filterComment(body.list || []), total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        async getHotComment({ hash }, page = 1, limit = 20) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          let timestamp = Date.now();
          const params = `dfid=0&mid=16249512204336365674023395779019&clienttime=${timestamp}&uuid=0&extdata=${hash}&appid=1005&code=fc4be23b4e972707f36b8a828a93ba8a&schash=${hash}&clientver=11409&p=${page}&clienttoken=&pagesize=${limit}&ver=10&kugouid=0`;
          const _requestObj2 = httpFetch(`http://m.comment.service.kugou.com/r/v1/rank/topliked?${params}&signature=${signatureParams(params)}`, {
            cache: "default",
            headers: {
              "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.24"
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.err_code !== 0) throw new Error("获取热门评论失败");
          const total = body.count ?? 0;
          return { source: "kg", comments: this.filterComment(body.list || []), total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        async getReplyComment({ songmid, audioId }, replyId, page = 1, limit = 100) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          songmid = songmid.length == 32 ? audioId.split("_")[0] : songmid;
          const _requestObj2 = httpFetch(`http://comment.service.kugou.com/index.php?r=commentsv2/getReplyWithLike&code=fc4be23b4e972707f36b8a828a93ba8a&p=${page}&pagesize=${limit}&ver=1.01&clientver=8373&kugouid=687373022&need_show_image=1&appid=1001&childrenid=${songmid}&tid=${replyId}`, {
            headers: {
              "User-Agent": "Android712-AndroidPhone-8983-18-0-COMMENT-wifi"
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.err_code !== 0) throw new Error("获取回复评论失败");
          return { source: "kg", comments: this.filterComment(body.list || []) };
        },
        replaceAt(raw, atList) {
          atList.forEach((atobj) => {
            raw = raw.replaceAll(`[at=${atobj.id}]`, `@${atobj.name} `);
          });
          return raw;
        },
        filterComment(rawList) {
          return rawList.map((item) => {
            let data = {
              id: item.id,
              text: decodeName((item.atlist ? this.replaceAt(item.content, item.atlist) : item.content) || ""),
              images: item.images ? item.images.map((i) => i.url) : [],
              location: item.location,
              time: item.addtime,
              timeStr: dateFormat2(new Date(item.addtime).getTime()),
              userName: item.user_name,
              avatar: item.user_pic,
              userId: item.user_id,
              likedCount: item.like.likenum,
              replyNum: item.reply_num,
              reply: []
            };
            return item.pcontent ? {
              id: item.id,
              text: decodeName(item.pcontent),
              time: null,
              userName: item.puser,
              avatar: null,
              userId: item.puser_id,
              likedCount: null,
              replyNum: null,
              reply: [data]
            } : data;
          });
        }
      };
    }
  });

  // src/musicSdk/kg/index.js
  var kg, kg_default;
  var init_kg = __esm({
    "src/musicSdk/kg/index.js"() {
      "use strict";
      init_leaderboard2();
      init_api_source();
      init_songList2();
      init_musicSearch2();
      init_pic2();
      init_lyric2();
      init_hotSearch2();
      init_comment2();
      kg = {
        // tipSearch,
        leaderboard: leaderboard_default2,
        songList: songList_default2,
        musicSearch: musicSearch_default2,
        hotSearch: hotSearch_default2,
        comment: comment_default2,
        getMusicUrl(songInfo, type) {
          return apis("kg").getMusicUrl(songInfo, type);
        },
        getLyric(songInfo) {
          return lyric_default2.getLyric(songInfo);
        },
        // getLyric(songInfo) {
        //   return apis('kg').getLyric(songInfo)
        // },
        getPic(songInfo) {
          return pic_default2.getPic(songInfo);
        },
        getMusicDetailPageUrl(songInfo) {
          return `https://www.kugou.com/song/#hash=${songInfo.hash}&album_id=${songInfo.albumId}`;
        }
        // getPic(songInfo) {
        //   return apis('kg').getPic(songInfo)
        // },
      };
      kg_default = kg;
    }
  });

  // src/musicSdk/tx/leaderboard.js
  var boardList3, leaderboard_default3;
  var init_leaderboard3 = __esm({
    "src/musicSdk/tx/leaderboard.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_utils();
      boardList3 = [{ id: "tx__4", name: "流行指数榜", bangid: "4" }, { id: "tx__26", name: "热歌榜", bangid: "26" }, { id: "tx__27", name: "新歌榜", bangid: "27" }, { id: "tx__62", name: "飙升榜", bangid: "62" }, { id: "tx__58", name: "说唱榜", bangid: "58" }, { id: "tx__57", name: "喜力电音榜", bangid: "57" }, { id: "tx__28", name: "网络歌曲榜", bangid: "28" }, { id: "tx__5", name: "内地榜", bangid: "5" }, { id: "tx__3", name: "欧美榜", bangid: "3" }, { id: "tx__59", name: "香港地区榜", bangid: "59" }, { id: "tx__16", name: "韩国榜", bangid: "16" }, { id: "tx__60", name: "抖快榜", bangid: "60" }, { id: "tx__29", name: "影视金曲榜", bangid: "29" }, { id: "tx__17", name: "日本榜", bangid: "17" }, { id: "tx__52", name: "腾讯音乐人原创榜", bangid: "52" }, { id: "tx__36", name: "K歌金曲榜", bangid: "36" }, { id: "tx__61", name: "台湾地区榜", bangid: "61" }, { id: "tx__63", name: "DJ舞曲榜", bangid: "63" }, { id: "tx__64", name: "综艺新歌榜", bangid: "64" }, { id: "tx__65", name: "国风热歌榜", bangid: "65" }, { id: "tx__67", name: "听歌识曲榜", bangid: "67" }, { id: "tx__72", name: "动漫音乐榜", bangid: "72" }, { id: "tx__73", name: "游戏音乐榜", bangid: "73" }, { id: "tx__75", name: "有声榜", bangid: "75" }, { id: "tx__131", name: "校园音乐人排行榜", bangid: "131" }];
      leaderboard_default3 = {
        limit: 300,
        list: [
          {
            id: "txlxzsb",
            name: "流行榜",
            bangid: 4
          },
          {
            id: "txrgb",
            name: "热歌榜",
            bangid: 26
          },
          {
            id: "txwlhgb",
            name: "网络榜",
            bangid: 28
          },
          {
            id: "txdyb",
            name: "抖音榜",
            bangid: 60
          },
          {
            id: "txndb",
            name: "内地榜",
            bangid: 5
          },
          {
            id: "txxgb",
            name: "香港榜",
            bangid: 59
          },
          {
            id: "txtwb",
            name: "台湾榜",
            bangid: 61
          },
          {
            id: "txoumb",
            name: "欧美榜",
            bangid: 3
          },
          {
            id: "txhgb",
            name: "韩国榜",
            bangid: 16
          },
          {
            id: "txrbb",
            name: "日本榜",
            bangid: 17
          },
          {
            id: "txtybb",
            name: "YouTube榜",
            bangid: 128
          }
        ],
        listDetailRequest(id, period, limit) {
          return httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            method: "post",
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
            },
            body: {
              toplist: {
                module: "musicToplist.ToplistInfoServer",
                method: "GetDetail",
                param: {
                  topid: id,
                  num: limit,
                  period
                }
              },
              comm: {
                uin: 0,
                format: "json",
                ct: 20,
                cv: 1859
              }
            }
          }).promise;
        },
        regExps: {
          periodList: /<i class="play_cover__btn c_tx_link js_icon_play" data-listkey=".+?" data-listname=".+?" data-tid=".+?" data-date=".+?" .+?<\/i>/g,
          period: /data-listname="(.+?)" data-tid=".*?\/(.+?)" data-date="(.+?)" .+?<\/i>/
        },
        periods: {},
        periodUrl: "https://c.y.qq.com/node/pc/wk_v15/top.html",
        _requestBoardsObj: null,
        getBoardsData() {
          if (this._requestBoardsObj) this._requestBoardsObj.cancelHttp();
          this._requestBoardsObj = httpFetch("https://c.y.qq.com/v8/fcg-bin/fcg_myqq_toplist.fcg?g_tk=1928093487&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&uin=0&needNewCode=1&platform=h5");
          return this._requestBoardsObj.promise;
        },
        getData(url) {
          const requestDataObj = httpFetch(url);
          return requestDataObj.promise;
        },
        filterData(rawList) {
          return rawList.map((item) => {
            let types = [];
            let _types = {};
            if (item.file.size_128mp3 !== 0) {
              let size = sizeFormate(item.file.size_128mp3);
              types.push({ type: "128k", size });
              _types["128k"] = {
                size
              };
            }
            if (item.file.size_320mp3 !== 0) {
              let size = sizeFormate(item.file.size_320mp3);
              types.push({ type: "320k", size });
              _types["320k"] = {
                size
              };
            }
            if (item.file.size_flac !== 0) {
              let size = sizeFormate(item.file.size_flac);
              types.push({ type: "flac", size });
              _types.flac = {
                size
              };
            }
            if (item.file.size_hires !== 0) {
              let size = sizeFormate(item.file.size_hires);
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            return {
              singer: formatSingerName(item.singer, "name"),
              name: item.title,
              albumName: item.album.name,
              albumId: item.album.mid,
              source: "tx",
              interval: formatPlayTime(item.interval),
              songId: item.id,
              albumMid: item.album.mid,
              strMediaMid: item.file.media_mid,
              songmid: item.mid,
              img: item.album.name === "" || item.album.name === "空" ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : "" : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        getPeriods(bangid) {
          return this.getData(this.periodUrl).then(({ body: html }) => {
            let result = html.match(this.regExps.periodList);
            if (!result) return Promise.reject(new Error("get data failed"));
            result.forEach((item) => {
              let result2 = item.match(this.regExps.period);
              if (!result2) return;
              this.periods[result2[2]] = {
                name: result2[1],
                bangid: result2[2],
                period: result2[3]
              };
            });
            const info = this.periods[bangid];
            return info && info.period;
          });
        },
        filterBoardsData(rawList) {
          let list = [];
          for (const board of rawList) {
            if (board.id == 201) continue;
            if (board.topTitle.startsWith("巅峰榜·")) {
              board.topTitle = board.topTitle.substring(4, board.topTitle.length);
            }
            if (!board.topTitle.endsWith("榜")) board.topTitle += "榜";
            list.push({
              id: "tx__" + board.id,
              name: board.topTitle,
              bangid: String(board.id)
            });
          }
          return list;
        },
        async getBoards(retryNum = 0) {
          this.list = boardList3;
          return {
            list: boardList3,
            source: "tx"
          };
        },
        getList(bangid, page, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          bangid = parseInt(bangid);
          let info = this.periods[bangid];
          let p = info ? Promise.resolve(info.period) : this.getPeriods(bangid);
          return p.then((period) => {
            return this.listDetailRequest(bangid, period, this.limit).then((resp) => {
              if (resp.body.code !== 0) return this.getList(bangid, page, retryNum);
              return {
                total: resp.body.toplist.data.songInfoList.length,
                list: this.filterData(resp.body.toplist.data.songInfoList),
                limit: this.limit,
                page: 1,
                source: "tx"
              };
            });
          });
        },
        getDetailPageUrl(id) {
          if (typeof id == "string") id = id.replace("tx__", "");
          return `https://y.qq.com/n/ryqq/toplist/${id}`;
        }
      };
    }
  });

  // src/musicSdk/tx/musicInfo.js
  var getSinger, musicInfo_default;
  var init_musicInfo = __esm({
    "src/musicSdk/tx/musicInfo.js"() {
      "use strict";
      init_request();
      init_utils_index();
      getSinger = (singers) => {
        let arr = [];
        singers.forEach((singer) => {
          arr.push(singer.name);
        });
        return arr.join("、");
      };
      musicInfo_default = (songmid) => {
        const requestObj = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
          method: "post",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
          },
          body: {
            comm: {
              ct: "19",
              cv: "1859",
              uin: "0"
            },
            req: {
              module: "music.pf_song_detail_svr",
              method: "get_song_detail_yqq",
              param: {
                song_type: 0,
                song_mid: songmid
              }
            }
          }
        });
        return requestObj.promise.then(({ body }) => {
          if (body.code != 0 || body.req.code != 0) return Promise.reject(new Error("获取歌曲信息失败"));
          const item = body.req.data.track_info;
          if (!item.file?.media_mid) return null;
          let types = [];
          let _types = {};
          const file = item.file;
          if (file.size_128mp3 != 0) {
            let size = sizeFormate(file.size_128mp3);
            types.push({ type: "128k", size });
            _types["128k"] = {
              size
            };
          }
          if (file.size_320mp3 !== 0) {
            let size = sizeFormate(file.size_320mp3);
            types.push({ type: "320k", size });
            _types["320k"] = {
              size
            };
          }
          if (file.size_flac !== 0) {
            let size = sizeFormate(file.size_flac);
            types.push({ type: "flac", size });
            _types.flac = {
              size
            };
          }
          if (file.size_hires !== 0) {
            let size = sizeFormate(file.size_hires);
            types.push({ type: "flac24bit", size });
            _types.flac24bit = {
              size
            };
          }
          let albumId = "";
          let albumName = "";
          if (item.album) {
            albumName = item.album.name;
            albumId = item.album.mid;
          }
          return {
            singer: getSinger(item.singer),
            name: item.title,
            albumName,
            albumId,
            source: "tx",
            interval: formatPlayTime(item.interval),
            songId: item.id,
            albumMid: item.album?.mid ?? "",
            strMediaMid: item.file.media_mid,
            songmid: item.mid,
            img: albumId === "" || albumId === "空" ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : "" : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
            types,
            _types,
            typeUrl: {}
          };
        });
      };
    }
  });

  // src/musicSdk/tx/qrcDecode.js
  var constants, DES_ENCRYPT, DES_DECRYPT, sbox, key_rnd_shift, key_perm_c, key_perm_d, key_compression, bitnum, bitnum_intr, bitnum_intl, sbox_bit, initial_permutation, inverse_permutation, des_f, des_crypt, key_schedule, tripledes_key_setup, tripledes_crypt, QRC_KEY, handleInflate2, decodeQrc;
  var init_qrcDecode = __esm({
    "src/musicSdk/tx/qrcDecode.js"() {
      "use strict";
      init_buffer();
      init_pako();
      constants = { Z_SYNC_FLUSH: 2 };
      DES_ENCRYPT = 1;
      DES_DECRYPT = 0;
      sbox = [
        [
          14,
          4,
          13,
          1,
          2,
          15,
          11,
          8,
          3,
          10,
          6,
          12,
          5,
          9,
          0,
          7,
          0,
          15,
          7,
          4,
          14,
          2,
          13,
          1,
          10,
          6,
          12,
          11,
          9,
          5,
          3,
          8,
          4,
          1,
          14,
          8,
          13,
          6,
          2,
          11,
          15,
          12,
          9,
          7,
          3,
          10,
          5,
          0,
          15,
          12,
          8,
          2,
          4,
          9,
          1,
          7,
          5,
          11,
          3,
          14,
          10,
          0,
          6,
          13
        ],
        [
          15,
          1,
          8,
          14,
          6,
          11,
          3,
          4,
          9,
          7,
          2,
          13,
          12,
          0,
          5,
          10,
          3,
          13,
          4,
          7,
          15,
          2,
          8,
          15,
          12,
          0,
          1,
          10,
          6,
          9,
          11,
          5,
          0,
          14,
          7,
          11,
          10,
          4,
          13,
          1,
          5,
          8,
          12,
          6,
          9,
          3,
          2,
          15,
          13,
          8,
          10,
          1,
          3,
          15,
          4,
          2,
          11,
          6,
          7,
          12,
          0,
          5,
          14,
          9
        ],
        [
          10,
          0,
          9,
          14,
          6,
          3,
          15,
          5,
          1,
          13,
          12,
          7,
          11,
          4,
          2,
          8,
          13,
          7,
          0,
          9,
          3,
          4,
          6,
          10,
          2,
          8,
          5,
          14,
          12,
          11,
          15,
          1,
          13,
          6,
          4,
          9,
          8,
          15,
          3,
          0,
          11,
          1,
          2,
          12,
          5,
          10,
          14,
          7,
          1,
          10,
          13,
          0,
          6,
          9,
          8,
          7,
          4,
          15,
          14,
          3,
          11,
          5,
          2,
          12
        ],
        [
          7,
          13,
          14,
          3,
          0,
          6,
          9,
          10,
          1,
          2,
          8,
          5,
          11,
          12,
          4,
          15,
          13,
          8,
          11,
          5,
          6,
          15,
          0,
          3,
          4,
          7,
          2,
          12,
          1,
          10,
          14,
          9,
          10,
          6,
          9,
          0,
          12,
          11,
          7,
          13,
          15,
          1,
          3,
          14,
          5,
          2,
          8,
          4,
          3,
          15,
          0,
          6,
          10,
          10,
          13,
          8,
          9,
          4,
          5,
          11,
          12,
          7,
          2,
          14
        ],
        [
          2,
          12,
          4,
          1,
          7,
          10,
          11,
          6,
          8,
          5,
          3,
          15,
          13,
          0,
          14,
          9,
          14,
          11,
          2,
          12,
          4,
          7,
          13,
          1,
          5,
          0,
          15,
          10,
          3,
          9,
          8,
          6,
          4,
          2,
          1,
          11,
          10,
          13,
          7,
          8,
          15,
          9,
          12,
          5,
          6,
          3,
          0,
          14,
          11,
          8,
          12,
          7,
          1,
          14,
          2,
          13,
          6,
          15,
          0,
          9,
          10,
          4,
          5,
          3
        ],
        [
          12,
          1,
          10,
          15,
          9,
          2,
          6,
          8,
          0,
          13,
          3,
          4,
          14,
          7,
          5,
          11,
          10,
          15,
          4,
          2,
          7,
          12,
          9,
          5,
          6,
          1,
          13,
          14,
          0,
          11,
          3,
          8,
          9,
          14,
          15,
          5,
          2,
          8,
          12,
          3,
          7,
          0,
          4,
          10,
          1,
          13,
          11,
          6,
          4,
          3,
          2,
          12,
          9,
          5,
          15,
          10,
          11,
          14,
          1,
          7,
          6,
          0,
          8,
          13
        ],
        [
          4,
          11,
          2,
          14,
          15,
          0,
          8,
          13,
          3,
          12,
          9,
          7,
          5,
          10,
          6,
          1,
          13,
          0,
          11,
          7,
          4,
          9,
          1,
          10,
          14,
          3,
          5,
          12,
          2,
          15,
          8,
          6,
          1,
          4,
          11,
          13,
          12,
          3,
          7,
          14,
          10,
          15,
          6,
          8,
          0,
          5,
          9,
          2,
          6,
          11,
          13,
          8,
          1,
          4,
          10,
          7,
          9,
          5,
          0,
          15,
          14,
          2,
          3,
          12
        ],
        [
          13,
          2,
          8,
          4,
          6,
          15,
          11,
          1,
          10,
          9,
          3,
          14,
          5,
          0,
          12,
          7,
          1,
          15,
          13,
          8,
          10,
          3,
          7,
          4,
          12,
          5,
          6,
          11,
          0,
          14,
          9,
          2,
          7,
          11,
          4,
          1,
          9,
          12,
          14,
          2,
          0,
          6,
          10,
          13,
          15,
          3,
          5,
          8,
          2,
          1,
          14,
          7,
          4,
          10,
          8,
          13,
          15,
          12,
          9,
          0,
          3,
          5,
          6,
          11
        ]
      ];
      key_rnd_shift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
      key_perm_c = [
        56,
        48,
        40,
        32,
        24,
        16,
        8,
        0,
        57,
        49,
        41,
        33,
        25,
        17,
        9,
        1,
        58,
        50,
        42,
        34,
        26,
        18,
        10,
        2,
        59,
        51,
        43,
        35
      ];
      key_perm_d = [
        62,
        54,
        46,
        38,
        30,
        22,
        14,
        6,
        61,
        53,
        45,
        37,
        29,
        21,
        13,
        5,
        60,
        52,
        44,
        36,
        28,
        20,
        12,
        4,
        27,
        19,
        11,
        3
      ];
      key_compression = [
        13,
        16,
        10,
        23,
        0,
        4,
        2,
        27,
        14,
        5,
        20,
        9,
        22,
        18,
        11,
        3,
        25,
        7,
        15,
        6,
        26,
        19,
        12,
        1,
        40,
        51,
        30,
        36,
        46,
        54,
        29,
        39,
        50,
        44,
        32,
        47,
        43,
        48,
        38,
        55,
        33,
        52,
        45,
        41,
        49,
        35,
        28,
        31
      ];
      bitnum = (a, b, c) => (a[(b / 32 | 0) * 4 + 3 - (b % 32 / 8 | 0)] >>> 7 - b % 8 & 1) << c >>> 0;
      bitnum_intr = (a, b, c) => (a >>> 31 - b & 1) << c >>> 0;
      bitnum_intl = (a, b, c) => (a << b >>> 0 & 2147483648) >>> 0 >>> c >>> 0;
      sbox_bit = (a) => a & 32 | (a & 31) >>> 1 | (a & 1) << 4;
      initial_permutation = (input) => {
        const s0 = (bitnum(input, 57, 31) | bitnum(input, 49, 30) | bitnum(input, 41, 29) | bitnum(input, 33, 28) | bitnum(input, 25, 27) | bitnum(input, 17, 26) | bitnum(input, 9, 25) | bitnum(input, 1, 24) | bitnum(input, 59, 23) | bitnum(input, 51, 22) | bitnum(input, 43, 21) | bitnum(input, 35, 20) | bitnum(input, 27, 19) | bitnum(input, 19, 18) | bitnum(input, 11, 17) | bitnum(input, 3, 16) | bitnum(input, 61, 15) | bitnum(input, 53, 14) | bitnum(input, 45, 13) | bitnum(input, 37, 12) | bitnum(input, 29, 11) | bitnum(input, 21, 10) | bitnum(input, 13, 9) | bitnum(input, 5, 8) | bitnum(input, 63, 7) | bitnum(input, 55, 6) | bitnum(input, 47, 5) | bitnum(input, 39, 4) | bitnum(input, 31, 3) | bitnum(input, 23, 2) | bitnum(input, 15, 1) | bitnum(input, 7, 0)) >>> 0;
        const s1 = (bitnum(input, 56, 31) | bitnum(input, 48, 30) | bitnum(input, 40, 29) | bitnum(input, 32, 28) | bitnum(input, 24, 27) | bitnum(input, 16, 26) | bitnum(input, 8, 25) | bitnum(input, 0, 24) | bitnum(input, 58, 23) | bitnum(input, 50, 22) | bitnum(input, 42, 21) | bitnum(input, 34, 20) | bitnum(input, 26, 19) | bitnum(input, 18, 18) | bitnum(input, 10, 17) | bitnum(input, 2, 16) | bitnum(input, 60, 15) | bitnum(input, 52, 14) | bitnum(input, 44, 13) | bitnum(input, 36, 12) | bitnum(input, 28, 11) | bitnum(input, 20, 10) | bitnum(input, 12, 9) | bitnum(input, 4, 8) | bitnum(input, 62, 7) | bitnum(input, 54, 6) | bitnum(input, 46, 5) | bitnum(input, 38, 4) | bitnum(input, 30, 3) | bitnum(input, 22, 2) | bitnum(input, 14, 1) | bitnum(input, 6, 0)) >>> 0;
        return [s0, s1];
      };
      inverse_permutation = (s0, s1, out) => {
        out[3] = (bitnum_intr(s1, 7, 7) | bitnum_intr(s0, 7, 6) | bitnum_intr(s1, 15, 5) | bitnum_intr(s0, 15, 4) | bitnum_intr(s1, 23, 3) | bitnum_intr(s0, 23, 2) | bitnum_intr(s1, 31, 1) | bitnum_intr(s0, 31, 0)) & 255;
        out[2] = (bitnum_intr(s1, 6, 7) | bitnum_intr(s0, 6, 6) | bitnum_intr(s1, 14, 5) | bitnum_intr(s0, 14, 4) | bitnum_intr(s1, 22, 3) | bitnum_intr(s0, 22, 2) | bitnum_intr(s1, 30, 1) | bitnum_intr(s0, 30, 0)) & 255;
        out[1] = (bitnum_intr(s1, 5, 7) | bitnum_intr(s0, 5, 6) | bitnum_intr(s1, 13, 5) | bitnum_intr(s0, 13, 4) | bitnum_intr(s1, 21, 3) | bitnum_intr(s0, 21, 2) | bitnum_intr(s1, 29, 1) | bitnum_intr(s0, 29, 0)) & 255;
        out[0] = (bitnum_intr(s1, 4, 7) | bitnum_intr(s0, 4, 6) | bitnum_intr(s1, 12, 5) | bitnum_intr(s0, 12, 4) | bitnum_intr(s1, 20, 3) | bitnum_intr(s0, 20, 2) | bitnum_intr(s1, 28, 1) | bitnum_intr(s0, 28, 0)) & 255;
        out[7] = (bitnum_intr(s1, 3, 7) | bitnum_intr(s0, 3, 6) | bitnum_intr(s1, 11, 5) | bitnum_intr(s0, 11, 4) | bitnum_intr(s1, 19, 3) | bitnum_intr(s0, 19, 2) | bitnum_intr(s1, 27, 1) | bitnum_intr(s0, 27, 0)) & 255;
        out[6] = (bitnum_intr(s1, 2, 7) | bitnum_intr(s0, 2, 6) | bitnum_intr(s1, 10, 5) | bitnum_intr(s0, 10, 4) | bitnum_intr(s1, 18, 3) | bitnum_intr(s0, 18, 2) | bitnum_intr(s1, 26, 1) | bitnum_intr(s0, 26, 0)) & 255;
        out[5] = (bitnum_intr(s1, 1, 7) | bitnum_intr(s0, 1, 6) | bitnum_intr(s1, 9, 5) | bitnum_intr(s0, 9, 4) | bitnum_intr(s1, 17, 3) | bitnum_intr(s0, 17, 2) | bitnum_intr(s1, 25, 1) | bitnum_intr(s0, 25, 0)) & 255;
        out[4] = (bitnum_intr(s1, 0, 7) | bitnum_intr(s0, 0, 6) | bitnum_intr(s1, 8, 5) | bitnum_intr(s0, 8, 4) | bitnum_intr(s1, 16, 3) | bitnum_intr(s0, 16, 2) | bitnum_intr(s1, 24, 1) | bitnum_intr(s0, 24, 0)) & 255;
      };
      des_f = (state, key) => {
        const t1 = (bitnum_intl(state, 31, 0) | (state & 4026531840) >>> 0 >>> 1 | bitnum_intl(state, 4, 5) | bitnum_intl(state, 3, 6) | (state & 251658240) >>> 0 >>> 3 | bitnum_intl(state, 8, 11) | bitnum_intl(state, 7, 12) | (state & 15728640) >>> 0 >>> 5 | bitnum_intl(state, 12, 17) | bitnum_intl(state, 11, 18) | (state & 983040) >>> 0 >>> 7 | bitnum_intl(state, 16, 23)) >>> 0;
        const t2 = (bitnum_intl(state, 15, 0) | (state & 61440) << 15 >>> 0 | bitnum_intl(state, 20, 5) | bitnum_intl(state, 19, 6) | (state & 3840) << 13 >>> 0 | bitnum_intl(state, 24, 11) | bitnum_intl(state, 23, 12) | (state & 240) << 11 >>> 0 | bitnum_intl(state, 28, 17) | bitnum_intl(state, 27, 18) | (state & 15) << 9 >>> 0 | bitnum_intl(state, 0, 23)) >>> 0;
        const lrgstate = [
          t1 >>> 24 & 255,
          t1 >>> 16 & 255,
          t1 >>> 8 & 255,
          t2 >>> 24 & 255,
          t2 >>> 16 & 255,
          t2 >>> 8 & 255
        ];
        for (let i = 0; i < 6; i++) lrgstate[i] ^= key[i];
        let s = (sbox[0][sbox_bit(lrgstate[0] >>> 2)] << 28 | sbox[1][sbox_bit((lrgstate[0] & 3) << 4 | lrgstate[1] >>> 4)] << 24 | sbox[2][sbox_bit((lrgstate[1] & 15) << 2 | lrgstate[2] >>> 6)] << 20 | sbox[3][sbox_bit(lrgstate[2] & 63)] << 16 | sbox[4][sbox_bit(lrgstate[3] >>> 2)] << 12 | sbox[5][sbox_bit((lrgstate[3] & 3) << 4 | lrgstate[4] >>> 4)] << 8 | sbox[6][sbox_bit((lrgstate[4] & 15) << 2 | lrgstate[5] >>> 6)] << 4 | sbox[7][sbox_bit(lrgstate[5] & 63)]) >>> 0;
        return (bitnum_intl(s, 15, 0) | bitnum_intl(s, 6, 1) | bitnum_intl(s, 19, 2) | bitnum_intl(s, 20, 3) | bitnum_intl(s, 28, 4) | bitnum_intl(s, 11, 5) | bitnum_intl(s, 27, 6) | bitnum_intl(s, 16, 7) | bitnum_intl(s, 0, 8) | bitnum_intl(s, 14, 9) | bitnum_intl(s, 22, 10) | bitnum_intl(s, 25, 11) | bitnum_intl(s, 4, 12) | bitnum_intl(s, 17, 13) | bitnum_intl(s, 30, 14) | bitnum_intl(s, 9, 15) | bitnum_intl(s, 1, 16) | bitnum_intl(s, 7, 17) | bitnum_intl(s, 23, 18) | bitnum_intl(s, 13, 19) | bitnum_intl(s, 31, 20) | bitnum_intl(s, 26, 21) | bitnum_intl(s, 2, 22) | bitnum_intl(s, 8, 23) | bitnum_intl(s, 18, 24) | bitnum_intl(s, 12, 25) | bitnum_intl(s, 29, 26) | bitnum_intl(s, 5, 27) | bitnum_intl(s, 21, 28) | bitnum_intl(s, 10, 29) | bitnum_intl(s, 3, 30) | bitnum_intl(s, 24, 31)) >>> 0;
      };
      des_crypt = (input, schedule, output) => {
        let [s0, s1] = initial_permutation(input);
        for (let i = 0; i < 15; i++) {
          const prev = s1;
          s1 = (des_f(s1, schedule[i]) ^ s0) >>> 0;
          s0 = prev;
        }
        s0 = (des_f(s1, schedule[15]) ^ s0) >>> 0;
        inverse_permutation(s0, s1, output);
      };
      key_schedule = (key, mode) => {
        const schedule = Array.from({ length: 16 }, () => new Uint8Array(6));
        let c = 0;
        let d = 0;
        for (let i = 0; i < 28; i++) {
          c = (c | bitnum(key, key_perm_c[i], 31 - i)) >>> 0;
          d = (d | bitnum(key, key_perm_d[i], 31 - i)) >>> 0;
        }
        for (let i = 0; i < 16; i++) {
          c = ((c << key_rnd_shift[i] >>> 0 | c >>> 28 - key_rnd_shift[i]) & 4294967280) >>> 0;
          d = ((d << key_rnd_shift[i] >>> 0 | d >>> 28 - key_rnd_shift[i]) & 4294967280) >>> 0;
          const togen = mode === DES_DECRYPT ? 15 - i : i;
          for (let j = 0; j < 24; j++) {
            schedule[togen][j / 8 | 0] |= bitnum_intr(c, key_compression[j], 7 - j % 8);
          }
          for (let j = 24; j < 48; j++) {
            schedule[togen][j / 8 | 0] |= bitnum_intr(d, key_compression[j] - 27, 7 - j % 8);
          }
        }
        return schedule;
      };
      tripledes_key_setup = (key, mode) => {
        if (mode === DES_ENCRYPT) {
          return [
            key_schedule(key.subarray(0, 8), DES_ENCRYPT),
            key_schedule(key.subarray(8, 16), DES_DECRYPT),
            key_schedule(key.subarray(16, 24), DES_ENCRYPT)
          ];
        }
        return [
          key_schedule(key.subarray(16, 24), DES_DECRYPT),
          key_schedule(key.subarray(8, 16), DES_ENCRYPT),
          key_schedule(key.subarray(0, 8), DES_DECRYPT)
        ];
      };
      tripledes_crypt = (input, schedule, output) => {
        const buf = new Uint8Array(8);
        des_crypt(input, schedule[0], buf);
        des_crypt(buf, schedule[1], output);
        des_crypt(output, schedule[2], buf);
        output.set(buf);
      };
      QRC_KEY = Buffer2.from([
        33,
        64,
        35,
        41,
        40,
        42,
        36,
        37,
        49,
        50,
        51,
        90,
        88,
        67,
        33,
        64,
        33,
        64,
        35,
        41,
        40,
        78,
        72,
        76
      ]);
      handleInflate2 = (data) => new Promise((resolve, reject) => {
        resolve(inflate2(data, { finishFlush: constants.Z_SYNC_FLUSH }));
      });
      decodeQrc = async (hexData) => {
        if (!hexData || hexData.length % 2 !== 0) return "";
        const encrypted = Buffer2.from(hexData, "hex");
        if (encrypted.length === 0) return "";
        const schedule = tripledes_key_setup(QRC_KEY, DES_DECRYPT);
        const block = new Uint8Array(8);
        for (let i = 0; i + 8 <= encrypted.length; i += 8) {
          tripledes_crypt(encrypted.subarray(i, i + 8), schedule, block);
          encrypted.set(block, i);
        }
        try {
          const result = await handleInflate2(encrypted);
          return Buffer2.from(result).toString("utf-8");
        } catch {
          return "";
        }
      };
    }
  });

  // src/musicSdk/tx/lyric.js
  var songIdMap, promises, decodeLyric3, parseTools, lyric_default3;
  var init_lyric3 = __esm({
    "src/musicSdk/tx/lyric.js"() {
      "use strict";
      init_request();
      init_musicInfo();
      init_qrcDecode();
      songIdMap = /* @__PURE__ */ new Map();
      promises = /* @__PURE__ */ new Map();
      decodeLyric3 = async (lrc, tlrc, rlrc) => ({
        lyric: await decodeQrc(lrc),
        tlyric: await decodeQrc(tlrc),
        rlyric: await decodeQrc(rlrc)
      });
      parseTools = {
        rxps: {
          info: /^{"/,
          lineTime: /^\[(\d+),\d+\]/,
          lineTime2: /^\[([\d:.]+)\]/,
          wordTime: /\(\d+,\d+\)/,
          wordTimeAll: /(\(\d+,\d+\))/g,
          timeLabelFixRxp: /(?:\.0+|0+)$/
        },
        msFormat(timeMs) {
          if (Number.isNaN(timeMs)) return "";
          let ms = timeMs % 1e3;
          timeMs /= 1e3;
          let m = parseInt(timeMs / 60).toString().padStart(2, "0");
          timeMs %= 60;
          let s = parseInt(timeMs).toString().padStart(2, "0");
          return `[${m}:${s}.${String(ms).padStart(3, "0")}]`;
        },
        parseLyric(lrc) {
          lrc = lrc.trim();
          lrc = lrc.replace(/\r/g, "");
          if (!lrc) return { lyric: "", lxlyric: "" };
          const lines = lrc.split("\n");
          const lxlrcLines = [];
          const lrcLines = [];
          for (let line of lines) {
            line = line.trim();
            let result = this.rxps.lineTime.exec(line);
            if (!result) {
              if (line.startsWith("[offset")) {
                lxlrcLines.push(line);
                lrcLines.push(line);
              }
              if (this.rxps.lineTime2.test(line)) {
                lrcLines.push(line);
              }
              continue;
            }
            const startMsTime = parseInt(result[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;
            let words = line.replace(this.rxps.lineTime, "");
            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, "")}`);
            let times = words.match(this.rxps.wordTimeAll);
            if (!times) continue;
            times = times.map((time) => {
              const result2 = /\((\d+),(\d+)\)/.exec(time);
              return `<${Math.max(parseInt(result2[1]) - startMsTime, 0)},${result2[2]}>`;
            });
            const wordArr = words.split(this.rxps.wordTime);
            const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join("");
            lxlrcLines.push(`${startTimeStr}${newWords}`);
          }
          return {
            lyric: lrcLines.join("\n"),
            lxlyric: lxlrcLines.join("\n")
          };
        },
        parseRlyric(lrc) {
          lrc = lrc.trim();
          lrc = lrc.replace(/\r/g, "");
          if (!lrc) return { lyric: "", lxlyric: "" };
          const lines = lrc.split("\n");
          const lrcLines = [];
          for (let line of lines) {
            line = line.trim();
            let result = this.rxps.lineTime.exec(line);
            if (!result) continue;
            const startMsTime = parseInt(result[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;
            let words = line.replace(this.rxps.lineTime, "");
            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, "")}`);
          }
          return lrcLines.join("\n");
        },
        removeTag(str) {
          return str.replace(/^[\S\s]*?LyricContent="/, "").replace(/"\/>[\S\s]*?$/, "");
        },
        getIntv(interval) {
          if (!interval) return 0;
          if (!interval.includes(".")) interval += ".0";
          let arr = interval.split(/:|\./);
          while (arr.length < 3) arr.unshift("0");
          const [m, s, ms] = arr;
          return parseInt(m) * 36e5 + parseInt(s) * 1e3 + parseInt(ms);
        },
        fixRlrcTimeTag(rlrc, lrc) {
          const rlrcLines = rlrc.split("\n");
          let lrcLines = lrc.split("\n");
          let newLrc = [];
          rlrcLines.forEach((line) => {
            const result = this.rxps.lineTime2.exec(line);
            if (!result) return;
            const words = line.replace(this.rxps.lineTime2, "");
            if (!words.trim()) return;
            const t1 = this.getIntv(result[1]);
            while (lrcLines.length) {
              const lrcLine = lrcLines.shift();
              const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
              if (!lrcLineResult) continue;
              const t2 = this.getIntv(lrcLineResult[1]);
              if (Math.abs(t1 - t2) < 100) {
                newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]));
                break;
              }
            }
          });
          return newLrc.join("\n");
        },
        fixTlrcTimeTag(tlrc, lrc) {
          const tlrcLines = tlrc.split("\n");
          let lrcLines = lrc.split("\n");
          let newLrc = [];
          tlrcLines.forEach((line) => {
            const result = this.rxps.lineTime2.exec(line);
            if (!result) return;
            const words = line.replace(this.rxps.lineTime2, "");
            if (!words.trim()) return;
            let time = result[1];
            if (time.includes(".")) {
              time += "".padStart(3 - time.split(".")[1].length, "0");
            }
            const t1 = this.getIntv(time);
            while (lrcLines.length) {
              const lrcLine = lrcLines.shift();
              const lrcLineResult = this.rxps.lineTime2.exec(lrcLine);
              if (!lrcLineResult) continue;
              const t2 = this.getIntv(lrcLineResult[1]);
              if (Math.abs(t1 - t2) < 100) {
                newLrc.push(line.replace(this.rxps.lineTime2, lrcLineResult[0]));
                break;
              }
            }
          });
          return newLrc.join("\n");
        },
        parse(lrc, tlrc, rlrc) {
          const info = {
            lyric: "",
            tlyric: "",
            rlyric: "",
            lxlyric: ""
          };
          if (lrc) {
            let { lyric, lxlyric } = this.parseLyric(this.removeTag(lrc));
            info.lyric = lyric;
            info.lxlyric = lxlyric;
          }
          if (rlrc) info.rlyric = this.fixRlrcTimeTag(this.parseRlyric(this.removeTag(rlrc)), info.lyric);
          if (tlrc) info.tlyric = this.fixTlrcTimeTag(tlrc, info.lyric);
          return info;
        }
      };
      lyric_default3 = {
        successCode: 0,
        async getSongId({ songId, songmid }) {
          if (songId) return songId;
          if (songIdMap.has(songmid)) return songIdMap.get(songmid);
          if (promises.has(songmid)) return (await promises.get(songmid)).songId;
          const promise = musicInfo_default(songmid);
          promises.set(promise);
          const info = await promise;
          songIdMap.set(songmid, info.songId);
          promises.delete(songmid);
          return info.songId;
        },
        async parseLyric(lrc, tlrc, rlrc) {
          const { lyric, tlyric, rlyric } = await decodeLyric3(lrc, tlrc, rlrc);
          return parseTools.parse(lyric, tlyric, rlyric);
        },
        getLyric(mInfo, retryNum = 0) {
          if (retryNum > 3) return Promise.reject(new Error("Get lyric failed"));
          return {
            cancelHttp() {
            },
            promise: this.getSongId(mInfo).then((songId) => {
              const requestObj = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
                method: "post",
                headers: {
                  referer: "https://y.qq.com",
                  "user-agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36"
                },
                body: {
                  comm: {
                    ct: "19",
                    cv: "1859",
                    uin: "0"
                  },
                  req: {
                    method: "GetPlayLyricInfo",
                    module: "music.musichallSong.PlayLyricInfo",
                    param: {
                      format: "json",
                      crypt: 1,
                      ct: 19,
                      cv: 1873,
                      interval: 0,
                      lrc_t: 0,
                      qrc: 1,
                      qrc_t: 0,
                      roma: 1,
                      roma_t: 0,
                      songID: songId,
                      trans: 1,
                      trans_t: 0,
                      type: -1
                    }
                  }
                }
              });
              return requestObj.promise.then(({ body }) => {
                if (body.code != this.successCode || body.req.code != this.successCode) return this.getLyric(songId, ++retryNum);
                const data = body.req.data;
                return this.parseLyric(data.lyric, data.trans, data.roma);
              });
            })
          };
        }
      };
    }
  });

  // src/musicSdk/tx/songList.js
  var songList_default3;
  var init_songList3 = __esm({
    "src/musicSdk/tx/songList.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_utils();
      songList_default3 = {
        _requestObj_tags: null,
        _requestObj_hotTags: null,
        _requestObj_list: null,
        limit_list: 36,
        limit_song: 1e5,
        successCode: 0,
        sortList: [
          {
            name: "推荐",
            tid: "recommend",
            id: "-1"
          },
          {
            name: "最热",
            tid: "hot",
            id: "3"
          },
          {
            name: "最新",
            tid: "new",
            id: "2"
          }
        ],
        regExps: {
          hotTagHtml: /class="c_bg_link js_tag_item" data-id="\w+">.+?<\/a>/g,
          hotTag: /data-id="(\w+)">(.+?)<\/a>/,
          // https://y.qq.com/n/yqq/playlist/7217720898.html
          // https://i.y.qq.com/n2/m/share/details/taoge.html?platform=11&appshare=android_qq&appversion=9050006&id=7217720898&ADTAG=qfshare
          listDetailLink: /\/playlist\/(\d+)/,
          listDetailLink2: /id=(\d+)/
        },
        tagsUrl: "https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=%7B%22tags%22%3A%7B%22method%22%3A%22get_all_categories%22%2C%22param%22%3A%7B%22qq%22%3A%22%22%7D%2C%22module%22%3A%22playlist.PlaylistAllCategoriesServer%22%7D%7D",
        hotTagUrl: "https://c.y.qq.com/node/pc/wk_v15/category_playlist.html",
        getListUrl(id, page) {
          id = parseInt(id);
          return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify({
            comm: { cv: 1602, ct: 20 },
            playlist: {
              method: "get_category_content",
              param: {
                titleid: id,
                caller: "0",
                category_id: id,
                size: this.limit_list,
                page: page - 1,
                use_page: 1
              },
              module: "playlist.PlayListCategoryServer"
            }
          }))}`;
        },
        getListDetailUrl(id) {
          return `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`;
        },
        // http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=2849349915&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1
        // 获取标签
        getTag(tryNum = 0) {
          if (this._requestObj_tags) this._requestObj_tags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_tags = httpFetch(this.tagsUrl);
          return this._requestObj_tags.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getTag(++tryNum);
            return this.filterTagInfo(body.tags.data.v_group);
          });
        },
        // 获取标签
        getHotTag(tryNum = 0) {
          if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_hotTags = httpFetch(this.hotTagUrl);
          return this._requestObj_hotTags.promise.then(({ statusCode, body }) => {
            if (statusCode !== 200) return this.getHotTag(++tryNum);
            return this.filterInfoHotTag(body);
          });
        },
        filterInfoHotTag(html) {
          let hotTag = html.match(this.regExps.hotTagHtml);
          const hotTags = [];
          if (!hotTag) return hotTags;
          hotTag.forEach((tagHtml) => {
            let result = tagHtml.match(this.regExps.hotTag);
            if (!result) return;
            hotTags.push({
              id: parseInt(result[1]),
              name: result[2],
              source: "tx"
            });
          });
          return hotTags;
        },
        filterTagInfo(rawList) {
          return rawList.map((type) => ({
            name: type.group_name,
            list: type.v_item.map((item) => ({
              parent_id: type.group_id,
              parent_name: type.group_name,
              id: item.id,
              name: item.name,
              source: "tx"
            }))
          }));
        },
        async getRecommendList(page) {
          const { body } = await httpFetch(
            `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(
              JSON.stringify({
                comm: { cv: 1602, ct: 20 },
                playlist: {
                  module: "music.playlist.PlaylistSquare",
                  method: "GetRecommendWhole",
                  param: {
                    IsReqFeed: true,
                    FeedReq: {
                      From: (page - 1) * this.limit_list,
                      Size: this.limit_list
                    }
                  }
                }
              })
            )}`
          ).promise;
          if (body.code !== this.successCode) throw new Error("tx getRecommendList failed");
          return {
            list: body.playlist.data.FeedRsp.List?.map(({ Playlist }) => ({
              play_count: formatPlayCount(Playlist.basic.play_cnt),
              id: String(Playlist.basic.tid),
              author: decodeName(Playlist.basic.creator.nick),
              name: decodeName(Playlist.basic.title),
              time: Playlist.basic.modify_time ? dateFormat(Playlist.basic.modify_time * 1e3, "Y-M-D") : "",
              img: Playlist.basic.cover.medium_url || Playlist.basic.cover.default_url,
              total: Playlist.basic.song_cnt,
              desc: decodeName(Playlist.basic.desc).replace(/<br>/g, "\n"),
              source: "tx"
            })) || [],
            total: body.playlist.data.FeedRsp.FromLimit,
            limit: this.limit_list,
            page,
            source: "tx"
          };
        },
        // 获取列表数据
        getList(sortId, tagId, page, tryNum = 0) {
          if (this._requestObj_list) this._requestObj_list.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          if (!tagId) {
            if (!tagId && sortId == -1) return this.getRecommendList(page);
            tagId = sortId;
          }
          this._requestObj_list = httpFetch(
            this.getListUrl(tagId, page)
          );
          return this._requestObj_list.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getList(sortId, tagId, page, ++tryNum);
            return this.filterList(body.playlist.data, page);
          });
        },
        // filterList(data, page) {
        //   return {
        //     list: data.v_playlist.map(item => ({
        //       play_count: formatPlayCount(item.access_num),
        //       id: String(item.tid),
        //       author: item.creator_info.nick,
        //       name: item.title,
        //       time: item.modify_time ? dateFormat(item.modify_time * 1000, 'Y-M-D') : '',
        //       img: item.cover_url_medium,
        //       // grade: item.favorcnt / 10,
        //       total: item.song_ids?.length,
        //       desc: decodeName(item.desc).replace(/<br>/g, '\n'),
        //       source: 'tx',
        //     })),
        //     total: data.total,
        //     page,
        //     limit: this.limit_list,
        //     source: 'tx',
        //   }
        // },
        filterList({ content }, page) {
          return {
            list: content.v_item.map(({ basic }) => ({
              play_count: formatPlayCount(basic.play_cnt),
              id: String(basic.tid),
              author: basic.creator.nick,
              name: basic.title,
              // time: basic.publish_time,
              img: basic.cover.medium_url || basic.cover.default_url,
              // grade: basic.favorcnt / 10,
              desc: decodeName(basic.desc).replace(/<br>/g, "\n"),
              source: "tx"
            })),
            total: content.total_cnt,
            page,
            limit: this.limit_list,
            source: "tx"
          };
        },
        async handleParseId(link, retryNum = 0) {
          if (retryNum > 2) return Promise.reject(new Error("link try max num"));
          const requestObj_listDetailLink = httpFetch(link);
          const { url, statusCode } = await requestObj_listDetailLink.promise;
          if (statusCode > 400) return this.handleParseId(link, ++retryNum);
          return url;
        },
        async getListId(id) {
          if (/[?&:/]/.test(id)) {
            if (!this.regExps.listDetailLink.test(id)) {
              id = await this.handleParseId(id);
            }
            let result = this.regExps.listDetailLink.exec(id);
            if (!result) {
              result = this.regExps.listDetailLink2.exec(id);
              if (!result) throw new Error("failed");
            }
            id = result[1];
          }
          return id;
        },
        // 获取歌曲列表内的音乐
        async getListDetail2(id, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj_listDetail = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            method: "post",
            headers: {
              Origin: "https://y.qq.com",
              Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html`
            },
            body: {
              comm: {
                cv: 4747474,
                ct: 24,
                format: "json",
                inCharset: "utf-8",
                outCharset: "utf-8",
                platform: "yqq.json",
                needNewCode: 1,
                uin: 0
              },
              req_1: {
                module: "music.srfDissInfo.aiDissInfo",
                method: "uniform_get_Dissinfo",
                param: {
                  disstid: parseInt(id),
                  userinfo: 1,
                  tag: 1,
                  orderlist: 1,
                  song_begin: 0,
                  song_num: this.limit_song,
                  onlysonglist: 0,
                  enc_host_uin: ""
                }
              }
            }
          });
          const { body } = await requestObj_listDetail.promise;
          if (body.code !== this.successCode) return this.getListDetail2(id, ++tryNum);
          if (body.req_1.code !== this.successCode) throw new Error("failed");
          const result = body.req_1.data;
          const dirinfo = result.dirinfo;
          return {
            list: this.filterListDetail(result.songlist),
            page: 1,
            limit: this.limit_song,
            total: result.total_song_num,
            source: "tx",
            info: {
              name: dirinfo.title,
              img: dirinfo.picurl,
              desc: decodeName(dirinfo.desc ?? "").replace(/<br>/g, "\n"),
              author: dirinfo.host_nick,
              play_count: formatPlayCount(dirinfo.listennum)
            }
          };
        },
        // 获取歌曲列表内的音乐
        async getListDetail(id, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          id = await this.getListId(id);
          const requestObj_listDetail = httpFetch(this.getListDetailUrl(id), {
            headers: {
              Origin: "https://y.qq.com",
              Referer: `https://y.qq.com/n/yqq/playsquare/${id}.html`
            }
          });
          const { body } = await requestObj_listDetail.promise;
          if (body.code !== this.successCode) return this.getListDetail(id, ++tryNum);
          if (body.subcode !== this.successCode || !body.cdlist) return this.getListDetail2(id);
          const cdlist = body.cdlist[0];
          return {
            list: this.filterListDetail(cdlist.songlist),
            page: 1,
            limit: cdlist.songlist.length + 1,
            total: cdlist.songlist.length,
            source: "tx",
            info: {
              name: cdlist.dissname,
              img: cdlist.logo,
              desc: decodeName(cdlist.desc).replace(/<br>/g, "\n"),
              author: cdlist.nickname,
              play_count: formatPlayCount(cdlist.visitnum)
            }
          };
        },
        filterListDetail(rawList) {
          return rawList.map((item) => {
            let types = [];
            let _types = {};
            if (item.file.size_128mp3 !== 0) {
              let size = sizeFormate(item.file.size_128mp3);
              types.push({ type: "128k", size });
              _types["128k"] = {
                size
              };
            }
            if (item.file.size_320mp3 !== 0) {
              let size = sizeFormate(item.file.size_320mp3);
              types.push({ type: "320k", size });
              _types["320k"] = {
                size
              };
            }
            if (item.file.size_flac !== 0) {
              let size = sizeFormate(item.file.size_flac);
              types.push({ type: "flac", size });
              _types.flac = {
                size
              };
            }
            if (item.file.size_hires !== 0) {
              let size = sizeFormate(item.file.size_hires);
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            return {
              singer: formatSingerName(item.singer, "name"),
              name: item.title,
              albumName: item.album.name,
              albumId: item.album.mid,
              source: "tx",
              interval: formatPlayTime(item.interval),
              songId: item.id,
              albumMid: item.album.mid,
              strMediaMid: item.file.media_mid,
              songmid: item.mid,
              img: item.album.name === "" || item.album.name === "空" ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : "" : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
              lrc: null,
              otherSource: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        getTags() {
          return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: "tx" }));
        },
        async getDetailPageUrl(id) {
          id = await this.getListId(id);
          return `https://y.qq.com/n/ryqq/playlist/${id}`;
        },
        search(text, page, limit = 20, retryNum = 0) {
          if (retryNum > 5) throw new Error("max retry");
          return httpFetch(`http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page - 1}&num_per_page=${limit}&format=json&query=${encodeURIComponent(text)}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)",
              Referer: "http://y.qq.com/portal/search.html"
            }
          }).promise.then(({ body }) => {
            if (body.code != 0) return this.search(text, page, limit, ++retryNum);
            return {
              list: body.data.list.map((item) => {
                return {
                  play_count: formatPlayCount(item.listennum),
                  id: String(item.dissid),
                  author: decodeName(item.creator.name),
                  name: decodeName(item.dissname),
                  time: dateFormat(item.createtime, "Y-M-D"),
                  img: item.imgurl,
                  // grade: item.favorcnt / 10,
                  total: item.song_count,
                  desc: decodeName(decodeName(item.introduction)).replace(/<br>/g, "\n"),
                  source: "tx"
                };
              }),
              limit,
              total: body.data.sum,
              source: "tx"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/tx/utils/crypto.js
  function pickHashByIdx(hash, indexes) {
    return indexes.map((idx) => hash[idx]).join("");
  }
  function base64Encode(data) {
    return Buffer2.from(data).toString("base64").replace(/[\\/+=]/g, "");
  }
  async function zzcSign(text) {
    const hash = await hashSHA1(text);
    const part1 = pickHashByIdx(hash, PART_1_INDEXES);
    const part2 = pickHashByIdx(hash, PART_2_INDEXES);
    const part3 = SCRAMBLE_VALUES.map((value, i) => value ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
    const b64Part = base64Encode(part3).replace(/[\\/+=]/g, "");
    return `zzc${part1}${b64Part}${part2}`.toLowerCase();
  }
  var PART_1_INDEXES, PART_2_INDEXES, SCRAMBLE_VALUES;
  var init_crypto2 = __esm({
    "src/musicSdk/tx/utils/crypto.js"() {
      "use strict";
      init_buffer();
      init_crypto();
      PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
      PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
      SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
    }
  });

  // src/musicSdk/tx/utils/index.js
  var signRequest;
  var init_utils2 = __esm({
    "src/musicSdk/tx/utils/index.js"() {
      "use strict";
      init_request();
      init_crypto2();
      signRequest = async (data) => {
        const sign = await zzcSign(JSON.stringify(data));
        return httpFetch(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, {
          method: "post",
          headers: {
            "User-Agent": "QQMusic 14090508(android 12)"
          },
          body: data
        }).promise;
      };
    }
  });

  // src/musicSdk/tx/musicSearch.js
  var musicSearch_default3;
  var init_musicSearch3 = __esm({
    "src/musicSdk/tx/musicSearch.js"() {
      "use strict";
      init_utils_index();
      init_utils();
      init_utils2();
      musicSearch_default3 = {
        limit: 50,
        total: 0,
        page: 0,
        allPage: 1,
        successCode: 0,
        musicSearch(str, page, limit, retryNum = 0) {
          if (retryNum > 5) return Promise.reject(new Error("搜索失败"));
          // 2026-10 匿名搜索新线：musicu.fcg 裸 POST（无需 zzc 签名）+ DoSearchForQQMusicMobile +
          // android comm（旧 musics.fcg+zzc 签名+Desktop 形态被上游全量拒绝；经 L-1124/QQMusicApi 实弹验证）。
          // 响应容器归一化：Mobile 的 body.item_song → Desktop 语义 body.song.list / meta.sum（search() 零改动）
          const hexGuid32 = () => { let s = ""; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; };
          const d0 = new Date();
          const p2 = (n, w) => String(n).padStart(w, "0");
          const sid = `${d0.getFullYear()}${p2(d0.getMonth() + 1, 2)}${p2(d0.getDate(), 2)}${p2(d0.getHours(), 2)}${p2(d0.getMinutes(), 2)}${p2(d0.getSeconds(), 2)}`;
          const searchid = String(BigInt(1 + Math.floor(Math.random() * 20)) * 18014398509481984n + BigInt(Math.floor(Math.random() * 4194305)) * 4294967296n + BigInt(Date.now() % 864e5));
          const searchRequest = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            method: "post",
            headers: {
              "User-Agent": "QQMusic 20090008(android 16)"
            },
            body: {
              comm: {
                ct: "11",
                cv: "20090008",
                v: "20090008",
                tmeAppID: "qqmusic",
                chid: "10003505",
                QIMEI36: "a4b97890df4ce85af6ea4dd810001f01aa16",
                traceid: "10002_" + hexGuid32() + "_" + Date.now(),
                OpenUDID: hexGuid32(),
                OpenUDID2: hexGuid32(),
                udid: hexGuid32(),
                aid: "fec4f3bb7357533c",
                uid: "6822670964",
                sid,
                os_ver: "16",
                phonetype: "24129PN74C"
              },
              "music.search.SearchCgiService": {
                module: "music.search.SearchCgiService",
                method: "DoSearchForQQMusicMobile",
                param: {
                  searchid,
                  query: str,
                  search_type: 0,
                  num_per_page: limit,
                  page_num: page,
                  highlight: 1,
                  grp: 1,
                  selectors: {},
                  vec_selectors: []
                }
              }
            }
          });
          return searchRequest.promise.then(({ body }) => {
            const req = body?.["music.search.SearchCgiService"] ?? body?.req;
            if (!req || body.code != this.successCode || req.code != this.successCode) {
              return this.musicSearch(str, page, limit, ++retryNum);
            }
            const d = req.data || {};
            const songs = d.body && d.body.item_song || [];
            const total = (d.meta && (d.meta.sum ?? d.meta.estimate_sum)) || songs.length;
            return { body: { song: { list: songs, total_num: total } }, meta: { sum: total } };
          });
        },
        /**
         * PC 客户端版 searchid：32 位大写十六进制 GUID + 5 位补零随机数 = 37 字符。
         * 对应 QQ 音乐 PC 端 searchid 形状（服务端只需要唯一的会话 ID，形状一致即可）。
         */
        getSearchId() {
          let guid = "";
          for (let i = 0; i < 32; i++) guid += Math.floor(Math.random() * 16).toString(16);
          return guid.toUpperCase() + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
        },
        handleResult(rawList) {
          if (!rawList || !Array.isArray(rawList)) return [];
          const list = [];
          rawList.forEach((item) => {
            if (!item.file?.media_mid) return;
            let types = [];
            let _types = {};
            const file = item.file;
            if (file.size_128mp3 != 0) {
              let size = sizeFormate(file.size_128mp3);
              types.push({ type: "128k", size });
              _types["128k"] = {
                size
              };
            }
            if (file.size_320mp3 !== 0) {
              let size = sizeFormate(file.size_320mp3);
              types.push({ type: "320k", size });
              _types["320k"] = {
                size
              };
            }
            if (file.size_flac !== 0) {
              let size = sizeFormate(file.size_flac);
              types.push({ type: "flac", size });
              _types.flac = {
                size
              };
            }
            if (file.size_hires !== 0) {
              let size = sizeFormate(file.size_hires);
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            let albumId = "";
            let albumName = "";
            if (item.album) {
              albumName = item.album.name;
              albumId = item.album.mid;
            }
            list.push({
              singer: formatSingerName(item.singer, "name"),
              // name: item.name + (item.title_extra ?? ''),
              name: item.title,
              albumName,
              albumId,
              source: "tx",
              interval: item.interval ? formatPlayTime(item.interval) : null,
              songId: item.id,
              albumMid: item.album?.mid ?? "",
              strMediaMid: item.file.media_mid,
              songmid: item.mid,
              img: albumId === "" || albumId === "空" ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : "" : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
              types,
              _types,
              typeUrl: {}
            });
          });
          return list;
        },
        search(str, page = 1, limit) {
          if (limit == null) limit = this.limit;
          return this.musicSearch(str, page, limit).then(({ body, meta }) => {
            let list = this.handleResult(body.song.list);
            this.total = meta.sum;
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return Promise.resolve({
              list,
              allPage: this.allPage,
              limit,
              total: this.total,
              source: "tx"
            });
          });
        }
      };
    }
  });

  // src/musicSdk/tx/hotSearch.js
  var hotSearch_default3;
  var init_hotSearch3 = __esm({
    "src/musicSdk/tx/hotSearch.js"() {
      "use strict";
      init_request();
      hotSearch_default3 = {
        _requestObj: null,
        async getList(retryNum = 0) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const _requestObj = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            method: "post",
            body: {
              comm: {
                ct: "19",
                cv: "1803",
                guid: "0",
                patch: "118",
                psrf_access_token_expiresAt: 0,
                psrf_qqaccess_token: "",
                psrf_qqopenid: "",
                psrf_qqunionid: "",
                tmeAppID: "qqmusic",
                tmeLoginType: 0,
                uin: "0",
                wid: "0"
              },
              hotkey: {
                method: "GetHotkeyForQQMusicPC",
                module: "tencent_musicsoso_hotkey.HotkeyService",
                param: {
                  search_id: "",
                  uin: 0
                }
              }
            },
            headers: {
              Referer: "https://y.qq.com/portal/player.html"
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== 0) throw new Error("获取热搜词失败");
          return { source: "tx", list: this.filterList(body.hotkey.data.vec_hotkey) };
        },
        filterList(rawList) {
          return rawList.map((item) => item.query);
        }
      };
    }
  });

  // src/musicSdk/tx/comment.js
  var emojis, songIdMap2, promises2, comment_default3;
  var init_comment3 = __esm({
    "src/musicSdk/tx/comment.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_musicInfo();
      emojis = {
        e400846: "😘",
        e400874: "😴",
        e400825: "😃",
        e400847: "😙",
        e400835: "😍",
        e400873: "😳",
        e400836: "😎",
        e400867: "😭",
        e400832: "😊",
        e400837: "😏",
        e400875: "😫",
        e400831: "😉",
        e400855: "😡",
        e400823: "😄",
        e400862: "😨",
        e400844: "😖",
        e400841: "😓",
        e400830: "😈",
        e400828: "😆",
        e400833: "😋",
        e400822: "😀",
        e400843: "😕",
        e400829: "😇",
        e400824: "😂",
        e400834: "😌",
        e400877: "😷",
        e400132: "🍉",
        e400181: "🍺",
        e401067: "☕️",
        e400186: "🥧",
        e400343: "🐷",
        e400116: "🌹",
        e400126: "🍃",
        e400613: "💋",
        e401236: "❤️",
        e400622: "💔",
        e400637: "💣",
        e400643: "💩",
        e400773: "🔪",
        e400102: "🌛",
        e401328: "🌞",
        e400420: "👏",
        e400914: "🙌",
        e400408: "👍",
        e400414: "👎",
        e401121: "✋",
        e400396: "👋",
        e400384: "👉",
        e401115: "✊",
        e400402: "👌",
        e400905: "🙈",
        e400906: "🙉",
        e400907: "🙊",
        e400562: "👻",
        e400932: "🙏",
        e400644: "💪",
        e400611: "💉",
        e400185: "🎁",
        e400655: "💰",
        e400325: "🐥",
        e400612: "💊",
        e400198: "🎉",
        e401685: "⚡️",
        e400631: "💝",
        e400768: "🔥",
        e400432: "👑"
      };
      songIdMap2 = /* @__PURE__ */ new Map();
      promises2 = /* @__PURE__ */ new Map();
      comment_default3 = {
        _requestObj: null,
        _requestObj2: null,
        async getSongId({ songId, songmid }) {
          if (songId) return songId;
          if (songIdMap2.has(songmid)) return songIdMap2.get(songmid);
          if (promises2.has(songmid)) return (await promises2.get(songmid)).songId;
          const promise = musicInfo_default(songmid);
          promises2.set(promise);
          const info = await promise;
          songIdMap2.set(songmid, info.songId);
          promises2.delete(songmid);
          return info.songId;
        },
        async getComment(mInfo, page = 1, limit = 20) {
          if (this._requestObj) this._requestObj.cancelHttp();
          const songId = await this.getSongId(mInfo);
          const _requestObj = httpFetch("http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg", {
            method: "POST",
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
            },
            form: {
              uin: "0",
              format: "json",
              cid: "205360772",
              reqtype: "2",
              biztype: "1",
              topid: songId,
              cmd: "8",
              needmusiccrit: "1",
              pagenum: page - 1,
              pagesize: limit
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== 0) throw new Error("获取评论失败");
          const comment = body.comment;
          return {
            source: "tx",
            comments: this.filterNewComment(comment.commentlist),
            total: comment.commenttotal,
            page,
            limit,
            maxPage: Math.ceil(comment.commenttotal / limit) || 1
          };
        },
        async getHotComment(mInfo, page = 1, limit = 20) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          const songId = await this.getSongId(mInfo);
          const _requestObj2 = httpFetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
            method: "POST",
            body: {
              comm: {
                cv: 4747474,
                ct: 24,
                format: "json",
                inCharset: "utf-8",
                outCharset: "utf-8",
                notice: 0,
                platform: "yqq.json",
                needNewCode: 1,
                uin: 0
              },
              req: {
                module: "music.globalComment.CommentRead",
                method: "GetHotCommentList",
                param: {
                  BizType: 1,
                  BizId: String(songId),
                  LastCommentSeqNo: "",
                  PageSize: limit,
                  PageNum: page - 1,
                  HotType: 1,
                  WithAirborne: 0,
                  PicEnable: 1
                }
              }
            },
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.0.0",
              referer: "https://y.qq.com/",
              origin: "https://y.qq.com"
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.code !== 0 || body.req.code !== 0) throw new Error("获取热门评论失败");
          const comment = body.req.data.CommentList;
          return {
            source: "tx",
            comments: this.filterHotComment(comment.Comments),
            total: comment.Total,
            page,
            limit,
            maxPage: Math.ceil(comment.Total / limit) || 1
          };
        },
        filterNewComment(rawList) {
          return rawList.map((item) => {
            let time = this.formatTime(item.time);
            let timeStr = time ? dateFormat2(time) : null;
            if (item.middlecommentcontent) {
              let firstItem = item.middlecommentcontent[0];
              firstItem.avatarurl = item.avatarurl;
              firstItem.praisenum = item.praisenum;
              item.avatarurl = null;
              item.praisenum = null;
              item.middlecommentcontent.reverse();
            }
            return {
              id: `${item.rootcommentid}_${item.commentid}`,
              rootId: item.rootcommentid,
              text: item.rootcommentcontent ? this.replaceEmoji(item.rootcommentcontent).replace(/\\n/g, "\n") : "",
              time: item.rootcommentid == item.commentid ? time : null,
              timeStr: item.rootcommentid == item.commentid ? timeStr : null,
              userName: item.rootcommentnick ? item.rootcommentnick.substring(1) : "",
              avatar: item.avatarurl,
              userId: item.encrypt_rootcommentuin,
              likedCount: item.praisenum,
              reply: item.middlecommentcontent ? item.middlecommentcontent.map((c) => {
                return {
                  id: `sub_${item.rootcommentid}_${c.subcommentid}`,
                  text: this.replaceEmoji(c.subcommentcontent).replace(/\\n/g, "\n"),
                  time: c.subcommentid == item.commentid ? time : null,
                  timeStr: c.subcommentid == item.commentid ? timeStr : null,
                  userName: c.replynick.substring(1),
                  avatar: c.avatarurl,
                  userId: c.encrypt_replyuin,
                  likedCount: c.praisenum
                };
              }) : []
            };
          });
        },
        filterHotComment(rawList) {
          return rawList.map((item) => {
            return {
              id: `${item.SeqNo}_${item.CmId}`,
              rootId: item.SeqNo,
              text: item.Content ? this.replaceEmoji(item.Content).replace(/\\n/g, "\n") : "",
              time: item.PubTime ? this.formatTime(item.PubTime) : null,
              timeStr: item.PubTime ? dateFormat2(this.formatTime(item.PubTime)) : null,
              userName: item.Nick ?? "",
              images: item.Pic ? [item.Pic] : [],
              avatar: item.Avatar,
              location: item.Location ? item.Location : "",
              userId: item.EncryptUin,
              likedCount: item.PraiseNum,
              reply: item.SubComments ? item.SubComments.map((c) => {
                return {
                  id: `sub_${c.SeqNo}_${c.CmId}`,
                  text: this.replaceEmoji(c.Content).replace(/\\n/g, "\n"),
                  time: c.PubTime ? this.formatTime(c.PubTime) : null,
                  timeStr: c.PubTime ? dateFormat2(this.formatTime(c.PubTime)) : null,
                  userName: c.Nick ?? "",
                  avatar: c.Avatar,
                  images: c.Pic ? [c.Pic] : [],
                  userId: c.EncryptUin,
                  likedCount: c.PraiseNum
                };
              }) : []
            };
          });
        },
        replaceEmoji(msg) {
          let rxp = /^\[em\](e\d+)\[\/em\]$/;
          let result = msg.match(/\[em\]e\d+\[\/em\]/g);
          if (!result) return msg;
          result = Array.from(new Set(result));
          for (let item of result) {
            let code = item.replace(rxp, "$1");
            msg = msg.replace(new RegExp(item.replace("[em]", "\\[em\\]").replace("[/em]", "\\[\\/em\\]"), "g"), emojis[code] || "");
          }
          return msg;
        },
        formatTime(time) {
          return String(time).length < 10 ? null : parseInt(time + "000");
        }
      };
    }
  });

  // src/musicSdk/tx/index.js
  var tx, tx_default;
  var init_tx = __esm({
    "src/musicSdk/tx/index.js"() {
      "use strict";
      init_leaderboard3();
      init_lyric3();
      init_songList3();
      init_musicSearch3();
      init_api_source();
      init_hotSearch3();
      init_comment3();
      tx = {
        // tipSearch,
        leaderboard: leaderboard_default3,
        songList: songList_default3,
        musicSearch: musicSearch_default3,
        hotSearch: hotSearch_default3,
        comment: comment_default3,
        getMusicUrl(songInfo, type) {
          return apis("tx").getMusicUrl(songInfo, type);
        },
        getLyric(songInfo) {
          return lyric_default3.getLyric(songInfo);
        },
        async getPic(songInfo) {
          return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${songInfo.albumId}.jpg`;
        },
        getMusicDetailPageUrl(songInfo) {
          return `https://y.qq.com/n/yqq/song/${songInfo.songmid}.html`;
        }
      };
      tx_default = tx;
    }
  });

  // src/musicSdk/wy/utils/crypto.js
  var iv, presetKey, linuxapiKey, publicKey, eapiKey, aesEncrypt, rsaEncrypt, weapi, eapi;
  var init_crypto3 = __esm({
    "src/musicSdk/wy/utils/crypto.js"() {
      "use strict";
      init_buffer();
      init_buffer();
      init_crypto();
      init_env();
      iv = btoa("0102030405060708");
      presetKey = btoa("0CoJUm6Qyw8W8jud");
      linuxapiKey = btoa("rFgB&h#%2?^eDg:Q");
      publicKey = "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----";
      eapiKey = btoa("e82ckenh8dichen8");
      aesEncrypt = (b64, mode, key, iv2) => {
        return aesEncryptSync(b64, key, iv2, mode);
      };
      rsaEncrypt = (buffer, key) => {
        buffer = Buffer2.concat([Buffer2.alloc(128 - buffer.length), buffer]);
        return Buffer2.from(rsaEncryptSync(buffer.toString("base64"), key, RSA_PADDING.NoPadding), "base64");
      };
      weapi = (object) => {
        const text = JSON.stringify(object);
        const secretKey = String(Math.random()).substring(2, 18);
        return {
          params: aesEncrypt(btoa(aesEncrypt(Buffer2.from(text).toString("base64"), AES_MODE.CBC_128_PKCS7Padding, presetKey, iv)), AES_MODE.CBC_128_PKCS7Padding, btoa(secretKey), iv),
          encSecKey: rsaEncrypt(Buffer2.from(secretKey).reverse(), publicKey).toString("hex")
        };
      };
      eapi = (url, object) => {
        const text = typeof object === "object" ? JSON.stringify(object) : object;
        const message = `nobody${url}use${text}md5forencrypt`;
        const digest = toMD52(message);
        const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
        return {
          params: Buffer2.from(aesEncrypt(Buffer2.from(data).toString("base64"), AES_MODE.ECB_128_NoPadding, eapiKey, ""), "base64").toString("hex").toUpperCase()
        };
      };
    }
  });

  // src/musicSdk/wy/musicDetail.js
  var musicDetail_default;
  var init_musicDetail = __esm({
    "src/musicSdk/wy/musicDetail.js"() {
      "use strict";
      init_request();
      init_utils_index();
      musicDetail_default = {
        getSinger(singers) {
          let arr = [];
          singers?.forEach((singer) => {
            arr.push(singer.name);
          });
          return arr.join("、");
        },
        filterList({ songs, privileges = [] }) {
          const list = [];
          const normalizedSongs = songs.map((item) => ({
            ...item,
            ar: item.ar || item.artists || [],
            al: item.al || item.album || {},
            dt: item.dt ?? item.duration ?? 0,
            hr: item.hr || item.hrMusic,
            sq: item.sq || item.sqMusic,
            h: item.h || item.hMusic,
            m: item.m || item.mMusic,
            l: item.l || item.lMusic
          }));
          const resolvedPrivileges = privileges.length ? privileges : normalizedSongs.map((item) => ({
            id: item.id,
            maxBrLevel: item.hr ? "hires" : "",
            maxbr: item.sq ? 999e3 : item.h ? 32e4 : item.m ? 192e3 : item.l ? 128e3 : 0
          }));
          normalizedSongs.forEach((item, index) => {
            const types = [];
            const _types = {};
            let size;
            let privilege = resolvedPrivileges[index];
            if (privilege.id !== item.id) privilege = resolvedPrivileges.find((p) => p.id === item.id);
            if (!privilege) return;
            if (privilege.maxBrLevel == "hires") {
              size = item.hr ? sizeFormate(item.hr.size) : null;
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            switch (privilege.maxbr) {
              case 999e3:
                size = item.sq ? sizeFormate(item.sq.size) : null;
                types.push({ type: "flac", size });
                _types.flac = {
                  size
                };
              case 32e4:
                size = item.h ? sizeFormate(item.h.size) : null;
                types.push({ type: "320k", size });
                _types["320k"] = {
                  size
                };
              case 192e3:
              case 128e3:
                size = item.l ? sizeFormate(item.l.size) : null;
                types.push({ type: "128k", size });
                _types["128k"] = {
                  size
                };
            }
            types.reverse();
            if (item.pc) {
              list.push({
                singer: item.pc.ar ?? "",
                name: item.pc.sn ?? "",
                albumName: item.pc.alb ?? "",
                albumId: item.al?.id,
                source: "wy",
                interval: formatPlayTime(item.dt / 1e3),
                songmid: item.id,
                img: item.al?.picUrl ?? "",
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {}
              });
            } else {
              list.push({
                singer: this.getSinger(item.ar),
                name: item.name ?? "",
                albumName: item.al?.name,
                albumId: item.al?.id,
                source: "wy",
                interval: formatPlayTime(item.dt / 1e3),
                songmid: item.id,
                img: item.al?.picUrl,
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {}
              });
            }
          });
          return list;
        },
        async getList(ids = [], retryNum = 0) {
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          if (!ids.length) return { source: "wy", list: [] };
          const songs = [];
          const chunkSize = 80;
          for (let start = 0; start < ids.length; start += chunkSize) {
            const chunk = ids.slice(start, start + chunkSize);
            const requestObj = httpFetch(`https://music.163.com/api/song/detail?ids=${encodeURIComponent("[" + chunk.join(",") + "]")}`, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
                Referer: "https://music.163.com/"
              }
            });
            const { body, statusCode } = await requestObj.promise;
            if (statusCode !== 200 || body.code !== 200 || !Array.isArray(body.songs)) return this.getList(ids, ++retryNum);
            songs.push(...body.songs);
          }
          return { source: "wy", list: this.filterList({ songs }) };
        }
      };
    }
  });

  // src/musicSdk/wy/leaderboard.js
  var topList, leaderboard_default4;
  var init_leaderboard4 = __esm({
    "src/musicSdk/wy/leaderboard.js"() {
      "use strict";
      init_crypto3();
      init_request();
      init_utils_index();
      init_musicDetail();
      topList = [
        { id: "wy__19723756", name: "飙升榜", bangid: "19723756" },
        { id: "wy__3779629", name: "新歌榜", bangid: "3779629" },
        { id: "wy__2884035", name: "原创榜", bangid: "2884035" },
        { id: "wy__3778678", name: "热歌榜", bangid: "3778678" },
        { id: "wy__991319590", name: "说唱榜", bangid: "991319590" },
        { id: "wy__71384707", name: "古典榜", bangid: "71384707" },
        { id: "wy__1978921795", name: "电音榜", bangid: "1978921795" },
        { id: "wy__5453912201", name: "黑胶VIP爱听榜", bangid: "5453912201" },
        { id: "wy__71385702", name: "ACG榜", bangid: "71385702" },
        { id: "wy__745956260", name: "韩语榜", bangid: "745956260" },
        { id: "wy__10520166", name: "国电榜", bangid: "10520166" },
        { id: "wy__180106", name: "UK排行榜周榜", bangid: "180106" },
        { id: "wy__60198", name: "美国Billboard榜", bangid: "60198" },
        { id: "wy__3812895", name: "Beatport全球电子舞曲榜", bangid: "3812895" },
        { id: "wy__21845217", name: "KTV唛榜", bangid: "21845217" },
        { id: "wy__60131", name: "日本Oricon榜", bangid: "60131" },
        { id: "wy__2809513713", name: "欧美热歌榜", bangid: "2809513713" },
        { id: "wy__2809577409", name: "欧美新歌榜", bangid: "2809577409" },
        { id: "wy__27135204", name: "法国 NRJ Vos Hits 周榜", bangid: "27135204" },
        { id: "wy__3001835560", name: "ACG动画榜", bangid: "3001835560" },
        { id: "wy__3001795926", name: "ACG游戏榜", bangid: "3001795926" },
        { id: "wy__3001890046", name: "ACG VOCALOID榜", bangid: "3001890046" },
        { id: "wy__3112516681", name: "中国新乡村音乐排行榜", bangid: "3112516681" },
        { id: "wy__5059644681", name: "日语榜", bangid: "5059644681" },
        { id: "wy__5059633707", name: "摇滚榜", bangid: "5059633707" },
        { id: "wy__5059642708", name: "国风榜", bangid: "5059642708" },
        { id: "wy__5338990334", name: "潜力爆款榜", bangid: "5338990334" },
        { id: "wy__5059661515", name: "民谣榜", bangid: "5059661515" },
        { id: "wy__6688069460", name: "听歌识曲榜", bangid: "6688069460" },
        { id: "wy__6723173524", name: "网络热歌榜", bangid: "6723173524" },
        { id: "wy__6732051320", name: "俄语榜", bangid: "6732051320" },
        { id: "wy__6732014811", name: "越南语榜", bangid: "6732014811" },
        { id: "wy__6886768100", name: "中文DJ榜", bangid: "6886768100" },
        { id: "wy__6939992364", name: "俄罗斯top hit流行音乐榜", bangid: "6939992364" },
        { id: "wy__7095271308", name: "泰语榜", bangid: "7095271308" },
        { id: "wy__7356827205", name: "BEAT排行榜", bangid: "7356827205" },
        { id: "wy__7325478166", name: "编辑推荐榜VOL.44 天才女子摇滚乐队boygenius剖白卑微心迹", bangid: "7325478166" },
        { id: "wy__7603212484", name: "LOOK直播歌曲榜", bangid: "7603212484" },
        { id: "wy__7775163417", name: "赏音榜", bangid: "7775163417" },
        { id: "wy__7785123708", name: "黑胶VIP新歌榜", bangid: "7785123708" },
        { id: "wy__7785066739", name: "黑胶VIP热歌榜", bangid: "7785066739" },
        { id: "wy__7785091694", name: "黑胶VIP爱搜榜", bangid: "7785091694" }
      ];
      leaderboard_default4 = {
        limit: 1e5,
        list: [
          {
            id: "wybsb",
            name: "飙升榜",
            bangid: "19723756"
          },
          {
            id: "wyrgb",
            name: "热歌榜",
            bangid: "3778678"
          },
          {
            id: "wyxgb",
            name: "新歌榜",
            bangid: "3779629"
          },
          {
            id: "wyycb",
            name: "原创榜",
            bangid: "2884035"
          },
          {
            id: "wygdb",
            name: "古典榜",
            bangid: "71384707"
          },
          {
            id: "wydouyb",
            name: "抖音榜",
            bangid: "2250011882"
          },
          {
            id: "wyhyb",
            name: "韩语榜",
            bangid: "745956260"
          },
          {
            id: "wydianyb",
            name: "电音榜",
            bangid: "1978921795"
          },
          {
            id: "wydjb",
            name: "电竞榜",
            bangid: "2006508653"
          },
          {
            id: "wyktvbb",
            name: "KTV唛榜",
            bangid: "21845217"
          }
        ],
        getUrl(id) {
          return `https://music.163.com/discover/toplist?id=${id}`;
        },
        regExps: {
          list: /<textarea id="song-list-pre-data" style="display:none;">(.+?)<\/textarea>/
        },
        _requestBoardsObj: null,
        getBoardsData() {
          if (this._requestBoardsObj) this._requestBoardsObj.cancelHttp();
          this._requestBoardsObj = httpFetch("https://music.163.com/weapi/toplist", {
            method: "post",
            form: weapi({})
          });
          return this._requestBoardsObj.promise;
        },
        getData(id) {
          const requestBoardsDetailObj = httpFetch(`https://music.163.com/api/playlist/detail?id=${id}`);
          return requestBoardsDetailObj.promise;
        },
        filterBoardsData(rawList) {
          let list = [];
          for (const board of rawList) {
            list.push({
              id: "wy__" + board.id,
              name: board.name,
              bangid: String(board.id)
            });
          }
          return list;
        },
        async getBoards(retryNum = 0) {
          this.list = topList;
          return {
            list: topList,
            source: "wy"
          };
        },
        async getList(bangid, page, retryNum = 0) {
          if (++retryNum > 6) return Promise.reject(new Error("try max num"));
          let resp;
          try {
            resp = await this.getData(bangid);
          } catch (err) {
            if (err.message == "try max num") {
              throw err;
            } else {
              return this.getList(bangid, page, retryNum);
            }
          }
          if (resp.statusCode !== 200 || !resp.body.result?.tracks?.length) {
            console.log("[wy-lb-diag]", resp.statusCode, typeof resp.body, JSON.stringify(resp.body).slice(0, 200));
            return this.getList(bangid, page, retryNum);
          }
          const rawList = resp.body.result.tracks;
          return {
            total: rawList.length,
            list: rawList.map((item) => ({
              singer: (item.artists || []).map((a) => a.name).join("、"),
              name: item.name,
              albumName: item.album && item.album.name || "",
              songmid: String(item.id),
              source: "wy",
              interval: formatPlayTime(Math.round((item.duration || 0) / 1e3)),
              img: item.album && item.album.picUrl || null,
              lrc: null,
              otherSource: null,
              types: [],
              _types: {},
              typeUrl: {}
            })),
            limit: this.limit,
            page,
            source: "wy"
          };
        },
        getDetailPageUrl(id) {
          if (typeof id == "string") id = id.replace("wy__", "");
          return `https://music.163.com/#/discover/toplist?id=${id}`;
        }
      };
    }
  });

  // src/musicSdk/wy/lyric.js
  var eapiRequest, parseTools2, fixTimeLabel, lyric_default4;
  var init_lyric4 = __esm({
    "src/musicSdk/wy/lyric.js"() {
      "use strict";
      init_request();
      init_crypto3();
      eapiRequest = (url, data) => {
        return httpFetch("https://interface3.music.163.com/eapi/song/lyric/v1", {
          method: "post",
          headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
            origin: "https://music.163.com"
            // cookie: 'os=pc; deviceId=A9C064BB4584D038B1565B58CB05F95290998EE8B025AA2D07AE; osver=Microsoft-Windows-10-Home-China-build-19043-64bit; appver=2.5.2.197409; channel=netease; MUSIC_A=37a11f2eb9de9930cad479b2ad495b0e4c982367fb6f909d9a3f18f876c6b49faddb3081250c4980dd7e19d4bd9bf384e004602712cf2b2b8efaafaab164268a00b47359f85f22705cc95cb6180f3aee40f5be1ebf3148d888aa2d90636647d0c3061cd18d77b7a0; __csrf=05b50d54082694f945d7de75c210ef94; mode=Z7M-KP5(7)GZ; NMTID=00OZLp2VVgq9QdwokUgq3XNfOddQyIAAAF_6i8eJg; ntes_kaola_ad=1',
          },
          form: eapi(url, data)
        });
      };
      parseTools2 = {
        rxps: {
          info: /^{"/,
          lineTime: /^\[(\d+),\d+\]/,
          wordTime: /\(\d+,\d+,\d+\)/,
          wordTimeAll: /(\(\d+,\d+,\d+\))/g,
          timeMs2: /\[\d+:\d+\.\d{2}]/,
          timeMs3: /\[\d+:\d+\.\d{3}]/
        },
        msFormat(timeMs, pad3 = true) {
          if (Number.isNaN(timeMs)) return "";
          let ms = (timeMs % 1e3).toString().padStart(pad3 ? 3 : 2, "0");
          if (!pad3 && ms.length > 2) ms = ms.slice(0, 2);
          timeMs /= 1e3;
          let m = parseInt(timeMs / 60).toString().padStart(2, "0");
          timeMs %= 60;
          let s = parseInt(timeMs).toString().padStart(2, "0");
          return `[${m}:${s}.${ms}]`;
        },
        parseLyric(lines) {
          const lxlrcLines = [];
          const lrcLines = [];
          for (let line of lines) {
            line = line.trim();
            let result = this.rxps.lineTime.exec(line);
            if (!result) {
              if (line.startsWith("[offset")) {
                lxlrcLines.push(line);
                lrcLines.push(line);
              }
              continue;
            }
            const startMsTime = parseInt(result[1]);
            const startTimeStr = this.msFormat(startMsTime);
            if (!startTimeStr) continue;
            let words = line.replace(this.rxps.lineTime, "");
            lrcLines.push(`${startTimeStr}${words.replace(this.rxps.wordTimeAll, "")}`);
            let times = words.match(this.rxps.wordTimeAll);
            if (!times) continue;
            times = times.map((time) => {
              const result2 = /\((\d+),(\d+),\d+\)/.exec(time);
              return `<${Math.trunc(Math.max(parseInt(result2[1]) - startMsTime, 0))},${result2[2]}>`;
            });
            const wordArr = words.split(this.rxps.wordTime);
            wordArr.shift();
            const newWords = times.map((time, index) => `${time}${wordArr[index]}`).join("");
            lxlrcLines.push(`${startTimeStr}${newWords}`);
          }
          return {
            lyric: lrcLines.join("\n"),
            lxlyric: lxlrcLines.join("\n")
          };
        },
        parseHeaderInfo(str) {
          str = str.trim();
          str = str.replace(/\r/g, "");
          if (!str) return null;
          const isPad3 = this.rxps.timeMs3.test(str) || !this.rxps.timeMs2.test(str);
          const lines = str.split("\n");
          return lines.map((line) => {
            if (!this.rxps.info.test(line)) return line;
            try {
              const info = JSON.parse(line);
              const timeTag = this.msFormat(info.t, isPad3);
              return timeTag ? `${timeTag}${info.c.map((t) => t.tx).join("")}` : "";
            } catch {
              return "";
            }
          });
        },
        getIntv(interval) {
          if (!interval) return 0;
          if (!interval.includes(".")) interval += ".0";
          let arr = interval.split(/:|\./);
          while (arr.length < 3) arr.unshift("0");
          const [m, s, ms] = arr;
          return parseInt(m) * 36e5 + parseInt(s) * 1e3 + parseInt(ms);
        },
        fixTimeTag(lrc, targetlrc) {
          let lrcLines = lrc.split("\n");
          const targetlrcLines = targetlrc.split("\n");
          const timeRxp = /^\[([\d:.]+)\]/;
          let temp = [];
          let newLrc = [];
          targetlrcLines.forEach((line) => {
            const result = timeRxp.exec(line);
            if (!result) return;
            const words = line.replace(timeRxp, "");
            if (!words.trim()) return;
            const t1 = this.getIntv(result[1]);
            while (lrcLines.length) {
              const lrcLine = lrcLines.shift();
              const lrcLineResult = timeRxp.exec(lrcLine);
              if (!lrcLineResult) continue;
              const t2 = this.getIntv(lrcLineResult[1]);
              if (Math.abs(t1 - t2) < 100) {
                const lrc2 = line.replace(timeRxp, lrcLineResult[0]).trim();
                if (!lrc2) continue;
                newLrc.push(lrc2);
                break;
              }
              temp.push(lrcLine);
            }
            lrcLines = [...temp, ...lrcLines];
            temp = [];
          });
          return newLrc.join("\n");
        },
        parse(ylrc, ytlrc, yrlrc, lrc, tlrc, rlrc) {
          const info = {
            lyric: "",
            tlyric: "",
            rlyric: "",
            lxlyric: ""
          };
          if (ylrc) {
            let lines = this.parseHeaderInfo(ylrc);
            if (lines) {
              const result = this.parseLyric(lines);
              if (ytlrc) {
                const lines2 = this.parseHeaderInfo(ytlrc);
                if (lines2) {
                  info.tlyric = this.fixTimeTag(result.lyric, lines2.join("\n"));
                }
              }
              if (yrlrc) {
                const lines2 = this.parseHeaderInfo(yrlrc);
                if (lines2) {
                  info.rlyric = this.fixTimeTag(result.lyric, lines2.join("\n"));
                }
              }
              const timeRxp = /^\[[\d:.]+\]/;
              const headers = lines.filter((l) => timeRxp.test(l)).join("\n");
              info.lyric = `${headers}
${result.lyric}`;
              info.lxlyric = result.lxlyric;
              return info;
            }
          }
          if (lrc) {
            const lines = this.parseHeaderInfo(lrc);
            if (lines) info.lyric = lines.join("\n");
          }
          if (tlrc) {
            const lines = this.parseHeaderInfo(tlrc);
            if (lines) info.tlyric = lines.join("\n");
          }
          if (rlrc) {
            const lines = this.parseHeaderInfo(rlrc);
            if (lines) info.rlyric = lines.join("\n");
          }
          return info;
        }
      };
      fixTimeLabel = (lrc, tlrc, romalrc) => {
        if (lrc) {
          let newLrc = lrc.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, "[$1.$2]");
          let newTlrc = tlrc?.replace(/\[(\d{2}:\d{2}):(\d{2})]/g, "[$1.$2]") ?? tlrc;
          if (newLrc != lrc || newTlrc != tlrc) {
            lrc = newLrc;
            tlrc = newTlrc;
            if (romalrc) romalrc = romalrc.replace(/\[(\d{2}:\d{2}):(\d{2,3})]/g, "[$1.$2]").replace(/\[(\d{2}:\d{2}\.\d{2})0]/g, "[$1]");
          }
        }
        return { lrc, tlrc, romalrc };
      };
      lyric_default4 = (songmid) => {
        const requestObj = eapiRequest("/api/song/lyric/v1", {
          id: songmid,
          cp: false,
          tv: 0,
          lv: 0,
          rv: 0,
          kv: 0,
          yv: 0,
          ytv: 0,
          yrv: 0
        });
        requestObj.promise = requestObj.promise.then(({ body }) => {
          if (body.code !== 200 || !body?.lrc?.lyric) return Promise.reject(new Error("Get lyric failed"));
          const fixTimeLabelLrc = fixTimeLabel(body.lrc.lyric, body.tlyric?.lyric, body.romalrc?.lyric);
          const info = parseTools2.parse(body.yrc?.lyric, body.ytlrc?.lyric, body.yromalrc?.lyric, fixTimeLabelLrc.lrc, fixTimeLabelLrc.tlrc, fixTimeLabelLrc.romalrc);
          if (!info.lyric) return Promise.reject(new Error("Get lyric failed"));
          return info;
        });
        return requestObj;
      };
    }
  });

  // src/musicSdk/wy/musicInfo.js
  var musicInfo_default2;
  var init_musicInfo2 = __esm({
    "src/musicSdk/wy/musicInfo.js"() {
      "use strict";
      init_request();
      init_crypto3();
      musicInfo_default2 = (songmid) => {
        const requestObj = httpFetch("https://music.163.com/weapi/v3/song/detail", {
          method: "post",
          headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
            Referer: "https://music.163.com/song?id=" + songmid,
            origin: "https://music.163.com"
          },
          form: weapi({
            c: `[{"id":${songmid}}]`,
            ids: `[${songmid}]`
          })
        });
        requestObj.promise = requestObj.promise.then(({ body }) => {
          if (body.code !== 200 || !body.songs.length) return Promise.reject(new Error("获取歌曲信息失败"));
          return body.songs[0];
        });
        return requestObj;
      };
    }
  });

  // src/musicSdk/wy/utils/index.js
  var eapiRequest2;
  var init_utils3 = __esm({
    "src/musicSdk/wy/utils/index.js"() {
      "use strict";
      init_request();
      init_crypto3();
      eapiRequest2 = (url, data) => {
        return httpFetch("http://interface.music.163.com/eapi/batch", {
          method: "post",
          headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
            origin: "https://music.163.com"
            // cookie: 'os=pc; deviceId=A9C064BB4584D038B1565B58CB05F95290998EE8B025AA2D07AE; osver=Microsoft-Windows-10-Home-China-build-19043-64bit; appver=2.5.2.197409; channel=netease; MUSIC_A=37a11f2eb9de9930cad479b2ad495b0e4c982367fb6f909d9a3f18f876c6b49faddb3081250c4980dd7e19d4bd9bf384e004602712cf2b2b8efaafaab164268a00b47359f85f22705cc95cb6180f3aee40f5be1ebf3148d888aa2d90636647d0c3061cd18d77b7a0; __csrf=05b50d54082694f945d7de75c210ef94; mode=Z7M-KP5(7)GZ; NMTID=00OZLp2VVgq9QdwokUgq3XNfOddQyIAAAF_6i8eJg; ntes_kaola_ad=1',
          },
          form: eapi(url, data)
        });
      };
    }
  });

  // src/musicSdk/wy/musicSearch.js
  var musicSearch_default4;
  var init_musicSearch4 = __esm({
    "src/musicSdk/wy/musicSearch.js"() {
      "use strict";
      init_utils_index();
      init_utils3();
      musicSearch_default4 = {
        limit: 30,
        total: 0,
        page: 0,
        allPage: 1,
        musicSearch(str, page, limit) {
          const searchRequest = eapiRequest2("/api/search/song/list/page", {
            keyword: str,
            needCorrect: "1",
            channel: "typing",
            offset: limit * (page - 1),
            scene: "normal",
            total: page == 1,
            limit
          });
          return searchRequest.promise.then(({ body }) => body);
        },
        getSinger(singers) {
          let arr = [];
          singers.forEach((singer) => {
            arr.push(singer.name);
          });
          return arr.join("、");
        },
        handleResult(rawList) {
          if (!rawList) return [];
          return rawList.map((item) => {
            item = item.baseInfo.simpleSongData;
            const types = [];
            const _types = {};
            let size;
            if (item.privilege.maxBrLevel == "hires") {
              size = item.hr ? sizeFormate(item.hr.size) : null;
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            switch (item.privilege.maxbr) {
              case 999e3:
                size = item.sq ? sizeFormate(item.sq.size) : null;
                types.push({ type: "flac", size });
                _types.flac = {
                  size
                };
              case 32e4:
                size = item.h ? sizeFormate(item.h.size) : null;
                types.push({ type: "320k", size });
                _types["320k"] = {
                  size
                };
              case 192e3:
              case 128e3:
                size = item.l ? sizeFormate(item.l.size) : null;
                types.push({ type: "128k", size });
                _types["128k"] = {
                  size
                };
            }
            types.reverse();
            return {
              singer: this.getSinger(item.ar),
              name: item.name,
              albumName: item.al.name,
              albumId: item.al.id,
              source: "wy",
              interval: formatPlayTime(item.dt / 1e3),
              songmid: item.id,
              img: item.al.picUrl,
              lrc: null,
              types,
              _types,
              typeUrl: {}
            };
          });
        },
        search(str, page = 1, limit, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          if (limit == null) limit = this.limit;
          return this.musicSearch(str, page, limit).then((result) => {
            if (!result || result.code !== 200) return this.search(str, page, limit, retryNum);
            let list = this.handleResult(result.data.resources || []);
            if (list == null) return this.search(str, page, limit, retryNum);
            this.total = result.data.totalCount || 0;
            this.page = page;
            this.allPage = Math.ceil(this.total / this.limit);
            return {
              list,
              allPage: this.allPage,
              limit: this.limit,
              total: this.total,
              source: "wy"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/wy/songList.js
  var songList_default4;
  var init_songList4 = __esm({
    "src/musicSdk/wy/songList.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_musicDetail();
      init_utils3();
      init_utils();
      songList_default4 = {
        _requestObj_tags: null,
        _requestObj_hotTags: null,
        _requestObj_list: null,
        limit_list: 30,
        limit_song: 1e5,
        successCode: 200,
        cookie: "MUSIC_U=",
        sortList: [
          {
            name: "最热",
            tid: "hot",
            id: "hot"
          }
          // {
          //   name: '最新',
          //   tid: 'new',
          //   id: 'new',
          // },
        ],
        regExps: {
          listDetailLink: /^.+(?:\?|&)id=(\d+)(?:&.*$|#.*$|$)/,
          listDetailLink2: /^.+\/playlist\/(\d+)\/\d+\/.+$/
        },
        async handleParseId(link, retryNum = 0) {
          if (retryNum > 2) throw new Error("link try max num");
          const requestObj_listDetailLink = httpFetch(link);
          const { url, statusCode } = await requestObj_listDetailLink.promise;
          if (statusCode > 400) return this.handleParseId(link, ++retryNum);
          return this.regExps.listDetailLink.test(url) ? url.replace(this.regExps.listDetailLink, "$1") : url.replace(this.regExps.listDetailLink2, "$1");
        },
        async getListId(id) {
          let cookie;
          if (/###/.test(id)) {
            const [url, token] = id.split("###");
            id = url;
            cookie = `MUSIC_U=${token}`;
          }
          if (/[?&:/]/.test(id)) {
            if (this.regExps.listDetailLink.test(id)) {
              id = id.replace(this.regExps.listDetailLink, "$1");
            } else if (this.regExps.listDetailLink2.test(id)) {
              id = id.replace(this.regExps.listDetailLink2, "$1");
            } else {
              id = await this.handleParseId(id);
            }
          }
          return { id, cookie };
        },
        async getListDetail(rawId, page, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const { id, cookie } = await this.getListId(rawId);
          if (cookie) this.cookie = cookie;
          const requestObj_listDetail = httpFetch(`https://music.163.com/api/v3/playlist/detail?id=${encodeURIComponent(id)}&n=${this.limit_song}&s=8`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
              Referer: "https://music.163.com/",
              Cookie: this.cookie
            }
          });
          const { statusCode, body } = await requestObj_listDetail.promise;
          if (statusCode !== 200 || body.code !== this.successCode) return this.getListDetail(id, page, ++tryNum);
          let limit = 1e3;
          let rangeStart = (page - 1) * limit;
          let list;
          if (body.playlist.trackIds.length == body.privileges.length) {
            list = this.filterListDetail(body);
          } else {
            try {
              list = (await musicDetail_default.getList(body.playlist.trackIds.slice(rangeStart, limit * page).map((trackId) => trackId.id))).list;
            } catch (err) {
              console.log(err);
              if (err.message == "try max num") {
                throw err;
              } else {
                return this.getListDetail(id, page, ++tryNum);
              }
            }
          }
          return {
            list,
            page,
            limit,
            total: body.playlist.trackIds.length,
            source: "wy",
            info: {
              play_count: formatPlayCount(body.playlist.playCount),
              name: body.playlist.name,
              img: body.playlist.coverImgUrl,
              desc: body.playlist.description,
              author: body.playlist.creator.nickname
            }
          };
        },
        filterListDetail({ playlist: { tracks }, privileges }) {
          const list = [];
          tracks.forEach((item, index) => {
            const types = [];
            const _types = {};
            let size;
            let privilege = privileges[index];
            if (privilege.id !== item.id) privilege = privileges.find((p) => p.id === item.id);
            if (!privilege) return;
            if (privilege.maxBrLevel == "hires") {
              size = item.hr ? sizeFormate(item.hr.size) : null;
              types.push({ type: "flac24bit", size });
              _types.flac24bit = {
                size
              };
            }
            switch (privilege.maxbr) {
              case 999e3:
                size = null;
                types.push({ type: "flac", size });
                _types.flac = {
                  size
                };
              case 32e4:
                size = item.h ? sizeFormate(item.h.size) : null;
                types.push({ type: "320k", size });
                _types["320k"] = {
                  size
                };
              case 192e3:
              case 128e3:
                size = item.l ? sizeFormate(item.l.size) : null;
                types.push({ type: "128k", size });
                _types["128k"] = {
                  size
                };
            }
            types.reverse();
            if (item.pc) {
              list.push({
                singer: item.pc.ar ?? "",
                name: item.pc.sn ?? "",
                albumName: item.pc.alb ?? "",
                albumId: item.al?.id,
                source: "wy",
                interval: formatPlayTime(item.dt / 1e3),
                songmid: item.id,
                img: item.al?.picUrl ?? "",
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {}
              });
            } else {
              list.push({
                singer: formatSingerName(item.ar, "name"),
                name: item.name ?? "",
                albumName: item.al?.name,
                albumId: item.al?.id,
                source: "wy",
                interval: formatPlayTime(item.dt / 1e3),
                songmid: item.id,
                img: item.al?.picUrl,
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {}
              });
            }
          });
          return list;
        },
        // 获取列表数据
        getList(sortId, tagId, page, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          if (this._requestObj_list) this._requestObj_list.cancelHttp();
          const cat = tagId || "全部";
          const order = sortId === "new" ? "new" : "hot";
          const offset = this.limit_list * (page - 1);
          this._requestObj_list = httpFetch(`https://music.163.com/api/playlist/list?cat=${encodeURIComponent(cat)}&order=${order}&limit=${this.limit_list}&offset=${offset}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
              Referer: "https://music.163.com/"
            }
          });
          return this._requestObj_list.promise.then(({ statusCode, body }) => {
            if (statusCode !== 200 || body.code !== this.successCode || !Array.isArray(body.playlists)) return this.getList(sortId, tagId, page, ++tryNum);
            return {
              list: this.filterList(body.playlists),
              total: Number(body.total) || 0,
              page,
              limit: this.limit_list,
              source: "wy"
            };
          });
        },
        filterList(rawData) {
          return rawData.map((item) => ({
            play_count: formatPlayCount(item.playCount),
            id: String(item.id),
            author: item.creator?.nickname || "",
            name: item.name,
            time: item.createTime ? dateFormat(item.createTime, "Y-M-D") : "",
            img: item.coverImgUrl,
            grade: item.grade,
            total: item.trackCount,
            desc: item.description,
            source: "wy"
          }));
        },
        // 获取标签
        getTag(tryNum = 0) {
          if (this._requestObj_tags) this._requestObj_tags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_tags = httpFetch("https://music.163.com/api/playlist/catalogue", {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
              Referer: "https://music.163.com/"
            }
          });
          return this._requestObj_tags.promise.then(({ statusCode, body }) => {
            if (statusCode !== 200 || body.code !== this.successCode || !Array.isArray(body.sub)) return this.getTag(++tryNum);
            return this.filterTagInfo(body);
          });
        },
        filterTagInfo({ sub, categories }) {
          const subList = {};
          for (const item of sub) {
            if (!subList[item.category]) subList[item.category] = [];
            subList[item.category].push({
              parent_id: categories[item.category],
              parent_name: categories[item.category],
              id: item.name,
              name: item.name,
              source: "wy"
            });
          }
          const list = [];
          for (const key of Object.keys(categories)) {
            list.push({
              name: categories[key],
              list: subList[key],
              source: "wy"
            });
          }
          return list;
        },
        // 获取热门标签
        getHotTag(tryNum = 0) {
          if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_hotTags = httpFetch("https://music.163.com/api/playlist/hottags", {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
              Referer: "https://music.163.com/"
            }
          });
          return this._requestObj_hotTags.promise.then(({ statusCode, body }) => {
            if (statusCode !== 200 || body.code !== this.successCode || !Array.isArray(body.tags)) return this.getHotTag(++tryNum);
            return this.filterHotTagInfo(body.tags);
          });
        },
        filterHotTagInfo(rawList) {
          return rawList.map((item) => ({
            id: item.playlistTag.name,
            name: item.playlistTag.name,
            source: "wy"
          }));
        },
        getTags() {
          return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({ tags, hotTag, source: "wy" }));
        },
        async getDetailPageUrl(rawId) {
          const { id } = await this.getListId(rawId);
          return `https://music.163.com/#/playlist?id=${id}`;
        },
        search(text, page, limit = 20) {
          return eapiRequest2("/api/cloudsearch/pc", {
            s: text,
            type: 1e3,
            // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
            limit,
            total: page == 1,
            offset: limit * (page - 1)
          }).promise.then(({ body }) => {
            if (body.code != this.successCode) throw new Error("filed");
            return {
              list: this.filterList(body.result.playlists),
              limit,
              total: body.result.playlistCount,
              source: "wy"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/wy/hotSearch.js
  var hotSearch_default4;
  var init_hotSearch4 = __esm({
    "src/musicSdk/wy/hotSearch.js"() {
      "use strict";
      init_utils3();
      hotSearch_default4 = {
        _requestObj: null,
        async getList(retryNum = 0) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const _requestObj = eapiRequest2("/api/search/chart/detail", {
            id: "HOT_SEARCH_SONG#@#"
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== 200) throw new Error("获取热搜词失败");
          return { source: "wy", list: this.filterList(body.data.itemList) };
        },
        filterList(rawList) {
          return rawList.map((item) => item.searchWord);
        }
      };
    }
  });

  // src/musicSdk/wy/comment.js
  var emojis2, applyEmoji, cursorTools, comment_default4;
  var init_comment4 = __esm({
    "src/musicSdk/wy/comment.js"() {
      "use strict";
      init_request();
      init_crypto3();
      init_utils_index();
      emojis2 = [
        ["大笑", "😃"],
        ["可爱", "😊"],
        ["憨笑", "☺️"],
        ["色", "😍"],
        ["亲亲", "😙"],
        ["惊恐", "😱"],
        ["流泪", "😭"],
        ["亲", "😚"],
        ["呆", "😳"],
        ["哀伤", "😔"],
        ["呲牙", "😁"],
        ["吐舌", "😝"],
        ["撇嘴", "😒"],
        ["怒", "😡"],
        ["奸笑", "😏"],
        ["汗", "😓"],
        ["痛苦", "😖"],
        ["惶恐", "😰"],
        ["生病", "😨"],
        ["口罩", "😷"],
        ["大哭", "😂"],
        ["晕", "😵"],
        ["发怒", "👿"],
        ["开心", "😄"],
        ["鬼脸", "😜"],
        ["皱眉", "😞"],
        ["流感", "😢"],
        ["爱心", "❤️"],
        ["心碎", "💔"],
        ["钟情", "💘"],
        ["星星", "⭐️"],
        ["生气", "💢"],
        ["便便", "💩"],
        ["强", "👍"],
        ["弱", "👎"],
        ["拜", "🙏"],
        ["牵手", "👫"],
        ["跳舞", "👯‍♀️"],
        ["禁止", "🙅‍♀️"],
        ["这边", "💁‍♀️"],
        ["爱意", "💏"],
        ["示爱", "👩‍❤️‍👨"],
        ["嘴唇", "👄"],
        ["狗", "🐶"],
        ["猫", "🐱"],
        ["猪", "🐷"],
        ["兔子", "🐰"],
        ["小鸡", "🐤"],
        ["公鸡", "🐔"],
        ["幽灵", "👻"],
        ["圣诞", "🎅"],
        ["外星", "👽"],
        ["钻石", "💎"],
        ["礼物", "🎁"],
        ["男孩", "👦"],
        ["女孩", "👧"],
        ["蛋糕", "🎂"],
        ["18", "🔞"],
        ["圈", "⭕"],
        ["叉", "❌"]
      ];
      applyEmoji = (text) => {
        for (const e of emojis2) text = text.replaceAll(`[${e[0]}]`, e[1]);
        return text;
      };
      cursorTools = {
        cache: {},
        getCursor(id, page, limit) {
          let cacheData = this.cache[id];
          if (!cacheData) cacheData = this.cache[id] = {};
          let orderType;
          let cursor;
          let offset;
          if (page == 1) {
            cacheData.page = 1;
            cursor = cacheData.cursor = cacheData.prevCursor = Date.now();
            orderType = 1;
            offset = 0;
          } else if (cacheData.page) {
            cursor = cacheData.cursor;
            if (page > cacheData.page) {
              orderType = 1;
              offset = (page - cacheData.page - 1) * limit;
            } else if (page < cacheData.page) {
              orderType = 0;
              offset = (cacheData.page - page - 1) * limit;
            } else {
              cursor = cacheData.cursor = cacheData.prevCursor;
              offset = cacheData.offset;
              orderType = cacheData.orderType;
            }
          }
          return {
            orderType,
            cursor,
            offset
          };
        },
        setCursor(id, cursor, orderType, offset, page) {
          let cacheData = this.cache[id];
          if (!cacheData) cacheData = this.cache[id] = {};
          cacheData.prevCursor = cacheData.cursor;
          cacheData.cursor = cursor;
          cacheData.orderType = orderType;
          cacheData.offset = offset;
          cacheData.page = page;
        }
      };
      comment_default4 = {
        _requestObj: null,
        _requestObj2: null,
        async getComment({ songmid }, page = 1, limit = 20) {
          if (this._requestObj) this._requestObj.cancelHttp();
          const id = "R_SO_4_" + songmid;
          const cursorInfo = cursorTools.getCursor(songmid, page, limit);
          const _requestObj = httpFetch("https://music.163.com/weapi/comment/resource/comments/get", {
            method: "post",
            headers: {
              "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
              origin: "https://music.163.com",
              Refere: "http://music.163.com/"
            },
            form: weapi({
              cursor: cursorInfo.cursor,
              offset: cursorInfo.offset,
              orderType: cursorInfo.orderType,
              pageNo: page,
              pageSize: limit,
              rid: id,
              threadId: id
            })
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== 200) throw new Error("获取评论失败");
          cursorTools.setCursor(songmid, body.data.cursor, cursorInfo.orderType, cursorInfo.offset, page);
          return { source: "wy", comments: this.filterComment(body.data.comments), total: body.data.totalCount, page, limit, maxPage: Math.ceil(body.data.totalCount / limit) || 1 };
        },
        async getHotComment({ songmid }, page = 1, limit = 100) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          const id = "R_SO_4_" + songmid;
          const _requestObj2 = httpFetch(`https://music.163.com/weapi/v1/resource/hotcomments/${id}`, {
            method: "post",
            headers: {
              "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
              origin: "https://music.163.com",
              Refere: "http://music.163.com/"
            },
            form: weapi({
              rid: id,
              limit,
              offset: limit * (page - 1),
              beforeTime: Date.now().toString()
            })
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.code !== 200) throw new Error("获取热门评论失败");
          const total = body.total ?? 0;
          return { source: "wy", comments: this.filterComment(body.hotComments), total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        filterComment(rawList) {
          return rawList.map((item) => {
            let data = {
              id: item.commentId,
              text: item.content ? applyEmoji(item.content) : "",
              time: item.time ? item.time : "",
              timeStr: item.time ? dateFormat2(item.time) : "",
              location: item.ipLocation?.location,
              userName: item.user.nickname,
              avatar: item.user.avatarUrl,
              userId: item.user.userId,
              likedCount: item.likedCount,
              reply: []
            };
            let replyData = item.beReplied && item.beReplied[0];
            return replyData ? {
              id: item.commentId,
              rootId: replyData.beRepliedCommentId,
              text: replyData.content ? applyEmoji(replyData.content) : "",
              time: item.time,
              timeStr: null,
              location: replyData.ipLocation?.location,
              userName: replyData.user.nickname,
              avatar: replyData.user.avatarUrl,
              userId: replyData.user.userId,
              likedCount: null,
              reply: [data]
            } : data;
          });
        }
      };
    }
  });

  // src/musicSdk/wy/index.js
  var wy, wy_default;
  var init_wy = __esm({
    "src/musicSdk/wy/index.js"() {
      "use strict";
      init_leaderboard4();
      init_api_source();
      init_lyric4();
      init_musicInfo2();
      init_musicSearch4();
      init_songList4();
      init_hotSearch4();
      init_comment4();
      wy = {
        // tipSearch,
        leaderboard: leaderboard_default4,
        musicSearch: musicSearch_default4,
        songList: songList_default4,
        hotSearch: hotSearch_default4,
        comment: comment_default4,
        getMusicUrl(songInfo, type) {
          return apis("wy").getMusicUrl(songInfo, type);
        },
        getLyric(songInfo) {
          return lyric_default4(songInfo.songmid);
        },
        getPic(songInfo) {
          const requestObj = musicInfo_default2(songInfo.songmid);
          return requestObj.promise.then((info) => info.al.picUrl);
        },
        getMusicDetailPageUrl(songInfo) {
          return `https://music.163.com/#/song?id=${songInfo.songmid}`;
        }
      };
      wy_default = wy;
    }
  });

  // src/musicSdk/mg/utils/index.js
  var createHttpFetch;
  var init_utils4 = __esm({
    "src/musicSdk/mg/utils/index.js"() {
      "use strict";
      init_request();
      createHttpFetch = async (url, options, retryNum = 0) => {
        if (retryNum > 2) throw new Error("try max num");
        let result;
        try {
          result = await httpFetch(url, options).promise;
        } catch (err) {
          console.log(err);
          return createHttpFetch(url, options, ++retryNum);
        }
        if (result.statusCode !== 200 || (result.body.code !== void 0 ? result.body.code : result.body.returnCode !== void 0 ? result.body.returnCode : result.body.code) !== "000000") return createHttpFetch(url, options, ++retryNum);
        if (result.body.data) return result.body.data;
        return result.body;
      };
    }
  });

  // src/musicSdk/mg/musicInfo.js
  var createGetMusicInfosTask, filterMusicInfoList, filterMusicInfoListV5, getMusicInfo, getMusicInfos;
  var init_musicInfo3 = __esm({
    "src/musicSdk/mg/musicInfo.js"() {
      "use strict";
      init_utils_index();
      init_utils4();
      init_utils();
      createGetMusicInfosTask = (ids) => {
        let list = ids;
        let tasks = [];
        while (list.length) {
          tasks.push(list.slice(0, 100));
          if (list.length < 100) break;
          list = list.slice(100);
        }
        let url = "https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2";
        return Promise.all(tasks.map((task) => createHttpFetch(url, {
          method: "POST",
          form: {
            resourceId: task.join("|")
          }
        }).then((data) => data.resource)));
      };
      filterMusicInfoList = (rawList) => {
        let ids = /* @__PURE__ */ new Set();
        const list = [];
        rawList.forEach((item) => {
          if (!item.songId || ids.has(item.songId)) return;
          ids.add(item.songId);
          const types = [];
          const _types = {};
          item.newRateFormats?.forEach((type) => {
            let size;
            switch (type.formatType) {
              case "PQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "128k", size });
                _types["128k"] = {
                  size
                };
                break;
              case "HQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "320k", size });
                _types["320k"] = {
                  size
                };
                break;
              case "SQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "flac", size });
                _types.flac = {
                  size
                };
                break;
              case "ZQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "flac24bit", size });
                _types.flac24bit = {
                  size
                };
                break;
            }
          });
          const intervalTest = /(\d\d:\d\d)$/.test(item.length);
          list.push({
            singer: formatSingerName(item.artists, "name"),
            name: item.songName,
            albumName: item.album,
            albumId: item.albumId,
            songmid: item.songId,
            copyrightId: item.copyrightId,
            source: "mg",
            interval: intervalTest ? RegExp.$1 : null,
            img: item.albumImgs?.length ? item.albumImgs[0].img : null,
            lrc: null,
            lrcUrl: item.lrcUrl,
            mrcUrl: item.mrcUrl,
            trcUrl: item.trcUrl,
            otherSource: null,
            types,
            _types,
            typeUrl: {}
          });
        });
        return list;
      };
      filterMusicInfoListV5 = (rawList) => {
        let ids = /* @__PURE__ */ new Set();
        const list = [];
        rawList.forEach((item) => {
          if (!item.songId || ids.has(item.songId)) return;
          ids.add(item.songId);
          const types = [];
          const _types = {};
          item.audioFormats?.forEach((type) => {
            let size;
            switch (type.formatType) {
              case "PQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "128k", size });
                _types["128k"] = {
                  size
                };
                break;
              case "HQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "320k", size });
                _types["320k"] = {
                  size
                };
                break;
              case "SQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "flac", size });
                _types.flac = {
                  size
                };
                break;
              case "ZQ":
                size = sizeFormate(type.size ?? type.androidSize);
                types.push({ type: "flac24bit", size });
                _types.flac24bit = {
                  size
                };
                break;
            }
          });
          list.push({
            singer: formatSingerName(item.singerList, "name"),
            name: item.songName,
            albumName: item.album,
            albumId: item.albumId,
            songmid: item.songId,
            copyrightId: item.copyrightId,
            source: "mg",
            interval: formatPlayTime(item.duration),
            img: item.img3 || item.img2 || item.img1 || null,
            lrc: null,
            lrcUrl: item.lrcUrl,
            mrcUrl: item.mrcUrl,
            trcUrl: item.trcUrl,
            otherSource: null,
            types,
            _types,
            typeUrl: {}
          });
        });
        return list;
      };
      getMusicInfo = async (copyrightId) => {
        return getMusicInfos([copyrightId]).then((data) => data[0]);
      };
      getMusicInfos = async (copyrightIds) => {
        return filterMusicInfoList(await Promise.all(createGetMusicInfosTask(copyrightIds)).then((data) => data.flat()));
      };
    }
  });

  // src/musicSdk/mg/leaderboard.js
  var boardList4, leaderboard_default5;
  var init_leaderboard5 = __esm({
    "src/musicSdk/mg/leaderboard.js"() {
      "use strict";
      init_request();
      init_musicInfo3();
      boardList4 = [
        {
          id: "mg__27553319",
          name: "新歌榜",
          bangid: "27553319",
          source: "mg"
        },
        {
          id: "mg__27186466",
          name: "热歌榜",
          bangid: "27186466",
          source: "mg"
        },
        {
          id: "mg__27553408",
          name: "原创榜",
          bangid: "27553408",
          source: "mg"
        },
        {
          id: "mg__75959118",
          name: "音乐风向榜",
          bangid: "75959118",
          source: "mg"
        },
        {
          id: "mg__76557036",
          name: "彩铃分贝榜",
          bangid: "76557036",
          source: "mg"
        },
        {
          id: "mg__76557745",
          name: "会员臻爱榜",
          bangid: "76557745",
          source: "mg"
        },
        {
          id: "mg__23189800",
          name: "港台榜",
          bangid: "23189800",
          source: "mg"
        },
        {
          id: "mg__23189399",
          name: "内地榜",
          bangid: "23189399",
          source: "mg"
        },
        {
          id: "mg__19190036",
          name: "欧美榜",
          bangid: "19190036",
          source: "mg"
        },
        {
          id: "mg__83176390",
          name: "国风金曲榜",
          bangid: "83176390",
          source: "mg"
        }
      ];
      leaderboard_default5 = {
        limit: 200,
        list: [
          {
            id: "mgyyb",
            name: "音乐榜",
            bangid: "27553319"
          },
          {
            id: "mgysb",
            name: "影视榜",
            bangid: "23603721"
          },
          {
            id: "mghybnd",
            name: "华语内地榜",
            bangid: "23603926"
          },
          {
            id: "mghyjqbgt",
            name: "华语港台榜",
            bangid: "23603954"
          },
          {
            id: "mgomb",
            name: "欧美榜",
            bangid: "23603974"
          },
          {
            id: "mgrhb",
            name: "日韩榜",
            bangid: "23603982"
          },
          {
            id: "mgwlb",
            name: "网络榜",
            bangid: "23604058"
          },
          {
            id: "mgclb",
            name: "彩铃榜",
            bangid: "23604023"
          },
          {
            id: "mgktvb",
            name: "KTV榜",
            bangid: "23604040"
          },
          {
            id: "mgrcb",
            name: "原创榜",
            bangid: "23604032"
          }
        ],
        getUrl(id, page) {
          return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${id}&needAll=0`;
        },
        successCode: "000000",
        requestBoardsObj: null,
        getBoardsData() {
          if (this.requestBoardsObj) this._requestBoardsObj.cancelHttp();
          this.requestBoardsObj = httpFetch("https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0", {
            // this.requestBoardsObj = httpFetch('https://app.c.nf.migu.cn/MIGUM3.0/v1.0/template/rank-list/release', {
            // this.requestBoardsObj = httpFetch('https://app.c.nf.migu.cn/MIGUM2.0/v2.0/content/indexrank.do?templateVersion=8', {
            headers: {
              Referer: "https://app.c.nf.migu.cn/",
              "User-Agent": "Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36",
              channel: "0146921"
            }
          });
          return this.requestBoardsObj.promise;
        },
        getData(url) {
          const requestObj = httpFetch(url);
          return requestObj.promise;
        },
        // filterBoardsData(listData, list = [], ids = new Set()) {
        //   for (const item of listData) {
        //     if (item.rankId && !ids.has(item.rankId)) {
        //       ids.add(item.rankId)
        //       list.push({
        //         id: 'mg__' + item.rankId,
        //         name: item.rankName,
        //         bangid: String(item.rankId),
        //         source: 'mg',
        //       })
        //     } else if (item.contents) this.filterBoardsData(item.contents, list, ids)
        //   }
        //   return list
        // },
        // filterBoardsData(rawList) {
        //   // console.log(rawList)
        //   let list = []
        //   for (const board of rawList) {
        //     if (board.template != 'group1') continue
        //     for (const item of board.itemList) {
        //       if ((item.template != 'row1' && item.template != 'grid1' && !item.actionUrl) || !item.actionUrl.includes('rank-info')) continue
        //       let data = item.displayLogId.param
        //       list.push({
        //         id: 'mg__' + data.rankId,
        //         name: data.rankName,
        //         bangid: String(data.rankId),
        //       })
        //     }
        //   }
        //   return list
        // },
        async getBoards(retryNum = 0) {
          this.list = boardList4;
          return {
            list: boardList4,
            source: "mg"
          };
        },
        getList(bangid, page, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          return this.getData(this.getUrl(bangid, page)).then(({ statusCode, body }) => {
            if (statusCode !== 200 || body.code !== this.successCode) return this.getList(bangid, page, retryNum);
            const list = filterMusicInfoList(body.columnInfo.contents.map((m) => m.objectInfo));
            return {
              total: list.length,
              list,
              limit: this.limit,
              page,
              source: "mg"
            };
          });
        },
        getDetailPageUrl(id) {
          if (typeof id == "string") id = id.replace("mg__", "");
          for (const item of boardList4) {
            if (item.bangid == id) {
              return `https://music.migu.cn/v3/music/top/${item.webId}`;
            }
          }
          return null;
        }
      };
    }
  });

  // src/musicSdk/mg/musicSearch.js
  var createSignature, musicSearch_default5;
  var init_musicSearch5 = __esm({
    "src/musicSdk/mg/musicSearch.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_utils();
      createSignature = (time, str) => {
        const deviceId = "963B7AA0D21511ED807EE5846EC87D20";
        const signatureMd5 = "6cdc72a439cef99a3418d2a78aa28c73";
        const sign = toMD5(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`);
        return { sign, deviceId };
      };
      musicSearch_default5 = {
        limit: 20,
        total: 0,
        page: 0,
        allPage: 1,
        // 旧版API
        // musicSearch(str, page, limit) {
        //   const searchRequest = httpFetch(`http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?ua=Android_migu&version=5.0.1&text=${encodeURIComponent(str)}&pageNo=${page}&pageSize=${limit}&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22songlist%22%3A0%2C%22bestShow%22%3A1%7D`, {
        // searchRequest = httpFetch(`http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?ua=Android_migu&version=5.0.1&text=${encodeURIComponent(str)}&pageNo=${page}&pageSize=${limit}&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22songlist%22%3A0%2C%22bestShow%22%3A1%7D`, {
        // searchRequest = httpFetch(`http://jadeite.migu.cn:7090/music_search/v2/search/searchAll?sid=4f87090d01c84984a11976b828e2b02c18946be88a6b4c47bcdc92fbd40762db&isCorrect=1&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0`, {
        // searchRequest = httpFetch(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCopyright=1&isCorrect=1&pageNo=${page}&pageSize=${limit}&searchSwitch={%22song%22:1,%22album%22:0,%22singer%22:0,%22tagSong%22:0,%22mvSong%22:0,%22songlist%22:0,%22bestShow%22:0}&sort=0&text=${encodeURIComponent(str)}`)
        //   // searchRequest = httpFetch(`http://jadeite.migu.cn:7090/music_search/v2/search/searchAll?sid=4f87090d01c84984a11976b828e2b02c18946be88a6b4c47bcdc92fbd40762db&isCorrect=1&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0`, {
        //     headers: {
        //       // sign: 'c3b7ae985e2206e97f1b2de8f88691e2',
        //       // timestamp: 1578225871982,
        //       // appId: 'yyapp2',
        //       // mode: 'android',
        //       // ua: 'Android_migu',
        //       // version: '6.9.4',
        //       osVersion: 'android 7.0',
        //       'User-Agent': 'okhttp/3.9.1',
        //     },
        //   })
        //   // searchRequest = httpFetch(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCopyright=1&isCorrect=1&pageNo=${page}&pageSize=${limit}&searchSwitch={%22song%22:1,%22album%22:0,%22singer%22:0,%22tagSong%22:0,%22mvSong%22:0,%22songlist%22:0,%22bestShow%22:0}&sort=0&text=${encodeURIComponent(str)}`)
        //   return searchRequest.promise.then(({ body }) => body)
        // },
        // handleResult(rawData) {
        //   // console.log(rawData)
        //   let ids = new Set()
        //   const list = []
        //   rawData.forEach(item => {
        //     if (ids.has(item.id)) return
        //     ids.add(item.id)
        //     const types = []
        //     const _types = {}
        //     item.newRateFormats && item.newRateFormats.forEach(type => {
        //       let size
        //       switch (type.formatType) {
        //         case 'PQ':
        //           size = sizeFormate(type.size ?? type.androidSize)
        //           types.push({ type: '128k', size })
        //           _types['128k'] = {
        //             size,
        //           }
        //           break
        //         case 'HQ':
        //           size = sizeFormate(type.size ?? type.androidSize)
        //           types.push({ type: '320k', size })
        //           _types['320k'] = {
        //             size,
        //           }
        //           break
        //         case 'SQ':
        //           size = sizeFormate(type.size ?? type.androidSize)
        //           types.push({ type: 'flac', size })
        //           _types.flac = {
        //             size,
        //           }
        //           break
        //         case 'ZQ':
        //           size = sizeFormate(type.size ?? type.androidSize)
        //           types.push({ type: 'flac24bit', size })
        //           _types.flac24bit = {
        //             size,
        //           }
        //           break
        //       }
        //     })
        //     const albumNInfo = item.albums && item.albums.length
        //       ? {
        //           id: item.albums[0].id,
        //           name: item.albums[0].name,
        //         }
        //       : {}
        //     list.push({
        //       singer: this.getSinger(item.singers),
        //       name: item.name,
        //       albumName: albumNInfo.name,
        //       albumId: albumNInfo.id,
        //       songmid: item.songId,
        //       copyrightId: item.copyrightId,
        //       source: 'mg',
        //       interval: null,
        //       img: item.imgItems && item.imgItems.length ? item.imgItems[0].img : null,
        //       lrc: null,
        //       lrcUrl: item.lyricUrl,
        //       mrcUrl: item.mrcurl,
        //       trcUrl: item.trcUrl,
        //       otherSource: null,
        //       types,
        //       _types,
        //       typeUrl: {},
        //     })
        //   })
        //   return list
        // },
        musicSearch(str, page, limit) {
          const time = Date.now().toString();
          const signData = createSignature(time, str);
          const searchRequest = httpFetch(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`, {
            headers: {
              uiVersion: "A_music_3.6.1",
              deviceId: signData.deviceId,
              timestamp: time,
              sign: signData.sign,
              channel: "0146921",
              "User-Agent": "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"
            }
          });
          return searchRequest.promise.then(({ body }) => body);
        },
        filterData(rawData) {
          const list = [];
          const ids = /* @__PURE__ */ new Set();
          rawData.forEach((item) => {
            item.forEach((data) => {
              if (!data.songId || !data.copyrightId || ids.has(data.copyrightId)) return;
              ids.add(data.copyrightId);
              const types = [];
              const _types = {};
              data.audioFormats && data.audioFormats.forEach((type) => {
                let size;
                switch (type.formatType) {
                  case "PQ":
                    size = sizeFormate(type.asize ?? type.isize);
                    types.push({ type: "128k", size });
                    _types["128k"] = {
                      size
                    };
                    break;
                  case "HQ":
                    size = sizeFormate(type.asize ?? type.isize);
                    types.push({ type: "320k", size });
                    _types["320k"] = {
                      size
                    };
                    break;
                  case "SQ":
                    size = sizeFormate(type.asize ?? type.isize);
                    types.push({ type: "flac", size });
                    _types.flac = {
                      size
                    };
                    break;
                  case "ZQ24":
                    size = sizeFormate(type.asize ?? type.isize);
                    types.push({ type: "flac24bit", size });
                    _types.flac24bit = {
                      size
                    };
                    break;
                }
              });
              let img = data.img3 || data.img2 || data.img1 || null;
              if (img && !/https?:/.test(data.img3)) img = "http://d.musicapp.migu.cn" + img;
              list.push({
                singer: formatSingerName(data.singerList),
                name: data.name,
                albumName: data.album,
                albumId: data.albumId,
                songmid: data.songId,
                copyrightId: data.copyrightId,
                source: "mg",
                interval: formatPlayTime(data.duration),
                img,
                lrc: null,
                lrcUrl: data.lrcUrl,
                mrcUrl: data.mrcurl,
                trcUrl: data.trcUrl,
                types,
                _types,
                typeUrl: {}
              });
            });
          });
          return list;
        },
        search(str, page = 1, limit, retryNum = 0) {
          if (++retryNum > 3) return Promise.reject(new Error("try max num"));
          if (limit == null) limit = this.limit;
          return this.musicSearch(str, page, limit).then((result) => {
            if (!result || result.code !== "000000") return Promise.reject(new Error(result ? result.info : "搜索失败"));
            const songResultData = result.songResultData || { resultList: [], totalCount: 0 };
            let list = this.filterData(songResultData.resultList);
            if (list == null) return this.search(str, page, limit, retryNum);
            this.total = parseInt(songResultData.totalCount);
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return {
              list,
              allPage: this.allPage,
              limit,
              total: this.total,
              source: "mg"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/mg/songList.js
  var songList_default5;
  var init_songList5 = __esm({
    "src/musicSdk/mg/songList.js"() {
      "use strict";
      init_request();
      init_utils_index();
      init_musicInfo3();
      init_musicSearch5();
      init_utils4();
      songList_default5 = {
        _requestObj_tags: null,
        _requestObj_list: null,
        limit_list: 30,
        limit_song: 30,
        successCode: "000000",
        cachedDetailInfo: {},
        cachedUrl: {},
        sortList: [
          {
            name: "推荐",
            id: "15127315",
            tid: "recommend"
            // id: '1',
          }
          // {
          //   name: '最新',
          //   id: '15127272',
          //   tid: 'new',
          //   // id: '2',
          // },
        ],
        regExps: {
          list: /<li><div class="thumb">.+?<\/li>/g,
          listInfo: /.+data-original="(.+?)".*data-id="(\d+)".*<div class="song-list-name"><a\s.*?>(.+?)<\/a>.+<i class="iconfont cf-bofangliang"><\/i>(.+?)<\/div>/,
          // https://music.migu.cn/v3/music/playlist/161044573?page=1
          listDetailLink: /^.+\/playlist\/(\d+)(?:\?.*|&.*$|#.*$|$)/
        },
        tagsUrl: "https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release",
        // tagsUrl: 'https://app.c.nf.migu.cn/MIGUM3.0/v1.0/template/musiclistplaza-taglist/release',
        // tagsUrl: 'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/indexTagPage.do?needAll=0',
        getSongListUrl(sortId, tagId, page) {
          if (!tagId) {
            return `https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`;
          }
          return `https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=${page}&templateVersion=2&tagId=${tagId}`;
        },
        getSongListDetailUrl(id, page) {
          return `https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${this.limit_song}&playlistId=${id}`;
        },
        defaultHeaders: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
          Referer: "https://m.music.migu.cn/"
          // language: 'Chinese',
          // ua: 'Android_migu',
          // mode: 'android',
          // version: '6.8.5',
        },
        getListDetailList(id, page, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          const requestObj_listDetail = httpFetch(this.getSongListDetailUrl(id, page), { headers: this.defaultHeaders });
          return requestObj_listDetail.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getListDetailList(id, page, ++tryNum);
            return {
              list: filterMusicInfoListV5(body.data.songList),
              page,
              limit: this.limit_song,
              total: body.data.totalCount,
              source: "mg"
            };
          });
        },
        getListDetailInfo(id, tryNum = 0) {
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          if (this.cachedDetailInfo[id]) return Promise.resolve(this.cachedDetailInfo[id]);
          const requestObj_listDetailInfo = httpFetch(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`, {
            headers: this.defaultHeaders
          });
          return requestObj_listDetailInfo.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getListDetail(id, ++tryNum);
            const cachedDetailInfo = this.cachedDetailInfo[id] = {
              name: body.data.title,
              img: body.data.imgItem.img,
              desc: body.data.summary,
              author: body.data.ownerName,
              play_count: formatPlayCount(body.data.opNumItem.playNum)
            };
            return cachedDetailInfo;
          });
        },
        async getDetailUrl(link, page, retryNum = 0) {
          if (retryNum > 3) return Promise.reject(new Error("link try max num"));
          const requestObj_listDetailLink = httpFetch(link, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1",
              Referer: link
            }
          });
          const { url: location, statusCode } = await requestObj_listDetailLink.promise;
          if (statusCode > 400) return this.getDetailUrl(link, page, ++retryNum);
          if (location.split("?")[0] != link.split("?")[0]) {
            this.cachedUrl[link] = location;
            return this.getListDetail(location, page);
          }
          return Promise.reject(new Error("link get failed"));
        },
        getListDetail(id, page, retryNum = 0) {
          if (/\/playlist[/?]/.test(id)) {
            id = /(?:playlistId|id)=(\d+)/.exec(id)?.[1];
            if (!id) throw new Error("list detail id parse failed");
          } else if (this.regExps.listDetailLink.test(id)) {
            id = id.replace(this.regExps.listDetailLink, "$1");
          } else if (/[?&:/]/.test(id)) {
            const url = this.cachedUrl[id];
            return url ? this.getListDetail(url, page) : this.getDetailUrl(id, page);
          }
          return Promise.all([
            this.getListDetailList(id, page, retryNum),
            this.getListDetailInfo(id, retryNum)
          ]).then(([listData, info]) => {
            listData.info = info;
            return listData;
          });
        },
        // 获取列表数据
        getList(sortId, tagId, page, tryNum = 0) {
          if (this._requestObj_list) this._requestObj_list.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_list = httpFetch(this.getSongListUrl(sortId, tagId, page), {
            headers: this.defaultHeaders
            // headers: {
            //   sign: 'c3b7ae985e2206e97f1b2de8f88691e2',
            //   timestamp: 1578225871982,
            //   appId: 'yyapp2',
            //   mode: 'android',
            //   ua: 'Android_migu',
            //   version: '6.9.4',
            //   osVersion: 'android 7.0',
            //   'User-Agent': 'okhttp/3.9.1',
            // },
          });
          return this._requestObj_list.promise.then(({ body }) => {
            if (body.code !== "000000") return this.getList(sortId, tagId, page, ++tryNum);
            const list = body.data.contents ? this.filterList2(body.data.contents) : this.filterList(body.data.contentItemList[1].itemList);
            return {
              list,
              total: 99999,
              page,
              limit: this.limit_list,
              source: "mg"
            };
          });
        },
        filterList2(listData, list = [], ids = /* @__PURE__ */ new Set()) {
          for (const item of listData) {
            if (item.contents) this.filterList2(item.contents, list, ids);
            else if (item.resType == "2021" && !ids.has(item.resId)) {
              ids.add(item.resId);
              list.push({
                id: String(item.resId),
                author: "",
                name: item.txt,
                // time: dateFormat(item.createTime, 'Y-M-D'),
                img: item.img,
                // grade: item.grade,
                // total: item.contentCount,
                desc: item.txt2,
                source: "mg"
              });
            }
          }
          return list;
        },
        filterList(rawData) {
          return rawData.map((item) => ({
            play_count: item.barList[0]?.title,
            id: String(item.logEvent.contentId),
            author: "",
            name: item.title,
            // time: dateFormat(item.createTime, 'Y-M-D'),
            img: item.imageUrl,
            // grade: item.grade,
            // total: item.contentCount,
            desc: "",
            source: "mg"
          }));
        },
        // 获取标签
        getTag(tryNum = 0) {
          if (this._requestObj_tags) this._requestObj_tags.cancelHttp();
          if (tryNum > 2) return Promise.reject(new Error("try max num"));
          this._requestObj_tags = httpFetch(this.tagsUrl, { headers: this.defaultHeaders });
          return this._requestObj_tags.promise.then(({ body }) => {
            if (body.code !== this.successCode) return this.getTag(++tryNum);
            return this.filterTagInfo(body.data);
          });
        },
        filterTagInfo(rawList) {
          return {
            hotTag: rawList[0].content.map(({ texts: [name, id] }) => ({
              id,
              name,
              source: "mg"
            })),
            tags: rawList.slice(1).map(({ header, content }) => ({
              name: header.title,
              list: content.map(({ texts: [name, id] }) => ({
                // parent_id: objectInfo.columnId,
                // parent_name: objectInfo.columnTitle,
                id,
                name,
                source: "mg"
              }))
            })),
            source: "mg"
          };
        },
        getTags() {
          return this.getTag();
        },
        getDetailPageUrl(id) {
          if (/playlist\/index\.html\?/.test(id)) {
            id = id.replace(/.*(?:\?|&)id=(\d+)(?:&.*|$)/, "$1");
          } else if (this.regExps.listDetailLink.test(id)) {
            id = id.replace(this.regExps.listDetailLink, "$1");
          }
          return `https://music.migu.cn/v3/music/playlist/${id}`;
        },
        filterSongListResult(raw) {
          const list = [];
          raw.forEach((item) => {
            if (!item.id) return;
            const playCount = parseInt(item.playNum);
            list.push({
              play_count: isNaN(playCount) ? 0 : formatPlayCount(playCount),
              id: item.id,
              author: item.userName,
              name: item.name,
              img: item.musicListPicUrl,
              total: item.musicNum,
              source: "mg"
            });
          });
          return list;
        },
        search(text, page, limit = 20) {
          const timeStr = Date.now().toString();
          const signResult = createSignature(timeStr, text);
          return createHttpFetch(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`, {
            headers: {
              uiVersion: "A_music_3.6.1",
              deviceId: signResult.deviceId,
              timestamp: timeStr,
              sign: signResult.sign,
              channel: "0146921",
              "User-Agent": "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30"
            }
          }).then((body) => {
            if (!body.songListResultData) throw new Error("get song list faild.");
            const list = this.filterSongListResult(body.songListResultData.result);
            return {
              list,
              limit,
              total: parseInt(body.songListResultData.totalCount),
              source: "mg"
            };
          });
        }
      };
    }
  });

  // src/musicSdk/mg/pic.js
  var pic_default3;
  var init_pic3 = __esm({
    "src/musicSdk/mg/pic.js"() {
      "use strict";
      init_musicInfo3();
      pic_default3 = {
        async getPic(songInfo) {
          const info = await getMusicInfo(songInfo.songmid);
          return info.img;
        }
      };
    }
  });

  // src/musicSdk/mg/utils/mrc.js
  var DELTA, MIN_LENGTH, keyArr, teaDecrypt, longArrToString, longToBytes, toBigintArray, MAX, MIN, toLong, decrypt;
  var init_mrc = __esm({
    "src/musicSdk/mg/utils/mrc.js"() {
      "use strict";
      init_buffer();
      DELTA = 2654435769n;
      MIN_LENGTH = 32;
      keyArr = [
        27303562373562475n,
        18014862372307051n,
        22799692160172081n,
        34058940340699235n,
        30962724186095721n,
        27303523720101991n,
        27303523720101998n,
        31244139033526382n,
        28992395054481524n
      ];
      teaDecrypt = (data, key) => {
        const length = data.length;
        const lengthBitint = BigInt(length);
        if (length >= 1) {
          let j2 = data[0];
          let j3 = toLong((6n + 52n / lengthBitint) * DELTA);
          while (true) {
            let j4 = j3;
            if (j4 == 0n) break;
            let j5 = toLong(3n & toLong(j4 >> 2n));
            let j6 = lengthBitint;
            while (true) {
              j6--;
              if (j6 > 0n) {
                let j7 = data[j6 - 1n];
                let i = j6;
                j2 = toLong(data[i] - (toLong(toLong(j2 ^ j4) + toLong(j7 ^ key[toLong(toLong(3n & j6) ^ j5)])) ^ toLong(toLong(toLong(j7 >> 5n) ^ toLong(j2 << 2n)) + toLong(toLong(j2 >> 3n) ^ toLong(j7 << 4n)))));
                data[i] = j2;
              } else break;
            }
            let j8 = data[lengthBitint - 1n];
            j2 = toLong(data[0n] - toLong(toLong(toLong(key[toLong(toLong(j6 & 3n) ^ j5)] ^ j8) + toLong(j2 ^ j4)) ^ toLong(toLong(toLong(j8 >> 5n) ^ toLong(j2 << 2n)) + toLong(toLong(j2 >> 3n) ^ toLong(j8 << 4n)))));
            data[0] = j2;
            j3 = toLong(j4 - DELTA);
          }
        }
        return data;
      };
      longArrToString = (data) => {
        const arrayList = [];
        for (const j of data) arrayList.push(longToBytes(j).toString("utf16le"));
        return arrayList.join("");
      };
      longToBytes = (l) => {
        const result = Buffer2.alloc(8);
        for (let i = 0; i < 8; i++) {
          result[i] = parseInt(l & 0xFFn);
          l >>= 8n;
        }
        return result;
      };
      toBigintArray = (data) => {
        const length = Math.floor(data.length / 16);
        const jArr = Array(length);
        for (let i = 0; i < length; i++) {
          jArr[i] = toLong(data.substring(i * 16, i * 16 + 16));
        }
        return jArr;
      };
      MAX = 9223372036854775807n;
      MIN = -9223372036854775808n;
      toLong = (str) => {
        const num = typeof str == "string" ? BigInt("0x" + str) : str;
        if (num > MAX) return toLong(num - (1n << 64n));
        else if (num < MIN) return toLong(num + (1n << 64n));
        return num;
      };
      decrypt = (data) => {
        return data == null || data.length < MIN_LENGTH ? data : longArrToString(teaDecrypt(toBigintArray(data), keyArr));
      };
    }
  });

  // src/musicSdk/mg/lyric.js
  var mrcTools, lyric_default5;
  var init_lyric5 = __esm({
    "src/musicSdk/mg/lyric.js"() {
      "use strict";
      init_request();
      init_musicInfo3();
      init_mrc();
      mrcTools = {
        rxps: {
          lineTime: /^\s*\[(\d+),\d+\]/,
          wordTime: /\(\d+,\d+\)/,
          wordTimeAll: /(\(\d+,\d+\))/g
        },
        parseLyric(str) {
          str = str.replace(/\r/g, "");
          const lines = str.split("\n");
          const lxlrcLines = [];
          const lrcLines = [];
          for (const line of lines) {
            if (line.length < 6) continue;
            let result = this.rxps.lineTime.exec(line);
            if (!result) continue;
            const startTime = parseInt(result[1]);
            let time = startTime;
            let ms = (time % 1e3).toString().padStart(3, "0");
            time /= 1e3;
            let m = parseInt(time / 60).toString().padStart(2, "0");
            time %= 60;
            let s = parseInt(time).toString().padStart(2, "0");
            time = `${m}:${s}.${ms}`;
            let words = line.replace(this.rxps.lineTime, "");
            lrcLines.push(`[${time}]${words.replace(this.rxps.wordTimeAll, "")}`);
            let times = words.match(this.rxps.wordTimeAll);
            if (!times) continue;
            times = times.map((time2) => {
              const result2 = /\((\d+),(\d+)\)/.exec(time2);
              return `<${Math.trunc(parseInt(result2[1]) - startTime)},${result2[2]}>`;
            });
            const wordArr = words.split(this.rxps.wordTime);
            const newWords = times.map((time2, index) => `${time2}${wordArr[index]}`).join("");
            lxlrcLines.push(`[${time}]${newWords}`);
          }
          return {
            lyric: lrcLines.join("\n"),
            lxlyric: lxlrcLines.join("\n")
          };
        },
        getText(url, tryNum = 0) {
          const requestObj = httpFetch(url, {
            headers: {
              Referer: "https://app.c.nf.migu.cn/",
              "User-Agent": "Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36",
              channel: "0146921"
            }
          });
          return requestObj.promise.then(({ statusCode, body }) => {
            if (statusCode == 200) return body;
            if (tryNum > 5 || statusCode == 404) return Promise.reject(new Error("歌词获取失败"));
            return this.getText(url, ++tryNum);
          });
        },
        getMrc(url) {
          return this.getText(url).then((text) => {
            return this.parseLyric(decrypt(text));
          });
        },
        getLrc(url) {
          return this.getText(url).then((text) => ({ lxlyric: "", lyric: text }));
        },
        getTrc(url) {
          if (!url) return Promise.resolve("");
          return this.getText(url);
        },
        async getMusicInfo(songInfo) {
          return songInfo.mrcUrl == null ? getMusicInfo(songInfo.songmid) : songInfo;
        },
        getLyric(songInfo) {
          return {
            promise: this.getMusicInfo(songInfo).then((info) => {
              let p;
              if (info.mrcUrl) p = this.getMrc(info.mrcUrl);
              else if (info.lrcUrl) p = this.getLrc(info.lrcUrl);
              if (p == null) return Promise.reject(new Error("获取歌词失败"));
              return Promise.all([p, this.getTrc(info.trcUrl)]).then(([lrcInfo, tlyric]) => {
                lrcInfo.tlyric = tlyric;
                return lrcInfo;
              });
            }),
            cancelHttp() {
            }
          };
        }
      };
      lyric_default5 = {
        getLyric(songInfo) {
          let requestObj = mrcTools.getLyric(songInfo);
          return requestObj;
        }
      };
    }
  });

  // src/musicSdk/mg/hotSearch.js
  var hotSearch_default5;
  var init_hotSearch5 = __esm({
    "src/musicSdk/mg/hotSearch.js"() {
      "use strict";
      init_request();
      hotSearch_default5 = {
        _requestObj: null,
        async getList(retryNum = 0) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (retryNum > 2) return Promise.reject(new Error("try max num"));
          const _requestObj = httpFetch("http://jadeite.migu.cn:7090/music_search/v3/search/hotword");
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== "000000") throw new Error("获取热搜词失败");
          return { source: "mg", list: this.filterList(body.data.hotwords[0].hotwordList) };
        },
        filterList(rawList) {
          return rawList.filter((item) => item.resourceType == "song").map((item) => item.word);
        }
      };
    }
  });

  // src/musicSdk/mg/songId.js
  var getSongId, songId_default;
  var init_songId = __esm({
    "src/musicSdk/mg/songId.js"() {
      "use strict";
      init_musicInfo3();
      getSongId = async (mInfo) => {
        if (mInfo.songmid != mInfo.copyrightId) return mInfo.songmid;
        const musicInfo = await getMusicInfo(mInfo.songmid);
        return musicInfo.songmid;
      };
      songId_default = getSongId;
    }
  });

  // src/musicSdk/mg/comment.js
  var comment_default5;
  var init_comment5 = __esm({
    "src/musicSdk/mg/comment.js"() {
      "use strict";
      init_request();
      init_songId();
      init_utils_index();
      comment_default5 = {
        _requestObj: null,
        _requestObj2: null,
        _requestObj3: null,
        lastCommentIds: /* @__PURE__ */ new Map(),
        async getComment(musicInfo, page = 1, limit = 20) {
          if (this._requestObj) this._requestObj.cancelHttp();
          if (!musicInfo.songId) {
            let id = await songId_default(musicInfo);
            if (!id) throw new Error("获取评论失败");
            musicInfo.songId = id;
          }
          if (page === 1) this.lastCommentIds.clear();
          const lastCommentId = this.lastCommentIds.get(String(page)) || "";
          if (!lastCommentId && page > 1) throw new Error("获取评论失败");
          const _requestObj = httpFetch(`https://app.c.nf.migu.cn/MIGUM3.0/user/comment/stack/v1.0?pageSize=${limit}&queryType=1&resourceId=${musicInfo.songId}&resourceType=2&commentId=${lastCommentId}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"
              // Referer: 'https://music.migu.cn',
            }
          });
          const { body, statusCode } = await _requestObj.promise;
          if (statusCode != 200 || body.code !== "000000") throw new Error("获取评论失败");
          const total = parseInt(body.data.commentNums);
          const list = this.filterComment(body.data.comments);
          this.lastCommentIds.set(String(page + 1), list.length ? list[list.length - 1].id : "");
          return { source: "mg", comments: list, total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        async getHotComment(musicInfo, page = 1, limit = 20) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          if (!musicInfo.songId) {
            let id = await songId_default(musicInfo);
            if (!id) throw new Error("获取评论失败");
            musicInfo.songId = id;
          }
          const _requestObj2 = httpFetch(`https://app.c.nf.migu.cn/MIGUM3.0/user/comment/stack/v1.0?pageSize=${limit}&queryType=2&resourceId=${musicInfo.songId}&resourceType=2&hotCommentStart=${(page - 1) * limit}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"
              // Referer: 'https://music.migu.cn',
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.code !== "000000") throw new Error("获取热门评论失败");
          const total = parseInt(body.data.cfgHotCount);
          return { source: "mg", comments: this.filterComment(body.data.hotComments), total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        async getReplyComment(musicInfo, replyId, page = 1, limit = 10) {
          if (this._requestObj2) this._requestObj2.cancelHttp();
          const _requestObj2 = httpFetch(`https://app.c.nf.migu.cn/MIGUM3.0/user/comment/stack/${replyId}/v1.0?pageSize=${limit}&queryType=2&resourceId=${musicInfo.songId}&resourceType=2&start=${(page - 1) * limit}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"
            }
          });
          const { body, statusCode } = await _requestObj2.promise;
          if (statusCode != 200 || body.code !== "000000") throw new Error("获取回复评论失败");
          const total = parseInt(body.data.replyTotalCount);
          return { source: "mg", comments: this.filterComment(body.data.mainCommentItem.replyComments), total, page, limit, maxPage: Math.ceil(total / limit) || 1 };
        },
        filterComment(rawList) {
          return rawList.map((item) => ({
            id: item.commentId,
            text: item.commentInfo,
            time: item.commentTime,
            timeStr: dateFormat2(new Date(item.commentTime).getTime()),
            userName: item.user.nickName,
            avatar: item.user.middleIcon || item.user.bigIcon || item.user.smallIcon,
            userId: item.user.userId,
            likedCount: item.opNumItem.thumbNum,
            replyNum: item.replyTotalCount,
            reply: item.replyComments.map((c) => ({
              id: c.replyId,
              text: c.replyInfo,
              time: c.replyTime,
              timeStr: dateFormat2(new Date(c.replyTime).getTime()),
              userName: c.user.nickName,
              avatar: c.user.middleIcon || c.user.bigIcon || c.user.smallIcon,
              userId: c.user.userId,
              likedCount: null,
              replyNum: null
            }))
          }));
        }
      };
    }
  });

  // src/musicSdk/mg/index.js
  var mg, mg_default;
  var init_mg = __esm({
    "src/musicSdk/mg/index.js"() {
      "use strict";
      init_api_source();
      init_leaderboard5();
      init_songList5();
      init_musicSearch5();
      init_pic3();
      init_lyric5();
      init_hotSearch5();
      init_comment5();
      mg = {
        // tipSearch,
        songList: songList_default5,
        musicSearch: musicSearch_default5,
        leaderboard: leaderboard_default5,
        hotSearch: hotSearch_default5,
        comment: comment_default5,
        getMusicUrl(songInfo, type) {
          return apis("mg").getMusicUrl(songInfo, type);
        },
        getLyric(songInfo) {
          return lyric_default5.getLyric(songInfo);
        },
        getPic(songInfo) {
          return pic_default3.getPic(songInfo);
        },
        getMusicDetailPageUrl(songInfo) {
          return `http://music.migu.cn/v3/music/song/${songInfo.copyrightId}`;
        }
      };
      mg_default = mg;
    }
  });

  // src/entry.js
  var require_entry = __commonJS({
    "src/entry.js"() {
      init_kw();
      init_kg();
      init_tx();
      init_wy();
      init_mg();
      init_api_source();
      globalThis.__LX_SDK = { kw: kw_default, kg: kg_default, tx: tx_default, wy: wy_default, mg: mg_default, supportQuality };
      globalThis.__LX_SDK_INITED = false;
    }
  });
  require_entry();
})();
/*! Bundled license information:

crypto-js/ripemd160.js:
  (** @preserve
  	(c) 2012 by Cédric Mesnil. All rights reserved.
  
  	Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
  
  	    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
  	    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
  
  	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  	*)

crypto-js/mode-ctr-gladman.js:
  (** @preserve
   * Counter block mode compatible with  Dr Brian Gladman fileenc.c
   * derived from CryptoJS.mode.CTR
   * Jan Hruby jhruby.web@gmail.com
   *)
*/

// __LX_SDK_CORE_END

const { EVENT_NAMES, request, on, send } = globalThis.lx
const SDK = globalThis.__LX_SDK
const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg']
// 宿主探测：iBox 引擎提供 __lxRequestSync 同步原语；洛雪客户端走标准 lx.request（shim 已双端适配）
const IS_IBOX = typeof __lxRequestSync === 'function'

// musicSdk 运行时环境（getMusicType 读取；壳内先行补齐，不覆盖引擎的 lx API 其余字段）
try {
  if (!globalThis.lx.qualityList) {
    globalThis.lx.qualityList = {
      kw: ['flac24bit', 'flac', '320k', '128k'],
      kg: ['flac', '320k', '128k'],
      tx: ['flac', '320k', '128k'],
      wy: ['flac', '320k', '128k'],
      mg: ['flac', '320k', '128k'],
    }
  }
} catch (e) {}

// 各平台取链主键：洛雪语义 kw/wy/tx=songmid、kg=hash、mg=copyrightId（宿主 vod_id 同语义编码）
function rowKey(source, s) {
  if (source === 'kg') return s.hash || s.songmid || ''
  if (source === 'mg') return s.copyrightId || s.songmid || ''
  return s.songmid || ''
}

// musicSdk 行 → 宿主 vod_* 行（vod_id 点播 / vod_remarks 歌手 / vod_content 专辑 / vod_duration 秒）
function songRow(source, s) {
  const key = rowKey(source, s)
  return {
    vod_id: source + '_' + key,
    vod_name: s.name || s.title || '',
    vod_pic: s.img || '',
    vod_remarks: s.singer || '',
    vod_content: s.albumName || '',
    vod_duration: str2secs(s.interval),
  }
}

function str2secs(text) {
  if (!text) return 0
  if (typeof text === 'number') return text
  const m = String(text).match(/(\d+):(\d+)/)
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

// 取链/歌词入参（mobile musicSdk 的 songInfo 形状；_types 保底防空读）
function songInfo(source, id, type) {
  const mi = { songmid: id, source, type: type || '320k', _types: {}, types: [] }
  if (source === 'kg') mi.hash = id
  if (source === 'mg') mi.copyrightId = id
  return mi
}

function need(source) {
  const mod = SDK && SDK[source]
  if (!mod) throw new Error('洛雪内核未包含平台: ' + source)
  return mod
}

// musicSdk 部分接口返回 httpFetch 原样对象（{promise,...}）而非 Promise——统一解包
function asPromise(v) {
  if (v && typeof v.then === 'function') return v
  if (v && v.promise && typeof v.promise.then === 'function') return v.promise
  return Promise.resolve(v)
}

// 五平台取链模块（六音聚合，MIT © Lincoln；经 IIFE 捕获注册）
function soundHandler() {
  const h = globalThis.__PANBOX_SOUND
  if (!h) throw new Error('取链模块未就绪')
  return h
}

on(EVENT_NAMES.request, function (req) {
  // 同步段异常转 rejection（带 message 上抛引擎，QuickJS 裸异常无信息）
  try {
    return handle(req)
  } catch (e) {
    return Promise.reject(new Error(String((e && e.message) || e)))
  }
})

function handle(req) {
  const source = req.source
  const action = req.action
  // 内容站适配器（蜻蜓/听友）：整源路由到子模块 handler
  if (source === 'panbox_qtfm') {
    const h = globalThis.__PANBOX_QTFM
    if (!h) return Promise.reject(new Error('蜻蜓电台模块未就绪'))
    return asPromise(h(req))
  }
  if (source === 'panbox_tingyou') {
    const h = globalThis.__PANBOX_TINGYOU
    if (!h) return Promise.reject(new Error('听友音乐模块未就绪'))
    return asPromise(h(req))
  }
  const mod = need(source)
  // 五平台取链走音源模块（六音聚合）；歌词/浏览走内核
  if (action === 'musicUrl') {
    return asPromise(soundHandler()(req))
  }
  const info = req.info || {}
  switch (action) {
    case 'musicUrl': {
      const id = (info.musicInfo && info.musicInfo.songmid) || ''
      return asPromise(mod.getMusicUrl(songInfo(source, id, info.type), info.type || '320k'))
    }
    case 'lyric': {
      const id = (info.musicInfo && info.musicInfo.songmid) || ''
      // isGetLyricx=true：kw 服务端总回 lrcx 加密体（无视 lrcx 参数），须走解密分支
      return asPromise(mod.getLyric(songInfo(source, id), true)).then(function (l) {
        return (l && l.lyric) || ''
      }).catch(function (e) {
        throw new Error(String((e && e.message) || e))
      })
    }
    case 'search': {
      return mod.musicSearch.search(String(info.wd || ''), Number(info.page) || 1).then(function (r) {
        const total = r.total || 0
        const limit = r.limit || 30
        return {
          list: (r.list || []).map(function (s) { return songRow(source, s) }),
          total: total,
          page: Number(info.page) || 1,
          pagecount: Math.max(1, Math.ceil(total / limit)),
        }
      }).catch(function (e) {
        // tx 高频搜索会触发 QQ 限流（自动重试放大请求量）——给出明确恢复指引
        if (source === 'tx' && String((e && e.message) || e).indexOf('搜索失败') > -1) {
          throw new Error('QQ 搜索暂时受限（频率保护），请稍等片刻后重试')
        }
        throw e
      })
    }
    case 'home': {
      return mod.leaderboard.getBoards().then(function (r) {
        // bangid=裸榜单 id（如 kg "8888"）；id 是洛雪全局标识（"kg__8888"）——宿主回传要裸 id
        return { class: (r.list || []).map(function (b) { return { type_id: String(b.bangid || b.id), type_name: b.name || '' } }) }
      })
    }
    case 'category': {
      return mod.leaderboard.getList(String(info.cate || ''), Number(info.page) || 1).then(function (r) {
        return {
          list: (r.list || []).map(function (s) { return songRow(source, s) }),
          total: r.total || 0,
          page: Number(info.page) || 1,
        }
      })
    }
    case 'playlist_cats': {
      // 歌单分类：hotTag+tags 扁平去重（上游 getTags 返回 {hotTag:[{id,name}], tags:[{name,list:[{id,name}]}]}）
      return asPromise(mod.songList.getTags()).then(function (r) {
        const flat = [{ type_id: '', type_name: '全部' }]
        const seen = {}
        const push = function (id, name) {
          const k = String(id)
          if (!k || seen[k]) return
          seen[k] = 1
          flat.push({ type_id: k, type_name: name || '' })
        }
        for (const t of (r.hotTag || [])) push(t.id, t.name)
        for (const g of (r.tags || [])) for (const t of (g.list || [])) push(t.id, t.name)
        return { class: flat }
      })
    }
    case 'playlist_list': {
      // 歌单广场：sortId 固定最热(6)；cate=分类标签 id（空=全部）；行 id 保持 "id_<specialid>"（getListDetail 消费该前缀）
      let cate = String(info.cate || '')
      if (cate === '全部') cate = '' // 前端初始 tab 名字面量，视作全部分类（防御）
      return asPromise(mod.songList.getList('6', cate, Number(info.page) || 1)).then(function (r) {
        const total = r.total || 0
        return {
          list: (r.list || []).map(function (p) {
            return {
              vod_id: p.id || '',
              vod_name: p.name || '',
              vod_pic: p.img || '',
              vod_remarks: p.author || '',
              vod_content: p.desc || '',
            }
          }),
          total: total,
          page: Number(info.page) || 1,
        }
      })
    }
    case 'playlist_detail': {
      return asPromise(mod.songList.getListDetail(String(info.id || ''), 1)).then(function (r) {
        return {
          list: (r.list || []).map(function (s) { return songRow(source, s) }),
          info: {
            name: (r.info && r.info.name) || '',
            img: (r.info && r.info.img) || '',
            desc: (r.info && r.info.desc) || '',
          },
        }
      })
    }
    default:
      return Promise.reject(new Error('洛雪音乐源不支持 action: ' + action))
  }
}

// inited 声明按宿主分流：iBox 引擎声明 7 key（含内容站扩展）；
// 洛雪客户端 sources 白名单只认五平台且 actions 仅 musicUrl/lyric——按其规范声明（内容站在洛雪无浏览承载位）
const SOUND_ACTIONS = ['musicUrl', 'lyric']
const BROWSE_ACTIONS = ['home', 'category', 'search', 'playlist_cats', 'playlist_list', 'playlist_detail']
const FIVE = ['kw', 'kg', 'tx', 'wy', 'mg']
const NAMES = { kw: '酷我音乐', kg: '酷狗音乐', tx: 'QQ音乐', wy: '网易云音乐', mg: '咪咕音乐' }
const QUALITYS = { kw: ['flac24bit', 'flac', '320k', '128k'], kg: ['flac', '320k', '128k'], tx: ['flac', '320k', '128k'], wy: ['flac', '320k', '128k'], mg: ['flac', '320k', '128k'] }

const declared = {}
for (const s of FIVE) {
  declared[s] = {
    name: NAMES[s], type: 'music',
    actions: IS_IBOX ? ['musicUrl', ...SOUND_ACTIONS.slice(1), ...BROWSE_ACTIONS] : SOUND_ACTIONS,
    qualitys: QUALITYS[s],
  }
}
if (IS_IBOX) {
  declared.panbox_qtfm = { name: '蜻蜓电台', type: 'music', actions: ['musicUrl', ...BROWSE_ACTIONS], qualitys: ['128k'] }
  declared.panbox_tingyou = { name: '听友音乐', type: 'music', actions: ['musicUrl', ...BROWSE_ACTIONS, 'detail'], qualitys: ['128k'] }
}

send(EVENT_NAMES.inited, { status: true, sources: declared })
