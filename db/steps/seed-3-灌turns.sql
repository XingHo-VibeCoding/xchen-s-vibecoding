-- ============================================================
-- seed.sql · 第 3-灌 turns 批：17 轮对话
-- 来自 db/seed.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK
-- ============================================================


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
