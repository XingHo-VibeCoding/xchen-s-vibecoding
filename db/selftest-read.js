/* 离线自测：用真实库里的原始行验证出口 JSON 形状（Day 17 板块①自检）
   不 require index.js（会建连接池），只把纯函数抽出来单独求值。
   数据是 tcb db execute 从真实库查回来的原样行，未经加工。 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../cloudfunctions/read/index.js', 'utf8');

const TZ = src.match(/const TZ_SUFFIX = (.*);/)[1];
/* 按「函数声明 + 缩进到列 0 的收尾大括号」定位函数体。
   不用 [\s\S]*?\n\} —— 对象字面量里也有 }，会提前截断（第一次写就踩了）。 */
function grabFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('没找到函数 ' + name);
  const end = src.indexOf('\n}', start);
  if (end < 0) throw new Error('函数 ' + name + ' 的结尾没找到');
  return src.slice(src.indexOf('{', start) + 1, end);
}
const isoSrc = grabFn('iso');
const shapeSessionSrc = grabFn('shapeSession');
const shapeItemSrc = grabFn('shapeItem');

const iso = new Function('TZ_SUFFIX', TZ + ';return function iso(ts){' + isoSrc + '}')(eval(TZ));
/* 注意包装：函数体里用了形参 row（/ sessionId 里的 row.xxx），
   只贴函数体不写签名会 ReferenceError。 */
const shapeSession = new Function('iso', TZ + ';return function shapeSession(row){' + shapeSessionSrc + '}')(iso);
const shapeItem = new Function('iso', TZ + ';return function shapeItem(row){' + shapeItemSrc + '}')(iso);

// ↓ 真实库原始行（S-MOCK-05 是中途退出的那场：endedAt=null、isComplete=false）
const rawSess = [
  { sessionId: 'S-MOCK-01', topicId: 'T1', nickname: '小陈', startedAt: '2026-09-28T20:11:16', endedAt: '2026-09-28T20:14:20', durationSeconds: '184', errorCount: '2', goodSentenceCount: '1', turnCount: '4', isComplete: true },
  { sessionId: 'S-MOCK-05', topicId: 'T1', nickname: '', startedAt: '2026-09-22T20:08:00', endedAt: null, durationSeconds: '42', errorCount: '0', goodSentenceCount: '0', turnCount: '1', isComplete: false }
];
const rawFav = [
  { itemId: 'T1-S1-E1', sessionId: 'S-MOCK-01', topicId: 'T1', type: 'logic', turn: '2', originalText: 'We have some issues but I think it is ok.', reminder: '先说「有问题」又说「没问题」，前后不一致。', correction: "We're two days behind on the API, but we can still make Friday.", isFavorited: true, note: '', favoritedAt: '2026-09-28T20:16:02', createdAt: '2026-09-28T20:14:25' },
  { itemId: 'T1-S1-G1', sessionId: 'S-MOCK-01', topicId: 'T1', type: 'good', turn: '1', originalText: 'Let me walk you through...', reminder: '先给全貌、再点出需要的帮助。', correction: null, isFavorited: true, note: '开场就用这个结构', favoritedAt: '2026-09-28T20:15:30', createdAt: '2026-09-28T20:14:25' }
];

const out1 = { ok: true, data: { sessions: rawSess.map(shapeSession), count: 2 }, error: null };
console.log('--- GET /api/sessions ---');
console.log(JSON.stringify(out1, null, 2));

console.log('\n--- GET /api/favorites 首条 ---');
console.log(JSON.stringify(shapeItem(rawFav[0]), null, 2));

const checks = [
  ['时间戳已补 +08:00', out1.data.sessions[0].startedAt === '2026-09-28T20:11:16+08:00'],
  ['中途退出的 endedAt 仍是 null（不是 "null" 字符串）', out1.data.sessions[1].endedAt === null],
  ['中途退出被标出 aborted=true', out1.data.sessions[1].aborted === true],
  ['布尔列未被转换（原生 true/false）', out1.data.sessions[0].isComplete === true && typeof out1.data.sessions[0].isComplete === 'boolean'],
  ['计数从 PG 的 string 转成 number', typeof out1.data.sessions[0].durationSeconds === 'number'],
  ['空昵称转成 null（界面自己显示「你」）', out1.data.sessions[1].nickname === null],
  ['逻辑错误条目 correction 有值（B7）', typeof shapeItem(rawFav[0]).correction === 'string'],
  ['精彩句子 correction 仍是 null，不是空串（B7）', shapeItem(rawFav[1]).correction === null],
  ['无日期时区参与换算：库里 20:11 → 出口 20:11+08:00', out1.data.sessions[0].startedAt.slice(11, 19) === '20:11:16']
];
console.log('\n--- 自检 ---');
checks.forEach(([name, pass]) => console.log((pass ? '  OK  ' : ' FAIL ') + name));
const bad = checks.filter(([, p]) => !p).length;
console.log(bad === 0 ? '\n全部通过' : '\n有 ' + bad + ' 项不通过');
process.exit(bad === 0 ? 0 : 1);
