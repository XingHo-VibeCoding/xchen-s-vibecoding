/* Day 19：storage.js 新增的「待分析转写」两个方法
   -------------------------------------------------------------
   为什么单测它：这两个方法的全部价值就在「**取走即删**」这一条语义上，
   而那条语义错了不会报错、只会**安静地显示错的东西** ——
   拿上一场的转写当本次结果展示，正是这个产品最不该出的错。
   人眼看代码看不出它对不对，跑一遍断言才放心。

   跑法：node .test-pending-transcript.js
   （与 .test-analyze.js / .test-api-analyze.js 同一个路子：
    用最小环境 eval 源码，不引任何测试框架）                     */

const fs = require('fs');
const path = require('path');

/* ---------- 最小 localStorage 替身 ----------
   真 localStorage 有个特性必须模拟出来：**写满了 setItem 会抛**
   （E8 的由来），无痕模式下访问 localStorage 本身会抛。
   这两个替身分别模拟这两件事。 */
function makeStore(opts) {
  const o = opts || {};
  const data = {};
  return {
    throwOnGet: !!o.throwOnGet,
    throwOnSet: !!o.throwOnSet,
    quotaExhausted: !!o.quotaExhausted,
    getItem(k) { if (this.throwOnGet) throw new Error('SecurityError'); return k in data ? data[k] : null; },
    setItem(k, v) {
      if (this.throwOnSet) throw new Error('SecurityError');
      if (this.quotaExhausted) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = String(v);
    },
    removeItem(k) { if (this.throwOnSet) throw new Error('SecurityError'); delete data[k]; },
    _dump() { return data; }
  };
}

function loadStorage(store) {
  const src = fs.readFileSync(path.join(__dirname, 'frontend', 'js', 'storage.js'), 'utf8');
  global.window = { localStorage: store };
  // eslint-disable-next-line no-new-func
  new Function('window', src)(global.window);
  return global.window.Storage;
}

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   → ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}
function section(t) { console.log('\n' + t); }

/* ============================================================ */
section('一、存进去能原样取出来');
{
  const store = makeStore({});
  const S = loadStorage(store);
  const payload = {
    topicId: 'T1',
    transcript: [
      { turn: 1, userText: "We're a bit behind.", aiText: 'Which part?' },
      { turn: 2, userText: 'The API integration.', aiText: 'Okay.' }
    ]
  };
  eq('savePendingTranscript 返回 true', S.savePendingTranscript(payload), true);

  const got = S.takePendingTranscript();
  ok('取得到对象', !!got);
  eq('topicId 正确', got.topicId, 'T1');
  eq('转写条数正确', got.transcript.length, 2);
  eq('第 1 轮原话没被改', got.transcript[0].userText, "We're a bit behind.");
  eq('第 2 轮 AI 那句也在', got.transcript[1].aiText, 'Okay.');
  eq('turn 序号保住了', got.transcript[1].turn, 2);
}

section('二、★取走即删（这条是整个方法存在的理由）');
{
  const store = makeStore({});
  const S = loadStorage(store);
  S.savePendingTranscript({
    topicId: 'T1',
    transcript: [{ turn: 1, userText: 'hello', aiText: 'hi' }]
  });

  const first = S.takePendingTranscript();
  ok('第一次取得到', !!first);

  const second = S.takePendingTranscript();
  ok('第二次取不到（必须是 null，不能是上一场）', second === null, '实际 ' + JSON.stringify(second));

  ok('键真的从 localStorage 里消失了',
    store.getItem('vibecoding.pendingTranscript') === null);
}

section('三、刷新 / 手输地址 不能读到上一场');
{
  const store = makeStore({});
  const S = loadStorage(store);
  // 模拟：练完一场 → 进结果页（读掉）→ 用户刷新
  S.savePendingTranscript({ topicId: 'T1', transcript: [{ turn: 1, userText: 'a', aiText: 'b' }] });
  S.takePendingTranscript();
  // 刷新后第二次加载页面脚本（等价于重新 eval 一遍）
  const S2 = loadStorage(store);
  eq('重新打开页面读到 null', S2.takePendingTranscript(), null);
}

section('四、没存过 → null，不报错');
{
  const S = loadStorage(makeStore({}));
  eq('空键返回 null', S.takePendingTranscript(), null);
}

section('五、空转写不写键（省一次无用写入）');
{
  const store = makeStore({});
  const S = loadStorage(store);
  eq('transcript 为空数组 → 不写', S.savePendingTranscript({ topicId: 'T1', transcript: [] }), false);
  eq('transcript 缺字段 → 不写', S.savePendingTranscript({ topicId: 'T1' }), false);
  ok('键没有被创建', store.getItem('vibecoding.pendingTranscript') === null);
  eq('取也是 null', S.takePendingTranscript(), null);
}

section('六、E9 读损坏：按「没有」处理，不抛错');
{
  const store = makeStore({});
  store.setItem('vibecoding.pendingTranscript', '{这不是 JSON');
  const S = loadStorage(store);
  let threw = false, got;
  try { got = S.takePendingTranscript(); } catch (e) { threw = true; }
  ok('解析失败不抛错', !threw);
  eq('返回 null', got, null);
}
{
  // 数组不是对象（E9 规则：数组与 null 都视为损坏）
  const store = makeStore({});
  store.setItem('vibecoding.pendingTranscript', '[1,2,3]');
  const S = loadStorage(store);
  eq('数组形态 → null', S.takePendingTranscript(), null);
}
{
  // transcript 字段不是数组
  const store = makeStore({});
  store.setItem('vibecoding.pendingTranscript', '{"topicId":"T1","transcript":"abc"}');
  const S = loadStorage(store);
  eq('transcript 类型不对 → null', S.takePendingTranscript(), null);
}

section('七、★损坏的键读完之后也要消失（防止一直卡住）');
{
  const store = makeStore({});
  store.setItem('vibecoding.pendingTranscript', '坏掉的值');
  const S = loadStorage(store);
  S.takePendingTranscript();
  ok('坏值也被清掉了', store.getItem('vibecoding.pendingTranscript') === null);
}

section('八、E8 写失败：返回 false，不抛错');
{
  const S = loadStorage(makeStore({ quotaExhausted: true }));
  let threw = false, ret;
  try {
    ret = S.savePendingTranscript({ topicId: 'T1', transcript: [{ turn: 1, userText: 'a', aiText: 'b' }] });
  } catch (e) { threw = true; }
  ok('配额满时不抛错', !threw);
  eq('返回 false（调用方据此走「没存成」那条路）', ret, false);
}
{
  // 无痕模式：访问 localStorage 本身就会抛 → store() 返回 null
  const S = loadStorage(makeStore({ throwOnGet: true, throwOnSet: true }));
  let threw = false, ret;
  try {
    ret = S.savePendingTranscript({ topicId: 'T1', transcript: [{ turn: 1, userText: 'a', aiText: 'b' }] });
  } catch (e) { threw = true; }
  ok('localStorage 不可访问时不抛错', !threw);
  eq('返回 false', ret, false);
  eq('取也是 null', S.takePendingTranscript(), null);
}

section('九、topicId 缺失时不报错（旧数据兼容）');
{
  const store = makeStore({});
  store.setItem('vibecoding.pendingTranscript', '{"transcript":[{"turn":1,"userText":"a","aiText":"b"}]}');
  const S = loadStorage(store);
  const got = S.takePendingTranscript();
  ok('取得到', !!got);
  eq('topicId 落空串而不是 undefined', got.topicId, '');
}

section('十、不影响既有四个键（回归）');
{
  const store = makeStore({});
  const S = loadStorage(store);
  S.savePendingTranscript({ topicId: 'T1', transcript: [{ turn: 1, userText: 'a', aiText: 'b' }] });
  S.takePendingTranscript();

  S.bumpPracticeCount('T1');
  S.bumpPracticeCount('T1');
  eq('练习次数照常累加', S.practiceCount('T1'), 2);
  S.togglePin('T3');
  eq('星标照常', S.isPinned('T3'), true);
  S.toggleFavorite('X-1-1-logic', { type: 'logic', topicId: 'T1' });
  eq('收藏照常', S.isFavorite('X-1-1-logic'), true);
  eq('收藏列表照常', S.favoriteIds().length, 1);
  eq('版本号照常', S.schemaVersion(), 1);
}

/* ============================================================ */
console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(46));
process.exit(fail === 0 ? 0 : 1);