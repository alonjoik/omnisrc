// 玩偶系网盘聚合（webWG 七站共用模板：玩偶/快映/蜡笔/多多/木偶/小虎/闪电）
// DYXS2 苹果CMS 模板，两种 URL 形态并存（2026-10 探测：多数站已开 PATHINFO 重写）：
//   老伪静态：/vodtype/{cate}-{pg}.html 分类翻页 · /voddetail/{id}.html 详情（玩偶等）
//   PATHINFO：/index.php/vod/type/id/{cate}[/page/{pg}].html · /index.php/vod/detail/id/{id}.html（木偶/多多/快映/蜡笔/小虎等）
// 请求自适配：先试 PATHINFO，响应不像列表/详情再回退老形态；正则同时兼容两种 href。
// 详情页网盘卡片：data-dropdown-value 分组（站点多改缩写 BD/KK/UC/115WP）+ btn-down 直链；
// 夸克/UC/115 走 muban 转存公共库（__panDetect 按 URL 判型，分组名仅展示）；
// 无可用线路时不再整体报错——返回名称/封面/简介，原因写入备注（未登录网盘/站不支持直连）。
// ext = {"host":"http://...","domains":"http://a|http://b"}：host 失效时按 domains 轮换探测。
var EXT = {};
try {
    var __ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
    if (__ej && typeof __ej === 'object') EXT = __ej;
} catch (e) {}
if (!EXT.host && EXT.domains) EXT.host = String(EXT.domains).split('|')[0].trim();
if (!EXT.host) EXT.host = 'http://woggpan.888484.xyz';

var __HOST = '';
function __pickHost() {
    if (__HOST) return __HOST;
    var seen = {};
    var cands = [EXT.host].concat(String(EXT.domains || '').split('|'));
    for (var i = 0; i < cands.length; i++) {
        var c = String(cands[i] || '').trim().replace(/\/+$/, '');
        if (!c || seen[c]) continue;
        seen[c] = 1;
        try {
            var r = request(c + '/').content || '';
            if (r.length > 2000 && /voddetail\/|vod\/detail\/id\//.test(r)) { __HOST = c; return __HOST; }
        } catch (e) {}
    }
    __HOST = EXT.host; // 全部探测失败也回主域，报错信息更真实
    return __HOST;
}

// 分类页：先 PATHINFO 后老形态——「页内出现影片详情链接」才算命中；
// 不得比页长（玩偶 PATHINFO 路径是 230K 的 Google 风控页，比正常列表还大）
function __typeHtml(cate, pg) {
    var h = __pickHost();
    var r = request(h + '/index.php/vod/type/id/' + cate + (pg > 1 ? '/page/' + pg : '') + '.html').content || '';
    if (/voddetail\/|vod\/detail\/id\//.test(r)) return r;
    var r2 = request(h + '/vodtype/' + cate + '-' + pg + '.html').content || '';
    if (/voddetail\/|vod\/detail\/id\//.test(r2)) return r2;
    return r;
}

// 详情页：先 PATHINFO 后老形态——「网盘卡片/简介容器存在」才算命中
function __detailHtml(id) {
    var h = __pickHost();
    var r = request(h + '/index.php/vod/detail/id/' + id + '.html').content || '';
    if (/btn-down|data-dropdown-value|sqjj_a|module-info-introduction/.test(r)) return r;
    var r2 = request(h + '/voddetail/' + id + '.html').content || '';
    if (/btn-down|data-dropdown-value|sqjj_a|module-info-introduction/.test(r2)) return r2;
    return r;
}

// 分组缩写 → 展示名（判型由 __panDetect 按分享 URL 决定，与分组名无关）
function __panLabel(g) {
    var map = { BD: '百度云盘', baidu: '百度云盘', KK: '夸克网盘', UC: 'UC网盘', '115WP': '115网盘', WP: '115网盘', XL: '迅雷云盘', Xunlei: '迅雷云盘' };
    return map[g] || g;
}

var rule = {
    title: '玩偶',
    host: EXT.host,
    searchable: 0, // 站点搜索被 301 禁用（重定向 google）
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },

    class_parse: function () {
        var html = request(__pickHost() + '/').content || '';
        var cls = [], seen = {};
        // 双形态 nav：<a ... href="/vodtype/1.html">名</a> · <a ... href="/index.php/vod/type/id/1.html">名</a>
        var re = /href="(?:\/vodtype\/|\/index\.php\/vod\/type\/id\/)(\d+)\.html"[^>]*>[\s\S]{0,120}?([^<>]{2,12})<\/a>/g;
        var m;
        while ((m = re.exec(html)) !== null) {
            var tid = m[1], name = m[2].replace(/\s+/g, '');
            if (!name || seen[tid]) continue;
            if (name === '首页' || name === '留言' || name === '帮助') continue;
            seen[tid] = 1;
            cls.push({ type_id: tid, type_name: name });
            if (cls.length >= 24) break;
        }
        return { class: cls };
    },

    一级: function () {
        var html = __typeHtml(this.MY_CATE || '1', parseInt(this.MY_PAGE || '1', 10) || 1);
        var d = [], seen = {};
        // 卡片：<a href="[两种前缀]{id}.html" title="名">…</a> 后近邻 img 的 data-src（a 与 img 为兄弟节点）
        var re = /<a[^>]*href="(?:\/index\.php\/vod\/detail\/id\/|\/voddetail\/)(\d+)\.html"[^>]*title="([^"]{1,80})"[\s\S]{0,600}?data-src="([^"]{10,300})"/g;
        var m;
        while ((m = re.exec(html)) !== null) {
            var id = m[1];
            if (seen[id]) continue;
            seen[id] = 1;
            d.push({ title: m[2], img: m[3], desc: '', url: id });
        }
        return d;
    },

    二级: function () {
        var html = __detailHtml(this.input);
        var t = /<h1[^>]*>([^<]{1,120})<\/h1>/.exec(html);
        var pic = /<img[^>]*class="lazy[^"]*"[^>]*data-src="([^"]{10,300})"/.exec(html);
        // 简介容器双形态：老站 div(module-info-introduction|skill-c) · 新站 p(sqjj_a)
        var intro = /<(?:div|p)[^>]*class="[^"]*(?:module-info-introduction|skill-c|sqjj_a)[^"]*"[^>]*>([\s\S]{10,3000}?)<\/(?:div|p)>/.exec(html);
        // 网盘分组卡片：data-dropdown-value="缩写|中文名" 顺序 + 对应模块内的直链 href
        var groups = [];
        var gre = /data-dropdown-value="([^"]{1,20})"/g, gm;
        while ((gm = gre.exec(html)) !== null) groups.push(gm[1]);
        var links = [];
        var lre = /<a[^>]*class="[^"]*btn-down[^"]*"[^>]*href="(https?:\/\/[^"]{10,300})"/g, lm;
        while ((lm = lre.exec(html)) !== null) links.push(lm[1]);
        var froms = [], urls = [], firstFail = '';
        for (var i = 0; i < groups.length && i < links.length; i++) {
            var g = groups[i], link = links[i];
            var pf = __panDetect(link);
            if (!pf) { if (!firstFail) firstFail = __panLabel(g) + '暂不支持直连'; continue; }
            var det;
            try { det = __panDetailOf(link, g); } catch (e) {
                var msg = String((e && e.message) || e).slice(0, 60);
                if (!firstFail) firstFail = __panLabel(g) + '：' + msg;
                continue;
            }
            if (det && det.count > 0) {
                froms.push(__panLabel(g));
                urls.push(det.play_url);
            }
        }
        // 无可用线路不再 throw——详情基础信息照常返回，原因写备注
        var remarks = froms.length ? froms.join('/') : (firstFail || '暂无可用网盘线路');
        return {
            vod_id: this.input,
            vod_name: t ? t[1] : '玩偶',
            vod_pic: pic ? pic[1] : '',
            vod_remarks: remarks,
            vod_content: intro ? intro[1].replace(/<[^>]+>/g, '').trim().slice(0, 500) : '',
            vod_play_from: froms.join('$$$'),
            vod_play_url: urls.join('$$$'),
        };
    },

    lazy: function () {
        return JSON.stringify(__panLazyOf(this.input));
    },
}
