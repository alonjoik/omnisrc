// 黑豆短剧 — www.hddj.cc（网页型网盘源，夸克分享）
// 搜索 /search.html?t=kw → /duanju/{id}.html；详情页 h1 + pan.quark.cn
var rule = {
    title: '黑豆短剧',
    host: 'https://www.hddj.cc',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36' },
    class_name: '全部',
    class_url: 'all',
    play_parse: true,
    searchUrl: '/search.html?t=**',

    一级: function () {
        // 站点无分类页：引导用搜索
        return [];
    },

    搜索: function () {
        var d = [];
        var html = request(this.host + '/search.html?t=' + encodeURIComponent(this.wd)).content || '';
        var re = /href="\/duanju\/(\d+)\.html"[^>]*>([^<]{1,120})</g;
        var seen = {}, m;
        while ((m = re.exec(html)) !== null) {
            var id = m[1], name = m[2].replace(/\s+/g, '');
            if (!name || seen[id]) continue;
            seen[id] = 1;
            d.push({ title: name, img: '', desc: '夸克', url: id });
            if (d.length >= 30) break;
        }
        return d;
    },

    二级: function () {
        var html = request(this.host + '/duanju/' + this.input + '.html').content || '';
        var t = /<h1>([^<]{1,200})<\/h1>/.exec(html);
        var pan = /https:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/.exec(html);
        if (!pan) throw new Error('黑豆 无网盘链接');
        var d = __panDetailOf(pan[0], '夸克网盘');
        return {
            vod_id: this.input,
            vod_name: t ? t[1] : '黑豆短剧',
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
