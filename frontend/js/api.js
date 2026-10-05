/* api.js —— 前端访问后端的唯一出口（Day 17 新建）
   -------------------------------------------------------------
   位置：TECH_DESIGN §4.2 规矩 1 定的「唯一出口」——
     换环境只改这**一个文件**里的 BASE，四个页面一个字都不用动。
     今天只接两个读接口（api-contract §2.1），写入接口 Day 18 起陆续加。

   为什么今天要建它（而不是等接口通了再说）：
     页面要接后端，就必须有一个「统一的地方」知道
     「基址在哪、路径怎么拼、返回 {ok,data,error} 怎么判、失败怎么显示」。
     这些规则散在页面里就会出现四份不一致的写法。
     **建了但不接数据**（fetchData 失败就回落到本地 mock），
     好处是：今天页面照常能用，接口一通就自动切过去，不用再改页面。

   -------------------------------------------------------------
   ★ 三个约定（都是从契约里抄的，不自己发明）
   -------------------------------------------------------------
   ① **只判断 ok**：契约 §1.2 规定所有接口都带 ok 布尔值，
      业务失败也返回 HTTP 200 + ok:false。前端不必区分
      「网络失败」与「业务失败」两套处理逻辑。
   ② **失败必须回落到本地数据**：读接口当前返回 DB_CONNECTION_REFUSED
      （个人版连不上 PG，见 api-contract §2.1「已知的未通项」）。
      所以 fetchData 失败时**不把页面清空**，而是继续用本地 mock——
      否则接口一挂，记录页就变成空白，比不做还糟。
   ③ **展示层字段名在映射处翻**：`quote` / `fix` 是展示层叫法，
      `originalText` / `correction` 是接口层叫法（契约 §7 已拍板两者并存）。
      **翻译只发生在这一处**（mapItem）。
   -------------------------------------------------------------------- */

(function () {
  'use strict';

  /* ★ 基址：不写进每个页面，只写在这里（规矩 1）。
     留空字符串 = 用当前域名（本地是 localhost:8010，线上是 CloudBase 域名）。
     将来若接口与页面不同源，把绝对地址填在这里即可，页面无需改动。 */
  var BASE = '';

  /* 读接口的超时。CloudBase 是按需启停的（空闲会挂起），
     第一次请求可能有冷启动延迟，所以给得比一般接口宽一些。 */
  var TIMEOUT_MS = 25000;

  /* ---------- 底层：带超时的 fetch ---------- */
  /* fetch 本身没有超时能力，不加控制台会一直转圈。
     AbortController 是标准做法，没有它就没有「等不下去就放弃」这条退路。 */
  function request(path, params) {
    var url = BASE + path;
    if (params) {
      var qs = [];
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) &&
            params[k] !== undefined && params[k] !== null && params[k] !== '') {
          qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      if (qs.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    var opt = { method: 'GET', headers: { 'Accept': 'application/json' } };
    if (controller) opt.signal = controller.signal;

    return fetch(url, opt).then(function (res) {
      /* 先看HTTP 状态码，再解JSON —— 顺序不能反。
         本地起服务时请求 /api/favorites 会拿到 serve.py 的 404 **HTML**，
         直接 res.json() 会抛 SyntaxError，而 SyntaxError 没有 .code，
         页面就只会显示「后端数据读不到」，把真正的原因（路径没接上）盖掉了。
         这里先判状态码，好让降级提示能说出到底是哪种失败。 */
      return res.text().then(function (txt) {
        var body = null;
        try { body = JSON.parse(txt); } catch (e) { /* 不是 JSON，留在下面按 HTTP 状态处理 */ }

        if (!res.ok || !body) {
          var e2 = new Error(
            body ? '' : 'HTTP ' + res.status + '（返回的不是 JSON，多半是路径没接到后端）');
          e2.code = body ? 'HTTP_' + res.status : 'HTTP_' + res.status + '_NOT_JSON';
          throw e2;
        }

        /* 契约 §1.2：只看 ok，不看 HTTP 状态码。
           业务错误是 200 + ok:false，网络层错误才会走到 catch。 */
        if (body.ok !== true) {
          var e = body.error || {};
          var err = new Error(e.message || '接口返回失败');
          err.code = e.code || 'UNKNOWN';
          err.gotPath = body.gotPath;
          throw err;
        }
        return body.data;
      });
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /* ---------- 字段映射：接口层 → 展示层（契约 §7） ----------
     唯一一处翻译。改名只改这里，渲染代码永远只认 quote / fix / typeLabel。 */
  function mapItem(row) {
    return {
      itemId: row.itemId,
      sessionId: row.sessionId,
      topicId: row.topicId,
      type: row.type,
      /* typeLabel 由 type 查表得到，**不让后端传**（契约 §7 的理由：
         中文界面文案的决定权不该交给后端，改文案就要改后端） */
      typeLabel: typeLabelOf(row.type),
      quote: row.originalText,          // 接口 originalText → 展示 quote
      turn: row.turn,
      reminder: row.reminder,
      fix: row.correction === null ? '' : row.correction,  // 接口 correction → 展示 fix
      isFavorited: row.isFavorited,
      note: row.note,
      favoritedAt: row.favoritedAt,
      createdAt: row.createdAt
    };
  }

  /* 与 item-card.js / records.html 里的中文标签保持一致。
     Day 14 踩过 offtopic 被写成 off_topic 的坑，这里只有一处映射，写错一眼能看出来。 */
  function typeLabelOf(type) {
    if (type === 'logic') return '逻辑错误';
    if (type === 'good') return '精彩句子';
    return '偏题';                      // offtopic；未知值也落这里，避免出现空胶囊
  }

  /* ---------- 两个读接口（api-contract §2.1）---------- */
  /* 会话列表。核心表sessions 的列表，R1。 */
  function getSessions(params) {
    return request('/api/sessions', params).then(function (data) {
      return { sessions: (data.sessions || []), count: data.count };
    });
  }

  /* 收藏列表。items 里 is_favorited = TRUE 的那些，R5 只读侧。 */
  function getFavorites(params) {
    return request('/api/favorites', params).then(function (data) {
      return { items: (data.items || []).map(mapItem), count: data.count };
    });
  }

  /* ---------- 带降级的取数（今天页面的真实用法）----------
     失败时回落到传入的本地数据，并把错误信息挂上供页面显示。
     **页面因此永远不会空**——这是 ② 的直接落点。 */
  function getSessionsOrLocal(params, localFallback) {
    return getSessions(params).catch(function (err) {
      return { sessions: localFallback || [], count: (localFallback || []).length,
               degraded: true, errorCode: err.code, errorMessage: err.message };
    });
  }

  function getFavoritesOrLocal(params, localFallback) {
    return getFavorites(params).catch(function (err) {
      return { items: localFallback || [], count: (localFallback || []).length,
               degraded: true, errorCode: err.code, errorMessage: err.message };
    });
  }

  window.Api = {
    BASE: BASE,
    getSessions: getSessions,
    getFavorites: getFavorites,
    getSessionsOrLocal: getSessionsOrLocal,
    getFavoritesOrLocal: getFavoritesOrLocal,
    mapItem: mapItem,
    typeLabelOf: typeLabelOf
  };
})();
