// 玩偶系网盘聚合（webWG 七站共用模板：玩偶/快映/蜡笔/多多/木偶/小虎/闪电）
// DYXS2 苹果CMS 模板：/vodtype/{id}.html 分类 · /vodtype/{id}-{pg}.html 翻页 · /voddetail/{id}.html 详情
// 详情页网盘卡片：data-dropdown-value="夸克网盘" 分组 + href 直链；夸克/UC 走 muban 转存公共库
// host 由源 ext 传入：ext = {"host":"http://woggpan.888484.xyz"}
var EXT = {};
try {
    var __ej = JSON.parse(typeof __extJson !== 'undefined' && __extJson ? __extJson : '{}');
    if (__ej && typeof __ej === 'object') EXT = __ej;
} catch (e) {}
if (!EXT.host) EXT.host = 'http://woggpan.888484.xyz';

var rule = {
    title: '玩偶',
    host: EXT.host,
    searchable: 0, // 站点搜索被 301 禁用（重定向 google）
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },

    class_parse: function () {
        var html = request(this.host + '/').content || '';
        var cls = [], seen = {};
        // nav 版：<a class="nav-link" href="/vodtype/1.html"><i ...></i>玩偶电影</a>
        var re = /href="\/vodtype\/(\d+)\.html"[^>]*>[\s\S]{0,120}?([^<>]{2,12})<\/a>/g;
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
        var u = this.host + '/vodtype/' + (this.MY_CATE || '1') + '-' + (this.MY_PAGE || 1) + '.html';
        var html = request(u).content || '';
        var d = [], seen = {};
        var re = /<a[^>]*href="\/voddetail\/(\d+)\.html"[^>]*title="([^"]{1,80})"[\s\S]{0,500}?data-src="([^"]{10,300})"/g;
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
        var html = request(this.host + '/voddetail/' + this.input + '.html').content || '';
        var t = /<h1[^>]*>([^<]{1,120})<\/h1>/.exec(html);
        var pic = /<img[^>]*class="lazy[^"]*"[^>]*data-src="([^"]{10,300})"/.exec(html);
        var intro = /<div[^>]*class="[^"]*(?:module-info-introduction|skill-c)[^"]*"[^>]*>([\s\S]{10,3000}?)<\/div>/.exec(html);
        // 网盘分组卡片：data-dropdown-value="xxx网盘" 顺序 + 对应模块内的直链 href
        var groups = [];
        var gre = /data-dropdown-value="([^"]{1,20})"/g, gm;
        while ((gm = gre.exec(html)) !== null) groups.push(gm[1]);
        var links = [];
        var lre = /<a[^>]*class="[^"]*btn-down[^"]*"[^>]*href="(https?:\/\/[^"]{10,300})"/g, lm;
        while ((lm = lre.exec(html)) !== null) links.push(lm[1]);
        var froms = [], urls = [];
        for (var i = 0; i < groups.length && i < links.length; i++) {
            var g = groups[i], link = links[i];
            var pf = __panDetect(link);
            if (!pf) continue; // 百度/磁力等暂不直出（夸克/UC 走转存）
            var det;
            try { det = __panDetailOf(link, g); } catch (e) { continue; }
            if (det && det.count > 0) {
                froms.push(g);
                urls.push(det.play_url);
            }
        }
        if (!froms.length) throw new Error('无可用网盘线路');
        return {
            vod_id: this.input,
            vod_name: t ? t[1] : '玩偶',
            vod_pic: pic ? pic[1] : '',
            vod_remarks: froms.join('/'),
            vod_content: intro ? intro[1].replace(/<[^>]+>/g, '').trim().slice(0, 500) : '',
            vod_play_from: froms.join('$$$'),
            vod_play_url: urls.join('$$$'),
        };
    },

    lazy: function () {
        return JSON.stringify(__panLazyOf(this.input));
    },
}
