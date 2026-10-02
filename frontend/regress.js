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
      await sleep(1600);
      const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const v = r.result && r.result.result && r.result.result.value;
      if (!v) { console.log('  ' + w + 'px → 取不到读数'); fail++; continue; }
      const issues = [];
      if (v.overflow) issues.push('横向溢出 ' + v.overflow);
      if (v.small.length) issues.push('触控<44px ' + v.small.length + ' 处: ' + v.small.slice(0, 3).join(' / '));
      if (issues.length) { console.log('  ' + w + 'px → ✗ ' + issues.join('；')); fail++; }
      else { console.log('  ' + w + 'px → ✓ 无溢出 / 触控全达标'); pass++; }
    }
    console.log('');
  }
  console.log('【控制台】' + (logs.length ? logs.join(' | ') : '0 条报错'));
  console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  ws.close(); chrome.kill(); process.exit(0);
})();
