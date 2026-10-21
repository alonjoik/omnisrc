// guazi.js — 瓜子（WexAiGuaZi 对拍，5 域名池 API）
// 协议：form 提交 request_key=HEX(AES-CBC-PKCS5(params, k16, iv16)).upper、
//   keys=base64(RSA-PKCS1v15(pubX509, {"iv":iv,"key":k}))、signature=MD5(拼接串+盐).upper；
// 响应 data.keys=base64(RSA(privPkcs8)) → {key,iv}，data.response_key=HEX(AES 密文) → AES 解 → JSON
// token：随机 new_key(40HEX) signUp 注册（可重 signIn/refresh 续期），__store 持久化
var GZ_HOSTS = ["https://sdapi.e2wu4ht.com", "https://api.w32z7vtd.com", "https://api.6a7nnf7.com", "https://api.umygrx3.com", "https://api.rmedphk.com"];
var GZ_UA = "okhttp/3.12.0";
var GZ_PUB = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDUM5+/y8sPsWkd1/RQS64X259EUwxFXFE5HlA65MqrxnPs0JqoSRojSDy5QhwvROlaD6TwRQHKMY2OAZ6SnQeUJsChTEFIR9qUkwrs3/MVUMxjsv6JS6Oe/juclyJGTgVmDhB55EafXsD0SQYVj/QXXsxR6ewR5E2kL52yAAD4yQIDAQAB";
var GZ_PRIV = "MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGAe6hKrWLi1zQmjTT1ozbE4QdFeJGNxubxld6GrFGximxfMsMB6BpJhpcTouAqywAFppiKetUBBbXwYsYU1wNr648XVmPmCMCy4rY8vdliFnbMUj086DU6Z+/oXBdWU3/b1G0DN3E9wULRSwcKZT3wj/cCI1vsCm3gj2R5SqkA9Y0CAwEAAQKBgAJH+4CxV0/zBVcLiBCHvSANm0l7HetybTh/j2p0Y1sTXro4ALwAaCTUeqdBjWiLSo9lNwDHFyq8zX90+gNxa7c5EqcWV9FmlVXr8VhfBzcZo1nXeNdXFT7tQ2yah/odtdcx+vRMSGJd1t/5k5bDd9wAvYdIDblMAg+wiKKZ5KcdAkEA1cCakEN4NexkF5tHPRrR6XOY/XHfkqXxEhMqmNbB9U34saTJnLWIHC8IXys6Qmzz30TtzCjuOqKRRy+FMM4TdwJBAJQZFPjsGC+RqcG5UvVMiMPhnwe/bXEehShK86yJK/g/UiKrO87h3aEu5gcJqBygTq3BBBoH2md3pr/W+hUMWBsCQQChfhTIrdDinKi6lRxrdBnn0Ohjg2cwuqK5zzU9p/N+S9x7Ck8wUI53DKm8jUJE8WAG7WLj/oCOWEh+ic6NIwTdAkEAj0X8nhx6AXsgCYRql1klbqtVmL8+95KZK7PnLWG/IfjQUy3pPGoSaZ7fdquG8bq8oyf5+dzjE/oTXcByS+6XRQJAP/5ciy1bL3NhUhsaOVy55MHXnPjdcTX0FaLi+ybXZIfIQ2P4rb19mVq1feMbCXhz+L1rG8oat5lYKfpe8k83ZA==";
var GZ_SALT = "*&zvdvdvddbfikkkumtmdwqppp?|4Y!s!2br";
var GZ_OLD_KEY = "aLFBMWpxBrIDAD1Si/KVvm41";

var GZ_hostIdx = 0;
var GZ_token = "";
var GZ_uid = "";
var GZ_devKey = "";

function gz_rand(n) {
    var T = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var s = "";
    for (var i = 0; i < n; i++) s += T.charAt(Math.floor(Math.random() * T.length));
    return s;
}
function gz_randHex(n) {
    var T = "0123456789ABCDEF";
    var s = "";
    for (var i = 0; i < n; i++) s += T.charAt(Math.floor(Math.random() * 16));
    return s;
}
function gz_b64bytes(s) { // 标准 base64 → 字节数组
    var T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var r = [], bits = 0, acc = 0;
    for (var i = 0; i < s.length; i++) {
        var v = T.indexOf(s.charAt(i));
        if (v < 0) continue;
        acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; r.push((acc >> bits) & 0xff); }
    }
    return r;
}
function gz_hex2b64(hexs) { // hex 字节串 → 标准 base64（AES 密文喂 __aesCbcDecrypt 用）
    var T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "", pad = "";
    var bytes = [];
    for (var i = 0; i + 1 < hexs.length; i += 2) bytes.push(parseInt(hexs.substring(i, i + 2), 16));
    for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += T.charAt(b0 >> 2);
        out += T.charAt(((b0 & 3) << 4) | (b1 >> 4));
        out += i + 1 < bytes.length ? T.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
        out += i + 2 < bytes.length ? T.charAt(b2 & 63) : "=";
    }
    return out;
}
function gz_json(obj) { return JSON.stringify(obj); }

// 认证：注册或复用已存 token
function gz_shell_check() {
    if (typeof __aesCbcEncrypt === "undefined" || typeof __rsaPubEncB64 === "undefined" || typeof __reqRaw === "undefined")
        throw new Error("瓜子源依赖 PanBox 壳加密原语,仅 PanBox 壳内可用");
}
function gz_auth() {
    gz_shell_check();
    if (GZ_token) return;
    var tk = "", key = "", uid = "";
    try { tk = __storeGet("gz_token") || ""; key = __storeGet("gz_key") || ""; uid = __storeGet("gz_uid") || ""; } catch (e) { }
    if (tk) {
        GZ_token = tk; GZ_devKey = key; GZ_uid = uid;
        // 静默续期（失败不管，业务请求失败会重试其它域名）
        try { gz_api("/App/Authentication/Authenticator/refresh", {}); } catch (e) { }
        return;
    }
    GZ_devKey = gz_randHex(40);
    var d = gz_api("/App/Authentication/Device/signUp", { new_key: GZ_devKey, old_key: GZ_OLD_KEY, phone_type: 1, code: "" }, "");
    GZ_token = d.token || "";
    GZ_uid = String(d.app_user_id || "");
    if (!GZ_token) throw new Error("瓜子注册失败");
    try { __storeSet("gz_token", GZ_token); __storeSet("gz_key", GZ_devKey); __storeSet("gz_uid", GZ_uid); } catch (e) { }
}

// 构造签名 form
function gz_form(paramsJson) {
    var k = gz_rand(16), iv = gz_rand(16);
    var ctB64 = __aesCbcEncrypt(paramsJson, k, iv);
    var bytes = gz_b64bytes(ctB64);
    var rk = "";
    for (var i = 0; i < bytes.length; i++) rk += ("0" + bytes[i].toString(16)).slice(-2);
    rk = rk.toUpperCase();
    var keyjson = '{"iv":"' + iv + '","key":"' + k + '"}';
    var keys = __rsaPubEncB64(GZ_PUB, keyjson);
    var m = {
        token_id: "", token: GZ_token || "", phone_type: "1",
        request_key: rk, app_id: "1", time: String(Math.floor(Date.now() / 1000)), keys: keys,
    };
    var sig = "token_id=" + m.token_id + ",token=" + m.token + ",phone_type=" + m.phone_type
        + ",request_key=" + m.request_key + ",app_id=" + m.app_id + ",time=" + m.time
        + ",keys=" + m.keys + GZ_SALT;
    m.signature = __md5(sig).toUpperCase();
    m.phone_model = "xiaomi-22081212c";
    m.ad_version = "1";
    return m;
}

// 带解密的接口调用（自动轮询域名）
function gz_api(path, params, tokenOverride) {
    var body = gz_json(params || {});
    var errs = null;
    for (var round = 0; round < 2; round++) {
        for (var i = 0; i < GZ_HOSTS.length; i++) {
            var host = GZ_HOSTS[(GZ_hostIdx + i) % GZ_HOSTS.length];
            var save = GZ_token;
            if (tokenOverride !== undefined) GZ_token = tokenOverride;
            var form;
            try { form = gz_form(body); } finally { GZ_token = save; }
            try {
                var r = JSON.parse(__reqRaw(host + path, JSON.stringify({
                    method: "POST",
                    body: (function () {
                        var parts = [];
                        for (var k in form) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(form[k]));
                        return parts.join("&");
                    })(),
                    headers: {
                        "User-Agent": GZ_UA,
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "Ver": "3.0.4.8", "Version": "2606029", "api-ver": "3.0.4.8",
                        "PackageName": "com.v54f07a912.t4ee50f184.dbb1e7669f20260721",
                        "code": "GZ0313", "deviceId": "8641500600" + gz_rand(5).replace(/\D/g, "0"),
                        "lang": "zh_cn", "Cache-Control": "no-cache", "Referer": host,
                    },
                })));
                var txt = String(r.content || "");
                if (!txt) throw new Error("空响应");
                var resp = JSON.parse(txt);
                if (resp.code !== 200 && resp.code !== 0) throw new Error("code=" + resp.code + " " + (resp.msg || ""));
                var data = resp.data || {};
                var kj = JSON.parse(__rsaPrivDecB64(GZ_PRIV, data.keys || ""));
                var pt = __aesCbcDecrypt(gz_hex2b64(String(data.response_key || "")), kj.key, kj.iv);
                GZ_hostIdx = (GZ_hostIdx + i) % GZ_HOSTS.length;
                return JSON.parse(pt);
            } catch (e) {
                errs = e;
            }
        }
        if (round === 0 && tokenOverride === undefined) {
            // token 可能过期：清除后重注册再试一轮
            GZ_token = "";
            try { __storeSet("gz_token", ""); } catch (e) { }
            gz_auth();
        }
    }
    throw new Error("瓜子接口失败: " + String(errs && errs.message || errs));
}

function gz_items(arr) {
    var out = [];
    if (!arr) return out;
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (!o || !o.vod_name) continue;
        out.push({
            vod_id: String(o.vod_id || ""),
            vod_name: o.vod_name,
            vod_pic: o.vod_pic || "",
            vod_remarks: o.vod_scroe || o.vod_remarks || "",
        });
    }
    return out;
}

var GZ_CATS = [
    ["1", "电影"], ["2", "电视剧"], ["3", "动漫"], ["4", "综艺"], ["64", "短剧"],
    ["72", "音乐"], ["74", "AI漫剧"], ["73", "电影解说"], ["71", "体育解说"], ["70", "电竞解说"],
];
var GZ_FILTERS = {
    "1": "动作片:5,悬疑片:29,喜剧片:6,爱情片:7,科幻片:8,恐怖片:9,剧情片:10,战争片:11,动画片:36,纪录片:20,灾难片:38,犯罪片:61",
    "2": "国产剧:12,香港剧:13,台湾剧:14,欧美剧:15,日本剧:16,韩国剧:17,海外剧:18,泰国剧:19,新加坡剧:69",
    "3": "中国动漫:30,日本动漫:31,欧美动漫:33",
    "4": "大陆综艺:22,港台综艺:23,日韩综艺:24,欧美综艺:25",
};

var GZ_API = {
    home: function () {
        gz_auth();
        var h = gz_api("/App/IndexList/index", { ns: "", nt: String(Math.floor(Date.now() / 1000)), pid: "1" });
        var list = [];
        var blocks = h.list || [];
        for (var i = 1; i < blocks.length; i++) {
            list = list.concat(gz_items((blocks[i] || {}).list));
        }
        return {
            class: GZ_CATS.map(function (c) {
                var fs = [];
                var raw = GZ_FILTERS[c[0]];
                if (raw) {
                    var vals = raw.split(",").map(function (x) {
                        var p = x.split(":");
                        return { n: p[0], v: p[1] || "" };
                    });
                    fs = [{ key: "class", name: "类型", value: vals }];
                }
                return { type_id: c[0], type_name: c[1], filters: fs };
            }),
            list: list.slice(0, 60),
        };
    },
    category: function (args) {
        gz_auth();
        var ext = args[3] || {};
        var tid = ext.cateId || String(args[0] || "1");
        var pg = parseInt(args[1], 10) || 1;
        var cls = ext.class || "";
        // 分页字段实测为 page（pg 会被服务端忽略返回同页）
        var p = { ns: "", nt: String(Math.floor(Date.now() / 1000)), pid: tid, page: String(pg) };
        if (cls) p.child = cls;
        var d = gz_api("/App/IndexList/indexList", p);
        var out = gz_items(d.list);
        return { list: out, page: pg, pagecount: out.length >= 30 ? pg + 1 : pg };
    },
    search: function (args) {
        gz_auth();
        var wd = String(args[0] || "");
        if (!wd) return { list: [], page: 1, pagecount: 1 };
        var d = gz_api("/App/Index/findMoreVod", { keywords: wd, ns: "", nt: String(Math.floor(Date.now() / 1000)), order_val: "1" });
        return { list: gz_items(d.list), page: 1, pagecount: 1 };
    },
    detail: function (args) {
        gz_auth();
        var vid = String(args[0] || "");
        if (!vid) throw new Error("缺少瓜子参数");
        var info = gz_api("/App/IndexPlay/playInfo", {
            token_id: GZ_uid, vod_id: vid, mobile_time: String(Math.floor(Date.now() / 1000)), token: GZ_token,
        });
        var v = info.vodInfo || {};
        var vv = gz_api("/App/Resource/Vurl/show", { vurl_cloud_id: "2", vod_d_id: vid });
        var segs = [];
        var eps = vv.list || [];
        for (var i = 0; i < eps.length; i++) {
            var ep = eps[i] || {};
            var nm = ep.title || ("第" + (i + 1) + "集");
            // 选可用清晰度（show_type=0 且 param 非空），存首清晰度 param
            var play = ep.play || {};
            var chosen = "";
            var order = ["2160", "1080", "720", "480", "360", "240"];
            for (var j = 0; j < order.length; j++) {
                var o = play[order[j]];
                if (o && o.show_type !== "2" && o.param) { chosen = o.param; break; }
            }
            if (chosen) segs.push(nm + "$" + chosen);
        }
        if (!segs.length) throw new Error("瓜子剧集为空");
        return { list: [{
            vod_id: vid,
            vod_name: v.vod_name || "",
            vod_pic: v.vod_pic || "",
            vod_year: v.vod_year || "",
            vod_actor: v.vod_actor || "",
            vod_director: v.vod_director || "",
            vod_content: v.vod_use_content || v.vod_content || "",
            vod_play_from: "瓜子",
            vod_play_url: segs.join("#"),
        }] };
    },
    play: function (args) {
        gz_auth();
        var param = String(args[1] || "");
        if (!param) throw new Error("瓜子播放参数为空");
        // param: vod_d_id=..&vurl_id=..&domain_type=..&resolution=..&type=play
        var q = {};
        var parts = param.split("&");
        for (var i = 0; i < parts.length; i++) {
            var kv = parts[i].split("=");
            if (kv.length >= 2) q[kv[0]] = kv.slice(1).join("=");
        }
        if (!q.type) q.type = "play";
        var d = gz_api("/App/Resource/VurlDetail/showOne", q);
        var url = d.url || "";
        if (!url) throw new Error("瓜子播放地址为空");
        return {
            parse: 0, url: url,
            headers: { "User-Agent": "Lavf/57.83.100", "Referer": "http://WJiZxLXA2.com/" },
        };
    },
};

// ─── rule 形态出口(批次A:panboxjs __panCall → jsdrpy rule;壳内全能力)───
function gz_filters(cateId) {
    var raw = GZ_FILTERS[cateId];
    if (!raw) return [];
    return [{ key: "class", name: "类型", value: raw.split(",").map(function (x) {
        var p = x.split(":");
        return { n: p[0], v: p[1] || "" };
    }) }];
}

function gz_cards(list) {
    return (list || []).map(function (v) {
        return { title: v.vod_name, img: v.vod_pic, url: String(v.vod_id || ""), desc: v.vod_remarks || v.vod_scroe || "" };
    });
}

var rule = {
    title: "瓜子",
    host: GZ_HOSTS[0],
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
    play_parse: true,
    headers: { "User-Agent": GZ_UA },

    class_parse: function () {
        var filters = {};
        for (var k in GZ_FILTERS) filters[k] = gz_filters(k);
        return {
            class: GZ_CATS.map(function (c) { return { type_id: c[0], type_name: c[1] }; }),
            filters: filters,
        };
    },

    推荐: function () {
        return gz_cards(GZ_API.home().list);
    },

    一级: function () {
        // 原协议 ext.class 为子分类筛选项(filters 的 class 键)
        var r = GZ_API.category([this.MY_CATE, this.MY_PAGE, "", { class: (this.MY_FL || {}).class || "" }]);
        return gz_cards(r.list);
    },

    二级: function () {
        return GZ_API.detail([this.input]).list[0];
    },

    搜索: function () {
        return gz_cards(GZ_API.search([this.wd]).list);
    },

    lazy: function () {
        var r = GZ_API.play(["", this.input]);
        return JSON.stringify({ parse: r.parse || 0, url: r.url, header: r.headers || {} });
    },
};
