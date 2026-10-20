// qm.js — 七猫短剧（JS 源形态）
// 协议：qm-params = base64(设备JSON) 经 char_map 混淆；sign = md5(头排序串+qm-params+reg+密钥)
//   分类 /api/v1/playlet/index?tag_id=&playlet_privacy=1&operation=1&sign=
//   详情 api-read.qmplaylet.com/player/api/v1/playlet/info?playlet_id=&sign=
var QM_KEYS = 'd3dGiJc651gSQ8w1';
var QM_STORE = 'https://api-store.qmplaylet.com';
var QM_READ = 'https://api-read.qmplaylet.com';
var QM_MAP = { '+': 'P', '/': 'X', '0': 'M', '1': 'U', '2': 'l', '3': 'E', '4': 'r', '5': 'Y', '6': 'W', '7': 'b', '8': 'd', '9': 'J', 'A': '9', 'B': 's', 'C': 'a', 'D': 'I', 'E': '0', 'F': 'o', 'G': 'y', 'H': '_', 'I': 'H', 'J': 'G', 'K': 'i', 'L': 't', 'M': 'g', 'N': 'N', 'O': 'A', 'P': '8', 'Q': 'F', 'R': 'k', 'S': '3', 'T': 'h', 'U': 'f', 'V': 'R', 'W': 'q', 'X': 'C', 'Y': '4', 'Z': 'p', 'a': 'm', 'b': 'B', 'c': 'O', 'd': 'u', 'e': 'c', 'f': '6', 'g': 'K', 'h': 'x', 'i': '5', 'j': 'T', 'k': '-', 'l': '2', 'm': 'z', 'n': 'S', 'o': 'Z', 'p': '1', 'q': 'V', 'r': 'v', 's': 'j', 't': 'Q', 'u': '7', 'v': 'D', 'w': 'w', 'x': 'n', 'y': 'L', 'z': 'e' };
var QM_TAGS = [
    ['0', '全部'], ['1', '男频'], ['3', '新剧'], ['21', '现代言情'], ['37', '神豪'],
    ['356', '萌宝'], ['373', '穿越'], ['527', '战神'], ['1269', '神医'], ['1272', '古装'],
];
var QM_CACHE = { qp: '', sign: '', ts: 0 };

function QM_headers() {
    var now = Date.now();
    if (QM_CACHE.qp && now - QM_CACHE.ts < 240000) {
        return QM_hdrOf(QM_CACHE.qp, QM_CACHE.sign);
    }
    var dev = JSON.stringify({
        'static_score': '0.8', 'uuid': '00000000-7fc7-08dc-0000-000000000000',
        'device-id': '20250220125449b9b8cac84c2dd3d035c9052a2572f7dd0122edde3cc42a70',
        'sourceuid': 'aa7de295aad621a6', 'refresh-type': '0', 'model': '22021211RC',
        'client-id': 'aa7de295aad621a6', 'brand': 'Redmi', 'sys-ver': '12',
        'phone-level': 'H', 'wlb-uid': 'aa7de295aad621a6', 'session-id': String(now),
    });
    var b64 = __b64e(dev);
    var qp = '';
    for (var i = 0; i < b64.length; i++) {
        var ch = b64.charAt(i);
        qp += QM_MAP[ch] !== undefined ? QM_MAP[ch] : ch;
    }
    var sign = __md5('AUTHORIZATION=app-version=10001application-id=com.duoduo.readchannel=unknownis-white=net-env=5platform=androidqm-params=' + qp + 'reg=' + QM_KEYS);
    QM_CACHE = { qp: qp, sign: sign, ts: now };
    return QM_hdrOf(qp, sign);
}

function QM_hdrOf(qp, sign) {
    return {
        'net-env': '5', 'reg': '', 'channel': 'unknown', 'is-white': '',
        'platform': 'android', 'application-id': 'com.duoduo.read', 'authorization': '',
        'app-version': '10001', 'User-Agent': 'okhttp/3.12.11',
        'qm-params': qp, 'sign': sign,
        'content-type': 'application/json; charset=utf-8',
    };
}

function QM_get(url) {
    var r = JSON.parse(__reqRaw(url, JSON.stringify({ headers: QM_headers() })));
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 60));
    return JSON.parse(r.content);
}

function QM_card(i) {
    return {
        vod_id: String(i.playlet_id),
        vod_name: i.title || '',
        vod_pic: i.image_link || '',
        vod_remarks: (i.total_episode_num || '') + '集',
    };
}

var QM_API = {
    home: function () {
        var cls = [];
        for (var i = 0; i < QM_TAGS.length; i++) {
            cls.push({ type_id: QM_TAGS[i][0], type_name: QM_TAGS[i][1] });
        }
        return { class: cls };
    },
    category: function (args) {
        var tid = args[0] || '0';
        var sign = __md5('operation=1playlet_privacy=1tag_id=' + tid + QM_KEYS);
        var v = QM_get(QM_STORE + '/api/v1/playlet/index?tag_id=' + tid + '&playlet_privacy=1&operation=1&sign=' + sign);
        var arr = ((v.data || {}).list) || [];
        var list = [];
        for (var i = 0; i < arr.length; i++) list.push(QM_card(arr[i]));
        return { list: list, more: false };
    },
    search: function (args) {
        // /search 端点已废弃：遍历全部分类客户端过滤
        var kw = args[0] || '';
        var list = [];
        var seen = {};
        for (var t = 0; t < QM_TAGS.length; t++) {
            var sign = __md5('operation=1playlet_privacy=1tag_id=' + QM_TAGS[t][0] + QM_KEYS);
            var v;
            try {
                v = QM_get(QM_STORE + '/api/v1/playlet/index?tag_id=' + QM_TAGS[t][0] + '&playlet_privacy=1&operation=1&sign=' + sign);
            } catch (e) { continue; }
            var arr = ((v.data || {}).list) || [];
            for (var i = 0; i < arr.length; i++) {
                var id = String(arr[i].playlet_id);
                if (!seen[id]) {
                    seen[id] = 1;
                    if ((arr[i].title || '').indexOf(kw) >= 0) list.push(QM_card(arr[i]));
                }
            }
        }
        return { list: list, more: false };
    },
    detail: function (args) {
        var pid = args[0] || '';
        var sign = __md5('playlet_id=' + pid + QM_KEYS);
        var v = QM_get(QM_READ + '/player/api/v1/playlet/info?playlet_id=' + pid + '&sign=' + sign);
        var d = v.data || {};
        var pl = d.play_list || [];
        var pu = [];
        for (var i = 0; i < pl.length; i++) {
            pu.push((pl[i].sort || (i + 1)) + '$' + (pl[i].video_url || ''));
        }
        return { list: [{
            vod_id: pid,
            vod_name: d.title || '',
            vod_pic: d.image_link || '',
            vod_remarks: (d.total_episode_num || '') + '集',
            vod_content: d.intro || '',
            vod_play_from: '七猫短剧',
            vod_play_url: pu.join('#'),
        }] };
    },
    play: function (args) {
        var url = args[1] || args[0] || '';
        if (url.indexOf('http') !== 0) throw new Error('七猫 无效地址');
        return { parse: 0, url: url };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = QM_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
