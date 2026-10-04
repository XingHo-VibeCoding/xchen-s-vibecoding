-- ============================================================
-- seed.sql · 第 4-灌 items 批：7 条条目 + 4.1 行数核对
-- 来自 db/seed.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK，然后行数 sessions=5 / turns=17 / items=7
-- ============================================================


-- =============================================================================
-- 三、items —— 7 条条目
--
-- ★这个 INSERT 是整份脚本里最该被检查的一段。
--   抄 mock-items.json 时把 fix（展示层名字）换成了 correction（接口层名字），
--   并把两条偏题/精彩句子的 fix:"" 改成了真正的 NULL——
--   因为库里correction 是可空列，写空字符串会被 ck_items_correction 直接拒绝。
--   （mock 里写 fix:"" 是因为前端 JS 用 falsy 判断，空串和 null 都算「没有」，
--     数据库分得清这两者，所以入库时必须翻译成 NULL。）
--
-- 覆盖情况：offtopic × 2、logic × 1、good × 4，三个 type 都齐。
-- 收藏状态也覆盖了：已收藏且有收藏时间的 3 条、未收藏且收藏时间为空的 4 条。
-- =============================================================================
INSERT INTO items
  (item_id, session_id, topic_id, type, turn,
   original_text, reminder, correction,
   is_favorited, note, favorited_at, created_at)
VALUES
  -- S-MOCK-01 的三条：与 mock-items.json 的 items 数组逐条对应
  -- turn 1：精彩句子。correction 为 NULL（§5.6 精彩句子没有「纠正」这个概念）
  ('T1-S1-G1', 'S-MOCK-01', 'T1', 'good', 1,
   'Let me walk you through where we are, and then flag the one thing I need help with.',
   '先给全貌、再点出需要的帮助，是汇报里很稳的结构。',
   NULL,
   TRUE, '开场就用这个结构', '2026-09-28 20:15:30', '2026-09-28 20:14:25'),

  -- turn 2：逻辑错误。correction 必须有值（B7）
  ('T1-S1-E1', 'S-MOCK-01', 'T1', 'logic', 2,
   'We have some issues but I think it is ok.',
   '先说「有问题」又说「没问题」，前后不一致。',
   'We are two days behind on the API, but we can still make Friday.',
   TRUE, '', '2026-09-28 20:16:02', '2026-09-28 20:14:25'),

  -- turn 4：偏题。correction 必须为 NULL（B7：只提醒，不给改法）
  ('T1-S1-E2', 'S-MOCK-01', 'T1', 'offtopic', 4,
   'By the way, I really like the coffee machine on the third floor.',
   '这句讲的是三楼的咖啡机，和「项目进度」这个主题没关系。',
   NULL,
   FALSE, '', NULL, '2026-09-28 20:14:25'),

  -- S-MOCK-02 的偏题
  ('T6-S2-E1', 'S-MOCK-02', 'T6', 'offtopic', 3,
   'I have two cats, they are very lazy.',
   '这句讲的是家里的猫，和这次要交代的工作背景没关系。',
   NULL,
   FALSE, '', NULL, '2026-09-27 19:40:05'),

  -- S-MOCK-03 的精彩句子。这一场 error_count=0，但仍有精彩句子——
  -- 因为 good_sentence_count 与 error_count 是两回事（B22：error_count 只数两类错误）
  ('T3-S3-G1', 'S-MOCK-03', 'T3', 'good', 1,
   'I think we should keep the current scope.',
   '先给结论再说理由，在被点名时最不容易卡住。',
   NULL,
   FALSE, '', NULL, '2026-09-25 20:04:40'),

  -- S-MOCK-04 自由对话的两条精彩句子。
  -- 注意这里 topic_id 是 FREE、type 全是 good —— 库里没有一条 offtopic，
  -- 这就是 F6「不判偏题」在数据层的证据
  ('FREE-S4-G1', 'S-MOCK-04', 'FREE', 'good', 1,
   'I am so tired of these meetings that add nothing.',
   '用大白话把情绪说出来，正是自由对话想练的。',
   NULL,
   FALSE, '', NULL, '2026-09-23 21:06:15'),

  -- 这条对应 turn 4（不是 turn 3）。original_text 必须与 turns.user_text 逐字一致，
  -- 这是 B8「不编造原句」的落点：模型只给 turn 编号，原文由后端按编号取回。
  -- ★ 写这行时我第一遍把 turn 写成了 3、被离线校验器当场抓出来（B8 不一致），
  --   照抄 turn 4 才对 —— 轮次编号和原句必须同时对得上。
  ('FREE-S4-G2', 'S-MOCK-04', 'FREE', 'good', 4,
   'I finally fixed the bug I have been chasing since Monday.',
   '讲清楚「卡在哪、怎么解决的」，是很好的一句话。',
   NULL,
   TRUE, '这句想记住', '2026-09-23 21:07:02', '2026-09-23 21:06:15');


  -- S-MOCK-05 没有条目：中途退出的场次只留下 1 轮，用户没来得及说完。
  -- 「没做完的场次不硬凑条目」和 B10 是同一个原则


-- =============================================================================
-- 四、验证 SELECT —— 清单的完成标准是「每张核心表至少 5 行」
-- 期望结果：sessions=5、turns=17、items=7
-- =============================================================================

-- 4.1 行数核对：三条都应 ≥5
SELECT 'sessions' AS table_name, COUNT(*) AS row_count FROM sessions
UNION ALL
SELECT 'turns',   COUNT(*) FROM turns
UNION ALL
SELECT 'items',   COUNT(*) FROM items;
