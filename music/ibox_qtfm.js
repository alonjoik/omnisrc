/**
 * @name 蜻蜓电台
 * @description iBox 内置广播电台源
 * @version 1.0.0
 * @author PanBox
 */
// ibox_qtfm.js — 蜻蜓 FM 电台（落雪扩展 action 适配器；蓝本 qtfm_ibox.js，协议零变化）
// 协议：GraphQL POST https://webbff.qtfm.cn/www {radioPage(cid,page){contents} / searchResultsPage}；
//       详情 GET webapi.qtfm.cn/api/pc/radio/{id} → album；播放直链 lhttp-hw.qtfm.cn/live/{id}/64k.mp3
// 扩展 action（宿主契约）：home → {class}；category → {list,page,pagecount}；search → {list}；
//                          detail → {list:[vod]}；musicUrl → url 字符串（info.musicInfo.songmid=电台id）
const { EVENT_NAMES, request, on, send } = globalThis.lx

const QT_CATS = [
    ['3', '北京'], ['5', '天津'], ['7', '河北'], ['19', '山西'], ['31', '内蒙古'], ['44', '辽宁'],
    ['59', '吉林'], ['69', '黑龙江'], ['217', '广东'], ['83', '上海'], ['99', '浙江'], ['85', '江苏'],
    ['111', '安徽'], ['129', '福建'], ['139', '江西'], ['151', '山东'], ['169', '河南'], ['187', '湖北'],
    ['202', '湖南'], ['239', '广西'], ['254', '海南'], ['257', '重庆'], ['259', '四川'], ['281', '贵州'],
    ['291', '云南'], ['316', '陕西'], ['327', '甘肃'], ['351', '宁夏'], ['357', '新疆'], ['308', '西藏'],
    ['342', '青海'], ['433', '资讯'], ['442', '音乐'], ['429', '交通'], ['439', '经济'], ['432', '文艺'],
    ['441', '都市'], ['430', '体育'], ['431', '双语'], ['438', '综合'], ['435', '生活'], ['436', '旅游'],
    ['434', '曲艺'], ['440', '方言'],
]

const QT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Referer': 'https://www.qtfm.cn',
}

function qt_req(url, opt) {
    return new Promise(function (resolve, reject) {
        request(url, opt || {}, function (err, resp) {
            if (err) return reject(new Error(String(err)))
            resolve(resp && resp.body)
        })
    })
}

function qt_gql(query) {
    return qt_req('https://webbff.qtfm.cn/www', {
        method: 'POST',
        body: JSON.stringify({ query: query }),
        headers: Object.assign({ 'content-type': 'application/json' }, QT_HEADERS),
    })
}

function qt_pic(u) {
    const s = String(u || '')
    return s.indexOf('//') === 0 ? 'https:' + s : s
}

function qt_cards(arr, detailMode) {
    const out = []
    if (!arr || !arr.length) return out
    for (let i = 0; i < arr.length; i++) {
        const o = arr[i]
        out.push({
            vod_id: String(o.id || ''),
            vod_name: o.title || '',
            vod_pic: qt_pic(detailMode ? o.cover : o.imgUrl),
            vod_remarks: String((detailMode ? o.description : o.desc) || '').slice(0, 40),
        })
    }
    return out
}

on(EVENT_NAMES.request, function (req) {
    const source = req.source
    const action = req.action
    const info = req.info || {}
    return new Promise(function (resolve, reject) {
        switch (action) {
            case 'musicUrl': {
                const id = (info.musicInfo && (info.musicInfo.songmid || info.musicInfo.hash)) || ''
                if (!id) return reject(new Error('蜻蜓电台 id 为空'))
                resolve('https://lhttp-hw.qtfm.cn/live/' + id + '/64k.mp3')
                break
            }
            case 'home':
                resolve({ class: QT_CATS.map(function (c) { return { type_id: c[0], type_name: c[1] } }) })
                break
            case 'category': {
                const tid = String(info.cate || '3')
                const pg = parseInt(info.page, 10) || 1
                qt_gql('{\n    radioPage(cid:' + tid + ', page:' + pg + '){\n      contents\n    }\n  }').then(function (d) {
                    let items = null
                    try { items = d.data.radioPage.contents.items } catch (e) { }
                    resolve({ list: qt_cards(items, false), page: pg, pagecount: (items && items.length >= 12) ? pg + 1 : pg })
                }).catch(reject)
                break
            }
            case 'search': {
                const kw = String(info.wd || '').replace(/"/g, '')
                const pg = parseInt(info.page, 10) || 1
                qt_gql('{\n        searchResultsPage(keyword:"' + kw + '", page:' + pg + ', include:"channel_live" ) {\n          tdk,\n          searchData,\n          numFound\n        }\n      }').then(function (d) {
                    let arr = null
                    try { arr = d.data.searchResultsPage.searchData } catch (e) { }
                    resolve({ list: qt_cards(arr, true) })
                }).catch(reject)
                break
            }
            case 'detail': {
                const id = String(info.id || '')
                qt_req('https://webapi.qtfm.cn/api/pc/radio/' + encodeURIComponent(id), { headers: QT_HEADERS }).then(function (body) {
                    const a = (body && body.album) || {}
                    resolve({ list: [{
                        vod_id: id,
                        vod_name: a.title || '',
                        vod_pic: qt_pic(a.cover),
                        vod_content: a.description || '',
                        vod_play_from: '蜻蜓FM',
                        vod_play_url: (a.title || '直播') + '$' + (a.id || id),
                    }] })
                }).catch(reject)
                break
            }
            default:
                reject(new Error('蜻蜓电台不支持 action: ' + action))
        }
    })
})

send(EVENT_NAMES.inited, {
    status: true,
    sources: {
        ibox_qtfm: {
            name: '蜻蜓电台',
            type: 'music',
            actions: ['musicUrl', 'home', 'category', 'search', 'detail'],
            qualitys: ['128k'],
        },
    },
})
