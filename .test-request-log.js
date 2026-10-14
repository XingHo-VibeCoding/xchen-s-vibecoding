/* .test-request-log.js —— 验 Day 23余力加练的 logReq()
   -------------------------------------------------------------
   为什么这个测试要起真的 HTTP 服务，而不是 eval 抓纯函数：
     logReq 的全部价值依赖 res.req —— 方法与路径是从那里取的。
     而「res.req 存不存在」这件事正是本实现的前提（我实测确认过，
     但那是临时验的，不该只在对话里留一句结论）。
     ★ eval 一个纯函数验不到「res.req 在真实请求里能拿到 url」，
       所以这个测试起真服务、发真请求、看真实日志输出。

   为什么还要测「日志不影响请求」：
     logReq 里有一段 try/catch。它的存在理由是
     「日志失败不能连累用户的请求」—— 而这句话本身也得验，
     否则那段 catch 就是一句自我声明。

   ★ 不测的部分（诚实说明）：
     CloudBase 的真实日志面板格式没验过。这里验的是
     「函数会往 stdout 打出这样一行」，
     CloudBase 是否原样收集 stdout 需要部署后看控制台。
*/

const http = require('http');
const path = require('path');
const fs = require('fs');

const src = fs.readFileSync(
  path.join(__dirname, 'cloudfunctions', 'chat', 'index.js'), 'utf8');

/* ★ 抓法有三个坑，三个都要踩过才知道（Day 23）：
   ① **边界要用大括号配对，不能用注释文字找** ——
      注释（'/* ---------- HTTP 响应'）会随人改版挪位置，
      而 logReq 上方的注释本来就不是它的一部分。
   ② **不能 require 那个文件** —— 它 top-level 有 server.listen()，
      require 进来会真的占一个端口。
   ③ ★★ **承接变量必须用 var，不能用 const** ——
      抓回来的代码里就有 `function logReq`，
      用 const logReq = eval(...) 时两者在同一作用域冲突：
      「Identifier 'logReq' has already been declared」。
      ★ 报错指向 eval 内部那一行，看着像生产代码有语法问题，
        实际是测试文件自己的接收变量撞了名。
   ★ 下面 bodyOf 只有一个定义 —— 原来有两个（bodyOfSrc 与 bodyOf），
     是编辑时留下的重复。留着两个的后果是「改了一个另一个没改」，
     而它们干的正是同一件事（切函数体）。 */
function bodyOf(src, fnName, tagToNorm) {
  const a = src.indexOf('function ' + fnName);
  if (a < 0) return null;
  const braceAt = src.indexOf('{', a);
  let depth = 0;
  for (let i = braceAt; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        let text = src.slice(a, i + 1);
        if (tagToNorm) text = text.split('[' + tagToNorm + ']').join('[TAG]');
        return text;
      }
    }
  }
  return null;
}

const chunk = bodyOf(src, 'logReq');
if (!chunk || !chunk.trim()) {
  console.log('★ 抓不到 logReq 函数体 —— chat/index.js 结构变了？');
  process.exit(1);
}
var logReq = eval(chunk + '\n;(function(){ return logReq; })()');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '\n      ' + extra : '')); }
  /* ★ 原来这里写的是 fail() —— 而 fail 是一个数字，
       调用它会抛 TypeError: fail is not a function，
       于是「测试不通过」这件事本身变成了「测试崩了」，
       报错信息还指向错误的地方。★ 「失败分支自己先坏掉」
       是最难查的一类问题，因为它让红色结果看起来像环境问题。
       （Day 23 写这个文件时踩到，抄改多了。） */
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

/* ---------- 起真服务，四种请求打到同一条 logReq ---------- */
const lines = [];
const realLog = console.log;
console.log = function () {
  lines.push(Array.prototype.join.call(arguments, ' '));
};

const server = http.createServer(function (req, res) {
  const pathOnly = (req.url || '/').split('?')[0];
  if (pathOnly === '/api/chat') {
    // 成功
    logReq(res, 200, { ok: true, data: { aiText: 'hello' } });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else if (pathOnly === '/api/boom') {
    // 业务失败：ok:false + error.code
    logReq(res, 400, { ok: false, data: null, error: { code: 'INVALID_PARAMS', message: '缺少 topicId' } });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  } else if (pathOnly === '/api/500') {
    // 服务端错
    logReq(res, 500, { ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  } else if (pathOnly === '/api/weird') {
    // 外壳形状不对（没有 error 也没有 ok:true）—— 判据不能因此崩
    logReq(res, 200, {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  } else if (pathOnly === '/api/sessions') {
    // ★ 带 query 的真实场景：read 接口的筛选条件都走 query
    //（?topicId=T3&limit=20）。这里验证 topicId 不进日志。
    logReq(res, 200, { ok: true, data: { sessions: [] } });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  }
});

function req(port, p) {
  return new Promise(function (resolve) {
    http.get('http://127.0.0.1:' + port + p, function (r) {
      r.resume();
      r.on('end', function () { resolve(r.statusCode); });
    });
  });
}

server.listen(0, function () {
  const port = server.address().port;
  Promise.all([
    req(port, '/api/chat'),
    req(port, '/api/boom'),
    req(port, '/api/500'),
    req(port, '/api/weird'),
    req(port, '/api/sessions?topicId=T3&limit=20')
  ]).then(function (codes) {
    server.close();
    console.log = realLog;

    console.log('\n【1】五个请求都返回了（证明 logReq 没干扰响应）');
    console.log('  HTTP 状态：' + codes.join(' / '));
    t('状态码原样穿过（日志没有改变响应）',
      codes.join(',') === '200,400,500,200,200', codes.join(' / '));

    console.log('\n【2】打印出 5 行日志');
    t('行数正确', lines.length === 5, '实际 ' + lines.length + ' 行');
    lines.forEach(function (l) { console.log('      ' + l); });

    console.log('\n【3】★ 三要素齐全：时间 / 路径 / 结果');
    const okLine = lines.filter(function (l) { return l.indexOf('/api/chat') >= 0; })[0] || '';
    t('有时间戳', /^\[\w+\] \d{2}:\d{2}:\d{2}/.test(okLine),
      okLine ? '「' + okLine.split(' ')[1] + '」' : '没这行');
    t('有方法与路径', okLine.indexOf('GET /api/chat') >= 0,
      okLine ? '含「GET /api/chat」' : '没这行');
    t('有 HTTP 状态与结果', okLine.indexOf('200 ok') >= 0,
      okLine ? '含「200 ok」' : '没这行');

    console.log('\n【4】★ 失败时打出错误码（排查靠它）');
    const badLine = lines.filter(function (l) { return l.indexOf('/api/boom') >= 0; })[0] || '';
    t('400 打出 INVALID_PARAMS', badLine.indexOf('400 INVALID_PARAMS') >= 0, badLine);
    const errLine = lines.filter(function (l) { return l.indexOf('/api/500') >= 0; })[0] || '';
    t('500 打出 INTERNAL_ERROR', errLine.indexOf('500 INTERNAL_ERROR') >= 0, errLine);

    console.log('\n【5】★ 安全要求：日志不能泄露业务数据');
    /* ★ 这是余力加练里最要紧的一条判据。
       query 里带 topicId，日志里不该出现它（业务数据）；
       body 里有 aiText，更不该出现。 */
    const allText = lines.join('\n');
    t('日志里没有 aiText 的值', allText.indexOf('hello') < 0);
    t('日志里没有缺topicId 的中文原文', allText.indexOf('缺少 topicId') < 0);
    /*★ 这条比「query 没进日志」更直接：
       就算将来有人改了 split('?')[0] 那一行，
       「topicId 这个值有没有出现在日志里」也会立刻报出来。 */
    t('日志里没有 topicId 的值 T3', allText.indexOf('T3') < 0);
    /* ★ 这条判据第一版写成 l.indexOf('?') < 0，结果误报失败。
       排查后确认是**期望写错了**：日志里那个 `?` 确实存在，
       但它是「外壳没有 error.code」的占位符（见【6】那行 `200 ?`），
       不是 URL 的 query 分隔符。
       ★ 教训：判据必须针对**要测的那件事**，
         不能用一个字符在整行里出现与否来判断 ——
         同一行里可能有多个 `?`，来源还不一样。 */
    const hasQuery = lines.some(function (l) {
      /* query 会跟在路径后面出现形如「/api/xxx?a=1」的片段 */
      return /\?[^ ]+=/.test(l);
    });
    t('query 参数没有进日志', !hasQuery,
      '用 /\\?[^ ]+=/ 查「? 后跟键值」，不会与占位符 ? 混淆');

    console.log('\n【6】★ 外壳形状不对时也不能崩（回退成 ?）');
    const weirdLine = lines.filter(function (l) { return l.indexOf('/api/weird') >= 0; })[0] || '';
    t('没有 error 字段时不崩，代码回退为 ?',
      weirdLine.indexOf('200 ?') >= 0, weirdLine);

console.log('\n【7】★ 五份logReq 必须逐字同形（只允许前缀不同）');
/* ★ 这项是本测试最要紧的一条。
   CloudBase 云函数没有共享模块机制 —— 五个函数各存一份 logReq。
   手抄必然分叉，而分叉的后果极难查：
   「有的接口有日志、有的没有」看起来像「那个接口没被调用过」。
   （与 .test-write.js 里那条「改一份必须同步另一份」同一个思路。） */
const FN_NAMES = ['chat', 'analyze', 'read', 'write', 'speech'];
/* ★★ 比法改了两次才对（Day 23）：
   ① 最初用「下一个顶层 function」切边界 —— 结果把 logReq **上方**那段注释
      也算进来了，而每个函数上方本来就有各自的标题注释
      （analyze 是「HTTP 响应」、read 是「三、统一响应外壳」…），
      于是报「四份都不一致」。★ 那不是真的分叉，
      是我拿「谁家的门口贴了不同的纸条」当成了「屋里东西不一样」。
   ② 现在改成：**按大括号配对切出函数体**，再逐字比。
      口径是「函数体逐字相同（日志前缀除外）」——
      注释属于周边，不属于这个函数，不该进这个判据。
      ★ 教训：一致性判据必须针对**要保证的那件事**。
        「五份一样」的保证对象是代码行为，不是文件长相。 */
function grabLogReq(fn) {
  const s = fs.readFileSync(
    path.join(__dirname, 'cloudfunctions', fn, 'index.js'), 'utf8');
  return bodyOf(s, 'logReq', fn);
}
const bodies = {};
FN_NAMES.forEach(function (fn) { bodies[fn] = grabLogReq(fn); });
const missing = FN_NAMES.filter(function (fn) { return !bodies[fn]; });
t('五个函数都有 logReq', missing.length === 0,
  missing.length === 0 ? '5/5' : '缺：' + missing.join(', '));
if (missing.length === 0) {
  const diff = FN_NAMES.filter(function (fn) {
    return bodies[fn] !== bodies[FN_NAMES[0]];
  });
  t('五份内容逐字一致（前缀除外）', diff.length === 0,
    diff.length === 0 ? '5 份完全一致' : '不一致：' + diff.join(', '));
}

/* 五份都要在 sendJSON 里真的调用了 ——
   插了函数但忘了调用，是这类批量改动最常见的漏。 */
const notCalled = FN_NAMES.filter(function (fn) {
  const s = fs.readFileSync(
    path.join(__dirname, 'cloudfunctions', fn, 'index.js'), 'utf8');
  const a = s.indexOf('function sendJSON');
  if (a < 0) return true;
  const rest = s.slice(a, a + 400);
  return rest.indexOf('logReq(res, httpStatus, body)') < 0;
});
t('五个函数的 sendJSON 都调用了 logReq', notCalled.length === 0,
  notCalled.length === 0 ? '5/5' : '没调用：' + notCalled.join(', '));

console.log('\n【8】云函数不得自己写 CORS 头（Day 24 尾巴：这就是「语音失败: UNKNOWN」的真因）');
/* ★ 为什么要钉这一条：2026-10-13 语音在**真浏览器**里一直报
   `【诊断】语音失败: UNKNOWN`，而云函数日志显示每次请求都 `→ 200 ok`。
   真因：`speech` 函数**自己又写了一组** CORS 响应头，与**网关**按跨域配置
   回的那一份撞车 —— 浏览器收到**两个同名的 ACAO 头**，规范规定「该头多值即非法」
   → 跨域校验失败 → `fetch` 被 reject（err **没有 code**）→ 前端只能落到 UNKNOWN。
   ★ 它极难发现，因为三条路全是绿的、只有真浏览器会挂：
     · `curl` 全绿（不校验 CORS、也不在乎重复头）
     · 云函数日志全绿（请求确实到达并成功返回）
     · 连 `OPTIONS` 预检也绿（预检由**网关自己应答**、不转发给函数，那份是干净的）
   ★ 口径：CORS 由**网关的跨域设置**统一负责（控制台 `#/env/cross-domain`），
     函数里一律不写。另外 5 个函数本来就一条都没写，这里把 speech 一起钉住。
   ★ 判据针对的是「代码里有没有真的设这个头」，所以扫描前会**剥掉注释**——
     否则光是注释里提到头名就会误报。 */
const CORS_HEAD_RE = /Access-Control-Allow-(Origin|Methods|Headers)/;
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')   /* 块注释 */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); /* 行注释（避开 http:// 这种） */
}
const ALL_FUNCS = FN_NAMES.concat(['health']);
const corsOffenders = ALL_FUNCS.filter(function (fn) {
  const s = fs.readFileSync(
    path.join(__dirname, 'cloudfunctions', fn, 'index.js'), 'utf8');
  return CORS_HEAD_RE.test(stripComments(s));
});
t('六个函数都不自己写 CORS 头（交给网关）', corsOffenders.length === 0,
  corsOffenders.length === 0 ? '6/6 干净' : '自己去写了：' + corsOffenders.join(', '));

console.log('\n────────────────────────────');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail > 0) process.exit(1);
console.log('全部通过');
  });
});