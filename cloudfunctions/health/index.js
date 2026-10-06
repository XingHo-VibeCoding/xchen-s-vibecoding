/* GET /api/health —— 第一个云函数（Day 15 · 板块 ②）
   -------------------------------------------------------------
   位置：整个后端的第 0 号接口，也是唯一一个已上线的接口。
   它不连数据库、不调大模型、不读环境变量，只回答一个问题：
   「这条链路通了吗？」

   为什么第一个接口要做成这样（而不是直接上 /api/chat）：
     · /api/chat 一旦调不通，可能性有五六个（网络、路由、密钥、模型、超时），
       排查时无法区分是「部署没成功」还是「大模型有问题」；
     · /api/health 只有一个变量——部署本身。通了就说明域名、路由、函数、
       运行时全对；不通就说明还没部署好。**它是排错的基线**。
   所以这一版刻意不写任何业务逻辑：**先把链路验通，再往上加东西**。

   为什么用 Node 原生 http 模块，不引express：
     §3.3 选路线乙的核心理由是「零构建工具、不学框架」。express 会把
     node_modules 带进部署包，云端要装依赖，多一个会出错的地方。
     原生 http 只需一个文件、无依赖、部署最不容易出问题——**今天要的是
     确定能跑通，不是写得好看**。等真的接了 /api/chat 再考虑换框架。

   端口 9000 是硬规定：CloudBase HTTP 云函数只认这个端口，写别的起不来。
   ------------------------------------------------------------- */

const http = require('http');

/* CloudBase 把访问者的真实 IP 等信息放在这些请求头里。
   **不要把整个 req.headers 原样回给用户** —— 那会把云开发内部的
   凭证头（x-cloudbase-context 等）一起泄露出去。
   这里只取用得上的一个字段：X-Forwarded-For 的第一段。 */
function clientIp(req) {
  var fwd = req.headers['x-forwarded-for'];
  if (!fwd) return '';
  return String(fwd).split(',')[0].trim();
}

const server = http.createServer((req, res) => {
  // 路径后面可能带查询串（?a=1），取问号前的部分
  const path = (req.url || '/').split('?')[0];

  // 只认 GET。别的 method 直接给 405，省得后面每个接口各写一遍判断。
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    // ★ Day 19：外壳与其余三个接口统一成 {ok, data, error:{code,message}}。
    //   原先这里写的是 {ok, errorCode, message}（照契约 §1.3 的旧文案），
    //   但 chat / analyze / read 三个都用了另一套，而**前端 api.js 只认那一套**
    //   （body.error.code）。两套并存的风险：以后谁照着旧文案写新接口，
    //   前端读不到 code，错误码就退化成 'UNKNOWN'。
    //   契约 §1.3 已同步改成与代码一致，**以代码为准**（前端已上线，改代码成本高得多）。
    res.end(JSON.stringify({
      ok: false,
      data: null,
      error: { code: 'METHOD_NOT_ALLOWED', message: '本接口只接受 GET' }
    }));
    return;
  }

  // 路径容错：以下几种写法都算对
  //   /api/health、/api/health/  —— 直连函数时拿到的完整路径
  //   /health、/health/       —— 经网关路由进来时，网关会剥掉前缀 /api
  //   /                —— 网关剥完前缀后，如果只访问了 /api 本身
  // （末尾斜杠不影响匹配，见 CloudBase 路由的前缀匹配规则）
  //
  // **为什么要兼容两种前缀**：这是实测出来的，不是预防性编程。Day 15 部署后
  // 首次访问返回 404，函数日志里 gotPath 是 "/health" —— 网关做了路径改写，
  // 把 /api 前缀去掉了。原先只认 "/api/health" 的写法在这里会一直 404。
  // 代价只是多几个字符串比较，收益是**改不改前端配置都能通**。
  const isHealth =
    path === '/api/health' || path === '/api/health/' ||
    path === '/health' || path === '/health/' ||
    path === '/' || path === '/api' || path === '/api/';

  if (isHealth) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      // 接口返回的是「服务活着吗」，不是「内容是什么」，
      // 缓存会让排错看到旧结果，反而添乱
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      ok: true,
      service: 'TalkTrainer'
    }));
    return;
  }

  // 走到这里说明：函数活着，但请求的路径不是它认识的。
  // 这本身是有用信息——它能区分「部署失败」与「路径写错」。
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  // gotPath 保留在**顶层**：契约 §1.5 约定「错误分支要带我实际收到了什么」，
  // 而它不是错误原因的一部分，是现场记录 —— 放进 error 里会让人误以为它是错误类别之一。
  // 这个字段当初救过一命：部署成功但访问 404，是它一眼看出网关把 /api 前缀剥掉了。
  res.end(JSON.stringify({
    ok: false,
    data: null,
    error: { code: 'NOT_FOUND', message: '本函数目前只提供健康检查（/api/health）' },
    gotPath: path
  }));

  // 日志留痕：控制台的「日志查询」里能看见，用来确认请求真的到过云上
  console.log('[health] ' + req.method + ' ' + path + ' from ' + clientIp(req));
});

/* 端口必须写9000，且必须监听 0.0.0.0。
   写 127.0.0.1 会导致从网关进来的请求连不上——本机测能通、线上全挂，
   是这一类代码最常见的翻车点。 */
server.listen(9000, '0.0.0.0', () => {
  console.log('[health] listening on 0.0.0.0:9000, route: GET /api/health');
});
