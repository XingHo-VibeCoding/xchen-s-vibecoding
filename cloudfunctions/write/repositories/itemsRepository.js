/* itemsRepository.js —— items 表的数据访问（Day 19 · 板块 ②）
   -------------------------------------------------------------
   items 装三类条目（offtopic / logic / good），不拆成issues / goodSentences
   两张表 —— 那是用户 Day 16 拍板的数据模型（笔记 §7）。
   本文件与 read/repositories/itemsRepository.js 是两个文件：
   read 那边只读，本文件只写。

   ★★ B7 / B8 的落地点**不在这个文件里**，值得说清楚为什么：
     B7（偏题与精彩句子的 correction 必须是 NULL）由 cleanItems() 保证，
     B8（原句必须来自后端自己的 transcript，不收请求方传的）也在 cleanItems()。
     两者都是**领域规则**，判据是产品口径，不是数据库怎么存。
     这个文件只负责把已经判干净的条目拼成行插进去——
     它拿到什么就存什么，不做任何判断。
     ★ 这么分是因为判错B7/B8 的后果是「库里存进一句用户没说过的话」，
       那是这个产品最不能出的错，它不该依赖「写库这一层心情好的时候才检查」。 */

const db = require('../httpdb');

/* ---------- 一、itemId 生成（纯函数）---------- */
/* 形状 = sessionId + 类型字母 + 序号，最长 32 + 2 + 2 = 36 字，VARCHAR(40) 装得下。
   ★ 字母表：logic → L、good → G、其余（offtopic）→ O。
     之所以用字母而不是 type 原文，是长度上限摆在那里
     （'offtopic' + 32 + 1 = 41 字会超 VARCHAR(40)）。 */
function newItemId(sessionId, type, seq) {
  const letter = type === 'logic' ? 'L' : (type === 'good' ? 'G' : 'O');
  return sessionId + '-' + letter + seq;
}

/* ---------- 二、行数据构造（纯函数）---------- */
/* ★ 这三列**不出现在这里**，走建表时的 DEFAULT：
     is_favorited → FALSE、note → ''、favorited_at → NULL。
   写接口不碰收藏（F4 是 PATCH 的活，Day 20+）。
   ★ 顺带一个好处：ck_items_favtime（收藏状态与收藏时间必须一致）
     这条约束因此天然成立，不需要在应用层再对一遍。 */
function buildItemRows(sessionId, topicId, items, createdAt) {
  let seq = 0;
  return items.map(function (it) {
    seq += 1;
    return {
      item_id: newItemId(sessionId, it.type, seq),
      session_id: sessionId,
      /* topic_id 是刻意冗余的列：记录页要「按主题+时间倒序」，
         走 idx_items_topic_time 一次命中，不必 join 回sessions。
         代价是可能写歪→ 约定由后端从 session 带出（就是上面那个 topicId 实参）。 */
      topic_id: topicId,
      type: it.type,
      turn: it.turn,
      /* ★ originalText 来自后端自己的 transcript（cleanItems 里按 turn 取回），
         不是请求方传的字段。到达这里时它已经是「用户真说过的那句话」。 */
      original_text: it.originalText,
      reminder: it.reminder,
      correction: it.correction,
      created_at: createdAt
    };
  });
}

/* ---------- 三、批量插入 ----------
   同一个数组一次调用 → 批次内原子（理由见 turnsRepository.js 的注释）。 */
async function insertItems(rows) {
  return db.insertMany('items', rows);
}

module.exports = {
  newItemId: newItemId,
  buildItemRows: buildItemRows,
  insertItems: insertItems
};
