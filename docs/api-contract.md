# 接口契约（api-contract.md）

> **这个文件是第 3 周建表与写接口的唯一依据。**
>
> **本文档只做登记，不实现。** 清单里写明「今天只登记占位，不实现」——
> `DAY15` 只上线了 `GET /api/health` 一个接口（见 [§2](#s2)），其余全部是**占位**。
> Day 16–20 写代码时回来对照本文件，**不要即兴发明字段**。
>
> **写代码时本文档若与`TECH_DESIGN.md` 冲突，以 `TECH_DESIGN.md` 为准**，
> 并回头改本文档——契约是从文档派生出来的，不是反过来。

**文档信息**

| 项 | 值 |
|---|---|
| 归属| 接口契约（`TECH_DESIGN` 的派生文档，不是产品决策） |
| 建立 | Day 15（第 3 周，板块 ④） |
| 上游依据 | `TECH_DESIGN.md` §5（数据对象）/ §6（API 列表）/ §8（错误处理） |
| 公网基址 | `https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com` |
| 状态 | 🔴 1 个已实现（health）· 🟡 3 个占位待实现（chat / analyze / speech-to-text）· ⚪ 4 个预留（不启用） |
| 已拍板事项 | 接口层与展示层字段名**并存不合并**（见 §7，Day 15 用户采纳） |

---

<a id="s1"></a>

## 一、通用约定

### 1.1 基址与路径

所有接口都挂在同一个网关基址下：

```
https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com
```

| 前端调用写法 | 实际请求 |
|---|---|
| `/api/chat` | `{基址}/api/chat` |

> **为什么基址不写进代码**：`TECH_DESIGN §4.2` 规矩 1 定了「`api.js` 是前端访问后端的唯一出口」——
> 换环境只改那一个文件，页面代码一个字不动。**今天前端还没有 `api.js`**（`§4.1` 里列了，
> 尚未创建），Day 16 接第一个接口时一并建。
>
> **为什么接口路径都以 `/api` 开头**：与静态托管的 `/` 共用同一个域名，靠路径前缀区分
> （`cloudbaserc.json` 的 `gateway.routes` 里`/api` 排在 `/` **之前**，顺序反了接口会被静态托管抢走）。

### 1.2 统一响应外壳

**所有接口（成功与失败）都返回 JSON，且都带 `ok` 布尔字段。** 前端只需判断 `ok` 就能分流。

### 1.3 错误返回的统一形状

```json
{
  "ok": false,
  "errorCode": "LLM_TIMEOUT",
  "message": "AI 没有及时回应"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ok` | boolean | 是 | 恒为 `false` |
| `errorCode` | string | 是 | 机器可读的错误码，见 §1.4 |
| `message` | string | 是 | **中文**、给用户看的一句话（不堆栈、不暴露内部信息） |

> **已实现的口径参照**：`GET /api/health` 今天已上线，它的实际错误返回是
> `{"ok":false,"errorCode":"NOT_FOUND","message":"...","gotPath":"/xxx"}`——
> 多出的`gotPath` 是**排错字段**（见 §1.5）。

### 1.4 错误码清单

沿用 `TECH_DESIGN §8.2` 的 E 编号，**一个错误码对一个 E 编号**，不另造一套：

| `errorCode` | 对应 | 场景 | HTTP |
|---|---|---|---|
| `LLM_TIMEOUT` | E4 | AI 没及时回应 | 200 + `ok:false` |
| `LLM_BAD_FORMAT` | E5 | 模型返回结构不合格，重试后仍不合格 | 200 + `ok:false` |
| `NOT_FOUND` | — | 路径不存在（health 已实现） | 404 |
| `METHOD_NOT_ALLOWED` | — | 方法不对（health 已实现） | 405 |
| `INVALID_PARAMS` | — | 必填参数缺失或类型不对 | 400 |
| `RATE_LIMITED` | — | 超频（Day 16 起加限频时启用） | 429 |

> **为什么错误也用 HTTP 200 + `ok:false` 返回业务错误**：业务失败（AI 超时）不是HTTP 层错误，
> 用 200 让前端不必区分「网络失败」与「业务失败」两套处理逻辑。
> **但「路径不存在」「方法不对」用真实的 404 / 405** —— 那是真的请求错了，
> 属于开发期问题，不该和业务失败混在一起。
>
> ⚠️ **第 2 周反面教材**：Day 14踩过一个坑——验证线上有没有生效时**只 grep 关键词**，
> 结果 HTML 注释里写「曾改成中文…」被当成「中文版还在」，连着 4 个假警报。
> **契约要能被验证**：每条接口都要能用 `curl` 直接打出响应，不靠"看代码觉得对"。

### 1.5 错误分支要带"我实际收到了什么"

`GET /api/health` 今天因为这个字段救了一命：部署成功但访问 404，
是响应里的 `gotPath: "/health"` 立刻指出**网关把 `/api` 前缀剥掉了**，
避免了去折腾 envId、运行时、网关路由（那些全都没问题）。

**约定**：所有接口的 4xx / 5xx 响应**带 `gotPath` 或 `gotParams` 字段**，回显实际收到的路径或参数。
代价是多几十字节，收益是排错时能区分「部署/路由错」与「业务逻辑错」。

### 1.6 时间与标识

| 项 | 约定 | 依据 |
|---|---|---|
| 绝对时间 | ISO 8601 带时区，如 `2026-10-03T19:06:35+08:00` | `§5.3` `startedAt`/`endedAt` |
| 相对时间 | number（毫秒），用于轮次时间戳 | `§5.3` `transcript[].timestamp` |
| `sessionId` / `itemId` | string，由**后端生成**，前端不造 | `§5.3`/`§5.5` |
| `topicId` | `"T1"`–`"T8"`，自由对话固定 `"FREE"` | `§5.2` |
| `type`（条目类型） | `"offtopic"` / `"logic"` / `"good"` | `§5.5` Day 14 修订 |

---

<a id="s2"></a>

## 二、已实现：`GET /api/health`✅

**用途**：验部署链路通不通（域名 → 网关 → 函数 → 运行时）。**不连数据库、不调大模型。**

### 请求

无参数。

```bash
curl https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/api/health
```

### 响应（成功）

```json
{ "ok": true, "service": "TalkTrainer" }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 恒 `true` |
| `service` | string | 恒 `"TalkTrainer"`，用于区分将来别的服务 |

### 响应（失败）

| 情况 | HTTP | 响应体 |
|---|---|---|
| 路径不对 | 404 | `{"ok":false,"errorCode":"NOT_FOUND","message":"本函数目前只提供健康检查（/api/health）","gotPath":"/xxx"}` |
| 方法不是 GET | 405 | `{"ok":false,"errorCode":"METHOD_NOT_ALLOWED","message":"本接口只接受 GET"}` |

### 实现上的两个约定

1. **路径要兼容网关剥前缀**：`gateway.routes` 配的`path` 是 `/api`，实际转发给函数的是
   `/health`（**前缀没了**）。所以函数同时认 `/health`、`/api/health`、`/`。
2. **端口固定 `0.0.0.0:9000`**：CloudBase HTTP 云函数只认 9000，且必须绑 `0.0.0.0`
   ——写 `127.0.0.1` 会本地能测、线上全挂。

---

<a id="s3"></a>

## 三、待实现（占位）：`POST /api/chat` 🟡

**用途**：用户说了一句 → AI 回一句（F1）。**与判断逻辑是两条独立的路**（`§6.1`，这是 B9 的技术落地）。

### 请求

```json
{
  "topicId": "T1",
  "history": [
    { "turn": 1, "userText": "We are a bit behind on the API.", "aiText": "Okay. Which part exactly?" }
  ],
  "userText": "The backend part. I think we can finish it.",
  "silenceSeconds": 0
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `topicId` | string | 是 | `"T1"`–`"T8"` 或 `"FREE"`。用于取 `opening` / `followUps` / `anchor` |
| `history` | object[] | 是 | 已有轮次，**只传文本不传音频** |
| `userText` | string | 是 | 本轮用户说的话（转写结果） |
| `silenceSeconds` | number | 否 | 沉默秒数。**8 主题阈值 8 秒，`FREE` 阈值 5 秒**（`§6.2`） |

### 响应（成功）

```json
{
  "ok": true,
  "aiText": "Finish it by when?",
  "kind": "follow_up",
  "followUpType": "vague"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `aiText` | string | AI 要说的那句话（前端同时出文字 + 朗读，B2） |
| `kind` | string | `"normal"` / `"follow_up"` / `"nudge"`（催促） |
| `followUpType` | string | `kind="follow_up"` 时才有：`"too_short"` / `"vague"` / `"incomplete"` |

### 三条硬约束（不可放宽）

1. 提示词**不得出现**偏题/逻辑判断指令 → 保证 B9（对话中不评判）
2. 必须携带 PRD §6.1 三条硬规则：不主动降语速不简化用词、不替用户补完、不无条件肯定
3. 追问方向**只允许**落在该主题的 `anchor` 与 `followUps` 范围内
   （`FREE` 无此约束：F6 不判偏题，也没有追问边界）

### 自由对话（`topicId="FREE"`）的差异

| 项 | 8 主题 | `FREE` |
|---|---|---|
| 追问方向约束 | 受 `anchor` 约束 | **无** |
| 提示词取向 | "不迁就"三条硬规则 | 不评价、不下结论、不灌鸡汤 |
| 沉默时| 后端生成催促 | **前端直接取 `topics.json` 的 `openerPool` 下一句上屏**，不走本接口 |

> Day 14现状：`FREE` **不调本接口**，接话全部来自 `topics.json` 的本地文案池。
> 接上后「界面与流程一个字不用改」，前端只把文案池换成本接口。

### 响应（失败）

```json
{ "ok": false, "errorCode": "LLM_TIMEOUT", "message": "AI 没有及时回应" }
```

---

<a id="s4"></a>

## 四、待实现（占位）：`POST /api/analyze` 🟡

**用途**：整场结束后，一次性给出两类条目 + 精彩句子（F2）。**只在对话结束时调一次**，不是每轮都调。

### 请求

```json
{
  "topicId": "T1",
  "transcript": [
    { "turn": 1, "userText": "We are a bit behind on the API.", "aiText": "Okay. Which part exactly?" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `topicId` | string | 是 | `"T1"`–`"T8"` 或 `"FREE"` |
| `transcript` | object[] | 是 | 整场转写全文，**每项 `{turn, userText, aiText}`** |

### 响应（成功）

```json
{
  "ok": true,
  "issues": [
    {
      "type": "logic",
      "turn": 2,
      "originalText": "We have some issues but I think it's ok.",
      "reminder": "先说「有问题」又说「没问题」，前后不一致。",
      "correction": "We're two days behind on the API, but we can still make Friday."
    },
    {
      "type": "offtopic",
      "turn": 3,
      "originalText": "By the way, I really like the coffee here.",
      "reminder": "这一句偏离了「解释进度和原因」这个主题",
      "correction": null
    }
  ],
  "goodSentences": [
    { "turn": 2, "originalText": "We're two days behind because the API spec changed." }
  ],
  "noIssueFound": false
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `issues[].type` | string | 只允许 `"offtopic"` / `"logic"` |
| `issues[].correction` | string \| null | **偏题必须为 `null`**；逻辑错误必须有值（B7） |
| `issues.length` | number | 前端据此算 `errorCount`（B22要能对上） |
| `goodSentences[].originalText` | string | **只含用户说的句子**，不含 AI 的 |
| `noIssueFound` | boolean | `true` 时界面显示"没发现问题"，**不硬凑条目**（B10） |

### 三条硬约束

1. **`originalText` 必须从 `transcript[].userText` 原样取出**，禁止模型重新生成——
   **B8 的技术保障**。实现方式：让模型只返回 `turn` 编号，**原文由后端按编号取回**，模型碰不到原句字符串
2. **偏题条目的 `correction` 由后端强制置 `null`**（不依赖模型自觉）
3. **`FREE` 时后端强制丢弃所有 `type="offtopic"` 的条目**；该模式下 `errorCount`
   **只由逻辑错误条目计算**（PRD §8.3）

> 第 2、3 条为什么必须后端强制而不是前端过滤：前端过滤会让「偏题条目确实被生成过」
> 这个事实留在链路里，将来换前端、加导出功能时它就漏出来了。**口径要卡在数据源头那一层。**

### 响应（失败）

```json
{ "ok": false, "errorCode": "LLM_BAD_FORMAT", "message": "这次没能整理出记录，再试一次好吗" }
```

---

<a id="s5"></a>

## 五、预留（v1 不启用）：`POST /api/speech-to-text` ⚪

**用途**：若浏览器原生识别对带口音英语准确度不足（PRD R1），把转写改到服务端。

| 项 | 内容 |
|---|---|
| v1 状态 | **不启用**。接口位置预留，前端 `speech.js` 里留一个开关 |
| 请求 | 音频文件（`multipart/form-data`） |
| 响应 | `{ "ok": true, "text": "..." }` |
| 失败 | `{ "ok": false, "errorCode": "ASR_FAILED", "message": "..." }` |
| 代价 | 按量费用 + 一份密钥 + 一段网络延迟 |
| 触发条件 | Day 6 实测（Q-T1）不通过才启用 |

> **它不是"要做的功能"，是"留的退路"**——写在这里是为了R1 触发时不用回头改接口设计。

---

<a id="s6"></a>

## 六、预留接口（**本期不实现，需要时才启用**） ⚪

> **这一节是 Day 15 拍板的结果**：清单给的示例是「打卡应用」的
> `plan_days` / `checkins` 与 `GET /api/favorites`。**本项目不是打卡应用**，
> 线上数据只有三类：会话、条目、收藏标记。
>
> **但今天不写进主表**，原因见下方「为什么先不启用」。

### 6.1 如果将来要上云数据库，会需要哪几个

**触发前提**：现在走路线乙（`§3.3`），数据只存在本机localStorage，
`pinnedTopics` / `favoriteItems` 是**临时键**（`storage.js` 里明写「第 3 周接库后迁走」）。
**若将来要跨设备同步**（升级到路线丙），就需要下面这些接口。

| # | 方法 | 路径 | 用途 | 对应前端数据 |
|---|---|---|---|---|
| R1 | `GET` | `/api/sessions` | **列表读取**：某主题的练习记录 | `vibecoding.sessions` |
| R2 | `GET` | `/api/sessions/{id}` | 单场详情（含 `transcript`） | 同上 |
| R3 | `POST` | `/api/sessions` | 写入一场会话（点「结束对话」时） | 同上 |
| R4 | `GET` | `/api/items` | **列表读取**：条目与精彩句子（记录页用，支持按主题/时间筛选） | `vibecoding.issues` + `goodSentences` |
| R5 | `PATCH` | `/api/items/{id}` | 改收藏标记 / 备注 | `favoriteItems` 的 `isFavorited` / `note` |
| R6 | `GET` | `/api/practice-count` | 某主题练过几次 | `vibecoding.practiceCount` |

**列表读取接口的形状（以 R4 为例，R1 同理）**：

```
GET /api/items?topicId=T1&limit=20&cursor=xxx
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `topicId` | 否 | 不传= 全部主题 |
| `limit` | 否 | 每页条数，默认 20 |
| `cursor` | 否 | 翻页游标（**用游标不用 offset**——记录是持续追加的，offset 会漏/重） |

```json
{
  "ok": true,
  "items": [
    {
      "itemId": "T1-S1-E1",
      "sessionId": "T1-S1",
      "topicId": "T1",
      "type": "logic",
      "turn": 2,
      "originalText": "We have some issues but I think it's ok.",
      "reminder": "先说「有问题」又说「没问题」，前后不一致。",
      "correction": "We're two days behind on the API, but we can still make Friday.",
      "isFavorited": true,
      "note": "",
      "favoritedAt": "2026-10-03T19:20:00+08:00",
      "createdAt": "2026-10-03T19:18:00+08:00"
    }
  ],
  "nextCursor": "yyy"
}
```

| 错误码 | HTTP | 场景 |
|---|---|---|
| `INVALID_PARAMS` | 400 | `limit` 不是数字等 |
| `NOT_FOUND` | 404 | 指定的 `sessionId` 不存在 |
| `RATE_LIMITED` | 429 | 超频 |

### 6.2 为什么先不启用（重要）

| 理由 | 依据 |
|---|---|
| **与已锁定决策冲突** | `§3.3` 选路线乙、PRD D5 砍掉账号系统、`§10.1` 写明「数据不部署，在用户自己浏览器里」。做这些接口等于默认上云数据库 = **回头改PRD** |
| **今天不建表** | 清单「今日不做」明确写了：真实业务接口、**数据库建表**、跨域配置都留Day 16–20 |
| **无跨域 = 前端连不上** | 静态托管与接口虽同域名，但跨域白名单今天不配（也在「今日不做」里） |
| **`storage.js` 结构已预留** | `§4.2` 规矩 2：将来只需改那一个文件，4 个页面不用动。**这是当初就设计好的降本路径** |

**结论**：这一节是**登记占位**，写清楚"将来要上云时会需要哪几个、参数长什么样"，
好让 Day 16–20 建表时不必重新推导。**今天不实现、不建表、不配跨域。**

---

<a id="s7"></a>

## 七、字段名：接口层 vs 展示层（✅ Day 15 已拍板）

`TECH_DESIGN §5.5` 的字段名与 `mock-items.json` 里已落地的实现不一致。
**Day 15 由用户拍板：两者并存，不合并。**

| 层 | 字段名 | 谁用 | 能否改名 |
|---|---|---|---|
| **接口层** | `originalText` / `correction` | `/api/analyze` 的请求与响应 | ❌ 不能 —— `correction` 绑着 B7 硬约束 |
| **展示层** | `quote` / `fix` | `mock-items.json`、页面渲染 | ✅ 能 —— 只动展示 |

**映射发生在前端 `api.js` 一处**（`TECH_DESIGN §4.2` 规矩 1：唯一出口）：

```
/api/analyze 响应           前端拿到的（mock / 展示层）
{                  →
  "originalText": "..."    →  quote: "..."
  "correction":  "..."    →  fix:   "..."
  "typeLabel":    "..."    →  typeLabel: "..."   （实现多出来的，接口暂不带）
```

> `typeLabel`（中文标签，如「逻辑错误」）**接口层不带**——它是渲染用的，
> 完全可以由 `type`（`"offtopic"` / `"logic"`）在前端查表得到。
> 让后端传展示文案，等于把中文界面的决定权交给后端，改文案就要改后端。

**为什么接口层用文档名**（而不是把文档改成实现侧）：

| 名字 | 绑着的东西 | 后果 |
|---|---|---|
| `correction` | **B7：偏题条目必须为 `null`** | 改名容易漏掉这条校验——它是"偏题只提醒、不给改法"的唯一技术保障 |
| `fix` | 只是「显示哪段文字」 | 改它只动渲染，零风险 |

**约束挂在接口层字段上，展示层用什么都行。**

> **这与Day 14 那次修订不矛盾，两次判断依据不同**：
> Day 14 改的是 `type` 的**取值**（`"off_topic"` → `"offtopic"`），
> 那些字面量**已落进 CSS 类名、localStorage、页面判断分支** → 改实现代价大，统一到实现侧。
> 本次不同：`originalText` / `correction` **还没有任何实现**（接口尚未写），
> 现在统一到文档侧代价为零，收益是 B7 约束与字段名绑定。
> **判断依据是「有没有已落地的实现」，不是「文档和代码谁对」。**
> （此修订已同步写入 `TECH_DESIGN §5.5`。）

---

<a id="s8"></a>

## 八、这份契约不写什么（避免越界）

| 不写 | 为什么 |
|---|---|
| 具体表结构 / 建表 SQL | 属`TECH_DESIGN §5` 的范围，且**今天不建表** |
| 跨域（CORS）配置 | 清单「今日不做」，Day 16 起处理 |
| 鉴权 / 账号 | PRD D5 已砍账号系统（`§3.3` 第 3 条理由） |
| 限频数值 | 「不替用户选方案」；E4 只定了「只重试 1 次」 |
| 部署平台细节 | 已定稿 CloudBase，写在 `TECH_DESIGN §10.1`（待补） |

---

**建表与写接口时回来对照本文件；有拿不准的先问，不要即兴发明字段。**
