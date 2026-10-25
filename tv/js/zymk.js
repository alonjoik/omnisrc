// zymk.js — 知音漫画（JS 源形态，热更新免重编译）
// 协议同 zymk.rs：api-cdn.kaimanhua.com / 详情 AES-128-CBC / yyhao 图床
// 契约：__panCall(reqJson) → {entry, args[]} → 返回 JSON 字符串
var ZK_BASE = 'https://api-cdn.kaimanhua.com';
var ZK_KEY = '4548ded8c9e02690';
var ZK_IV = '1992360ee9bc4f8f';
var ZK_UA = 'Mozilla/5.0 (Linux; Android 12; HD1900) AppleWebKit/537.36 Chrome/97 Mobile Safari/537.36';

var ZK_THEMES = [
    ['5', '热血'], ['9', '恋爱'], ['7', '玄幻'], ['17', '穿越'], ['20', '都市'],
    ['10', '动作'], ['13', '悬疑'], ['14', '恐怖'], ['6', '搞笑'], ['8', '生活'],
    ['11', '科幻'], ['12', '战争'], ['15', '校园'], ['16', '历史'], ['18', '后宫'],
    ['19', '体育'], ['21', '萝莉'], ['22', '漫改'], ['25', '少男'], ['26', '少女'],
    ['27', '青年'], ['23', '连载'], ['24', '完结'], ['28', '知音漫客'], ['29', '神漫'], ['30', '飒漫画'],
];

function ZK_req(url) {
    var r = JSON.parse(__reqRaw(url, JSON.stringify({ headers: { 'User-Agent': ZK_UA } })));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return JSON.parse(r.content);
}

function ZK_cover(id) {
    var s = '000000000' + id;
    var a = s.substr(Math.max(0, s.length - 9), 3);
    var b = s.substr(Math.max(0, s.length - 6), 3);
    return 'https://chapter-cover.yyhao.com/file/cover/' + a + '/' + b + '/' + id + '.jpg-300x400';
}

function ZK_mapList(d) {
    var page = d.data.page || {};
    var items = page.comic_list || [];
    var list = [];
    for (var i = 0; i < items.length; i++) {
        var c = items[i];
        list.push({
            vod_id: String(c.comic_id),
            vod_name: c.comic_name || '',
            vod_pic: ZK_cover(c.comic_id),
            vod_remarks: (c.last_chapter && c.last_chapter.name) || '',
            vod_actor: c.score ? (c.score / 10).toFixed(1) + '分' : '',
        });
    }
    return { list: list, total: page.total_num || list.length };
}

var ZK_API = {
    cats: function () {
        var themes = [];
        for (var i = 0; i < ZK_THEMES.length; i++) {
            themes.push({ name: ZK_THEMES[i][1], path_word: ZK_THEMES[i][0], count: '' });
        }
        return { themes: themes, ordering: [{ name: '人气', path_word: 'click' }, { name: '最新', path_word: 'addtime' }] };
    },
    list: function (args) {
        var cate = args[0] || '0';
        var sort = args[1] === 'addtime' ? 'addtime' : 'click';
        var page = parseInt(args[2] || '1', 10) || 1;
        return ZK_mapList(ZK_req(ZK_BASE + '/zymk-comic-api/app_api/v5/getsortlist_new/?type=' + cate + '&sort=' + sort + '&page=' + page));
    },
    search: function (args) {
        var kw = encodeURIComponent(args[0] || '');
        var page = parseInt(args[2] || '1', 10) || 1;
        return ZK_mapList(ZK_req(ZK_BASE + '/zymk-comic-api/app_api/v5/getsortlist_new/?key=' + kw + '&page=' + page));
    },
    detail: function (args) {
        var id = args[0] || '';
        var d = ZK_req(ZK_BASE + '/zymk-comic-api/v2/comic/getcomicinfo?comic_id=' + id);
        if (!d.data) throw new Error('详情无数据');
        var enc = d.data.indexOf('arsadata') === 0 ? d.data.substring(8) : d.data;
        var plain = __aesCbcDecrypt(enc, ZK_KEY, ZK_IV);
        if (plain.indexOf('__ERR__') === 0) throw new Error(plain);
        // 响应尾部可能附冗余片段：只取首个 JSON 对象
        var info = JSON.parse(plain);
        var chapters = [];
        var cl = info.chapter_list || [];
        for (var i = 0; i < cl.length; i++) {
            var ch = cl[i];
            var name = ch.chapter_name || ('第' + ch.chapter_id + '话');
            if (ch.chapter_title && name.indexOf(ch.chapter_title) < 0) name += ' ' + ch.chapter_title;
            chapters.push({
                id: id + '~' + ch.chapter_addr + '~' + (ch.start_var || 1) + '~' + (ch.end_var || ch.start_var || 1),
                name: name,
            });
        }
        return {
            vod_id: id,
            vod_name: info.comic_name || '',
            vod_pic: ZK_cover(parseInt(id, 10) || 0),
            vod_actor: info.author_name || '',
            vod_content: info.desc || '',
            chapters: chapters,
        };
    },
    images: function (args) {
        var parts = String(args[0] || '').split('~');
        if (parts.length < 4) throw new Error('章节参数无效');
        var addr = parts[1], start = parseInt(parts[2], 10), end = parseInt(parts[3], 10);
        // chapter_addr 中文百分号编码
        var enc = encodeURIComponent(addr).replace(/%2F/g, '/');
        var images = [];
        for (var n = start; n <= end; n++) {
            images.push({ url: 'https://mhpic.yyhao.com/comic/' + enc + n + '.jpg' });
        }
        return { images: images };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = ZK_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
