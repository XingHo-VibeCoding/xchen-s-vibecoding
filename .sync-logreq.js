/* .sync-logreq.js —— 用 chat/index.js 的 logReq 覆盖其他函数的那一份
   -------------------------------------------------------------
   为什么需要这个脚本（Day 23）：
     五个云函数必须持有**逐字相同**的 logReq（日志前缀除外）。
     起因是我先手写了 chat 与 analyze 两份，注释写得不一样长，
     .test-request-log.js 的「五份一致」判据立刻报出 analyze 不一致。
     ★ 那不是误报 —— 代码行本来就一样，差的是注释，
       而注释里正写着「为什么不把 query 打进日志」这类**安全理由**。
       ★★ 所以不该放宽判据去消这个红灯（比方说「忽略注释只比代码」）——
         那会让注释分叉不再报警，而那几句恰恰最该五份一致。
       正确做法是把落后的那份对齐到样板。

   ★ 为什么以 chat 为样板而不是反过来：
     chat 那份最早写、注释最全，而且它是 .test-request-log.js
     实际 eval 来跑行为验证的那一份 —— 行为测试与一致性判据
     必须落在同一个文件上，否则「测的和比的」是两份不同的东西。

   可重复执行：已经一致就跳过。
*/

const fs = require('fs');
const path = require('path');

const PROTOTYPE = 'chat';
const TARGETS = ['analyze', 'read', 'write', 'speech'];

function bodyOf(src, fn) {
  const a = src.indexOf('function ' + fn);
  if (a < 0) return null;
  const b = src.indexOf('{', a);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return { text: src.slice(a, i + 1), start: a, end: i + 1 }; }
  }
  return null;
}

const protoSrc = fs.readFileSync(
  path.join(__dirname, 'cloudfunctions', PROTOTYPE, 'index.js'), 'utf8');
const proto = bodyOf(protoSrc, 'logReq');
if (!proto) { console.log('★ 样板里找不到 logReq'); process.exit(1); }

let synced = 0, already = 0;
TARGETS.forEach(function (fn) {
  const p = path.join(__dirname, 'cloudfunctions', fn, 'index.js');
  const src = fs.readFileSync(p, 'utf8');
  const cur = bodyOf(src, 'logReq');
  if (!cur) { console.log('  ! ' + fn + ' 里没有 logReq，跳过'); return; }

  /* 归一化后再比：日志前缀按函数名不同，先换成同一个占位符。 */
  const norm = function (s) { return s.split('[' + fn + ']').join('[TAG]'); };
  if (norm(cur.text) === proto.text.split('[' + PROTOTYPE + ']').join('[TAG]')) {
    console.log('  ' + fn + ' 已一致，跳过');
    already++;
    return;
  }

  const want = proto.text.split('[' + PROTOTYPE + ']').join('[' + fn + ']');
  const out = src.slice(0, cur.start) + want + src.slice(cur.end);
  fs.writeFileSync(p, out, 'utf8');
  console.log('  ✓ ' + fn + ' 已对齐到样板');
  synced++;
});

console.log('\n对齐 ' + synced + ' 个，本来就一致 ' + already + ' 个');
if (synced > 0) console.log('（改完请跑 node .test-request-log.js 复核）');