-- ============================================================
-- seed.sql · 第 5-验证 批：4.2 – 4.7 六条SELECT
-- 来自 db/seed.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：6 个结果集，对照 README 的期望值表
-- ============================================================


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
