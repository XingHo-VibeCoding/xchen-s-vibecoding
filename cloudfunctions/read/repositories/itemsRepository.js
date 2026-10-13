/* itemsRepository.js —— items 表的数据访问（Day 19 · 板块 ②）
   -------------------------------------------------------------
   位置与sessionsRepository 同理：read 与 write 各有一份，理由见那个文件头。

   ★ items 一张表装三类（offtopic / logic / good），不拆成 issues / goodSentences
     两张表 —— 那是用户 Day 16 拍板的数据模型（笔记 §7）。

   ★★ 本文件只提供**只读**入口：listFavoritedItems() 与 listAllItems()（★ Day 24 新增后者）。
     写入、收藏（PATCH note / is_favorited）在 write 那个函数的
     itemsRepository.js 里，两边不共用方法——
     同一个文件里同时有读和写，会让「这个接口只读」这件事看不出来。 */

const db = require('../httpdb');

/* ---------- 一、列清单 ----------
   注意这里有 is_favorited / note / favorited_at 三个「收藏相关」的列：
   读接口只读不写，但列要在 SELECT 里，否则前端拿不到收藏备注（F4）。
   ★ 显式列名的理由同sessionsRepository：一来锁定响应面，
     二来避免库里加列波及接口形状。 */
const SELECT_FAVORITES = [
  'item_id', 'session_id', 'topic_id', 'type', 'turn', 'original_text',
  'reminder', 'correction', 'is_favorited', 'note', 'favorited_at', 'created_at'
].join(',');

/* ---------- 二、查询条件 ----------
   ★ 与 sessions 的差别只有一处：这里**恒定**带is_favorited=eq.true。
     sessions 那边的 topicId 是「有就过滤、没有就全部」，
     而「只读收藏」是这个接口的定义本身，不能被关掉——
     所以它写死在 buildQuery 内部，不作为参数暴露给接口层。

   ★★ Day 22 软删除：这里**恒定**带 is_deleted=eq.false。
     这与 is_favorited 是同一个层级的硬条件——「只读收藏」的定义里
     也包含「已软删的条目不算收藏」（它在软删那一刻收藏标记就被清掉了，
     但双保险有意义：万一将来恢复时忘了清 is_favorited，
     这里这一条也能挡住它回到收藏列表里）。

     ★★ 为什么不能靠 write 侧软删时顺手清 is_favorited 就够了（那样更省）：
       因为「已软删」与「已收藏」是**两个正交的维度**，
       只用一个去挡，等于把「软删」这个状态绑死在「取消收藏」上。
       将来若加「恢复」接口，很容易忘了反向也要清 is_deleted
       ——而漏掉查询条件的话，就是一张已软删的卡片出现在收藏区里。
       ★ 两条过滤都写在这里：**每条可见性规则只在一个地方实现**，
         与本文件「所有路径都收敛到这里」的同一个理由。 */
function buildFavoritesQuery(topicId, limit) {
  return {
    is_favorited: 'eq.true',
    is_deleted: 'eq.false',
    order: 'favorited_at.desc',
    limit: limit,
    ...(topicId ? { topic_id: 'eq.' + topicId } : {})
  };
}

/* ---------- 三、对外唯一入口 ----------
   返回：items 表的行数组（snake_case，未做形状转换）。
   ★ 三条路径（/api/favorites、/api/items/favorites、还有直接打到本函数的）
     全部收敛到这里，所以「只查收藏」这个约束只有一处实现。 */
async function listFavoritedItems(topicId, limit) {
  return db.select('items', buildFavoritesQuery(topicId, limit), SELECT_FAVORITES);
}

/* ---------- 四、第二条入口：**全部条目**（Day 24 新增，实现契约 §6.1 的 R4）----------
   与上面的差别只有一处：**不带 is_favorited 过滤**。

   ★ 为什么必须在数据访问层再开一个入口，而不是在接口层拿收藏结果凑：
     契约 §6.1 R4 登记的就是「列表读取：条目与精彩句子（记录页用）」——
     它要的是**全部**条目。而 R5 只读侧（/api/favorites）的定义是「只返已收藏的」，
     两者是不同的查询条件，凑不出来。

   ★★ 记录页原来的错就在这里：它借用了 /api/favorites 取「全部条目」，
     于是库里没收藏的条目一条都显示不出来（Day 24 复现：库里 7 条 items、
     只收藏了 3 条，页面「共 2 条」—— 少的那些不是没数据，是查错了接口）。

   ★ 仍然带 is_deleted=eq.false：「已软删的不算存在」这条可见性规则
     对两个入口都成立 —— 软删掉的东西不该从「全部条目」里漏出来。 */
function buildAllItemsQuery(topicId, limit) {
  return {
    is_deleted: 'eq.false',
    /* 按创建时间倒序：记录页的「全部条目」是「历次练习混排、按时间倒序」
       （PRD §6.4），与收藏区按 favorited_at 倒序是两回事。 */
    order: 'created_at.desc',
    limit: limit,
    ...(topicId ? { topic_id: 'eq.' + topicId } : {})
  };
}

async function listAllItems(topicId, limit) {
  return db.select('items', buildAllItemsQuery(topicId, limit), SELECT_FAVORITES);
}

module.exports = {
  listFavoritedItems: listFavoritedItems,
  listAllItems: listAllItems,
  SELECT_FAVORITES: SELECT_FAVORITES,
  buildFavoritesQuery: buildFavoritesQuery,
  buildAllItemsQuery: buildAllItemsQuery
};
