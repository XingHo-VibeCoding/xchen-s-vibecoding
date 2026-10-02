# 视觉细则：颜色、字体、卡片、装饰

> 主文件 `SKILL.md` 只留速查，这里放具体数值与缘由。
> 数值全部来自 `frontend/styles/main.css` 头部注释与项目笔记，**没有新增判断**。

## 1. 颜色令牌全表

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#FDFBF6` | 暖奶油底，避开纯白的冷硬 |
| `--bg-tint` | `#FBF5EA` | 浅奶油区块 |
| `--surface` | `#FFFFFF` | 白卡片 |
| `--surface-soft` | `#FFF8EE` | 浅奶油区块 / 条目卡 |
| `--primary` | `#D97706` | 蜜橘：**装饰**（圆斑、竖条、边框、大号数字） |
| `--primary-dark` | `#B45309` | 白底 5.02 / 奶油底 4.86，可做正文级文字 |
| `--primary-deep` | `#9A4708` | **小字专用**。白底 6.40 / 蜜橘浅底 5.70 |
| `--primary-soft` | `#FDF0DC` | 蜜橘浅底 |
| `--accent` | `#E8624A` | 珊瑚：**装饰 + 警示** |
| `--accent-deep` | `#A83A23` | **警示小字专用**。白底 6.37 / 珊瑚浅底 5.60 |
| `--accent-soft` | `#FDEDE8` | 珊瑚浅底 |
| `--teal` | `#0F7A6B` | 深青：组 B 组色。白底 5.23 / 深青浅底 4.61，达标不用改 |
| `--teal-soft` | `#E4F4F0` | 深青浅底 |
| `--grad-from` / `--grad-to` | `#B45309` / `#C24A2E` | 主按钮渐变端点 |
| `--grad-from-hover` / `--grad-to-hover` | `#9A4708` / `#A83A23` | 渐变悬停 |
| `--text` | `#2B2622` | 正文，**非纯黑** |
| `--text-secondary` | `#6B6259` | 次级文字 |
| `--text-muted` | `#736A5F` | 弱化文字。**Day 9 由 `#9C9288` 调深**（原值只有 2.68~3.05） |
| `--border` | `#EBE3D6` | 描边 |
| `--border-soft` | `#F2EADD` | 浅描边 |

### 暗场令牌（对话区 `.stage`）

`--night #241A13`（舞台底）/ `--night-raised #33251A`（抬升块）/ `--night-edge #3E2D20`（描边）
文字 `--night-text #F5EDE2`（14.68）/ `--night-2nd #CDBBA6`（9.13）/ `--night-muted #AB9985`（6.19）/ `--night-accent #E8A34E`（7.94）

**为什么是暖棕不是黑**：纯黑会把暖橘光压成冷调，像关机的手机。深暖棕是「关了灯的客厅」，木色还在。

## 2. 两条硬规矩

### 规矩一：鲜色只做装饰，小字一律用 `-deep` 档

依据是实测对比度（白底/ 奶油底，12px 文字要求 4.5）：

| 写法 | 实测 | 12px 要求 4.5 |
|---|---|---|
| `--accent #E8624A` 当文字 | 3.35 | 不达标 |
| `--primary #D97706` 当文字 | 3.19 | 不达标 |
| 白字压在蜜橘→珊瑚渐变按钮上 | 3.19~3.35 | 不达标 |

换 `--grad-from/to` 后两端 5.02 / 4.87，色相仍是蜜橘→红橘，「多巴胺」的暖色观感保住，只是深了一档。

**验收口径：所有「文字×底色」≥4.5（大字号 ≥3.0）**。

### 规矩二：三色分工，不串用

```
组 A（会议上 T1–T5）  → 蜜橘族
组 B（同事间 T6–T8）  → 深青族
珊瑚                  → 专管警示：偏题、卡点、失败、品牌点
```

**为什么珊瑚专管警示**：Day 12 之前三个色到处串（编号是珊瑚、区块小标是珊瑚、悬停边框是蜜橘、星标渐变是蜜橘→珊瑚、卡点数字是珊瑚），结果没有一个颜色在说话，页面看着吵。

**不能为了配色规则删掉三色** —— `PRD.md §6.2` 用颜色区分「偏题 / 逻辑错误 / 精彩句子」是**产品语义**。

### 类型胶囊三色（`.item-tag-*`）

- 偏题`offtopic` = 珊瑚浅底 + `--accent-deep`（5.60）
- 逻辑错误 `logic` = 蜜橘浅底 + `--primary-deep`（5.70）
- 精彩句子 `good` = **深青**（4.61）—— 它不是「问题」是「亮点」，用另一个色相一眼能分开

## 3. 字体栈（三栈，各有分工）

```
--font-sans  "Noto Sans SC" → MiSans → HarmonyOS Sans SC → PingFang SC → 微软雅黑
--font-en    Georgia → Sitka Text → Cambria → Times New Roman → 宋体
--font-mono  "Cascadia Mono" → Cascadia Code → Source Code Pro → SF Mono → Consolas
```

- **`--font-en` 只用在英文内容本身**（卡片英文说明、条目引文），**不用在标题/标签/数字上**。
  技能包禁的是「UI 外壳用衬线」，这里是「内容是英文句子，用衬线才读得对」—— 不冲突。
- **换字体栈不需要用户动手**：本机 `C:\Windows\Fonts` 已装齐`Noto Sans SC`（有真
  Regular/Medium/Bold）、`MiSans`、`HarmonyOS Sans SC`。零下载、零网络依赖、零授权风险。
- **`Noto Sans SC` 排第一的理由**：它是思源黑体的 Google 发行版，本机有三档真字重
  （`MiSans` 只有 Regular，标题会退化成合成粗体）。
- 换栈的**已知代价**：换机器若没装这几款会退到 PingFang / 雅黑 —— 中文仍正常，
  只是没了这一档质感。要彻底锁定得自托管字体文件，**那件事没做**（属未定事项）。

## 4. 间距、圆角、阴影、动效

```
--space-1..12  4px 网格（0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3rem）
--radius-sm/md/lg/xl/full  0.25 / 0.5 / 0.75 / 1rem / 9999px
--shadow-sm/md/lg  一律带暖色底 rgba(107,84,56,…)
--fast 150ms   --normal 300ms
--ease-out   cubic-bezier(0, 0, 0.2, 1)        交互
--ease-spring cubic-bezier(0.34, 1.56, 0.64, 1)  回弹，交互元素用这条，不要线性
--ease-soft  cubic-bezier(0.16, 1, 0.3, 1)      入场，长距离位移用它
--stagger 55ms卡片错峰入场的单档延迟
```

**阴影为什么必须染色**：中性灰阴影压在奶油底上会显脏。

## 5. 装饰与多巴胺

> 需求源（用户原话）：**突出英语特色 / 着色不要太艳丽也不能太简朴 / 有多巴胺效果**。
> 改动视觉时以此为准绳。

| 装饰 | 做法 |
|---|---|
| 卡片右上角大圆斑 | **必须 `right:-46px` 停在框外**，悬停放大 1.3 倍 |
| `.topic::before` 角斑 | **必须 `top/right:-66px` 停在框外** |
| 主按钮 |暖橘渐变 `--grad-from → --grad-to` |
| 卡片悬停 | 上浮 4px + 左边缘 3px 组色指示条 |
| 卡片错峰入场 | `animation-delay: calc(var(--i) * 55ms)`，`--i` 由 CSS `nth-child` 给 |
| 标题右侧珊瑚圆点 | 3.2s 呼吸；`:active` 压感 |
| `.topic` 卡片 | 5 行栅格，星标在**顶行右侧**（与左上 TOPIC N 对角），信息胶囊占底行 |
| `.topic .ic-hint` | **必须绝对定位浮起** |
| 已收藏条目 | 整块变暖 `.item:has(.ic-btn.is-fav)`，不只按钮 |

**错峰入场的关键**：`--i` 由 CSS `nth-child` 给，**`topic-card.js` 一个字不改**。

## 6. AI 光球（`.orb`）

四层：`.orb-halo` / `.orb-ripple` / `.orb-orbit` / `.orb-core`。三处出现：对话页舞台中央（正式）+
页头 `h1::after`（10px）+ 主题页自由入口（60px / 手机 48px）。

- **三态由 5 个变量驱动**：`--orb-scale / --orb-bright / --orb-sat / --orb-halo / --orb-speed`。
  `.stage[data-mood]` 只改这几个数，具体数值见 `main.css` 注释。
- 配色是**径向渐变**不是纯色（球体从左上高光到右下收暗）：`--orb-hi #FFE0AE` /
  `--orb-core #FFC46B` / `--orb-warm #F2A03C` / `--orb-lo #E8624A`。
- 定版数值：球径**176px**（149px 时四边空）、暂停态 `brightness 0.82 / saturate 0.95`。
- 光球 `aria-hidden`；引导语**只说陪伴鼓励，不承诺功能、不评价用户**。
- **状态不许只靠动画表达** —— `prefers-reduced-motion` 下三态静态仍须两两可辨（已断言）。
- 「调暗」用 `brightness`（**别低于约0.8**）；**别用 `saturate`**（会把浅色高光推向白）。
  `filter` 会连元素外圈的 `box-shadow` 发光一起作用。
