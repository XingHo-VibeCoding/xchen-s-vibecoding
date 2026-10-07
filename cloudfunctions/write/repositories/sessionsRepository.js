/* sessionsRepository.js —— sessions 表的数据访问（Day 19 · 板块 ②）
   -------------------------------------------------------------
   位置：与 read/repositories/sessionsRepository.js 是**两个文件、内容有意不同**。
   为什么不共用：CloudBase 每个云函数独立目录独立部署（见 read 那份的文件头）。
   为什么内容不同：read 只需要「查」，write 只需要「写一行」和「删一行」，
   硬凑成一份会让两个函数都带着对方用不到的方法。

   ★★ 本文件与 write/index.js 的分工（Day 19 用户拍板：编排留在接口层）：
     这里只提供**原子动作**——插一行、删一行。
     「先插 sessions → 再插 turns → 再插 items，第 2/3 步失败就 DELETE 补偿」
     这套顺序控制留在 write/index.js，因为它是业务流程，不是查库动作。

   ★ 为什么拆开有价值：改「写库要补哪一列」时，只动这个文件；
     改「三表写入的顺序或补偿策略」时，只动 index.js。两者不会互相踩。 */

const db = require('../httpdb');

/* ---------- 一、行数据构造 ----------
   列名一律 snake_case（库里就是这样，契约 §9.8 第 6 条）。
   ★ 注意这三个函数是**纯函数**：输入几个值、返回一个对象，不碰数据库。
     所以单测可以直接 require 本文件验它们，不必起服务、不必假库。 */

/* 三列刻意**不在这里**——走建表时的 DEFAULT：
     is_favorited → FALSE、note → ''、favorited_at → NULL。
   写接口不碰收藏（F4 是 PATCH 的活，Day 20+）。
   ★ 顺带一个好处：ck_items_favtime（收藏状态与收藏时间必须一致）
     这条约束因此天然成立，不需要在应用层再对一遍。 */
function buildSessionRow(input) {
  return {
    session_id: input.sessionId,
    topic_id: input.topicId,
    nickname: input.nickname,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    duration_seconds: input.durationSeconds,
    error_count: input.errorCount,
    good_sentence_count: input.goodSentenceCount,
    turn_count: input.turnCount,
    is_complete: input.isComplete
  };
}

/* ---------- 二、两个原子动作 ---------- */

/* 插一行。
   ★ 为什么必须**父表先插**：turns.items 都外键指向 sessions.session_id，
     顺序反了会撞外键（实测 HTTP API 会返回 23503）。 */
async function insertSession(row) {
  return db.insertMany('sessions', [row]);
}

/* 按主键删一行 —— 补偿删除用。
   ★ 依赖 Day 16 建表时定义的 ON DELETE CASCADE：
     删掉sessions 这一行会连带删掉它的 turns 与 items（fk_turns_session /
     fk_items_session），这是「不留半场数据」的物理保证。
   ★ 不带 limit：PostgREST 的 DELETE 若命中多行会全删。
     sessionId 是主键，天然唯一，但过滤值仍经httpdb 的 URLSearchParams 编码。 */
async function deleteBySessionId(sessionId) {
  return db.deleteWhere('sessions', { session_id: 'eq.' + sessionId });
}

module.exports = {
  buildSessionRow: buildSessionRow,
  insertSession: insertSession,
  deleteBySessionId: deleteBySessionId
};
