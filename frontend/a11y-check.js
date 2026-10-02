// P4 可访问性检查（Day 12 余力加练）
// 跑法：cd frontend && python serve.py 另开终端 → node a11y-check.js
// 判据：见 checks.md §改后验证；这里补一组 a11y 断言
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

class W {
  constructor(u) { const x = new URL(u); this.h = x.hostname; this.p = x.port; this.pa = x.pathname + x.search; this.b = Buffer.alloc(0); this.hs = []; }
  connect() {
    return new Promise((rs, rj) => {
      this.s = net.connect(this.p, this.h, () => {
        this.s.write('GET ' + this.pa + ' HTTP/1.1\r\nHost: ' + this.h + ':' + this.p +
          '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' +
          crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      let f = false;
      this.s.on('data', c => {
        if (!f) { const t = c.toString('latin1'); const i = t.indexOf('\r\n\r\n'); if (i < 0) return; f = true; this.b = Buffer.concat([this.b, c.slice(Buffer.byteLength(t.slice(0, i + 4), 'latin1'))]); rs(); this.d(); return; }
        this.b = Buffer.concat([this.b, c]); this.d();
      });
      this.s.on('error', rj);
    });
  }
  d() {
    while (this.b.length >= 2) {
      let l = this.b[1] & 127, o = 2;
      if (l === 126) { if (this.b.length < 4) return; l = this.b.readUInt16BE(2); o = 4; }
      else if (l === 127) { if (this.b.length < 10) return; l = Number(this.b.readBigUInt64BE(2)); o = 10; }
      if (this.b.length < o + l) return;
      const p = this.b.slice(o, o + l).toString('utf8'); this.b = this.b.slice(o + l);
      try { const m = JSON.parse(p); this.hs.forEach(h => h(m)); } catch (e) {}
    }
  }
  send(s) {
    const d = Buffer.from(s, 'utf8'), m = crypto.randomBytes(4); let h;
    if (d.length < 126) h = Buffer.from([0x81, 0x80 | d.length]);
    else if (d.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(d.length, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(d.length), 2); }
    const x = Buffer.alloc(d.length);
    for (let i = 0; i < d.length; i++) x[i] = d[i] ^ m[i % 4];
    this.s.write(Buffer.concat([h, m, x]));
  }
  on(f) { this.hs.push(f); }
  close() { try { this.s.destroy(); } catch (e) {} }
}

const PROBE = `(() => {
  const q = document.getElementById('flt-q');
  const out = {};
  out.labelFor = q && !!document.querySelector('label[for="flt-q"]');
  out.labelText = (document.querySelector('label[for="flt-q"]')||{}).textContent || '';
  out.describedBy = q ? (q.getAttribute('aria-describedby')||'') : '';
  out.describedExists = !!document.getElementById('flt-count');
  out.countRole = (document.getElementById('flt-count')||{}).getAttribute('role') || '';
  out.inputType = q ? q.type : '';
  out.hasPlaceholder = !!(q && q.placeholder);
  out.liveRegions = [...document.querySelectorAll('[aria-live]')].map(e => e.id || e.className);
  out.imgNoAlt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
  out.btnNoName = [...document.querySelectorAll('button')].filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length;
  out.decorativeAriaHidden = document.querySelectorAll('[aria-hidden="true"]').length;
  out.h1 = document.querySelectorAll('h1').length;
  out.hOrder = [...document.querySelectorAll('h1,h2,h3')].map(e => e.tagName).join('>');
  out.focusable = document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])').length;
  // 键盘可达：Tab 顺序里筛选框能不能被聚焦到
  q.focus();
  out.focusWorks = (document.activeElement === q);
  out.inputH = Math.round(q.getBoundingClientRect().height);
  return out;
})()`;

(async () => {
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + require('os').tmpdir() + '/wb-a11y-profile', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { t = await getJSON('/json/list'); if (t.length) break; } catch (e) {} }
  const pg = t.find(x => x.type === 'page');
  const w = new W(pg.webSocketDebuggerUrl);
  await w.connect();
  let id = 0; const wt = new Map();
  w.on(m => { if (m.id && wt.has(m.id)) { wt.get(m.id)(m); wt.delete(m.id); } });
  const cmd = (me, pa) => new Promise(r => { const n = ++id; wt.set(n, r); w.send(JSON.stringify({ id: n, method: me, params: pa || {} })); });
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'http://localhost:8010/pages/records.html' });
  await sleep(2000);
  const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  const v = r.result && r.result.result && r.result.result.value;
  console.log('===== P4 可访问性检查（Day 12 余力加练）=====\n');
  if (!v) { console.log('取不到读数'); }
  else {
    const rows = [
      ['label[for] 关联输入框', v.labelFor, v.labelFor ? '✓' : '✗'],
      ['label 文字', JSON.stringify(v.labelText), v.labelText ? '✓' : '✗'],
      ['aria-describedby 指向的元素', v.describedBy + ' → ' + (v.describedExists ? '存在' : '不存在'), v.describedExists ? '✓' : '✗'],
      ['计数行 role=status', v.countRole, v.countRole === 'status' ? '✓' : '✗'],
      ['输入框 type', v.inputType, v.inputType === 'search' ? '✓' : '✗'],
      ['placeholder 提示', v.hasPlaceholder ? '有' : '无', v.hasPlaceholder ? '✓' : '✗'],
      ['aria-live 区域', v.liveRegions.join(', ') || '无', v.liveRegions.length ? '✓' : '—'],
      ['装饰元素 aria-hidden', v.decorativeAriaHidden + ' 个', v.decorativeAriaHidden > 0 ? '✓' : '—'],
      ['img 缺 alt', v.imgNoAlt, v.imgNoAlt === 0 ? '✓' : '✗'],
      ['button 无可访问名', v.btnNoName, v.btnNoName === 0 ? '✓' : '✗'],
      ['h1 数量', v.h1, v.h1 === 1 ? '✓' : '✗'],
      ['标题层级顺序', v.hOrder, '—'],
      ['可聚焦元素数', v.focusable, v.focusable > 0 ? '✓' : '—'],
      ['筛选框可被键盘聚焦', v.focusWorks, v.focusWorks ? '✓' : '✗'],
      ['筛选框高度', v.inputH + 'px', v.inputH >= 44 ? '✓' : '✗']
    ];
    for (const [k, val, mark] of rows) console.log('  ' + mark + '  ' + k.padEnd(30) + ': ' + val);
  }
  w.close(); ch.kill(); process.exit(0);
})();
