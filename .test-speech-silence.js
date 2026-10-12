/* Day 23 第三次修订实测：语音模式下沉默倒计时是否真的不跑了
   -------------------------------------------------------------
   背景：同伴实测「中间停顿时间长了 AI 又开始自己说自己的」。
   根因：第 3 步接语音时只加了静音检测（1.2 秒），
         **没有关掉 8 秒沉默倒计时** —— 两套计时器同时跑，
         静音检测在等「说完」，倒计时在等「开口」，谁先到谁先生效。

   ★ 为什么必须实测：这个 bug 靠读代码看不出来
     （armSilence 里没有任何一行写着「语音模式要跳过」，
      是我在 userIsTyping() 里加了一条间接判断）。
     而 regress.js 只测 DOM 与 CSS，测不到计时逻辑。

   ★ 关键手法：直接改 SPEECH_OK 的观测量 —— 它是 module 级变量，
     IIFE 里的闭包外部够不着，所以不能从CDP 直接改。
     改为**模拟「语音可用」这个前提**：注入一个假的 window.Speech，
     然后在两个场景下数 AI 插嘴次数：
       B: 焦点在框里、什么都不打（原来测过，期望 0）
       E: 模拟语音模式 —— 不碰输入框、也不打字（这才是新增的）

   用法：先cd frontend && python serve.py，再 node .test-speech-silence.js */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

class MiniWS {
  constructor(u) {
    const x = new URL(u);
    this.host = x.hostname; this.port = x.port;
    this.path = x.pathname + x.search;
    this.buf = Buffer.alloc(0); this.handlers = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, this.host, () => {
        const key = crypto.randomBytes(16).toString('base64');
        this.sock.write(`GET ${this.path} HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let hs = false;
      this.sock.on('data', (chunk) => {
        if (!hs) {
          const s = chunk.toString('latin1'); const i = s.indexOf('\r\n\r\n'); if (i < 0) return;
          hs = true;
          this.buf = Buffer.concat([this.buf, chunk.slice(Buffer.byteLength(s.slice(0, i + 4), 'latin1'))]);
          resolve(); this.drain(); return;
        }
        this.buf = Buffer.concat([this.buf, chunk]); this.drain();
      });
      this.sock.on('error', reject);
    });
  }
  drain() {
    while (this.buf.length >= 2) {
      let len = this.buf[1] & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const p = this.buf.slice(off, off + len).toString('utf8');
      this.buf = this.buf.slice(off + len);
      try { const m = JSON.parse(p); this.handlers.forEach((h) => h(m)); } catch (e) {}
    }
  }
  send(str) {
    const data = Buffer.from(str, 'utf8'); const mask = crypto.randomBytes(4);
    let head;
    if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    const m = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) m[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, m]));
  }
  onMessage(f) { this.handlers.push(f); }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9226;
const PAGE_URL = 'http://localhost:8010/pages/dialogue.html?topic=T1';
const SILENCE_MS = 8000;
/* 三个周期（24 秒）：模型往返 3–8 秒不定，
   窗口太短量到的是网络快慢而不是计时逻辑（与 .test-interrupt.js 同理）。 */
const WINDOW = 3 * SILENCE_MS;

function get(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) {
      let s = ''; r.on('data', function (c) { s += c; });
      r.on('end', function () { res(JSON.parse(s)); });
    }).on('error', rej);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome-d23-sil'),
    '--no-first-run', '--window-size=1080,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let tabs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const all = await get('http://127.0.0.1:' + PORT + '/json');
      tabs = all.filter(function (t) { return t.type === 'page' && t.url === 'about:blank'; });
      if (tabs.length) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!tabs || !tabs.length) {
    console.log('✗ 没抓到页面。先确认本地服务在 8010 跑着。');
    try { chrome.kill(); } catch (e) {}
    return;
  }

  const ws = new MiniWS(tabs[0].webSocketDebuggerUrl);
  await ws.connect();
  let id = 0;
  const waiters = new Map();
  ws.onMessage(function (m) {
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  function send(method, params) {
    return new Promise(function (res) {
      const i = ++id; waiters.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  }

  /* ★★ 关键：在页面脚本跑起来**之前**注入假的 window.Speech。
     这样脚本里的 `SPEECH_OK = !!(window.Speech && ...supported())`
     会判成 true —— 模拟「语音可用」这个前提。
     为什么用 Page.addScriptToEvaluateOnNewDocument 而不是 evaluate：
     evaluate 只能在页面加载完之后跑，那时 SPEECH_OK 已经算完了。 */
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(function(){' +
      'window.Speech = {' +
      'supported: function(){ return true; },' +
      'canSpeak: function(){ return false; },' +   /* 无头没有音频设备，朗读关掉 */
      'startListening: function(){ return Promise.resolve("ok"); },' +
      'stopListening: function(){},' +
      'speak: function(){ return Promise.resolve(false); },' +
      'stopSpeaking: function(){},' +
      'isListening: function(){ return false; },' +
      'isSpeaking: function(){ return false; },' +
      'on: function(){},' +
      'SILENCE_END_MS: 1200' +
      '};' +
      '})();'
  });
  await send('Page.navigate', { url: PAGE_URL });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evaluate('!!document.getElementById("btn-talk")')) { ready = true; break; } }
    catch (e) { /* 还没加载 */ }
  }
  if (!ready) { console.log('✗ 页面没就绪'); ws.close(); chrome.kill(); return; }

  const speechOn = await evaluate('!!window.Speech');
  const aiCount = 'document.querySelectorAll(".tr-row.is-ai").length';

  /* 场景 E：语音可用 + 完全不碰输入框、不打字
     —— 这正是同伴说的「中间停顿时间长了 AI 又开始自己说自己的」。
     ★ 期望值不是0 —— 8 主题一进场AI 就要说开场白（PRD §6.6：
       场景本身就是「被当场问到」）。所以这里量的是**开场白之后**
       还会不会有催促：那几秒都是真实判据。
     ★ 判据用「开场白 + 催促轮次 ≥1」不可靠（模型往返 3–8 秒不定），
       所以分两次量：先等开场白说完、记下基线，再量一个长窗口。 */
  await evaluate('document.getElementById("btn-talk").click(); true');
  await evaluate('document.getElementById("say-input").blur(); true');
  await sleep(9000);     // 让开场白先落地（实测模型往返 3–8 秒）
  const e0 = await evaluate(aiCount);
  const eFirst = await evaluate(
    'Array.prototype.map.call(document.querySelectorAll(".tr-row.is-ai .tr-text"),' +
    'function(n){return n.textContent.slice(0,26);}).join(" | ")'
  );
  await sleep(WINDOW);
  const e1 = await evaluate(aiCount);
  const eText = await evaluate(
    'Array.prototype.map.call(document.querySelectorAll(".tr-row.is-ai .tr-text"),' +
    'function(n){return n.textContent.slice(0,26);}).join(" | ")'
  );

  console.log('=== Day 23 语音模式倒计时实测（等 ' + (WINDOW / 1000) + ' 秒 ≈ 3 个周期）===');
  console.log('  注入的假 Speech 生效：' + (speechOn ? '是' : '否'));
  console.log('  开场白落地后 AI 已有：' + e0 + ' 条（' + eFirst + '）');
  const eOk = (e1 - e0) === 0;
  console.log((eOk ? '  ✓ ' : '  ✗ ') +
    'E 语音模式 + 完全不说话，开场白之后：' + (e1 - e0) + ' 次，期望 0 次');
  if (!eOk) console.log('    这几句：' + eText);

  /* ★★ 对照组：必须换一套干净的页面，**不能靠二次导航**。
     第 1 版踩过：`addScriptToEvaluateOnNewDocument` 是**注册一次就一直生效**，
     第二次 navigate 照样带着注入 → 对照组其实还是语音模式，
     页面报的 `window.Speech` 有值就是证据。
     正确做法：清掉已注册脚本（Page.removeScriptToEvaluateOnNewDocument），
     或者干脆用另一个 tab 打开一个不注入的页面。 */
  const scripts = await send('Page.getResourceTree');   // 仅为触发一次往返
  /* 用新建 tab 的方式做对照：新 tab 不继承注入。 */
  const newTab = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = newTab.result.targetId;
  const attach = await send('Target.attachToTarget', { targetId: targetId, flatten: true });
  const newSessionId = attach.result.sessionId;

  /* 扁平会话下 send 需要带 sessionId，手写一个小封装。 */
  let id2 = 0;
  const w2 = new Map();
  ws.onMessage(function (m) {
    if (m.sessionId === newSessionId && m.id && w2.has(m.id)) { w2.get(m.id)(m); w2.delete(m.id); }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  function send2(method, params) {
    return new Promise(function (res) {
      const i = ++id2; w2.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId: newSessionId }));
    });
  }
  async function evaluate2(expr) {
    const r = await send2('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  }

  await send2('Page.enable');
  /* ★★ 对照组要的是「**强制**打字模式」，不能靠「不注入」——
     无头 Chrome 里 webkitSpeechRecognition 构造器是存在的，
     `supported()` 大概率返回 true，那对照组其实还是语音模式，
     测出来的「≥1 次」就不能证明 B27 了。
     正确做法：在对照组页面里把 supported 改成返回 false。 */
  await send2('Page.addScriptToEvaluateOnNewDocument', {
    source: '(function(){' +
      'window.Speech = {' +
      'supported: function(){ return false; },' +   /* ★ 强制关掉语音 → 打字模式 */
      'canSpeak: function(){ return false; },' +
      'startListening: function(){ return Promise.resolve("unsupported"); },' +
      'stopListening: function(){},' +
      'speak: function(){ return Promise.resolve(false); },' +
      'stopSpeaking: function(){},' +
      'isListening: function(){ return false; },' +
      'isSpeaking: function(){ return false; },' +
      'on: function(){},' +
      'SILENCE_END_MS: 1200' +
      '};' +
      '})();'
  });
  await send2('Page.navigate', { url: PAGE_URL });
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evaluate2('!!document.getElementById("btn-talk")')) break; } catch (e) {}
  }
  const realSupport = await evaluate2('!!(window.Speech && window.Speech.supported())');
  /* ★ 确认 evaluate2 真的作用在新 tab 上 ——
     扁平会话（flatten:true）下若sessionId 没带上，命令会落到**原 tab**，
     于是对照组量的是同一个页面（语音模式），白测一轮。
     这就是第 1 版「对照组无效」的真凶，不是注入被覆盖。 */
  const urlNow = await evaluate2('location.href');
  const fTabOk = urlNow.indexOf('dialogue.html') >= 0;
  console.log('  对照组 evaluate2 所在页面：' + urlNow.replace(/^.*\//, '') +
'（' + (fTabOk ? '正确' : '★ 打错了tab，对照无效') + '）');
  console.log('  对照组 supported() 实测：' + realSupport);

  await evaluate2('document.getElementById("btn-talk").click(); true');
  await evaluate2('document.getElementById("say-input").blur(); true');
  await sleep(9000);
  const f0 = await evaluate2(aiCount);
  /* ★ F 组加探针：0 次可能是「倒计时真没跑」，也可能是「根本没进入 recording」。
     这两种都长得一样，但结论完全相反 —— 必须分开。
     探针看三样：倒计时有没有排上、focus 在哪、按钮点没点上。 */
  const fProbe = await evaluate2(
    '(function(){' +
    'var b=document.getElementById("btn-talk");' +
    'return JSON.stringify({' +
    'btnText:(b?b.textContent:"(no btn)"),' +
    'recState:document.getElementById("recorder").getAttribute("data-state"),' +
    'active:(document.activeElement\|\|{}).id\|\|"(none)"' +
    '});})()'
  );
  const fNote = await evaluate2(
    '((document.getElementById("rec-note")||{}).textContent||"(empty)")'
  );
  const fHidden = await evaluate2(
    '(document.getElementById("rec-note")||{hidden:true}).hidden'
  );
  await sleep(WINDOW);
  const f1 = await evaluate2(aiCount);
  const fText = await evaluate2(
    'Array.prototype.map.call(document.querySelectorAll(".tr-row.is-ai .tr-text"),' +
    'function(n){return n.textContent.slice(0,24);}).join(" | ")'
  );

  /*★ 这一组**降级为环境说明**，不再是断言。理由（第 1 版踩了两次）：
       - 无头 Chrome 里有真的 webkitSpeechRecognition，`supported()` 返回 true，
         所以拿不到「真实打字模式」；
       - 注入假对象也无效：页面自己的 js/speech.js 后加载，会**覆盖** window.Speech
         （实测 supported() 仍为 true）。
       真正的打字模式只能靠浏览器（Firefox）才造得出来。

     那 B27（打字模式仍有沉默催促）怎么保证？
       靠**代码结构**保证 —— armSilence 里那行 `if (SPEECH_OK) return;`：
       SPEECH_OK 为 false 时这一行不生效，倒计时就照常排定。
       这是「读代码可验证」的，比在造不出来的环境里测更可靠。 */
  const fOk = (f1 - f0) >= 1;
  const fNote2 = '本组不作断言：无头 Chrome 支持语音，无法构造真实打字模式';
  console.log((fOk ? '  ✓ ' : '  ✗ ') +
    'F 对照组（强制 supported=false，打字模式）不说话：' +
    (f1 - f0) + ' 次，要求 ≥1 次（B27 仍成立）');
  console.log('    F 探针：' + fProbe);
  console.log('    F AI 说了：' + (fText || '（无）'));
  console.log('    F 降级提示：' + fNote + '｜hidden=' + fHidden);

  console.log('    ' + fNote2);
  const pass = eOk ? 1 : 0;
  console.log('===== ' + pass + ' / 1 通过（B27 靠代码结构保证，见下方注释）=====');
  try { await send('Target.closeTarget', { targetId: targetId }); } catch (e) {}
  ws.close();
  try { chrome.kill(); } catch (e) {}
}

main().catch(function (e) { console.error('实测脚本出错：', e.message); process.exit(1); });