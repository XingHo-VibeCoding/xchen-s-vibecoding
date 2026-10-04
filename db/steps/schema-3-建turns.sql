-- ============================================================
-- schema.sql · 第 3-建 turns 批（含外键与索引）
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK
-- ============================================================


-- =============================================================================
-- 表二：turns —— 轮次（sessions 的子表， 1 : N）
-- 字段依据：TECH_DESIGN §5.4
--
-- 主键用复合主键 (session_id, turn)，不用自增 id：
-- 轮次号本来就只在「本场之内」有意义，(session_id, turn) 才是它的真身份。
-- 这样做顺带把「同一场里不能出现两个第 3 轮」钉死在数据库里。
-- =============================================================================
CREATE TABLE turns (
  session_id      VARCHAR(32)     NOT NULL,   -- 所属会话；外键指向 sessions.session_id，删会话时连带删轮次
  -- turn 在 PG 里是「非保留关键字」，可以直接当列名用，不必加引号
  turn            INTEGER        NOT NULL,   -- 轮次序号，从 1 开始
  user_text       TEXT            NOT NULL,   -- 用户原句，一字不改。这是 B8「不编造原句」的唯一可信来源
  ai_text         TEXT            NOT NULL,   -- AI 的回应文字；前端再用 SpeechSynthesis 读出来（B2）
  -- 该轮开始的相对时间（毫秒，从会话开始算起），用于回放与排序
  timestamp       INTEGER        NOT NULL DEFAULT 0,
  asked_follow_up BOOLEAN        NOT NULL DEFAULT FALSE,  -- 本轮 AI 是否做了追问

  -- 轮次按时间顺序读，复合主键已经把 (session_id, turn) 做成索引，不必再加
  CONSTRAINT pk_turns PRIMARY KEY (session_id, turn),

  CONSTRAINT fk_turns_session
    FOREIGN KEY (session_id) REFERENCES sessions (session_id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- 约束：轮次从 1 开始，0 与负数都不合法
  CONSTRAINT ck_turns_turn CHECK (turn >= 1)
);
