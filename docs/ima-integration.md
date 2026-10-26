# ima 知识库接入 · 需求澄清与可行性结论

> 日期：2026-10-17 20:48–21:11
> 状态：**需求已澄清、可行性已查证，用户决定暂缓**。本文写作时**没有任何代码改动**，也没有动 `PRD.md` / `TECH_DESIGN.md`。
> 用途：下次捡起这件事时的唯一起点 —— 已定什么、被什么挡住、代码改哪儿、还差哪几个决定。
> 口径：本文只记录"接 ima"这一件事。产品决策归 `PRD.md`，实现方案归 `TECH_DESIGN.md`，调研来源见 §7。

---

## §0 需求原文（用户口述，不改写）

> 我想要用户的每一次与ai的对话可以完整存储进ima知识库，方便查看，精进，用户自己也可以设置资料，ai的free talk板块可以提取知识库中用户专门存储的资料进行相关提问，表达想法

拆成三句话就是：**完整存档** + **用户自己放资料** + **FREE talk 从资料里取材提问**。

---

## §1 已定（用户拍板，不再讨论）

| # | 决定 | 影响 |
|---|---|---|
| 1 | 每次练习**完整**存进 ima，供查看、精进 | 需要写接口；且"完整"包含 AI 那句的中文直译（见 §4.2） |
| 2 | 用户自己往知识库放资料 | 需要读接口 + 让用户指定"哪个库是素材库" |
| 3 | **FREE talk** 提取这些资料，用来提问、引出表达 | 检索发生在 `chat` 链路，不在 `analyze` 链路 |
| 4 | 凭证模型 = **完整 BYOK**：每个用户自带 `client_id` / `api_key` | 现阶段唯一能"各自存自己库"的形态（原因见 §2）。★ 这否掉了「只做只读」的折中方案 |

★ 第 4 条是被第 1 条逼出来的：既然要写进用户自己的库，凭证就必须属于用户本人，没有第二条路。

---

## §2 硬约束（三条会挡路的，都是查证结果，不是推测）

### 2.1 ima 没有对外开放"终端用户授权"的 OAuth

| 通道 | 地址 | 鉴权 | 谁能用 |
|---|---|---|---|
| MCP | `https://ima.qq.com/mcp` | `mcp-oauth` Bearer | **agent 宿主**（WorkBuddy 等）。本机连接器配置里写死 `from_connector: ima-mcp`，`visible_in` 也只有宿主环境 |
| OpenAPI | `https://ima.qq.com/openapi/note/v1/…`、`/openapi/wiki/v1/…` | Header `ima-openapi-clientid` + `ima-openapi-apikey` | 谁申请谁用，**一套凭证 = 一个 ima 账号** |

**后果**：做不到"用户在网页里点一下、OAuth 授权、我们就代他读写"。只能做成：用户自己打开 `https://ima.qq.com/agent-interface` → 拿到 Client ID / API Key → 粘贴到我们的页面。这是**开发者级操作**，普通用户走不完。

社区里唯一跑通过的多用户方案（§7 第 2 条）用的也是这个办法：**请求头透传用户自己的凭证、服务器零存储、`client_id` 白名单准入**。它的 README 明说 ima 的笔记/知识库能力"原本只能单人单实例使用"。

### 2.2 没有 `create_knowledge_base` 接口

程序建不了知识库。只有 `get_addable_knowledge_base_list`（列出可添加内容的库）。所以"注册即自动开通个人知识库"做不到，必须让用户**先在 ima 里手动建库**，再回来选。

### 2.3 检索没有类型过滤

`search_knowledge` 只接受 `knowledge_base_id` + `query` + `cursor` + `limit`，**没有按类型、按文件夹、按时间过滤的参数**。

**后果**：练习记录和用户资料混在同一个库里，检索时历史对话会大量命中——那里面全是英语对话，关键词密度比资料还高——真正想要的资料被挤掉。分隔必须做在**库**这一级，做在文件夹里没用（分隔写在写入侧，限制不了读取侧）。

### 2.4 另外两条要知道的
- `API Key` 会过期、可重置；`client_id` 才是稳定身份标识 → 做白名单、做用户身份都该用 `client_id`。
- 凭证在浏览器里**不能直连** ima（跨域 + 密钥暴露），必须过我们自己的云函数转发。于是"密钥存哪"成了新问题：存 localStorage → 换设备就没了；存 CloudBase → 我们要替别人保管密钥。

---

## §3 接口能力清单

| 线 | 接口 | 作用 |
|---|---|---|
| 笔记 `openapi/note/v1/` | `import_doc` | 用 Markdown 创建一篇笔记 → 拿到 `doc_id` |
| | `append_doc` | 往已有笔记追加内容 |
| | `get_doc_content` | 读笔记正文（纯文本 / JSON） |
| | `search_note` / `list_note` / `list_notebook` | 搜笔记 / 列笔记 / 列笔记本 |
| 知识库 `openapi/wiki/v1/` | `search_knowledge_base` | 按名称搜库 → 拿 `kb_id` |
| | `get_addable_knowledge_base_list` | 列出可往里加内容的库 |
| | `search_knowledge` | 在指定 `kb_id` 内检索 |
| | `add_knowledge` | 把笔记 / 网页 / 文件加进知识库 |
| | `create_media` | 上传前置：创建媒体记录、拿 COS 凭证 |
| | `import_urls` | 批量导入网页 |
| | `check_repeated_names` | 上传前重名检查 |
| | `get_knowledge_list` / `get_knowledge_base` | 浏览目录 / 按 ID 批量取信息 |
| | `create_folder` / `move_knowledge` | ⚠️ 社区文档标"未完整确认"，别当稳定能力用 |

**读是两步**：`search_knowledge_base` 拿 `kb_id` → `search_knowledge` 检索。没有"跨全库一次搜"的接口。

**写是两步**：`import_doc` 建笔记拿 `doc_id` → `add_knowledge` 挂进目标库；中间建议先 `check_repeated_names` 防重名。

---

## §4 代码落点（已查实，含行号）

### 4.1 写入时机有现成的位置

`frontend/pages/result.html:385` 的 `saveSessionToDb(issues, goods)` 是全项目**唯一的写库点**，TOPIC 和 FREE 都经过它——FREE 只影响文案和"丢弃 offtopic"的规则（`result.html:144` 的 `isFree`），不影响是否走这个函数。

调接口在 `result.html:405`（`window.Api.writeSession`），那一刻手上已经齐了：

| 数据 | 来源 | 内容 |
|---|---|---|
| 整场转写 | `pending.transcript`（`result.html:414-416` 取用） | `turn` / `userText` / `aiText` |
| 分析条目 | `issues.concat(goods)`（`result.html:420-427`） | `type` / `reminder` / `correction` |
| 时间 | URL 的 `start` / `end`（`result.html:392-393`） | 时长由后端算，与屏幕显示自洽 |
| 场次号 | `SAVED_ID`（`result.html:402`） | `S-YYYYMMDDhhmmss-xxxx` |

### 4.2 ★ "完整对话"现在并不完整

`aiTextZh`（AI 那句的中文直译，Day 27 加的）**从来没进过转写**，断在两处：

1. `frontend/pages/dialogue.html:552`：`transcript.push({ who: who, text: text })` —— `appendLine(who, text, zh)`（`:546`）收了第三个参数 `zh`，但只拿去渲染气泡，没进数组。
2. `frontend/pages/dialogue.html:801` / `:804`：`transcriptTurns()` 建对象时只给 `turn` / `userText` / `aiText` 三个字段，取 AI 那句时只读 `it.text`。

**所以"存英中对照"的前提是先改对话页补字段，不是只改结果页。** 另外降级路径（`chat` 没返回 `aiTextZh` 时）本来就没有这个值，补了也要容忍空串。

★ 补字段的连带风险：`transcriptTurns()` 有两个消费方——`historyForApi()`（`dialogue.html:762`，取最后 6 轮发给 `chat`）和整场交给 `analyze`（`dialogue.html:1476`）。加 `zh` 字段后要确认 `chat` 云函数不会把它拼进 prompt（否则白烧 token，还诱导模型中英混排）。

### 4.3 需要新增的东西（现在没有）

| 缺口 | 为什么必须有 |
|---|---|
| `sessionId ↔ doc_id` 的映射 | 想"追加到一篇总账"就必须知道上次那篇是哪篇。现在 `sessions` 表没这个字段 |
| 用户凭证的存放位置 | 存浏览器 / 存 CloudBase，各有代价，见 §2.4 |
| "哪个库是素材库 / 哪个是复盘库"的用户设置 | 见 §2.3，库这一级是唯一有效的分隔 |
| 一个凭证引导页 | 用户要去 `agent-interface` 申请，得有人一步步带他做 |

---

## §5 未决问题（按依赖顺序，下次从这里接着问）

> 下面每条都附了**我当时的推荐**——只是推荐，不是既成决定。

**① 练习记录和素材，一个库还是两个库？**
- 一个库：配置最省事，但检索被历史对话污染（§2.3）。
- 两个库：素材库只读 + 复盘库只写，检索干净；代价是用户要手动建两个库，引导页多一步。
- ★ 推荐两个库。理由：文件夹分隔在这个接口上无效，而库是唯一能分隔的层级。

**② 一次练习存一篇笔记，还是所有练习追加成一篇总账？**
- 一篇一篇：结构清晰，但笔记数会随练习次数线性膨胀，把 ima 笔记列表冲垮。
- 追加总账：列表干净，但需要 §4.3 的 `doc_id` 映射，且单篇会越来越长（`append_doc` 的单篇上限没查）。
- ★ 倾向：按"一次练习一篇"存，但用命名前缀（如 `[练习复盘] 2026-10-17 T1`）让它可批量检索；如果笔记膨胀真的成了问题，再改成按月总账。

**③ FREE talk 的检索 query 从哪来？**
- FREE 没有主题卡、没有 `followUps`，天然没有关键词。
- 可选：开局面用固定 query 检索一次（如"工作 沟通 会议"）、让用户手动指定"这次用哪份资料"、或从用户上一轮说的话里提关键词。
- ★ 这条没想清楚之前，FREE 的"取材"做出来大概率是随机的。

---

## §6 如果要动手：必须按这个顺序解决

不是计划，是依赖关系——前一步没定，后一步写出来就要返工。

```
① 凭证怎么到用户手里（引导页 + 存放位置）
      ↓
② 库怎么分（一个 / 两个；谁建、怎么选）
      ↓
③ 补 aiTextZh 进转写（dialogue.html:552 与 :801/:804）
      ↓
④ 写：result.html 的 saveSessionToDb 里加一次 ima 写入（异步、失败不阻塞看结果）
      ↓
⑤ 读：chat 链路里注入素材（③ 之外唯一要动云函数的地方）
```

★ ④ 和 ⑤ 都可以在 ① ② 未定时先用**你自己的凭证**跑通打通，但那只验证了"接口能通"，验证不了"别人能不能用"——而后者才是这件事的真问题。

---

## §7 参考来源

| # | 来源 | 用来确认什么 | 采集日期 |
|---|---|---|---|
| 1 | ima 官方 wiki：MCP 与 OpenAPI 接入对照指南（`ima.qq.com/wiki/`） | 三条通道的存在与鉴权方式；OpenAPI 走 `/openapi/wiki/v1/` + 双 Header | 2026-09-23 实测 |
| 2 | `waityou-love/ima-mcp-server` README（himcp.ai / glama.ai 镜像） | 社区唯一的多用户实现方式 = 请求头透传凭证 + 零存储 + `client_id` 白名单；"原本只能单人单实例" | 2026-10-17 |
| 3 | `EdwardWason/web-to-FIM` 的 `references/ima-setup.md`（IMA OpenAPI v1.1.7） | 笔记线 / 知识库线的接口清单与端点路径 | 2026-10-17 |
| 4 | ima 官方 wiki："API 接入思路与排错"、进阶篇接口全景 | 基础地址、统一响应格式 `{code,msg,data,request_id}`、`search_knowledge` 参数 | 2026-10-17 |

★ 以上都是**公开文档 + 社区实现**，没有一条来自我实际调通 ima 的请求。真正接的时候，第一条要验的就是"拿一对真实凭证，`search_knowledge_base` 能不能返回 `kb_id`"。
