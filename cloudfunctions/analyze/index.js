/* POST /api/analyze —— 整场结束后的判断（契约 §4）
   -------------------------------------------------------------
   用途：一次给全三类条目（偏题 / 逻辑错误 / 精彩句子）。
   **只在对话结束时调一次**，不是每轮都调（契约 §4 首句）。

   -------------------------------------------------------------
   一、为什么独立成一个函数，而不是并进 chat

   chat    —— 每轮都调，3–15 秒，超时 60 秒，只回一句话
   analyze —— 整场调一次，输入是**整份 transcript**（可能几十轮），
              prompt 远大于 chat，超时也该更长，而且失败要能重试

   两条路的超时预算、输入规模、失败代价都不一样，放一个函数里
   就会出现「chat 为了迁就 analyze 的超时把等待拉到 60 秒」这类问题。
   与 Day 17 定「chat 必须独立成函数」是同一条理由。

   ★ 它同样**不查库**（契约 §9.8 第 1 条）。判定只用这一场自己的
     transcript，不需要读会话、不需要读条目。写库是另一件事（Day 20+）。

   -------------------------------------------------------------
   二、★ 原文不由模型决定 —— 但**要给模型看**（Day 19 实测修正）

   契约 §4 硬约束 1 要求 originalText 从 transcript[].userText 原样取出。
   这一点从头到尾没变过。

   ★ 但 Day 19 第一版实现踩了一个大坑，值得记下来：
     我原本理解成「模型碰不到原句字符串」，于是提示词里**连内容都不给**，
     只发「turn 1: [user spoke]」这样的空标签。

     实测结果：模型输出 issues: [] 并把几乎每一轮都列进 goodSentences——
     连「I really like the coffee machine on the third floor」（明显偏题）
     与「We have some issues but I think it's ok」（自相矛盾）都被当成亮点。

     **原因是判断的前提就是看到内容。** 无内容可判时，
     模型的唯一合理解读就是「既然没看出问题，那就都是好句子」。

     现在改成：**给模型看原句，但最终产出前一律用后端取回的原文覆盖**
     （normalizeIssue 根本不看模型可能多回的 originalText 字段）。
     判断力回来了，硬约束 1 也仍然成立——
     约束从「输入侧封锁」改成了「输出侧覆盖」，
     而目标是同一个：**用户看到的必须是他自己说过的话**。

  契约 §4 的措辞已同步修正（见那一节的 Day 19 记录）。

   ★ 只给**用户说的话**，不给 AI 说了什么——
     给了 AI 的话，模型会把「对方的回应」当成该判断的对象。

   -------------------------------------------------------------
   三、三条硬约束（契约 §4，均在本文件强制，用户已拍板只在后端做）

   ① 原文按编号取回（见上）
   ② 偏题条目的 correction 强制置 null —— 不依赖模型自觉
      （B7：偏题只提醒、不给改法）
   ③ FREE 模式下强制丢弃所有 offtopic 条目；
      该模式 errorCount 只由 logic 条目计算（PRD §8.3）

   ★ 为什么这三条不放前端做（契约 §4 末尾的原话）：
     前端过滤会让「偏题条目确实被生成过」这个事实留在链路里，
     将来换前端、加导出功能时它就漏出来了。**口径要卡在数据源头那一层。**

   -------------------------------------------------------------
   四、模型输出为什么要求 JSON，而 chat 不要求

   chat 要的是一句话，模型偶尔带包装（"AI: xxx"）能靠 cleanAiText 收拾。
   analyze 要的是**结构化的多条判断**，靠正则从散文里抠 JSON 不可靠 ——
   抠不出来就整场失败，用户白练一场。所以这里：
     · 明确要求只输出 JSON
     · 解析失败时**重试一次**（把错误告诉模型让它自己改）
     · 仍失败才报 LLM_BAD_FORMAT
   重试只做一次：两次都失败说明是系统性问题，再试就是烧钱。
   -------------------------------------------------------------------- */

const http = require('http');
const https = require('https');

/* ---------- 配置 ---------- */
/* 密钥只从环境变量读，绝不写死（TECH_DESIGN §9.1，与 chat 同规矩）。 */
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

const LLM_TIMEOUT_MS = 55000;      // 与 chat 同值，见 cloudbaserc.json 的 timeout

/* 一场对话最多多少轮。
   ★ 上限保护：transcript 来自前端，理论上能被人为塞很大。
     prompt tokens 直接等于钱，而 200 轮的口语转写对「找问题」这件事
     已经远超需要（真人一次对话也就几十轮）。超出的部分从**最早**开始丢 ——
     偏题与逻辑错误往往出现在前半场，精彩句子在中间，两头都不能少。 */
const MAX_TURNS = 40;

/* 每类条目的条数上限。
   为什么限：模型倾向于「找到一处就开始列举」，不设上限会返回十几条
   几乎同义的问题，用户看到的不是「你今天的三处问题」而是噪声。
   5 条已经超过一次对话里真正值得记住的量。 */
const MAX_ISSUES = 5;
const MAX_GOOD = 3;

function checkEnv() {
  const need = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
  return need.filter((k) => !process.env[k]);
}

/* ---------- HTTP 响应 ---------- */
function sendJSON(res, httpStatus, body) {
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function sendError(res, httpStatus, errorCode, message, extra) {
  const body = { ok: false, data: null, error: { code: errorCode, message: message } };
  if (extra) {
    for (const k of Object.keys(extra)) body[k] = extra[k];
  }
  sendJSON(res, httpStatus, body);
}

/* ---------- 调用大模型 ----------
   与 chat 一样手写 https，不引 SDK：同样只调一个 HTTP 接口。
   ★ 但要多一个参数 retryHint：重试时把上次的错误告诉模型让它自己改。 */
function callLLM(messages) {
  return new Promise((resolve, reject) => {
    const base = new URL(LLM_BASE_URL);
    let pathname = base.pathname && base.pathname !== '/' ? base.pathname : '/chat/completions';
    if (/\/chat\/completions$/.test(pathname)) {
      /* 填了完整路径 */
    } else if (/\/v1$/.test(pathname)) {
      pathname += '/chat/completions';
    } else if (pathname === '/chat/completions') {
      /* 默认值 */
    } else {
      pathname = pathname.replace(/\/$/, '') + '/chat/completions';
    }

    const payload = JSON.stringify({
      model: LLM_MODEL,
      messages: messages,
      stream: false,
      /* ★ temperature 与 chat 不同：这里要的是**判断稳定**，
         不是花样。同一场对话判两次若结论都不一样，用户会怀疑这个功能。
         0.2 保留一点变化，又不至于飘。 */
      temperature: 0.2,
      /* 输出量级远大于 chat：几类条目 × 提醒 + 改法，几百 token 起。
         给 1200，不够会在 max_tokens 处被硬截 → JSON 解析必失败。 */
      max_tokens: 1200
    });

    const req = https.request(
      {
        hostname: base.hostname,
        port: base.port || 443,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + LLM_API_KEY
        }
      },
      (upstream) => {
        let raw = '';
        upstream.setEncoding('utf8');
        upstream.on('data', (c) => { raw += c; });
        upstream.on('end', () => {
          if (upstream.statusCode !== 200) {
            /* 只回状态码与截断文本，不回完整 body（厂商错误 body 有时会回显请求内容，
               那等于把用户说的话外泄出去）。 */
            const err = new Error('大模型返回 HTTP ' + upstream.statusCode + '：' + raw.slice(0, 200));
            err.code = statusToCode(upstream.statusCode);
            return reject(err);
          }
          try {
            const parsed = JSON.parse(raw);
            const text = parsed.choices && parsed.choices[0] &&
              parsed.choices[0].message && parsed.choices[0].message.content;
            if (!text) {
              const e2 = new Error('大模型返回里没有可用文本：' + raw.slice(0, 200));
              e2.code = 'LLM_BAD_RESPONSE';
              return reject(e2);
            }
            return resolve(String(text).trim());
          } catch (err) {
            const e3 = new Error('大模型返回的不是 JSON：' + raw.slice(0, 200));
            e3.code = 'LLM_BAD_RESPONSE';
            reject(e3);
          }
        });
      }
    );

    req.setTimeout(LLM_TIMEOUT_MS, () => {
      req.destroy();
      const e = new Error('大模型没在 ' + (LLM_TIMEOUT_MS / 1000) + ' 秒内回应');
      e.code = 'LLM_TIMEOUT';
      reject(e);
    });

    req.on('error', (err) => {
      if (err.code === 'LLM_TIMEOUT') return reject(err);
      const e2 = new Error('连不上大模型：' + err.message);
      e2.code = 'LLM_UNREACHABLE';
      reject(e2);
    });

    req.write(payload);
    req.end();
  });
}

function statusToCode(httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return 'LLM_AUTH_FAILED';
  if (httpStatus === 429) return 'LLM_RATE_LIMITED';
  if (httpStatus === 402) return 'LLM_NO_CREDIT';
  return 'LLM_BAD_RESPONSE';
}

/* ---------- 提示词 ---------- */
/* ★★ Day 19 实测踩出来的重大设计错误（已修）
   原设计是「连原句都不给模型，只给 turn 编号」—— 理由是想彻底杜绝
   模型改写原句（硬约束 1）。**结果是模型无从判断**：

     实测输入：turn 3「We have some issues but I think it's ok.」（自相矛盾）
               turn 4「I really like the coffee machine」（明显偏题）
     实测输出：{"issues": [], "goodSentences": [{turn:1},{2},{3},{4},{6}]}
               ——矛盾句没抓、偏题句没抓，连偏题那句都被当成「精彩句子」夸了

   原因很直白：**判断的前提是看到内容**。只给「turn 1: [user spoke]」
   这样的空标签，模型无法知道说了什么，
   唯一可能的输出就是「既然没看出问题，那就都是好句子」。

   现在的做法（原句给它看，但产出前全部覆盖）：
     · 模型**能看见** userText—— 判断力回来了
     · 但它**只需回turn 编号**；即便它擅自多回一个 originalText，
       normalizeIssue 也**根本不看那个字段**，
       最终产出的 originalText 一律来自 byTurn（我们自己的 transcript）
     · 所以硬约束 1 仍然成立：**原句由后端说了算，模型碰不到产出路径**

   ★ 与契约 §4 原文的差异（契约写的是「模型碰不到原句字符串」）：
     现在是「模型看得到、但说不上来」。这是把约束从「输入侧封锁」
     改成「输出侧覆盖」—— 目标没变（用户看到的必须是他自己说过的话），
     但为了让判断真的能发生，必须这么改。契约 §4 已同步记录这个变更。 */
function systemPromptFor(isFree, topicInfo) {
  const lines = [
    'You are an English conversation coach reviewing a completed practice session.',
    'The user\'s own words are shown below, numbered by turn.',
    '',
    'Return ONLY a JSON object, no markdown fence, no explanation. Shape:',
    '{',
    '  "issues": [',
    '    { "turn": <number>, "type": "offtopic"|"logic", "reminder": "<Chinese, one short sentence>",',
    '      "correction": "<English rewrite, or null>" }',
    '  ],',
    '  "goodSentences": [ { "turn": <number> } ]',
    '}',
    ''
  ];

  lines.push('Hard rules:');
  lines.push('1. For each issue and each good sentence, cite ONLY the turn number.');
  lines.push('   Do NOT output the original sentence anywhere — just the number.');
  lines.push('2. "offtopic" = the speaker wandered away from the session\'s subject.');
  lines.push('3. "logic" = the speaker contradicted themselves within what they said,');
  lines.push('   or asserted something that undercuts their own point.');
  lines.push('4. For "offtopic", correction MUST be null. For "logic", correction MUST be');
  lines.push('   an English sentence that fixes the problem. Never null for logic.');
  lines.push('5. "reminder" must be in Chinese, one short sentence, telling the learner what to');
  lines.push('   notice. Be specific and factual, never scolding, never reassuring.');
  lines.push('6. "goodSentences" = turns where the speaker said something well. Cite turn numbers only.');
  lines.push('7. If nothing is wrong, return an empty "issues" array. Do NOT invent problems');
  lines.push('   to fill the array.');
  lines.push('');

  if (isFree) {
    lines.push(
      'This was a FREE conversation with no fixed subject. Therefore:',
      '  NEVER report an "offtopic" issue. There was no topic to wander away from.',
      '  Only report "logic" problems and "goodSentences".'
    );
  } else {
    const anchor = (topicInfo && topicInfo.anchor) ? topicInfo.anchor : '';
    if (anchor) {
      lines.push(
        'The session was about: ' + anchor,
        '  Judge "offtopic" against that subject only. Speaking about a different work',
        '  matter is still on topic; only genuinely unrelated content is off topic.'
      );
    }
    lines.push(
      'Small talk and clarifying questions are NOT off topic.',
      'Being vague or imprecise about facts is NOT off topic — reserve that for "logic".'
    );
  }

  return lines.join('\n');
}

/* 轮次文本：原句给模型看，但标清编号。
   ★ 只给**用户说的话**，不给 AI 说了什么 ——
     给了 AI 的话，模型会把「对方的回应」当成该判断的对象，
     而契约要判断的只有用户说的话。 */
function userPromptFor(turns) {
  const lines = ['Here are the turns the user spoke in:'];
  turns.forEach((t) => {
    lines.push('turn ' + t.turn + ': "' + t.userText + '"');
  });
  lines.push('');
  lines.push('Judge only these turns. Cite the turn numbers in your JSON.');
  return lines.join('\n');
}

function buildMessages(isFree, topicInfo, turns, retryHint) {
  const msgs = [
    { role: 'system', content: systemPromptFor(isFree, topicInfo) },
    { role: 'user', content: userPromptFor(turns) }
  ];
  /* 重试时把上一次的问题告诉模型，让它自己改格式。 */
  if (retryHint) {
    msgs.push({
      role: 'user',
      content: 'Your previous reply could not be used: ' + retryHint +
        '\n\nReply again with ONLY the JSON object, starting with { and ending with }.'
    });
  }
  return msgs;
}

/* ---------- 解析模型输出 ---------- */
/* 模型即使被要求只输出 JSON，也常带markdown 围栏、前后说明文字。
   这里的策略是「先找到第一个 { 到最后一个 }」，
   而不是逐层剥前缀 —— 后者遇到模型在JSON 前面写一段解释就失效了。 */
function extractJSON(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) {
    const e = new Error('输出里找不到 JSON 对象');
    e.hint = 'no braces found';
    throw e;
  }
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (err) {
    const e = new Error('JSON 解析失败：' + err.message);
    e.hint = 'invalid json';
    throw e;
  }
}

/* ---------- 服务端校验：三条硬约束在这里落地 ---------- */

/* 按 turn 编号取回原文。
   ★ 这是硬约束 1 的落地点，也是整个文件的核心。
   编号查不到 → 返回 null → 调用方丢弃该条目。
   **绝不退化成「让模型再写一遍」** —— 那样就等于把约束 1 打开了。 */
function pickOriginal(turnNo, byTurn) {
  const hit = byTurn[Number(turnNo)];
  return hit ? String(hit.userText || '').trim() : '';
}

/* 单条 issue 清洗。返回 null 表示这条该丢。 */
function normalizeIssue(raw, byTurn, isFree) {
  if (!raw || typeof raw !== 'object') return null;

  const type = String(raw.type || '').toLowerCase().trim();
  /* 契约只允许 offtopic / logic 两个值（§4 的 type 行）。
     模型偶尔会返回 "off_topic"（Day 14前端踩过这个坑）或 "off-topic"。
     这里做归一化而不是丢弃 —— 归一化后它就是一条正常的偏题条目。 */
  let t = type;
  if (t === 'off_topic' || t === 'off-topic' || t === 'off topic') t = 'offtopic';
  if (t === 'logical' || t === 'logic_error') t = 'logic';
  if (t !== 'offtopic' && t !== 'logic') return null;

  /* 硬约束 3 的后半：FREE 丢弃偏题。
     放这里而不是让模型自觉 —— 模型会漏，用户看到的判定就不一致。 */
  if (isFree && t === 'offtopic') return null;

  const original = pickOriginal(raw.turn, byTurn);
  /* 查不到编号、或该轮用户根本没说话 → 丢弃。
     这正是「模型碰不到原句」要的效果：它编不出一个能通过这道检查的 turn。 */
  if (!original) return null;

  /* ★ 硬约束 2：偏题的 correction 强制置null（B7：偏题只提醒、不给改法）。
     模型若给了改法也丢掉 —— 口径不由模型决定。 */
  let correction = null;
  if (t === 'logic') {
    const c = typeof raw.correction === 'string' ? raw.correction.trim() : '';
    /* logic 必须有改法（B7）。模型偷懒给空 → 丢掉这条。
       宁可少一条也不要出现「标着逻辑错误却没给改法」的条目。 */
    if (!c) return null;
    correction = c;
  }

  /* reminder 是中文短句，模型给空就退化成一句通用话而不是丢弃 ——
     提醒是给用户看的中文说明，缺了影响小；
     而 turn 与 type 是数据本身，缺了就该丢。 */
  const reminder = typeof raw.reminder === 'string' && raw.reminder.trim()
    ? raw.reminder.trim().slice(0, 120)
    : (t === 'offtopic' ? '这一句偏离了本次的主题。' : '这句话前后不太一致。');

  const turn = Number(raw.turn);
  return {
    type: t,
    turn: turn,
    /* ★ 原文来自 transcript，不是模型输出 */
    originalText: original.slice(0, 400),
    reminder: reminder,
    correction: correction
  };
}

function normalizeGood(raw, byTurn) {
  if (!raw || typeof raw !== 'object') return null;
  const original = pickOriginal(raw.turn, byTurn);
  if (!original) return null;
  return {
    turn: Number(raw.turn),
    originalText: original.slice(0, 400),
    /* 精彩句子的点评：模型只让回 turn，没让它写点评，
       这里按契约 §4 的形状给一个通用但不说谎的默认值。
       ★ 不让模型生成点评是刻意的：精彩句子的价值在于「用户自己说过这句」，
         模型再夸一遍是它说的，不是用户的收获。 */
    reminder: '这句说清楚了，值得保留。'
  };
}

/* ---------- 请求体解析 ---------- */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limitBytes) {
        tooLarge = true;
        raw = '';
      }
    });
    req.on('end', () => {
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

/* analyze 的 transcript 是整场，可以比 chat 大；
   但仍然有限 —— 一个恶意请求就能把内存吃满，也直接等于烧钱。 */
const MAX_BODY = 256 * 1024;

/* ---------- 主处理 ---------- */
async function handleAnalyze(req, res) {
  let body;
  try {
    body = await readBody(req, MAX_BODY);
  } catch (err) {
    return sendError(res, 400, err.code || 'INVALID_JSON', err.message);
  }

  const topicId = body.topicId;
  if (!topicId || typeof topicId !== 'string') {
    return sendError(res, 400, 'INVALID_PARAMS', '缺少 topicId（必须是 T1–T8 或 FREE）');
  }
  if (!Array.isArray(body.transcript)) {
    return sendError(res, 400, 'INVALID_PARAMS', 'transcript 必须是数组');
  }

  /* transcript 归一化：只留契约 §4 规定的两个字段，
     顺手把非法轮次剔掉（没编号、或不是对象）。
     ★ 这里做归一化还有个副作用：byTurn 的键来自**我们自己的** transcript，
       不是模型给的 —— 硬约束 1 的基础。 */
  const cleaned = [];
  body.transcript.forEach((t, idx) => {
    if (!t || typeof t !== 'object') return;
    const turn = Number(t.turn);
    if (!turn || turn < 1) return;
    cleaned.push({
      turn: turn,
      userText: typeof t.userText === 'string' ? t.userText.trim() : ''
    });
  });

  if (!cleaned.length) {
    /* 没有可判断的轮次不是错误 —— 一句话都没说就结束对话是合法的。
       走 empty 形状而不是报错，前端不用为「没说话」单独写一条分支。 */
    return sendJSON(res, 200, {
      ok: true,
      data: { issues: [], goodSentences: [], noIssueFound: true }
    });
  }

  /* 没有任何一轮用户说话 → 同上，无从判断。 */
  const spoken = cleaned.filter((t) => t.userText);
  if (!spoken.length) {
    return sendJSON(res, 200, {
      ok: true,
      data: { issues: [], goodSentences: [], noIssueFound: true }
    });
  }

  /* 超长截断：从最早开始丢（理由见MAX_TURNS 的注释）。 */
  const turns = (spoken.length > MAX_TURNS ? spoken.slice(-MAX_TURNS) : spoken);

  const byTurn = {};
  turns.forEach((t) => { byTurn[t.turn] = t; });

  const isFree = topicId === 'FREE';
  const topicInfo = {
    anchor: typeof body.anchor === 'string' ? body.anchor : ''
  };

  /*★ 到这里才查密钥 —— 上面所有早退路径都不需要密钥，
     不该被「没配好」拦住（理由见路由层的注释）。 */
  const missing = checkEnv();
  if (missing.length) {
    return sendError(res, 200, 'LLM_NOT_CONFIGURED',
      'AI 接口还没配置好（缺少环境变量：' + missing.join('、') + '）',
      { gotPath: '/api/analyze', missingEnv: missing });
  }

  /* ---------- 调模型（带一次重试）---------- */
  let parsed = null;
  let lastHint = '';
  let rawText = '';              /* 提出来供下面的 DEBUG 块用（原来在循环里是块作用域）*/
  for (let attempt = 0; attempt < 2; attempt++) {
    let attemptText;
    try {
      attemptText = await callLLM(buildMessages(isFree, topicInfo, turns, attempt === 0 ? '' : lastHint));
    } catch (err) {
      const code = err.code || 'LLM_ERROR';
      const msgMap = {
        LLM_TIMEOUT: 'AI 没有及时回应',
        LLM_AUTH_FAILED: 'AI 接口密钥无效或没配好',
        LLM_NO_CREDIT: 'AI 接口额度不足',
        LLM_RATE_LIMITED: 'AI 接口调用太频繁，稍后再试',
        LLM_UNREACHABLE: '连不上 AI 服务',
        LLM_BAD_RESPONSE: 'AI 返回的内容没法解析'
      };
      console.warn('[analyze] 调用失败 code=' + code + ' detail=' + String(err.message).slice(0, 200));
      const isClientErr = (code === 'INVALID_PARAMS' || code === 'INVALID_JSON' || code === 'PAYLOAD_TOO_LARGE');
      return sendError(res, isClientErr ? 400 : 200, code,
        msgMap[code] || 'AI 调用失败', { gotPath: '/api/analyze' });
    }

    try {
      parsed = extractJSON(attemptText);
      rawText = attemptText;
      break;
    } catch (err) {
      rawText = attemptText;
      lastHint = err.hint || 'invalid json';
      console.warn('[analyze] 第 ' + (attempt + 1) + ' 次输出无法解析：' + err.message.slice(0, 150));
    }
  }

  if (!parsed) {
    /* 两次都失败 → 判定为格式问题。这一轮对话的判断就此拿不到，
       前端会显示「这次没能整理出记录」——比给一份半真半假的强。 */
    return sendError(res, 200, 'LLM_BAD_FORMAT',
      '这次没能整理出记录，再试一次好吗', { gotPath: '/api/analyze' });
  }

  /* ---------- 落地三条硬约束 ---------- */
  /*★ 临时诊断开关（Day 19，验完必删）：把模型原始输出与被丢弃的条目带出来。
     为什么需要：首轮实测发现该报的没报（矛盾句与偏题句都漏了），
     但「响应为空」有两种相反的成因 ——
       ① 模型根本没报（提示词不管用）→ 要改提示词
       ② 模型报了但被 normalizeIssue 丢掉（校验太严）→ 要改校验
     不看原始输出就无法区分，而 `tcb fn log` 对 HTTP 函数查不到日志
     （Day 18 实测：返回 No invocation logs）→ 只能从响应里带出来。
     设 ANALYZE_DEBUG=1 时才生效，默认完全不影响生产响应。

     ★ 注意：开启后响应里会带出模型看到的原文，也就是**用户说过的话**。
       只在排查时临时开，绝不能长期留着。 */

  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues = [];
  for (let i = 0; i < rawIssues.length && issues.length < MAX_ISSUES; i++) {
    const it = normalizeIssue(rawIssues[i], byTurn, isFree);
    if (it) issues.push(it);
  }

  const rawGood = Array.isArray(parsed.goodSentences) ? parsed.goodSentences : [];
  const goodSentences = [];
  for (let i = 0; i < rawGood.length && goodSentences.length < MAX_GOOD; i++) {
    const it = normalizeGood(rawGood[i], byTurn);
    if (it) goodSentences.push(it);
  }

  /* 整场一句话都没说、或模型没给出任何东西 → noIssueFound=true（B10：界面显示
     「没发现问题」，**不硬凑条目**）。 */
  const noIssueFound = issues.length === 0;

  const resp = {
    ok: true,
    data: {
      issues: issues,
      goodSentences: goodSentences,
      noIssueFound: noIssueFound,
      model: LLM_MODEL
    }
  };

  /* 排错开关：DEBUG 模式下把模型原始输出挂到响应上。
     为什么走响应而不是日志：`tcb fn log` 对 HTTP 函数返回
     No invocation logs（Day 18 实测），拿不到。
     ★ 开这个开关等于把用户说过的话暴露到公网响应里 ——
       只在排查时临时开。日常保持关闭（Day 19 用完即关）。 */
  if (process.env.ANALYZE_DEBUG === '1') {
    resp.debug = {
      rawText: String(rawText).slice(0, 1200),
      parsedIssues: Array.isArray(parsed.issues) ? parsed.issues : null,
      parsedGood: Array.isArray(parsed.goodSentences) ? parsed.goodSentences : null,
      byTurnKeys: Object.keys(byTurn),
      rawIssuesCount: Array.isArray(parsed.issues) ? parsed.issues.length : -1
    };
  }

  sendJSON(res, 200, resp);
}

/* ---------- 路由 ---------- */
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const norm = path.replace(/\/+$/, '') || '/';

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 POST', { gotPath: path });
  }

  const isAnalyze = norm === '/api/analyze' || norm === '/analyze';
  if (!isAnalyze) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：POST /api/analyze',
      { gotPath: path });
  }

  /* ★★ 缺密钥检查放在**参数校验之后**，不与 chat 一致 —— Day 19 实测踩出来的。
     chat 先查密钥没有副作用：它的参数校验失败也是报「没配好」，用户看到后去配密钥，
     配完再点，自然就好了。
     analyze 不行：它有一条「空 transcript 直接返回 noIssueFound」的早退路径
     （用户一句话都没说就结束对话是合法的）。若密钥检查在前，
     这条路径会被拦下并报「没配好密钥」——
     用户明明只该看到「没发现问题」，却看到一个跟他操作无关的配置错误，
     而且**改前端也改不掉**（前端无从判断该不该报这个）。
     所以这里先让 handleAnalyze 校验参数、跑早退，快要调模型时才查密钥。 */

  handleAnalyze(req, res).catch((err) => {
    console.error('[analyze] 未捕获异常', err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    }
  });
});

server.listen(9000, '0.0.0.0', () => {
  const missing = checkEnv();
  console.log('[analyze] listening on 0.0.0.0:9000');
  console.log('[analyze] route: POST /api/analyze');
  console.log('[analyze] model=' + LLM_MODEL + '（Day 19 起实现）');
  console.log('[analyze] 硬约束：原文按 turn 取回 / 偏题 correction=null / FREE 丢弃偏题');
  console.log('[analyze] 密钥环境变量：' + (missing.length === 0
    ? '已配置 3 项'
    : '缺少 ' + missing.join('、') + '（不打印值）'));
});