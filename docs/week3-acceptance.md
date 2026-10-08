# 第 3 周（Day 15–21）周验收表

> 编制：Day 21｜编制日期：2026-10-08
> 判定口径：**PASS** = 有可复现命令且实跑通过；**FAIL** = 跑了但结果不符；
> **未执行** = 本周没做或没验，如实标出、不用别的说法遮盖。
> 复现命令里的 `B` 统一指：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com`
> （定义见 `frontend/js/api.js:53`，是前端访问后端的唯一出口）

---

## 一、总览

| # | 验收项 | 对应本周产出 | 判定 |
|---|---|---|---|
| 1 | schema / seed 脚本 | `db/schema.sql`、`db/seed.sql`、`db/steps/` | **PASS** |
| 2 | GET / POST 公网接口 | `cloudfunctions/{health,read,write}` | **PASS** |
| 3 | 分层重构 | `repositories/` 五个文件 | **PASS** |
| 4 | 公网检查台 URL | `frontend/pages/status.html` | **PASS**（用户 Day 21 已人眼确认为控制台内容） |
| 5 | api-contract.md 完整性 | `docs/api-contract.md`（1336 行） | **PASS**（附一处需订正的数字，见 §5备注） |
| 6 | 同伴交叉验证 | 三行结论 | **部分执行**（打开 ✅ / 真实读写 ⚠️ / 报错 ✅，见 §4.1） |

---

## 二、逐项证据

### 项1｜schema / seed 脚本 —— PASS

**验证方法**：数文件、定位建表与索引行号、用读接口反查库里真实行数。

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
grep -nE "CREATE TABLE|CREATE INDEX" db/schema.sql
ls -1 db/steps/
curl -s "$B/api/sessions?limit=100" | grep -o '"count":[0-9]*'
```

**实跑输出**：

```
52:CREATE TABLE sessions (
95:CREATE INDEX idx_sessions_topic_time ON sessions (topic_id, started_at);
106:CREATE TABLE turns (
140:CREATE TABLE items (
192:CREATE INDEX idx_items_session ON items (session_id);
196:CREATE INDEX idx_items_topic_time ON items (topic_id, created_at);
197:CREATE INDEX idx_items_time ON items (created_at);
200:CREATE INDEX idx_items_fav ON items (is_favorited, favorited_at);
```

- 三张表 `sessions` / `turns` / `items` 全在（`db/schema.sql` 第 52 / 106 / 140 行），五条索引（第 95 / 192 / 196 / 197 / 200 行）。
- `db/schema.sql` 共 276 行、`db/seed.sql` 312 行、`db/steps/` 11 个分批脚本（`schema-1`～`schema-6`、`seed-1`～`seed-5`），可整块粘进控制台 SQL 编辑器。
- 落库验证：`GET /api/sessions?limit=100` 返回 `"count":6` = 种子 5 场（`S-MOCK-01`～`05`）+ Day 21 验收写入 1 场（见项 2）。
- 种子行 `S-MOCK-01` 的字段与 `db/seed.sql` 一致（`errorCount:2` / `goodSentenceCount:1` / `turnCount:4`）。

> ⚠️ `db/selftest-read.js` 现在报错：`TypeError: Cannot read properties of null (reading 'slice')`（第 53 行）。
> **根因**：它的假数据还是 camelCase（`sessionId`/`startedAt`），Day 18 起 `shapeSession` 已改成读
> snake_case（`cloudfunctions/read/index.js:134-149` 的 `row.session_id`），取不到值 → `iso(undefined)`
> 返回 null → `.slice()` 炸。**属Day 18 遗留问题，不是本项产出**，按今日清单「不顺手修复与验收无关的问题」
> 记入第4 周待办。

---

### 项 2 ｜ GET / POST 公网接口 —— PASS

**验证方法**：对公网基址跑三个 GET + 一个 POST，再重新 GET 确认写入持久化，最后重复 POST 确认约束生效。

```bash
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
curl -s "$B/api/health";curl -s "$B/api/sessions?topicId=T1&limit=20"
curl -s "$B/api/favorites?limit=3"
curl -s -X POST "$B/api/sessions/write" -H "Content-Type: application/json" --data-binary @body.json
```

**实跑输出（2026-10-08）**：

| 调用 | HTTP | 关键返回 |
|---|---|---|
| `GET /api/health` | 200 | `{"ok":true,"service":"TalkTrainer"}` |
| `GET /api/sessions?limit=3` | 200 | 3 条真实库行：`S-MOCK-01`/`02`/`03`，字段为 camelCase |
| `GET /api/favorites?limit=3` | 200 | 3 条已收藏条目，含 `correction` / `note` / `favoritedAt` |
| `POST /api/sessions/write` | 200 | `turnsStored:2, itemsStored:1, itemsDropped:0`，`durationSeconds:200`、`errorCount:1` |
| 写入后重跑 `GET /api/sessions?topicId=T1` | 200 | **读得到 `S-DAY21-VERIFY`** 与 `nickname:"Day21验收"` →持久化成立 |
| 重复提交同一 `sessionId` | **400** | `{"ok":false,"error":{"code":"DUPLICATE","message":"这场对话已经存过了（同一个 sessionId 只能存一次）"}}` |

**写入内容**（验收记录，可删）：
`sessionId=S-DAY21-VERIFY`、`topicId=T1`、`startedAt=2026-10-08T09:00:00+08:00`、2 轮转写、1 条 logic 条目。

**结论**：读得到、写得进、刷新后还在、重复提交被拦住 —— 四项都成立。

---

### 项 3 ｜ 分层重构 —— PASS

**验证方法**：证明「接口层里没有 SQL」+「接口层确实调repository」两件事都成立。

```bash
for f in cloudfunctions/read/index.js cloudfunctions/write/index.js; do
  echo -n "$f SQL行数="; grep -cE "SELECT |INSERT INTO" "$f"; done
grep -nE "require\('\./repositories" cloudfunctions/read/index.js cloudfunctions/write/index.js
wc -l cloudfunctions/*/repositories/*.js
```

**实跑输出**：

```
cloudfunctions/read/index.js    SQL行数=0
cloudfunctions/write/index.js   SQL行数=0

read/index.js:47   const sessionsRepo = require('./repositories/sessionsRepository');
read/index.js:48   const itemsRepo    = require('./repositories/itemsRepository');
write/index.js:104 const sessionsRepo = require('./repositories/sessionsRepository');
write/index.js:105 const turnsRepo    = require('./repositories/turnsRepository');
write/index.js:106 const itemsRepo    = require('./repositories/itemsRepository');
```

- SQL 只存在于两处：`read/repositories/sessionsRepository.js`、`read/repositories/itemsRepository.js`（各 1 条 SELECT）；`write` 侧三个 repository 只做行对象构造（`turnsRepository.js` 的 `buildTurnRows`），写入统一走 `httpdb.js`。
- repository 层共 5 个文件、310 行：`read` 2 个（51+75行）、`write` 3 个（68+66+50 行）。
- 拆分设计说明在 `docs/layering-day19.md`（185 行），含「换一个需求时这段代码会不会跟着变」这条判定标准。

**回归未受影响**（分层属后端，但仍跑了前端回归）：

```bash
cd frontend && python serve.py   # 另开终端
node regress.js
```

→ `===== 结果：25 通过 / 0 失败 =====`、控制台 0 条报错（四页+ 检查台 × 五断点 = 25 项）。

---

### 项 4 ｜ 公网检查台 URL —— PASS

**验证方法**：`curl` 取页面并**比对 title 与正文关键词**（不能只看状态码，见下方「为什么必须人眼确认」）；再由用户在真实浏览器里确认一次。

```bash
curl -s "$B/pages/status.html" | grep -oE "<title>[^<]*</title>"
curl -s "$B/pages/topics.html" | grep -oE "<title>[^<]*</title>"
curl -s "$B/pages/status.html" | grep -c "检查台"
```

**实跑输出**：

```
<title>检查台 · 口语对话实战器</<title>      # status.html
<title>主题列表 · 口语对话实战器</title>        # topics.html
正文命中「检查台」5 处
```

**URL**：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/pages/status.html`

> ★ **为什么命令行绿灯不能单独判 PASS**：CloudBase 会拦带 `Sec-Fetch-Mode: navigate` 的请求，
> 返回标题为「风险提醒」的 404 页，**而 HTTP 状态码仍是 200**。所以只看状态码会把拦截页
> 当成正常页。curl 不带这个头，因此命令行这次拿到的是真页面（title 已比对）。
> ✅ **用户 Day 21 已在真实浏览器打开确认：是控制台内容**（非拦截页）→ 本项判 PASS。

---

### 项 5 ｜ api-contract.md 完整性 —— PASS

**验证方法**：数章节、列出全部接口、把契约错误码清单与代码实际错误码**双向交叉比对**。

```bash
grep -nE "^## " docs/api-contract.md          # 章节与接口
awk 'NR>=108 && NR<=195' docs/api-contract.md | grep -oE "^\| *\`[A-Z_]{3,}\`" | grep -oE "\`[A-Z_]{3,}\`" | tr -d '`' | sort -u > /tmp/codes_contract.txt
grep -rohE "'(LLM_[A-Z_]+|DB_[A-Z_]+|DUPLICATE|INVALID_JSON|INVALID_PARAMS|INTERNAL_ERROR|METHOD_NOT_ALLOWED|NOT_FOUND|PAYLOAD_TOO_LARGE)'" cloudfunctions/ | tr -d "'" | sort -u > /tmp/codes_code.txt
comm -23 /tmp/codes_contract.txt /tmp/codes_code.txt   # 契约有、代码无
comm -13 /tmp/codes_contract.txt /tmp/codes_code.txt   # 代码有、契约无
```

**实跑输出**：

- 文档 1336 行，10 个二级章节，接口逐个标了实现状态：
  `GET /api/health` ✅（第 223 行）／`GET /api/sessions`+`/api/favorites` 🟡（第 267 行）／
  `POST /api/chat` 🟢（第 438 行）／`POST /api/analyze` 🟢（第 556 行）／
  `POST /api/sessions/write` 🟢（第 709 行）／`POST /api/speech-to-text` ⚪（第 886 行，本期不启用）。
- 响应外壳只有一套（`{ok, data, error:{code,message}}`），`§1.3` 明确 `data` 恒为 `null` 于失败时。
- **错误码双向比对：契约 20 个 vs 代码 20 个，逐个一致**（`comm` 两侧均无输出）。
  - 扫码要抓两种写法：`sendError(res, …, 'CODE', …)` 与 `e.code = 'CODE'`。
    只grep 前者会漏掉 `LLM_TIMEOUT` / `PAYLOAD_TOO_LARGE`。
  - `DB_*` 4 个码不在 `index.js` 而在 `read/httpdb.js:84,88,128,131,135,139,142` ——
    属正常，它们由数据访问层抛出、接口层原样转出。

> ⚠️ **需订正的一处数字**：`§1.4` 正文写「下面三张表合计 **20 个码**」，
> 与表内实际列出的 20 行一致 ✅；但同段上文「此前只列了 6 个，实际实现了 21 个」
> 说的是**Day 19 当时的数**，Day 18 调整后是 20 个。两句放在一起容易读成矛盾。
> **这不是缺漏，是叙述顺序造成的歧义** —— 按今日清单不在验收日改文档，记入第 4 周文案订正。

---

## 三、本周未完成项（如实列出，不算失败）

| 项| 状态 | 原因 |
|---|---|---|
| `POST /api/favorites`（收藏写入）与 `PATCH 收藏与备注` | **未实现** | 契约里仍是预留；`frontend/js/storage.js` 的 `itemIdOf()`存在撞键问题，要先解|
| `frontend/js/speech.js`（语音转写） | 未实现 | `POST /api/speech-to-text` 契约标⚪ 本期不启用；本期用文本框代替 |
| 首页主题卡「上次在这里卡过」标记 | **仍是 mock** | `GET /api/sessions` 只给合计 `errorCount`，标记要的是分项（偏题 vs 逻辑错误），需给 items 表加全量查询接口 —— 清单外，未做 |
| P2 空态 / P3 加载态 | 未做 | 排在第 4 周 |
| **AI 连问不停（同伴实报）** | **疑似 bug，未修** | 同伴反馈「这个 AI 问个不停，都不等我回答一直问」。疑在 `dialogue.html:464-474` 的 `armSilence()` 循环未停住。**第 4 周第① 优先项，且是演示风险点** |
| `Sec-Fetch-Mode` 拦截机制来源 | 未查清 | Day 20 遗留。不影响本环境交付，换域名可能复发，值得查一次官方文档 |
| `db/selftest-read.js` | **报错** | Day 18 遗留：假数据还是 camelCase，`shapeSession`（`read/index.js:134-149`）已改读 snake_case → 取不到值 → `iso(undefined)` 返回 null → 第 53 行 `.slice()` 炸 |

---

## 四、同伴交叉验证（三行结论模板）

> 本节**必须由同伴本人填写**。我不代填、不推测。
> 同伴只需打开下面两个地址、做三件事，然后把三行结论发回。

**给同伴的地址**：
- 首页：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/pages/topics.html`
- 检查台：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/pages/status.html`

**请同伴回的三行**（照抄这个格式回，不要写成一段话）：

```
能否打开：______ ｜依据：______（打开的哪个地址 + 看到了什么）
能否真实读写：______ ｜依据：______（在哪做了什么改动 + 刷新后看到什么）
有无报错：______ ｜依据：______（控制台或页面报了哪条原文，或「无」）
```

**判定口径**（同伴自己判，不用来问我）：

| 结论 | 算通过的样子 | 不算通过 |
|---|---|---|
| 能否打开 | 两个地址都出内容，不是「风险提醒」页| 只说「能打开」，说不出看到什么 |
| 能否真实读写 | 在检查台改一条数据 → 刷新 → 改动还在；或点「结束对话」存一场 → 记录页能读到 | 只看了静态内容，没做任何改动 |
| 有无报错 | F12 控制台 0 条报错 | 有报错但「应该是正常的」 |

---

### 4.1 同伴回的三行结论（已回收）

**回收时间**：2026-10-08｜**判定**：**部分执行**（用户 Day 21 选定口径 A）

| 结论 | 判定 | 同伴原话 | 核实后是否采信 |
|---|---|---|---|
| 能否打开 | ✅ **PASS** | 「能打开，看到了检查台页面，应该能读吧」「第三个也能打卡能读」 | ✅ 采信。与开发者 curl 取到的 title「检查台 · 口语对话实战器」一致，非「风险提醒」拦截页 |
| 能否真实读写 | ⚠️ **部分执行** | 「写不了，他说不算报错」「第三个也能打卡能读，能写」 | ⚠️ 部分采信，**见下方两点** |
| 有无报错 | ✅ **PASS** | 「他说不算报错」 | ✅ 采信（无F12 红色报错） |

#### ⚠️ 「能真实读写」为什么不是 PASS —— 两个要说清的地方

**① 同伴写的「能写」是写 localStorage，不是写数据库。**
记录页的收藏/取消收藏（`frontend/pages/records.html:252` 调 `window.Storage.toggleFavorite`）
存的是浏览器本地的 `favoriteItems` 键（`frontend/js/storage.js`），
**换一台电脑打开就没有了**。这跟验收项 2 要求的「写进 PG、刷新后还在」不是一回事。

**② 同伴没有做「改数据库 → 刷新 → 改动还在」这个动作。**
他没权限改数据库，所以核心动作没做 —— 不是他不愿意，是没条件。
按 AGENTS.md「缺项如实标记，不要模糊处理」，本项**不判 PASS**。

#### ✅ 但写数据库的能力，开发者侧已独立验过（不依赖同伴）

见§二项 2：公网 POST 写入 `S-DAY21-VERIFY` → HTTP 200 → 重新 GET 读回→ 重复提交 400 `DUPLICATE`。
**同伴没验成的这一环，开发者用curl 验成了** —— 两者不冲突，如实并列。

#### ⚠️ 同伴额外报了一个真问题（已记入第 4 周待查）

> **「这个 AI 问个不停，都不等我回答一直问」**

这不是同伴不会用，**是疑似真bug**。按 PRD §6.6，AI 说一句就该停下等用户；
代码里 `armSilence()`（`frontend/pages/dialogue.html:464-474`）设计的是
「沉默满5 秒（FREE）/ 8 秒（8 主题）才催一句」，且**必须在 `state === 'recording'` 时才起表**。
但同伴的体感是「一直问」，说明这个循环在实跑中没停住。

**今天不修**（今日清单：不修与验收无关的问题），记为第 4 周第①优先项。
⚠️ **演示风险**：第②段「核心流程」要现场跑对话，这个现象若复现会影响演示效果，
演示时注意观察或先备一句「这是已知问题」。

**回填状态**：✅ 已回收 → 上表第 6 项已从「未执行」改为 **部分执行**。

### 4.2 明天补做（可选，不做也不阻塞交付）

若要让第 6 项拿满三分，需要**有数据库权限的人**补做一次：
检查台改一条记录的 errorCount → 刷新 → 数字跟着变 →回三行。
（开发者已用 curl 代验，见上文；这一步是为了让「同伴三行」也拿满。）

---

## 五、演示提纲（3–5 分钟）

> 完整版见 `docs/day21-demo-outline.md`（同日另一份文件）。此处只留四段骨架，
> 供截图用（截图要含「用户问题 → 核心流程 → 提示词改写 → 验证方式」四段结构）。

| 段 | 时长 | 讲什么 | 屏幕上给什么证据 |
|---|---|---|---|
| ① 用户问题 | 30s | 有英语基础但一开口就卡住的人，缺练习伙伴；市面上app 要么不给反馈，要么只判「对/错」 | PRD 目标用户段 + 8 个主题卡 |
| ② 核心流程 | 2min | 选主题 → AI 先开口 → 文本框对话 → 结束对话 → **真实落库** → 记录页读到 | POST 200返回体 + 刷新后 GET 到 `S-DAY21-VERIFY` |
| ③ 提示词改写 | 1.5min | analyze 提示词从「泛判对错」改成「按 F2 边界：偏题只提醒、逻辑错误才纠正」；附 FREE 对照 | `analyze/index.js:244` `systemPromptFor()` + T1/FREE 两次真实返回 |
| ④ 验证方式 | 1min | 210 项单测、25 项回归、公网 curl 四件套 | `regress.js` 25/0 + `.test-write.js` 118/0 |
| ⑤ 未完成项 | 20s | 语音转写、收藏写接口、「卡过」标记仍 mock | — |

**四段结构齐了**（截图要求：用户问题 → 核心流程 → 提示词改写 → 验证方式），
第⑤ 段是追加的诚实说明。

**已完整走通一遍**，9 个入口全部实测存在：

| 提纲里写的入口 | 实测 |
|---|---|
| `pages/topics.html` 公网可达 | ✅ HTTP 200，title「主题列表 · 口语对话实战器」 |
| `POST /api/sessions/write` 真实写入 | ✅ 200，`turnsStored:2, itemsStored:1` |
| 写入后刷新读回 | ✅ `GET /api/sessions?topicId=T1` 读到 `S-DAY21-VERIFY` |
| 重复提交被拦 | ✅ 400 `DUPLICATE` |
| `POST /api/analyze` T1 模式 | ✅ 200：logic **给了** correction、offtopic `correction:null` |
| `POST /api/analyze` FREE 模式 | ✅ 200：`issues:[]` |
| `analyze/index.js` 提示词段 | ✅ `systemPromptFor()` 在第 244 行 |
| `regress.js` | ✅ 25 通过 / 0 失败 |
| `.test-write.js` | ✅ 118 项通过 |