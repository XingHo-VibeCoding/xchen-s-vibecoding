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
   二、提示词：三条硬约束 + 追问边界（不可放宽）
   -------------------------------------------------------------
   写在文件里而不是散在代码里，是因为它们**每一条都会咬人**，
   需要能一眼看到、一处修改：

   ① **不做偏题 / 逻辑判断**（B9）
      判定是 /api/analyze 的职责，契约 §6.1 明确两条独立的路。
      若提示词里带一句「如果他偏题就纠正」，对话中就会出现评判，
      用户会分不清「他在陪我练」还是「他在给我打分」——B9 就破了。

   ② **不主动降语速、不简化用词、不替用户补完**
      这是本产品最核心的价值：A2–B2 的学习者能听懂但说不出来。
      模型天然倾向说简单句、用同义词绕开难题、甚至替用户把句子说完——
      那等于**把用户该练的部分练掉了**。

   ③ **不无条件肯定**
      模型天然爱夸。若用户说得含糊就回 "Great job!"，用户立刻满足、练习结束。
      所以明确要求：只有用户确实说清楚了才认可，否则**继续追问细节**。

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

   ★ 判定交给模型，但**必须在服务端做合理性校验**（see pickKind）：
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
/* 8 主题的「不迁就」取向：角色 + 追问边界。 */
function systemPromptFor(topic) {
  const isFree = !topic || !topic.topicId || topic.topicId === 'FREE';

  if (isFree) {
    return [
      'You are the other person in a casual English conversation practice session.',
      '',
      'Your job: respond like a real person would, in ONE short spoken sentence (or two at most).',
      '',
      'Hard rules:',
      '1. Never evaluate, never judge, never conclude. Do not encourage or motivate the learner.',
      '   You are chatting, not coaching. No "that\'s great!", no advice, no summarizing their life.',
      '2. Do not simplify your vocabulary or slow down your speech for them.',
      '   They understand more than they can say; that gap is exactly what they are practising.',
      '3. Never finish their sentence for them. Never complete a thought they left open.',
      '4. React to what they actually said. Ask something that follows from their words,',
      '   not from a prepared list. If they go off topic, just follow wherever they went.',
      '5. Keep it natural and conversational, like a colleague chatting between meetings.',
      '   Vary your sentence length and phrasing. Do not reuse the same opening word twice in a row.',
      '6. Reply in English only. Even if they switch to Chinese, stay in English.'
    ].join('\n');
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
    'Your job: respond like that person would, in ONE short spoken sentence (or two at most).',
    '',
    'Hard rules:',
    '1. Do NOT judge whether they are off topic, and do NOT correct their grammar or logic.',
    '   That is a separate system\'s job. Your job is only to keep the conversation going.',
    '2. Do not simplify your vocabulary, do not slow down, and do not use simpler',
    '   synonyms to dodge difficulty. They understand more than they can say;',
    '   that gap is exactly what they are practising.',
    '3. Never finish their sentence for them. If they trail off, ask - do not complete it.',
    '4. Do not praise them unconditionally. Only acknowledge when they actually got',
    '   something clear and specific. Vague answers get a follow-up question, not a compliment.',
    '5. Stay strictly inside this topic\'s scope. Reply in English only.',
    ''
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
    '  React to what they actually said. Ask something that follows from their words,',
    '  not from a prepared script. Vary sentence length and phrasing.',
    '  If they say something vague or off-topic, press on the vagueness rather than changing',
    '  the subject yourself.'
  );
  return lines.join('\n');
}

/* 沉默催促：单独一条 system，措辞与上面不同 —— 它要的是"把人拉回来"，
   不是"继续聊天"。混进systemPrompt 会让模型分不清。 */
function nudgePrompt(topic) {
  const isFree = !topic || !topic.topicId || topic.topicId === 'FREE';
  return isFree
    ? [
        'The other person has gone quiet. Say something natural to get them talking again.',
        'One short English sentence. Do not comment on the silence itself in a formal way,',
        'do not say "you have been quiet". Just naturally invite them to continue.',
        'Reply in English only.'
      ].join('\n')
    : [
        'You are role-playing as ' + (topic.role || 'a colleague') + '.',
        'The learner has gone quiet. Nudge them to speak, in character, naturally.',
        'One short English sentence. Do not lecture them about the silence.',
        'Stay inside the topic. Reply in English only.'
      ].join('\n');
}

/* ---------- 组装 messages ---------- */
function buildMessages(topic, history, userText, silenceSeconds) {
  /* 沉默催促：history 里没有本轮发言，走独立提示词。 */
  if (silenceSeconds > 0) {
    return [
      { role: 'system', content: nudgePrompt(topic) },
      /* 带最近几轮让它知道在聊什么，但用 summary 角色说明"这些是背景"，
         避免模型把对话当成自己的发言记录来续写。 */
      { role: 'user', content: '(The conversation so far: ' + summarizeHistory(history) + ')' }
    ];
  }

  const msgs = [{ role: 'system', content: systemPromptFor(topic) }];

  /* 只带最近 MAX_HISTORY 轮：prompt tokens 直接等于钱，
     且历史越长模型越容易"越说越套路"。 */
  const recent = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY);
  recent.forEach((h) => {
    if (h && typeof h.userText === 'string' && h.userText) {
      msgs.push({ role: 'user', content: h.userText });
    }
    if (h && typeof h.aiText === 'string' && h.aiText) {
      msgs.push({ role: 'assistant', content: h.aiText });
    }
  });

  msgs.push({
    role: 'user',
    content: userText +
      '\n\n(Reply with ONE short spoken English sentence only. No JSON, no quotes, no explanation.)'
  });

  return msgs;
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
/* ★ 为什么要校验：模型偶尔会返回契约里没列出的值（比如把 kind 说成"question"）。
   前端拿它去 switch 会走进 else，显示成奇怪的东西。
   ——「模型说什么都照单全收」是这类系统最常见的线上事故。 */
function pickKind(raw, userText) {
  const text = String(raw || '').toLowerCase();

  if (/^\s*nudge\b|^\s*催/.test(text)) return 'nudge';
  if (/follow[_ -]?up|追问/.test(text)) {
    /* follow_up 必须带类型，缺了就按"说得含糊"处理：
       这是最常见的一种，也是最该追问的一种。 */
    const m = text.match(/(too[_ -]?short|vague|incomplete)/);
    const sub = m ? m[1].replace(/[_ ]/g, '') : 'vague';
    return { kind: 'follow_up', followUpType: sub };
  }
  if (/^\s*normal\b|正常/.test(text)) return 'normal';

  /* 模型没给可识别的值时，按用户这句话的实际情况兜底：
     明显短 → too_short，否则当 normal（宁可少追问，不要逼问）。 */
  const words = String(userText || '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 3) {
    return { kind: 'follow_up', followUpType: 'too_short' };
  }
  return 'normal';
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
    followUps: Array.isArray(body.followUps) ? body.followUps : []
  };

  /* silenceSeconds 已在上面的参数校验里声明，这里不重复声明。
     （重复 const 声明在严格模式下是 SyntaxError —— Day 18 踩过一次） */
  const userText = String(body.userText || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];

  const messages = buildMessages(topic, history, userText, silenceSeconds);

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

  const aiText = cleanAiText(raw);
  if (!aiText) {
    return sendError(res, 200, 'LLM_BAD_RESPONSE',
      'AI 返回的内容去掉包装后是空的', { gotPath: '/api/chat' });
  }

  /* 单句上限：模型偶尔会写一大段。契约 §3 规定是一句回合，
     超长说明它没按要求来 —— 截断比原样上屏更像真实对话。 */
  const finalText = aiText.length > 400 ? aiText.slice(0, 400).trim() + '…' : aiText;

  const kindRaw = silenceSeconds > 0 ? 'nudge' : null;
  const kind = kindRaw || pickKind(raw, userText);

  sendJSON(res, 200, {
    ok: true,
    data: {
      aiText: finalText,
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