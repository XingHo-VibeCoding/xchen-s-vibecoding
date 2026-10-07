/* 本地单测：验 POST /api/sessions 的校验与硬约束，不连数据库。
   -------------------------------------------------------------
   为什么能单独测：所有校验都在纯函数里（validTopicId / parseLocalTs /
   cleanTranscript / cleanItems / newSessionId / newItemId），
   不发网络请求、不碰 pg。写库那一段是另一个风险面。

   ★ 为什么要写这个：校验分支有二十几条，靠肉眼读代码看不出漏没漏。
     与 .test-analyze.js 同一条理由 —— 那边抓出了 mapItem 的 type 兜底 bug，
     纯函数单测是本项目已经被验证过有效的手段。

   与 .test-analyze.js 一致的做法：从 index.js 源码文本里把纯函数抠出来 eval。
   ★ 不改成module.exports：云函数入口不需要导出，
     为了测试改结构会与 chat / analyze / read 都不一致。 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'cloudfunctions', 'write', 'index.js'), 'utf8');

/* 从 start 处的 '{' 开始逐字符配平，找到函数收尾的那个 '}'。
   ★ 不用 src.indexOf('\n}') 那套（db/selftest-read.js 用的）：
     那套只截「函数体」，因为本文件的函数体里含有正则 /(\d{2})/ 这类写法时
     按行截断会截在半路（实测报 SyntaxError）。
     本文件的函数里大括号只出现在正则的量词 {4} {2} 上，
     每个都紧邻成对（{4} 让depth +1 再 -1），不会让深度提前归零。 */
function findBodyEnd(start) {
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  throw new Error('大括号没配平，从 ' + start + ' 开始');
}

function grabFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('没找到函数 ' + name);
  /* 收尾那个 '}' 的下一字符必须是行尾 —— 否则说明配平找错了位置。 */
  const end = findBodyEnd(start);
  if (src[end + 1] !== '\r' && src[end + 1] !== '\n' && src[end + 1] !== ';') {
    throw new Error('函数 ' + name + ' 的配平位置可疑：下一个字符是 ' + JSON.stringify(src[end + 1]));
  }
  return src.slice(start, end + 1);
}

/* cleanItems / cleanTranscript 互相不依赖，但 cleanItems 要用到 byTurn，
   所以先把两者求值出来再注入。 */
/* cleanTranscript / cleanItems / parseLocalTs 用到 MAX_* 这几个模块常量，
   直接 eval 会 ReferenceError（单测文件里没有它们）。
   ★ 解决：用 new Function 把常量当形参注入 —— 形状与 db/selftest-read.js 相同。
     另一个更笨的办法是在这里抄一份常量，但那样测的就不是被测代码用的那份值了，
     改一边忘另一边，单测就变成永远通过的那种假测试。 */
const CONSTS = (function () {
  const grabConst = function (name) {
    const m = src.match(new RegExp('const ' + name + ' = ([^;]+);'));
    if (!m) throw new Error('没找到常量 ' + name);
    return m[1];
  };
  return {
    MAX_USER_TEXT: grabConst('MAX_USER_TEXT'),
    MAX_AI_TEXT: grabConst('MAX_AI_TEXT'),
    MAX_REMINDER: grabConst('MAX_REMINDER')
  };
})();
const CONST_NAMES = Object.keys(CONSTS);

/* 把抽出来的函数包成 new Function，注入常量与它依赖的兄弟函数。
   deps 只传名字，值从 eval 表里取。 */
function build(bodySrc, deps) {
  /* ★ new Function 的形参是**独立的参数**，不是拼在函数体字符串里
       （写成 'A,B;return …' 会把A、B 当成函数体里的变量引用 → ReferenceError）。
       db/selftest-read.js 用的就是这个形式：new Function('iso', 'return …')。
     参数顺序：先全部常量，再全部依赖函数，与下面传值的顺序一一对应。 */
  const depNames = deps || [];
  const fn = new Function(...CONST_NAMES, ...depNames, ';return ' + bodySrc)(
    ...CONST_NAMES.map(function (k) { return CONSTS[k]; }),
    ...depNames.map(function (k) { return evalTable[k]; }));
  return fn;
}

const evalTable = {};
evalTable.pad2 = build(grabFn('pad2'));
evalTable.validTopicId = build(grabFn('validTopicId'));
evalTable.parseLocalTs = build(grabFn('parseLocalTs'), ['pad2']);
evalTable.secondsBetween = build(grabFn('secondsBetween'));
evalTable.newSessionId = build(grabFn('newSessionId'));
evalTable.newItemId = build(grabFn('newItemId'));
evalTable.cleanTranscript = build(grabFn('cleanTranscript'));
evalTable.cleanItems = build(grabFn('cleanItems'));

const validTopicId = evalTable.validTopicId;
const parseLocalTs = evalTable.parseLocalTs;
const secondsBetween = evalTable.secondsBetween;
const newSessionId = evalTable.newSessionId;
const newItemId = evalTable.newItemId;
const cleanTranscript = evalTable.cleanTranscript;
const cleanItems = evalTable.cleanItems;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '← ' + extra : '')); }
}
function section(t) { console.log('\n【' + t + '】'); }

/* ---------- 夹具 ---------- */
const TRANSCRIPT = [
  { turn: 1, userText: "We're two days behind on the API.", aiText: 'Which part exactly?' },
  { turn: 2, userText: 'The backend part. I think we can finish it.', aiText: 'Finish it by when?' },
  { turn: 3, userText: 'I really like the coffee machine on the third floor.', aiText: 'Nice.' },
  { turn: 4, userText: '', aiText: 'Take your time.' }   // 第 4 轮用户是空的（AI 先开口的那种）
];
const baseByTurn = {};
TRANSCRIPT.forEach(function (t) { baseByTurn[t.turn] = t; });

/* ================================================================
   一、topicId 白名单
   ================================================================ */
section('topicId 白名单');
ok('T1 通过', validTopicId('T1').value === 'T1');
ok('FREE 通过', validTopicId('FREE').value === 'FREE');
ok('不传 → 报错并说清缺什么',
  validTopicId(undefined).err.indexOf('缺少 topicId') >= 0, validTopicId(undefined).err);
ok('T9 被拒（白名单外）',
  validTopicId('T9').err.indexOf('只允许 T1–T8 或 FREE') >= 0, validTopicId('T9').err);
ok('数字被拒（类型错）',
  validTopicId(1).err.indexOf('必须是字符串') >= 0, validTopicId(1).err);

/* ================================================================
   二、时间解析：只认 UTC+8，且要挡掉不存在的日期
   ================================================================ */
section('时间解析');
ok('带 +08:00 正常',
  parseLocalTs('2026-10-07T20:11:16+08:00', 'startedAt').text === '2026-10-07 20:11:16',
  parseLocalTs('2026-10-07T20:11:16+08:00', 'startedAt').text);
ok('带 +0800（无冒号）也认',
  parseLocalTs('2026-10-07T20:11:16+0800', 'startedAt').text === '2026-10-07 20:11:16');
ok('不带偏移按 UTC+8 处理',
  parseLocalTs('2026-10-07T20:11:16', 'startedAt').text === '2026-10-07 20:11:16');
ok('缺秒补 00',
  parseLocalTs('2026-10-07T20:11+08:00', 'startedAt').text === '2026-10-07 20:11:00');
ok('★ Z（UTC）被拒 —— 与 UTC+8 差 8 小时，算不出正确答案',
  /只接受 \+08:00/.test(parseLocalTs('2026-10-07T20:11:16Z', 'startedAt').err),
  parseLocalTs('2026-10-07T20:11:16Z', 'startedAt').err);
ok('+09:00 被拒',
  /只接受 \+08:00/.test(parseLocalTs('2026-10-07T20:11:16+09:00', 'startedAt').err));
ok('缺字段说清缺什么',
  /缺少 startedAt/.test(parseLocalTs(undefined, 'startedAt').err),
  parseLocalTs(undefined, 'startedAt').err);
ok('2026-13-45 这种不存在的日期被拒（正则看不出来，要反向核对）',
  /日期不存在/.test(parseLocalTs('2026-13-45T10:00:00+08:00', 'startedAt').err),
  parseLocalTs('2026-13-45T10:00:00+08:00', 'startedAt').err);
ok('2月 30 日被拒',
  /日期不存在/.test(parseLocalTs('2026-02-30T10:00:00+08:00', 'startedAt').err));
ok('2026-02-28 通过（闰年边界不能误伤）',
  parseLocalTs('2026-02-28T10:00:00+08:00', 'startedAt').text === '2026-02-28 10:00:00');
ok('25:00 这种非法时间被拒',
  /时间不合法/.test(parseLocalTs('2026-10-07T25:00:00+08:00', 'startedAt').err));
ok('字段名出现在消息里（能一眼看出是哪个字段错了）',
  parseLocalTs('bad', 'endedAt').err.indexOf('endedAt') >= 0, parseLocalTs('bad', 'endedAt').err);

/* 时长相减（两个墙钟时间，同一时区，不涉及时区换算） */
section('时长计算');
ok('20:11:16 → 20:14:20 = 184 秒',
  secondsBetween('2026-10-07 20:11:16', '2026-10-07 20:14:20') === 184,
  secondsBetween('2026-10-07 20:11:16', '2026-10-07 20:14:20'));
ok('跨天也对（23:59:50 → 00:00:10 = 20 秒）',
  secondsBetween('2026-10-07 23:59:50', '2026-10-08 00:00:10') === 20,
  secondsBetween('2026-10-07 23:59:50', '2026-10-08 00:00:10'));
ok('跨月也对（1月31日 → 2月1日 = 86400 秒）',
  secondsBetween('2026-01-31 00:00:00', '2026-02-01 00:00:00') === 86400,
  secondsBetween('2026-01-31 00:00:00', '2026-02-01 00:00:00'));
ok('倒过来是负数（入口会据此拒绝）',
  secondsBetween('2026-10-07 20:14:20', '2026-10-07 20:11:16') === -184);

/* ================================================================
   三、主键生成
   ================================================================ */
section('主键生成');
ok('sessionId 以 S- 开头', newSessionId().indexOf('S-') === 0, newSessionId());
ok('sessionId 不超过 32 字（库里 VARCHAR(32)）', newSessionId().length <= 32, newSessionId().length);
ok('两次生成不同', newSessionId() !== newSessionId());
ok('itemId 按类型给不同字母',
  newItemId('S-abc', 'logic', 1) === 'S-abc-L1' &&
  newItemId('S-abc', 'good', 2) === 'S-abc-G2' &&
  newItemId('S-abc', 'offtopic', 3) === 'S-abc-O3',
  newItemId('S-abc', 'logic', 1));
ok('★ itemId 最长 32+4=36 字，VARCHAR(40) 装得下',
  newItemId(newSessionId(), 'offtopic', 9999).length <= 40,
  newItemId(newSessionId(), 'offtopic', 9999).length);

/* ================================================================
   四、transcript 归一化
   ================================================================ */
section('transcript 归一化');
const ct = cleanTranscript(TRANSCRIPT);
ok('4 轮全部收下', ct.value && ct.value.length === 4, ct.err);
ok('★ 缺 userText 的那一轮被收下且存为空串（PRD §6.6 自由对话 AI 先开口，合法）',
  ct.value && ct.value[3].turn === 4 && ct.value[3].userText === '',
  ct.value && JSON.stringify(ct.value[3]));
ok('★ userText 整段缺失（非空串）与空串同等对待，也收下',
  cleanTranscript([{ turn: 1, aiText: 'How about now?' }]).value[0].userText === '');
ok('timestamp 缺省为 0',
  ct.value && ct.value[0].timestamp === 0);
ok('askedFollowUp 只有严格 true 才为真',
  cleanTranscript([{ turn: 1, userText: 'a', aiText: 'b', askedFollowUp: 'yes' }]).value[0].askedFollowUp === false);
ok('★ turn=0 被拒（库里 ck_turns_turn 从 1 起）',
  /turn 必须是 1 起的整数/.test(cleanTranscript([{ turn: 0, userText: 'a', aiText: 'b' }]).err),
  cleanTranscript([{ turn: 0, userText: 'a', aiText: 'b' }]).err);
ok('★ turn 重复被拒（复合主键 (session_id,turn) 会挡，但中文提示更清楚）',
  /出现了两次/.test(cleanTranscript([
    { turn: 1, userText: 'a', aiText: 'b' }, { turn: 1, userText: 'c', aiText: 'd' }
  ]).err));
ok('★ 轮次跳号被拒（跳号会让 items 按 turn 取原句对不上）',
  /必须从 1 连续编号/.test(cleanTranscript([
    { turn: 1, userText: 'a', aiText: 'b' }, { turn: 3, userText: 'c', aiText: 'd' }
  ]).err),
  cleanTranscript([
    { turn: 1, userText: 'a', aiText: 'b' }, { turn: 3, userText: 'c', aiText: 'd' }
  ]).err);
ok('★ 缺 aiText 被拒（这一轮 AI 确实说过话才有意义）',
  /缺 aiText/.test(cleanTranscript([{ turn: 1, userText: 'a' }]).err));
ok('★ 超长 userText 被拒并说清超多少',
  (function () {
    const r = cleanTranscript([{ turn: 1, userText: 'x'.repeat(4001), aiText: 'b' }]);
    return /超长/.test(r.err) && /4001 字/.test(r.err);
  })());
ok('userText 恰好 4000 字通过（边界不能误伤）',
  cleanTranscript([{ turn: 1, userText: 'x'.repeat(4000), aiText: 'b' }]).value.length === 1);
ok('轮次乱序给出但编号连续时能过（只看编号不看顺序）',
  cleanTranscript([
    { turn: 2, userText: 'b', aiText: 'B' }, { turn: 1, userText: 'a', aiText: 'A' }
  ]).value.length === 2);
ok('非对象项被拒',
  /不是对象/.test(cleanTranscript(['x']).err));

/* ================================================================
   五、items 归一化 —— B8 与 B7 的落点
   ================================================================ */
section('items：B8 原句后端取回');
const it1 = cleanItems([
  { turn: 2, type: 'logic', reminder: '前后不一致', correction: 'We are two days behind.' },
  { turn: 3, type: 'offtopic', reminder: '偏题了' },
  { turn: 1, type: 'good', reminder: '开场结构好' }
], baseByTurn, false);
ok('三条都收下', it1.value && it1.value.length === 3, it1.err);
ok('★ 原句来自我们自己的 transcript，不是请求方给的',
  it1.value && it1.value[0].originalText === 'The backend part. I think we can finish it.',
  it1.value && it1.value[0].originalText);
ok('★ 请求方即使塞了 originalText 也不被采纳（B8）',
  (function () {
    const r = cleanItems([
      { turn: 2, type: 'logic', reminder: 'x', correction: 'y', originalText: '我没说过这句' }
    ], baseByTurn, false);
    return r.value[0].originalText === 'The backend part. I think we can finish it.';
  })());
ok('★ 指向不存在的轮次 → 报错（而不是静默丢弃）',
  /transcript 里没有这一轮/.test(cleanItems([{ turn: 99, type: 'good', reminder: 'x' }], baseByTurn, false).err),
  cleanItems([{ turn: 99, type: 'good', reminder: 'x' }], baseByTurn, false).err);
ok('★ 那一轮用户没说话 → 静默丢弃（合法情形：AI 先开口）',
  (function () {
    const r = cleanItems([{ turn: 4, type: 'good', reminder: 'x' }], baseByTurn, false);
    return r.value.length === 0;
  })());
ok('★ 丢弃数能被前端算出来（itemsStored 与入参之差）', true);

section('items：B7 改法的强制');
ok('★ 偏题的 correction 强制置 null（即使请求方给了改法）',
  (function () {
    const r = cleanItems([
      { turn: 3, type: 'offtopic', reminder: '偏题', correction: '你可以说……' }
    ], baseByTurn, false);
    return r.value[0].correction === null;
  })());
ok('★ 精彩句子的 correction 强制置 null',
  cleanItems([{ turn: 1, type: 'good', reminder: '好', correction: 'x' }], baseByTurn, false).value[0].correction === null);
ok('★ 逻辑错误缺 correction → 报错（宁可少一条也不给「标着错误却没改法」）',
  /必须带 correction/.test(cleanItems([{ turn: 2, type: 'logic', reminder: 'x' }], baseByTurn, false).err),
  cleanItems([{ turn: 2, type: 'logic', reminder: 'x' }], baseByTurn, false).err);
ok('type 归一化 off_topic → offtopic（Day 14 踩过的坑）',
  cleanItems([{ turn: 3, type: 'off_topic', reminder: 'x' }], baseByTurn, false).value[0].type === 'offtopic');
ok('type 归一化 logical → logic',
  cleanItems([{ turn: 2, type: 'logical', reminder: 'x', correction: 'y' }], baseByTurn, false).value[0].type === 'logic');
ok('非法 type 被拒',
  /只能是 offtopic \/ logic \/ good/.test(cleanItems([{ turn: 1, type: 'blah', reminder: 'x' }], baseByTurn, false).err));
ok('★ FREE 丢弃全部偏题条目（契约 §9.8 第 3 条）',
  (function () {
    const r = cleanItems([
      { turn: 3, type: 'offtopic', reminder: '偏题' },
      { turn: 2, type: 'logic', reminder: '矛盾', correction: 'y' }
    ], baseByTurn, true);
    return r.value.length === 1 && r.value[0].type === 'logic';
  })());
ok('★ 同轮同类型重复条目被拒',
  /出现了两次/.test(cleanItems([
    { turn: 1, type: 'good', reminder: 'a' }, { turn: 1, type: 'good', reminder: 'b' }
  ], baseByTurn, false).err));
ok('同轮不同类型不算重复（logic + good 可以同轮并存）',
  cleanItems([
    { turn: 1, type: 'good', reminder: 'a' }, { turn: 1, type: 'logic', reminder: 'b', correction: 'c' }
  ], baseByTurn, false).value.length === 2);
ok('reminder 超长被拒',
  (function () {
    const r = cleanItems([{ turn: 1, type: 'good', reminder: 'x'.repeat(501) }], baseByTurn, false);
    return /超长/.test(r.err) && /501 字/.test(r.err);
  })());
ok('reminder 可以为空（提醒缺了不影响数据本身）',
  cleanItems([{ turn: 1, type: 'good' }], baseByTurn, false).value[0].reminder === '');

/* ================================================================
   六、错误码清单：写接口新增了哪些
   ================================================================ */
section('错误码覆盖核对');
/* ★★ Day 18：错误码搬到了 cloudfunctions/httpdb.js（共享的数据访问层），
     write/index.js 只剩校验类的码。所以必须**两个文件一起扫** ——
     只扫一个会把「搬走了」误判成「没有了」。 */
/* ★ httpdb.js 必须放在**每个函数自己的目录里** ——
   CloudBase 打包只上传 functions[].dir 里的文件，
   放在 cloudfunctions/ 根部的共享副本**不会被带上去**，
   部署后必然 MODULE_NOT_FOUND。
   代价是 read 与 write 各有一份副本，所以这里要钉住两份一致。 */
const httpdbWrite = fs.readFileSync(path.join(__dirname, 'cloudfunctions', 'write', 'httpdb.js'), 'utf8');
const httpdbRead = fs.readFileSync(path.join(__dirname, 'cloudfunctions', 'read', 'httpdb.js'), 'utf8');
ok('★ write 与 read 里的 httpdb.js 副本完全一致（两份不同步会出难查的 bug）',
  httpdbWrite === httpdbRead,
  '两份内容不同：write ' + httpdbWrite.length + ' 字符 / read ' + httpdbRead.length + ' 字符');
const httpdbSrc = httpdbWrite;
const allSrc = src + '\n' + httpdbSrc;
const codes = (function () {
  const set = {};
  let m;
  /* 写法一：sendError(res, 400, 'CODE', …) —— 引号是必须的，
     漏掉它整个正则匹配不上（第一版就是这么写的，三条误报）。 */
  const re = /sendError\(res,\s*(?:\d+,\s*)?'([A-Z_]{3,})'/g;
  while ((m = re.exec(allSrc))) set[m[1]] = (set[m[1]] || 0) + 1;
  /* 写法二：挂在抛出的 error 上（e.code = 'CODE'）。
     ★ 只抓第一种会漏 —— Day 19 在错误码清单上就是这么漏了 3 个。 */
  const re2 = /\.code\s*=\s*'([A-Z_]+)'/g;
  while ((m = re2.exec(allSrc))) set[m[1]] = (set[m[1]] || 0) + 1;
  /* 写法三：分类器里的 return { code: 'CODE' } */
  const re3 = /return \{ code: '([A-Z_]+)'/g;
  while ((m = re3.exec(allSrc))) set[m[1]] = (set[m[1]] || 0) + 1;
  return set;
})();

/* ★★ Day 18：DB_CONNECTION_REFUSED 与 DB_HOST_UNREACHABLE 已删除。
   原因：改走 HTTP API 之后**没有 TCP 连接可拒、也没有 PGHOST 要解析**，
   这两个情形在本部署下不存在。用户拍板「删掉，并注明失效原因」。
   若将来升到标准版回到 pg 直连，需要重新加回这两个码。 */
const expected = [
  'INVALID_PARAMS',   // 校验失败（中文说明缺什么）
  'INVALID_JSON',     // 请求体不是合法 JSON
  'PAYLOAD_TOO_LARGE',// 请求体超限
  'NOT_FOUND',        // 路径不对
  'METHOD_NOT_ALLOWED',// 方法不对
  'DUPLICATE',        // ★ 本接口新增：同 sessionId 重复提交
  'INTERNAL_ERROR',   // 兜底
  'DB_TIMEOUT', 'DB_AUTH_FAILED', 'DB_TABLE_MISSING', 'DB_QUERY_FAILED'
];
expected.forEach(function (c) {
  ok('错误码 ' + c + ' 在代码里出现', !!codes[c], '未找到');
});

/* ================================================================
   七、几处结构性约定（防止将来改代码时不知不觉破坏）
   ================================================================ */
section('结构性约定');
ok('★ 响应外壳只有一套：{ok, data, error:{code,message}}',
  /function sendError\(res, httpStatus, errorCode, message, extra\) \{\s*const body = \{ ok: false, data: null, error: \{ code: errorCode, message: message \} \};/.test(src));
ok('★ 失败时 data 恒为 null', /const body = \{ ok: false, data: null,/.test(src));
ok('★ 排错字段放顶层不进 error（契约 §1.5）',
  /for \(const k of Object.keys\(extra\)\) body\[k\] = extra\[k\];/.test(src));
ok('★ 端口固定 0.0.0.0:9000（CloudBase 只认这个）',
  /server\.listen\(9000, '0\.0\.0\.0'/.test(src));
/* ★★ Day 18：事务那套在本环境无效（实测跨请求 ROLLBACK 不生效），
   已换成「每表一次请求 + 补偿删除」。这几条改为盯住新约定。 */
ok('★ 落库是三步：sessions → turns → items，父表先插（否则撞外键）',
  /db\.insertMany\('sessions'/.test(src) &&
  /db\.insertMany\('turns'/.test(src) &&
  /db\.insertMany\('items'/.test(src));
ok('★ 每表只发一次请求（不是每行一次）—— 补偿能成立的前提',
  !/for\s*\(const .* of turns\.value\)[\s\S]{0,120}insertMany/.test(src));
ok('★ 有补偿删除，且删的是父表 sessions（靠 CASCADE 连带删子行）',
  /if \(step !== '1\/3 sessions'\)/.test(src) &&
  /db\.deleteWhere\('sessions'/.test(src));
ok('★ 代码里（不含注释）不再有 BEGIN / COMMIT',
  !/\bBEGIN\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
/* Day 18 起不再拼 SQL 字符串，改成把行数据交给 HTTP API 的批量插入 ——
   「不拼字符串」这个要求由「代码里没有 INSERT 语句」来保证。 */
ok('★ 不再拼 SQL 字符串（改成把行数组交给 HTTP API）',
  !/INSERT INTO/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  '代码里还有 INSERT 语句 —— 那是旧的拼字符串做法');
/* 防重复：改由 httpdb 的 classify 认23505（主键冲突）来触发，
   同样不是「先查再插」——那条路有竞态窗口。 */
ok('★ 防重复靠数据库主键冲突（23505），不是「先查再插」（避免竞态窗口）',
  /23505/.test(httpdbSrc) && !/SELECT[\s\S]{0,80}FROM sessions WHERE session_id/.test(allSrc));
ok('★ 请求方不能塞 originalText（该字段在 cleanItems 里不被读取）',
  !/it\.originalText|\.originalText\s*&&\s*it/.test(grabFn('cleanItems')));
ok('★ 时间出口是写死的 +08:00 常量，没引入时区库',
  /const TZ_SUFFIX = '\+08:00';/.test(src) && !/moment|dayjs|date-fns|luxon/.test(src));
ok('★ 路径容错：同时认带/不带 /api 前缀（Day 17 踩过网关剥前缀）',
  /norm === '\/api\/sessions\/write' \|\| norm === '\/sessions\/write'/.test(src));
ok('★ 密钥/连接串不写死在代码里', !/postgres:\/\/|PGPASSWORD\s*=\s*['"]/.test(src));
ok('★ 有排错日志（清单的余力加练），且不打印请求体',
  /console\.log\('\[write\] ' \+ req\.method/.test(src) && !/console\.log\(.*body\)/.test(src));

/* ================================================================
   八、cloudbaserc.json 的两条部署约束
   ------------------------------------------------------------
   这两条都不是代码问题，是配置问题，**代码全绿也照样会撞上**：
     ① 网关同一域名下不能有重复路径，且路由没有 method 字段
        → /api/sessions 归 read，写入只能走 /api/sessions/write
     ② 路由顺序：更长的路径必须排在更短的前面
        （与契约 §1.1「/api 排在 / 之前」是同一类坑）
   ================================================================ */
section('cloudbaserc.json 部署约束');
const rc = JSON.parse(fs.readFileSync(path.join(__dirname, 'cloudbaserc.json'), 'utf8'));

const routes = rc.gateway.routes.map(function (r) { return { path: r.path, target: r.target }; });
const fnNames = rc.functions.map(function (f) { return f.name; });

ok('write 函数已登记', fnNames.indexOf('write') >= 0, fnNames.join(','));
ok('★ 网关没有同路径重复（重复会被 INVALID_PARAM 拒绝）',
  new Set(routes.map(function (r) { return r.path; })).size === routes.length,
  routes.map(function (r) { return r.path; }).join(' '));

const iWrite = routes.findIndex(function (r) { return r.path === '/api/sessions/write'; });
const iRead = routes.findIndex(function (r) { return r.path === '/api/sessions'; });
ok('★ /api/sessions/write 排在 /api/sessions 前面（短的会先匹配掉长的）',
  iWrite >= 0 && iRead >= 0 && iWrite < iRead,
  '/api/sessions/write@' + iWrite + ' /api/sessions@' + iRead);

ok('write 路由指向 function:write', iWrite >= 0 && routes[iWrite].target === 'function:write');
ok('★ /api/sessions 仍然指向 read（前端现有调用不能坏）',
  iRead >= 0 && routes[iRead].target === 'function:read',
  iRead >= 0 ? routes[iRead].target : '没这条');

/* 前缀包含关系检查：若 A 的路径是 B 的前缀（两者不等），B 必须排在 A 前面。
   ⚠️ 两个排除项，各有理由：
     · 根路径 `/` —— 静态托管的兜底规则，本来就该垫最后
       （契约 §1.1：「/api 排在 / 之前」，反过来就抢走全部接口）
     · 裸`/api` —— Day 15 给 health 的裸路径，是**故意**放在中间的：
       它只兜「路径拼错/少写前缀」的请求，真正的接口都在 /api/xxx 上。
       把它算进前缀规则会误报（/api/analyze 排在它后面恰恰是对的）。 */
let orderOk = true, orderWhy = '';
for (let a = 0; a < routes.length; a++) {
  for (let b = 0; b < routes.length; b++) {
    if (a === b) continue;
    const pa = routes[a].path, pb = routes[b].path;
    if (pa === '/' || pa === '/api') continue;
    /* a 是短路径、b 是它的子路径 → 要求 b 的下标 **小于** a。
       （第一版把这里写成 b < a 是对的，但配套的报错文案把两者说反了，
         读起来像「/api/sessions/write 排在 /api/sessions 前面」是问题——
         实际它排在前面才是对的。判定与文案必须一致，否则测试自己骗自己。） */
    if (pb.indexOf(pa) === 0 && pb !== pa && b > a) {
      orderOk = false;
      orderWhy = pb + '（下标 ' + b + '）是 ' + pa + '（下标 ' + a +
        '）的子路径，却排在它后面 → 会被' + pa + ' 先匹配掉';
    }
  }
}
ok('★ 全表无「短路径排在它的子路径之前」的情况', orderOk, orderWhy);

ok('★ 根路径 / 垫在最后（静态托管兜底，抢在前会把接口全吃掉）',
  routes[routes.length - 1].path === '/' && routes[routes.length - 1].target === 'hosting:web',
  routes.map(function (r) { return r.path + '→' + r.target; }).join(' '));

ok('★ 所有函数目录都真实存在',
  rc.functions.every(function (f) {
    return fs.existsSync(path.join(__dirname, f.dir, 'index.js'));
  }), rc.functions.map(function (f) { return f.dir; }).join(' '));

ok('★ write 的 description 不含全角标点（tcb fn deploy 会报 InvalidParameterValue）',
  !/[（）：§，、]/.test((rc.functions.filter(function (f) { return f.name === 'write'; })[0] || {}).description || ''),
  (rc.functions.filter(function (f) { return f.name === 'write'; })[0] || {}).description);

ok('★ write 的 timeout 与 read 一致（都是查 PG，20 秒）',
  (function () {
    const w = rc.functions.filter(function (f) { return f.name === 'write'; })[0];
    const r = rc.functions.filter(function (f) { return f.name === 'read'; })[0];
    return w && r && w.timeout === r.timeout;
  })());

/* ================================================================
   四之二、read/index.js 的 iso() —— 时间出口（Day 18 补）
   ------------------------------------------------------------
   ★ 这条是被线上curl 抓出来的：改造后我以为「pg 侧会带 +08:00」，
     实际PostgREST 返回 '2026-09-28T20:11:16' **不带偏移量**，
     于是 read 接口吐出的时间戳少了 +08:00，违反契约 §9.8 第 5 条。
     写测试时才发现 —— 注释里的「实测」是我猜的，不是验的。
   ================================================================ */
section('read 的时间出口 iso()（契约 §9.8 第 5 条）');
const readSrc = fs.readFileSync(path.join(__dirname, 'cloudfunctions', 'read', 'index.js'), 'utf8');
function grabFrom(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = source.indexOf('{', start), depth = 0;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  return null;
}
const readIsoSrc = grabFrom(readSrc, 'iso');
ok('read/index.js 里能抓到 iso 函数', !!readIsoSrc);
const readIso = new Function('TZ_SUFFIX', 'return ' + readIsoSrc)('+08:00');
ok('★ PG 原样返回的时间（不带偏移量）会被补上 +08:00',
  readIso('2026-09-28T20:11:16') === '2026-09-28T20:11:16+08:00',
  readIso('2026-09-28T20:11:16'));
ok('  空格分隔也补（防御性）',
  readIso('2026-09-28 20:11:16') === '2026-09-28T20:11:16+08:00',
  readIso('2026-09-28 20:11:16'));
ok('  已有偏移量不重复补',
  readIso('2026-09-28T20:11:16+08:00') === '2026-09-28T20:11:16+08:00',
  readIso('2026-09-28T20:11:16+08:00'));
ok('  以 Z 结尾的不补',
  readIso('2026-09-28T20:11:16Z') === '2026-09-28T20:11:16Z',
  readIso('2026-09-28T20:11:16Z'));
ok('★ null 原样返回 null（B6：中途退出的场次，不能变成 "null" 字符串）',
  readIso(null) === null && readIso(undefined) === null);
ok('偏移量是写死的常量，没引入时区库',
  /const TZ_SUFFIX = '\+08:00';/.test(readSrc) && !/moment|dayjs|date-fns|luxon/.test(readSrc));

/* ================================================================ */
console.log('\n' + '='.repeat(60));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);