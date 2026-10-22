// xbpq — csp_XBPQ/XBiu 字符串截取规则引擎（JS 移植自 src-tauri/src/csp.rs xbpq_call,批次3 模板族）
// ext 三形态：http 规则地址 / 内联规则 JSON / null（对齐 Rust load_rules_json）
// 规则键（含变体）：分类/分类url/搜索url/请求头/搜索请求头/数组/搜索数组/二次截取/搜索二次截取/
//   标题/链接/图片/副标题（搜索时 "搜索"+键 优先）/影片标题|标题/影片图片|图片/简介|影片简介/
//   播放数组/播放二次截取/线路数组|多线数组/线路标题/播放列表/播放标题/播放链接/跳转播放链接
var rule = {
    title: 'XBPQ',
    host: 'http://127.0.0.1',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    searchUrl: '**',
    play_parse: true,   // 宿主 search 入口守卫（函数式 搜索 不消费）

    // ── 规则加载与基础原语 ──
    _rules: function () {
        if (this._r) return this._r;
        var t = String(__extJson || '').trim();
        var v = {};
        try { v = JSON.parse(t || '{}'); } catch (e) { throw new Error('规则 JSON 无效: ' + String(t).substring(0, 60)); }
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
    _rs: function (keys) {   // 键名变体依次取
        var r = this._rules();
        for (var i = 0; i < keys.length; i++) {
            var s = r[keys[i]];
            if (typeof s === 'string' && s !== '') return s;
        }
        return '';
    },
    // ── 残缺配置兜底：TVBox 社区配置常只带 分类+分类url，站点实为苹果CMS标准UI（stui/myui 族）──
    // 只补缺失键、不覆盖显式规则；数组规则多族结构在 _listPage 取数时按命中嗅探
    // 末族为详情链接锚定（module 主题影片区 <a href="/vod/detail/...">，天然排除导航区链接；
    // 配合 _listPage 链接形态兜底重组被锚点吃掉的 href 头部）
    _DEF_ARRS: ['stui-vodlist__box&&</li>', 'stui-vodlist__item&&</li>', 'myui-vodlist__box&&</li>', 'myui-vodlist__media&&</li>', 'class="module-item"&&</div>', '<a href="/vod/detail/&&</a>', 'public-list-exp&&</a>'],
    _fillDefaults: function () {
        var r = this._rules();
        var set = function (k, v) { if (!r[k]) r[k] = v; };
        set('标题', 'title="&&"');
        set('链接', 'href="&&"');
        set('图片', 'data-original="&&"');
        set('副标题', 'pic-text text-right">&&</span>');
        // 播放三键不设默认：无显式播放数组时全页 <a> 会截到自身 URL 等垃圾，留空走嗅探兜底
        set('线路数组', 'nav-tabs&&</ul>');
        set('线路标题', '>&&</a>');
        // 请求头兜底：残缺配置无「请求头」时引擎发非浏览器 UA 被 CF/宝塔 WAF 拦（curl Chrome UA 同页可通）
        if (!r['请求头']) {
            var hm = String(r['分类url'] || r['搜索url'] || '').match(/https?:\/\/[^\/]+/);
            r['请求头'] = 'User-Agent$电脑#Referer$' + (hm ? hm[0] + '/' : '');
        }
        return r;
    },
    _headers: function (spec) {  // "A$B#C$D" + UA 宏
        var m = {};
        spec = String(spec || '').trim();
        if (!spec) return m;
        var macro = function (k) {
            k = k.trim();
            if (k === '手机' || k === 'MOBILE_UA' || k === 'mobile') return 'Mozilla/5.0 (Linux; Android 11; M2012K11AC) AppleWebKit/537.36 Chrome/94 Mobile Safari/537.36';
            if (k === '电脑' || k === 'PC_UA' || k === 'pc') return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/94 Safari/537.36';
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
    _enc: function (s) {     // 对齐 Rust enc：NON_ALPHANUMERIC 全量编码
        var out = '';
        String(s).split('').forEach(function (ch) {
            if (/[A-Za-z0-9]/.test(ch)) out += ch;
            else {
                var b = unescape(encodeURIComponent(ch));
                for (var i = 0; i < b.length; i++) out += '%' + ('0' + b.charCodeAt(i).toString(16).toUpperCase()).slice(-2);
            }
        });
        return out;
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

    // ── 截取原语（find_pre 语义：末尾 * 跳属性到 '>',中间 * lazy）──
    _pre: function (s, pre) {
        if (!pre) return [0, 0];
        if (pre.indexOf('*') >= 0) {
            var pat;
            if (pre.charAt(pre.length - 1) === '*') pat = pre.substring(0, pre.length - 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*>';
            else pat = pre.split('*').map(function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('[\\s\\S]*?');
            var m = s.match(new RegExp(pat));
            if (!m) return null;
            return [m.index, m.index + m[0].length];
        }
        var i = s.indexOf(pre);
        return i < 0 ? null : [i, i + pre.length];
    },
    _cut1: function (s, ruleStr) {
        if (!ruleStr) return '';
        var i = ruleStr.indexOf('&&');
        var pre = i < 0 ? ruleStr : ruleStr.substring(0, i);
        var post = i < 0 ? '' : ruleStr.substring(i + 2);
        var p = this._pre(s, pre);
        if (!p) return '';
        var rest = s.substring(p[1]);
        if (!post) return rest.trim();
        var q = this._pre(rest, post);
        return q ? rest.substring(0, q[0]).trim() : '';
    },
    _cutAll: function (s, ruleStr) {
        if (!ruleStr) return [];
        var i = ruleStr.indexOf('&&');
        var pre = i < 0 ? ruleStr : ruleStr.substring(0, i);
        var post = i < 0 ? '' : ruleStr.substring(i + 2);
        var out = [], cur = s;
        for (;;) {
            var p = this._pre(cur, pre);
            if (!p) break;
            var rest = cur.substring(p[1]);
            if (!post) { out.push(rest.trim()); break; }
            var q = this._pre(rest, post);
            if (!q) break;
            out.push(rest.substring(0, q[0]).trim());
            cur = rest.substring(q[1]);
        }
        return out;
    },
    _preCut: function (s, ruleStr) {
        if (!String(ruleStr || '').trim()) return s;
        var c = this._cut1(s, ruleStr);
        return c === '' ? s : c;
    },
    _pairs: function (s) {   // "名$id#名$id"
        var out = [];
        String(s || '').split('#').forEach(function (x) {
            var i = x.indexOf('$');
            if (i > 0) out.push([x.substring(0, i).trim(), x.substring(i + 1).trim()]);
        });
        return out;
    },

    class_parse: function () {
        var self = this;
        var cls = this._pairs(this._rs(['分类'])).map(function (p) {
            return { type_id: p[1], type_name: p[0] };
        });
        return { class: cls };
    },

    _listPage: function (isSearch, wd, cateId, pg) {
        this._fillDefaults();
        var tplS = isSearch ? this._rs(['搜索url', '分类url']) : this._rs(['分类url']);
        // 搜索url 兜底：残缺配置用分类url 的 host 拼苹果CMS 默认搜索路由
        if (isSearch && !this._rs(['搜索url'])) {
            var hm = String(this._rs(['分类url'])).match(/https?:\/\/[^\/]+/);
            if (hm) { this._rules()['搜索url'] = hm[0] + '/vodsearch/{wd}------------.html'; tplS = this._rules()['搜索url']; }
        }
        if (!tplS) throw new Error('规则缺少 分类url/搜索url');
        var url = isSearch
            ? this._tpl(tplS, { wd: this._enc(wd), pg: pg, catePg: '1', cateId: '', by: '', area: '', year: '', lang: '', class: '', letter: '', sorter: '', addtime: '' })
            : this._tpl(tplS, { cateId: cateId, catePg: pg, pg: pg, by: '', area: '', year: '', lang: '', class: '', letter: '', sorter: '', addtime: '' });
        var hdr = this._headers(this._rs(isSearch ? ['搜索请求头', '请求头'] : ['请求头']));
        // POST 搜索支持(如 QY影视 wdbay 仅收 POST):ext「搜索方法」=post +「搜索body」模板
        var reqOpt = { headers: hdr };
        var method = this._rs(['搜索方法', '请求方法']);
        var bodyTpl = isSearch ? this._rs(['搜索body', '请求body']) : '';
        if (isSearch && method && method.toLowerCase() === 'post' && bodyTpl) {
            reqOpt.method = 'POST';
            reqOpt.body = this._tpl(bodyTpl, { wd: this._enc(wd), pg: pg, catePg: '1', cateId: '', by: '', area: '', year: '', lang: '', class: '', letter: '', sorter: '', addtime: '' });
            var hasCt = false;
            for (var hk in reqOpt.headers) { if (hk.toLowerCase() === 'content-type') hasCt = true; }
            if (!hasCt) reqOpt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        var page = request(url, reqOpt).content;
        var html = this._preCut(page, this._rs(['搜索二次截取', '二次截取']));
        var arr = this._rs(isSearch ? ['搜索数组', '数组'] : ['数组']);
        var blocks = this._cutAll(html, arr);
        // 数组嗅探：显式规则零命中时按 stui/myui/模块 三族依次尝试（残缺配置兜底）
        if (!blocks.length) {
            for (var di = 0; di < this._DEF_ARRS.length; di++) {
                if (this._DEF_ARRS[di] === arr) continue;
                var b2 = this._cutAll(html, this._DEF_ARRS[di]);
                if (b2.length) { arr = this._DEF_ARRS[di]; blocks = b2; break; }
            }
        }
        var self = this;
        var items = [];
        blocks.forEach(function (b) {
            if (!b) return;
            var field = function (keys) {
                for (var i = 0; i < keys.length; i++) {
                    var rk;
                    if (isSearch) {
                        // 对齐 Rust：搜索键命中即返回（空也返回），不回退通用键
                        rk = self._rs(['搜索' + keys[i]]);
                        if (rk) return self._cut1(b, rk).trim();
                    }
                    rk = self._rs([keys[i]]);
                    if (rk) { var v = self._cut1(b, rk).trim(); if (v) return v; }
                }
                return '';
            };
            var name = field(['标题']), link = field(['链接']);
            // 锚定数组形态兜底：'<a href="/xxx/' 锚点吃掉 href 值头部，块首残段重组完整链接
            if (!link && arr.indexOf('<a href="/') === 0) {
                var anchor = arr.substring(9, arr.indexOf('&&'));
                var lv = self._cut1(b, '&&"').trim();
                if (lv && lv.indexOf('/') !== 0) link = anchor + lv;
            }
            if (!name || !link) return;
            // 懒加载占位（data-original="/"）不算封面
            var rawPic = field(['图片']);
            items.push({
                vod_id: self._abs(url, link),
                vod_name: name,
                vod_pic: (rawPic && rawPic !== '/') ? self._abs(url, rawPic) : '',
                vod_remarks: field(['副标题']),
            });
        });
        return { list: items, page: pg, pagecount: items.length ? 999 : 1 };
    },

    一级: function () {
        return this._listPage(false, '', this.MY_CATE || '', String(this.MY_PAGE || 1)).list;
    },

    搜索: function () {
        return this._listPage(true, this.wd || '', '', '1').list;
    },

    二级: function () {
        this._fillDefaults();
        var url = this.input;
        // 直链守卫：vod_id 本身是媒体直链（WP VideoObject 等直链源），免请求直接构造播放条目
        if (/\/index\.(m3u8|mp4|flv)(\?|$)/i.test(url) || /\.(m3u8|mp4|flv)(\?|$)/i.test(url)) {
            return { vod_id: url, vod_name: '', vod_pic: '', vod_play_from: '直链',
                     vod_play_url: '正片$' + url };
        }
        var hdr = this._headers(this._rs(['请求头']));
        var html = request(url, { headers: hdr }).content;
        // 只认「影片标题」（「标题」是列表键，详情页会命中导航/记录类链接的 title，如「观看记录」）
        var name = this._cut1(html, this._rs(['影片标题'])).trim();
        if (!name) {
            var ttl = this._cut1(html, '<title>&&</title>');
            var bm = ttl.match(/《(.+?)》/);
            if (!name) name = bm ? bm[1] : ttl.split('_')[0].trim();
        }
        var pic = this._abs(url, this._cut1(html, this._rs(['影片图片', '图片'])));
        var intro = this._cut1(html, this._rs(['简介', '影片简介'])).trim();
        var pa = this._rs(['播放数组']);
        var blocks = pa ? this._cutAll(html, pa) : [this._preCut(html, this._rs(['播放二次截取']))];
        var lines = this._cutAll(html, this._rs(['线路数组', '多线数组']));
        var epList = this._rs(['播放列表']), epTitle = this._rs(['播放标题']), epLink = this._rs(['播放链接']);
        var flags = [], urls = [];
        var self = this;
        blocks.forEach(function (blk, i) {
            var parts = [];
            self._cutAll(blk, epList).forEach(function (e) {
                var t = self._cut1(e, epTitle).trim();
                var u = self._cut1(e, epLink).trim();
                if (!u) return;
                parts.push((t || '播放') + '$' + self._abs(url, u));
            });
            if (!parts.length) return;
            var flag = '默认线路';
            if (lines[i] !== undefined) {
                var lt = self._cut1(lines[i], self._rs(['线路标题'])).trim();
                flag = lt || lines[i].substring(0, 12);
            }
            flags.push(flag);
            urls.push(parts.join('#'));
        });
        // 嗅探兜底：规则未配播放块时，从详情页取首个媒体直链（TVBox play_parse 惯例）
        if (!flags.length) {
            var mm = html.match(/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4|flv)[^"'\s<>]*/);
            if (mm) { flags.push('嗅探'); urls.push('正片$' + mm[0]); }
        }
        return {
            vod_id: url, vod_name: name, vod_pic: pic, vod_content: intro,
            vod_play_from: flags.join('$$$'), vod_play_url: urls.join('$$$'),
        };
    },

    lazy: function () {
        var u = this.input;
        var jump = this._rs(['跳转播放链接']);
        if (jump && u.indexOf('http') === 0) {
            var hdr = this._headers(this._rs(['请求头']));
            var html = request(u, { headers: hdr }).content;
            var t = this._cut1(html, jump);
            if (t) {
                // 「跳转前缀」:截取值为参数(如 vid 值)时拼回直链前缀
                var prefix = this._rs(['跳转前缀']);
                u = (prefix || '') + t.replace(/\\\//g, '/').replace(/\\"/g, '"');
                // 跳转截取命中=已解析直链(含 content.php?vid= 等无后缀动态流,响应即
                // MP4 分段流)——parse:0 交宿主流式播放并透传站点头(QY影视 wdbay 形态)
                return JSON.stringify({ parse: 0, url: u, header: { 'Referer': hdr['Referer'] || u, 'User-Agent': hdr['User-Agent'] || '' } });
            }
        }
        var direct = /\.(m3u8|mp4|flv|mkv|ts)(\?|$)/i.test(u);
        return JSON.stringify({ parse: direct ? 0 : 1, url: u, header: {} });
    },
}
