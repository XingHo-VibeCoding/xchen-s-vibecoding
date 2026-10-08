/* Day 21 截图辅助：把 docs/*.md 渲染成可直接在浏览器打开的 HTML
   （仅为截图用；不改动任何产品代码，也不进部署目录）
   跑法：node .render-md.js   → 输出 docs/_preview/*.html */
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, 'docs');
const OUT = path.join(DOCS, '_preview');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 行内解析：先摘出行内代码占位，避免代码里的 * _ | 被当语法 */
function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + esc(codes[+i]) + '</code>');
  return s;
}

/* 按 | 切表格单元格，但跳过反引号里的 | */
function splitRow(line) {
  const cells = [];
  let cur = '', inCode = false;
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const ch of s) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function isSep(line) {
  return /^\|[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

function render(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const L = lines[i];

    /* 围栏代码块 */
    if (/^```/.test(L)) {
      const lang = L.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="code' + (lang ? ' lang-' + esc(lang) : '') + '"><code>'
        + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }

    /* 表格：| ... | 后面紧跟 | --- | */
    if (/^\s*\|/.test(L) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(L);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]) && !isSep(lines[i])) {
        rows.push(splitRow(lines[i])); i++;
      }
      out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('')
        + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    /* 标题 */
    const h = L.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++; continue;
    }

    /* 水平线 */
    if (/^---+$/.test(L.trim())) { out.push('<hr>'); i++; continue; }

    /* 引用块 */
    if (/^>\s?/.test(L)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
      continue;
    }

    /* 列表（无序 / 有序，含二级缩进） */
    if (/^\s*([-*]|\d+\.)\s+/.test(L)) {
      const ordered = /^\s*\d+\./.test(L);
      const buf = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { buf.push(lines[i]); i++; }
      const items = buf.map(li => {
        const m = li.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        const pad = m[1].length >= 2 ? ' class="sub"' : '';
        return '<li' + pad + '>' + inline(m[3]) + '</li>';
      });
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }

    /* 空行 */
    if (!L.trim()) { i++; continue; }

    /* 段落 */
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(\||```|#{1,6}\s|>|\s*([-*]|\d+\.)\s|---)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    if (buf.length) out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>');
    else i++;
  }
  return out.join('\n');
}

/* 配色沿用产品令牌（notes/ui-visual.md）：暖奶油底 + 蜜橘 + 深青 */
const CSS = `
:root{--bg:#FDFBF6;--ink:#2A2320;--muted:#6B5D55;--line:#E8DFD3;
--orange:#D97706;--orange-deep:#9A4708;--teal:#0F7A6B;--coral:#E8624A}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.75 "Segoe UI","Microsoft YaHei",sans-serif;padding:40px 32px}
.page{max-width:1000px;margin:0 auto;background:#fff;border:1px solid var(--line);
border-radius:14px;padding:40px 44px;box-shadow:0 2px 18px rgba(42,35,32,.06)}
h1{font-size:30px;margin:0 0 6px;padding-bottom:14px;border-bottom:3px solid var(--orange);color:var(--orange-deep)}
h2{font-size:23px;margin:38px 0 14px;padding-left:11px;border-left:5px solid var(--teal);color:#0B5F54}
h3{font-size:19px;margin:26px 0 10px;color:var(--orange-deep)}
h4{font-size:17px;margin:20px 0 8px;color:var(--teal)}
p{margin:12px 0}
hr{border:0;border-top:1px dashed var(--line);margin:30px 0}
a{color:var(--teal)}
strong{color:var(--orange-deep)}
code{background:#F5EFE6;border:1px solid var(--line);border-radius:4px;
padding:1px 6px;font:13.5px/1.6 Consolas,Monaco,monospace;color:#8A3B06}
pre.code{background:#2A2320;color:#F7F1E7;border-radius:9px;padding:15px 18px;
overflow-x:auto;margin:14px 0;line-height:1.6}
pre.code code{background:none;border:0;color:inherit;padding:0;font-size:13.5px}
pre.code.lang-json{border-left:4px solid var(--teal)}
pre.code.lang-bash{border-left:4px solid var(--orange)}
blockquote{margin:16px 0;padding:12px 18px;background:#F5EFE6;
border-left:4px solid var(--orange);border-radius:0 8px 8px 0;color:#5A4C44}
blockquote p{margin:6px 0}
table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14.5px;
border:1px solid var(--line);border-radius:8px;overflow:hidden}
th{background:#F5EFE6;color:var(--orange-deep);text-align:left;font-weight:600}
th,td{border:1px solid var(--line);padding:9px 12px;vertical-align:top}
tbody tr:nth-child(even){background:#FDFBF6}
ul,ol{margin:12px 0;padding-left:26px}
li{margin:6px 0}
li.sub{margin-left:22px;color:var(--muted);list-style:circle}
.banner{background:#0F7A6B;color:#fff;border-radius:9px;padding:11px 18px;
margin:0 0 26px;font-size:14.5px}
`;

const FILES = [
  { md: 'week3-acceptance.md', title: '第 3 周周验收表· Day 21' },
  { md: 'day21-demo-outline.md', title: '演示提纲（3–5 分钟）· Day 21' },
  { md: 'day21-peer-crosscheck.md', title: '同伴交叉验证三行结论 · Day 21' },
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(DOCS, f.md);
  if (!fs.existsSync(src)) { console.log('跳过（不存在）：' + f.md); continue; }
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(f.title) + '</title><style>' + CSS + '</style></head><body><div class="page">'
    + '<div class="banner">口语对话实战器 · 第 3 周收尾验收 · 2026-10-08</div>'
    + render(fs.readFileSync(src, 'utf8'))
    + '</div></body></html>';
  fs.writeFileSync(path.join(OUT, f.md.replace(/\.md$/, '.html')), html, 'utf8');
  console.log('已生成 ' + path.join(OUT, f.md.replace(/\.md$/, '.html')));
}