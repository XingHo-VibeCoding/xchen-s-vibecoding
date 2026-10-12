/* Day 23 插嘴实测：在真实浏览器里跑三个场景，数 AI 到底插了几次嘴。
   -------------------------------------------------------------
   为什么必须实测：同伴反馈「AI 还是在插嘴」，第1 版修完没见效。
   靠读代码判断是哪条路径漏的极易想错 —— 第 1 版就是这么漏的：
   只在「起算那一刻」判了有没有在打字，定时器排定后就不管了。
   ★ 这条教训与 `.test-write.js` 那条「单测要断言行为而不是写法」同源：
     修机制就得跑机制，不能跑完单测就交差。

   ★ 零npm 依赖：MiniWS 直接抄自 `.headless-frontend-d22.js`
     （regress.js 是脚本不是模块，require 进来会立刻开跑）。

   用法：先 `cd frontend && python serve.py`，再 `node .test-interrupt.js` */

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
const PORT = 9224;
const PAGE_URL = 'http://localhost:8010/pages/dialogue.html?topic=T1';

/* 场景各自等多久：8 秒是SILENCE_MS（用户拍板的值），
   留 3 秒余量给「AI 回完那一句」本身。 */
const SILENCE_MS = 8000;
const WAIT_WINDOW = SILENCE_MS + 3000;

/* ★★ 把窗口拉长到 3 个倒计时周期（3*8000+4000≈28 秒）。
   为什么必须这么长：**前两轮实测数字不稳定**——
   A 有时1 次有时 2 次、B 时而 0 次时而 1 次。
   根因是云函数往返耗时 3–8 秒不确定：短的时候一个窗口里塞得下
   「开场白 + 催促 + 第二次催促」，长的时候只够一次。
   窗口太短时测的是「网络快慢」，不是「计时器对不对」。
   ★ 这条与 MEMORY 里「公网验证 ≠ curl 绿，要用户眼睛确认」同源：
     判定必须能复现，否则数字是噪声不是证据。 */
const LONG_WINDOW = 3 * SILENCE_MS + 4000;

function get(url) {
  return new Promise(function (res, rej) {
    http.get(url, function (r) {
      let s = '';
      r.on('data', function (c) { s += c; });
      r.on('end', function () { res(JSON.parse(s)); });
    }).on('error', rej);
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(__dirname, '.chrome-d23-int'),
    '--no-first-run', '--window-size=1080,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let tabs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const all = await get('http://127.0.0.1:' + PORT + '/json');
      /* ★ 按 URL 精确匹配（只按 type==='page' 会抓到扩展页） */
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
      const i = ++id;
      waiters.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails));
    }
    return r.result.result.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: PAGE_URL });

  // 等页面脚本跑起来（btn-talk 能拿到= IIFE 已执行完bindGuards）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { if (await evaluate('!!document.getElementById("btn-talk")')) { ready = true; break; } }
    catch (e) { /* 还没加载 */ }
  }
  if (!ready) { console.log('✗ 页面没就绪'); ws.close(); chrome.kill(); return; }

  const aiCount = 'document.querySelectorAll(".tr-row.is-ai").length';

  /* ---- 场景 A：一句话都不说 → 按 8 秒口径，AI 应该先开口 ----
     这是 B27 验收项，必须保证没被改坏。
     ★ 也挂探针：上一轮这里报 2 次（期望 1），得看清多出来的那次
       是「开口白+ 一句催促」还是「催了两轮」。 */
  await evaluate(
    'window.__probeA=[];' +
    '(function(){var i=document.getElementById("say-input");' +
    'i.addEventListener("focus",function(){window.__probeA.push("focus");});' +
    'i.addEventListener("blur",function(){window.__probeA.push("blur");});})();' +
    'document.getElementById("btn-talk").click(); true'
  );
  await evaluate('document.getElementById("say-input").blur(); true');
  const a0 = await evaluate(aiCount);
  await sleep(LONG_WINDOW);
  const a1 = await evaluate(aiCount);
  const aProbe = await evaluate('JSON.stringify(window.__probeA)');
  const aText = await evaluate(
    'Array.prototype.map.call(document.querySelectorAll(".tr-row.is-ai .tr-text"),' +
    'function(n){return n.textContent.slice(0,28);}).join(" | ")'
  );

  /* ---- 场景 B：一句话都不说，就让光标停在框里 ----
     ★ 这场景有个陷阱（前两轮都栽在这里）：它接在 A 之后，
       而 A 结束时 AI 刚说了句、armSilence 已排上了 → B 一开始就带着
       一个**已经在跑的定时器**，量到的是 A 的残留，不是 B 自己的行为。
       前两轮 B 的数字在 0/1 之间跳，正是这个原因（不是代码不稳）。

     修法：B 之前先 blur + 等一个长窗口，让A 的残留定时器全部走完，
     再从「定时器干净、焦点在框」的状态起步。 */
  await evaluate('document.getElementById("say-input").blur(); true');
  /* ★ 记下blur 之后的焦点：上一版只看 B 窗口内的探针，
     看不到「起步时焦点究竟在哪」—— 而这正是 B 忽好忽坏的原因。 */
  const bStartFocus = await evaluate('(document.activeElement||{}).id || "(none)"');
  await sleep(LONG_WINDOW);
  const bMidFocus = await evaluate('(document.activeElement||{}).id || "(none)"');
  /* ★ 探针必须**先挂后 focus** —— 第 1 版反过来写，
     监听在 focus() 之后才挂，事件永远抓不到（看到 [] 而非「没事件」）。
     这与 MEMORY 里「测页面的变量必须挂到 window 上」是同一类坑。 */
  /* ★★ 无头环境的坑：页面没拿到窗口焦点时，`.focus()` 可能静默不生效
     （探针实测：blur 后焦点 #(none)，调 focus() 也不动）。
     所以这里用「真实点击」来建立焦点 —— 与用户动作一致，
     而不是脚本直接调 focus()。 */
  await evaluate(
    '(function(){' +
    'window.__probe=[];' +
    'var i=document.getElementById("say-input");' +
    'i.addEventListener("focus",function(){window.__probe.push("focus");});' +
    'i.addEventListener("blur",function(){window.__probe.push("blur");});' +
    'i.addEventListener("input",function(){window.__probe.push("input");});' +
    'var r=i.getBoundingClientRect();' +
    'function pe(type,x,y){i.dispatchEvent(new PointerEvent(type,' +
    '{clientX:x,clientY:y,bubbles:true,pointerType:"mouse"}));}' +
    'function me(type){i.dispatchEvent(new MouseEvent(type,{bubbles:true}));}' +
    'pe("pointerdown",r.left+20,r.top+20);pe("pointerup",r.left+20,r.top+20);' +
    'me("mousedown");me("mouseup");me("click");' +
    'i.focus();' +
    'window.__probe.push("active="+(document.activeElement||{}).id);' +
    'return true;})()'
  );
  const b0 = await evaluate(aiCount);
  await sleep(LONG_WINDOW);
  const b1 = await evaluate(aiCount);
  const bProbe = await evaluate('JSON.stringify(window.__probe)');
  const bActive = await evaluate('(document.activeElement||{}).id || "(none)"');

  /* ---- 场景 C：提交一句 → AI 回应 → 用户正在想下一句 ----
     提交后焦点应留在输入框；这段时间不该被催。 */
  await evaluate(
    '(function(){var i=document.getElementById("say-input");' +
    'i.focus();i.value="I think the second part is not done yet.";' +
    'document.getElementById("composer").dispatchEvent(new Event("submit",{cancelable:true}));' +
    'return true;})()'
  );
  await sleep(LONG_WINDOW);              // 等AI 回应完 + 一个窗口
  const c0 = await evaluate(aiCount);
  const focusAfterSubmit = await evaluate('(document.activeElement||{}).id || ""');
  await sleep(LONG_WINDOW);
  const c1 = await evaluate(aiCount);

  /* ---- 场景 D：真实用户路径—— 先等开场白过去，再点进框里 ----
     ★ 这是同伴反馈最可能的那条路径，第 1 版漏的就是它：
       AI 说完开场白 → armSilence 排上 8 秒 → 用户在这 8 秒里
       点进输入框、正在想措辞 → 第 8 秒照催。
       第 1 版的userIsTyping 只看有没有字，这时框是空的 → 判false。

       B 场景之所以「过」，是因为它接在 A 之后焦点本来就在框里，
       **没真正测到「中途点进框」这个动作**。D 才是干净的复现。 */
  await evaluate(
    '(function(){var i=document.getElementById("say-input");' +
    'i.blur();i.focus();' +
    'window.__probeD=[];' +
    'i.addEventListener("focus",function(){window.__probeD.push("focus");});' +
    'return true;})()'
  );
  const d0 = await evaluate(aiCount);
  await sleep(LONG_WINDOW);
  const d1 = await evaluate(aiCount);
  const dProbe = await evaluate('JSON.stringify(window.__probeD||[])');

  /* ★ A 的判据不能用「固定条数」——
     云函数往返 3–8 秒不确定，28 秒窗口里可能塞 2 轮也可能 3 轮
     （实测拿到过 3 次与 4 次两种）。按条数判就是在测网络快慢。
     真正要守住的是两条**行为约束**：
       ① 一次都不该开口（他没准备说话）→ 必须 0
       ② 完全不说话时AI 仍会按 8 秒口径先开口（B27 验收）→ 至少 1
     「至少 1」比「恰好 N」稳，因为它不依赖耗时。 */
  const cases = [
    ['B 光标在框里不动（在想措辞）', b1 - b0, 0],
    ['C 提交后正在想下一句', c1 - c0, 0],
    ['D 听到AI 后才点进输入框', d1 - d0, 0]
  ];
  let pass = 0;

  /* B27：完全不说话时 AI 仍要按 8 秒口径先开口 */
  const aOk = a1 - a0 >= 1;
  console.log('=== Day 23 插嘴实测（等 ' + (LONG_WINDOW / 1000) + ' 秒 ≈ 3 个倒计时周期）===');
  cases.forEach(function (c) {
    const ok = c[1] === c[2];
    if (ok) pass++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + c[0] + '：' + c[1] + ' 次，期望 ' + c[2] + ' 次');
  });
  console.log('  ' + (aOk ? '✓' : '✗') + ' B27 完全不说话时 AI 按 8 秒先开口：' +
    (a1 - a0) + ' 次（要求 ≥1）');
  if (aOk) pass++;
  console.log('  ' + (focusAfterSubmit === 'say-input' ? '✓' : '✗') +
    ' 提交后焦点留在输入框：#' + focusAfterSubmit);
  if (focusAfterSubmit === 'say-input') pass++;

  console.log('== 探针 ==');
  console.log('   A 焦点事件：' + aProbe +'｜AI 说了：' + aText);
  console.log('   B 焦点事件：' + bProbe + '｜窗口末焦点：#' + bActive);
  console.log('     B 起步时焦点=#' + bStartFocus + '（期望 body，即 blur 生效）' +
    '｜等完 28 秒后焦点=#' + bMidFocus);
  console.log('   D 焦点事件：' + dProbe);
  console.log('===== ' + pass + ' / 5 通过 =====');
  ws.close();
  try { chrome.kill(); } catch (e) {}
}

main().catch(function (e) { console.error('实测脚本出错：', e.message); process.exit(1); });