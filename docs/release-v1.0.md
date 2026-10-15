# 发布清单 · v1.0

> 本文是**发布动作的作业单**：版本标记 / 发布前验证项 / 发布步骤 / 发布后验证 / 备份方式。
> 每一条都写了命令或文件路径，可直接复制执行。
> 配套文档：回退步骤见 `docs/rollback-playbook.md`；本次演练流水见 `docs/day26-rollback-drill.md`。
>
> **适用对象**：口语对话实战器（前端静态托管 + CloudBase 云函数 + CloudBase PG）
> **线上地址**：`https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com`

---

## 0. 一句话背景：v1.0 之前，线上是不可追溯的

Day 26 实测（方法：`git hash-object <线上文件>` 与 `git rev-parse <commit>:<path>` 比对象哈希，
按路径历史从新到旧回溯第一个相等者）：

**发布前的线上内容是「按文件取不同历史版本」拼出来的叠加态，没有任何一个提交号能代表它。**

| 线上文件 | 对应 git 版本 |
|---|---|
| `data/mock-sessions.json`、`js/pages/status.js`、`js/pages/topics.js`、`pages/status.html`、`pages/topics.html` | `77eefb5`（10-07） |
| `js/api.js`、`js/components/item-card.js`、`pages/records.html` | `34fd16f`（10-09） |
| `data/topics.json` | `817aa73`（10-02） |
| `js/components/interact.js`、`js/components/topic-card.js` | `afb499e`（09-29） |
| `js/storage.js` | `e4c9259`（10-07） |
| `pages/result.html` | `8d63027`（10-07） |
| `js/speech.js`、`pages/dialogue.html`、`styles/main.css`、`index.html` | **不在 git 里**（对象不存在，内容从未提交） |

★ **v1.0 的意义就在这里**：这是第一次让「线上内容」与「一个提交号」对齐。
从 v1.0 起，回退才有干净的锚点；v1.0 之前的线上，只能靠快照回退（见 §4.2）。

---

## 1. 版本标记

| 项 | 值 |
|---|---|
| 版本号 | **v1.0** |
| 产品代码基线 | `303acde`（Day 25 最后一笔）的 `frontend/` 目录 —— 当日工作区干净、与远端 0 差距，可视为等同 HEAD |
| 标记方式 | git 附注标签 `v1.0`（**不改任何产品代码**，故不重跑 Day 25 的 20 项以外的额外回归） |
| 打标签命令 | 见 §3 第 5 步 |
| 线上地址 | `https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/pages/topics.html` |
| 本次发布内容 | `frontend/` 当前全部文件 + 保留线上已有的 `index.html`（跳转页，项目里没有源文件） |

**为什么 v1.0 是「发布」而不是「改代码」**：本次产品代码零改动。
发的是**已经被写出来但一直没上公网的内容** —— Day 23 之后累积的前端改动，从未部署过。

### ⚠️ 待拍板：tag 打在哪一笔提交上

| 选项 | 含义 | 代价 |
|---|---|---|
| **A（建议）** | 打在**今日收尾提交**（含发布清单/回滚手册） | tag 指向的仓库状态包含当天文档；产品代码部分与 `303acde` 一致（清单里已写明） |
| B | 直接打在 `303acde` | tag 指向纯产品代码状态；但「v1.0 = Day 26 发布」这层信息只能靠 tag 注释表达 |

---

## 2. 发布前验证项

### 2.1 主检查：Day 25 那套 20 项（必跑）

**必须在 Git Bash / MINGW64 里跑**（脚本用了 bash 特有的 `$'…'` 与 `<()`）。

```bash
# 终端 1：让本地服务开着（第 13 项要跑无头回归，缺了它会判 SKIP）
cd /c/Users/26629/WorkBuddy/VibeCoding/frontend && python serve.py

# 终端 2：回仓库根目录跑检查
cd /c/Users/26629/WorkBuddy/VibeCoding
bash .workbuddy/skills/kouyu-verify-project/scripts/check.sh
```

**通过标准**：末行 `20 通过 / 0 失败 / 0 跳过`，退出码 `0`。
★ **跳过 ≠ 通过** —— 退出码 = 失败数 + 跳过数，有 SKIP 就不算全过。
★ 逐项的命令、通过标准、已知误报风险见真源：
`.workbuddy/skills/kouyu-verify-project/references/checks.md`

### 2.2 v1.0 专属项（本次新增，20 项没覆盖）

| # | 检查什么 | 命令（Git Bash） | 通过标准 |
|---|---|---|---|
| V1 | 部署目录与源码一致 | 逐文件比对命令见 §3 第 2 步末 | 输出为**空**（= 每个文件与 `frontend/` 同路径文件的对象哈希相等） |
| V2 | 部署目录**不含** 6 个开发期文件 | `cd .deploy/hosting && ls serve.py regress.js a11y-check.js flt-verify.js js/pages/day23-errors.js pages/day23-errors.html 2>&1` | 6 条**全部**报 `No such file or directory` |
| V3 | 部署目录**含** `index.html` | `ls -l .deploy/hosting/index.html` | 文件存在（它只存在于部署目录，项目里没有源文件） |
| V4 | 发布前线上快照已取得 | `find .deploy/snapshots/before-v1.0 -type f \| wc -l` | **23** |
| V5 | 无已跟踪文件被改动、与远端无差距 | `git status --short`；`git rev-parse --short HEAD origin/master` | 输出里**没有 `M`/`D`/`A` 行**（只允许 `?? docs/` 下的今日新增文档，它们在收尾时才提交）；两个哈希相同 |

★ **V2 的判据是「显式确认这几个文件不在」**，不是「一条都没有」——
后者会让你误删该留的东西（`checks.md` 三条不虚报原则之三）。

---

## 3. 发布步骤

### 第 1 步 · 确认备份已完成（§4）
```bash
ls .deploy/snapshots/before-v1.0/ && find .deploy/snapshots/before-v1.0 -type f | wc -l   # 期望 23
```

### 第 2 步 · 重建部署目录 `.deploy/hosting/`

⚠️ **本次不能「同步差异文件」，只能整目录重建。**
原因：`.deploy/hosting/` 是**陈旧混合态** —— 多数文件停在 10-07，
但 `js/api.js`、`js/speech.js`、`pages/dialogue.html`、`styles/main.css` 4 个文件
是 **10-11 23:22 的未部署副本**，既不是线上版也不是当前代码。
只同步「9 个不一致文件」会把这份野生版本一起发出去。

做法：先**清空**（保留 `index.html`），再从 `frontend/` 复制，并排除 6 个开发期文件。

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
# 1) 保存 index.html（项目里没有源文件，不能被清掉）
cp .deploy/hosting/index.html .deploy/_index.html.keep
# 2) 清空并重建
rm -rf .deploy/hosting && mkdir -p .deploy/hosting
# 3) 复制源码（排除 6 个开发期文件）
cd frontend
tar cf - --exclude='serve.py' --exclude='regress.js' --exclude='a11y-check.js' \
        --exclude='flt-verify.js' --exclude='js/pages/day23-errors.js' \
        --exclude='pages/day23-errors.html' . | (cd ../.deploy/hosting && tar xf -)
cd ..
# 4) 放回 index.html
mv .deploy/_index.html.keep .deploy/hosting/index.html
```

PowerShell 等价写法（不用 tar）：
```powershell
cd C:\Users\26629\WorkBuddy\VibeCoding
$src='.\frontend'; $dst='.\.deploy\hosting'
$keep = Get-Content -Raw "$dst\index.html"
Remove-Item $dst -Recurse -Force; New-Item -ItemType Directory -Path $dst | Out-Null
$skip = @('serve.py','regress.js','a11y-check.js','flt-verify.js','day23-errors.js','day23-errors.html')
Get-ChildItem $src -Recurse -File | Where-Object { $skip -notcontains $_.Name } |
  ForEach-Object { $rel=$_.FullName.Substring((Resolve-Path $src).Path.Length+1)
    $t=Join-Path $dst $rel; New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null
    Copy-Item $_.FullName $t }
Set-Content -Path "$dst\index.html" -Value $keep -NoNewline
```

**重建后自查（V1/V2/V3）**：
```bash
# ① 文件数应为 17（frontend 22 个 - 6 个开发期文件 = 16，再加只有部署目录才有的 index.html）
find .deploy/hosting -type f | wc -l
# ② 与源码逐文件比对象哈希，期望输出为空（= 无差异）
for f in $(cd .deploy/hosting && find . -type f | sed 's|^\./||' | grep -v '^index.html$'); do
  [ "$(git hash-object .deploy/hosting/$f)" = "$(git hash-object frontend/$f)" ] || echo "差异：$f"
done
```

★ 上面第 3 步的 `tar` 复制命令**已实测**：得到 16 个文件，
且 `serve.py` / `regress.js` / `a11y-check.js` / `flt-verify.js` / 两个 `day23-errors` 文件
逐个确认不在结果里（不是「看起来没有」）。

★ 本次执行前的旧副本已保全在 `.deploy/_hosting.bak-before-rebuild/`（17 个文件），
重建后核对无差异即可删。它和回退用的 `.deploy/snapshots/` **不是一回事**：
前者是本地陈旧副本，后者是线上快照。

### 第 3 步 · 再跑一次发布前检查
部署目录变了，§2.1 必须在本步之后重跑一遍（尤其第 13 项无头回归）。

### 第 4 步 · 上传到静态托管（由你亲手执行）

```bash
# Git Bash —— MSYS_NO_PATHCONV=1 不能省，否则路径被 Git Bash 改写
cd /c/Users/26629/WorkBuddy/VibeCoding
MSYS_NO_PATHCONV=1 tcb hosting deploy ".deploy/hosting" /
```
```powershell
# PowerShell
cd C:\Users\26629\WorkBuddy\VibeCoding
tcb hosting deploy ".deploy/hosting" /
```

⚠️ **绝对不能加 `--safe`、`--verify`、`--prune`、`--enable-git-ignore`**（逐个说清，都是实测或 `--help` 原文）：

| 不能加 | `--help` 原文 / 实测后果 |
|---|---|
| `--safe` | "create a backup before publishing, and automatically roll back if…fails" —— 实测会把整个根目录**清空**，它说的「备份保留在 `.cloudbase-backup/`」根本没在磁盘生成 |
| `--verify` | 与 `--safe` 配套的校验，触发上面那条清空式「回滚」 |
| **`--prune`** | "clean up remote files that **do not belong to the current version**; this will **delete remote files outside this publish**" —— 我们的部署目录里**没有** CloudBase 自带的 `__auth/` 下 5 个文件（自带资源与 `cloud-admin/index.html` 合计 **6 个**）和 `cloud-admin/index.html`，加了它就会被判定为「不属于当前版本」而**删掉登录与控制台入口** |
| `--enable-git-ignore` | 把项目 `.gitignore` 合并进来；而 `.gitignore` 里有 `.deploy/`，语义会变得难以预料。默认就是关的，别开 |

⚠️ 部署**只上传、不删除**：这是**好事**（不会误删 CloudBase 自带资源），
代价是**回退时残留文件要显式删**（见回滚手册）。

### 第 5 步 · 打版本标签

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
git tag -a v1.0 -m "v1.0 · 首次将线上内容与提交号对齐"
git push origin v1.0
```

---

## 4. 备份方式

### 4.1 代码备份

| 手段 | 命令 / 位置 | 说明 |
|---|---|---|
| **远端仓库**（主保险） | `git push origin master` | 提交推送走；失败先探直连与代理（见 §6） |
| **版本标签** | `git push origin v1.0` | v1.0 的可追溯锚点 |
| **部署目录全量** | `.deploy/hosting/` | `frontend/` 的可重建副本；已加入 `.gitignore` |

### 4.2 线上快照（回退的**唯一**可用锚点）

```bash
# Git Bash
cd /c/Users/26629/WorkBuddy/VibeCoding
MSYS_NO_PATHCONV=1 tcb hosting download "/" ".deploy/snapshots/before-v1.0" --dir
```
```powershell
# PowerShell
cd C:\Users\26629\WorkBuddy\VibeCoding
tcb hosting download "/" ".deploy/snapshots/before-v1.0" --dir
```

- 本次快照：`.deploy/snapshots/before-v1.0/`，**23 个文件**（已取得）
- ★ 里面含 CloudBase 自带资源 `__auth/` 下 5 个文件（自带资源与 `cloud-admin/index.html` 合计 **6 个**）+ `cloud-admin/index.html` ——
  **回滚时绝不能整目录删**，否则登录与控制台入口一起没了
- ★ 放在 `.deploy/` 下是**故意的**：该目录已在 `.gitignore` 里；
  新建 `.rollback-snapshot/` 会被 git 跟踪，等于把线上字节塞进仓库

### 4.3 数据备份（CloudBase PG）

**现状**：`sessions` 7 行 / `turns` 20 行 / `items` 8 行（Day 26 实测）。
连接方式只有一条可用通路：`tcb db execute`（云函数直连 PG 在体验版不通，原因见 `notes/cloudbase-pg.md §2`）。

| 表 | 备份命令（只读，可直接跑） |
|---|---|
| `sessions` | `tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from sessions" --json` |
| `turns` | `tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from turns" --json` |
| `items` | `tcb db execute -e cxj1528-d4g55ng0o54cbe296 --sql "select * from items" --json` |

- 把三条输出重定向到 `.deploy/backups/db/<日期>-<表名>.json` 即完成逻辑导出
- ⚠️ SQL 编辑器单次限 **10000 字符**，大表要分批（`limit`/`offset`）；当前数据量远未触限
- ⚠️ **发布静态托管不改任何数据**，所以本次发布的[数据备份是「保险」而非「必需」**
- ★ 数据**恢复**属回滚手册备查内容，今日不做实操（Day 26 明确不做）

---

## 5. 发布后验证

### 5.1 命令行粗筛（只能证明「文件上去了」，不能证明「页面正常」）

```bash
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
# ① 标题不是「风险提醒」拦截页
curl -s --noproxy '*' -m 25 "$B/pages/topics.html" | grep -oE "<title>[^<]*</title>"
# ② 已发布文件的内容 ETag = 本地部署目录的 md5（逐文件确认真的换成新内容）
curl -s --noproxy '*' -m 25 -D - -o /dev/null "$B/js/speech.js" | grep -i etag
md5sum .deploy/hosting/js/speech.js
# ③ 检查台四接口（走真浏览器页面，或直接打接口）
curl -s --noproxy '*' -m 25 "$B/api/health"
```

**为什么不能只信状态码**：CloudBase 会拦带 `Sec-Fetch-Mode: navigate` 的请求，返回标题为
「风险提醒」的 404 页（**HTTP 照样 200**）。所以 ① 必须比 `<title>`，状态码完全无法区分。

★ **部署命令回显里的 CDN 提示**：CLI 会提示 `CDN cache ttl: … CDN usually refreshes in a few minutes`。
本次实测**没有出现延迟**（部署后立刻抓 6 个文件，全部已是新内容）。若将来遇到延迟，
先不要当失败 —— 过一个 CDN 周期再抓一次。

### 5.2 真浏览器肉眼确认（★ 不可省，这是唯一的最终判据）

打开 `https://…tcloudbase.com/pages/topics.html`，`Ctrl+Shift+R` **强制刷新**后逐项确认：

| 确认什么 | 合格长什么样 |
|---|---|
| 首页 | 主题列表正常渲染，不是空白、不是拦截页 |
| 检查台 `/pages/status.html` | 四个接口全 🟢 |
| 对话页 | 录音出现「正在听：…」；说完 1 秒出现「听到你说完了，正在提交……」；**AI 会出声** |
| 收藏 / 记录页 | 条目能正常显示（Day 24 的「收藏从不写库」修复应已生效） |

★ 第 5 项截图（三个地址栏 + 页面）留作当日交付物。

---

## 6. 已知坑速查（发布相关）

| 现象 | 根因 | 怎么办 |
|---|---|---|
| `tcb hosting list/deploy "/"` 报 `No files found under …PortableGit` | Git Bash 把 `/` 改写成 Windows 路径 | 命令前加 `MSYS_NO_PATHCONV=1` |
| 部署后页面没变 | 浏览器缓存 | `Ctrl+Shift+R` 强制刷新 |
| `--safe` 之后整站 404 | `--safe` 的清空式回滚，且备份根本没生成 | **永远不用 `--safe` / `--verify`** |
| 登录/控制台入口 404 | 误加了 `--prune`，把 CloudBase 自带的 `__auth/*`、`cloud-admin/` 当「不属于当前版本」删了 | **永远不用 `--prune`**；这几条本来也不在我们的部署目录里 |
| `tail -N` 看不到部署进度 | 输出被缓冲 | `> 文件 2>&1` 后 grep |
| `git push` 报 `schannel failed to receive handshake` | 本机代理不稳 | 两条路重探：`curl -s -o /dev/null --max-time 12 -w "直连 %{http_code}\n" https://github.com` 与 `--proxy http://127.0.0.1:7897`；直连通就 `git -c http.proxy= -c https.proxy= push` |
| 自测本机服务连接失败 | 本机有 `http_proxy` 环境变量 | `curl` 加 `--noproxy '*'`；无头 Chrome 加 `--no-proxy-server` |

---

## 7. 本次发布记录（完成后回填）

| 项 | 结果 |
|---|---|
| 发布前检查（§2.1） | **20 通过 / 0 失败 / 0 跳过**，退出码 `0`（2026-10-15 14:35，日志 `.deploy/check-day26.log`） |
| v1.0 专属项 V1–V5 | 全过：部署目录 17 个文件且与源码无差异 / 6 个开发期文件确认不存在 / `index.html` 存在 / 快照 23 个文件 / HEAD = `origin/master` = `303acde` |
| 部署命令回显 | **`Total files: 17` / `Successfully uploaded 17 file(s)`**，无失败（2026-10-15 14:42，由你亲手执行） |
| 标签 | 待填：`v1.0` → 提交 `______`，已推送（是/否） |
| 发布后命令行粗筛 | 托管侧 ETag **17/17 与本地 md5 一致**；公网标题 `主题列表 · 口语对话实战器`；抽验 6 个文件线上 md5 = 本地（新内容已生效）；自带资源 6 个全在 |
| 真浏览器确认 | **通过**（2026-10-15，用户亲自确认；属人工步骤，证据为用户口述 + 当日截图，无法用命令行复现） |
| 快照 | `.deploy/snapshots/before-v1.0/`，23 个文件 |
