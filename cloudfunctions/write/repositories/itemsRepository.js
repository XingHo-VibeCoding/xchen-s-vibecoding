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

/* ---------- 四、按 id 查一条（Day 22）----------
   ★ 为什么必须先查再改/再删，不能靠 patch 与 delete 的返回值：
     PostgREST 命中 0 行也回 200（见 httpdb.js 的 patchWhere 注释），
     所以「改到了没有」这件事只能靠**先查存在性**来判断。
     换个角度看这也是产品要求：契约要求「不存在的 id 返回中文错误说明」，
     而 200 + 空体没法区分「不存在」与「存在但没变化」。

   ★ 查哪几列：PATCH 需要读出改之前的值（截图要对比 before/after，
     而且 isFavorited 连带 favorited_at 时要先看收藏时间在不在），
     所以取全部展示字段而不是只取主键。
   ★ 返回单条对象而不是数组：主键唯一，最多一条；找不到返回 null，
     由接口层决定报什么错——**repository 不产错误文案**（同文件头的分界）。

   ★★ Day 22 软删除：查的时候**恒定带 is_deleted=eq.false**。
     为什么必须在这里带而不是接口层事后过滤：
       ① 接口层过滤 = 把该查的 N 条都拉回来再扔掉，
          分页 limit 就废了（库里 100 条里 99 条已删，页面只显示 1 条）
       ② 带在where 里，PostgREST 就会按 is_deleted 过滤后**再算 limit**
     ★ 这一条同时也是「改」与「删」的前置门：软删掉的那条，
       findItemById 返回 null → 接口层自然回 404「找不到这一条」，
       不需要额外的 if 判断。 */
async function findItemById(itemId) {
  const rows = await db.select('items', {
    item_id: 'eq.' + itemId,
    is_deleted: 'eq.false'
  },
  'item_id,session_id,topic_id,type,turn,original_text,reminder,correction,is_favorited,note,favorited_at,created_at');
  return (rows && rows.length) ? rows[0] : null;
}

/* ---------- 五、改单条（Day 22）----------
   patch 用库里原样的 snake_case 列名（映射是接口层的事，见 httpdb.js 的 select 注释）。

   ★★ 调用方必须自己保证 is_favorited 与 favorited_at 一致：
     库里有 ck_items_favtime（收藏了必须有收藏时间、没收藏必须没有），
     不一致时数据库会拒。repository 刻意**不**替调用方补 favorited_at ——
     「收藏了就把时间戳补上」是产品规则不是数据访问规则，
     判断放在接口层（与 cleanItems 里 B7/B8 交给接口层处理是同一条理由）。 */
async function updateItemById(itemId, patch) {
  return db.patchWhere('items', { item_id: 'eq.' + itemId }, patch);
}

/* ---------- 四之二、查一条**连已软删的**（Day 22 软删除）----------
   ★ 为什么单独开一个方法，不给 findItemById 加个 includeDeleted 参数：
     「看得见的」与「找得到的」是两种用途。
     前者是给页面/接口用的（不该看见已删的），后者是给「找回」用的
     （正是要找那条已删的）。合成一个带开关的方法的话，
     每个调用点都要想一遍「我这次要不要 includeDeleted」——
     想错一次就是把已删的当可见的了。分开写，误用就写不出来。

   ⚠️ **只有「找回」场景能调它**。它绕过了 is_deleted 过滤，
     在别的场景用它就等于把软删除当摆设。 */
async function findItemByIdIncludingDeleted(itemId) {
  const rows = await db.select('items', { item_id: 'eq.' + itemId },
    'item_id,session_id,topic_id,type,turn,original_text,reminder,correction,is_favorited,note,favorited_at,created_at,is_deleted');
  return (rows && rows.length) ? rows[0] : null;
}

/* ---------- 六、删单条（Day 22）----------
   ★★ Day 22 余力加练改成**软删除**：不真删行，只把 is_deleted 置 true。

   为什么改：清单原话是「删错了还能找回」。真删掉的那一刻，
     那一行**当场消失** —— 没有撤销、没有历史、没有痕迹，
     「还能找回」这句话就是空的。加一个标记位之后，
     行还在库里，随时能 `UPDATE items SET is_deleted = FALSE` 改回来。

   ★ 为什么打标记时要顺手清 is_favorited（顺手清掉收藏）：
     已删掉的那条不该继续占着收藏列表的名额，而收藏列表是
     「is_favorited=eq.true」的查询 —— 只打 is_deleted 不清收藏的话，
     read 侧要同时加两个条件才干净（is_favorited + is_deleted），
     漏一个就会在收藏区里挂一张空卡片。
     两边都清掉的方案更简单：**软删 = 从所有可见查询里消失**，
     规则只有一条，不靠「记得同时改两个字段」。

   ★ 依赖先前的 findItemById 判断存在性——理由与 patchWhere 相同。
   ★ 删的是 items 行**不会**连带删 turns（外键方向是 turns→sessions），
     所以删一条条目不影响那一场练习的其它轮次；
     删 sessions 那一行才会连带删掉整场（ON DELETE CASCADE）。 */
async function softDeleteItemById(itemId) {
  return db.patchWhere('items', { item_id: 'eq.' + itemId }, {
    is_deleted: true,
    /* 连带清收藏：理由见上方注释。收藏时间一并清掉 ——
       ck_items_favtime 只管「收藏了必须有收藏时间、没收藏必须没有」，
       留着 favorited_at 而is_favorited=false 会被数据库拒（23514）。 */
    is_favorited: false,
    favorited_at: null
  });
}

module.exports = {
  newItemId: newItemId,
  buildItemRows: buildItemRows,
  insertItems: insertItems,
  findItemById: findItemById,
  findItemByIdIncludingDeleted: findItemByIdIncludingDeleted,
  updateItemById: updateItemById,
  softDeleteItemById: softDeleteItemById
};
