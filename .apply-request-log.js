/* .apply-request-log.js —— 给剩下三个云函数补上 logReq
   -------------------------------------------------------------
   为什么用脚本而不是手动改三遍：
     chat / analyze / read / write / speech 五个函数的 logReq 必须
     **逐字同形**（只有前缀不同）。手抄三遍必然出现细微差别，
     而「有的接口有日志、有的没有」这种不一致极难查
     （它看起来像「那个接口没被调用过」）。
     ★ 机制钉住 > 靠自觉 —— 与 .test-write.js 那条
       「改一份必须同步另一份」的检查同一个思路。

   为什么必须先跑它再跑 .test-request-log.js：
     本脚本只做「插入」，不检查插入结果对不对；
     验它是否成功由测试负责（那里有一项专门查五份是否一致）。

   ★ 本脚本可重复执行：已插入过就跳过，不会插两份。
*/

const fs = require('fs');
const path = require('path');

/* chat 里的那份是「样板」—— 保持它为准，改了它另外四份要跟着重跑本脚本。 */
const TEMPLATE = path.join(__dirname, 'cloudfunctions', 'chat', 'index.js');

const TARGETS = [
  { file: 'cloudfunctions/read/index.js',   tag: 'read' },
  { file: 'cloudfunctions/write/index.js',  tag: 'write' },
  { file: 'cloudfunctions/speech/index.js', tag: 'speech' }
];

/* 从样板里取出 logReq 的完整源码 + 那一行 logReq(...) 调用。
   ★ 切分边界用「下一个顶层 function 声明」而不是注释文字 ——
     注释会随人改版挪位置，function 声明不会。 */
function extractFromTemplate() {
  const src = fs.readFileSync(TEMPLATE, 'utf8');
  const start = src.indexOf('function logReq');
  if (start < 0) throw new Error('样板里找不到 function logReq');
  const rest = src.slice(start + 'function logReq'.length);
  const m = rest.match(/\nfunction [A-Za-z]+/);
  if (!m) throw new Error('样板里 logReq 之后找不到下一个 function');
  const end = start + 'function logReq'.length + m.index;
  return src.slice(start, end);
}

const body = extractFromTemplate();

let changed = 0, skipped = 0;
TARGETS.forEach(function (t) {
  const p = path.join(__dirname, t.file);
  let src = fs.readFileSync(p, 'utf8');

  if (src.indexOf('function logReq') >= 0) {
    console.log('  跳过 ' + t.tag + '（已经插过了）');
    skipped++;
    return;
  }

  /* 换掉前缀：[chat] → [read] / [write] / [speech]。
     ★ 只替换前缀那一处，不动其他内容 —— 逐字同形是硬要求，
       一旦在这里「顺手优化」某句注释，五份就分叉了。 */
  const tagged = body.split('[chat]').join('[' + t.tag + ']');

  /* 插到 sendJSON 定义之前。
     ★ 为什么是「之前」而不是之后：sendJSON 是唯一响应出口，
       logReq 必须在它被调用前已定义（function 声明会提升，
       其实前后都行，但放之前更好读 —— 读代码时先看到日志再看响应）。
     ★ 用 indexOf('function sendJSON') 而不是注释文字作锚点，同上。 */
  const anchor = src.indexOf('function sendJSON');
  if (anchor < 0) throw new Error(t.tag + ' 里找不到 function sendJSON');

  /* 找 sendJSON 上面紧邻的那段块注释的起点，让新代码插在它之后，
     保持「响应外壳」这个标题仍然管辖着 sendJSON。 */
  let insertAt = anchor;
  const head = src.slice(0, anchor);
  const lastComment = head.lastIndexOf('/* ----------');
  if (lastComment >= 0 && head.length - lastComment < 400) {
    insertAt = lastComment;
  }

  const header = '/* ---------- 请求日志（Day 23 · 余力加练）---------- */\n' +
    '/* 与 chat/index.js 的 logReq 逐字同形（只有日志前缀不同）。\n' +
    '   ★ 五个函数必须同步改：CloudBase 云函数没有共享模块机制，\n' +
    '     各函数独立部署，仓库里也没有 build 步骤能替你合并。\n' +
    '     不同步的症状是「有的接口有日志、有的没有」，\n' +
    '     而它看起来像「那个接口没被调用过」，极难查。\n' +
    '     （.test-request-log.js 里有一项检查专门钉这条。） */\n';

  src = src.slice(0, insertAt) + header + tagged + '\n\n' + src.slice(insertAt);

  /* 在 sendJSON 的函数体开头插入调用。
     锚点用 sendJSON 后面紧跟的第一处 '{' +换行 —— 
     sendJSON 的函数体第一行就是 res.writeHead。 */
  const sdStart = src.indexOf('function sendJSON');
  const braceAt = src.indexOf('{', sdStart);
  const bodyStart = src.indexOf('\n', braceAt) + 1;
  const call = '  logReq(res, httpStatus, body);\n' +
    '  /* 日志已打：Day 23 要求每次响应都留一条「时间/路径/结果」 */\n';
  src = src.slice(0, bodyStart) + call + src.slice(bodyStart);

  fs.writeFileSync(p, src, 'utf8');
  console.log('  ✓ 已给 ' + t.tag + ' 插上 logReq');
  changed++;
});

console.log('\n改动 ' + changed + ' 个文件，跳过 ' + skipped + ' 个');
if (changed === 0 && skipped === 0) console.log('★ 一个都没处理，检查 TARGETS');