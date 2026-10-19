// 河马短剧 — freevideo.zqqds.cn（AES-128-CBC portal 协议）
// key=dzkjgfyxgshylgzm iv=apiupdownedcrypt；alg:HG45LKBS + datas 头；1103 注册 → 1125/1803/1131/1132/1139
var rule = {
    title: '河马短剧',
    host: 'https://freevideo.zqqds.cn',
    searchable: 1,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    class_name: '精选&古装&重生&家庭&恋爱',
    class_url: '53@精选&54@古装&55@重生&56@家庭&57@恋爱',
    searchUrl: '/free-video-portal/portal/1803',
    KEY: 'dzkjgfyxgshylgzm',
    IV: 'apiupdownedcrypt',
    utdid: '',
    uid: '',
    sess: '',

    预处理: function () {
        var hex = '0123456789abcdef', s = '', t = '';
        for (var i = 0; i < 32; i++) s += hex.charAt(Math.floor(Math.random() * 16));
        for (var j = 0; j < 32; j++) t += hex.charAt(Math.floor(Math.random() * 16));
        this.utdid = s;
        this.sess = t;
        var reg = this.portal(1103, { deviceID: s, appID: 'HMTFBJ1000130', loginType: 0 });
        if (!reg || !reg.userId) throw new Error('河马注册失败');
        this.uid = String(reg.userId);
    },

    devBody: function () {
        var brand = 'HONOR';
        return '{"version":"2.1.0","pname":"com.dz.hmjc","channelCode":"HMTFBJ1000130","utdidTmp":"'
            + this.utdid + '","token":"","utdid":"' + this.utdid
            + '","os":"android","osv":31,"brand":"' + brand + '","model":"PPG-AN00","manu":"' + brand
            + '","userId":"' + this.uid
            + '","launch":"shortcut","mchid":"HMTFBJ1000130","nchid":"HMTFBJ1000130","session1":"'
            + this.sess + '","session2":"' + this.sess
            + '","oaid":"","imei":"","startScene":"shortcut","installTime":1725117096995,"p":4}';
    },

    portal: function (port, bodyObj) {
        var datas = __aesCbcEncrypt(this.devBody(), this.KEY, this.IV);
        if (datas.indexOf('__ERR__') === 0) throw new Error(datas);
        var enc = __aesCbcEncrypt(JSON.stringify(bodyObj), this.KEY, this.IV);
        if (enc.indexOf('__ERR__') === 0) throw new Error(enc);
        var r = JSON.parse(request(this.host + '/free-video-portal/portal/' + port, {
            method: 'POST',
            headers: { 'alg': 'HG45LKBS', 'datas': datas, 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'okhttp/4.10.0' },
            body: enc,
        }).content);
        if (!v_ok(r)) throw new Error('portal/' + port + ' code=' + r.code);
        var plain = __aesCbcDecrypt(r.data, this.KEY, this.IV);
        if (plain.indexOf('__ERR__') === 0) throw new Error(plain);
        return JSON.parse(plain);
    },

    一级: function () {
        var parts = String(this.MY_CATE || '53@精选').split('@');
        var v = this.portal(1125, {
            recSwitch: true, storePageId: 10002, channelGroupId: '10',
            channelId: parseInt(parts[0], 10) || 53, channelName: parts[1] || '精选',
            lastColumnStyle: 3, fromColumnId: '1', pageFlag: String(this.MY_PAGE),
            theaterSubscriptSwitch: true,
        }) || {};
        var d = [];
        var cds = v.columnData || [];
        for (var c = 0; c < cds.length; c++) {
            var arr = cds[c].videoData || [];
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i];
                d.push({ title: it.bookName || '', img: it.coverWap || '', desc: it.finishStatusCn || '', url: String(it.bookId) });
            }
        }
        return d;
    },

    搜索: function () {
        var v = this.portal(1803, {
            keyword: this.wd || '', page: 1, size: 15,
            searchSource: '搜索按钮', hotWordType: 2, tagIds: '', reservationSwitch: true,
        }) || {};
        var d = [];
        (v.searchVos || []).forEach(function (it) {
            d.push({ title: it.bookName || '', img: it.coverWap || '', desc: it.finishStatusCn || '', url: String(it.bookId) });
        });
        return d;
    },

    二级: function () {
        var bid = String(this.input);
        var meta = this.portal(1131, { bookId: bid, needNextChapter: 0, isNeedAlias: '', bookAlias: '', resolutionRate: '720P' }) || {};
        var vi = meta.videoInfo || {};
        var chs = this.portal(1132, { bookId: bid, chapterMin: 1, chapterMax: 999 });
        var cl = (chs && chs.chapterList) || [];
        if (!cl.length) throw new Error('河马 无章节');
        var zj = cl[cl.length - 1].chapterId;
        var pu = cl.map(function (c, i) {
            return (c.chapterName || ('第' + (i + 1) + '集')) + '$' + bid + '@' + c.chapterId + '@' + zj;
        });
        return {
            vod_id: bid,
            vod_name: vi.bookName || '',
            vod_pic: vi.coverWap || '',
            vod_remarks: (vi.finishStatusCn || '') + ' 共' + cl.length + '集',
            vod_content: '剧情：' + (vi.introduction || ''),
            vod_play_from: '河马短剧',
            vod_play_url: pu.join('#'),
        };
    },

    lazy: function () {
        var parts = String(this.input).split('@');
        if (parts.length < 3) throw new Error('河马 无效播放参数');
        var v = this.portal(1139, {
            bookId: parts[0], chapterIds: [parts[1]], unClockType: 'load',
            chapterId: parts[2], resolutionRate: '720P',
        }) || {};
        var cis = v.chapterInfo || [];
        var url = '';
        if (cis.length) {
            var ct = cis[0].content || {};
            url = ct.mp4720p || ct.m3u8720p || (ct.mp4SwitchUrl && ct.mp4SwitchUrl[0]) || '';
        }
        if (!url) throw new Error('河马 无播放地址');
        return JSON.stringify({ parse: 0, url: url });
    },
}

function v_ok(r) { return !!r.data || (r.code !== 9 && r.code !== 8 && r.code !== 100); }
