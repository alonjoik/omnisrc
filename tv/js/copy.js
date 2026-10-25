// copy.js — 拷贝漫画（JS 源形态，热更新免重编译；copymanga.rs 同构翻译）
// v3 REST API + Platform/Region/Version/Webp 头；缺 Version 头触发 210 升级拦截
// 注意：homeIndex 带 Version 头反而返回空集（Rust 版实测），单独无 Version 请求
var CM_API_HOST = 'https://api.mangacopy.com';
var CM_UA = 'Mozilla/5.0 (Linux; Android 12; Redmi K30 Pro) Chrome/120 Mobile';

function CM_headers(withVersion) {
    var h = {
        'User-Agent': CM_UA,
        'Platform': '3',
        'Region': '1',
        'Webp': '1',
    };
    if (withVersion) h['Version'] = '3.0.0';
    return h;
}

function CM_req(path, withVersion) {
    var r = JSON.parse(__reqRaw(CM_API_HOST + path, JSON.stringify({ headers: CM_headers(withVersion !== false) })));
    if (!r.ok || r.status !== 200) {
        throw new Error('拷贝 HTTP ' + r.status + (r.error ? ' | ' + r.error : '') + ': ' + path);
    }
    var v = {};
    try { v = JSON.parse(r.content); } catch (e) { throw new Error('拷贝响应非 JSON: ' + path); }
    if (v.code !== 200) throw new Error('拷贝错误 ' + v.code + ': ' + (v.message || 'unknown'));
    return v.results || {};
}

function CM_enc(s) { return encodeURIComponent(s || ''); }

// homeIndex 项是 {comic:{...}} 包装，list/search 项直接是 comic 对象
function CM_card(x) {
    var c = x || {};
    if (c.path_word === undefined || c.path_word === null) c = c.comic || {};
    var authors = [];
    var arr = c.author || [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].name) authors.push(arr[i].name);
    }
    return {
        vod_id: c.path_word || '',
        vod_name: c.name || '',
        vod_pic: c.cover || '',
        vod_remarks: c.datetime_updated || '',
        vod_actor: authors.join(','),
    };
}

function CM_pick(r, key) {
    var arr = (r && r[key]) || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) out.push(CM_card(arr[i]));
    return out;
}

var CM_API = {
    home: function () {
        var r = CM_req('/api/v3/h5/homeIndex', false);
        var banners = [];
        var bs = r.banners || [];
        for (var i = 0; i < bs.length; i++) {
            banners.push({
                pic: (bs[i] && bs[i].cover) || '',
                brief: (bs[i] && bs[i].brief) || '',
                comic: (bs[i] && bs[i].comic && bs[i].comic.path_word) || '',
            });
        }
        return {
            banners: banners,
            hot: CM_pick(r, 'hotComics'),
            new: CM_pick(r, 'newComics'),
            finish: CM_pick(r, 'finishComics'),
            rank_day: CM_pick(r, 'rankDayComics'),
            rank_week: CM_pick(r, 'rankWeekComics'),
            rank_month: CM_pick(r, 'rankMonthComics'),
            rec: CM_pick(r, 'recComics'),
        };
    },
    cats: function () {
        var r = CM_req('/api/v3/h5/filter/comic/tags?type=1&platform=3');
        var themes = [];
        var ts = r.theme || [];
        for (var i = 0; i < ts.length; i++) {
            themes.push({ name: ts[i].name || '', path_word: ts[i].path_word || '', count: ts[i].count || 0 });
        }
        return {
            themes: themes,
            ordering: [
                { name: '最新更新', v: '-datetime_updated' },
                { name: '最热人气', v: '-popular' },
                { name: '最多订阅', v: '-quantity' },
            ],
        };
    },
    list: function (args) {
        var theme = args[0] || '';
        var ordering = args[1] || '-datetime_updated';
        var offset = args[2] || '0';
        var r = CM_req('/api/v3/comics?theme=' + theme + '&ordering=' + ordering
            + '&offset=' + offset + '&limit=21&platform=3');
        var list = [];
        var arr = r.list || [];
        for (var i = 0; i < arr.length; i++) list.push(CM_card(arr[i]));
        return { list: list, total: r.total || 0, offset: r.offset || 0 };
    },
    search: function (args) {
        var q = CM_enc(args[0]);
        var offset = args[1] || '0';
        var r = CM_req('/api/v3/search/comic?format=json&limit=21&offset=' + offset
            + '&q=' + q + '&platform=3');
        var list = [];
        var arr = r.list || [];
        for (var i = 0; i < arr.length; i++) list.push(CM_card(arr[i]));
        return { list: list, total: r.total || 0 };
    },
    detail: function (args) {
        var pw = args[0] || '';
        var r = CM_req('/api/v3/comic2/' + pw + '?platform=3');
        var c = r.comic || {};
        if (!c.path_word || !c.name) {
            throw new Error('拷贝漫画当前未返回此作品的详情数据。可返回并切换到包子漫画或 MangaDex 源。');
        }
        var authors = [];
        var aa = c.author || [];
        for (var i = 0; i < aa.length; i++) if (aa[i] && aa[i].path_word) authors.push(aa[i].path_word);
        var themes = [];
        var ts = c.theme || [];
        for (var j = 0; j < ts.length; j++) if (ts[j] && ts[j].name) themes.push(ts[j].name);
        var paras = [];
        var ps = c.paras || [];
        for (var k = 0; k < ps.length; k++) if (ps[k] && ps[k].content) paras.push(ps[k].content);
        return {
            vod_id: c.path_word || pw,
            vod_name: c.name || '',
            vod_pic: c.cover || '',
            vod_remarks: c.datetime_updated || '',
            vod_actor: authors.join(','),
            type_name: themes.join(','),
            vod_content: paras.length ? paras.join('\n') : (c.b_404 || ''),
            order_by: r.groups || {},
        };
    },
    chapters: function (args) {
        var pw = args[0] || '';
        var offset = args[1] || '0';
        // group=top 默认主线；build_group=1 携带分卷信息
        var r = CM_req('/api/v3/comic/' + pw + '/chapter2?limit=100&offset=' + offset + '&platform=3');
        var list = [];
        var arr = r.list || [];
        for (var i = 0; i < arr.length; i++) {
            var x = arr[i];
            list.push({
                id: (x && x.uuid) || '',
                name: (x && x.name) || '',
                idx: (x && x.index) || 0,
                count: (x && x.size) || 0,
                updated: (x && x.datetime_created) || '',
            });
        }
        return { list: list, total: r.total || 0 };
    },
    images: function (args) {
        var pw = args[0] || '';
        var uuid = args[1] || '';
        var r = CM_req('/api/v3/comic/' + pw + '/chapter2/' + uuid + '?platform=3');
        var ch = r.chapter || {};
        var imgs = [];
        var cs = ch.contents || [];
        for (var i = 0; i < cs.length; i++) {
            imgs.push({ url: (cs[i] && cs[i].url) || '', w: '', h: '' });
        }
        return { name: ch.name || '', images: imgs, prev: ch.previous || '', next: ch.next || '' };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = CM_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
