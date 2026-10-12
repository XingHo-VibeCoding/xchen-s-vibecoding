/* Day 23：clampToSentence 与 isVague 的单测
   -------------------------------------------------------------
   为什么单独测这两个：
     - clampToSentence 是**纯函数**（不碰网络、不读环境变量），
       但它决定用户看到的是一句完整话还是半句 —— 直接影响朗读体验。
     - isVague 决定要不要给下一句加「只问一个小点」的约束。
       阈值定错两个方向都有害：太松→ 连问两层；太紧 → 该追问时不追问。

   ★ 这两个函数在 cloudfunctions/chat/index.js 里，那个文件 top-level
     就有 server.listen()，require 进来会真的起一个服务。
     所以照Day 19 的办法：**从源码里把函数源码抓出来 eval**，
     不 require 整个文件。 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, 'cloudfunctions', 'chat', 'index.js'), 'utf8');

/* ---------- 从源码抽取函数 ----------
   eval 时必须包一层 (function(){… return fn;})()：
   直接 eval 里写 return 是非法的（Illegal return statement）。
   ★ 依赖也要一起抓：clampToSentence 不依赖别的，
     isVague 依赖 FILLER_WORDS（模块级常量）——
     只抓函数不抓常量，测试等于在测「我以为的实现」，与生产脱钩。 */
function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('源码里找不到 ' + name);
  let i = SRC.indexOf('{', start), depth = 0, end = -1;
  for (let p = i; p < SRC.length; p++) {
    const c = SRC[p];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) throw new Error(name + ' 的函数体没闭合');
  return SRC.slice(start, end + 1);
}

const clampToSentence = eval('(function(){' +
  extract('clampToSentence') + '; return clampToSentence;})()');

const FILLER_SRC = SRC.match(/const FILLER_WORDS = \/.*?\/i;/s)[0];
const isVague = eval('(function(){' + FILLER_SRC + '\n' +
  extract('isVague') + '; return isVague;})()');

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(desc, cond) {
  if (cond) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc); }
}

console.log('一、clampToSentence —— 截断要落在句子边界上');
ok('不超长原样返回',
  clampToSentence('How is the Shanghai rollout going?', 400) === 'How is the Shanghai rollout going?');
ok('正好等于上限不加省略号',
  clampToSentence('abcd', 4) === 'abcd');

/* ★ 这条用例第 1 轮就写错了，教训记在下面：
     我给maxChars=60，但第一句 "So what I am trying to say is that we should
     probably delay it." 本身就有 63 字符 —— 上限之内**根本不存在
     完整句子**，硬截是唯一正确行为，我却期望「截到第一句后」。
     于是把正确实现判成失败。**期望值写错比代码有 bug 更能误导人。**
   ✓ 真正该验的是：上限之内**有**完整句子时，才走句子边界。 */
const long3 = 'We should delay it. What do you think about that plan?';
const cut3a = clampToSentence(long3, 40);
ok('上限内有完整句子 → 截到句子边界（不是硬切）',
  cut3a === 'We should delay it.…',
  '实际：' + JSON.stringify(cut3a));

/* 上限 40：第一句28 字符（句号在第 27 位），第二句从第 29 位到 49 位
   —— 第二句不完整，所以应该只保留第一句。 */
const long4 = 'One two three four five six. Seven eight nine ten.';
const cut4 = clampToSentence(long4, 40);
ok('上限内有完整句 → 保留它，不越界到下一句',
  cut4 === 'One two three four five six.…',
  '实际：' + JSON.stringify(cut4));

/* 同一段但上限正好等于全文长度（50）→ **不该截断，也不该加省略号**。
   ★ 我第 1 轮把期望写成带「…」的，又是一次期望值写错：
     `s.length <= maxChars` 走的是原样返回分支，这是正确行为。 */
const cut4b = clampToSentence(long4, 50);
ok('上限正好等于全文长度 → 原样返回，不加省略号',
  cut4b === long4,
  '实际：' + JSON.stringify(cut4b));

/* 上限比全文少 1 → 该截，且截到最后一个句号 */
const cut4c = clampToSentence(long4, 49);
ok('上限比全文少 1 → 截到最后一个句号',
  cut4c === 'One two three four five six. Seven eight nine ten.…',
  '实际：' + JSON.stringify(cut4c));

const long2 = 'So what I am trying to say is that we should probably delay it. ' +
  'What do you think about that?';
const cut2 = clampToSentence(long2, 60);
ok('上限内无完整句 → 退到硬截 + 省略号（不是空白）',
  cut2.length <= 61 && cut2.endsWith('…'),
  '实际：' + JSON.stringify(cut2));

const long2b = clampToSentence(long2, 120);
ok('上限够容纳两句 → 全部保留',
  long2b.indexOf('What do you think') >= 0,
  '实际：' + JSON.stringify(long2b));

const noPunct = 'a'.repeat(500);
const cut5 = clampToSentence(noPunct, 100);
ok('通篇没有句号 → 硬截 + 省略号（宁可半句也不要空白）',
  cut5.length === 101 && cut5.endsWith('…'),
  '实际长度：' + cut5.length);

ok('带闭引号时把它一起吃掉（…"…" → 不留半个引号）',
  (function () {
    const t = 'He said "we should delay it." Then he left.';
    const r = clampToSentence(t, 35);
    return r.indexOf('"') >= 0 && r.indexOf('"') === r.lastIndexOf('"') + 1 ||
      r === 'He said "we should delay it."…';
  })());

console.log('');
console.log('二、isVague —— 决定要不要加「只问一个小点」');
ok('空字符串算含糊', isVague('') === true);
ok('undefined 算含糊', isVague(undefined) === true);
ok('4 个词的短答算含糊（A2 真实口语）', isVague('Yeah, I think so.') === true);
ok('长度够且有实词 → 不算含糊',
  isVague('The second part depends on the API integration.') === false);
ok('全是填充词（长度够）→ 算含糊',
  isVague('Yeah well okay maybe I guess sure') === true);
ok('填充词只占少数 → 不算含糊',
  isVague('The budget needs approval from finance first.') === false);
ok('中文也算（用户可能切语言）→ 长度够就不算含糊',
  isVague('我觉得应该先做完前两个功能再考虑第三个。') === false);

console.log('');
console.log('三、两个函数的边界不崩');
ok('超长输入不抛错', (function () {
  try { clampToSentence('a'.repeat(10000), 400); isVague('x'.repeat(10000)); return true; }
  catch (e) { console.log('    抛错：' + e.message); return false; }
})());
ok('截断后长度不超过上限+省略号',
  clampToSentence('One. Two. Three. Four. Five. Six. Seven.', 20).length <= 21);

console.log('');
console.log('=====' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);