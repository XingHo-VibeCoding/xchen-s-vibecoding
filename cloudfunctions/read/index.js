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
const { Pool } = require('pg');

/* ---------- 一、数据库连接池 ----------
   连接信息全部来自环境变量，不写死在代码里（AGENTS.md 第五条 / README 安全约定）。
   连接池放在模块顶层：云函数会复用同一个运行时实例，
   每次请求新建连接会很快把数据库连接数打满。 */
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30000
});

/* 让未处理的 promise 拒绝不至于悄悄杀掉函数。
   没有这两行的话，池里某次查询失败会让云函数静默退出，
   表现是「接口偶发 502 且日志里什么都没有」——最难查的那一类问题。 */
pool.on('error', (err) => {
  console.error('[read] 连接池错误：', err.message);
});

/* ---------- 二、时间字段的统一出口（契约 §9.8 第 5 条）---------- */
/* 库里是 TIMESTAMP（不带时区），按 UTC+8 存、单时区不做换算；
   接口按 ISO 8601 带偏移输出。
   偏移量是**写死的常量**，不是 now() 算出来的，也不用时区库。 */
const TZ_SUFFIX = '+08:00';

/* to_char 已在 SQL 里产出 'YYYY-MM-DDTHH24:MI:SS'，这里只补偏移量。
   null（ended_at 为空 = 中途退出 B6）必须原样返回 null，
   **不能变成 "null" 字符串或空串** —— 前端要靠它判断「这场没正常结束」。 */
function iso(ts) {
  return ts === null || ts === undefined ? null : ts + TZ_SUFFIX;
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

/* ---------- 五、两条 SQL ----------
   查询写snake_case，出口用 AS "camelCase" 映射（契约 §9.8 第 4 条）。
   映射只写在这一处，不散落到各处。 */

/* R1：会话列表。按契约 §6.1 走 idx_sessions_topic_time：
   传 topicId 时走 (topic_id, started_at)，不传时走后一段做倒序扫描。
   started_at 倒序 = 最近的场次在最前面，与记录页的时间倒序口径一致。 */
const SQL_SESSIONS = `
  SELECT
    session_id            AS "sessionId",
    topic_id              AS "topicId",
    nickname,
    to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "startedAt",
    to_char(ended_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS "endedAt",
    duration_seconds      AS "durationSeconds",
    error_count           AS "errorCount",
    good_sentence_count   AS "goodSentenceCount",
    turn_count            AS "turnCount",
    is_complete           AS "isComplete"
  FROM sessions
  WHERE ($1::text IS NULL OR topic_id = $1)
  ORDER BY started_at DESC
  LIMIT $2::int
`;

/* R5 只读侧：收藏列表。走 idx_items_fav (is_favorited, favorited_at)：
   WHERE 里写 is_favorited = TRUE 命中索引前一段，ORDER BY favorited_at 命中后一段。
   ★ 故意不写 is_favorited = TRUE 到 SQL 字符串里，而是当参数传：
     值是参数、形状是固定的，两者分离。 */
const SQL_FAVORITES = `
  SELECT
    item_id       AS "itemId",
    session_id    AS "sessionId",
    topic_id      AS "topicId",
    type,
    turn,
    original_text AS "originalText",
    reminder,
    correction,
    is_favorited  AS "isFavorited",
    note,
    to_char(favorited_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "favoritedAt",
    to_char(created_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS "createdAt"
  FROM items
  WHERE is_favorited = $1::boolean
    AND ($2::text IS NULL OR topic_id = $2)
  ORDER BY favorited_at DESC
  LIMIT $3::int
`;

/* 把sessions 行加工成接口形状：
   -时间补 +08:00
   - 布尔列 PG的 BOOLEAN 出参本来就是 true/false，**不需要转换**（契约 §9.8 第 4 条）
   - 顺手给 B6 一个显式标记：endedAt 为空 = 中途退出 */
function shapeSession(row) {
  return {
    sessionId: row.sessionId,
    topicId: row.topicId,
    nickname: row.nickname === '' ? null : row.nickname,  // 空串 → null，界面自己决定显示「你」
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    durationSeconds: Number(row.durationSeconds),
    errorCount: Number(row.errorCount),
    goodSentenceCount: Number(row.goodSentenceCount),
    turnCount: Number(row.turnCount),
    isComplete: row.isComplete,
    aborted: row.endedAt === null            // B6：中途退出的场次也算数据
  };
}

/* items 行的加工。correction 保持 null（偏题与精彩句子无改法，B7）——
   库里的 ck_items_correction 已经保证过这件事，接口只负责不把它变成空串。 */
function shapeItem(row) {
  return {
    itemId: row.itemId,
    sessionId: row.sessionId,
    topicId: row.topicId,
    type: row.type,
    turn: Number(row.turn),
    originalText: row.originalText,
    reminder: row.reminder,
    correction: row.correction === null ? null : row.correction,
    isFavorited: row.isFavorited,
    note: row.note,
    favoritedAt: iso(row.favoritedAt),
    createdAt: iso(row.createdAt)
  };
}

/* ---------- 六、两个处理函数 ---------- */
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

  // null 传进去表示「不过滤」，PG 里 ($1::text IS NULL OR ...) 短路成恒真
  const result = await pool.query(SQL_SESSIONS, [topicId === undefined ? null : topicId, limit]);
  const data = result.rows.map(shapeSession);
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

  const result = await pool.query(SQL_FAVORITES, [true, topicId === undefined ? null : topicId, limit]);
  const data = result.rows.map(shapeItem);
  return sendOK(res, { items: data, count: data.length });
}

/* ---------- 七、HTTP 服务 ---------- */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return '';
  return String(fwd).split(',')[0].trim();
}

/* 错误分类：把「连不上库」和「连上了但认证失败」分成两种 code。
   ★为什么要分：pg 抛的错五花八门，若一律返回 INTERNAL_ERROR，
     只能靠翻云端日志判断根因——而实测 `tcb fn log` 对 HTTP 函数
     经常查不到调用日志（返回 "No invocation logs"），等于没有排错入口。
     所以把根因分类直接写进响应的 error.code，
     **不依赖日志就能定位问题**。这是 Day 17 新增的一条排错约定。 */
function classifyDbError(err) {
  const m = (err && err.message) ? String(err.message) : String(err);
  const code = (err && err.code) ? String(err.code) : '';

  if (code === 'ENOTFOUND' || /getaddrinfo|ENOTFOUND/i.test(m)) {
    return { code: 'DB_HOST_UNREACHABLE', message: '数据库地址解析不了（PGHOST 不对或内网 DNS 不可用）' };
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED|Connection refused/i.test(m)) {
    return { code: 'DB_CONNECTION_REFUSED', message: '数据库拒绝连接（端口或内网访问不通）' };
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout|Timeout/i.test(m)) {
    return { code: 'DB_TIMEOUT', message: '连数据库超时（常见于内网未打通）' };
  }
  if (/password authentication failed|no pg_hba|SSPI|SASL/i.test(m)) {
    return { code: 'DB_AUTH_FAILED', message: '数据库拒绝了认证（账号或密码不对）' };
  }
  if (/does not exist|relation ".*" does not exist/i.test(m)) {
    return { code: 'DB_TABLE_MISSING', message: '表不存在（建表脚本没在库里执行）' };
  }
  return { code: 'DB_QUERY_FAILED', message: '查询数据库时出错' };
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
    pool.end().then(() => process.exit(0));
  });
}
