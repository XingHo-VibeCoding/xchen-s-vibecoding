# Day 24 · 核心流程测试清单（检查台 + 收藏页）

> 用途：**修复 Bug 前跑一遍（复现）、修复后再跑一遍（回归），前后各留一份证据。**
> 每一步都可独立跑，勾选框 `□ 复现` / `□ 修复后` 各记一次。
>
> 本清单按**本项目真实链路（A 口径）**编制，口径对齐见 §0。
> 每一步的结构固定为：**怎么测 → 正常现象（判据）→ 刁钻输入 → 若失败：原因排序 → 每个原因的验证方法 → 修复方向 → 回归项**。

---

## §0 口径对齐（你写的 → 本项目实际）

| 你写的 | 本项目实际 | 依据 |
|---|---|---|
| 读取 `plan_days` / `checkins` | **这两张表不存在**。核心表是 `sessions` | `frontend/pages/status.html:52`；`docs/api-contract.md §6.2`「本项目不是打卡应用」 |
| 写入「打卡」 | 写入 = `POST /api/sessions/write`，写**一场练习记录**（`S-TEST-` 前缀） | `frontend/js/pages/status.js:251` `TEST_SESSION_ID` |
| 修改 → 删除 | 检查台**没有**改/删按钮；改/删作用于 **`items` 收藏条目**，入口在**收藏页 `records.html`** | `frontend/pages/status.html`（只有三块）；`records.html:311` |

**结论**：这条链跨两个页面 —— 步 1–4 在**检查台**（`pages/status.html`），步 5–6 在**收藏页**（`pages/records.html`）。

---

## §1 怎么打开（两条路，**都不能双击 HTML**）

| 环境 | 打开方式 | 地址 |
|---|---|---|
| 本地 | `cd frontend && python serve.py` | `http://localhost:8010/pages/status.html` |
| 公网 | 已静态托管（Day 20/23） | `https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/pages/status.html` |

★ 双击 HTML（`file://`）会让 `fetch` 全部被拦 —— 见步 1 原因 1。
★ 换版本后要 `Ctrl+Shift+R` **强制刷新**，否则看的是缓存里的旧代码。

**开跑前先记基线**（每步都拿它比）：
- 检查台第二块显示的「sessions 行数」＝ ______ 行
- SQL 编辑器跑 `select count(*) from sessions;` ＝ ______ 条

（SQL 编辑器在 CloudBase 控制台；命令行写法见 `docs/api-contract.md §4.2` 的 `tcb db execute`。**两边必须一致**，这是「是不是连的同一个库」的判据。）

---

## 步 1 · 打开检查台

**怎么测**：按 §1 打开 `status.html`，等三块（健康 / 核心表 / 写入测试）各自出结果。

**正常现象（判据）**
1. 第一块显示「服务 = TalkTrainer」「接口基址 = …」
2. 第二块显示行数与行卡片
3. 顶部 `last-updated` 出现时间戳（如「最后更新：12:40:05（数据取自云端数据库）」）

**刁钻输入**：断网点一次「重新读取」；同一页快速连点两次。

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因（按可能性） | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | **用 `file://` 双击打开了 HTML** | 看地址栏开头是不是 `file:///` | 改用 `serve.py`（§1） |
| 2 | **`api.js` 没加载** | F12 Network 里 `js/api.js` 是不是 200；页面是否显示「接口模块没加载（js/api.js）」 | 查 `<script>` 路径与加载顺序（`status.html:94-95`） |
| 3 | **请求打到了本地静态服务**（BASE 判断错） | F12 Network 看请求 URL 的 host —— 本地打开却打到 `localhost:8010` 就是它 | `api.js:65-67` 的 `IS_LOCAL` 判断 |
| 4 | **公网被 CloudBase 拦** | 看页面**标题**是不是「风险提醒」（此时 HTTP 也是 200） | 换真浏览器访问，别用命令行/无头 |
| 5 | 云函数冷启动超 25 秒 | F12 Network 看请求状态（pending / aborted） | 再点一次「重新读取」，一般即恢复 |

**回归项**
- □ 三块都出结果（不出现「读取中…」卡住）
- □ `last-updated` 有时间戳
- □ F12 Console **0 条红色报错**

---

## 步 2 · 读取 `sessions`

**怎么测**：看第二块「sessions 行数 / 累计问题条目 / 条均轮次」，以及下面的逐行卡片。

**正常现象（判据）**
1. 行数与 §1 基线一致（接口带 `limit=8`，故最多显示 8 行）
2. 每行卡片有：`topicId` 标签 + 时间（`MM-DD HH:MM`）+ 轮次/问题/精彩句子 三行 + 完整 `sessionId`
3. 「中途退出」的行会多一个标签（`isComplete === false`）

**刁钻输入**：库里 0 行时会怎样；`limit` 传非法值；行数超过 8 行时是否只显示 8 行。

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因 | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | `DB_AUTH_FAILED`（`CLOUDBASE_API_KEY` 没配/填错） | 提示里括号内的错误码；看响应体 `detail` | → `notes/cloudbase-pg.md`（本部署最常见的一类） |
| 2 | `DB_TABLE_MISSING`（建表脚本没在库里跑过） | 错误码；SQL 里 `\dt` 有没有 sessions 表 | 跑 `db/schema.sql` |
| 3 | 显示 **0 行但没有报错** | 直接用 SQL 查库确认到底有没有数据 | ★ 这里**不会**是降级假数据 —— 检查台**刻意不用** `getSessionsOrLocal`（`status.js:236-237`）。若 0 行且无错 → 真连的是空库 |
| 4 | 有数据但行数与基线对不上 | 比 F12 Network 里 `/api/sessions` 的响应 JSON 与 SQL 结果 | 连错库 / 网关路由指到别的函数 |
| 5 | 卡片显示 `undefined 轮`、时间空白 | F12 Network 看响应 JSON 的**字段名** | 接口改了字段名但 `status.js` 没跟着改（`renderSessOk`） |

**回归项**
- □ 行数与 SQL 基线一致
- □ 在 SQL 里加/删一行 → 点「重新读取」→ 数字跟着变
- □ 每行 `sessionId` 能在 SQL 里查到

---

## 步 3 · 写入测试（`POST /api/sessions/write`）

**怎么测**：点「写一条测试数据」（`sessionId = S-TEST-DAY20`）。

**正常现象（判据）**
1. 第一次点 → 提示「写入成功：S-TEST-DAY20（轮次存了 1 条、条目存了 0 条）」
2. 第二块**自动重读**，出现这一行（写入即闭环，不用手动点第二个按钮）
3. **第二次点** → 提示「主键冲突（DUPLICATE）：…这是约束生效，不是故障」
4. 提示里的清理 SQL 可用：`delete from sessions where session_id = 'S-TEST-DAY20';`

**刁钻输入**：连点两次；先清理再写；`transcript` 传空数组（应 `INVALID_PARAMS`）。

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因 | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | **第二次点显示「写入失败」而不是 DUPLICATE** | ① F12 Network 看响应：是不是 `HTTP 400` + body `error.code = "DUPLICATE"`；② 看页面提示括号里的码：是 `DUPLICATE` 还是 `HTTP_400` | `api.js` 错误分类**必须先读 `body.error.code`**（`sendWithTimeout`，`api.js:509`），顺序反了就会盖掉业务码 |
| 2 | **第一次点就回 DUPLICATE** | SQL 查 `select * from sessions where session_id='S-TEST-DAY20';` | 上次测试行没清；执行清理 SQL 再试 |
| 3 | `INVALID_PARAMS` | F12 Network 看**请求 body**：`startedAt` 是否 `+08:00` 结尾、`transcript` 是否≥1 轮 | 时间戳格式 / 必填字段（契约 §4之一） |
| 4 | `DB_*` | 同步 2 的表 | → `notes/cloudbase-pg.md` |
| 5 | 按钮**卡在「写入中…」不变回** | F12 Network 看该请求是否 pending / aborted | 超时（`TIMEOUT_MS` 25s）未 settle；查 `doWrite` 的 `finally` |

**回归项**
- □ 第一次 = 成功（200），第二块行数 +1
- □ 第二次 = DUPLICATE（**不是**「失败」）
- □ SQL 里能查到 `S-TEST-DAY20` 这一行
- □ 清理 SQL 执行后，行数回到基线

---

## 步 4 · 刷新确认（「重新读取」）

**怎么测**：点「重新读取」。

**正常现象（判据）**
1. 三块同时重算
2. `last-updated` 更新为**当前时刻**
3. **只成功时才更新** —— 失败时它应保持上一次成功的时间（`status.js:105`、`219` 的设计意图）

**刁钻输入**：**断网后**点「重新读取」；快速连点两次。

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因 | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | **失败时 `last-updated` 也变了** | 断网点一次，看顶部时间戳有没有变 | `stampUpdated()` 应只在成功分支调（`renderHealthOk` / `renderSessOk`），别放进 `finally` 或失败分支 |
| 2 | 数字没变 | F12 Network 确认 `/api/sessions` 这次**真的发出去了** | 本项目读接口无缓存，若没发请求 → 事件没绑上 |
| 3 | 汇总数字变了但行卡片没变（或反之） | 对比第二块上下两部分的 DOM | `sessList` / `sessRows` 两处 `replaceChildren` 有一处漏了 |

**回归项**
- □ 改库 → 点重新读取 → 数字跟着变
- □ **断网** → 提示失败 + 错误码，且 `last-updated` **不动**

---

## 步 5 · 修改（`PATCH /api/sessions/write`）★ 当前无界面入口

> **现状（已核实）**：`api.js` 里有 `patchItem` 并已导出，但**全仓库没有任何页面调用它** ——
> `records.html` 的收藏切换走的是 `window.Storage.toggleFavorite`（localStorage），**不是** PATCH。
> 所以这一步**目前只能在命令行验证**。这不是 Bug，是**界面覆盖缺口**，先记着。

**怎么测**（Git Bash 版；`$B` 见 §1 公网地址）
```bash
B=https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com
curl -s -X PATCH "$B/api/sessions/write" -H "Content-Type: application/json" \
  -d '{"itemId":"<库里真实的一条 itemId>","note":"验证用备注"}'
```
PowerShell 版：把换行改成反引号续行，或把 JSON 写进文件用 `--data-binary @file.json`。
也可直接跑仓库根的单测：`.test-modify.js`。

**正常现象（判据）**
1. 返回 `{ok:true, data:{item:{…}, before:{note,isFavorited}, changed:[…]}}`
2. `isFavorited:true` → `favoritedAt` 被**连带写上**；`isFavorited:false` → `favoritedAt` **变 null**

**刁钻输入**：不存在的 `itemId`；只传 `originalText`；`note` 超长；`isFavorited` 传字符串 `"yes"`。

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因 | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | `NOT_FOUND` 但 id 确实存在 | SQL 查：`select item_id,is_deleted from items where item_id='…';` | 该条**已软删**（`is_deleted=true`）→ 404 是**预期行为**，不是 bug |
| 2 | 报英文 CHECK 约束名（`23514 ck_items_favtime`） | SQL 看 `is_favorited` 与 `favorited_at` 是否一有一无 | 接口层的**连带逻辑丢了**（`patch.favorited_at = isFavorited ? now : null`，契约 §4.2） |
| 3 | 只传 `originalText` 却成功了 | 看返回的 `changed` 是不是空/有值 | 白名单失效（应回 `INVALID_PARAMS`「没有要改的内容」） |
| 4 | `changed` 与 `before` 对不上 | 对比返回 JSON 与 SQL 三列 | 回读的不是库里的真值 |

**回归项**
- □ `before` / `changed` / `item` 三者自洽
- □ SQL 里 `is_favorited` 与 `favorited_at` **同进同退**
- □ 改一条已软删的 → `404 NOT_FOUND`

---

## 步 6 · 删除（`DELETE /api/sessions/write?itemId=…`，**软删**）

**怎么测**：打开**收藏页** `pages/records.html` → 某条卡片上点「删除」→ 弹 `window.confirm`（带**原句 + 轮次 + 类型**）→ 点「确定」。

**正常现象（判据）**
1. 提示「已删掉 1 条记录，它不会再出现在记录里。」（★ 是这句，**不是**「删了就找不回来了」）
2. 该条从列表消失
3. 库里**行还在**：`is_deleted=true`、`is_favorited=false`、`favorited_at=NULL`

**刁钻输入**
- 弹窗点**取消** → **一个请求都不该发**（F12 Network 里不该出现 DELETE）
- 点「确定」后**连点两次** → 第二次回 `404 NOT_FOUND`，且**卡片应被移除**，不是留着说「可以再试一次」
- 在另一个标签页先删掉同一条，再回来删 → 同样走 404 分支

**若失败：原因排序 → 验证方法 → 修复方向**

| 序 | 原因 | 验证方法 | 修复方向 |
|---|---|---|---|
| 1 | **连点两次后卡片还在 + 提示「可以再试一次」** | F12 Network 看第二次 DELETE 的响应码；看提示走的是哪条分支 | ①`api.js` 要把 `404` 映射成 `body.error.code`（不是 `HTTP_404`）；②`records.html:367` 的 `NOT_FOUND` 分支没生效 |
| 2 | confirm 文案写「删了就找不回来了」 | 看弹窗原文 | 软删后口径必须说「不会再出现在记录里」（`records.html:306`，**别改回去**） |
| 3 | 删除后**收藏区还挂着空卡片** | 看收藏区是否多出一张空卡 | 本地 storage 没跟着清（`records.html:339`） |
| 4 | 回 `DB_QUERY_FAILED` +「删除没有生效」 | 看错误码与文案 | 后端标记后复查发现行还在（契约 §4.2 第 ③ 道确认） |

**回归项**
- □ 删前 GET 收藏 N 条 → 删后 N-1
- □ SQL 里该行仍在，且三个列正确
- □ 再删一次 → `404 NOT_FOUND`（不是「成功」）
- □ 取消弹窗 → 无请求、无变化

---

## §2 出问题时按这个格式发我

```
现象：            （屏幕上看到什么，越具体越好）
复现步骤：        （从哪一页开始，点了什么，第几步出错）
报错原文：        （F12 Console / Network 里的原文，或页面提示的完整一句话）
已尝试动作：      （你已经试过什么，结果如何）
```

我按 **原因排序 → 每个原因的验证方法 → 修复方案 → 回归验证清单** 回复。

---

## §3 前后各留一份证据（今天要交的两张截图）

| 时点 | 截图内容 | 备注 |
|---|---|---|
| **复现时** | F12 控制台里的**报错原文** + 地址栏 | 图里要能看清**关键错误原文那几行**，以及**地址栏** |
| **修复后** | 同一位置**正常运行** | 图里要有**正常返回** |

★ 截图必须有 `localhost` 地址栏（或无头截不到的长条）→ **这两张你自己手截**，我截不到浏览器外壳。
★ 桌面截图用 **1080 宽**（`.wrap` 的 `max-width: 1080px`）。

---

## §4 顺带发现（**只记录，今天不修**）

| # | 发现 | 位置 | 性质 |
|---|---|---|---|
| 1 | `PATCH`（改备注/收藏）**无任何界面入口**，只能命令行验证 | `api.js:674` 有定义、无调用方 | 覆盖缺口 |
| 2 | 错误码清单计数漂移：`§1.4` 小标题写「通用（4 个）」但表里 5 行；`MEMORY.md` 记 21 个 / DB 6 个，文档写 20 个 / DB 4 个 | `docs/api-contract.md §1.4` | 文档口径不一致 |

> 今天只做清单里的事；上面两条先记着，要不要修由你定。
