// maccms — 苹果CMS V10 采集站（json / xml 双形态自适应；壳+源整合 批次3 模板族）
// 站址来源 ext：{"api":"..."}（批次4 落库形态）或裸 URL 字符串；api 路径已含 /at/xml/ 的走 RSS 解析
var rule = {
    title: '苹果CMS',
    host: 'http://127.0.0.1',   // 占位：实际请求走 api() 动态站址
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    searchUrl: '**',
    play_parse: true,            // 宿主 search 入口守卫需要非空（函数式 搜索 不消费此字段）

    // 站址（去尾斜杠）
    api: function () {
        var a = '';
        var e = __extJson || '';
        try {
            var j = JSON.parse(e || 'null');
            if (typeof j === 'string') a = j;
            else if (j && j.api) a = j.api;
        } catch (err) {
            a = String(e || '').trim();   // 非 JSON：当裸 URL
        }
        if (!a && this.MY_API) a = this.MY_API;
        return String(a || '').replace(/\/+$/, '');
    },

    isXml: function () { return /at\/xml|\/xml\.php|\/xml\//i.test(this.api()); },

    UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',

    class_parse: function () {
        var c = request(this.api() + '?ac=list', { headers: { 'User-Agent': this.UA } }).content;
        var cls = [];
        if (this.isXml()) {
            // RSS：<class><ty id="1">电影</ty></class>；CDATA 会被 jsoup 解析为注释，故 xml 一律正则提取
            var re = /<ty id="([^"]*)">([\s\S]*?)<\/ty>/g, m;
            while ((m = re.exec(c))) {
                var nm = m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
                if (m[1] || nm) cls.push({ type_id: m[1], type_name: nm, type_pid: '0' });
            }
        } else {
            var r = JSON.parse(c);
            (r.class || []).forEach(function (t) {
                // type_pid：父子分类体系（ffzy/lziapi 系 0=顶级）；无该字段的站归 0
                cls.push({ type_id: String(t.type_id), type_name: t.type_name || '', type_pid: String(t.type_pid || 0) });
            });
        }
        return { class: cls };
    },

    // 列表：json → r.list[{vod_id,vod_name,vod_pic,vod_remarks}]；xml → <video> 节点
    _list: function (c) {
        var d = [];
        if (this.isXml()) {
            c.split('<video>').slice(1).forEach(function (seg) {
                seg = seg.split('</video>')[0];
                var g = function (tag) {
                    var m = seg.match(new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>'));
                    return m ? m[1].trim() : '';
                };
                d.push({ title: g('name') || g('title'), img: g('pic'), desc: g('note') || g('des'), url: g('id') });
            });
        } else {
            (JSON.parse(c).list || []).forEach(function (v) {
                d.push({
                    title: v.vod_name || '',
                    img: v.vod_pic || '',
                    desc: v.vod_remarks || v.vod_class || '',
                    url: String(v.vod_id),
                });
            });
        }
        return d;
    },

    一级: function () {
        var u = this.api() + '?ac=' + (this.isXml() ? 'videolist&at=xml' : 'videolist') +
            '&t=' + encodeURIComponent(this.MY_CATE || '') + '&pg=' + (this.MY_PAGE || 1);
        var c = request(u, { headers: { 'User-Agent': this.UA } }).content;
        return this._list(c);
    },

    搜索: function () {
        var u = this.api() + '?ac=' + (this.isXml() ? 'videolist&at=xml' : 'videolist') +
            '&wd=' + encodeURIComponent(this.wd || '');
        var c = request(u, { headers: { 'User-Agent': this.UA } }).content;
        return this._list(c);
    },

    二级: function () {
        var id = this.input;
        var u = this.api() + '?ac=' + (this.isXml() ? 'videolist&at=xml' : 'videolist') + '&ids=' + encodeURIComponent(id);
        var c = request(u, { headers: { 'User-Agent': this.UA } }).content;
        var vod;
        if (this.isXml()) {
            var seg = c.split('<video>').slice(1).join('<video>').split('</video>')[0] || '';
            var g = function (tag) {
                var m = seg.match(new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>'));
                return m ? m[1].trim() : '';
            };
            // dd 体本身已是 "集名$URL"（或裸 URL），按 flag 分组为多线路（$$$ 分隔）
            var lines = {};   // flag -> [集段]
            var order = [];
            var ddre = /<dd flag="([^"]*)">([\s\S]*?)<\/dd>/g, dm;
            while ((dm = ddre.exec(seg))) {
                var flag = dm[1] || 'maccms';
                var body = (dm[2] || '').replace(/<!\[CDATA\[|\]\]>/g, '');
                body.split('#').forEach(function (x) {
                    x = x.trim();
                    if (!x) return;
                    if (!lines[flag]) { lines[flag] = []; order.push(flag); }
                    // 裸 URL 补集名；已含 $ 的保持原样（勿再加 flag 前缀）
                    lines[flag].push(x.indexOf('$') >= 0 ? x : ('第' + (lines[flag].length + 1) + '集$' + x));
                });
            }
            vod = {
                vod_id: id,
                vod_name: g('name'),
                vod_pic: g('pic'),
                vod_remarks: g('note'),
                vod_content: g('des'),
                vod_play_from: order.join('$$$') || 'maccms',
                vod_play_url: order.map(function (f) { return lines[f].join('#'); }).join('$$$'),
            };
        } else {
            var r = JSON.parse(c);
            var it = (r.list || [])[0] || {};
            vod = {
                vod_id: id,
                vod_name: it.vod_name || '',
                vod_pic: it.vod_pic || '',
                vod_remarks: it.vod_remarks || '',
                type_name: it.type_name || '',
                vod_content: it.vod_content || '',
                vod_play_from: it.vod_play_from || 'maccms',
                vod_play_url: it.vod_play_url || '',
            };
        }
        return vod;
    },

    // 直链播放（vod_play_url 已含真实地址；加密线的站靠批次5 分诊）
    lazy: function () {
        var u = this.input;
        if (u.indexOf('http') !== 0) throw new Error('maccms 非直链播放地址');
        return JSON.stringify({ parse: 0, url: u });
    },
}
