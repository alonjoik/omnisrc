// jianpian.js — 荐片 App API 源(批次A jar 退役等价物,rule 函数形态)
// 协议:docs/integrations/jianpian-protocol.md(2026-10-21 裸 HTTP 实测)
//   三头必需:UA(尾缀 packageName:com.jp3.xg3)+ accept + x-requested-with
//   分类:tid 1电影/2电视剧/3动漫/4综艺(crumb)·50纪录片/99Netflix(dyTag 聚合流)
//   直链唯一来源 detailv2.data.source_list_source(https m3u8 裸可达;
//   m3u8_list 现已全空、ftp_list 为 App 内核专用协议,均弃用)
// ext 可省;显式传入:{"api":"https://api.ztcgi.com","img":"https://img.jgsfnl.com","filters":"http://..."}
// 图片域省略 appAuthConfig 动态发现(YAGNI:ext.img 为现行图床,失效仅影响封面)

var JP_API = 'https://api.ztcgi.com';
var JP_IMG = 'https://img.jgsfnl.com';
var JP_UA = 'Mozilla/5.0 (Linux; Android 11; Redmi K30 Pro Zoom Edition Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.210 Mobile Safari/537.36;webank/h5face;webank/1.0;netType:NETWORK_WIFI;appVersion:416;packageName:com.jp3.xg3';
var JP_HEADERS = { 'User-Agent': JP_UA, 'accept': 'application/json, text/plain, */*', 'x-requested-with': 'com.jp3.xg3' };
// 分类常量(与 App 一致);50/99 走 dyTag 聚合流,其余走 crumb 筛选
var JP_CLASSES = [
    { type_id: '1', type_name: '电影' },
    { type_id: '2', type_name: '电视剧' },
    { type_id: '3', type_name: '动漫' },
    { type_id: '4', type_name: '综艺' },
    { type_id: '50', type_name: '纪录片' },
    { type_id: '99', type_name: 'Netflix' },
];

(function () {
    try {
        var ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
        if (ej && typeof ej === 'object') {
            if (ej.api) JP_API = ej.api;
            if (ej.img) JP_IMG = ej.img;
        }
    } catch (e) {}
})();

function jp_get(path) {
    var r = req(JP_API + path, { headers: JP_HEADERS, timeout: 15000 });
    return JSON.parse(r.content || '{}');
}

// 列表项 → drpy 卡片;封面 = 图片域 + path/thumbnail(相对路径;搜索项为 thumbnail,列表项为 path)
function jp_card(it) {
    var pic = it.path || it.thumbnail || '';
    return {
        title: it.title || '',
        img: pic ? (JP_IMG + pic) : '',
        url: String(it.id || ''),
        desc: it.mask || it.score || '',
    };
}

var rule = {
    title: '荐片',
    host: JP_API,
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    play_parse: true,
    headers: JP_HEADERS,

    class_parse: function () {
        // 筛选配置走 ext.filters(域易失效,失败静默降级为无筛选)
        var filters = {};
        try {
            var ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
            if (ej && ej.filters) {
                var fr = req(ej.filters, { headers: JP_HEADERS, timeout: 10000 });
                var fc = JSON.parse(fr.content || 'null');
                if (fc && typeof fc === 'object') filters = fc;
            }
        } catch (e) {}
        return { class: JP_CLASSES, filters: filters };
    },

    一级: function () {
        var tid = String(this.MY_CATE || '1');
        var pg = parseInt(this.MY_PAGE || '1', 10) || 1;
        if (tid === '50' || tid === '99' || tid === '111') {
            var d = jp_get('/api/dyTag/list?category_id=' + tid + '&page=' + pg);
            var out = [];
            var blocks = d.data || [];
            for (var i = 0; i < blocks.length; i++) {
                var arr = blocks[i].dataList || [];
                for (var j = 0; j < arr.length; j++) out.push(jp_card(arr[j]));
            }
            return out;
        }
        var f = this.MY_FL || {};
        var u = '/api/crumb/list?fcate_pid=' + tid + '&area=' + encodeURIComponent(f.area || '0') +
            '&year=' + encodeURIComponent(f.year || '0') + '&type=0&sort=' + encodeURIComponent(f.by || 'updata') +
            '&page=' + pg + '&category_id=';
        return (jp_get(u).data || []).map(jp_card);
    },

    二级: function () {
        var info = (jp_get('/api/video/detailv2?id=' + this.input).data) || {};
        var from = [], urls = [];
        var groups = info.source_list_source || [];
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i], eps = g.source_list || [];
            if (!eps.length) continue;
            var ep = [];
            for (var j = 0; j < eps.length; j++) {
                ep.push((eps[j].source_name || '第' + (j + 1) + '集') + '$' + eps[j].url);
            }
            from.push(g.name || ('线路' + (i + 1)));
            urls.push(ep.join('#'));
        }
        return {
            vod_id: String(info.id || this.input),
            vod_name: info.title || '',
            vod_pic: info.thumbnail ? (JP_IMG + info.thumbnail) : '',
            vod_year: String(info.year || ''),
            vod_area: info.area || '',
            // 演职人员为 [{id,name}] 对象数组,取 name 拼串
            vod_actor: (info.actors || []).map(function (a) { return a && a.name; }).filter(Boolean).join(','),
            vod_director: (info.directors || []).map(function (d) { return d && d.name; }).filter(Boolean).join(','),
            vod_content: info.description || '',
            vod_remarks: info.mask || '',
            vod_play_from: from.join('$$$'),
            vod_play_url: urls.join('$$$'),
        };
    },

    搜索: function () {
        return (jp_get('/api/v2/search/videoV2?key=' + encodeURIComponent(this.wd) + '&category_id=88&page=1&pageSize=20').data || []).map(jp_card);
    },

    lazy: function () {
        return JSON.stringify({ parse: 0, url: this.input, header: { 'User-Agent': JP_UA } });
    },
};
