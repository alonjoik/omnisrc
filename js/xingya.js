// 星芽短剧 — app.whjzjx.cn（AES-ECB 设备体登录 u.shytkjgs.com 换 JWT）
var rule = {
    title: '星芽短剧',
    host: 'https://app.whjzjx.cn',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    class_name: '剧场&新剧&热播&星选&阳光',
    class_url: '1&3&2&7&5',
    searchUrl: '/v3/search',
    KEY: 'B@ecf920Od8A4df7',
    UA: 'Linux; Android 12; Pixel 3 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.101 Mobile Safari/537.36',
    DEV: '2a50580e69d38388c94c93605241fb306',
    AID: 'ec1280db12795506',
    token: '',

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

    login: function () {
        var now = Date.now();
        var body = JSON.stringify({
            device: this.DEV,
            package_name: 'com.jz.xydj',
            android_id: this.AID,
            install_first_open: true,
            first_install_time: now - 86400000,
            last_update_time: now,
            report_link_url: '',
            authorization: '',
            timestamp: now,
        });
        var encHex = __aesEcbEncryptHex(body, this.KEY);
        if (encHex.indexOf('__ERR__') === 0) throw new Error(encHex);
        var r = JSON.parse(request('https://u.shytkjgs.com/user/v3/account/login', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'platform': '1',
                'user_agent': 'Mozilla/5.0 (Linux; Android 9; V1938T Build/PQ3A.190705.08211809; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: this.hex2b64(encHex),
        }).content);
        if (!r.data || !r.data.token) throw new Error('星芽登录失败: ' + (r.msg || r.code));
        this.token = r.data.token;
    },

    api: function (method, url, bodyObj) {
        if (!this.token) this.login();
        var opt = {
            method: method,
            headers: { 'User-Agent': this.UA, 'authorization': this.token, 'platform': '1', 'version_name': '3.8.3.1' },
        };
        if (bodyObj !== undefined) {
            opt.headers['Content-Type'] = 'application/json';
            opt.body = JSON.stringify(bodyObj);
        }
        var r = request(url, opt);
        if (r.status === 401) this.token = '';
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return JSON.parse(r.content);
    },

    一级: function () {
        var v = this.api('GET', this.host + '/v1/theater/home_page?theater_class_id=' + (this.MY_CATE || '1') +
            '&class2_id=4&page_num=' + this.MY_PAGE + '&page_size=24');
        var d = [];
        ((v.data || {}).list || []).forEach(function (t) {
            var th = t.theater || {};
            d.push({ title: th.title || '', img: th.cover_url || '', desc: th.play_amount_str || th.theme || '', url: String(th.id) });
        });
        return d;
    },

    搜索: function () {
        var v = this.api('POST', this.host + '/v3/search', { text: this.wd || '' });
        var d = [];
        (((v.data || {}).theater || {}).search_data || []).forEach(function (t) {
            d.push({ title: t.title || '', img: t.cover_url || '', desc: t.play_amount_str || t.theme || '', url: String(t.id) });
        });
        return d;
    },

    二级: function () {
        var did = this.input;
        var v = this.api('GET', this.host + '/v2/theater_parent/detail?theater_parent_id=' + did);
        var d = v.data || {};
        var pu = (d.theaters || []).map(function (t, i) {
            return (t.num || (i + 1)) + '$' + (t.son_video_url || '');
        });
        if (!pu.length && d.video_url) pu.push('1$' + d.video_url);
        return {
            vod_id: did,
            vod_name: d.title || '',
            vod_pic: d.cover_url || '',
            vod_remarks: d.filing || '',
            vod_content: '剧情：' + (d.introduction || ''),
            vod_play_from: '星芽',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var url = this.input;
        if (url.indexOf('http') !== 0) throw new Error('星芽 无效地址');
        return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': this.UA } });
    },
}
