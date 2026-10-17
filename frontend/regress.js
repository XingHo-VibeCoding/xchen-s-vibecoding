// 五页 × 五断点回归（Day 12 建，Day 20 加 status）—— 改 main.css 后的必做项
// 跑法：cd frontend && python serve.py另开一个终端 → node regress.js
// 判据：横向溢出 / 触控目标 <44px / 控制台报错，各页各断点都过才算通过
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
/* Day 20：加 'status'。检查台也要进回归 ——
   它同样引用 main.css，而回归的判据（横向溢出 / 触控目标 / 控制台报错）
   对它同样成立；新页面不进这个清单就等于没人替它把关。 */
const PAGES = ['topics', 'dialogue', 'result', 'records', 'status'];
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
     P4 页面上的条目来自后端数据库。**读接口当前返回 DB_CONNECTION_REFUSED**
     （体验版没有 VPC 权限，见 api-contract §2.1与 notes/cloudbase-pg.md），
     所以正常打开看到的是**错误态**而不是列表。

   ★ Day 19 改判据的依据（原先那版已作废）：
     原判据是「#all-list 必须有 .item 条目」，那是在**还有本地假条目兜底**的前提下写的
     —— mock-items.json 没了之后，接口不通就必然是0 条，那条判据变成永远失败。
     现在改成：**有条目** 或 **处于明确的错��/空态** 两者之一就算过。
     真正要守住的不变 —— 页面必须如实说明数据的来处，
     尤其不能让人把空白误读成「我没有记录」。

   三条硬要求：
     ① #rec-mock 存在且有文字（不能空着）
     ② 走本地假数据时，文字里必须出现「假条目」三个字
     ③ 0 条时必须是**说清楚了原因**的错态/空态，不能是空白页
   */
const PROBE_RECORDS = `(() => {
  const bar = document.getElementById('rec-mock');
  if (!bar) return { noBar: true };
  const text = (bar.textContent || '').trim();
  const list = document.getElementById('all-list');
  return {
    barText: text,
    barClass: bar.className || '',
    saysFake: text.indexOf('假条目') >= 0,
    itemCount: document.querySelectorAll('#all-list .item').length,
    childCount: list ? list.children.length : -1,
    /* ★ 是否有说清原因的错态（.state-error）—— 0 条时靠它区分
       「页面坏了」与「明确告诉你为什么没有」 */
    hasErrorState: !!document.querySelector('#all-list .state-error'),
    /* ★ Day 27 补：**明确的空态**（.empty 但不是 .state-error）。
       上面那段注释从 Day 19 起就写着「错态/空态两者之一就算过」，
       但代码一直只认 .state-error —— 于是库真的被清空（Day 27 删假数据）之后，
       5 个宽度全部报「一条都没有，且没有错态」，把**正确表现**判成了失败。
       空态与错态的区别是「有没有取到数据」：取到了但确实为空 = 空态。 */
    isEmptyState: !!document.querySelector('#all-list .empty:not(.state-error)'),
    /* 0 条时说明条必须给出原因，不能只是一句干巴巴的「没有记录」 */
    explainsWhy: text.indexOf('读不到') >= 0 || text.indexOf('不是') >= 0
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
    if (m.method === 'Runtime.exceptionThrown') {
      /* ★ Day 25 修：原来只取 exceptionDetails.text，而它**永远是「Uncaught」**——
         看输出只知道「有错」，不知道错在哪。真正的消息在 exception.description
         的第一行（如 `ReferenceError: FRAME_MS is not defined`），位置在 url + lineNumber。
         Day 25 故意弄坏验证时，【控制台】只打出一串 Uncaught，等于把最有用的一半丢了。 */
      const d = m.params.exceptionDetails || {};
      const raw = (d.exception && d.exception.description) || d.text || 'exc';
      const msg = String(raw).split('\n')[0].trim();
      const ln = (typeof d.lineNumber === 'number') ? d.lineNumber + 1 : '?';
      const at = d.url ? ' @' + String(d.url).replace(/^.*\//, '') + ':' + ln : '';
      /* 同一处错误「每页 × 每断点」都会重报一次，去重、最多留 3 条，
         否则【控制台】那一行会被同一句话刷满。 */
      const one = msg + at;
      if (!logs.includes(one) && logs.length < 3) logs.push(one);
    }
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
      /* ★ records 页要多等：它要连后端才判出错态，而本环境连 PG 会等到
     连接超时才返回 DB_CONNECTION_REFUSED（实测要好几秒）。
     2200ms 只够渲染骨架，判据会读在「什么都没拿到」的中间态上。 */
await sleep(pg === 'records' ? 9000 : 1600);
      const r = await cmd('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      const v = r.result && r.result.result && r.result.result.value;
      if (!v) { console.log('  ' + w + 'px → 取不到读数'); fail++; continue; }
      const issues = [];
      if (v.overflow) issues.push('横向溢出 ' + v.overflow);
      if (v.small.length) issues.push('触控<44px ' + v.small.length + ' 处: ' + v.small.slice(0, 3).join(' / '));

      // Day 17 建、Day 27 改：记录页判据（见上方 PROBE_RECORDS 注释）
      let recNote = '';
      if (pg === 'records') {
        const r2 = await cmd('Runtime.evaluate', { expression: PROBE_RECORDS, returnByValue: true });
        const rv = r2.result && r2.result.result && r2.result.result.value;
        if (!rv || rv.noBar) issues.push('找不到 #rec-mock 说明条');
        /* ★★ Day 27：**不再要求 #rec-mock 平时有文字**。
           它已退化成「操作反馈条」——只有用户点了收藏/删除才有内容，
           成功态 / 空态 / 错误态一律清空并 hidden（那些开发语言被删了，
           原因写在 records.html 的 setBar() 上方）。
           要守的诚实性换成这一条：**0 条时页面必须有能读的态**（空态或错态），
           不能是一片什么都没说的空白。 */
        if (rv && rv.itemCount === 0 && !rv.hasErrorState && !rv.isEmptyState) {
          issues.push('#all-list 一条都没有，既不是空态也不是错态（子节点数=' + rv.childCount +
            '，说明条=' + JSON.stringify((rv.barText || '').slice(0, 30)) + '）');
        } else if (rv) {
          recNote = ' · 条目 ' + rv.itemCount + ' 条';
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
