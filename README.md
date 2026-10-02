# 口语对话实战器

一个制造真实压力的英语口语陪练网页：AI 扮演不迁就你的对话方，逼你把话说完整；练完告诉你哪一句跑题了、哪一句逻辑不成立并给出纠正，并记录你每次卡住的地方。

- 产品定义与验收标准见 `PRD.md`
- 技术选型与实现方案见 `TECH_DESIGN.md`
- 调研来源见 `research.md`
- 协作规则见 `AGENTS.md`

---

## 当前状态（Day 14 / 第 2 周）

**已完成：4 个页面的骨架、全站视觉，以及「星标 / 收藏 / 自由对话」三条能在本地跑通的功能线。**

| 页面 | 文件 | 现在能做什么 | 还不能做什么 |
|---|---|---|---|
| P1 主题列表页（首页） | `frontend/pages/topics.html` | 8 个主题分两组展示（数据从 `topics.json` 读取）、可星标置顶且刷新后仍在；「自由对话」独立入口（第 02 区块，小标 `Free talk`）；点卡片进对话页、进记录页 | 昵称填了不保存 |
| P2 对话页 | `frontend/pages/dialogue.html` | 顶部显示所选主题名、职场角色、轮次与对话时长；录音区三态切换（未录音 / 正在录音 / 已暂停）；「这个主题练过几次」跨页面记忆；自由对话模式下可打字提交、AI 会给回应 | 没有真实录音与转写（只做界面态与计时，不采集音频）；AI 台词来自本地词池，未接大模型 |
| P3 会话结果页 | `frontend/pages/result.html` | 四个字段都有值（时长来自对话页，错误次数与精彩句子按本次条目真实计数）；问题清单（偏题只提醒 / 逻辑错误给纠正）+「这次说得好的」，每条可收藏；`?topic=FREE` 时不出现偏题只显示逻辑错误 | 条目来自 `data/mock-items.json` 的本地假数据，判断功能未接入 |
| P4 错误记录页 | `frontend/pages/records.html` | 收藏区（按收藏时间倒序）+ 全部条目列表，条目同样可收藏 | 条目仍是本地假数据，不是真实会话记录 |

**下一步要做的事**（按顺序）：
1. 接入真实录音与转写 → 对话页能说一句、屏幕上出文字（新建 `frontend/js/speech.js`）
2. 接入后端与大模型 → 能真的来回对话（8 个主题的英语追问句已备好）
3. 接入真实会话存储 → 昵称、会话记录、问题条目能留下来（目前只有练习次数 / 星标 / 收藏三类落盘）
4. 接入 AI 判断 → 结束对话后真的给出偏题提醒与逻辑纠正

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

## 目录结构

```
VibeCoding/
├── PRD.md
├── research.md
├── TECH_DESIGN.md
├── AGENTS.md
├── README.md                       ← 本文件
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
        ├── mock-items.json         ← P3 的本次条目（本地假数据）
        └── mock-sessions.json      ← P4 的历次记录（本地假数据）
```

> P2 / P3 / P4 的渲染逻辑目前**内联在各自的 HTML 里**，还没拆成 `js/pages/` 下的独立文件——拆不拆以 `TECH_DESIGN.md` §4.1 为准。

**还没创建**（见 `TECH_DESIGN.md` §4.1）：`frontend/js/speech.js`（真实录音与转写）、`frontend/js/api.js`（对后端的唯一出口）、`frontend/js/pages/` 下 P2–P4 的逻辑文件、整个 `backend/` 目录、`docs/` 目录。

---

## 一条安全约定

后端一旦开始写（`backend/`），**API 密钥只能放在 `backend/.env` 里**，且 `.env` 必须进 `.gitignore`、永远不提交。前端任何文件、聊天记录里都不能出现密钥。

---

## 已经可以再调的地方

全站样式集中在 `frontend/styles/main.css` 一个文件里，改完刷新即可见，不影响任何功能。注意**它是 4 个页面共用的**——改一处要四页一起看。
