// xmvideo.js — 熊猫视频源(批次A jar 退役等价物,rule 函数形态,零壳依赖纯公共面)
// 协议:csp_XMVideo 反编译(182.jar)+ 裸 HTTP 实测(2026-10-21,探针 test/probe_xmvideo.py)
//   分类:POST /getDataInit(硬编码占位 body)→ data.menu0ListMap[].menu2List[](取前 3 组)
//   列表/搜索:POST /forward {command:WEB_GET_INFO,...} → data.resultList[]
//   播放:vod_pic 的 `1.jpg` → `playlist.m3u8`(图片路径即播放线索;直链 m3u8 裸可达)
// 站点为成人内容站,上游分类/内容随其运营变化,壳侧不做内容过滤

var XM_API = 'https://spiderscloudcn2.51111666.com';
var XM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function xm_post(path, body) {
    var r = req(XM_API + path, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'User-Agent': XM_UA, 'Content-Type': 'application/json' },
        timeout: 15000,
    });
    return JSON.parse(r.content || '{}');
}

// 列表项 → drpy 卡片;id 携带播放线索 `名称#图片URL`(原 jar 同款约定,二级/play 复原)
function xm_card(it) {
    var name = String(it.vod_name || '').replace(/yy8ycom/g, '');
    var pic = String(it.vod_pic || '');
    return { title: name, img: pic, url: name + '#' + pic, desc: '' };
}

// 熊猫站点分类不稳定时 getDataInit 可能为空,兜底给一个「全部」分类(typeId=0 走搜索通道)
var XM_FALLBACK = [{ type_id: '0', type_name: '全部' }];

var rule = {
    title: '熊猫视频',
    host: XM_API,
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    play_parse: true,
    headers: { 'User-Agent': XM_UA },

    class_parse: function () {
        try {
            var d = xm_post('/getDataInit', { name: 'John', age: 31, city: 'New York' });
            var groups = (d.data || {}).menu0ListMap || [];
            var cls = [];
            for (var i = 0; i < groups.length && i < 3; i++) {
                var subs = groups[i].menu2List || [];
                for (var j = 0; j < subs.length; j++) {
                    cls.push({
                        type_id: String(subs[j].typeId2 || '').replace(/\.0$/, ''),
                        type_name: subs[j].typeName2 || '',
                    });
                }
            }
            return { class: cls.length ? cls : XM_FALLBACK, filters: {} };
        } catch (e) {
            return { class: XM_FALLBACK, filters: {} };
        }
    },

    一级: function () {
        var tid = String(this.MY_CATE || '0');
        var pg = parseInt(this.MY_PAGE || '1', 10) || 1;
        var d = xm_post('/forward', {
            command: 'WEB_GET_INFO', pageNumber: pg, RecordsPage: 20,
            typeId: tid, typeMid: '1', languageType: 'CN', content: '',
        });
        return ((d.data || {}).resultList || []).map(xm_card);
    },

    二级: function () {
        // id = `名称#图片URL`;播放地址 = 图片路径 1.jpg → playlist.m3u8
        var parts = String(this.input || '').split('#');
        var name = parts[0] || '';
        var pic = parts[1] || '';
        var play = pic.replace('1.jpg', 'playlist.m3u8');
        return {
            vod_id: this.input,
            vod_name: name,
            vod_pic: pic,
            vod_play_from: '熊猫视频',
            vod_play_url: '播放$' + play,
            vod_content: '',
        };
    },

    搜索: function () {
        var d = xm_post('/forward', {
            command: 'WEB_GET_INFO', pageNumber: 1, RecordsPage: 20,
            typeId: '0', typeMid: '1', languageType: 'CN', content: this.wd, type: '1',
        });
        return ((d.data || {}).resultList || []).map(xm_card);
    },

    lazy: function () {
        return JSON.stringify({ parse: 0, url: this.input, header: { 'User-Agent': XM_UA } });
    },
};
