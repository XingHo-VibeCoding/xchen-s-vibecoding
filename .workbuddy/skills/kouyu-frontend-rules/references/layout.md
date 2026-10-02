# 布局细则：页面层级、栅格、断点、移动端

> 主文件 `SKILL.md` 只留速查，这里放结构与响应式的具体约定。

## 1. 四个页面

| 页面 | 文件 | 定位 |
|---|---|---|
| P1 | `pages/topics.html` | 主题列表（**应用入口**，不是作品集） |
| P2 | `pages/dialogue.html` | 对话（暗场舞台 + AI 光球） |
| P3 | `pages/result.html` | 本次会话结果 + 收藏 |
| P4 | `pages/records.html` | 错误记录（收藏区 + 全部条目） |

**脚本加载顺序**（无打包工具，经典 `<script>` 挂 `window.Components`）：
```
storage.js → components/interact.js → components/item-card.js → 页面逻辑
```
**组件脚本必须先于页面逻辑加载** —— 顺序反了页面直接报错。

## 2. 主题页区块顺序

```
01 称呼 → 02 自由对话 → 03 选主题 → 04 卡点
```

顺序由 `main.css` 的 `.blk-*{order}` 决定。

**⚠️ 视觉顺序 ≠ DOM 顺序**：`.col-side` 是 `display:contents`，装的是 01 与 04。
用脚本查页面顺序**必须按屏幕坐标（`getBoundingClientRect().top`）排序**，
按 DOM 序会得到 `01/04/02/03` 并误判（Day 14已踩）。

**改区块顺序必须同步改小标编号**（编号是区块内容的一部分，不是纯装饰）。

## 3. 主题页两块高度（**量着定的，别再顺手动**）

1440px 实测：自由对话节**178**、称呼区**153**。

- 自由对话节 129 → 178：加一个等宽小标 + `.free-link` 上下内边距 20→28px
- 称呼区 176 → 153：**只收起 `.blk-identity > .hint` 说明行**，
  输入框与内边距一个字没动 —— 撑高它的是输入框那列 103px，只有说明行可省
- 390px 实测：**212 / 260**

**这两处高度一动对调感就没了。**

## 4. 断点

```css
max-width: 640px   /* 手机单列 */
min-width: 740px   /* 区块拆两列 · 统计横排 · 主题卡自动 3 列 */
```

**900 → 740 的缘由**（别改回去）：`main.css` 里 900 那条其实只改了 gap，
真正 900 以上才生效的只有「区块 1 内部拆两列」，导致 640~900 通栏宽卡右半边一大片空白。

`min-width:740px` 里的拆分细则：
- 区块 1 拆两列
- 区块 4 统计横排
- 主题卡自动 3 列

## 5. 表单：标签必须在输入框上方

`.field` 是**纵向两行**（`flex-direction: column`），标签在上、输入框在下。
桌面端靠栅格放到右列，与左列标题齐平。

**为什么**：原先标签与输入框同排（`.field` 是横向 flex），宽屏没问题，
但窄到 400px 时「昵称」会被挤到输入框左侧贴边，标签与控件的关系变模糊。

`.field-grid` / `.cell` / `.label` / `.value` 是一套可复用的栅格表单块。

## 6. 移动端自查

- **横向溢出**：`scrollWidth > clientWidth` 即出界
- **触控目标 ≥44×44px**：判据 `(A | BUTTON) && offsetParent !== null`，宽高**任一** < 44 就记
- **装饰元素要豁免**：`.orb`、角斑刻意停在框外，出界判据不能把它们算进去
- **文字裁切**：出界与裁切要分开报

现成脚本（Day 11 建的，在 `%TEMP%\wb-taste-check\`）：
- `mobile-check.js` —— 四页六 URL × 390/360，含出界 / 文字裁切 / 触控尺寸 / 控制台报错四类断言
- `btn-probe.js` —— 只量按钮尺寸 + 卡片高 + 页高，用于「加高度前后」这类改动
  （`node btn-probe.js <base> <标签>`）

**全站可点元素曾普遍不达 44px**（`.ic-btn` 短边 30~32px），加练轮已修：
`display:inline-flex; align-items:center; justify-content:center; min-height:44px`。
**为什么是 flex 而不是加大 `padding-block`**：光加内边距文字会视觉偏上，得靠 flex 居中。

## 7. 对话记录区 `.transcript`（P2）

白卡 › `.tr-head` › `.tr-list`（上限 340px、自身滚动）› `.tr-note`（本地文案池说明，**刻意不做成气泡**）

- `.tr-row`：用户靠右 / `.is-ai` 靠左
- `.tr-bubble`：**AI 暗色 `--night-raised`、用户暖色 `--primary-soft`**
- `.tr-text` 加 `.en` 才套 Georgia 斜体 —— **整行 ASCII 才加**（两条线台词现在都是英语、
  正常每条都命中，判断留着当防线）
- `.composer` = textarea + 「我说完了」，仅录音态出现；≤640px 竖排
- `.tr-empty` 空态

## 8. 空状态

```css
.empty        /* 虚线框 —— 表示「这条还没接上」 */
.empty-solid  /* 实线框 —— 表示「判断跑完了、结果就是空」 */
```

`.empty .big` 是大字结论，`.empty .small` 是说明（`max-width:52ch` 居中，行宽必须收窄）。

`.empty.state-error` 是错误态：复用 `.empty` 的框，只换强调色，不给报错堆栈（`TECH_DESIGN.md §8.2 E9`）。

**语义别搞反**：确定的结果为空用实线，还没接上的功能用虚线。

## 9. 可复用类

| 类 | 用途 |
|---|---|
| `.spec-list` | 规格清单（`records.html` 结构说明卡在用） |
| `.card-spaced` | 卡片纵向间距 |
| `.card .hint + *` | 标题区到内容自动16px 间距 |
| `.field-grid` / `.cell` | 栅格表单 |
| `.tag` / `.item-tag-*` | 胶囊标签 |
| `.counter-inline` | 把该成行的数字压回行内（见 `checks.md`） |
