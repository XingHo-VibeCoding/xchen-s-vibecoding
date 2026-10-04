-- ============================================================
-- schema.sql · 第 5-字段注释 批：COMMENT ON × 31（3 张表 + 28 列）
-- 来自 db/schema.sql，可整块复制粘贴到控制台 SQL 编辑器执行
-- 执行完应该看到：Query OK（注释不影响功能，失败可跳过）
-- ============================================================


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
