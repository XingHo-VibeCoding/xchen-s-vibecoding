-- =============================================================================
-- seed.sql · 口语对话实战器 · 种子数据（Day 16）
-- =============================================================================
-- 前置条件：先执行 schema.sql 建表。本脚本不建表。
--
-- ★ 方言：PostgreSQL（不是 MySQL）—— 翻译对照见 schema.sql 文末附录。
--
-- 数据来自哪里（不是编的，是抄的前端已有 mock）：
--   frontend/data/mock-items.json    → S-MOCK-01（T1）与 S-MOCK-02（T6）的条目
--   frontend/data/mock-sessions.json → 各主题的练习次数与最后练习时间
-- 抄它而不是另编一套的理由：前端四个页面现在显示的就是这份 mock 数据，
-- 数据库里的行和页面上看到的能一一对上，Day 17 接读接口时不会出现
-- 「库里说练过 3 次、页面说练过 1 次」这种对不上的情况。
--
-- ★ 本脚本可重复执行，跑第二遍不会报错也不会产生重复数据。
--   做法：TRUNCATE … CASCADE 清空三张表（PG 里 CASCADE 会连带清掉子表，
--   不用像 MySQL 那样先关 FOREIGN_KEY_CHECKS 再手动开回来）→ 再 INSERT。
--   不写成 INSERT … ON CONFLICT DO UPDATE 是因为那样第二次跑出来的
--   created_at 会变，「可复现」就不成立了 —— 清单要的就是跑几遍结果一样。
--
-- 执行方式：CloudBase 控制台 → SQL 数据库（本环境即 PostgreSQL）→ SQL 编辑器
--           （分批执行，见 db/steps/）
-- =============================================================================

-- 外键连带清空：sessions 下的 turns / items 会被 CASCADE 一起清掉，
-- 一条语句就够，不用先删子表。
TRUNCATE TABLE sessions CASCADE;


-- =============================================================================
-- 一、sessions —— 5 场会话
--
-- 刻意覆盖五种不同情况，不是随便凑够 5 行（每种都对应用到产品里的一个分支）：
--   S-MOCK-01  T1    正常结束，有偏题 + 逻辑错误 + 精彩句子（三个 type 都齐）
--   S-MOCK-02  T6    正常结束，只有一条偏题
--   S-MOCK-03  T3    正常结束，is_complete=TRUE 但错误数为 0（noIssueFound 的那种场）
--   S-MOCK-04  FREE  正常结束，自由对话只有精彩句子、没有偏题
--                     ← F6 不判偏题（PRD §8.3），这一行就是那条口径的证据
--   S-MOCK-05  T1    **中途退出**：is_complete=FALSE、ended_at 为空
--                     ← B6「中途退出也要存」的证据，也是 ck_sessions_endtime 的验证对象
-- =============================================================================
INSERT INTO sessions
  (session_id, topic_id, nickname, started_at, ended_at,
   duration_seconds, error_count, good_sentence_count, turn_count, is_complete)
VALUES
  -- is_complete=TRUE → ended_at 必须有值
  ('S-MOCK-01', 'T1',    '小陈', '2026-09-28 20:11:16', '2026-09-28 20:14:20',
     184, 2, 1, 4, TRUE),
  ('S-MOCK-02', 'T6',    '小陈', '2026-09-27 19:37:54', '2026-09-27 19:40:00',
     126, 1, 0, 3, TRUE),
  ('S-MOCK-03', 'T3',    '',     '2026-09-25 20:02:10', '2026-09-25 20:04:35',
     145, 0, 1, 4, TRUE),
  -- FREE：error_count 只由逻辑错误算起；这条一个错误都没有，所以是 0
  ('S-MOCK-04', 'FREE',  '小陈', '2026-09-23 21:00:00', '2026-09-23 21:06:12',
     372, 0, 2, 5, TRUE),
  -- 中途退出：is_complete=FALSE → ended_at 必须为 NULL（B6），duration_seconds 是已进行的时长
  ('S-MOCK-05', 'T1',    '小陈', '2026-09-22 20:08:00', NULL,
      42, 0, 0, 1, FALSE);


-- =============================================================================
-- 二、turns —— 17 轮
--
-- 三条硬约束体现在数据里：
--   1. turn 从 1 起，同一场里不重复（复合主键挡着）
--   2. user_text 一字不改 —— items.original_text 必须是从这里原样取的（B8）
--   3. timestamp 是相对毫秒，用于回放与排序
-- =============================================================================
INSERT INTO turns
  (session_id, turn, user_text, ai_text, timestamp, asked_follow_up)
VALUES
  -- S-MOCK-01（T1 项目进度被追问），4 轮，184 秒
  ('S-MOCK-01', 1,
   'Let me walk you through where we are, and then flag the one thing I need help with.',
   'We are a bit behind. So, what is the status?',
   0, FALSE),
  ('S-MOCK-01', 2,
   'We have some issues but I think it is ok.',
   'Okay. Which part exactly?',
   42000, TRUE),
  ('S-MOCK-01', 3,
   'The backend part. The spec changed and we had to redo the integration.',
   'What is holding it up?',
   96000, TRUE),
  ('S-MOCK-01', 4,
   'By the way, I really like the coffee machine on the third floor.',
   'When can we expect it?',
   138000, TRUE),

  -- S-MOCK-02（T6 第一次见面自我介绍），3 轮，126 秒
  ('S-MOCK-02', 1,
   'I am a new joiner on the data platform team.',
   'Nice to meet you. So, tell me about yourself.',
   0, FALSE),
  ('S-MOCK-02', 2,
   'I came from a fintech startup, mostly data engineering.',
   'So what do you do here?',
   38000, TRUE),
  ('S-MOCK-02', 3,
   'I have two cats, they are very lazy.',
   'Where were you before this?',
   81000, TRUE),

  -- S-MOCK-03（T3 被问到没准备过的问题），4 轮，145 秒。
  -- 这一场刻意零错误：用来验证「没发现问题时不硬凑条目」（B10 / noIssueFound=true）
  ('S-MOCK-03', 1,
   'I think we should keep the current scope.',
   'So, what do you think?',
   0, FALSE),
  ('S-MOCK-03', 2,
   'Honestly I need a bit more time to look at the numbers.',
   'What makes you say that?',
   35000, TRUE),
  ('S-MOCK-03', 3,
   'Can I come back to you on that this afternoon?',
   'Can you give me an example?',
   72000, TRUE),
  ('S-MOCK-03', 4,
   'Sure. I will send the summary after the standup.',
   'When can we expect it?',
   108000, TRUE),

  -- S-MOCK-04（FREE 自由对话），5 轮，372 秒。
  -- 自由对话不判偏题，所以这 5 轮里即使有跑题的内容，items 里也不会有 offtopic
  ('S-MOCK-04', 1,
   'I am so tired of these meetings that add nothing.',
   'That sounds like a long day. What was the hardest part?',
   0, TRUE),
  ('S-MOCK-04', 2,
   'Three meetings in a row with no decision at the end.',
   'Thanks for telling me. How did that leave you feeling?',
   68000, TRUE),
  ('S-MOCK-04', 3,
   'Frustrated, but I did get one thing done this morning.',
   'I see. What happened next?',
   145000, TRUE),
  ('S-MOCK-04', 4,
   'I finally fixed the bug I have been chasing since Monday.',
   'That makes sense. Was it what you expected?',
   220000, TRUE),
  ('S-MOCK-04', 5,
   'Not at all. It turned out to be a missing comma.',
   'Mm, I am following. Anything else from today on your mind?',
   296000, TRUE),

  -- S-MOCK-05（T1，中途退出），只留下 1 轮就退出了。
  -- 用户中途关页面，已说的这轮要留住（B6）
  ('S-MOCK-05', 1,
   'We are a bit behind on the API integration.',
   'We are a bit behind. So, what is the status?',
   0, FALSE);


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


-- 4.2 关联验证：两张子表都能通过 session_id 挂到会话上。
-- 这条是「两张表靠哪个字段关联」的直接证据 —— 三个 count 必须相等
SELECT
  s.session_id,
  s.topic_id,
  s.is_complete,
  (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.session_id) AS turn_count,
  (SELECT COUNT(*) FROM items i WHERE i.session_id = s.session_id) AS item_count,
  s.error_count,
  s.good_sentence_count
FROM sessions s
ORDER BY s.started_at DESC;


-- 4.3 ★ 最要紧的一条：B22 核对。
-- error_count 必须恰好等于该场的 offtopic + logic 条数，一条不多一条不少。
-- 期望每行 error_count 与 bad_count 那两列相等（末行 S-MOCK-05 两列都是 0）
SELECT
  s.session_id,
  s.topic_id,
  s.error_count,
  COUNT(i.item_id) AS bad_count,
  CASE WHEN s.error_count = COUNT(i.item_id) THEN 'OK' ELSE '❌ 对不上' END AS verdict
FROM sessions s
LEFT JOIN items i
  ON i.session_id = s.session_id
 AND i.type IN ('offtopic', 'logic')
GROUP BY s.session_id, s.topic_id, s.error_count
ORDER BY s.started_at DESC;


-- 4.4 B7 核对：偏题与精彩句子的correction 必须是 NULL
SELECT
  i.item_id,
  i.type,
  i.correction,
  CASE
    WHEN i.type = 'logic'    AND i.correction IS NOT NULL THEN 'OK 逻辑错误有改法'
    WHEN i.type = 'offtopic' AND i.correction IS NULL     THEN 'OK 偏题无改法'
    WHEN i.type = 'good'     AND i.correction IS NULL     THEN 'OK 精彩句子无此字段'
    ELSE '❌ 违反 B7'
  END AS verdict
FROM items i
ORDER BY i.created_at DESC, i.turn;


-- 4.5 F6 核对：自由对话不该有偏题条目。
-- 期望 0 行。返回 1 行就说明 F6 的口径被破坏了
SELECT * FROM items WHERE topic_id = 'FREE' AND type = 'offtopic';


-- 4.6 B6 核对：中途退出的场次 ended_at 为空，且轮次确实留下来了。
-- 期望 1 行，ended_at=NULL、turn_count=1
SELECT
  s.session_id,
  s.is_complete,
  s.ended_at,
  (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.session_id) AS turn_count
FROM sessions s
WHERE s.is_complete = FALSE;


-- 4.7 收藏区：对应前端 P4 的「收藏」板块（F4），按收藏时间倒序。
-- is_favorited=TRUE 的应该有 3 条
SELECT item_id, topic_id, type, note, favorited_at
FROM items
WHERE is_favorited = TRUE
ORDER BY favorited_at DESC;
