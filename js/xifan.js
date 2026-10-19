// 西饭短剧 — xifan-api-cn.youlishipin.com（明文 GET）
var rule = {
    title: '西饭短剧',
    host: 'https://xifan-api-cn.youlishipin.com',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'okhttp/3.12.11', 'content-type': 'application/json; charset=utf-8' },
    class_name: '都市&逆袭&甜宠&战神&神豪&穿越&重生&古装&萌宝&赘婿',
    class_url: '都市&逆袭&甜宠&战神&神豪&穿越&重生&古装&萌宝&赘婿',
    searchUrl: '/xifan/search/getSearchList?reqType=search&offset=0&keyword=**&quickEngineVersion=-1&scene=',

    kw: function (w) {
        var v = JSON.parse(request(this.host + '/xifan/search/getSearchList?reqType=search&offset=0&keyword=' +
            encodeURIComponent(w) + '&quickEngineVersion=-1&scene=').content);
        var out = [];
        var els = (v.result || {}).elements || [];
        for (var b = 0; b < els.length; b++) {
            var cs = els[b].contents || [];
            for (var i = 0; i < cs.length; i++) {
                var dj = cs[i].duanjuVo || {};
                if (dj.duanjuId) out.push(dj);
            }
        }
        return out;
    },

    card: function (dj) {
        return {
            title: dj.title || '',
            img: dj.coverImageUrl || '',
            desc: (dj.total || '') + '集',
            url: dj.duanjuId + '#' + (dj.source || ''),
        };
    },

    一级: function () {
        var tid = this.MY_CATE || '都市';
        var d = [], seen = {};
        var self = this;
        this.kw(tid).forEach(function (dj) {
            var cats = dj.categories || [];
            var hit = cats.length === 0;
            for (var c = 0; c < cats.length; c++) { if (cats[c] === tid) hit = true; }
            var id = String(dj.duanjuId);
            if (hit && !seen[id]) { seen[id] = 1; d.push(self.card(dj)); }
        });
        return d;
    },

    搜索: function () {
        var d = [], seen = {};
        var self = this;
        this.kw(this.wd || '').forEach(function (dj) {
            var id = String(dj.duanjuId);
            if (!seen[id]) { seen[id] = 1; d.push(self.card(dj)); }
        });
        return d;
    },

    二级: function () {
        var parts = String(this.input).split('#');
        var v = JSON.parse(request(this.host + '/xifan/drama/getDuanjuInfo?duanjuId=' +
            encodeURIComponent(parts[0]) + '&source=' + encodeURIComponent(parts[1] || '')).content);
        var d = v.result || {};
        var eps = d.episodeList || [];
        if (!eps.length) throw new Error('西饭 无剧集');
        var pu = eps.map(function (e, i) {
            return (e.index || (i + 1)) + '$' + (e.playUrl || '');
        });
        return {
            vod_id: this.input,
            vod_name: d.title || '',
            vod_pic: d.coverImageUrl || '',
            vod_remarks: (d.total || '') + '集' + (d.updateStatus === 'over' ? ' 已完结' : ''),
            vod_play_from: '西饭短剧',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var url = this.input;
        if (url.indexOf('http') !== 0) throw new Error('西饭 无效地址');
        return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': 'okhttp/3.12.11' } });
    },
}
