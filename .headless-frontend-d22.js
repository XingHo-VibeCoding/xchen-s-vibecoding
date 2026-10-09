/* Day 22 板块④无头验证：前端的删除二次确认 + 真发 DELETE
   -------------------------------------------------------------
   为什么单测不够：单测能验「api.js 拼的报文对不对」，
   但验不了「点击 → 弹窗 → 取消 → 一个请求都不发」这条链，
   那是浏览器里的事，只有真页面跑一遍才算数。

   ★★ 测页面真实网络响应的唯一入口：**给 window.fetch 包一层记进 window.__net**。
     变量在 IIFE 里从 Runtime.evaluate 访问不到，所以必须挂到 window 上。

   confirm 在无头里默认直接返回 false（等于用户点了「取消」），
   第一轮就靠这个验「取消不发请求」；第二轮手动换成返回 true 验真删。 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

/* ★ 直接复用 frontend/regress.js 里那份 MiniWS（这里抄一份而不是 require 它：
     regress.js 是脚本不是模块，require 进来会立刻开跑）。
   为什么不装 ws 包：本项目至今零 npm 依赖，为一个自查脚本引入依赖不划算。 */
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
      this.sock.on('data', chunk => {
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
      try { const m = JSON.parse(p); this.handlers.forEach(h => h(m)); } catch (e) {}
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
const PORT = 9222;
const PAGE_URL = 'http://localhost:8010/pages/records.html';

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
    '--user-data-dir=' + path.join(__dirname, '.chrome-d22b'),
    '--no-first-run', '--window-size=1080,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let tabs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const all = await get('http://127.0.0.1:' + PORT + '/json');
      /* ★ 按 URL 精确匹配，只按 type==='page' 会抓到扩展页 */
      tabs = all.filter(function (t) { return t.type === 'page' && t.url === 'about:blank'; });
      if (tabs.length) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!tabs || !tabs.length) { console.log('✗ 没抓到页面'); chrome.kill(); return; }

  const ws = new MiniWS(tabs[0].webSocketDebuggerUrl);
  await ws.connect();
  let id = 0;
  const waiting = {};
  const logs = [];

  function send(method, params) {
    return new Promise(function (res, rej) {
      const mid = ++id;
      /* ★ 必须带超时：CDP 断开时 socket 只是不 close，
         原来的 send() 会永远挂着 —— 脚本看起来「在跑」，
         实则一行都不往下走（踩过一次：第一组有输出、第二组什么都没有）。
         带超时会直接抛出来，比静默卡死好查。 */
      const timer = setTimeout(function () {
        rej(new Error('CDP 超时（15s）：' + method));
      }, 15000);
      waiting[mid] = function (v) { clearTimeout(timer); res(v); };
      ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
    });
  }

  ws.onMessage(function (m) {
    if (m.id && waiting[m.id]) { waiting[m.id](m.result); waiting[m.id] = null; }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push((m.params.type || '') + ': ' +
        (m.params.args || []).map(function (a) { return a.value; }).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.text || ''));
    }
  });

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true
    });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result.value;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  /*★★ 顺序踩过一次：先注入包层再 Page.navigate 的话，
     导航会把整个 JS 上下文换掉 —— 注入的 window.fetch / window.confirm
     连同 __net 一起消失，后续 evaluate 就在一个空上下文里跑，
     send() 永远不 resolve，脚本静默卡住（表现是「第一组有输出、第二组没有」）。

     正确顺序：**先导航、等页面脚本跑完，再注入包层，最后才操作**。
     包层只需覆盖「用户操作」这一段，取数那两次 fetch 漏掉不影响我们要验的东西。 */
  await send('Page.navigate', { url: PAGE_URL });
  await sleep(7000);

  /* 包层 + confirm 替换（注入在页面自己的脚本之后，只包住交互） */
  await evaluate(`
    window.__net = [];
    window.__confirms = [];
    window.__confirmAnswer = false;
    var _f = window.fetch;
    window.fetch = function (u, o) {
      o = o || {};
      window.__net.push({ url: String(u), method: o.method || 'GET', body: o.body || null });
      return _f.apply(window, arguments);
    };
    window.confirm = function (msg) {
      window.__confirms.push(msg);
      return window.__confirmAnswer;
    };
    'injected'
  `);
  const injected = await evaluate(`typeof window.__confirmAnswer`);
  console.log('包层注入结果 __confirmAnswer 类型 =', injected,
    injected === 'boolean' ? '✓' : '✗（导航把包层冲掉了）');

  /* ---------- 检查 1：删除按钮在不在 ---------- */
  const probe = await evaluate(`(function(){
    var cards = document.querySelectorAll('.item');
    var dels  = document.querySelectorAll('.item-del');
    return {
      cards: cards.length,
      delBtns: dels.length,
      delTexts: Array.prototype.map.call(dels, function(b){return b.textContent;}),
      delAria: dels.length ? dels[0].getAttribute('aria-label') : null,
      delH: dels.length ? Math.round(dels[0].getBoundingClientRect().height) : 0,
      delW: dels.length ? Math.round(dels[0].getBoundingClientRect().width) : 0,
      footDisplay: cards.length ? getComputedStyle(cards[0].querySelector('.item-foot')).display : null
    };
  })()`);
  console.log('\n【1】页面上的删除按钮');
  console.log('  条目卡片数 =', probe.cards, ' 删除按钮数 =', probe.delBtns);
  console.log('  按钮文字 =', JSON.stringify(probe.delTexts));
  console.log('  aria-label =', probe.delAria, ' 尺寸 =', probe.delW + 'x' + probe.delH);
  console.log('  .item-foot display =', probe.footDisplay, '（期望 flex）');

  /* ---------- 检查 2：点一下 → confirm 弹了没 ---------- */
  await evaluate(`window.__net = []; window.__confirms = [];`);
  await evaluate(`(function(){
    var b = document.querySelector('.item-del');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1200);

  const afterCancel = await evaluate(`(function(){
    return {
      confirms: window.__confirms,
      deleteCalls: window.__net.filter(function(r){
        return r.method === 'DELETE';
      }),
      totalNet: window.__net.length
    };
  })()`);
  console.log('\n【2】点了删除，confirm 弹窗内容：');
  (afterCancel.confirms || []).forEach(function (c) {
    console.log('  ---');
    c.split('\n').forEach(function (l) { console.log('  | ' + l); });
  });
  console.log('  取消后发出的 DELETE 请求数 =', afterCancel.deleteCalls.length,
    afterCancel.deleteCalls.length === 0 ? ' ✓ 一个都没发' : ' ✗ 不该发');
  console.log('  取消后总请求数 =', afterCancel.totalNet, '（应该只有 2 个 GET）');

  /* ---------- 检查 3：把 confirm 改成 true，验真删 ---------- */
  const before = await evaluate(`(function(){
    var cards = document.querySelectorAll('.item');
    var ids = Array.prototype.map.call(cards, function(c){
      return c.getAttribute('data-item-id');
    });
    return { count: cards.length, ids: ids,
      bar: document.getElementById('rec-mock') ? document.getElementById('rec-mock').textContent : '' };
  })()`);
  console.log('\n【3】确认删除（confirm 返回 true）');
  console.log('  删前卡片数 =', before.count, ' ids =', JSON.stringify(before.ids));

  await evaluate(`window.__net = []; window.__confirms = []; window.__confirmAnswer = true;`);
  await evaluate(`(function(){
    var b = document.querySelector('.item-del');
    if (b) b.click();
    return true;
  })()`);
  await sleep(4000);

  const afterDel = await evaluate(`(function(){
    var cards = document.querySelectorAll('.item');
    var bar = document.getElementById('rec-mock');
    return {
      count: cards.length,
      ids: Array.prototype.map.call(cards, function(c){
        return c.getAttribute('data-item-id');
      }),
      bar: bar ? bar.textContent : '',
      barWarn: bar ? bar.classList.contains('mock-bar-warn') : null,
      deleteCalls: window.__net.filter(function(r){ return r.method === 'DELETE'; }),
      totalNet: window.__net.map(function(r){ return r.method + ' ' + r.url.split('?')[0]; })
    };
  })()`);
  console.log('  删后卡片数 =', afterDel.count, ' ids =', JSON.stringify(afterDel.ids));
  console.log('  删后说明条 =', JSON.stringify(afterDel.bar));
  console.log('  说明条是不是警示态 =', afterDel.barWarn, '（删成功应是 false）');
  console.log('  实际发出的请求：');
  (afterDel.totalNet || []).forEach(function (x) { console.log('    ', x); });
  console.log('  DELETE 的 itemId 走 query 还是 body =',
    afterDel.deleteCalls.length && afterDel.deleteCalls[0].body === null ? 'query ✓' : 'body ✗');

  /* ---------- 检查 4：失败路径（这条是最容易被省掉的）----------
   做法：先从库里把某一条删掉（模拟「别处已经删了」），再回到页面上点它的删除。
   ★ 要验的不是「报错」，而是**报错之后页面做了什么对的事**：
     后端回 404 NOT_FOUND 的意思是「库里已经没有这一条」，
     此时页面必须把它从列表里拿掉（跟库里对齐），
     而不是留一张点不动、点了还会再 404 的幽灵卡片。 */
  const stillThere = await evaluate(`(function(){
    /* 用我们自己造的、排在最前面那条测试数据，
       绝不拿种子数据当试验品 —— 第一轮就误删过 FREE-S4-G2（已补回）。 */
    var cards = document.querySelectorAll('.item');
    for (var i=0;i<cards.length;i++){
      var id = cards[i].getAttribute('data-item-id');
      if (id.indexOf('S-D22-UI') === 0) return id;
    }
    return cards.length ? cards[0].getAttribute('data-item-id') : null;
  })()`);
  console.log('\n【4】失败路径：库里已经删掉一条，再从页面点它的删除');
  console.log('  拿来做试验的 id =', stillThere);

  const countBeforeFail = await evaluate(`document.querySelectorAll('.item').length`);

  /* 直接把这个 id 从库里删掉（模拟并发：另一个页面先删了） */
  const B = 'https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com';
  await evaluate(`window.__net = []; window.__confirmAnswer = true;`);
  await new Promise(function (r) {
    const req = require('https').request(B + '/api/sessions/write?itemId=' + stillThere,
      { method: 'DELETE' }, function (res) { res.resume(); res.on('end', r); });
    req.on('error', r); req.end();
  });
  console.log('  已在库中删掉这一条（模拟别处先删）');
  console.log('  失败前卡片数 =', countBeforeFail);

  await sleep(500);
  const clicked = await evaluate(`(function(){
    var cards = document.querySelectorAll('.item');
    for (var i=0;i<cards.length;i++){
      if (cards[i].getAttribute('data-item-id') === ${JSON.stringify(stillThere)}) {
        cards[i].querySelector('.item-del').click();
        return 'clicked';
      }
    }
    return 'not-found';
  })()`);
  console.log('  页面点它 =', clicked);
  await sleep(4000);

  const failPath = await evaluate(`(function(){
    var cards = document.querySelectorAll('.item');
    var bar = document.getElementById('rec-mock');
    var ids = Array.prototype.map.call(cards, function(c){
      return c.getAttribute('data-item-id');
    });
    var del = document.querySelector('.item-del');
    return {
      count: cards.length,
      ids: ids,
      stillListed: ids.indexOf(${JSON.stringify(stillThere)}) !== -1,
      bar: bar ? bar.textContent : '',
      barWarn: bar ? bar.classList.contains('mock-bar-warn') : null,
      firstDelDisabled: del ? del.disabled : null
    };
  })()`);
  console.log('  失败后卡片数 =', failPath.count, '（从', countBeforeFail, '降下来 =',
    failPath.count < countBeforeFail ? '✓ 幽灵卡片被拿掉了' : '✗ 幽灵卡片还在');
  console.log('  失败后 ids =', JSON.stringify(failPath.ids));
  console.log('  那一条还在列表里吗 =', failPath.stillListed ? '✗ 还在' : '✓ 已经不在');
  console.log('  失败后说明条 =', JSON.stringify(failPath.bar));
  console.log('  说明条是警示态 =', failPath.barWarn, '（404 属于「已达成」不该报警示）');
  console.log('  删除按钮恢复可点 =', failPath.firstDelDisabled === false ? '✓' : '✗');

  /* ---------- 检查 5：控制台有没有报错 ---------- */
  console.log('\n【5】控制台');
  console.log('  ' + (logs.length ? logs.join('\n  ') : '（无任何输出）'));

  ws.close();
  chrome.kill();
  await sleep(500);
}

main().catch(function (e) { console.error('脚本本身出错：', e); process.exit(1); });