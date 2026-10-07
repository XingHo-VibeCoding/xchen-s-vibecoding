/* api.js —— 前端访问后端的唯一出口（Day 17 新建）
   -------------------------------------------------------------
   位置：TECH_DESIGN §4.2 规矩 1 定的「唯一出口」——
     换环境只改这**一个文件**里的 BASE，四个页面一个字都不用动。

   ★ 接口清单与接进来的时间：
     GET  /api                health   ✅ Day 20（pingHealth，检查台用）
     GET  /api/sessions       read     ✅ Day 17
     GET  /api/favorites      read     ✅ Day 17
     POST /api/chat           chat     ✅ Day 18
     POST /api/analyze        analyze  ✅ Day 19
     POST /api/sessions/write write    ✅ Day 20（writeSession，检查台用）
     POST /api/speech-to-text           ⬜ 未接（契约 §5，本期不启用）

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

  /* analyze 又长一档：输入是整份 transcript（几十轮），
     输出要逐条判断（偏题/逻辑/精彩句子 + 中文提醒 + 英文改法）。
     比 chat 重得多，用60 秒会在正常场景下误判失败 ——
     而误判失败在这里的代价是用户练完一场却看不到任何条目。 */
  var ANALYZE_TIMEOUT_MS = 90000;

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
      /*先解文本再分类，**不要一上来按 res.ok 分流**。
         原因（Day 20 修，与 postWithTimeout 同一处坑）：
         契约 §1.2 说业务失败一般是 200 + ok:false，但 §2 的 health 表里
         404 NOT_FOUND、§4之一 表里 405 METHOD_NOT_ALLOWED 都是**真实 4xx**，
         而且它们 body 里**带着有意义的 error.code**。
         先判 res.ok 会把这些码盖成 HTTP_404 —— records.html 的降级提示
         恰恰是靠 errorCode 说话的（它要区分「路径没接上」与「库读不到」）。

         为什么用 res.text() 再 JSON.parse 而不是直接 res.json()：
         本地起服务时请求 /api/favorites 会拿到 serve.py 的 404 **HTML**，
         直接 res.json() 会抛 SyntaxError，而 SyntaxError 没有 .code，
         页面就只会显示「后端数据读不到」，把真正的原因（路径没接上）盖掉了。 */
      return res.text().then(function (txt) {
        var body = null;
        try { body = JSON.parse(txt); } catch (e) { /* 不是 JSON，留在下面按 HTTP 状态处理 */ }

        /* 第一级：body 自带业务错误码 → 用它（契约的分类口径）。
           判据是 `ok === false` 而非 `!res.ok`，
           否则 200 + ok:false 那种正常业务失败会被漏掉。 */
        if (body && body.ok === false && body.error && body.error.code) {
          var be = new Error(body.error.message || '接口返回失败');
          be.code = body.error.code;
          be.gotPath = body.gotPath;
          be.httpStatus = res.status;
          throw be;
        }

        /* 第二级：没有 JSON 或状态码不对 → 这才是传输层/路径问题。 */
        if (!res.ok || !body) {
          var e2 = new Error(
            body ? '' : 'HTTP ' + res.status + '（返回的不是 JSON，多半是路径没接到后端）');
          e2.code = body ? 'HTTP_' + res.status : 'HTTP_' + res.status + '_NOT_JSON';
          throw e2;
        }

        /* 第三级：外壳形状不对（ok 不为 true 却没有 error），
           不能当成功 —— 否则页面会拿到 undefined 去渲染。 */
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
     唯一一处翻译。改名只改这里，渲染代码永远只认 quote / fix / typeLabel。

     ★ typeFallback 是给「接口没给 type」的情况用的兜底，
       默认值是 'good' —— 因为**只有精彩句子会缺 type**：
       契约 §4 的 goodSentences[] 项只有 {turn, originalText}，
       没有 type 字段；而 issues[] 一定有 type。
       若默认成 'offtopic'，所有精彩句子都会被标成「偏题」
       （typeLabelOf 的兜底分支就是偏题，Day 14 踩过offtopic/off_topic 的坑）。 */
  function mapItem(row, typeFallback) {
    var type = row.type || typeFallback || 'good';
    return {
      itemId: row.itemId,
      sessionId: row.sessionId,
      topicId: row.topicId,
      type: type,
      /* typeLabel 由 type 查表得到，**不让后端传**（契约 §7 的理由：
         中文界面文案的决定权不该交给后端，改文案就要改后端） */
      typeLabel: typeLabelOf(type),
      quote: row.originalText,          // 接口 originalText → 展示 quote
      turn: row.turn,
      reminder: row.reminder,
      /* ★ undefined 与 null 要分清：契约 §4 规定偏题的 correction 就是 null，
         映射成展示层的空串（偏题只提醒、不给改法，B7）；
         但字段整个不存在时也落空串 —— 渲染层只认空/非空，不必再判断。 */
      fix: row.correction === null || row.correction === undefined ? '' : row.correction,
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

  /* ---------- POST /api/analyze（Day 19）----------
     整场结束后的偏题 / 逻辑判断与精彩句子提取（契约 §4）。

     ★ 为什么它不叫 items / results：契约 §4 定名 analyze，
       且「分析」这个词在本项目里只指这一件事（回合中的 AI 不做分析，
       那是 chat 的提示词里明写的不准做的事，B9）。

     ★ 与chat 的三处不同：
       ① 传的是整份 transcript，不是单轮 + 若干轮历史
       ② 超时更长（90 秒）—— 输入是几十轮，输出要逐条判断，
         比「等一句话」重得多；用60 秒会在正常场景下误判失败
       ③ 返回的是**数组**，不是单个对象 —— 映射要逐条做

     为什么用 mapItem 而不是自己拼：mapItem 是契约 §7 定的唯一映射处
     （originalText → quote、correction → fix、type → typeLabel），
     走它才不会写出第二份翻译。 */
  function analyze(params) {
    return postWithTimeout('/api/analyze', {
      topicId: params.topicId,
      transcript: params.transcript || [],
      /* anchor 随请求带上：8 主题的偏题判定要有个「主题是什么」的依据，
         而云函数读不到 frontend/data/topics.json（理由同 chat 的role/anchor）。
         FREE 不判偏题，anchor 传空串即可。 */
      anchor: params.anchor || ''
    }, ANALYZE_TIMEOUT_MS).then(function (data) {
return {
      /* issues 自带 type（契约 §4 规定只允许 offtopic / logic），不传兜底；
         goodSentences 没有 type 字段，显式给 'good' ——
         靠 mapItem 的默认兜底虽然也能得到 'good'，
         但那是「碰巧对」，写出来才知道为什么对。 */
      issues: (data.issues || []).map(function (row) { return mapItem(row); }),
      goodSentences: (data.goodSentences || []).map(function (row) { return mapItem(row, 'good'); }),
        /* B10：没发现问题就是没发现，界面据此显示「没发现问题」，
           不硬凑条目（mock 阶段这里总是有3 条假条目）。 */
        noIssueFound: data.noIssueFound === true,
        model: data.model
      };
    });
  }

  /* ---------- 带回落的 analyze ----------
     为什么 analyze 也给回落版：判定要等模型（普遍 10–30 秒），
     比 chat 更久，失败概率更高；而结果页在接口挂掉时
     **不能变成空白** —— 用户练完一场看到「条目没能加载」，
     不如看到预设条目 + 一行说明。行为与两个读接口一致（api.js 开头 ②）。 */
  function analyzeOrLocal(params, localFallback) {
    var fb = localFallback || { issues: [], goodSentences: [] };
    return analyze(params).catch(function (err) {
      return {
        issues: fb.issues || [],
        goodSentences: fb.goodSentences || [],
        noIssueFound: !fb.issues || fb.issues.length === 0,
        degraded: true,
        errorCode: err.code,
        errorMessage: err.message
      };
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

        /* ★★ Day 20 修的一处真bug：原来这里先判`!res.ok` 就抛，
           结果把 body 里真正的 error.code 盖掉了。

           症状（检查台第一次点写入就撞上）：第二个测试行点第二次时，
           接口按契约 §4之一返回 `HTTP 400 + error.code="DUPLICATE"`，
           前端却显示 `HTTP_400` —— 页面因此把「主键约束按预期生效」
           说成了「写入失败」，方向完全反了。

           根因：`res.ok` 为 false 时，body **照样是那份合法的 {ok:false,...}**
           （契约 §1.3 规定业务失败 data 恒为 null，但 error 一定在）。
           契约 §4之一 明确写「DUPLICATE 用真实的 400 而不是 200」，
           所以 4xx 也可能带着有意义的业务错误码—— 不能只看状态码。

           修法：**先看 body 有没有 error.code**，有就用它（这才是契约的分类口径）；
           没有才退回按 HTTP 状态码分类（那时才是真正的传输层问题）。
           两级顺序不能反 —— 反了就是今天这个 bug。 */
        if (body && body.ok === false && body.error && body.error.code) {
          var be = new Error(body.error.message || '接口返回失败');
          be.code = body.error.code;
          be.httpStatus = res.status;
          throw be;
        }

        if (!res.ok || !body) {
          var e2 = new Error(body ? ''
            : 'HTTP ' + res.status + '（返回的不是 JSON，多半是路径没接到后端）');
          e2.code = body ? 'HTTP_' + res.status : 'HTTP_' + res.status + '_NOT_JSON';
          throw e2;
        }
        /* 契约 §1.2：业务失败通常是 200 + ok:false，上面已处理过；
           走到这里若 ok 仍不为 true，说明外壳形状不对，不能当成功。 */
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

  /* ---------- POST /api/sessions/write（Day 20 · 检查台写入测试）----------
     ★ 为什么今天才接：Day 18 建了这个接口但前端没调用方，
       一直只靠 curl 验证。今天检查台（pages/status.html）要一个
       「写入链路通不通」的按钮，这是它的第一个前端调用方。

     ★ sessionId 由前端生成（契约 §4之一 决定 1）：
       「重复提交被拒」这个行为要求**前端手里已经有这个 id**才谈得上 ——
       后端生成的话，第二次点按钮会拿到两个不同 id，永远撞不上主键。
       所以这里带一个带 S-TEST- 前缀的固定 id：
         第一次点 = 写入成功；第二次点 = 400 DUPLICATE，正好验证约束在生效。

     ★ 不叫 saveSession 而叫 writeSession：路径是 /api/sessions/write，
       云函数名也是 write（cloudbaserc.json 里的第 4 个函数），
       名字跟着走省得对不上。

     ⚠️ 这一条是四个 POST 里唯一「真的会改数据库」的。
       别的（chat / analyze）只读不写，失败重试无副作用；
       这一条失败重试会在库里留两行 —— 所以它的幂等键必须真的起作用。 */
  function writeSession(payload) {
    return postWithTimeout('/api/sessions/write', {
      sessionId: payload.sessionId,
      topicId: payload.topicId,
      nickname: payload.nickname || '',
      startedAt: payload.startedAt,
      endedAt: payload.endedAt || '',
      isComplete: payload.isComplete === true,
      /* transcript 至少 1 轮（契约 §4之一 必填）。空数组会被接口判 INVALID_PARAMS，
         所以调用方必须给至少一轮 —— 这里不再兜底，塞个假的反而会写进库里。 */
      transcript: payload.transcript || [],
      items: payload.items || []
    }, TIMEOUT_MS).then(function (data) {
      return {
        session: data.session,
        turnsStored: data.turnsStored,
        itemsStored: data.itemsStored,
        itemsDropped: data.itemsDropped
      };
    });
  }

  /* ---------- 裸 GET /api（Day 20 · 检查台健康检查）----------
     health 那条路由在 cloudbaserc.json 里是 path:"/api"（**没有 /health 后缀**），
     所以这里就是 GET /api，不要自己加后缀。返回 {ok:true, service:"TalkTrainer"}，
     注意它**不包在 data 里** —— 与其余四个接口的 {ok,data,error} 外壳不同，
     是契约 §2 记过的历史形状。所以不能走 request()（那个函数会解 body.data），
     单独发一次 fetch。 */
  function pingHealth() {
    var url = BASE + '/api';
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    var opt = { method: 'GET', headers: { 'Accept': 'application/json' } };
    if (controller) opt.signal = controller.signal;

    return fetch(url, opt).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = JSON.parse(txt); } catch (e) {}
        if (!res.ok || !body || body.ok !== true) {
          var e = new Error(body && body.error ? (body.error.message || '健康检查失败')
            : 'HTTP ' + res.status + '（健康接口没返回预期内容）');
          e.code = body && body.error ? (body.error.code || 'UNKNOWN') : 'HTTP_' + res.status;
          throw e;
        }
        /* 注意这里返回的是 body 本身而不是 body.data：
           health 的形状是 {ok, service}，没有 data 这一层。 */
        return { service: body.service || '（未返回服务名）', base: BASE || '（当前域名）' };
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
    analyze: analyze,
    analyzeOrLocal: analyzeOrLocal,
    writeSession: writeSession,
    pingHealth: pingHealth,
    mapItem: mapItem,
    typeLabelOf: typeLabelOf
  };
})();
