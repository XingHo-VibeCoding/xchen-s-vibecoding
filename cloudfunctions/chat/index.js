/* POST /api/chat —— AI 对话实现（Day 18）
   -------------------------------------------------------------
   Day 17 这里只有一个返回 501 的骨架。今天把实现填进去，
   **架构不改动**：仍然不查库（契约 §9.8 第 1 条）、密钥只从环境变量读、
   端口固定 9000。三条约束是 Day 17 定的，今天照办。

   -------------------------------------------------------------
   一、模型调用：DeepSeek（OpenAI 兼容格式）
   -------------------------------------------------------------
   为什么接口层写成「OpenAI 兼容形状」而不是 DeepSeek 专属：
   换模型时只改环境变量（LLM_BASE_URL / LLM_MODEL），代码一行不用动。
   DeepSeek 的 endpoint 与字段名和 OpenAI 完全一致，所以直接按兼容格式写。

   本项目用的是最小可用集：只发 model / messages，
   不开temperature 之类 —— **即兴对话要的是稳定自然，不是花样**。

   -------------------------------------------------------------
   二、提示词：情感边界四层 + 轮型（Day 28 重写）
   -------------------------------------------------------------
   ★ 起因：用户反馈「AI 讲话很人机」。查下来至少有两条是我们自己造成的：
     ① 朗读用系统默认音色，代码里从没挑过（speech.js 全文没有 getVoices）；
     ② 原硬约束③「不无条件肯定」被写成了「一律不许鼓励」——
        比 PRD 严。PRD §6.1 原话是「不无条件肯定，**只针对内容本身回应**」，
        即：禁的是空泛表扬，不是禁共情。代码比 PRD 严，是这轮要修的病根之一。

   现在按「对谁说 / 说什么」拆成四层，**只有第 4 层是永禁**：

     ① 共情（对**处境**）—— 不限，且主动用
        "Oh no, that sounds rough." / "Ugh, two versions in one week."
        用户含糊或卡住时尤其该给：他要的是被接住，不是被考。
     ② 认可（对**内容**）—— 门控在「用户确实说清了」（!isVague）
        "Yeah, that's a fair point."
        ★ 它同时是**语言输入**：用户要能把这句搬去夸真人。
          所以必须「真人会说 + 有具体指向」——"Nice!" 学不到任何东西。
     ③ 看法（对**事**）—— 允许分歧，但必须带视角限定
        "I'd worry about the timeline." / "For me the second one's safer."
        禁第二人称判定："You're wrong." / "That doesn't make sense."
        ★ B9 没被推翻：B9 禁的是**评判用户**，不是「AI 不许有态度」。
          这两件事常被混成一件（见 docs/day27-反馈与优先级.md §6 第 4 条）。
     ④ 评价（对**语言 / 人**）—— 永禁
        "Good job." / "Your English is getting better." / "You explained that well."
        B9（PRD §9.2，四条一票否决之一）+ 会提前关掉练习动机（用户满足了就不练了）。

   甲、轮型：服务端强制，**不靠模型自觉**
     用户拍板：「追问不能连续出现两次」，两个追问之间至少隔一句表态。

     ★★ 计数单位是 **AI 台词序列**，不是「轮」——
        开场白（8 主题的 "So, what's the status?"）与沉默催促都是 AI 台词，
        但都发生在用户开口之前、不配任何一轮 →
        `transcriptTurns` 会跳过它们（frontend/pages/dialogue.html 那段注释
        写得很清楚「ai 在 pending 为空时直接跳过」）→ history 里根本没有它们。
        只看 history，服务端会以为「上轮没问」而放行追问，
        用户听到的却是连着两个问句 —— 正是要消除的那个现象。
        所以前端要额外带一条 lastAiLine（最近一条 AI 台词，不论是否配对），
        服务端用 buildAiSeq 拼成完整序列再数。

     ① 尾部连续问句 >= 2  → 本轮禁问号（**豁免也不给**，机会用完了）
     ② 尾部连续问句 == 1  → 默认禁问号；但 isVague(userText) 时豁免一次
        （PRD §6.1 要求「说得含糊必须追问」，硬禁会把这条机制打死；
          只豁免一次，正好覆盖「澄清通常要两步」：先问是什么，再问多具体）
     ③ 尾部连续问句 == 0  → 自由，倾向问

     词数分档：追问轮 <= 14 词；表态轮 <= 22 词。
     ★ 2026-10-26 从 12/18 放宽（用户拍板）：情绪轮要同时说「接住情绪 +
       一句站得住的话 + 自己的想法」，12 词里塞不下，硬塞就成模板句。
       放宽只给了表态轮与情绪轮；追问轮仍是短句（14 词），
       「手递话筒」这个性质没变。
     ★ 情绪轮：hasEmotion(userText) 为真时，turnRule 改成强制三成分
       （顺序不可换，见 turnRule）。纯事实陈述不触发 —— 每轮都鼓励会变成捧场。
     ★ 表态轮必须留「钩子」：复述一个具体细节，或给出自己的态度。
       只说 "Okay." 用户接不上；语音模式下沉默倒计时是关着的
       （dialogue.html 的 armSilence 开头就 return），接不上就真冷场。

   ★ 追问边界：8 主题只能在该主题的 anchor / followUps 范围内问，
     FREE 无此约束（F6 不判偏题，见 PRD §6.3）。
     这三份数据由**前端随请求带上**（今天新增的可选字段）：
     云函数读不到 frontend/data/topics.json，而把这份数据拷进云函数会造成两份、
     改了前端不同步。现在 topics.json 是唯一来源。

   -------------------------------------------------------------
   三、三类 kind 的判定（契约 §3）
   -------------------------------------------------------------
   normal    —— 用户说清楚了，接着往下聊/换一个角度
   follow_up —— 用户没说清，追问细节（带 followUpType）
   nudge     —— 用户沉默太久，催一句（契约 §3 的 silenceSeconds）

   ★ 判定交给模型，但**必须在服务端做合理性校验**（see deriveKind；Day 28 起
     干脆不再让模型报 kind —— 轮型是服务端算的，比模型的自我报告可靠）：
   模型偶尔会返回契约没列出的值，前端拿到会走进else 分支显示成奇怪的东西。
     ——「模型说什么都照单全收」是这类系统最常见的线上事故。
   -------------------------------------------------------------------- */

const http = require('http');
const https = require('https');

/* ---------- 配置 ---------- */
/* 密钥只从环境变量读，绝不写死在这里（TECH_DESIGN §9.1）。
   缺变量要在部署后第一次调用就被明确报出来，而不是让用户点开始对话才看到含糊报错。 */
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

/* 模型思考 + 网络往返的余量。契约 §3 的 LLM_TIMEOUT 对应这个值。
   云函数 timeout 是 60 秒，这里留足余量（60 > 55，留5 秒给冷启动与写响应）。 */
const LLM_TIMEOUT_MS = 55000;

/* 一次对话最多带多少轮历史。
   ★ 为什么限：prompt tokens 直接等于钱，且历史越长模型越容易"越说越套路"。
   只取最近 6 轮 —— 够维持口语连贯，又不给它"复述前文"的素材。 */
const MAX_HISTORY = 6;

/* ---------- 启动时自检 ---------- */
/* 只打印**有没有**，绝不打印值 —— 密钥进了日志就是事故。 */
function checkEnv() {
  const need = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
  return need.filter((k) => !process.env[k]);
}

/* ---------- HTTP 响应 ---------- */
/* ---------- 请求日志（Day 23 · 余力加练）---------- */
/*只记「时间 / 方法+路径 / 结果」三样，不记请求体。
 ★ 为什么不记请求体：body 里是用户的对话内容（还可能有个人信息），
   打进日志等于在云端留一份没脱敏的用户数据，而且日志保留期通常长得多。
   ★ 为什么加在 sendJSON 里而不是路由入口：
     sendJSON 是**所有响应的唯一出口**（成功走 sendOK、失败走 sendError，
     两条都汇到它）。改这一处五个函数各5 行就够；
     写在路由入口则每个return 分支都要记得写一次，漏一处就少一条日志 ——
     而「漏掉的那条」恰恰是出问题时最想看的那条。
   ★ 怎么拿到路径：Node 里 res.req 就是产生这个 res 的请求对象
     （标准别名，不用自己传 req 进来）。
     ★ 这样 sendJSON 的签名不用改 —— 改签名要动全部调用点，
       而调用点有二十几处（api-contract §4 里每条路由都可能提前 return）。 */
function logReq(res, httpStatus, body) {
  try {
    const req = res.req || {};
    /* 时间用本地格式而不是 ISO：
       ISO 的 'T' 和 'Z' 在 CloudBase 日志面板里不好读，
       而排查时最常做的是「上一条是几点」这种时间上相邻的对比。 */
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const method = req.method || '?';
    /* 只取路径段，丢掉 query —— query 里可能带 topicId / itemId，
       那属于业务数据，日志里没必要留（DAY23 安全要求：日志不记业务数据）。*/
    const path = (req.url || '?').split('?')[0];
    /* 结果只看「成功还是失败 + 错误码」，不打印 body.data ——
       那是接口的返回内容，可能是整份转写。 */
    const ok = body && body.ok === true;
    const code = ok ? 'ok' : ((body && body.error && body.error.code) || '?');
    console.log('[chat] ' + t + ' ' + method + ' ' + path +
      ' → ' + httpStatus + ' ' + code);
  } catch (e) {
    /*★ 日志失败绝不能影响请求：
       写日志是为了排错，不是业务的一部分。
       这行 catch 是为了「日志本身出异常时，用户的请求照样能返回」。 */
  }
}

/* ---------- HTTP 响应 ---------- */
function sendJSON(res, httpStatus, body) {
  logReq(res, httpStatus, body);
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

/* ---------- 调用大模型 ---------- */
/* 用 https 模块直接发，不引第三方 SDK。
   理由：本函数**只调一个 HTTP 接口、只用 POST+JSON**，
   引openai 官方 SDK 会带进一整包依赖（含它自己的重试与超时逻辑），
   而云函数部署包越小启动越快。40 行手写比 200 行依赖更可控。 */
function callLLM(messages) {
  return new Promise((resolve, reject) => {
    const base = new URL(LLM_BASE_URL);
    /* 兼容两种填法：只给域名（/v1 由这里补）或直接给全路径（含 /chat/completions）。
       DeepSeek 官方文档的 base_url 就是 https://api.deepseek.com，
       实际请求路径是 /chat/completions（兼容模式也收/v1/chat/completions）。 */
    let pathname = base.pathname && base.pathname !== '/' ? base.pathname : '/chat/completions';
    if (/\/chat\/completions$/.test(pathname)) {
      /* 填了完整路径，直接用 */
    } else if (/\/v1$/.test(pathname)) {
      pathname += '/chat/completions';
    } else if (pathname === '/chat/completions') {
      /* 默认值，原样 */
    } else {
      pathname = pathname.replace(/\/$/, '') + '/chat/completions';
    }

    const payload = JSON.stringify({
      model: LLM_MODEL,
      messages: messages,
      stream: false,
      /* ★ temperature 不设为 0：即兴对话需要一点变化，
         全锁死会重新变成"固定套路"。也不设高值——太高会跑偏、
         开始编造话题。0.7 左右是"自然但不失控"的区间。 */
      temperature: 0.7,
      max_tokens: 220          /* 一句对话回合不该超过这个量级 */
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
            /* ★ 只回**状态码与截断后的文本**，不回完整 body。
               厂商的错误 body 有时会把请求内容回显出来，透传等于把用户说的话外泄。 */
            const err = new Error('大模型返回 HTTP ' + upstream.statusCode + '：' + raw.slice(0, 200));
            err.code = statusToCode(upstream.statusCode);
            return reject(err);
          }
          try {
            const parsed = JSON.parse(raw);
            const text = parsed.choices && parsed.choices[0] &&
              parsed.choices[0].message && parsed.choices[0].message.content;
            if (!text) {
              const e2 = new Error('大模型返回里没有可用的文本：' + raw.slice(0, 200));
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

    /* 网络层错误统一归到 LLM_UNREACHABLE，
       区别于 LLM_BAD_RESPONSE（拿到响应但内容不对）——
       前者查网络/域名，后者查模型名/额度。 */
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
/* ---------- 提示词 ---------- */
/* ★ Day 28：FREE 的人设拼成一行。
   字段是 {who, job, fact}，全部可选 —— 缺了也能跑，只是 AI 没有身份。
   ★ 为什么标签用英文：这段是直接拼进英文 system 的，
     中文标签会让模型在英文句子里"换算"一次，容易走形。
   ★ 为什么只给三个标签：要给的是**立场**，不是**履历**。
     标签越多，模型越会每轮引用它（"as a designer I..."），
     既占词数又比不问更假。7 天内不需要一个完整的人生。 */
function personaLine(persona) {
  const p = (persona && typeof persona === 'object') ? persona : {};
  const parts = [p.who, p.job, p.fact]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.join(' / ');
}

/* 8 主题的「不迁就」取向：角色 + 追问边界。 */
function systemPromptFor(topic) {
  const isFree = !topic || !topic.topicId || topic.topicId === 'FREE';

  if (isFree) {
    /* ★ Day 28：FREE 有了人设（整场一个人、跨场轮换，前端挑并随请求带上）。
       没有身份时模型说 "I'd probably..." 是空的 —— 那个 "I" 没有东西可依，
       于是只能说 "I think it depends" 这种谁都能说的话，比不问更假。
       ★ 但人设只给「立场」，不给「履历」：见下面 "Never invent your own past"。
         原因是模型拿到背景就会疯狂消费它（每轮提猫、提通勤），
         既占掉词数，又比不问更假。 */
    const pl = personaLine(topic && topic.persona);
    return [
      'You are chatting with someone in a casual English conversation practice session.',
      '',
      'Who you are in this conversation:',
      '  ' + (pl || '(no fixed identity - stay neutral, do not invent one)'),
      'Stay this person for the whole session. Never mention that you are an AI.',
      '',
      'What you say:',
      '1. React to what they actually said - one specific detail, not a generic "interesting".',
      '   Reactions are always welcome: "Oh no, that sounds rough." "Ugh, that commute."',
      '2. Say what YOU think when you have a view. Always as a view, never as a verdict:',
      '   "I\'d hate that." / "For me, mornings are the worst."',
      '   Never: "You\'re wrong." / "That doesn\'t make sense." / "That\'s not right."',
      '3. If they said something clear and specific, you may acknowledge it:',
      '   "Yeah, that\'s a fair point." Keep it reusable - something a real person',
      '   could say to another real person. "Nice!" teaches them nothing.',
      '4. Ask when you genuinely need something, not as a reflex.',
      '',
      'What you must NOT do:',
      '- Never comment on their English. No "your English", "you explained that well",',
      '  "clearly", "good job", "well done". You are not a teacher.',
      '- Never invent your own past. You have no memories to draw on:',
      '  no "last week I...", "when I was in college...", "I used to...".',
      '  The identity above is all you are.',
      '- Do not simplify your vocabulary or dodge difficulty with easier synonyms.',
      '  They understand more than they can say; that gap is what they are practising.',
      '- Never finish their sentence. If they trail off, wait or ask.',
      '- If they go off topic, just follow wherever they went.',
      '- Reply in English only. Even if they switch to Chinese, stay in English.',
      '',
      'Vary your phrasing. Do not open two turns in a row with the same word',
      'or the same construction.'
      /* ★ Day 28：原来这里有一段 Turn length（含 "End with a question whenever you can"），
         已移出提示词 —— 它和「表态轮不许问」是直接冲突的两条，
         放在同一份 system 里模型只会挑自己爱听的那条执行。
         现在词数与问句由 buildMessages 按实际轮型追加一条 system 下发（见 turnRule）。 */
    ].join('\n') + OUTPUT_FORMAT;
  }

  /* 8 主题：角色扮演 + 严格的追问边界 */
  const role = topic.role || 'a colleague';
  const anchor = topic.anchor || '';
  const followUps = Array.isArray(topic.followUps) && topic.followUps.length
    ? topic.followUps.join(' / ')
    : '';

  const lines = [
    'You are role-playing as ' + role + ' in a workplace English conversation practice session.',
    '',
    'What you say:',
    '1. React to what they actually said - one specific detail, not a generic "interesting".',
    '   "Oh no, two versions in one week." / "Ugh, that sounds like a long day."',
    '2. Say what YOU think when you have a view. Always as a view, never as a verdict:',
    '   "I\'d worry about the timeline." / "Honestly, I\'d go with the second one."',
    '   Never: "You\'re wrong." / "That doesn\'t make sense." / "That\'s not right."',
    '3. If they said something clear and specific, you may acknowledge it:',
    '   "Yeah, that\'s a fair point." Keep it reusable - something a real colleague',
    '   could actually say to you later. "Nice!" teaches them nothing.',
    '4. Ask when you genuinely need something. You do not have to ask every turn.',
    '',
    'What you must NOT do:',
    '- Never judge whether they are off topic, and never correct their grammar or logic.',
    '  That is a separate system\'s job. Your job is only to keep the conversation going.',
    '- Never comment on their English: no "your English", "you explained that well",',
    '  "clearly", "good job". You are not a teacher.',
    '- Do not simplify your vocabulary, do not slow down, and do not use simpler',
    '  synonyms to dodge difficulty. They understand more than they can say;',
    '  that gap is exactly what they are practising.',
    '- Never finish their sentence. If they trail off, ask - do not complete it.',
    '- Stay strictly inside this topic\'s scope. Reply in English only.',
    '',
    'Vary your phrasing. Do not open two turns in a row with the same word',
    'or the same construction.'
    /* ★ Day 28：原第 4 条「Do not praise them unconditionally ... not a compliment」
       已并入上面第 1/3 条的四层边界 —— 那条的本意（禁空泛表扬）保住了，
       但它连带把「共情」也禁了，用户体感是"冷冰冰、只会追问"。
       ★ 原「Turn length / End with a question」整段移出：
         与「表态轮不许问」直接冲突，见 turnRule。 */
  ];

  if (anchor) {
    lines.push(
      'Topic context (for your own understanding - it tells you what you are probing for,',
      'you must NEVER mention it or point it out to the learner):',
      '  ' + anchor,
      ''
    );
  }
  if (followUps) {
    lines.push(
      'Your probing directions must stay within these (pick at most one per turn,',
      'rephrase them in your own words, never quote them):',
      '  ' + followUps,
      ''
    );
  }

  lines.push(
    'Naturalness:',
    '  React to what they actually said, not to a prepared script.',
    '  If they are vague or off-topic, press on the vagueness rather than changing',
    '  the subject yourself - unless this turn tells you not to ask.'
  );
  return lines.join('\n') + OUTPUT_FORMAT;
}

/* 沉默催促：单独一条 system，措辞与上面不同 —— 它要的是"把人拉回来"，
   不是"继续聊天"。混进systemPrompt 会让模型分不清。
   ★ Day 28：加 questionRun 参数。原因：催促本身也是一句「AI 开口」，
     如果上一句已经是问句，再用问句催他，就是连着两个问句 ——
     正是用户拍板要消除的那个现象。所以轮型在这里也要生效。 */
function nudgePrompt(topic, questionRun) {
  const isFree = !topic || !topic.topicId || topic.topicId === 'FREE';
  /* ★ Day 28：FREE 的第一句**就走这里**（静默 5 秒 AI 先开口，不是 open 路径），
     所以人设必须带上 —— 否则第一句是「没有身份的人」说的，
     从第二句起突然有了身份，用户一眼就看出是两个人。 */
  const pl = isFree ? personaLine(topic && topic.persona) : '';

  const invite = Number(questionRun) >= 1
    ? [
        'Do NOT ask a question this time - you already asked one.',
        'Say something that keeps the door open instead: a short encouraging remark,',
        'a small piece of your own thought, or "Take your time". No question mark.'
      ].join('\n  ')
    : 'Say one short natural question or invitation to get them talking again.';

  return isFree
    ? [
        pl ? 'You are: ' + pl : 'You are the other person in this conversation.',
        'They have gone quiet. Say something natural to get them talking again.',
        invite,
        'One short English sentence. Do not comment on the silence itself in a formal way,',
        'do not say "you have been quiet". Reply in English only.'
      ].join('\n') + OUTPUT_FORMAT
    : [
        'You are role-playing as ' + (topic.role || 'a colleague') + '.',
        'The learner has gone quiet. Nudge them to speak, in character, naturally.',
        invite,
        'One short English sentence. Do not lecture them about the silence.',
        'Stay inside the topic. Reply in English only.'
      ].join('\n') + OUTPUT_FORMAT;
}

/* ---------- 组装 messages ---------- */
/* ★ Day 28：轮型判定收拢到 decideTurn **一处**，buildMessages 只消费结果。

   ★ 为什么必须收拢：同一条判据（这一轮能不能问）现在有两个用途 ——
     ① 写进提示词（turnRule）；② 决定回给前端的 kind（deriveKind）。
     如果两处各算一遍，条件改一处就会分叉，而分叉的表现是
     "AI 明明没问，却回报 follow_up" 这种没人会去查的静默错误。

   ★ 参数 turn 由调用方（handleChat）算好传进来：
     { run, vague, blocked }。沉默路径也用 turn.run —— 催促本身
     也是一句 AI 开口，上一句是问句时不能再用问句催。 */
function buildMessages(topic, history, userText, silenceSeconds, turn) {
  /* 只带最近 MAX_HISTORY 轮：prompt tokens 直接等于钱，
     且历史越长模型越容易"越说越套路"。 */
  const recent = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY);
  const t = turn || { run: 0, vague: isVague(userText), blocked: false };

  /* 沉默催促：history 里没有本轮发言，走独立提示词。 */
  if (silenceSeconds > 0) {
    return [
      { role: 'system', content: nudgePrompt(topic, t.run) },
      /* 带最近几轮让它知道在聊什么，但用 summary 角色说明"这些是背景"，
         避免模型把对话当成自己的发言记录来续写。 */
      { role: 'user', content: '(The conversation so far: ' + summarizeHistory(history) + ')' }
    ];
  }

  const msgs = [{ role: 'system', content: systemPromptFor(topic) }];

  recent.forEach((h) => {
    if (h && typeof h.userText === 'string' && h.userText) {
      msgs.push({ role: 'user', content: h.userText });
    }
    if (h && typeof h.aiText === 'string' && h.aiText) {
      msgs.push({ role: 'assistant', content: h.aiText });
    }
  });

  /* ★★ Day 28：把「本轮能不能问」和「能说多长」合成**一条** system 下发。
     为什么合成一条而不是两条：两条会互相打架 ——
     一条说「说得含糊就追问」，另一条说「本轮不许问」，
     模型只会挑自己爱听的那条执行（Day 27 那次 `No JSON` 挡住格式要求，
     就是"两条指令打架、权重高的赢"的现成例子）。

     ★ 这里取代了 Day 23 的那段「上一轮他说得含糊 → 追问一下」：
       含糊不再是独立条件，而是轮型判定里的**豁免项**（见 turnRule）。 */
  msgs.push({ role: 'system', content: turnRule(t.run, t.vague, t.emotion) });

  /* ★★ Day 27：这一行原来是「(Reply with ONE short spoken English sentence only.
     No JSON, no quotes, no explanation.)」—— Day 23 加它是为了防模型把 JSON 或引号
     漏到界面上。
     但今天反过来要求它返回 JSON（一句话 + 中文），这条就成了**唯一的挡路石**：
     它挂在 user 消息里、是模型读到的最后一句，权重比 system 末尾的格式说明还高。
     实测两次：aiText 都只有纯英文、aiTextZh 为空 —— 模型完全没理会 JSON 要求。
     现在改成指向 system 里的格式定义，并明确 en / zh 各是什么。 */
  msgs.push({
    role: 'user',
    content: userText +
      '\n\n(Reply as the JSON object defined in the system prompt: ' +
      '"en" = one short spoken English sentence, "zh" = its plain Chinese translation.)'
  });

  return msgs;
}

/* ---------- Day 28：轮型 ---------- */

/* AI 台词序列：history 里所有 aiText（按时间序）+ 末尾补一条 lastAiLine。
   ★ 为什么需要 lastAiLine：开场白（8 主题的 "So, what's the status?"）
     与沉默催促都发生在用户开口之前，没有配对的用户发言 →
     transcriptTurns 会把它们跳过（frontend/pages/dialogue.html 里那段注释
     写得很清楚：「ai 在 pending 为空时直接跳过 —— 没有对应的用户发言，
     它不是任何一轮的回应」）→ history 里根本没有它们。
     只看 history，服务端会以为"上轮没问"从而放行追问，
     用户听到的却是连着两个问句。
   ★ 去重：正常一轮之后 lastAiLine 必然等于 history 最后一条 aiText，
     相同就不重复追加，否则一次问句会被数成两条。 */
function buildAiSeq(history, lastAiLine) {
  const seq = [];
  (Array.isArray(history) ? history : []).forEach((h) => {
    if (h && typeof h.aiText === 'string' && h.aiText.trim()) seq.push(h.aiText.trim());
  });
  const tail = String(lastAiLine || '').trim();
  if (tail && seq[seq.length - 1] !== tail) seq.push(tail);
  return seq;
}

/* 是否以问号结尾。
   ★ 允许问号后面跟闭引号/括号：模型常把整句包在引号里（"What kind?"），
     只判最后一个字符会漏掉这一类。 */
function endsWithQuestion(text) {
  return /\?["'”’)\]]*\s*$/.test(String(text || '').trim());
}

/* 末尾连续问句的条数：从后往前数，遇到第一句非问句就停。
   ★ 用户拍板的口径是「追问不能连续出现两次」，所以真正要看的是
     **连了几个**，而不是「上一句是不是问句」—— 后者数不出连问两层。 */
function trailingQuestionRun(aiSeq) {
  let n = 0;
  const arr = Array.isArray(aiSeq) ? aiSeq : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!endsWithQuestion(arr[i])) break;
    n++;
  }
  return n;
}

/* 本轮指令：问不问 + 多长。三种形态，**互斥**，一次只下发一条。
     run >= 2      连问上限已用完 → 强制表态，豁免也不给
     run == 1      默认表态；isVague 时豁免一次（PRD §6.1 要求含糊必须追问）
     run == 0      自由，倾向追问

   ★ 表态轮为什么必须点明「不许有问号」而不是只说「别问」：
     模型会把「别问太多」理解成「问一个就好」，实测里这种指令基本无效。
     用可机械检查的形式（不许出现 ?）它才真的不写问号。
   ★ 表态轮为什么要「钩子」：只说 "Okay." 用户接不上；
     而语音模式下沉默倒计时是关着的（armSilence 开头就 return），
     接不上就真冷场，没有催促兜底。 */
function turnRule(questionRun, vague, emotion) {
  const run = Number(questionRun) || 0;
  const blocked = run >= 2 || (run === 1 && !vague);

  /* ★ 2026-10-26：情绪轮的固定三成分，顺序不可换。
     用户要求的原话是「既要有他的想法，也要有特定语境下对用户负面情绪的鼓励」——
     三者缺一都不成立：只有鼓励是无脑捧场，只有想法是冷冰冰，
     只有共情是没有内容。
     ★ 第一行只写「三部分、按这个顺序」，不复述「他听起来很累」——
       各分支的引导句已经说过一次，重复一遍模型容易把开头写两遍。 */
  const WARM = [
    'Three parts, in this order:',
    '1. Name the specific strain they just showed, using their own detail.',
    '   Not "I understand", not "I know how you feel".',
    '2. One line that holds up: "I\'d feel the same." / "That would wear anyone down."',
    '   It is a shared reaction, not a grade. Never "great job", "well done",',
    '   "you\'re doing great", "don\'t worry", "cheer up".',
    '3. Then your own view, as a view: "I\'d still raise it early." / "I\'d say it\'s worth it."'
  ].join('\n');

  /* ★ 2026-10-26：格式提醒补在**每一条**轮型指令的末尾。
     原因见 chat 与 8 主题两条 system 末尾的 OUTPUT_FORMAT —— 那条 system 排在最前面，
     而这条 turnRule 是模型读到的最后一条 system（紧挨用户发言），
     它整段都是内容指令、不提格式，模型偶尔就整轮忘了包 JSON。
     不重复整段 OUTPUT_FORMAT（两条格式说明会互相稀释），只指回去。 */
  const FORMAT_NOTE = 'Format: the same {"en","zh"} JSON object as defined above.';

  if (blocked) {
    return [
      'THIS TURN: do not ask anything. There must be no question mark at all.',
      emotion ? WARM : [
        'React instead - either pick one specific detail they just said and respond to it,',
        'or state your own view on it.'
      ].join('\n'),
      'Under 22 words. One sentence, or two very short ones.',
      'Leave them something to pick up: the detail you echoed, or a view they can push back on.',
      FORMAT_NOTE
    ].join('\n');
  }

  /* 情绪优先于含糊：含糊也可能是「说不出来就是因为累」，
     这时逼他澄清细节，比先接住情绪更不近人情。 */
  if (emotion) {
    return [
      'THIS TURN: they sound worn down - answer that before anything else.',
      WARM,
      'You may end with one short question if it comes naturally - it is optional,',
      'and there must be at most one question mark.',
      'Under 22 words.',
      FORMAT_NOTE
    ].join('\n');
  }

  if (vague) {
    return [
      'THIS TURN: their answer was too short or too vague to build on.',
      'Ask ONE very small, very concrete question - a single word answer would be enough.',
      'Do not ask a second question. Do not restate what they said.',
      'Under 14 words.',
      FORMAT_NOTE
    ].join('\n');
  }

  return [
    'THIS TURN: under 14 words. One question, and let it be the last thing you say.',
    'Ask the smallest thing you are still unsure about - not everything.',
    FORMAT_NOTE
  ].join('\n');
}

/* 轮型判定的**唯一入口**。返回 { run, vague, blocked }：
     run     —— 尾部已连了几个问句
     vague   —— 用户这句是否撑不起追问
     blocked —— 本轮是否禁止问号

   ★ blocked 的优先级要说清（用户拍板的口径）：
     ① run >= 2：连问上限已经用完，**即使含糊也不豁免** ——
        否则一直含糊就能一直连问，退回 Day 23 那个
        「连问两层 → 答不上来 → 更沉默 → 被催」的死循环。
     ② run == 1 且含糊：豁免一次。PRD §6.1 要求「说得含糊必须追问」，
        硬禁会把这条核心机制打死；只豁免一次，正好覆盖
        「澄清通常要两步」（先问是什么，再问多具体）。
     ③ 其余：允许问。 */
function decideTurn(history, userText, lastAiLine) {
  const recent = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY);
  const aiSeq = buildAiSeq(recent, lastAiLine);
  const run = trailingQuestionRun(aiSeq);
  const vague = isVague(userText);
  const emotion = hasEmotion(userText);
  const blocked = run >= 2 || (run === 1 && !vague);
  return { run: run, vague: vague, emotion: emotion, blocked: blocked };
}

/* 回给前端的 kind（契约 §3：normal / follow_up / nudge）。

   ★★ Day 28 重写。原实现 pickKind(raw, userText) 是从**模型返回的纯文本**里
      找 "normal" / "follow_up" 这两个词。但 Day 27 之后模型回的是
      `{"en":"...","zh":"..."}` —— 开头永远是 `{`，
      所以 `^\s*normal` 和 `^\s*nudge` 永远匹配不到、`follow_up` 只能靠
      撞巧出现在正文里。整段判据实际上是死代码，
      kind 一直在走最后的「按长度兜底」，等于没判。

      现在改成**由轮型推出**：我们自己知道这一轮有没有问、用户是不是含糊，
      不需要再问模型一遍。少一次猜测，也不会两处判据分叉。

   ★ 口径：AI 只表态不问 → normal（正常接话，没追问）；
           用户含糊但被豁免允许追问 → follow_up（带类型）；
           用户说清了、AI 追问了 → normal（不是「因为你说得不清楚」才问的）。 */
function deriveKind(turn, userText) {
  const t = turn || {};
  /* ★ 用户还没开口（8 主题开场白 kind="open"）：没有「他说得含糊」这回事。
     不加这一条的话 isVague('') 返回真 → 开场白会被标成 follow_up/too_short，
     而那句话明明是 AI 自己开的话题。实测（Day 28）踩到过。 */
  if (!String(userText || '').trim()) return 'normal';
  if (t.blocked) return 'normal';
  if (!t.vague) return 'normal';

  /* too_short 与 vague 的区分沿用原判据的边界（3 词以内算太短），
     只是搬到这里，让 followUpType 与契约 §3 的枚举对得上。
     （incomplete「说到一半停住」没被回传：模型不再报告它，
       而 isVague 也判不出「句子没说完」，硬猜会误报。） */
  const words = String(userText || '').trim().split(/\s+/).filter(Boolean);
  return { kind: 'follow_up', followUpType: words.length <= 3 ? 'too_short' : 'vague' };
}

/* 「这句话含糊到撑不起下一轮」的判据。
   ★ 为什么阈值定 4 个词：目标用户 CEFR A2–B2，真实口语里
     "Yeah, I think so." 就是 4 个词，但那确实撑不起追问 ——
     它没有任何具体内容。
   ★ 为什么要单独处理中文（Day 23 单测实测踩到）：
     中文没有空格，按 `\s+` 分词只有「一项」，
     于是任何中文句子都被判成 ≤4 词 = 含糊 —— 明显错。
     用户切中文聊两句很常见（提示词第6 条就是为此写的），
     判据不能只对英文成立。用**字符数**兜住这个case。 */
const FILLER_WORDS = /^(uh|um|erm|ah|well|so|yeah|yes|no|maybe|ok|okay|not sure|idk|i guess|whatever|sure)\b[,.\s]*$/i;
function isVague(text) {
  const s = String(text || '').trim();
  if (!s) return true;

  /* 中日韩文本按字符数判（没有词边界的概念）。
     阈值取 8 个字符：低于这个长度撑不起一个追问，
     高于就有具体信息（"我觉得应该先做完前两个功能"= 14 字）。 */
  if (/[一-鿿぀-ヿ]/.test(s)) {
    return s.length <= 8;
  }

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true;
  /* 长度够但全是 "yeah... okay" 这种 —— 一句话里没有任何实词，
     同样撑不起追问。用比例判：超过一半是填充词就算含糊。 */
  const fillers = words.filter((w) => FILLER_WORDS.test(w.toLowerCase())).length;
  return fillers / words.length > 0.5;
}

/* 「这句话里有负面情绪」的判据（2026-10-26 · 用户要求「多带鼓励」）。
   turnRule 靠它决定这一轮要不要走「接住情绪 + 站得住的话 + 自己的想法」三成分。

   ★ 为什么用关键词表，而不是让模型自己判要不要鼓励：
     模型判这个会飘 —— 同一句话两次结果不同；而且它倾向**每轮都夸**，
     那就成了捧场。纯函数判，行为可测、可复现、可回放。
   ★ 为什么宁可多报也不要漏：
     用户的原话是「特定语境下对用户负面情绪的鼓励」——
     漏掉情绪等于这次改动没做；多鼓励一次只是稍微热络，用户不会觉得假。
   ★ 但要排掉「假阴性反转」：
     "It's not that hard." / "I'm not tired." 不是负面情绪，
     所以看命中词前面 18 个字符里有没有否定词。
   ★ 已知边界（写在这里，免得以后当 bug 修）：
     - "not sure I can do it" → 命中 not sure ✓
     - "It's not the first time it's been hard." → 否定词离 "hard" 太远，
       会误报。接受：多给一次鼓励，比漏掉真实情绪便宜。 */
const EMOTION_WORDS = /\b(tired|exhausted|drained|worn out|worn down|long day|slammed|swamped|busy week|nervous|anxious|worried|worry|stressed|stress|pressure|scared|afraid|panic|overwhelmed|struggling|struggle|stuck|behind|failing|failed|a mess|hard|tough|difficult|impossible|hopeless|sick of|fed up|give up|whatever|not sure|no idea|don'?t know|can'?t|couldn'?t)\b/i;

const NEGATION_BEFORE = /\b(not|never|isn'?t|wasn'?t|aren'?t|don'?t|doesn'?t|didn'?t)\b(\s+\w+){0,2}\s*$/i;

function hasEmotion(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  /* ★ 必须逐个命中词检查，不能只看第一个：
     "I'm not stressed, but it's hard." 的第一个命中（stressed）被否定排除，
     但后面还有真的情绪（hard）。只看第一个就会把整句判成"没情绪"。 */
  const re = new RegExp(EMOTION_WORDS.source, 'gi');
  let m;
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(Math.max(0, m.index - 18), m.index);
    if (!NEGATION_BEFORE.test(before)) return true;
    if (m.index === re.lastIndex) re.lastIndex++;   // 防零宽匹配死循环
  }
  return false;
}

function summarizeHistory(history) {
  const recent = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY);
  if (!recent.length) return '(nothing yet)';
  return recent
    .map((h) => (h && h.userText ? h.userText : ''))
    .filter(Boolean)
    .join(' / ') || '(nothing yet)';
}

/* ---------- 服务端校验模型输出 ---------- */
/* ★ Day 28：原 pickKind(raw, userText) 已删除，改为 deriveKind(turn, userText)
   （见上面「轮型」一节）。删它的理由不是它写错了，而是**它的输入已经不存在了** ——
   Day 27 起模型回的是 JSON，不再是 "normal / follow_up" 这种纯文本标签。
   留着它会一直匹配不到，而"看起来在工作、其实永远走兜底"是最难发现的一类问题。 */

/* 把超过上限的回复截到**最后一个完整的句子**上。
   ★ 为什么按句子边界而不是按字符（Day 23）：
     直接 slice 会切出半句话，页面上出现 "So what I'm thinking is that we…"
     —— 用户读到的是一句没说完的话。加语音之后朗读半句还会显得卡住。
   ★ 为什么留一句而不是全丢：
     模型偶尔真的写长（不听指令时），全丢会让这一轮空着。
     留最长的那个完整句子，至少是一句能读的话。
   ★ 为什么末尾标成中文的「…」：它表明「后面还有，被截了」，
     和英文原文不冲突（清理包装时只剥引号和星号，不动这个）。 */
function clampToSentence(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  /* 找最后一个「句号/问号/叹号 + 可选闭引号」的位置。
     ★ 为什么 `\s` 改成可选（Day 23 实测踩到）：
       原来要求「标点 + 空格」，但maxChars 常常正好切在句号**之后**
       —— 那时句号本身落在截断之外，正则匹配不到，
       整段就退化成硬截，页面上又出现半句话（实测复现）。
       标点后有没有空格对「这是不是句子边界」没有意义。
     ★ 为什么是**最后**一个边界而不是第一个：
       取最后一个才能在上限内尽量多保留内容；
       再由调用处的长度上限兜住，不会失控。 */
  const head = s.slice(0, maxChars + 1);
  let cut = -1;
  for (let p = 0; p < head.length; p++) {
    const c = head[p];
    if (c === '.' || c === '?' || c === '!') {
      // 吃掉紧跟的闭引号/括号（"..." / '...' / ...!）
      let q = p + 1;
      while (q < head.length && /["')\]]/.test(head[q])) q++;
      /* ★ 只有后面**还有内容**时才把它当边界。
         若它就是最后一个字符（后面被切掉了），保留它更完整 ——
         「留最长的完整句」比「切在句号前」好。 */
      cut = q;
    }
  }
  if (cut <= 0) return s.slice(0, maxChars).trim() + '…';
  return s.slice(0, cut).trim() + '…';
}

/* 把模型可能带出来的包装剥掉：引号、markdown 强调、常见前缀。
   ★ 模型即使被要求"只回一句话"，也常回 "AI: xxx" 或带 ** 的。 */
function cleanAiText(s) {
  return String(s || '')
    .replace(/^\s*(AI|Assistant|ai|assistant)\s*[:：]\s*/, '')
    .replace(/^[\s"'“”‘’`*_]+/, '')
    .replace(/[\s"'“”‘’`*_]+$/, '')
    .replace(/^\s*\*\*(.+?)\*\*\s*$/, '$1')
    .trim();
}

/* ---------- Day 27：输出格式（一句话 + 中文） ----------
   用户反馈「AI 说的句子有单词和句子看不懂」。AI 的台词是**每次现场生成**的，
   前端查表覆盖不了 → 只能让模型自己把中文一起给出来。
   ★ 只追加"输出格式"这一段，上面那些硬约束（不评判 / 不简化 / ≤12 词 / 问句结尾）
     一个字不动 —— 它们的优先级高于格式。 */
const OUTPUT_FORMAT = [
  '',
  'Output format (packaging only — it does not relax any rule above):',
  'The rule "Reply in English only" applies to the VALUE of "en", not to this JSON wrapper.',
  'Return exactly one JSON object, with nothing before or after it:',
  '{"en":"<the English sentence the learner hears>","zh":"<its plain Chinese translation>"}',
  '- "en": English only. It still obeys the length limit, the style,',
  '  and whatever THIS TURN tells you about asking a question.',
  '  (Some turns ask for one question; some forbid any question mark. Follow this turn.)',
  '- "zh": REQUIRED and never empty. Plain colloquial Chinese, same length as "en".',
  '  No pinyin, no explanation, no notes.',
  'Do not answer with bare English text. Do not wrap the JSON in a markdown code fence.'
].join('\n');

/* ---------- 解析模型返回（Day 27 新增） ----------
   ★ 解析失败**不报错**：整段当英文用，中文留空。
     理由：格式没守住的后果应该是「少一行中文」，
     绝不能是「这场对话断了」——chat 挂掉比没有翻译严重得多。 */
function parseReply(raw) {
  const s = String(raw || '').trim();
  if (!s) return { en: '', zh: '', fellBack: true };

  let body = s;
  /* 模型有时会包一层 ```json 围栏 */
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  /* 找最外层 {...}：前后可能还带一句客套话 */
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(body.slice(start, end + 1));
      if (o && typeof o.en === 'string' && o.en.trim()) {
        return {
          en: o.en.trim(),
          zh: (typeof o.zh === 'string') ? o.zh.trim() : '',
          /* ★ 2026-10-26：fellBack 用来区分「解析失败」与「解析成功但模型没给 zh」。
             这两种都会让卡片背面显示「这句没拿到译文」，但修法完全不同 ——
             前者是格式约束不够，后者是 zh 字段被模型漏写。日志靠它定位。 */
          fellBack: false
        };
      }
    } catch (e) { /* 落到下面的兜底 */ }
  }
  return { en: s, zh: '', fellBack: true };
}

/* ---------- 请求体解析 ---------- */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (c) => {
      raw += c;
      /* 上限保护：history 是用户会话，理论上能被人为塞很大。
         限制住，否则一个恶意请求就能把内存吃满（也直接等于烧钱）。 */
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

const MAX_BODY = 64 * 1024;   // 64KB：6 轮对话 + 主题约束远远够用

/* ---------- 主处理 ---------- */
async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req, MAX_BODY);
  } catch (err) {
    return sendError(res, 400, err.code || 'INVALID_JSON', err.message);
  }

  /* 参数校验（契约 §3 的必填项）。
     ★ Day 18 实测发现的一处契约错配，已在此修正**：
       契约把 userText 标成「必填」，但**8主题的开场白**（AI 一进对话就开口）
       与**沉默催促**（用户一直没说话）这两种请求，用户根本还没开口——
       userText 天然是空的。若按契约硬校验，这两种请求会全部报INVALID_PARAMS，
       页面上一进对话就降级（实测HTTP_400）。
       所以校验改成：**只有「回应用户发言」这一种场景才要求 userText**，
       判定依据是 silenceSeconds（>0 即沉默场景）。
       契约 §3 的「必填」标注也要跟着改，这条已记在待办里。 */
  const topicId = body.topicId;
  if (!topicId || typeof topicId !== 'string') {
    return sendError(res, 400, 'INVALID_PARAMS', '缺少 topicId（必须是 T1–T8 或 FREE）');
  }
  if (body.history !== undefined && !Array.isArray(body.history)) {
    return sendError(res, 400, 'INVALID_PARAMS', 'history 必须是数组');
  }

  const silenceSeconds = Number(body.silenceSeconds) || 0;
  /* 开场白（open）也属于「用户还没开口」：
     8 主题一进对话对方就先说，前端此时传的是 {kind:'open'} 而没有 userText。
     用needsUserText 同时挡掉这两种情况。 */
  const needsUserText = silenceSeconds <= 0 && body.kind !== 'open';
  if (needsUserText && (typeof body.userText !== 'string' || !body.userText.trim())) {
    return sendError(res, 400, 'INVALID_PARAMS',
      '缺少 userText（用户本轮说的话）');
  }

  /* ★ 话题约束数据由前端带上来（今天新增的可选字段）。
     云函数读不到 frontend/data/topics.json，所以 topic.role / anchor / followUps
     由前端从那份唯一的来源读出后随请求带上。
     没有它也能跑（退化成"没有边界的泛聊"），但追问会跑到主题外——
     所以前端接的时候必须带上，这里只做提示不硬失败。 */
  const topic = {
    topicId: topicId,
    role: typeof body.role === 'string' ? body.role : '',
    anchor: typeof body.anchor === 'string' ? body.anchor : '',
    followUps: Array.isArray(body.followUps) ? body.followUps : [],
    /* ★ Day 28：FREE 的人设。**整场一个人、跨场轮换**，由前端从
       topics.json 的人设池里挑好、每轮随请求带上（云函数无状态，
       它自己随机的话，一场对话里会换好几次人）。
       这里只做字段裁剪，不做校验 —— 缺了就是「没有身份」，不报错。 */
    persona: (body.persona && typeof body.persona === 'object') ? {
      who: typeof body.persona.who === 'string' ? body.persona.who : '',
      job: typeof body.persona.job === 'string' ? body.persona.job : '',
      fact: typeof body.persona.fact === 'string' ? body.persona.fact : ''
    } : null
  };

  /* silenceSeconds 已在上面的参数校验里声明，这里不重复声明。
     （重复 const 声明在严格模式下是 SyntaxError —— Day 18 踩过一次） */
  const userText = String(body.userText || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];
  /* ★ Day 28：最近一条 AI 台词，可能不属于任何一轮（开场白 / 沉默催促）。
     不带它，「不许连问」就数不准，见 buildAiSeq。 */
  const lastAiLine = typeof body.lastAiLine === 'string' ? body.lastAiLine : '';

  /* ★ Day 28：轮型只算一次，两处消费（提示词 turnRule / 回给前端的 kind）。
     分开算会让两个判据慢慢分叉，而分叉的表现是静默的（见 decideTurn 注释）。 */
  const turn = decideTurn(history, userText, lastAiLine);

  const messages = buildMessages(topic, history, userText, silenceSeconds, turn);

  let raw;
  try {
    raw = await callLLM(messages);
  } catch (err) {
    /* ★ 厂商错误详情（原始 body、请求内容）不进响应体，
       只回错误码与一句话说明。排错靠 error.code，不靠泄露。 */
    const code = err.code || 'LLM_ERROR';
    const msgMap = {
      LLM_TIMEOUT: 'AI 没有及时回应',
      LLM_AUTH_FAILED: 'AI 接口密钥无效或没配好',
      LLM_NO_CREDIT: 'AI 接口额度不足',
      LLM_RATE_LIMITED: 'AI 接口调用太频繁，稍后再试',
      LLM_UNREACHABLE: '连不上 AI 服务',
      LLM_BAD_RESPONSE: 'AI 返回的内容没法解析'
    };
    /* HTTP 状态按契约：业务错误仍走 200 + ok:false（§1.2），
       只有「请求本身不合法」才用 4xx —— 前端处理逻辑才有一份。 */
    const isClientErr = (code === 'INVALID_PARAMS' || code === 'INVALID_JSON' || code === 'PAYLOAD_TOO_LARGE');
    console.warn('[chat] 调用失败 code=' + code + ' detail=' + String(err.message).slice(0, 200));
    return sendError(res, isClientErr ? 400 : 200, code,
      msgMap[code] || 'AI 调用失败', { gotPath: '/api/chat' });
  }

  /* Day 27：先按 JSON 解析（en + zh）；解析不出来就整段当英文（见 parseReply） */
  const parsed = parseReply(raw);
  const aiText = cleanAiText(parsed.en);
  /* 中文只用于展示，给个上限：模型偶尔会把整段解释塞进 zh */
  const aiTextZh = String(parsed.zh || '').trim().slice(0, 200);

  /* ★ 2026-10-26：缺译文时留一条现场证据。
     用户实测遇到过「卡片背面显示这句没拿到译文」，但我压测 47 次一次没复现，
     光靠猜分不清是「模型没包 JSON」还是「包了但漏了 zh」。
     这行日志只在缺译文时打，正常请求不产生日志噪音。
     raw 只截 400 字符，模型输出里没有密钥，进了云函数日志也不会泄露用户数据。 */
  if (!aiTextZh) {
    console.warn('[chat][zh-missing] fellBack=' + parsed.fellBack +
      ' en=' + JSON.stringify(String(aiText || '').slice(0, 120)) +
      ' raw=' + JSON.stringify(String(raw || '').slice(0, 400)));
  }
  if (!aiText) {
    return sendError(res, 200, 'LLM_BAD_RESPONSE',
      'AI 返回的内容去掉包装后是空的', { gotPath: '/api/chat' });
  }

  /* 单句上限：模型偶尔会写一大段。契约 §3 规定是一句回合，
   超长说明它没按要求来 —— 截断比原样上屏更像真实对话。
   ★ Day 23：改按**句号边界**截断。
     原来直接 `slice(0,400)` 会切在句子中间，页面上出现半句话
     （"So what I'm thinking is that we should probably..."），
     那比长句更伤—— 用户读到的是一个没说完的句子。
     同一个毛病在加语音之后更明显：朗读半句话会显得卡住。 */
  const finalText = clampToSentence(aiText, 400);

  /* ★ Day 23：`kind` 不再只是回传。
     它在 buildMessages 里已经被用来给「上一轮含糊」加约束了
     （见 isVague 那段）。这里照旧回传，前端可以将来用。
     ★ 前端 dialogue.html 目前只取 aiText，kind 走到那里会被丢 ——
       那是前端的事，本轮不动（契约 §3 的字段仍然保留）。 */

  /* ★★ Day 28：kind 不再由模型说了算，改由轮型推出（deriveKind）。
     见 pickKind 删除处的注释 —— 模型回 JSON 之后，原判据的输入已经不存在。
     ★ silenceSeconds > 0 仍然是 nudge，这一点没变：催促不可能是别的东西。 */
  const kind = silenceSeconds > 0 ? 'nudge' : deriveKind(turn, userText);

  sendJSON(res, 200, {
    ok: true,
    data: {
      aiText: finalText,
      /* ★ Day 27：这句话的中文。可能为空（模型没按格式给 / 降级路径）。
         前端**只显示、不朗读** —— SpeechSynthesis 仍然只念 aiText。 */
      aiTextZh: aiTextZh || undefined,
      kind: typeof kind === 'string' ? kind : kind.kind,
      followUpType: typeof kind === 'string' ? undefined : kind.followUpType,
      model: LLM_MODEL
    }
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const norm = path.replace(/\/+$/, '') || '/';

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 POST', { gotPath: path });
  }

  /* 网关的 enablePathTransmission 默认是false，会把路径剥光（Day 17 实测）。
     这条路由在 cloudbaserc.json 里开了透传，两边都留着写法做双保险。 */
  const isChat = norm === '/api/chat' || norm === '/chat';
  if (!isChat) {
    return sendError(res, 404, 'NOT_FOUND',
      '本函数提供：POST /api/chat',
      { gotPath: path });
  }

  /* ★ 缺密钥要在**部署后第一次调用**就被明确报出来，
     而不是等用户点了开始对话才在浏览器里看到一句含糊报错。 */
  const missing = checkEnv();
  if (missing.length) {
    return sendError(res, 200, 'LLM_NOT_CONFIGURED',
      'AI 接口还没配置好（缺少环境变量：' + missing.join('、') + '）',
      { gotPath: path, missingEnv: missing });
  }

  handleChat(req, res).catch((err) => {
    /*兜底：handleChat 内部已处理业务错误，走到这说明是真 bug。
       只打日志（不泄露细节给公网），返回统一的 500。 */
    console.error('[chat] 未捕获异常', err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    }
  });
});

/* 端口 9000 + 0.0.0.0：CloudBase HTTP 云函数只认这个（Day 15 / Day 17 各踩过一次）。 */
server.listen(9000, '0.0.0.0', () => {
  const missing = checkEnv();
  console.log('[chat] listening on 0.0.0.0:9000');
  console.log('[chat] route: POST /api/chat');
  console.log('[chat] model=' + LLM_MODEL + '（Day 18 起真正实现）');
  console.log('[chat] 密钥环境变量：' + (missing.length === 0
    ? '已配置 ' + 3 + ' 项'
    // 只说缺哪几个名字，不说值，也不说存在与否的值内容
    : '缺少 ' + missing.join('、') + '（不打印值）'));
});