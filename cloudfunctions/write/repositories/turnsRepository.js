/* turnsRepository.js —— turns 表的数据访问（Day 19 · 板块 ②）
   -------------------------------------------------------------
   turns 是 sessions 的子表（复合主键 (session_id, turn)，
   外键 ON DELETE CASCADE 指向 sessions）。本文件只提供**批量插入**一个动作。

   ★ 为什么 read 那边没有同名文件：read 一个 turn 都不查
     （契约 §6.1 的 GET /api/sessions 只返回汇总行，不返回轮次明细）。
     建一个空文件等于凭空多一个要维护的东西，所以不建。

   ★ 为什么只有写入没有查询：当前四个接口里没有任何一个要单独读 turns。
     将来记录页要做「点开一场看逐轮对话」时，才在这里加 listTurnsBySession()——
     那时候查询条件与列清单一起加，不提前预留。 */

const db = require('../httpdb');

/* ---------- 行数据构造（纯函数，可直接单测）---------- */
/* 列名 snake_case（库里就是这样）。
   ★ asked_follow_up 对应库里的 BOOLEAN 列：接口传 true/false，
     PG 原样存取，不需要转成 0/1。
   ★ timestamp 是**相对**会话开始的毫秒数（不是绝对时间），
     接口层已在 cleanTranscript 里把它规整成非负整数，这里只搬运。 */
function buildTurnRows(sessionId, turns) {
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

/* ---------- 批量插入 ----------
   ★ 为什么是「一次插整个数组」而不是循环单条：
     ① 本环境走 CloudBase HTTP API，**跨请求的事务不存在**
        （实测 BEGIN 与 ROLLBACK 分两次调用，ROLLBACK 后那一行还在）；
     ② 但**同一批内是原子的** —— 实测同批里一行违反 CHECK，整批 0 行落库。
     所以「一次调用 = 一个原子单位」是这个环境下能拿到的最强保证。
   ★ 空数组直接返回：httpdb.insertMany 内部对空数组短路，
     不发请求（发过去也只是白跑一趟）。 */
async function insertTurns(rows) {
  return db.insertMany('turns', rows);
}

module.exports = {
  buildTurnRows: buildTurnRows,
  insertTurns: insertTurns
};
