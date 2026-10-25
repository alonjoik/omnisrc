// baozi.js — 包子漫画（JS 源形态，热更新免重编译；Rust 版 baozi.rs 同构翻译）
// 结构参照 keiyoushi/baozimanhua Tachiyomi 插件：comics-card 列表 / comics-chapters 章节 / comic-contain 图片
// 线路域名：源条目 ext 传入（__extJson 兼容 "null"/空/裸域名），内置源「包子漫画」「包子漫画·备线」共用本脚本
var BZ_UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/126';
var BZ_DEFAULT = 'https://cn.dinnerku.com';
var BZ_SEARCH_BASES = ['https://www.baozimh.com', 'https://baozimh.one'];
// 封面噪声排除（logo/loading/广告位等）
var BZ_EXCLUDED = ['/cover/', 'logo', 'loading.gif', '404.png', 'favicon', '/img/', 'banner', 'recommend'];

function BZ_base() {
    var e = typeof __extJson === 'string' ? __extJson : '';
    if (!e || e === 'null' || e === '{}') return BZ_DEFAULT;
    var v = e;
    if (v.charAt(0) === '{') {
        try { v = JSON.parse(v).base || v; } catch (err) { /* 裸域名回退 */ }
    }
    v = String(v).replace(/\/+$/, '');
    return v.indexOf('http') === 0 ? v : BZ_DEFAULT;
}

function BZ_get(url) {
    var r = JSON.parse(__reqRaw(url, JSON.stringify({ headers: { 'User-Agent': BZ_UA } })));
    if (!r.ok || r.status !== 200) throw new Error('包子 HTTP ' + r.status + (r.error ? ' | ' + r.error : ''));
    return r.content;
}

function BZ_excluded(u) {
    for (var i = 0; i < BZ_EXCLUDED.length; i++) {
        if (u.indexOf(BZ_EXCLUDED[i]) >= 0) return true;
    }
    return false;
}

// 兼容 AMP 与懒加载卡片：优先真实封面地址，跳过 AMP 的 default_cover 占位图。
// Baozi 的网页封面 CDN 会对应用代理返回 Cloudflare 403；公开 App 镜像提供同路径封面。
function BZ_coverCdn(url) {
    var m = String(url || '').match(/^(https?:\/\/)([^\/?#]+)(\/cover\/[^?#]*)([?#].*)?$/i);
    if (!m) return String(url || '');
    var host = m[2].toLowerCase();
    var isBaozi = /(^|\.)baozimh\.com$/.test(host) || /(^|\.)dinnerku\.com$/.test(host) || /(^|\.)baozimh\.one$/.test(host);
    return isBaozi ? m[1] + 's.baozicdn.com/baozimhapp' + m[3] + (m[4] || '') : String(url);
}

function BZ_imageUrl(img) {
    var attrs = ['data-src', 'data-original', 'data-lazy-src', 'data-echo', 'src', 'data-srcset', 'srcset'];
    for (var i = 0; i < attrs.length; i++) {
        var value = iboxAttr(img, '', attrs[i]);
        if (!value) continue;
        // srcset 形如 "url 285w, url2 600w"，只需取第一张候选图。
        value = String(value).split(',')[0].trim().split(/\s+/)[0];
        if (!value || value.indexOf('data:') === 0 || value.indexOf('default_cover') >= 0) continue;
        var url = value.indexOf('//') === 0 ? 'https:' + value
            : (value.indexOf('http://') === 0 || value.indexOf('https://') === 0) ? value
                : value.charAt(0) === '/' ? BZ_base() + value
                    : BZ_base() + '/' + value.replace(/^\.\//, '');
        return BZ_coverCdn(url);
    }
    return '';
}

// 图片走与源请求相同的 HTTP 会话，让代理继承站点 cookie，并补正确 Referer。
function BZ_cover(card) {
    var imgs = iboxQueryAll(card, 'amp-img, img');
    for (var i = 0; i < imgs.length; i++) {
        var url = BZ_imageUrl(imgs[i]);
        if (url) return 'httpLua$baozi.js$' + url;
    }
    return '';
}

// 卡片 → vod（list/search 共用；search 时卡片可能是 a.comics-card__poster 自身）
function BZ_card(card) {
    var name = iboxText(card, '.comics-card__title');
    if (!name) name = iboxAttr(card, 'a.comics-card__poster', 'title');
    if (!name || name.indexOf('{{') >= 0) return null;
    var href = iboxAttr(card, 'a.comics-card__poster', 'href');
    if (!href) href = iboxAttr(card, '', 'href'); // 卡片自身即链接（搜索结果形态）
    var pic = BZ_cover(card);
    return { vod_id: href, vod_name: name, vod_pic: pic };
}

// page_direct 跳转链 → 章节直链：/user/page_direct?comic_id=..&section_slot=0&chapter_slot=690
// → /comic/chapter/{comic}/{s}_{c}.html
function BZ_normalizeChapter(href) {
    if (href.indexOf('/comic/chapter/') >= 0) return href;
    if (href.indexOf('page_direct') >= 0) {
        var q = href.split('?')[1] || '';
        var kv = {};
        var parts = q.split('&');
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].split('=');
            if (p.length === 2) kv[p[0]] = p[1];
        }
        if (kv.comic_id) return '/comic/chapter/' + kv.comic_id + '/' + (kv.section_slot || '0') + '_' + (kv.chapter_slot || '0') + '.html';
    }
    return '';
}

var BZ_API = {
    cats: function () {
        return {
            themes: [
                { name: '人气推荐', path_word: 'classify', count: '' },
                { name: '最新上线', path_word: 'new', count: '' },
            ],
            ordering: [],
        };
    },
    list: function (args) {
        var cate = args[0] || 'classify';
        var page = parseInt(args[2] || '1', 10) || 1;
        var url = cate === 'new' ? BZ_base() + '/list/new' : BZ_base() + '/classify?page=' + page;
        var doc = iboxParse(BZ_get(url));
        var cards = iboxQueryAll(doc, 'div.comics-card');
        var list = [];
        for (var i = 0; i < cards.length; i++) {
            var it = BZ_card(cards[i]);
            if (it) list.push(it);
        }
        return { list: list };
    },
    search: function (args) {
        var q = encodeURIComponent(args[0] || '');
        // 搜索走独立镜像站，全挂回线路域名兜底；结果与 classify 同卡片结构
        var html = null;
        for (var i = 0; i < BZ_SEARCH_BASES.length; i++) {
            try { html = BZ_get(BZ_SEARCH_BASES[i] + '/search?q=' + q); break; } catch (err) { /* 试下一镜像 */ }
        }
        if (html === null) html = BZ_get(BZ_base() + '/search?q=' + q);
        var doc = iboxParse(html);
        var cards = iboxQueryAll(doc, 'div.comics-card, a.comics-card__poster');
        var list = [];
        for (var j = 0; j < cards.length; j++) {
            var it = BZ_card(cards[j]);
            if (it) list.push(it);
        }
        return { list: list };
    },
    detail: function (args) {
        var slugUrl = args[0] || ''; // /comic/{slug}
        var html = BZ_get(BZ_base() + slugUrl);
        var doc = iboxParse(html);
        var text = function (css) { return iboxText(doc, css); };
        // 封面：og:image（属性值含冒号必须带引号——Rust 版无引号写法选择器静默失效的修正）
        var cover = iboxAttr(doc, 'meta[property="og:image"]', 'content') || iboxAttr(doc, 'meta[name="og:image"]', 'content');
        if (cover && cover.indexOf('http') === 0) cover = 'httpLua$baozi.js$' + BZ_coverCdn(cover);
        // 章节：页面"章节目录"标题前还有最新话/推荐区块，截其后解析去重
        var toc = html;
        var cut = html.indexOf('章节目录');
        if (cut < 0) cut = html.indexOf('章節目錄');
        if (cut >= 0) toc = html.substring(cut);
        var tocDoc = iboxParse(toc);
        var as = iboxQueryAll(tocDoc, 'a.comics-chapters__item');
        var chapters = [];
        var seen = {};
        for (var i = 0; i < as.length; i++) {
            var url = BZ_normalizeChapter(iboxAttr(as[i], '', 'href'));
            var chName = iboxText(as[i], 'span');
            if (!url || !chName || seen[url]) continue;
            seen[url] = 1;
            chapters.push({ id: url, name: chName });
        }
        return {
            vod_id: slugUrl,
            vod_name: text('h1.comics-detail__title'),
            vod_pic: cover,
            vod_actor: text('h2.comics-detail__author'),
            vod_content: text('p.comics-detail__desc'),
            chapters: chapters,
        };
    },
    images: function (args) {
        var chapterPath = args[0] || ''; // /comic/chapter/{slug}/{s}_{c}.html
        var requestUrl = BZ_base() + chapterPath;
        var chapterKey = String(chapterPath).replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\.html$/i, '');
        var imgs = [];
        var seen = {};
        var hops = 0;
        while (true) {
            var html = BZ_get(requestUrl);
            var doc = iboxParse(html);
            var ims = iboxQueryAll(doc, '.comic-contain amp-img, .comic-contain img, .comic-article img, .chapter-img img');
            for (var i = 0; i < ims.length; i++) {
                var src = iboxAttr(ims[i], '', 'data-src') || iboxAttr(ims[i], '', 'src');
                if (!src || BZ_excluded(src) || seen[src]) continue;
                seen[src] = 1;
                imgs.push({ url: src });
            }
            // 某些长章节会用 /0_0_2.html 继续当前话；/0_1.html 已经是下一话，不能串进来。
            hops++;
            var next = iboxAttr(doc, '#next-chapter, .next-page', 'href');
            if (!next) {
                var as = iboxQueryAll(doc, 'a');
                for (var j = 0; j < as.length; j++) {
                    var t = iboxText(as[j], '');
                    if (t === '下一页' || t === '下一頁') { next = iboxAttr(as[j], '', 'href'); break; }
                }
            }
            if (!next || hops >= 10) break;
            var nextPath = String(next).replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
            var suffix = nextPath.indexOf(chapterKey + '_') === 0 ? nextPath.substring(chapterKey.length + 1) : '';
            if (!/^\d+\.html$/i.test(suffix)) break;
            requestUrl = next.indexOf('http') === 0 ? next : BZ_base() + next;
        }
        return { images: imgs, name: '' };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = BZ_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
