-- ============================================================
-- schema.sql · 第 4-建 items 批（含 4 条 CHECK）
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK
-- ============================================================


-- =============================================================================
-- 表三：items —— 条目（偏题 / 逻辑错误 / 精彩句子）
-- 字段依据：TECH_DESIGN §5.5（issues）+ §5.6（goodSentences）+ api-contract §7
--
-- 三类条目同表，靠 type 区分（§5.5 已记录实现侧就是一个 items 数组）：
--   offtopic 偏题     → correction 必须为 NULL（B7：只提醒，不给改法）
--   logic    逻辑错误 → correction 必须有值（B7：提醒 + 纠正）
--   good     精彩句子 → 无「纠正」概念，同 offtopic 一样必须为 NULL（§5.6 无此字段）
--
-- ★ 库里的列名是 correction（原接口层名字），不改 snake_case：
--   这一列绑着 B7 硬约束，名字叫 fix（展示层旧称）会让人以为可以随便改。
-- =============================================================================
CREATE TABLE items (
  item_id        VARCHAR(40)     NOT NULL,   -- 条目唯一标识，由后端生成
  session_id     VARCHAR(32)     NOT NULL,   -- 所属会话；外键指向 sessions.session_id
  -- 所属主题。刻意冗余一份：记录页要「按主题筛选 + 时间倒序」，
  -- 有它就能走索引一次命中，不必 join sessions
  topic_id       VARCHAR(16)     NOT NULL,
  -- type 在 PG 里是「非保留关键字」，可以直接当列名用
  type           VARCHAR(8)      NOT NULL,   -- 条目类型，只允许 offtopic / logic / good 三个值
  turn           INTEGER        NOT NULL,   -- 出现在第几轮（对应 turns.turn）
  -- 用户原句，从 turns.user_text 原样取出，禁止 AI 重新生成（B8）
  original_text  TEXT            NOT NULL,
  -- 提醒：偏题说明偏离了哪一点，逻辑错误说明哪里不成立，精彩句子说明好在哪
  reminder       VARCHAR(500)    NOT NULL DEFAULT '',
  -- 纠正：应该怎么说。偏题与精彩句子必须为 NULL，逻辑错误必须有值（B7）
  correction     TEXT            NULL DEFAULT NULL,
  is_favorited   BOOLEAN         NOT NULL DEFAULT FALSE,  -- 收藏标记（F4）
  note           VARCHAR(120)    NOT NULL DEFAULT '',     -- 备注，单行短文本，建议 ≤30 字
  favorited_at   TIMESTAMP       NULL DEFAULT NULL,      -- 收藏时间，收藏区按它倒序；未收藏时为空
  created_at     TIMESTAMP       NOT NULL,                -- 条目生成时间，记录页按它时间倒序（B19）

  CONSTRAINT pk_items PRIMARY KEY (item_id),

  CONSTRAINT fk_items_session
    FOREIGN KEY (session_id) REFERENCES sessions (session_id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  -- 约束 1：类型只允许三个字面量。
  -- Day 14踩过 offtopic 曾被写成 off_topic，这类错在库这一层就插不进来。
  CONSTRAINT ck_items_type CHECK (type IN ('offtopic', 'logic', 'good')),

  -- 约束 2（今天最重要的一条）：B7 的技术保障。
  -- 偏题与精彩句子必须没有改法，逻辑错误必须有改法。
  -- 契约 §4 特意强调这条要「后端强制，不依赖模型自觉」—— 现在库也强制了，
  -- 就算代码写错、模型不听话，插不进一条「偏题却给了改法」的脏数据。
  CONSTRAINT ck_items_correction CHECK (
    (type = 'logic'    AND correction IS NOT NULL)
    OR (type = 'offtopic' AND correction IS NULL)
    OR (type = 'good'     AND correction IS NULL)
  ),

  -- 约束 3：轮次从 1 开始
  CONSTRAINT ck_items_turn CHECK (turn >= 1),

  -- 约束 4：收藏状态与收藏时间必须一致。
  -- 收藏了却没时间戳 → 收藏区倒序排不出来；没收藏却有时间戳 → 数据自相矛盾。
  CONSTRAINT ck_items_favtime CHECK (
    (is_favorited AND favorited_at IS NOT NULL)
    OR (NOT is_favorited AND favorited_at IS NULL)
  )
);


-- 索引：按会话取全部条目（结果页 P3 看本次）
CREATE INDEX idx_items_session ON items (session_id);


-- 记录页 P4：按主题筛选 + 时间倒序；不传主题时也能用后一段做倒序扫描。
-- 对应 api-contract §6.1 R4 的游标翻页。
CREATE INDEX idx_items_topic_time ON items (topic_id, created_at);

CREATE INDEX idx_items_time ON items (created_at);


-- 收藏区（F4）：只取已收藏的，按收藏时间倒序
CREATE INDEX idx_items_fav ON items (is_favorited, favorited_at);
