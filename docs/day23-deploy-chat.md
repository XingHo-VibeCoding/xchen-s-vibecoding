# 第 2 步：重新部署 chat 云函数（完整步骤）

> 环境 `cxj1528-d4g55ng0o54cbe296` ｜ 只改 `cloudfunctions/chat/index.js` 一个文件

## 📌 用哪个终端？

**PowerShell 和 Git Bash 都能跑大部分命令**，但有一处不兼容：

- 第 3 步的 `diff <(...)` 是 **Git Bash 专用**，PowerShell 会报
  `'<'' 不是 cmdlet` —— **那不是部署失败**，文档里给了 PowerShell 版写法
- `curl`、`tcb`、`ls`、`cat` 两边都一样
- `--data-binary @文件` 两边都支持（但 `-d '{...}'` 两边都不行，JSON 引号会被剥掉）

**已经在 PowerShell 里跑完前三步的情况**（Day 23 实测）→
直接跳到第 4 步，密钥用 `Select-String` 那条查。

---

## ⚠️ 先看这一条：不能用 `tcb fn deploy`

项目笔记里记着一条实测结论：

> **`tcb fn deploy` 会清空控制台配好的环境变量。**
> 它的 `--help` 原文写着「applies … **envVariables** config」，
> 而 `cloudbaserc.json` 的 `functions[]` 里**没有**这个字段
> → 云函数里 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` **会被清空**。

密钥没了，AI 直接返回 `LLM_NOT_CONFIGURED`。

**所以只能用 `tcb fn code update`** —— 它只更代码、不碰配置。

---

## 路线 A：命令行（推荐，两条命令）

### 第 1 步：部署前先备份密钥配置

这一步是保险。万一后面任何操作动了配置，能照着这份还原。

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
tcb fn env pull chat --output-file .workbuddy/tmp/chat-env-backup.txt
```

跑完看文件里有没有三个键名（**只看名字，不看值**）：

```bash
grep -o "^LLM_[A-Z_]*" .workbuddy/tmp/chat-env-backup.txt
```

期望看到三行：`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`。

**没看到就要停下来**，说明配置本来就不全，先处理这个问题再部署。

### 第 2 步：只更新代码

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
tcb fn code update chat --dir cloudfunctions/chat
```

等 10–30 秒，看到成功提示即可。

**这条命令不会碰环境变量**，只换代码。

### 第 3 步：立刻核对密钥还在

⚠️ **PowerShell 用户直接看第 4 步** ——
下面的 `diff <(...)` 是 Git Bash 语法，PowerShell 会报
`'<'' 不是 cmdlet`（Day 23 实测踩到）。
**那不是部署失败，是命令形式不对。**

**PowerShell 版**（复制这两行）：

```powershell
cd C:/Users/26629/WorkBuddy/VibeCoding
Get-Content .workbuddy/tmp/chat-env-after.txt | Select-String "^LLM_[A-Z_]*"
```

输出 3 行（`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`）= 密钥没丢。

**Git Bash 版**（一条命令比两个文件）：

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
diff <(grep -o "^LLM_[A-Z_]*" .workbuddy/tmp/chat-env-backup.txt) \
     <(grep -o "^LLM_[A-Z_]*" .workbuddy/tmp/chat-env-after.txt)
```

**没有输出 = 键名完全一致 = 密钥没被动过。**

有输出就说明配置变了，按备份还原，别继续往下走。

### 第 4 步：直接打线上接口看效果

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
curl -s -X POST "https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/api/chat" \
  -H "Content-Type: application/json" \
  --data-binary '{"topicId":"T1","userText":"I think we should delay it.","role":"项目负责人","anchor":"项目进度","followUps":["哪个部分还没做完"],"history":[]}'
```

★ **两个坑**（都不是命令写错，是环境问题）：
- 域名是 `...app.tcloudbase.com`（中间是 `tcloudbase`，不是 `tcloudbaseapp`），
  抄错会返回 `HTTP 000`（连接失败，不是接口报错）
- `-d` 里塞 JSON 在 Git Bash 下双引号会被外层剥掉 → **必须用
  `--data-binary @文件`**，文件我放在 `.workbuddy/tmp/probe.json`

期望返回：
```json
{"ok":true,"data":{"aiText":"...","kind":"normal","model":"deepseek-chat"}}
```

**看 `aiText` 的词数** —— 12 词以内算生效。

---

## 路线 B：控制台网页上传

不想用命令行就走这条。

1. 打开 `https://console.cloud.tencent.com/tcb`
2. 确认左上角环境是 **`cxj1528-d4g55ng0o54cbe296`**
3. 左侧「云函数」→ 点进 **`chat`**
4. 「函数代码」标签页 → 找「**函数代码编辑**」或「**上传文件**」
5. 把 `cloudfunctions/chat/` 整个目录压成 zip 上传
   （**只传 `chat` 这一个目录**，别把整个 `cloudfunctions/` 传上去）
6. 点「部署」
7. ★ **顺手确认环境变量没丢**：函数详情页 →「函数配置」→「环境变量」，
   应该有 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 三项

★ 控制台上传一般不会动环境变量，但**看一眼比不看稳妥**。

---

## 部署后怎么验证（这步别跳过）

### 命令行快速验证

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
curl -s -X POST "https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/api/chat" \
  -H "Content-Type: application/json" \
  --data-binary '{"topicId":"T1","userText":"I do not know.","role":"项目负责人","anchor":"项目进度","followUps":["哪个部分还没做完"],"history":[]}'
```

`userText` 是 `I do not know.`（含糊的），期望 AI 只问**一个很具体的点**、8 词以内。
这就是「`kind` 现在真的被用起来」的证据。

### 浏览器验证

1. `cd frontend && python serve.py`
2. 打开 `http://localhost:8010/pages/dialogue.html?topic=T1`
3. 点「开始说话」，连着说 3–4 句

**看两件事**：
- 每句 AI 的话**明显变短**（12 词左右，比之前短一大截）
- 大部分句子**以问号结尾**（之前有陈述句，你现在没东西接）

---

## 部署完还是不对，按这个表查

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `LLM_NOT_CONFIGURED` | 环境变量被清空 | 用第 1 步的备份还原（控制台配，或用 `tcb fn env` 相关命令） |
| 403/签名错误 | 用错域名 | 确认是 `...app.tcloudbase.com` |
| HTTP 000 | 命令行没带对 | 用 `--data-binary @文件`，别用 `-d '{...}'` |
| 话还是很长 | 代码没真上传 | 走路线 B，或在控制台看 `index.js` 的更新时间 |
| 页面报错但接口正常 | 前端缓存 | 硬刷新 `Ctrl+Shift+R` |

排错时**不要指望 `tcb fn log`** —— 笔记里记着「HTTP 函数查不到调用日志」。

---

## 顺便说一下：不用重新部署的

这次只改了 `cloudfunctions/chat/index.js` 一个文件，所以：

- `analyze` / `read` / `write` / `health` —— **不用动**
- 静态托管 —— **不用重传**（前端 HTML 的改动在本地，服务能读到）