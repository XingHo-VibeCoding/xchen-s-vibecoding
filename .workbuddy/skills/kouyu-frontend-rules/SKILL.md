---
name: kouyu-frontend-rules
version: 1.0.0
display_name: 口语对话实战器前端规则
display_name_en: Spoken Practice Frontend Rules
description: |
  「口语对话实战器」项目的已确认前端规则与改动流程。适用于本项目内任何前端改动：
  调颜色或字体、改卡片与按钮、加或改区块、动移动端与响应式、审查已有页面。
  内含改前检查清单与改后验证清单，改完能拿到可复现的证据（命令 + 文件行号）。
  规则全部来自项目已确认的笔记，笔记未定的标注为「未定」，不在这里替用户决策。
  This skill should be used when modifying any frontend file of the 口语对话实战器
  project — colors, fonts, cards, buttons, layout, responsive behavior —
  or when reviewing an existing page before delivery.
description_zh: 口语对话实战器项目已确认的前端规则与改动流程：页面层级、颜色字体、卡片按钮、移动端适配，附改前检查与改后验证清单，规则全部来自项目已确认笔记。
agent_created: true
---

# 口语对话实战器 · 前端规则

本项目是**原生 HTML / CSS / JS + Node 轻后端 + localStorage**（技术路线「乙」，`TECH_DESIGN.md §3.3`）。
**不引入任何构建工具或第三方依赖**（无 React / Tailwind / Framer Motion / npm 包）。所有动效用纯 CSS 实现。

## 什么时候用

在本项目里动以下任一文件时读本Skill：
`frontend/styles/main.css`、任何 `frontend/pages/*.html`、任何 `frontend/js/**/*.js`。

## 三条最容易踩的（先看这三条）

1. **`main.css` 是全站唯一样式表**，4 个页面共用（`TECH_DESIGN.md §4.1`）。
   改它 = 改四个页面，**改完必须四页回归**，不能只看改的那一页。
2. **页面视觉顺序 ≠ DOM 顺序**。主题页 `.blk-*{order}` 决定顺序，`.col-side` 是
   `display:contents`。用脚本查页面顺序**必须按屏幕坐标（`getBoundingClientRect().top`）排**，
   按 DOM 序会得到 `01/04/02/03` 并误判（Day 14 已踩）。
3. **数值合法 ≠ 视觉成立**。光球 149px 各项数值都「合法」但四边空，176px 才成立。
   构图问题量不出来，必须看渲染结果 —— 见下面「改后验证」。

## 步骤：改之前

按顺序做完，不要跳。

1. **读对应细则**（只读这次用得上的那份）：
   - 动颜色 / 字体 / 卡片 / 装饰 → 读 `references/ui-visual.md`
   - 动层级 / 栅格 / 断点 / 移动端 → 读 `references/layout.md`
   - 要动手改、要验证、要避坑 → 读 `references/checks.md`
2. **确认口径来源**。涉及产品定义的词（错误次数、偏题、逻辑错误、精彩句子、主题、时长），
   一律以 `PRD.md` 为准。口语说法与 PRD 定义对不上时，**先问用户以哪个为准**，不要自己挑一个写进代码。
3. **确认改动落在哪一层**。`research.md` 只放调研、`PRD.md` 只放产品决策与验收、
   `TECH_DESIGN.md` 只放技术选型。跨文档引用写「见 XX.md §N」，不复制粘贴。
4. **确认是否要改 PRD**。要加 PRD 尚未定义的功能区块，**先改 PRD，不能只改代码**
   （Day 8 拍板：只留接缝注释，不擅自渲染）。
5. **新交互先想清楚状态存哪**。状态只有一份时，从那一份现场算出各个视图，
   不要各存一份再「同步」（`records.html` 两个列表就是这么做的，见 `references/checks.md §收藏同步`）。

## 步骤：改什么（速查）

细则在三个 `references/` 里，这里只放最常查的硬约束。
**六块规则的落点**：页面层级见下 · 颜色与字体 / 卡片与按钮 / 移动端与响应式见下三节 ·
修改前检查见上面「步骤：改之前」· 修改后验证见下面「步骤：改之后」。

### 页面层级（详见 `references/layout.md`）

- **四个页面**：P1 `topics.html` 主题列表（应用入口）· P2 `dialogue.html` 对话（暗场舞台）·
  P3 `result.html` 本次结果 · P4 `records.html` 错误记录（收藏区 + 全部条目）
- **脚本加载顺序**（无打包工具）：`storage.js → interact.js → item-card.js → 页面逻辑`。
  **组件脚本必须先于页面逻辑** —— 顺序反了页面直接报错。
- **主题页区块顺序**：`01 称呼 → 02 自由对话 → 03 选主题 → 04 卡点`，
  由 `main.css` 的 `.blk-*{order}` 决定。**改顺序必须同步改小标编号**。
- **⚠️ 视觉顺序 ≠ DOM 顺序**：`.col-side` 是 `display:contents`（装的是 01 与 04），
  用脚本查页面顺序**必须按 `getBoundingClientRect().top` 排**。
- **表单标签必须在输入框上方**（`.field` 是纵向两行 flex），任何宽度下关系都不歧义。
- **空状态语义别搞反**：`.empty` 虚线 = 「这条还没接上」；
  `.empty-solid` 实线 = 「跑完了、结果确实为空」。**确定的结果为空用实线。**
- 主题页两块高度是**量着定的**（1440px：自由对话 178 / 称呼 153），**别再顺手动**。

### 颜色与字体（硬规矩，详见 `references/ui-visual.md`）

- 鲜色**只做装饰**，小字文字**一律用 `-deep` 档**：
  `--primary-deep #9A4708` / `--accent-deep #A83A23`。
  鲜色 `--primary #D97706`（白底 3.19）与 `--accent #E8624A`（白底 3.35）都**不达 4.5:1**。
- 三色各有分工，不串用：**组 A（会议上）= 蜜橘族/ 组 B（同事间）= 深青族 / 珊瑚 = 只管警示**
  （偏题、卡点、失败、品牌点）。
- 阴影一律带**暖色底** `rgba(107,84,56,…)`，不用中性灰 —— 中性灰压在奶油底上显脏。
- 字体三栈：`--font-sans` 中文 / `--font-en` Georgia 斜体**只用在英文内容本身**
  （不用在标题、标签、数字上）/ `--font-mono` 只用在技术小标。
- 间距用 `--space-*`（4px 网格），圆角用 `--radius-*`，**不写裸值**。

### 卡片与按钮

- 主按钮暖橘渐变 `--grad-from → --grad-to`，**不用鲜色**（白字压在鲜色上只有 3.19~3.35）。
- 卡片右上角暖色大圆斑**必须 `right:-46px` 停在框外**（`.topic::before` 是 `top/right:-66px`）。
- 卡片悬停：上浮 4px + 左边缘 3px 组色指示条。
- 可点元素 **≥44×44px**。给按钮加高度用 `display:inline-flex; align-items:center; justify-content:center;
  min-height:44px`，**不要只加 `padding-block`** —— 那样文字会视觉偏上。
- 已收藏条目整块变暖：`.item:has(.ic-btn.is-fav)`，不只按钮变。

### 移动端与响应式

- `max-width:640px` 手机单列；`min-width:740px` 区块拆列 / 统计横排 / 主题卡三列。
- 装饰元素（`.orb`、角斑）刻意停在框外，**出界判据要豁免它们**，否则全是误报。
- `prefers-reduced-motion` 下动效全站归零，且**状态不许只靠动画表达**
  —— 静态下三态仍要两两可辨。

## 步骤：改之后（必须给可复现证据）

**禁止只写「已确认」「检查无误」。** 每条结论都要有能复制的命令或文件行号。详见 `references/checks.md`。

最少交付这三样：
1. **渲染截图**（无头 Chrome，见 `references/checks.md §截图`）—— 有地址栏的版本用于打卡
2. **断言输出**：横向溢出 / 触控尺寸 / 控制台报错，每项给数字
3. **改动文件清单 + 每个文件属于哪天的任务**

## 改不动的时候

- 同一个操作反复失败 → **停下来报告**，说清试了什么、报什么错、判断的原因，不循环重试
- 需要用户拍板的地方 → 列选项与各自代价，让用户选，**不自己决定**
- 要回退 → 用 `git revert` 保留历史，**禁止 `git reset --hard` 与强制推送**；回退前先确认恢复到哪个提交

## 本地跑法

```bash
cd frontend && python serve.py     # → http://localhost:8010/pages/topics.html
```

**不能双击 HTML**（`file://` 协议会拦 `fetch`，页面数据加载不出来）。
开发服务器发 `no-store`，改完刷新即可见。

## 未定事项（不要自行决定）

以下三项在项目笔记里标为「待定」，**碰到时问用户，不要替其决定**：

1. 字体未自托管 —— 换机器若没装`Noto Sans SC` / `MiSans` / `HarmonyOS Sans SC` 会退到
   PingFang / 雅黑。要彻底锁定需自托管字体文件，**那件事没做**。
2. AI「正在说」要不要加第四个光球态（现沿用 listen 态）。
3. `topics.html` 第 18-19 行中文破折号后多一个空格（纯 HTML 空白字符问题）。
