/* Day 23 第四次修订实测：识别会不会「说完一句就不听了」
   -------------------------------------------------------------
   用户实测原话：「我讲了半天都没有被录入进去」「说了半天 AI 没反应」。

   根因是三个独立的 bug 叠在一起（都是我自己写的）：
     ① armSilence 的定时器里调 stopListening()，把 wantListen 置 false
        → 一句提交后识别再也不重启
     ② speakAiLine 里 `if (!canSpeak()) return;`
        → 没有语音合成的浏览器上，识别永远不重启
     ③ 提交后没有立刻恢复识别
        → AI 回话那 3–8 秒里说的话被静默丢掉

   ★ 这三个都**读代码看不出来**（每一处单看都合理），必须真跑。

   ★★★ 注入点（第 1 版踩的坑，这里是正解）：
     第 1 版替换 `window.Speech` 造一个假对象 —— **没用**。
     探针实测 `recOnresult: false`：页面用的是**真 speech.js** 的代码
     （它自己 `new Recognition()`），假 Speech 只是个没人用的壳，
     回调挂不上去、`__speak` 永远返回 false。

     正确做法：**替换 `webkitSpeechRecognition` 构造器**，
     让页面自己的 speech.js 照常跑，只是它 new 出来的东西我们能控制。
     ★ 注入点越低（越接近底层），测到的越接近真实代码路径。
     顺带删掉 `speechSynthesis` → `canSpeak()` 变 false，
     这正是 bug ② 的触发条件（最狠的一种浏览器）。

   ★ FakeRecognition.stop() 必须**触发 onend** —— 真SpeechRecognition 就是这样，
     而 speech.js 的 onend 里会自动重启识别（wantListen 为 true 时）。
     不触发的话那段重启代码永远走不到，测的就不是真实路径。

   用法：先 cd frontend && python serve.py，再 node .test-speech-restart.js */

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
const PORT = 9229;
const PAGE_URL = 'http://localhost:8010/pages/dialogue.html?topic=T1';
const SILENCE_MS = 2500;   /* 与 speech.js 的 SILENCE_END_MS 保持一致 */

/* 注入源码：替换构造器 + 删掉语音合成。必须在文档脚本之前跑。 */
const FAKE_SPEECH = `(function(){
  window.__starts = 0;
  window.__ends = 0;
  window.__fakeRec = null;
  function FakeRecognition(){
    var self = this;
    this.lang=''; this.continuous=false; this.interimResults=false; this.maxAlternatives=0;
    this.onresult=null; this.onerror=null; this.onend=null;
    this.start=function(){ window.__starts++; window.__fakeRec = self; };
    /* ★★ Day 23 第六次修订：这个桩现在会像真浏览器一样，
       在 stop() 之后先抛一次 onerror('aborted') 再走 onend ——
       真 SpeechRecognition 就是这个顺序（stop 被当作「被中断」）。
       第 5 版没模拟这一步，所以测不出「aborted 误判成故障」这个 bug。 */
    this.stop=function(){
      window.__ends++;
      if (self.onerror) { try{ self.onerror({ error: 'aborted' }); }catch(e){} }
      if (self.onend) { try{ self.onend(); }catch(e){} }
    };
    this.abort=function(){ this.stop(); };
    window.__fakeRec = self;
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  /* ★★ 无头 Chrome 没有麦克风设备，getUserMedia 直接失败 →
     speech.js 的 micPermission() 返回 'denied' → 识别**根本不会启动**。
     探针实测 starts:0 而 ends:3 就是这么来的。
     所以必须把 getUserMedia 也桩掉 —— 它是「权限探测」，
     失败就该进入 E1 分支（页面已实现），这里是让测试能往下走。 */
  try {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: function(){
          return Promise.resolve({
            getTracks: function(){ return [{ stop: function(){} }]; }
          });
        }
      }
    });
  } catch(e) { /* defineProperty 失败就放弃，测试会报 starts:0 */ }
  try { delete window.speechSynthesis; } catch(e){ window.speechSynthesis = undefined; }
  try { delete window.SpeechSynthesisUtterance; } catch(e){ window.SpeechSynthesisUtterance = undefined; }
  window.__speak = function(text){
    var r = window.__fakeRec;
    if (!r || !r.onresult) return false;
    r.onresult({ resultIndex:0, results: [{ 0:{transcript:text}, length:1, isFinal:true }] });
    return true;
  };
  window.__probe = function(){
    var real = (window.Speech && window.Speech.__debug) ? window.Speech.__debug() : null;
    return JSON.stringify({
      starts: window.__starts,
      ends: window.__ends,
      hasRec: !!window.__fakeRec,
      onresult: !!(window.__fakeRec && window.__fakeRec.onresult),
      /* ★ 真实内部状态 —— 比桩里的变量可信。
         第 6 版之前一直只看桩的 __fakeRec，方向错了。 */
      real: real
    });
  };
  /* ★ 抓页面上「降级提示」有没有出现 ——
     aborted 若是又被当成故障，用户就会看到「语音识别暂时用不了」。
     这是本次修复最直接的观测量。 */
  window.__degraded = function(){
    var b = document.getElementById('btn-talk');
    var n = document.getElementById('rec-note');
    return (b ? b.textContent : '') + ' /// ' + (n ? (n.textContent||'').slice(0,80) : '');
  };
})();`;

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
    '--user-data-dir=' + path.join(__dirname, '.chrome-d23-restart'),
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

  await send('Page.enable');
  await send('Runtime.enable');
  /* ★ 注入必须在文档脚本之前 —— speech.js 加载时会取
     `window.SpeechRecognition || window.webkitSpeechRecognition`，
     晚一步就来不及了。 */
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SPEECH });
  await send('Page.navigate', { url: PAGE_URL });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evaluate('!!window.__probe')) { ready = true; break; } }
    catch (e) { /* 还没加载 */ }
  }
  if (!ready) { console.log('✗ 注入或页面没就绪'); ws.close(); chrome.kill(); return; }

  const canSpeak = await evaluate(
    '!!(window.Speech && window.Speech.canSpeak && window.Speech.canSpeak())'
  );
  const supported = await evaluate(
    '!!(window.Speech && window.Speech.supported())'
  );
  const noteVisible = await evaluate(
    '(function(){var n=document.getElementById("rec-note");' +
    'return n ? n.textContent.slice(0,60) : "(no note)";})()'
  );
  console.log('=== Day 23 识别重启实测（canSpeak=' + canSpeak +
    '，即没有语音合成的浏览器）===');
  console.log('  supported()=' + supported + '（决定 SPEECH_OK，必须为 true）');
  console.log('  提示行：' + noteVisible);

  /* 开场白先落地，免得干扰计数 */
  await evaluate('document.getElementById("btn-talk").click(); true');
  await sleep(9000);
  const p0 = await evaluate('window.__probe()');

  /* 第 1 句 */
  const said1 = await evaluate('window.__speak("I think the second part is not done yet.")');
  await sleep(SILENCE_MS + 1500);
  const p1 = await evaluate('window.__probe()');
  const rows1 = await evaluate('document.querySelectorAll(".tr-row:not(.is-ai)").length');

  /* ★ 关键：第 2 句。bug ①/② 还在的话，这一句进不去。 */
  await sleep(6000);
  const said2 = await evaluate('window.__speak("We need two more days for testing.")');
  await sleep(SILENCE_MS + 1500);
  const p3 = await evaluate('window.__probe()');
  const rows2 = await evaluate('document.querySelectorAll(".tr-row:not(.is-ai)").length');

  /* 第 3 句 —— 再加一道，确认不是「只支持两句」 */
  const said3 = await evaluate('window.__speak("Can you walk me through the testing plan?")');
  await sleep(SILENCE_MS + 1500);
  const rows3 = await evaluate('document.querySelectorAll(".tr-row:not(.is-ai)").length');
  const texts = await evaluate(
    'Array.prototype.map.call(document.querySelectorAll(".tr-row:not(.is-ai) .tr-text"),' +
    'function(n){return n.textContent;}).join(" | ")'
  );

  /* ★ 根因探针：为什么 starts 不涨？
     分四种可能，一次看清，不再来回猜：
       a) 没进startListening（入口被 listening/already 挡了）
       b) 进了但start() 抛错
       c) 进了但权限检查失败
       d) 完全没被调用 */
  /* ★★ 真正要问的：页面到底调没调 startListening？
     starts=2 只说明桩被调过 2 次，但**不知道是不是页面调的**。
     —— supported() 若为 false，SPEECH_OK 就是 false，
       页面走的是 `noteSpeech('不支持语音')` 那条路，一次都不会调。 */
  const speechOk = await evaluate(
    '!!(window.Speech && window.Speech.supported()) && !!document.getElementById("btn-talk")'
  );
  const btnText = await evaluate(
    '(document.getElementById("btn-talk")||{}).textContent || "(none)"'
  );
  const why = await evaluate(
    '(function(){' +
    'var d = window.Speech.__debug();' +
    'return JSON.stringify(d);' +
    '})()'
  );
  /* 手动再调一次，看返回什么 */
  const manual = await evaluate(
    '(function(){' +
    'var r = window.Speech.startListening();' +
    'return String(r);' +
    '})()'
  );
  await sleep(800);
  const afterManual = await evaluate('window.__probe()');

  console.log('  点开始后     ：' + p0);
  console.log('  ★ 按钮文案：' + btnText + '（变成「开始练习」= 已降级，页面没在用语音）');
  console.log('  ★ 根因探针：' + why);
  console.log('  ★ 手动再调 startListening → ' + manual);
  console.log('  ★ 手动之后   ：' + afterManual);
  console.log('  说第 1 句    ：注入=' + said1 + ' → ' + p1 + '｜用户气泡 ' + rows1 + ' 个');
  console.log('  说第 2 句    ：注入=' + said2 + ' → ' + p3 + '｜用户气泡 ' + rows2 + ' 个');
  console.log('  说第 3 句    ：注入=' + said3 + '｜用户气泡 ' + rows3 + ' 个');

  /* ★ 判据：三句都要录进去。
     这正是「说了半天 AI 没反应」的直接反面 ——
     如果第 2 句之后就进不去，用户体验就是「只有第一句被听到，之后全丢」。 */
  const degraded = await evaluate('window.__degraded()');

  /* ★ 判据一：三句都要录进去。
     这正是「说了半天 AI 没反应」的直接反面 ——
     如果第 2 句之后就进不去，用户体验就是「只有第一句被听到，之后全丢」。 */
  const okRows = rows3 >= 3;
  console.log((okRows ? '  ✓ ' : '  ✗ ') + '连续三句都能录入：' + rows3 + ' 个，要求 ≥3');
  console.log('    录进去的内容：' + (texts || '（无）'));

  /* ★ 判据二：aborted 不得被当成故障。
     按钮文案必须是「🎙 开始说话」而不是「开始练习」——
     后者说明 degradeToText 被触发过了（误判成「不支持语音」）。 */
  const okNoDegrade = degraded.indexOf('开始练习') === -1;
  console.log((okNoDegrade ? '  ✓ ' : '  ✗ ') +
    'aborted 没被误判成故障（按钮未降级）');
  console.log('    按钮与提示：' + degraded);
  /* ★ 打印完整诊断行 —— 重启失败的**真实原因**就在里面
     （形如 restart-failed:InvalidStateError:xxx）。
     之前只报码不报信息，我为「为什么失败」猜了好几轮都没中。 */
  const fullDiag = await evaluate(
    '(function(){var n=document.getElementById("rec-note");' +
    'return n ? n.textContent : "(none)";})()'
  );
  console.log('    完整诊断：' + fullDiag);

  const ok = okRows && okNoDegrade;
  console.log('===== ' + (ok ? 1 : 0) + ' / 2 通过 =====');

  ws.close();
  try { chrome.kill(); } catch (e) {}
}

main().catch(function (e) { console.error('实测脚本出错：', e.message); process.exit(1); });