// 哔哔（B站）— api.bilibili.com（原版 appBili 五源共用：合集/少儿/小学/初中/高中）
// 链路：finger/spi 取 buvid → nav 取 wbi key → wbi 签名请求（search/popular/view/playurl 匿名全通）
// 播放：x/player/playurl?avid=&platform=html5 匿名 720P；直链必须带 Referer: https://www.bilibili.com/
// ext = {"name":"哔哔小学","kws":["小学数学","小学语文","小学英语"]}
var EXT = {};
try {
    var __ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
    if (__ej && typeof __ej === 'object') EXT = __ej;
} catch (e) {}
if (!EXT.name) EXT.name = '哔哔';
if (!EXT.kws || !EXT.kws.length) EXT.kws = ['纪录片', '科普', '音乐会'];

var rule = {
    title: EXT.name,
    host: 'https://api.bilibili.com',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    searchUrl: '/x/web-interface/search/type?search_type=video&keyword=**&page=1',
    // 函数式一级也必须提供 url 模板（host.category 的 tplUrl 前置依赖；type_id=关键词）
    url: '/x/web-interface/search/type?search_type=video&keyword=fyclass&page=fypage',

    MIXIN: [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52],
    __key: '',
    __ck: '',
    UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

    // buvid3（finger/spi 匿名获取）：无 cookie 请求会被过滤少儿类内容（如搜「儿歌」返回空 result）
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

    // wbi mixin key（nav img_key+sub_key 按固定置换表取位）
    // 只缓存在引擎实例内存（__key）——B站 key 会轮换，落 site_kv 会导致跨次调用用过期 key 风控
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

    // wbi 签名 GET（参数按 key 排序 + wts，md5(qs+key) 附加 w_rid）
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

    card: function (v) {
        var pic = v.pic || '';
        if (pic.indexOf('//') === 0) pic = 'https:' + pic;
        else if (pic.indexOf('http') !== 0) pic = 'https://' + pic;
        var title = String(v.title || '').replace(/<[^>]+>/g, '');
        return {
            title: title,
            img: pic,
            desc: (v.author || '') + ' · ' + ((v.play || 0) >= 10000 ? Math.round((v.play || 0) / 10000) + '万' : (v.play || 0)),
            url: v.bvid || '',
            content: String(v.description || '').slice(0, 200),
        };
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
}

// card 引用（函数体内 this 绑定规则对象；独立映射函数）
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
