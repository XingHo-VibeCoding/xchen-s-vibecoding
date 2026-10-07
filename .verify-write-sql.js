/* 用云函数自己算出的参数，跑它生成的那三条 INSERT（Day 18 · 板块③）
   -------------------------------------------------------------
   为什么要有这个文件：今天云函数连不上库，线上那三个用例只能验到校验层。
   但「SQL 本身对不对、能不能真落库」这件事**仍然要验**，
   而 `tcb db execute` 能直连 PG —— 它走的是控制台那条路，不受云函数 VPC 限制。

   ★ 关键设计：参数**不是在这里手写的**，而是从 write/index.js 里把
     纯函数抽出来跑一遍得到的。手工抄一遍参数就失去了意义 ——
     抄错了也照样能插进去，验的就不是被测代码写出的东西了。

   它验什么、不验什么：
     ✓ SQL 语法对不对、CHECK 约束会不会挡、三张表的父子顺序、字段映射
     ✗ 云函数到数据库的网络（那个只能等升级环境）
     ✗ DUPLICATE 分支（同一条记录插两次才行，得云函数能连库）
   用法：node .verify-write-sql.js  （把生成的 SQL 打出来，复制给 tcb db execute） */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'cloudfunctions', 'write', 'index.js'), 'utf8');

function findBodyEnd(start) {
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return j; }
  }
  throw new Error('大括号没配平');
}
function grabFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('没找到函数 ' + name);
  return src.slice(start, findBodyEnd(start) + 1);
}
function grabConst(name) {
  const m = src.match(new RegExp('const ' + name + ' = ([^;]+);'));
  if (!m) throw new Error('没找到常量 ' + name);
  return m[1];
}

const CONSTS = {
  MAX_USER_TEXT: grabConst('MAX_USER_TEXT'),
  MAX_AI_TEXT: grabConst('MAX_AI_TEXT'),
  MAX_REMINDER: grabConst('MAX_REMINDER')
};
const CN = Object.keys(CONSTS);
function build(bodySrc, deps) {
  deps = deps || [];
  return new Function(...CN, ...deps, ';return ' + bodySrc)(
    ...CN.map((k) => CONSTS[k]), ...deps.map((k) => FNS[k]));
}
const FNS = {};
FNS.pad2 = build(grabFn('pad2'));
FNS.parseLocalTs = build(grabFn('parseLocalTs'), ['pad2']);
FNS.secondsBetween = build(grabFn('secondsBetween'));
FNS.validTopicId = build(grabFn('validTopicId'));
FNS.cleanTranscript = build(grabFn('cleanTranscript'));
FNS.cleanItems = build(grabFn('cleanItems'));
FNS.newItemId = build(grabFn('newItemId'));

/* SQL 常量直接从源码里抠出来（它们就是云函数执行的那几条，不是重写的） */
function grabSql(name) {
  const start = src.indexOf('const ' + name + ' = `');
  if (start < 0) throw new Error('没找到 SQL ' + name);
  const from = src.indexOf('`', start) + 1;
  const to = src.indexOf('`', from);
  return src.slice(from, to);
}
const SQL_SESSION = grabSql('SQL_INSERT_SESSION');
const SQL_TURN = grabSql('SQL_INSERT_TURN');
const SQL_ITEM = grabSql('SQL_INSERT_ITEM');

/* ---------- 造一个请求，走一遍云函数的数据加工 ---------- */
const REQUEST = {
  sessionId: 'S-D18-VERIFY-01',
  topicId: 'T1',
  nickname: '小陈',
  startedAt: '2026-10-07T20:11:16+08:00',
  endedAt: '2026-10-07T20:14:20+08:00',
  isComplete: true,
  transcript: [
    { turn: 1, userText: "We're two days behind on the API.", aiText: 'Which part exactly?' },
    { turn: 2, userText: 'The backend part. I think we can finish it.', aiText: 'Finish it by when?' }
  ],
  items: [
    { turn: 2, type: 'logic', reminder: '先说落后又说能做完', correction: 'The backend part is two days behind, but we can make Friday.' }
  ]
};

const topic = FNS.validTopicId(REQUEST.topicId);
if (topic.err) throw new Error(topic.err);
const started = FNS.parseLocalTs(REQUEST.startedAt, 'startedAt');
if (started.err) throw new Error(started.err);
const ended = FNS.parseLocalTs(REQUEST.endedAt, 'endedAt');
if (ended.err) throw new Error(ended.err);

const turns = FNS.cleanTranscript(REQUEST.transcript);
if (turns.err) throw new Error(turns.err);
const byTurn = {};
turns.value.forEach((t) => { byTurn[t.turn] = t; });
const items = FNS.cleanItems(REQUEST.items, byTurn, topic.value === 'FREE');
if (items.err) throw new Error(items.err);

const durationSeconds = FNS.secondsBetween(started.text, ended.text);
let errorCount = 0, goodSentenceCount = 0;
items.value.forEach((it) => { if (it.type === 'good') goodSentenceCount++; else errorCount++; });

/* ---------- 生成可执行的 SQL（把 $n 换成字面量，仅用于本次验证） ---------- */
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function fill(sql, params) {
  return sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
}

const lines = [];
lines.push('-- 由 .verify-write-sql.js 从 cloudfunctions/write/index.js 里抠出来的同款SQL 生成');
lines.push('-- sessionId: ' + REQUEST.sessionId);
lines.push('');

const ps = [REQUEST.sessionId, topic.value, REQUEST.nickname, started.text, ended.text,
  durationSeconds, errorCount, goodSentenceCount, turns.value.length, true];
lines.push('-- 1/4  sessions（汇总）');
lines.push(fill(SQL_SESSION, ps).replace(/\s+/g, ' ').trim() + ';');

let i = 0;
for (const t of turns.value) {
  i++;
  const pt = [REQUEST.sessionId, t.turn, t.userText, t.aiText, t.timestamp, t.askedFollowUp];
  lines.push('');
  lines.push('-- 2/4  turns 第 ' + i + ' 行');
  lines.push(fill(SQL_TURN, pt).replace(/\s+/g, ' ').trim() + ';');
}

const createdAt = ended.text;
let seq = 0;
for (const it of items.value) {
  seq++;
  const pi = [FNS.newItemId(REQUEST.sessionId, it.type, seq), REQUEST.sessionId, topic.value,
    it.type, it.turn, it.originalText, it.reminder, it.correction, createdAt];
  lines.push('');
  lines.push('-- 3/4  items 第 ' + seq + ' 行');
  lines.push(fill(SQL_ITEM, pi).replace(/\s+/g, ' ').trim() + ';');
}

lines.push('');
lines.push('-- 4/4  读回复核（应返回 1 行 1 场）');
lines.push("SELECT session_id, topic_id, nickname, duration_seconds, error_count, good_sentence_count, turn_count, is_complete FROM sessions WHERE session_id = '" + REQUEST.sessionId + "';");
lines.push('');
lines.push('-- 三张表的行数应各为 1 / ' + turns.value.length + ' / ' + items.value.length);
lines.push("SELECT (SELECT count(*) FROM sessions  WHERE session_id = '" + REQUEST.sessionId + "') AS n_sessions,");
lines.push("       (SELECT count(*) FROM turns    WHERE session_id = '" + REQUEST.sessionId + "') AS n_turns,");
lines.push("       (SELECT count(*) FROM items    WHERE session_id = '" + REQUEST.sessionId + "') AS n_items;");
lines.push('');
lines.push('-- 重复提交同一条会撞主键（模拟 DUPLICATE）');
lines.push("INSERT INTO sessions (session_id, topic_id, started_at) VALUES ('" + REQUEST.sessionId + "', 'T1', '2026-10-07 20:11:16');");

const out = lines.join('\n');
console.log(out);
fs.writeFileSync(path.join(__dirname, '.workbuddy', 'verify-write-sql.sql'), out, 'utf8');
console.log('\n-- 已写入 .workbuddy/verify-write-sql.sql（未自动执行，落库前请自己看一眼）');