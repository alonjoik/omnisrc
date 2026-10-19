// 即刻短剧 — api.uuuka.com（网盘聚合 API；source_link 为夸克/UC 分享链接）
var rule = {
    title: '即刻短剧',
    host: 'https://api.uuuka.com',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
    class_name: '短剧&动漫&电影&电视剧&学习&百度短剧',
    class_url: 'post&dongman&movie&tv&xuexi&baidu',
    play_parse: true,
    searchUrl: '/api/search?keyword=**',

    一级: function () {
        var d = [];
        var u = this.host + '/api/contents/' + encodeURIComponent(this.MY_CATE) +
            '?page=' + this.MY_PAGE + '&limit=20';
        var v = JSON.parse(request(u).content);
        ((v.data || {}).items || []).forEach(function (it) {
            d.push({
                title: (it.title || '').replace(/（\d+集）/, ''),
                img: it.cover || it.image || '',
                desc: it.category || it.type_name || '',
                url: it.source_link || '',
                content: it.description || '',
            });
        });
        return d;
    },

    搜索: function () {
        var d = [];
        var u = this.host + '/api/search?keyword=' + encodeURIComponent(this.wd);
        var v = JSON.parse(request(u).content);
        ((v.data || {}).items || []).forEach(function (it) {
            d.push({
                title: (it.title || '').replace(/（\d+集）/, ''),
                img: it.cover || it.image || '',
                desc: it.category || it.type_name || '',
                url: it.source_link || '',
                content: it.description || '',
            });
        });
        return d;
    },

    二级: function () {
        // 一级/搜索的 url 即网盘分享链接，detail 时 input=[url, name] 序列化串或原链接
        var raw = String(this.input || '');
        var link = raw, name = '';
        try {
            var j = JSON.parse(raw);
            if (j && j.url) { link = j.url; name = j.name || ''; }
        } catch (e) {}
        var pan = __panDetailOf(link, '即刻网盘');
        if (pan) {
            return {
                vod_id: link,
                vod_name: name || '即刻资源',
                vod_pic: '',
                vod_remarks: pan.count + '集',
                vod_play_from: pan.from,
                vod_play_url: pan.play_url,
            };
        }
        return {
            vod_id: link,
            vod_name: name || '即刻资源',
            vod_pic: '',
            vod_remarks: '网页',
            vod_play_from: '网页',
            vod_play_url: '播放$' + link,
        };
    },

    lazy: function () {
        return JSON.stringify(__panLazyOf(this.input));
    },
}
