# 口语对话实战器

一个制造真实压力的英语口语陪练网页：AI 扮演不迁就你的对话方，逼你把话说完整；练完告诉你哪一句跑题了、哪一句逻辑不成立并给出纠正，并记录你每次卡住的地方。

- 产品定义与验收标准见 `PRD.md`
- 技术选型与实现方案见 `TECH_DESIGN.md`
- 调研来源见 `research.md`
- 协作规则见 `AGENTS.md`

---

## 当前状态（Day 7 / 第 1 周）

**已完成：页面骨架（P1–P4 共 4 个页面，能本地启动、能互相跳通）。**

| 页面 | 文件 | 今天能做什么 | 还不能做什么 |
|---|---|---|---|
| P1 主题列表页（首页） | `frontend/pages/topics.html` | 看到 8 个主题分两组展示（数据从 `topics.json` 读取）、点卡片进对话页、进记录页 | 昵称填了不保存 |
| P2 对话页 | `frontend/pages/dialogue.html` | 顶部显示所选主题名、轮次与时长三块信息；点「结束对话」进结果页 | 按钮灰着，不能录音、没有 AI 回话 |
| P3 会话结果页 | `frontend/pages/result.html` | 看到四个字段的框架、问题清单与「这次说得好的」两个区块 | 数值固定为 0，没有收藏按钮 |
| P4 错误记录页 | `frontend/pages/records.html` | 看到收藏区、全部条目的空状态文案 | 本地存储未接入，必然是空的 |

**下一步要做的事**（按顺序）：
1. 接入录音与转写 → 对话页能说一句、屏幕上出文字
2. 接入后端与 AI → 能真的来回对话
3. 接入本地存储 → 昵称、会话记录、收藏与备注能留下来
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
python -m http.server 8000
```

执行后屏幕上会出现这样一行，**然后光标停住不动**：

```
Serving HTTP on :: port 8000 (http://[::]:8000/) ...
```

这是正常的——**这个黑窗口就是服务器本身，它开着网页才能访问；一关窗口网页就打不开了。**

### 第三步：在浏览器里打开

打开 Chrome 或 Edge，在**地址栏手动输入**：

```
http://localhost:8000/pages/topics.html
```

页面上应该看到：标题「口语对话实战器」、右上角「查看错误记录 →」、一个昵称输入框、两组主题卡片（组 A · 会议上 5 个 / 组 B · 同事间 3 个），底部一行「共 8 个主题…」。

### 怎么关掉

回到那个黑窗口，按 `Ctrl + C`，或直接关掉窗口。

### 换端口

8000 被占用时（提示 `Address already in use`），换成 8001：

```
python -m http.server 8001
```

对应地址改成 `http://localhost:8001/pages/topics.html`。

---

## 各页面的访问地址

| 页面 | 地址 |
|---|---|
| P1 主题列表页（首页） | `http://localhost:8000/pages/topics.html` |
| P2 对话页 | `http://localhost:8000/pages/dialogue.html?topic=T1` |
| P3 会话结果页 | `http://localhost:8000/pages/result.html?topic=T1` |
| P4 错误记录页 | `http://localhost:8000/pages/records.html` |

> `?topic=T1` 是主题编号，取值 `T1`–`T8`，对应 `frontend/data/topics.json` 里的 8 个主题。P2 和 P3 靠它知道"这次练的是哪个主题"。

---

## 改完代码看不到变化怎么办

按 `Ctrl + F5` 强制刷新。只按 F5 可能拿到浏览器缓存里的旧文件。

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
    ├── pages/
    │   ├── topics.html             ← P1 主题列表页（首页，入口）
    │   ├── dialogue.html           ← P2 对话页
    │   ├── result.html             ← P3 会话结果页
    │   └── records.html            ← P4 错误记录页
    ├── js/
    │   └── pages/
    │       └── topics.js           ← P1 的渲染逻辑
    ├── styles/
    │   └── main.css                ← 全站样式（4 个页面共用）
    └── data/
        └── topics.json             ← 8 个主题的配置数据
```

**还没创建**（见 `TECH_DESIGN.md` §4.1）：`frontend/js/speech.js`（录音与转写）、`api.js`（对后端的唯一出口）、`storage.js`（本地存储的唯一出口）、`frontend/js/pages/` 下另外三个页面的逻辑文件、整个 `backend/` 目录、`docs/` 目录。

---

## 一条安全约定

后端一旦开始写（`backend/`），**API 密钥只能放在 `backend/.env` 里**，且 `.env` 必须进 `.gitignore`、永远不提交。前端任何文件、聊天记录里都不能出现密钥。

---

## 已经可以再调的地方

今天只做了"能跑通"，样式是随时可改的：全站样式集中在 `frontend/styles/main.css` 一个文件里，改完刷新即可见，不影响任何功能。等 4 个页面都长出真实功能之后再看整体观感会更准。
