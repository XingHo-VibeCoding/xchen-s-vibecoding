# 安全自查清单（Day 23）

> 审计范围：硬编码密钥、裸报错、非法输入、`.gitignore` 完整性。
> 日期：2026-10-12· 环境 `cxj1528-d4g55ng0o54cbe296`
>
> ★ **每项都能自己复现**：命令可直接复制粘贴到 Git Bash 跑，
> 期望输出写在命令后面。队友或评审不用问就能自己验一遍。

---

## 一、硬编码密钥

### 1.1仓库里没有真实密钥 ✅

```bash
git grep -nIE "AKID[A-Za-z0-9]{10,}" -- .
```

**实跑结果：2 条命中，逐条确认均安全**

| 文件:行号 | 内容 | 为什么安全 |
|---|---|---|
| `.test-asr-sign.js:38` | `AKIDz8krbsJ5yKBZQpn74WFkmLPx3*******` | 腾讯云**官方文档公开的示例值**，尾部带 `*******` 掩码。取自 `https://cloud.tencent.com/document/api/1093/35646` 签名示例，公开可查 |
| `docs/day23-deploy-speech.md:32` | `AKIDxxxxxxxxxxxxxxxx` | 全是x 的**占位符**，文档里给人看的填写模板 |

> ★ **为什么这一项不是 0 条**：
> Day 23 的完成标准写的是「全仓库搜不到密钥特征词」，
> 但实际有 2 条**确认安全**的命中 —— 官方公开示例值与文档占位符。
> ★★ **把这两条删掉以求「0 条」是错的**：
> 单测的签名用例需要官方示例值才能算出一个确定的结果，
> 文档的占位符是给人填配置时看的。
> **正确的判据是「搜出来的每一条都确认过安全」，不是「一条都没有」** ——
> 后者会逼着人删掉该留的东西，或者干脆把搜索范围缩到搜不到为止。
> 截图请带上这两行，并在旁边写明为什么安全。

### 1.2 没有硬编码的密码与数据库连接串 ✅

```bash
git grep -nIE "postgres(ql)?://|mysql://|password[[:space:]]*[:=]" -- .
```

**实跑结果：0 条**

### 1.3 密钥全部走环境变量 ✅

所有云函数的密钥都从`process.env` 读，没有一处写死：

| 变量 | 用途 | 读取处 |
|---|---|---|
| `LLM_API_KEY` | 大模型 Key | `cloudfunctions/chat/index.js:63`、`analyze/index.js:80` |
| `LLM_BASE_URL` | 模型接口地址 | `chat/index.js:61`、`analyze/index.js:78` |
| `LLM_MODEL` | 模型名 | `chat/index.js:62`、`analyze/index.js:79` |
| `ASR_SECRET_ID` | 腾讯云 SecretId | `cloudfunctions/speech/index.js:62` |
| `ASR_SECRET_KEY` | 腾讯云 SecretKey | `speech/index.js:63` |
| `ASR_APPID` | 腾讯云 AppId | `speech/index.js:64` |
| `CLOUDBASE_API_KEY` | CloudBase 管理 Key | `read/httpdb.js:37`、`write/httpdb.js:37` |
| `CLOUDBASE_ENV_ID` | 环境 ID | `read/httpdb.js:36`、`write/httpdb.js:36` |

```bash
# 复现：列出全部环境变量读取点
git grep -hoIE "process\.env\.[A-Z_0-9]+" -- cloudfunctions/ | sed 's/process\.env\.//' | sort -u
```

**复现「缺变量会被明确报出来」（而不是静默失败）**
```bash
grep -n "只打印\*\*有没有\*\*" cloudfunctions/chat/index.js
```
`chat/index.js:75` 的注释写明「只打印有没有，绝不打印值 —— 密钥进了日志就是事故」，
代码 `checkEnv()` 只返回键名列表（`need.filter(k => !process.env[k])`），
**启动日志里不会出现任何密钥的值**。

### 1.4 Git 历史里没有提交过真实密钥 ✅

**这一项最重要** —— 代码干净不代表历史干净，删掉的密钥还在 git 对象里。

```bash
git log --all -p --no-color | grep -oE "AKID[A-Za-z0-9]{10,}" | sort -u
```

**实跑结果（52 个提交全查）：**
```
AKIDxxxxxxxxxxxxxxxx
AKIDz8krbsJ5yKBZQpn74WFkmLPx3
```
与 1.1 完全相同 —— **只有那两个确认安全的值**。

```bash
# 再扫一遍 28 位以上的裸串（排除 40 位 commit hash 本身）
git log --all -p --no-color | grep -oE "\b[A-Za-z0-9]{28,}\b" \
  | grep -vE "^[0-9a-f]{40}$" | sort -u
```
**实跑结果：** 3 条 —— 1 条是上面那个 AKID，2 条是 CDP 方法名
`addScriptToEvaluateOnNewDocument` / `removeScriptToEvaluateOnNewDocument`。均非密钥。

### 1.5 环境变量文件从未进入版本库 ✅

```bash
git log --all --full-history --oneline -- ".env" ".env.local" "*.key" "*.pem" "secrets.json"
```
**实跑结果：空**（从未被加入过索引）

```bash
git ls-files | grep -iE "\.env|secret|credential"
```
**实跑结果：空**（当前也没有被追踪的密钥类文件）

---

## 二、.env 与忽略规则

### 2.1 `.env` 被正确忽略 ✅

```bash
git check-ignore -v .env .env.local .env.production
```
**实跑结果：**
```
.gitignore:12:*.env              .env
.gitignore:3:.env.*              .env.local
.gitignore:3:.env.*              .env.production
```

> ★ `.env.production` 这一条要一起验：新增的 `!.env.example` 例外
> **不能误伤**同前缀的真配置文件。

### 2.2 `.env.example` 能进仓库 ✅

```bash
git check-ignore -v .env.example      # 命中的是否定规则
git status --short .env.example# 这条才是判据
```
**实跑结果：** `?? .env.example` —— 会被正常提交。

> ★ **判据要两条一起看**，只看第一条会误判：
> `git check-ignore -v` 命中 `!.env.example` 时**退出码仍是 0**，
> 输出看着像「被忽略」，实际那是否定规则。
> 真正的判据是 `git status` 显示 `??`（未跟踪）。

### 2.3 `.env.example` 里只有键名没有值 ✅

```bash
grep -nE "AKID[A-Za-z0-9]{10,}|[A-Za-z0-9]{28,}" .env.example
```
**实跑结果：0 条命中**

覆盖的 10 个键名见 `.env.example` 全文。
⚠️ **注意**：本项目**没有 .env 加载器**（无 dotenv 依赖），
云函数的值在控制台配、代码用 `process.env.X` 读。
`.env.example` 的作用是**固定键名清单**，
不是「复制下来改改就能跑」—— 文件开头已写明这一点，免得误导人。

### 2.4 忽略规则覆盖完整 ✅

`.gitignore:1-13` 覆盖：`.env` / `.env.*` / `!.env.example` / `*.env` / `*.key` / `*.pem` /
`secrets.json` / `config.local.*` / `.cloudbase-api-key.local.json`

本地实际存在的密钥文件确认被忽略：
```bash
git check-ignore -v .cloudbase-api-key.local.json
# → .gitignore:13:.cloudbase-api-key.local.json
```

---

### 3.1b★ 做演示页时发现并修掉的一个真bug ✅

`friendlyMessage` 的最后一层兜底原来是：

```javascript
return raw ||'出了点问题，请再试一次';   // raw = err.message
```

它**赌 `err.message` 一定是中文** —— 契约 §1.3 确实这么规定，
线上实测也确实如此（`curl` 打 `/api/sessions` 返回「本接口只接受 GET」）。
**所以这个假设当时是成立的，代码不算 bug。**

但做演示页时，我把某一条的 `message` 填成了英文码本身，
结果页面上**真的显示出了 `SOME_NEW_CODE_2027`** ——
也就是说演示页上写的承诺「不会出现 undefined 或英文码」**被它自己否证了**。

**修法**：兜底层加一道「含中文」的检查，不含中文就不给用户看：

```javascript
if (HAS_CHINESE.test(raw)) return raw;
return '出了点问题，请再试一次';
```

★ **为什么不干脆一律不返回 `raw`**：
message 里的中文细节（「本接口只接受 GET」）比任何通用兜底都有用，不该浪费。

★★ **这条不属于「发现了一个 bug」，属于「防线太薄」**：
契约写在文档里、代码随时会改，而兜底层是**最后一道** ——
前面所有分支都没兜住时才走到它。
**「假定上游一定是好人」在跨越模块边界时必然失效。**
（与 MEMORY 里那条「静默失败比崩溃更贵」同类。）

```bash
node .test-friendly-message.js   # 【7】项专门钉这一条
```
**实跑结果：通过 18 / 失败 0**（原14 项，新增 4 项）
- message 是英文码 → 不给用户看 ✓
- message 是英文句子 → 不给用户看 ✓
- message 是中文 → **保留它**（细节比通用兜底有用）✓
- message 中英混排（含中文就保留）✓

---

## 三、错误提示（裸报错）

### 3.1 错误码 → 中文人话的映射表 ✅

映射表在 `frontend/js/api.js` 的 `friendlyMessage()`，导出为 `Api.friendlyMessage` / `Api.friendlyOf`。

按**三类**组织，每条文案都回答「用户现在能做什么」：

| 类别 | 覆盖的码| 文案示例 |
|---|---|---|
| **输入错**（用户能自己改） | `INVALID_PARAMS` `INVALID_JSON` `PAYLOAD_TOO_LARGE` `NOT_FOUND` `METHOD_NOT_ALLOWED` `ASR_EMPTY_BODY` `ASR_BAD_AUDIO` `ASR_TOO_LARGE` | 「这次说的内容不太对，换个说法试试」 |
| **网络错**（能重试） | `LLM_UNREACHABLE` `ASR_UNREACHABLE` `LLM_TIMEOUT` `ASR_TIMEOUT` `DB_TIMEOUT` `LLM_RATE_LIMITED` `ASR_RATE_LIMITED` | 「连不上服务器，检查一下网络再试」 |
| **服务端错**（只能等） | `INTERNAL_ERROR` `LLM_ERROR` `LLM_NOT_CONFIGURED` `LLM_AUTH_FAILED` `LLM_NO_CREDIT` `ASR_NOT_CONFIGURED` `ASR_AUTH_FAILED` `ASR_FAILED` `ASR_UPSTREAM_ERROR` `ASR_BAD_RESPONSE` `LLM_BAD_RESPONSE` `LLM_BAD_FORMAT` `DB_QUERY_FAILED` `DB_AUTH_FAILED` `DB_TABLE_MISSING` `DB_TIMEOUT` | 「服务器出了点问题，我们正在处理，稍后再试」 |

```bash
node .test-friendly-message.js
```
**实跑结果：通过 14 / 失败 0**，其中三项专门盯最易出错的兜底分支：
- 34 个码（含伪造的 `ZZZ_FUTURE_CODE`）**全部返回中文**，没有一个把英文码原样吐回给用户
- 9 种边界输入（无 code / code 为空 / 只有 message）**都返回非空字符串**
- 调用后`err.message` **原样保留** —— 只改「给用户看的那一句」，不销毁排查信息

### 3.2 页面不再直出 `err.message` ✅

```bash
git grep -nIE "err\.message" -- frontend/pages frontend/js/pages \
  | grep -viE "friendlyOf|friendlyMessage|err\.message \|\| ''\)|★|原来"
```
**实跑结果：** 剩下的 4 处全部是三元表达式的 else 分支：
```javascript
(window.Api && window.Api.friendlyOf) ? window.Api.friendlyOf(err)
                                       : (err && err.message ? err.message : '')
```
> **刻意保留的兜底**：万一 `api.js` 没加载成功（路径错、脚本 404），
> 至少还能显示后端给的中文 message，而不是一片空白。
> 走这条分支说明 `window.Api` 本身不存在 —— 那是另一个问题，
> 不该在错误提示里被藏起来。

### 3.2b 检查台（status.js）也做了处理 ✅

★ 这一项是 Day 23 补的：审计第一遍只扫了 `frontend/pages/` 与 `frontend/js/`，
漏了 `frontend/js/pages/status.js` 的 3 处（`renderHealthFail` / `renderSessFail` / `renderWriteFail`），
写清单时实跑 `git grep` 才暴露出来。

**它与普通页面不同，所以处理方式也不同**：

| |普通页面 | 检查台 |
|---|---|---|
| 给谁看 | 终端用户 | **开发者** |
| 要什么 | 只说能不能重试 | 中文人话 + **错误码** |
| 错误码 | 藏起来 | **必须保留** |

检查台存在的意义就是告诉你「哪一步坏了、错误码是什么」，
只显示「服务器出了点问题」反而丢了排查信息。
所以做成**中文人话在前、错误码在括号里**：

```javascript
note(sessNote, friendlyOf(code, message) + '（错误码 ' + code + '）' + ' —— 页面显示 0 行不代表库里没有数据。', true);
```
显示效果：`服务器暂时读不到记录，我们正在处理（错误码 DB_QUERY_FAILED）`

**改前 / 改后对照**（Day 23 的学习点：哪句裸报错改成了人话）

| 位置 | 改前（用户看到的） | 改后 |
|---|---|---|
| `records.html` 删除失败 | `没能删掉：HTTP 404` | `没能删掉：没找到要找的内容，可能已经被删掉了` |
| `records.html` 收藏读不到 | `没能加载（DB_QUERY_FAILED）` | `没能加载（服务器暂时读不到记录，我们正在处理）` |
| `records.html` 整体加载失败 | `记录没能加载（INTERNAL_ERROR）` | `记录没能加载（服务器出了点问题…）` |
| `result.html` 判断未完成 | `这次没能完成判断（LLM_TIMEOUT）` | `这次没能完成判断（等得太久了，AI 还没回话，可以再说一次）` |
| `result.html` 异常 | `这次没能完成判断（ASR_AUTH_FAILED）` | `这次没能完成判断（语音功能暂时不可用，你也可以用文字继续）` |
| `dialogue.html` 降级提示 | `不是即时回应（LLM_TIMEOUT）` | `不是即时回应（等得太久了，AI 还没回话，可以再说一次）` |
| `topics.js` 概览 | `记录没能加载（HTTP_404_NOT_JSON）` | `连不上服务器，请检查网络或换个浏览器试试` |

### 3.3 后端返回的本来就是中文 ✅

```bash
grep -n "sendError(res" cloudfunctions/analyze/index.js
```
契约 §1.3 规定 `error.message` 必须是「**中文**、给用户看的一句话（不堆栈、不暴露内部信息）」。
`chat` / `analyze` / `speech` 四个函数都遵守，前端映射表是**第二道**保险 ——
它挡住的是前端自己造的 `HTTP_xxx` 码，以及历史遗留的英文文案。

### 3.4 顺手修掉的一个静默失效判断 ✅

`records.html` 的 `renderError()` 原来判断 `DB_CONNECTION_REFUSED`，
而**这个码Day 18 已经删了**（见 `docs/api-contract.md §1.4`）。
后果：所有数据库故障都被说成「页面本身没问题，最常见原因是直接双击打开了 HTML」——
真机用户根本没双击，方向完全说反了。

已改为**前缀判断** `code.indexOf('DB_') === 0`，
跟着 api-contract 的分类约定走，以后新增 DB 码自动归位——
不再重蹈「逐个列码 → 新增一个漏掉一个」。

---

## 四、非法输入

### 4.1 后端做参数校验 ✅

```bash
grep -nE "sendError\(res, 400" cloudfunctions/analyze/index.js
```
**实跑结果：**
```
468:  INVALID_JSON   请求体不是合法 JSON
473:  INVALID_PARAMS  缺少 topicId（必须是 T1–T8 或 FREE）
476:  INVALID_PARAMS  transcript 必须是数组
```
`INVALID_PARAMS` 实际有**两个来源**：显式校验 + PG 的 CHECK 约束
（`.test-write.js` 里有一条检查钉住这条路径）。

### 4.2 前端有长度与类型限制 ✅

- 对话页对用户输入有长度上限（超出会提示，不是静默截断）
- `PATCH` 只开放 `note` 与 `isFavorited` 两个键，**白名单在最靠近数据的地方也成立一次**
  （`api.js` 的 `patchItem()`）；后端接口层还会再拒一次
- ⚠️ `sendWithTimeout` **不做输入校验** —— 那是接口层的职责，
  前端多做一遍就是两份规则，不一致时极难查

### 4.3 请求体大小限制 ✅

`PAYLOAD_TOO_LARGE` 是后端主动拒绝超大请求体时发的码（两个函数都有）。

---

## 五、请求日志（余力加练· 已完成）

五个云函数（`chat` / `analyze` / `read` / `write` / `speech`）的每次响应都会打一行：

```
[chat] 09:37:27 POST /api/chat → 200 ok
[read] 09:37:27 GET /api/sessions → 400 INVALID_PARAMS
[speech] 09:37:27 POST /api/speech-to-text → 200 ASR_AUTH_FAILED
```

格式：`时间 方法 路径 → HTTP状态 结果`

### 5.1 加在 `sendJSON` 里，不是路由入口 ✅

`sendJSON` 是**所有响应的唯一出口**（成功走 `sendOK`、失败走 `sendError`，两条都汇到它）。
改这一处，每个函数 5 行就够；写在路由入口则每个 return 分支都要记得写一次——
**漏掉的那条恰恰是出问题时最想看的那条**。

```bash
# 复现：五个函数都在 sendJSON 里调用了
grep -A 2 "function sendJSON" cloudfunctions/*/index.js | grep logReq
```

### 5.2 ★ 只记三要素，不记请求体 ✅

```bash
node .test-request-log.js
```
**实跑结果：通过 15 / 失败 0**，其中三项专门盯「日志不泄露业务数据」：

| 判据 | 实跑 |
|---|---|
| 日志里没有 `aiText` 的值 | ✓ |
| 日志里没有「缺少 topicId」的中文原文 | ✓ |
| 请求带 `?topicId=T3&limit=20` 时日志里没有 `T3` | ✓ |

> ★ **为什么要盯这个**：请求体里是用户的对话内容（可能含个人信息），
> query 里是 topicId / itemId 这些业务数据。
> 打进日志等于在云端留一份没脱敏的用户数据，而且日志保留期通常比数据库长得多。
> 代码里对应两处：路径只取 `split('?')[0]`、结果只打 `ok` 或错误码，不打 `body.data`。

### 5.3 ★ 五份必须逐字同形 ✅

CloudBase 云函数**没有共享模块机制**，五个函数各存一份。
不同步的后果：「有的接口有日志、有的没有」——
而它看起来像「那个接口没被调用过」，极难查。

```bash
node .test-request-log.js   # 【7】项专门钉这条
```
**实跑结果：五份内容逐字一致（前缀除外）✓ 5 份完全一致**

改一份之后同步另外四份：
```bash
node .sync-logreq.js         # 用 chat 那份覆盖其余四份（可重复执行）
```

### 5.4 日志失败不影响请求 ✅

`logReq` 整体包在 `try/catch` 里 —— 写日志是为了排错，不是业务的一部分。
测试里「四个请求都返回了」一项就是验证这一点：
状态码原样穿过（200 / 400 / 500 / 200 / 200）。

### 5.5 ⚠️ 还没验的部分（诚实说明）

**CloudBase 控制台的日志面板格式没验过。**
上面验的是「函数会往 stdout 打出这样一行」，
CloudBase 是否原样收集 stdout、以及在哪看，需要**部署后打开控制台确认**。

⚠️ **改了云函数必须重新部署才生效**：
```bash
tcb fn deploy chat
tcb fn deploy analyze
tcb fn deploy read
tcb fn deploy write
```
（`cloudfunctions/speech` 若已建成HTTP 型，重部署方式见 `docs/day23-deploy-speech.md`）

---

## 六、遗留风险（诚实记录，不算通过）

| 风险 | 说明 | 处置建议 |
|---|---|---|
| **云函数日志里可能有用户对话内容** | 模型调用失败时，部分分支会把错误上下文打进日志 | 上生产前确认 CloudBase 日志保留期与访问权限 |
| **没有速率限制** | 前端可无限调 `/api/chat`，每次都真实调模型 = 真实花钱 | 体验版阶段可接受；上线前建议加并发上限 |
| **录音会离开设备** | 语音功能把音频传到腾讯云识别（PRD 已注明，`TECH_DESIGN §3.3`） | 已在产品说明里告知用户；不落库不留存 |
| **体验版连不上 PG** | 包版本限制，非代码问题 | 已在 `api-contract §2.1` 记为「已知的未通项」 |
| **本地 `serve.py` 无鉴权** | 任何人都能调本地服务上的页面 | 仅本机开发用，不对外暴露 |

---

## 七、Day 23 事故记录（已处置）

**2026-10-12 上午**，为查云函数「执行方式」而运行 `tcb fn detail speech`，
该命令把 `SecretId` / `SecretKey` / `AppId` 的**真实值**打印进了对话记录。

- **已作废**（用户于 2026-10-12 确认），并在控制台重新生成了新密钥
- **规则**：以后查云函数信息**不要用 `tcb fn detail`**。
  要看键名用：
  ```bash
  tcb fn env pull <name> --output-file <f> && grep -o "^ASR_[A-Z_]*" <f>
  ```
  ⚠️ 拉下来的文件**不要 cat**（笔记里早有这条要求，仍踩了）

---

## 一句话总结

**密钥 0 处泄漏（含 Git 历史）、`.env` 规则完整、三类错误已统一中文提示。**
唯一的历史事故（`tcb fn detail` 打印密钥）已作废处置。
两条`AKID` 搜索命中是确认安全的官方示例值与文档占位符，**不该删，也不该为了「0 条」而藏起来**。
---

## 八、打卡截图怎么截

### 8.1 错误提示对照（三类中文提示）

**网址（本地服务必须先起）**：
```bash
cd frontend && python serve.py
```
然后浏览器打开：
```
http://localhost:8010/pages/day23-errors.html
```

> ★ **不能用 `file://` 直接双击打开** —— 那会让 `fetch` 失败、`api.js` 加载异常，
> 页面停在「加载中…」，而截图看起来仍像排版正常（**截图成功 ≠ 页面有内容**）。

页面并排显示四类错误的「改前 / 改后」，**加载的是真实 `api.js`**，
所以每一句都与线上页面逐字相同。已生成的无头版截图在
`day23-截图/day23-错误提示对照.png`。

★ **打卡截图必须带 `localhost` 地址栏**，而无头 Chrome 截不到地址栏（属浏览器外壳），
所以上面这张无头图**只能用作留证，正式打卡要你在真浏览器里手动截**。

### 8.2 密钥搜索（两条口径，都要截）

**口径 A · 搜全部 AKID（2 条，都是确认安全的）**
```bash
git grep -nIE "AKID[A-Za-z0-9]{10,}" -- .
```
输出：
```
.test-asr-sign.js:38  'const ASR_SECRET_ID = "AKIDz8krbsJ5yKBZQpn74WFkmLPx3*******";' +
docs/day23-deploy-speech.md:32    SecretId     AKIDxxxxxxxxxxxxxxxx
```

**口径 B · 搜真实密钥（0 条）**
```bash
git grep -nIE "AKID[A-Za-z0-9]{10,}" -- . | grep -vE "\*\*\*\*\*\*\*|AKIDx+"
```
**实跑结果：0 条（退出码 1）** ← 这才是「仓库里没有真实密钥」的准确判据

> ★★ **完成标准写的是「搜索结果为 0 条」，但口径 A 必然是 2 条。**
> 建议**两张都截**，并在图旁标注：口径 A 的两条是腾讯云官方公开示例值与文档占位符，
> 口径 B 才是 0 条。
> ★★ **不要为了让搜索变成 0 条而删掉那两处** ——
> 单测的签名用例需要官方示例值才能算出确定结果，文档占位符是给人填配置时看的。
> **也不要把搜索范围缩到搜不到为止**（比如只搜某一个文件）——
> 那是在骗自己。正确判据是「**每一条都确认过安全**」。

### 8.3 其余自查项的截图（可选）

| 拍什么 | 怎么造出来 |
|---|---|
| `node .test-friendly-message.js` 全过 | 命令行直接跑 |
| `node .test-request-log.js` 全过（含五份一致） | 命令行直接跑 |
| 检查台三类错误 | `http://localhost:8010/pages/status.html`，点「检查健康 / 读记录 / 写测试」 |
| 仓库里搜不到连接串 | `git grep -nIE "postgres(ql)?://\|password[[:space:]]*[:=]" -- .`（0 条） |
