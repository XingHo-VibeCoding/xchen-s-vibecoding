/* Day 19：dialogue.html 的 transcriptTurns 配对逻辑
   -------------------------------------------------------------
   ★ 这个 bug 差点上线，而且症状极具误导性（Day 19 实测）：

     原写法按 `i += 2` 等间隔配对，隐含假设「下标 0 一定是 user，
     之后user/ai 严格交替」。8 主题里 AI 一进场就说opening，
     下标 0 恰好是 user，所以一直没暴露。
     但 FREE 模式 AI 不先说话（PRD §6.6），实际数组是：

         ["ai", "user", "ai", "user", "ai", "ai"]
                  ↑ 下标 1 才是 user

     按 i += 2 去看全错位，一个 user 都配不出来 → 转写成空数组 →
     analyze 收不到内容 → 结果页说「没有这一场的对话内容」。

     ★ 为什么这个 bug 这么难被发现：
       ① **界面完全正常** —— 记录区照样逐句显示 AI 说的话，肉眼看不出问题
       ② 报错信息指向 storage ——「没有对话内容」听起来像存储坏了，
          而真正错的是配对逻辑
       ③ 只在 FREE 模式出现 —— 8 主题怎么测都测不出来
       ④ **单测测不出来**：测的是 storage.js 的读写，
          而 bug 在 dialogue.html 里的一个纯函数里

     所以判据必须覆盖「数组从 ai 开始」「连着两个 ai」这些真实形态。

   跑法：node .test-transcript-turns.js
   （从 dialogue.html 源码里抓出 transcriptTurns 来测——
     它在 IIFE 里，不能直接 require；用正则抓函数体保持与页面同源） */
const fs = require('fs');
const path = require('path');

/* ---------- 从 dialogue.html 里把 transcriptTurns 抠出来 ----------
   刻意不复制一份到测试文件里：复制的那份会与页面上的那份分家，
   页面改了测试不会改 —— 那正是这个 bug 逃出去的原因之一。 */
const src = fs.readFileSync(path.join(__dirname, 'frontend', 'pages', 'dialogue.html'), 'utf8');
const m = src.match(/function transcriptTurns\(maxTurns\)\s*\{[\s\S]*?\n      \}/);
if (!m) {
  console.log('✗ 没在 dialogue.html 里找到 transcriptTurns —— 函数名或写法改了，测试要跟着改');
  process.exit(1);
}
/* transcriptTurns 读的是页面 IIFE 里的闭包变量 transcript，
   不是参数、也不是 this。所以测试要**在同一作用域里造一个同名绑定**。

   走过两条弯路，都记在这里免得下次再踩：
     ① .call({transcript: t}, null) —— this 上的属性在函数体里解析不到
        （eval 出来的函数按作用域链找标识符，不查 this）
     ② eval('var transcript; (…)') —— var 声明在当前作用域，
        函数体里的 transcript 解析到的是 eval 自己那个未赋值的 var（undefined），
        外层的赋值反而被遮蔽了

④ 包成函数表达式：eval 里的 `function f(){}` 是**语句**，
        直接拼接会报 "Function statements require a function name"；
        必须写成 `(function f(){…})` 或 `var f = function(…){}`

   做法：把「声明 transcript」与「定义 transcriptTurns」放进**同一个** eval，
   闭包链才连得上。run() 每次重新 eval 一遍，拿到的是全新闭包。 */
function run(list, maxTurns) {
  const arg = (maxTurns === null) ? 'null' : JSON.stringify(maxTurns);
  // 抠出来的原文是 `function transcriptTurns(maxTurns){…}`，
  // 外面再套一层括号就成了函数表达式
  const fnSrc = '(' + m[0] + ')';
  // eslint-disable-next-line no-eval
  return eval('(function(){ var transcript = ' + JSON.stringify(list) + ';\n' +
    '        var transcriptTurns = ' + fnSrc + ';\n' +
    '        return transcriptTurns(' + arg + '); })()');
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   → ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}
function section(t) { console.log('\n' + t); }

/* transcript 里的每一项长这样：{ who: 'user'|'ai', text } */
const U = t => ({ who: 'user', text: t });
const A = t => ({ who: 'ai', text: t });

/* ============================================================ */
section('一、★FREE 真实形态：数组从 ai 开始（这是本 bug 的现场）');
{
  const t = [A('Did they catch you?'), U('I have two cats.'), A('What do they do?'),
             U('They sleep.'), A('Lazy cats.'), A('So, back to the report…')];
  const r = run(t, null);
  eq('两条 user 都被认出', r.length, 2);
  eq('第 1 轮', r[0], { turn: 1, userText: 'I have two cats.', aiText: 'What do they do?' });
  eq('第 2 轮', r[1], { turn: 2, userText: 'They sleep.', aiText: 'Lazy cats.' });
}

section('二、8 主题形态：数组从 user 开始（旧代码碰巧也对的这一种）');
{
  const t = [A("We're a bit behind."), U('The API.'), A('Which part?')].slice(1);
  const r = run(t, null);
  eq('一条', r.length, 1);
  eq('配对正确', r[0], { turn: 1, userText: 'The API.', aiText: 'Which part?' });
}

section('三、★AI 连着说两句（自由对话里沉默催促很常见）');
{
  const t = [U('The API is late.'), A('Which part?'), A('Take your time.'), U('The docs.')];
  const r = run(t, null);
  eq('两条 user', r.length, 2);
  eq('第 1 轮只配第一条 AI（第二条不硬凑）', r[0].aiText, 'Which part?');
  eq('第 2 轮还没等到 AI 回应', r[1].aiText, '');
}

section('四、用户连着说两句（AI 还没回上一句）');
{
  const t = [U('First.'), U('Second.'), A('Both noted.')];
  const r = run(t, null);
  eq('两句都保留', r.length, 2);
  eq('第 1 轮没等到回应 → 空串', r[0].aiText, '');
  eq('第 2 轮拿到回应', r[1].aiText, 'Both noted.');
  ok('★不能把 AI 那句硬塞给上一句（否则 analyze 会读到一条不存在的问答）',
    r[0].aiText === '' && r[1].aiText === 'Both noted.');
}

section('五、开头是 AI、且用户还没说话（点结束得很快的情况）');
{
  const r = run([A('Ready when you are.')], null);
  eq('空数组（那句 AI 不是任何一轮的回应）', r.length, 0);
}
{
  const r = run([], null);
  eq('空数组进 → 空数组出', r.length, 0);
}

section('六、turn 编号必须连续（analyze 靠它引回原句）');
{
  const t = [A('Hi.'), U('One.'), A('ok'), A('and?'), U('Two.'), A('sure'), U('Three.')];
  const r = run(t, null);
  eq('turn 依次是 1 2 3', r.map(x => x.turn), [1, 2, 3]);
  eq('userText 对得上', r.map(x => x.userText), ['One.', 'Two.', 'Three.']);
}

section('七、maxTurns 截断（chat 只取最后 6 轮）');
{
  const t = [];
  for (let i = 1; i <= 10; i++) { t.push(U('S' + i), A('A' + i)); }
  eq('传 6 → 只剩 6 条', run(t, 6).length, 6);
  eq('留的是最后 6 条', run(t, 6)[0].userText, 'S5');
  eq('turn 重新编号（不沿用原下标）',
    run(t, 6).map(x => x.turn), [1, 2, 3, 4, 5, 6]);
  eq('传 null → 全量', run(t, null).length, 10);
}

section('八、原句一个字符都不能动（契约 §4 硬约束 1 的源头）');
{
  const raw = "We have some issues but I think it's ok.";
  const r = run([U(raw), A('Which part?')], null);
  eq('原话原样', r[0].userText, raw);
  ok('没有 trim / 没有补标点', r[0].userText === raw);
}

/* ============================================================ */
console.log('\n' + '='.repeat(48));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(48));
process.exit(fail === 0 ? 0 : 1);