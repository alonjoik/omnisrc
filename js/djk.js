// 短剧库 — duanjuku.org（ZBlog 网页型网盘源，夸克分享）
var rule = {
    title: '短剧库',
    host: 'https://duanjuku.org',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' },
    class_name: '全部',
    class_url: 'all',
    play_parse: true,
    searchUrl: '/search.php?q=**',

    一级: function () {
        var d = [];
        var html = request(this.host + '/').content || '';
        var re = /href="https:\/\/duanjuku\.org\/(\d+)\.html"[^>]*title="([^"]{1,150})"/g;
        var seen = {}, m;
        while ((m = re.exec(html)) !== null) {
            var id = m[1], name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
            if (!name || seen[id]) continue;
            seen[id] = 1;
            d.push({ title: name, img: '', desc: '夸克', url: id });
            if (d.length >= 30) break;
        }
        return d;
    },

    搜索: function () {
        var d = [];
        var html = request(this.host + '/search.php?q=' + encodeURIComponent(this.wd)).content || '';
        var re = /href="https:\/\/duanjuku\.org\/(\d+)\.html"[^>]*title="([^"]{1,150})"/g;
        var seen = {}, m;
        while ((m = re.exec(html)) !== null) {
            var id = m[1], name = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
            if (!name || seen[id]) continue;
            seen[id] = 1;
            d.push({ title: name, img: '', desc: '夸克', url: id });
            if (d.length >= 30) break;
        }
        return d;
    },

    二级: function () {
        var html = request(this.host + '/' + this.input + '.html').content || '';
        var t = /<h1[^>]*>([^<]{1,200})<\/h1>/.exec(html);
        var pan = /https:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/.exec(html);
        if (!pan) throw new Error('短剧库 无网盘链接');
        var d = __panDetailOf(pan[0], '夸克网盘');
        return {
            vod_id: this.input,
            vod_name: t ? t[1] : '短剧库',
            vod_pic: '',
            vod_remarks: d ? d.count + '集' : '夸克网盘',
            vod_play_from: d ? d.from : '夸克网盘',
            vod_play_url: d ? d.play_url : '全剧$' + pan[0],
        };
    },

    lazy: function () {
        return JSON.stringify(__panLazyOf(this.input));
    },
}
