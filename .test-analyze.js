/* 本地单测：只验三条硬约束的落地，不调模型。
   为什么能单独测：三条约束都在 normalizeIssue / pickOriginal 里，
   是纯函数—— 不发网络请求。模型那部分是另一个风险面。
   ★ 这是 Day 19 实测踩出来的：三条约束靠肉眼读代码看不出漏没漏。 */

const path = require('path');
const src = fs_read(path.join(__dirname, 'cloudfunctions', 'analyze', 'index.js'));

/* index.js 是个启动即监听 9000 的服务，没导出任何函数。
   为了能测纯函数，这里用源码文本抽取的方式：把 normalizeIssue /
   pickOriginal / normalizeGood / extractJSON 四段抠出来 eval。
   ★ 为什么不改成 module.exports：云函数入口不需要导出，
     为了测试改结构会与chat/index.js 不一致（那边也没有导出）。 */
function fs_read(p) { return require('fs').readFileSync(p, 'utf8'); }

function grabFn(name) {
  /* 匹配「function name(」到下一个顶层「}」——
     本文件的函数都不含嵌套的顶层大括号歧义，逐字符配平更稳。 */
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数 ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error('函数 ' + name + ' 的大括号没配平');
}

const pickOriginal = eval('(' + grabFn('pickOriginal') + ')');
const normalizeIssue = eval('(' + grabFn('normalizeIssue') + ')');
const normalizeGood = eval('(' + grabFn('normalizeGood') + ')');

/* ---------- 测试夹具 ---------- */
const TRANSCRIPT = [
  { turn: 1, userText: "We're two days behind on the API because the spec changed.", aiText: 'Which part exactly?' },
  { turn: 2, userText: "We have some issues but I think it's ok.", aiText: 'Issues or ok?' },
  { turn: 3, userText: "I still think we can make Friday.", aiText: 'Why?' },
  { turn: 4, userText: "By the way, I really like the coffee machine on the third floor.", aiText: 'Nice.' },
  { turn: 5, userText: "", aiText: 'Take your time.' },
  { turn: 6, userText: "I need more clarity on the scope.", aiText: 'What is unclear?' }
];
const byTurn = {};
TRANSCRIPT.forEach((t) => { byTurn[t.turn] = t; });

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ← ' + extra : '')); }
}

console.log('\n【硬约束 1】原文必须按 turn 编号原样取回');
{
  /* 模型返回 turn=2，originalText 应该等于 transcript[2].userText 原文 */
  const r = normalizeIssue({ turn: 2, type: 'logic', reminder: 'x', correction: 'Fixed.' }, byTurn, false);
  ok('turn=2 取出原文且与 transcript 一致',
    r && r.originalText === "We have some issues but I think it's ok.",
    r && JSON.stringify(r.originalText));
  ok('原文里那些语法毛病原样保留（没被模型改通顺）',
    r && r.originalText.indexOf("I think it's ok") >= 0);
}
{
  /* ★ 最关键的一条：模型编一个不存在的 turn，必须被丢弃 */
  const r = normalizeIssue({ turn: 99, type: 'logic', reminder: 'x', correction: 'Y.' }, byTurn, false);
  ok('模型编造 turn=99 → 整条丢弃（返回 null）', r === null, '实际 ' + JSON.stringify(r));
}
{
  /* turn 存在但用户那轮没说话 → 无原句可取 → 丢弃 */
  const r = normalizeIssue({ turn: 5, type: 'logic', reminder: 'x', correction: 'Y.' }, byTurn, false);
  ok('turn=5 用户没发言 → 丢弃', r === null, '实际 ' + JSON.stringify(r));
}
{
  /* 模型若自己在 originalText 里塞了改写，必须被无视（我们只认 turn） */
  const r = normalizeIssue(
    { turn: 2, type: 'logic', reminder: 'x', correction: 'Y.',
      originalText: 'We have some issues, but I think it is OK.' },
    byTurn, false);
  ok('模型塞的 originalText 被无视，用的还是 transcript 原文',
    r && r.originalText === "We have some issues but I think it's ok.");
}

console.log('\n【硬约束 2】偏题 correction 强制 null');
{
  const r = normalizeIssue({ turn: 4, type: 'offtopic', reminder: 'x', correction: 'Should have stayed on topic.' }, byTurn, false);
  ok('模型给了 correction 也强制置 null',
    r && r.correction === null, '实际 ' + JSON.stringify(r && r.correction));
  ok('偏题条目正常产出（type + 原文都在）',
    r && r.type === 'offtopic' && r.originalText.indexOf('coffee machine') > 0);
}

console.log('\n【硬约束 B7】逻辑错误必须有改法');
{
  const r = normalizeIssue({ turn: 2, type: 'logic', reminder: 'x', correction: '' }, byTurn, false);
  ok('logic 但 correction 为空 → 丢弃（不产出没改法的条目）',
    r === null, '实际 ' + JSON.stringify(r));
}
{
  const r = normalizeIssue({ turn: 2, type: 'logic', reminder: 'x', correction: "We're two days behind, but we can still make Friday." }, byTurn, false);
  ok('logic 且有改法 → 正常产出', r && r.correction.indexOf('two days behind') >= 0);
}

console.log('\n【硬约束 3】FREE 强制丢弃偏题');
{
  const r = normalizeIssue({ turn: 4, type: 'offtopic', reminder: 'x' }, byTurn, true);
  ok('FREE 下偏题条目被丢弃', r === null, '实际 ' + JSON.stringify(r));
}
{
  const r = normalizeIssue({ turn: 2, type: 'logic', reminder: 'x', correction: 'Z.' }, byTurn, true);
  ok('FREE 下逻辑错误仍保留', r !== null && r.type === 'logic');
}

console.log('\n【type 归一化】模型写错拼写时不该丢条目');
{
  const a = normalizeIssue({ turn: 4, type: 'off_topic', reminder: 'x' }, byTurn, false);
  ok('off_topic → 归一化成 offtopic（不丢弃）', a && a.type === 'offtopic');
  const b = normalizeIssue({ turn: 4, type: 'off-topic', reminder: 'x' }, byTurn, false);
  ok('off-topic → 归一化成 offtopic', b && b.type === 'offtopic');
  const c = normalizeIssue({ turn: 4, type: 'something_weird', reminder: 'x' }, byTurn, false);
  ok('契约外的 type → 丢弃', c === null);
}

console.log('\n【精彩句子】');
{
  const g = normalizeGood({ turn: 6 }, byTurn);
  ok('turn=6 → 取出原文', g && g.originalText === "I need more clarity on the scope.");
  ok('有 reminder（展示层需要）', g && typeof g.reminder === 'string' && g.reminder.length > 0);
  const bad = normalizeGood({ turn: 99 }, byTurn);
  ok('编造的 turn → 丢弃', bad === null);
}

console.log('\n【B10】没发现问题不硬凑');
{
  /* noIssueFound 的判定在主流程里，纯函数测不到；
     这里能验的是「一条都不产出时不会凭空造出来」——
     把 byTurn 清空，所有条目都该被丢弃。 */
  const empty = {};
  const r = normalizeIssue({ turn: 2, type: 'logic', reminder: 'x', correction: 'Y.' }, empty, false);
  const g = normalizeGood({ turn: 1 }, empty);
  ok('transcript 为空时既不产issue 也不产精彩句子', r === null && g === null);
}

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail > 0 ? 1 : 0);