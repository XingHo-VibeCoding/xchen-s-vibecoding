# Day 27 · 最高优先级修复 · 第 5 条（半句被截断提交）

> 对应反馈：`docs/day27-反馈与优先级.md` 第 5 条
> 用户拍板：**A 方案** —— 识别结果只填进输入框，**不再自动提交**，由用户点「我说完了」
> 改动范围：**1 个函数**（`frontend/pages/dialogue.html` 的 `onSpeechResult`）

---

## §1 提示词（要改什么 —— 可直接复制给未来的自己或另一个 AI）

```
【现象】
语音输入时，用户说到一半停顿约 3 秒，这句话就被自动提交成一条完整发言。
进入对话与后续判定的是被截断的半句话。

【根因（代码级，别猜）】
frontend/js/speech.js:69     SILENCE_END_MS = 2500   ← 连续静音 2.5 秒即判"说完了"，停止录音
frontend/pages/dialogue.html:1159  Speech.on('onResult', onSpeechResult)
frontend/pages/dialogue.html:1050  onSpeechResult() 把转写填进输入框后
frontend/pages/dialogue.html:1060  立刻调 submitSpeech() → 自动提交

用户感知的"3 秒" = 2.5 秒静音阈值 + 1~3 秒上传识别耗时。

【只许改这里】
frontend/pages/dialogue.html
  · onSpeechResult()（约 1050–1074 行）：删掉 submitSpeech() 那一行；
    转写改为「拼接进输入框」而不是覆盖；加一句提示告诉用户"还没发出去"。
  · submitSpeech()（约 1076–1088 行）：唯一调用方就是上面那一处，改完全仓无人调用 → 一并删除。

【不许动（碰了就是扩大范围）】
1. frontend/js/speech.js 的任何内容 —— 尤其 SILENCE_END_MS。
   它是"一轮录音何时结束"的判据，改它会改变录音节奏，与本条修复不是一件事。
2. form 的 submit 监听（dialogue.html:1461）—— 那是打字与语音共用的唯一提交入口，一行都不改。
3. 打字路径（input → 点「我说完了」）—— 它本来就是手动提交，是对的，别动。
4. userIsTyping / armSilence / clearSilence —— 沉默催话那一套与"提交"是两回事。
   armSilence 触发的是 aiSay('silence')，它**不会**提交用户的话（已核实，见 §5）。
5. 不要新增 CSS、不要改 main.css（那是四页共用的唯一样式表）。

【验收判据】
① 语音说完一段、停 3 秒 → 文字出现在输入框里，但**对话记录区不新增"你说"气泡**；
② 点「我说完了」→ 才出现气泡，且内容与输入框一致；
③ 打字路径不变：输入文字 → 点「我说完了」→ 正常提交；
④ 浏览器控制台 0 条报错；node regress.js 全过。

【已知残留（本次不修，写清楚以免被当成没修好）】
静音 2.5 秒仍会结束这一轮录音并重启，重启与识别期间（1~3 秒）麦克风是关的，
这期间说的话会丢。若复验后仍觉得"卡"，下一步是把 speech.js:69 的 2500 调到 4000（改动一行），
但那属于第二件事，需单独拍板。
```

---

## §2 实际改了什么

| 文件 | 位置 | 改法 |
|---|---|---|
| `frontend/pages/dialogue.html` | `onSpeechResult()` | 删 `submitSpeech()`；改拼接；加"还没发出去"提示 |
| 同上 | `submitSpeech()` | 整函数删除（唯一调用方已移除） |
| 同上 | 对话记录空态文案（约 93 行） | 删掉「直接开口就行，说完停一下系统会自动发出去。」 |
| 同上 | `VIEW.recording.hint`（约 421 行） | **整句删除**（改成 `hint: ''`），注释里留下原话与删除理由 |
| 同上 | `applyView()` 的 hint 赋值（约 458 行） | `hint` 为空时整行 `hidden` —— 只清文字会留一段空白（`.rec-hint` 是 `flex: 1 1 260px`） |
| 同上 | 语音接线段注释（约 903 行） | 「系统自动识别并提交」→「自动识别并填进输入框，提交由你点」 |

★ **为什么不止删你圈的那一句**：一共 3 处在说「会自动发出去」——你圈的 `hint`、
对话记录的**空态文案**（用户可见，2 处），再加代码注释里的一处。
只删一处会留下**自相矛盾**的页面（一处说自动发、一处说手动点），用户更困惑。
这三处都是**本次修复造成的**，不是顺手优化。如果你只想删那一处，回一句我就回退另外两处。

**没动**：`speech.js`、form submit 监听、`armSilence` 一套、任何 CSS、任何云函数。

### §2.1 改完之后的验证结果（都可复现）

| 查什么 | 命令 | 实跑结果 |
|---|---|---|
| 改动面 | `git diff --stat frontend/pages/dialogue.html` | `1 file changed, 38 insertions(+), 26 deletions(-)` |
| 内联 JS 语法 | 临时脚本 `new Function(内联 script)` | **1 块 / 1399 行 / 语法 OK** |
| 注释配对 | 同上，数 `/*` 与 `*/` | `/* = 117`，`*/ = 117` → **配对** |
| 自动提交是否真的没了 | 剥离注释后再搜 | 残留调用 **false** / 残留定义 **false** |
| 有没有把页面弄坏 | `cd frontend && node regress.js` | **【控制台】0 条报错**（每次都 0 条） |
| 通过数能不能当判据 | 同一份改动连跑三次 | **不能**：第 1 次 `0 通过 / 25 失败` → 第 2 次 `25 通过 / 0 失败` → 第 3 次被 `SIGTERM` 杀掉 |

### ★★ 更正一处我写错过的结论（第三次了，记下来）

我第一次看到「0 通过 / 25 失败」，又用 `git show HEAD:` 还原旧版跑一遍，也是 0/25，
就写成了「25 项是**既有 CSS/触控问题**，改动前后完全一致」。

**这个推断不成立** —— 第三次跑就变成 `25 通过 / 0 失败`。
那 25 项不是页面缺陷，是**测试环境不稳定**（headless 首次启动没等到布局就量尺寸）。

**教训**：拿一个**会随机失败**的指标做前后对比，两边"看起来一致"可能只是巧合。
本条的判据只有两个：**① 内联 JS 语法检查通过 ② 【控制台】0 条报错**。
`regress.js` 的通过数**不能**当判据 —— 这条本来就记在 `MEMORY.md` 里，今天又验证了一次。

★ **踩到一个自检坑，记下来**：第一次查"`submitSpeech` 还有没有调用"时，
正则命中了**我自己写在注释里的** `submitSpeech()` 字样 → 报了假阳性（true）。
改成**先剥注释再查**才为 false。
（教训：用正则查"某函数还有没有调用"，必须先剥注释，否则说明文会变成假阳性。）

---

## §3 最小复验任务（你做，5 分钟）

> 前提：语音得能用。`/api/speech-to-text` 路由现在**是 WEB_SCF**（`tcb routes list` 实测，2026-10-13 更新），
> 说明语音链路是通的 —— 这也是同伴能被截断的原因。若你的浏览器麦克风不通，
> 走 §3.4 的降级验法。

### 3.1 起服务（Git Bash）
```bash
cd /c/Users/26629/WorkBuddy/VibeCoding/frontend && python serve.py
```

### 3.2 三步验（打开 `http://localhost:8010/pages/dialogue.html?topic=T1`）

| 步 | 做什么 | 应该看到 |
|---|---|---|
| 1 | 点「🎙 开始说话」，说一句英语（比如 `We finished the first part last week`），**说到一半停 3 秒**，然后闭嘴 | 输入框里出现文字；**对话记录区没有新增"你说"的气泡**；提示条写「听到了，还没发出去」 |
| 2 | 点「我说完了」 | 这时才出现"你说"气泡，内容与输入框一致 |
| 3 | 接着说第二句、再点「我说完了」 | 第二句正常进对话，AI 正常回 |

### 3.3 打字回归（别把打字弄坏）
在第 3 步之后，直接用键盘打一句、点「我说完了」——应当照常提交。

### 3.4 麦克风不通时的降级验法
无法验语音，就只跑 3.3 + 下面这条代码核对：
```bash
git grep -n "submitSpeech" -- frontend/
```
**期望输出为空**（函数已删、调用已删）。这说明"没有任何路径会替用户自动提交语音"。

---

## §4 回滚

```bash
git revert <本次提交号>
```
或单独回退这个文件：
```bash
git checkout <修复前的提交> -- frontend/pages/dialogue.html
```

---

## §5 顺手更正一条过期记录

`MEMORY.md` 与 `docs/week4-acceptance.md §0` 一直记着「`speech` 路由类型是 `SCF`，网关不收，调不通」。
今天实测（`tcb routes list -e cxj1528-d4g55ng0o54cbe296`）：

```
/api/speech-to-text   WEB_SCF   speech   Enable   Path passthrough: Enable   2026-10-13T22:48:30+08:00
```

**它已经是 `WEB_SCF` 了** —— 语音是可用的。这条过期记录会让人误判"语音不可用"，
进而把"半句被截断"这种真实 bug 归因错。**已在本次修复中一并更正。**

---

## §6 附加：清空全部演示数据（用户 12:55 要求）

> 用户指令：「把项目中所有的假数据全删除，在开始使用项目后录入真数据」
> 这不是 6 条反馈之一，是同一轮追加的要求；改动与本次修复同批，所以记在这里。

### 6.1 删了什么（先盘点、后动手）

| 位置 | 内容 | 数量 |
|---|---|---|
| 数据库 `sessions` | `S-MOCK-01`~`05`、`S-DAY21-VERIFY`、`S-TEST-DAY20` | **7 行** |
| 数据库 `turns` | 全部属于上面 7 场 | **20 行** |
| 数据库 `items` | 属于其中 5 场（offtopic 2 / logic 2 / good 4） | **8 行** |
| `frontend/data/mock-sessions.json` | 首页「卡过」标记用的写死数据 | 整个文件 |
| `db/seed.sql` | `TRUNCATE` + 3 组 `INSERT` + 4.1~4.7 核对 `SELECT` | 312 行 → 改成「已停用」说明 |

★ **先确认「100% 是假的」才动手**：逐行看过导出的备份，
7 场会话没有一场是真人练出来的（昵称是「小陈 / 检查台 / Day21验收」），
所以清空**不会丢任何真人数据**。

### 6.2 不删就会坏的两处代码（必须一起改）

| 文件 | 为什么必须改 |
|---|---|
| `frontend/js/pages/topics.js` | 它 `fetch('../../data/mock-sessions.json')`；文件一删就 404，整个 `Promise.all` reject → **首页直接掉进错误态**。改法：`stuckMap`（「上次在这里卡过」）改为从 `GET /api/sessions` 的 `topicId` + `errorCount` 现场算 |
| `frontend/regress.js` | 注释从 Day 19 起就写着「错态**或空态**都算过」，但代码只认 `.state-error`。库一空，记录页的**正确空态**被判成失败（5 个宽度全红）。补上 `isEmptyState`，让代码与注释一致 |

### 6.3 删完之后的状态（已实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 三张表行数 | `select count(*) from …` | **0 / 0 / 0** |
| 公网读接口 | `curl -s "$B/api/sessions?limit=100"` | `{"ok":true,"data":{"sessions":[],"count":0},"error":null}` |
| 同上 items | `curl -s "$B/api/items?limit=100"` | `{"ok":true,"data":{"items":[],"count":0},"error":null}` |
| 首页概览 | 三个数字由上面两组数据算出 | 应为 **练过 0 次 / 问题 0 条 / 收藏 0 条** |
| 记录页 | 无条目 | 空态「还没有任何记录」+ 说明条「空态：本页已经取到数据，只是数据里一条记录也没有」 |
| 回归 | `cd frontend && node regress.js` | **25 通过 / 0 失败**，控制台 0 条报错 |

### 6.4 ★ 这一节的结论在同一天就被推翻了（保留原文作记录）

**当时的判断**：`writeSession` 的唯一调用方是检查台（`status.js:314/333`），
对话页与结果页都没有写库调用 → 「库是空的，练一场也不会多出一行」。

**接下来的事**：用户当轮就说「现在做，让用户说完就可以接入真数据」→
写库在**结果页**接上了，端到端实测通过。**详见 §7。**

### 6.5 怎么退回去

```bash
# Git Bash：找回原来的种子脚本（含全部演示数据）
cd /c/Users/26629/WorkBuddy/VibeCoding
git show v1.0:db/seed.sql > db/seed.sql
```

然后在 CloudBase 控制台 SQL 编辑器里执行它（会先 TRUNCATE 再重新灌入）。
数据库的**删除前快照**：`.deploy/backups/db/20261017-{sessions,turns,items}.json`（7 / 20 / 8 行）。

---

## §7 接入真数据：练完即落库（用户 13:08 要求）

### 7.1 写在哪、为什么

**写在结果页（`result.html`），`analyze` 出结果之后。**

理由：接口要的 `items` 来自 `/api/analyze` 的判断结果，而 analyze 是**结果页**调的。
在对话页写，就只能先写空 items 再想办法补 —— 两次写、还可能补不上。
一次 POST 写全三张表（后端是三步请求 + 补偿删除，Day 18 就实现了）。

时序：

```
点「结束对话」
  → 整场转写存进 localStorage（take 语义：取出即删）
  → 跳 result.html（★ 新增两个参数 start / end，ISO 8601 +08:00）
  → 结果页调 /api/analyze
  → paint(issues, goods)            ← 先让用户看到结果
  → saveSessionToDb(issues, goods)  ← 一次 POST 落三张表
```

### 7.2 改了哪三个文件

| 文件 | 改动 |
|---|---|
| `frontend/pages/dialogue.html` | 加 `isoLocal()`；结束对话时多传 `start` / `end`。`startedAt` 用「现在 − 已练秒数」反推，与 `dur` **自洽**（后端按 `endedAt − startedAt` 算时长，暂停的时间不会被算进去） |
| `frontend/pages/result.html` | 加 `saveSessionToDb()`；「本次数据」卡片后加 `#save-bar` 提示条；刷新时若地址带 `session` 参数，明确说「已存库，去记录页看」 |
| — | `api.js` 的 `writeSession` Day 20 就有，**一行没改** |

**没动**：`speech.js`、`item-card.js`、任何 CSS、任何云函数。

### 7.3 端到端实测（真跑一场，不是手写 INSERT）

用无头 Chrome 走**产品自己的按钮与提交入口**跑了一场（`topic=T1`，两句台词）：

结果页提示：**「这一场已经存进数据库：2 轮对话、2 条问题/精彩句子。去「错误记录」页能看到。」**

库里立刻出现：

| 表 | 内容 |
|---|---|
| `sessions` | `S-20261017131208-7ilu` / T1 / turn_count=**2** / error_count=**1** / good=**1** / duration=**32 秒** / is_complete=**true** |
| `items` | `…-O1` **offtopic**「By the way, the coffee machine…」<br>`…-G2` **good**「We finished the first part las…」 |

★ 两个细节值得记：
- `original_text` 是后端按 `turn` 从 `transcript` **取回的完整原句**，不是前端传的 —— 与契约「决定 2」（防编造原句）一致
- 地址栏被 `replaceState` 补上了 `session=S-…`，刷新时能据此说清「已存库」

### 7.4 失败与边界

| 情况 | 行为 |
|---|---|
| 写库失败（网络 / DB） | 结果照常显示 + 提示条标红 + 给「重试保存」按钮。**重试沿用同一个 `sessionId`** —— 万一第一次其实成功了（只是响应丢了），第二次会拿到 `DUPLICATE` 而不是写两行 |
| 直接打开结果页（地址没有 `start`） | **不写库**，提示「地址里缺开始时间」。不编一个时间糊过去，否则库里会多一条「根本没发生过」的场次 |
| 转写为空（没说话就点结束） | 不写库（接口要求 `transcript` ≥ 1 轮） |
| analyze 失败（degraded） | **照样写库**：`sessions` / `turns` 该留下（练习确实发生了），只是 `items` 为 0 条 |
| 刷新结果页 | 仍显示「没有这一场的对话内容」（转写 take 的语义），但会说明「已存数据库，去错误记录页看」—— 数据没丢 |

### 7.5 还剩的缺口（今天不动）

1. **结果页刷新后看不到条目本身** —— 数据在库里，但要重建「这一场的结果视图」得新增「按 sessionId 查一场」的读接口。今天只做到「说清它没丢」。
2. **昵称没接** —— `topics.html` 的昵称输入框没有保存逻辑（`storage.js:14` 写明「nickname 键暂不涉及」），所以写库时 `nickname` 传空。契约允许为空。

### 7.6 验证命令

```bash
# Git Bash
cd /c/Users/26629/WorkBuddy/VibeCoding && cd frontend && node regress.js
# 期望：25 通过 / 0 失败，【控制台】0 条报错

# 看一下库里现在有什么（只读）
cd /c/Users/26629/WorkBuddy/VibeCoding
tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select session_id, topic_id, turn_count, error_count, good_sentence_count, duration_seconds from sessions" --json
```
