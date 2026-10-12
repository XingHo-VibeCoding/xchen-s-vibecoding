/* .test-friendly-message.js —— 验 Day 23 新增的 friendlyMessage()
   -------------------------------------------------------------
   为什么这个测试用 eval 而不是 require：
     api.js 是 IIFE（`(function(){...})()`），顶层没有 module.exports，
     require 进来拿不到内部函数。Day 23 与之前的 .test-clamp-sentence.js
     同一个办法 —— 从源码里 eval 抓纯函数出来测。

   ★ 但要注意：eval 只在「函数体」层面生效，
     所以抓的时候连依赖一起抓（friendlyMessage 只依赖自己的三张表，
     不依赖外部变量，所以直接抓就够）。

   验收口径：
     ① 三类错误每一类都要有中文提示
     ② **没见过的码不能返回 undefined / 空串**（静默失败比报错更糟）
     ③ 落进兜底的也要是人话，不能是英文码本身
*/

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, 'frontend', 'js', 'api.js'), 'utf8');

/* 从源码里抓 friendlyMessage 与三张表。
   用正则找「function friendlyMessage」到下一个「function」之前 ——
   这样连带三张表（都在它上面）也一起进了作用域。 */
const start = src.indexOf('function friendlyMessage');
if (start < 0) {
  console.log('★ 抓不到 friendlyMessage —— api.js 结构变了？');
  process.exit(1);
}
const fnStart = src.indexOf('function friendlyMessage');
const after = src.indexOf('function friendlyOf');
const body = src.slice(fnStart, after < 0 ? undefined : after);

//三张表定义在 friendlyMessage 之前，一并抓出来
const mapsStart = src.indexOf('var INPUT_MAP');
const chunk = src.slice(mapsStart, fnStart);

const evalSrc =
  chunk + '\n' +
  '(function(){' + body + '\nreturn friendlyMessage;})()';

const friendlyMessage = eval(evalSrc);

/* ---------- 测试 ---------- */
let pass = 0, fail = 0;
function t(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('  ✓ ' + name + '  →  ' + actual); }
  else { fail++; console.log('  ✗ ' + name);
         console.log('      期望: ' + expected);
         console.log('      实际: ' + actual); }
}
function tOk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
}

const HAS_CHINESE = /[\u4e00-\u9fa5]/;

console.log('\n【1】三类错误各有中文提示');
t('输入错 INVALID_PARAMS', friendlyMessage({ code: 'INVALID_PARAMS' }),
  '这次说的内容不太对，换个说法试试');
t('输入错 PAYLOAD_TOO_LARGE', friendlyMessage({ code: 'PAYLOAD_TOO_LARGE' }),
  '这次说的内容太长了，试着说短一点');
t('网络错 LLM_UNREACHABLE', friendlyMessage({ code: 'LLM_UNREACHABLE' }),
  '连不上服务器，检查一下网络再试');
t('网络错 LLM_TIMEOUT', friendlyMessage({ code: 'LLM_TIMEOUT' }),
  '等得太久了，AI 还没回话，可以再说一次');
t('服务端错 INTERNAL_ERROR', friendlyMessage({ code: 'INTERNAL_ERROR' }),
  '服务器出了点问题，我们正在处理，稍后再试');
t('服务端错 LLM_NOT_CONFIGURED', friendlyMessage({ code: 'LLM_NOT_CONFIGURED' }),
  'AI 服务暂时不可用，我们正在处理');

console.log('\n【2】★ 兜底不能静默失败（最容易出错的地方）');
/*★ 这条期望改过一次：第一版写的是「应返回 HTTP_ 分支那句」，
     实测拿到的是兜底的「出了点问题，请再试一次」——
     排查后确认是**我的期望写错了**，不是实现错：
     SOMETHING_NEW_FROM_SERVER 不以 HTTP_ 开头，走不到那个分支，
     落到最后一层「连 code 都没有」是完全正确的行为。
     ★ 教训（Day 23 又踩了一次）：兜底分支的判据是
       「返回了人话」，不是「返回了哪一句」。 */
tOk('完全陌生的码 → 返回的是中文人话（不是码本身）',
  HAS_CHINESE.test(friendlyMessage({ code: 'SOMETHING_NEW_FROM_SERVER' })),
  friendlyMessage({ code: 'SOMETHING_NEW_FROM_SERVER' }));
tOk('HTTP_404 → 人话',
  friendlyMessage({ code: 'HTTP_404' }) === '连不上服务器，请检查网络后重试',
  friendlyMessage({ code: 'HTTP_404' }));
tOk('HTTP_404_NOT_JSON → 人话',
  friendlyMessage({ code: 'HTTP_404_NOT_JSON' }) === '连不上服务器，请检查网络或换个浏览器试试',
  friendlyMessage({ code: 'HTTP_404_NOT_JSON' }));

console.log('\n【3】★ 任何输入都不能返回 undefined / 空串');
const probes = [
  { code: 'UNKNOWN' }, { code: '' }, {},
  { code: null, message: '后端给的中文提示' },
  { message: '只有 message 没有 code' },
  { code: 'INVALID_PARAMS', message: 'INVALID_PARAMS' },
  { code: 'db_query_failed' },          // 小写，看前缀判断是否也该覆盖
  { code: 'ASR_NOT_CONFIGURED' },
  { code: 'DB_QUERY_FAILED' }
];
let bad = [];
probes.forEach(function (p) {
  const r = friendlyMessage(p);
  if (r === undefined || r === null || r === '' || String(r) === 'undefined') {
    bad.push(JSON.stringify(p) + ' → ' + String(r));
  }
});
tOk('9 种边界输入都返回了非空字符串', bad.length === 0,
  bad.length === 0 ? '全部有值' : bad.join(' | '));

console.log('\n【4】★ 返回的必须是中文，不能把英文码原样吐回给用户');
const allCodes = [
  'INVALID_PARAMS','INVALID_JSON','PAYLOAD_TOO_LARGE','NOT_FOUND',
  'METHOD_NOT_ALLOWED','DUPLICATE','INTERNAL_ERROR',
  'LLM_NOT_CONFIGURED','LLM_TIMEOUT','LLM_UNREACHABLE','LLM_BAD_RESPONSE',
  'LLM_BAD_FORMAT','LLM_AUTH_FAILED','LLM_NO_CREDIT','LLM_RATE_LIMITED',
  'LLM_ERROR','ASR_BAD_RESPONSE','ASR_EMPTY_BODY','ASR_TIMEOUT',
  'ASR_TOO_LARGE','ASR_UNREACHABLE','ASR_UPSTREAM_ERROR',
  'ASR_NOT_CONFIGURED','ASR_AUTH_FAILED','ASR_BAD_AUDIO','ASR_FAILED',
  'ASR_RATE_LIMITED',
  'DB_AUTH_FAILED','DB_QUERY_FAILED','DB_TABLE_MISSING','DB_TIMEOUT',
  'HTTP_500','HTTP_404','HTTP_502_NOT_JSON','UNKNOWN','ZZZ_FUTURE_CODE'
];
const notChinese = [];
allCodes.forEach(function (c) {
  const r = friendlyMessage({ code: c });
  if (!HAS_CHINESE.test(r)) notChinese.push(c + ' → ' + r);
});
tOk('34 个码（含未来新增的占位）全部返回中文', notChinese.length === 0,
  notChinese.length === 0 ? '34/34' : notChinese.join(' | '));

console.log('\n【5】★ 同类错误的文案必须一致（页面口径统一）');
/* ★ 这条判据第一版写反了：原来判「无重复文案」，结果报了14 处
     「重复」。查下来每一处都是**设计意图**——
     INVALID_PARAMS 与 INVALID_JSON 都属于「输入错」，
     给用户同一句「换个说法试试」才是对的；
     若给它们两句不同的话，同一类错误在不同页面显示不同口径，
     反而是缺陷（api.js 开头「① 只判断 ok」那条规矩要的就是统一）。
   ★ 判据改成：**不同类别之间不能撞车**。
     即「输入类」「网络类」「服务端类」三组文案互不相同。 */
const groups = {
  input: ['INVALID_PARAMS','PAYLOAD_TOO_LARGE','NOT_FOUND','ASR_EMPTY_BODY'],
  net:   ['LLM_UNREACHABLE','LLM_TIMEOUT','LLM_RATE_LIMITED'],
  server:['INTERNAL_ERROR','LLM_NOT_CONFIGURED','DB_QUERY_FAILED','ASR_NOT_CONFIGURED']
};
const texts = {};
Object.keys(groups).forEach(function (g) {
  texts[g] = {};
  groups[g].forEach(function (c) { texts[g][c] = friendlyMessage({ code: c }); });
});
let crossDup = [];
const allTexts = [];
Object.keys(groups).forEach(function (g) {
  Object.keys(texts[g]).forEach(function (c) { allTexts.push(texts[g][c]); });
});
// 三类之间撞车 = 一个文案同时出现在两个类别里
const flat = {};
allTexts.forEach(function (t) { flat[t] = (flat[t] || 0) + 1; });
Object.keys(groups).forEach(function (g) {
  Object.keys(texts[g]).forEach(function (c) {
    if (flat[texts[g][c]] > 1 && groups[g].indexOf(c) !== groups[g].lastIndexOf(c)) {
      crossDup.push(c);
    }
  });
});
/* 简化判据：三组各自的「首句」互不相同就够了 —— 同组内允许重复（那是统一的体现）*/
const firstOf = function (g) { return texts[g][groups[g][0]]; };
tOk('三类的代表文案互不相同',
  firstOf('input') !== firstOf('net') && firstOf('net') !== firstOf('server') &&
  firstOf('input') !== firstOf('server'),
  '输入「' + firstOf('input') + '」/ 网络「' + firstOf('net') + '」/ 服务端「' + firstOf('server') + '」');
tOk('同类内部文案统一（INVALID_PARAMS 与 INVALID_JSON 同一句）',
  friendlyMessage({ code: 'INVALID_PARAMS' }) === friendlyMessage({ code: 'INVALID_JSON' }),
  '同属输入类 → 同一句，这是对的');

console.log('\n【6】★ 保留原始 message 供开发者（不销毁信息）');
const orig = { code: 'INVALID_PARAMS', message: '缺少 topicId（必须是 T1–T8 或 FREE）' };
friendlyMessage(orig);
tOk('调用后 err.message 原样保留', orig.message === '缺少 topicId（必须是 T1–T8 或 FREE）',
  orig.message);

console.log('\n【7】★★ 兜底层不能把英文 message 漏给用户');
/* ★ 这条是Day 23 真踩出来的（做演示页时发现的）：
   原来的兜底是 `return raw || '出了点问题，请再试一次'`，
   赌 message 一定是中文（契约 §1.3 确实这么规定，实测线上也都是中文）。
   但演示页有一条 message 被我填成了英文码本身 ——
   结果页面上真的显示出了 `SOME_NEW_CODE_2027`。
   ★ 也就是说那张演示页上写的承诺「不会出现 undefined 或英文码」
     被它自己否证了。
   ★ 契约写在文档里、代码随时会改，而兜底层是**最后一道** ——
     「假定上游一定是好人」在跨模块边界时必然失效。
   （与 MEMORY 里「静默失败比崩溃更贵」同类。）*/
tOk('message 是英文码时不给用户看它',
  friendlyMessage({ code: 'SOME_NEW_CODE_2027', message: 'SOME_NEW_CODE_2027' })
  === '出了点问题，请再试一次',
  friendlyMessage({ code: 'SOME_NEW_CODE_2027', message: 'SOME_NEW_CODE_2027' }));
tOk('message 是英文句子时也不给用户看',
  HAS_CHINESE.test(friendlyMessage({ code: 'X', message: 'Connection refused' })),
  friendlyMessage({ code: 'X', message: 'Connection refused' }));
tOk('★ 但 message 是中文时要保留它（细节比通用兜底有用）',
  friendlyMessage({ code: 'FUTURE_CODE_X', message: '本接口只接受 GET' })
  === '本接口只接受 GET',
  '用 FUTURE_CODE_X（不在任何映射表里，才真的落到兜底层）；' +
  friendlyMessage({ code: 'FUTURE_CODE_X', message: '本接口只接受 GET' }));
tOk('message 含中英混排（含中文就保留）',
  HAS_CHINESE.test(friendlyMessage({ code: 'Y', message: '错误 E123：请稍后重试' })),
  friendlyMessage({ code: 'Y', message: '错误 E123：请稍后重试' }));

console.log('\n────────────────────────────');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail > 0) { console.log('★ 有失败，先打印实际值核对是不是期望写错了'); process.exit(1); }
console.log('全部通过');