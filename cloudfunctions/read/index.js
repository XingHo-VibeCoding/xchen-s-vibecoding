/* GET /api/sessions 与 GET /api/favorites —— 第一个读接口（Day 17 · 板块 ①）
   -------------------------------------------------------------
   位置：整个后端第1 号「真正查库」的接口（第 0 号是 health，不连库）。
   它做的是 api-contract §6.1 里登记的 R1（读核心表 sessions）与
   R5 的一部分（只读侧：读 items 里已收藏的条目）。

   ★ 为什么不是清单上写的 /api/hot（今日热搜）：
     清单给的是「打卡 / 热搜」类项目的范例。本项目没有热搜表、
     PRD 里也没有任何要展示热搜的场景，api-contract §6.2 已写明
     「本项目不是打卡应用」。硬造一张没人用的表等于凭空多一个
     要维护的东西，所以按契约读自己的表。
     「三个问题」的答案也指向这里：sessions / items 是**用户产出的**
     数据，要回看历史 → 必须存库（Day 16 已建）→ 今天只是**从库里读出来**。

   为什么用 Node 原生 http + pg，不引 express（同 health/index.js 的理由）：
     零构建、无框架、部署不容易出问题。今天要的是确定能跑通。

   --------------------------------------------------------------------
   ★★ 写这个文件时踩到的一个真坑（值得单独记住）：
     pg 驱动会把 PG 的 TIMESTAMP **自动解析成 JS 的 Date 对象**，
     而 Date 的一切格式化方法（toISOString / toLocaleString）都隐含
     「本机时区 → UTC」的换算。契约 §9.8 第 5 条明确禁止这类换算
     （偏移量是写死常量，一换环境就错）。
     **解决办法：在 SQL 里就用 to_char() 把时间拼成字符串**，
     PG 返回的就是 text，驱动不碰它，出口直接补 "+08:00"。
     这样「库里的 TIMESTAMP」到「接口的 ISO 8601」全程没有时区换算，
     只有一处写死的偏移量 —— 正是契约要的那一处。
   -------------------------------------------------------------------- */

const http = require('http');
/* ★★ Day 18：从 pg 驱动改成 CloudBase HTTP API（cloudfunctions/httpdb.js）
   原因：本环境是体验版，云函数没有 VPC 权限，pg 直连永远连不上
   （Day 17 实测；官方能力表「云函数 连接腾讯云 VPC」在体验版/个人版都是「-」）。
   ★★ Day 19（板块 ②）：本文件**不再直接 require httpdb**。
     数据访问全部下沉到 repositories/，这里只做接口层的三件事——
     接请求、调 repository、返响应。
     拆之前这个文件里同时住着三层：路由与校验（接口层）、
     列名与查询条件（数据访问层）、https 调用（传输层）。
     现在后两层分别是 repositories/*.js 与 httpdb.js，依赖方向单一：
       index.js → repositories/*.js → httpdb.js
     ★ 为什么是三个文件而不是一个：见 sessionsRepository.js 文件头。 */

/* ★ 数据访问层：一张表一个文件。
   注意 require 的路径是'./repositories/xxx'——它们自己再去 require('../httpdb')。
   也就是**接口层不再碰 httpdb**，唯一还在碰它的地方是下面的 classifyDbError，
   因为错误分类是「响应怎么写」的问题，属于接口层职责。 */
const sessionsRepo = require('./repositories/sessionsRepository');
const itemsRepo = require('./repositories/itemsRepository');
/* 错误分类仍走 httpdb：它认得 PostgreSQL 的错误码（23505 / 23514 / …）。
   这一条不是「数据访问漏了出去」—— classify 只读错误信息，不碰数据。 */
const db = require('./httpdb');

/* ---------- 二、时间字段的统一出口（契约 §9.8 第 5 条）---------- */
/* 库里是 TIMESTAMP（不带时区），按 UTC+8 存、单时区不做换算；
   接口按 ISO 8601 带偏移输出。
   偏移量是**写死的常量**，不是 now() 算出来的，也不用时区库。 */
const TZ_SUFFIX = '+08:00';

/* 时间字段的统一出口（契约 §9.8 第 5 条）——
   库里是 TIMESTAMP（不带时区），按 UTC+8 存、单时区不做换算；
   接口按 ISO 8601 带偏移输出。

   ★★ Day 18 实测：PG 经 HTTP API 返回 TIMESTAMP 时**不带偏移量**，
      原样是 '2026-09-28T20:11:16'（我第一版注释里写「pg 侧带着 +08:00」是错的，
      线上 curl 打出来才发现少了偏移量）。
      所以**补偏移量这一步仍然要自己做** —— 它正是契约 §9.8 第 5 条
      要求「只有一处写死的偏移量」的那一处。

      不引入时区库、不用 now()：偏移量是常量，与运行环境时区无关。
   null（ended_at 为空 = 中途退出 B6）必须原样返回 null，
   **不能变成 "null" 字符串或空串** —— 前端要靠它判断「这场没正常结束」。 */
function iso(ts) {
  if (ts === null || ts === undefined) return null;
  let s = String(ts);
  if (s.indexOf(' ') >= 0) s = s.replace(' ', 'T');   // 防御：有的环境给空格分隔
  /* 已经有偏移量（带 + 或 -，或以 Z 结尾）就不重复补 */
  if (/(?:[+-]\d{2}:?\d{2}|Z)$/.test(s)) return s;
  return s + TZ_SUFFIX;
}

/* ---------- 三、统一响应外壳（契约 §1.2 / §1.3）---------- */
function sendJSON(res, httpStatus, body) {
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function sendOK(res, data) {
  sendJSON(res, 200, { ok: true, data: data, error: null });
}

function sendError(res, httpStatus, errorCode, message, extra) {
  const body = { ok: false, data: null, error: { code: errorCode, message: message } };
  if (extra) {
    //契约 §1.5：4xx / 5xx 要回显「我实际收到了什么」。
    // Day 15 部署 404 时，正是 gotPath 这个字段一秒指出网关把 /api 前缀剥掉了。
    for (const k of Object.keys(extra)) body[k] = extra[k];
  }
  sendJSON(res, httpStatus, body);
}

/* ---------- 四、参数解析（全部参数化，不拼字符串）---------- */
/* 契约 §6.1：limit 默认 20，topicId 不传= 全部主题。
   ★ 这里只做**校验与转型**，SQL 里一律用 $1/$2 占位符——
     拼进WHERE 子句的永远是 $1，不是用户输入本身。 */
function parseLimit(raw) {
  if (raw === null || raw === undefined || raw === '') return 20;
  if (!/^\d+$/.test(raw)) return null;          // 非法 → 交上层报 INVALID_PARAMS
  const n = parseInt(raw, 10);
  if (n < 1 || n > 100) return null;            // 上限 100，防止一次拉爆
  return n;
}

/* topicId 只允许 T1–T8 / FREE，白名单校验。
   这一条不只是洁癖：topicId 后面要进 WHERE 和索引，
   放过任意字符串等于放弃索引，白名单顺带堵掉了注入面。 */
function validTopicId(t) {
  if (t === null || t === undefined || t === '') return undefined; // 不传 = 全部
  if (!/^(T[1-8]|FREE)$/.test(t)) return null;                     // 非法
  return t;
}

/* ---------- 五、出口映射（契约 §9.8 第 4 条）----------
   ★★ Day 19：这一节**没有跟着搬去repository**，是有意的。
     契约第4 条写的是「映射只写在出口那一处」——
     「出口」指接口的响应，所以 camelCase 转换留在接口层。
     repository 交出的是库里原样的 snake_case 行。

   sessions 行 → 接口形状。HTTP 层返回的是 snake_case 列名，
   所以这里从 row.session_id 取（不再是 row.sessionId）。
   映射**只写在出口这一处**，不散落到各个地方（契约 §9.8 第 4 条）。 */
function shapeSession(row) {
  return {
    sessionId: row.session_id,
    topicId: row.topic_id,
    nickname: row.nickname === '' ? null : row.nickname,  // 空串 → null，界面自己决定显示「你」
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    durationSeconds: Number(row.duration_seconds),
    errorCount: Number(row.error_count),
    goodSentenceCount: Number(row.good_sentence_count),
    turnCount: Number(row.turn_count),
    isComplete: row.is_complete,
    aborted: row.ended_at === null           // B6：中途退出的场次也算数据
  };
}

/* items 行 → 接口形状。同样从 snake_case 取（Day 18 起）。
   correction 保持 null（偏题与精彩句子无改法，B7）——
   库里的 ck_items_correction 已经保证过这件事，接口只负责不把它变成空串。 */
function shapeItem(row) {
  return {
    itemId: row.item_id,
    sessionId: row.session_id,
    topicId: row.topic_id,
    type: row.type,
    turn: Number(row.turn),
    originalText: row.original_text,
    reminder: row.reminder,
    correction: row.correction === null ? null : row.correction,
    isFavorited: row.is_favorited,
    note: row.note,
    favoritedAt: iso(row.favorited_at),
    createdAt: iso(row.created_at)
  };
}

/* ---------- 六、两个处理函数 ---------- */
/* ★★ Day 19：这两段现在只剩接口层该做的事——
   校验参数（limit / topicId）、调repository、把行转成响应形状、返回。
   「查哪张表、查哪些列」已经不在这个文件里了。 */
async function handleSessions(query, res) {
  const limit = parseLimit(query.limit);
  if (limit === null) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'limit 只能是 1–100 的整数', { gotParams: JSON.stringify(query) });
  }
  const topicId = validTopicId(query.topicId);
  if (topicId === null) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'topicId 只允许 T1–T8 或 FREE', { gotParams: JSON.stringify(query) });
  }

  const rows = await sessionsRepo.listSessions(topicId, limit);
  const data = rows.map(shapeSession);
  return sendOK(res, { sessions: data, count: data.length });
}

async function handleFavorites(query, res) {
  const limit = parseLimit(query.limit);
  if (limit === null) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'limit 只能是 1–100 的整数', { gotParams: JSON.stringify(query) });
  }
  const topicId = validTopicId(query.topicId);
  if (topicId === null) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'topicId 只允许 T1–T8 或 FREE', { gotParams: JSON.stringify(query) });
  }

  const rows = await itemsRepo.listFavoritedItems(topicId, limit);
  const data = rows.map(shapeItem);
  return sendOK(res, { items: data, count: data.length });
}

/* ---------- 七、HTTP 服务 ---------- */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return '';
  return String(fwd).split(',')[0].trim();
}

/* 错误分类：Day 18 起改用 httpdb.classify ——
   识别方式从「pg 驱动的 err.code（ECONNREFUSED 等）」换成
   「响应体里的 PostgreSQL 错误码（23505 / 23514 / …）与 HTTP 状态」，
   因为现在不再有 pg 驱动。

   ★ 保留原意不变：`tcb fn log` 对 HTTP 函数查不到调用日志
     （返回 No invocation logs），等于没有排错入口——
     所以根因必须写进响应的 error.code，不依赖日志就能定位问题。 */
function classifyDbError(err) {
  return db.classify(err);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const qs = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : '';
  const query = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      const v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      query[k] = v;
    }
  }

  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 GET');
  }

  /* 路径容错：同时认带/不带 /api 前缀的多种写法。
     ★ Day 17 实测踩到的坑（接在 Day 15 之后）：
       Day 15 网关只剥掉 /api 前缀 → 函数收到 /health
       Day 17 试 enablePathTransmission=false 时，**整段路径被剥光** →
                请求 /api/sessions 到达函数时 req.url 是 "/"，gotPath:"/"
     证据都是响应里的 gotPath 字段（契约 §1.5 那个字段两次救场）。
     修法在网关侧：给每条路由开 enablePathTransmission（见 cloudbaserc.json
     的 gateway.routes），让路径原样透传，函数才分得出是哪个接口。
     函数端仍保留全部写法做双保险——万一哪天网关配置又变了。*/
  const norm = path.replace(/\/+$/, '') || '/';

  const routes = {
    '/api/sessions': handleSessions,
    '/sessions': handleSessions,
    '/api/favorites': handleFavorites,
    '/favorites': handleFavorites,
    '/api/items/favorites': handleFavorites,   // 契约 §6.1 R4 的「只看收藏」写法
    '/items/favorites': handleFavorites
  };

  const handler = routes[norm];
  if (!handler) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：GET /api/sessions 与 GET /api/favorites',
      { gotPath: path });
  }

  handler(query, res).catch((err) => {
    // 业务错误统一在这里兜住，返回 200 + ok:false（契约 §1.4）：
    // 前端只需判断 ok，不必区分「网络失败」与「业务失败」。
    // **错误详情只进日志**，不进响应体——不暴露连接串、表名给公网。
    // 但**根因分类**要进 error.code（见 classifyDbError 的注释）。
    console.error('[read] 处理 ' + path + ' 失败：', err && err.stack ? err.stack : err);
    const kind = classifyDbError(err);
    sendError(res, 200, kind.code, kind.message);
  });

  console.log('[read] ' + req.method + ' ' + norm + ' from ' + clientIp(req));
});

/* 端口 9000 + 0.0.0.0：CloudBase HTTP 云函数只认这个（Day 15 踩过）。 */
server.listen(9000, '0.0.0.0', () => {
  console.log('[read] listening on 0.0.0.0:9000');
  console.log('[read] routes: GET /api/sessions · GET /api/favorites');
  console.log('[read] db: ' + (process.env.PGHOST ? 'env 已配置' : 'env 未配置（会连不上）'));
});

/* 优雅退出：让连接池有机会收干净，不留挂起的 socket。 */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
