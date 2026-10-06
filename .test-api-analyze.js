/* 验api.js 的 analyze 映射：重点验 type 兜底与 fix 的 null/undefined 处理。
   ★ 为什么要单独测：mapItem 里 type 默认值写错，
     所有精彩句子都会被标成「偏题」—— 界面上看起来「有三条偏题」，
     而真实原因只是少传一个参数。这类错肉眼读代码看不出来。 */

const fs = require('fs');
const path = require('path');

/* api.js 是IIFE，挂到 window 上，且直接读 location.hostname。
   在 Node 里没有 window / location / fetch，先补齐最小环境。 */
const win = {};
global.window = win;
global.location = { hostname: '127.0.0.1' };

/* 记录postWithTimeout 发出去的 body，供断言用。 */
let sentUrl = null;
let sentBody = null;
global.fetch = function (url, opt) {
  sentUrl = url;
  sentBody = JSON.parse(opt.body);
  /* 造一份与云函数真实形状一致的响应（照Day 19 实测的响应体字段写）：
     issues 有 type、goodSentences 没有 type —— 这正是要验的差别。 */
  const resp = {
    ok: true,
    data: {
      issues: [
        {
          type: 'logic', turn: 2,
          originalText: "We have some issues but I think it's ok.",
          reminder: '先说有问题又说没问题，前后不一致。',
          correction: "We're two days behind, but we can still make Friday."
        },
        {
          type: 'offtopic', turn: 4,
          originalText: 'By the way, I really like the coffee machine.',
          reminder: '这一句偏离了本次主题。',
          correction: null
        }
      ],
      goodSentences: [
        { turn: 6, originalText: 'I need more clarity on the scope.', reminder: '这句说清楚了。' }
      ],
      noIssueFound: false,
      model: 'deepseek-chat'
    }
  };
  return Promise.resolve({
    ok: true,
    status: 200,
    text: function () { return Promise.resolve(JSON.stringify(resp)); }
  });
};

const src = fs.readFileSync(path.join(__dirname, 'frontend', 'js', 'api.js'), 'utf8');
eval(src);

const Api = win.Api;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ← ' + extra : '')); }
}

Api.analyze({
  topicId: 'T1',
  anchor: '项目进度与延期原因',
  transcript: [{ turn: 1, userText: 'hi' }]
}).then(function (r) {
  console.log('\n【请求发出去的样子】');
  ok('打到 /api/analyze', sentUrl && sentUrl.indexOf('/api/analyze') >= 0, sentUrl);
  ok('带上了 anchor（8 主题判偏题要用）',
    sentBody.anchor === '项目进度与延期原因', JSON.stringify(sentBody.anchor));
  ok('transcript 传了', Array.isArray(sentBody.transcript) && sentBody.transcript.length === 1);

  console.log('\n【type 兜底：最容易错的地方】');
  ok('issues[0] type=逻辑错误', r.issues[0].typeLabel === '逻辑错误', r.issues[0].typeLabel);
  ok('issues[1] type=偏题', r.issues[1].typeLabel === '偏题', r.issues[1].typeLabel);
  /*★ 这条是本次改动的核心：goodSentences 没有 type 字段，
     不显式兜底就会被 typeLabelOf 的 else 分支标成「偏题」。 */
  ok('goodSentences 标成精彩句子（不是偏题）',
    r.goodSentences[0].typeLabel === '精彩句子',
    r.goodSentences[0].typeLabel);
  ok('goodSentences[0].type === "good"', r.goodSentences[0].type === 'good');

  console.log('\n【fix 映射：null 与 undefined 都落空串】');
  ok('偏题 fix 为空串（B7：不给改法）', r.issues[1].fix === '', JSON.stringify(r.issues[1].fix));
  ok('逻辑错误 fix 有值', r.issues[0].fix.indexOf('two days behind') >= 0);
  ok('精彩句子 fix 为空串（响应里没有 correction 字段）',
    r.goodSentences[0].fix === '', JSON.stringify(r.goodSentences[0].fix));

  console.log('\n【quote 映射：originalText → quote】');
  ok('原文原样进 quote（没被改写）',
    r.issues[0].quote === "We have some issues but I think it's ok.",
    JSON.stringify(r.issues[0].quote));
  ok('语法毛病保留（引号是原样的）', r.issues[0].quote.indexOf("it's ok") >= 0);

  console.log('\n【noIssueFound】');
  ok('noIssueFound=false 透传', r.noIssueFound === false);

  console.log('\n【回落版】');
  /* 注意：此处 fetch 仍是成功版本，所以 analyzeOrLocal 应该正常返回、不标 degraded。
     失败路径的验证放在下面「接口挂掉」那节—— 那里才把 fetch 换成 reject。 */
  return Api.analyzeOrLocal(
    { topicId: 'T1', transcript: [] },
    { issues: [], goodSentences: [] }
  );
}).then(function (r) {
  ok('接口正常时 analyzeOrLocal 不标 degraded', r.degraded === undefined, JSON.stringify(r.degraded));
  /* 失败路径：让 fetch 直接 reject，验 analyze() 是 reject 而非静默返回 */
  global.fetch = function () { return Promise.reject(new Error('network down')); };
  return Api.analyze({ topicId: 'T1', transcript: [] })
    .then(function () { ok('失败时应 reject', false, '居然成功了'); })
    .catch(function () { ok('接口失败时 analyze() 走 reject（不吞错）', true); });
}).then(function () {
  return Api.analyzeOrLocal(
    { topicId: 'T1', transcript: [] },
    { issues: [{ quote: '假条目' }], goodSentences: [] }
  );
}).then(function (r) {
  console.log('\n【接口挂掉时的回落】');
  ok('返回 degraded=true', r.degraded === true);
  ok('回落条目照常返回（页面不空白）', r.issues.length === 1);
  ok('带上了错误码', !!r.errorCode || !!r.errorMessage, JSON.stringify(r.errorCode));
  ok('noIssueFound 按回落条数算（有 1 条 → false）', r.noIssueFound === false);

  console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail > 0 ? 1 : 0);
}).catch(function (e) {
  console.error('测试崩了: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});