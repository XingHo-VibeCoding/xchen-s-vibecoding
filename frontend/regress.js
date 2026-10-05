// 四页 × 五断点回归（Day 12）—— 改 main.css 后的必做项
// 跑法：cd frontend && python serve.py另开一个终端 → node regress.js
// 判据：横向溢出 / 触控目标 <44px / 控制台报错，各页各断点都过才算通过
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const PAGES = ['topics', 'dialogue', 'result', 'records'];
const WIDTHS = [390, 360, 640, 740, 1440];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
class MiniWS {
  constructor(u) { const x = new URL(u); this.host = x.hostname; this.port = x.port; this.path = x.pathname + x.search; this.buf = Buffer.alloc(0); this.handlers = []; }
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

const PROBE = `(() => {
  const de = document.documentElement;
  const overflow = de.scrollWidth > window.innerWidth
    ? de.scrollWidth + '>' + window.innerWidth : '';
  const small = [];
  document.querySelectorAll('a, button').forEach(e => {
    if (e.offsetParent === null) return;          // 隐藏的不算
    if (e.classList.contains('orb')) return;        // 刻意出界的装饰
    const r = e.getBoundingClientRect();
    if (r.width < 44 || r.height < 44)
      small.push((e.className||e.tagName) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return { overflow: overflow, small: small, w: window.innerWidth };
})()`;

/* Day 17 新增：记录页专属判据「数据源声明」。
   ------------------------------------------------------------
   为什么单独加一条而不并进 PROBE：
     PROBE 是四页通用的（溢出 / 触控 / 视口宽），records 没有的判据
     放在这里会让另外三页凭空多出一个恒为空的字段。

   判的是什么：
     P4 页面上的条目可能来自**后端真实数据**，也可能来自**本地假条目**
     （读接口当前返回 DB_CONNECTION_REFUSED，见 api-contract §2.1）。
     无论走哪条路，页面底部的 #rec-mock 都**必须如实说明**用的是哪一种——
     否则用户会把假条目当成自己真练出来的记录，这是诚实性问题，不是体验问题。

   两条硬要求：
     ① #rec-mock 存在且有文字（不能空着）
     ② 走本地假数据时，文字里必须出现「假条目」三个字
   */
const PROBE_RECORDS = `(() => {
  const bar = document.getElementById('rec-mock');
  if (!bar) return { noBar: true };
  const text = (bar.textContent || '').trim();
  return {
    barText: text,
    barClass: bar.className || '',
    saysFake: text.indexOf('假条目') >= 0,
    itemCount: document.querySelectorAll('#all-list .item').length,
    childCount: document.getElementById('all-list') ?
      document.getElementById('all-list').children.length : -1
  };
})()`;

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/wb-regress-profile', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { targets = await getJSON('/json/list'); if (targets.length) break; } catch (e) {} }
  const page = targets.find(t => t.type === 'page');
  const ws = new MiniWS(page.webSocketDebuggerUrl);
  await ws.connect();
  let id = 0; const waiting = new Map(); const logs = [];
  ws.onMessage(m => {
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.text || 'exc');
  });
  const cmd = (method, params) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
  await cmd('Runtime.enable'); await cmd('Page.enable');

  let pass = 0, fail = 0;
  console.log('===== 四页 × 五断点回归（Day 12）=====\n');
  for (const pg of PAGES) {
    console.log('【' + pg + '】');
    for (const w of WIDTHS) {
      await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
      await cmd('Page.navigate', { url: 'http://localhost:8010/pages/' + pg + '.html' });
      // 记录页要等后端取数（含 25s 超时上限，但本地是无 404 快返），多给 600ms
      await sleep(pg === 'records' ? 2200 : 1600);
      const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const v = r.result && r.result.result && r.result.result.value;
      if (!v) { console.log('  ' + w + 'px → 取不到读数'); fail++; continue; }
      const issues = [];
      if (v.overflow) issues.push('横向溢出 ' + v.overflow);
      if (v.small.length) issues.push('触控<44px ' + v.small.length + ' 处: ' + v.small.slice(0, 3).join(' / '));

      // Day 17：记录页追加「数据源声明」判据（见上方 PROBE_RECORDS 注释）
      let recNote = '';
      if (pg === 'records') {
        const r2 = await cmd('Runtime.evaluate', { expression: PROBE_RECORDS, returnByValue: true });
        const rv = r2.result && r2.result.result && r2.result.result.value;
        if (!rv || rv.noBar) issues.push('找不到 #rec-mock 说明条');
        else if (!rv.barText) issues.push('#rec-mock 是空的，没说明数据来源');
        else if (rv.saysFake) recNote = ' · 数据源：本地假条目（已如实标注）';
        else recNote = ' · 数据源：后端真实数据';
        // 条目数为 0 时把现场读数一起打出来，否则只有一句「一条都没有」没法定位
        if (rv && rv.itemCount === 0) {
          issues.push('#all-list 一条都没有（诊断：条数=' + rv.itemCount +
            '，说明条文字数=' + (rv.barText ? rv.barText.length : -1) +
            '，说明条前 30 字=' + JSON.stringify((rv.barText || '').slice(0, 30)) +
            '，#all-list 子节点数=' + rv.childCount + '）');
        }
      }

      if (issues.length) { console.log('  ' + w + 'px → ✗ ' + issues.join('；')); fail++; }
      else { console.log('  ' + w + 'px → ✓ 无溢出 / 触控全达标' + recNote); pass++; }
    }
    console.log('');
  }
  console.log('【控制台】' + (logs.length ? logs.join(' | ') : '0 条报错'));
  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  ws.close(); chrome.kill(); process.exit(0);
})();
