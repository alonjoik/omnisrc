// appv7.js — WexAppV7 appv7 协议模板(秒播族 8 站共用;批次B 自 PanBox 壳 panboxjs 迁入,rule 形态)
// 协议(jadx 反编译 WexAppV7.java + merge/i/a.java,全链 PC 实测验证):
//   1. GET {crypto}?action=config&key={config} → {data:{host,version,pk_id,sign_md5,apk_length,user_agent,...}}
//   2. POST {crypto}?action=encrypt  {key,raw:JSON{method,data,csrf}} → {body:密文}
//   3. POST {host}/v7/logs  body=密文 + 特征头(pk-id/version/build-time/...) → gzip → 密文文本
//   4. POST {crypto}?action=decrypt {key,raw:密文} → {data:{...}}(响应若直接 JSON 则免 decrypt)
//   方法:nav(分类) / video_list(列表) / search(搜索) / video_detail(详情,带sign_md5+apk_path伪装)
//   集数:vod_url_with_player[].url 按#拆集,每集 `名$flag`;flag 载体——PanBox 壳内 AES-ECB-PKCS7
//   b64(与原 App 一致),第三方宿主降级 base64(JSON);play 双尝试解码。
//   播放:解密 JSON 取 url;非 http 走 parse_api GET(响应非 http/{/[ 时 parse_decrypt 兜底)
// ext: {"config":"AppV7Dsx"}
var AV7_CRYPTO = 'http://103.36.222.35:9595/wexfnwshinidie/appv7/crypto.php';
var AV7_EPKEY = '0123456789abcdef';
var AV7_UA_DEF = 'Dart/3.11 (dart:io)';
var AV7_CACHE = null;

// 网络双通道:PanBox 壳 __reqRaw(返回 {ok,status,content});drpy 公共面 request(返回 {content,headers,status})
function av7_req(url, opt) {
    opt = opt || {};
    if (typeof __reqRaw !== 'undefined') {
        var r = JSON.parse(__reqRaw(url, JSON.stringify(opt)));
        return { ok: !!r.ok, status: r.status || 0, content: String(r.content || '') };
    }
    var r2 = request(url, opt);
    return { ok: (r2.status || 0) >= 200 && (r2.status || 0) < 300, status: r2.status || 0, content: String(r2.content || '') };
}

function av7_ext() {
    try {
        return JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}') || {};
    } catch (e) { return {}; }
}

function av7_init() {
    if (AV7_CACHE) return AV7_CACHE;
    var key = av7_ext().config || 'AppV7Dsx';
    var r = av7_req(AV7_CRYPTO + '?action=config&key=' + encodeURIComponent(key), '{}');
    if (!r.ok) throw new Error('config HTTP ' + r.status);
    var d = JSON.parse(r.content);
    if (d.error) throw new Error('config: ' + d.error);
    var cfg = d.data || {};
    if (!cfg.host) throw new Error('config empty: ' + key);
    AV7_CACHE = { key: key, cfg: cfg };
    return AV7_CACHE;
}

function av7_post(action, payload) {
    var st = av7_init();
    var r = av7_req(AV7_CRYPTO + '?action=' + action, {
        method: 'POST',
        body: JSON.stringify({ key: st.key, raw: payload }),
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    });
    if (!r.ok) throw new Error(action + ' HTTP ' + r.status);
    return JSON.parse(r.content);
}

function av7_logs(method, data) {
    var st = av7_init();
    var cfg = st.cfg;
    var enc = av7_post('encrypt', JSON.stringify({ method: method, data: data, csrf: Date.now() }));
    var body = enc.body || '';
    if (!body) throw new Error(cfg.pk_id + ' encrypt empty');
    var host = String(cfg.host).replace(/\/+$/, '');
    var h = {
        'user-agent': cfg.user_agent || AV7_UA_DEF,
        'version': cfg.version || '',
        'version-number': cfg.version_number || '',
        'content-type': 'text/plain',
        'pk-id': cfg.pk_id || '',
        'build-time': cfg.build_time || '',
        'platform': cfg.platform || 'android',
        'platform-version': cfg.platform_version || 'TP1A.220624.014',
    };
    var r = av7_req(host + '/v7/logs', { method: 'POST', body: body, headers: h });
    var txt = String(r.content || '').trim();
    if (txt.charAt(0) === '{') { try { return JSON.parse(txt); } catch (e) { } }
    var d = av7_post('decrypt', txt);
    if (d && typeof d === 'object' && d.data) return d.data;
    if (d && typeof d === 'object' && typeof d.text === 'string' && d.text) {
        try { return JSON.parse(d.text); } catch (e) { return d; }
    }
    // 服务端偶发抖动(响应密文+decrypt 空):重试一次
    var enc2 = av7_post('encrypt', JSON.stringify({ method: method, data: data, csrf: Date.now() }));
    var body2 = enc2.body || '';
    if (body2) {
        var r2 = av7_req(host + '/v7/logs', { method: 'POST', body: body2, headers: h });
        var t2 = String(r2.content || '').trim();
        try { var j2 = JSON.parse(t2); if (j2) return j2; } catch (e) { }
        var d2 = av7_post('decrypt', t2);
        if (d2 && typeof d2 === 'object' && d2.data) return d2.data;
        if (d2 && typeof d2 === 'object' && typeof d2.text === 'string' && d2.text) {
            try { return JSON.parse(d2.text); } catch (e) { return d2; }
        }
    }
    var dbg = txt.slice(0, 40).replace(/[^\x20-\x7e]/g, function (c) { return '<' + c.charCodeAt(0) + '>'; });
    throw new Error((cfg.pk_id || '') + ' ' + method + ' decrypt empty st=' + r.status + ' len=' + txt.length + ' head=' + dbg);
}

// j() 等价:GET 解析(响应非 http/{/[ 时 parse_decrypt 兜底)
function av7_parseGet(url) {
    var cfg = av7_init().cfg;
    var r = av7_req(url, { headers: { 'user-agent': cfg.user_agent || AV7_UA_DEF, 'accept-encoding': 'gzip' } });
    var t = String(r.content || '').trim();
    var c0 = t.charAt(0);
    if (c0 !== '{' && c0 !== '[' && t.indexOf('http') !== 0) {
        var d = av7_post('parse_decrypt', t);
        var txt = (d && typeof d === 'object') ? String(d.text || '') : '';
        if (txt) return txt;
    }
    return t;
}

function av7_arr(o, k) { var a = o && o[k]; return a && a.length ? a : []; }

function av7_vod(j) {
    return {
        vod_id: String(j.vod_id || ''),
        vod_name: j.vod_name || '',
        vod_pic: j.vod_pic || '',
        vod_remarks: j.vod_remarks || '',
    };
}

function av7_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ''), desc: v.vod_remarks || '' };
    });
}

// 集数 flag 编码:壳内 AES-ECB b64(原 App 协议),第三方宿主 base64(JSON) 降级
function av7_flagEnc(metaStr) {
    if (typeof __aesEcbEncryptB64 !== 'undefined') return __aesEcbEncryptB64(metaStr, AV7_EPKEY);
    return base64Encode(metaStr);
}

var AV7_API = {
    home: function () {
        var r = av7_logs('nav', { token: '' });
        var cats = av7_arr(r, 'data').map(function (t) {
            return { type_id: String(t.type_id), type_name: t.type_name || '' };
        });
        return { class: cats };
    },
    category: function (args) {
        var tid = parseInt(args[0], 10) || 1;
        var pg = parseInt(args[1], 10) || 1;
        var fl = args[3] || {};
        var r = av7_logs('video_list', {
            token: '', pg: pg, tid: tid,
            class: fl.class || '', area: fl.area || '', lang: fl.lang || '',
            year: fl.year || '', order: fl.order || '最新',
        });
        var list = av7_arr(r, 'data').map(av7_vod);
        return { list: list, page: pg, pagecount: (r && r.pagecount) || 9999 };
    },
    search: function (args) {
        var pg = parseInt(args[2], 10) || 1;
        var r = av7_logs('search', { token: '', pg: pg, text: args[0] || '' });
        return { list: av7_arr(r, 'data').map(av7_vod) };
    },
    detail: function (args) {
        var cfg = av7_init().cfg;
        var r = av7_logs('video_detail', {
            token: '', id: parseInt(args[0], 10) || 0,
            sign_md5: cfg.sign_md5 || '',
            apk_path: '/data/app/~~mLGfF_Nezy4R4TqUevJVlg==/' + (cfg.pk_id || '') + '-NlNuzFF6p4657CBJv-ue4Q==/base.apk',
            apk_length: parseInt(cfg.apk_length, 10) || 0,
        });
        var info = (r && r.data && r.data.vod_info) || {};
        var froms = [], plays = [];
        var lines = av7_arr(info, 'vod_url_with_player');
        for (var i = 0; i < lines.length; i++) {
            var name = String(lines[i].name || '').trim();
            if (!name) continue;
            var eps = String(lines[i].url || '').split('#').filter(function (s) { return s; });
            var out = [];
            for (var k = 0; k < eps.length; k++) {
                var seg = eps[k].split('$');
                if (seg.length < 2) continue;
                var val = seg.slice(1).join('$');
                if (val.indexOf('http') === 0) {
                    out.push(seg[0] + '$' + val);
                } else {
                    // 非直链(TX/SMDAT 平台码、ETH 密文等):编码 JSON 传给 play
                    var meta = JSON.stringify({
                        url: val,
                        parse_api: String(lines[i].parse_api || ''),
                        extra_parse_api: String(lines[i].extra_parse_api || ''),
                    });
                    out.push(seg[0] + '$' + av7_flagEnc(meta));
                }
            }
            if (out.length) { froms.push(name); plays.push(out.join('#')); }
        }
        return { list: [{
            vod_id: String(info.vod_id || args[0]),
            vod_name: info.vod_name || '',
            vod_pic: info.vod_pic || '',
            vod_remarks: info.vod_remarks || '',
            vod_year: info.vod_year || '',
            vod_area: info.vod_area || '',
            vod_actor: info.vod_actor || '',
            vod_director: info.vod_director || '',
            vod_content: info.vod_content || '',
            vod_play_from: froms.join('$$$'),
            vod_play_url: plays.join('$$$'),
        }] };
    },
    play: function (args) {
        var flag = args[1] || args[0] || '';
        var cfg = av7_init().cfg;
        if (flag.indexOf('http') === 0) {
            return { parse: 0, url: flag };
        }
        // flag 载体双尝试:base64(JSON)(第三方降级)→ AES-ECB(壳内)
        var pt = '';
        try {
            var cand = base64Decode(flag);
            if (cand && cand.charAt(0) === '{') pt = cand;
        } catch (e) { }
        if (!pt && typeof __aesEcbDecrypt !== 'undefined') {
            pt = __aesEcbDecrypt(flag, AV7_EPKEY);
            if (pt.indexOf('__ERR__') === 0) throw new Error('集数解密失败');
        }
        var meta = null;
        try { meta = JSON.parse(pt); } catch (e) { }
        if (!meta) throw new Error('集数数据无效');
        var url = String(meta.url || '');
        var parseApi = String(meta.parse_api || '').trim();
        var extraApi = String(meta.extra_parse_api || '').trim();
        if (!parseApi && !extraApi) {
            if (url.indexOf('http') !== 0) throw new Error('缺少parse_api且播放地址不是http');
            return { parse: 0, url: url, headers: { 'User-Agent': cfg.user_agent || AV7_UA_DEF } };
        }
        var pick = function (resp) {
            try {
                var j = JSON.parse(resp);
                if (j && j.url && String(j.url).indexOf('http') === 0) return String(j.url);
            } catch (e) { }
            return '';
        };
        var res = '';
        if (parseApi && url) {
            var g = av7_parseGet(parseApi + url);
            res = pick(g);
            if (!res && g.indexOf('http') === 0) res = g;
        }
        if (!res && extraApi && extraApi !== parseApi && url) {
            var g2 = av7_parseGet(extraApi + url);
            res = pick(g2);
            if (!res) {
                try {
                    var j2 = JSON.parse(g2);
                    var data = String((j2 && j2.data) || '');
                    if (data.indexOf('%') >= 0) data = decodeURIComponent(data.replace(/\+/g, '%2B'));
                    if (data.indexOf('http') === 0) {
                        var g3 = av7_parseGet(data);
                        res = pick(g3);
                        if (!res && g3.indexOf('http') === 0) res = g3;
                    }
                } catch (e) { }
            }
        }
        if (!res) {
            var msg = '';
            try { msg = (JSON.parse(g || g2 || '') || {}).msg || ''; } catch (e) { }
            throw new Error(msg || '解析失败');
        }
        return { parse: 0, url: res, headers: { 'User-Agent': cfg.user_agent || AV7_UA_DEF } };
    },
};

// ─── rule 形态出口(批次B:panboxjs __panCall → jsdrpy rule)───
var rule = {
    title: '秒播',
    host: AV7_CRYPTO,
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,

    class_parse: function () {
        return { class: AV7_API.home().class, filters: {} };
    },

    推荐: function () {
        return []; // appv7 协议 nav 无推荐位;分类入口可达(homeVod 允许空)
    },

    一级: function () {
        var r = AV7_API.category([this.MY_CATE, this.MY_PAGE, '', this.MY_FL || {}]);
        return av7_cards(r.list);
    },

    二级: function () {
        return AV7_API.detail([this.input]).list[0];
    },

    搜索: function () {
        return av7_cards(AV7_API.search([this.wd, '', this.MY_PAGE || 1]).list);
    },

    lazy: function () {
        var r = AV7_API.play(['', this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};
