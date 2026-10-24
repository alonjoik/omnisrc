// maccms — 苹果CMS V10 采集站（json / xml 双形态自适应；壳+源整合 批次3 模板族）
// 站址来源 ext：{"api":"..."}（批次4 落库形态）或裸 URL 字符串；api 路径已含 /at/xml/ 的走 RSS 解析
//@tpl-ver 20261024 — 新增二级筛选（地区/年份/排序，MY_FL 消费 + 静态筛选组）
var rule = {
    title: '苹果CMS',
    host: 'http://127.0.0.1',   // 占位：实际请求走 api() 动态站址
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    searchUrl: '**',
    play_parse: true,            // 宿主 search 入口守卫需要非空（函数式 搜索 不消费此字段）

    // 静态筛选组（苹果CMS V10 采集站通用维度；v='' 即不筛）——宿主 home 的 filters 通道
    // 按 getFilters() 自动带出，key '*' 对全部分类生效
    filter: {
        '*': [
            { key: 'area', name: '地区', value: [
                { n: '全部', v: '' }, { n: '大陆', v: '大陆' }, { n: '香港', v: '香港' }, { n: '台湾', v: '台湾' },
                { n: '美国', v: '美国' }, { n: '法国', v: '法国' }, { n: '英国', v: '英国' }, { n: '日本', v: '日本' },
                { n: '韩国', v: '韩国' }, { n: '德国', v: '德国' }, { n: '泰国', v: '泰国' }, { n: '印度', v: '印度' },
                { n: '其他', v: '其他' },
            ] },
            { key: 'year', name: '年份', value: [
                { n: '全部', v: '' }, { n: '2026', v: '2026' }, { n: '2025', v: '2025' }, { n: '2024', v: '2024' },
                { n: '2023', v: '2023' }, { n: '2022', v: '2022' }, { n: '2021', v: '2021' }, { n: '2020', v: '2020' },
                { n: '2019', v: '2019' }, { n: '2018', v: '2018' }, { n: '2017', v: '2017' }, { n: '2016', v: '2016' },
                { n: '2015', v: '2015' }, { n: '更早', v: '2014' },
            ] },
            { key: 'by', name: '排序', value: [
                { n: '默认', v: '' }, { n: '最新', v: 'time' }, { n: '最热', v: 'hits' }, { n: '评分', v: 'score' },
            ] },
        ],
    },

    // 二级筛选 → query 追加段（provide/vod 标准参数白名单；json/xml 同参；MY_FL 宿主传 JSON 串）
    _filterQuery: function () {
        var fl = this.MY_FL;
        if (typeof fl === 'string' && fl.indexOf('{') >= 0) {
            try { fl = JSON.parse(fl); } catch (err) { fl = {}; }
        }
        if (!fl || typeof fl !== 'object') fl = {};
        var allow = ['class', 'area', 'year', 'lang', 'state', 'by'];
        var q = '';
        for (var i = 0; i < allow.length; i++) {
            var v = String(fl[allow[i]] || '').trim();
            if (v) q += '&' + allow[i] + '=' + encodeURIComponent(v);
        }
        return q;
    },

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

    // 分类锁定 ext：{"api":"...","cate":"30&50","cateName":"短剧&擦边短剧"}——
    // 短剧锁源只保留配置分类（含其子类），顺序即展示顺序；缺省则展示全部分类
    _cateConf: function () {
        try {
            var j = JSON.parse(__extJson || 'null');
            if (j && j.cate) return { ids: String(j.cate).split('&'), names: String(j.cateName || '').split('&') };
        } catch (err) {}
        return null;
    },

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
        var conf = this._cateConf();
        if (!conf) return { class: cls };
        // 锁定：按 cate 顺序保留配置 id 本身（不展开子类，对齐宿主锁定语义），去重
        var out = [], seen = {};
        conf.ids.forEach(function (id, i) {
            var hit = cls.filter(function (t) { return t.type_id === id; });
            if (!hit.length || seen[id]) return;
            seen[id] = 1;
            var name = (conf.names[i] || '').trim();
            var t = hit[0];
            out.push({ type_id: t.type_id, type_name: name || t.type_name, type_pid: t.type_pid });
        });
        return { class: out };
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
            '&t=' + encodeURIComponent(this.MY_CATE || '') + '&pg=' + (this.MY_PAGE || 1) +
            this._filterQuery();
        var c = request(u, { headers: { 'User-Agent': this.UA } }).content;
        return this._list(c);
    },

    搜索: function () {
        var conf = this._cateConf();
        // 锁分类源：逐配置分类查询合并去重（MacCMS 多分类 t 参数支持不一致，对齐宿主逐分类语义）
        var cates = conf ? conf.ids : [''];
        var seen = {}, d = [];
        for (var i = 0; i < cates.length; i++) {
            var u = this.api() + '?ac=' + (this.isXml() ? 'videolist&at=xml' : 'videolist') +
                '&wd=' + encodeURIComponent(this.wd || '') + '&t=' + encodeURIComponent(cates[i]);
            var c = request(u, { headers: { 'User-Agent': this.UA } }).content;
            this._list(c).forEach(function (v) {
                if (seen[v.url]) return;
                seen[v.url] = 1;
                d.push(v);
            });
        }
        return d;
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
