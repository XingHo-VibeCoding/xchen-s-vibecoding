/* POST /api/sessions/write —— 写入一场练习（Day 18 · 板块 ①）
   -------------------------------------------------------------
   位置：后端第 5 个云函数，也是**第一个往数据库里写**的接口。
   它实现契约 §6.1 登记的 R3：点「结束对话」时把一场练习整场存下来。
   落三张表：sessions（汇总，1 行）+ turns（轮次，1:N）+ items（条目，1:N）。

   ★★ 路径为什么带 /write 后缀（不是契约 §6.1 原写的 /api/sessions）：
     CloudBase HTTP 网关**同一域名下不能有重复路径**（重复报 INVALID_PARAM），
     且路由配置里**没有 method 字段** —— 网关无法按 HTTP 方法把同一路径
     分给两个函数。而 `/api/sessions` 已被 read 占了（Day 17 建的 GET 列表）。
     所以写入另起一条路径，见文件头下方那段注释。

   ★ 为什么写库这个要单独一个函数，而不是并进 read：
     · 超时预算不同。读库毫秒级（read 给 20 秒），写库要插三张表 + 事务，
       20 秒也够，但两类请求的失败代价不同，混在一起不好排错。
     · 更要紧的是**它需要凭证而 read 不需要**：写库前要判重、要生成主键，
       一旦有人日后给写接口加上任何"外发"逻辑（发通知、写日志到外部），
       它就会变成第二个需要隔离密钥的函数。先分开，比将来再拆便宜。
     · chat / analyze 不查库、read/write 查库，这四条边界写在契约 §9.8 第 1 条。

   ★ 为什么一次写三张表（而不是只写 sessions 一行）：
     单独插sessions 会留下一场「有汇总、没有内容」的记录 ——
     记录页能看到它，点进去却什么都没有。三个 INSERT 放在**一个事务**里，
     要么全成、要么全不成，不会留半场数据。

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

/* itemId = sessionId + 类型字母 + 序号，最长 32 + 2 + 2 = 36 字，VARCHAR(40) 装得下。 */
function newItemId(sessionId, type, seq) {
  const letter = type === 'logic' ? 'L' : (type === 'good' ? 'G' : 'O');
  return sessionId + '-' + letter + seq;
}

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

/* ---------- 九、行数据（交给 HTTP API 批量插入）----------
   ★ Day 18 改造：原来是三条带 $n 占位符的 INSERT 字符串，现在改成
     **每表一个数组**，由 httpdb.insertMany() 一次 POST 整个数组。

     为什么这样改：实测（本环境）**跨请求的事务不存在** ——
     BEGIN 与 ROLLBACK 分两次 HTTP 调用，ROLLBACK 后那一行还在。
     多语句拼一次调用又被 PG 拒（cannot insert multiple commands into a prepared statement）。
     所以原设计的「三表一个事务」在本环境做不到。

     现在的保证靠两件事（都有实测依据，见 httpdb.js 与 .probe-httpapi.js）：
       ① 批次内原子性：同批里一行违反 CHECK → 整批 0 行落库
       ② ON DELETE CASCADE：删父行连带删子行（Day 16 建表就定义了）

   列名一律 snake_case（库里就是这样），映射在响应出口那一处做（契约 §9.8 第 4 条）。 */
function sessionRow(sessionId, topicId, nickname, startedAt, endedAt, durationSeconds, errorCount, goodSentenceCount, turnCount, isComplete) {
  return {
    session_id: sessionId,
    topic_id: topicId,
    nickname: nickname,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    error_count: errorCount,
    good_sentence_count: goodSentenceCount,
    turn_count: turnCount,
    is_complete: isComplete
  };
}

function turnRows(sessionId, turns) {
  return turns.map(function (t) {
    return {
      session_id: sessionId,
      turn: t.turn,
      user_text: t.userText,
      ai_text: t.aiText,
      timestamp: t.timestamp,
      asked_follow_up: t.askedFollowUp
    };
  });
}

/* ★ 这三列**不出现在这里**，走建表时的 DEFAULT：
     is_favorited → FALSE、note → ''、favorited_at → NULL。
   写接口不碰收藏（F4 是 PATCH 的活，Day 20+）。
   ★ 顺带一个好处：ck_items_favtime（收藏状态与收藏时间必须一致）
     这条约束因此天然成立，不需要在应用层再对一遍。 */
function itemRows(sessionId, topicId, items, createdAt) {
  let seq = 0;
  return items.map(function (it) {
    seq += 1;
    return {
      item_id: newItemId(sessionId, it.type, seq),
      session_id: sessionId,
      topic_id: topicId,
      type: it.type,
      turn: it.turn,
      original_text: it.originalText,
      reminder: it.reminder,
      correction: it.correction,
      created_at: createdAt
    };
  });
}

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
    await db.insertMany('sessions', [sessionRow(
      sessionId, topicId, nickname, started.text, endedText,
      durationSeconds, errorCount, goodSentenceCount, turns.value.length, isComplete
    )]);

    step = '2/3 turns';
    await db.insertMany('turns', turnRows(sessionId, turns.value));

    /* 条目的 created_at：这一场结束时才算出来的，所以用 endedAt；
       中途退出的场次没有 endedAt，退回 startedAt。
       刻意**不用当前时间** —— 契约 §6.1 明写偏移量与时间都不引入运行时依赖，
       同一份输入两次调用应当落进库里同样的值。 */
    const createdAt = endedText || started.text;
    step = '3/3 items';
    await db.insertMany('items', itemRows(sessionId, topicId, items, createdAt));

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
        await db.deleteWhere('sessions', { session_id: 'eq.' + sessionId });
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

  /* ★ 路径为什么不是 /api/sessions（Day 18 实测踩到的硬约束）：
     CloudBase HTTP 网关**同一域名下不能有重复路径**（重复会报 INVALID_PARAM），
     而且路由配置里**没有 method 字段** —— 网关不能按 HTTP 方法分流。
     `/api/sessions` 已被 read 占了（Day 17 建的 GET 列表），
     所以写入只能另起一条路径。选 /api/sessions/write 的理由：
     它仍然读得出「这是 sessions 的写」，将来网关若支持方法分流，
     改回 /api/sessions 只需要删一条路由、动前端一个字符串。
     ⚠️ 网关路由顺序：**这条必须排在 /api/sessions 之前**，
       否则更短的路径会先匹配掉它（同一类坑：契约 §1.1 记着「/api 排在 / 之前」）。 */
  const isSessions = norm === '/api/sessions/write' || norm === '/sessions/write';
  if (!isSessions) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：POST /api/sessions/write（写入一场练习）。读取会话列表请用 GET /api/sessions',
      { gotPath: path });
  }
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED',
      '本接口只接受 POST（读取会话列表请用 GET /api/sessions，那是另一个云函数）',
      { gotPath: path });
  }

  handlePostSession(req, res).catch(function (err) {
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
  console.log('[write] route: POST /api/sessions/write（写 sessions + turns + items，一个事务）');
  console.log('[write] 硬约束：原句按 turn 取回（B8）/ 偏题 correction 必须为空（B7）/ FREE 丢弃偏题');
  console.log('[write] 防重复：同sessionId 第二次提交 → 主键冲突 → 400 DUPLICATE');
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