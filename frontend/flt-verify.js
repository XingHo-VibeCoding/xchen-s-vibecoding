// P4 筛选验证（Day 12）—— Chrome DevTools Protocol 版
//跑法：
//   1) cd frontend && python serve.py
//   2) node flt-verify.js
// 原理：起一个 headless Chrome，开 --remote-debugging-port，用 CDP 直连，
//      真正在页面里执行表达式并取回返回值（--dump-dom 拿不到返回值）。
// 不装 Playwright / Puppeteer，只用系统自带的 Chrome。

const http = require('http');
const { spawn } = require('child_process');
const WebSocket = null; // 不用 ws 库，走原生 net 手搓 WebSocket 帧

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'http://localhost:8010/pages/records.html';
const PORT = 9333;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---------- 极简 WebSocket 客户端（只够发文本帧、收文本帧） ----------
class MiniWS {
  constructor(wsUrl) {
    const u = new URL(wsUrl);
    this.host = u.hostname;
    this.port = u.port || 80;
    this.path = u.pathname + u.search;
    this.buf = Buffer.alloc(0);
    this.handlers = [];
    this.frag = [];
  }
  connect() {
    const net = require('net');
    const crypto = require('crypto');
    const key = crypto.randomBytes(16).toString('base64');
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, this.host, () => {
        this.sock.write(
          `GET ${this.path} HTTP/1.1\r\n` +
          `Host: ${this.host}:${this.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      let handshake = false;
      this.sock.on('data', chunk => {
        if (!handshake) {
          const s = chunk.toString('latin1');
          const i = s.indexOf('\r\n\r\n');
          if (i < 0) return;
          handshake = true;
          this.buf = Buffer.concat([this.buf, chunk.slice(Buffer.byteLength(s.slice(0, i + 4), 'latin1'))]);
          this.onOpen();
          resolve();
          this.drain();
          return;
        }
        this.buf = Buffer.concat([this.buf, chunk]);
        this.drain();
      });
      this.sock.on('error', reject);
    });
  }
  onOpen() {}
  drain() {
    while (this.buf.length >= 2) {
      const b1 = this.buf[1];
      let len = b1 & 127, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len).toString('utf8');
      this.buf = this.buf.slice(off + len);
      try { const msg = JSON.parse(payload); this.handlers.forEach(h => h(msg)); } catch (e) {}
    }
  }
  send(str) {
    const data = Buffer.from(str, 'utf8');
    const mask = require('crypto').randomBytes(4);
    let head;
    if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) {
      head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2);
    } else {
      head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked]));
  }
  onMessage(fn) { this.handlers.push(fn); }
  close() { try { this.sock.destroy(); } catch (e) {} }
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/wb-flt-profile',
    'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { targets = await getJSON('/json/list'); if (targets.length) break; } catch (e) {}
  }
  if (!targets || !targets.length) { console.error('连不上 Chrome'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new MiniWS(page.webSocketDebuggerUrl);
  await ws.connect();

  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onMessage(msg => {
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.type + ': ' + (msg.params.args || []).map(a => a.value).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails.text || ''));
    }
  });
  const cmd = (method, params) => new Promise(res => {
    const n = ++id; waiting.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });

  await cmd('Runtime.enable');
  await cmd('Page.enable');
  await cmd('Page.navigate', { url: PAGE });

  // 等页面真正 ready（Page.navigate 返回只代表开始导航，不等于 DOM 就绪）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const chk = await cmd('Runtime.evaluate', {
      expression: "document.readyState === 'complete' && !!document.getElementById('flt-q')",
      returnByValue: true
    });
    const v = chk.result && chk.result.result && chk.result.result.value;
    if (v === true) { ready = true; break; }
  }
  if (!ready) {
    const dbg = await cmd('Runtime.evaluate', {
      expression: "JSON.stringify({url: location.href, ready: document.readyState, hasQ: !!document.getElementById('flt-q'), bodyLen: document.body ? document.body.innerHTML.length : -1})",
      returnByValue: true
    });
    console.log('页面没就绪，当前状态：', dbg.result.result.value);
    ws.close(); chrome.kill(); process.exit(1);
  }
  // 再等fetch 出来的条目渲染完
  await sleep(1200);

  // 断言脚本：跑 7 个场景，返回结构化读数
  const PROBE = `(() => {
    const q = document.getElementById('flt-q');
    const set = v => { q.value = v; q.dispatchEvent(new Event('input', {bubbles:true})); };
    const read = () => ({
      allIds: [...document.querySelectorAll('#all-list .item')].map(e => e.dataset.itemId),
      favIds: [...document.querySelectorAll('#fav-list .item')].map(e => e.dataset.itemId),
      allEmpty: (document.querySelector('#all-list .empty .big')||{}).textContent || '',
      favEmpty: (document.querySelector('#fav-list .empty .big')||{}).textContent || '',
      allSmall: (document.querySelector('#all-list .empty .small')||{}).textContent || '',
      count: (document.getElementById('flt-count')||{}).textContent || ''
    });
    const out = {};
    set(''); out.blank = read();
    set('coffee'); out.coffee = read();
    set('COFFEE'); out.upper = read();
    set('咖啡机'); out.zh = read();
    set('偏题'); out.type = read();
    set('zzzz'); out.none = read();
    set(''); out.clear = read();

    /* ---- 收藏区有内容时的筛选（前面的场景收藏区一直空，覆盖不到）----
       键名与结构必须照storage.js 的真接口写，否则页面读不到：
         键vibecoding.favoriteItems（带命名空间前缀，不是我一开始写的favoriteItems）
         值{ "<itemId>": { type, topicId, at } }
         at 是 **Date.now() 毫秒时间戳**（不是 ISO 字符串）——
         favoriteIds() 靠 ta - tb 排序，填字符串会相减得 NaN 排不出顺序。
       直接调 Storage.toggleFavorite() 最稳，它自己会填对结构。 */
    try {
      window.Storage.toggleFavorite('T1-S1-E1', { type: 'logic', topicId: 'T1' });
      window.Storage.toggleFavorite('T1-S1-G1', { type: 'good', topicId: 'T1' });
      out.seeded = window.Storage.favoriteIds().join(',');
    } catch (e) { out.seedErr = String(e); }

    // 附加断言
    out.hOverflow = document.documentElement.scrollWidth > window.innerWidth
      ? document.documentElement.scrollWidth + ' > ' + window.innerWidth : 'no';
    const inp = document.getElementById('flt-q').getBoundingClientRect();
    out.inputH = Math.round(inp.height);
    out.countRole = document.getElementById('flt-count').getAttribute('role');
    out.labelFor = !!document.querySelector('label[for="flt-q"]');
    out.hasSearchLabel = (document.querySelector('label[for="flt-q"]')||{}).textContent || '';
    return out;
  })()`;

  const res = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const val = res.result && res.result.result && res.result.result.value;

  // ---------- 第二轮：收藏区有内容时的筛选 ----------
  // 上一轮往 localStorage 种了两条收藏，重载页面让 render() 读到它们，再筛一次。
  let favVal = null;
  await cmd('Page.reload', {});
  await sleep(2000);
  const PROBE2 = `(() => {
    const q = document.getElementById('flt-q');
    const set = v => { q.value = v; q.dispatchEvent(new Event('input', {bubbles:true})); };
    const read = () => ({
      allIds: [...document.querySelectorAll('#all-list .item')].map(e => e.dataset.itemId),
      favIds: [...document.querySelectorAll('#fav-list .item')].map(e => e.dataset.itemId),
      favEmpty: (document.querySelector('#fav-list .empty .big')||{}).textContent || '',
      count: (document.getElementById('flt-count')||{}).textContent || ''
    });
    const out = {};
    set(''); out.blank = read();
    set('逻辑'); out.logic = read();      // 命中 T1-S1-E1 的 typeLabel
    set('汇报'); out.report = read();     // 命中 T1-S1-G1 的 reminder（先给全貌再点出帮助）
    set('coffee'); out.coffee = read();   // 收藏的那两条都不含 coffee → 收藏区应「未找到」
    set(''); out.clear = read();
    return out;
  })()`;
  const res2 = await cmd('Runtime.evaluate', { expression: PROBE2, returnByValue: true });
  favVal = res2.result && res2.result.result && res2.result.result.value;

  console.log('===== P4筛选验证（Day 12）=====\n');
  if (!val) {
    console.log('取不到读数，原始返回：', JSON.stringify(res).slice(0, 800));
  } else {
    const line = s => JSON.stringify(s);
    console.log('【① 初始（无筛选）】');
    console.log('  全部条目 :', val.blank.allIds.join(', ') || '(空)', '共', val.blank.allIds.length, '条');
    console.log('  收藏区   :', val.blank.favIds.join(', ') || '(空)', '→ 空态文案:', val.blank.favEmpty);
    console.log('  计数行   :', val.blank.count);

    console.log('\n【② 英文关键词 coffee】');
    console.log('  全部条目 :', val.coffee.allIds.join(', ') || '(空)');
    console.log('  收藏区   :', val.coffee.favIds.join(', ') || '(空)', '→ 空态文案:', val.coffee.favEmpty);
    console.log('  计数行   :', val.coffee.count);

    console.log('\n【③ 大小写无关 COFFEE】');
    console.log('  全部条目 :', val.upper.allIds.join(', ') || '(空)');

    console.log('\n【④ 中文意思 咖啡机（命中 reminder）】');
    console.log('  全部条目 :', val.zh.allIds.join(', ') || '(空)');

    console.log('\n【⑤ 中文类型 偏题】');
    console.log('  全部条目 :', val.type.allIds.join(', ') || '(空)');

    console.log('\n【⑥ 无结果 zzzz】');
    console.log('  全部条目 :', val.none.allIds.join(', ') || '(空)', '→ 空态文案:', val.none.allEmpty);
    console.log('  说明文字 :', val.none.allSmall);
    console.log('  收藏区   :', val.none.favIds.join(', ') || '(空)', '→ 空态文案:', val.none.favEmpty);
    console.log('  计数行   :', val.none.count);

    console.log('\n【⑦ 清空恢复】');
    console.log('  全部条目 :', val.clear.allIds.join(', ') || '(空)', '共', val.clear.allIds.length, '条');
    console.log('  收藏区   :', val.clear.favIds.join(', ') || '(空)', '→ 空态文案:', val.clear.favEmpty);
    console.log('  计数行   :', val.clear.count);

    console.log('\n【附加断言】');
    console.log('  横向溢出 :', val.hOverflow);
    console.log('  输入框高 :', val.inputH + 'px', val.inputH >= 44 ? '✓ ≥44' : '✗ <44');
    console.log('  计数行 role=status :', val.countRole);
    console.log('  label[for=flt-q]：', val.hasSearchLabel, val.labelFor ? '✓' : '✗');
  }

  if (favVal) {
    console.log('\n===== 第二轮：收藏区有内容时（已种 2 条收藏）=====\n');
    console.log('  （种下去的收藏：' + (val.seeded || '?') + '）');
    console.log('\n【⑧ 收藏区初始】');
    console.log('  收藏区   :', favVal.blank.favIds.join(', ') || '(空)');
    console.log('  全部条目 :', favVal.blank.allIds.length, '条（应仍是 4）');
    console.log('  计数行   :', favVal.blank.count);

    console.log('\n【⑨ 筛「逻辑」】');
    console.log('  收藏区   :', favVal.logic.favIds.join(', ') || '(空)');
    console.log('  全部条目 :', favVal.logic.allIds.join(', ') || '(空)');
    console.log('  计数行   :', favVal.logic.count);

    console.log('\n【⑩ 筛「汇报」（只命中收藏的那条精彩句子）】');
    console.log('  收藏区   :', favVal.report.favIds.join(', ') || '(空)');
    console.log('  全部条目 :', favVal.report.allIds.join(', ') || '(空)');
    console.log('  计数行   :', favVal.report.count);

    console.log('\n【⑪ 筛coffee（收藏的两条都不含 → 收藏区「未找到」，全部条目仍有）】');
    console.log('  收藏区   :', favVal.coffee.favIds.join(', ') || '(空)', '→ 空态:', favVal.coffee.favEmpty);
    console.log('  全部条目 :', favVal.coffee.allIds.join(', ') || '(空)');

    console.log('\n【⑫ 清空恢复】');
    console.log('  收藏区   :', favVal.clear.favIds.join(', ') || '(空)');
    console.log('  全部条目 :', favVal.clear.allIds.length, '条');
  } else {
    console.log('\n【第二轮没跑成：收藏区为空，无法验证「有收藏时筛选」】');
  }

  console.log('\n【控制台】', logs.length ? logs.join(' | ') : '0 条报错');
  ws.close(); chrome.kill();
  process.exit(0);
})();
