// 大芒短剧 — damang.api.mgtv.com（芒果TV大芒体系）
var rule = {
    title: '大芒短剧',
    host: 'https://damang.api.mgtv.com',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    play_parse: true,
    searchUrl: '/newbee/search/key/words?keyWords=**&did=x',
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12; HD1900) AppleWebKit/537.36 Chrome/97 Mobile Safari/537.36' },
    UA: 'Mozilla/5.0 (Linux; Android 12; HD1900) AppleWebKit/537.36 Chrome/97 Mobile Safari/537.36',

    did: function () {
        var s = '';
        for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
        return s;
    },

    class_parse: function () {
        var r = JSON.parse(request(this.host + '/newbee/manage/page/rec/tags/v3?did=' + this.did()).content);
        var cls = [];
        var tags = r.data || [];
        for (var i = 0; i < tags.length; i++) {
            if (tags[i].tagName) cls.push({ type_id: tags[i].tagName, type_name: tags[i].tagName });
        }
        return { class: cls };
    },

    一级: function () {
        var d = [];
        var tag = encodeURIComponent(this.MY_CATE || '');
        var u = this.host + '/newbee/manage/page/film/library/v3?tagName=' + tag +
            '&page=' + this.MY_PAGE + '&pagesize=24&did=' + this.did();
        var r = JSON.parse(request(u).content);
        var self = this;
        ((r.data || {}).list || []).forEach(function (v) {
            d.push({
                title: v.albumTitle || '',
                img: v.verticalImg || v.crossImg || '',
                desc: v.subTitle || v.albumSubTitle || (v.serialCount ? v.serialCount + '集' : ''),
                url: String(v.albumId || ''),
            });
        });
        this._more = !!((r.data || {}).more);
        return d;
    },

    搜索: function () {
        var d = [];
        var u = this.host + '/newbee/search/key/words?keyWords=' + encodeURIComponent(this.wd || '') +
            '&did=' + this.did();
        var r = JSON.parse(request(u).content);
        ((r.data || {}).videos || []).forEach(function (v) {
            d.push({
                title: v.title || '',
                img: v.verticalImg || v.crossImg || '',
                desc: v.subTitle || v.albumSubTitle || '',
                url: String(v.albumId || ''),
            });
        });
        return d;
    },

    二级: function () {
        var id = this.input;
        var r = JSON.parse(request(this.host + '/newbee/play/page/detail?albumId=' + id + '&did=' + this.did()).content);
        var album = (r.data || {}).album || {};
        var eps = album.anthologies || [];
        var self = this;
        var pu = eps.map(function (e, i) {
            var name = e.title || ('第' + e.serialno + '集');
            if (album.albumTitle && name.indexOf(album.albumTitle) === 0) {
                name = name.substring(album.albumTitle.length).trim();
            }
            return '第' + (e.serialno || i + 1) + '集 ' + name + '$' + e.vid;
        });
        return {
            vod_id: id,
            vod_name: album.albumTitle || '',
            vod_pic: album.verticalImg || '',
            vod_remarks: album.albumUpdateSerialNoDesc || '',
            vod_content: album.albumBrief || '',
            vod_play_from: 'damang',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var vid = this.input;
        var did = this.did();
        var r = JSON.parse(request('http://mobile.api.mgtv.com/v8/video/getSource?playType=28&fileSourceType=2&seekSourceType=2&definition=3&_support=10100001&osVersion=10&videoId=' + vid + '&did=' + did + '&uuid=' + did).content);
        var data = r.data || {};
        var domains = data.videoDomains || [];
        var dom0 = domains[0] || 'http://disp.titan.mgtv.com';
        var sources = data.videoSources || [];
        // 从低清晰度起试到解包成功（蓝光为会员轨）
        for (var i = sources.length - 1; i >= 0; i--) {
            var rel = sources[i] && sources[i].url;
            if (!rel) continue;
            var resp = request(dom0 + rel, { headers: { 'User-Agent': this.UA } });
            if (resp.ok && resp.content) {
                try {
                    var info = JSON.parse(resp.content).info;
                    if (info && info.indexOf('http') === 0) {
                        return JSON.stringify({ parse: 0, url: info, header: { 'User-Agent': this.UA } });
                    }
                } catch (e) { /* 下一线路 */ }
            }
        }
        throw new Error('大芒 无可用播放源');
    },
}
