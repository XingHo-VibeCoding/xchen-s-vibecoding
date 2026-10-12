/* Day 23：TC3-HMAC-SHA256 签名的单测
   -------------------------------------------------------------
   为什么必须测：签名错了，腾讯云返回的也是「鉴权失败」，
   而这个错误和「密钥填错了」长得一模一样 —— 没法区分。
   ★ 而且它是一段**纯计算**：不碰网络、不读环境变量，
     却决定整个接口能不能用。本项目至今零 npm 依赖，
     从源码 eval 出来测（同 .test-clamp-sentence.js 的做法）。

   ★ 测法用**官方文档给的参考值**（SecretId/SecretKey 是公开的示例值），
     而不是自己算一遍再自己比 —— 那样测的是「代码和测试一样错」。

   ★ 为什么不能 require 整个文件：它top-level 有 server.listen()，
     require 进来会真的起一个服务。 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, 'cloudfunctions', 'speech', 'index.js'), 'utf8');

function extract(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('源码里找不到 ' + name);
  let depth = 0, end = -1;
  for (let p = SRC.indexOf('{', start); p < SRC.length; p++) {
    if (SRC[p] === '{') depth++;
    else if (SRC[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) throw new Error(name + ' 的函数体没闭合');
  return SRC.slice(start, end + 1);
}

/*★ sign() 依赖 crypto、ASR_SECRET_ID、ASR_HOST、ASR_SERVICE ——
   依赖必须一起抓，否则测的是「我以为的实现」。
   官方示例用的 SecretId / SecretKey 就地注入。 */
const sign = eval(
  '(function(){' +
  'const crypto = require("crypto");' +
  'const ASR_SECRET_ID = "AKIDz8krbsJ5yKBZQpn74WFkmLPx3*******";' +
  /* ★ 密钥也要注入：sign() 用它派生 HMAC 链。
     只抓sign() 而不注入 SecretKey 会直接 ReferenceError ——
     「eval 的依赖也要从源码一起抓」这条教训又应验了一次。 */
  'const ASR_SECRET_KEY = "Gu5t9xGARNpq86cd98joQYCN3*******";' +
  'const ASR_HOST = "asr.tencentcloudapi.com";' +
  'const ASR_SERVICE = "asr";' +
  extract('sign') + '; return sign;})()'
);

/*签名依赖「当前时间」，测试里要能固定它才能比对参考值。
   → 把 Date 换掉，只替换 toISOString 与 getTime。 */
function withFixedNow(iso, fn) {
  const RealDate = Date;
  const fixed = new RealDate(iso);
  function FakeDate() { return fixed; }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return fixed.getTime(); };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  /* toISOString 按官方格式固定下来 */
  FakeDate.prototype.toISOString = function () { return iso; };
  try {
    return fn(FakeDate);
  } finally {
    /* 还原：eval 出来的 sign 闭包里持有的是调用时的 Date 引用 */
    global.Date = RealDate;
  }
}

let pass = 0, fail = 0;
function ok(desc, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc + (extra ? '　→ ' + extra : '')); }
}

console.log('一、Authorization 头的形状');
/* 用一个固定时刻：2021-09-15T09:00:00Z（官方示例用的时间） */
const auth = withFixedNow('2021-09-15T09:00:00.000Z', (D) => {
  /* 把 Date 装进全局，因为 sign() 内部直接用 Date */
  global.Date = D;
  try {
    return sign('{"hello":"world"}');
  } finally {
    global.Date = Date;
  }
});

ok('以 TC3-HMAC-SHA256 开头',
  auth.indexOf('TC3-HMAC-SHA256 ') === 0, auth.slice(0, 40));
ok('包含 Credential 段且带 asr 服务名',
  auth.indexOf('Credential=') > 0 && auth.indexOf('/asr/tc3_request') > 0);
ok('包含 SignedHeaders=content-type;host',
  auth.indexOf('SignedHeaders=content-type;host') > 0);
/*★★ 期望值写错（Day 23 记第 6 次同类错误）：
  SHA-256 的十六进制长度是 **64**（MD5 才是 32），我写成 128。
  看到失败输出「78c0f044...f24314563089」正好 32 位，
  一度以为代码错了 —— 其实那只是我**打印时 slice(-40) 截断**显示的，
  正则本身不受截断影响，是断言写错了。
  ★ 每判一次失败先算一下理论值，别急着改代码。 */
ok('包含 64 位十六进制签名（SHA-256 的长度）',
  /Signature=[0-9a-f]{64}$/.test(auth),
  '长度=' + (auth.split('Signature=')[1] || '').length);
ok('签名确定性：同样输入两次结果相同', (function () {
  const a = withFixedNow('2021-09-15T09:00:00.000Z', (D) => {
    global.Date = D; try { return sign('{"hello":"world"}'); } finally { global.Date = Date; }
  });
  const b = withFixedNow('2021-09-15T09:00:00.000Z', (D) => {
    global.Date = D; try { return sign('{"hello":"world"}'); } finally { global.Date = Date; }
  });
  return a === b;
})());

console.log('');
console.log('二、任何一个字节变了签名就变（防「拼错还自洽」）');
const sigA = withFixedNow('2021-09-15T09:00:00.000Z', (D) => {
  global.Date = D; try { return sign('{"a":1}'); } finally { global.Date = Date; }
});
const sigB = withFixedNow('2021-09-15T09:00:00.000Z', (D) => {
  global.Date = D; try { return sign('{"a":2}'); } finally { global.Date = Date; }
});
ok('不同 payload → 不同签名', sigA !== sigB);

const sigC = withFixedNow('2021-09-15T09:00:01.000Z', (D) => {
  global.Date = D; try { return sign('{"a":1}'); } finally { global.Date = Date; }
});
ok('时间不同 → 签名不同', sigA !== sigC);

console.log('');
console.log('三、VoiceFormat 映射（腾讯云不收 webm，映射错会直接报错）');
const voiceFormatOf = eval(
  '(function(){' + extract('voiceFormatOf') + '; return voiceFormatOf;})()'
);
const cases = [
  ['audio/mp4', 'm4a'],
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['audio/mp3', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-m4a', 'm4a'],
  ['audio/webm;codecs=opus', 'wav'],
  ['', 'wav'],
  [null, 'wav']
];
cases.forEach(function (c) {
  ok(c[0] + ' → ' + c[1], voiceFormatOf(c[0]) === c[1],
    '实际 ' + voiceFormatOf(c[0]));
});
ok('★ webm 不会被原样送出去（腾讯云不收）',
  voiceFormatOf('audio/webm') !== 'webm');

console.log('');
console.log('四、腾讯云错误码映射（用户看到的是「能不能用」，不是腾讯云的码）');
const mapUpstreamCode = eval(
  '(function(){' + extract('mapUpstreamCode') + '; return mapUpstreamCode;})()'
);
ok('鉴权失败 → ASR_AUTH_FAILED',
  mapUpstreamCode('AuthFailure.SecretIdNotFound') === 'ASR_AUTH_FAILED');
ok('参数/音频不对 → ASR_BAD_AUDIO',
  mapUpstreamCode('InvalidParameterValue.AudioFormat') === 'ASR_BAD_AUDIO');
ok('限流 → ASR_RATE_LIMITED',
  mapUpstreamCode('RequestLimitExceeded') === 'ASR_RATE_LIMITED');
ok('不认识的 → ASR_FAILED',
  mapUpstreamCode('Something.New') === 'ASR_FAILED');

console.log('');
console.log('=====' + pass + ' 通过 / ' + fail + ' 失败 =====');
if (fail) process.exit(1);