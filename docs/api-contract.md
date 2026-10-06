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
| 状态 | 🟢 4 个已实现（health / sessions·favorites / **chat** / **analyze**）· 🟡 1 个占位待实现（speech-to-text）· ⚪ 4 个预留（不启用）· 🟢 **数据表已在库中执行**（Day 16 建表、Day 17 上午复核 5/17/7） |
| 已拍板事项 | 接口层与展示层字段名**并存不合并**（见 §7，Day 15 用户采纳）；`turns` **独立成表**（见 §9.2，Day 16 用户采纳，覆盖 `TECH_DESIGN §5.4` 原写的「内嵌不单独立表」）；**读接口走 `GET /api/sessions` + `GET /api/favorites`**，不造 `/api/hot`（Day 17 用户采纳，见 §2.1）；`/api/analyze` 的三条硬约束**只在云函数强制**（Day 19 用户采纳，见 §4） |

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
> 换环境只改那一个文件，页面代码一个字不动。`frontend/js/api.js` 已于 Day 17 建立。
>
> **⚠️ `api.js` 里的 `BASE` 按 hostname 判断（Day 18 实测）**：
> 本地（`localhost`/`127.0.0.1`）→ 云端域名绝对地址；其他 → 留空 = 当前域名走同域免跨域。
> **本地不能用空串**：本地静态服务只 serve 文件、不转发也不代理，「同域」在本地根本不成立，
> 空串会让请求打到本地服务得到 **501**（`serve.py` 打的），症状与「跨域被拦」极像。
>
> **为什么接口路径都以 `/api` 开头**：与静态托管的 `/` 共用同一个域名，靠路径前缀区分
> （`cloudbaserc.json` 的 `gateway.routes` 里`/api` 排在 `/` **之前**，顺序反了接口会被静态托管抢走）。

### 1.2 统一响应外壳

**所有接口（成功与失败）都返回 JSON，且都带 `ok` 布尔字段。** 前端只需判断 `ok` 就能分流。

### 1.3 错误返回的统一形状

```json
{
  "ok": false,
  "data": null,
  "error": { "code": "LLM_TIMEOUT", "message": "AI 没有及时回应" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ok` | boolean | 是 | 恒为 `false` |
| `data` | null | 是 | **失败时恒为 `null`**（成功时它装业务数据，失败时一律留空） |
| `error.code` | string | 是 | 机器可读的错误码，见 §1.4 |
| `error.message` | string | 是 | **中文**、给用户看的一句话（不堆栈、不暴露内部信息） |

> **★ 为什么是 `error.code` 而不是顶层 `errorCode`**（Day 19 定的，之前写错过）：
> 前端 `api.js` 只认 `body.error.code` 这一个路径，读不到就退化成 `UNKNOWN`。
> 原先 `GET /api/health` 写的是顶层 `errorCode`，与其余三个接口不一致 ——
> 两套并存的风险是**以后谁照着旧文案写新接口，前端读不到错误码**。
> Day 19 已把 health 改成与其余三个一致，并 curl 实测过三种响应。
>
> **以代码为准，不以文档为准**：前端已上线，改代码的成本远高于改文档。
> 写新接口时先照 `cloudfunctions/analyze/index.js` 的 `sendError()` 抄形状。

### 1.4 错误码清单

**本清单是 Day 19 按线上代码逐个核出来的**（此前只列了 6 个，实际实现了 21 个）。
分类按前缀走，一眼能看出根因在哪一层。

> **★ 为什么后端错误码不用 E 编号**：`TECH_DESIGN §8.2` 的 E1–E12 是**用户可见的前端错误**清单
> （E1 麦克风未授权、E2 转写为空、E8 localStorage 写满、E10 没声音…），
> 与「后端返回了什么」是两回事，混用一套编号会互相污染。
> 所以后端码另立一套并用 `LLM_` / `DB_` 前缀区分，**只有两处交叉**（下表已标出）。
> 「对应」列留空 = 无对应 E 编号（前端不可见，属开发期/运维期错误）。
>
> 下面三张表合计 **21 个码**，其中有 E 编号的 2 个、无编号的 19 个。
> 数字以表为准，别口头转述——写这份文档时用脚本跟代码交叉核对过。
> ⚠️ 核对时注意：错误码在代码里有**两种写法**，
> 一种是 `sendError(res, 400, 'CODE', …)`，另一种是 `e.code = 'CODE'` 挂在抛出的错误上，
> **只 grep `sendError` 会漏掉后面这半**（Day 19 就是这么漏了 `INVALID_JSON` 与 `PAYLOAD_TOO_LARGE` 的）。

#### 通用（4 个，全接口共用）

| `error.code` | 对应 | 场景 | HTTP | 出现在 |
|---|---|---|---|---|
| `INVALID_PARAMS` | — | 必填参数缺失或类型不对 | 400 | chat / analyze / read |
| `NOT_FOUND` | — | 路径不存在 | 404 | 全部四个 |
| `METHOD_NOT_ALLOWED` | — | 方法不对（本接口只接受 GET） | 405 | 全部四个 |
| `INTERNAL_ERROR` | — | 服务器内部错误（兜底，**只在非预期异常时**） | 500 | chat / analyze |

#### LLM 类（11 个，chat 与 analyze）

| `error.code` | 对应 | 场景 | chat | analyze |
|---|---|---|:-:|:-:|
| `LLM_NOT_CONFIGURED` | — | 环境变量没配（`LLM_API_KEY` 等三个） | ✅ | ✅ |
| `LLM_TIMEOUT` | **E4** | 55 秒内没回应（`LLM_TIMEOUT_MS`） | ✅ | ✅ |
| `LLM_UNREACHABLE` | — | **网络层**连不上模型服务 | ✅ | ✅ |
| `LLM_BAD_RESPONSE` | — | 拿到响应但状态码不在 200/401/402/403/429 里 | ✅ | — |
| `LLM_BAD_FORMAT` | **E5** | 响应正常但**内容**解析不出结构，重试一次后仍失败 | — | ✅ |
| `LLM_AUTH_FAILED` | — | 模型返回 401/403 → 密钥无效 | ✅ | ✅ |
| `LLM_NO_CREDIT` | — | 模型返回 402 → 额度不足 | ✅ | ✅ |
| `LLM_RATE_LIMITED` | — | **模型侧**返回 429 → 厂商限流 | ✅ | ✅ |
| `LLM_ERROR` | — | 兜底：抛出的 err 上没有 `.code`（不在上表分类里的意外错误） | ✅ | ✅ |
| `INVALID_JSON` | — | 请求体不是合法 JSON | ✅ | ✅ |
| `PAYLOAD_TOO_LARGE` | — | 请求体超限 | ✅ | ✅ |

> **`LLM_ERROR` 为什么要留兜底**：调用模型失败时统一 `const code = err.code || 'LLM_ERROR'`。
> 有了它，前端永远拿得到一个非空错误码；没有的话 `body.error.code` 会是 `undefined`，
> 前端只能显示 `UNKNOWN`，排错时连方向都没有。
>
> **`INVALID_JSON` / `PAYLOAD_TOO_LARGE` 属于「请求本身不对」**，与 `INVALID_PARAMS` 同类，
> 返回 **400**（不是 200），因为重试也没用——是客户端发错了。

> **⚠️ `LLM_BAD_RESPONSE` 与 `LLM_BAD_FORMAT` 是最容易混的两个**（analyze 的三次实测全靠分清它们才排对）：
>
> | | `LLM_BAD_RESPONSE` | `LLM_BAD_FORMAT` |
> |---|---|---|
> | 拦在哪 | `statusToCode()`，看**HTTP 状态码** | 解析响应体之后，看**内容结构** |
> | 典型场景 | 模型返回 500/503、返回了 HTML 错误页 | 返回 200 且是 JSON，但字段缺了/格式不对 |
> | 谁的锅 | 模型服务 | 模型的输出习惯 |
> | 重试策略 | 不重试（重试大概率同样错） | **重试一次**，并把错误告诉模型让它自己改格式 |
>
> 只有 `LLM_BAD_FORMAT` 值得重试 —— 这是它与前者的关键差别，也是 analyze 多写的那点代码。

#### DB 类（6 个，read）

`read` 把 pg 抛的错**分类成 6 种**，而不是一律返回 `INTERNAL_ERROR`。这么做的原因：
实测 `tcb fn log` 对 HTTP 函数**查不到调用日志**（返回 `No invocation logs`），
等于没有排错入口 —— 所以根因必须写进响应体，不依赖日志就能定位。

| `error.code` | pg 侧对应 | 排错方向 |
|---|---|---|
| `DB_CONNECTION_REFUSED` | `ECONNREFUSED` / Connection refused | **端口或内网访问不通**（本环境当前就是这个） |
| `DB_HOST_UNREACHABLE` | `ENOTFOUND` / getaddrinfo | `PGHOST` 不对，或内网 DNS 不可用 |
| `DB_TIMEOUT` | `ETIMEDOUT` / timeout | 常见于内网未打通 |
| `DB_AUTH_FAILED` | password authentication failed / no pg_hba | 账号或密码不对（**不是网络问题**，与上一条要分清） |
| `DB_TABLE_MISSING` | relation does not exist | 建表脚本没在库里执行 |
| `DB_QUERY_FAILED` | 其余所有 | 兜底，查 SQL 本身 |

> ★ `DB_CONNECTION_REFUSED` 与 `DB_AUTH_FAILED` 的区分是这套分类的重点：
> 前者是**网络不通**，配对密码也没用；后者是**认证失败**，网络是通的。
> 不分开的话，每次都要把两个方向都试一遍。

> **为什么错误也用 HTTP 200 + `ok:false` 返回业务错误**：业务失败（AI 超时）不是 HTTP 层错误，
> 用 200 让前端不必区分「网络失败」与「业务失败」两套处理逻辑。
> **但「路径不存在」「方法不对」「参数不对」用真实的 404 / 405 / 400** —— 那是真的请求错了，
> 属于开发期问题，不该和业务失败混在一起。

> ⚠️ **第 2 周反面教材**：Day 14踩过一个坑——验证线上有没有生效时**只 grep 关键词**，
> 结果 HTML 注释里写「曾改成中文…」被当成「中文版还在」，连着 4 个假警报。
> **契约要能被验证**：每条接口都要能用 `curl` 直接打出响应，不靠"看代码觉得对"。

### 1.5 错误分支要带"我实际收到了什么"

`GET /api/health` 今天因为这个字段救了一命：部署成功但访问 404，
是响应里的 `gotPath: "/health"` 立刻指出**网关把 `/api` 前缀剥掉了**，
避免了去折腾 envId、运行时、网关路由（那些全都没问题）。

**约定**：所有接口的 4xx / 5xx 响应**带 `gotPath` 或 `gotParams` 字段**，回显实际收到的路径或参数。
代价是多几十字节，收益是排错时能区分「部署/路由错」与「业务逻辑错」。

> **★ 位置约定（Day 19 定）**：这类排错字段放**响应体顶层**，不进 `error` 对象里——
> 它不是错误原因的一部分，而是「我实际收到了什么」的现场记录。
> 放进 `error` 里会让人误以为它是错误类别之一。
> 现成的例子就是 health 的 404：`{"ok":false,"data":null,"error":{...},"gotPath":"/xxx"}`。

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
| 路径不对 | 404 | `{"ok":false,"data":null,"error":{"code":"NOT_FOUND","message":"本函数目前只提供健康检查（/api/health）"},"gotPath":"/xxx"}` |
| 方法不是 GET | 405 | `{"ok":false,"data":null,"error":{"code":"METHOD_NOT_ALLOWED","message":"本接口只接受 GET"}}` |

> 上表是 Day 19 线上 curl 实测的原样响应，不是手写的示例。
> `gotPath` 放顶层不进 `error`，理由见 §1.5。

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

###★ 环境打通后：跑 `verify.sh`（一条命令验全部完成标准）

`verify.sh` 在仓库根目录，**6 组检查全自动**，包含清单要求的「改一行数据库数据 → 接口跟着变」。

```bash
bash verify.sh
```

| 组 | 验什么 | 期望 |
|---|---|---|
| 1–2 | `/api/sessions`、`/api/favorites` 的返回形状 | `data.count` 存在 |
| 3 | **参数化**：`topicId=T1` / `limit=1` / 非法参数 | T1 得 2场、limit 得 1 条、非法值报 `INVALID_PARAMS` |
| 4 | **B6**：中途退出的场次 | `endedAt` 是 `null`（不是字符串 `"null"`） |
| 5 | **B7**：非 logic 类型条目 | `correction` 全是 `null` |
| 6 | ★ **改一行库数据 → 刷新接口 → 返回跟着变** | 改后接口返回新值，且自动改回原值 |

退出码 `0` = 全通过，`1` = 有项目未通过。

> **⚠️ 第 6 组会真的 UPDATE 库**（改 `S-MOCK-01` 的 `nickname`，验完自动改回）。
> 脚本**先确认接口能读到数据才动库**——读不到就直接跳过并打印「**没有动库**」。
> 这个顺序是Day 17 首跑后补的：原先接口读不到时 `BEFORE` 取到空串，
> 却照样执行 UPDATE 再用空串改回，**在有真实昵称的库上会永久丢数据**。
> 所以「先探测、再改库」不能省。

**它依赖的东西**：Git Bash（或 Linux/macOS）+ `curl` + `python`（解析 JSON）+ tcb CLI 已登录。
`jq` 没装也行，脚本内部已退化用 python 解析。

---

<a id="s3"></a>

## 三、已实现：`POST /api/chat` 🟢

**用途**：用户说了一句 → AI 回一句（F1）。**与判断逻辑是两条独立的路**（`§6.1`，这是 B9 的技术落地）。

> Day 18（10-05）上线。云函数 `cloudfunctions/chat`，密钥只从环境变量读、**不查库**。
> 实测：8 主题开场白 / 接话 / 沉默催促 / `FREE` 自由对话 / 跑题后拉回，五种场景全部达标、零降级。

### 请求

```json
{
  "topicId": "T1",
  "kind": "reply",
  "history": [
    { "turn": 1, "userText": "We are a bit behind on the API.", "aiText": "Okay. Which part exactly?" }
  ],
  "userText": "The backend part. I think we can finish it.",
  "silenceSeconds": 0,
  "role": "Alex from the backend team",
  "anchor": "the API is behind schedule",
  "followUps": ["Which part exactly?", "Finish it by when?"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `topicId` | string | 是 | `"T1"`–`"T8"` 或 `"FREE"`。用于取追问边界 |
| `kind` | string | 否 | 本轮性质：`"open"`（AI 先开口）/ `"reply"`（回应用户）/ `"silence"`（沉默催促）。**默认 `"reply"`** |
| `history` | object[] | 否 | 已有轮次，**只传文本不传音频**。实现只取**最近 6 轮** |
| `userText` | string | **条件必填** | 本轮用户说的话。**`kind="open"` 或 `silenceSeconds>0` 时可空**（见下方说明） |
| `silenceSeconds` | number | 否 | 沉默秒数。**8 主题阈值 8 秒，`FREE` 阈值 5 秒**（`§6.2`） |
| `role` | string | 否 | AI 的身份/人设，取自 `topics.json` 的 `role`。`FREE` 无此字段 |
| `anchor` | string | 否 | 主题锚点，**追问不许跑出这个范围**。`FREE` 无此字段 |
| `followUps` | string[] | 否 | 预设追问句，**8 主题给中文追问意图**（`topics.json` 的 `followUps`）。`FREE` 无此字段 |

> **★ Day 18 修正的一处契约错配（原先本节把 `userText` 标成「必填」）**：
> 8 主题一进对话就该由 AI 先说 `opening`，`FREE` 沉默 5 秒后 AI 也先开口——
> **这两种场景用户根本还没说话，`userText` 天然是空的**。按原契约会一进页面就报
> `400 INVALID_PARAMS`。现在改成条件必填：仅「回应用户发言」的场景才校验非空。
>
> **约束数据（`role`/`anchor`/`followUps`）为什么由前端传**：云函数读不到
> `frontend/data/topics.json`（静态托管目录里的文件，云函数访问不到）。
> 缺这三个字段接口照样能跑，但追问会跑出主题外。

### 响应（成功）

```json
{
  "ok": true,
  "data": {
    "aiText": "Finish it by when?",
    "kind": "follow_up",
    "followUpType": "vague",
    "model": "deepseek-chat"
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `aiText` | string | AI 要说的那句话（前端同时出文字 + 朗读，B2）。**超 400 字会被截断** |
| `kind` | string | `"normal"` / `"follow_up"` / `"nudge"`（催促）。**服务端校验过**，模型返回契约外的值会被兜底 |
| `followUpType` | string | `kind="follow_up"` 时才有：`"too_short"` / `"vague"` / `"incomplete"` |
| `model` | string | 实际用的模型名，排错用 |

> **为什么 `kind` 要服务端兜底**：模型偶尔会返回契约没列出的值（比如把 `kind` 说成
> `question`），前端 `switch` 会走进 `else` 显示奇怪内容。服务端白名单校验后统一纠正。

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
| 沉默时 | 后端生成催促 | **后端生成催促**（阈值 5 秒） |

> Day 14 现状：`FREE` 完全不调本接口，接话全部来自 `topics.json` 的本地文案池。
> Day 18 已接通：`FREE` 的**沉默催促也走本接口由模型生成**，不再取 `openerPool`。
> 「界面与流程一个字不用改」，前端只是把文案池换成本接口。

### 响应（失败）

```json
{ "ok": false, "data": null, "error": { "code": "LLM_TIMEOUT", "message": "AI 没有及时回应" } }
```

失败的完整错误码清单见 §1.4 的「LLM 类」表（11 个）。

### 云函数环境变量（Day 18）

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `LLM_API_KEY` | **是** | — | 模型厂商密钥。**没配直接返回 `LLM_NOT_CONFIGURED`** |
| `LLM_BASE_URL` | 否 | `https://api.deepseek.com` | 换厂商只改这个 |
| `LLM_MODEL` | 否 | `deepseek-chat` | 模型名 |
| `LLM_TIMEOUT_MS` | 否 | `55000` | 等模型的上限 |

> **⚠️ 密钥只能在控制台手配，不能用 CLI 推。** 实测 `tcb fn env` **只有 `pull` 没有 `push`**。
>
> **⚠️ `tcb fn deploy` 会清空控制台配好的环境变量。** 它会 apply `cloudbaserc.json` 里的
> `functions[].envVariables` 配置，而 `chat` 函数**没有这个字段** → 部署等于删除线上密钥。
> **控制台配好变量后，只更新代码的命令是**：
>
> ```bash
> tcb fn code update chat --dir cloudfunctions/chat
> ```

---

<a id="s4"></a>

## 四、已实现 🟢：`POST /api/analyze`

**用途**：整场结束后，一次性给出两类条目+ 精彩句子（F2）。**只在对话结束时调一次**，不是每轮都调。

> **Day 19 从占位转实现**。实现落在 `cloudfunctions/analyze/`（独立函数，不并进 chat——输入规模与超时预算都不同）。
> 三条硬约束**只在云函数强制**（用户 Day 19 拍板），`frontend/js/api.js` 的 `analyze()` 不做这些处理。

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
| `anchor` | string | 否 | 8 主题的判偏题依据（主题是什么）。**Day 19 新增的字段**：云函数读不到 `frontend/data/topics.json`，所以这个值由前端随请求带上（同 `role`/`anchor` 在 §3 的理由）。FREE 传空串 |

### 响应（成功）

```json
{
  "ok": true,
  "data": {
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
      { "turn": 2, "originalText": "We're two days behind because the API spec changed.",
        "reminder": "这句说清楚了，值得保留。" }
    ],
    "noIssueFound": false,
    "model": "deepseek-chat"
  }
}
```

> **★ Day 19 实现时发现并修正的三处契约缺口**（原有示例给不出的字段，都已补在上例里）：
>
> 1. **整个业务字段在 `data` 里**，不在顶层。与 `/api/chat` 一致 —— 原 §4 的示例把 `issues` 放在顶层，与实现不符
> 2. **`goodSentences[]` 带 `reminder`**：展示层的 `item-card.js` 需要它渲染，没这一项界面会空一块
> 3. **`goodSentences[]` 没有 `type` 字段**：契约只让模型回 `turn`。前端 `api.js` 必须显式补 `type='good'` ——
>    **不补会被 `typeLabelOf()` 的兜底分支标成「偏题」**（Day 19 实测写单测抓到的）
>
> 另：失败响应的外壳 Day 19 已统一 —— 本节原写作 `{ok, errorCode, message}`，
> 而实现用的是 `{ok:false, data:null, error:{code, message}}`（同 `/api/chat`）。
> **当时的分歧已解决**：前端 `api.js` 只认 `body.error.code`，故以代码为准，
> 契约与 `health` 函数都在 Day 19 改成了这一套。详见 §1.3。

| 字段 | 类型 | 说明 |
|---|---|---|
| `issues[].type` | string | 只允许 `"offtopic"` / `"logic"`（实现另接受 `off_topic`/`off-topic` 并归一化） |
| `issues[].correction` | string \| null | **偏题必须为 `null`**；逻辑错误必须有值（B7）。**logic 但 `correction` 为空的条目会被整条丢弃**，不产出「标着逻辑错误却没改法」的条目 |
| `issues.length` | number | 前端据此算 `errorCount`（B22要能对上）。实现另设上限 **5 条** |
| `goodSentences[].originalText` | string | **只含用户说的句子**，不含 AI 的 |
| `noIssueFound` | boolean | `true` 时界面显示"没发现问题"，**不硬凑条目**（B10） |

### 三条硬约束

1. **`originalText` 必须从 `transcript[].userText` 原样取出**，禁止模型重新生成——
   **B8 的技术保障**。实现方式：让模型只返回 `turn` 编号，**原文由后端按编号取回**
2. **偏题条目的 `correction` 由后端强制置 `null`**（不依赖模型自觉）
3. **`FREE` 时后端强制丢弃所有 `type="offtopic"` 的条目**；该模式下 `errorCount`
   **只由逻辑错误条目计算**（PRD §8.3）

> 第 2、3 条为什么必须后端强制而不是前端过滤：前端过滤会让「偏题条目确实被生成过」
> 这个事实留在链路里，将来换前端、加导出功能时它就漏出来了。**口径要卡在数据源头那一层。**

> **★★ Day 19 实测修正：约束 1 的实现方式从「输入侧封锁」改为「输出侧覆盖」**
>
> 原写法是「模型碰不到原句字符串」—— 提示词里**只给 turn 编号**，
> 连用户说了什么都不给。**实测结果是判断能力直接归零**：
>
> ```
> 输入：turn 3「We have some issues but I think it's ok.」（自相矛盾）
>      turn 4「I really like the coffee machine on the third floor」（明显偏题）
> 输出：{"issues": [], "goodSentences": [{turn:1},{2},{3},{4},{6}]}
>       ——矛盾句没抓、偏题句没抓，连偏题那句都被夸成「精彩句子」
> ```
>
> 原因是**判断的前提就是看到内容**。只给「turn 1: [user spoke]」这样的空标签，
> 模型的唯一合理解读就是「既然没看出问题，那就都是好句子」。
>
> 现改为：**给模型看原句，但它只需回 turn 编号**；
> 最终产出的 `originalText` 一律来自 `byTurn`（后端自己的 transcript），
> `normalizeIssue` **根本不看**模型可能多回的那个字段。
> 所以约束 1 仍然成立，只是**从输入侧封锁变成了输出侧覆盖** ——
> 目标没变：**用户看到的必须是他自己说过的话**。
>
> **修完的实测**（同一段输入）：
> ```
> logic   turn 3  「We have some issues but I think it's ok.」
>                 提醒：先说"有问题"又说"没问题"，前后自相矛盾
>                 改法：We have some issues, but they are minor and we have a plan...
> offtopic turn 4 「By the way, I really like the coffee machine on the third floor.」
>                 提醒：与项目进度、延期原因和补救计划无关
>                 correction: null
> goodSentences: turn 1 / 2 / 6
> ```
> 注意 logic 那条：模型给的改法里补了逗号（`issues, but`），
> 而 `originalText` 仍是用户原样那句`...issues but I think it's ok.`（无逗号）——
> 这就是覆盖生效的直接证据。
>
> **FREE 模式实测**：矛盾句被报为 `logic`，聊天话题（猫、天气）未被误判成偏题 ✓

> **★ Day 19 实现补充：约束 1 靠「查不到就丢弃」来兜底。**
> 模型偶尔会编一个不存在的 `turn`，或引用用户根本没说话的那一轮。
> 这两种情况一律**整条丢弃**（不产出条目），**绝不退化成「让模型再写一遍原句」**——
> 后者等于把约束 1 重新打开，而「收藏一句我没说过的话」是这个产品最不能出的错。
>
> 三条约束的单测在 `.test-analyze.js`（18 项，含「模型编造 turn=99 被丢弃」、
> 「模型塞的 originalText 被无视」、「偏题给改法也被强制置 null」等关键项）。

### 响应（失败）

```json
{ "ok": false, "data": null, "error": { "code": "LLM_BAD_FORMAT", "message": "这次没能整理出记录，再试一次好吗" } }
```

> 上面这行的外壳 Day 19 已与 §1.3 统一（原先本节写的是旧的顶层 `errorCode`）。
> `LLM_BAD_FORMAT` 的含义与 `LLM_BAD_RESPONSE` 的区别见 §1.4 的对照表。

### Day 19 实测记录的三个实现选择

| 选择 | 理由 |
|---|---|
| **`temperature: 0.2`**（chat 是 0.7） | 同一场对话判两次若结论都不一样，用户会怀疑这个功能。要的是**判断稳定**，不是花样 |
| **解析失败重试一次** | 靠正则从散文里抠 JSON 不可靠，抠不出来整场失败、用户白练一场。重试时把错误告诉模型让它自己改格式。**只做一次**：两次都失败说明是系统性问题，再试就是烧钱 |
| **空 transcript 直接返回 `noIssueFound: true`** | 用户一句话都没说就结束对话是合法的，不该报错。★ **因此密钥检查必须排在参数校验之后**——否则这条正常路径会被「没配好密钥」拦住，而用户**改前端也改不掉**（前端无从判断该不该报这个） |

---

<a id="s5"></a>

## 五、预留（v1 不启用）：`POST /api/speech-to-text` ⚪

**用途**：若浏览器原生识别对带口音英语准确度不足（PRD R1），把转写改到服务端。

| 项 | 内容 |
|---|---|
| v1 状态 | **不启用**。接口位置预留，前端 `speech.js` 里留一个开关 |
| 请求 | 音频文件（`multipart/form-data`） |
| 响应 | `{ "ok": true, "text": "..." }` |
| 失败 | `{ "ok": false, "data": null, "error": { "code": "ASR_FAILED", "message": "..." } }` |
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

> **本表是「预留接口设计」，不是已实现清单**（这些接口属§6.1，v1 不实现）。
> 已实现的 21 个错误码见 §1.4。
>
> 两处与已实现代码的差异，将来实现时要留意：
>
> | 本表写的 | 已实现代码的情况 |
> |---|---|
> | `NOT_FOUND` =「指定的 `sessionId` 不存在」 | `read/index.js` 目前的 `NOT_FOUND` **只用于「路径不对」**（路由匹配失败时）。查不到 sessionId 走的是 `200 + {items:[], count:0}`，不是 404 |
> | `RATE_LIMITED` = 超频（**我们自己**限用户调用频次） | 代码里的 `LLM_RATE_LIMITED` 是**模型厂商**返回 429，含义完全不同。我们**尚未实现**用户级限频 |

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

`TECH_DESIGN §5.5` 的字段名与实现侧（`frontend/js/api.js` 的 `mapItem()`）已落地的写法不一致。
**Day 15 由用户拍板：两者并存，不合并。**

| 层 | 字段名 | 谁用 | 能否改名 |
|---|---|---|---|
| **接口层** | `originalText` / `correction` | `/api/analyze` 的请求与响应 | ❌ 不能 —— `correction` 绑着 B7 硬约束 |
| **展示层** | `quote` / `fix` | `api.js` 的 `mapItem()`、页面渲染 | ✅ 能 —— 只动展示 |

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
> **入库时的一处翻译**：偏题条目在前端是 `fix: ""`（空串），
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
