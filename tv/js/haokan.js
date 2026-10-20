// haokan.js — 好看短剧（sv.baidu.com，DuanJuAiHaoKan 对拍）
// 协议：全部 POST 表单；home=playletShelfFeed{from:feed}→playlet_shelf_filter_panel[].tag_list[]；
//       cate=playletTagsFeed{tag_id,rn:9,pn}→data.list[]；search=sugs{search_word}；
//       detail=appui/api{"video/commonlist":"...id=..&rn=10&pn=1&direction=3"}取vid→rec/detail{vid,playlet_id}→vid_list；
//       play=appui/api{"video/relate":"method=post&vid=..&video_set_id=..&..."}→clarityUrl[]取1080p→sc→[0]
var HK_UA = 'Mozilla/5.0 (Linux; Android 11; M2012K10C Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/87.0.4280.141 Mobile Safari/537.36 haokan/7.80.0.18 (Baidu; P1 11)/imoaiX_03_11_C01K2102M/1043677m/5ACDB023CFB9D64743B08E51953F7C76%7CVSAJ32AVA/1/7.80.0.18/780001/1/immersiveMode/modeV4PlusWhite/isFirstInstall/bbqMode/bbqModeV2/blackStyle/isPlaylet Talos/1.8.7';

function hk_headers() {
    return {
        'User-Agent': HK_UA,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Cookie': 'BAIDUCUID=giHCu0azv80G8SfQ0avU8gaaH8jfiv86ju2MugiR2i8-k3a35avAa1_mA',
        'Talos-Module-Version': '1.0.71.1',
        'Talos-Module-Name': 'shortDrama',
        'Referer': 'https://sv.baidu.com/',
    };
}

function hk_post(url, form) {
    var body = [];
    for (var k in form) body.push(encodeURIComponent(k) + '=' + encodeURIComponent(form[k]));
    var r = JSON.parse(__reqRaw(url, JSON.stringify({ method: 'POST', body: body.join('&'), headers: hk_headers() })));
    return JSON.parse(String(r.content || '{}'));
}

var HK_API = {
    home: function () {
        var d = hk_post('https://sv.baidu.com/haokan/ui-feed/playletShelfFeed?osbranch=a0', { from: 'feed' });
        var panels = (d.data && d.data.playlet_shelf_filter_panel) || [];
        var out = [];
        for (var i = 0; i < panels.length; i++) {
            var tags = panels[i].tag_list || [];
            for (var k = 0; k < tags.length; k++) {
                if (tags[k].tag_id) out.push({ type_id: String(tags[k].tag_id), type_name: tags[k].name || '' });
            }
        }
        return { class: out };
    },
    category: function (args) {
        var tid = args[0] || '1';
        var pg = parseInt(args[1], 10) || 1;
        var d = hk_post('https://sv.baidu.com/haokan/ui-feed/playletTagsFeed?osbranch=a0',
            { tag_id: tid, rn: '9', pn: String(pg) });
        var list = (d.data && d.data.list) || [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var o = list[i];
            if (!o.playlet_title) continue;
            var id = o.playlet_id;
            if (o.progress_vid) id = id + '|||' + o.progress_vid;
            out.push({
                vod_id: id, vod_name: o.playlet_title,
                vod_pic: o.playlet_poster || '', vod_remarks: o.episodes_num_text || '',
            });
        }
        return { list: out, page: pg, pagecount: out.length >= 9 ? pg + 1 : pg };
    },
    search: function (args) {
        var d = hk_post('https://sv.baidu.com/haokan/ui-interact/playlet/search/sugs?osbranch=a0',
            { search_word: args[0] || '' });
        var arr = d.data || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            if (!arr[i].title) continue;
            out.push({
                vod_id: String(arr[i].id || ''), vod_name: arr[i].title,
                vod_pic: arr[i].cover_url || '', vod_remarks: arr[i].tag || '',
            });
        }
        return { list: out };
    },
    detail: function (args) {
        var parts = String(args[0] || '').split('|||');
        var pid = parts[0] || '';
        var vid = parts[1] || '';
        if (!vid) {
            var cl = 'enable_enter_playlet=0&seek_time=0&hotspot=0&auto_show_hot_point_panel=0&type=playlet' +
                '&commonlist_id=' + Date.now() + '&scene=&vid=&enable_atlas=0&mark_pn=&uk=&ctime=0&from=playlet_new' +
                '&id=' + pid + '&rn=10&pn=1&direction=3';
            var d0 = hk_post('https://sv.baidu.com/appui/api?osbranch=a0', { 'video/commonlist': cl });
            var res = ((d0['video/commonlist'] || {}).data || {}).results || [];
            vid = res.length ? (res[0].content || {}).vid || '' : '';
        }
        if (!vid) throw new Error('好看短剧详情缺少视频参数');
        var d = hk_post('https://sv.baidu.com/haokan/ui-video/playlet/rec/detail?osbranch=a0',
            { vid: vid, playlet_id: pid });
        var info = d.data || {};
        var eps = [];
        var vl = info.vid_list || [];
        for (var i = 0; i < vl.length; i++) {
            eps.push('第' + (i + 1) + '集$' + vl[i] + '|||' + pid);
        }
        return { list: [{
            vod_id: String(pid), vod_name: info.playlet_title || '',
            vod_pic: info.playlet_poster || '', vod_content: info.description || '',
            vod_play_from: '好看短剧',
            vod_play_url: eps.join('#'),
        }] };
    },
    play: function (args) {
        var flag = args[1] || args[0] || '';
        var parts = flag.split('|||');
        if (parts.length < 2) throw new Error('好看短剧播放参数错误');
        var q = 'method=post&vid=' + parts[0] + '&immersive_mode=v4_5&tplname=feed_small_video&tag=playlet_talos' +
            '&tab=detail&external_from=&is_dp_video=0&immersive_square_type=3&video_set_id=' + parts[1] +
            '&play_screen_type=1&play_volume_type=2&play_external_device_type=1';
        var d = hk_post('https://sv.baidu.com/appui/api?osbranch=a0', { 'video/relate': q });
        var cl = ((((d['video/relate'] || {}).data || {}).cur_video) || {}).clarityUrl || [];
        if (!cl.length) throw new Error('好看短剧播放地址为空');
        var url = '';
        for (var i = 0; i < cl.length; i++) {
            if (cl[i].key === '1080p') { url = cl[i].url; break; }
        }
        if (!url) {
            for (var j = 0; j < cl.length; j++) {
                if (cl[j].key === 'sc') { url = cl[j].url; break; }
            }
        }
        if (!url) url = cl[0].url || '';
        if (!url) throw new Error('好看短剧播放地址为空');
        return { parse: 0, url: url, headers: { 'User-Agent': HK_UA } };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = HK_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
