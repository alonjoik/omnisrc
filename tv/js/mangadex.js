// MangaDex public API reader. Complies with MangaDex's public API policy:
// credit MangaDex and show the scanlation group on each chapter/reader.
// Source ext: {"lang":"zh" | "zh-hk" | "en"}
var MD_API = 'https://api.mangadex.org';
var MD_UA = 'iBox Reader/1.0 (desktop comic reader)';
var MD_LIMIT = 24;

function MD_lang() {
    try {
        var ext = JSON.parse(__extJson || '{}');
        var lang = String(ext.lang || 'en');
        return ['zh', 'zh-hk', 'en'].indexOf(lang) >= 0 ? lang : 'en';
    } catch (e) { return 'en'; }
}

function MD_get(path) {
    var raw = JSON.parse(__reqRaw(MD_API + path, JSON.stringify({
        headers: { 'User-Agent': MD_UA, 'Accept': 'application/json' }
    })));
    if (!raw.ok || raw.status < 200 || raw.status >= 300) {
        throw new Error('MangaDex HTTP ' + raw.status + (raw.error ? ': ' + raw.error : ''));
    }
    var value = JSON.parse(raw.content || '{}');
    if (value.result === 'error') {
        var first = (value.errors || [])[0] || {};
        throw new Error('MangaDex ' + (first.status || '') + ' ' + (first.title || first.detail || '请求失败'));
    }
    return value;
}

function MD_enc(value) { return encodeURIComponent(String(value || '')); }

function MD_title(names) {
    if (!names) return '';
    if (typeof names === 'string') return names;
    var lang = MD_lang();
    return names[lang] || names.en || names['ja-ro'] || names.ja || names.zh || Object.keys(names).map(function (k) { return names[k]; })[0] || '';
}

var MD_TAG_TRANSLATIONS = {
    'thriller': ['惊悚', '驚悚'], 'sci-fi': ['科幻', '科幻'], 'historical': ['历史', '歷史'],
    'action': ['动作', '動作'], 'psychological': ['心理', '心理'], 'romance': ['恋爱', '戀愛'],
    'comedy': ['喜剧', '喜劇'], 'mecha': ['机甲', '機甲'], "boys' love": ['耽美', '耽美'],
    'crime': ['犯罪', '犯罪'], 'sports': ['运动', '運動'], 'superhero': ['超级英雄', '超級英雄'],
    'magical girls': ['魔法少女', '魔法少女'], 'adventure': ['冒险', '冒險'],
    "girls' love": ['百合', '百合'], 'wuxia': ['武侠', '武俠'], 'isekai': ['异世界', '異世界'],
    'philosophical': ['哲学', '哲學'], 'drama': ['剧情', '劇情'], 'medical': ['医疗', '醫療'],
    'horror': ['恐怖', '恐怖'], 'fantasy': ['奇幻', '奇幻'], 'slice of life': ['日常', '日常'],
    'mystery': ['悬疑', '懸疑'], 'tragedy': ['悲剧', '悲劇']
};

function MD_tagTitle(names) {
    var title = MD_title(names);
    var lang = MD_lang();
    if (lang === 'en' || !title) return title;
    var translated = MD_TAG_TRANSLATIONS[title.toLowerCase()];
    return translated ? translated[lang === 'zh-hk' ? 1 : 0] : title;
}

function MD_cover(manga) {
    var rels = manga.relationships || [];
    for (var i = 0; i < rels.length; i++) {
        if (rels[i].type === 'cover_art' && rels[i].attributes && rels[i].attributes.fileName) {
            return 'https://uploads.mangadex.org/covers/' + manga.id + '/' + rels[i].attributes.fileName + '.256.jpg';
        }
    }
    return '';
}

function MD_card(manga) {
    var a = manga.attributes || {};
    return {
        vod_id: manga.id || '',
        vod_name: MD_title(a.title) || '未命名作品',
        vod_pic: MD_cover(manga),
        vod_remarks: a.status || '',
        vod_actor: '',
    };
}

function MD_mangaPath(query) {
    return '/manga?' + query + '&availableTranslatedLanguage%5B%5D=' + MD_enc(MD_lang()) +
        '&contentRating%5B%5D=safe&includes%5B%5D=cover_art&includes%5B%5D=author';
}

var MD = {
    cats: function () {
        var data = MD_get('/manga/tag');
        var themes = [];
        var tags = data.data || [];
        for (var i = 0; i < tags.length; i++) {
            var tag = tags[i];
            var a = tag.attributes || {};
            if (a.group !== 'genre') continue;
        themes.push({ name: MD_tagTitle(a.name), path_word: tag.id, count: '' });
        }
        return { themes: themes };
    },
    list: function (args) {
        var page = Math.max(1, parseInt(args[2] || '1', 10) || 1);
        var sort = args[1] === 'addtime' ? 'latestUploadedChapter' : 'followedCount';
        var query = 'limit=' + MD_LIMIT + '&offset=' + ((page - 1) * MD_LIMIT) +
            '&order%5B' + sort + '%5D=desc';
        if (args[0]) query += '&includedTags%5B%5D=' + MD_enc(args[0]);
        var result = MD_get(MD_mangaPath(query));
        return { list: (result.data || []).map(MD_card), total: result.total || 0 };
    },
    search: function (args) {
        var keyword = String(args[0] || '').trim();
        if (!keyword) return { list: [], total: 0 };
        var offset = Math.max(0, parseInt(args[1] || '0', 10) || 0);
        var result = MD_get(MD_mangaPath('title=' + MD_enc(keyword) + '&limit=' + MD_LIMIT + '&offset=' + offset + '&order%5Brelevance%5D=desc'));
        return { list: (result.data || []).map(MD_card), total: result.total || 0 };
    },
    detail: function (args) {
        var id = String(args[0] || '');
        if (!id) throw new Error('MangaDex 作品编号为空');
        var response = MD_get('/manga/' + MD_enc(id) + '?includes%5B%5D=cover_art&includes%5B%5D=author&includes%5B%5D=artist');
        var manga = response.data || {};
        var a = manga.attributes || {};
        var feed = MD_get('/manga/' + MD_enc(id) + '/feed?limit=500&translatedLanguage%5B%5D=' + MD_enc(MD_lang()) +
            '&order%5Bvolume%5D=asc&order%5Bchapter%5D=asc&includes%5B%5D=scanlation_group');
        var chapters = [];
        var rows = feed.data || [];
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var ca = row.attributes || {};
            var groups = [];
            var relationships = row.relationships || [];
            for (var j = 0; j < relationships.length; j++) {
                var relation = relationships[j];
                if (relation.type === 'scanlation_group' && relation.attributes && relation.attributes.name && groups.indexOf(relation.attributes.name) < 0) {
                    groups.push(relation.attributes.name);
                }
            }
            var chapterNo = ca.chapter ? String(ca.chapter) : '';
            var title = String(ca.title || '').trim();
            var label = chapterNo ? (MD_lang() === 'en' ? 'Chapter ' + chapterNo : '第' + chapterNo + '话') : (title || '短篇');
            var titleNo = title.match(/^第\s*(\d+(?:\.\d+)?)\s*[话話章回]?/);
            if (title && title !== chapterNo && title !== label && (!titleNo || titleNo[1] !== chapterNo)) label += ' · ' + title;
            var credit = groups.join(' / ');
            label += ' · ' + (credit || '翻译组未标注');
            chapters.push({ id: row.id, name: label, credit: credit });
        }
        var authors = [];
        var rels = manga.relationships || [];
        for (var k = 0; k < rels.length; k++) {
            if ((rels[k].type === 'author' || rels[k].type === 'artist') && rels[k].attributes && rels[k].attributes.name && authors.indexOf(rels[k].attributes.name) < 0) {
                authors.push(rels[k].attributes.name);
            }
        }
        var descriptions = a.description || {};
        var intro = MD_title(descriptions);
        return {
            vod_id: manga.id || id,
            vod_name: MD_title(a.title) || '未命名作品',
            vod_pic: MD_cover(manga),
            vod_actor: authors.join(' / '),
            type_name: MD_lang(),
            vod_remarks: a.status || '',
            vod_content: intro,
            chapters: chapters,
        };
    },
    images: function (args) {
        var chapterId = String(args[0] || '');
        if (!chapterId) throw new Error('MangaDex 章节编号为空');
        var home = MD_get('/at-home/server/' + MD_enc(chapterId));
        var chapter = home.chapter || {};
        var quality = (chapter.dataSaver && chapter.dataSaver.length) ? 'data-saver' : 'data';
        var files = quality === 'data-saver' ? chapter.dataSaver : chapter.data;
        var images = [];
        for (var i = 0; i < (files || []).length; i++) {
            images.push({ url: home.baseUrl + '/' + quality + '/' + chapter.hash + '/' + files[i] });
        }
        if (!images.length) throw new Error('MangaDex 章节没有可用图片');
        return { images: images };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = MD[req.entry];
    if (!fn) return JSON.stringify({ error: '未知 MangaDex 入口：' + req.entry });
    try { return JSON.stringify(fn(req.args || [])); }
    catch (e) { return JSON.stringify({ error: String((e && e.message) || e) }); }
}
