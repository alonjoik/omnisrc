// 红豆短剧 — cdp-app.gxnngnww.top（免登录明文 GET）
// 板块 section_page · 列表 compilations/sorted · 全集 static_resp/episodic_drama/dramas/{fakeId} · 播放 video/v4/{videoFakeId}
var rule = {
    title: '红豆短剧',
    host: 'https://cdp-app.gxnngnww.top',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    headers: { 'User-Agent': 'okhttp/4.10.0' },
    play_parse: true,
    searchUrl: '/cdp/server_api/compilations/search_list?keyword=**&pageNum=1&pageSize=20',

    class_parse: function () {
        var v = JSON.parse(request(this.host + '/cdp/section_group/section_page?sectionGroupTypeValue=1&index=1').content);
        var grps = (v.currentSectionGroupDTO || {}).sectionList || v.sectionGroupList || [];
        var cls = [], seen = {};
        for (var i = 0; i < grps.length; i++) {
            var g = grps[i];
            var arr2 = (g && (g.sectionList || g.sections)) || (g && g.id ? [g] : []);
            for (var j = 0; j < arr2.length; j++) {
                var s = arr2[j] || g;
                if (s && s.id && !seen[s.id]) {
                    seen[s.id] = 1;
                    cls.push({ type_id: String(s.id), type_name: s.name || '' });
                }
            }
        }
        if (!cls.length) cls.push({ type_id: 'search', type_name: '搜索' });
        return { class: cls };
    },

    一级: function () {
        var d = [];
        var u = this.host + '/cdp/section_group/compilations/sorted?sectionId=' +
            encodeURIComponent(this.MY_CATE) + '&pageNum=' + this.MY_PAGE + '&pageSize=24';
        var v = JSON.parse(request(u).content);
        (v.list || []).forEach(function (it) {
            d.push({
                title: it.title || '',
                img: it.coverImgUrl || '',
                desc: (it.totalOfEpisodes || '') + '集',
                url: String(it.fakeId || it.id || ''),
                content: it.introduce || '',
            });
        });
        return d;
    },

    搜索: function () {
        var d = [];
        var u = this.host + '/cdp/server_api/compilations/search_list?keyword=' +
            encodeURIComponent(this.wd) + '&pageNum=1&pageSize=20';
        var v = JSON.parse(request(u).content);
        var arr2 = Array.isArray(v) ? v : (v.list || []);
        arr2.forEach(function (it) {
            d.push({
                title: it.title || '',
                img: it.coverImgUrl || '',
                desc: (it.totalOfEpisodes || '') + '集',
                url: String(it.fakeId || it.id || ''),
                content: it.introduce || '',
            });
        });
        return d;
    },

    二级: function () {
        var id = this.input;
        var eps = JSON.parse(request(this.host + '/cdp/static_resp/episodic_drama/dramas/' + encodeURIComponent(id)).content);
        if (!Array.isArray(eps)) eps = [];
        eps.sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
        var pu = eps.map(function (e, i) { return (e.title || 'EP' + (i + 1)) + '$' + (e.videoFakeId || ''); });
        return {
            vod_id: id,
            vod_name: ((eps[0] && eps[0].title) || '').replace(/EP?\d+[-_]?/i, '') || '红豆短剧',
            vod_pic: '',
            vod_remarks: eps.length + '集',
            vod_play_from: '红豆短剧',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var v = JSON.parse(request(this.host + '/cdp/video/v4/' + encodeURIComponent(this.input)).content);
        var url = '';
        (v.videoFiles || []).forEach(function (f) { if (!url && f.videoUrl) url = f.videoUrl; });
        return JSON.stringify({ parse: url ? 0 : 1, url: url });
    },
}
