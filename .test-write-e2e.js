/* 端到端自测：在本地把 write/index.js 起成真HTTP 服务，发真请求。
   -------------------------------------------------------------
   为什么单测不够：.test-write.js 只验纯函数（校验与硬约束），
   **路由、外壳、三步写入顺序、补偿删除、防重复这五件事一个都没跑过**。
   纯函数全绿但接口 404、或者补偿没触发，是完全可能发生的。

   ★★ Day 18 改造：假 pg 已改成假 httpdb。
     原来替换 require('pg')，现在替换 require('../httpdb') ——
     **被测代码换数据访问层时，测试的替换点必须跟着换**，
     否则测试会「因为找不到 require('pg')」直接退出，
     看起来像测试坏了，其实是它没跟上代码的变化。

   为什么不用真数据库：那些是真库，但要验证的是「接口行为对不对」，
   而不是「PG 怎么响应」。把 httpdb 换成假的，可以精确制造三种失败：
     · 第 2 步（turns）失败→ 验补偿删除有没有真的发生
     · sessions 主键冲突     → 验防重复分支
     · items 违反 CHECK      → 验 23514 被翻译成中文
   ★ 真库那一层由 .probe-httpapi.js 与 tcb db execute 负责（板块③）。

   怎么跑：node .test-write-e2e.js   （退出码 0 = 全通过） */

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/* ---------- 一、假 httpdb ---------- */
/* ★ 跨进程只能靠文件（Day 18 踩出来的）：
     服务是 spawn 出去的子进程，读不到测试进程的 global。
   所以：
     · 被调用的每一次（表名 + 参数）由子进程写进record 文件，测试进程读回来验
     · 「让哪一步失败」用指令文件下发，读完即删（这样下一批不受影响）

   ★★ 失败注入的设计与 Day 17 的 pg 版不同，原因是本环境没有跨请求事务：
     现在是「sessions → turns → items」三步，补偿靠 DELETE sessions。
     所以失败点要能精确落在**第几步**，才能验「补偿有没有真的发生」。
     指令格式就是表名：'sessions' / 'turns' / 'items'。 */
const recorderPath = path.join(__dirname, '.fake-pg-calls.json');
const failDirectivePath = path.join(__dirname, '.fake-pg-fail.txt');

const calls = [];           // 测试进程侧的镜像（从 record 文件读回来）
let failTable = null;       // 下次调用这张表时抛错

function makeFakeHttpDbModule() {
  return [
    "const fs = require('fs');",
    "const REC = " + JSON.stringify(recorderPath) + ";",
    "const FAIL = " + JSON.stringify(failDirectivePath) + ";",
    "function rec(entry) {",
    "  let all = [];",
    "  try { all = JSON.parse(fs.readFileSync(REC, 'utf8')); } catch (e) { all = []; }",
    "  all.push(entry);",
    "  fs.writeFileSync(REC, JSON.stringify(all));",
    "}",
    /* 读指令文件：本次该让哪张表的插入失败。读完即删，
       这样同一批里的后续行不受影响。 */
    "function takeFail(table) {",
    "  let v = '';",
    "  try { v = fs.readFileSync(FAIL, 'utf8').trim(); } catch (e) { v = ''; }",
    "  if (v !== table) return '';",
    "  try { fs.unlinkSync(FAIL); } catch (e) {}",
    "  return v;",
    "}",
    "function dbErr(code, message) {",
    "  const e = new Error(message);",
    "  e.code = code;",
    "  return e;",
    "}",
    "class DbError extends Error {",
    "  constructor(code, message, status) {",
    "    super(message);",
    "    this.code = code;",
    "    this.dbHttpStatus = status || 0;",
    "  }",
    "}",
    "module.exports = {",
    "  DbError: DbError,",
    "  isConfigured: function () { return true; },",
    "  describe: function () { return 'fake-httpdb（本地自测）'; },",
    /* select：只测试里够用（write 用不到） */
    "  select: function (table, query, cols) {",
    "    rec({ op: 'select', table: table, query: query, cols: cols });",
    "    return Promise.resolve([]);",
    "  },",
    "  execSql: function (sql) { rec({ op: 'exec', sql: sql }); return Promise.resolve([]); },",
    "  insertMany: function (table, rows) {",
    "    rec({ op: 'insert', table: table, rows: rows, rowCount: rows.length });",
    "    if (takeFail(table) === table) {",
    /* 三种失败各自对应真实库里会遇到的错误（实测原��见 .probe-httpapi.js） */
    "      if (table === 'sessions') {",
    "        return Promise.reject(new DbError('DUPLICATE', '这个已被映射过', 400));",
    "      }",
    "      if (table === 'turns') {",
    "        return Promise.reject(new DbError('DB_QUERY_FAILED', '插入 turns 失败', 400));",
    "      }",
    "      return Promise.reject(new DbError('INVALID_PARAMS',",
    "        '数据不符合入库口径：逻辑错误必须有改法，偏题与精彩句子不能有', 400));",
    "    }",
    "    return Promise.resolve({ affected: rows.length });",
    "  },",
    "  deleteWhere: function (table, query) {",
    "    rec({ op: 'delete', table: table, query: query });",
    "    return Promise.resolve({ affected: 1 });",
    "  },",
    /* 复用真实的分类器逻辑太麻烦，这里给一份够用的——
       真正的分类器由 .test-write.js 的结构性检查与线上 curl 验。 */
    "  classify: function (err) {",
    "    const m = String((err && err.message) || err || '');",
    "    const code = (err && err.code) ? String(err.code) : '';",
    "    if (code === 'DUPLICATE' || /23505|duplicate key|unique constraint/i.test(m)) {",
    "      return { code: 'DUPLICATE', message: '这场对话已经存过了（同一个 sessionId 只能存一次）' };",
    "    }",
    "    if (/23514|violates check constraint/i.test(m) || code === 'INVALID_PARAMS') {",
    "      if (/ck_items_correction/.test(m)) {",
    "        return { code: 'INVALID_PARAMS', message: '数据不符合入库口径：逻辑错误必须有改法，偏题与精彩句子不能有' };",
    "      }",
    "      return { code: 'INVALID_PARAMS', message: '数据不符合入库口径' };",
    "    }",
    "    return { code: 'DB_QUERY_FAILED', message: '写数据库时出错' };",
    "  }",
    "};"
  ].join('\n');
}

function syncCalls() {
  calls.length = 0;
  let all = [];
  try { all = JSON.parse(fs.readFileSync(recorderPath, 'utf8')); } catch (e) { all = []; }
  all.forEach(function (c) { calls.push(c); });
}
function resetCalls() {
  try { fs.unlinkSync(recorderPath); } catch (e) {}
  calls.length = 0;
}
function armFail(table) {
  try { fs.unlinkSync(failDirectivePath); } catch (e) {}
  fs.writeFileSync(failDirectivePath, table);
}
function disarmFail() {
  try { fs.unlinkSync(failDirectivePath); } catch (e) {}
}

/* 按 op 过滤调用记录 */
function callsOf(op, table) {
  return calls.filter(function (c) {
    return c.op === op && (!table || c.table === table);
  });
}

/* ---------- 二、准备临时副本（生产文件一个字不动）---------- */
/* 做法：把真httpdb 换成假模块。两种更差的做法：
     · 改index.js 加 if (process.env.FAKE_PG) 分支→ 生产代码里留测试专用分支
     · 在 index.js 挂 module.exports → 与其余四个云函数结构不一致

   ★★ Day 19 改法（原来是把 index.js 复制到仓库根 + 把require('./httpdb')
     替换成绝对路径，那套现在不够用了）：
     index.js 从 Day 19 起多了 require('./repositories/xxxRepository')，
     而副本放在仓库根 —— './repositories/' 在那里不存在，
     子进程会直接 MODULE_NOT_FOUND 起不来。
     逐个把 require 换成绝对路径能救，但那是**四处require 都要记得改**，
     少改一处就变成「测的是真库、以为测的是假库」，而且症状很难看。

     现在的做法：**把整个函数目录按原样复制到临时目录**，
     只把假 httpdb 覆盖到同名路径上（index.js 与 repositories/ 一个字不改）。
     这样 require 路径在副本里仍然成立，模块加载图与线上一致——
     「测的东西和跑的东西是同一份代码」这条比什么都重要。 */
const target = path.join(__dirname, 'cloudfunctions', 'write', 'index.js');
const writeDir = path.join(__dirname, 'cloudfunctions', 'write');
const original = fs.readFileSync(target, 'utf8');
if (!/require\('\.\/httpdb'\)/.test(original)) {
  console.error("没找到 require('./httpdb')，index.js 结构变了？");
  process.exit(1);
}
/* ★ Day 19：结构性前提。index.js 必须 require 三个 repository，
   否则副本里的 repositories/ 是死代码，测的就不是分层后的代码了。 */
['sessionsRepository', 'turnsRepository', 'itemsRepository'].forEach(function (n) {
  if (original.indexOf("./repositories/" + n) < 0) {
    console.error('index.js 里没有 require ./repositories/' + n + '，Day 19 的分层被撤销了？');
    process.exit(1);
  }
});
if (!fs.existsSync(path.join(writeDir, 'repositories'))) {
  console.error('cloudfunctions/write/repositories 不存在，分层结构没了？');
  process.exit(1);
}
if (!/server\.listen\(9000, '0\.0\.0\.0'/.test(original)) {
  console.error('没找到 server.listen(9000, ...)，端口约定变了？');
  process.exit(1);
}

const fakeDbPath = path.join(__dirname, '.fake-httpdb-for-e2e.js');
fs.writeFileSync(fakeDbPath, makeFakeHttpDbModule());

/* ★★ Day 19：副本目录（把整个 write 函数目录按原样搬过来）。
   目录结构与线上一致：
     .write-e2e-fn/
       index.js← 只改端口，其余一字不改
       httpdb.js                ← **假模块**（覆盖真httpdb）
       repositories/
         sessionsRepository.js  ← 一字不改
         turnsRepository.js     ← 一字不改
         itemsRepository.js     ← 一字不改
   ★ 为什么假 httpdb 放在副本目录里、而不是让 repository 去 require 绝对路径：
     require('../httpdb') 在副本里正好解析到它 —— 路径不用改一个字。
     Day 19 之前的老做法是把 index.js 的 require 换成绝对路径，
     拆出 repositories/ 之后那样要改四处 require，漏一处就悄悄测错东西。 */
const FN_COPY_DIR = path.join(__dirname, '.write-e2e-fn');
const FN_COPY_REPO = path.join(FN_COPY_DIR, 'repositories');

/* 把 write 函数目录复制到 .write-e2e-fn/，只覆盖 httpdb.js 为假模块。 */
function buildFnCopy(port) {
  fs.rmSync(FN_COPY_DIR, { recursive: true, force: true });
  fs.mkdirSync(FN_COPY_REPO, { recursive: true });
  /* index.js：只改端口。★ 不改任何 require —— 副本目录结构与原目录相同。 */
  fs.writeFileSync(path.join(FN_COPY_DIR, 'index.js'),
    original.replace(/server\.listen\(9000, '0\.0\.0\.0'/, "server.listen(" + port + ", '0.0.0.0'"));
  /* httpdb.js：真身被假模块覆盖。 */
  fs.copyFileSync(fakeDbPath, path.join(FN_COPY_DIR, 'httpdb.js'));
  /* repositories/：逐个字照抄。 */
  fs.readdirSync(path.join(writeDir, 'repositories')).forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    fs.copyFileSync(path.join(writeDir, 'repositories', f), path.join(FN_COPY_REPO, f));
  });
  return path.join(FN_COPY_DIR, 'index.js');
}

/* ---------- 三、端口 ----------
   ★ 9000 不能改：index.js 里写死 0.0.0.0:9000 是 CloudBase 的硬约定
     （Day 15 踩过：写 127.0.0.1 本地能测、线上全挂）。
     端口替换只发生在临时副本上。若 9000 已被别的进程占用
     （本机可能起了别的云函数本地实例），退到备用端口。 */
const REAL_PORT = 9000;
const ALT_PORT = 9123;

function portFree(p) {
  return new Promise(function (resolve) {
    const s = net.createServer();
    s.once('error', function () { resolve(false); });
    s.once('listening', function () { s.close(function () { resolve(true); }); });
    s.listen(p, '127.0.0.1');
  });
}

/* 端口上已经有东西在监听 —— 用于等服务起来。
   用「连一下再断开」判断，而不是看子进程退出码（理由见引导处那行注释）。 */
function portInUse(p) {
  return new Promise(function (resolve) {
    const sock = net.connect({ port: p, host: '127.0.0.1' });
    sock.once('connect', function () { sock.destroy(); resolve(true); });
    sock.once('error', function () { resolve(false); });
    setTimeout(function () { sock.destroy(); resolve(false); }, 800);
  });
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '← ' + extra : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }
function raw(r) { return r && r.raw ? r.raw : JSON.stringify(r); }

/* 一份合法请求，后面在它身上改 */
function goodBody() {
  return {
    sessionId: 'S-TEST-001',
    topicId: 'T1',
    nickname: '小陈',
    startedAt: '2026-10-07T20:11:16+08:00',
    endedAt: '2026-10-07T20:14:20+08:00',
    isComplete: true,
    transcript: [
      { turn: 1, userText: "We're two days behind on the API.", aiText: 'Which part exactly?' },
      { turn: 2, userText: 'The backend part.', aiText: 'Finish it by when?' }
    ],
    items: [
      { turn: 2, type: 'logic', reminder: '前后不一致', correction: 'The backend part is two days behind.' }
    ]
  };
}

let child = null;
let childLog = [];
let port = REAL_PORT;

function send(body, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: port, path: opts.path || '/api/sessions/write',
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { /* 非 JSON 留 null */ }
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on('error', function (e) { resolve({ status: 0, body: null, raw: String(e.message) }); });
    req.end(payload);
  });
}

function cleanup() {
  [fakeDbPath, recorderPath, failDirectivePath].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) {}
  });
  /* ★★ Day 19：副本现在是**一个目录**（原来是一个文件 patchedPath），
     所以清理要用 rmSync 递归删；漏掉的话 .write-e2e-fn/ 会留在仓库里，
     下次跑时 buildFnCopy 虽然会先 rmSync 重建，但 git status 会脏。 */
  try { fs.rmSync(FN_COPY_DIR, { recursive: true, force: true }); } catch (e) {}
  if (child) { try { child.kill(); } catch (e) {} }
}

/* ---------- 四、全部用例 ---------- */
async function runAll() {
  /* ===== 路由与外壳 ===== */
  section('路由与响应外壳');

  resetCalls();
  let r = await send(goodBody());
  syncCalls();
  ok('POST /api/sessions/write 返回 200', r.status === 200, r.status + ' ' + raw(r));
  ok('外壳是 {ok,data,error}，成功时 error=null',
    r.body && r.body.ok === true && r.body.error === null && !!r.body.data, raw(r));
  ok('sessionId 回显请求方传的值（幂等键语义）',
    r.body.data.session.sessionId === 'S-TEST-001', raw(r));
  ok('★ 时长在后端算出 = 184 秒（不是收前端传的）',
    r.body.data.session.durationSeconds === 184, raw(r));
  ok('★ turnCount 由 transcript 长度算出 = 2',
    r.body.data.session.turnCount === 2, raw(r));
  ok('★ errorCount 由 items 算出（1 条 logic）',
    r.body.data.session.errorCount === 1, raw(r));
  ok('时间出口带 +08:00',
    r.body.data.session.startedAt === '2026-10-07T20:11:16+08:00', raw(r));

  section('三步写入（Day 18：无跨请求事务，靠批次原子 + 补偿删除）');
  const inserts = callsOf('insert');
  ok('三步按 sessions → turns → items 顺序（父表必须先插，否则子表撞外键）',
    JSON.stringify(inserts.map(function (c) { return c.table; })) ===
    JSON.stringify(['sessions', 'turns', 'items']),
    inserts.map(function (c) { return c.table; }).join(' → '));
  ok('★ 每表只发一次请求（不是每行一次）—— 靠这个才可能补偿',
    inserts.length === 3, inserts.length + ' 次');
  ok('★ sessions 是单行（一场就是一行）', callsOf('insert', 'sessions')[0].rowCount === 1);
  ok('★ turns 整个数组一次插完（实测一次能插 10 行）',
    callsOf('insert', 'turns')[0].rowCount === 2,
    callsOf('insert', 'turns')[0].rowCount + ' 行');
  ok('每行参数逐个列出，不拼字符串',
    callsOf('insert', 'turns')[0].rows[0].user_text === "We're two days behind on the API." &&
    callsOf('insert', 'turns')[0].rows[0].ai_text === 'Which part exactly?',
    JSON.stringify(callsOf('insert', 'turns')[0].rows[0]));
  ok('★ items 的 original_text 取自 transcript 那一轮的原句（B8）',
    callsOf('insert', 'items')[0].rows[0].original_text ===
    callsOf('insert', 'turns')[0].rows[1].user_text,
    'items.original_text=' + callsOf('insert', 'items')[0].rows[0].original_text
    + ' 但 turns 第2 轮 user_text=' + callsOf('insert', 'turns')[0].rows[1].user_text);
  ok('★ items 不带 is_favorited/note/favorited_at（走 DEFAULT，ck_items_favtime 天然成立）',
    callsOf('insert', 'items')[0].rows[0].is_favorited === undefined &&
    callsOf('insert', 'items')[0].rows[0].note === undefined &&
    callsOf('insert', 'items')[0].rows[0].favorited_at === undefined);
  ok('★ 没有 deleteWhere（成功路径不该有补偿）', callsOf('delete').length === 0,
    JSON.stringify(callsOf('delete')));

  /* ===== 用例 2：重复提交（同 sessionId 第二次）===== */
  section('用例 2：重复提交（同 sessionId 第二次）');
  resetCalls();
  armFail('sessions');
  r = await send(goodBody());
  disarmFail();
  syncCalls();
  ok('返回 400（不是 200）—— 同一条记录提交两次是请求本身错了',
    r.status === 400, r.status + ' ' + raw(r));
  ok('error.code = DUPLICATE', r.body.error.code === 'DUPLICATE', raw(r));
  ok('★ message 是中文且说清已存在', /已经存过/.test(r.body.error.message), r.body.error.message);
  ok('失败时 data 恒为 null', r.body.data === null, raw(r));
  ok('★ 第一步就失败 → 后两步根本没发起（不会有半场数据）',
    callsOf('insert').length === 1, JSON.stringify(callsOf('insert').map(function (c) { return c.table; })));
  ok('★ 第一步失败不需要补偿（库里本来就什么都没有）',
    callsOf('delete').length === 0, JSON.stringify(callsOf('delete')));

  /* ===== 用例 2b：第二步失败 → 补偿删除必须真的发生 ===== */
  section('★ 补偿删除（第 2 步失败时）');
  resetCalls();
  armFail('turns');
  r = await send(goodBody());
  disarmFail();
  syncCalls();
  ok('turns 失败 → 不返回成功', r.body.ok === false, raw(r));
  ok('★ 补上了 DELETE sessions（补偿）',
    callsOf('delete').length === 1, JSON.stringify(callsOf('delete')));
  ok('★ 删的是父表 sessions（靠 CASCADE 连带删已插的 turns）',
    callsOf('delete')[0] && callsOf('delete')[0].table === 'sessions');
  ok('★ 删除条件带上刚插的 sessionId（不能误删别的）',
    callsOf('delete')[0] && callsOf('delete')[0].query.session_id === 'eq.S-TEST-001',
    JSON.stringify(callsOf('delete')[0] && callsOf('delete')[0].query));
  ok('★ 第 3 步（items）没有发起（父行已不存在，发了必撞外键）',
    callsOf('insert', 'items').length === 0);

  /* ===== 用例 2c：第三步失败 → 同样要补偿 ===== */
  section('★ 补偿删除（第 3 步失败时）');
  resetCalls();
  armFail('items');
  r = await send(goodBody());
  disarmFail();
  syncCalls();
  ok('items 失败 → 不返回成功', r.body.ok === false, raw(r));
  ok('★ 也补上了 DELETE sessions',
    callsOf('delete').length === 1, JSON.stringify(callsOf('delete')));
  ok('★ 且 23514 被翻译成中文口径说明（不是把 PG 英文报错透出去）',
    /入库口径/.test(r.body.error.message) && !/violates check/.test(r.body.error.message),
    r.body.error.message);

  /* ===== 用例 3：缺必填字段 ===== */
  section('用例 3：缺必填字段');
  for (const field of ['topicId', 'startedAt', 'transcript']) {
    resetCalls();
    const b = goodBody();
    delete b[field];
    const res = await send(b);
    syncCalls();
    ok('缺 ' + field + ' → 400 + INVALID_PARAMS',
      res.status === 400 && res.body.error.code === 'INVALID_PARAMS', res.status + ' ' + raw(res));
    ok('缺 ' + field + ' 的提示是中文且点名该字段',
      res.body.error.message.indexOf(field) >= 0 && /[一-龥]/.test(res.body.error.message),
      res.body.error.message);
    ok('缺 ' + field + ' 时一条 INSERT 都没执行（校验在写库之前）',
      calls.filter(function (c) { return /INSERT INTO/.test(c.sql); }).length === 0,
      calls.filter(function (c) { return /INSERT INTO/.test(c.sql); }).length + ' 条');
  }

  /* ===== B6 中途退出===== */
  section('B6 中途退出的场次');
  resetCalls();
  const b = goodBody();
  b.endedAt = undefined; b.isComplete = false;
  r = await send(b);
  syncCalls();
  ok('isComplete=false 且无 endedAt → 200', r.status === 200, raw(r));
  ok('endedAt 回显 null（不是空串、不是 "null"）',
    r.body.data.session.endedAt === null, raw(r));
  ok('aborted 被标为 true', r.body.data.session.aborted === true, raw(r));
  ok('★ 入库的 ended_at 是真 NULL 而非空串',
    callsOf('insert', 'sessions')[0].rows[0].ended_at === null,
    JSON.stringify(callsOf('insert', 'sessions')[0].rows[0].ended_at));
  ok('★ 入库的 is_complete 是 false',
    callsOf('insert', 'sessions')[0].rows[0].is_complete === false);

  /* isComplete 与 endedAt 不自洽要拦住（否则靠数据库报错，英文） */
  resetCalls();
  const b2 = goodBody(); b2.isComplete = true; delete b2.endedAt;
  r = await send(b2);
  ok('isComplete=true 却没 endedAt → 400 且中文说清怎么改',
    r.status === 400 && /中途退出/.test(r.body.error.message), r.status + ' ' + raw(r));
  const b3 = goodBody(); b3.isComplete = false;
  r = await send(b3);
  ok('有 endedAt 却说 isComplete=false → 400', r.status === 400, r.status + ' ' + raw(r));

  /* ===== CHECK 约束冲突的分类 ===== */
  section('CHECK 约束冲突的分类（23514）');
  /* ★ 这里必须自己发一次请求：上一节的 r 是「第 3 步失败」那个，
     但中间又跑了两次校验请求，r 已被覆盖。 */
  resetCalls();
  armFail('items');
  const rChk = await send(goodBody());
  disarmFail();
  syncCalls();
  r = rChk;
  ok('23514 被翻译成中文口径说明，没把数据库英文报错透出去',
    /入库口径|改法/.test(r.body.error.message) && !/violates check/.test(r.body.error.message),
    r.body.error.message);
  ok('且落到能定位的码上',
    ['DB_QUERY_FAILED', 'INVALID_PARAMS'].indexOf(r.body.error.code) >= 0, r.body.error.code);

  /* ===== 方法与路径 ===== */
  section('方法与路径');
  r = await send(goodBody(), { method: 'GET' });
  ok('GET → 405 METHOD_NOT_ALLOWED',
    r.status === 405 && r.body.error.code === 'METHOD_NOT_ALLOWED', r.status + ' ' + raw(r));
  /*★ Day 22：这条判据原来断的是「message 里有 GET /api/sessions」——
     那句话原来住在 405 的文案里（那时这条路径只挂 POST，所以能写
     「本接口只接受 POST，读取要走 GET /api/sessions」）。
     今天三个方法共用这条路径，405 改成**列出允许哪几个方法**
     （契约 §1.5「回显我实际收到了什么」的同一条思路），
     于是这句「读取要走…」挪到了 404 的文案里。

     ★ 教训（和 .test-modify.js 那两条同源）：**断言行为，不要断言旧文案**。
       判据改成「把这条路径支持的方法都列出来了」——
       它对文案措辞免疫，而且换个方法没被列出来时会真的失败。 */
  ok('405 的提示列出了这条路径支持的全部方法',
    /POST/.test(r.body.error.message) &&
    /PATCH/.test(r.body.error.message) &&
    /DELETE/.test(r.body.error.message),
    r.body.error.message);
  ok('★ 4xx 响应带 gotPath（契约 §1.5 排错字段）', r.body.gotPath === '/api/sessions/write', raw(r));

  r = await send('{"topicId":"T1",');
  ok('非法 JSON → 400 INVALID_JSON',
    r.status === 400 && r.body.error.code === 'INVALID_JSON', r.status + ' ' + raw(r));
  ok('非法 JSON 的提示是中文',
    /JSON/.test(r.body.error.message) && /[一-龥]/.test(r.body.error.message), r.body.error.message);

  r = await send(goodBody(), { path: '/sessions/write' });
  ok('路径不带 /api 前缀也认（网关剥过前缀的保险）', r.status === 200, r.status + ' ' + raw(r));

  r = await send({}, { path: '/api/nothing' });
  ok('路径不对 → 404 NOT_FOUND',
    r.status === 404 && /NOT_FOUND/.test(r.raw), r.status + ' ' + r.raw);

  /* ★ 这条是 Day 18 才发现的硬约束，值得钉住：
     /api/sessions 是 read 的（GET），写入只能走 /api/sessions/write。
     哪天有人图省事把路径改回去，这里会红。 */
  r = await send(goodBody(), { path: '/api/sessions' });
  ok('★ 打 /api/sessions（read 的地盘）本函数不接，返回 404 而不是误处理',
    r.status === 404 && /NOT_FOUND/.test(r.raw), r.status + ' ' + r.raw);
  ok('★ 404 的提示说清本函数只提供 /api/sessions/write',
    /\/api\/sessions\/write/.test(r.raw), r.raw);

  /* ===== FREE 模式：丢弃偏题，错误次数只算逻辑错误 ===== */
  section('FREE 模式（契约 §9.8 第 3 条）');
  resetCalls();
  const bFree = goodBody();
  bFree.topicId = 'FREE';
  bFree.items = [
    { turn: 1, type: 'offtopic', reminder: '偏题' },
    { turn: 2, type: 'logic', reminder: '前后不一致', correction: '改一下。' },
    { turn: 2, type: 'good', reminder: '说清楚了' }
  ];
  r = await send(bFree);
  syncCalls();
  ok('FREE 下偏题条目被丢弃（itemsStored 不含它）',
    r.body.data.itemsStored === 2 && r.body.data.itemsDropped === 1, raw(r));
  ok('★ errorCount 只由逻辑错误算（1），偏题与精彩句子都不计入',
    r.body.data.session.errorCount === 1, raw(r));
  ok('★ goodSentenceCount 只数 good（1）',
    r.body.data.session.goodSentenceCount === 1, raw(r));
  ok('库里的偏题原句根本没被插进去',
    callsOf('insert', 'items')[0].rowCount === 2,
    '实际插了 ' + callsOf('insert', 'items')[0].rowCount + ' 条（偏题那条应被丢弃）');

  /* ===== 空 userText 的轮次能存（PRD §6.6 自由对话 AI 先开口）===== */
  section('自由对话：用户那轮是空的');
  resetCalls();
  const bEmpty = goodBody();
  bEmpty.topicId = 'FREE';
  bEmpty.transcript = [{ turn: 1, userText: '', aiText: 'How about now? Tell me about your day.' }];
  bEmpty.items = [];
  r = await send(bEmpty);
  syncCalls();
  ok('用户没说话的轮次能存进去（Day 19 转写配对那个坑的同一批数据）',
    r.status === 200 && r.body.data.turnsStored === 1, r.status + ' ' + raw(r));
  ok('★ 入库的是空串而不是 NULL（库里 user_text NOT NULL）',
    callsOf('insert', 'turns')[0].rows[0].user_text === '',
    '实际 user_text=' + JSON.stringify(callsOf('insert', 'turns')[0].rows[0].user_text));

  /* ===== 排错日志（余力加练）===== */
  section('排错日志');
  const logText = childLog.join('');
  /* ★ Day 22：判据原来钉的是「route: POST /api/sessions/write」这一句措辞，
     今天启动日志改成「三条路由共用一条路径」+ 分行列出三个方法，措辞就不匹配了
     ——但代码完全正常。**断言意图（三个方法都报了）不断言措辞。 */
  ok('启动时打印了路由与三条硬约束',
    /POST/.test(logText) && /PATCH/.test(logText) && /DELETE/.test(logText) &&
    /B8/.test(logText) && /DUPLICATE/.test(logText),
    logText.split('\n').filter(function (l) { return /route|\/api\//.test(l); }).slice(0, 5).join(' | '));
  ok('★ 每个请求打一行，含方法、路径、状态码、耗时',
    /\[write\] POST \/api\/sessions\/write from .* → 200 \d+ms/.test(logText),
    logText.split('\n').filter(function (l) { return /\[write\] POST/.test(l); }).slice(-1)[0]);
  ok('★ 日志里没有请求体内容（会带用户原句与昵称）',
    !/We're two days behind/.test(logText));
  /* 判据只看「有没有泄露敏感信息」，**不钉具体措辞** ——
   措辞会随假模块/真模块不同而变（真httpdb 说「env=已配置 / apiKey=已配置」，
   假模块说「fake-httpdb（本地自测）」），钉措辞会让测试因无关原因变红。 */
  ok('★ 启动时如实说明 db 状态，且不泄露连接串或 Key',
    /\[write\] db: .+/.test(logText) &&
    !/postgres:\/\//.test(logText) &&
    !/Bearer /.test(logText) &&
    !/eyJ[A-Za-z0-9_-]{20,}/.test(logText),
    (logText.split('\n').filter(function (l) { return /\[write\] db:/.test(l); })[0] || '(没这行)'));
  ok('★ 启动时说明了落库方式（三步 + 补偿）',
    /每表一次请求/.test(logText),
    (logText.split('\n').filter(function (l) { return /落库方式/.test(l); })[0] || ''));

  /* ===== 数据访问层改造后的结构性检查 =====
     ★ 这几条是今天改造的核心约定，靠人记不住，必须钉在这里。
       哪天有人「顺手把 BEGIN/COMMIT 加回来」会立刻红 —— 那个写法在本环境无效。 */
  section('★ 数据访问层改造后的结构性约定');
  const codeSrc = fs.readFileSync(target, 'utf8');

  ok('已不再 require pg（体验版无 VPC，直连永远连不上）',
    !/require\('pg'\)/.test(codeSrc), 'index.js 里还有 pg');
  ok('★ 用共享的 httpdb 层', /require\('\.\/httpdb'\)/.test(codeSrc));
  ok('★ 错误分类走 db.classify（分类器只有一套，不能分叉）',
    /const kind = db\.classify\(err\);/.test(codeSrc));
  /* ★ 判据要**剥掉注释**再看 —— 这些词在注释里正当出现
     （我自己在注释里就写了「不再有 BEGIN / COMMIT」），
     直接全文搜会永远为真，测试就废了。 */
  const codeOnly = codeSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')   /* 块注释 */
    .replace(/\/\/.*$/gm,'');              /* 行注释 */
  ok('★ 代码里（不含注释）不再有 BEGIN / COMMIT（本环境跨请求事务无效）',
    !/\bBEGIN\b/.test(codeOnly) && !/\bCOMMIT\b/.test(codeOnly),
    '代码里出现了 BEGIN/COMMIT —— 在本环境它是无效的，ROLLBACK 不会真正回滚');
  ok('★ 代码里（不含注释）不再有 pool.end（HTTP API 没有连接池）',
    !/pool\./.test(codeOnly), '代码里还有 pool 引用');
  ok('★ 有补偿删除，且第 1 步失败时不补偿',
    /if \(step !== '1\/3 sessions'\)/.test(codeSrc) &&
    /deleteBySessionId/.test(codeSrc));
  /* ★★ Day 19：补偿删除的实现搬进了 repositories/sessionsRepository.js，
     所以「删的是哪张表」这条判据必须**跨文件**验。
     只扫 index.js 会误判成「补偿删除不见了」—— 那是搬迁，不是删除。 */
  const sessionRepoSrc = fs.readFileSync(
    path.join(writeDir, 'repositories', 'sessionsRepository.js'), 'utf8');
  ok('★ 补偿删的是父表 sessions（靠 CASCADE 连带删 turns/items）',
    /db\.deleteWhere\('sessions'/.test(sessionRepoSrc));
  ok('★ 补偿失败不掩盖原始错误（原始错误才是根因）',
    /catch \(e2\)/.test(codeSrc));


  /* 「没配 API Key」场景 —— ★ 这里必须用**真httpdb**，不能用假模块：
       假模块自己实现 describe()，根本不看环境变量，
       用它测「没配 Key」只会测出一个假通过。 */
  section('★ 没配 API Key 时错误码仍然清楚（用真 httpdb 测）');
  const port3 = 9001;
  /* ★★ 副本必须放在 cloudfunctions/write/ 目录里——
     换名后的副本不再有原目录的上下文，require('./httpdb') 会在仓库根找不到模块
     （第一版放在根目录，进程直接 MODULE_NOT_FOUND 起不来）。
     **替换掉文件名的同时，必须一起考虑它的相对路径。**
     ★★ Day 19 追加一条：这个目录现在还必须能解析 './repositories/xxxRepository'——
       它在同一个目录里，所以这一条自动成立（副本与原目录同级）。
       若哪天改成把副本放到别的目录，这条会立刻炸，那正是它该炸的时候。 */
  const patched3Path = path.join(__dirname, 'cloudfunctions', 'write', '.e2e-nokey-copy.js');
  /* 这一份**不替换** httpdb —— 用真的那个，只把端口换掉。
     子进程没有 CLOUDBASE_API_KEY，真 httpdb 就会走「未配置」那条路。 */
  fs.writeFileSync(patched3Path, original.replace(/server\.listen\(9000, '0\.0\.0\.0'/,
    "server.listen(" + port3 + ", '0.0.0.0'"));
  const child3 = spawn(process.execPath, [patched3Path], {
    /* ★ 显式给空值：Object.assign 不会删除继承来的值，必须显式覆盖成'' */
    env: Object.assign({}, process.env, { CLOUDBASE_API_KEY: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const log3 = [];
  child3.stdout.on('data', function (d) { log3.push(String(d)); });
  child3.stderr.on('data', function (d) { log3.push('[stderr] ' + String(d)); });
  let up3 = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(function (r) { setTimeout(r, 100); });
    if (await portInUse(port3)) { up3 = true; break; }
  }
  ok('（第三个进程已起，端口 ' + port3 + '，用真 httpdb 且未配 Key）', up3,
    log3.join('').slice(0, 300));

  const savedPort = port;
  port = port3;
  try {
    const r3 = await send(goodBody());
    ok('★ 没配 Key 时不返回 ok:true',
      r3.body && r3.body.ok === false, r3.status + ' ' + raw(r3));
    ok('★ 错误码能定位（不是 INTERNAL_ERROR 那种一句话糊弄）',
      r3.body && r3.body.error && r3.body.error.code !== 'INTERNAL_ERROR',
      r3.body && r3.body.error ? r3.body.error.code : '(无 error)');
    ok('★ 真 httpdb 的启动日志如实说「未配置」',
      /apiKey=未配置/.test(log3.join('')),
      (log3.join('').split('\n').filter(function (l) { return /db:/.test(l); })[0] || '(没这行)'));
  } finally {
    port = savedPort;
    try { child3.kill(); } catch (e) {}
    try { fs.unlinkSync(patched3Path); } catch (e) {}
  }

  /* ===== 收尾 ===== */
  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(60));
}

/* ---------- 五、引导 ---------- */
(async function () {
  /* ★★ 开头先清一遍残留，不能只在 cleanup 里清。
     Day 18 实测：上一轮如果因为语法错误之类在 cleanup 之前就退出，
     失败指令文件会留在磁盘上下一次运行 —— 于是**第一个请求就命中
     「让 items 失败」**，看起来像代码有 bug，其实是上一次没清干净。
     临时指令文件的正确做法是「进来先清、出去再清」，两头都做。 */
  [recorderPath, failDirectivePath].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) {}
  });

  if (await portFree(REAL_PORT)) { port = REAL_PORT; }
  else if (await portFree(ALT_PORT)) { port = ALT_PORT; }
  else { console.error('9000 与 ' + ALT_PORT + ' 都被占用，无法本地起服务'); process.exit(1); }

  console.log('（本地端口 ' + port + (port === REAL_PORT ? '，与线上一致' : '，9000 被占用，换了备用端口') + '）');

  /* ★★ Day 19：不再把 index.js 复制到仓库根 + 替换 require 路径。
     改成把**整个函数目录**复制到 .write-e2e-fn/，只覆盖 httpdb.js 为假模块。
     理由见 buildFnCopy 上面的注释：require 路径一个字都不用改。 */
  const fnEntry = buildFnCopy(port);

  child = spawn(process.execPath, [fnEntry], {
    env: Object.assign({}, process.env, {
      PGHOST: 'fake', PGDATABASE: 'fake', PGUSER: 'fake', PGPASSWORD: 'fake', PGPORT: '5432'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (d) { childLog.push(String(d)); });
  child.stderr.on('data', function (d) { childLog.push('[stderr] ' + String(d)); });

  /* 等服务真的起来。
     ★ 判断方式必须是「探端口有没有响应」，不能只看 child.exitCode：
       spawn 之后那个字段要等子进程真正退出才有值，起服过程中一直是 null，
       拿它判断会在服务还没起来时就误判成「已退出」然后往下跑
       （第一版就是这么写的，症状是全部用例报 ECONNREFUSED，
         而服务其实活得很好—— 同一个请求手动 curl 是通的）。 */
  let up = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(function (r) { setTimeout(r, 100); });
    if (child.exitCode !== null) {
      console.error('子进程已退出，退出码 ' + child.exitCode + '，日志如下：\n' + childLog.join(''));
      cleanup(); process.exit(1);
    }
    const alive = await portInUse(port);
    if (alive) { up = true; break; }
  }
  if (!up) {
    console.error('等了10 秒端口仍未监听，日志如下：\n' + childLog.join(''));
    cleanup(); process.exit(1);
  }

  try {
    await runAll();
  } catch (e) {
    console.error('自测脚本本身出错：', e);
    console.log(childLog.join(''));
    fail++;
  }
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})();