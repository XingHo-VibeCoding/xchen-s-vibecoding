# Day 21 演示提纲（3–5 分钟）

> 用途：第3 周收尾演示 / 打卡截图第三张
> 编制：2026-10-08｜所有命令与返回体都是当日实跑结果，可原样复制复现
> 配套：`docs/week3-acceptance.md`（周验收表）

**全程4 段，共约 5 分钟**（第③段最长，因为提示词改写是本周唯一"改了判断逻辑"的地方）。
每段末尾标了「屏幕上给什么证据」，截图时对着取。

---

## 段① 用户问题（30 秒）

**讲什么**

目标用户不是英语零基础，而是**有英语基础、但一开口就卡住的人**（CEFR A2–B2）。
痛点不是"不会"，是**没有搭子、没有时间、开口前不知道该说什么**。

现有app 的两种做法都不对：
- 只给「对/错」→ 练习的人知道自己错了，但不知道怎么改；
- 给一整套语法课程 → 那是教材，不是即兴对话的陪练。

**所以这个产品的口径是**（PRD 一律为准）：
- 场景限定**职场即兴英语对话**：A 组会议上 T1–T5 / B 组同事间 T6–T8，外加 F6 自由对话；
- **F2 边界是硬口径**：偏题**只提醒不给改法**；逻辑错误**提醒 + 纠正**（只理顺说法、不改原意）；
- **AI 台词一律英语**，中文只在页面说明里。

**屏幕上给什么证据**

打开 `pages/topics.html`（公网），让镜头扫过 8 张主题卡 + 自由对话入口。
这是最直观的一页——不需要解释，主题名本身就是场景。

---

## 段② 核心流程（2 分钟，含一次真实写入 + 刷新持久化）

**讲什么**（按这个顺序走，每步都有实跑过的返回体）

1. **选主题 → 进对话。** 8 个主题一进场AI 就先说 `opening`；自由对话不先说话，等 5 秒沉默才开口。
2. **对话中。** AI 台词是英语，追问分中文意图（`followUps`，给模型当范围约束）和英语台词（`followUpsEn`，显示在气泡里）两套，不能混用。
3. **结束对话 → 整场落库。** 一次 POST 写三张表：`sessions`（汇总）+ `turns`（逐轮）+ `items`（条目）。
4. **刷新页面 → 数据还在。** 这一步是本段的重点，必须现场做给看。

**演示命令（照抄可跑）**

```bash
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"

# ① 写入一场
curl -s -X POST "$B/api/sessions/write" \
  -H "Content-Type: application/json" --data-binary @body.json
```

实跑返回（HTTP 200）：

```json
{"ok":true,"data":{"session":{"sessionId":"S-DAY21-VERIFY","topicId":"T1",
"nickname":"Day21验收","durationSeconds":200,"errorCount":1,"turnCount":2,
"isComplete":true,"aborted":false},"turnsStored":2,"itemsStored":1,"itemsDropped":0},
"error":null}
```

```bash
# ② 刷新后重新读—— 读得到才叫真持久化
curl -s "$B/api/sessions?topicId=T1&limit=20" | tr ',' '\n' | grep S-DAY21-VERIFY
```

实跑输出：`"sessionId":"S-DAY21-VERIFY"` ✅

**一个值得当场讲的细节**（能体现"真实"而不是"假数据"）：

重复提交同一场会返回 **400 `DUPLICATE`**，且**行数不变**——不会留下半场数据。

```bash
curl -s -X POST "$B/api/sessions/write" -H "Content-Type: application/json" --data-binary @body.json
# {"ok":false,"error":{"code":"DUPLICATE","message":"这场对话已经存过了（同一个 sessionId 只能存一次）"}}
```

**屏幕上给什么证据**

写入返回体 + 刷新后读到的 `S-DAY21-VERIFY`。截图里要能看到两处（写入返回 + 刷新读出），
最好再带公网地址栏。

---

## 段③ 提示词改写过程（1.5 分钟，本段是重点）

**讲什么**

这是本周唯一改了「判断逻辑」的地方——`cloudfunctions/analyze/index.js` 的 `systemPromptFor()`
（第 244 行起）。

**第一版错在哪**

我原本理解成「契约要求原文由后端取回，所以**模型碰不到原句**」，
于是提示词里连内容都不给，只发 `turn 1: [user spoke]` 这样的空标签。

**实测结果**：模型返回 `issues: []`，并把几乎每一轮都塞进 `goodSentences`——
连`I really like the coffee machine on the third floor`（明显偏题）
和 `We have some issues but I think it's ok`（自相矛盾）都被当成亮点夸。

**根因**：**判断的前提就是看到内容。** 无内容可判时，模型的唯一合理解读就是
「既然没看出问题，那就都是好句子」。

**改法**：约束从「输入侧封锁」改成「输出侧覆盖」——
给模型看原句，但最终产出一律用后端从 `transcript[].userText` 取回的原文覆盖
（`normalizeIssue` 根本不看模型可能多回的 `originalText`）。
**目标是同一个：用户看到的必须是他自己说过的话。**

**改完之后的真实效果（现场跑给你看）**

```bash
curl -s -X POST "$B/api/analyze" -H "Content-Type: application/json" \
  --data-binary @analyze-t1.json
```

实跑返回（HTTP 200，节选）：

```json
{"issues":[
  {"type":"logic","turn":2,"originalText":"The backend part, but it is fine.",
   "reminder":"说“落后两天”后又用“it is fine”淡化问题，前后自相矛盾。",
   "correction":"The backend part is where we are behind, and it needs attention."},
  {"type":"offtopic","turn":3,"originalText":"I really like the coffee machine on the third floor.",
   "reminder":"讨论 API 发布进度时突然聊咖啡机，偏离了当前话题。",
   "correction":null}],
 "goodSentences":[{"turn":1,...},{"turn":4,...}],
 "noIssueFound":false,"model":"deepseek-chat"}
```

↑ **这一次返回把 F2 边界的两侧都演示了**：
- `turn 2` 逻辑错误 → **给了** `correction`（提醒 + 纠正）
- `turn 3` 偏题 → `correction` 是 **`null`**（只提醒、不给改法）

>为什么偏题一定不给改法、且不靠模型自觉：
> 后端在 `normalizeIssue` 里**强制**把偏题的 `correction` 置 `null`（第 384 行）。
> FREE 模式更进一步**强制丢弃所有 offtopic 条目**（第 375 行），
> 因为自由对话没有锚点，无从判断偏题。
> 这三条约束放在后端而不是前端，理由是：前端过滤会让「偏题条目确实被生成过」
> 这个事实留在链路里，换前端或加导出功能时它就漏出来了。

**FREE 模式的对照（10 秒，顺手跑一下更有说服力）**

```bash
curl -s -X POST "$B/api/analyze" -H "Content-Type: application/json" --data-binary @analyze-free.json
```

实跑返回：`{"issues":[],"noIssueFound":true,...}` —— 同一句自相矛盾的
`I read the log more carefully. It is fine now.`，
在 T1 里被判逻辑错误，在 FREE 里**不判偏题也不判逻辑**（按 PRD：FREE 只判逻辑错误/精彩句子）。
**同一段输入、两种模式、两种判法** —— 这是口径落到代码的证据。

**屏幕上给什么证据**

`analyze/index.js` 的提示词段（第 244–296 行）＋ 上面两次真实返回的对比。
截图要能看出四段结构里的第③段是「提示词改写」。

---

## 段④ 验证方式（1 分钟）

**讲什么**

三层验证，从便宜到贵：

| 层 | 手段 | 结果 |
|---|---|---|
| 单测 | 5 个脚本，`.test-*.js` | **210 项全通过**（18 + 19 + 33 + 22 + 118） |
| 前端回归 | `frontend/regress.js`（4 页 + 检查台 × 5 断点） | **25 通过 / 0 失败**，控制台 0 报错 |
| 公网实测 | curl 四件套 | 3 个 GET + 1 个 POST 全 200，写入后可读回 |

**演示命令（挑一条跑即可）**

```bash
cd frontend && python serve.py    # 另开一个终端
node regress.js                   # → 25 通过 / 0 失败

node .test-write.js               # → 通过 118 项，失败 0 项
```

> 单测这个做法是实测过有用才留的：它抓出过 `mapItem` 的 type 兜底bug、
> 以及「截断后 turn 编号不连续」这个端到端测不出来的问题。

**诚实说明（这段一定要讲）**

命令行绿灯 ≠ 公网可用。CloudBase 会拦带 `Sec-Fetch-Mode: navigate` 的请求，
返回标题「风险提醒」的 404 页，**HTTP 状态码还是 200**。
所以公网这一项必须人眼确认过一次才算数——本周已确认。

**屏幕上给什么证据**

`regress.js` 的 `25 通过 / 0 失败` 尾行 + 单测的 `通过 118 项，失败 0 项`。
截图里要带上公网地址栏（无头浏览器截不到，得手动截）。

---

## 段⑤ 本周未完成项（20 秒，如实说）

演示不说未完成项会显得不诚实，而且评委一定会问。直接过：

| 项| 状态 | 一句话原因 |
|---|---|---|
| 语音转写 `speech.js` | 未做 | 本期用文本框代替；`/api/speech-to-text` 契约标⚪ 本期不启用 |
| `POST /api/favorites` / 收藏备注 PATCH | 未做 | 契约里仍是预留；`storage.js` 的 `itemIdOf()` 有撞键问题要先解 |
| 首页主题卡「上次在这里卡过」标记 | **仍是 mock** | `GET /api/sessions` 只给合计 `errorCount`，标记要的是分项（偏题 vs 逻辑错误），需要给 items 表加全量查询接口 —— **清单外，未做** |
| P2 空态 / P3 加载态 | 未做 | 排在第 4 周 |
| **AI 连问不停**（同伴 Day 21 实报） | **疑似 bug，未修** | 同伴原话「这个 AI 问个不停，都不等我回答一直问」。按 PRD §6.6 AI 说一句就该停下等用户；疑在 `dialogue.html:464-474` 的 `armSilence()` 循环没停住。**演示时留意这一点，见下方提醒** |
| `db/selftest-read.js` | 报错 | Day 18 遗留：假数据还是 camelCase，`shapeSession` 已改读 snake_case。本周不修，记入第 4 周 |

> ⚠️ **演示前必看**：同伴实报「AI 连问不停」。第②段要现场跑对话，
> **如果这个现象复现，别硬解释成「这是故意的」** —— 直接说
> 「这是同伴发现的已知问题，已记进第 4 周第① 优先项，原因是沉默计时器的循环没停住」。
> 承认已知问题比现场圆过去可信得多，而且这个问题本来就该由演示者主动说出来。

---

## 全程时间预算

| 段 | 时长 | 累计 |
|---|---|---|
| ① 用户问题 | 0:30 | 0:30 |
| ② 核心流程（含真实写入 + 刷新） | 2:00 | 2:30 |
| ③ 提示词改写（含两次真实返回对比） | 1:30 | 4:00 |
| ④ 验证方式 | 1:00 | 5:00 |
| ⑤ 未完成项 | 0:20 | 5:20 |

**要压到 3 分钟**：②压到 1 分（跳过 `DUPLICATE` 那段，留着被问）、③压到 45 秒（只跑 T1 那次）、
④压到 30 秒（只跑 `regress.js`）。

---

## 走通检查（提纲里每个入口都实测过）

| 提纲里写的入口 | 实测结果 |
|---|---|
| `pages/topics.html` 公网可达 | ✅ HTTP 200，title「主题列表 · 口语对话实战器」 |
| `POST /api/sessions/write` 真实写入 | ✅ HTTP 200，`turnsStored:2, itemsStored:1` |
| 写入后刷新读回 | ✅ `GET /api/sessions?topicId=T1` 读到 `S-DAY21-VERIFY` |
| 重复提交被拦 | ✅ HTTP 400 `DUPLICATE` |
| `POST /api/analyze` T1 模式 | ✅ HTTP 200，logic 给 correction、offtopic 给 null |
| `POST /api/analyze` FREE 模式 | ✅ HTTP 200，`issues:[]` |
| `analyze/index.js` 提示词段存在 | ✅ `systemPromptFor()` 在第 244 行 |
| `regress.js` | ✅ 25 通过 / 0 失败 |
| `.test-write.js` | ✅ 118 项通过 |