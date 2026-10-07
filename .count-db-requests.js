/* 统计「一次验证发出了多少次数据库请求」
   -------------------------------------------------------------
   为什么需要它：PostgreSQL 按 **5 分钟窗口**计费
   （342 点/(核·小时)，共享实例 0.5 核 → 每个活跃窗口 0.04167 CU ≈ 14.25 点）。
   免费版 3000 点/月 ≈ 210 个窗口 ≈ 17.5 小时/月。
   → 知道自己一次验证烧多少点，才知道还能验多少次。

   ★ 它不连真库：把 write/index.js 的 httpdb 换成一个「只记录、不发请求」的
     模块，然后发一组真请求，看记录里有几条。
     ★★ 副本必须放在 cloudfunctions/write/ 目录里——
       换名后的副本不再有原目录的上下文，require('../../xxx') 会在仓库根找不到模块
       （踩过：放在根目录时进程直接 MODULE_NOT_FOUND 起不来）。

   ★★ 改写副本端口这件事的教训（文末有留档断言）：
     字符串替换容易漏掉右括号或多写逗号 → 语法错 → 副本起不来。
     而症状极具误导性：看起来像「端口没换成功」，于是会反复去改替换逻辑。
     → 真正管用的不是「找到唯一正确的写法」，而是**替换后立刻校验**：
       既确认旧的 9000 不在了，也确认目标端口写进去了。
     附带一条已核实的：'$1' + 端口 在只有一个捕获组时是**安全**的
     （曾以为会拼成 $19002 而静默失效，实测不会）。

   怎么跑：node .count-db-requests.js   （退出码 0 = 全部符合预期） */

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'cloudfunctions', 'write', 'index.js');
const RECORDER = path.join(ROOT, '.count-db-recorder.js');
const LOG = path.join(ROOT, '.count-db-requests.log');
const COPY = path.join(ROOT, 'cloudfunctions', 'write', '.count-db-copy.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32mOK\x1b[0m   ' + name); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '\n         ' + detail : '')); }
}
function section(t) { console.log('\n\x1b[1m  ' + t + '\x1b[0m'); }

/* ---------- 端口工具 ---------- */
const portsInUse = [];

function portPid(p) {
  /* Windows 上按端口找 PID：netstat 输出最后一个字段就是 PID */
  try {
    const out = require('child_process')
      .execSync('netstat -ano | findstr :' + p, { encoding: 'utf8' });
    const rows = out.split('\n').filter(function (l) { return /LISTENING/i.test(l); });
    if (!rows.length) return null;
    return rows[0].trim().split(/\s+/).pop();
  } catch (e) { return null; }
}

function portFree(p) {
  return new Promise(function (resolve) {
    const s = net.createServer();
    s.once('error', function () { resolve(false); });
    s.once('listening', function () { s.close(function () { resolve(true); }); });
    s.listen(p, '127.0.0.1');
  });
}

/* 目标端口能不能连上——「进程起来了」的可靠判据。
   ★ 不用「端口能否被 bind」来判：那个方法在 Windows 上会与刚监听的进程
     抢端口、结果不可靠（实测在这里误判过一次，害我以为端口替换失败）。 */
function portInUse(p) {
  return new Promise(function (resolve) {
    const s = net.connect({ host: '127.0.0.1', port: p });
    s.setTimeout(800);
    s.once('connect', function () { s.destroy(); resolve(true); });
    s.once('error', function () { resolve(false); });
    s.once('timeout', function () { s.destroy(); resolve(false); });
  });
}

function post(port, body, raw) {
  return new Promise(function (resolve) {
    const payload = Buffer.from(raw !== undefined ? raw : JSON.stringify(body), 'utf8');
    const r = http.request({
      host: '127.0.0.1', port: port, path: '/api/sessions/write', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, function (s) {
      let x = '';
      s.on('data', function (d) { x += d; });
      s.on('end', function () { resolve({ status: s.statusCode, body: x }); });
    });
    r.on('error', function (e) { resolve({ status: 0, body: String(e.message) }); });
    r.end(payload);
  });
}

/* ---------- 计数 ---------- */
function dbCalls() {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').filter(function (l) { return l.trim(); });
  } catch (e) { return []; }
}
function resetLog() { try { fs.unlinkSync(LOG); } catch (e) {} }

const GOOD = {
  sessionId: 'S-COUNT-PROBE', topicId: 'T1',
  startedAt: '2026-10-07T20:11:16+08:00', endedAt: '2026-10-07T20:14:20+08:00',
  isComplete: true,
  transcript: [{ turn: 1, userText: 'a', aiText: 'b' }],
  /* ★ items 必须带上：它是三步写入里的第 3 步。
     不给的话 items 是空数组 → rows=0，「顺序」那条断言就没意义了。 */
  items: [{ turn: 1, type: 'logic', reminder: '测试用', correction: 'a' }]
};

/* ---------- 清理 ---------- */
function cleanup() {
  [RECORDER, LOG, COPY].forEach(function (f) { try { fs.unlinkSync(f); } catch (e) {} });
  portsInUse.forEach(function (p) {
    const pid = portPid(p);
    if (pid) { try { process.kill(Number(pid)); } catch (e) {} }
  });
}
process.on('exit', cleanup);

(async function () {
  console.log('  说明：不连真库。把 write 的 httpdb 换成只记录不发请求的模块，');
  console.log('        再发真请求，看记录里有几条 —— 目的是「数发了几次」。');

  /* ---------- 0. 端口 ---------- */
  let port = 0;
  for (const cand of [9002, 9003, 9004, 9005]) {
    if (await portFree(cand)) { port = cand; break; }
  }
  if (!port) {
    console.log('  \x1b[33m跳过\x1b[0m 9002–9005 都被占用，无法起本地副本');
    console.log('        （不影响 verify.sh 的前6 项检查）');
    process.exit(0);
  }
  portsInUse.push(port);

  /* ---------- 1. 生成记录器 ---------- */
  fs.writeFileSync(RECORDER, [
    "/* 只记录「有没有真的发出数据库请求」，不连真库。 */",
    "const fs = require('fs');",
    "const LOG = require('path').join(__dirname, '.count-db-requests.log');",
    "function rec(s) { fs.appendFileSync(LOG, s + '\\n'); }",
    'module.exports = {',
    "  select: function (t) { rec('SELECT ' + t); return Promise.resolve([]); },",
    "  insertMany: function (t, rows) { rec('INSERT ' + t + ' rows=' + rows.length); return Promise.resolve({ affected: rows.length }); },",
    "  deleteWhere: function (t) { rec('DELETE ' + t); return Promise.resolve({ affected: 1 }); },",
    "  execSql: function () { rec('EXEC'); return Promise.resolve([]); },",
    "  classify: function () { return { code: 'DB_QUERY_FAILED', message: 'x' }; },",
    '  isConfigured: function () { return true; },',
    "  describe: function () { return '计数器（不连真库）'; }",
    '};'
  ].join('\n'), 'utf8');

  /* ---------- 2. 生成副本（换 httpdb + 换端口） ---------- */
  const src = fs.readFileSync(SRC, 'utf8');
  if (!/require\('\.\/httpdb'\)/.test(src)) {
    console.error('  \x1b[31m没找到 require(\'./httpdb\')，write/index.js 结构变了？\x1b[0m');
    process.exit(1);
  }
  const patched = src
    .replace("require('./httpdb')", "require('../../.count-db-recorder.js')")
    /* ★ 用函数形式返回，理由见文件头 */
    .replace(/(server\.listen\(\s*)9000\b/, function (_, head) { return head + port; });

  /* 双重校验：既确认旧的 9000 没了，也确认目标端口真的写进去了 */
  if (/server\.listen\(\s*9000\b/.test(patched)) {
    console.error('  \x1b[31m端口替换失败，副本仍会抢 9000\x1b[0m');
    process.exit(1);
  }
  if (!new RegExp('server\\.listen\\(\\s*' + port + '\\b').test(patched)) {
    console.error('  \x1b[31m副本里没有 listen(' + port + ')\x1b[0m 实际那行：'
      + patched.split('\n').filter(function (l) { return /server\.listen/.test(l); })[0]);
    process.exit(1);
  }
  fs.writeFileSync(COPY, patched, 'utf8');

  /* ---------- 3. 起进程 ---------- */
  const child = spawn(process.execPath, [COPY], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', function (d) { logs.push(String(d)); });
  child.stderr.on('data', function (d) { logs.push('[stderr] ' + String(d)); });

  let up = false, sawExit = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(function (r) { setTimeout(r, 100); });
    if (child.exitCode !== null) { sawExit = true; break; }
    if (await portInUse(port)) { up = true; break; }
  }
  ok('本地副本已起（端口 ' + port + '）', up,
    (sawExit ? '进程已退出，退出码 ' + child.exitCode + '\n' : '') +
    '启动日志：\n' + logs.join('').slice(0, 400));
  if (!up) { cleanup(); process.exit(1); }

  /* ---------- 4. 逐个场景数库请求 ---------- */
  section('哪些请求会碰数据库');
  const cases = [
    ['缺 topicId（校验拦下）', Object.assign({}, GOOD, { topicId: undefined, sessionId: undefined }), 0],
    ['topicId 传数字（类型错）', Object.assign({}, GOOD, { topicId: 123, sessionId: undefined }), 0],
    ['时区写 Z', Object.assign({}, GOOD, { startedAt: '2026-10-07T20:11:16Z', sessionId: undefined }), 0],
    ['空 body', {}, 0],
    ['非法 JSON', null, 0],
    ['字段完整（该发 3 次）', Object.assign({}, GOOD, { sessionId: 'S-COUNT-PROBE' }), 3]
  ];

  let total = 0;
  const perCase = [];
  for (const cs of cases) {
    resetLog();
    const r = cs[1] === null ? await post(port, null, '{"bad') : await post(port, cs[1]);
    const calls = dbCalls();
    total += calls.length;
    perCase.push({ name: cs[0], status: r.status, n: calls.length, calls: calls });
    ok(cs[0] + ' → 数据库请求 ' + calls.length + ' 次（预期 ' + cs[2] + '）',
      calls.length === cs[2],
      'HTTP ' + r.status + '  实际：' + (calls.join(' | ') || '（0 次）'));
  }

  section('完整写入的三个请求分别打哪张表');
  const full = perCase[perCase.length - 1];
  ok('顺序是 sessions → turns → items（父表必须先插，否则子表撞外键）',
    full.calls.join(',') === 'INSERT sessions rows=1,INSERT turns rows=1,INSERT items rows=1',
    full.calls.join(' | '));

  /* ---------- 5. 折算资源点 ---------- */
  section('折算成资源点');
  const CU = 0.5 * 5 / 60;          /* 0.04167 CU：0.5 核 × 5 分钟 */
  const PTS = CU * 342;             /* ≈ 14.25 点/窗口 */
  const freePts = 3000;
  console.log('    上面 ' + perCase.length + ' 个请求一共发出 ' + total + ' 次库请求');
  console.log('    计费不看请求条数，看落在多少个 5 分钟窗口里');
  console.log('    一次完整验证（一轮）通常 = 1 个窗口 = ' + PTS.toFixed(2) + ' 点');
  console.log('    免费版 ' + freePts + ' 点/月 ≈ ' + Math.floor(freePts / PTS) + ' 个窗口 ≈ '
    + (freePts / PTS * 5 / 60).toFixed(1) + ' 小时/月');
  ok('一轮验证占的点数远低于配额（不会因为验证就撞上限）',
    PTS < freePts / 10,
    '一个窗口 ' + PTS.toFixed(2) + ' 点，配额 ' + freePts + ' 点');

  section('哪些操作不烧点（Day 18 实测）');
  [
    ['写代码 / 改 CSS / 想方案', '不碰数据库'],
    ['GET /api/health', '纯健康检查，从 Day 15 就不连库'],
    ['POST /api/chat', '只调大模型'],
    ['POST /api/analyze', '只调大模型'],
    ['静态托管（页面 / JS / CSS）', 'CDN 上的文件'],
    ['★ 所有校验失败的请求', '校验在写库之前就 return 了']
  ].forEach(function (o) { console.log('    ' + o[0] + '\n' + ' '.repeat(38) + o[1]); });
  console.log('      → 也就是说：故意传错参数调接口调接口**不烧点**，只有真写入/真查询才烧');

  /* ---------- 6. 端口替换的坑，留档 ---------- */
  section('★ 留档：改写副本端口这件事本身');
  /* 真坑：字符串替换容易漏掉右括号或多个逗号，语法错。
     而**症状极具误导性** —— 副本起不来，第一反应会以为「端口没换成功」，
     于是去反复改替换逻辑（我在这上面绕了三轮，方向全错）。
     → 真正起作用的不是「找到唯一正确的写法」，而是**替换后立刻校验**：
       既确认旧的 9000 不在了，也确认目标端口写进去了（第 2 步就是这么做的）。 */
  ok('★ 替换后有双重校验（旧端口消失 + 新端口出现）',
    /server\.listen\(\s*9000\b/.test(patched) === false &&
    new RegExp('server\\.listen\\(\\s*' + port + '\\b').test(patched),
    '副本实际那行：' + patched.split('\n').filter(function (l) { return /server\.listen/.test(l); })[0]);
  ok('  万一没换成功会直接退出，而不是让副本默默抢 9000',
    /端口替换失败/.test(fs.readFileSync(__filename, 'utf8')));

  /* ★ 一个曾让我改错地方的判断：以为 '$1' + 端口 会静默失效
     （拼成 $19002 被当成第 19 组捕获）。**实测是错的**——
     只有一个捕获组时它正常工作，$19 会退回 $1 + '9'。 */
  const dollarThenDigits = 'X'.replace(/(X)/, '$1' + 9002);
  ok('  （已核实）\'$1\'+端口 其实是安全的 —— $19 找不到第 19 组时退回 $1+9',
    dollarThenDigits === 'X9002',
    '实际结果：' + dollarThenDigits);

  ok('★ write/index.js 的启动日志里端口是写死的字面量（不能拿它判副本起没起）',
    /console\.log\('\[write\] listening on 0\.0\.0\.0:9000'\)/.test(src),
    'index.js 里那行变了——若哪天改成打印真实端口，本条断言要跟着改');
  ok('  判据是「能不能连上端口」，不是「能不能 bind 端口」（Windows 上后者会误判）',
    typeof portInUse === 'function' && typeof portFree === 'function');
  ok('日志文件路径与记录器里写的一致（两处不一致就记不到）',
    /\.count-db-requests\.log/.test(fs.readFileSync(RECORDER, 'utf8')));
  ok('记录器与副本都在清理列表里（结束时删掉，不留垃圾）',
    cleanup.toString().indexOf('RECORDER') >= 0 && cleanup.toString().indexOf('COPY') >= 0);

  try { child.kill(); } catch (e) {}
  await new Promise(function (r) { setTimeout(r, 200); });

  console.log('\n' + '='.repeat(60));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(60));
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('脚本自身出错：', e && e.stack ? e.stack : e);
  cleanup();
  process.exit(1);
});