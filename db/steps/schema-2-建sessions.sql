-- ============================================================
-- schema.sql · 第 2-建 sessions 批
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK
-- ============================================================


-- =============================================================================
-- 表一：sessions —— 会话（一次练习 = 一条）
-- 字段依据：TECH_DESIGN §5.3 + api-contract §1.6
-- =============================================================================
CREATE TABLE sessions (
  -- ★ 三个原本用 INT UNSIGNED 的计数字段改成 INTEGER + CHECK >= 0：
  --   PG 没有 UNSIGNED 类型。负数防护由 CHECK 约束接手（见 ck_sessions_counts），
  --   效果与UNSIGNED 等价，且 CHECK 的意图写得更明白。
  session_id          VARCHAR(32)     NOT NULL,   -- 会话唯一标识，由后端生成（api-contract §1.6），不用自增
  topic_id            VARCHAR(16)     NOT NULL,   -- 主题编号：T1–T8；自由对话固定 FREE（PRD §6.6）
  nickname            VARCHAR(64)     NOT NULL DEFAULT '',  -- 昵称；未填写为空串，界面用「你」称呼
  -- ★ DATETIME → TIMESTAMP：PG 没有 DATETIME。用不带时区的 TIMESTAMP
  --   （不是 TIMESTAMPTZ），因为本项目单时区，startedAt 一律按 UTC+8 存、不做换算。
  started_at          TIMESTAMP      NOT NULL,
  -- 结束时间；为空 = 中途退出（B6 要求这种也存）
  ended_at            TIMESTAMP      NULL DEFAULT NULL,
  -- 以下四个是「不许为负」的计数
  duration_seconds    INTEGER        NOT NULL DEFAULT 0,   -- 对话时长（秒），墙钟时间，含停顿与 AI 说话时间（PRD §8.2）
  error_count         INTEGER        NOT NULL DEFAULT 0,   -- 错误次数 = 偏题条数 + 逻辑错误条数（PRD §8.3）；精彩句子不计入
  good_sentence_count INTEGER        NOT NULL DEFAULT 0,   -- 精彩句子呈现次数 = 条数（PRD §8.2）
  turn_count          INTEGER        NOT NULL DEFAULT 0,   -- 本场总轮数（一轮 = 用户一次发言 + AI 一次回应）；跨场次的累计在 practiceCount，两者不是一回事
  -- ★ TINYINT(1) 0/1 → BOOLEAN TRUE/FALSE（Day 16 用户拍板）
  is_complete         BOOLEAN        NOT NULL DEFAULT TRUE, -- 是否正常结束；FALSE = 中途退出，数据仍要留（B6）

  CONSTRAINT pk_sessions PRIMARY KEY (session_id),

  -- 约束：时长/计数不许为负。PG 没有 UNSIGNED，负数防护靠这条
  CONSTRAINT ck_sessions_counts CHECK (
    duration_seconds >= 0
    AND error_count >= 0
    AND good_sentence_count >= 0
    AND turn_count >= 0
  ),

  -- 约束：中途退出的会话没有结束时间，正常结束的必须有。
  -- 这是 B6「中途退出也存」在库里的落点：不靠应用层自觉。
  -- ★ BOOLEAN 版比 0/1 版更直白：is_complete AND ended_at IS NOT NULL
  CONSTRAINT ck_sessions_endtime CHECK (
    (is_complete AND ended_at IS NOT NULL)
    OR (NOT is_complete AND ended_at IS NULL)
  )
);


-- 索引：服务契约 §6.1 的 R1（按主题取会话列表）与 R4 的游标翻页
-- 用 (topic_id, started_at) 排序，翻页时按时间当游标而不是 offset
--（记录是持续追加的，offset 会漏读或重读）。
-- ★ PG 的索引必须用 CREATE INDEX 单独建，不能像 MySQL 那样内联在 CREATE TABLE 里
CREATE INDEX idx_sessions_topic_time ON sessions (topic_id, started_at);
