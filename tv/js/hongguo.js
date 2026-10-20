// 红果短剧 — drpy 薄壳源（rule 模板形态，双形态自适配）
// PanBox 壳内（typeof __hongguoApi === 'function'，见 SPEC.md 壳增强面）：
//   六入口转发壳内红果全能力——home/category 免签通道、detail App 全量分集、
//   search 官网+App 双线路、play CENC 高清多档（本地解密流 /hgstream/<id>/video.mp4，
//   桌面/Android/iOS 全端一致）。
// 其他 drpy 宿主（TVBox/影视仓 qjs）：自动降级红果官网（hongguoduanju.com）SSR 公开数据
//   ——分类/搜索/详情/集数 + 官网明文 360p 播放（>360p 为上游 CENC 加密流，普通播放器不可解）。
// 契约：drpy qjs 兼容子集（见 SPEC.md），同步方法，无 async。

var rule = {
    title: '红果短剧',
    host: 'https://hongguoduanju.com',
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    play_parse: true,

    class_parse: function () {
        if (typeof __hongguoApi === 'function') {
            var h = hgCall('home', []);
            return { class: (h && h.class) || [] };
        }
        return {
            class: [
                ['real-drama', '真人短剧'],
                ['comic-drama', '漫剧'],
                ['ai-drama', 'AI短剧'],
                ['hot-drama', '热播榜'],
                ['hot-real-drama', '真人·热播'],
                ['hot-comic-drama', '漫剧·热播'],
                ['hot-ai-drama', 'AI·热播'],
            ].map(function (c) { return { type_id: c[0], type_name: c[1] }; }),
        };
    },

    // 壳内：免签 landpage/bookmall 通道（type_id 如 short_play:hot_score / rank:xxx）
    // 降级：官网 category/rank 页 SSR（recommendList / rankList）
    一级: function () {
        var tid = String(this.MY_CATE || '');
        var pg = String(this.MY_PAGE || 1);
        if (typeof __hongguoApi === 'function') {
            var r = hgCall('category', [tid, pg]);
            return (r && r.list) || [];
        }
        var page = Math.max(1, parseInt(pg, 10) || 1);
        var path = tid.indexOf('hot-') === 0 ? 'rank' : 'category';
        // host 预置的 MY_URL 来自 rule.url 模板（本源未用），官网地址自行构造；
        // page=1 官网 301 规范化去 query（避免依赖宿主 req 的重定向行为），page>=2 才带参数
        var url = rule.host + '/' + path + '/' + tid + (page > 1 ? '?page=' + page : '');
        var data = hgRouterData(hgReq(url)).loaderData || {};
        for (var k in data) {
            var v = data[k];
            if (!v || typeof v !== 'object') continue;
            if (v.recommendList) {
                return { list: hgCards(v.recommendList), pagecount: Math.max(1, Number(v.pagination && v.pagination.totalPages) || 1) };
            }
            if (v.rankList) {
                return { list: hgCards(v.rankList), pagecount: Math.max(1, Number(v.pagination && v.pagination.totalPages) || page) };
            }
        }
        throw new Error('红果官网该分类暂无数据');
    },

    // 壳内：App 全量分集（卡片先经官网 SSR 补剧名/封面）；降级：官网 player 页
    二级: function () {
        var sid = String(this.input || '').split(',')[0];
        if (!/^[0-9]{1,30}$/.test(sid)) throw new Error('红果详情参数无效');
        if (typeof __hongguoApi === 'function') {
            // 壳内分集走 App；SSR 仅补卡片（失败不阻塞，壳内用占位）
            var card = {};
            try {
                var d0 = hgDetailPage(sid);
                card = {
                    vod_name: d0.card.vod_name,
                    vod_pic: d0.card.vod_pic,
                    vod_content: d0.card.vod_content,
                    type_name: '短剧',
                };
            } catch (e) { /* ignore */ }
            var r = hgCall('detail', [sid, JSON.stringify(card)]);
            var vod = (r && r.list && r.list[0]) || null;
            if (!vod) throw new Error('红果壳内未返回该剧分集');
            return vod;
        }
        var d = hgDetailPage(sid);
        var eps = d.vids.map(function (vid, i) {
            return '第' + (i + 1) + '集$' + sid + '/' + vid;
        }).join('#');
        return {
            vod_id: sid,
            vod_name: d.card.vod_name,
            vod_pic: d.card.vod_pic,
            vod_content: d.card.vod_content,
            vod_play_from: '红果官网',
            vod_play_url: eps,
        };
    },

    // 壳内：官网 SSR + App 双线路；降级：官网搜索页 + suggestion 联想兜底
    搜索: function () {
        var wd = String(this.wd || '').trim();
        if (!wd) return [];
        if (typeof __hongguoApi === 'function') {
            return (hgCall('search', [wd]) || {}).list || [];
        }
        try {
            var data = hgRouterData(hgReq(rule.host + '/search/' + encodeURIComponent(wd))).loaderData || {};
            for (var k in data) {
                var v = data[k];
                if (v && typeof v === 'object' && v.searchList) return hgCards(v.searchList || []);
            }
        } catch (e) {
            if (typeof log === 'function') log('[src 搜索 SSR 异常] ' + e);
        }
        // suggestion 联想兜底：仅 video_data 项是剧；sid 用 keyword 字符串（JSON.parse 大数丢精度）
        var out = [];
        try {
            var sug = JSON.parse(hgReq(rule.host + '/incent_resource/suggestion?app_id=8662&query=' + encodeURIComponent(wd) + '&count=20'));
            var arr = sug.suggest_list || [];
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i];
                if (it && it.video_data) {
                    var c = hgCard(it.video_data, typeof it.keyword === 'string' ? it.keyword : '');
                    if (c) out.push(c);
                }
            }
        } catch (e2) {
            if (typeof log === 'function') log('[src 搜索联想异常] ' + e2);
        }
        return out;
    },

    // 壳内：本地 CENC 解密流（play 返回 qualities 多档，host 透传给 PanBox 清晰度面板）
    // 降级：官网明文 360p（player 页 ld+json contentUrl，带本集归属校验）
    lazy: function () {
        var id = String(this.input || '');
        var parts = id.split('/');
        if (parts.length !== 2 || !/^[0-9]+$/.test(parts[0]) || !/^[0-9]+$/.test(parts[1])) {
            throw new Error('红果播放参数无效');
        }
        if (typeof __hongguoApi === 'function') {
            return hgCall('play', ['', id]);
        }
        var url = hgWebPlayUrl(parts[0], parts[1]);
        if (!url) throw new Error('红果官网未返回本集明文视频（>360p 为上游加密流）');
        return { parse: 0, url: url, header: { 'User-Agent': HG_UA(), Referer: rule.host + '/' } };
    },
};

// ── 壳原语调用（错误 JSON 化返回，取 __err 抛出）──
function hgCall(entry, args) {
    var r = JSON.parse(__hongguoApi(entry, JSON.stringify(args)));
    if (r && r.__err) throw new Error(r.__err);
    return r;
}

// ── 官网 SSR 工具（公开网页数据；不 eval 远程脚本）──
function HG_UA() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function hgReq(url) {
    var r = req(url, {
        headers: { 'User-Agent': HG_UA(), Referer: rule.host + '/' },
        timeout: 15000,
    });
    if (r.status !== 200 || !r.content || r.content.length > 8 * 1024 * 1024) {
        throw new Error('红果官网暂不可达(' + r.status + ')');
    }
    return r.content;
}

// 配对扫描提取 _ROUTER_DATA JSON（转义字符串感知）。
// 页面里 _ROUTER_DATA 出现多次（引用处无 =），必须锚定「后跟 =」的赋值处。
function hgRouterData(text) {
    var at = 0;
    while (true) {
        var mark = text.indexOf('_ROUTER_DATA', at);
        if (mark < 0) throw new Error('红果官网路由数据缺失');
        var i = mark + 12;
        while (i < text.length && ' \t\r\n'.indexOf(text.charAt(i)) >= 0) i++;
        if (text.charAt(i) !== '=') {
            at = mark + 12;
            continue;
        }
        var brace = text.indexOf('{', i);
        if (brace < 0) throw new Error('红果官网路由数据缺失');
        var depth = 0, quoted = false, esc = false;
        for (var j = brace; j < text.length; j++) {
            var c = text.charAt(j);
            if (quoted) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') quoted = false;
            } else if (c === '"') quoted = true;
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return JSON.parse(text.slice(brace, j + 1));
            }
        }
        throw new Error('红果官网路由数据不完整');
    }
}

// 条目归一：兼容 video_data 包装；sid 仅收数字串（sidHint 优先——suggestion 的
// series_id 为 JSON number，JSON.parse 超 2^53 丢精度，必须用 keyword 字符串）
function hgCard(row0, sidHint) {
    var row = row0 && row0.video_data ? row0.video_data : (row0 || {});
    var sid = sidHint || (row.series_id == null ? '' : String(row.series_id));
    var title = row.series_title || row.series_name || row.title;
    if (!/^[0-9]{1,30}$/.test(sid) || typeof title !== 'string' || !title.trim()) return null;
    var remark = row.episode_right_text || (row.episode_cnt > 0 ? '全' + row.episode_cnt + '集' : '');
    var heat = row.hot_score_data && row.hot_score_data.text ? row.hot_score_data.text : '';
    return {
        vod_id: sid,
        vod_name: title.trim(),
        vod_pic: row.series_cover || row.cover || '',
        vod_remarks: String(remark || heat || ''),
        vod_content: row.series_intro || row.description || '',
    };
}

function hgCards(items) {
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) {
        var c = hgCard(items[i]);
        if (c && !seen[c.vod_id]) { seen[c.vod_id] = 1; out.push(c); }
    }
    return out;
}

// 官网 player 页：seriesDetail（vid_list 全量）+ 卡片
function hgDetailPage(sid) {
    var ld = hgRouterData(hgReq(rule.host + '/player/' + sid)).loaderData || {};
    for (var k in ld) {
        var v = ld[k];
        if (v && typeof v === 'object' && v.seriesDetail && String(v.seriesDetail.series_id) === sid) {
            if (v.isSuccess === false) break;
            var s = v.seriesDetail;
            var card = hgCards([s])[0];
            if (!card || !s.vid_list || !s.vid_list.length) break;
            return { card: card, vids: s.vid_list };
        }
    }
    throw new Error('红果官网未返回该剧分集');
}

// 官网明文直链：player 页 ld+json 的 VideoObject.contentUrl（校验本集归属，防串集）
function hgWebPlayUrl(sid, vid) {
    var page = hgReq(rule.host + '/player/' + sid + '/' + vid);
    var re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(page)) !== null) {
        var obj;
        try { obj = JSON.parse(m[1]); } catch (e) { continue; }
        var stack = [obj];
        while (stack.length) {
            var cur = stack.pop();
            if (!cur || typeof cur !== 'object') continue;
            if (cur['@type'] === 'VideoObject' && typeof cur.contentUrl === 'string'
                && cur.contentUrl.indexOf('https://hongguoduanju.com/video/public/') === 0
                && cur.contentUrl.indexOf('/' + vid + '/') > 0) {
                return cur.contentUrl;
            }
            for (var k in cur) {
                if (cur[k] && typeof cur[k] === 'object') stack.push(cur[k]);
            }
        }
    }
    return '';
}
