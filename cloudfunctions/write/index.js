/* POST   /api/sessions/write —— 写入一场练习（Day 18 · 板块 ①）
   PATCH  /api/sessions/write —— 改一条条目（Day 22）
   DELETE /api/sessions/write?itemId=x —— 删一条条目（Day 22）
   -------------------------------------------------------------
   ★★★ Day 22：三个接口共用一条路径 `/api/sessions/write`。
     这不是设计偏好，是被网关逼出来的唯一解，理由与实测过程：

     1) 网关路由**没有 method 字段** → 不能按 HTTP 方法分流。
     2) 同一域名下**不能有重复路径**（重复报 INVALID_PARAM）
        → `PATCH /api/items/{id}` 与 `DELETE /api/items/{id}`
          两条路径字面完全相同，在本网关上**根本无法同时存在**。
     3) 本来给它们各建一条带动作后缀的路径（/api/items/update、
        /api/items/delete）绕开 2)，实测**建不出来**：
        控制台「新增触发路径」只能建 `SCF` 类型路由
        （下拉只有「云函数」与「静态网站托管」），而 write 是 `WEB_SCF`，
        提交即「创建失败」；CLI 的 routes add/edit/delete 三条路全被拒
        （add 报 system internal domain 不支持手工创建，
         edit/delete 报路由不存在 —— 因为压根没进路由表）。
        ★ 结论：HTTP 型函数的路径只能靠控制台建，而控制台建不了。

     4) 好消息：网关**会把 PATCH 与 DELETE 原样转发**（方法不改写）。
        探针实测：拿 PATCH 打已有路由，拿到的是本函数自己写的 405
        与 gotPath —— 请求进了函数、req.method 就是 PATCH。
        ★ 所以这两个接口用标准 HTTP 方法，不需要退化成
          「POST + body 里带 _method」的绕法。

     ⚠️ 代价：路径叫 write 却也管改删，语义别扭。将来若控制台支持建
       WEB_SCF 路由，改回 RESTful 的 /api/items/{id} 只需改路由表
       （见文件末尾 ROUTES）+ 前端一个字符串，本文件的业务代码不用动。

   -------------------------------------------------------------
   位置：后端第 5 个云函数，也是**第一个往数据库里写**的接口。
   它实现契约 §6.1 登记的 R3：点「结束对话」时把一场练习整场存下来。
   落三张表：sessions（汇总，1 行）+ turns（轮次，1:N）+ items（条目，1:N）。

   ★★ 路径为什么带 /write 后缀（不是契约 §6.1 原写的 /api/sessions）：
     `/api/sessions` 已被 read 占了（Day 17 建的 GET 列表），
     两条路径不能重复，所以写入另起一条。详见文件末尾 ROUTES 上方那段注释。

   ★ 为什么写库这个要单独一个函数，而不是并进 read：
     · 超时预算不同。读库毫秒级（read 给 20 秒），写库要插三张表 + 事务，
       20 秒也够，但两类请求的失败代价不同，混在一起不好排错。
     · 更要紧的是**它需要凭证而 read 不需要**：写库前要判重、要生成主键，
       一旦有人日后给写接口加上任何"外发"逻辑（发通知、写日志到外部），
       它就会变成第二个需要隔离密钥的函数。先分开，比将来再拆便宜。
     · chat / analyze 不查库、read/write 查库，这四条边界写在契约 §9.8 第 1 条。

   ★ 为什么一次写三张表（而不是只写 sessions 一行）：
     单独插 sessions 会留下一场「有汇总、没有内容」的记录 ——
     记录页能看到它，点进去却什么都没有。
     ★ Day 18 改造：这里**不再是「一个事务」**。本环境走 CloudBase HTTP API，
       BEGIN/ROLLBACK 跨请求不生效（实测 ROLLBACK 后那一行还在），
       且多语句拼一次调用被 PG 拒（DATABASE_42601）。
       改成「每表一次请求 + 失败时补偿删父行」，靠批次内原子 + ON DELETE CASCADE
       保证不留半场数据 —— 详见第八节。

   -------------------------------------------------------------
   ★★ 一、B8：原句不由请求方决定（契约 §9.8 第 2 条，本文件第一约束）

     请求里**没有** items[].originalText 这个字段，它由后端按 turn 编号
     从 transcript 里取回。理由与 analyze 的硬约束 1 完全相同：

       库里的 ck_items_correction 只挡得住 correction 那一列，
       **挡不住原句被编造**。B8「用户看到的必须是他自己说过的话」
       的保障在应用层，不在数据库。

     所以 items[].turn 在 transcript 里查不到、或者那一轮用户根本没说话，
     一律整条丢弃 —— 绝不退化成「让请求方自己再写一遍原句」。

   ★★ 二、防重复（Day 18 用户拍板的口径）

     同一个 sessionId 第二次提交 → 拒绝，返回「这场对话已经存过了」。

     为什么 sessionId 改成**可选**（契约 §1.6 原写「由后端生成，前端不造」）：
       · 不传 = 后端生成，守住 §1.6（前端不知道该传什么，也不用管）。
       · 传了 = 当幂等键用。这一条是为「同一场保存被点两下」「网络重试」
         这类真实场景准备的 —— 前端只有手里已经有这个 id，才谈得上"重复提交"。
     判重交给数据库主键（pk_sessions），不做「先查再插」——
       那是两条语句，中间有竞态窗口；主键冲突是一次性的、服务端强制的。

   ★★ 三、四个计数与时长**不让请求方传**（Day 18 实现决定）

     turnCount / errorCount / goodSentenceCount / durationSeconds 全都能从
     transcript 与 items 推出来。让前端再传一份，就多一处可能自相矛盾的地方 ——
     比如前端说turnCount=5 而 transcript 里只有 4 轮，
     库里就会出现一条永远对不上的记录，而且没人会发现。

     errorCount 的口径：偏题 + 逻辑错误（PRD §8.3），精彩句子不计入；
     FREE 模式下偏题条目整条丢弃，所以那里只剩逻辑错误计入（契约 §9.8 第 3 条）。

   -------------------------------------------------------------
   ★★ 四、时间：不引入时区库，也不做时区换算（契约 §6.1 / §9.8 第 5 条）

     库里是 TIMESTAMP（不带时区），一律按 UTC+8 存、单时区不做换算。
     所以本文件：

       入口：只接受 UTC+8 的偏移写法（+08:00 / +0800）或干脆不写偏移。
             其他偏移一律拒绝 —— 不是图省事，是**算不出正确答案**：
             Z 表示 UTC，与 UTC+8 差 8 小时，硬当成本地时间会错 8 小时，
             而这种错要等到用户翻记录才发现。
       出口：拼上写死的 '+08:00' 常量。
       时长：两个墙钟时间相减。为了做减法用 Date.UTC 构造，
             **那只是把墙钟数字塞进一个能算差值的容器**，
             两边都当成同一个时区，读出来的是真实间隔，不涉及时区换算。
   -------------------------------------------------------------------- */

const http = require('http');
/* ★★ Day 18：从 pg 驱动改成 CloudBase HTTP API（cloudfunctions/httpdb.js）
   原因：本环境是体验版，云函数没有 VPC 权限，pg 直连永远连不上
   （Day 17 实测，官方能力表与社区 issue #1237 同因）。
   完整的实测依据与限制记在 httpdb.js 文件头。
   ★ 校验、B8/B7 硬约束、响应外壳这些**一个字都没动**，
     换的只是「怎么把请求送到数据库」。 */
const db = require('./httpdb');

/* ★★ Day 19（板块 ②）：数据访问下沉到 repositories/。
   本文件从 698 行降到 600 行左右，搬走的是四样纯数据访问的东西：
     sessionRow() / turnRows() / itemRows() / newItemId()→ repositories/
     db.insertMany(表名, 行)  → 各表自己的 insertXxx()
     db.deleteWhere('sessions', …) → sessionsRepo.deleteBySessionId()

   ★★ 留在本文件的是**编排**（用户 Day 19 拍板）：
     「sessions → turns → items 三步，失败时 DELETE 父行补偿」
     这套顺序控制是业务流程不是查库动作。分界线是：
       数据访问层 = 「对这张表做这一个动作」，不问为什么
       接口层     = 「按什么顺序做、失败了怎么办、响应长什么样」

   ★ 注意本文件**仍然 require httpdb**，只用它的 db.classify()——
     错误分类是「响应怎么写」的问题（契约 §1.4），属于接口层。
     数据一个都不经它手。 */
const sessionsRepo = require('./repositories/sessionsRepository');
const turnsRepo = require('./repositories/turnsRepository');
const itemsRepo = require('./repositories/itemsRepository');

/* ---------- 一、上限保护 ----------
   transcript 来自请求方，理论上能被人为塞很大。
   一次要插 1 + N + M 行，没有上限就等于给了一条放大攻击面。
   真人一次对话也就几十轮，40 轮（与 analyze 同值）已经远超需要。 */
const MAX_TURNS = 40;
const MAX_ITEMS = 20;
const MAX_BODY = 512 * 1024;
const MAX_USER_TEXT = 4000;
const MAX_AI_TEXT = 4000;
const MAX_NICKNAME = 64;      // 库里 VARCHAR(64)
const MAX_REMINDER = 500;     // 库里 VARCHAR(500)
/* Day 22：itemId 的长度上限与 note 的上限都取自建表脚本
   （items.item_id VARCHAR(40)、items.note VARCHAR(120)）。 */
const MAX_ITEM_ID = 40;
const MAX_NOTE = 120;

/* ---------- 三、统一响应外壳（契约 §1.2 / §1.3）----------
   与 analyze/index.js 逐字同形。前端 api.js 只认 body.error.code。 */
function sendJSON(res, httpStatus, body) {
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function sendOK(res, data) {
  sendJSON(res, 200, { ok: true, data: data, error: null });
}

function sendError(res, httpStatus, errorCode, message, extra) {
  const body = { ok: false, data: null, error: { code: errorCode, message: message } };
  if (extra) {
    /* 契约 §1.5：4xx / 5xx 要回显「我实际收到了什么」。
       排错字段放**顶层**不进 error —— 它是现场记录，不是错误原因之一。 */
    for (const k of Object.keys(extra)) body[k] = extra[k];
  }
  sendJSON(res, httpStatus, body);
}

/* ---------- 四、时间解析与格式化 ---------- */
const TZ_SUFFIX = '+08:00';

/* 接受三种写法：不带偏移（视为 UTC+8）、带 +08:00 / +0800、带 Z。
   Z 也匹配进来是为了能给出**准确**的拒绝理由——
   如果让正则直接把它挡掉，用户只会看到「格式不对」，
   不知道是自己的写法有别的问题，还是这个字段根本不能用 Z。
   其他偏移与 Z 一样在下面被明确拒绝（见文件头第四节）。 */
function parseLocalTs(raw, fieldName) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { err: '缺少 ' + fieldName + '（必填，格式 2026-10-07T20:11:16+08:00）' };
  }
  const m = raw.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!m) {
    return { err: fieldName + ' 格式不对（应为 2026-10-07T20:11:16+08:00）' };
  }

  /* 偏移检查放在日期检查之前：时区不对是一个更根本的问题，
     先说它，用户改完偏移再谈别的。
     ★ off 是整个捕获到的偏移串（`+08:00` / `+0800` / `Z`），
       所以两种写法都要认 —— 只认一种的话接口在真实调用下会全线拒绝
       （前端 api.js 发的是标准写法 `+08:00`）。 */
  const off = m[7] || '';
  let offsetOk = false;
  if (off === '') offsetOk = true;                                    // 不写 = 按 UTC+8
  else if (off === 'Z') offsetOk = false;
  else if (/^\+08:?00$/.test(off)) offsetOk = true;
  if (!offsetOk) {
    const shown = off === 'Z' ? 'Z（UTC）' : off.slice(0, 3) + ':' + off.slice(3);
    return {
      err: fieldName + ' 的时区只接受 +08:00（本项目统一按 UTC+8 记录时间，不做时区换算；收到的是 ' +
        shown + '，与 UTC+8 相差 ' + (off === 'Z' ? '8 小时' : '不等量') + '，换算不出正确答案）'
    };
  }

  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const hh = Number(m[4]), mi = Number(m[5]), ss = Number(m[6] || '0');
  /* 先查时分秒的范围。Date.UTC 会把 25:00 顺延成次日 01:00，
     若先做日期核对，这类错误会被报成「日期不存在」——消息与真正的原因不符，
     用户会照着去查日期。 */
  if (hh > 23 || mi > 59 || ss > 59) {
    return { err: fieldName + ' 的时间不合法（收到 ' + m[4] + ':' + m[5] + (m[6] ? ':' + m[6] : '') + '）' };
  }
  /* 再查日期本身：2026-13-45 那种靠正则看不出来。
     Date.UTC 会把越界的月份/日期顺延到下一年，所以要反向核对。 */
  const probe = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return { err: fieldName + ' 的日期不存在（收到 ' + y + '-' + mo + '-' + d + '）' };
  }
  return { text: y + '-' + pad2(mo) + '-' + pad2(d) + ' ' + pad2(hh) + ':' + pad2(mi) + ':' + pad2(ss) };
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

/* 当前的 UTC+8 墙钟时间，格式与 parseLocalTs 的产出完全一致（'YYYY-MM-DD HH:mm:ss'）。
   ★ 为什么这么算，而不是 new Date().toLocaleString()：
     那走的是**运行环境的本地时区**（云函数容器通常是 UTC），
     会比库里其它时间戳差 8 小时 —— 而库里所有时间都按 UTC+8 存（契约 §9.8 第 5 条）。
     这里的做法是把 UTC 时间戳整体加 8 小时再读它的 UTC 字段，
     读到的就是 UTC+8 的钟点，与容器时区无关。
   ★ 为什么不用运行时依赖拼时间：写接口那条注释已说明（同一份输入两次调用
     应当落进库里同样的值）。但**收藏时间戳是个例外**——
     它记的是「用户什么时候点的收藏」，本来就该是操作发生的时刻，
     所以取当前时间是正确的，与写接口的确定性要求不冲突。 */
function nowLocalText() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

/* 两个墙钟时间相减得秒数。
   ★ Date.UTC 在这里只是把「年月日时分秒」这组数字塞进一个能算差值的容器，
     两边用的是同一套换算，读出来就是真实间隔 —— 不涉及任何时区换算。 */
function secondsBetween(fromText, toText) {
  const a = Date.UTC(+fromText.slice(0, 4), +fromText.slice(5, 7) - 1, +fromText.slice(8, 10),
    +fromText.slice(11, 13), +fromText.slice(14, 16), +fromText.slice(17, 19));
  const b = Date.UTC(+toText.slice(0, 4), +toText.slice(5, 7) - 1, +toText.slice(8, 10),
    +toText.slice(11, 13), +toText.slice(14, 16), +toText.slice(17, 19));
  return Math.round((b - a) / 1000);
}

/* ---------- 五、主键生成 ---------- */
/* 后端生成，形状与库里现有种子数据一致（S- 前缀 + 时间戳 + 随机尾巴）。
   ★ 不含任何业务信息：只看 id 认不出这是谁的哪一场。 */
function newSessionId() {
  return 'S-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 7).toUpperCase();
}

/* ★★ itemId 的生成（newItemId）Day 19 已搬到 itemsRepository.js。
   理由：它是「拼一条 items 行」的一部分，与 buildItemRows 是同一件事的两半，
   放一起才读得懂「item_id 是怎么来的」。
   刻意留在本文件的是 newSessionId：它定的是**这一场练习的标识**，
   防重复靠数据库主键而不是靠 id 里的随机尾巴，所以它是领域规则不是数据访问。 */

/* ---------- 六、参数校验 ----------
   校验产出的每条 message 都用中文，且说清「缺了什么」而不是「格式错误」。
   排错时前端会把这句话直接显示给用户。 */

/* topicId 白名单。不只是洁癖：它后面要进索引与 WHERE，
   放过任意字符串等于放弃索引，顺带堵掉注入面（与 read 同一条理由）。 */
function validTopicId(t) {
  if (t === undefined || t === null || t === '') return { err: '缺少 topicId（必填，T1–T8 或 FREE）' };
  if (typeof t !== 'string') return { err: 'topicId 必须是字符串（T1–T8 或 FREE）' };
  if (!/^(T[1-8]|FREE)$/.test(t)) {
    return { err: 'topicId 只允许 T1–T8 或 FREE（收到 ' + t + '）' };
  }
  return { value: t };
}

/* transcript 归一化：只留契约 §9.4 规定的字段。
   ★ 归一化之后 byTurn 的键来自**我们自己这份** transcript，
     不是请求方另给的编号 —— 这是上面「B8」那一节的落地。 */
function cleanTranscript(list) {
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || typeof t !== 'object') return { err: 'transcript 第 ' + (i + 1) + ' 项不是对象' };
    const turn = Number(t.turn);
    if (!turn || turn < 1 || turn % 1 !== 0) {
      return { err: 'transcript 第 ' + (i + 1) + ' 项的 turn 必须是 1 起的整数（收到 ' + JSON.stringify(t.turn) + '）' };
    }
    if (seen[turn]) return { err: 'transcript 里 turn=' + turn + ' 出现了两次（一轮只能有一条）' };
    seen[turn] = true;
    const userText = typeof t.userText === 'string' ? t.userText.trim() : '';
    const aiText = typeof t.aiText === 'string' ? t.aiText.trim() : '';
    /* ★ userText 允许为空，aiText 不允许 —— 两者不对称，是有原因的：
       PRD §6.6 自由对话里 AI 可以先开口，那一轮用户就是空的（数组是
       ["ai","user",…]），这是合法情形，不能拦在门外。
       而 aiText 为空说明这一轮 AI 根本没说话——那种轮次不该存在，
       真出现了多半是前端配对错了（Day 19 在转写配对上踩过同类的坑）。
       ★ 空 userText 存进库是空串而不是 NULL：库里 user_text 是 NOT NULL，
       而「用户这轮没说话」与「用户说了空话」在产品上是同一件事。 */
    if (!aiText) return { err: 'turn=' + turn + ' 缺 aiText（AI 这一轮的回应不能为空）' };
    if (userText.length > MAX_USER_TEXT) {
      return { err: 'turn=' + turn + ' 的 userText 超长（' + userText.length + ' 字，上限 ' + MAX_USER_TEXT + '）' };
    }
    if (aiText.length > MAX_AI_TEXT) {
      return { err: 'turn=' + turn + ' 的 aiText 超长（' + aiText.length + ' 字，上限 ' + MAX_AI_TEXT + '）' };
    }
    const ts = Number(t.timestamp);
    out.push({
      turn: turn,
      userText: userText,
      aiText: aiText,
      /* timestamp 是**相对**会话开始的毫秒数。缺省 0（= 第一轮）。
         传了负数或非数字就当没传，不因为一个排序用的字段拒绝整场。 */
      timestamp: (isFinite(ts) && ts > 0) ? Math.floor(ts) : 0,
      askedFollowUp: t.askedFollowUp === true
    });
  }
  /* 轮次从 1 起、连续 —— 数据库的复合主键只能挡住重复，挡不住跳号。
     跳号会让 items 按 turn 取原句时对不上（这一轮明明有话却取不到），
     所以在入口就要求连续。 */
  const sorted = out.map(function (x) { return x.turn; }).sort(function (a, b) { return a - b; });
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      return { err: 'transcript 的轮次必须从 1 连续编号（缺了 turn=' + (i + 1) + '）' };
    }
  }
  return { value: out };
}

/* items 归一化。★ 不读 originalText —— 它在后端从 byTurn 取（见文件头第一节）。 */
function cleanItems(list, byTurn, isFree) {
  const out = [];
  const seen = {};
  let seq = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || typeof it !== 'object') return { err: 'items 第 ' + (i + 1) + ' 项不是对象' };

    const type = String(it.type || '').toLowerCase().trim();
    let t = type;
    if (t === 'off_topic' || t === 'off-topic' || t === 'off topic') t = 'offtopic';
    if (t === 'logical' || t === 'logic_error') t = 'logic';
    if (t !== 'offtopic' && t !== 'logic' && t !== 'good') {
      return { err: 'items 第 ' + (i + 1) + ' 项的 type 只能是 offtopic / logic / good（收到 ' + JSON.stringify(it.type) + '）' };
    }

    const turn = Number(it.turn);
    const hit = byTurn[turn];
    /* ★★ B8 的落地点：原句按编号取回，取不到就整条丢弃。
       绝不接受请求方自带的 originalText —— 那等于把约束重新打开，
       而「收藏一句用户没说过的话」是这个产品最不能出的错。 */
    if (!hit) {
      /* 编号不存在：这是请求方的错，值得报错（不是静默丢弃）。
         只有「那一轮用户根本没说话」才静默丢—— 那属于合法情形
         （§6.6 自由对话里 AI 可以先开口，那一轮用户是空的）。 */
      if (!turn || turn < 1) {
        return { err: 'items 第 ' + (i + 1) + ' 项的 turn 必须是 1 起的整数' };
      }
      return { err: 'items 第 ' + (i + 1) + ' 项指向 turn=' + turn + '，但 transcript 里没有这一轮' };
    }
    if (!hit.userText) continue;

    /* 契约 §9.8 第 3 条：FREE 强制丢弃全部偏题条目，
       该模式下错误次数只由逻辑错误算（PRD §8.3）。
       放后端强制而不是让前端过滤 —— 前端过滤会让「偏题确实被生成过」
       这个事实留在链路里，换前端、加导出时它就漏出来了。 */
    if (isFree && t === 'offtopic') continue;

    const reminder = typeof it.reminder === 'string' ? it.reminder.trim() : '';
    if (reminder.length > MAX_REMINDER) {
      return { err: 'items 第 ' + (i + 1) + ' 项的 reminder 超长（' + reminder.length + ' 字，上限 ' + MAX_REMINDER + '）' };
    }

    /* B7：偏题与精彩句子没有「改法」，逻辑错误必须有。
       库里的 ck_items_correction 也会挡一层，但在这里挡能给出中文提示，
       而不是把数据库的英文报错原样透出去。 */
    let correction = null;
    if (t === 'logic') {
      correction = typeof it.correction === 'string' ? it.correction.trim() : '';
      if (!correction) return { err: 'items 第 ' + (i + 1) + ' 项是逻辑错误，必须带 correction（改法）' };
    }

    seq += 1;
    const key = t + ':' + turn;
    if (seen[key]) return { err: 'items 里 turn=' + turn + ' 的 ' + t + ' 条目出现了两次' };
    seen[key] = true;

    out.push({
      type: t,
      turn: turn,
      originalText: hit.userText,   // ★ 来自我们自己的 transcript
      reminder: reminder.slice(0, MAX_REMINDER),
      correction: correction
    });
  }
  return { value: out };
}

/* ---------- 七、读请求体 ----------
   与 analyze 同款：超限与非法 JSON 各自给一个明确的错误码。 */
function readBody(req, limitBytes) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    let tooLarge = false;
    req.on('data', function (c) {
      raw += c;
      if (raw.length > limitBytes) { tooLarge = true; raw = ''; }
    });
    req.on('end', function () {
      if (tooLarge) {
        const e = new Error('请求体太大');
        e.code = 'PAYLOAD_TOO_LARGE';
        return reject(e);
      }
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        const e2 = new Error('请求体不是合法 JSON');
        e2.code = 'INVALID_JSON';
        reject(e2);
      }
    });
    req.on('error', reject);
  });
}

/* ---------- 九、落库（Day 19：数据访问已下沉，这里只剩编排）----------
   ★★ Day 19 改造：本节原来还有 sessionRow() / turnRows() / itemRows()
     三个行构造函数和四处 db.insertMany / db.deleteWhere 调用。
     现在它们分别搬进 repositories/ 下的三个文件（一张表一个），
     本节只负责**顺序与补偿**——用户 Day 19 拍板：编排留在接口层。

     为什么这样分界：换「写库要补哪一列」→ 只动 repository；
     换「三表写入的顺序或补偿策略」→ 只动本文件。两者不会互相踩。

   ★★ 落库方式（Day 18 定的，本节一个字没改）——
     本环境（体验版）**跨请求的事务不存在**，原来的
     BEGIN → 三条 INSERT → COMMIT 做不到（实测 ROLLBACK 不生效）。
     现在的保证靠两件事（都有实测依据，见 httpdb.js 与 .probe-httpapi.js）：
       ① 批次内原子性：insertTurns / insertItems 一次 POST 整个数组，
          库把它当一个事务。实测：同批里一行违反 CHECK → 整批 0 行落库。
       ② ON DELETE CASCADE：删父行连带删子行（Day 16 建表就定义了）

     顺序必须**父表先插**，否则 turns/items 会撞外键。 */

/* ---------- 十、主处理 ---------- */
async function handlePostSession(req, res) {
  let body;
  try {
    body = await readBody(req, MAX_BODY);
  } catch (err) {
    return sendError(res, 400, err.code || 'INVALID_JSON', err.message);
  }

  /* --- 1. sessionId（可选）---
     不传 = 后端生成（守住契约 §1.6）；传了 = 当幂等键，重复提交会被主键挡住。 */
  let sessionId;
  if (body.sessionId === undefined || body.sessionId === null || body.sessionId === '') {
    sessionId = newSessionId();
  } else if (typeof body.sessionId !== 'string') {
    return sendError(res, 400, 'INVALID_PARAMS', 'sessionId 必须是字符串（不传则由后端生成）');
  } else if (body.sessionId.length > 32) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'sessionId 超长（' + body.sessionId.length + ' 字，上限 32）');
  } else if (!/^[A-Za-z0-9_-]+$/.test(body.sessionId)) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'sessionId 只能含字母、数字、下划线和连字符（收到 ' + body.sessionId + '）');
  } else {
    sessionId = body.sessionId;
  }

  /* --- 2. topicId --- */
  const topic = validTopicId(body.topicId);
  if (topic.err) return sendError(res, 400, 'INVALID_PARAMS', topic.err);
  const topicId = topic.value;
  const isFree = topicId === 'FREE';

  /* --- 3. nickname（可选）--- */
  let nickname = '';
  if (body.nickname !== undefined && body.nickname !== null) {
    if (typeof body.nickname !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', 'nickname 必须是字符串（不填留空即可）');
    }
    if (body.nickname.length > MAX_NICKNAME) {
      return sendError(res, 400, 'INVALID_PARAMS',
        'nickname 超长（' + body.nickname.length + ' 字，上限 ' + MAX_NICKNAME + '）');
    }
    nickname = body.nickname.trim();
  }

  /* --- 4. 时间 --- */
  const started = parseLocalTs(body.startedAt, 'startedAt');
  if (started.err) return sendError(res, 400, 'INVALID_PARAMS', started.err);
  const hasEnded = !(body.endedAt === undefined || body.endedAt === null || body.endedAt === '');
  let endedText = null;
  if (hasEnded) {
    const ended = parseLocalTs(body.endedAt, 'endedAt');
    if (ended.err) return sendError(res, 400, 'INVALID_PARAMS', ended.err);
    endedText = ended.text;
  }

  /* isComplete 与 endedAt 必须自洽（库里的 ck_sessions_endtime 也会挡一层，
     但在这里挡能给出中文提示，而不是把数据库的英文报错透出去）。 */
  const isComplete = body.isComplete === undefined ? hasEnded : body.isComplete === true;
  if (typeof body.isComplete !== 'undefined' && typeof body.isComplete !== 'boolean') {
    return sendError(res, 400, 'INVALID_PARAMS', 'isComplete 必须是 true 或 false');
  }
  if (isComplete && !hasEnded) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'isComplete 是 true（正常结束）就必须给 endedAt；若这场是中途退出，请把 isComplete 设为 false');
  }
  if (!isComplete && hasEnded) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'endedAt 有值就说明这场正常结束了，isComplete 不能是 false（两者必须一致）');
  }
  const durationSeconds = hasEnded ? secondsBetween(started.text, endedText) : 0;
  if (durationSeconds < 0) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'endedAt 早于 startedAt，时长算出来是负数');
  }

  /* --- 5. transcript --- */
  if (body.transcript === undefined || body.transcript === null) {
    return sendError(res, 400, 'INVALID_PARAMS', '缺少 transcript（这场对话的轮次，必填）');
  }
  if (!Array.isArray(body.transcript)) {
    return sendError(res, 400, 'INVALID_PARAMS', 'transcript 必须是数组');
  }
  if (body.transcript.length === 0) {
    return sendError(res, 400, 'INVALID_PARAMS', 'transcript 是空的（至少要有 1 轮）');
  }
  if (body.transcript.length > MAX_TURNS) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'transcript 轮数超上限（' + body.transcript.length + ' 轮，上限 ' + MAX_TURNS + '）');
  }
  const turns = cleanTranscript(body.transcript);
  if (turns.err) return sendError(res, 400, 'INVALID_PARAMS', turns.err);

  const byTurn = {};
  turns.value.forEach(function (t) { byTurn[t.turn] = t; });

  /* --- 6. items（可选）--- */
  let items = [];
  if (body.items !== undefined && body.items !== null) {
    if (!Array.isArray(body.items)) {
      return sendError(res, 400, 'INVALID_PARAMS', 'items 必须是数组');
    }
    if (body.items.length > MAX_ITEMS) {
      return sendError(res, 400, 'INVALID_PARAMS',
        'items 条数超上限（' + body.items.length + ' 条，上限 ' + MAX_ITEMS + '）');
    }
    const cleaned = cleanItems(body.items, byTurn, isFree);
    if (cleaned.err) return sendError(res, 400, 'INVALID_PARAMS', cleaned.err);
    items = cleaned.value;
  }

  /* --- 7. 四个计数在后端算，不收前端传的 ---
       errorCount = 偏题 + 逻辑错误（PRD §8.3），精彩句子不计入；
       FREE 下偏题已被整条丢弃，所以那里只剩逻辑错误。 */
  let errorCount = 0, goodSentenceCount = 0;
  items.forEach(function (it) {
    if (it.type === 'good') goodSentenceCount += 1;
    else errorCount += 1;
  });

  /* --- 8. 落库：每表一次请求，失败时补偿删除 ---
     ★★★ 本环境（体验版）**跨请求的事务不存在**，所以原来的
       BEGIN → 三条INSERT → COMMIT 做不到（实测 ROLLBACK 不生效）。
       现在这个顺序的依据是两条实测结论：

       ① 批次内原子：insertMany 一次 POST 整个数组，库把它当一个事务。
          实测：同批里一行违反 CHECK → 整批 0 行落库。
       ② 删父行连带删子行：sessions 的 DELETE 会带走 turns 与 items
          （Day 16 建表就定义了 ON DELETE CASCADE）。

       于是顺序必须是 **父表先插**，否则 turns/items 会撞外键。
       补偿只在第2、3 步做——第 1 步失败时本来就没有任何残留。 */
  let step = '1/3 sessions';
  try {
    await sessionsRepo.insertSession(sessionsRepo.buildSessionRow({
      sessionId: sessionId, topicId: topicId, nickname: nickname,
      startedAt: started.text, endedAt: endedText,
      durationSeconds: durationSeconds, errorCount: errorCount,
      goodSentenceCount: goodSentenceCount, turnCount: turns.value.length,
      isComplete: isComplete
    }));

    step = '2/3 turns';
    await turnsRepo.insertTurns(turnsRepo.buildTurnRows(sessionId, turns.value));

    /* 条目的 created_at：这一场结束时才算出来的，所以用 endedAt；
       中途退出的场次没有 endedAt，退回 startedAt。
       刻意**不用当前时间** —— 契约 §6.1 明写偏移量与时间都不引入运行时依赖，
       同一份输入两次调用应当落进库里同样的值。 */
    const createdAt = endedText || started.text;
    step = '3/3 items';
    await itemsRepo.insertItems(itemsRepo.buildItemRows(sessionId, topicId, items, createdAt));

    /* 读回时给的形状与 GET /api/sessions 的 sessions[] 一致 ——
       同一个字段名两处必须一样，否则前端要写两套取值代码。 */
    return sendOK(res, {
      session: {
        sessionId: sessionId,
        topicId: topicId,
        nickname: nickname === '' ? null : nickname,
        startedAt: started.text.replace(' ', 'T') + TZ_SUFFIX,
        endedAt: endedText ? endedText.replace(' ', 'T') + TZ_SUFFIX : null,
        durationSeconds: durationSeconds,
        errorCount: errorCount,
        goodSentenceCount: goodSentenceCount,
        turnCount: turns.value.length,
        isComplete: isComplete,
        aborted: !hasEnded
      },
      turnsStored: turns.value.length,
      itemsStored: items.length,
      /* 被 B8 与 FREE 规则丢掉的条目数。前端据此能告诉用户
         「有 N 条没存进去」，而不是让条目静默消失。 */
      itemsDropped: (body.items || []).length - items.length
    });
  } catch (err) {
    /* 补偿删除：第 2、3 步失败时把已插入的父行删掉。
       ★ 为什么第 1 步失败不用补偿 —— 那一步失败时库里什么都没有。
       ★ 补偿失败也不掩盖原始错误：原始错误才是根因，补偿失败只进日志。 */
    if (step !== '1/3 sessions') {
      try {
        await sessionsRepo.deleteBySessionId(sessionId);
        console.log('[write] 已补偿删除 sessionId=' + sessionId + '（' + step + ' 失败）');
      } catch (e2) {
        console.error('[write] ★ 补偿删除也失败了，库里可能留下一行残数据：' +
          sessionId + ' —— ' + (e2 && e2.message ? e2.message : e2));
        console.error('  下次重试会被主键挡住（DUPLICATE），不会写出半场数据；'
          + '若确认要清，用 DELETE FROM sessions WHERE session_id = ' + sessionId);
      }
    }
    console.error('[write] 写库失败（' + step + '）sessionId=' + sessionId + '：' +
      (err && err.stack ? err.stack : err));
    const kind = db.classify(err);
    /* 业务失败走 200 + ok:false（契约 §1.4）：
       前端不必区分「网络失败」与「业务失败」两套处理逻辑。
       ★ 唯一例外是 DUPLICATE —— 那是请求本身错了（同一条记录提交两次），
         用真实的 400，前端能据此提示「别重复点」。 */
    return sendError(res, kind.code === 'DUPLICATE' ? 400 : 200, kind.code, kind.message);
  }
}

/* ---------- 出口映射（契约 §9.8 第 4 条）----------
   ★★ Day 22：这里要说明为什么**又一份** shapeItem，而不复用 read 那边那份。
     读接口的 shapeItem 在 cloudfunctions/read/index.js 里，与本文件不同目录、
     不同云函数，且两个目录之间没有共享模块的机制（复制部署，各自独立）。
     契约那条「映射只写在出口那一处」指的是**一个接口的出口只有一处**，
     不是整个仓库只能有一行映射代码。
     ★ 代价是两份实现可能改岔，所以单测里有一条检查（.test-modify.js）：
       两份 shapeItem 对同一行数据必须给出同样的对象 —— 不一致就在测试里报出来。

   ★ 为什么这份要处理 favorited_at 的 null：
     未收藏的条目在库里是 NULL，接口要原样给 null 而不是空串，
     前端靠它区分「没收藏过」与「收藏了但没记时间」。 */
function isoOut(ts) {
  if (ts === null || ts === undefined) return null;
  let s = String(ts);
  if (s.indexOf(' ') >= 0) s = s.replace(' ', 'T');   // 防御：有的环境给空格分隔
  if (/(?:[+-]\d{2}:?\d{2}|Z)$/.test(s)) return s;
  return s + TZ_SUFFIX;
}

function shapeItem(row) {
  return {
    itemId: row.item_id,
    sessionId: row.session_id,
    topicId: row.topic_id,
    type: row.type,
    turn: Number(row.turn),
    originalText: row.original_text,
    reminder: row.reminder,
    /* correction 保持 null（偏题与精彩句子无改法，B7）——
       不变成空串，那是前端 mapItem 的展示层该做的翻译。 */
    correction: row.correction === null || row.correction === undefined ? null : row.correction,
    isFavorited: row.is_favorited,
    note: row.note,
    favoritedAt: isoOut(row.favorited_at),
    createdAt: isoOut(row.created_at)
  };
}

/* ---------- 十之二、Day 22：改一条条目（PATCH /api/sessions/write）----------
   -------------------------------------------------------------
   它实现契约 §6.1 R5 的写侧：把一条 item 的**备注**与**收藏标记**改掉。

   ★★ 为什么只开放这两个字段，其余一律拒绝：
     其余字段分两类，都不该由用户改：
       · original_text / correction —— 绑着 B8「不编造原句」与 B7「偏题不给改法」。
         用户改这两列就等于亲手绕过本项目最不能出的那条错。
       · type / turn / reminder / session_id / topic_id / created_at ——
         它们是 AI 那一轮判断的产物与归属信息，改了就与 turns 表对不上，
         结果页会指向一条不存在或错配的轮次。
     所以这里采取「白名单 + 明确报错」而不是「黑名单拦危险字段」：
     白名单漏一个字段是安全的一侧（新字段默认不可改），
     黑名单漏一个则是危险的一侧（新字段默认可改）。

   ★★ 收藏标记必须连带改收藏时间（ck_items_favtime）：
     库里有约束「收藏了必须有收藏时间、没收藏必须没有收藏时间」。
     只改 is_favorited 不改 favorited_at 会被数据库拒（23514），
     而那条报错是英文的 CHECK 约束名 —— 用户看不懂。
     所以连带逻辑写在这里，数据库只当最后一道防线。

   ★★ 为什么先查存在性再改：
     PostgREST 命中 0 行也回 200（httpdb.js 的 patchWhere 注释），
     拿返回值判断「改到了没有」是错的。而契约要求「不存在的 id 返回中文错误说明」，
     200 + 空体没法区分「不存在」与「存在但没变化」。 */
async function handlePatchItem(req, res) {
  let body;
  try {
    body = await readBody(req, MAX_BODY);
  } catch (err) {
    return sendError(res, 400, err.code || 'INVALID_JSON', err.message);
  }

  /* --- 1. itemId：必填，格式与长度都按建表脚本（VARCHAR(40)）--- */
  if (body.itemId === undefined || body.itemId === null || body.itemId === '') {
    return sendError(res, 400, 'INVALID_PARAMS', '缺少 itemId（要改哪一条，得先说清楚它的编号）');
  }
  if (typeof body.itemId !== 'string') {
    return sendError(res, 400, 'INVALID_PARAMS', 'itemId 必须是字符串');
  }
  if (body.itemId.length > MAX_ITEM_ID) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'itemId 超长（' + body.itemId.length + ' 字，上限 ' + MAX_ITEM_ID + '）');
  }

  /* --- 2. 至少要给一个要改的字段 ---
     全空的 PATCH 是无意义请求：要么是调用方漏了，要么是前端 bug。
     明确报出来比回一个「改成功了但什么都没变」诚实。 */
  const hasNote = body.note !== undefined && body.note !== null;
  const hasFav = body.isFavorited !== undefined && body.isFavorited !== null;
  if (!hasNote && !hasFav) {
    return sendError(res, 400, 'INVALID_PARAMS',
      '没有要改的内容（可改的是 note 备注与 isFavorited 收藏标记，至少给一个）');
  }

  /* --- 3. 逐个校验 --- */
  const patch = {};

  if (hasNote) {
    if (typeof body.note !== 'string') {
      return sendError(res, 400, 'INVALID_PARAMS', 'note 必须是字符串（留空串即可清空备注）');
    }
    if (body.note.length > MAX_NOTE) {
      return sendError(res, 400, 'INVALID_PARAMS',
        'note 超长（' + body.note.length + ' 字，上限 ' + MAX_NOTE + '）');
    }
    patch.note = body.note;
  }

  let nextFav = null;
  if (hasFav) {
    /* 严格布尔，不接受 'true' / 1 这类。
       为什么不容错：isFavorited 与 favorited_at 是一条约束的两半，
       一旦把 'false' 当成 true（JS 里非空字符串都是真值），就会写出
       「没收藏却带收藏时间」的脏数据，还是英文报错。 */
    if (typeof body.isFavorited !== 'boolean') {
      return sendError(res, 400, 'INVALID_PARAMS',
        'isFavorited 必须是 true 或 false（收到 ' + JSON.stringify(body.isFavorited) + '）');
    }
    nextFav = body.isFavorited;
    patch.is_favorited = nextFav;
    /* ★ 连带的那一半（ck_items_favtime）。收藏 → 记下此刻；
       取消收藏 → 时间必须清空，否则数据库拒。 */
    patch.favorited_at = nextFav ? nowLocalText() : null;
  }

  /* --- 4. 查存在性（理由见上方注释：命中 0 行也回 200，判不出来）--- */
  const itemId = body.itemId;
  let before;
  try {
    before = await itemsRepo.findItemById(itemId);
  } catch (err) {
    const kind = db.classify(err);
    return sendError(res, 200, kind.code, kind.message);
  }
  if (!before) {
    /* 404 + 中文说明。用真实 404 而不是 200：这是「你指的那条不存在」，
       属于请求本身错了，前端可以据此提示「可能已经被删掉了」
       而不必与「库读不到」混为一谈（两者都降级时提示完全不一样）。 */
    return sendError(res, 404, 'NOT_FOUND',
      '找不到这一条（itemId=' + itemId + '）。它可能已经被删掉了，' +
      '或者编号不是本系统生成的 —— 请刷新列表后重试。',
      { gotItemId: itemId });
  }

  /* --- 5. 落改 --- */
  let updated;
  try {
    updated = await itemsRepo.updateItemById(itemId, patch);
    /* 回读一次，用**库里的真值**作为响应，而不是把 patch 原样回显。
       为什么：并发场景下别人可能也改过同一条，回显 patch 等于
       告诉用户「你现在看到的是我以为的样子」而不是真实状态。 */
    const after = await itemsRepo.findItemById(itemId);
    return sendOK(res, {
      item: shapeItem(after || before),
      /* 改前改后都给：契约 §1.5 那条「回显我实际收到了什么」的同一条思路，
         放在这里是给截图与排错用 —— 不用再查一次库就能对比出来。 */
      before: { note: before.note, isFavorited: before.is_favorited },
      changed: Object.keys(patch)
    });
  } catch (err) {
    console.error('[write] 改条目失败 itemId=' + itemId + '：' +
      (err && err.stack ? err.stack : err));
    const kind = db.classify(err);
    return sendError(res, 200, kind.code, kind.message);
  }
}

/* ---------- 十之三、Day 22：删一条条目（DELETE /api/sessions/write）----------
   ★★ 删除为什么比新增更容易出事（今天要掌握的那件事）：
     新增写错了一条 → 库里多一行，GET 列表里多一条，用户看得见、也能顺手删掉。
     删除写错了一次 → 那一行**当场消失**，没有撤销、没有历史、没有痕迹。
     所以删除这条路径上多两道确认：
       ① 前端必须二次确认（records.html 用 window.confirm，用户亲眼看过再点）
       ② 后端必须先查存在性再删 —— 不存在的 id 要给中文说明，
          而不是回一个「成功」让人以为真删掉了什么
     这两条都不是功能，是把不可逆操作挡在能被看见的地方。

   ★ 为什么删的是 items 行而不是 sessions 行：
     sessions 的外键是 ON DELETE CASCADE，删一场会把整场的 turns 与 items 一起带走，
     那是「删一场练习」的语义，属于另一个接口的范围。
     今天只删单条条目 —— 它是用户在结果页/记录页看到并能单独判断「这条我不要了」的东西。

   ★★★★ Day 22 余力加练：这里改成**软删除**（不真删行，只把 is_deleted 置 true）。
     为什么这道加练正好落在这层：把 is_deleted 写成查询条件里的一处，
     这里就从 DELETE 换成 UPDATE，**接口形状与前端二次确认都不用变**。

     软删除带来的两处连锁改动（都不是可选的，漏了就是 bug）：
       ① 「标记之后再查一次」这一步的**方法换了**——
          现在 findItemById 带 is_deleted=eq.false 过滤，
          所以「查不到了」不能证明「标记写成功了」（本来就查不到也能查不到）。
          → 必须用 **findItemByIdIncludingDeleted** 复查：
            它绕过过滤，能真正验证「行还在、且 is_deleted 已变成 true」。
       ② 404 的含义 broadened：「找不到」现在包含「已软删」——
          这正好是想要的：软删过的条目再删一次，仍回 404 + 「它可能已经被删过了」。

     ★ 找回的口子留在库里：行还在，
       `UPDATE items SET is_deleted = FALSE` 就能改回来
       （用户 Day 22 拍板：本期只做标记 + 查询跳过，不做恢复接口）。 */
async function handleDeleteItem(req, res) {
  /* itemId 走 query 而不是 body：DELETE 带 body 在各代理上的行为不一致，
     而 query 是所有路径都确定支持的（read 接口的两个 GET 也是走 query）。 */
  const url = req.url || '/';
  const qs = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : '';
  const query = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      const v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      query[k] = v;
    }
  }

  const itemId = query.itemId;
  if (itemId === undefined || itemId === null || itemId === '') {
    return sendError(res, 400, 'INVALID_PARAMS',
      '缺少 itemId（要删哪一条，得先说清楚它的编号）');
  }
  if (itemId.length > MAX_ITEM_ID) {
    return sendError(res, 400, 'INVALID_PARAMS',
      'itemId 超长（' + itemId.length + ' 字，上限 ' + MAX_ITEM_ID + '）');
  }

  /* 先查存在性。★ 这一步不是多余的：
     软删除之后，「查到了」=「它在，且没被软删过」，这正是要删的前提。
     若它已经软删过，这里返回 null → 走下面的 404「它可能已经被删过了」——
     与真删时期的行为一致，用户看到的提示没变。 */
  let before;
  try {
    before = await itemsRepo.findItemById(itemId);
  } catch (err) {
    const kind = db.classify(err);
    return sendError(res, 200, kind.code, kind.message);
  }
  if (!before) {
    return sendError(res, 404, 'NOT_FOUND',
      '找不到这一条（itemId=' + itemId + '），没有东西可删。它可能已经被删过了。',
      { gotItemId: itemId });
  }

  /* 真要说有什么该拦的：删一条被收藏的条目会让收藏区少一条，
     但那是用户自己的数据、自己的判断，后端不该替他决定。
     ★ 软删除会顺手清掉这条的收藏标记（见 softDeleteItemById 注释），
       所以「收藏区少一条」这件事仍然成立，不需要额外拦。 */
  try {
    await itemsRepo.softDeleteItemById(itemId);

    /* 标记之后再查一次，确认标记真落到行上了。
       ★★ 这里**必须**用 IncludingDeleted 那个方法，不能用 findItemById ——
         软删之后 findItemById 带 is_deleted=eq.false 过滤，
         它天然查不到刚软删的那条。用它验证等于「用结论证明结论」：
         查不到是因为过滤生效了，而过滤生效恰恰就是我这次要验证的那件事 ——
         但真正该验的是「**行还在，且 is_deleted 变成 true 了**」。

       多这一次查询换一条可信结论，值得 —— 这正是今天这个知识点本身。 */
    const after = await itemsRepo.findItemByIdIncludingDeleted(itemId);
    if (!after || after.is_deleted !== true) {
      /* 标记没生效，这是最不该悄悄过去的一种状态：用户以为删掉了，
         刷新列表又看见它。宁可报错也不要回「成功」。 */
      return sendError(res, 200, 'DB_QUERY_FAILED',
        '删除没有生效，刷新后这条记录仍然在。可能是同一条被并发改动过，请刷新列表重试。');
    }

    return sendOK(res, {
      itemId: itemId,
      /* softDeleted=true 是给前端的一句人话：
         「这一条已经对所有查询不可见了」，而不是「那一行从库里消失了」。
         前端拿它决定提示措辞 —— 用户 Day 22 拍板「契约与文案同步说明」，
         对外口径必须与实际一致，不能还说「从库里删掉了」。 */
      softDeleted: true,
      /* 把软删掉的那条摘要回给前端，让它能在提示里说清删了什么，
         而不是只说「已删除」。 */
      deleted: {
        itemId: before.item_id,
        type: before.type,
        turn: Number(before.turn),
        originalText: before.original_text,
        wasFavorited: before.is_favorited,
        note: before.note
      }
    });
  } catch (err) {
    console.error('[write] 删条目失败 itemId=' + itemId + '：' +
      (err && err.stack ? err.stack : err));
    const kind = db.classify(err);
    return sendError(res, 200, kind.code, kind.message);
  }
}

/* ---------- 十一、HTTP 服务 ---------- */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return '';
  return String(fwd).split(',')[0].trim();
}

const server = http.createServer(function (req, res) {
  const t0 = Date.now();
  const url = req.url || '/';
  const path = url.split('?')[0];
  const norm = path.replace(/\/+$/, '') || '/';

  /* ★ 三个接口为什么共用一条路径（Day 22 实测踩出来的，不是设计偏好）：
     CloudBase HTTP 网关**同一域名下不能有重复路径**（重复会报 INVALID_PARAM），
     路由配置里**没有 method 字段** → 网关不能按方法分流，
     一条路径天然就能同时服务 POST / PATCH / DELETE。

     ⚠️ 本来给 PATCH/DELETE 各自建了 /api/items/update 与 /api/items/delete，
       两条都**建不出来**：控制台「新增触发路径」只能建 `SCF` 类型路由
       （下拉只有「云函数」与「静态网站托管」），而 write 是 `WEB_SCF` 类型，
       提交即「创建失败」；CLI 的 routes add/edit/delete 三条路也全被拒
       （add 报「system internal domain 不支持手工创建」，
        edit/delete 报「路由不存在」—— 因为压根没进路由表）。
       结论：HTTP 型函数的路径**只能靠控制台建，且控制台建不了**。
       所以复用已存在的 /api/sessions/write —— 实测它本来就能收到 PATCH/DELETE。

     ★★ 网关会把 PATCH 与 DELETE 原样转发（方法不改写），这是探针实测的：
       拿 `PATCH /api/sessions/write` 打这条路由，拿到的是本函数自己写的
       405 + 中文说明与 gotPath —— 说明请求进了函数且 req.method 就是 PATCH。
       ★ 所以这两个接口用的是**标准 HTTP 方法**，
         不需要退化成「POST + body 里带 _method」那种绕法。

     ⚠️ 网关路由顺序：**这条必须排在 /api/sessions 之前**，
       否则更短的路径会先匹配掉它（同一类坑：契约 §1.1 记着「/api 排在 / 之前」）。

     ★ 路径语义变别扭了（叫 write 却也管改删），这是被网关逼出来的妥协，
       不是设计选择。将来若控制台能建 WEB_SCF 路由，改回 RESTful 的
       /api/items/{id} 只需改这张表 + 前端一个字符串，云函数代码不用动。 */
  const ROUTES = {
    '/api/sessions/write': {
      POST: handlePostSession,   /* 写入一场练习（Day 18） */
      PATCH: handlePatchItem,    /* 改一条条目：备注 / 收藏标记（Day 22） */
      DELETE: handleDeleteItem   /* 删一条条目：itemId 走 query（Day 22） */
    },
    '/sessions/write': {        /* 同一个 key 的双前缀写法（沿用 Day 18） */
      POST: handlePostSession,
      PATCH: handlePatchItem,
      DELETE: handleDeleteItem
    }
  };

  const route = ROUTES[norm];
  if (!route) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：POST /api/sessions/write（写入一场练习）、' +
      'PATCH /api/sessions/write（改一条条目）、DELETE /api/sessions/write（删一条条目）。' +
      '读取会话列表与收藏请用 GET /api/sessions 与 GET /api/favorites',
      { gotPath: path });
  }
  if (!route[req.method]) {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED',
      '这条路径接受 ' + Object.keys(route).join(' / ') + '（收到了 ' + req.method + '）',
      { gotPath: path });
  }

  route[req.method](req, res).catch(function (err) {
    console.error('[write] 未捕获异常：' + (err && err.stack ? err.stack : err));
    if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
  }).then(function () {
    /* 排错日志（Day 18 清单的「余力加练」加的一条）。
       为什么必须有它：实测 `tcb fn log` 对 HTTP 函数查不到调用日志
       （返回 No invocation logs），所以行数与耗时只能打在 stdout 里。
       一行一条，格式固定，方便 grep。**不打印请求体**——
       它含用户原句与昵称。 */
    console.log('[write] ' + req.method + ' ' + norm + ' from ' + clientIp(req) +
      ' → ' + res.statusCode + ' ' + (Date.now() - t0) + 'ms');
  });
});

server.listen(9000, '0.0.0.0', function () {
  console.log('[write] listening on 0.0.0.0:9000');
  console.log('[write] 三条路由共用一条路径 /api/sessions/write（网关不能按方法分流，原因见路由层注释）：');
  console.log('[write]   POST   /api/sessions/write（写 sessions + turns + items，每表一次请求 + 补偿删除）');
  console.log('[write]   PATCH  /api/sessions/write（改 note / isFavorited，先查存在性，收藏连带写 favorited_at）');
  console.log('[write]   DELETE /api/sessions/write?itemId=（删单条条目，先查存在性 + 删后复查，不存在回 404 中文说明）');
  console.log('[write] 硬约束：原句按 turn 取回（B8）/ 偏题 correction 必须为空（B7）/ FREE 丢弃偏题');
  console.log('[write] 防重复：同sessionId 第二次提交 → 主键冲突 → 400 DUPLICATE');
  console.log('[write] ★ PATCH 只开放 note 与 isFavorited：originalText/correction/type/turn 一律不改');
  console.log('[write] db: ' + db.describe());
  console.log('[write] 落库方式：每表一次请求 + 失败时补偿删除（跨请求事务在本环境不存在）');
});

/* 优雅退出。★ Day 18：原来这里要 pool.end() 收连接池，
   现在走 HTTP API 没有连接池，收干净即可。 */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, function () {
    server.close();
    process.exit(0);
  });
}