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

  /* ★ 基址：一处判断，本地与线上各自对（规矩 1）。
     留空字符串 = 用当前域名。

     ★ Day 18 踩过的坑：原先 BASE 写死空字符串，本地跑时页面在 localhost:8010，
       请求就打到了**本地静态服务** —— POST /api/chat 得到 **501**（serve.py 打的，
       不是云端），AI 于是永远在降级。查这个问题花了几轮。

     现在按 hostname 判断，两边都不用改别的地方：
       localhost / 127.0.0.1 → 云端域名（本地静态服务不提供 API）
       其他（线上 CloudBase 域名）→ 留空 = 当前域名，与接口同域、免跨域

     为什么本地不能用空串：本地静态服务只 serve 静态文件，不转发也不代理，
     所以「同域」在本地根本不成立。 */
  var CLOUD_BASE = 'https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com';
  var IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var BASE = IS_LOCAL ? CLOUD_BASE : '';

  /* 读接口的超时。CloudBase 是按需启停的（空闲会挂起），
     第一次请求可能有冷启动延迟，所以给得比一般接口宽一些。 */
  var TIMEOUT_MS = 25000;

  /* chat 单独一个超时：AI 要等模型回话（普遍 3–15 秒，DeepSeek 偶尔更久），
     读库是毫秒级。沿用 25 秒会在模型慢一点时误判为失败 ——
     而「误判失败」在这里的代价是用户看到一句突兀的降级台词。 */
  var CHAT_TIMEOUT_MS = 60000;

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

  /* ---------- 写接口：POST /api/chat（Day 18）----------
     ★ 与上面两个 GET 的三点不同：
       ① 用 POST —— 聊天要发一大段history，query 放不下也不该放
       ② body 用 JSON.stringify —— GET 只带参数，这里带数组与嵌套对象
       ③ 超时更长（60 秒）—— AI 要等模型回话，读库是毫秒级

     ★ 约束数据（role / anchor / followUps）由**调用方**一起带上来，
     云函数读不到 frontend/data/topics.json（那是静态目录里的文件）。
     云端已有这三个字段的实现，缺了它也能跑但追问会跑出主题外。 */
  function chat(params) {
    return postWithTimeout('/api/chat', {
      topicId: params.topicId,
      userText: params.userText,
      history: params.history || [],
      silenceSeconds: params.silenceSeconds || 0,
      /* kind 让云函数区分「这轮用户有没有开口」：
         open / silence 两种场景用户还没说话，userText 天然为空，
         云函数据此跳过 userText 的必填校验（否则一进对话就报 INVALID_PARAMS）。 */
      kind: params.kind || 'reply',
      role: params.role || '',
      anchor: params.anchor || '',
      followUps: params.followUps || []
    }, CHAT_TIMEOUT_MS).then(function (data) {
      return {
        aiText: data.aiText,
        kind: data.kind,
        followUpType: data.followUpType,
        model: data.model
      };
    });
  }

  /* ---------- POST 版请求（带独立超时）----------
     为什么不用上面的 request()：它是 GET，没有 body、也没有 body 解析。
     与其给 request() 加一堆 if (method === 'POST') 分支，不如把两件事分开写 ——
     分支越少，读代码时越不容易猜错。 */
  function postWithTimeout(path, bodyObj, timeoutMs) {
    var url = BASE + path;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    var opt = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(bodyObj)
    };
    if (controller) opt.signal = controller.signal;

    return fetch(url, opt).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = JSON.parse(txt); } catch (e) {}

        if (!res.ok || !body) {
          var e2 = new Error(body ? ''
            : 'HTTP ' + res.status + '（返回的不是 JSON，多半是路径没接到后端）');
          e2.code = body ? 'HTTP_' + res.status : 'HTTP_' + res.status + '_NOT_JSON';
          throw e2;
        }
        /* 契约 §1.2：只看 ok。业务失败是 200 + ok:false。 */
        if (body.ok !== true) {
          var e = body.error || {};
          var err = new Error(e.message || '接口返回失败');
          err.code = e.code || 'UNKNOWN';
          throw err;
        }
        return body.data;
      });
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  window.Api = {
    BASE: BASE,
    getSessions: getSessions,
    getFavorites: getFavorites,
    getSessionsOrLocal: getSessionsOrLocal,
    getFavoritesOrLocal: getFavoritesOrLocal,
    chat: chat,
    mapItem: mapItem,
    typeLabelOf: typeLabelOf
  };
})();
