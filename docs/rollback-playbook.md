# 回滚手册

> **定位**：出事时照着做，不用临场想。分三块 —— 什么时候必须回滚 / 怎么退 / 退完怎么验。
> 配套文档：发布动作见 `docs/release-v1.0.md`；当日演练流水见 `docs/day26-rollback-drill.md`。
>
> **适用对象**：口语对话实战器（前端静态托管 + CloudBase 云函数 + CloudBase PG）
> **线上地址**：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com`

---

## 0. 三个决定本手册长相的事实

这三条不是背景介绍，是**每一条步骤的由来**。不知道它们，就会做出错误动作。

### 0.1 静态托管没有版本管理，「回滚」只能靠重传旧文件

`tcb hosting deploy --help` 原文：

```
Upload static files to cloud storage (file upload only, no build, no version management).
```

**没有"回滚到上一版"这个按钮，也没有版本历史。** 控制台上也没有。
所以「回退」在本项目里的唯一含义是：**把旧版的文件重新上传一遍**。

→ 由此推出：**发布前必须留一份线上快照**。这是回退的唯一弹药。
（怎么取：`docs/release-v1.0.md §4.2`）

### 0.2 `deploy` 只上传、不删除

好处：**永远不用担心它误删 CloudBase 自带资源**（登录页、控制台入口）。
代价：**新版新增的文件，回退后会残留在线上**，要单独处理（见 §2.5）。

### 0.3 v1.0 之前，线上内容对不上任何提交号

Day 26 实测：v1.0 发布前的线上是「按文件取不同历史版本」的叠加态
（`js/api.js` 是 10-09 的、`pages/topics.html` 是 10-07 的、`styles/main.css` 干脆从未提交）。

→ 所以**不能用 `git checkout 旧提交` 重建"上一版"** —— 重建出来的和线上本来就不一样。
**从 v1.0 起这条才成立**（v1.0 是第一次让线上内容与一个提交号对齐），但仍推荐优先用快照。

---

## 1. 什么时候必须回滚

> ★ **这一节的分档与阈值是 Day 26 拟定的默认值，未经实战检验。** 
> 第一次真出事之后，按实际情况回来改这张表 —— 别让它停在"看起来很完整"的状态。

### 1.1 判断顺序（照这个顺序问自己，不要跳）

1. **这次故障能不能撤销？** 碰了数据（写坏、丢了）→ 最高优先级，**立刻回滚**。
2. **用户看不看得见？** 用户可见的坏 > 内部可见的坏。内部接口报错但页面正常 → 不急。
3. **回滚目标本身是好的吗？** 别滚到一个也坏了的版本 —— 先确认快照/目标提交是当初验证过的那一版。
4. **修的成本可估吗？** 回滚成本是**已知的**（一次上传，几十秒）；诊断成本是**未知的**。
   → **宁可先回滚再慢慢查**。"先查清楚再决定"在出事现场是最容易把小事故拖成大事故的选择。

### 1.2 必须回滚（不诊断，先退）

| 触发条件 | 为什么这么定 |
|---|---|
| **数据被写坏 / 丢失 / 大面积误改** | 唯一**不可逆**的一类。拖一分钟多坏一分钟的数据 |
| 首页或主要页面 **404 / 白屏 / 拦截页** | 等于产品不存在了，用户第一眼就看到 |
| **登录页或控制台入口 404** | 典型的 `--prune` 误用后果（见 `release-v1.0.md §3 第 4 步`）。不退就没法登录去修 |
| 接口**大面积 5xx**（不是偶发单次） | 前端再好也白搭 |
| 部署后**页面能开但交互全坏**（发不出消息、点了没反应） | 表面正常比彻底坏更误导人 |

### 1.3 先回滚、再排查（2 分钟内判断不清楚就退）

| 触发条件 | 说明 |
|---|---|
| **某个核心流程不可用**（对话发不出去 / 收藏不生效 / 记录页空白） | 用户主路径断了，但站点还在 |
| **某个接口持续报错**（连续多次，且换设备/换网络仍报） | 先用 `error.code` 判断范围；判断不了就退 |
| **刚发布完，用户反馈"不好用了"但说不清哪里** | 信任用户的第一感觉，先退到已知good |

### 1.4 不回滚，走正常修复

| 触发条件 | 为什么 |
|---|---|
| 文案错、错别字、样式小瑕疵 | 不影响可用性；回滚会丢掉新版里对的东西 |
| 单个接口**偶发**失败（重试即好） | 多半是网络或冷启动，不是版本问题 |
| 非关键页面（如检查台）有问题 | 检查台是开发期工具，不在用户主路径上 |
| 只有你自己在本地看到的问题 | 先排除缓存：`Ctrl+Shift+R` |

★ **最后一类尤其要注意**：本项目踩过「curl 绿灯但无头浏览器拿到拦截页」的坑，
所以**"我这边看着不对"在定性之前不能当故障**，必须先用第 3 节的三条判据核实。

---

## 2. 静态托管回退步骤（**本次演练实操的就是这条**）

### 2.0 前置：确认回退目标

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
ls -d .deploy/snapshots/*/          # 有哪些快照
find .deploy/snapshots/<快照名> -type f | wc -l
```

- 快照命名规则：`before-<版本>`，即「发布该版本**之前**的线上状态」
- ★ **回滚到「上一版」= 传到 `before-<当前版本>` 那份快照**

### 2.1 记开始时间（★★ 必须与上传在**同一个命令块**里）

```bash
# Git Bash
S=$(date +%s)
```
```powershell
# PowerShell
$s=Get-Date
```

★★ **这条规矩比命令本身重要**：`S=$(date +%s)` 和 `tcb hosting deploy` **必须一次粘贴、连在一起跑**。

为什么：Day 26 演练第一次量出 `120 秒`，而同样操作的第二次（同块计时）只有 `7 秒` ——
差的 113 秒是**人看消息、切窗口、粘贴的时间**。
→ **分成两个块粘贴，量到的是「人有多快」，不是「流程有多快」。**
→ 所以下面 §2.2 与 §2.3 要**写在同一个命令块里**执行。

### 2.2 构建回退上传目录（★ 不能直接传整个快照）

```bash
rm -rf .deploy/_rollback-upload && mkdir -p .deploy/_rollback-upload
(cd .deploy/snapshots/before-v1.0 && tar cf - --exclude='./__auth' --exclude='./cloud-admin' . \
  | (cd ../../_rollback-upload && tar xf -))
find .deploy/_rollback-upload -type f | wc -l      # 期望 17
```

★ **为什么不直接传快照目录**：快照里含 CloudBase 自带的 `__auth/*`（5 个文件）和
`cloud-admin/index.html`。那**不是我们的资源**（登录页与控制台入口），
重传它们没必要，还可能干扰 CloudBase 自己的逻辑。**只回退我们自己的 17 个文件。**

★ 路径易错点：`cd .deploy/snapshots/before-v1.0` 之后回仓库根是 `../../`，
**不要再补一层 `.deploy/`**（`../../` 已经到 `.deploy` 了）。写成 `../../.deploy/_rollback-upload`
会报 `No such file or directory` —— 这个错本次实测踩过。

### 2.3 上传

```bash
# Git Bash
MSYS_NO_PATHCONV=1 tcb hosting deploy ".deploy/_rollback-upload" /
```
```powershell
# PowerShell
tcb hosting deploy ".deploy/_rollback-upload" /
```

★ 同样**一个可选参数都不加**：`--safe`（清空式回滚）/ `--verify` / `--prune`（删自带资源）/
`--enable-git-ignore` 全禁。理由逐条见 `docs/release-v1.0.md §3 第 4 步`。

期望回显：`Total files: 17` + `Successfully uploaded 17 file(s)`。

### 2.4 记耗时

★ **输出只用 ASCII**。写成 `echo "回退耗时 … 秒"` 这种**带中文的**输出，
在 MINGW64 终端里会渲染成糊掉的乱码（Day 26 两次实测：截出来是 `0 0 120 ~` 这种读不出的东西，
害得操作人回终端翻历史重找）。纯 ASCII 不可能糊：

```bash
# Git Bash
echo "ROLLBACK_SECONDS=$(( $(date +%s) - S ))"
```
```powershell
# PowerShell
"ROLLBACK_SECONDS=$([int]((Get-Date)-$s).TotalSeconds)"
```

期望输出：`ROLLBACK_SECONDS=97`

### 2.5 残留文件：什么时候需要额外删

`deploy` 只上传不删除 → **新版新增过的文件，回退后仍在线上**。

**本次 v1.0 的情况（实测）**：v1.0 相对旧版**没有新增任何文件**（17 个文件在快照里都有）。
→ **回退是纯覆盖，不需要删任何东西**。

一般情况（今后版本要注意）：
```bash
# 1) 先比对：回退后线上还有哪些文件不属于这一版
MSYS_NO_PATHCONV=1 tcb hosting list "/" --json > .deploy/hosting-list-after-rollback.json
# 2) 多出来的（排除 __auth/ 与 cloud-admin/ 之后）才删
MSYS_NO_PATHCONV=1 tcb hosting delete "<远端路径>"          # 单文件
MSYS_NO_PATHCONV=1 tcb hosting delete "<远端目录>" --dir     # 整个目录
```
★ **删之前必须确认该文件不在快照里**。把 `__auth/` 和 `cloud-admin/` 删掉 = 把登录入口删掉。

---

## 3. 云函数回退步骤（**今日只备查，不实操**）

Day 26 明确不做云函数回退实操。这一节是给真出事时用的。

### 3.1 唯一正确的更新命令

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
tcb fn code update <函数名> --dir cloudfunctions/<函数名>
```

★ **不要用 `tcb fn deploy`** —— 它会按 `cloudbaserc.json` 的 `functions[]` 覆盖配置，
而环境变量是在**控制台**配的（不进仓库，见 `docs/security-checklist.md`）。
`tcb fn deploy` 会把线上密钥清空。

### 3.2 回退到上一个提交的云函数代码

```bash
# 1) 把该函数的目录回退到上一个已验证的提交（只动这个目录）
git checkout <旧提交> -- cloudfunctions/<函数名>
# 2) 只更新代码，不碰配置与环境变量
tcb fn code update <函数名> --dir cloudfunctions/<函数名>
# 3) 验证（见 §4）
# 4) 验证通过后，把工作区还原到 HEAD，别把旧代码留在分支上
git checkout HEAD -- cloudfunctions/<函数名>
```
```powershell
# PowerShell（四条同，仅第 1、4 条路径分隔符不影响，git 在两边写法一致）
```

### 3.3 更稳的做法：蓝绿

`tcb fn copy <函数名> <新函数名>` 存在，且**类型与环境变量随复制**。
所以可以先建一份新函数、验证通过再切路由，出问题切回来 —— 不用改原函数。

### 3.4 两个不能靠 CLI 的东西

| 东西 | 为什么 | 怎么办 |
|---|---|---|
| **环境变量** | `tcb fn env` 只有 `pull` 没有 `push`；且绝不能写进 `cloudbaserc.json`（那是仓库里的文件＝泄密） | **只能控制台手点**。所以环境变量的当前值必须另有记录 —— 回滚前先 `tcb fn env pull <函数名> --output-file <项目内路径>` 留底，**只核键名，不要 cat 出值** |
| **网关路由** | `tcb routes add` 报 `domain … is a system internal domain, manual creation or modification is not supported` | **只能控制台**：`#/env/http-access` →「路由管理」→「添加路由」。★ 必须开「路径透传」和「**跨域设置**」（后者少了浏览器被拦而 curl 照样 200） |

---

## 4. 数据恢复（**今日只备查，不实操**）

### 4.1 现状与通路

- 数据在 CloudBase PG；三张表：`sessions` / `turns` / `items`
- **云函数直连 PG 在本环境不通**（体验版没有 VPC/内网权限）→ 数据操作只能走
  `tcb db execute`（CLI）或云函数的 HTTP API
- ★ **数据恢复是不可逆操作**，动手前**先导出现状**，别在没退路的情况下改

### 4.2 备份（发布清单 §4.3 有同样的命令）

```bash
tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from sessions" --json
tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from turns"    --json
tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from items"    --json
```
★ `Rows` 字段是「JSON 里再套一层 JSON 字符串」（形如 `["[\"7\",\"20\",\"8\"]"]`）。
想快速看多张表的行数，最省事的写法是一条 SQL 里用子查询：
`select (select count(*) from sessions) as sessions, (select count(*) from turns) as turns, (select count(*) from items) as items`

### 4.3 恢复思路（真出事再细化，今日不展开）

1. 按导出文件逐条 `INSERT` 回去（注意 `items` 主键与外键顺序：先 `sessions`，再 `turns` / `items`）
2. 数据是演示数据、可以整体重灌时 → 直接用 `db/seed.sql` 重建
3. ★ `db/schema.sql` 是建表真源；SQL 编辑器单次限 **10000 字符**，大文件要分批

---

## 5. 静态托管回退的「另一条路」：从 git 重建（不推荐）

只有**没有快照**时才考虑，且要接受它可能与线上不一致。

```bash
# 1) 把某个提交的前端展开到临时目录（不污染工作区）
git worktree add .deploy/_wt-rollback <提交号>
# 2) 从那个工作树构建上传目录（排除开发期文件，与发布时同一套排除规则）
# 3) 上传；验证完删掉工作树
git worktree remove .deploy/_wt-rollback
```

★ 三个已知风险，用它就必须接受：
1. **v1.0 之前**的线上内容是叠加态，重建出来的和线上本来就不一样（§0.3）
2. 行尾：本仓库 `core.autocrlf=true`，重建出来的文件字节可能与线上不等
3. 它重建的是"某个提交的前端"，不一定是"当初真正在跑的那一版"

---

## 6. 回滚后验证

### 6.1 主判据：托管侧 ETag 与目标文件逐文件比对（绕开 CDN）

```bash
MSYS_NO_PATHCONV=1 tcb hosting list "/" --json > .deploy/list.json
```
判据：**每一个文件的 `eTag` == 回退目标目录里同名文件的 `md5sum`**。
- 这条查的是**存储侧实际存下的字节**，不受 CDN 与浏览器缓存影响
- ★ 回退的验收标准是「**字节等于目标版本**」，**不是**「页面能打开」——
  页面能打开也可能还是新版

### 6.2 辅助判据

```bash
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
# ① 标题不是「风险提醒」拦截页（拦截页也是 200，所以必须比标题）
curl -s --noproxy '*' -m 25 "$B/pages/topics.html" | grep -oE "<title>[^<]*</title>"
# ② 抽几个文件比 md5
curl -s --noproxy '*' -m 25 "$B/js/api.js" -o /tmp-probe && md5sum /tmp-probe
```

★★ **必须让真人用真浏览器看一眼**。本项目实测：CloudBase 会拦带
`Sec-Fetch-Mode: navigate` 的请求，返回标题为「风险提醒」的 404 页（**HTTP 也是 200**）。
所以**命令行绿灯不能当验收结论**。

### 6.3 回滚后还必须做的两件事

1. **确认自带资源还在**：`__auth/` 下 5 个文件 + `cloud-admin/index.html`（共 6 个）
2. **在 `docs/` 或记忆里记一笔**：什么时候、因为什么、退到哪一版、耗时多久 ——
   否则下次出事没人知道这个版本被退过

---

## 7. 演练记录模板

> 每次演练或实战后填一张。**耗时是这张表的核心** ——
> 目的是回答"真出事我敢不敢用这套流程"，而不是"流程写完了没有"。

### 7.1 基本信息

| 项 | 内容 |
|---|---|
| 日期 / 时间 | |
| 类型 | 演练 / 真实事故（二选一） |
| 操作人 | |
| 起因 | |
| 当前线上版本 | |
| 回退目标 | 快照 `before-______` / 提交 `______` |
| 终端 | Git Bash / PowerShell |

### 7.2 分步耗时

| # | 步骤 | 开始 | 结束 | 耗时 | 命令 | 结果 / 证据 |
|---|---|---|---|---|---|---|
| 1 | 记开始时间 | | | — | `S=$(date +%s)` | |
| 2 | 确认回退目标存在 | | | | `find .deploy/snapshots/<名> -type f \| wc -l` | 文件数 = |
| 3 | 构建回退上传目录 | | | | `tar cf - --exclude=…` | 文件数 = 17 |
| 4 | 上传（回退） | | | | `tcb hosting deploy ".deploy/_rollback-upload" /` | `Successfully uploaded __ file(s)` |
| 5 | 记耗时 | | | | `echo "ROLLBACK_SECONDS=$(( $(date +%s) - S ))"` | **ROLLBACK_SECONDS = __** |
| 6 | ETag 逐文件比对 | | | | `tcb hosting list "/" --json` | 一致 __ / 17 |
| 7 | 标题粗筛 | | | | `curl … grep title` | |
| 8 | **真浏览器确认** | | | | 人工 | 谁在什么时候看的 |
| 9 | 恢复原版本 | | | | `tcb hosting deploy ".deploy/hosting" /` | |
| 10 | 再次验证（6、7、8） | | | | 同上 | |

★ **第 1–5 步必须一次粘贴、连在一起跑**（同 §2.1 的理由）。
分开粘贴量到的是人的反应时间 —— Day 26 第一次就是这么量出 `120 秒` 的，而真实值 `7 秒`。
★ 第 9 步的耗时同样用 ASCII：`echo "RESTORE_SECONDS=$(( $(date +%s) - S2 ))"`

### 7.3 结论

| 问题 | 回答 |
|---|---|
| 总耗时 | ____ 秒 |
| 卡在哪一步最久 | |
| 手册有没有写得不清楚 / 写错的地方 | |
| 下次要不要改流程 | |
| **真出事敢不敢用** | 敢 / 有保留（写清保留在哪） |

★ 第 7.3 最后一问是这张表存在的理由。**如果答不出"敢"，说明流程还没验收。**
