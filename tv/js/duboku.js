// duboku.js — 独播库(api.dbokutv.com + java.util.Random 签名复现;批次B 自 PanBox 壳 panboxjs 迁入,rule 形态)
// g() 签名 = sign/ssid/token(Random LCG 双串交错);a() = 每10字符反转 + '.'→'=' + base64 解码
var DB_HOST = 'https://api.dbokutv.com';
var DB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
var DB_CH33 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
var DB_CH88 = 'XYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVW';

// 网络双通道:PanBox 壳 __reqRaw / drpy 公共面 request
function db_req(url, opt) {
    opt = opt || {};
    if (typeof __reqRaw !== 'undefined') {
        var r = JSON.parse(__reqRaw(url, JSON.stringify(opt)));
        return { ok: !!r.ok, status: r.status || 0, content: String(r.content || '') };
    }
    var r2 = request(url, opt);
    return { ok: (r2.status || 0) >= 200 && (r2.status || 0) < 300, status: r2.status || 0, content: String(r2.content || '') };
}

// base64 双通道:drpy 公共面优先,SPEC 红线(壳 __b64e/__b64d 回退仅作兼容)
function db_b64e(s) {
    if (typeof base64Encode === 'function') return base64Encode(s);
    return __b64e(s);
}
function db_b64d(s) {
    if (typeof base64Decode === 'function') return base64Decode(s);
    return __b64d(s);
}

// java.util.Random 复现(48 位 LCG)
function db_random(seed) {
    var mask = (1n << 48n) - 1n;
    var s = (BigInt(seed) ^ 0x5DEECE66Dn) & mask;
    function next(bits) {
        s = (s * 0x5DEECE66Dn + 0xBn) & mask;
        return Number(s >> BigInt(48 - Number(bits)));
    }
    function nextInt(bound) {
        if ((bound & -bound) === bound) {
            return Number((BigInt(bound) * BigInt(next(31))) >> 31n);
        }
        var bits, val;
        do {
            bits = next(31);
            val = bits % bound;
        } while (bits - val + (bound - 1) > 2147483647);
        return val;
    }
    return { nextInt: nextInt };
}

// Java b(i, j, i2):seed = 当前秒 + j
function db_token(len, jSec, kind) {
    var rnd = db_random(Math.floor(Date.now() / 1000) + jSec);
    var table = kind === 33 ? DB_CH33 : DB_CH88;
    var s = '';
    for (var i = 0; i < len; i++) s += table.charAt(rnd.nextInt(table.length));
    return s;
}

// Java g():?sign=..&ssid=..&token=..
function db_sign() {
    var tsSec = Math.floor(Date.now() / 1000);
    var rnd = db_random(tsSec);
    var iN = rnd.nextInt(800000000) % 800000001;
    var tsMs = String(Date.now());
    var str = String(100000000 + iN) + String(900000000 - iN);
    var min = Math.min(str.length, tsMs.length);
    var sb = '';
    for (var i = 0; i < min; i++) {
        sb += str.charAt(i);
        sb += tsMs.charAt(i);
    }
    if (str.length > min) sb += str.slice(min);
    if (tsMs.length > min) sb += tsMs.slice(min);
    var ssid = db_b64e(sb).replace(/=/g, '.');
    return '?sign=' + db_token(60, tsSec + 60, 33) + '&ssid=' + ssid + '&token=' + db_token(38, tsSec + 38, 88);
}

// Java a():每 10 字符反转 + '.'→'=' + base64 解码
function db_decode(str) {
    if (!str) return '';
    var sb = '';
    for (var i = 0; i < str.length; i += 10) {
        var chunk = str.slice(i, i + 10).split('').reverse().join('');
        sb += chunk;
    }
    try {
        var pt = db_b64d(sb.replace(/\./g, '='));
        return pt || '';
    } catch (e) {
        return '';
    }
}

function db_get(path) {
    var sign = db_sign();
    var url = DB_HOST + path + (path.indexOf('?') >= 0 ? sign.replace('?', '&') : sign);
    var r = db_req(url, {
        headers: { 'User-Agent': DB_UA, 'Connection': 'Keep-Alive', 'Referer': 'https://www.duboku.tv/' },
    });
    return JSON.parse(String(r.content || '{}'));
}

function db_items(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (!o || !o.Name) continue;
        var remark = o.Tag || (o.Rating !== undefined && o.Rating !== null ? o.Rating + '分' : '');
        out.push({ vod_id: db_decode(o.DId || ''), vod_name: o.Name, vod_pic: db_decode(o.TnId || ''), vod_remarks: remark });
    }
    return out;
}

function db_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ''), desc: v.vod_remarks || '' };
    });
}

var DB_CATS = [
    { type_id: '1', type_name: '电影' }, { type_id: '2', type_name: '电视剧' },
    { type_id: '3', type_name: '综艺' }, { type_id: '4', type_name: '动漫' },
    { type_id: '21', type_name: '短剧' }, { type_id: '20', type_name: '港剧' },
    { type_id: '13', type_name: '陆剧' }, { type_id: '15', type_name: '日韩剧' },
    { type_id: '14', type_name: '台泰剧' },
];
var DB_BY = [{ n: '时间', v: '' }, { n: '人气', v: '人气' }, { n: '评分', v: '评分' }];
var DB_AREAS = ['大陆', '香港', '台湾', '韩国', '日本', '泰国', '英国', '法国', '加拿大', '澳大利亚'].map(function (a) { return { n: a, v: a }; });
var DB_YEARS = ['2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017'].map(function (y) { return { n: y, v: y }; });

var DB_API = {
    home: function () {
        var recs = [];
        try {
            var homeArr = db_get('/home');
            if (Array.isArray(homeArr)) {
                for (var i = 0; i < homeArr.length && recs.length < 21; i++) {
                    recs = recs.concat(db_items(homeArr[i] && homeArr[i].VodList));
                }
            }
        } catch (e) { }
        return {
            class: DB_CATS.map(function (c) {
                return { type_id: c.type_id, type_name: c.type_name, filters: [
                    { key: 'class', name: '类型', value: [] },
                    { key: 'year', name: '年份', value: DB_YEARS },
                    { key: 'area', name: '地区', value: DB_AREAS },
                    { key: 'by', name: '排序', value: DB_BY },
                ] };
            }),
            list: recs,
        };
    },
    category: function (args) {
        var ext = args[3] || {};
        var tid = ext.cateId || args[0] || '1';
        var pg = parseInt(args[1], 10) || 1;
        var area = ext.area || '';
        var by = ext.by || '';
        var cls = ext.class || '';
        var year = ext.year || '';
        var path = '/vodshow/' + tid + '-' + area + '-' + by + '-' + cls + '-' + '----' + pg + '---' + year;
        var j = db_get(path);
        var out = db_items(j.VodList);
        return { list: out, page: pg, pagecount: out.length >= 48 ? pg + 1 : pg };
    },
    search: function (args) {
        var wd = args[0] || '';
        if (!wd) return { list: [], page: 1, pagecount: 1 };
        var j = db_get('/vodsearch?wd=' + encodeURIComponent(wd));
        return { list: db_items(Array.isArray(j) ? j : j.VodList), page: 1, pagecount: 1 };
    },
    detail: function (args) {
        var path = args[0] || '';
        if (path.charAt(0) !== '/') path = '/' + path;
        var j = db_get(path);
        var segs = [];
        var pl = j.Playlist || [];
        for (var i = 0; i < pl.length; i++) {
            var o = pl[i] || {};
            var nm = o.EpisodeName || ('第' + (i + 1) + '集');
            var vp = db_decode(o.VId || '');
            if (vp) segs.push(nm + '$' + vp);
        }
        if (!segs.length) throw new Error('独播库剧集为空');
        var actors = Array.isArray(j.Actor) ? j.Actor.join(',') : '';
        return { list: [{
            vod_id: path,
            vod_name: j.Name || '',
            vod_pic: db_decode(j.TnId || ''),
            vod_content: j.Description || '',
            vod_director: j.Director || '',
            vod_actor: actors,
            vod_year: j.ReleaseYear || '',
            vod_play_from: '独播库',
            vod_play_url: segs.join('#'),
        }] };
    },
    play: function (args) {
        var path = args[0] || '';
        if (!path) throw new Error('独播库播放参数为空');
        if (path.charAt(0) !== '/') path = '/' + path;
        var j = db_get(path);
        var url = db_decode(j.HId || '');
        if (!url) throw new Error('独播库播放地址为空');
        return { parse: 0, url: url, headers: {
            'User-Agent': DB_UA, 'Origin': 'https://w.duboku.io', 'Referer': 'https://w.duboku.io/',
        } };
    },
};

// ─── rule 形态出口(批次B:panboxjs __panCall → jsdrpy rule)───
var rule = {
    title: '独播库',
    host: DB_HOST,
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,

    class_parse: function () {
        var filters = {};
        for (var i = 0; i < DB_CATS.length; i++) {
            filters[DB_CATS[i].type_id] = [
                { key: 'class', name: '类型', value: [] },
                { key: 'year', name: '年份', value: DB_YEARS },
                { key: 'area', name: '地区', value: DB_AREAS },
                { key: 'by', name: '排序', value: DB_BY },
            ];
        }
        return { class: DB_CATS.map(function (c) { return { type_id: c.type_id, type_name: c.type_name }; }), filters: filters };
    },

    推荐: function () {
        return db_cards(DB_API.home().list);
    },

    一级: function () {
        var ext = this.MY_FL || {};
        if (ext.cateId === undefined) ext.cateId = this.MY_CATE;
        var r = DB_API.category([this.MY_CATE, this.MY_PAGE, '', ext]);
        return db_cards(r.list);
    },

    二级: function () {
        return DB_API.detail([this.input]).list[0];
    },

    搜索: function () {
        return db_cards(DB_API.search([this.wd]).list);
    },

    lazy: function () {
        var r = DB_API.play([this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};
