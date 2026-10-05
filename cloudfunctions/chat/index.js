/* POST /api/chat —— AI 对话接口的骨架（Day 17 建，Day 18 起填内容）
   -------------------------------------------------------------
   ★★ 今天这个文件是「空壳」，只有架构没有实现。
      建它的唯一目的：**在写第一行真正的 AI 代码之前，
      先把三件「以后会疼」的事定死**，明天接 AI 只是往里填内容，不用改架构。

   -------------------------------------------------------------
   一、为什么 /api/chat 必须是独立的云函数，不能塞进 read
   -------------------------------------------------------------
   三个理由，每一个都会真的咬人：

   1. **超时预算完全不同**
      read 是读数据库，毫秒级，timeout 20 秒绰绰有余。
      AI 对话要等模型回话，普遍 3–15 秒，20 秒随时被砍断。
      契约 §3 专门给了 LLM_TIMEOUT 这个错误码，就是为它准备的。
      共用一个 timeout，等于让读接口的余量去承担 AI 的风险。

   2. **密钥隔离**
      LLM_API_KEY 是整个项目唯一需要保密的东西（TECH_DESIGN §9.1）。
      混在一起的话，**改一次读接口就要重新部署一个带密钥的函数**，
      密钥的暴露面被无谓地放大。分开后，read 永远不碰密钥。

   3. **连接池不互相拖累**
      read 里挂着 PG 连接池。本项目当前环境连不上 PG（个人版限制，
      2026-10-05 实测 error.code=DB_CONNECTION_REFUSED），
      连接池会持续重试。若和 AI 同函数，**读库的故障会拖垮 AI 的响应**。
      分开之后，一个挂了不影响另一个。

   -------------------------------------------------------------
   二、本文件今天定的三条硬约定（明天不要改）
   -------------------------------------------------------------
   ① **不查数据库**。契约 §9.8 第 1 条：/api/chat 与 /api/analyze 都不查库，
      库是给读接口用的。本文件里**不允许出现任何 SQL 或 pg 的引用**——
      这条一旦破例，密钥函数就会开始持有数据库连接，日志与排错都会变复杂。

   ② **超时独立配置**。cloudbaserc.json 里给 chat 单独设 timeout，
      不与 read 共用。AI 的时间预算是分钟级的余量，不是数据库的。

   ③ **密钥只从环境变量读**，且**要在启动时校验存在**——
      缺密钥应该在部署后第一次调用就被明确报出来，
      而不是等到用户点了「开始对话」才在浏览器里看到一句含糊的报错。

   -------------------------------------------------------------
   三、今天不实现的部分（明确写下来，避免明天以为漏了）
   -------------------------------------------------------------
   · 调大模型（LLM_BASE_URL / LLM_MODEL / LLM_API_KEY 读得到，但没用）
   · 提示词（三条硬约束：不含偏题判断、不降语速不补完、不无条件肯定）
   · 三类回应 kind（normal / follow_up / nudge）的判定
   · 自由对话（topicId="FREE"）的取向差异——它不受 anchor 约束
   · 8 秒 / 5 秒沉默触发（契约 §3 的 silenceSeconds）
   以上全部属于 Day 18，今天一律不写。
   -------------------------------------------------------------------- */

const http = require('http');

/* 启动时自检：把「配置对不对」的问题挡在第一次用户请求之前。
   注意只打印**有没有**，绝不打印值——密钥进了日志就是事故。 */
function checkEnv() {
  const need = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
  const missing = need.filter((k) => !process.env[k]);
  return missing;
}

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
      '本函数提供：POST /api/chat（骨架已建，实现见 Day 18）',
      { gotPath: path });
  }

  /* 契约 §3：请求体是 { topicId, history, userText, silenceSeconds }。
     今天不解析也不校验——**校验属于实现的一部分**，Day 18 一起做，
     现在凭空写一套只会和明天的实现对不上。 */
  sendError(res, 501, 'NOT_IMPLEMENTED',
    '接口骨架已建，AI 对话能力Day 18 接入',
    { gotPath: path, envReady: checkEnv().length === 0 });
});

/* 端口 9000 + 0.0.0.0：CloudBase HTTP 云函数只认这个（Day 15 / Day 17 各踩过一次）。 */
server.listen(9000, '0.0.0.0', () => {
  const missing = checkEnv();
  console.log('[chat] listening on 0.0.0.0:9000');
  console.log('[chat] route: POST /api/chat');
  console.log('[chat] 这是 Day 17 建的骨架，尚未实现 AI 调用');
  console.log('[chat] 密钥环境变量：' + (missing.length === 0
    ? '已配置 ' + 3 + ' 项'
    // 只说缺哪几个名字，不说值，也不说存在与否的值内容
    : '缺少 ' + missing.join('、') + '（不打印值）'));
});
