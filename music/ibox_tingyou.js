/**
 * @name 听友音乐
 * @description 听友FM音乐模块：分类/专辑/曲目/直链
 * @version 1.1.0
 * @author iBox
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
const { EVENT_NAMES, request, on, send } = globalThis.lx

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
    ibox_tingyou: {
      name: '听友音乐',
      type: 'music',
      actions: ['musicUrl', 'home', 'category', 'search', 'detail', 'playlist_cats', 'playlist_list', 'playlist_detail', 'lyric'],
      qualitys: ['128k'],
    },
  },
})
