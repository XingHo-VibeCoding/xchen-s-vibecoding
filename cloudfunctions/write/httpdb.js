/* httpdb.js —— CloudBase PostgreSQL 的 HTTP 访问层（Day 18）
   -------------------------------------------------------------
   ★ 为什么不用 pg 驱动（这是本文件存在的全部理由）：
     本环境包版本是**体验版**，云函数**没有 VPC/内网访问权限**（Day 17 实测，
     社区 issue #1237 同因）。官方能力表写明「云函数 连接腾讯云 VPC」在
     体验版与个人版都是「-」，标准版 ¥199 起，且官方工程师明确
     「直连能力等待后续功能更新后提供」——**没有时间表，社区无一例成功**。
     所以 pg 驱动在这条路上永远连不上，不是配置问题。

   ★ 走哪条路（实测结论见 .probe-httpapi.js，16/0）：
     CloudBase HTTP API 两条端点：
       · PostgREST 风格  /v1/rdb/rest/{table}      —— 读，以及批量写
       · 任意 SQL      /v1/rdb/exec-pgsql         —— 需要管理员凭据
     鉴权用 API Key（service_role），从环境变量 `CLOUDBASE_API_KEY` 读。

   ★★★ 最关键的一条限制：**跨请求的事务不存在**。
     实测 `BEGIN` 与 `ROLLBACK` 分两次 HTTP 调用，ROLLBACK 后那一行还在——
     每次调用是独立连接。所以「多张表在一个事务里写入」在本环境**做不到**。
     替代方案（用户 Day 18 拍板）：**每表一次请求 + 失败时补偿删除**。
     它能成立靠两件事：
       ① 批次内原子性 —— 实测同一批里一行违反 CHECK，整批 0 行落库
       ② ON DELETE CASCADE —— Day 16 建表时就定义在 turns/items 上，
          删父行连带删子行（schema.sql 的 fk_turns_session / fk_items_session）
     补偿若也失败 → 抛错，且**下一次重试会被主键DUPLICATE 挡住**，
     所以不会写出半场数据。

   --------------------------------------------------------------------
   为什么手写 https 而不引 SDK（与 chat / analyze 同一条理由）：
     只调一个 HTTP 接口，零构建、无框架，部署不容易出问题。

   ★ 密钥绝不写死、绝不进代码（与 chat 的 LLM_API_KEY 同规矩）：
     只从环境变量读，且启动日志里只说「已配置 / 未配置」，不打印值。 */

const https = require('https');

const ENV_ID = process.env.CLOUDBASE_ENV_ID || 'cxj1528-d4g55ng0o54cbe296';
const API_KEY = process.env.CLOUDBASE_API_KEY || '';
const HOST = ENV_ID + '.api.tcloudbasegateway.com';

const TIMEOUT_MS = 20000;

/* 两个端点。REST 用于读写表（能批量），EXEC 用于需要管理员权限的场合。 */
const REST_BASE = 'https://' + HOST + '/v1/rdb/rest';
const EXEC_URL = 'https://' + HOST + '/v1/rdb/exec-pgsql';

/* ---------- 对外的错误类型 ----------
   让调用方能区分「参数不对」（400，给用户看）与「库出问题」（200 + ok:false）。
   error.code 用契约 §1.4 那套后端码，不另起命名。 */
class DbError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.dbHttpStatus = httpStatus || 0;
  }
}

/* ---------- 底层 HTTPS 调用 ---------- */
function httpJson(method, urlStr, bodyObj, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const url = new URL(urlStr);
    const payload = bodyObj === undefined || bodyObj === null
      ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const headers = Object.assign({
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Type': 'application/json; charset=utf-8'
    }, extraHeaders || {});
    if (payload) headers['Content-Length'] = payload.length;

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: headers,
      timeout: TIMEOUT_MS
    }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch (e) { /* 非 JSON 留 null */ } }
        resolve({ status: res.statusCode, body: parsed, raw: raw, headers: res.headers || {} });
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new DbError('DB_TIMEOUT', '连数据库超时', 0)); });
    /* 网络层失败统一归到 DB_QUERY_FAILED —— Day 18 已删掉
       DB_HOST_UNREACHABLE 与 DB_CONNECTION_REFUSED：
       走 HTTP API 后没有「PGHOST 解析不了」或「TCP 被拒」这两种情形。 */
    req.on('error', function (e) { reject(new DbError('DB_QUERY_FAILED', '连数据库失败：' + e.message, 0)); });
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------- 把 HTTP 层的失败翻译成契约里的错误码 ----------
   与 read/index.js 原来的 classifyDbError 同一套语义，但识别方式换了：
   原来靠 pg 驱动的 err.code（ECONNREFUSED 等），现在靠
   **响应体里的 PostgreSQL 错误码**（23505 / 23514 / …）与 HTTP 状态。 */
function classify(err) {
  if (err instanceof DbError) return { code: err.code, message: err.message };

  const m = String((err && err.message) || err || '');
  /* 主键/唯一约束冲突 → DUPLICATE。
     实测原���（tcb db execute 撞重复）：
       ERROR: duplicate key value violates unique constraint "pk_sessions" (SQLSTATE 23505) */
  if (/23505|duplicate key|unique constraint/i.test(m)) {
    return { code: 'DUPLICATE', message: '这场对话已经存过了（同一个 sessionId 只能存一次）' };
  }
  /* CHECK 约束 → 说清违反了哪条口径（实测原��：violates check constraint "ck_sessions_endtime"） */
  if (/23514|violates check constraint/i.test(m)) {
    if (/ck_sessions_endtime/.test(m)) {
      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：正常结束必须有结束时间，中途退出则不能有' };
    }
    if (/ck_items_correction/.test(m)) {
      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：逻辑错误必须有改法，偏题与精彩句子不能有' };
    }
    if (/ck_items_favtime/.test(m)) {
      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：收藏状态与收藏时间必须一致' };
    }
    if (/ck_sessions_counts/.test(m)) {
      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：时长与三个计数都不许为负' };
    }
    if (/ck_turns_turn|ck_items_turn/.test(m)) {
      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：轮次从 1 开始' };
    }
    return { code: 'INVALID_PARAMS', message: '数据没通过数据库的入库口径校验' };
  }
  if (/42501|permission denied|row-level security/i.test(m)) {
    return { code: 'DB_AUTH_FAILED', message: '数据库拒绝了这次操作（权限不足或表级授权没配）' };
  }
  if (/42P01|does not exist|relation ".*" does not exist/i.test(m)) {
    return { code: 'DB_TABLE_MISSING', message: '表不存在（建表脚本没在库里执行）' };
  }
  /*403/401：鉴权失败（API Key 没配或填错）—— 这是本部署下最可能的一类库失败 */
  if (/401|403|MISSING_CREDENTIALS|PERMISSION_DENIED/i.test(m)) {
    return { code: 'DB_AUTH_FAILED', message: '数据库拒绝了这次操作（API Key 没配好或无权限）' };
  }
  /*403/401：鉴权失败（API Key 没配或填错）—— 这是本部署下最可能的一类库失败 */
  if (/401|403|MISSING_CREDENTIALS|PERMISSION_DENIED/i.test(m)) {
    return { code: 'DB_AUTH_FAILED', message: '数据库拒绝了这次操作（API Key 没配好或无权限）' };
  }
  if (/40001|deadlock|serialization/i.test(m)) {
    return { code: 'DB_TIMEOUT', message: '数据库忙，请稍后重试' };
  }
  return { code: 'DB_QUERY_FAILED', message: '读写数据库时出错' };
}

/* ---------- 三个对外方法 ---------- */

/* 读：REST 风格查表。
   selectCols 用 snake_case（库里的列名），返回的也是 snake_case 行——
   **映射成 camelCase 是调用方的责任**（与各接口出口那一处保持一致）。 */
async function select(table, query, selectCols) {
  const qs = new URLSearchParams();
  if (selectCols) qs.set('select', selectCols);
  Object.keys(query || {}).forEach(function (k) {
    qs.set(k, String(query[k]));
  });
  /* ★ URLSearchParams 会自动编码。这里显式 set 的是我们自己写的值，
     不会有通配符 —— 清理探针那种「like 忘了编码删光全表」的事故不会再发生。 */
  const r = await httpJson('GET', REST_BASE + '/' + table + '?' + qs.toString(),
    undefined, { 'Prefer': 'count=exact' });
  /* ★ PostgREST 语义：`count=exact` 成功时返回 **206 Partial Content**，
     不是 200。把它当失败会误判成「查不到数据」。 */
  if (r.status === 200 || r.status === 206) {
    return Array.isArray(r.body) ? r.body : [];
  }
  throw buildError(r, table);
}

/* 写：一次插入整个数组（批次内原子 —— 实测一行违规整批不落库）。 */
async function insertMany(table, rows) {
  if (!rows || rows.length === 0) return [];
  const r = await httpJson('POST', REST_BASE + '/' + table, rows,
    { 'Prefer': 'return=minimal' });
  /* 实测：201 Created（成功）；204/200 也可能（取决于是否要返回体） */
  if (r.status === 201 || r.status === 200 || r.status === 204) {
    return { affected: rows.length };
  }
  throw buildError(r, table);
}

/* 补偿删除：删父行，依赖 ON DELETE CASCADE 连带删子行。 */
async function deleteWhere(table, query) {
  const qs = new URLSearchParams();
  Object.keys(query || {}).forEach(function (k) { qs.set(k, String(query[k])); });
  const r = await httpJson('DELETE', REST_BASE + '/' + table + '?' + qs.toString());
  if (r.status === 204 || r.status === 200 || r.status === 404) {
    return { affected: r.headers['content-range'] || '' };
  }
  throw buildError(r, table);
}

/* ---------- 改（Day 22 新增）----------
   ★ 为什么要新加一个方法，而不是拿 execSql 写一条 UPDATE：
     exec-pgsql 需要管理员凭据，而且它一次只能一条语句；
     REST 风格这条是普通的数据操作，与同文件里的 select / insertMany / deleteWhere
     同一类东西 —— 放在一起，接口层不必知道「改」和「增删」走的不是一套机制。

   ★★ 最关键的一条语义差异：**命中 0 行也回 200**。
     PostgREST 不区分「改到了」与「没匹配到」，两者都是 200 + 空体。
     所以**任何依赖「确实改到了」的判断，都必须先 select 查存在性** ——
     拿这个方法的返回值去判断存在性是错的（接口层 handlePatchItem 就是先查后改）。

   patchObj 用库里原样的 snake_case 列名（与 insertMany 一致：
   映射成 camelCase 是调用方的责任，见 select 上方那段注释）。 */
async function patchWhere(table, query, patchObj) {
  const keys = Object.keys(patchObj || {});
  /* 空补丁直接返回，不发请求：PostgREST 收到空 body 会报 400，
     而「没有字段要改」是我们自己的校验层该先拦住的事，不该走到这里。 */
  if (!keys.length) return { affected: 0 };
  const qs = new URLSearchParams();
  Object.keys(query || {}).forEach(function (k) { qs.set(k, String(query[k])); });
  const r = await httpJson('PATCH', REST_BASE + '/' + table + '?' + qs.toString(), patchObj,
    { 'Prefer': 'return=minimal' });
  /* 实测：命中时 200 / 204；命中 0 行同样 200（见上方那段说明） */
  if (r.status === 200 || r.status === 204) {
    return { affected: r.headers['content-range'] || '' };
  }
  throw buildError(r, table);
}

/* 执行任意 SQL（只用于 read/write 之外的运维与排错场景，日常写入不碰它）。 */
async function execSql(sql, parameters) {
  const r = await httpJson('POST', EXEC_URL, {
    sql: sql, parameters: parameters || [], role: 'cloudbase_postgres'
  });
  if (r.status === 200) return r.body;
  throw buildError(r, 'exec-pgsql');
}

/* ---------- 把失败响应变成带错误码的 DbError ---------- */
function buildError(res, table) {
  /* PostgreSQL 的错误原文在 body.message 里；
     实测形如 {"code":"DATABASE_23505","message":"duplicate key value …"} */
  const body = res.body || {};
  const msg = String(body.message || body.error || res.raw || '');
  const kind = classify(new Error(msg));
  const e = new DbError(kind.code, kind.message, res.status);
  /* 把PG 原文挂在 detail 上，只进日志不进响应体 ——
     不把表名、列名、约束名暴露给公网（与 read 原来的做法一致）。 */
  e.detail = msg.slice(0, 500);
  e.table = table;
  return e;
}

function isConfigured() {
  return !!API_KEY;
}

function describe() {
  return 'env=' + (ENV_ID ? '已配置' : '未配置') + ' / apiKey=' + (API_KEY ? '已配置' : '未配置（会连不上）');
}

module.exports = {
  select: select,
  insertMany: insertMany,
  deleteWhere: deleteWhere,
  patchWhere: patchWhere,
  execSql: execSql,
  classify: classify,
  DbError: DbError,
  isConfigured: isConfigured,
  describe: describe,
  /* 导出常量是为了单测能把形状钉住，不只是为了省几行 */
  REST_BASE: REST_BASE,
  EXEC_URL: EXEC_URL
};