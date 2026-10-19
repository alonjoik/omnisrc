// SK3.0（SKAPP）影视后端族 — tpl/sk.js（看客/嘶喱等 appSK 族共用，ext 区分）
// 链路：domain 中转取真实 host → POST /get_config {sign: md5(key+iv)} 换 JWT → sk-api 全套
// 响应解密：FROMSKZZJM 前缀 + hex(AES-128-CBC(key,iv))；列表/搜索/详情/播放全加密
// 播放：vod_play_url 集 url 为 NBY-XMYAES 加密标识 → /sk-api/vod/skjson?url= 解直链
// ext = {"domain":"https://kankelm.cn:2024/appdomain.txt","key":"...","iv":"...","sign":"..."}
var EXT = {};
try {
    var __ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
    if (__ej && typeof __ej === 'object') EXT = __ej;
} catch (e) {}
if (!EXT.key) { EXT.key = 'ygcnbcvybqqckwqy'; EXT.iv = '1583560747143708'; EXT.sign = '0c40a3da8412365fda8e31415dbaa21f'; EXT.domain = 'https://kankelm.cn:2024/appdomain.txt'; }

var rule = {
    title: '看客',
    host: '',
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,
    headers: { 'User-Agent': 'Dart/2.10 (dart:io)' },
    searchUrl: '/sk-api/search/pages?keyword=**&page=1&limit=12&typeId=-1',
    // 函数式一级必须带 url 模板（host.category 前置 tplUrl）
    url: '/sk-api/vod/list',
    __host: '',
    __token: '',

    hex2b64: function (h) {
        var cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var out = '';
        for (var i = 0; i < h.length; i += 6) {
            var b0 = parseInt(h.substr(i, 2), 16);
            var b1 = i + 2 < h.length ? parseInt(h.substr(i + 2, 2), 16) : 0;
            var b2 = i + 4 < h.length ? parseInt(h.substr(i + 4, 2), 16) : 0;
            out += cs.charAt(b0 >> 2) + cs.charAt(((b0 & 3) << 4) | (b1 >> 4));
            out += i + 2 < h.length ? cs.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=';
            out += i + 4 < h.length ? cs.charAt(b2 & 63) : '=';
        }
        return out;
    },

    // FROMSKZZJM + hex(AES-CBC) → 明文
    skdec: function (s) {
        s = String(s || '');
        if (s.indexOf('FROMSKZZJM') !== 0) return s;
        var b64 = this.hex2b64(s.slice(10));
        var pt = __aesCbcDecrypt(b64, EXT.key, EXT.iv);
        if (pt.indexOf('__ERR__') === 0) throw new Error('SK解密失败: ' + pt);
        return pt;
    },

    // 真实 host + JWT（引擎实例内缓存）
    init2: function () {
        if (this.__host) return;
        var dom = EXT.domain || '';
        var host = dom.indexOf('http') === 0 ? request(dom, { headers: { 'User-Agent': this.headers['User-Agent'] } }).content.trim() : dom;
        if (!/https?:\/\//.test(host)) throw new Error('SK host 获取失败');
        this.__host = host.replace(/\/+$/, '');
        var sign = EXT.sign || md5(EXT.key + EXT.iv);
        var r = request(this.__host + '/get_config', {
            method: 'POST',
            headers: { 'User-Agent': this.headers['User-Agent'], 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ sign: sign, ck: '' }),
        });
        var token = this.skdec(r.content);
        if (!token) throw new Error('SK token 获取失败');
        this.__token = token;
    },

    // 加密 GET
    api: function (path) {
        this.init2();
        var r = request(this.__host + path, {
            headers: { 'User-Agent': this.headers['User-Agent'], 'authorization': 'Bearer ' + this.__token },
        });
        if (!r.ok) throw new Error('SK HTTP ' + r.status + ' ' + path.slice(0, 40));
        var v = JSON.parse(this.skdec(r.content));
        if (String(v.code) !== '200' && v.code !== 1) throw new Error('SK API ' + v.code + ' ' + (v.msg || ''));
        return v;
    },

    card: function (v) {
        return {
            title: v.vod_name || '',
            img: v.vod_pic || '',
            desc: v.vod_remarks || '',
            url: String(v.vod_id || ''),
            content: String(v.vod_blurb || '').slice(0, 300),
        };
    },

    class_parse: function () {
        var v = this.api('/sk-api/type/list');
        var cls = [];
        var data = v.data || [];
        for (var i = 0; i < data.length; i++) {
            if (data[i] && typeof data[i] === 'object' && data[i].type_id !== undefined) {
                cls.push({ type_id: String(data[i].type_id), type_name: data[i].type_name || '' });
            }
        }
        return { class: cls };
    },

    一级: function () {
        var v = this.api('/sk-api/vod/list?typeId=' + encodeURIComponent(this.MY_CATE || '1') +
            '&page=' + (this.MY_PAGE || 1) + '&limit=18&type=updateTime&area=&lang=&year=&mtype=&extendtype=');
        var d = [];
        (v.data || []).forEach(function (it) { d.push(__skCard(it)); });
        return d;
    },

    搜索: function () {
        var v = this.api('/sk-api/search/pages?keyword=' + encodeURIComponent(this.wd || '') + '&page=1&limit=12&typeId=-1');
        var d = [];
        (v.data || []).forEach(function (it) { d.push(__skCard(it)); });
        return d;
    },

    二级: function () {
        var v = this.api('/sk-api/vod/one?vodId=' + encodeURIComponent(this.input));
        var d = v.data || {};
        var pu = String(d.vod_play_url || '');
        var pf = String(d.vod_play_from || '');
        if (!pu) throw new Error('看客 无播放数据');
        return {
            vod_id: this.input,
            vod_name: d.vod_name || '',
            vod_pic: d.vod_pic || '',
            vod_remarks: d.vod_remarks || '',
            vod_content: String(d.vod_content || d.vod_blurb || '').slice(0, 500),
            vod_play_from: pf.replace(/\$\$\$/g, '$$$') || '看客',
            vod_play_url: pu,
        };
    },

    lazy: function () {
        // input = 集 url（NBY-XMYAES 加密标识）
        var id = String(this.input);
        if (/^https?:\/\//.test(id) && /\.(m3u8|mp4|flv)/.test(id)) {
            return JSON.stringify({ parse: 0, url: id });
        }
        var v = this.api('/sk-api/vod/skjson?url=' + encodeURIComponent(id) + '&skjsonindex=0');
        var url = (v.data || {}).url || '';
        if (!url) throw new Error('看客 解析失败');
        return JSON.stringify({
            parse: 0, url: url,
            header: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1' },
        });
    },
}

function __skCard(v) {
    return {
        title: v.vod_name || '',
        img: v.vod_pic || '',
        desc: v.vod_remarks || '',
        url: String(v.vod_id || ''),
        content: String(v.vod_blurb || '').slice(0, 300),
    };
}
