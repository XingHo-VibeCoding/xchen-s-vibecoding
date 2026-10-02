# frontend-guidelines.md · 前端规则与改动流程（手动版）

> **这是 `kouyu-frontend-rules` Skill 的手动降级入口。**
> 用途：当 Skill 工具加载不到项目级 Skill 时（新建的 Skill 要**重启会话**才会被发现），
> 读这份文件 + 同目录 `references/` 三份细则，按同样的流程手动执行。
> 规则内容与 Skill 完全一致，**不存在两套标准**。
>
> 手动调用方式：读这份 → 读本次用得上的 `references/*.md` → 按下面的流程做 → 交付时说明
> 「依据本文件第 X 节做了Y」。

---

## 技术前提

原生 HTML / CSS / JS+ Node 轻后端 + localStorage（技术路线「乙」，`TECH_DESIGN.md §3.3`）。
**不引入构建工具或第三方依赖**，动效一律纯 CSS。

## 三条最容易踩

1. **`main.css` 是全站唯一样式表**，4 页共用（`TECH_DESIGN.md §4.1`）→ 改它= 改四页，**必须四页回归**
2. **视觉顺序 ≠ DOM 顺序**（主题页 `.blk-*{order}` + `.col-side` 是 `display:contents`）
   → 脚本查顺序**必须按 `getBoundingClientRect().top`排**，按 DOM 序会误判
3. **数值合法 ≠ 视觉成立**（光球 149px 合法但四边空，176px 才成立）→ 构图问题必须看渲染结果

## 改前检查

- [ ] 读过下面三份 `references/` 里本次用得上的那份
- [ ] 产品词（偏题/逻辑错误/精彩句子/错误次数/时长）以 `PRD.md` 为准，对不上**先问用户**
- [ ] 要加的区块 PRD 定义了没有？**没定义先改 PRD，不能只改代码**
- [ ] 文档不混放：`research` 调研 / `PRD` 产品决策 / `TECH_DESIGN` 技术选型，跨文档写「见 XX.md §N」
- [ ] 要改 `main.css` 吗？→ 记住四页回归
- [ ] 页面顺序要查吗？→ 按屏幕坐标
- [ ] 新状态存哪？→ 只有一份就现场算，别存两份再「同步」

## 改后验证（禁止只写「已确认」）

- [ ] 渲染截图（无头 Chrome，命令见 `references/checks.md §截图`）；打卡截图**必须有地址栏**
- [ ] 横向溢出 / 触控 ≥44px / 文字裁切 / 控制台报错 —— **每项给数字**
- [ ] 动了 CSS 则加测：四页 × 五断点（390/360/640/740/1440）无横向溢出
- [ ] 改动文件清单 + 每个文件属于哪天的任务

## 细则在哪

| 文件 | 装什么 | 什么时候读 |
|---|---|---|
| `references/ui-visual.md` | 颜色令牌全表、两条硬规矩、字体三栈、装饰与多巴胺、光球 | 动颜色/字体/卡片/装饰 |
| `references/layout.md` | **页面层级**（四页定位、脚本加载顺序、区块顺序、定版高度）、栅格、断点、移动端自查、空状态 | 动层级/栅格/断点/移动端 |
| `references/checks.md` | **改前检查**、**改后验证**（含截图命令）、8类踩过的坑、字段契约 | 要动手改、要验证、要避坑 |

**六块规则的落点对照**（与 `SKILL.md` 一一对应）：

| 你要的六块 | 在哪 |
|---|---|
| ① 页面层级 | 下面「页面层级」速查 + `references/layout.md` |
| ② 颜色和字体 | 下面「颜色」+ `references/ui-visual.md` |
| ③ 卡片与按钮 | 下面「卡片按钮」+ `references/ui-visual.md` |
| ④ 移动端适配 | 下面「移动端」+ `references/layout.md` |
| ⑤ 修改前检查 | 上面「改前检查」+ `references/checks.md` |
| ⑥ 修改后验证 | 上面「改后验证」+ `references/checks.md` |

## 硬约束速查

**页面层级**
- 脚本顺序：`storage.js → interact.js → item-card.js → 页面逻辑`（组件必须先于页面逻辑）
- 主题页顺序由 `.blk-*{order}` 给，**视觉顺序 ≠ DOM 顺序** → 脚本查顺序按 `getBoundingClientRect().top`
- **空状态语义**：`.empty` 虚线 = 还没接上 / `.empty-solid` 实线 = 结果确实为空

**颜色**
- 鲜色**只做装饰**，小字**一律用 `-deep`**：`--primary-deep #9A4708` / `--accent-deep #A83A23`
  （鲜色当文字只有 3.19~3.35，不达4.5:1）
- 三色分工：A 组（会议上）= 蜜橘 / B 组（同事间）= 深青 / 珊瑚 = **只管警示**
- 所有「文字×底色」≥4.5（大字号 ≥3.0）
- 阴影一律暖色底 `rgba(107,84,56,…)`

**字体**
- `--font-sans` 中文 / `--font-en` Georgia 斜体**只用在英文内容本身** / `--font-mono` 只用在技术小标

**卡片按钮**
- 主按钮暖橘渐变`--grad-from → --grad-to`
- 圆斑**必须停在框外**（卡片 `right:-46px`，`.topic::before` `top/right:-66px`）
- 可点元素 **≥44×44px**；加高度用 `inline-flex + min-height:44px`，**不要只加 padding-block**

**移动端**
- `max-width:640px` 手机单列 / `min-width:740px` 拆列
- 装饰（`.orb`、角斑）刻意出界，**出界判据要豁免**
- `prefers-reduced-motion` 归零，且**状态不许只靠动画表达**

## 未定事项（碰到时问用户，不要替其决定）

1. 字体未自托管（换机器会退到 PingFang / 雅黑）
2. AI「正在说」要不要加第四个光球态
3. `topics.html` 第 18-19 行中文破折号后多一个空格
