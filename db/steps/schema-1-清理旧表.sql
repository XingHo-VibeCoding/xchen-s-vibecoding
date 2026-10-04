-- ============================================================
-- schema.sql · 第1-清理旧表 批：DROP 三张表
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：不报错即可
-- ============================================================
-- =============================================================================
-- schema.sql · 口语对话实战器 · 建表脚本（Day 16）
-- =============================================================================
-- 依据（表结构不是自己发明的，全部推导自这三份）：
--   docs/api-contract.md   §1.6 时间与标识 / §6.1 预留接口的字段与查询形状
--   TECH_DESIGN.md         §5.2 topics / §5.3 sessions / §5.4 turns / §5.5 issues
--   PRD.md                 §8.2 时长口径 / §8.3 错误次数 = 偏题 + 逻辑错误
--
-- ★ 方言：PostgreSQL（不是 MySQL）
--   本项目的 CloudBase 环境（cxj1528-…）跑的是 PG 引擎，控制台「SQL 数据库」
--   进去就是 PostgreSQL 管理。Day 16 上午先按 MySQL 写了一版，跑不进这个引擎，
--   已整体翻译成 PG 方言。翻译对照表见文末§ 附。
--
-- 三张表与它们的关系：
--   sessions（一场练习 = 一行）
--     ├── turns  （该场的每一轮，1 : N）
--     └── items  （该场的条目：偏题 / 逻辑错误 / 精彩句子，1 : N）
--   关联字段：turns.session_id 与 items.session_id 都外键指向 sessions.session_id
--
-- 为什么是三张而不是两张或四张：
--   · turns 独立成表 —— Day 16 用户拍板（覆盖 TECH_DESIGN §5.4 原写的
--     「v1 内嵌在 sessions.transcript，不单独立表」）。拆出来的代价是
--     §5.3 的 transcript 字段不再存在，已在 §5.3 标注。
--   · topics 不入库 —— §5.2 已定「来自 topics.json，不是用户数据，只在代码里维护」。
--   · issues 与 goodSentences 不分表 —— §5.5 已记录「实现侧就是一个 items 数组，
--     靠 type: "good" 区分」，契约 §6.1 的接口也叫 /api/items。
--
-- 列名用 snake_case（Day 16 用户拍板）：
--   PG 会把不带双引号的标识符全部转小写，camelCase 的 sessionId 会被存成 sessionid，
--   到时候「库里的名字」和「代码里写的名字」对不上，排查起来很费劲。
--   所以库里一律 snake_case，接口层仍是 camelCase —— Day 17 写云函数时用
--   AS "sessionId" 映射回去，映射点在云函数里写一次，不散落在各处。
--
-- 执行方式：CloudBase 控制台 → SQL 数据库（本环境即 PostgreSQL）→ SQL 编辑器
--           （分批执行，见 db/steps/；步骤见 README.md「数据库怎么建起来的」一节）
--
-- 本脚本可重复执行：开头 DROP TABLE IF EXISTS，且按「子表先删」顺序排列。
-- =============================================================================

-- 先删子表、再删父表：外键约束会让反序删除失败
-- ★ PG 连带删最省心：TRUNCATE sessions CASCADE 会自动把 turns / items 一起清掉，
--   不用像MySQL 那样先关 FOREIGN_KEY_CHECKS 再手动开回来（PG 没这个变量）。
DROP TABLE IF EXISTS items CASCADE;

DROP TABLE IF EXISTS turns  CASCADE;

DROP TABLE IF EXISTS sessions CASCADE;
