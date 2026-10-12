# 把今天三处改动发布到公网（静态托管）

> 云函数 `chat` **今天已经部署过了**（你手动做的）。这一步只管前端文件。

---

## 一句话背景

线上现在是**Day 20 的旧版本** —— 我实测过：

```
https://...tcloudbase.com/js/speech.js  →  HTTP 404
```

所以公网上那版：插嘴没修、AI 说的话还长、**没有语音**。

前端文件我已经全部同步到 `.deploy/hosting/` 了，**你只需要跑一条命令**。

---

## 部署命令

⚠️ **注意 `MSYS_NO_PATHCONV=1` 不能省。** 不加它，Git Bash 会把
`C:/Users/...` 这个路径自动转换成 Windows 风格，CloudBase CLI 认不出来
（笔记里记着这个坑）。

```bash
cd C:/Users/26629/WorkBuddy/VibeCoding
MSYS_NO_PATHCONV=1 tcb hosting deploy ".deploy/hosting" /
```

等 10–30 秒，会列出每个文件的上传结果。

★ 用 **PowerShell** 的话改成：

```powershell
cd C:/Users/26629/WorkBuddy/VibeCoding
tcb hosting deploy ".deploy/hosting" /
```

（那条 `MSYS_NO_PATHCONV=1` 是给 Bash 用的，PowerShell 里不存在这种变量转换问题。）

---

## 部署后验证

### 第 1 步：确认文件真的上去了（最重要）

```bash
curl -s -o /dev/null -w "speech.js → HTTP %{http_code}\n" "https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/js/speech.js"
```

**期望 200**（部署前是 404，这是最直接的证据）

### 第 2 步：确认页面拿到了新代码

打开线上地址，`Ctrl+Shift+R` **强制刷新**（不然浏览器会用缓存，你以为没生效）：

```
https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com/
```

进对话页，说一句话，验三件事：
- 录音区出现「正在听：…」→ 说明 speech.js 加载成功
- 说完停 1 秒 → 出现「听到你说完了，正在提交……」
- **AI 会出声音**

### 第 3 步：对照检查台

```
https://...tcloudbase.com/pages/status.html
```

四个接口都应该是 🟢。`chat` 今天部署过，如果它红了说明部署出问题，看浏览器 F12 的 Network 里 `/api/chat` 的 `error.code`。

---

## ⚠️ 一个坑：验证必须用真浏览器

命令行绿灯**不能拿来交差** —— CloudBase 会拦带 `Sec-Fetch-Mode: navigate` 的请求，
返回标题为「风险提醒」的 404 页（**HTTP 也是 200**）。
真实浏览器正常、无头 Chrome 被拦。

★ 所以第 2 步必须你亲眼看，curl 只用来确认「文件上去了没有」。

---

## 部署失败怎么办

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `domain ... is a system internal domain` | 路径传成了域名 | 检查是不是把路径写成 `https://...` 了 |
| 提示找不到路径 | 当前目录不对 | 先 `cd` 到项目根目录 |
| 上传了但页面没变 | 浏览器缓存 | `Ctrl+Shift+R` 强制刷新 |
| 删了文件想重传 | 传歪了要清理 | `tcb hosting delete "<远端字面路径>" --dir` |

---

## 附：这次更新了哪些文件

```
新增  js/speech.js                       ← 今天新建的语音模块
更新  js/api.js  js/storage.js
更新  js/components/interact.js  item-card.js  topic-card.js
更新  js/pages/topics.js  status.js
更新  pages/dialogue.html                ← 插嘴修复 + 语音接线
更新  pages/topics.html  records.html  result.html  status.html
更新  styles/main.css                    ← 排队提示 + 语音提示行
更新  data/topics.json
```

`index.html` **没动** —— 它只存在于 `.deploy/hosting/`（Day 20 写的跳转页，
项目里没有源文件），我特意没覆盖它。

部署目录里**不含** `serve.py` / `regress.js` / `a11y-check.js` / `flt-verify.js`
这 4 个开发工具 —— 我逐个核对过。

---

## 部署完就该做的事

今天的 git 提交还没做。按规矩：部署验证完 → 我列文件清单 → 你确认 → 再提交。