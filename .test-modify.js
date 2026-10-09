/* .test-modify.js —— PATCH / DELETE 的单测（Day 22 · 板块 ①②）
   -------------------------------------------------------------
   为什么这两个接口要有自己的单测（而不是并进 .test-write.js）：
     ① 它验证的是**另一类风险**。写入的风险是「写进去一半」，
        改与删的风险是「动了不该动的」和「没动却报成功」——
        后者今天真的发生过一次（见下面「第0 项」）。
     ② .test-write.js 已经是 118 项，加进去会让「写接口」这个文件名
        不再对应它验证的东西。

   ★★ 本文件最该记住的一条（Day 22 实际踩到）：
     我改了 write/repositories 的 itemsRepository 加了 updateItemById，
     却忘了 read/repositories 里那份同名文件也要跟着改——
     .test-write.js 里那条「两份 httpdb.js 副本必须一致」的检查把它抓出来了。
     同一个错误今天发生在 repository 层：**两份副本不同步，
     症状是「有的接口能找到数据、有的接口找不到」，极难查。**
     所以本文件第 0 组检查就是钉住这一条。

   跑法：node .test-modify.js （在仓库根目录，与其余单测同例） */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; fails.push(name);
    console.log('  ✗ ' + name + (extra !== undefined ? '\n      ← ' + extra : ''));
  }
}
function section(t) { console.log('\n【' + t + '】'); }

/* 从源文件文本里抓一个函数的源码（与 .test-analyze.js 同一手法）。
   云函数没有 module.exports，测试不改它的结构，只把纯函数 eval 出来。 */
function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') {
      depth--;
      if (started && depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

/* ---------- 读源文件 ---------- */
const ROOT = __dirname;
const writeDir = path.join(ROOT, 'cloudfunctions', 'write');
const readDir = path.join(ROOT, 'cloudfunctions', 'read');

const writeSrc = fs.readFileSync(path.join(writeDir, 'index.js'), 'utf8');
const writeHttpdb = fs.readFileSync(path.join(writeDir, 'httpdb.js'), 'utf8');
const readHttpdb = fs.readFileSync(path.join(readDir, 'httpdb.js'), 'utf8');
const itemsRepoSrc = fs.readFileSync(path.join(writeDir, 'repositories', 'itemsRepository.js'), 'utf8');
const readItemsRepoSrc = fs.readFileSync(path.join(readDir, 'repositories', 'itemsRepository.js'), 'utf8');
const rc = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudbaserc.json'), 'utf8'));

/* 代码正文（去掉注释）—— 结构性检查只看代码，不看注释里的话。 */
const code = writeSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

/* ================================================================
   一、副本同步（Day 22 真的在这里栽了一次）
   ------------------------------------------------------------
   ★ 为什么这件事要单独一组检查：
     read 与 write 各带一份 httpdb.js 与 itemsRepository.js，
     两个云函数是**各自复制部署**的，没有共享模块机制 ——
     所以改一份就必须手动同步另一份，改漏了症状极难查。
     这不是「最好保持一致」，是**不改就一定会出两种行为**。
   ================================================================ */
section('副本同步（read 与 write 各带一份，必须一致）');

ok('★ 两份 httpdb.js 完全一致',
  writeHttpdb === readHttpdb,
  'write ' + writeHttpdb.length + ' 字符 / read ' + readHttpdb.length + ' 字符');

ok('★ 两份 httpdb.js 都导出了 patchWhere（改接口要用的方法）',
  /patchWhere: patchWhere/.test(writeHttpdb) && /patchWhere: patchWhere/.test(readHttpdb));

/* itemsRepository 两份**故意不一样**（read 那份只读，这份只写），
   所以这里查的不是「文件相同」，而是「新增方法在 write 这份里」，
   以及「read 那份没有混入写方法」—— 后者同样是不同步的一种。
   ★ Day 22 余力加练改了名字：deleteItemById → softDeleteItemById（软删除），
     另加了 findItemByIdIncludingDeleted（软删复查要绕过 is_deleted 过滤）。 */
ok('★ write 的 itemsRepository 有 find/update/softDelete 三个方法',
  /findItemById/.test(itemsRepoSrc) && /updateItemById/.test(itemsRepoSrc) &&
  /softDeleteItemById/.test(itemsRepoSrc));

ok('★ write 的 itemsRepository 有「连已软删的也能查」那个方法（软删复查靠它）',
  /findItemByIdIncludingDeleted/.test(itemsRepoSrc));

/* ★★ 软删除：查询必须**恒定**带 is_deleted 过滤，带 WHERE 里而不是接口层事后过滤。
     判据断的是「findItemById 的查询条件里有 is_deleted: 'eq.false'」——
     而不是「文件里出现过 is_deleted」（注释里也会出现这个词）。
     为什么判这么严：只过滤不带上或只过滤接口层，症状都是
     「已删的条目还在列表里」，而后者更难查（分页会静默变短）。 */
ok('★ write 的 findItemById 恒定带 is_deleted=eq.false',
  /findItemById[\s\S]{0,400}is_deleted:\s*'eq\.false'/.test(itemsRepoSrc));
ok('★ read 的收藏查询也恒定带 is_deleted=eq.false',
  /buildFavoritesQuery[\s\S]{0,400}is_deleted:\s*'eq\.false'/.test(readItemsRepoSrc));

/* ★★ 软删必须**清掉收藏标记**（否则已删的条目继续占着收藏区的名额）。
     两个字段一起断：is_favorited=false 与 favorited_at=null ——
     少清 favorited_at 会撞 ck_items_favtime（23514，英文报错）。 */
ok('★ softDeleteItemById 连带清 is_favorited 与 favorited_at（否则撞 ck_items_favtime）',
  /softDeleteItemById[\s\S]{0,400}is_favorited:\s*false[\s\S]{0,120}favorited_at:\s*null/
    .test(itemsRepoSrc));

/* ★★ 软删之后「删完再查」这一步必须换方法：用 findItemById 会用结论证明结论
     （它带 is_deleted 过滤，天然查不到刚软删的那条，验不出任何东西）。 */
ok('★ 接口层复查用 findItemByIdIncludingDeleted（不是 findItemById）',
  /findItemByIdIncludingDeleted\(itemId\)/.test(code));

ok('★ read 的 itemsRepository 没混进写方法（只读就是只读）',
  !/updateItemById|softDeleteItemById|deleteItemById/.test(readItemsRepoSrc));

/* ================================================================
   二、出口映射：write 与 read 两份 shapeItem 必须给同样的结果
   ------------------------------------------------------------
   ★ 这是 Day 22 特意加的一条：write 里新写了一份 shapeItem
     （契约 §9.8 第 4 条的「映射只写在出口那一处」指的是
     **一个接口的出口只有一处**，不是全仓库只能有一行映射代码）。
     代价就是两份实现可能改岔—— 这条检查让改岔在测试里就暴露。
   ================================================================ */
section('出口映射（两份 shapeItem 的结果必须一致）');

/* ★ 两个文件里的时间函数名不一样（write 叫 isoOut、read 叫 iso），
     而各自 shapeItem 内部调的也是自己那个名字。
     做法是**注入别名**而不是改生产代码里的函数名 ——
     为了让测试跑得下去去改产品代码的名字，是本末倒置。
     write 的 shapeItem 调 isoOut、read 的调 iso，所以按 fname 反推要用哪个。 */
function evalShapeItem(src, fname, timeFnName) {
  const fn = grabFn(src, fname);
  const timeSrc = grabFn(src, timeFnName);
  if (!fn || !timeSrc) return null;
  const shim = 'const __time = ' + timeFnName + ';\n'
    /* 把 shapeItem 内部对时间函数的调用统一改成 __time，两边就一致了。
       只替换调用点（' + timeFnName + '('），不动声明处。 */
    + fn.replace(new RegExp('(?<!function )' + timeFnName + '\\(', 'g'), '__time(')
    + '\nreturn shapeItem;';
  const codeStr = "const TZ_SUFFIX = '+08:00';\n" + timeSrc + '\n' + shim;
  /* ★ eval 的直接 eval 上下文里 return 是非法的（Illegal return statement），
     所以要包成一个函数再调用。shapeItem 那一组之所以一开始没事，
     是因为它的代码里碰巧先 return 了别的东西把语句连起来了 ——
     这种「碰巧不报错」比报错更坏，所以统一用同一个包法。
     ★ TZ_SUFFIX 必须自己声明：它在这两个文件里是各自定义的模块级常量
       （两个云函数各自复制部署，没有共享模块），eval 里拿不到外面的作用域。 */
  try { return eval('(function(){\n' + codeStr + '\n})()'); } catch (e) { return null; }
}

const shapeWrite = evalShapeItem(writeSrc, 'shapeItem', 'isoOut');
const shapeRead = evalShapeItem(
  fs.readFileSync(path.join(readDir, 'index.js'), 'utf8'), 'shapeItem', 'iso');

const SAMPLE = {
  item_id: 'S-x-L1', session_id: 'S-x', topic_id: 'T1', type: 'logic',
  turn: 2, original_text: 'I go to office yesterday.',
  reminder: '时间用了过去式', correction: 'I went to the office yesterday.',
  is_favorited: true, note: '第二天复习', favorited_at: '2026-10-08 21:00:00',
  created_at: '2026-10-08 20:00:00'
};

ok('★ write 里能抓到 shapeItem', !!shapeWrite);
ok('★ read 里能抓到 shapeItem', !!shapeRead);

if (shapeWrite && shapeRead) {
  const a = shapeWrite(JSON.parse(JSON.stringify(SAMPLE)));
  const b = shapeRead(JSON.parse(JSON.stringify(SAMPLE)));
  ok('★ 两份 shapeItem 对同一行给出同样的结果',
    JSON.stringify(a) === JSON.stringify(b),
    'write=' + JSON.stringify(a) + '\n      read =' + JSON.stringify(b));
  ok('  时间戳补上写死的 +08:00',
    a.createdAt === '2026-10-08T20:00:00+08:00', a.createdAt);
  ok('  未收藏的 favorited_at 是 null 而不是空串',
    shapeWrite(Object.assign({}, SAMPLE, { favorited_at: null })).favoritedAt === null);
  ok('★ 偏题的 correction 保持 null（不变成空串，B7）',
    shapeWrite(Object.assign({}, SAMPLE, { type: 'offtopic', correction: null })).correction === null);
  ok('  turn 从库里取出来是数字',
    shapeWrite(SAMPLE).turn === 2 && typeof shapeWrite(SAMPLE).turn === 'number');
}

/* ================================================================
   三、PATCH 的校验层
   ------------------------------------------------------------
   这些判断没有别的入口能测到：它们只在 handler 里，
   而 handler 要真库才跑得动。所以从源码抽出关键片段做静态检查，
   再用纯函数（isoOut、nowLocalText）做行为检查。
   ================================================================ */
section('PATCH /api/sessions/write 的校验层（改条目）');

const patchBody = grabFn(writeSrc, 'handlePatchItem');
ok('★ 能抓到 handlePatchItem', !!patchBody);

/* 白名单：只有 note 与 isFavorited 可改，其余字段绝不改。
   这条是**安全的一侧**——漏一个字段只是「新字段默认不可改」，
   反过来（黑名单漏一个）就是「新字段被默认放行」，那是危险的一侧。 */
ok('★ 只读 note 与 isFavorited 两个字段进 patch（白名单）',
  /patch\.note = body\.note/.test(code) && /patch\.is_favorited = nextFav/.test(code) &&
  !/patch\.original_text\s*=/.test(code) && !/patch\.correction\s*=/.test(code) &&
  !/patch\.type\s*=/.test(code) && !/patch\.turn\s*=/.test(code));

ok('★ 改动 favorited_at 是连带行为，且只在收藏标记变了时才做',
  /patch\.favorited_at = nextFav \? nowLocalText\(\) : null/.test(code));

ok('★ 收藏时间戳取当前时间而不是库里的某个字段（用户「什么时候点的收藏」）',
  /function nowLocalText/.test(code));

/* 严格的布尔校验：'true' / 1 这类必须被拒。
   理由是 isFavorited 与 favorited_at 是一条约束的两半，
   把 'false' 当真值（JS 里非空字符串都是真值）会写出脏数据。 */
ok('★ isFavorited 只接受真布尔，不做真值转换',
  /typeof body\.isFavorited !== 'boolean'/.test(code) &&
  !/body\.isFavorited === true/.test(code.replace(/\/\*[\s\S]*?\*\//g, '')));

ok('★ 至少要给一个要改的字段（空 PATCH 明确拒绝）',
  /没有要改的内容/.test(writeSrc));

ok('★ itemId 必填且按 VARCHAR(40) 校验长度',
  /缺少 itemId/.test(writeSrc) && /MAX_ITEM_ID = 40/.test(code));

ok('★ note 按 VARCHAR(120) 校验长度',
  /MAX_NOTE = 120/.test(code) && /note 超长/.test(writeSrc));

/* 存在性校验必须是「先查后改」—— PostgREST 改到 0 行也回 200，
   拿返回值判断存在性是错的。 */
ok('★ 先查存在性再改（PostgREST 命中 0 行也回 200）',
  /await itemsRepo\.findItemById\(itemId\)/.test(code) &&
  code.indexOf('findItemById') < code.indexOf('updateItemById'));

ok('★ 不存在的 id 回404 + 中文说明，并回显 gotItemId',
  /sendError\(res, 404, 'NOT_FOUND'/.test(code) && /gotItemId: itemId/.test(code));

ok('★ 响应回显 before（截图要对比改前改后）',
  /before: \{ note: before\.note, isFavorited: before\.is_favorited \}/.test(code));

/* ================================================================
   四、DELETE 的两道确认
   ------------------------------------------------------------
   ★ 今天要掌握的那件事：**删除为什么比新增更容易出事**。
     新增写错一条 → 库里多一行，用户看得见、也能顺手删掉；
     删除写错一次 → 那一行当场消失，没有撤销、没有历史、没有痕迹。
     所以删除路径上多两道确认，下面逐条钉住。
   ================================================================ */
section('DELETE /api/sessions/write 的两道确认（删条目）');

const delBody = grabFn(writeSrc, 'handleDeleteItem');
ok('★ 能抓到 handleDeleteItem', !!delBody);

ok('★ 确认一：先查存在性，不存在不给删',
  /await itemsRepo\.findItemById\(itemId\)/.test(code.slice(code.indexOf('function handleDeleteItem'))) &&
  code.indexOf('findItemById(itemId)', code.indexOf('function handleDeleteItem')) <
  code.indexOf('softDeleteItemById(itemId)'));

ok('★ 不存在回 404 + 中文说明（不是回「删除成功」）',
  /sendError\(res, 404, 'NOT_FOUND'/.test(code) &&
  /没有东西可删/.test(writeSrc));

/* 确认二：标记之后再查一次。
   ★★ Day 22 软删除后这一步的**方法换了**，理由值得钉住：
     findItemById 带 is_deleted=eq.false 过滤，刚软删的那条它天然查不到 ——
     用它复查等于「用结论证明结论」（查不到是因为过滤生效了，
     而过滤生效恰恰就是这次要验证的那件事）。
     真正该验的是「**行还在，且 is_deleted 变成 true 了**」，
     所以必须用 findItemByIdIncludingDeleted。 */
ok('★ 确认二：标记后用 findItemByIdIncludingDeleted 复查（不是 findItemById）',
  /const after = await itemsRepo\.findItemByIdIncludingDeleted\(itemId\)/.test(code) &&
  /after\.is_deleted !== true/.test(code));
ok('★ 复查发现没标记成功要报错，而不是回成功',
  /删除没有生效/.test(writeSrc));

/* ★ 软删除的三条对外口径（用户 Day 22 拍板「契约与文案同步说明」）：
     ① 接口回 softDeleted: true，前端据此说「不可见」而不是「从库里消失」
     ② 404 文案仍说「它可能已经被删过了」——软删过的再删一次也走这条
     ③ 库里那行**还在**，所以不能再用 deleteItemById（真删） */
ok('★ 响应带 softDeleted: true（对外说「不可见」而不是「消失」）',
  /softDeleted:\s*true/.test(code));
ok('★ 软删后不再调用真删方法（行必须留在库里，否则「可找回」是空话）',
  !/itemsRepo\.deleteItemById/.test(code));

ok('★ DELETE 走 query 而不是 body（DELETE 带 body 各代理行为不一致）',
  /url\.slice\(url\.indexOf\('\?'\) \+ 1\)/.test(code.slice(code.indexOf('function handleDeleteItem'))));

ok('★ 响应回显删掉的那条摘要（前端能说清删了什么，不只是「已删除」）',
  /originalText: before\.original_text/.test(code));

/* ★★ 前端文案同步（软删之后不能还说「找不回来 / 那一行已经没有了」——
     行还在库里，说那种话就是**在说一件假事**）。

   ★★★ 这条判据本身改过一次（同一个坑今天第三次）：
     原来写 `!/找不回/.test(recHtml)` ——「整份文件都不许出现『找不回』」。
     结果它命中的是我自己写的**说明性注释**（「原来写『删了就找不回来了』」）。
     教训和前两次一样：**判据要比要求准**，全文件禁令会把「记录改动原因」也禁掉。
     现在只抓三处**用户可见的文案字面量**——注释里怎么引用旧文案都不管。 */
const recHtml = fs.readFileSync(path.join(__dirname, 'frontend', 'pages', 'records.html'), 'utf8');
const VISIBLE_COPY = [
  ['confirm 弹窗', /window\.confirm\(\s*'([^']*)'/],
  ['删除成功说明', /mockBar\.textContent = '([^']*已删掉[^']*)'/],
  ['页面底部说明条', /'([^']*收藏与删除都会写回数据库[^']*)'/]
];
ok('★ 三处用户可见文案都能抓到（判据本身没失效）',
  VISIBLE_COPY.every(function (p) { return p[1].test(recHtml); }),
  VISIBLE_COPY.filter(function (p) { return !p[1].test(recHtml); })
    .map(function (p) { return '抓不到：' + p[0]; }).join('；'));
ok('★ 前端文案不再说「找不回来」（软删后行还在，只查可见文案）',
  VISIBLE_COPY.every(function (p) { return !/找不回/.test(p[1].test(recHtml) ? p[1].exec(recHtml)[1] : ''); }),
  VISIBLE_COPY.filter(function (p) {
    var m = p[1].exec(recHtml); return m && /找不回/.test(m[1]);
  }).map(function (p) { return p[0] + ' 里还有「找不回」'; }).join('；'));
ok('★ 前端文案改成「不会再出现在记录里」（三处都在）',
  (recHtml.match(/不会再出现在记录里/g) || []).length >= 3);

/* ================================================================
   五、路由与网关（部署前必查，代码全绿也照样会撞）
   ================================================================ */
section('路由与网关');

/* ★ 这条判据踩过一次：原来写成找 `网关**会**把 PATCH`（加粗只包「会」），
   后来注释润色成 `网关**会把 PATCH**`，字面就变了 → 检查报失败但代码没问题。
   教训和 Day 22 改 .test-write.js 那条一样：**断言意图，不断言字面**。
   所以这里只判三件事：源码说了「原样转发」、说了「不改写」、
   以及文件头三行路由声明里 PATCH 与 DELETE 都挂在同一条路径上。 */
ok('★ 网关会转发 PATCH / DELETE 且不改写方法（Day 22 探针实测，不是猜的）',
  /原样转发/.test(writeSrc) && /方法不改写/.test(writeSrc));

const head = writeSrc.slice(0, 400);
ok('★ 文件头把三个方法声明在同一条路径上',
  /POST\s+\/api\/sessions\/write/.test(head) &&
  /PATCH\s+\/api\/sessions\/write/.test(head) &&
  /DELETE\s+\/api\/sessions\/write/.test(head),
  head.split('\n').slice(0, 3).join(' | '));

ok('★ 没有退化成 POST + _method 的绕法',
  !/_method/.test(code));

/* ★ 这里踩过一次：`path.replace('api','')` 会把斜杠留下（//api去成//），
   正确写法是替换掉 '/api' 整段。改岔的表现是「检查报失败但代码没问题」，
   所以判据本身也要经得起复核。 */
function stripApi(p) { return p.replace('/api', ''); }
function hasKey(src, p) {
  return new RegExp("'" + p.replace(/\//g, '\\/') + "'").test(src);
}

/* ★★ Day 22：三个接口共用一条路径 `/api/sessions/write`。
   不是设计偏好，是被网关逼出来的唯一解：
     · 路由配置没有 method 字段 → 网关不能按方法分流
     · 同域名不能有重复路径 → PATCH /api/items/{id} 与 DELETE /api/items/{id}
       字面完全相同，无法同时存在
     · 想给它们各建一条带后缀的路径绕开上面这条，控制台建不出来
       （只能建 SCF，而 write 是 WEB_SCF）→ 只能复用已有路由
   详见 cloudfunctions/write/index.js 路由层上方那段注释。 */
const P = '/api/sessions/write';
ok('★ 复用的路径 ' + P + ' 进 ROUTES 表', hasKey(writeSrc, P));

ok('★ 带/不带 /api 前缀两种写法都在（Day 17 踩过网关剥前缀）',
  hasKey(writeSrc, P) && hasKey(writeSrc, stripApi(P)),
  P + (hasKey(writeSrc, P) ? '✓' : '✗') +
  ' / ' + stripApi(P) + (hasKey(writeSrc, stripApi(P)) ? '✓' : '✗'));

/* ★ 同一路径必须挂满三个方法。这条比「代码里有 handler」更强 ——
   挂漏一个的表现是线上 405，而 405 到浏览器里只显示「请求失败」。 */
['POST', 'PATCH', 'DELETE'].forEach(function (m) {
  ok('★ ' + P + ' 上挂了 ' + m,
    new RegExp('POST:\\s*handlePostSession').test(writeSrc) &&
    new RegExp('PATCH:\\s*handlePatchItem').test(writeSrc) &&
    new RegExp('DELETE:\\s*handleDeleteItem').test(writeSrc));
});

ok('★ 路由表按方法取 handler（route[req.method]），不是按 method 字段比对',
  /route\[req\.method\]/.test(writeSrc) && /if \(!route\[req\.method\]\)/.test(writeSrc));

/* 方法不对时回 405，且**把允许的方法列出来**——
   契约 §1.5 那条「回显我实际收到了什么」。 */
ok('★ 方法不对回 405，且文案里列出这条路径允许哪几个方法',
  /METHOD_NOT_ALLOWED/.test(code) &&
  /这条路径接受/.test(writeSrc) &&
  /Object\.keys\(route\)\.join/.test(writeSrc));

const routes = rc.gateway.routes.map(function (r) { return { path: r.path, target: r.target }; });
ok('★ 网关无同路径重复（重复会被 INVALID_PARAM 拒绝）',
  new Set(routes.map(function (r) { return r.path; })).size === routes.length,
  routes.map(function (r) { return r.path; }).join(' '));

const wr = routes.filter(function (r) { return r.path === P; });
ok('★ 网关上 ' + P + ' 恰好一条，且指向 function:write',
  wr.length === 1 && wr[0].target === 'function:write',
  wr.length ? wr.length + ' 条 → ' + wr[0].target : '没这条路由');
ok('★ ' + P + ' 开了 enablePathTransmission（不开路径会被剥光成 /）',
  rc.gateway.routes.filter(function (r) { return r.path === P; })[0].enablePathTransmission === true);

/* ★ 反向检查：建不出来的两条路由必须**不在**配置里。
   留着会让「读代码的人以为线上真有这两条路径」—— 部署时也不会报错
   （配置文件不是真相，路由表才是），属于最隐蔽的一类错。 */
['/api/items/update', '/api/items/delete'].forEach(function (p) {
  ok('★ 配置里没有残留建不出来的路由 ' + p,
    routes.filter(function (r) { return r.path === p; }).length === 0);
});
/* ★ 反向检查：建不出来的两条路径必须**不在 ROUTES 表里**。
   留着会让「读代码的人以为线上真有这两条路径」—— 部署时也不会报错
   （配置文件不是真相，路由表才是），属于最隐蔽的一类错。
   ⚠️ 判据只查 ROUTES 表那段，不能全文件搜这两个词：
     注释里**应该**留着它们（记录「为什么废弃」，Day 22 踩坑的证据）。
     一开始写成全文件禁，注释里一提就报失败 —— 判据比要求还严，
     等于逼着人把踩坑记录删掉。 */
const routesBlock = writeSrc.slice(writeSrc.indexOf('const ROUTES'),
  writeSrc.indexOf('const ROUTES') + 600);
['/api/items/update', '/api/items/delete'].forEach(function (p) {
  ok('★ ROUTES 表里没有残留建不出来的路由 ' + p, routesBlock.indexOf(p) === -1);
});
ok('★ ROUTES 表里只剩两条 key（带/不带 /api 各一条）',
  (routesBlock.match(/:\s*\{/g) || []).length === 2,
  '表里有 ' + (routesBlock.match(/:\s*\{/g) || []).length + ' 条 key');
ok('★ 踩坑原因仍留在注释里（不能因为判据严就把记录删了）',
  /建不出来/.test(writeSrc) && /WEB_SCF/.test(writeSrc));

ok('★ /api/items/favorites 仍指向 read（Day 17 建的读接口不能坏）',
  (routes.filter(function (r) { return r.path === '/api/items/favorites'; })[0] || {}).target === 'function:read');
ok('★ /api/sessions 仍指向 read（同上）',
  (routes.filter(function (r) { return r.path === '/api/sessions'; })[0] || {}).target === 'function:read');


/* 全表前缀规则：短路径不能排在它的子路径之前（会先匹配掉长的）。 */
let orderOk = true, orderWhy = '';
for (let a = 0; a < routes.length; a++) {
  for (let b = 0; b < routes.length; b++) {
    if (a === b) continue;
    const pa = routes[a].path, pb = routes[b].path;
    if (pa === '/' || pa === '/api') continue;
    if (pb.indexOf(pa) === 0 && pb !== pa && b > a) {
      orderOk = false;
      orderWhy = pb + ' 是 ' + pa + ' 的子路径，却排在它后面';
    }
  }
}
ok('★ 全表无「短路径排在它的子路径之前」的情况', orderOk, orderWhy);

ok('★ 根路径 / 垫在最后（静态托管兜底）',
  routes[routes.length - 1].path === '/' && routes[routes.length - 1].target === 'hosting:web');

/* ================================================================
   六、nowLocalText 的时区口径
   ------------------------------------------------------------
   ★ 这条特别容易写错：云函数容器通常是 UTC，
     库里的时间按 UTC+8 存（契约 §9.8 第 5 条）。
     少算/多算 8 小时在库里看不出来，要等用户翻记录才发现 ——
     所以形状写死在单测里。
   ================================================================ */
section('nowLocalText（当前 UTC+8 墙钟）');

const nowSrc = grabFn(writeSrc, 'nowLocalText');
ok('★ 能抓到 nowLocalText', !!nowSrc);
if (nowSrc) {
  /* pad2 也必须从源码抓，不能在测试里自己写一个 ——
     自己写一份就变成「测的是我以为的 pad2」，与生产代码脱钩，
     少一位/多一位这类 bug 就测不出来了。 */
  const pad2Src = grabFn(writeSrc, 'pad2');
  ok('★ 能抓到 pad2（nowLocalText 的依赖，也从源码取）', !!pad2Src);
  /* 同样要包一层：直接 eval 里的 return 是非法的。 */
  const fn = eval('(function(){\n' + pad2Src + '\n' + nowSrc + '\nreturn nowLocalText;\n})()');
  const out = fn();
  ok('★ 产出格式是 YYYY-MM-DD HH:mm:ss',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(out), out);

  /* 判据要精确：拿 UTC 时间戳 +8 小时，与函数产出必须逐字符相等。
     只比「看起来像 2026-10-08」是不够的 —— 那验不出 8 小时的偏差。 */
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  const expect = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  ok('★ 与「UTC 时间戳 +8 小时」逐字符相等（容器时区无关）',
    out === expect, '实得 ' + out + ' / 期望 ' + expect);
  ok('★ 走的是 getUTC* 而不是 get*（get* 读的是容器本地时区）',
    /getUTCFullYear/.test(code) && !/nowLocalText[\s\S]{0,400}d\.getFullYear/.test(code));
  ok('★ 没引入时区库', !/moment|dayjs|date-fns|luxon/.test(writeSrc));
}

/* ================================================================
   七、错误码
   ------------------------------------------------------------
   ★ 扫错误码要抓两种写法：sendError(res,…,'CODE',…) 与 e.code='CODE'。
     只抓前一种会漏掉挂在 error 对象上的那些（Day 19 栽过）。
   ================================================================ */
section('错误码');

const CODES = ['INVALID_PARAMS', 'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'INTERNAL_ERROR'];
CODES.forEach(function (c) {
  ok('★ 错误码 ' + c + ' 在 write/index.js 里出现',
    writeSrc.indexOf("'" + c + "'") >= 0);
});

ok('★ 新接口的错误码都已登记进契约（§1.4 那张表）',
  CODES.every(function (c) {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'api-contract.md'), 'utf8');
    return doc.indexOf('`' + c + '`') >= 0;
  }));

/* ================================================================
   八、无回归：Day 18 那条最贵的 bug 不许复活
   ================================================================ */
section('无回归');

ok('★ 密钥/连接串不写死在代码里',
  !/postgres:\/\/|PGPASSWORD\s*=\s*['"]/.test(writeSrc));

ok('★ 排错日志不打印请求体（含用户原句与昵称）',
  /console\.log\('\[write\] ' \+ req\.method/.test(writeSrc) &&
  !/console\.log\(.*body\)/.test(writeSrc));

ok('★ 响应外壳只有一套 {ok, data, error}',
  /function sendOK/.test(writeSrc) && /function sendError/.test(writeSrc) &&
  /\{ ok: true, data: data, error: null \}/.test(code) &&
  /\{ ok: false, data: null, error: \{ code: errorCode, message: message \} \}/.test(code));

ok('★ B8 仍成立：originalText 不由请求方决定',
  !/body\.originalText/.test(code));

ok('★ B7 仍成立：偏题的 correction 不由请求方决定',
  !/body\.correction/.test(patchBody || ''));

/* ================================================================ */
console.log('\n============================================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('\n失败项：'); fails.forEach(function (f) { console.log('  · ' + f); }); }
console.log('============================================================');
process.exit(fail ? 1 : 0);