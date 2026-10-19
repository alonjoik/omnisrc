// 白马短剧 — theater-api.sylangyue.xyz（匿名登录 JWT，8 天有效，401 自动重登）
// POST /api/user/anonymous/login {"device_id"} → data.t (Bearer)
// 分类 /api/playlet/category · 列表 /api/playlet?category_id=&page= · 详情 /api/playlet/info · 全集 /api/playlet/episode
var rule = {
    title: '白马短剧',
    host: 'https://theater-api.sylangyue.xyz',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'hotshort/1.0.2 (iPhone; iOS 15.7; Scale/3.00)', 'Content-Type': 'application/json' },
    searchUrl: '/api/playlet?category_id=0&page=1',
    DEV: 'bm034933be73234452',
    tok: '',
    cats: null,

    login: function () {
        var v = JSON.parse(request(this.host + '/api/user/anonymous/login', {
            method: 'POST',
            headers: { 'User-Agent': this.headers['User-Agent'], 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: this.DEV }),
        }).content);
        if (!v.data || !v.data.t) throw new Error('白马 登录失败 ');
        this.tok = v.data.t;
    },

    req: function (method, path, bodyObj) {
        if (!this.tok) this.login();
        var opt = { method: method, headers: { 'User-Agent': this.headers['User-Agent'], 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.tok } };
        if (bodyObj !== undefined) opt.body = JSON.stringify(bodyObj);
        var r = request(this.host + path, opt);
        if (r.status === 401) { this.tok = ''; return this.req(method, path, bodyObj); }
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path.slice(0, 50));
        return JSON.parse(r.content);
    },

    class_parse: function () {
        if (!this.cats) {
            var v = this.req('GET', '/api/playlet/category');
            this.cats = v.data || [];
        }
        var cls = this.cats.map(function (c) { return { type_id: String(c.id), type_name: c.name || '' }; });
        return { class: cls };
    },

    一级: function () {
        var v = this.req('GET', '/api/playlet?category_id=' + encodeURIComponent(this.MY_CATE || '0') + '&page=' + this.MY_PAGE);
        var d = [];
        (((v.data || {}).list) || []).forEach(function (i) {
            d.push({ title: i.title || '', img: i.content_cover || '', desc: '', url: String(i.playlet_id) });
        });
        return d;
    },

    搜索: function () {
        try {
        // 站点无搜索端点：遍历精选分类前 5 页客户端过滤
        var kw = this.wd || '';
        var d = [], seen = {};
        var self = this;
        for (var p = 1; p <= 5; p++) {
            var v;
            v = this.req('GET', '/api/playlet?category_id=0&page=' + p);
            var arr = ((v.data || {}).list) || [];
            if (!arr.length) break;
            arr.forEach(function (i) {
                var id = String(i.playlet_id);
                if (!seen[id] && (i.title || '').indexOf(kw) >= 0) {
                    seen[id] = 1;
                    d.push({ title: i.title || '', img: i.content_cover || '', desc: '', url: id });
                }
            });
        }
        return d;
        } catch (e) { return [{ title: 'ERR:' + e, img: '', desc: '', url: 'https://e/x' }]; }
    },

    二级: function () {
        var pid = this.input;
        var v = this.req('GET', '/api/playlet/info?playlet_id=' + encodeURIComponent(pid));
        var d = v.data || {};
        var ve = this.req('GET', '/api/playlet/episode?episode_number=1&playlet_id=' + encodeURIComponent(pid));
        var eps = ((ve.data || {}).list) || [];
        var pu = eps.map(function (e, i) {
            return (e.episode_number || (i + 1)) + '$' + (e.movie_file || '');
        });
        if (!pu.length) throw new Error('白马 无剧集');
        return {
            vod_id: pid,
            vod_name: d.title || '',
            vod_pic: d.content_cover || '',
            vod_remarks: eps.length + '集',
            vod_content: d.introduce || '',
            vod_play_from: '白马短剧',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var url = this.input;
        if (url.indexOf('http') !== 0) throw new Error('白马 无效地址');
        return JSON.stringify({ parse: 0, url: url });
    },
}
