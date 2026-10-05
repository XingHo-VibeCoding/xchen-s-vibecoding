# 接口契约（api-contract.md）

> **这个文件是第 3 周建表与写接口的唯一依据。**
>
> **本文档只做登记，不实现。** 清单里写明「今天只登记占位，不实现」——
> `DAY15` 只上线了 `GET /api/health` 一个接口（见 [§2](#s2)），其余全部是**占位**。
> Day 16–20 写代码时回来对照本文件，**不要即兴发明字段**。
>
> **Day 16 更新**：建表与种子脚本已写好（**PostgreSQL 方言**），表结构登记在 [§9](#s9)（三张表：
> `sessions` / `turns` / `items`）。§6.2 与 §8 里「不建表」的说法已按实际修订。
> **Day 17 上午复核：脚本已在真实库里执行，三张表5/17/7 行俱在。**
>
> **Day 17 更新**：第一个读接口已实现并部署 —— `GET /api/sessions` 与 `GET /api/favorites`（见 [§2.1](#s21)）。
> **清单原写的 `/api/hot`（今日热搜）不适用**，已与用户拍板换成契约 §6.1 登记的 R1 与 R5 只读侧，理由见 §2.1 开头。
> 云函数**当前还读不到数据**（本环境是**体验版**，云函数无内网访问权限，见 §2.1 末尾「已知的未通项」）。
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
| 状态 | 🟢 2 个已实现（health / **sessions·favorites**）· 🟡 3 个占位待实现（chat / analyze / speech-to-text）· ⚪ 4 个预留（不启用）· 🟢 **数据表已在库中执行**（Day 16 建表、Day 17 上午复核 5/17/7） |
| 已拍板事项 | 接口层与展示层字段名**并存不合并**（见 §7，Day 15 用户采纳）；`turns` **独立成表**（见 §9.2，Day 16 用户采纳，覆盖 `TECH_DESIGN §5.4` 原写的「内嵌不单独立表」）；**读接口走 `GET /api/sessions` + `GET /api/favorites`**，不造 `/api/hot`（Day 17 用户采纳，见 §2.1） |

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

<a id="s21"></a>

## 二之一、已实现（Day 17）：`GET /api/sessions` 与 `GET /api/favorites` 🟡

> **状态说明**：代码已实现、已部署、已通过离线自测，**但接口当前返回 `DB_CONNECTION_REFUSED`——
> 读不到数据**。这是环境限制（本环境是体验版，云函数无内网访问权限），不是接口没写完。
> 等升级标准版开通内网后即可通，**不需要改代码**。

### 为什么不是清单上写的 `/api/hot`

Day 17 清单给的示例接口是「`/api/hot`（今日热搜）」与「`/api/favorites`」，来自官方
「打卡 / 热搜」类项目模板。**本项目不是那一类**，三条理由：

1. **没有这个需求**：三张表是 `sessions` / `turns` / `items`，PRD 里没有任何要展示热搜的场景
2. **要造第四张表**：接外部热搜必须新建表，撞清单「今日不做：改表结构」
3. **§6.2 早已写明**：Day 15 定的口径是「本项目不是打卡应用」，线上数据只有会话、条目、收藏标记

清单自己末尾的 guidance 也印证了这个判断：「对大多数同学：你的真实数据不是外部接口，
而是你自己数据库里的用户数据」。按「三个问题」对本项目的真实答案：
`sessions` / `items` 是**用户产出的**数据 + **要回看历史** → 必须存库（Day 16 已建）
→ 今天只是**从库里读出真实数据**，不接任何外部 API。

**已拍板（Day 17 用户采纳）**：

| 原清单 | 改为 | 对应本文件 |
|---|---|---|
| `GET /api/hot`（热搜） | **`GET /api/sessions`** | §6.1 **R1**（核心表 `sessions` 列表） |
| `GET /api/favorites` | **`GET /api/favorites`**（保留） | §6.1 **R5** 只读侧（`items` 里 `is_favorited = TRUE`） |

> 「一个函数两条路径」是刻意的：`read` 同时服务两个读接口，
> 因为**它们共用同一份连接池与同一套出口映射规则**（§9.8 第4、5 条）。
> 但**它与 `/api/chat` 刻意分开**成两个云函数——理由见 §3 开头的 Day 17 补充。

### 请求

```
GET /api/sessions?topicId=T1&limit=20
GET /api/favorites?topicId=T1&limit=20
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `topicId` | 否 | 白名单`T1`–`T8` / `FREE`；不传 = 全部主题。**非白名单值返回 400** |
| `limit` | 否 | 1–100 的整数，默认 `20`。**非数字或越界返回 400** |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "sessionId": "S-MOCK-01",
        "topicId": "T1",
        "nickname": "小陈",
        "startedAt": "2026-09-28T20:11:16+08:00",
        "endedAt": "2026-09-28T20:14:20+08:00",
        "durationSeconds": 184,
        "errorCount": 2,
        "goodSentenceCount": 1,
        "turnCount": 4,
        "isComplete": true,
        "aborted": false
      }
    ],
    "count": 1
  },
  "error": null
}
```

`favorites` 的 `data` 形状是 `{"items": [...], "count": N}`，条目字段与 §6.1 的示例一致
（`itemId` / `sessionId` / `topicId` / `type` / `turn` / `originalText` / `reminder` /
`correction` / `isFavorited` / `note` / `favoritedAt` / `createdAt`）。

#### 三个实施决定（都不是 §6.1 写着的，是 Day 17 定的）

| # | 决定 | 理由 |
|---|---|---|
| 1 | `data` 里用 `sessions` / `items` 作键，**不直接返回数组** | 留出扩展位（将来加 `nextCursor` 不算破坏契约）。这**偏离了 §6.1 的示例**，是Day 17 有意为之 |
| 2 | 额外返回 `aborted`（`endedAt === null`） | B6「中途退出也是有效数据」在接口层的显式标记，前端不必自己推断。**`endedAt` 本身仍返回 `null`，不会被转成空串** |
| 3 | `nickname` 为空串时返回 `null` | 库里存 `''`，接口层转`null`，**「你没填昵称」与「你填了空昵称」在接口层分不开**——这是已知的信息损失，前端两种情况都显示「你」 |

###响应（失败）

| 情况 | HTTP | `error.code` |
|---|---|---|
| `limit` 非数字 / 越界 | 400 | `INVALID_PARAMS` |
| `topicId` 不在白名单 | 400 | `INVALID_PARAMS` |
| 方法不是 GET | 405 | `METHOD_NOT_ALLOWED` |
| 路径不认识 | 404 | `NOT_FOUND`（带 `gotPath`） |
| **连不上数据库** | 200 | `DB_CONNECTION_REFUSED` |
| 认证失败 / 表不存在等 | 200 | `DB_AUTH_FAILED` / `DB_TABLE_MISSING` / … |

> **★ 错误分类是新加的排错设计（Day 17）**
> 原先所有库错误一律返回 `INTERNAL_ERROR`，只能靠翻云端日志判断根因。
> 但实测 **`tcb fn log` 对 HTTP 函数查不到调用日志**（返回 `No invocation logs`），
> 等于没有排错入口。所以把根因分类**直接写进 `error.code`**：
> `DB_CONNECTION_REFUSED` / `DB_AUTH_FAILED` / `DB_HOST_UNREACHABLE` /
> `DB_TIMEOUT` / `DB_TABLE_MISSING` / `DB_QUERY_FAILED`。
> **不依赖日志就能定位问题**——今天正是靠它一眼确认了「是网络不通，不是密码错」。
>
> 错误详情（连接串、表名）**只进日志不进响应体**，不泄露给公网。

### 已知的未通项（诚实记录）

| 项 | 状态 |
|---|---|
| 接口能否通到公网 | ✅ 通。返回 200（不是 404） |
| SQL 是否正确 | ✅ 已用真实库验证过：`tcb db execute` 跑同样的 SELECT，返回 5 行 / 3 行 |
| 出口 JSON 形状是否正确 | ✅ `db/selftest-read.js` 用真实行跑，**9 项断言全通过** |
| **能否读到数据** | ❌ **`DB_CONNECTION_REFUSED`**。**准确原因（Day 17 实测）**：本环境包版本是**体验版**（`tcb env list` 显示创建于 2026-10-03），云函数没有内网访问权限，走 TCP 直连 PG 被拒（社区 issue #1237 同因）。**不是认证问题，配密码也没用** |
| 跨域白名单 | ❌ 未配（前端要跨域调才需要；同域名静态托管不需要） |
| 前端 `api.js` | ✅ 已建（`frontend/js/api.js`）。页面**已接后端**，失败自动回落本地 mock 并在页面标注 |

**补救路径（Day 17 已实测评估，按用户拍板暂不做）**：
走 CloudBase HTTP API（`https://<envId>.api.tcloudbasegateway.com` + Bearer token，PostgREST）。

> **Day 17 补测（原来这里只是推理，现在实测过）**：该网关**是可达的**——
> 打 `/health` 返回 `HTTP 401 MISSING_CREDENTIALS`（而不是超时或 404），
> 说明服务本身活着，只差 Bearer token。**所以这条路技术上通，不是死路。**

**仍然不选它的理由（不变）**：它只支持简单查询，将来 Day 18+ 要写库（`POST /api/sessions`）时那套很别扭，
**最终还是要回 `pg`**——先卡着、等升级标准版一次性解决，比现在做一层马上要拆的适配更省事。

**解开卡点的最短路径**：升级环境包版本到标准版（`tcb env modify`）→云函数拿到内网访问权限
→ 配 `PG*` 五个环境变量 → 跑 `verify.sh`。**零代码改动。**

### 怎么验证（可复现）

```bash
# 1. 接口通不通（现在会返回 DB_CONNECTION_REFUSED，这是预期的已知状态）
curl https://cxj1528-…ap-shanghai.app.tcloudbase.com/api/sessions

# 2. SQL 对不对（绕过接口，直接查库；应返回 5 行）
tcb db execute -e cxj1528-… --sql "SELECT session_id, topic_id FROM sessions ORDER BY started_at DESC"

# 3. 出口形状对不对（9 项断言，用真实库行喂出口函数）
cd db && node selftest-read.js
```

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

> **⚠️ 时间字段的时区口径（Day 17 写接口时必读）**
>
> 库里的 `started_at` / `ended_at` / `favorited_at` / `created_at` 都是
> **`TIMESTAMP`（不带时区）**，按 **UTC+8** 存，本项目单时区不做换算。
> 而接口层按 ISO 8601 带偏移输出（`+08:00`），见上面的示例。
>
> **偏移量是写死在代码里的常量，不是算出来的** —— 不要引入 `now()` 或时区库，
> 一换环境（本机时区不是 UTC+8 的笔记本、或将来部署到别处）就会算错。
>
> 转换只发生在云函数出口那一处：读库拿到 `TIMESTAMP` → 直接拼上 `+08:00`。

| 错误码 | HTTP | 场景 |
|---|---|---|
| `INVALID_PARAMS` | 400 | `limit` 不是数字等 |
| `NOT_FOUND` | 404 | 指定的 `sessionId` 不存在 |
| `RATE_LIMITED` | 429 | 超频 |

### 6.2 为什么这些接口先不实现（重要）

> **Day 16 修订**：本节原标题为「为什么先不启用」，其中「今天不建表」一条已过期——
> 表的**脚本**已于 Day 16 写好，见 [§9](#s9)。**接口本身仍然不实现**（Day 17 起），
> 下面四条理由里只有第2 条过期了，其余三条依然成立。

| 理由 | 依据 | Day 16 后是否仍成立 |
|---|---|---|
| **与已锁定决策冲突** | `§3.3` 选路线乙、PRD D5 砍掉账号系统、`§10.1` 写明「数据不部署，在用户自己浏览器里」。做这些接口等于默认上云数据库 = **回头改PRD** | ⚠️ 部分变化——见 §9.1 边界声明 |
| ~~**今天不建表**~~ | ~~清单「今日不做」明确写了：数据库建表留 Day 16–20~~ | ❌ **已过期**：Day 16 已写出建表脚本 |
| **无跨域 = 前端连不上** | 静态托管与接口虽同域名，但跨域白名单今天不配（也在「今日不做」里） | ✅ 仍成立 |
| **`storage.js` 结构已预留** | `§4.2` 规矩 2：将来只需改那一个文件，4 个页面不用动。**这是当初就设计好的降本路径** | ✅ 仍成立 |

**结论**：这一节是**登记占位**，写清楚"将来要上云时会需要哪几个、参数长什么样"，
好让 Day 17 起写接口时不必重新推导。**接口仍不实现**——
但表已经建好（§9），读接口可以直接查库，不必再回头推导字段。

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
| ~~具体表结构 / 建表 SQL~~ | ~~属`TECH_DESIGN §5` 的范围，且今天不建表~~ → **Day 16 已写**：表结构在 [§9](#s9)，SQL 在 `db/schema.sql` 与 `db/seed.sql`（PostgreSQL 方言），字段口径仍以 `TECH_DESIGN §5` 为准 |
| 跨域（CORS）配置 | 清单「今日不做」，Day 16 起处理 |
| 鉴权 / 账号 | PRD D5 已砍账号系统（`§3.3` 第 3 条理由） |
| 限频数值 | 「不替用户选方案」；E4 只定了「只重试 1 次」 |
| 部署平台细节 | 已定稿 CloudBase，写在 `TECH_DESIGN §10.1` |

---

<a id="s9"></a>

## 九、数据模型（Day 16 已建表）🟢

**这一节是 §3–§6 的落地依据**：接口的字段名从这里来，接口的形状也照着这些索引设计。
建表脚本 `db/schema.sql`，种子数据 `db/seed.sql`，两者都可重复执行。

### 9.1 三张表与边界声明

```
sessions（一场练习 = 一行）
  │
  ├── 1 : N ──> turns（该场每一轮）
  │
  └── 1 : N ──> items（偏题 / 逻辑错误 / 精彩句子）
```

**关联字段：`turns.session_id` 与 `items.session_id` 都外键指向 `sessions.session_id`**（库里的名字snake_case，接口层对应 `sessionId`），
`ON DELETE CASCADE`（删一场会话，连带删它的轮次与条目）。

| 表 | 存什么 | 依据 |
|---|---|---|
| `sessions` | 一场练习的**汇总**：主题、起止时间、时长、三个计数 | `TECH_DESIGN §5.3` |
| `turns` | 该场的**每一轮**：用户说了什么、AI 回了什么 | `TECH_DESIGN §5.4` |
| `items` | 该场的**条目**：偏题 / 逻辑错误 / 精彩句子 | `TECH_DESIGN §5.5` + §5.6 |

> **⚠️ 边界声明（这条不要跳过）**
>
> Day 16 **只建表**，其余什么都没动：
>
> | 项| 状态 |
> |---|---|
> | 表结构 | 🟡 **脚本写好了（`db/schema.sql`），尚未在真实数据库里执行** |
> | 种子数据 | 🟡 **脚本写好了（`db/seed.sql`，5 场 / 17 轮 / 7 条），同样未执行** |
> | 任何接口 | ❌ **仍然一个都没写** |
> | 前端 `api.js` | ❌ **未创建**，前端仍读写 localStorage |
> | `storage.js` | ❌ **一行未改**，四个页面行为完全不变 |
> | 跨域白名单 | ❌ 未配 |
>
> **所以 `TECH_DESIGN §3.3` 的路线乙（不引入数据库）没有被推翻，用户数据仍然只在本机。**
> 建表是为了让 Day 17 的读接口有库可查，**不是为了把用户数据搬上云**——
> 上云是另一件事，要改 PRD D5 与 R5「主动告知用户数据只存在本机」的口径，
> 那是路线丙的决策，不在 Day 16。
>
> **⚠️ 数据库是 PostgreSQL，不是 MySQL**（Day 16 上午发现的）
>
> 本项目环境（`cxj1528-d4g55ng0o54cbe296`）的「SQL 数据库」入口进去是
> **PostgreSQL 管理**，控制台没有独立的 MySQL 入口 —— PG 是 CloudBase 的
> 独立环境类型（2026 年 8 月起正式支持）。
>
> 上午先按 MySQL 写了一版脚本，跑不进这个引擎，**已整体翻译成 PG 方言**，
> 改了 11 类语法（`INT UNSIGNED`、`TINYINT(1)`、`DATETIME`、行内 `COMMENT`、
> 内联 `KEY`、`SET FOREIGN_KEY_CHECKS` 等），翻译对照表写在 `db/schema.sql` 文末附录。
> §9.3–9.5 三张字段表里写的都是 **PG 类型**。
>
> 执行入口不是 DMC，是控制台的 **SQL 编辑器**（`#/db/postgres/data-editor`）。
> 11 个分批文件与操作步骤见 `README.md`「数据库怎么建起来的」一节。
>
> **为什么值得先把表建出来**：字段一旦被接口引用，改名成本就涨了。
> 现在改是零成本（Day 15 拍板 `originalText` / `correction` 就是这个道理）。

### 9.2 两条与既有文档不同的决定（Day 16 用户拍板）

| # | 决定 | 覆盖了什么 | 为什么 |
|---|---|---|---|
| 1 | **`turns` 独立成表** | `TECH_DESIGN §5.4` 原写「v1 把轮次作为 `sessions.transcript` 数组内嵌，不单独立表」；同时 `§5.3` 的 `transcript` 字段**已删除** | 轮次要能被单独查、单独排。拆出来后`turns` 的主键用复合键 `(sessionId, turn)`，顺带把「同一场里不能有两个第 3 轮」钉在数据库里——内嵌数组做不到这件事 |
| 2 | **库里的列名用 snake_case，接口层仍是 camelCase** | 上午写过一版「库与接口同用 `originalText` / `correction`」的MySQL 脚本 | 环境是 PostgreSQL，**PG 会把不带双引号的标识符全部转小写** —— `sessionId` 会被存成 `sessionid`，库里的名字和代码里写的对不上，排查极费劲。所以库里一律 `session_id` / `original_text`，映射在 Day 17 的云函数里用 `AS "sessionId"` 做一次，不散落在各处。**唯一例外是 `correction` 这个词本身**（不改成 `fix`）：它绑着 B7 硬约束，叫 `fix` 会让人以为可以随便改 |

> **两个「不建表」的对象**（都不是遗漏，是已定决策）：
> - **`topics` 不入库** —— `TECH_DESIGN §5.2` 已定「来自 `topics.json`，**不是用户数据**，只在代码里维护」。主题是内容，内容归 `topics.json`（`§10.3` 同一条：调整主题只改 JSON 不动代码）。
> - **`issues` 与 `goodSentences` 不分表** —— `§5.5` 已记录「实现侧就是一个 `items` 数组，靠 `type: "good"` 区分」，契约 §6.1 的接口也叫 `/api/items`。所以 `type` 有三个值不是设计失误。

### 9.3 `sessions` 字段

| 库里的列 | PG 类型 | 接口层的名字 | 空 | 说明 |
|---|---|---|---|---|
| `session_id` | VARCHAR(32) PK | `sessionId` | 否 | 后端生成，**不用自增**（§1.6） |
| `topic_id` | VARCHAR(16) | `topicId` | 否 | `T1`–`T8` / `FREE` |
| `nickname` | VARCHAR(64) | `nickname` | 否（默认 `''`） | 未填写为空串，界面用「你」 |
| `started_at` | TIMESTAMP | `startedAt` | 否 | 统一按 UTC+8 存，**单时区不做换算**（用不带时区的 `TIMESTAMP`，不是 `TIMESTAMPTZ`） |
| `ended_at` | TIMESTAMP | `endedAt` | **是** | **为空 = 中途退出**（B6） |
| `duration_seconds` | INTEGER | `durationSeconds` | 否 | 墙钟时间，含停顿与 AI 说话（PRD §8.2）。**PG 没有 `UNSIGNED`，负数由 `ck_sessions_counts` 挡** |
| `error_count` | INTEGER | `errorCount` | 否 | 偏题 + 逻辑错误（PRD §8.3） |
| `good_sentence_count` | INTEGER | `goodSentenceCount` | 否 | **不计入** `error_count` |
| `turn_count` | INTEGER | `turnCount` | 否 | 场内轮数；**≠ `practiceCount`**（跨场次累计） |
| `is_complete` | BOOLEAN | `isComplete` | 否 | **`false` = 中途退出，数据仍留**（B6）。PG 没有 `TINYINT(1)` |

### 9.4 `turns` 字段

| 库里的列 | PG 类型 | 接口层的名字 | 空 | 说明 |
|---|---|---|---|---|
| `session_id` | VARCHAR(32) | `sessionId` | 否 | 复合主键第 1 段 + 外键 |
| `turn` | INTEGER | `turn` | 否 | 复合主键第 2 段，**从 1 开始** |
| `user_text` | TEXT | `userText` | 否 | 用户原句，一字不改。**B8 的唯一可信来源** |
| `ai_text` | TEXT | `aiText` | 否 | AI 回应；前端再用 `SpeechSynthesis` 读（B2） |
| `timestamp` | INTEGER | `timestamp` | 否 | **相对**会话开始的毫秒，用于回放与排序 |
| `asked_follow_up` | BOOLEAN | `askedFollowUp` | 否 | 本轮 AI 是否追问 |

> `turn` 与 `timestamp` 在 PG 里都是**非保留关键字**，可以直接当列名，不必加双引号。

### 9.5 `items` 字段

| 库里的列 | PG 类型 | 接口层的名字 | 空 | 说明 |
|---|---|---|---|---|
| `item_id` | VARCHAR(40) PK | `itemId` | 否 | 后端生成 |
| `session_id` | VARCHAR(32) | `sessionId` | 否 | 外键 → `sessions.session_id` |
| `topic_id` | VARCHAR(16) | `topicId` | 否 | **刻意冗余**：记录页要「按主题 + 时间倒序」，有它走索引一次命中，不必 join |
| `type` | VARCHAR(8) | `type` | 否 | 只允许 `offtopic` / `logic` / `good`（PG 里`type` 是非保留关键字，可直接用） |
| `turn` | INTEGER | `turn` | 否 | 对应 `turns.turn` |
| `original_text` | TEXT | `originalText` | 否 | 从 `turns.user_text` 原样取出，**禁止 AI 重新生成**（B8） |
| `reminder` | VARCHAR(500) | `reminder` | 否（默认 `''`） | 偏题说明偏离哪一点／逻辑错误说明哪里不成立／精彩句子说明好在哪 |
| `correction` | TEXT | `correction` | **是** | **偏题与精彩句子必须 `NULL`，逻辑错误必须有值**（B7）。**这一列没改成 snake_case**，见 §9.2 第 2 条 |
| `is_favorited` | BOOLEAN | `isFavorited` | 否 | F4 |
| `note` | VARCHAR(120) | `note` | 否（默认 `''`） | 建议 ≤30 字 |
| `favorited_at` | TIMESTAMP | `favoritedAt` | **是** | 收藏区倒序用 |
| `created_at` | TIMESTAMP | `createdAt` | 否 | 记录页时间倒序（B19） |

> **`items.topic_id` 冗余的代价**：理论上可能与 `sessions.topic_id` 写歪。
> 约定：**由后端从 session 带出，不单独由前端传**。
>
> **入库时的一处翻译**：`mock-items.json` 里偏题写的是 `fix: ""`（空串），
> 入库必须变成**真正的 `NULL`** —— 库里分得清空串与 `NULL`，而前端JS 用 falsy 判断，
> 两者对它是「都没有」。空串会被 `ck_items_correction` 直接拒绝。

### 9.6 五条 CHECK 约束（PRD 口径钉在库里）

**这一节是今天最该记住的部分**：口径不只写在文档里，还写进了数据库。
就算代码写错、模型不听话，**插不进一条违反 PRD 的脏数据**。

| 约束 | 管什么 | 挡住什么 |
|---|---|---|
| `ck_items_type` | `type` 只允许三个字面量 | 类型拼错（Day 14 踩过 `offtopic` 被写成 `off_topic`） |
| `ck_items_correction` | `logic` 必有改法；`offtopic` / `good` 必无 | **B7** 被绕过 —— §4 特意强调这条要后端强制，现在库也强制了 |
| `ck_sessions_endtime` | `is_complete` 为真必有 `ended_at`；为假必无 | **B6** —— 标了正常结束却没时间戳 |
| `ck_items_favtime` | 收藏状态与收藏时间必须一致 | 收藏区倒序排不出来／数据自相矛盾 |
| `ck_turns_turn` / `ck_items_turn` |轮次从 1 起 | 传 0 或负数 |

### 9.7 索引与它们服务的查询

| 索引 | 服务谁 | 为什么要它 |
|---|---|---|
| `idx_sessions_topic_time (topic_id, started_at)` | §6.1 **R1** 列表读取 | 按主题取场次，按时间倒序 |
| `idx_items_session (session_id)` | P3 结果页看「本次」 | 按会话取全部条目 |
| `idx_items_topic_time (topic_id, created_at)` + `idx_items_time (createdAt)` | §6.1 **R4** 记录页 | 按主题筛选 + 时间倒序；不传主题时走后一段 |
| `idx_items_fav (is_favorited, favorited_at)` | P4 收藏区（F4） | 只取已收藏，按收藏时间倒序 |

> **游标翻页，不是 offset**：§6.1 R4 已定用 `cursor`。
> 上表每个索引的第二列都是时间，因为**游标就用时间**——
> 记录是持续追加的，offset 会漏读或重读。

### 9.8 Day 17 写接口时必须遵守的五件事

1. **`/api/chat` 与 `/api/analyze` 都不查库**（它们只调大模型）。
   库是给**读接口**（§6.1 的 R1–R6）用的—— `R3 POST /api/sessions` 才是写库的那个。
2. **写库时 `items.original_text` 必须从 `turns.user_text` 取**，不许 AI 重新生成（B8）。
   `ck_items_correction` 只能挡住 `correction` 那一列，**挡不住原句被编造**——
   B8 的保障在这一层，不在数据库。
3. **`FREE` 时后端强制丢弃所有 `type='offtopic'` 的条目**，且 `error_count`
   只由逻辑错误算（PRD §8.3）。§4 硬约束第 3 条，库里的证据见 `seed.sql` 的验证 4.5。
4. **★ 查询写snake_case，输出用 `AS "camelCase"` 映射回接口层**（PG 特有）。
   库里的列是 `session_id` / `is_complete` / `original_text`…，
   接口要吐 `sessionId` / `isComplete` / `originalText`…（§6.1 的形状）。
   **映射只写在云函数出口这一处**，不要散落到各个查询里。
   布尔列直接返回 `is_complete` 即可 —— PG 的 `BOOLEAN` 出参就是 `true` / `false`，
   与 §6.1 示例里的 `"isFavorited": true` 天然一致，**不需要转换**。
5. **★ 时间戳出口要拼 `+08:00`**（PG 特有）。库里 `TIMESTAMP` 不带时区，
   接口按 ISO 8601 带偏移输出，详见 §6.1 示例下方那段「时间字段的时区口径」。

---

**写接口时回来对照本文件；有拿不准的先问，不要即兴发明字段。**
**字段长什么样看 [§9](#s9)（库结构，PG 类型）；接口长什么样看 §3–§6（camelCase）。**
**两者不一致时先查 §9.2 的两条决定** —— 库与接口的名字不一致是有意为之（PG 会转小写），
不是笔误。产品口径仍以 `TECH_DESIGN §5` 为准，并回头改这里。**
