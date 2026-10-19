// xyqh — csp_XYQHiker 双模式规则引擎（JS 移植自 src-tauri/src/csp.rs xyqh_call，批次3 模板族）
// ext=规则 JSON 地址或内联；模式键：分类/详情/搜索截取模式（0=JSON 点路径 1=CSS 链，CSS 链即 drpy && 语法）
var rule = {
    title: 'XYQH',
    host: 'http://127.0.0.1',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    searchUrl: '**',
    play_parse: true,

    _rules: function () {
        if (this._r) return this._r;
        var t = String(__extJson || '').trim();
        var v = {};
        try { v = JSON.parse(t || '{}'); } catch (e) { v = t; }   // 非 JSON：视作规则地址字符串（对齐 xbpq）
        if (typeof v === 'string') {
            if (v.indexOf('http') === 0) {
                var body = request(v, { headers: { 'User-Agent': 'Mozilla/5.0' } }).content;
                try { v = JSON.parse(body); } catch (e2) { throw new Error('规则拉取失败/无效: ' + v); }
            } else { v = {}; }
        }
        if (!v || typeof v !== 'object') throw new Error('规则不是对象');
        this._r = v;
        return v;
    },
    _rs: function (keys) {
        var r = this._rules();
        for (var i = 0; i < keys.length; i++) {
            var s = r[keys[i]];
            if (typeof s === 'string' && s !== '') return s;
        }
        return '';
    },
    _headers: function (spec) {
        var m = {};
        spec = String(spec || '').trim();
        if (!spec) return m;
        var macro = function (k) {
            k = k.trim();
            if (k === '手机' || k === 'MOBILE_UA') return 'Mozilla/5.0 (Linux; Android 11; M2012K11AC) AppleWebKit/537.36 Chrome/94 Mobile Safari/537.36';
            if (k === '电脑' || k === 'PC_UA') return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/94 Safari/537.36';
            if (k === 'okhttp' || k === 'OK_UA') return 'okhttp/3.15';
            return null;
        };
        if (spec.indexOf('$') < 0) { var u = macro(spec); if (u) m['User-Agent'] = u; return m; }
        spec.split('#').forEach(function (kv) {
            var i = kv.indexOf('$');
            if (i > 0) {
                var vv = macro(kv.substring(i + 1));
                m[kv.substring(0, i).trim()] = vv !== null ? vv : kv.substring(i + 1).trim();
            }
        });
        return m;
    },
    _tpl: function (t, vars) {
        var s = String(t || '');
        for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
        return s;
    },
    _abs: function (base, u) {
        u = String(u || '').trim();
        if (/^https?:\/\//.test(u)) return u;
        if (u.indexOf('//') === 0) return 'https:' + u;
        try { var j = __joinUrl(base, u); if (j) return j; } catch (e) { /* 回退 */ }
        if (u.indexOf('/') === 0) {
            var m = base.match(/^(https?:\/\/[^\/]+)/);
            if (m) return m[1] + u;
        }
        return u;
    },
    // JSON 点路径导航（对齐 Rust jnav：数字段取数组下标）
    _jnav: function (v, path) {
        var cur = v;
        String(path || '').split('.').forEach(function (seg) {
            if (seg === '') return;
            if (cur === null || cur === undefined) { cur = undefined; return; }
            cur = cur[seg];
        });
        return cur;
    },
    _jnavArr: function (v, path) {
        var t = this._jnav(v, path);
        if (t === null || t === undefined) return [];
        return Array.isArray(t) ? t : (typeof t === 'object' ? [t] : []);
    },
    _strip: function (s) {   // jsonp 剥离：首 { 到末 }
        var a = s.indexOf('{'), b = s.lastIndexOf('}');
        return (a >= 0 && b > a) ? s.substring(a, b + 1) : s;
    },
    _vars: function (isSearch, wd, cateId, pg) {
        var v = {
            cateId: isSearch ? '' : cateId,
            catePg: isSearch ? '1' : pg,
            wd: isSearch ? wd : '',
            pg: pg,
            // 未用筛选占位符置空：分类url 常含 {by}/{year}/{class}/{lang} 段，字面保留会导致站 404（筛选数据存在时下方覆盖同名键）
            by: '', area: '', year: '', lang: '', class: '',
        };
        var fl = this._rules()['筛选数据'];
        if (fl && typeof fl === 'object' && !Array.isArray(fl)) {
            for (var k in fl) v[k] = String(fl[k] || '');
        }
        return v;
    },

    class_parse: function () {
        var names = this._rs(['分类名称']).split('&');
        var vals = this._rs(['分类名称替换词', '分类值']).split('&');
        var cls = [];
        names.forEach(function (n, i) {
            n = n.trim();
            if (n) cls.push({ type_id: vals[i] !== undefined ? vals[i].trim() : '', type_name: n });
        });
        return { class: cls };
    },

    _list: function (isSearch, wd, cateId, pg) {
        var tplS = isSearch ? this._rs(['搜索链接']) : this._rs(['分类链接']);
        if (!tplS) throw new Error('规则缺少 分类链接/搜索链接');
        var url = this._tpl(tplS, this._vars(isSearch, wd, cateId, pg));
        var hdr = this._headers(this._rs(isSearch ? ['搜索请求头参数', '请求头参数'] : ['请求头参数']));
        var pfx = isSearch ? '搜索片单' : '分类片单';
        var mode = this._rs(isSearch ? ['搜索截取模式'] : ['分类截取模式']);
        var path = this._rs(isSearch ? ['搜索列表数组规则', '分类列表数组规则'] : ['分类列表数组规则']);
        var lp = this._rs([pfx + '链接加前缀']), ls = this._rs([pfx + '链接加后缀']);
        var kt = this._rs([pfx + '标题']), kl = this._rs([pfx + '链接']);
        var kp = this._rs([pfx + '图片']), ks = this._rs([pfx + '副标题']);
        var self = this;
        var items = [];
        if (mode === '1') {
            var html = request(url, { headers: hdr }).content;
            // pdfh 多候选（|| 分隔）依次取首个非空
            var pick = function (b, rule) {
                var rs = String(rule || '').split('||');
                for (var i = 0; i < rs.length; i++) {
                    var v = String(pdfh(b, rs[i]) || '');
                    if (v) return v;
                }
                return '';
            };
            pdfa(html, path).forEach(function (b) {
                var link = lp + pick(b, kl) + ls;
                var name = pick(b, kt);
                if (!name) return;
                items.push({
                    vod_id: link.indexOf('http') === 0 ? link : self._abs(url, link),
                    vod_name: name,
                    vod_pic: pick(b, kp),
                    vod_remarks: pick(b, ks),
                });
            });
        } else {
            var text = request(url, { headers: hdr }).content;
            var cut = this._rs(isSearch ? ['搜索Json数据二次截取'] : ['分类Json数据二次截取']);
            if (cut) text = this._cut1(text, cut);
            var v;
            try { v = JSON.parse(this._strip(text)); } catch (e) { throw new Error('JSON 解析失败: ' + url); }
            this._jnavArr(v, path).forEach(function (it) {
                var lv = self._jnav(it, kl);
                var link = lp + (typeof lv === 'string' ? lv : '') + ls;
                var nv = self._jnav(it, kt);
                var name = (typeof nv === 'string') ? nv : '';
                if (!name) return;
                items.push({
                    vod_id: link.indexOf('http') === 0 ? link : self._abs(url, link),
                    vod_name: name,
                    vod_pic: String(self._jnav(it, kp) || ''),
                    vod_remarks: String(self._jnav(it, ks) || ''),
                });
            });
        }
        return { list: items, page: pg, pagecount: items.length ? 999 : 1 };
    },

    // 二次截取复用截取原语（仅 JSON 模式需要；简单 pre&&post）
    _cut1: function (s, ruleStr) {
        if (!ruleStr) return s;
        var i = ruleStr.indexOf('&&');
        var pre = i < 0 ? ruleStr : ruleStr.substring(0, i);
        var post = i < 0 ? '' : ruleStr.substring(i + 2);
        var p = s.indexOf(pre);
        if (p < 0) return s;
        var rest = s.substring(p + pre.length);
        if (!post) return rest.trim();
        var q = rest.indexOf(post);
        return q < 0 ? s : rest.substring(0, q).trim();
    },

    一级: function () {
        return this._list(false, '', this.MY_CATE || '', String(this.MY_PAGE || 1)).list;
    },

    搜索: function () {
        return this._list(true, this.wd || '', '', '1').list;
    },

    二级: function () {
        var url = this.input;
        var hdr = this._headers(this._rs(['请求头参数']));
        var raw = request(url, { headers: hdr }).content;
        var mode = this._rs(['详情截取模式']);
        // 兼容两种模式键：详情截取模式 / 详情是否Jsoup写法（XYQHiker 在线规则常用后者）
        var isCss = mode === '1' || (!mode && this._rs(['详情是否Jsoup写法']) === '1');
        var name, pic, intro;
        if (!isCss) {
            var text = raw;
            var dc = this._rs(['详情Json数据二次截取']);
            if (dc) text = this._cut1(text, dc);
            var v = {};
            try { v = JSON.parse(this._strip(text)); } catch (e) { v = {}; }
            // 守卫：JSON 取值为非字符串（缺失时点路径可能落到对象本体）置空，杜绝 [object Object]
            var gs = function (path) { var x = this._jnav(v, path); return (typeof x === 'string') ? x : ''; }.bind(this);
            name = gs(this._rs(['详情片单标题']));
            pic = gs(this._rs(['详情片单图片']));
            intro = gs(this._rs(['详情片单简介']));
        } else {
            name = String(pdfh(raw, this._rs(['详情片单标题'])) || '');
            pic = String(pdfh(raw, this._rs(['详情片单图片'])) || '');
            intro = String(pdfh(raw, this._rs(['详情片单简介', '简介详情'])) || '');
            // 主标题兜底：部分规则无「详情片单标题」键（分类片单键不适用于详情页）；旺旺系 h1 是类型标签，真名在页 title《片名》里
            if (!name) {
                var ttl = this._cut1(raw, '<title>&&</title>');
                var bm = ttl.match(/《(.+?)》/);
                name = bm ? bm[1] : ttl.split(/[_(\-]/)[0].trim();
            }
            if (!name) name = String(pdfh(raw, 'body&&h1&&Text') || '').trim();
        }
        var epTitle = this._rs(['剧集标题']), epLink = this._rs(['剧集链接']);
        var lp = this._rs(['剧集链接加前缀', '详情链接加前缀']);
        var ls = this._rs(['剧集链接加后缀', '详情链接加后缀']);
        var self = this;
        var parts = [];
        var blocks;
        // 三段式多线路（XYQHiker 标准：线路列表数组 × 播放列表数组 × 选集列表，按容器序对齐）
        var lineArr = this._rs(['线路列表数组规则']);
        if (isCss && lineArr) {
            var playArr = this._rs(['播放列表数组规则']);
            var epArr2 = this._rs(['选集列表数组规则']);
            var epT2 = this._rs(['选集标题']), epL2 = this._rs(['选集链接']);
            var lts = pdfa(raw, lineArr);
            var pls = playArr ? pdfa(raw, playArr) : [];
            var ltRule = this._rs(['线路标题']);
            // "Text[替换:A=>B]" 语法：截取后文本替换
            var ltCut = ltRule, rep = null;
            var rm = ltRule.match(/^(.*?)\[替换:([^=\]]*)=>([^\]]*)\]$/);
            if (rm) { ltCut = rm[1]; rep = [rm[2], rm[3]]; }
            var rev = this._rs(['是否反转选集序列']) === '1';
            var froms = [], urls = [];
            for (var li = 0; li < pls.length; li++) {
                var eps = epArr2 ? pdfa(pls[li], epArr2) : [];
                var seg = [];
                for (var ei = 0; ei < eps.length; ei++) {
                    var t2 = String(pdfh(eps[ei], epT2) || '');
                    var u2 = String(pdfh(eps[ei], epL2) || '');
                    if (!u2) continue;
                    var full2 = lp + u2 + ls;
                    seg.push((t2 || '播放') + '$' + (full2.indexOf('http') === 0 ? full2 : self._abs(url, full2)));
                }
                if (rev) seg.reverse();
                if (!seg.length) continue;
                var lt2 = (lts[li] !== undefined) ? String(pdfh(lts[li], ltCut) || '').trim() : '';
                if (rep && lt2 === rep[0]) lt2 = rep[1];
                froms.push(lt2 || ('线路' + (li + 1)));
                urls.push(seg.join('#'));
            }
            if (froms.length) {
                return {
                    vod_id: url,
                    vod_name: name || '详情',
                    vod_pic: pic,
                    vod_content: intro,
                    vod_play_from: froms.join('$$$'),
                    vod_play_url: urls.join('$$$'),
                };
            }
        }
        if (isCss) {
            var ec = this._rs(['剧集列表二次截取']);
            var scope = ec ? (this._cut1(raw, ec) || raw) : raw;
            blocks = pdfa(scope, this._rs(['剧集数组规则']));
            blocks.forEach(function (b) {
                var t = String(pdfh(b, epTitle) || '');
                var u = String(pdfh(b, epLink) || '');
                if (!u) return;
                var full = lp + u + ls;
                parts.push((t || '播放') + '$' + (full.indexOf('http') === 0 ? full : self._abs(url, full)));
            });
        } else {
            var text2 = raw;
            var jc = this._rs(['剧集Json数据二次截取']);
            if (jc) text2 = this._cut1(text2, jc);
            var v2 = {};
            try { v2 = JSON.parse(this._strip(text2)); } catch (e) { v2 = {}; }
            this._jnavArr(v2, this._rs(['剧集数组规则'])).forEach(function (b) {
                var t = String(self._jnav(b, epTitle) || '');
                var u = String(self._jnav(b, epLink) || '');
                if (!u) return;
                var full = lp + u + ls;
                parts.push((t || '播放') + '$' + (full.indexOf('http') === 0 ? full : self._abs(url, full)));
            });
        }
        if (!parts.length) throw new Error('未解析到剧集（规则缺少 剧集数组规则）');
        var line = String(pdfh(raw, this._rs(['线路标题'])) || '').trim();
        return {
            vod_id: url,
            vod_name: name || '详情',
            vod_pic: pic,
            vod_content: intro,
            vod_play_from: line || '默认线路',
            vod_play_url: parts.join('#'),
        };
    },

    lazy: function () {
        var u = this.input;
        var direct = /\.(m3u8|mp4|flv|mkv|ts)(\?|$)/i.test(u);
        return JSON.stringify({ parse: direct ? 0 : 1, url: u, header: {} });
    },
}
