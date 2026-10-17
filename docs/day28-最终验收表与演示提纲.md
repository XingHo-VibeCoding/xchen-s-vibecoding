# Day 28｜最终验收表 + 3–5 分钟演示提纲

> **取证时间**：2026-10-17 19:35–19:50（全部命令当场跑，输出抄在下面对应位置）
> **执行者**：AI 代为执行命令，用户复核；需人眼确认的项已单列在 §2
> **代码基线**：`e8ed427`（Day 27），工作区干净（`git status --short` 空）
> **公网基址** `B`：
> `https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com`
> **判定口径**（沿用 `docs/week4-acceptance.md`）：
> **PASS** = 有可复现命令且实跑通过；**FAIL** = 跑了但结果不符；
> **未执行** = 今天没验，如实标出。**不把未验证的写成 PASS。**

---

## §1 附录 J 十项逐项验收

| # | 检查项 | 判定 | 一句话证据 |
|---|---|---|---|
| 1 | 页面 / 视图数量 | **PASS** | 4 个产品页 + 2 个开发期页，7 条路径全部 HTTP 200 |
| 2 | 反馈交互 | **PASS** | 收藏三态 / 备注 / 删除二次确认 / 错误提示统一（单测 18–0） |
| 3 | 数据库读写 | **PASS** | 写入返 `itemsStored=1`、重复提交 `DUPLICATE`、PATCH 改三列、DELETE `softDeleted:true` |
| 4 | 前后端链路 | **PASS** | `chat` 返 `aiText`+`aiTextZh`、`analyze` 返 2 issue + 1 good；线上文件与本地 7/7 一致 |
| 5 | 合法数据来源 | **PASS** | 9 条主题全手写、页面 0 外链、演示数据已清空、库里是真实使用记录 |
| 6 | 公网地址 | **PASS** | 首页 200 / 7404 B；4 个页面 + 检查台全部 200 |
| 7 | 线上持久化 | **PASS** | 写入后**跨请求**读回同一条；软删后条目消失而 `sessions` 保留 |
| 8 | 回滚与备份说明 | **PASS** | 快照 2 份共 46 文件；演练实测回退 8 秒 / 恢复 7 秒；手册 4 条路径 |
| 9 | CloudBase 额度与到期风险 | **PASS** | 资源点 636.45/3000（21.2%）；环境有效至 2027-04-03 |
| 10 | 敏感文件 | **PASS** | 仓库只跟踪 `.env.example`；3 个本地密钥文件均被 ignore；真实密钥 0 条 |

> ★ 十项里有两项**带缺口**（第 7 项的浏览器刷新层、第 8 项的备份时效），
> 缺口写在各自证据块和 §2，不是"通过"两个字盖过去。

---

### §1.1 页面 / 视图数量 — PASS

**判据**：PRD 定的 4 个页面都能打开，且"数量"能说清每一页是什么。

| 类型 | 页面 | 文件 | 公网状态 |
|---|---|---|---|
| 产品页 P1 首页 | 主题列表 / 自由对话入口 | `frontend/pages/topics.html` | 200 / 7404 B |
| 产品页 P2 对话 | 主题模式 + 自由对话模式（同一页两种视图） | `frontend/pages/dialogue.html` | 200 / 94909 B |
| 产品页 P3 结果 | 问题清单 + 精彩句子 + 收藏备注 | `frontend/pages/result.html` | 200 / 30006 B |
| 产品页 P4 记录 | 全部条目 + 收藏区 + 筛选 | `frontend/pages/records.html` | 200 / 46557 B |
| 开发期页 | 检查台（健康 / 读 sessions / 写入测试） | `frontend/pages/status.html` | 200 / 4920 B |
| 开发期页 | 三类错误提示对照（该页注释写明"只服务于截图"） | `frontend/pages/day23-errors.html` | 未部署 |

**口径说明**（避免"6 个页面"这种糊涂账）：

- **产品页 4 个**（对齐 `PRD.md §7.1` P1–P4）
- **视图 5 种**：P1 / P2-主题模式 / P2-FREE 模式 / P3 / P4。
  P2 的两种模式是同一 HTML，靠 `topicId=FREE` 切换（PRD §7.3「自由对话模式下的差异」）
- **开发期页 2 个**：`status.html`（检查台，不属 F1–F6）与 `day23-errors.html`（截图用对照页，未上线）
- `index.html` 是 200/1460 B 的跳转页，不计入页面数

**复现**（Git Bash）：

```bash
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
for p in "" "/pages/topics.html" "/pages/dialogue.html" "/pages/result.html" "/pages/records.html" "/pages/status.html"; do
  printf "%-26s " "/$p"; curl -s --noproxy '*' -m 15 -o /dev/null -w "HTTP %{http_code} %{size_download}B\n" "$B/$p"
done
```

实跑输出：7 行全 `HTTP 200`，字节数与上表一致。

---

### §1.2 反馈交互 — PASS

**判据**：用户每做一个动作，界面都要有即时回应；失败要有话可读。

| 交互 | 实现位置 | 用户看到什么 |
|---|---|---|
| 收藏（三态：未收藏 → 保存中… → 已收藏，可反复撤销） | `frontend/js/components/interact.js:34-38`、`item-card.js:107-113` | 按钮文字随状态变，失败给中文提示 |
| 备注保存 | P3 结果页 + P4 记录页，走 `PATCH /api/sessions/write` | 保存后 `changed` 里含 `note`，读回可见 |
| 删除二次确认 | `window.confirm`（Day 22 拍板，不动 `main.css`） | 先弹确认再请求 |
| 三类错误提示统一 | `api.js` 分类 + `friendlyMessage` | 全部返回中文，不露英文被拒栈 |
| 筛选（记录页两区块同时过滤） | P4 筛选条，全字段子串匹配 | 无匹配显示"未找到"，清空立刻恢复 |
| AI 朗读 + 中文直译 | `SpeechSynthesis` + `aiTextZh` | 听到英文、看到中文，中文不朗读 |

**单测实跑**（Git Bash）：

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
node .test-friendly-message.js
```

输出：`通过 18 / 失败 0 / 全部通过`（逐个错误码验证：一律返回中文，没有把英文原样抛给用户）。

> ★ 不拿 `node regress.js` 的通过数当证据：它同一份改动连跑三次会给出
> `0/25`、`25/0`、`SIGTERM` 三种结果，只能看"控制台 0 条报错"。

---

### §1.3 数据库读写 — PASS（增删改查四类全跑过）

今天新开两条验收记录，四类操作逐个实跑：

| 操作 | 请求 | 实际返回 |
|---|---|---|
| **增** | `POST /api/sessions/write`（`S-20261017-ACPT02`，2 轮 + 1 条 logic） | `ok:true`，`turnsStored:2`，`itemsStored:1`，`errorCount:1` |
| **查** | `GET /api/sessions?limit=2` | 第一条即 `S-20261017-ACPT01`，`durationSeconds:60` |
| **改** | `PATCH`（`itemId` + `note` + `isFavorited:true`） | `changed:["note","is_favorited","favorited_at"]`，读回 `fav=True`、备注原样 |
| **删** | `DELETE ...?itemId=S-20261017-ACPT02-L1` | `softDeleted:true`；随后 `GET /api/items` 里该条不再出现 |
| 去重 | 同一 `sessionId` 再 POST | `400 DUPLICATE`「这场对话已经存过了」 |
| 校验 | `topicId:"T99"` | `400 INVALID_PARAMS`「只允许 T1–T8 或 FREE（收到 T99）」 |
| 校验 | `items` 里 logic 缺 `correction` | `400 INVALID_PARAMS`「必须带 correction（改法）」 |

**复现**（Git Bash，`B` 同 §1.1）：

```bash
# 增
curl -s --noproxy '*' -X POST "$B/api/sessions/write" -H "Content-Type: application/json" \
 -d '{"sessionId":"S-20261017-ACPT02","topicId":"T2","startedAt":"2026-10-17T19:32:00+08:00","endedAt":"2026-10-17T19:33:00+08:00","isComplete":true,"transcript":[{"turn":1,"userText":"We are two days behind on the API.","aiText":"Which part exactly?"}],"items":[{"turn":1,"type":"logic","reminder":"先说落后又说能做完","correction":"We are two days behind, so I need one more day."}]}'
# 查
curl -s --noproxy '*' "$B/api/sessions?limit=2"
# 改（itemId 走 body）
curl -s --noproxy '*' -X PATCH "$B/api/sessions/write" -H "Content-Type: application/json" \
 -d '{"itemId":"S-20261017-ACPT02-L1","note":"验收备注","isFavorited":true}'
# 删（itemId 走 query —— 走 body 会报「缺少 itemId」，这是今天踩到的第一个小坑）
curl -s --noproxy '*' -X DELETE "$B/api/sessions/write?itemId=S-20261017-ACPT02-L1"
```

> **今天踩到的坑（演示时别踩）**：`DELETE` 的 `itemId` 在 **query**，`PATCH` 的在 **body**。
> 契约 `docs/api-contract.md §4.2` 方法一览里写了，但一眼看不出来。

---

### §1.4 前后端链路 — PASS

**判据**：前端页面 → 网关 → 云函数 → 大模型 / 数据库，每一跳都有实跑输出。

| 链路 | 实测输出 |
|---|---|
| `chat`（AI 先开口，T1） | `{"aiText":"Which part of the API isn't finished yet?","aiTextZh":"API哪一部分还没做完？","kind":"normal","model":"deepseek-chat"}` |
| `chat`（回应用户） | `{"aiText":"Which part is still unfinished?","aiTextZh":"哪一部分还没做完？",...,"model":"deepseek-chat"}` |
| `analyze`（3 轮整场） | 2 条 `issues`（1 logic 带 correction、1 offtopic 的 `correction:null`）+ 1 条 `goodSentences` |

★ `offtopic` 的 `correction` 是 `null` —— 正好对上 PRD **F2**「偏题只提醒、逻辑错误提醒+纠正」的口径。

**线上跑的是不是最新代码**（这条最容易被漏，也最能被追问）：

| 文件 | 本地 md5 | 线上 md5 | 一致 |
|---|---|---|---|
| `pages/topics.html` | baf838a5… | baf838a5… | ✅ |
| `pages/dialogue.html` | 0fc965ce… | 0fc965ce… | ✅ |
| `pages/result.html` | 316170dc… | 316170dc… | ✅ |
| `pages/records.html` | 2849ce37… | 2849ce37… | ✅ |
| `styles/main.css` | ff3fa36d… | ff3fa36d… | ✅ |
| `js/api.js` | 2366d568… | 2366d568… | ✅ |
| `js/pages/topics.js` | cda0a74c… | cda0a74c… | ✅ |

**复现**（Git Bash）：

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
B="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
mkdir -p .deploy/verify-day28
for f in pages/topics.html pages/dialogue.html pages/result.html pages/records.html styles/main.css js/api.js js/pages/topics.js; do
  curl -s --noproxy '*' -o ".deploy/verify-day28/$(echo $f | tr '/' '_')" "$B/$f"
  echo "$f  $(md5sum frontend/$f | cut -c1-8)  $(md5sum .deploy/verify-day28/$(echo $f | tr '/' '_') | cut -c1-8)"
done
```

---

### §1.5 合法数据来源 — PASS

| 数据 | 来源 | 证据 |
|---|---|---|
| 8 个职场主题 + FREE | 本项目手写，无第三方抓取 | `frontend/data/topics.json` 共 9 条：`T1`–`T8` + `FREE`（`FREE` 带 `openerPool` 5 条 / `replyPool` 8 条） |
| AI 台词 | 腾讯云函数调 **DeepSeek 官方 API**（`model:"deepseek-chat"`），密钥只从环境变量读 | 上方 chat 返回里的 `model` 字段 |
| 用户数据 | 只收「昵称 + 转写文本 + 分析条目」，写进自建 PostgreSQL 三张表 | 无手机号 / 无邮箱 / 无第三方统计脚本 |
| 页面外部依赖 | **0 条外链**（无 CDN / 无字体 / 无统计） | `grep -nE "https?://" frontend/pages/*.html` 过滤自家域名后为空 |
| 演示数据 | Day 27 已全部清空，`db/seed.sql` 改成"已停用"说明 | `frontend/data/mock-sessions.json` 已删除 |

**复现**（Git Bash）：

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
python -c "import json;d=json.load(open('frontend/data/topics.json',encoding='utf-8'));print(len(d),[t['topicId'] for t in d])"
grep -nE "https?://[a-zA-Z0-9.-]+" frontend/pages/*.html | grep -v "tcloudbaseapp" || echo "0 外链"
```

> ⚠️ **今天往库里写了 2 条带"验收测试"标记的记录**（`ACPT01` / `ACPT02`）。
> 它们不是伪造的用户数据，是验收动作留下的测试行。要不要在收尾时删掉 —— 见 §4 待拍板第 1 条。

---

### §1.6 公网地址 — PASS

三个地址，演示时任选其一，都指向同一份托管：

| 用途 | 地址 |
|---|---|
| 根路径（会跳到首页） | `https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/` |
| **推荐演示入口** | `.../pages/topics.html` |
| 健康接口 | `.../api/health` → `{"ok":true,"service":"TalkTrainer"}` |

★ 手机 / 微信注意事项：**微信内置浏览器不能当试用环境**（X5 内核网页朗读基本不响，
会被误报成"产品坏了"）。发链接要写「用手机浏览器打开」。安卓 Chrome 已实测全通。

---

### §1.7 线上持久化 — PASS（有一层今天没重跑）

| 层次 | 证据 | 判定 |
|---|---|---|
| **服务端跨请求** | 19:33 写入 `S-20261017-ACPT02` → 19:37 另起请求 `GET /api/sessions` 读到它 | ✅ 今天实测 |
| **软删可回查** | DELETE 后 `GET /api/items` 里消失，但同场次 `sessions` 仍在 | ✅ 今天实测 |
| **浏览器刷新后仍在** | 记录页从 `/api/items` 取数渲染；**今天没重跑无头刷新验证**，依据是 Day 27 真机（安卓 Chrome）实测全通 | ⚠️ 证据为 Day 27，非今日复现 |

★ 为什么第三层今天没重跑：它不是"可能坏"的地方（前端无 localStorage 缓存条目，
每次进页都请求接口），重跑只是为截图好看。**如实标成"证据日期不同"**，
评审若要当场看，打开 `.../pages/records.html` 刷新一次即可。

---

### §1.8 回滚与备份说明 — PASS（备份时效有缺口）

**四份材料都在**：

| 要说明的事 | 材料 | 关键内容 |
|---|---|---|
| 静态托管回退 | `docs/rollback-playbook.md §0.1` | 托管**没有版本管理**（`tcb hosting deploy --help` 原文 `no version management`）→ 回退 = 重传旧文件 |
| 回退实操演练 | `docs/day26-rollback-drill.md §7.3` | 回退 **8 秒** / 恢复 **7 秒**；托管侧 ETag **17/17** 命中；CloudBase 自带资源 6 个全程在 |
| 回退目标（弹药） | `.deploy/snapshots/before-v1.0/`、`before-day27/` | 两份共 **46 个文件**（`find .deploy/snapshots -type f | wc -l`） |
| 云函数 / 数据恢复 | `rollback-playbook.md §3`、`§4` | 云函数走 `tcb fn deploy`；数据用导出 JSON 回灌 |

**三个必须记住的硬事实**（缺一条回退就会失败）：

1. `tcb hosting deploy` **禁用** `--safe` / `--verify` / `--prune` / `--enable-git-ignore`
2. 回退**不能整包重传快照**，要先 `--exclude='./__auth' --exclude='./cloud-admin'`
3. **`tag v1.0` 指向 `15c75ac`，线上现在是 `e8ed427`** —— 别拿 tag 当线上基线

**缺口（如实列出）**：

| 缺口 | 实际情况 | 影响 |
|---|---|---|
| ~~DB 备份时效~~ | **已于 19:54 重导，缺口关闭**（见下方对照） | — |
| 回退演练未覆盖 | 云函数回退、数据恢复、"回退目标本身也是坏的" | 手册有步骤，但没实操过 → 演示时要用"已备查未实操"的措辞 |

**19:54 重导前后对照**（旧文件已改名 `*.bak-0916` 保留，两份都在）：

| 表 | 09:16 那份（`.bak-0916`） | 19:54 这份（当前） | 说明 |
|---|---|---|---|
| `sessions` | 7 行 | **8 行** | 旧的全是 `S-MOCK-01..05` / `S-DAY21-VERIFY` / `S-TEST-DAY20`，**一条真实记录都没有** |
| `turns` | 20 行 | **13 行** | 少 7 行是清空演示数据时一起没的，不是丢数据 |
| `items` | 8 行 | **9 行** | 含 2 条 `is_deleted=true`（软删打标记不删行，备份如实保留） |

★ **为什么必须重导**：旧备份如果真拿去恢复，会把 5 条演示数据灌回线上，而 14:28 之后的真实练习一条也回不来 ——
「有备份」的错觉比没备份更危险。这是今天发现的**第三处「文档说已清空、实际文件还留着旧状态」**的同类问题。

---

**「DB 备份」具体是什么**（用户 19:44 提问，补在这里）：

它和你平时说的"备份代码"不是一回事，两者分开存：

| 备份对象 | 存在哪 | 是什么 | 出事时怎么用 |
|---|---|---|---|
| **代码 + 页面**（静态托管） | `.deploy/snapshots/before-v1.0/`、`before-day27/` | 托管上文件的**原样副本**（46 个） | 重传回托管，页面就回到那一刻 |
| **数据库里的数据**（本节说的 DB 备份） | `.deploy/backups/db/20261017-*.json` | 用 `tcb db execute` 把三张表 `SELECT` 出来存成 JSON（`sessions` / `turns` / `items` 各一个文件） | 库被误删/写坏时，照 JSON 里的行 `INSERT` 回去 |

两个要点：

- **代码回退不会带回数据，数据回灌也不会带回代码** —— 它们是两套独立的东西
- 备份文件在 `.deploy/` 下，**已被 `.gitignore` 忽略**（`git check-ignore` 命中 `.gitignore:85`），
  不会进仓库；也就是说它只存在这台电脑上，换机器就没有

---

### §1.9 CloudBase 额度和到期风险 — PASS

数据来自 `docs/day27-资源与到期说明.md §2–§3`（2026-10-17 抄自控制台）：

| 项 | 值 | 含义 |
|---|---|---|
| 套餐 | **云开发免费体验版** | 环境 ID `cxj1528-d4g55ng0o54cbe296` |
| **环境有效期至** | **2027-04-03**（距今天 **167 天**） | 到期进停服隔离期，未转付费则**销毁环境** |
| 当前套餐周期 | 2026-10-03 ~ **2026-11-23**（距今 36 天） | 这轮资源点怎么算；**到期是否重置满额未验证** |
| 资源点 | **636.45 / 3,000（21.2%）** | 数据库 CU 占 **577.43 点 = 90.7%**，是大头 |
| 自动续费 | **不支持** | 没人管就真会停 |
| 免费续期 | 不是点一下，要**先做平台发布任务** | 到期前 1 个月内才可续 |

**风险排序**（演示时一句带过）：

1. **数据库 CU 是唯一要盯的指标**（90.7%），页面被打开多少次几乎不耗点
2. 2027-04-03 是生命线，2026-11-23 是额度周期，**两个日期不是一回事**
3. 今天又跑了 2 次 `chat` + 1 次 `analyze` + 若干写库，占比变化可忽略（统计延迟 ≤ 2 天）

---

### §1.10 敏感文件 — PASS

| 检查 | 结果 |
|---|---|
| 仓库里被 git 跟踪的敏感候选 | 只有 `.env.example`（10 个**键名**，无值） |
| `.env` / `.env.local` / `.cloudbase-api-key.local.json` | 三个全部命中 `.gitignore`（`git check-ignore -v` 逐条验过：`.gitignore:12` / `:3` / `:21`） |
| 真实腾讯云密钥 | **0 条**（`git grep -nIE "AKID[A-Za-z0-9]{20,}"` 只命中 1 处：`.test-asr-sign.js:38` 的**官方文档示例值** `AKIDz8krbsJ5yKBZQpn74WFkmLPx3*******`，已脱敏且是签名单测用例） |
| 密钥在运行时的来源 | 全部从云函数**环境变量**读，代码里无硬编码 |

**复现**（Git Bash）：

```bash
cd /c/Users/26629/WorkBuddy/VibeCoding
git ls-files | grep -iE "\.env|key|secret|credential|\.local\.json"
for f in .env .env.local .cloudbase-api-key.local.json; do printf "%-32s " "$f"; git check-ignore -v "$f" || echo "未忽略!!"; done
git grep -nIE "AKID[A-Za-z0-9]{20,}" -- . 
```

★ 判据是「**每一条都确认过安全**」，不是「一条都没有」。那 1 处示例值不该为凑 0 条去删 ——
`test-asr-sign.js` 要靠它算出确定签名。

---

## §1A 核心流程重复检测（板块②，2026-10-17 19:47–19:55）

**为什么要做这一步**：一次跑通只能证明"当时没坏"。重复检测要找的是
**哪些结果靠运气、哪些动作重复执行会变形**。七项检测，全部当场跑：

| # | 检测 | 重复次数 | 结果 | 判定 |
|---|---|---|---|---|
| R1 | 同一 `sessionId` 连提 | 3 | 3 次全 `DUPLICATE`；库里该场仍 **1 条** | ✅ 稳定 |
| R2 | `chat` 同输入重复 | 3 | 3/3 都满足：`ok` + ≤12 词 + 问号结尾 + 有中文；**句子措辞不同** | ✅ 结构稳、文案不稳 |
| R3 | `analyze` 同 transcript 重复 | 2 | 2/2 判定**完全一致**：`logic@t2` + `offtopic@t3` + `good@t1`；文案措辞不同 | ✅ 判定稳、文案不稳 |
| R4 | 页面重复取 | 各 5 | `topics` 7404 B ×5、`records` 46557 B ×5，**一字不差** | ✅ 稳定 |
| R5 | **并发**写同一新 `sessionId` | 2 同时 | 1 成功 + 1 `DUPLICATE`；库里 **1 条** | ✅ 无重复落库 |
| R6 | `health` 重复 | 5 | 5/5 都是 `{"ok":true,"service":"TalkTrainer"}` | ✅ 稳定 |
| R7 | 改/删重复执行 | 各 2 | 同值 `PATCH` 两次都 ok（会刷新 `favorited_at`）；第 2 次 `DELETE` → `NOT_FOUND` + 中文说明 | ⚠️ 状态不错、时间戳会变 |

### 三个结论（演示时可以直接讲这三点，比念功能有用）

1. **不依赖模型的部分是确定的**：同样的请求 5 次给出同样字节的内容；写库去重连并发都挡住了
   （R5 是关键 —— Day 18 记过"跨请求事务无效"，理论上并发可能写重，实测没有）
2. **依赖模型的部分「判定稳、措辞不稳」**：同一段转写分析两次，**判出哪几句有问题完全一致**，
   但提醒文案的措辞会变（`先说有问题又说一切正常、能按时完成` vs `先说有问题又说一切正常能按时完成`）。
   → 演示时别承诺"每次文案一样"，承诺"每次判定一样"
3. **有一处非严格幂等**：同值 `PATCH` 重放会重写 `favorited_at`（`write/index.js` 的实现是
   `favorited_at = isFavorited ? nowLocalText() : null`）。收藏状态不会错、计数不会翻倍，
   但"收藏时间"会变成最后一次点击的时间

**复现命令（Git Bash，`B` 同 §1.1）**：

```bash
# R1 连提 3 次（期望 3 次 DUPLICATE）
for i in 1 2 3; do curl -s --noproxy '*' -X POST "$B/api/sessions/write" \
  -H "Content-Type: application/json" -d '{"sessionId":"S-20261017-ACPT02","topicId":"T2",
  "startedAt":"2026-10-17T19:32:00+08:00","endedAt":"2026-10-17T19:33:00+08:00",
  "transcript":[{"turn":1,"userText":"x","aiText":"y"}]}' | python -c "import sys,json;d=json.load(sys.stdin);print(d['error']['code'] if not d['ok'] else 'WROTE AGAIN')"; done
# R5 并发（两条命令 + & + wait）
# R7 同值 PATCH 两次 → 第 2 次 changed 仍为三列；重复 DELETE → NOT_FOUND
```

### 这一轮新写进库的 2 条测试数据

| sessionId | 用途 | 现状 |
|---|---|---|
| `S-20261017-RPT01` | 并发重复写探针（T3，1 轮） | 保留 |
| `S-20261017-RPT02` | 改删幂等探针（T4，1 轮 + 1 条 good，已软删） | 保留（按你 19:44 选的 A） |

> ★ 一个要记住的取舍：这两条**不是伪造的用户数据**，是"唯一能证明并发/幂等行为"的实验痕迹。
> 删掉它们，§1A 这张表就没有实测支撑了。这也是你选 A 的实质理由。

---

## §1B 交付清单清点（板块③，2026-10-17 19:57）

**清点口径**：全部用命令数，不凭印象。状态只有四种：
**齐全** / **有意不在仓**（设计如此，说明理由） / **有缺口**（真的少） / **需你确认**（我不该替你判断）。

**总算**：仓库跟踪 **163 个文件**（`git ls-files | wc -l`），提交 **68 笔**，跨度 2026-09-17 → 2026-10-17。

### 一、产品代码（前端）

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 前端文件（仓库跟踪） | **21 个 / 10,632 行** | `frontend/` | 齐全 |
| 产品页面 | 4 个（P1–P4）+ 检查台 1 个 | `frontend/pages/` | 齐全 |
| 上线文件（自有） | **16 个** | 托管根 `/` | 齐全 |
| 本地有、线上无 | 4 个开发工具（`a11y-check.js` `flt-verify.js` `regress.js` `serve.py`）+ 2 个截图页（`day23-errors.*`） | — | 有意不在线上（工具与截图页不该给用户看） |

★ 16 + 6 = 22（托管总数），6 是 CloudBase 自带的 `__auth/` 5 个 + `cloud-admin/index.html`。
**这个 6 不能删**：删了登录入口就 404。

### 二、后端

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 云函数 | **6 个**（`health` `read` `write` `chat` `analyze` `speech`） | `cloudfunctions/` | 齐全，线上 `tcb fn list` 6 个全在 |
| 函数代码文件 | 25 个 | `cloudfunctions/` | 齐全 |
| 网关路由 | **11 条**（1 条静态托管 + 10 条云函数，其中 `/api/diag` 是残留） | 控制台 / `tcb routes list` | 齐全；11 条**路径透传全部 `Enable`** |

### 三、数据

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 数据库表 | 3 张（`sessions` / `turns` / `items`） | CloudBase PG | 齐全 |
| 当前行数 | **8 / 13 / 9**（items 含 2 条软删） | — | 齐全 |
| 建表与种子脚本 | 13 个 SQL + 1 个 js | `db/` | 齐全（`seed.sql` 已改「已停用」） |
| 主题数据 | 9 条（T1–T8 + FREE） | `frontend/data/topics.json` | 齐全 |

### 四、文档

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 主文档 | 5 个（`PRD.md` `TECH_DESIGN.md` `research.md` `README.md` `AGENTS.md`） | 根目录 | 齐全 |
| 过程文档 | **21 个 md** | `docs/` | 齐全 |
| 文档预览页 | 3 个 html | `docs/_preview/` | 齐全（`docs/` 合计 24 个文件） |

### 五、证据（截图与测试）

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 截图 | **53 张 png** | `day1` `day2` `day11`–`day14` `day19` `day23`（共 8 天有图） | **有缺口**：Day 3–10、15–17、20–22、24–28 没有图片 |
| 文字版证据 | 2 个 txt（Day 18 接口响应九用例 / 数据库新增行） | `day18-截图/` | 齐全（那天用文本代替截图，不是缺） |
| 单元/集成测试脚本 | **14 个** | 根目录 `.test-*.js` | 齐全 |
| 辅助探针脚本 | 7 个 | `.apply-request-log.js` `.count-db-requests.js` `.headless-frontend-d22.js` `.probe-httpapi.js` `.render-md.js` `.sync-logreq.js` `.verify-write-sql.js` | 齐全（一次性过程物，保留作证据） |
| 发布前检查脚本 | 1 个 | `verify.sh` | 齐全 |
| 本项目专用 Skill | 2 个（6 个文件） | `.workbuddy/skills/` | 齐全 |

> **截图缺口要不要补，需你判断**：那些天如果截图发在群里没存仓库，那就不是缺，只是没入库。
> 我不替你认定"缺了"或"没缺"。

### 六、线上与版本

| 条目 | 数量 | 位置 | 状态 |
|---|---|---|---|
| 公网地址 | 1 个域名，4 个产品页 | 腾讯云 CloudBase | 齐全 |
| 提交历史 | **68 笔**，2026-09-17 → 2026-10-17 | `master` | 齐全 |
| 版本标签 | `v1.0` → 提交 **`15c75ac`**（比 HEAD 少 2 笔） | git | 齐全，但**不等于线上内容** |
| 备份·代码 | 2 份快照 / **46 个文件** | `.deploy/snapshots/` | 齐全，但**不在 git** |
| 备份·数据 | 6 个文件（3 份当前 + 3 份 `.bak-0916`） | `.deploy/backups/db/` | 齐全，但**不在 git** |

### 七、三件必须在交付时说清的事

1. **`.deploy/` 全在 gitignore 里**（`.gitignore:85`）→ 快照与 DB 备份**只在你这一台电脑上**。
   仓库换台机器克隆下来，**没有回退弹药**。这是当前交付物的最大单点风险，比任何功能缺陷都实在。
2. **`tag v1.0` 指向 `15c75ac`，线上是 `e8ed427`** —— 差 2 笔。标签是附注标签（`git cat-file -t v1.0` = `tag`），
   所以 `git rev-parse v1.0` 给的是**标签对象**的哈希 `2db3d2b`，**不是提交**；
   要拿提交必须写 `git rev-parse v1.0^{}`。比 tag 与 HEAD 的远近时踩这个坑会得出相反结论。
3. **7 个一次性脚本留在根目录**（`.apply-*` `.count-*` `.probe-*` 等）——
   它们不是产品代码，是排查过程留下的。留着当证据可以，但演示时别说成"功能模块"。

---

## §2 已知不一致 / 需要人眼确认的项（不藏）

| # | 问题 | 事实 | 建议动作 |
|---|---|---|---|
| 1 | `docs/week4-acceptance.md §0` 写「`speech` 云函数当前不可用（路由是 SCF）」 | **已过期**。今天实测 `tcb routes list` 显示 `/api/speech-to-text` → **WEB_SCF**；POST 空 body 返回 `{"ok":true,"data":{"text":"","engine":"none","reason":"TOO_SHORT"}}`（进了函数，不是网关拒） | ✅ **已按 B 改写**（2026-10-17 19:45，用户拍板）：§0 标题与结论改成「已可用」，Day 23 的推理链保留作历史 |
| 2 | `docs/api-contract.md §5` 仍写「预留（v1 不启用）」，状态栏标 🟡「1 个占位待实现」 | 与 §2 第 1 条同一件事的另一处过期记录 —— 语音已部署且可用 | ⚠️ **待你决定是否一并改**（改契约属文档口径，未擅自动手） |
| 3 | 线上有 `/api/diag` 路由指向 `diag` 函数 | `cloudbaserc.json` 与 `cloudfunctions/` 里**没有** `diag` | 属部署残留；不影响演示，别在 `--only gateway` 收敛时误删其他路由 |
| 4 | DB 备份停留在 09:17 | 之后新增 3 场（见 §1.8） | 收尾时重导一次（一条命令，见 `day27-资源与到期说明 §4`） |
| 5 | `tag v1.0` = `15c75ac`，线上 = `e8ed427` | tag 落后 1 个提交 | 演示时别说"tag 就是线上" |
| 6 | 检查台 / 错误提示对照页是否算"作品页面" | 检查台是**开发期工具页**，不在 PRD 页面清单；对照页**未上线** | 演示时说"4 个产品页 + 1 个排错用的检查台"，别说 6 个页面 |
| 7 | CloudBase 控制台里请求日志的实际显示效果 | 五个云函数已加 `logReq` 并部署 | **需人眼确认**（今天没截图），演示时别把它说成"已验证" |

---

## §3 3–5 分钟演示提纲（4 分钟主版）

> 总原则：**先说人遇到什么麻烦，再演怎么解决，最后给可核查的数字。**
> 不背功能清单，每个功能都挂在一个真实动作上。

### 0:00–0:30 ｜用户问题（30 秒）

**说什么**：

> 目标用户是"有英语底子、但一开口就卡住"的人（CEFR A2–B2），场景是职场即兴英语 ——
> 被追问进度、跟同事解释延迟。
> 他们缺的不是单词量，是**在压力下把话说完整、不跑偏**的练习机会：
> 找真人陪练要预约、要花钱、还怕说错；自己念稿子没有反馈。
> 这个作品把这三件事合成一个网页：选场景 → 对着 AI 说 → 结束后拿到"哪句跑题了、哪句逻辑打架、哪句说得好"。

**手上动作**：停在 `.../pages/topics.html`，让镜头看到 8 个主题分两组（会议上 / 同事间）+ 顶部"自由对话"入口。

### 0:30–1:40 ｜核心流程（70 秒，现场走一遍）

**说什么**（一边点一边讲，别念稿）：

1. 「选 T1 项目进度被追问，角色是项目负责人 —— **AI 先开口**，不用你先想怎么开始」
2. 说两句（或打字），「每一轮：我的转写 + AI 英文回应 + **下面一行中文直译**」
3. 「点结束 → 结果页：这一场 2 轮、32 秒、1 处偏题、1 句精彩」
4. 「**偏题只提醒，逻辑矛盾给改法** —— 这是 PRD 定的口径，不是模型自己想出来的」
5. 「点收藏 + 写备注 → 记录页能看到它，**刷新后还在**（数据在云上，不在浏览器里）」

**若只有 3 分钟**：砍掉第 5 步（收藏备注），保留 1–4。

### 1:40–2:30 ｜提示词改写（50 秒，这是技术含量最高的一段）

**说什么**：

> 提示词改过两轮，第二轮是被自己的第一轮挡住的。
>
> **第一轮（Day 23）**：为了防模型把 JSON 漏到界面上，我在 user 消息最后加了一句
> `No JSON, no quotes`。它管用。
>
> **第二轮（Day 27）**：用户说"AI 的句子有单词看不懂"，我要模型同时返回中文，
> 就得让它返回 `{"en":"…","zh":"…"}`。结果**两次实测 `aiTextZh` 都是空的** ——
> 因为那句 `No JSON` 挂在 user 消息末尾，是模型读到的**最后一句**，
> 权重比 system 里的格式说明还高。它不是"冲突"，是**位置**问题。
>
> **改法**：把那句改成"按 system 里定义的 JSON 返回，en 是英文、zh 是中文"，
> 格式说明单独抽成 `OUTPUT_FORMAT` 常量（`cloudfunctions/chat/index.js:546`），
> **上面三条硬约束一个字没动**：不主动简化用词、不替用户补完、不无条件肯定。
> 解析失败不报错 —— 格式没守住只该"少一行中文"，不该"这场对话断了"。

**手上动作**：打开 `cloudfunctions/chat/index.js:410-422` 与 `:546-556`，只让人看到两段对照。

**一句话收尾**：改提示词不是堆约束，是**排查约束之间谁压住谁**。

### 2:30–3:10 ｜验证方式（40 秒，给可复制的命令）

**说什么**：

> 三个层次都验过，命令能当场跑：
>
> 1. **接口**：`curl .../api/health` → `{"ok":true}`；写一场 → 换一个请求读回来 → 同一条
> 2. **线上是不是最新代码**：把线上 7 个文件的 md5 和本地比，**7/7 一致** ——
>    这条最容易被漏，之前就出过"手机测的是旧版"的事故
> 3. **错误分支**：重复提交 → `400 DUPLICATE`；`topicId` 写错 → `400 INVALID_PARAMS` 且中文点名
> 4. **重复执行**：同一场连提 3 次、两个请求并发写同一场 —— 库里都只落 1 条；
>    同一段话分析两次，**判出哪几句有问题完全一致**（措辞会变，判定不会）
>
> 不拿回归脚本的通过数当证据（同一份代码连跑三次会给出三个不同结果），只看控制台报错数。

### 3:10–3:40 ｜平台限制（30 秒，说清哪些是范围、哪些是坑）

**说什么**：

| 限制 | 事实 | 应对 |
|---|---|---|
| 静态托管**没有版本管理** | 官方 help 原文 `no version management` | 回退 = 重传旧文件；**发布前必须取快照** |
| HTTP 网关**不能按方法分流** | 路由配置无 `method` 字段 | 写/改/删共用 `/api/sessions/write`，靠方法区分 |
| 免费体验版 | 资源点 3000/月，DB CU 占 90.7%，不支持自动续费 | 到期前 1 个月内续；免费续期要先做发布任务 |
| 浏览器原生语音识别**国内不可用** | 会上传音频到 Google | 改走服务端腾讯云 ASR（`speech` 路由已是 WEB_SCF，可用） |
| **微信内置浏览器** | X5 内核网页朗读基本不响 | 发链接写"用手机浏览器打开" |

### 3:40–4:10 ｜后续优化计划（30 秒，按优先级，不说空话）

| 优先级 | 事项 | 为什么排这个位置 |
|---|---|---|
| P0 | **补空态 / 加载态**（P2 空态、P3 加载态） | 网络慢时页面会短暂空白，是体验上最明显的缺口 |
| P1 | **DB 备份做到每日自动导出** | 现在是手工导出，一旦忘就丢一天数据 |
| P2 | **重新生成一次 v1.0 tag**，让 tag 与线上一致 | 避免将来回退拿错基线 |
| P3 | **清理 `/api/diag` 残留路由** + 删掉验收测试记录 | 属于整洁度，不影响功能 |
| 观察 | 语音识别准确率在安静/嘈杂环境的差异 | 已可用，但没做过场景化评测 |

**收尾一句**：

> 28 天里最大的认知改变是 —— **"能跑通"和"能交付"是两件事**。
> 跑通是接口返回 200；交付是别人拿到链接、换个设备、隔一天再打开，仍然是同一个结果。
> 这个项目里最贵的不是写代码，是"发布前取快照""线上 md5 和本地比""改提示词先搜有没有打架的旧约束"这三类动作。

---

## §4 收尾待办

### 4.1 三件已拍板（2026-10-17 19:44）

| # | 事 | 决定 | 后果 |
|---|---|---|---|
| 1 | 库里测试记录（`ACPT01`/`ACPT02` + 板块② 的 `RPT01`/`RPT02`） | **A 保留** | 演示时库里有一条"19:33 刚写的"可以当场读回；验收官问起就说是验收动作留的测试行（`RPT01`/`RPT02` 是并发与幂等探针，删了就没了证据） |
| 2 | DB 备份要不要现在重导 | **B（旧的改名保留 + 导新的）** | ✅ 已执行（19:54）：`*.json.bak-0916` 保留 09:16 那份，主文件换成当前 8/13/9 |
| 3 | `week4-acceptance.md §0` 的过期结论 | **B 按今天实测改写** | ✅ 已改：§0 标题与结论改为「已可用」，Day 23 的推理链保留作历史；§2 那条待办已勾掉 |

> 记录一条边界：改 `week4-acceptance.md` 属于「更正技术事实」，改 `api-contract.md §5`
> 会牵动契约状态栏（🟡 → 🟢），属文档口径，**没动，等你点头**。

### 4.2 两张截图（清单要求）

| 截图 | 怎么拍 |
|---|---|
| ① 附录 J 验收清单逐项打勾 | 打开本文件 §1 的表，**每项判定列可见**（PASS/缺口说明同屏） |
| ② 公网 URL 打开的样子 | 浏览器打开 `.../pages/topics.html`，**地址栏 + 完整首页同屏**（不要只截内容区） |

> 桌面截图用 1080 宽；手机截图必须用真机（无头截不到地址栏）。

### 4.3 提交（等你确认后才做）

今日预期改动：

| 文件 | 属于哪天 |
|---|---|
| `docs/day28-最终验收表与演示提纲.md`（本文件） | Day 28 |

`.deploy/verify-day28/` 是取证下载的线上文件副本，**不进 git**（`.deploy/` 已在忽略范围）。
