/* POST /api/speech-to-text —— 服务端语音转写（Day 23 新建）
   =============================================================
   为什么有这个东西：这一整个功能是被逼出来的。
   Day 23 先按TECH_DESIGN §3.3 定的「浏览器原生 SpeechRecognition」实现，
   真机一试就报 `network` —— **Chrome 的语音识别不是本地识别**，
   它把录音上传到 Google 的服务器去识别，国内网络访问不通就一直等。

   ★ 所以这不是「浏览器不支持」，是「这条路在你的网络环境下走不通」。
     继续调参数不会有任何改变。
     这正是 TECH_DESIGN §6.4（Q-T1）预留的退路：
     「若浏览器原生识别对带口音英语准确度不足（PRD R1），把转写改到服务端」。

   -------------------------------------------------------------
   一、腾讯云 ASR 的接入方式
   -------------------------------------------------------------
   用腾讯云一句话识别（SentenceRecognition），**HTTP 协议直接调**，
   不引 SDK —— 理由与 chat/index.js 一致：
     本函数只调一个 HTTP 接口、只用 POST + JSON，
     引tencentcloud-sdk-nodejs 会带进一整包依赖，
     而云函数部署包越小启动越快。60 行手写比200 行依赖更可控。

   ★ 签名（TC3-HMAC-SHA256）必须自己实现，这是本函数最麻烦的一段。
     为什么不能简单发：腾讯云要求每次请求带 Authorization 头，
     内容是「按时间戳 + 密钥派生出的签名」，时间戳过期就不认。
     下面 sign() 就是干这件事的，注释里标了每一步对应的官方文档说法。

   -------------------------------------------------------------
   二、密钥与隐私（TECH_DESIGN §3.3 硬规矩）
   -------------------------------------------------------------
     **密钥只从环境变量读，绝不写死在这里**。
     要配三个（见文件末尾的启动日志）：
       ASR_SECRET_ID    腾讯云 SecretId
       ASR_SECRET_KEY   腾讯云 SecretKey
       ASR_REGION       可选，默认 ap-shanghai
       ASR_APPID        必填（AppId 在控制台账号信息里）

   ★ **音频离开设备** —— 这是与浏览器方案最大的区别，
     必须对用户讲清楚（页面里也会写明）。
     PRD 与 TECH_DESIGN 当时选浏览器方案就是为了避免这件事，
     现在触发 R1 退路，就得接受它。音频不落库、不留存，
     只用于一次识别请求。

   -------------------------------------------------------------
   三、请求与响应（契约 §5 的预留格式）
   -------------------------------------------------------------
     请求：音频二进制，Content-Type 必须与扩展名对上
           （腾讯云按 content-type 判格式，传错会直接报错）
     响应：{ ok: true, data: { text, engine } }  ←
           ★ 契约 §5 写的是 { ok: true, text: "..." }，
             但那个形状和全站其余四个接口不一致
             （它们都是 { ok, data, error }，见 TECH_DESIGN §1.2）。
             ★ **以统一外壳为准**：data 里放 text。
               这是对预留契约的一处修正，已记在今天的文档改动里。
     失败：{ ok: false, data: null, error: { code: "ASR_FAILED", ... } }
   ============================================================= */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

/* ---------- 配置（只从环境变量读） ---------- */
const ASR_SECRET_ID = process.env.ASR_SECRET_ID || '';
const ASR_SECRET_KEY = process.env.ASR_SECRET_KEY || '';
const ASR_APPID = process.env.ASR_APPID || '';
const ASR_REGION = process.env.ASR_REGION || 'ap-shanghai';
const ASR_HOST = 'asr.tencentcloudapi.com';
const ASR_SERVICE = 'asr';
/* ★★ Day 24 修：原写 '2019-02-14' 是错的。
   一句话识别（SentenceRecognition）的 Version 是 **'2019-06-14'** —— 见官方文档「输入参数」表。 */
const ASR_VERSION = '2019-06-14';
/* 引擎类型：中英混合 → 官方取值 **`16k_zh-PY`**（文档描述「中英粤」）。
   ★ Day 24 修正：原写 '16k_zh'，而它在文档里是「**中文通用**」、并非中英混合 ——
     注释里那句理由（"16k_zh 是中英混合"）与文档不符，已按用户选择改成 16k_zh-PY。 */
const ASR_ENGINE_MODEL_TYPE = '16k_zh-PY';
/* ★★ Day 24 删掉 `ASR_VOICE_ID`：VoiceId 是**实时语音识别**的参数，
   一句话识别的「输入参数」表里**没有**这个字段。原来放在请求体里只会被忽略。 */

function checkEnv() {
  const need = ['ASR_SECRET_ID', 'ASR_SECRET_KEY', 'ASR_APPID'];
  return need.filter((k) => !process.env[k]);
}

/* ---------- 密钥自检（Day 24 · 排障用）----------
   用途：腾讯云回 `SignatureFailure` / `SecretIdNotFound` 时，用它区分三种抄写错误 ——
     · 长度不对（抄漏了字符，或抄了控制台上打了码的显示值）
     · 带空白（从控制台粘贴时夹带空格或换行 —— **肉眼看不见**，
       而它产生的正是 `SignatureFailure`，是本类问题最常见的成因）
     · 填错位（把 SecretId 填到了 SecretKey 上）
   正常形状（腾讯云的固定规格，可据此判断）：
     SecretId  = 36 位、`AKID` 开头
     SecretKey = 32 位、不含任何空白字符
   ★★ 安全红线：**只打印长度与「有没有空白」，永不打印值本身**。
      长度和空白不构成泄露 —— 这也正是它能安全留在代码里的原因。 */
function logEnvShape() {
  try {
    const id = ASR_SECRET_ID;
    const key = ASR_SECRET_KEY;
    console.log('[speech] env-shape' +
      ' idLen=' + id.length +
      ' idIsAKID=' + /^AKID/.test(id) +
      ' keyLen=' + key.length +
      ' keyTrimLen=' + key.trim().length +
      ' keyHasBlank=' + /\s/.test(key));
  } catch (e) {
    /* 自检失败绝不影响主流程 —— 它只是排障用的旁路信息 */
  }
}

/* ---------- 请求日志（Day 23 · 余力加练）---------- */
/* 与 chat/index.js 的 logReq 逐字同形（只有日志前缀不同）。
   ★ 五个函数必须同步改：CloudBase 云函数没有共享模块机制，
     各函数独立部署，仓库里也没有 build 步骤能替你合并。
     不同步的症状是「有的接口有日志、有的没有」，
     而它看起来像「那个接口没被调用过」，极难查。
     （.test-request-log.js 里有一项检查专门钉这条。） */
function logReq(res, httpStatus, body) {
  try {
    const req = res.req || {};
    /* 时间用本地格式而不是 ISO：
       ISO 的 'T' 和 'Z' 在 CloudBase 日志面板里不好读，
       而排查时最常做的是「上一条是几点」这种时间上相邻的对比。 */
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const method = req.method || '?';
    /* 只取路径段，丢掉 query —— query 里可能带 topicId / itemId，
       那属于业务数据，日志里没必要留（DAY23 安全要求：日志不记业务数据）。*/
    const path = (req.url || '?').split('?')[0];
    /* 结果只看「成功还是失败 + 错误码」，不打印 body.data ——
       那是接口的返回内容，可能是整份转写。 */
    const ok = body && body.ok === true;
    const code = ok ? 'ok' : ((body && body.error && body.error.code) || '?');
    console.log('[speech] ' + t + ' ' + method + ' ' + path +
      ' → ' + httpStatus + ' ' + code);
  } catch (e) {
    /*★ 日志失败绝不能影响请求：
       写日志是为了排错，不是业务的一部分。
       这行 catch 是为了「日志本身出异常时，用户的请求照样能返回」。 */
  }
}

/* ---------- HTTP 响应 ---------- */

/* ---------- HTTP 响应（外壳与其他四个接口一致） ---------- */
function sendJSON(res, httpStatus, body) {
  logReq(res, httpStatus, body);
  /* 日志已打：Day 23 要求每次响应都留一条「时间/路径/结果」 */
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
    /*★★★ Day 24 尾巴上删掉了这里原本的一组 CORS 头（第一版 bug 的真因）。
       Day 23 当初在这里多写过一组 CORS 响应头 ——
       允许来源 `*`、允许方法 `POST, OPTIONS`、允许头 `Content-Type`。
       理由是「CloudBase 函数没有统一的允许列表配置可依」—— **这句是错的**：
       网关的「跨域设置」就是那份配置（控制台 `#/env/cross-domain`），
       而且 `/api/speech-to-text` 这条路由的跨域开关**本来就是开的**，
       网关自己会回 `Access-Control-Allow-Origin: <请求来源>`。

       ★ 两边都写 → 浏览器收到**两个同名的 ACAO 头** →
         规范规定「该头出现多值即非法」→ 跨域校验失败 →
         fetch 被 reject（且 err **没有 code**）→ 前端只能落到 `语音失败: UNKNOWN`。

       ★★ 症状极具迷惑性，三条路都是绿的、只有真浏览器挂：
         · `curl` 全绿 —— 它根本不校验 CORS、也不在乎重复头；
         · 预检 `OPTIONS` 也绿 —— 预检由**网关自己应答**、不转发给函数，
           所以那一份是干净的（实测：预检回 `http://localhost:8010`、
           实际 POST 回 `http://localhost:8010,*` —— 差异就在这里露的馅）；
         · 云函数日志也全绿 —— 请求确实到达、也成功返回了 200。

       ★ 另外 5 个云函数（read / write / chat / analyze / health）
         **一处都没写 CORS 头**，全靠网关 —— 这里对齐它们即可。
         （`.test-request-log.js` 里加了一条回归检查钉住这件事。） */
  });
  res.end(JSON.stringify(body));
}

function sendError(res, httpStatus, errorCode, message, extra) {
  const body = { ok: false, data: null, error: { code: errorCode, message: message } };
  if (extra) {
    for (const k of Object.keys(extra)) body[k] = extra[k];
  }
  sendJSON(res, httpStatus, body);
}

/* ---------- 腾讯云 TC3-HMAC-SHA256 签名 ----------
   官方文档给的四步：① 构造规范化请求 ② 构造待签字符串
   ③ 用密钥派生签名 ④ 拼 Authorization 头。
   每一步都对应下面一段，避免「抄了但不知道为什么」。

   ★★ Day 24 修正**两处格式错误**（今天用 `tcb logs search` 挖到的第二个真 bug）。
     腾讯云的原文报错是：
       `[AuthFailure.InvalidAuthorization] … Date in Credential not valid format.`
     对照官方「签名方法 v3」文档里那个**逐值可核**的完整示例
     （时间戳 1551113065 / 日期 2019-02-25 / service cvm）：
       ① `stringToSign` 的**第二行是 Unix 时间戳**（示例 `1551113065`）——
          原来塞的是 `20261013T150150Z` 这种紧凑 RFC3339 串 → **错**。
       ② `Date`（出现在 Credential、CredentialScope，以及派生密钥第一次 HMAC 的**盐**）
          是 **`YYYY-MM-DD` 带连字符**（示例 `2019-02-25`），
          并且必须**由 X-TC-Timestamp 按 UTC+0 换算**（文档专门提醒：混进本地时区，
          东八区凌晨调用必失败）—— 原来用 `timestamp.slice(0, 8)` 得到 `20261013` → **错**。
     ★ 时间戳（Unix 秒）改为**由调用方传进来**，保证签名用的与 `X-TC-Timestamp`
       请求头**是同一个值**（文档：「Date 取值需要和公共参数 X-TC-Timestamp
       换算的 UTC 标准时间日期一致」）。
       ★ 该参数可选：不传就取当前时间 —— 这样 `.test-asr-sign.js` 现有的调用方式原样有效。
     ★ `Authorization` 头里那个 `SignedHeaders=content-type;host` 字段本身是**对的**
       （规则只要求「至少包含 host 与 content-type」）。
       ★★ 但规范请求串里**还必须再写一次**它 —— 见下面 ② 处那段说明，
         漏掉的是**规范请求串里**的那一份，它才是 `SignatureFailure` 的真因。
         （当时看到 Authorization 里已经有了，就误以为这一项全书都对 —— 这是本次踩的坑。） */
function sign(payloadStr, tsSeconds) {
  /* ① 时间戳：Unix 秒（要与 X-TC-Timestamp 请求头一致） */
  const ts = (tsSeconds === undefined || tsSeconds === null)
    ? Math.floor(Date.now() / 1000)
    : tsSeconds;
  /* 对应的 UTC 日期，形如 2019-02-25（**带连字符**，且只取 UTC 那一天） */
  const date = new Date(ts * 1000).toISOString().slice(0, 10);

  /* ② 待签字符串 = 4 行固定文本 + 哈希，顺序与换行都不能变
     ★★ Day 24 修**第三处**（也是 `SignatureFailure` 的真因）：
        规范请求串的**倒数第二行必须是 `SignedHeaders`**（这里是 `content-type;host`），
        而原来这一段只有 7 行、**把它整个漏掉了** —— 少了它签名怎么算都对不上，
        腾讯云回的正是 `[AuthFailure.SignatureFailure]`。
        ★ 为什么极易漏：`Authorization` 头里**也有**一个 `SignedHeaders=content-type;host`
          字段，那一处是对的 → 于是「content-type;host 我已经写过了」的错觉就成立。
          但**规范请求串里必须再出现一次**，两处互相独立、都要写。
        ★ 官方拼法（tencentcloud-sdk-python `abstract_client._get_tc3_signature`）：
          `method \n uri \n query \n canonical_headers \n signed_headers \n payload_hash`
          其中 canonical_headers 自身以 \n 结尾，展开后 `signed_headers` 正落在第 7 行、
          上面留一个空行 —— 与下面这个数组逐项对应。 */
  const hashedPayload = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',                                   /* query 为空 */
    'content-type:application/json; charset=utf-8',
    'host:' + ASR_HOST,
    '',                                   /* canonical headers 结束后的空行 */
    'content-type;host',                   /* ★ SignedHeaders：漏了它 = SignatureFailure */
    hashedPayload                          /* 最后一行是 payload 哈希 */
  ].join('\n');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(ts),                            /* ★ 第二行 = Unix 时间戳（不是日期串） */
    date + '/' + ASR_SERVICE + '/tc3_request',
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n');

  /* ③ 派生签名：日期 → 服务 → 终止符，三次 HMAC 链
        ★ 第一次 HMAC 的盐用**带连字符的 date**，与 Credential 里那个必须一致 */
  function hmac(key, str) {
    return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
  }
  const kDate = hmac('TC3' + ASR_SECRET_KEY, date);
  const kService = hmac(kDate, ASR_SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8').digest('hex');

  /* ④ 拼 Authorization 头 */
  return [
    'TC3-HMAC-SHA256 Credential=' + ASR_SECRET_ID + '/' + date +
      '/' + ASR_SERVICE + '/tc3_request, SignedHeaders=content-type;host, Signature=' + signature
  ].join(',');
}

/* ---------- 调用一句话识别 ---------- */
function callASR(buffer, contentType) {
  return new Promise((resolve, reject) => {
    /* ★★ Day 24 重写这一段（本次 speech 修不好的**根因**就在这）。
       原来这里是 **API v1 风格**的请求体：把 AppId / SecretId / Action / Version /
       Timestamp 全塞进 JSON 里。而本项目走的是 **v3** ——
       公共参数必须放**请求头** `X-TC-*`，请求体只放该接口自己的业务参数。
       症状（今天用 `tcb logs search` 挖出来的）：
         腾讯云回 `MissingParameter: The request header is missing a required
         common parameter `X-TC-Action``，被兜底映射成 `ASR_FAILED`。
       ★ 字段以官方文档「一句话识别 · 输入参数」为准：
         Action（头）= SentenceRecognition、Version（头）= 2019-06-14；
         体 = SubServiceType / ProjectId / EngSerViceType / VoiceFormat /
              SourceType(1=直接传数据) / Data(base64) / DataLen(未编码字节数)。
       ★ 音频要 base64；一句英语约 100–200KB，+33% 后 256MB 内存够用
         （上限见下面的 MAX_BODY）。 */
    const payload = JSON.stringify({
      SubServiceType: 2,                        /* 2 = 一句话识别（无效会被 InvalidParameterValue 拒） */
      ProjectId: 0,
      EngSerViceType: ASR_ENGINE_MODEL_TYPE,    /* ★ 叫 EngSerViceType，不是 EngineModelType */
      VoiceFormat: voiceFormatOf(contentType),
      SourceType: 1,                            /* 1 = 直接上传语音数据（0 才是传 URL） */
      Data: buffer.toString('base64'),
      DataLen: buffer.length                    /* 文档：base64 **之前**的字节数 */
    });

    /* 发请求前先记一条密钥形状自检：这样一旦腾讯云回鉴权类错误，
       日志里能直接看出是「值抄错了」还是「密钥不配对」，
       不用让人反复重填盲试。★ 只记长度/空白，不记值（见 logEnvShape 注释）。 */
    logEnvShape();

    /* ★ 时间戳只算一次，签名与 X-TC-Timestamp 请求头共用它 ——
       两者必须是同一个值（见 sign() 上方那段注释）。 */
    const timestamp = Math.floor(Date.now() / 1000);
    const auth = sign(payload, timestamp);

    const req = https.request(
      {
        hostname: ASR_HOST,
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          /* ★★ 这四个 `X-TC-*` 公共参数头是本次补的、也是修好的关键：
             少了它们腾讯云连请求都不认（`X-TC-Action` 必填）。
             ★ 它们**不参与签名** —— 官方示例里 SignedHeaders 就是 `content-type;host`,
               所以这里补头即可，sign() 一个字都不用动（它的 20 项单测原样有效）。 */
          'X-TC-Action': 'SentenceRecognition',
          'X-TC-Version': ASR_VERSION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': ASR_REGION,
          Authorization: auth,
          Host: ASR_HOST
        }
      },
      (upstream) => {
        let raw = '';
        upstream.setEncoding('utf8');
        upstream.on('data', (c) => { raw += c; });
        upstream.on('end', () => {
          if (upstream.statusCode !== 200) {
            const e = new Error('腾讯云返回 HTTP ' + upstream.statusCode + '：' + raw.slice(0, 200));
            e.code = 'ASR_UPSTREAM_ERROR';
            return reject(e);
          }
          let parsed;
          try { parsed = JSON.parse(raw); }
          catch (err) {
            const e2 = new Error('腾讯云返回的不是 JSON：' + raw.slice(0, 200));
            e2.code = 'ASR_BAD_RESPONSE';
            return reject(e2);
          }
          /* Response.Error存在 时是业务错误（鉴权失败、音频格式不对等） */
          if (parsed && parsed.Response && parsed.Response.Error) {
            const err = parsed.Response.Error;
            const e3 = new Error('[' + err.Code + '] ' + err.Message);
            e3.code = mapUpstreamCode(err.Code);
            return reject(e3);
          }
          const text = parsed.Response && parsed.Response.Result;
          return resolve(typeof text === 'string' ? text.trim() : '');
        });
      }
    );

    req.setTimeout(20000, () => {
      req.destroy();
      const e = new Error('腾讯云没在 20 秒内回应');
      e.code = 'ASR_TIMEOUT';
      reject(e);
    });

    req.on('error', (err) => {
      const e2 = new Error('连不上腾讯云：' + err.message);
      e2.code = 'ASR_UNREACHABLE';
      reject(e2);
    });

    req.write(payload);
    req.end();
  });
}

/* 腾讯云要的 VoiceFormat 与 content-type 对不上就会报错。
   ★ 这张映射表是实测踩出来的：Chrome 的 MediaRecorder 默认给
     audio/webm，而**腾讯云只认 pcm / speex / wav / mp3 / m4a 等**，
     不收 webm —— 所以前端那边要指定 audio/mp4（Safari 默认）
     或用 mp3/wav。 */
function voiceFormatOf(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.indexOf('wav') >= 0) return 'wav';
  if (ct.indexOf('mp3') >= 0) return 'mp3';
  if (ct.indexOf('m4a') >= 0 || ct.indexOf('mp4') >= 0) return 'm4a';
  if (ct.indexOf('speex') >= 0) return 'speex';
  if (ct.indexOf('pcm') >= 0) return 'pcm';
  /* 兜底：前端会优先转成 mp3/wav再发，这里只是别把webm 原样送上去 */
  return 'wav';
}

/* 把腾讯云的错误码映射到本项目的语义。
   ★ 为什么要映射而不透传：腾讯云的码（如 AuthFailure.SecretIdNotFound）
     对用户没有意义，前端也认不出；本项目要的是「能不能用、该怎么办」。 */
function mapUpstreamCode(code) {
  const c = String(code || '');
  if (c.indexOf('AuthFailure') === 0) return 'ASR_AUTH_FAILED';
  if (c.indexOf('InvalidParameter') === 0) return 'ASR_BAD_AUDIO';
  if (c.indexOf('FailedOperation') === 0) return 'ASR_FAILED';
  if (c.indexOf('LimitExceeded') === 0) return 'ASR_RATE_LIMITED';
  if (c.indexOf('RequestLimitExceeded') === 0) return 'ASR_RATE_LIMITED';
  return 'ASR_FAILED';
}

/* ---------- 请求体读取 ----------
   ★ 上限：8MB。base64 之后 8MB ≈ 6MB 音频 ≈ 好几分钟英语，
     远超「一句话」的长度 —— 给足余量，同时防恶意大包撑爆内存。 */
const MAX_BODY = 8 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_BODY) {
        /* ★ 立刻断开而不是继续收：超了就是超了，
           继续收只会浪费带宽与内存。 */
        tooLarge = true;
        req.destroy();
        const e = new Error('音频太大了');
        e.code = 'ASR_TOO_LARGE';
        return reject(e);
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!chunks.length) {
        const e = new Error('没收到音频数据');
        e.code = 'ASR_EMPTY_BODY';
        return reject(e);
      }
      resolve({ buffer: Buffer.concat(chunks), contentType: req.headers['content-type'] });
    });
    req.on('error', reject);
  });
}

/* ---------- 主处理 ---------- */
async function handleSpeech(req, res) {
  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    /* 契约§1.2：请求本身不合法用 4xx，业务错误用 200 + ok:false */
    const isClient = (err.code === 'ASR_TOO_LARGE' || err.code === 'ASR_EMPTY_BODY');
    return sendError(res, isClient ? 400 : 200,
      err.code || 'ASR_FAILED', err.message);
  }

  /* ★ 音频太短基本等于「他没说话」—— 直接回空文本，
     交给前端走「没听清」的提示，不要花钱调腾讯云。 */
  if (payload.buffer.length < 3000) {
    return sendJSON(res, 200, {
      ok: true,
      data: { text: '', engine: 'none', reason: 'TOO_SHORT' }
    });
  }

  let text;
  try {
    text = await callASR(payload.buffer, payload.contentType);
  } catch (err) {
    const code = err.code || 'ASR_FAILED';
    const msgMap = {
      ASR_AUTH_FAILED: '语音识别服务没配好（密钥无效）',
      ASR_BAD_AUDIO: '音频格式不对，识别不了',
      ASR_RATE_LIMITED: '识别请求太频繁，慢一点再试',
      ASR_TIMEOUT: '识别服务响应超时，稍后再试',
      ASR_UNREACHABLE: '连不上识别服务，检查网络',
      ASR_BAD_RESPONSE: '识别服务返回的内容没法解析',
      ASR_UPSTREAM_ERROR: '识别服务出错了'
    };
    /* ★ 详情只进日志，不进响应体 ——
       腾讯云的错误信息里可能带账号信息与请求内容，
       透传等于把它公开到公网。排错看云端日志。 */
    console.warn('[speech] 识别失败 code=' + code + ' detail=' +
      String(err.message).slice(0, 200));
    return sendError(res, 200, code, msgMap[code] || '语音识别失败');
  }

  /* 转写为空：不报错，当作「没听清」——
     前端据此提示重说，而不是弹一个错误。 */
  sendJSON(res, 200, {
    ok: true,
    data: { text: text, engine: ASR_ENGINE_MODEL_TYPE }
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const norm = path.replace(/\/+$/, '') || '/';

  /* CORS 预检：浏览器发POST 前会先发 OPTIONS，不回它会报跨域错。 */
  if (req.method === 'OPTIONS') {
    return sendJSON(res, 204, {});
  }

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 POST');
  }

  /* 网关的 enablePathTransmission 默认是 false 会剥掉路径，
     这条路由在 cloudbaserc.json 里开了透传，两边都留着写法做双保险。 */
  const isSpeech = norm === '/api/speech-to-text' || norm === '/speech-to-text';
  if (!isSpeech) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：POST /api/speech-to-text（multipart/form-data 或音频二进制）',
      { gotPath: path });
  }

  /* ★ 缺密钥要在**第一次调用**就明确报出来，
     而不是等用户说了话才看到含糊报错。 */
  const missing = checkEnv();
  if (missing.length) {
    return sendError(res, 200, 'ASR_NOT_CONFIGURED',
      '语音识别服务还没配置好（缺少环境变量：' + missing.join('、') + '）',
      { gotPath: path, missingEnv: missing });
  }

  handleSpeech(req, res).catch((err) => {
    console.error('[speech] 未捕获异常', err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    }
  });
});

/* 端口 9000 + 0.0.0.0：CloudBase HTTP 云函数只认这个（与另四个函数一致）。 */
server.listen(9000, '0.0.0.0', () => {
  const missing = checkEnv();
  console.log('[speech] listening on 0.0.0.0:9000');
  console.log('[speech] route: POST /api/speech-to-text');
  console.log('[speech] 引擎：' + ASR_ENGINE_MODEL_TYPE + '（腾讯云一句话识别）');
  console.log('[speech] ★ 音频会离开设备发给腾讯云，不落库、不留存');
  console.log('[speech] 环境变量：' + (missing.length === 0
    ? '已配置（SecretId / SecretKey / AppId）'
    /* 只说缺哪几个名字，不说值，也不说存在与否的值内容 */
    : '缺少 ' + missing.join('、') + '（不打印值）'));
});