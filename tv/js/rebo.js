// rebo.js — 热播秒播(v.rbotv.cn,WexAiReBo 对拍;批次B 自 PanBox 壳 panboxjs 迁入,rule 形态)
// 协议:POST multipart/form-data(固定 boundary);sign=md5("7gp0bnd2sr85ydii2j32pcypscoc4w6c7g5spl"+timestamp);
//       /v3/type/top_type(分类+filters) /v3/home/type_search(列表) /v3/home/vod_details(详情) /v3/home/search(搜索);
//       play:flag 含 '=' → GET 解析跳转取 {url}(需错误回退 query.url),否则直出
var RB_HOST = 'http://v.rbotv.cn';
var RB_BOUNDARY = '5c6034f2-670b-4fc0-87dd-ea23926c731b';
var RB_SALT = '7gp0bnd2sr85ydii2j32pcypscoc4w6c7g5spl';
var RB_UA = 'Mozilla/5.0 (Linux; Android 12; V2055A Build/SP1A.210812.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36';

// 网络双通道:PanBox 壳 __reqRaw / drpy 公共面 request
function rb_req(url, opt) {
    opt = opt || {};
    if (typeof __reqRaw !== 'undefined') {
        var r = JSON.parse(__reqRaw(url, JSON.stringify(opt)));
        return { ok: !!r.ok, status: r.status || 0, content: String(r.content || '') };
    }
    var r2 = request(url, opt);
    return { ok: (r2.status || 0) >= 200 && (r2.status || 0) < 300, status: r2.status || 0, content: String(r2.content || '') };
}

function rb_headers() {
    return {
        'User-Agent': 'okhttp-okgo/jeasonlzy',
        'Content-Type': 'multipart/form-data; boundary=' + RB_BOUNDARY,
    };
}

function rb_post(path, form) {
    var body = '';
    for (var k in form) {
        body += '--' + RB_BOUNDARY + '\r\n';
        body += 'Content-Disposition: form-data; name="' + k + '"\r\n\r\n';
        body += String(form[k] === undefined ? '' : form[k]) + '\r\n';
    }
    body += '--' + RB_BOUNDARY + '--\r\n';
    var r = rb_req(RB_HOST + path, { method: 'POST', body: body, headers: rb_headers() });
    return JSON.parse(String(r.content || '{}'));
}

function rb_sign() {
    var ts = String(Math.floor(Date.now() / 1000));
    return { sign: md5(RB_SALT + ts), timestamp: ts };
}

function rb_card(o) {
    return {
        vod_id: String(o.vod_id || o.id || ''),
        vod_name: o.vod_name || o.name || '',
        vod_pic: o.vod_pic || o.cover || '',
        vod_remarks: o.vod_remarks || o.episodes || o.remarks || '',
    };
}

function rb_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ''), desc: v.vod_remarks || '' };
    });
}

var RB_API = {
    home: function () {
        var s = rb_sign();
        var d = rb_post('/v3/type/top_type', s);
        var arr = ((d.data || {}).list) || [];
        var cats = [], filters = {};
        for (var i = 0; i < arr.length; i++) {
            var o = arr[i];
            var tid = String(o.type_id !== undefined ? o.type_id : (o.id || ''));
            cats.push({ type_id: tid, type_name: o.type_name || o.name || '' });
            var fs = [];
            var ext = o.extend || o.ext || {};
            var keys = [['class', '剧情', '全部剧情'], ['area', '地区', '全部地区'], ['year', '年份', '全部年份'], ['lang', '语言', '全部语言']];
            for (var k = 0; k < keys.length; k++) {
                var vals = ext[keys[k][0]] || [];
                if (typeof vals === 'string') vals = vals.split(',');
                var opts = [{ n: keys[k][2], v: '' }];
                for (var j = 0; j < vals.length; j++) {
                    if (vals[j] && vals[j] !== '全部') opts.push({ n: vals[j], v: vals[j] });
                }
                if (opts.length > 1) fs.push({ key: keys[k][0], name: keys[k][1], value: opts });
            }
            if (fs.length) filters[tid] = fs;
        }
        return { class: cats, filters: filters };
    },
    category: function (args) {
        var s = rb_sign();
        var fl = args[3] || {};
        var d = rb_post('/v3/home/type_search', {
            area: fl.area || '', year: fl.year || '', type_id: args[0] || '',
            page: args[1] || '1', lang: fl.lang || '', class: fl.class || '',
            sign: s.sign, timestamp: s.timestamp,
        });
        var list = ((d.data || {}).list) || [];
        return { list: list.map(rb_card), page: parseInt(args[1], 10) || 1, pagecount: list.length >= 20 ? (parseInt(args[1], 10) || 1) + 1 : (parseInt(args[1], 10) || 1) };
    },
    search: function (args) {
        var s = rb_sign();
        var d = rb_post('/v3/home/search', { keyword: args[0] || '', page: args[2] || '1', sign: s.sign, timestamp: s.timestamp });
        var list = ((d.data || {}).list) || [];
        return { list: list.map(rb_card) };
    },
    detail: function (args) {
        var s = rb_sign();
        var d = rb_post('/v3/home/vod_details', { vod_id: args[0] || '', sign: s.sign, timestamp: s.timestamp });
        var v = d.data || {};
        var froms = [], plays = [];
        var eps = v.vod_play_list || [];
        for (var i = 0; i < eps.length; i++) {
            var line = eps[i];
            var name = line.title || line.name || ('线路' + (i + 1));
            var parse = (line.parse_urls && line.parse_urls.length) ? String(line.parse_urls[0]) : '';
            var urls = line.urls || [];
            var segs = [];
            for (var k = 0; k < urls.length; k++) {
                var u = String(urls[k].url || '');
                if (!u) continue;
                if (parse) {
                    segs.push((urls[k].name || ('第' + (k + 1) + '集')) + '$' + parse + encodeURIComponent(u));
                } else {
                    segs.push((urls[k].name || ('第' + (k + 1) + '集')) + '$' + u);
                }
            }
            if (segs.length) { froms.push(name); plays.push(segs.join('#')); }
        }
        return { list: [{
            vod_id: args[0] || '',
            vod_name: v.vod_name || v.title || '',
            vod_pic: v.vod_pic || v.cover || '',
            vod_remarks: v.vod_remarks || '',
            vod_actor: v.vod_actor || '',
            vod_director: v.vod_director || '',
            vod_content: v.vod_content || v.description || '',
            vod_play_from: froms.join('$$$'),
            vod_play_url: plays.join('$$$'),
        }] };
    },
    play: function (args) {
        var flag = args[1] || args[0] || '';
        var UA = RB_UA;
        if (flag.indexOf('=') < 0) {
            return { parse: 0, url: flag, headers: { 'User-Agent': UA } };
        }
        var r = rb_req(flag, { headers: { 'User-Agent': UA } });
        var j = {};
        try { j = JSON.parse(String(r.content || '{}')); } catch (e) { }
        var url = String(j.url || '');
        if (!url || (j.msg && String(j.msg).indexOf('错误') >= 0)) {
            // 回退:query 里 url 参数
            var m = flag.match(/[?&]url=([^&]+)/);
            if (m) url = decodeURIComponent(m[1]);
        }
        if (!url) throw new Error('解析失败');
        return { parse: 0, url: url, headers: { 'User-Agent': UA } };
    },
};

// ─── rule 形态出口(批次B:panboxjs __panCall → jsdrpy rule)───
var rule = {
    title: '热播',
    host: RB_HOST,
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,

    class_parse: function () {
        var h = RB_API.home();
        return { class: h.class, filters: h.filters };
    },

    推荐: function () {
        return rb_cards(RB_API.category(['1', '1', '', {}]).list.slice(0, 24));
    },

    一级: function () {
        var r = RB_API.category([this.MY_CATE, this.MY_PAGE, '', this.MY_FL || {}]);
        return rb_cards(r.list);
    },

    二级: function () {
        return RB_API.detail([this.input]).list[0];
    },

    搜索: function () {
        return rb_cards(RB_API.search([this.wd, '', 1]).list);
    },

    lazy: function () {
        var r = RB_API.play(['', this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};
