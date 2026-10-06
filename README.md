# 口语对话实战器

一个制造真实压力的英语口语陪练网页：AI 扮演不迁就你的对话方，逼你把话说完整；练完告诉你哪一句跑题了、哪一句逻辑不成立并给出纠正，并记录你每次卡住的地方。

- 产品定义与验收标准见 `PRD.md`
- 技术选型与实现方案见 `TECH_DESIGN.md`
- 调研来源见 `research.md`
- 协作规则见 `AGENTS.md`

---

## 当前状态（Day 16 / 第 3 周）

**已完成：4 个页面的骨架、全站视觉、「星标 / 收藏 / 自由对话」三条能在本地跑通的功能线，已上线到 CloudBase 云函数，以及三张表的建表与种子脚本（PostgreSQL 方言）。**

| 页面 | 文件 | 现在能做什么 | 还不能做什么 |
|---|---|---|---|
| P1 主题列表页（首页） | `frontend/pages/topics.html` | 8 个主题分两组展示（数据从 `topics.json` 读取）、可星标置顶且刷新后仍在；「自由对话」独立入口（第 02 区块，小标 `Free talk`）；点卡片进对话页、进记录页 | 昵称填了不保存 |
| P2 对话页 | `frontend/pages/dialogue.html` | 顶部显示所选主题名、职场角色、轮次与对话时长；录音区三态切换（未录音 / 正在录音 / 已暂停）；「这个主题练过几次」跨页面记忆；自由对话模式下可打字提交、AI 会给回应 | 没有真实录音与转写（只做界面态与计时，不采集音频）；AI 台词来自本地词池，未接大模型 |
| P3 会话结果页 | `frontend/pages/result.html` | 四个字段都有值（时长来自对话页，错误次数与精彩句子按本次条目真实计数）；问题清单（偏题只提醒 / 逻辑错误给纠正）+「这次说得好的」，每条可收藏；`?topic=FREE` 时不出现偏题只显示逻辑错误 | ✅ 条目由 `POST /api/analyze` 从你这一场的原话生成（Day 19 接通） |
| P4 错误记录页 | `frontend/pages/records.html` | 收藏区（按收藏时间倒序）+ 全部条目列表，条目同样可收藏 | 条目仍是本地假数据，不是真实会话记录 |

### 后端与数据（第 3 周）

| 项 | 状态 |
|---|---|
| 静态托管（4 个页面） | ✅ 已上线，`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/` |
| `GET /api/health` | ✅ 已上线，公网返回 `{"ok":true,"service":"TalkTrainer"}` |
| 数据表三张（`sessions` / `turns` / `items`） | 🟡 **脚本已写好，尚未在库里执行**，见下方「数据库怎么建起来的」 |
| `POST /api/chat`、`POST /api/analyze` | ❌ 尚未实现（Day 17 起） |
| 前端 `api.js` | ❌ 尚未创建 |

> **建表 ≠ 用户数据上云**：Day 16 只写出了表结构与种子脚本，**还没在数据库里执行**；
> 而且**接口一个都没写，前端仍读写 localStorage**。
> 用户数据仍然只在本机浏览器里，`TECH_DESIGN §3.3` 的路线乙没有被推翻。
> 边界声明见 `docs/api-contract.md` §9.1。

**下一步要做的事**（按顺序）：
1. 写读接口`GET /api/sessions` / `GET /api/items` —— 现在有库可查了（Day 17）
2. 接入真实录音与转写 → 对话页能说一句、屏幕上出文字（新建 `frontend/js/speech.js`）
3. 接入大模型 → 能真的来回对话（8 个主题的英语追问句已备好）
4. 写 `POST /api/chat` 与 `POST /api/analyze`，把 AI 判断接上

---

## 怎么把页面跑起来

前端是纯静态文件，**必须用本地服务打开，不能双击 HTML 文件**。

原因：页面要读 `topics.json`。双击打开时浏览器地址是 `file://`，会以安全理由拦掉这个读取请求，页面上会显示"主题数据没能加载"。走 `http://localhost` 就没这个问题。

### 第一步：进入前端目录

在 **cmd**（命令提示符）里执行：

```
cd /d C:\Users\26629\WorkBuddy\VibeCoding\frontend
```

### 第二步：启动本地服务

```
python serve.py
```

执行后屏幕上会出现这样几行，**然后光标停住不动**：

```
服务目录：C:\Users\26629\WorkBuddy\VibeCoding\frontend
入口地址：http://localhost:8010/pages/topics.html
缓存头已设为 no-store —— 改完文件直接刷新即可，不用强刷。
按 Ctrl+C 停止。
```

这是正常的——**这个黑窗口就是服务器本身，它开着网页才能访问；一关窗口网页就打不开了。**

> **为什么用 `serve.py` 而不是 `python -m http.server`**：后者只发 `Last-Modified`、不发 `Cache-Control`，浏览器会对它启用「启发式缓存」——几天没动过的 HTML 被判定「还新鲜」就用本地副本，刚改过的 CSS 却去拿新的，于是页面变成「新样式 + 旧结构」的混搭。Day 13「光球不见了」、Day 14「自由对话显示成绿色卡片」两次都是它。`serve.py` 给每个响应加 `Cache-Control: no-store`，改完刷新就能看到。脚本里的完整理由见 `frontend/serve.py` 文件头。

### 第三步：在浏览器里打开

打开 Chrome 或 Edge，在**地址栏手动输入**：

```
http://localhost:8010/pages/topics.html
```

页面上应该看到：标题「口语对话实战器」、右上角「查看错误记录 →」、一个昵称输入框、两组主题卡片（组 A · 会议上 5 个 / 组 B · 同事间 3 个），底部一行「共 8 个主题…」。

### 怎么关掉

回到那个黑窗口，按 `Ctrl + C`，或直接关掉窗口。

### 换端口

8010 被占用时，在命令后面加一个端口号换一个：

```
python serve.py 8011
```

对应地址改成 `http://localhost:8011/pages/topics.html`。

### 让别人用自己的设备打开（局域网）

默认只绑 `127.0.0.1`，也就是**只有你这台电脑打得开**。要拿给别人测，加 `--lan`：

```
python serve.py 8010 --lan
```

屏幕上会多打一行「给对方的地址」，形如 `http://192.168.224.68:8010/pages/topics.html`——
把那个地址发给对方，**对方也要连同一个 WiFi**。

三点注意：

- 不加 `--lan` 时端口只对本机开，**别把 localhost 地址发给别人**，他们打开的是自己的电脑，会看到一片空白
- 开着期间同网段任何设备都能读这个目录，**测完立刻 `Ctrl+C` 关掉**
- 别让对方双击 HTML 文件，必须走 `http://` 开头；`file://` 下浏览器会拦掉数据请求，主题列表出不来

---

## 各页面的访问地址

| 页面 | 地址 |
|---|---|
| P1 主题列表页（首页） | `http://localhost:8010/pages/topics.html` |
| P2 对话页 | `http://localhost:8010/pages/dialogue.html?topic=T1` |
| P3 会话结果页 | `http://localhost:8010/pages/result.html?topic=T1` |
| P4 错误记录页 | `http://localhost:8010/pages/records.html` |

> `?topic=T1` 是主题编号，取值 `T1`–`T8`，对应 `frontend/data/topics.json` 里的 8 个主题。P2 和 P3 靠它知道"这次练的是哪个主题"。
>
> 自由对话（F6）用的是同一个地址、把编号换成 `FREE`：`dialogue.html?topic=FREE`、`result.html?topic=FREE`。

---

## 数据库怎么建起来的（Day 16）

三张表建在 **CloudBase 的 PostgreSQL 数据库**里，建表脚本与种子数据都在 `db/` 目录：

| 文件 | 作用 | 可重复执行 |
|---|---|---|
| `db/schema.sql` | 建表（`sessions` / `turns` / `items`）+ 外键 + 5 条 CHECK 约束 + 31 条字段注释 | ✅ 开头 `DROP TABLE IF EXISTS` |
| `db/seed.sql` | 灌 5 场会话 / 17 轮 / 7 条条目 + 7 条验证 SELECT | ✅ 用 `TRUNCATE` 而非 `ON CONFLICT` |
| `db/steps/` | 上面两个文件**按语句边界切开的分批版**，共 11 个文件 | ✅ 内容与原文件逐条一致 |

表结构与字段口径见 `docs/api-contract.md` §9。

> ### ⚠️ 本项目的环境是 PostgreSQL，不是 MySQL
>
> CloudBase 从 2026 年 8 月起正式支持 PostgreSQL，它是**独立的环境类型**——
> 本项目环境（`cxj1528-d4g55ng0o54cbe296`）的「SQL 数据库」入口进去就是
> **PostgreSQL 管理**，控制台里没有独立的 MySQL 入口。
>
> Day 16 上午先按 MySQL 写了一版脚本，跑不进这个引擎，已整体翻译成 PG 方言。
> 翻译对照表写在 `db/schema.sql` 文末附录，一共改了 11 类语法。
> **如果以后看到 `db/` 里的脚本，别拿 MySQL 的经验去判断对错。**

### 第一步：进SQL 编辑器

数据库已经开通好了（Day 16 之前就已存在），直接进：

```
https://tcb.cloud.tencent.com/dev?envId=cxj1528-d4g55ng0o54cbe296#/db/postgres/data-editor
```

或者从控制台左侧点「**SQL 数据库**」进去 —— 进去后确认页面上写的是
「**PostgreSQL** 管理」、左上角schema 选的是 `public`，这两个都对再往下走。

### 第二步：执行建表脚本（6 批，按顺序）

`db/steps/` 下这 6 个文件，**按 1→6 顺序**逐个打开、全选（Ctrl+A）、复制、粘进 SQL 编辑器、执行：

| 顺序 | 文件 | 做什么 | 执行完应该看到 |
|---|---|---|---|
| 1 | `schema-1-清理旧表.sql` | 删掉旧的三张表 | 不报错即可 |
| 2 | `schema-2-建sessions.sql` | 建 `sessions` + 它的索引 | Query OK |
| 3 | `schema-3-建turns.sql` | 建 `turns`（外键 → `sessions`） | Query OK |
| 4 | `schema-4-建items.sql` | 建 `items`（外键 + 4 条 CHECK）+ 4 个索引 | Query OK |
| 5 | `schema-5-字段注释.sql` | 31 条 `COMMENT ON`（3 张表 + 28 列） | Query OK |
| 6 | `schema-6-建表自检.sql` | 两条查询：查表清单、查外键 | **3 行** / **2 行** |

第 6 批的期望值：

| 查询 | 期望 | 应看到的内容 |
|---|---|---|
| 查表清单 | **3 行** | `items` / `sessions` / `turns` |
| 查外键 | **2 行** | `fk_items_session` / `fk_turns_session` |

> **第 5 批失败不阻断**：字段注释只是给人看的说明文字，插不进去也不影响表能不能用。
> 真报错了可以跳过这批，继续跑第 6 批验证表结构。
>
> **如果报语法错**，99% 是复制时漏了东西——中文注释较多，整块复制比手动敲稳得多。
> 若报「表已存在」，说明第 1 批没执行成功，回到第 1 批重跑。

### 第三步：执行种子脚本（5 批，按顺序）

同样打开 `db/steps/` 下这 5 个文件，按 1→5 顺序执行：

| 顺序 | 文件 | 做什么 | 执行完应该看到 |
|---|---|---|---|
| 1 | `seed-1-清空旧数据.sql` | `TRUNCATE sessions CASCADE`（连带清空子表） | 不报错即可 |
| 2 | `seed-2-灌sessions.sql` | 插入 5 场会话 | Query OK |
| 3 | `seed-3-灌turns.sql` | 插入 17 轮对话 | Query OK |
| 4 | `seed-4-灌items.sql` | 插入 7 条条目，**末尾带 4.1 行数核对** | Query OK + 行数 **5 / 17 / 7** |
| 5 | `seed-5-验证.sql` | 6 条验证 SELECT（4.2 – 4.7） | 见下表 |

> **4.1 为什么不在第 5 批**：切分是按语句边界切的，`4.1` 紧跟在 `INSERT items` 后面，
> 所以被分到了第 4 批。**灌完条目当场就能看行数**，这反而更顺手。

第 5 批的验证 SELECT，逐条对照：

| 验证 | 期望 | 验的是哪条 PRD 口径 |
|---|---|---|
| 4.2 关联 | 5 行，每行的轮数/条目数对得上 | 两张表靠 `session_id` 关联 |
| 4.3 B22 | 每行都 `OK` | 错误次数 = 偏题 + 逻辑错误 |
| 4.4 B7 | 每条都 `OK` | 偏题无改法、逻辑错误有改法 |
| 4.5 F6 | **0 行** ← 空结果是对的 | 自由对话不判偏题 |
| 4.6 B6 | **1 行**，`ended_at` 为空 | 中途退出也存数据 |
| 4.7 收藏 | **3 行** | 收藏区排序 |

**验证 4.5 返回 0 行是对的**（不是漏了数据）。想看 FREE 那场的条目，单独查：

```sql
SELECT item_id, type, turn, original_text FROM items WHERE topic_id = 'FREE';
```

### 第三步之二：确认脚本真的可重复执行

**把 `seed-1` → `seed-4` 再执行一遍**（第 5 批验证不用重跑），应该不报错、行数还是 5 / 17 / 7。

这一条是清单的完成标准，值得当场验。如果第二遍报 `Duplicate entry`，说明 TRUNCATE 没生效——检查是不是只复制了 INSERT 段、没复制第 1 批的 TRUNCATE。

### 第四步：截图

清单要交的是**数据库表数据页**，图里要有表名、每张核心表至少 5 行数据。

进「SQL 数据库」→左侧「表」→ 点 `sessions` → 数据页，把表名和行数截进图里。

> **截图是手动做的**：无头浏览器截不到控制台内部页面（DMC 是带侧栏的应用界面），
> 这几张图必须你自己截。我这边给不了。

### 数据库的几个已知特点

| 特点 | 影响 |
|---|---|
| **PostgreSQL，不是 MySQL** | 语法完全不同；本节所有脚本都是 PG 方言 |
| **列名一律snake_case** | PG 会把不带引号的标识符转小写，`sessionId` 会被存成 `sessionid`。所以库里用 `session_id`，接口层仍用 `sessionId`，Day 17 在云函数里用 `AS` 映射 |
| **`INT UNSIGNED` 不存在** | 改用 `INTEGER` + `CHECK >= 0`，负数防护由约束接手 |
| **`TINYINT(1)` 不存在** | 三个布尔字段（`is_complete` / `asked_follow_up` / `is_favorited`）用 `BOOLEAN`，值是 `TRUE` / `FALSE` |
| **`DATETIME` 不存在** | 用 `TIMESTAMP`（不带时区），因为本项目单时区、`started_at` 一律按 UTC+8 存 |
| **列内不能写 `COMMENT`** | 31 条字段注释用 `COMMENT ON COLUMN` 单独补，写在 `schema.sql` 末尾 |
| **索引不能内联** | MySQL 的 `KEY idx (…)` 要拆成独立的 `CREATE INDEX` |
| **没有 `FOREIGN_KEY_CHECKS` 变量** | 清表用 `TRUNCATE … CASCADE` 连带清掉子表，不用手动开关 |
| **按需启停，空闲会挂起** | 第一次访问会有冷启动延迟；将来 Day 17 的读接口第一次响应会慢一点 |
| **默认时区不是 UTC+8** | `sessions.started_at` 一律按 UTC+8 存，**本项目单时区不做换算** |

---


## 目录结构

```
VibeCoding/
├── PRD.md
├── research.md
├── TECH_DESIGN.md
├── AGENTS.md
├── README.md                       ← 本文件
│
├── db/                            ← Day 16 新建：数据库脚本（PostgreSQL 方言）
│   ├── schema.sql                 ← 建表（3 张表 + 外键 + 5 条 CHECK + 31 条字段注释）
│   ├── seed.sql                   ← 种子数据（5/17/7）+ 7 条验证 SELECT
│   └── steps/                     ← 按语句边界切的 11 个分批版（编辑器单次限 10000 字符）
│       ├── schema-1-清理旧表.sql   ┐
│       ├── schema-2-建sessions.sql  │
│       ├── schema-3-建turns.sql     │ 建表 6 批
│       ├── schema-4-建items.sql     │ 按 1→6 顺序执行
│       ├── schema-5-字段注释.sql    │
│       ├── schema-6-建表自检.sql   ┘
│       ├── seed-1-清空旧数据.sql    ┐
│       ├── seed-2-灌sessions.sql   │ 种子 5 批
│       ├── seed-3-灌turns.sql      │ 按 1→5 顺序执行
│       ├── seed-4-灌items.sql      │
│       └── seed-5-验证.sql        ┘
│
├── docs/                          ← Day 15 新建：接口契约
│   └── api-contract.md            ← 第 3 周写接口的唯一依据（§9 是数据模型）
│
├── cloudfunctions/                 ← Day 15 新建：CloudBase 云函数
│   └── health/                    ← GET /api/health（唯一已实现的接口）
├── cloudbaserc.json               ← Day 15 新建：部署声明（函数 / 静态托管 / 网关路由）
│
└── frontend/                       ← 前端（纯静态，可单独部署）
    ├── serve.py                    ← 开发用本地服务（发 no-store，见上文）
    ├── pages/
    │   ├── topics.html             ← P1 主题列表页（首页，入口）
    │   ├── dialogue.html           ← P2 对话页
    │   ├── result.html             ← P3 会话结果页
    │   └── records.html            ← P4 错误记录页
    ├── js/
    │   ├── storage.js              ← localStorage 的唯一出口（练习次数 / 星标 / 收藏）
    │   ├── components/             ← 跨页面复用的组件（经典 script，挂 window.Components）
    │   │   ├── topic-card.js       ← 主题卡片（P1 用）
    │   │   ├── item-card.js        ← 条目 + 收藏按钮（P3、P4 用）
    │   │   └── interact.js         ← 「点了要有反馈」的按钮状态机（星标 / 收藏共用）
    │   └── pages/
    │       └── topics.js           ← P1 的渲染逻辑
    ├── styles/
    │   └── main.css                ← 全站样式（4 个页面共用）
    └── data/
        ├── topics.json             ← 8 个职场主题 + 一条 FREE（自由对话）
        └── mock-sessions.json      ← P1「你的卡点」的历次练习概览（本地假数据）
```

> **Day 19**：`mock-items.json` 已删除 —— P3 / P4 的条目改由 `POST /api/analyze`
> 从用户真练出来的原话生成。理由：假条目会让用户把「我没说过的话」当成自己的记录，
> 与契约 §4 硬约束 1 是同一条底线。P4 读不到后端时显示错态并说清原因，不填假数据。

> P2 / P3 / P4 的渲染逻辑目前**内联在各自的 HTML 里**，还没拆成 `js/pages/` 下的独立文件——拆不拆以 `TECH_DESIGN.md` §4.1 为准。
>
> `frontend/` 下另有四个开发自查工具（`regress.js` / `a11y-check.js` / `flt-verify.js` / `serve.py`），**不部署到公网**，详见 `TECH_DESIGN.md` §4.1。

**还没创建**（见 `TECH_DESIGN.md` §4.1）：`frontend/js/speech.js`（真实录音与转写）、`frontend/js/api.js`（对后端的唯一出口）、`frontend/js/pages/` 下 P2–P4 的逻辑文件、`backend/` 目录（已被 `cloudfunctions/` 取代，见 `TECH_DESIGN.md` §4.1 Day 15 修订④）。

---

## 一条安全约定

后端一旦开始写，**API 密钥只能放在密钥管理或环境变量里**，且绝不能进Git 仓库。
前端任何文件、聊天记录里都不能出现密钥。

> **Day 15 实际情况**：密钥已配在 CloudBase 的**云函数环境变量**里，
> 不落地成文件，所以 `.gitignore` 里目前没有 `.env` 也不影响安全。
> `TECH_DESIGN.md` §4.2 规矩 3 原写「密钥只在 `backend/.env` 出现」——
> 后端形态改成云函数后这条要跟着改，Day 17 写第一个真接口时一并处理。
>
> **数据库账号密码是另一回事**：它存在 CloudBase 控制台的「账号管理」里，
> **不要写进代码、不要贴进聊天**。本README 只告诉你去哪个页面创建，不记录任何具体密码。

---

## 已经可以再调的地方

全站样式集中在 `frontend/styles/main.css` 一个文件里，改完刷新即可见，不影响任何功能。注意**它是 4 个页面共用的**——改一处要四页一起看。
