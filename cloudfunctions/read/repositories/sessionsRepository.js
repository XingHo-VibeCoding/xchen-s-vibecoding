/* sessionsRepository.js —— sessions 表的数据访问（Day 19 · 板块 ②）
   -------------------------------------------------------------
   位置：read 与 write 两个云函数**各有一份**（内容基本相同、物理上两个文件）。
   为什么不能共用一个：CloudBase 每个云函数独立目录独立部署，
   `tcb fn code update read --dir cloudfunctions/read` 只打包 read 那一个目录，
   放在仓库根的公共目录不会被带上去。要真正共用只能改成分层或私有 npm 包，
   那是改部署方式，超出本次范围（与 httpdb.js 已在 read/write 各有一份同理）。

   ★★ 这个文件存在的全部理由：**把「查sessions 表」这件事从接口层挪出来**。
     拆之前那四样东西写在 read/index.js 里：列名常量、查询条件拼装、
     db.select 调用、还有一句注释解释为什么这样拼。
     现在它们在这里，read/index.js 只剩「校验参数 → 调这里 → 转形状 → 返响应」。

   ★ 判定标准（拆分时最容易出错的一条）：
     **看换一个需求时这段代码会不会跟着变。**
     「取哪几列、按什么条件过滤」在任何接口里都一样 → 属于这一层；
     「limit 只能是 1–100」是 HTTP 请求的规矩 → 留在接口层。

   ★★ 边界：本文件**只负责把行原样取出来**，不做任何形状转换——
     返回的是库里原样的 snake_case 行（session_id / topic_id / …）。
     映射成 camelCase 是接口出口的职责（契约 §9.8 第 4 条：
     映射只写在出口那一处）。这样数据库将来加列，不会波及接口的响应形状。

   ★ 不重复实现参数校验：`limit` 与 `topicId` 的合法性由接口层判完再传进来。
     理由：校验规则属于「这个接口允许什么」，不是「这张表允许什么」。
     若表将来被别的接口用（比如导出脚本），两边的规矩未必一样。 */

const db = require('../httpdb');

/* ---------- 一、列清单 ----------
   查询参数写 snake_case（库里的列名），返回的也是 snake_case 行。
   为什么显式列出列名而不用 `select=*`：
     ① 库表将来加列时，`*` 会把新列一起带出来，接口却不会映射它，
        多出来的字段会让「响应逐字对比」这种回归手段失效。
     ② 这份清单本身就是文档：看一眼就知道 sessions 有哪些可读字段。 */
const SELECT_SESSIONS = [
  'session_id', 'topic_id', 'nickname', 'started_at', 'ended_at',
  'duration_seconds', 'error_count', 'good_sentence_count', 'turn_count', 'is_complete'
].join(',');

/* ---------- 二、查询条件 ----------
   PostgREST 的过滤写法：eq. 等于。
   ★ 值一律经 httpdb 内部的 URLSearchParams 编码——
     Day 18 的探针因为没编码通配符，把整个库删空了。 */
function buildQuery(topicId, limit) {
  return {
    order: 'started_at.desc',
    limit: limit,
    /* 不传 topicId 时就是「全部主题」。
       曾经试过用 or=(topic_id.is.null) 来等价表达「这个条件不成立」，
       但实测不带 topic_id 参数本身就返回全部，所以直接不放这个键。
       注释留在这儿是为了不让下一个人再走一遍那条弯路。 */
    ...(topicId ? { topic_id: 'eq.' + topicId } : {})
  };
}

/* ---------- 三、对外唯一入口 ----------
   返回：sessions 表的行数组（snake_case，未做任何形状转换）。
   抛错：连接/鉴权/表缺失等一律沿用 httpdb 的 DbError，
        由接口层统一 catch 并翻成契约里的错误码（不新增错误码）。 */
async function listSessions(topicId, limit) {
  return db.select('sessions', buildQuery(topicId, limit), SELECT_SESSIONS);
}

/* ★ 顺带说明：主键生成（newSessionId）刻意**不在这个文件里**。
   它是「怎么造一个不重复的 id」，属于领域规则；
   而 write/index.js 那边的防重复靠数据库主键，不靠 id 里的随机尾巴。
   留在接口层，将来改 id 规则时改动范围是清楚的。 */

module.exports = {
  listSessions: listSessions,
  /* 导出常量是为了单测能把形状钉住，不只是为了省几行 */
  SELECT_SESSIONS: SELECT_SESSIONS,
  buildQuery: buildQuery
};
