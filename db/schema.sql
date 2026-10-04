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


-- =============================================================================
-- 字段注释：PG 不支持 MySQL 那种写在列定义里的 COMMENT '…'，
-- 要用COMMENT ON 单独补。写在最后是因为它属于「装好房子之后挂门牌」的动作。
-- =============================================================================
COMMENT ON TABLE sessions IS '会话：一次练习 = 一行。字段口径见 TECH_DESIGN §5.3';
COMMENT ON COLUMN sessions.session_id           IS '会话唯一标识，由后端生成（api-contract §1.6），不用自增';
COMMENT ON COLUMN sessions.topic_id             IS '主题编号：T1–T8；自由对话固定 FREE（PRD §6.6）';
COMMENT ON COLUMN sessions.nickname             IS '昵称；未填写为空串，界面用「你」称呼';
COMMENT ON COLUMN sessions.started_at           IS '开始时间，统一按 UTC+8 存（单时区，不做时区换算）';
COMMENT ON COLUMN sessions.ended_at             IS '结束时间；为空 = 中途退出（B6 要求这种也存）';
COMMENT ON COLUMN sessions.duration_seconds     IS '对话时长（秒），墙钟时间，含停顿与 AI 说话时间（PRD §8.2）';
COMMENT ON COLUMN sessions.error_count          IS '错误次数 = 偏题条数 + 逻辑错误条数（PRD §8.3）；精彩句子不计入';
COMMENT ON COLUMN sessions.good_sentence_count  IS '精彩句子呈现次数 = 条数（PRD §8.2）';
COMMENT ON COLUMN sessions.turn_count           IS '本场总轮数（一轮 = 用户一次发言 + AI 一次回应）；跨场次累计在 practiceCount，两者不是一回事';
COMMENT ON COLUMN sessions.is_complete          IS '是否正常结束；false = 中途退出，数据仍要留（B6）';

COMMENT ON TABLE turns IS '轮次：一场会话的每一轮。Day 16 由 TECH_DESIGN §5.4 的内嵌 transcript 拆出';
COMMENT ON COLUMN turns.session_id   IS '所属会话；外键指向 sessions.session_id，删会话时连带删轮次';
COMMENT ON COLUMN turns.turn         IS '轮次序号，从 1 开始';
COMMENT ON COLUMN turns.user_text    IS '用户原句，一字不改。这是 B8「不编造原句」的唯一可信来源';
COMMENT ON COLUMN turns.ai_text      IS 'AI 的回应文字；前端再用 SpeechSynthesis 读出来（B2）';
COMMENT ON COLUMN turns.timestamp    IS '该轮开始的相对时间（毫秒，从会话开始算起），用于回放与排序';
COMMENT ON COLUMN turns.asked_follow_up IS '本轮 AI 是否做了追问';

COMMENT ON TABLE items IS '条目：偏题 / 逻辑错误 / 精彩句子，靠 type 区分。字段口径见 TECH_DESIGN §5.5';
COMMENT ON COLUMN items.item_id       IS '条目唯一标识，由后端生成';
COMMENT ON COLUMN items.session_id    IS '所属会话；外键指向 sessions.session_id';
COMMENT ON COLUMN items.topic_id      IS '所属主题。刻意冗余：记录页要「按主题筛选 + 时间倒序」，有它就能走索引一次命中，不必 join sessions';
COMMENT ON COLUMN items.type          IS '条目类型，只允许 offtopic / logic / good 三个值';
COMMENT ON COLUMN items.turn          IS '出现在第几轮（对应 turns.turn）';
COMMENT ON COLUMN items.original_text IS '用户原句，从 turns.user_text 原样取出，禁止 AI 重新生成（B8）';
COMMENT ON COLUMN items.reminder      IS '提醒：偏题说明偏离了哪一点，逻辑错误说明哪里不成立，精彩句子说明好在哪';
COMMENT ON COLUMN items.correction    IS '纠正：应该怎么说。偏题与精彩句子必须为 NULL，逻辑错误必须有值（B7）';
COMMENT ON COLUMN items.is_favorited  IS '收藏标记（F4）';
COMMENT ON COLUMN items.note          IS '备注，单行短文本，建议 ≤30 字';
COMMENT ON COLUMN items.favorited_at  IS '收藏时间，收藏区按它倒序；未收藏时为空';
COMMENT ON COLUMN items.created_at    IS '条目生成时间，记录页按它时间倒序（B19）';


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

-- =============================================================================
-- 附：MySQL → PostgreSQL 翻译对照（Day 16 实际改的每一处）
-- =============================================================================
-- 去掉反引号`             → PG 用不带引号的 snake_case（PG 会自动转小写）
-- INT UNSIGNED            → INTEGER+ CHECK >= 0      （8 处）
-- TINYINT(1)              → BOOLEAN + TRUE/FALSE     （3 处）
-- DATETIME                → TIMESTAMP（不带时区）    （4 处）
-- ENGINE=InnoDB CHARSET   → 删除（PG 不需要声明引擎与字符集）
-- 列内 COMMENT '…'        → COMMENT ON COLUMN/TABLE… （28 处抽成末尾一段）
-- 内联 KEY idx (…)        → CREATE INDEX idx… ON…    （5 处）
-- SET NAMES utf8mb4       → 删除（PG 默认就是 UTF8）
-- SET FOREIGN_KEY_CHECKS  → DROP TABLE … CASCADE（PG 没这个变量，靠 CASCADE 连带清空）
-- 反引号总数272 处、information_schema.DATABASE() → current_schema()
