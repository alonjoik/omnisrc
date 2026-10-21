// bobo.js — 波波秒播(vip.wwgz.cn:5200 macCMS 网页抓取;批次B 自 PanBox 壳 panboxjs 迁入,rule 形态)
// cat: index.php?m=vod-list-id-{tid}-pg-{pg}-...;detail 两跳取 script mac_url;play 三前缀解析分支
// DOM 解析走 drpy 公共面 pdfa/pdfh(批次B:壳 iboxParse 句柄 API → 公共面,SPEC 红线)
var BB_HOST = 'https://vip.wwgz.cn:5200';
var BB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Mobile/15E148 Safari/604.1';
var BB_JX = 'http://103.36.222.35:9595/wexfnwshinidie/bobo/caonidie.php';

// 网络双通道:PanBox 壳 __reqRaw / drpy 公共面 request
function bb_req(url, opt) {
    opt = opt || {};
    if (typeof __reqRaw !== 'undefined') {
        var r = JSON.parse(__reqRaw(url, JSON.stringify(opt)));
        return { ok: !!r.ok, status: r.status || 0, content: String(r.content || '') };
    }
    var r2 = request(url, opt);
    return { ok: (r2.status || 0) >= 200 && (r2.status || 0) < 300, status: r2.status || 0, content: String(r2.content || '') };
}

function bb_get(url, referer) {
    var h = { 'User-Agent': BB_UA };
    if (referer) h.referer = referer;
    return bb_req(url, { headers: h }).content;
}

function bb_regex(s, re) {
    var m = new RegExp(re).exec(s || '');
    return m ? m[1] : '';
}

// 过滤无效集段(Java c()):保留 a$b 形态
function bb_cleanPlay(s) {
    var parts = String(s || '').split('#');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].split('$', 2).length >= 2) out.push(parts[i]);
    }
    return out.join('#');
}

var BB_CATS = [
    { type_id: '1', type_name: '电影', filters: [
        { key: 'cateId', name: '类型', value: [{ n: '全部', v: '1' }, { n: '动作片', v: '5' }, { n: '喜剧片', v: '6' }, { n: '爱情片', v: '7' }, { n: '科幻片', v: '8' }, { n: '恐怖片', v: '9' }, { n: '剧情片', v: '10' }, { n: '战争片', v: '11' }, { n: '惊悚片', v: '16' }, { n: '奇幻片', v: '17' }] },
        { key: 'year', name: '年份', value: [{ n: '全部', v: '' }, { n: '2024', v: '2024' }, { n: '2023', v: '2023' }, { n: '2022', v: '2022' }, { n: '2021', v: '2021' }, { n: '2020', v: '2020' }, { n: '2019', v: '2019' }, { n: '2018', v: '2018' }] },
        { key: 'area', name: '地区', value: [{ n: '全部', v: '' }, { n: '大陆', v: '大陆' }, { n: '香港', v: '香港' }, { n: '台湾', v: '台湾' }, { n: '美国', v: '美国' }, { n: '韩国', v: '韩国' }, { n: '日本', v: '日本' }, { n: '泰国', v: '泰国' }, { n: '英国', v: '英国' }, { n: '法国', v: '法国' }, { n: '加拿大', v: '加拿大' }] },
        { key: 'by', name: '排序', value: [{ n: '全部', v: '' }, { n: '时间', v: 'time' }, { n: '人气', v: 'hits' }, { n: '评分', v: 'score' }] },
    ] },
    { type_id: '2', type_name: '电视剧', filters: [
        { key: 'cateId', name: '类型', value: [{ n: '全部', v: '2' }, { n: '国产剧', v: '12' }, { n: '港台剧', v: '13' }, { n: '日韩剧', v: '14' }, { n: '欧美剧', v: '15' }] },
        { key: 'year', name: '年份', value: [{ n: '全部', v: '' }, { n: '2024', v: '2024' }, { n: '2023', v: '2023' }, { n: '2022', v: '2022' }, { n: '2021', v: '2021' }, { n: '2020', v: '2020' }] },
        { key: 'by', name: '排序', value: [{ n: '全部', v: '' }, { n: '时间', v: 'time' }, { n: '人气', v: 'hits' }, { n: '评分', v: 'score' }] },
    ] },
    { type_id: '3', type_name: '综艺' },
    { type_id: '4', type_name: '动漫', filters: [
        { key: 'cateId', name: '类型', value: [{ n: '全部', v: '4' }, { n: '动漫剧', v: '18' }, { n: '动漫片', v: '19' }] },
        { key: 'by', name: '排序', value: [{ n: '全部', v: '' }, { n: '时间', v: 'time' }, { n: '人气', v: 'hits' }] },
    ] },
    { type_id: '26', type_name: '短剧' },
];

var BB_API = {
    home: function () {
        var html = bb_get(BB_HOST + '/');
        var recs = [];
        var lists = pdfa(html, 'ul.resize_list');
        for (var i = 0; i < lists.length; i++) {
            var lis = pdfa(lists[i], 'li');
            for (var j = 0; j < lis.length; j++) {
                var t = pdfh(lis[j], 'a&&title');
                var href = pdfh(lis[j], 'a&&href');
                if (!t || !href) continue;
                recs.push({ vod_id: href, vod_name: t, vod_pic: pdfh(lis[j], 'a&&data-src') || pdfh(lis[j], 'a&&src') || '', vod_remarks: '推荐' });
                if (recs.length >= 24) break;
            }
            if (recs.length >= 24) break;
        }
        return { class: BB_CATS.map(function (c) {
            var o = { type_id: c.type_id, type_name: c.type_name };
            if (c.filters) o.filters = c.filters;
            return o;
        }), list: recs };
    },
    category: function (args) {
        var ext = args[3] || {};
        var tid = ext.cateId || args[0] || '1';
        var pg = parseInt(args[1], 10) || 1;
        var by = ext.by || '';
        var year = ext.year || '';
        var area = ext.area || '';
        var path = 'index.php?m=vod-list-id-' + tid + '-pg-' + pg + '-order--by-' + by + '-class-0-year-' + year + '-letter--area-' + area + '-lang-.html';
        var html = bb_get(BB_HOST + '/' + path);
        var items = pdfa(html, 'section.mod-bd.clearfix&&li');
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var t = pdfh(items[i], 'a&&title');
            var href = pdfh(items[i], 'a&&href');
            if (!t || !href) continue;
            var pic = pdfh(items[i], 'a&&data-src') || pdfh(items[i], 'a&&src')
                || pdfh(items[i], 'img&&data-src') || pdfh(items[i], 'img&&src') || '';
            out.push({ vod_id: href, vod_name: t, vod_pic: pic, vod_remarks: '' });
        }
        return { list: out, page: pg, pagecount: out.length < 24 ? pg : pg + 1 };
    },
    search: function (args) {
        var wd = args[0] || '';
        var pg = parseInt(args[1], 10) || 1;
        var html = bb_get(BB_HOST + '/vod-search-pg-' + pg + '-wd-' + encodeURIComponent(wd) + '.html');
        var items = pdfa(html, '.ulPicTxt.clearfix&&li');
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var href = pdfh(items[i], 'div.pic&&a&&href');
            if (!href) continue;
            var t = String(pdfh(items[i], 'span.sTit&&Text') || pdfh(items[i], 'a&&Text') || '').trim();
            var pic = pdfh(items[i], 'div.pic&&img&&src') || pdfh(items[i], 'div.pic&&img&&data-src') || '';
            out.push({ vod_id: href, vod_name: t, vod_pic: pic, vod_remarks: '' });
        }
        return { list: out, page: pg, pagecount: out.length < 20 ? pg : pg + 1 };
    },
    detail: function (args) {
        var href = String(args[0] || '');
        while (href.charAt(0) === '/') href = href.slice(1);
        var html = bb_get(BB_HOST + '/' + href);
        var name = pdfh(html, 'section.page-bd&&h1&&a&&Text');
        var desc = pdfh(html, 'section.mod&&article&&p&&Text');
        var lis = pdfa(html, '.numList&&li');
        var playUrl = '', playFrom = '波波';
        if (lis.length) {
            var firstHref = pdfh(lis[0], 'a&&href');
            if (!firstHref) firstHref = pdfh(lis[0], 'li&&href') || '';
            while (firstHref.charAt(0) === '/') firstHref = firstHref.slice(1);
            var script = bb_get(BB_HOST + '/' + firstHref);
            // script 段在页面内:直接正则全文
            var macUrl = bb_regex(script, "mac_url='([\\s\\S]*?)';");
            var macFrom = bb_regex(script, "mac_from='([\\s\\S]*?)'");
            if (macFrom) playFrom = macFrom;
            if (macUrl.indexOf('$$$') >= 0) {
                var segs = [];
                var parts = macUrl.split('$$$');
                for (var i = 0; i < parts.length; i++) {
                    var c = bb_cleanPlay(parts[i]);
                    if (c) segs.push(c);
                }
                playUrl = segs.join('$$$');
            } else {
                playUrl = bb_cleanPlay(macUrl);
            }
        }
        if (!playUrl) throw new Error('波波剧集为空');
        return { list: [{
            vod_id: args[0],
            vod_name: name,
            vod_pic: '',
            vod_content: String(desc || '').trim(),
            vod_play_from: playFrom,
            vod_play_url: playUrl,
        }] };
    },
    play: function (args) {
        var flag = args[0] || '';
        var url = flag;
        if (flag.indexOf('dJj') === 0) {
            var u1 = BB_JX + encodeURIComponent(flag);
            url = bb_regex(bb_get(u1, u1).replace(/ /g, ''), "video:\\{url:'([\\s\\S]*?)',");
        } else if (flag.indexOf('aFHBRI09') === 0) {
            var u2 = 'https://api.wwgz.cn:520/webcloud/m3u8.php?url=' + encodeURIComponent(flag);
            url = bb_regex(bb_get(u2, u2).replace(/ /g, ''), "url='([\\s\\S]*?)';");
        } else if (flag.indexOf('bFWBFI09Z7X3J1pHYeWlwlvocW') === 0) {
            var u3 = 'https://api.wwgz.cn:520/webcloud/nmm3.php?url=' + encodeURIComponent(flag);
            url = bb_regex(bb_get(u3, u3).replace(/ /g, ''), "url='([\\s\\S]*?)';");
        }
        if (!url) throw new Error('波波解析播放地址为空');
        return { parse: 0, url: url, headers: { 'User-Agent': BB_UA } };
    },
};

// ─── rule 形态出口(批次B:panboxjs __panCall → jsdrpy rule)───
function bb_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ''), desc: v.vod_remarks || '' };
    });
}

var rule = {
    title: '波波',
    host: BB_HOST,
    searchable: 1,
    quickSearch: 0,
    filterable: 1,
    play_parse: true,
    headers: { 'User-Agent': BB_UA },

    class_parse: function () {
        var filters = {};
        for (var i = 0; i < BB_CATS.length; i++) {
            if (BB_CATS[i].filters) filters[BB_CATS[i].type_id] = BB_CATS[i].filters;
        }
        return { class: BB_CATS.map(function (c) { return { type_id: c.type_id, type_name: c.type_name }; }), filters: filters };
    },

    推荐: function () {
        return bb_cards(BB_API.home().list);
    },

    一级: function () {
        var ext = this.MY_FL || {};
        if (ext.cateId === undefined) ext.cateId = this.MY_CATE;
        var r = BB_API.category([this.MY_CATE, this.MY_PAGE, '', ext]);
        return bb_cards(r.list);
    },

    二级: function () {
        return BB_API.detail([this.input]).list[0];
    },

    搜索: function () {
        return bb_cards(BB_API.search([this.wd, 1]).list);
    },

    lazy: function () {
        var r = BB_API.play([this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};
