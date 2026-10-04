-- ============================================================
-- schema.sql · 第 6-建表自检 批：两条验证 SELECT
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：表清单 3 行 / 外键 2 行
-- ============================================================


-- =============================================================================
-- 建表结束的验证：应该看到 3 行
-- =============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN ('sessions', 'turns', 'items')
ORDER BY table_name;


-- 外键应该看到 2 条（turns → sessions、items → sessions）
SELECT
  tc.table_name,
  tc.constraint_name,
  ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;
