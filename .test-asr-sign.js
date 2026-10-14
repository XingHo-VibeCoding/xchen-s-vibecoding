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
  /*★★ Day 24 修一个**测试自身**的 bug（它差点把我骗过去）：
     原来是 `FakeDate.prototype = RealDate.prototype;` **再加上**
     `FakeDate.prototype.toISOString = function(){ return iso; };` ——
     因为两个 prototype 是**同一个对象**，那句改的是**真正的 `Date.prototype`**：
     跑过一次 withFixedNow 之后，全进程里所有 Date 的 toISOString()
     都被永久钉死成那个 iso（finally 只还原了 global.Date，**还原不了原型**）。
     ★ 症状：新加的那条断言打印出 `…/2021-09-15/…`，而不是传入时间戳该算出的
       `2019-02-25`。一次「**判失败先打印实际值**」立刻现形。
     ★ 修法：**干脆删掉这个 override** —— `fixed` 本来就是用 `iso` 构造的，
       真的 `toISOString()` 返回值与 iso 逐字相同（iso 都是规范化的 `.000Z` 串），
       所以那一行本来就多余；删掉即无泄漏、行为不变。 */
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return fixed.getTime(); };
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
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
/*★★ Day 24 补这一节 —— 补的就是「今天为什么没测出来」。
   原来 20 项**只测形状**（前缀、含 Credential=、签名 64 位十六进制、确定性、敏感度），
   于是两个**格式**错误全都溜过去了，直到真机打腾讯云才报
   `[AuthFailure.InvalidAuthorization] … Date in Credential not valid format.`
   ★ 教训与「写断言前先分清要保证的那件事」同源：我要保证的是
     「腾讯云**认**这个签名」，而形状对了完全不代表腾讯云认。
   ★ 下面用的时间戳 1551113065 出自官方「签名方法 v3」示例。
     它在东八区是 2019-02-26，而腾讯云要的是 **UTC 日期 2019-02-25** ——
     文档专门提醒「混进本地时区，东八区凌晨调用必失败」，
     所以这一条同时钉住两件事：① 带连字符的 YYYY-MM-DD；② 取 UTC 那一天。 */
console.log('三、Date 的格式与 UTC 口径（Day 24 补：真机就是挂在这里）');
/* 显式传时间戳 → 不需要 FakeDate，用的是真实 Date，
   而 toISOString() 恒为 UTC，所以断言与本机时区无关。 */
const authUtc = sign('{"a":1}', 1551113065);
ok('Credential 里的 Date 是 YYYY-MM-DD（带连字符）',
  authUtc.indexOf('/2019-02-25/asr/tc3_request') > 0, authUtc.slice(0, 96));
ok('Date 取 UTC 那天（不是本机 UTC+8 的 2019-02-26）',
  authUtc.indexOf('/2019-02-26/') < 0);
ok('签名与 X-TC-Timestamp 用同一个时间戳：换个时间戳签名就变',
  sign('{"a":1}', 1551113065) !== sign('{"a":1}', 1551113066));

console.log('');
/*★★★ Day 24 补这一节 —— 它才是今天真正救命的那条测量。
   起因：三、把 Date 格式修对后，真机仍然报
     `[AuthFailure.SignatureFailure] The provided credentials could not be validated.`
   而这个码与「密钥填错了」长得**一模一样**，靠猜分不开。
   判法：把**腾讯云官方 Python SDK 的签名算法**照原样翻译成 JS（下面的 refSign），
   与源码里 eval 出来的 sign() 用**完全相同的输入**各算一遍，比签名值。
   → 发现项目算的 canonicalRequest **少一行**（缺 SignedHeaders），签名自然对不上；
     而这**能通过上面全部形状断言**（Authorization 头长得完全正常），
     也解释了「换了新密钥还是 SignatureFailure」：错的是算法，不是凭证。
   ★ 本节钉的性质是「与官方算法同输入同输出」——
     只有它才等价于「腾讯云**认**这个签名」，形状对不对是另一回事。 */
console.log('三点五、与腾讯云官方 SDK 算法交叉验证（Day 24 补：SignatureFailure 的真因）');

/* 参考实现：照官方 Python 源码逐行翻译。
   sign_tc3                ← tencentcloud-sdk-python / common/sign.py
   canonicalRequest 的拼法 ← 同仓库 / common/abstract_client.py 的 _get_tc3_signature
   ★ 刻意**不套用** sign() 的数组写法，而是照官方格式串 `'%s\n%s\n…'` 拼，
     否则「两个实现犯同一个错」就白比了。 */
function refSign(secretKey, ts, payload, host, service, contentType, omitSignedHeaders) {
  const c = require('crypto');
  const hmac = function (key, msg) {
    return c.createHmac('sha256', key).update(msg, 'utf8').digest();
  };
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const payloadHash = c.createHash('sha256').update(payload, 'utf8').digest('hex');
  /* 官方原式：canonical_headers = 'content-type:%s\nhost:%s\n'（**自带尾部换行**），
     再由 '%s\n%s\n%s\n%s\n%s\n%s' 拼 —— 所以 signed_headers 之前自然留出一个空行。
     omitSignedHeaders=true 时就是**漏掉那一行**的样子（今天的 bug 形态）。 */
  const canonicalHeaders = 'content-type:' + contentType + '\nhost:' + host + '\n';
  const body = ['POST', '/', '', canonicalHeaders];
  if (!omitSignedHeaders) body.push('content-type;host');
  body.push(payloadHash);
  const canonicalRequest = body.join('\n');
  const digest = c.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const string2sign = [
    'TC3-HMAC-SHA256', String(ts), date + '/' + service + '/tc3_request', digest
  ].join('\n');
  const kDate = hmac('TC3' + secretKey, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, 'tc3_request');
  return c.createHmac('sha256', kSigning).update(string2sign, 'utf8').digest('hex');
}

/* 密钥用**与 eval 进 sign() 的那把完全相同**的值，否则比的是两把不同的密钥。 */
const REF_KEY = 'Gu5t9xGARNpq86cd98joQYCN3*******';
const REF_HOST = 'asr.tencentcloudapi.com';
const REF_SERVICE = 'asr';
const REF_CT = 'application/json; charset=utf-8';
const sigOf = function (authStr) { return (authStr.match(/Signature=([0-9a-f]+)/) || [])[1]; };

const REF_TS = 1551113065;
const REF_PAYLOAD = '{"SubServiceType":2,"ProjectId":0,"VoiceFormat":"wav","SourceType":1,"DataLen":32044}';
const projSig = sigOf(sign(REF_PAYLOAD, REF_TS));
const refSig = refSign(REF_KEY, REF_TS, REF_PAYLOAD, REF_HOST, REF_SERVICE, REF_CT, false);
ok('项目 sign() 与官方 SDK 算法：同输入 → 同签名',
  projSig === refSig, '项目=' + projSig + ' 官方=' + refSig);

/* 换一组输入再钉一次 —— 防「只对某一个特例碰巧相等」。 */
const p2 = '{"a":1}';
ok('换一组输入（payload 与时间戳都不同）仍然一致',
  sigOf(sign(p2, 1700000000)) === refSign(REF_KEY, 1700000000, p2, REF_HOST, REF_SERVICE, REF_CT, false),
  '项目=' + sigOf(sign(p2, 1700000000)));

/* 把病灶本身钉死：**漏掉 SignedHeaders 行**必须算出不同的签名。
   这样以后谁再删掉那一行，这条会立刻红，而不是等到真机报 SignatureFailure。 */
ok('★ 漏掉 SignedHeaders 行 → 签名必然不同（今天 SignatureFailure 的病）',
  projSig !== refSign(REF_KEY, REF_TS, REF_PAYLOAD, REF_HOST, REF_SERVICE, REF_CT, true),
  '漏行版=' + refSign(REF_KEY, REF_TS, REF_PAYLOAD, REF_HOST, REF_SERVICE, REF_CT, true));

console.log('');
console.log('四、VoiceFormat 映射（腾讯云不收 webm，映射错会直接报错）');
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