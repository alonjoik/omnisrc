// 咕咕番 — www.gugu3.com（MacCMS Streamlab 模板 + 签名 POST API + 云播直链）
// 列表/搜索：POST /index.php/api/vod(/search)  body: time=unix秒&key=md5("DS"+time+"DCC147D11943AF75")
// 详情：/index.php/vod/detail/id/{id}.html SSR；播放：play 页 player_aaaa.url → player.gugu3.com/admin/mizhi_json.php 解直链（vkey 不校验）
var rule = {
    title: '咕咕番',
    host: 'https://www.gugu3.com',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    searchUrl: '/index.php/api/vod/search',
    // 函数式一级必须带 url 模板（host.category 前置 tplUrl）
    url: '/index.php/vod/show/id/fyclass.html',
    SALT: 'DCC147D11943AF75',

    // 签名表单体：time=unix秒 & key=md5("DS"+time+SALT)
    signBody: function (pairs) {
        var t = String(Math.floor(Date.now() / 1000));
        var key = md5('DS' + t + this.SALT);
        var arr = [];
        for (var k in pairs) arr.push(k + '=' + encodeURIComponent(pairs[k]));
        arr.push('time=' + t, 'key=' + key);
        return arr.join('&');
    },

    // 列表 API（type 分类 / wd 搜索二合一）
    apiList: function (pairs) {
        var isSearch = pairs.wd !== undefined;
        var r = request(this.host + (isSearch ? '/index.php/api/vod/search' : '/index.php/api/vod'), {
            method: 'POST',
            headers: {
                'User-Agent': this.headers['User-Agent'],
                'Referer': this.host + '/',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: this.signBody(pairs),
        });
        if (!r.ok) throw new Error('咕咕 HTTP ' + r.status);
        var v = JSON.parse(r.content);
        if (v.code !== 1) throw new Error('咕咕 API ' + v.code);
        return v;
    },

    card: function (v) {
        return {
            title: v.vod_name || '',
            img: v.vod_pic || '',
            desc: (v.vod_remarks || '') + ((v.vod_score || 0) > 0 ? ' · ' + v.vod_score + '分' : ''),
            url: String(v.vod_id || ''),
            content: String(v.vod_blurb || '').slice(0, 300),
        };
    },

    class_parse: function () {
        return {
            class: [
                { type_id: '6', type_name: '番剧' },
                { type_id: '21', type_name: '剧场版' },
                { type_id: '23', type_name: '特摄' },
            ],
        };
    },

    一级: function () {
        var v = this.apiList({ type: this.MY_CATE || '6', class: '', area: '', lang: '', version: '', state: '', letter: '', page: this.MY_PAGE || 1 });
        var d = [];
        (v.list || []).forEach(function (it) { d.push(__guguCard(it)); });
        return d;
    },

    搜索: function () {
        var v = this.apiList({ wd: this.wd || '', page: 1 });
        var d = [];
        (v.list || []).forEach(function (it) { d.push(__guguCard(it)); });
        return d;
    },

    二级: function () {
        var html = request(this.host + '/index.php/vod/detail/id/' + this.input + '.html', {
            headers: { 'User-Agent': this.headers['User-Agent'], 'Referer': this.host + '/' },
        }).content || '';
        var t = /<h\d[^>]*>([^<]{2,120})<\/h\d>/.exec(html);
        var pic = /<img[^>]*class="lazy[^"]*"[^>]*data-src="([^"]{10,300})"/.exec(html);
        var blurb = /(?:剧情简介|vod_content|blurb)[^>]*>([\s\S]{10,2000}?)<\/(?:div|p|span)>/.exec(html);
        // 集列表（按 sid 分组线路）
        var groups = {};
        var re = /href="\/index\.php\/vod\/play\/id\/(\d+)\/sid\/(\d+)\/nid\/(\d+)\.html"[^>]*>([^<]{1,30})</g, m;
        while ((m = re.exec(html)) !== null) {
            var sid = m[2];
            if (!groups[sid]) groups[sid] = [];
            groups[sid].push(m[4] + '$' + m[1] + '/' + m[2] + '/' + m[3]);
        }
        var froms = [], urls = [];
        for (var sid in groups) {
            froms.push('咕咕线' + sid);
            urls.push(groups[sid].join('#'));
        }
        if (!froms.length) throw new Error('咕咕 无剧集');
        return {
            vod_id: this.input,
            vod_name: t ? t[1] : '咕咕番',
            vod_pic: pic ? pic[1] : '',
            vod_remarks: froms.length + '条线路',
            vod_content: blurb ? blurb[1].replace(/<[^>]+>/g, '').trim().slice(0, 500) : '',
            vod_play_from: froms.join('$$$'),
            vod_play_url: urls.join('$$$'),
        };
    },

    lazy: function () {
        // input = vid/sid/nid
        var p = String(this.input).split('/');
        if (p.length < 3) throw new Error('咕咕 播放参数异常');
        var playUrl = this.host + '/index.php/vod/play/id/' + p[0] + '/sid/' + p[1] + '/nid/' + p[2] + '.html';
        var html = request(playUrl, {
            headers: { 'User-Agent': this.headers['User-Agent'], 'Referer': this.host + '/' },
        }).content || '';
        var pm = /var player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(html);
        if (!pm) throw new Error('咕咕 无播放器数据');
        var v = JSON.parse(pm[1]);
        if (!v.url) throw new Error('咕咕 无资源地址');
        // 云播解析（vkey 不校验；直链为字节 CDN 签名 mp4，免头直连）
        var r = request('https://player.gugu3.com/admin/mizhi_json.php', {
            method: 'POST',
            headers: {
                'User-Agent': this.headers['User-Agent'],
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: 'url=' + encodeURIComponent(v.url) + '&time=&key=&vkey=',
        });
        var j = JSON.parse(r.content);
        if (String(j.code) !== '200' || !j.url) throw new Error('咕咕 解析失败: ' + (j.msg || j.code));
        return JSON.stringify({ parse: 0, url: j.url, header: { 'User-Agent': this.headers['User-Agent'] } });
    },
}

function __guguCard(v) {
    return {
        title: v.vod_name || '',
        img: v.vod_pic || '',
        desc: (v.vod_remarks || '') + ((v.vod_score || 0) > 0 ? ' · ' + v.vod_score + '分' : ''),
        url: String(v.vod_id || ''),
        content: String(v.vod_blurb || '').slice(0, 300),
    };
}
