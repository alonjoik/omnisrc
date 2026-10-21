// bili.js — B站双契约模板(批次B 合并,12 站能力全保)
// 契约A(ext 含 kws)—— wbi 签名链路(原仓库版):buvid+wbi key,搜索关键词即分类,播放 aid|cid
//   ext = {"name":"哔哔小学","kws":["小学数学","小学语文"]}
// 契约B(ext 含 json)—— BiliGuard 链路(批次B 自 PanBox 壳 panboxjs 迁入,rule 形态):
//   分类配置从 ext.json URL 拉取(type_id=搜索关键词或 mid/{pg} UP主空间),裸参数 search(无需 wbi 签名,
//   Java 版同款),播放 bvid@cid + platform=html5 免登录直链
//   ext = {"json":"https://nos.netease.com/....txt"}
var EXT = {};
try {
    var __ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
    if (__ej && typeof __ej === 'object') EXT = __ej;
} catch (e) {}
if (!EXT.name) EXT.name = '哔哔';
if (!EXT.kws || !EXT.kws.length) EXT.kws = ['纪录片', '科普', '音乐会'];
if (!EXT.json) EXT.json = '';

var BL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// 网络双通道:PanBox 壳 __reqRaw / drpy 公共面 request
function bl_req(url, opt) {
    opt = opt || {};
    if (typeof __reqRaw !== 'undefined') {
        var r = JSON.parse(__reqRaw(url, JSON.stringify(opt)));
        return { ok: !!r.ok, status: r.status || 0, content: String(r.content || '') };
    }
    var r2 = request(url, opt);
    return { ok: (r2.status || 0) >= 200 && (r2.status || 0) < 300, status: r2.status || 0, content: String(r2.content || '') };
}

function bl_stripTag(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/\\u003cem[^>]*>|<\/em>/g, '');
}
function bl_dur(d) {
    // 接口给 "4:59" 或秒数
    if (!d) return '';
    if (String(d).indexOf(':') >= 0) return String(d);
    var s = parseInt(d, 10) || 0;
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}
function bl_pic(p) {
    p = String(p || '');
    if (p.indexOf('//') === 0) return 'https:' + p;
    if (p.indexOf('http') !== 0) return 'https://' + p;
    return p.replace(/^http:/, 'https:');
}
function bl_card(it) {
    return {
        vod_id: String(it.bvid || it.aid || ''),
        vod_name: bl_stripTag(it.title),
        vod_pic: bl_pic(it.pic),
        vod_remarks: bl_dur(it.duration),
    };
}
function bl_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ''), desc: v.vod_remarks || '' };
    });
}

// ═══ 契约B:BiliGuard 链路(ext.json 分类配置)═══
var BH_UA = BL_UA;
var BH_CATS = null;

function bh_headers() {
    return { 'User-Agent': BH_UA, 'Referer': 'https://www.bilibili.com' };
}
function bh_get(url) {
    var r = bl_req(url, { headers: bh_headers() });
    if (!r.ok && r.status !== 0) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 60));
    return JSON.parse(r.content);
}
function bh_cats() {
    if (BH_CATS) return BH_CATS;
    if (EXT.json) {
        try {
            var r = bl_req(EXT.json, {});
            var cfg = JSON.parse(r.content);
            var arr = cfg && cfg.class;
            if (arr && arr.length) {
                BH_CATS = arr.map(function (t) {
                    return { type_id: String(t.type_id), type_name: String(t.type_name) };
                });
                return BH_CATS;
            }
        } catch (e) { }
    }
    BH_CATS = [{ type_id: '哔哩哔哩', type_name: '推荐' }];
    return BH_CATS;
}
function bh_searchPage(kw, pg, order, duration) {
    var q = 'https://api.bilibili.com/x/web-interface/wbi/search/type?qv_id=' +
        Math.random().toString(36).slice(2, 34).padEnd(32, '0') +
        '&search_type=video&page_size=42&keyword=' + encodeURIComponent(kw) +
        '&order=' + (order || 'totalrank') + '&duration=' + (duration || '0') +
        '&page=' + (pg || 1);
    var d = bh_get(q);
    var data = d && d.data;
    var arr = (data && data.result) || [];
    return { list: arr.map(bl_card), total: (data && data.numResults) || 0 };
}
function bh_spacePage(mid, pg) {
    var q = 'https://api.bilibili.com/x/space/wbi/arc/search?mid=' + mid +
        '&pn=' + (pg || 1) + '&ps=25&order=pubdate';
    var d = bh_get(q);
    var data = d && d.data;
    var list = data && data.list;
    var arr = (list && list.vlist) || [];
    return { list: arr.map(bl_card) };
}
var BH_API = {
    home: function () {
        return { class: bh_cats() };
    },
    category: function (args) {
        var tid = args[0] || '';
        var pg = parseInt(args[1], 10) || 1;
        var fl = args[3] || {};
        var m = tid.match(/^(\d+)\/\{pg\}$/);
        if (m) return bh_spacePage(m[1], pg);
        var r = bh_searchPage(tid, pg, fl.order, fl.duration);
        return { list: r.list, page: pg, pagecount: Math.ceil((r.total || 500) / 42) || 1 };
    },
    search: function (args) {
        var pg = parseInt(args[2], 10) || 1;
        return bh_searchPage(args[0] || '', pg, 'totalrank', '0');
    },
    detail: function (args) {
        var bvid = args[0] || '';
        var d = bh_get('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
        if (d.code !== 0) throw new Error(d.message || ('view ' + d.code));
        var v = d.data || {};
        var eps = [];
        var pages = v.pages || [];
        for (var i = 0; i < pages.length; i++) {
            eps.push(pages[i].part + '$' + bvid + '@' + pages[i].cid);
        }
        if (!eps.length) eps.push(v.title + '$' + bvid + '@' + (v.cid || ''));
        // 相关推荐
        var rel = [];
        try {
            var rd = bh_get('https://api.bilibili.com/x/web-interface/archive/related?bvid=' + encodeURIComponent(bvid));
            var rl = (rd.data || []).slice(0, 12);
            for (var k = 0; k < rl.length; k++) {
                rel.push(bl_stripTag(rl[k].title) + '$' + rl[k].bvid + '@' + rl[k].cid);
            }
        } catch (e) { }
        var playFrom = ['B站'];
        var playUrl = [eps.join('#')];
        if (rel.length) { playFrom.push('相关'); playUrl.push(rel.join('#')); }
        return { list: [{
            vod_id: bvid,
            vod_name: v.title || '',
            vod_pic: bl_pic(v.pic),
            vod_remarks: bl_dur(v.duration),
            vod_year: String(v.pubdate ? new Date(v.pubdate * 1000).getFullYear() : ''),
            vod_area: v.area || '',
            vod_actor: v.owner ? v.owner.name : '',
            vod_director: v.owner ? v.owner.name : '',
            vod_content: v.desc || '',
            vod_play_from: playFrom.join('$$$'),
            vod_play_url: playUrl.join('$$$'),
        }] };
    },
    play: function (args) {
        var flag = args[1] || args[0] || '';
        var at = flag.indexOf('@');
        if (at < 0) throw new Error('无效 flag');
        var bvid = flag.slice(0, at);
        var cid = flag.slice(at + 1);
        var q = 'https://api.bilibili.com/x/player/playurl?bvid=' + encodeURIComponent(bvid) +
            '&cid=' + encodeURIComponent(cid) + '&qn=64&platform=html5&high_quality=1';
        var d = bh_get(q);
        if (d.code !== 0) throw new Error(d.message || ('playurl ' + d.code));
        var dd = d.data || {};
        var durl = dd.durl || [];
        if (!durl.length) throw new Error('无直链(可能需要登录)');
        return {
            parse: 0,
            url: String(durl[0].url || (durl[0].durl || '')).replace(/^http:/, 'https:'),
            headers: { 'User-Agent': BH_UA, 'Referer': 'https://www.bilibili.com' },
        };
    },
};

var BH_RULE = {
    title: EXT.name,
    host: 'https://api.bilibili.com',
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,
    headers: bh_headers(),
    // 函数式一级也必须提供 url 模板(host.category 的 tplUrl 前置依赖)
    url: '/x/web-interface/wbi/search/type?search_type=video&keyword=fyclass&page=fypage',

    class_parse: function () {
        return { class: bh_cats(), filters: {} };
    },
    推荐: function () {
        return bl_cards(bh_searchPage(EXT.kws[0] || '哔哩哔哩', 1, 'totalrank', '0').list.slice(0, 24));
    },
    一级: function () {
        var r = BH_API.category([this.MY_CATE, this.MY_PAGE, '', this.MY_FL || {}]);
        return bl_cards(r.list);
    },
    二级: function () {
        return BH_API.detail([this.input]).list[0];
    },
    搜索: function () {
        return bl_cards(BH_API.search([this.wd, '', 1]).list);
    },
    lazy: function () {
        var r = BH_API.play(['', this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};

// ═══ 契约A:wbi 签名链路(ext.kws,原仓库版原样保留)═══
var BL_DEF_CATS = [
    { type_id: '哔哩哔哩', type_name: '推荐' },
    { type_id: '电影', type_name: '电影' },
    { type_id: '电视剧', type_name: '电视剧' },
    { type_id: '纪录片', type_name: '纪录片' },
    { type_id: '动漫', type_name: '动漫' },
    { type_id: '音乐', type_name: '音乐' },
    { type_id: '舞蹈', type_name: '舞蹈' },
    { type_id: '游戏', type_name: '游戏' },
    { type_id: '知识', type_name: '知识' },
    { type_id: '科技', type_name: '科技' },
    { type_id: '运动', type_name: '运动' },
    { type_id: '美食', type_name: '美食' },
];
var BL_CATS = null;

function bl_get(url) {
    var r = bl_req(url, { headers: { 'User-Agent': BL_UA, 'Referer': 'https://www.bilibili.com' } });
    if (!r.ok && r.status !== 0) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 60));
    return JSON.parse(r.content);
}

function bl_cats() {
    if (BL_CATS) return BL_CATS;
    if (EXT.json) {
        try {
            var r = bl_req(EXT.json, {});
            var cfg = JSON.parse(r.content);
            var arr = cfg && cfg.class;
            if (arr && arr.length) {
                BL_CATS = arr.map(function (t) {
                    return { type_id: String(t.type_id), type_name: String(t.type_name) };
                });
                return BL_CATS;
            }
        } catch (e) { }
    }
    BL_CATS = BL_DEF_CATS;
    return BL_CATS;
}

function bl_searchPage(kw, pg, order, duration) {
    var q = 'https://api.bilibili.com/x/web-interface/wbi/search/type?qv_id=' +
        Math.random().toString(36).slice(2, 34).padEnd(32, '0') +
        '&search_type=video&page_size=42&keyword=' + encodeURIComponent(kw) +
        '&order=' + (order || 'totalrank') + '&duration=' + (duration || '0') +
        '&page=' + (pg || 1);
    var d = bl_get(q);
    var data = d && d.data;
    var arr = (data && data.result) || [];
    return { list: arr.map(bl_card), total: (data && data.numResults) || 0 };
}

function bl_spacePage(mid, pg) {
    var q = 'https://api.bilibili.com/x/space/wbi/arc/search?mid=' + mid +
        '&pn=' + (pg || 1) + '&ps=25&order=pubdate';
    var d = bl_get(q);
    var data = d && d.data;
    var list = data && data.list;
    var arr = (list && list.vlist) || [];
    return { list: arr.map(bl_card) };
}

var BW_RULE = {
    title: EXT.name,
    host: 'https://api.bilibili.com',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': BL_UA, 'Referer': 'https://www.bilibili.com' },
    searchUrl: '/x/web-interface/search/type?search_type=video&keyword=**&page=1',
    // 函数式一级也必须提供 url 模板(host.category 的 tplUrl 前置依赖;type_id=关键词)
    url: '/x/web-interface/search/type?search_type=video&keyword=fyclass&page=fypage',

    MIXIN: [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52],
    __key: '',
    __ck: '',
    UA: BL_UA,

    // buvid3(finger/spi 匿名获取):无 cookie 请求会被过滤少儿类内容(如搜「儿歌」返回空 result)
    cookie: function () {
        if (this.__ck) return this.__ck;
        try {
            var spi = JSON.parse(request(this.host + '/x/frontend/finger/spi', {
                headers: { 'User-Agent': this.UA, 'Referer': 'https://www.bilibili.com/' },
            }).content);
            var b3 = (spi.data || {}).b_3 || '';
            if (b3) this.__ck = 'buvid3=' + b3;
        } catch (e) {}
        return this.__ck;
    },

    // wbi mixin key(nav img_key+sub_key 按固定置换表取位)
    // 只缓存在引擎实例内存(__key)——B站 key 会轮换,落 site_kv 会导致跨次调用用过期 key 风控
    wbiKey: function () {
        if (this.__key) return this.__key;
        var nav = JSON.parse(request(this.host + '/x/web-interface/nav', {
            headers: { 'User-Agent': this.UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': this.cookie() },
        }).content);
        var w = ((nav.data || {}).wbi_img) || {};
        var img = (w.img_url || '').split('/').pop().split('.')[0];
        var sub = (w.sub_url || '').split('/').pop().split('.')[0];
        if (!img || !sub) throw new Error('B站 nav 无 wbi key');
        var raw = img + sub, k = '';
        for (var i = 0; i < 32; i++) k += raw.charAt(this.MIXIN[i]);
        this.__key = k;
        return k;
    },

    // wbi 签名 GET(参数按 key 排序 + wts,md5(qs+key) 附加 w_rid)
    api: function (path, params) {
        var p = {};
        for (var k in params) p[k] = String(params[k]);
        p.wts = String(Math.floor(Date.now() / 1000));
        var keys = [];
        for (var k2 in p) keys.push(k2);
        keys.sort();
        var qs = keys.map(function (k3) {
            return encodeURIComponent(k3).replace(/[!'()*]/g, function (c) {
                return '%' + c.charCodeAt(0).toString(16).toUpperCase();
            }) + '=' + encodeURIComponent(p[k3]).replace(/[!'()*]/g, function (c) {
                return '%' + c.charCodeAt(0).toString(16).toUpperCase();
            });
        }).join('&');
        var w_rid = md5(qs + this.wbiKey());
        var u = this.host + path + '?' + qs + '&w_rid=' + w_rid;
        var r = request(u, { headers: { 'User-Agent': this.UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': this.cookie() } });
        if (!r.ok) throw new Error('B站 HTTP ' + r.status);
        var v = JSON.parse(r.content);
        if (v.code !== 0) throw new Error('B站 API ' + v.code + ' ' + (v.message || ''));
        return v;
    },

    class_parse: function () {
        var cls = EXT.kws.map(function (w) { return { type_id: w, type_name: w }; });
        return { class: cls };
    },

    一级: function () {
        var kw = this.MY_CATE || EXT.kws[0];
        var v = this.api('/x/web-interface/search/type', { search_type: 'video', keyword: kw, page: this.MY_PAGE || 1 });
        var d = [];
        ((v.data || {}).result || []).forEach(function (it) {
            d.push(__selfCard(it));
        });
        return d;
    },

    搜索: function () {
        var v = this.api('/x/web-interface/search/type', { search_type: 'video', keyword: this.wd || '', page: 1 });
        var d = [];
        ((v.data || {}).result || []).forEach(function (it) {
            d.push(__selfCard(it));
        });
        return d;
    },

    二级: function () {
        var v = this.api('/x/web-interface/view', { bvid: this.input });
        var data = v.data || {};
        var pages = data.pages || [];
        if (!pages.length && data.cid) pages = [{ cid: data.cid, part: data.title || '正片', page: 1 }];
        var aid = data.aid || '';
        if (!aid) throw new Error('B站 无aid');
        var pu = pages.map(function (p, i) {
            return (p.part || ('P' + (p.page || i + 1))) + '$' + aid + '|' + p.cid;
        });
        if (!pu.length) throw new Error('B站 无分P');
        return {
            vod_id: this.input,
            vod_name: data.title || '',
            vod_pic: data.pic || '',
            vod_remarks: (data.owner || {}).name || '',
            vod_content: String(data.desc || '').slice(0, 500),
            vod_play_from: EXT.name,
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var parts = String(this.input).split('|');
        if (parts.length < 2) throw new Error('B站 播放参数异常');
        var aid = parts[0], cid = parts[1];
        var r = request(this.host + '/x/player/playurl?avid=' + encodeURIComponent(aid) +
            '&cid=' + encodeURIComponent(cid) + '&qn=32&type=json&platform=html5&high_quality=1', {
            headers: { 'User-Agent': this.UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': this.cookie() },
        });
        var v = JSON.parse(r.content);
        if (v.code !== 0) throw new Error('B站 playurl ' + v.code);
        var d = v.data || {};
        var url = '';
        if (d.durl && d.durl.length) url = d.durl[0].url || '';
        else if (d.dash && d.dash.video && d.dash.video.length) url = (d.dash.video[0].baseUrl || d.dash.video[0].base_url || '');
        if (!url) throw new Error('B站 无直链');
        return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': this.UA, 'Referer': 'https://www.bilibili.com/' } });
    },
};

// card 引用(函数体内 this 绑定规则对象;独立映射函数)
function __selfCard(v) {
    var pic = v.pic || '';
    if (pic.indexOf('//') === 0) pic = 'https:' + pic;
    else if (pic.indexOf('http') !== 0) pic = 'https://' + pic;
    var title = String(v.title || '').replace(/<[^>]+>/g, '');
    var pl = v.play || 0;
    return {
        title: title,
        img: pic,
        desc: (v.author || '') + ' · ' + (pl >= 10000 ? Math.round(pl / 10000) + '万' : String(pl)),
        url: v.bvid || '',
        content: String(v.description || '').slice(0, 200),
    };
}

// 双契约分派:ext.json → BiliGuard;否则 kws → wbi 签名
var rule = EXT.json ? BH_RULE : BW_RULE;
