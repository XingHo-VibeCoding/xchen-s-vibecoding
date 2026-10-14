# 发布前检查 · 逐项真源表

> **这是真源**：每一项的命令、通过标准、出处（文件+行号 / 笔记）、已知误报风险都写在这里。
> `scripts/check.sh` 是它的可执行实现 —— **两者不一致时以本文件为准，改完同步改脚本**。
>
> 本表由 Day 25 从项目真踩过的坑整理：`docs/security-checklist.md`(Day 23) ·
> `verify.sh`(Day 17/18) · `docs/day24-测试清单.md` · 根目录 16 个 `.test-*.js` ·
> `frontend/regress.js` `a11y-check.js` `flt-verify.js` · `.workbuddy/memory/notes/` 下 7 份踩坑笔记。

**三条贯穿全表的判据原则**（违反任何一条，这一项就会变成「假绿」或「假红」）：

1. **每项必须能看到实际值**，不许只输出「通过」。
2. **取不到值 → 判 FAIL / SKIP，绝不判 PASS**。上游静默失败是这类检查最大的敌人
   （本项目已吃过两次：`verify.sh` 的 `getf` 语义写反 → 差点把库里昵称写成空；
   `friendlyMessage` 兜底原样回吐英文码）。
3. **白名单显式写在脚本里**，命中要打印「为什么安全」；判据是「每一条都确认过安全」，
   不是「一条都没有」—— 后者会逼着人删掉该留的东西。

---

## 组 1 · 密钥与仓库卫生

### 1.1 仓库里没有真实密钥

| | |
|---|---|
| **命令** | `git grep -nIE "AKID[A-Za-z0-9]{10,}" -- .` |
| **通过标准** | 命中的**每一条都在白名单里**；另跑一次机器判据 `... \| grep -vE "\*\*\*\*\*\*\*\|AKIDx+"` 必须 **0 行** |
| **白名单（脚本里写死）** | `.test-asr-sign.js`（腾讯云官方签名示例值，尾部带 `*******` 掩码）与 `docs/day23-deploy-speech.md`（全是 x 的占位符） |
| **出处** | `docs/security-checklist.md §1.1`、`§8.2`（口径 A / 口径 B） |
| **误报风险** | 低。**但判据不许写成「命中数 = 0」** —— 那会逼着删掉单测需要的官方示例值与给人看的占位符 |

### 1.2 Git 历史里没有真实密钥

| | |
|---|---|
| **命令** | `git log --all -p --no-color \| grep -oE "AKID[A-Za-z0-9]{10,}" \| sort -u` |
| **通过标准** | 去重后 ⊆ `{AKIDx…, AKIDz8krbs…}` |
| **出处** | `docs/security-checklist.md §1.4`（当时查了 52 个提交） |
| **误报风险** | 低。全历史扫描慢，但安全项不省。★ 删掉的密钥还在 git 对象里 —— 代码干净 ≠ 历史干净 |

### 1.3 没有数据库连接串与密码

| | |
|---|---|
| **命令** | `git grep -nIE "postgres(ql)?://\|mysql://\|password[[:space:]]*[:=]" -- .` |
| **通过标准** | **排除「文档里把这条命令写成示例」的行之后**，0 条 |
| **出处** | `docs/security-checklist.md §1.2`（原文写「实跑结果：0 条」） |
| **★ 误报风险（已实测复现）** | 现在跑出 **1 条命中**，来自 `docs/security-checklist.md:47` —— **那份文档把自己这条命令写进去了，于是被自己搜到**。原判据「0 条」现在跑不出来。修法：判据改成「排除含 `git grep` 字样的行后为 0」（与 §1.1 是同一个机制：**把检查命令写进文档，文档就变成命中源**） |

### 1.4 `.env` 系被正确忽略、`.env.example` 不被误伤

| | |
|---|---|
| **命令** | `git check-ignore --no-index -v .env .env.local .env.production .cloudbase-api-key.local.json`，再单独问一次 `git check-ignore --no-index -v .env.example` |
| **通过标准** | 前四个都必须出现在输出里；`.env.example` 命中的规则必须是 **`!.env.example`**（例外规则本身存在），不能是被第 3 行的 `.env.*` 吃掉 |
| **出处** | `docs/security-checklist.md §2.1`；`.gitignore:1-21` |
| **误报风险** | 只看退出码必误判 —— **有任何一个命中，退出码就是 0**。判据必须按「最后一段是不是这个文件名」逐行比对（脚本用 awk 比 `$NF`） |
| **★ 漏报风险（探针实测）** | `git check-ignore` **不对已被跟踪的文件应用忽略规则**，而 `.env.example` 已被跟踪 → 不带 `--no-index` 时它永远报「未命中」，本项就永远 PASS。**实测**：把 `!.env.example` 那行注释掉（于是被 `.env.*` 吃掉），本项**依然报 PASS**。加 `--no-index` 后正常态命中 `!.env.example`、注释掉后命中 `.env.*` → 抓得到（见 M6） |

### 1.5 被跟踪的密钥类文件恰好只有 `.env.example`

| | |
|---|---|
| **命令** | `git ls-files \| grep -iE "\.env\|secret\|credential"` |
| **通过标准** | 输出**恰好一行** `.env.example` |
| **出处** | `docs/security-checklist.md §1.5`（原文写「实跑结果：空」） |
| **★ 误报风险（已实测复现）** | 今天实测输出就是 `.env.example` 一行 —— 原文「必须为空」的判据**已过时**：Day 23 之后这个文件被正式纳入版本库了（那是设计意图，`.gitignore:11` 的 `!.env.example` 就是为它写的）。按「必须为空」判会必 FAIL |

---

## 组 2 · 公网与接口

> 基址（脚本里的 `$B`）：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com`
> ★ 所有 `curl` 都必须带 `--noproxy '*'`：本机有 `http_proxy` 环境变量，不加会把请求送进代理。

### 2.1 接口活着且外壳是 `{ok,data,error}`

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 "$B/api/health"`（另两个把路径换成 `/api/sessions`、`/api/favorites`） |
| **通过标准** | health → `{"ok":true,"service":"TalkTrainer"}`；另两个 `ok:true` 且 `data.count` 是整数 |
| **出处** | `verify.sh:55-66`；`docs/api-contract.md §1.2` |
| **误报风险** | 网络抖动（`verify.sh:41` 已内置 3 次重试，本脚本同样重试）；漏掉 `--noproxy '*'` 会整片假失败 |

### 2.2 ★ 跨域头真的存在

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 -D - -o /dev/null -H "Origin: http://localhost:8010" "$B/api/sessions" \| grep -i access-control` |
| **通过标准** | 出现 `access-control-allow-origin: http://localhost:8010`（实测同时还有 `allow-credentials: true`、`max-age: -1`） |
| **出处** | 控制台路由要开「跨域设置」，见 `notes/cloudbase-pg.md §3`；Day 22/24 两次踩过 |
| **★ 误报风险（最高，已实测）** | **不带 `Origin` 时网关一个 `access-control-*` 头都不发**（实测：带 → 3 个头；不带 → 0 个）。所以「用不带 Origin 的请求去查跨域」是必然假红；反过来，只看到 `curl` 200 就以为通了是必然假绿 —— **浏览器被拦时 curl 照样 200** |

### 2.3 非法参数被挡住

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 "$B/api/sessions?topicId=T9"`、`...?limit=abc` |
| **通过标准** | 两者都返回 `error.code = INVALID_PARAMS` |
| **出处** | `verify.sh:73-76`；`docs/api-contract.md §1.4` 通用类 |
| **误报风险** | 取值失败时**不许判 PASS**。`verify.sh:39-49` 的 `getf` 就是为此而生，且第一版把语义写反（写成「只有第 3 参数才算有效」）→ 拿空串去改库，**把 S-MOCK-01 的昵称永久写空** |

### 2.4 404 / 405 是我们自己的 JSON 外壳

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 -o body -w '%{http_code}' "$B/api/nope"`；再 `-X PUT "$B/api/sessions"` |
| **通过标准** | 404 + `error.code=NOT_FOUND`；405 + `error.code=METHOD_NOT_ALLOWED`；body 是 JSON 不是 HTML |
| **出处** | `docs/api-contract.md §1.3/§1.4`；`.workbuddy/after-day19/06-notfound.json`、`07-wrongmethod.json` |
| **误报风险** | 路由是**前缀、最长优先**匹配（`notes/cloudbase-pg.md`）：`/api/nope` 不匹配任何具名路由，会落到裸 `/api` → health 函数负责回 404。若哪天网关自己回了 HTML 404，本项要判 FAIL（那说明落到了网关默认页，不是我们的外壳） |

### 2.5 公网首页不是「风险提醒」拦截页

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 "$B/pages/topics.html" \| grep -oE "<title>[^<]*</title>"` |
| **通过标准** | 标题是「口语对话实战器…」，不是「风险提醒」 |
| **出处** | `notes/cloudbase-pg.md §「风险提醒」拦截页（Day 20）` |
| **★ 误报风险** | **拦截页也返回 HTTP 200**，所以状态码完全无法区分，只能比标题。更重要的是：触发条件是请求头 `Sec-Fetch-Mode: navigate`，**`curl` 拿到的可能是对的、无头 Chrome 拿到的是拦截页** → 本项只能当粗筛，**发布前必须真浏览器肉眼确认一次** |

---

## 组 3 · 环境变量

### 3.1 云函数必需环境变量齐

| | |
|---|---|
| **命令** | 主判据：`tcb fn env pull <函数名> --output-file <临时文件> && grep -oE "[A-Z][A-Z_0-9]{3,}" <临时文件>`（**只 grep 键名，绝不 `cat`**）<br>自洽判据：`grep -rhoE "process\.env\.[A-Z_0-9]+" --include='*.js' cloudfunctions/` 与 `grep -oE "^[A-Z_0-9]+" .env.example` 两边集合相等 |
| **通过标准** | 代码键名集合 = `.env.example` 键名集合（当前 **11 个**）；且**必需 7 个**在控制台里都配齐 |
| **必需 / 可有默认** | **必需 7**：`LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL`（`chat/index.js:76-79`、`analyze/index.js:98-101` → 缺则 `LLM_NOT_CONFIGURED`）、`ASR_SECRET_ID` `ASR_SECRET_KEY` `ASR_APPID`（`speech/index.js:78-81` → `ASR_NOT_CONFIGURED`）、`CLOUDBASE_API_KEY`（`read/httpdb.js:37`）<br>**有默认值 4**（缺了不算失败）：`CLOUDBASE_ENV_ID`(`read\|write/httpdb.js:36` `\|\| 'cxj1528-…'`)、`ASR_REGION`(`speech/index.js:65` `\|\| 'ap-shanghai'`)、`ANALYZE_DEBUG`(`analyze/index.js:656` 只认 `=== '1'`)、`PGHOST`（Day 18 改走 HTTP API 后**已废**，只剩 `read/index.js:356` 一行诊断日志） |
| **出处** | `docs/security-checklist.md §1.3`；`docs/api-contract.md §「云函数环境变量」`；Day 25 逐文件读代码核出 |
| **误报风险** | ① 拉下来的文件**绝不能 cat**（Day 23 事故：`tcb fn detail` 把真密钥打进了对话记录）；② 原清单只写 8 个键，实测代码读 **11 个** —— 不区分「必需 / 有默认」就会误报；③ `tcb` 不可用时本项判 **SKIP**（不算通过），并在输出里明说「控制台实际配置没验」；④ **判据必须锚定「行首键名 + 等号」**（`^KEY=`）—— `pull` 出来的格式是 `KEY=VALUE`，第一版写成 `grep -E "[A-Z]${k}"` 会多要一个前导大写字母，于是键明明在也判「缺」，**一口气报 11 条假失败**（见 M7） |
| **首跑实测** | 五个函数的键**全齐**：`chat` 3 键、`analyze` 3 键、`speech` 3 键、`read` 2 键、`write` 2 键 |

### 3.2 缺变量报 `*_NOT_CONFIGURED`，不静默失败

| | |
|---|---|
| **命令** | `grep -n "NOT_CONFIGURED" cloudfunctions/{chat,analyze,speech}/index.js` |
| **通过标准** | 三个函数都有对应分支 |
| **出处** | `docs/security-checklist.md §1.3`；`notes/cloud-functions.md` |
| **误报风险** | 低。★ 注意 `read` / `write` 的 `CLOUDBASE_API_KEY` 写成 `\|\| ''`，**没有** `checkEnv` → 缺了报的是 `DB_AUTH_FAILED`。那是设计之内（`§1.4` DB 表已把「Key 没配、填错或无权限」列为该码的排错方向），**不该判 FAIL** |
| **★ 漏报风险（已修）** | 判据若只写 `grep -q NOT_CONFIGURED 文件`，**把分支注释掉也会 PASS**（注释里有这几个字）。首跑发现同类漏洞后已改成「剥注释后再数」（复用第 15 项的 `strip-grep.py`，见 M10） |

---

## 组 4 · 前端静态与运行时

### 4.1 前端 JS 语法 + 五页五断点回归（合并为一项、两步）

| | |
|---|---|
| **命令** | ① `for f in $(git ls-files -- frontend \| grep -E '\.js$'); do node --check "$f"; done`<br>② `cd frontend && python serve.py`（另一终端）→ `node regress.js` |
| **通过标准** | ① 无语法错；② 输出里 `===== 结果：N 通过 / 0 失败 =====` **且** `【控制台】0 条报错`，且无横向溢出、无 <44px 触控 |
| **出处** | `frontend/regress.js:3`（判据）、`:194`（控制台行）、`:196`；`notes/headless-cache.md §5` |
| **★ 误报风险** | ① **`regress.js` 永远 `process.exit(0)`，退出码不可信** —— 必须解析输出文本；② **通过数不可信**（只测 DOM/CSS），真正管用的是「控制台 0 条报错」；③ `node --check` **抓不到未定义变量**这类运行时错误，只有真跑才暴露；④ 本地服务没起时本项判 **SKIP**，不许判 PASS |
| **★★ 实测证据（Day 25 故意弄坏）** | 在 `frontend/js/speech.js` 末尾加一行 `var __day25BrokenProbe = FRAME_MS;`（`FRAME_MS` 从未定义），然后：<br>· `node --check frontend/js/speech.js` → **通过**（静态一片绿）<br>· 本项 → **FAIL**，实际值 `===== 结果：25 通过 / 0 失败 ===== ；【控制台】Uncaught \| Uncaught \| …`<br>★ 注意**回归的「25 通过 / 0 失败」照样全绿** —— 揪出它的只有「控制台 0 条报错」这一条。这就是为什么判据必须看控制台，不能看通过数 |
| **已知局限** | 控制台那行打出来只有 `Uncaught`（来自 `regress.js:141` 的 `exceptionDetails.text`），**不含错误消息**，所以只能判「有没有报错」、不能告诉你「报了什么」。要更好用需改 `regress.js` 去读 `exceptionDetails.exception.description` —— **那要动既有开发工具，先问用户** |

### 4.2 内联 JS 的 `/*` 与 `*/` 配对

| | |
|---|---|
| **命令** | 对 `frontend/pages/{dialogue,result,records}.html` 各查 `grep -c '/\*'` 与 `grep -c '\*/'` |
| **通过标准** | 每页左右计数相等 |
| **出处** | MEMORY 硬规则（改内联 JS 必验两条之一） |
| **误报风险** | 字符串字面量里的 `/*` 会被误算 → 只能当粗筛；真正的判据仍是 4.1 的「控制台 0 条报错」 |

### 4.3 前端不引用已删除的错误码

| | |
|---|---|
| **命令** | 先**剥注释**再搜：以 `scripts/check.sh` 里的 `strip-grep.py` 为过滤器，`python strip-grep.py "DB_CONNECTION_REFUSED\|DB_HOST_UNREACHABLE" frontend`；另 `grep -rc "indexOf('DB_')" frontend/` |
| **通过标准** | 剥注释后命中 **0 处**；且前缀判断至少出现在 1 处（DB 类改用 `code.indexOf('DB_') === 0`） |
| **出处** | `docs/security-checklist.md §3.4`；`docs/api-contract.md §1.4`（Day 18 删了这 2 个码） |
| **★ 误报风险（首跑实测）** | 直接 `git grep` 会搜到 **6 处**，**全是注释**（`frontend/js/api.js:41`、`frontend/pages/records.html:581/680/687`、`frontend/regress.js:94/155`）—— 那些是在解释「这个码 Day 18 就删了」的历史。注释里写历史是对的，不该算「代码还在用它」 → 判据必须先剥注释（同 `notes/sql-pitfalls.md §3`：解析前先剥注释） |
| **通用教训** | 这条对应一类通用陷阱：**删码/改码后必须回搜前端所有按它判断的地方**，否则分支永假，表现成「文案方向完全说反」 |

---

## 组 5 · 数据口径与契约

### 5.1 `sessions` / `favorites` 的 count 是整数

| | |
|---|---|
| **命令** | `curl -s --noproxy '*' -m 25 "$B/api/sessions"`（与 `/api/favorites`） |
| **通过标准** | `data.count` 是整数 |
| **出处** | `verify.sh:53,60,66` |
| **★ 误报风险** | 判据**不许用** `grep -qx '[0-9]'` —— 那只能匹配**一位数**，count 一变成 10 就误判成「缺失」。`verify.sh:53` 的 `isnum()` 就是为此改的 |

### 5.2 B6 · 中途退出的 `endedAt` 必须是 `null`

| | |
|---|---|
| **命令** | curl sessions + python 取 `[s for s in d['data']['sessions'] if s['aborted']][0]['endedAt']` |
| **通过标准** | 取值是 `None`（字符串 `None`）**且** aborted 场次数 > 0 |
| **出处** | `verify.sh:78-81`；`PRD.md` B6 |
| **★ 误报风险** | 「取到 `None`」不能被当成「取不到值」→ `verify.sh` 的 `getf` 专门加了第 3 个参数。另：库里**没有** aborted 场次时本项要判 FAIL（「没数据」不等于「合规」） |

### 5.3 B7 · 偏题无改法 / 逻辑错误有改法

| | |
|---|---|
| **命令** | curl favorites + `all(i['correction'] is None for i in ... if i['type']!='logic')` 与其反面 |
| **通过标准** | 两个都 `True` |
| **出处** | `verify.sh:83-93`；`PRD.md` B7 |
| **★ 误报风险** | 判据写成布尔**列表**（`[True, True]`）再拿去比对永远不成立 → 必 FAIL。Day 18 踩过，必须用 `all()` 收成**单个布尔** |

### 5.4 错误码与 `api-contract §1.4` 一致

| | |
|---|---|
| **命令** | 扫 `cloudfunctions/` 下所有引号大写串，按前缀过滤，再减去变量名白名单，最后与 §1.4 的 **20 个码**双向 diff |
| **通过标准** | 双向 diff 为空（文档 = 代码） |
| **出处** | `docs/api-contract.md §1.4`（通用 5 + LLM 11 + DB 4 = **20 个**）及其「⚠️ 核对时注意」段 |
| **★ 误报/漏报风险（最高）** | ① **错误码在代码里有两种以上写法**：`sendError(res, 400, 'CODE', …)` 与 `e.code = 'CODE'`；只 grep 前者会漏掉后者（Day 19 因此漏了 `INVALID_JSON` 与 `PAYLOAD_TOO_LARGE`）<br>② 实测：只 grep `sendError` 得 9 个、加上 `e.code=` 得 19 个、**放开手抓会混进 `LLM_API_KEY` / `ASR_SECRET_ID` 这类变量名** → 必须按前缀过滤 + 显式变量名白名单<br>③ `DUPLICATE` 这两种写法都抓不到（它在别的形式里）→ 抓法本身要定期校准<br>④ **`ASR_*` 那 11 个码按 5.5 的拍板不纳入本项**（`grep -c ASR_ docs/api-contract.md` = 1，§1.4 没有它们的位置），它们的漂移风险由 5.5 兜住 |

### 5.5 前端 `friendlyMessage` 覆盖代码里出现的每一个码

| | |
|---|---|
| **命令** | 把 5.4 的抓取结果（**含 ASR 类**）与 `frontend/js/api.js` 里的码做 `comm -23`。★ 抓 api.js 要**两种写法都抓**：带引号的 `'INVALID_PARAMS'` **和** 无引号的对象键 `var INPUT_MAP = { INVALID_PARAMS: '…' }` |
| **通过标准** | 差集为空 —— 代码里出现的每个码都能在前端映射表里找到中文（当前：代码 31 个 / 映射表 32 个） |
| **出处** | `docs/security-checklist.md §3.1`、`§3.1b`（`SOME_NEW_CODE_2027` 被原样显示给用户那次） |
| **★ 误报风险（首跑实测）** | 只抓带引号的码 → api.js 用的是**无引号对象键**，抓出来是**空的** → 报「31 个码全没映射」的假失败。补上第二种抓法后一次通过（见 M9） |
| **通用教训** | 这条**不需要文档真源**，是纯代码内部自洽 —— 它专治「后端加了个新码、前端没跟」，D23 那次事故正是这一类 |

> ### 为什么 5.4 与 5.5 这么分工（Day 25 用户拍板）
> 把 11 个 ASR 码纳入 §1.4 比对，代价是**先要改一份已定稿的契约**（它白纸黑字写「三张表合计 20 个」），
> 以后每次动 speech 都要同步两处。改用「代码 ↔ 前端映射表」这条自洽判据后，
> 真源只留 §1.4 一处，而 ASR 码的漂移照样能被抓住。

---

## 附 · 本地开发注意（不占检查项编号）

- **L1** 页面必须走本地服务：`cd frontend && python serve.py` → `http://localhost:8010/pages/topics.html`。
  **不许双击 HTML** —— `file://` 下浏览器会拦掉 `fetch`，页面数据加载不出来（`README.md:48-50`）。
- **L2** 本机有 `http_proxy` 环境变量：自测本机服务要 `curl --noproxy '*'`；
  无头 Chrome 建议加 `--no-proxy-server`（MEMORY §7）。

## 附 · 已知的判据缺陷（诚实记录）

| # | 原判据所在 | 原写法 | 实测结果 | 本表怎么改 |
|---|---|---|---|---|
| M1 | `security-checklist §1.2` | 连接串搜索「实跑 0 条」 | 1 条命中，来自该文档自己写的命令 | 判据改为「排除含 `git grep` 的行后为 0」（见 1.3） |
| M2 | `security-checklist §1.5` | 「被跟踪的密钥类文件 = 空」 | 输出 `.env.example` 一行 | 改为「恰好只有 `.env.example`」（见 1.5） |
| M3 | `security-checklist §2.2` | `git status --short .env.example` 显示 `??` | **输出为空**（已被跟踪，git 不对已跟踪文件应用忽略规则） | 判据作废，见 1.4 |
| M4 | 跨域检查（各处都没有规定带 `Origin`） | 「查响应头里有没有 CORS」 | **不带 `Origin` 时一个头都没有** | 命令固定带 `Origin`（见 2.2） |
| M5 | 错误码抓法 | 只 grep `sendError` | 9 个；加 `e.code=` 得 19 个；宽手抓混入变量名；`DUPLICATE` 抓不到 | 前缀过滤 + 变量名白名单 + 双向 diff（见 5.4） |
| M6 | 本 Skill 第 4 项**初版** | 用 `git check-ignore -v`（带索引）问 `.env.example` | ★★ **探针实测漏报**：`.env.example` 已被跟踪，而 git 不对已跟踪文件应用忽略规则 → 它永远报「未命中」→ 把 `!.env.example` 注释掉本项**仍报 PASS** | 加 `--no-index`（问「假如没被跟踪，规则怎么判」），且判据改为「命中的必须是 `!.env.example`」 |
| M7 | 本 Skill 第 11 项**初版** | `grep -E "[A-Z]${k}"` 找键名 | 多要一个前导大写字母 → 键明明在也判「缺」→ 报 11 条假失败 | 锚定 `^KEY=` |
| M8 | 本 Skill 第 15 项**初版** | `git grep` 直接搜已删的码 | 6 处命中**全是注释** | 先剥注释再搜 |
| M9 | 本 Skill 第 20 项**初版** | 只抓带引号的码 | api.js 用无引号对象键 → 抓出来是空的 → 报「31 个码全没映射」 | 两种写法都抓 |
| M10 | 本 Skill 第 12 项**初版** | `grep -q NOT_CONFIGURED 文件` | 把分支注释掉也会 PASS（注释里有这几个字）——与 M8 同类的**漏报**，靠 M6 的探针顺带想到 | 复用 `strip-grep.py` 剥注释后再数 |

★ **M1 与 M2/M3 的共性是同一条规律**：**「把检查命令写进文档」会让文档变成命中源**；
**「把某个文件纳入版本库」会让基于忽略规则的判据失效**。改判据之前先问一句「这条判据建立在什么之上」。

★★ **M6–M10 的共性是另一条**：**判据只认「有没有这个字样」，不认「它是不是真的生效」** ——
所以「被跟踪的文件」要用 `--no-index` 问纯规则、「注释里的字样」要先剥注释。
一句话：**判据要锚定到「行/规则/语法位置」，不要浮在「字符串出现过」这一层。**

## 附 · 未定事项（碰到了问用户，不要自己定）

1. `read` / `write` 的 `CLOUDBASE_API_KEY` 要不要也加 `checkEnv`（现在缺了报 `DB_AUTH_FAILED`，能定位但不够直白）。
2. 5.4 的抓法对 `DUPLICATE` 这类「非字面量形式」的码仍抓不到 —— 值不值得为它写一个更重的 AST 级检查。
3. 2.5 的拦截页触发条件只定性到 `Sec-Fetch-Mode: navigate`，**机制来源未查清**，换环境可能复发。
4. 第 13 项打出来的控制台那行只有 `Uncaught`（`frontend/regress.js:141` 取的是 `exceptionDetails.text`），
   **不含错误消息** → 只能判「有没有报错」，不能告诉你「报了什么」。
   要更好用需改 `regress.js` 去读 `exceptionDetails.exception.description`，**那要动既有开发工具，先问用户**。
5. 第 19 项的抓法对「注释掉的错误码」会误报（注释里出现新码 → 双向 diff 不为空）。
   要不要也给它套 `strip-grep.py` 剥注释，等有真实案例再定。
