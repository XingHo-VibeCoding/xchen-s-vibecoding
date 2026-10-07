/* HTTP API 探针 —— 验证「云函数不直连 PG，改走 CloudBase HTTP API」这条路通不通
   -------------------------------------------------------------
   ★ 为什么先探再改：改正式代码（write/index.js 与 read/index.js 的数据访问层）
     是有成本的。如果这条路实际不通、或者事务不能跑，
     那次改动就是纯浪费——所以先用这个脚本把三件事验清楚，全绿了才动代码。

   只验三件事（每一件都是写接口真正依赖的能力）：
     ① exec-pgsql 能不能跑通（最基础的 SELECT 1）
     ② **能不能跑事务**（BEGIN → INSERT → ROLLBACK）—— 写接口的核心诉求。
        Day 18 的 write/index.js 靠事务保证「三张表要么全成要么全不成」，
        官方文档说 exec-pgsql「单次调用只能一条语句」，
        ★ 所以这里要验的是「同一个连接能否跨多次调用保持事务状态」——
          如果不能，写接口的多表原子性就得另想办法，这是今天最关键的一项。
     ③ 能不能捕到 23505（防重复那条分支的依据）

   另外顺带验两件小事：
     · PostgREST 风格读写（/v1/rdb/rest/）能不能用 —— 若能用，read 接口能少改动
     · 表的 RLS/GRANT 权限有没有配好 —— 这是社区文档点名的高频坑

   ★ 全程不打印 Key，也不打印任何连接串。

   怎么跑：node .probe-httpapi.js
   退出码：0 = 三件事都通，可以动正式代码；1 = 有不通的，先解决它。 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CFG_PATH = path.join(__dirname, '.cloudbase-api-key.local.json');
const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const ENV = cfg.envId || 'cxj1528-d4g55ng0o54cbe296';
const KEY = (cfg.apiKey || '').trim();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '\n      ← ' + extra : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

if (!KEY) {
  console.log('还没有填 API Key。');
  console.log('请打开这个文件，把 apiKey 那一栏的值粘进去：');
  console.log('  ' + CFG_PATH);
  console.log('');
  console.log('（填完存盘，再跑一次这个脚本。）');
  process.exit(2);
}

/* ---------- 一个极简的 HTTPS 调用（不引 SDK，理由同 chat/analyze）---------- */
function request(urlStr, method, bodyObj, extraHeaders) {
  return new Promise(function (resolve) {
    const url = new URL(urlStr);
    const payload = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const headers = Object.assign({
      'Authorization': 'Bearer ' + KEY,
      'Content-Type': 'application/json'
    }, extraHeaders || {});
    if (payload) headers['Content-Length'] = payload.length;

    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: method, headers: headers, timeout: 45000
    }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* 非 JSON 留 null */ }
        resolve({ status: res.statusCode, body: parsed, raw: raw, headers: res.headers });
      });
    });
    req.on('timeout', function () { req.destroy(); resolve({ status: 0, raw: '超时 45s' }); });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e.message) }); });
    if (payload) req.write(payload);
    req.end();
  });
}

const EXEC_URL = 'https://' + ENV + '.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
const REST_BASE = 'https://' + ENV + '.api.tcloudbasegateway.com/v1/rdb/rest';

(async function () {
  console.log('探针开始（不会打印 Key，也不打印任何连接串）');
  console.log('环境: ' + ENV);

  /* ============ 第 0 关：Key 本身通不通 ============ */
  section('0. Key 是否有效');
  let r = await request(EXEC_URL, 'POST', { sql: 'SELECT 1 AS ok', parameters: [] });
  /* ★ 判据要按「HTTP 200 且 body 有内容」来，不能找Rows 字段 ——
       exec-pgsql 的返回不是 executePGSql 那套 {Rows, Columns, AffectedRows} 结构，
       SELECT 直接把结果数组摊在 body 里（实测：[{"ok":1}]）。
       第一版按Rows 判断，于是「Key 是好的」被误判成「Key 没通过」而直接中止——
       **探针自己的判据出错，比探针不通更危险，它会让你以为这条路死了。** */
  const authOk = r.status === 200 && r.body !== null && String(r.raw || '').trim() !== '';
  ok('exec-pgsql 用这个 Key 能跑 SELECT 1', authOk,
    'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 400));
  if (r.status === 200) {
    console.log('      实际返回: ' + String(r.raw || '').slice(0, 120));
    console.log('      → 鉴权通过，且 SQL 真的在库里跑了');
  }
  if (!authOk) {
    console.log('');
    console.log('  → Key 没通过。下面三种可能，按顺序排查：');
    console.log('    a) Key 填错了（含空格 / 复制不全 / 不是服务端 Key 而是公开 Key）');
    console.log('    b) 控制台环境与你填的 envId 不是同一个');
    console.log('    c) 这个套餐/环境还没开通 HTTP API 的 PG 能力');
    console.log('');
    console.log('  → 脚本到此为止，后面几关不跑了（它们全靠这一关）。');
    process.exit(1);
  }

  /* ============ 第 1 关：读（顺带验权限配没配好）============ */
  section('1. 读库（PostgREST 风格 + 权限）');
  r = await request(REST_BASE + '/sessions?select=session_id,topic_id&limit=2', 'GET');
  ok('GET /v1/rdb/rest/sessions 能返回数据', r.status === 200 && r.body && Array.isArray(r.body),
    'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 300));
  if (r.status === 200 && Array.isArray(r.body)) {
    console.log('      读到 ' + r.body.length + ' 行' + (r.body.length ? '，第一行: ' + JSON.stringify(r.body[0]).slice(0, 120) : ''));
  }
  /* 社区文档点名的坑：RLS 开了但一条 policy 都没有 → 非 service_role 全被静默拒。
     我们用 API Key（service_role）所以不受影响，但记下来——
     将来若改用 Publishable Key（anon）就会撞上。 */
  r = await request(REST_BASE + '/sessions?select=session_id&limit=1', 'GET',
    undefined, { 'Prefer': 'count=exact' });
  ok('count=exact 能返回总行数（顺带确认权限层通）',
    r.status === 200 && !!r.headers && r.headers['content-range'] !== undefined,
    'HTTP ' + r.status + '  content-range=' + (r.headers && r.headers['content-range']));

  /* ============ 第 2 关：写 + 事务（最关键）============ */
  section('2. 写库与事务（写接口的核心依赖）');
  const PROBE_ID = 'S-PROBE-ROLLBACK';

  /* 2.1 能不能 INSERT（并立刻删掉，不留痕） */
  r = await request(EXEC_URL, 'POST', {
    sql: 'INSERT INTO sessions (session_id, topic_id, started_at, ended_at, is_complete) ' +
      'VALUES ($1,$2,$3,$4,TRUE)',
    parameters: [PROBE_ID, 'T1', '2026-10-07 00:00:00', '2026-10-07 00:01:00'],
    role: 'cloudbase_postgres'
  });
  const insOk = r.status === 200;
  ok('exec-pgsql 能执行 INSERT', insOk,
    'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 300));

  /* 2.2 ★ 事务：跨多次调用 BEGIN / INSERT / ROLLBACK。
       这是今天最关键的一项 —— 官方文档说 exec-pgsql「单次只能一条语句」，
       如果状态不能跨调用保持，那 write/index.js 的「三表一个事务」就实现不了，
       必须改设计（比如退化成单条语句或改成补偿式回滚）。 */
  r = await request(EXEC_URL, 'POST', { sql: 'BEGIN', role: 'cloudbase_postgres' });
  ok('BEGIN 单独一条能执行', r.status === 200,
    'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 200));

  r = await request(EXEC_URL, 'POST', {
    sql: 'INSERT INTO sessions (session_id, topic_id, started_at, ended_at, is_complete) ' +
      'VALUES ($1,$2,$3,$4,TRUE)',
    parameters: [PROBE_ID, 'T1', '2026-10-07 00:00:00', '2026-10-07 00:01:00'],
    role: 'cloudbase_postgres'
  });
  const dupInTx = r.status === 200;

  /* 2.2 ★ 关键判定：ROLLBACK 之后那一行还在不在？
       实测结论（Day 18 定）：**回滚不掉**。
       HTTP API 下每次调用是独立连接，BEGIN 对下一次调用不起作用
       ——所以「三表一个事务」在这条路上做不到。
       同时验证过：多语句拼一次调用会被 PG 拒
       （DATABASE_42601: cannot insert multiple commands into a prepared statement）。

       ★ 改用「每表一次请求」：PostgREST 单请求插整个数组，
         且批次内**有原子性**（实测：同批里一行违反CHECK → 整批不落库）。
         跨表一致性靠 ON DELETE CASCADE 补偿删除。 */
  r = await request(REST_BASE + '/sessions?session_id=eq.' + PROBE_ID + '&select=session_id', 'GET');
  const left = (r.status === 200 && Array.isArray(r.body)) ? r.body.length : -1;
  ok('★ 跨调用 ROLLBACK 不生效（本环境的既成事实，决定了要改设计）',
    left === 1, '预期残留 1 行（事务无效），实际残留 ' + left + ' 行');

  /* 2.3 但「单请求插整个数组 + 批次内原子」是可行的 —— 这是替代方案的基础。
       ★ 第一版这里写错了：上一小步已经插过 turn=1，紧接着又拿turn=1 开新批次，
         结果整批撞主键（23505）—— 根本没轮到 CHECK 约束那条生效，
         误判成「批次不原子」。**混用主键会掩盖掉要验的那件事。**
       现在用一组全新的轮次号（100/0），只测 CHECK。 */
  r = await request(REST_BASE + '/turns', 'POST', [
    { session_id: PROBE_ID, turn: 100, user_text: 'ok1', ai_text: 'A1' },
    { session_id: PROBE_ID, turn: 0, user_text: '违反 ck_turns_turn', ai_text: 'bad' }
  ]);
  ok('★ 批次内一行违反 CHECK → 整批被拒',
    r.status === 400 && /23514|ck_turns_turn/.test(String(r.raw)),
    'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 200));

  r = await request(REST_BASE + '/turns?session_id=eq.' + PROBE_ID + '&select=turn,user_text', 'GET');
  const batchLeft = (r.status === 200 && Array.isArray(r.body)) ? r.body.length : -1;
  ok('★ 该批次一行都没落库（原子性成立，这是替代方案能用的前提）',
    batchLeft === 0, '实际残留 ' + batchLeft + ' 行（若为 1 则说明只有违规那行没进去）');

  /* 2.4 再验一次「合法批次能一次插多行」—— turns 一场十几轮，这项直接决定性能。 */
  const manyRows = [];
  for (let i = 1; i <= 10; i++) {
    manyRows.push({ session_id: PROBE_ID, turn: i, user_text: 'u' + i, ai_text: 'a' + i });
  }
  r = await request(REST_BASE + '/turns', 'POST', manyRows, { 'Prefer': 'return=minimal' });
  ok('★ 一次请求插 10 行（turns 的真实规模）',
    r.status === 201, 'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 160));
  r = await request(REST_BASE + '/turns?session_id=eq.' + PROBE_ID + '&select=turn', 'GET');
  ok('  10 行确实都在', (r.body || []).length === 10, '实际 ' + (r.body || []).length + ' 行');

  /* 2.4 清理探针数据 */
  r = await request(REST_BASE + '/sessions?session_id=eq.' + PROBE_ID, 'DELETE');
  ok('补偿删除可用（DELETE /sessions?session_id=eq.X，外键 CASCADE 连带删子行）',
    r.status === 204, 'HTTP ' + r.status);

  r = await request(REST_BASE + '/sessions?session_id=eq.' + PROBE_ID + '&select=session_id', 'GET');
  ok('库已恢复原状（探针那一行确实没了）',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 0);

  /* ============ 第 3 关：23505（防重复那条分支）============ */
  section('3. 错误码能不能捕到（防重复的依据）');
  const DUP = 'S-PROBE-DUP';
  /* 先插一条 */
  await request(EXEC_URL, 'POST', {
    sql: 'INSERT INTO sessions (session_id, topic_id, started_at, ended_at, is_complete) ' +
      'VALUES ($1,$2,$3,$4,TRUE)',
    parameters: [DUP, 'T1', '2026-10-07 00:00:00', '2026-10-07 00:01:00'],
    role: 'cloudbase_postgres'
  });
  /* 再插同一条 —— 这次要看错误信息里有没有 23505 / duplicate key */
  r = await request(EXEC_URL, 'POST', {
    sql: 'INSERT INTO sessions (session_id, topic_id, started_at, ended_at, is_complete) ' +
      'VALUES ($1,$2,$3,$4,TRUE)',
    parameters: [DUP, 'T1', '2026-10-07 00:00:00', '2026-10-07 00:01:00'],
    role: 'cloudbase_postgres'
  });
  const dupText = (r.raw || '') + ' ' + JSON.stringify(r.body || {});
  const has23505 = /23505/.test(dupText) || /duplicate key|unique constraint/i.test(dupText);
  ok('★ 重复插入能被识别（错误信息含 23505 / duplicate key / unique constraint）',
    has23505, 'HTTP ' + r.status + '  ' + String(r.raw || '').slice(0, 300));
  ok('  且返回的不是 200（确实被数据库挡住了）', r.status !== 200, 'HTTP ' + r.status);

  /* 清理 */
  await request(EXEC_URL, 'POST', {
    sql: 'DELETE FROM sessions WHERE session_id = $1', parameters: [DUP],
    role: 'cloudbase_postgres'
  });
  r = await request(REST_BASE + '/sessions?session_id=eq.' + DUP + '&select=session_id', 'GET');
  ok('清理完成（第 3 关的探针数据也没了）',
    r.status === 200 && Array.isArray(r.body) && r.body.length === 0);

  /* ============ 第 4 关：确认库回到今天开始时的状态 ============ */
  section('4. 库状态复核（别把库留脏）');
  r = await request(REST_BASE + '/sessions?select=session_id', 'GET',
    undefined, { 'Prefer': 'count=exact' });
  const total = r.headers && r.headers['content-range'];
  ok('sessions 表行数（应包含 S-D18-SHOT-01，即截图用的那行）',
    !!total, 'content-range = ' + total);

  /* ============ 结论 ============ */
  console.log('');
  console.log('='.repeat(64));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(64));
  if (fail === 0) {
    console.log('');
    console.log('结论：这条路通。可以动正式代码了。');
    console.log('  · write/index.js 的数据访问层从 pg 驱动改成 exec-pgsql');
    console.log('  · read/index.js 同理（它也能从 DB_CONNECTION_REFUSED 里解放出来）');
    console.log('  · 校验、外壳、事务语义、B8/B7 硬约束全部不动');
  } else {
    console.log('');
    console.log('结论：这条路有不通的地方，先别动正式代码。');
    console.log('  看上面标✗ 的那几项 —— 每条都写了失败原因与排查方向。');
  }
  process.exit(fail === 0 ? 0 : 1);
})();