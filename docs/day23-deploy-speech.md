# 语音识别部署 · 照着做（Day 23）

> 全程约 20 分钟。做完这一步，语音才能真正用上。
> 详细说明在本文档后面，这里是要你照着点的清单。

---

## 四个网址

| # | 用途 | 网址 |
|---|---|---|
| 1 | 开腾讯云语音识别 | `https://console.cloud.tencent.com/asr` |
| 2 | 拿 SecretId / SecretKey | `https://console.cloud.tencent.com/cam/capi` |
| 3 | 拿 AppId | `https://console.cloud.tencent.com/developer` |
| 4 | CloudBase 控制台（部署 + 配环境变量 + 加路由） | `https://console.cloud.tencent.com/tcb/env/index?envId=cxj1528-d4g55ng0o54cbe296` |

---

## 第1 步 · 开腾讯云语音识别 + 拿三样东西

### 1.1 开通服务

打开 `https://console.cloud.tencent.com/asr` → 点「**立即开通**」

> 个人认证就能开，**免费额度足够用**（一句话识别约几分之一厘，一天几百句也就几毛钱）

### 1.2 拿 SecretId + SecretKey

打开 `https://console.cloud.tencent.com/cam/capi` → 「新建密钥」→ 复制这两项

```
SecretId     AKIDxxxxxxxxxxxxxxxx
SecretKey    xxxxxxxxxxxxxxxxxxxx
```

⚠️ **SecretKey 只显示一次**，当场复制下来。这两个值不要发给我、不要写进代码。

### 1.3 拿 AppId（最容易漏的一项）

打开 `https://console.cloud.tencent.com/developer` → 右上角账号信息 → 找到「**AppId**」

```
AppId       13xxxxxxxxx
```

★ **AppId 不在密钥页**，在账号信息页。这一处最容易漏，漏了接口会报 `ASR_NOT_CONFIGURED`。

**三样都拿到了吗？** SecretId / SecretKey / AppId。

---

## 第 2 步 · 部署 speech 云函数

### 2.1 部署代码（终端里跑）

⚠️ **是 `tcb fn deploy`，不是 `tcb fn code update`** —— `speech` 是**新建**的函数，
第一次必须用 `deploy`。它现在还没有环境变量，所以不存在清空的风险。

```powershell
cd C:/Users/26629/WorkBuddy/VibeCoding
tcb fn deploy speech
```

Git Bash 用户加前缀（路径含 `C:` 时需要）：
```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
MSYS_NO_PATHCONV=1 tcb fn deploy speech
```

等 10–30 秒。

> 如果这步报错，**改用控制台新建**：函数类型选 **HTTP**、
> 运行时 **Nodejs20.19**、超时 **30 秒**、内存 **256MB**，
> 然后把 `cloudfunctions/speech/` 整个目录压缩上传。

### 2.2 配三个环境变量

回到 CloudBase 控制台（第 4 个网址）→ 左侧「云函数」→ 点进 **`speech`**
→ 「函数配置」→「环境变量」→ 「添加」，加这三个：

| 键名 | 值 |
|---|---|
| `ASR_SECRET_ID` | 第 1.2 步的 SecretId |
| `ASR_SECRET_KEY` | 第 1.2 步的 SecretKey |
| `ASR_APPID` | 第 1.3 步的 AppId |

⚠️ **三个一个都不能少**。少任何一个，接口返回 `ASR_NOT_CONFIGURED`。

### 2.3 加网关路由（⚠️ 只能去控制台加）

同一页面 → 左侧「API 网关」→「路由管理」→「新建路由」：

| 项 | 填什么 |
|---|---|
| 路径 | `/api/speech-to-text` |
| 方法 | **不限**（或 POST）|
| 目标 | 云函数 → `speech` |
| **是否透传路径** | **开**（enablePathTransmission）|

★ **`tcb routes add` 在这个项目上无效** ——
它报 `domain ... is a system internal domain`。
CLI 那条路走不通，必须用控制台。

★ **路径必须排在 `/api` 那条路由前面。** `/api` 是给 health 用的兜底，
排在它后面的话请求会被 health 接走，症状是页面说「语音接口还没部署好」。

---

## 第 3 步 · 重新部署静态托管（前端代码）

```powershell
cd C:/Users/26629/WorkBuddy/VibeCoding
tcb hosting deploy ".deploy/hosting" /
```

⚠️ **PowerShell 不要加 `MSYS_NO_PATHCONV=1`**（那条是给 Git Bash 用的）。

---

## 第 4 步 · 验证（逐层排除，别跳）

### 层 1 · 云函数活着吗

```powershell
curl -s -X POST "https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/api/speech-to-text" -H "Content-Type: audio/wav" --data-binary "@C:/Users/26629/WorkBuddy/VibeCoding/.workbuddy/tmp/probe.wav"
```

> 没有 probe.wav 就先随便放一个 wav 进去也行 —— 这一层只验「通不通」，不验识别准不准。

| 返回 | 说明 |
|---|---|
| `{"ok":true,...}` | ✅ 通了 |
| `ASR_NOT_CONFIGURED` | ❌ 环境变量没配好 → 回 2.2 |
| 一段 HTML / `NOT_FOUND` | ❌ 网关路由没加 → 回 2.3 |

### 层 2 · 真能转写吗

录一句英语存成 `.wav`（Windows「录音机」就能录），放到
`C:\Users\26629\WorkBuddy\VibeCoding\.workbuddy\tmp\probe.wav`，再跑层 1 那条命令。

返回里的 `data.text` 就是识别结果。

### 层 3 · 页面能用吗（这层我替不了）

打开 `http://localhost:8010/pages/dialogue.html?topic=T1`，点「开始说话」，说一句英语，说完停一下。

**该看到的**：
- 麦克风授权弹窗 → 点允许
- 一条**音量条在动** ← 这是「麦克风真的在收」的证据
- 「听到了，正在识别……」
- 你说的话出现在记录区
- AI 出声

---

## 出错了看这一张表

| 页面提示 / 诊断码 | 原因 | 怎么办 |
|---|---|---|
| 语音识别服务还没配好 | 环境变量缺 | 回 2.2，三个都要 |
| 语音接口还没部署好 | 网关路由没加 | 回 2.3 |
| 语音识别密钥无效 | SecretId/Key 填错 | 回 2.2 |
| 麦克风没有授权 | 浏览器拒绝了 | 地址栏右侧小锁 → 麦克风 → 允许 |
| 找不到麦克风 | 被微信/钉钉/Teams 占用 | 关掉那些程序 |
| 这句没听清（一直出现）| 音量阈值太高或环境太吵 | `speech.js` 的 `VOLUME_THRESHOLD` 调低（0.02 → 0.01）|
| 一直录满 30 秒才停 | 环境噪音被当人声 | `VOLUME_THRESHOLD` 调高（0.02 → 0.04）|
| AI 不出声 | 浏览器没有语音合成 | 文字照常显示，属 E10 降级，不影响使用 |

★ **页面那行【诊断】会打出真实错误码**（`ASR_NOT_CONFIGURED` / `HTTP_404`
/ `ASR_AUTH_FAILED` 等），比猜快得多 —— 出了错把那行发我就行。

---

## 一个要知道的事

**语音识别现在会把录音发到腾讯云服务器。** 不落库、不留存，只用于这一次识别。
页面上有一块可见的告知（`.privacy-note` 那段文字）。

选浏览器原生方案当初就是为了避免这件事（`TECH_DESIGN §3.3`），
现在因为那条路在国内走不通，只能退到服务端 —— 这是这个取舍的代价。

---

## 附录· 详细说明

<details>
<summary>为什么必须换掉浏览器识别（点开）</summary>

Chrome 的 `SpeechRecognition` **不是本地识别** —— 它把录音上传到
**Google 的服务器**去识别，国内访问不通就一直等（真机报 `network` 错误）。

这不是代码问题，调任何参数都没用。而 `TECH_DESIGN.md:107`
早就写明了这一条（「Chrome 上还依赖网络」），`:139` 留了后路
（「是否切换由 Day 6 实测决定（Q-T1）」），`docs/api-contract.md §5`
更把 `POST /api/speech-to-text` 的位置预留好了 ——
**现在就是那个触发时**。

**但 AI 出声没换**：`SpeechSynthesis` 用的是操作系统语音，真本地、
不需要网络，那条路从一开始就是对的。
</details>

<details>
<summary>为什么手写签名而不引SDK（点开）</summary>

本函数只调一个 HTTP 接口、只用 POST + JSON，
引 `tencentcloud-sdk-nodejs` 会带进一整包依赖，
而云函数部署包越小启动越快。60 行手写比 200 行依赖更可控
（理由与 `chat/index.js` 一致）。

签名四步：① 规范请求 → ② 待签字符串 → ③ 三次 HMAC 派生
（日期 → 服务 → terminator）→ ④ 拼 Authorization 头。
单测 `.test-asr-sign.js`（20 项）覆盖签名形状、确定性、
payload 变则签名变、VoiceFormat 映射、错误码映射。
</details>