#!/usr/bin/env bash
# =============================================================================
# 发布前检查 · check.sh        Skill: kouyu-verify-project
# =============================================================================
# 真源（每一项的命令 / 通过标准 / 出处 / 误报风险）：
#   .workbuddy/skills/kouyu-verify-project/references/checks.md
#
# 跑法（★ 必须在 Git Bash / MINGW64 里跑，脚本用了 bash 特有的 $'…'、<() ）：
#   bash .workbuddy/skills/kouyu-verify-project/scripts/check.sh
#
# 前置条件：第 13 项要跑无头回归，需要本地服务已经在跑。
#   → 另开一个终端：cd frontend && python serve.py
#
# 退出码 = 失败数 + 跳过数。（★ 跳过 ≠ 通过：跳过意味着「这一项没有拿到证据」）
#
# 三条「不虚报」机制（这是本脚本存在的理由）：
#   ① 每一项都打印**实际值**，不只打 PASS
#   ② 取不到值 → 判 FAIL / SKIP，绝不判 PASS（上游静默失败是这一类检查最大的敌人）
#   ③ 白名单显式列在脚本里，命中要打印「为什么安全」，不靠人肉判断
# =============================================================================

set -u

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ]; then
  echo "✗ 当前目录不在 git 仓库里，无法运行（脚本依赖 git grep / git ls-files）"
  exit 2
fi
cd "$ROOT" || exit 2

TOTAL=20
N=0; PASS=0; FAIL=0; SKIP=0
CUR=""

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; BD=$'\033[1m'; OFF=$'\033[0m'

item() { N=$((N + 1)); CUR="$1"; }
ok()   { PASS=$((PASS + 1)); printf '[%2d/%d] %sPASS%s %-34s 实际值：%s\n' "$N" "$TOTAL" "$G" "$OFF" "$CUR" "$1"; }
ng()   { FAIL=$((FAIL + 1)); printf '[%2d/%d] %sFAIL%s %-34s 实际值：%s\n' "$N" "$TOTAL" "$R" "$OFF" "$CUR" "$1"; }
sp()   { SKIP=$((SKIP + 1)); printf '[%2d/%d] %sSKIP%s %-34s 实际值：%s\n' "$N" "$TOTAL" "$Y" "$OFF" "$CUR" "$1"; }
say()  { printf '\n%s%s%s\n' "$BD" "$1" "$OFF"; }

# ---------------------------------------------------------------- 基础工具 ---
# python：解析 JSON 用（本项目系统 3.11 与托管 3.13 都有 json 模块）
PY=""
for c in python python3 py; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

# ★ 表达式用 argv 传（不用 heredoc 拼进 -c 里），免得引号被 shell 吃掉一层
jqq() { # $1 = python 表达式，JSON 从 stdin 读
  [ -n "$PY" ] || return 1
  "$PY" -c 'import sys,json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
print(eval(sys.argv[1]))' "$1" 2>/dev/null
}

# curl 统一带 --noproxy '*'：本机有 http_proxy 环境变量，不加会把本机/本地服务请求送进代理
getf() { # $1=URL  $2=python 表达式  $3=「额外」也算有效的值（默认只有非空算有效）
  local url="$1" expr="$2" extra="${3:-}" v=""
  for _ in 1 2 3; do
    v=$(curl -s --noproxy '*' -m 25 "$url" 2>/dev/null | jqq "$expr")
    if [ -n "$v" ] && { [ -z "$extra" ] || [ "$v" != "None" ] || [ "$v" = "$extra" ]; }; then
      printf '%s' "$v"; return 0
    fi
    sleep 1
  done
  printf ''; return 1
}

# ★ 整数判据：不许用 grep -qx '[0-9]' —— 那只能匹配一位数，count 变成 10 就误判
isnum() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

bash_n="$(command -v bash)"
NODE_BIN="$(command -v node 2>/dev/null || true)"
[ -n "$NODE_BIN" ] || NODE_BIN="C:/Users/26629/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"

B="${TALK_BASE:-https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com}"
ORIGIN="http://localhost:8010"
TMPD=$(mktemp -d 2>/dev/null || echo ".workbuddy/tmp/verify-$$")
mkdir -p "$TMPD" 2>/dev/null
trap 'rm -rf "$TMPD"' EXIT   # ★ 临时目录里可能有 tcb pull 下来的环境变量文件，必须删干净

# 剥注释后搜字面串的小工具。
# ★ 为什么要剥：Day 25 第一遍判「前端还在引用已删的错误码」，6 处命中**全是注释**
#   （`原来是 (o.code === 'DB_CONNECTION_REFUSED')` 这种解释历史的文字），
#   剥掉注释后命中 0。注释里写历史是对的，不该被算成「代码还在用它」。
#   （同一个道理见 `notes/sql-pitfalls.md §3`：离线校验器解析前必须先剥注释。）
# 已知粗筛局限：`//` 也会把字符串里的 `https://` 后面截掉 —— 只当粗筛用。
cat > "$TMPD/strip-grep.py" <<'PYEOF'
import re, subprocess, sys
pat = re.compile(sys.argv[1])
files = subprocess.run(['git', 'ls-files', '--'] + sys.argv[2:],
                       capture_output=True, text=True).stdout.split()
hits = []
for p in files:
    try:
        s = open(p, encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    s = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s, flags=re.S)
    s = re.sub(r'<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), s, flags=re.S)
    s = re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), s)
    for i, line in enumerate(s.split('\n'), 1):
        if pat.search(line):
            hits.append('%s:%d:%s' % (p, i, line.strip()[:120]))
print(len(hits))
for h in hits[:5]:
    print(h)
PYEOF

printf '%s发布前检查 · 口语对话实战器%s\n' "$BD" "$OFF"
echo "仓库：$ROOT"
echo "公网基址：$B"
echo "时间：$(date '+%Y-%m-%d %H:%M:%S')"

# ============================================================ 组 1 密钥与仓库卫生
say "组 1 · 密钥与仓库卫生"

# ---- K1 仓库里没有真实密钥 ----------------------------------------------------
item "1 仓库里没有真实密钥"
ALL_AK=$(git grep -nIE "AKID[A-Za-z0-9]{10,}" -- . 2>/dev/null || true)
# ★ 白名单：这两处是「确认过安全」的，不许为了让搜索变 0 条而删掉
WL_OUT=$(printf '%s\n' "$ALL_AK" | grep -vE "^(\.test-asr-sign\.js|docs/day23-deploy-speech\.md):" | grep -c . || true)
WL_TOTAL=$(printf '%s\n' "$ALL_AK" | grep -c . || true)
REAL_AK=$(printf '%s\n' "$ALL_AK" | grep -vE '\*\*\*\*\*\*\*|AKIDx+' | grep -c . || true)
if [ "${WL_OUT:-1}" = "0" ] && [ "${REAL_AK:-1}" = "0" ]; then
  ok "全量 ${WL_TOTAL} 条全在白名单内（.test-asr-sign.js:38 官方示例值 / docs/day23-deploy-speech.md:32 占位符）；按「排除白名单特征」判 0 条"
else
  ng "白名单外命中 ${WL_OUT} 条、疑似真密钥 ${REAL_AK} 条；逐条看：$(printf '%s\n' "$ALL_AK" | grep -vE '\*\*\*\*\*\*\*|AKIDx+' | head -3 | tr '\n' ' ')"
fi

# ---- K2 Git 历史里没有真实密钥 ------------------------------------------------
item "2 Git 历史里没有真实密钥"
HIST=$(git log --all -p --no-color 2>/dev/null | grep -oE "AKID[A-Za-z0-9]{10,}" | sort -u)
HIST_BAD=$(printf '%s\n' "$HIST" | grep -vE "^AKIDx+$|^AKIDz8krbs" | grep -c . || true)
if [ "${HIST_BAD:-1}" = "0" ]; then
  ok "全部提交扫完（$(git rev-list --all --count) 个），去重后 $(printf '%s\n' "$HIST" | grep -c . || true) 条，全在既有白名单内"
else
  ng "历史里出现白名单外 ${HIST_BAD} 条：$(printf '%s\n' "$HIST" | grep -vE '^AKIDx+$|^AKIDz8krbs' | head -3 | tr '\n' ' ')"
fi

# ---- K3 没有数据库连接串与密码 ------------------------------------------------
item "3 没有数据库连接串与密码"
CONN_ALL=$(git grep -nIE "postgres(ql)?://|mysql://|password[[:space:]]*[:=]" -- . 2>/dev/null || true)
CONN_REAL=$(printf '%s\n' "$CONN_ALL" | grep -v "git grep" | grep -c . || true)
CONN_CMD=$(printf '%s\n' "$CONN_ALL" | grep -c "git grep" || true)
if [ "${CONN_REAL:-1}" = "0" ]; then
  ok "真实命中 0 条（另有 ${CONN_CMD} 条是文档里把本命令写成示例，已排除）"
else
  ng "真实命中 ${CONN_REAL} 条：$(printf '%s\n' "$CONN_ALL" | grep -v "git grep" | head -3 | tr '\n' ' ')"
fi

# ---- K4 .env 系被忽略、.env.example 不被误伤 ---------------------------------
item "4 .env 系被忽略、.env.example 不被误伤"
# ★ 必须加 --no-index：**.env.example 已被跟踪**，而 git **不对已跟踪文件应用忽略规则**
#   → 不带 --no-index 时它永远「未命中」，判据就永远 PASS。
#   Day 25 探针实测：把 `!.env.example` 那行注释掉（于是被第 3 行 `.env.*` 吃掉），
#   本项**仍然报 PASS** —— 那就是漏报。
#   --no-index 问的是「假如它没被跟踪，规则会怎么判」，这才是「规则本身是否成立」。
IGN=$(git check-ignore --no-index -v .env .env.local .env.production .cloudbase-api-key.local.json 2>/dev/null || true)
IGN_EX=$(git check-ignore --no-index -v .env.example 2>/dev/null || true)
IGN_MISS=""
for f in .env .env.local .env.production .cloudbase-api-key.local.json; do
  if ! printf '%s\n' "$IGN" | awk -v want="$f" '$NF == want { hit = 1 } END { exit !(hit) }'; then
    IGN_MISS="$IGN_MISS $f"
  fi
done
# .env.example 命中的那一行必须是「! 例外规则」，不能是被 `.env.*` 吃掉
if printf '%s\n' "$IGN_EX" | grep -q '!\.env\.example'; then IGN_EX_OK=1; else IGN_EX_OK=0; fi
if [ -z "$IGN_MISS" ] && [ "${IGN_EX_OK:-0}" = "1" ]; then
  ok "4 个该忽略的都命中（$(printf '%s\n' "$IGN" | grep -c . || true) 行）；.env.example 命中的是例外规则：$(printf '%s' "$IGN_EX" | tr -d '\r')"
else
  ng "未命中:$IGN_MISS ；.env.example 命中的规则是 '$(printf '%s' "$IGN_EX" | tr -d '\r')'（期望命中 !.env.example）"
fi

# ---- K5 被跟踪的密钥类文件恰好只有 .env.example ------------------------------
item "5 被跟踪的密钥类文件只有 .env.example"
TRACKED=$(git ls-files | grep -iE "\.env|secret|credential" || true)
TRACKED_N=$(printf '%s\n' "$TRACKED" | grep -c . || true)
TRACKED_EXTRA=$(printf '%s\n' "$TRACKED" | grep -v "^\.env\.example$" | grep -c . || true)
if [ "${TRACKED_N:-0}" = "1" ] && [ "${TRACKED_EXTRA:-1}" = "0" ]; then
  ok "恰好 1 行：.env.example（例外文件，只放键名不放值）"
else
  ng "${TRACKED_N} 行：$(printf '%s\n' "$TRACKED" | tr '\n' ' ')"
fi

# ============================================================ 组 2 公网与接口
say "组 2 · 公网与接口"

# ---- N1 接口活着 + 外壳形状 ---------------------------------------------------
item "6 接口活着且外壳是 {ok,data,error}"
H_OK=$(getf "$B/api/health" "d.get('ok')" || true)
H_SVC=$(getf "$B/api/health" "d.get('service')" || true)
S_OK=$(getf "$B/api/sessions" "d.get('ok')" || true)
S_CNT=$(getf "$B/api/sessions" "d['data']['count']" || true)
F_OK=$(getf "$B/api/favorites" "d.get('ok')" || true)
if [ "$H_OK" = "True" ] && [ "$S_OK" = "True" ] && [ "$F_OK" = "True" ] && isnum "$S_CNT"; then
  ok "health.ok=$H_OK service=$H_SVC ；sessions.ok=$S_OK count=$S_CNT ；favorites.ok=$F_OK"
else
  ng "health.ok='$H_OK' service='$H_SVC' ；sessions.ok='$S_OK' count='$S_CNT' ；favorites.ok='$F_OK'"
fi

# ---- N2 ★ 跨域头真的存在 -----------------------------------------------------
# ★ 必须带 Origin 才问得出：不带 Origin 时网关一个 access-control-* 头都不发
item "7 跨域头存在（必须带 Origin 才问得出）"
AC_AO=$(curl -s --noproxy '*' -m 25 -D - -o /dev/null -H "Origin: $ORIGIN" "$B/api/sessions" 2>/dev/null \
  | grep -i '^access-control-allow-origin' | tr -d '\r' | head -1 || true)
AC_HDRS=$(curl -s --noproxy '*' -m 25 -D - -o /dev/null -H "Origin: $ORIGIN" "$B/api/sessions" 2>/dev/null \
  | grep -ci '^access-control' || true)
AC_NONE=$(curl -s --noproxy '*' -m 25 -D - -o /dev/null "$B/api/sessions" 2>/dev/null \
  | grep -ci '^access-control' || true)
if [ -n "$AC_AO" ] && [ "$AC_HDRS" -ge 1 ] 2>/dev/null; then
  ok "带 Origin → ${AC_HDRS} 个头，$AC_AO（对照组：不带 Origin → ${AC_NONE} 个头，所以本项必须带 Origin）"
else
  ng "带 Origin 也没拿到 access-control-allow-origin（实际头数 $AC_HDRS）。浏览器会被拦，而 curl 不带 Origin 仍是 200 —— 这正是最容易误判的一项"
fi

# ---- N3 非法参数被挡住 --------------------------------------------------------
item "8 非法参数被挡住（INVALID_PARAMS）"
E1C=$(getf "$B/api/sessions?topicId=T9" "d['error']['code']" || true)
E2C=$(getf "$B/api/sessions?limit=abc" "d['error']['code']" || true)
if [ "$E1C" = "INVALID_PARAMS" ] && [ "$E2C" = "INVALID_PARAMS" ]; then
  ok "topicId=T9 → $E1C ；limit=abc → $E2C"
else
  ng "topicId=T9 → '$E1C'（期望 INVALID_PARAMS）；limit=abc → '$E2C'"
fi

# ---- N4 404 / 405 且是我们自己的 JSON 外壳 ------------------------------------
item "9 404/405 是我们自己的 JSON 外壳"
S404=$(curl -s --noproxy '*' -m 25 -o "$TMPD/n4a" -w '%{http_code}' "$B/api/nope" 2>/dev/null || true)
C404=$(jqq "d['error']['code']" < "$TMPD/n4a" 2>/dev/null || true)
S405=$(curl -s --noproxy '*' -m 25 -X PUT -o "$TMPD/n4b" -w '%{http_code}' "$B/api/sessions" 2>/dev/null || true)
C405=$(jqq "d['error']['code']" < "$TMPD/n4b" 2>/dev/null || true)
if [ "$S404" = "404" ] && [ "$C404" = "NOT_FOUND" ] && [ "$S405" = "405" ] && [ "$C405" = "METHOD_NOT_ALLOWED" ]; then
  ok "GET /api/nope → $S404 $C404 ；PUT /api/sessions → $S405 $C405"
else
  ng "GET /api/nope → $S404 '$C404' ；PUT /api/sessions → $S405 '$C405'（非 JSON 外壳说明落到了网关默认页）"
fi

# ---- N5 公网首页不是「风险提醒」拦截页 ----------------------------------------
# ★ 拦截页也返回 HTTP 200，所以只能比标题，不能看状态码
item "10 公网首页不是拦截页（比标题，不看 200）"
TITLE=$(curl -s --noproxy '*' -m 25 "$B/pages/topics.html" 2>/dev/null | grep -oE "<title>[^<]*</title>" | head -1 || true)
if printf '%s' "$TITLE" | grep -q "口语对话实战器"; then
  ok "$TITLE"
else
  ng "标题是 '$TITLE'（拦截页/404 页也返回 200，状态码无法区分；本项只作粗筛，发布前仍需真浏览器肉眼确认）"
fi

# ============================================================ 组 3 环境变量
say "组 3 · 环境变量"

# ---- E1 必需键齐（代码自洽 + 控制台）-----------------------------------------
item "11 云函数必需环境变量齐"
CODE_KEYS=$( { grep -rhoE "process\.env\.[A-Z_0-9]+" --include='*.js' cloudfunctions/ 2>/dev/null | sed 's/process\.env\.//'; } | sort -u | grep -c . || true)
EX_KEYS=$(grep -oE "^[A-Z_0-9]+" .env.example 2>/dev/null | sort -u | grep -c . || true)
KEYDIFF=$(diff <(grep -rhoE "process\.env\.[A-Z_0-9]+" --include='*.js' cloudfunctions/ 2>/dev/null | sed 's/process\.env\.//' | sort -u) \
               <(grep -oE "^[A-Z_0-9]+" .env.example 2>/dev/null | sort -u) | grep -c . || true)
# ★ 必需 7 个（缺了功能不可用）；有默认值的 4 个缺失不算失败
REQ="chat:LLM_API_KEY,LLM_BASE_URL,LLM_MODEL analyze:LLM_API_KEY,LLM_BASE_URL,LLM_MODEL speech:ASR_SECRET_ID,ASR_SECRET_KEY,ASR_APPID read:CLOUDBASE_API_KEY write:CLOUDBASE_API_KEY"
ENV_MISS=""
ENV_DONE=""
if command -v tcb >/dev/null 2>&1; then
  for pair in $REQ; do
    fn="${pair%%:*}"; need="${pair#*:}"
    # ★ 拉下来的文件只在 TMPD 里，只 grep 键名，绝不 cat
    if tcb fn env pull "$fn" --output-file "$TMPD/$fn.env" >/dev/null 2>&1; then
      # ★ 只读这一份里的**键名**（pull 出来的格式是 KEY=VALUE），值一律不打印、不 cat
      got=$(sed 's/=.*//' "$TMPD/$fn.env" | grep -c . || true)
      for k in ${need//,/ }; do
        # ★ 判据必须锚定「行首键名 + 等号」。
        #   Day 25 第一遍栽在这：写成 grep -E "[A-Z]${k}" 会**多要一个前导大写字母**，
        #   于是键明明在也判「缺」，报出 11 条假失败（实测五个函数键全齐）。
        if ! grep -qE "^${k}=" "$TMPD/$fn.env" 2>/dev/null; then ENV_MISS="$ENV_MISS $fn/$k"; fi
      done
      ENV_DONE="$ENV_DONE $fn(${got}键)"
    else
      ENV_MISS="$ENV_MISS $fn(拉取失败)"
    fi
  done
else
  ENV_DONE=""
fi
if [ "${KEYDIFF:-1}" != "0" ]; then
  ng "代码读的键（${CODE_KEYS} 个）与 .env.example 记的键（${EX_KEYS} 个）不一致 —— 键名清单本身漂了，控制台不可能全"
elif [ -n "$ENV_MISS" ]; then
  ng "控制台缺键：$ENV_MISS"
elif [ -n "$ENV_DONE" ]; then
  ok "代码键名与 .env.example 一致（${CODE_KEYS} 个）；控制台已核 ${ENV_DONE}"
else
  sp "代码键名与 .env.example 一致（${CODE_KEYS} 个）✅，但 tcb CLI 不可用/未登录 → **控制台实际配置没验**，不算通过。登录后重跑：tcb login"
fi

# ---- E2 缺变量要明确报出来 ----------------------------------------------------
item "12 缺变量报 *_NOT_CONFIGURED，不静默失败"
NC_COUNT=0; NC_WHICH=""
for fn in chat analyze speech; do
  # ★ 剥注释后再数：把分支注释掉、只在注释里留 `NOT_CONFIGURED` 这几个字，不该算「还在」。
  #   与第 15 项是同一类坑（判据只看字样、不看是不是活代码）。
  c=$("$PY" "$TMPD/strip-grep.py" "NOT_CONFIGURED" "cloudfunctions/$fn/index.js" 2>/dev/null | head -1 | tr -dc '0-9')
  if [ "${c:-0}" -ge 1 ] 2>/dev/null; then
    NC_COUNT=$((NC_COUNT + 1)); NC_WHICH="$NC_WHICH $fn(${c}处)"
  fi
done
if [ "$NC_COUNT" = "3" ]; then
  ok "chat / analyze → LLM_NOT_CONFIGURED，speech → ASR_NOT_CONFIGURED 都在（${NC_WHICH# }；read/write 的 CLOUDBASE_API_KEY 缺了走 DB_AUTH_FAILED，属设计之内）"
else
  ng "只有${NC_WHICH:-无} 有 NOT_CONFIGURED 分支（期望 3 个函数都有，且不含注释里的字样）"
fi

# ============================================================ 组 4 前端静态与运行时
say "组 4 · 前端静态与运行时"

# ---- F1 JS 语法 + 五页五断点回归（合并项：同一件事的两步）--------------------
item "13 前端 JS 语法 + 五页五断点回归"
SYN_BAD=""; SYN_N=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  SYN_N=$((SYN_N + 1))
  "$NODE_BIN" --check "$f" >/dev/null 2>&1 || SYN_BAD="$SYN_BAD $f"
done < <(git ls-files -- frontend | grep -E '\.js$' || true)

if [ -n "$SYN_BAD" ]; then
  ng "${SYN_N} 个 JS 里语法错：$SYN_BAD"
elif ! curl -s --noproxy '*' -m 5 -o /dev/null "http://127.0.0.1:8010/pages/topics.html" 2>/dev/null; then
  sp "${SYN_N} 个 JS 语法全过；但本地服务没起（8010 连不上）→ 回归没跑。先 cd frontend && python serve.py 再重跑"
else
  ( cd frontend && "$NODE_BIN" regress.js > "$TMPD/regress.log" 2>&1 || true )
  RES=$(grep -oE "===== 结果：[0-9]+ 通过 / [0-9]+ 失败 =====" "$TMPD/regress.log" | tail -1 || true)
  CONSOLE=$(grep -oE "【控制台】.*" "$TMPD/regress.log" | tail -1 || true)
  RFAIL=$(printf '%s' "$RES" | grep -oE "/ [0-9]+ 失败" | grep -oE "[0-9]+" || true)
  # ★ regress.js 永远 exit 0，退出码不可信，只能解析输出
  if [ "${RFAIL:-1}" = "0" ] && printf '%s' "$CONSOLE" | grep -q "0 条报错"; then
    ok "${SYN_N} 个 JS 语法全过；$RES ；$CONSOLE"
  else
    ng "${SYN_N} 个 JS 语法全过；$RES ；$CONSOLE"
  fi
fi

# ---- F2 内联 JS 注释配对 ------------------------------------------------------
item "14 内联 JS 的 /* 与 */ 配对"
F2_BAD=""; F2_DETAIL=""
for p in dialogue result records; do
  f="frontend/pages/$p.html"
  [ -f "$f" ] || continue
  a=$(grep -c '/\*' "$f" || true)
  b=$(grep -c '\*/' "$f" || true)
  F2_DETAIL="$F2_DETAIL $p:$a/$b"
  [ "$a" = "$b" ] || F2_BAD="$F2_BAD $p($a/$b)"
done
if [ -z "$F2_BAD" ]; then
  ok "左/右计数相等：$F2_DETAIL（仅当改过内联 JS 才需要看）"
else
  ng "不对等：$F2_BAD（字符串里的 /* 会被误算，本项只作粗筛）"
fi

# ---- F3 前端错误码引用不落后端 ------------------------------------------------
item "15 前端不引用已删除的错误码"
# ★ 剥注释后再搜（第一遍 6 处命中全是注释 → 见上面 strip-grep.py 的说明）
GONE_OUT=$("$PY" "$TMPD/strip-grep.py" "DB_CONNECTION_REFUSED|DB_HOST_UNREACHABLE" frontend 2>/dev/null || true)
GONE=$(printf '%s\n' "$GONE_OUT" | head -1 | tr -dc '0-9')
GONE_LIST=$(printf '%s\n' "$GONE_OUT" | tail -n +2 | tr '\n' ' ')
PREFIX=$(grep -rc "indexOf('DB_')" frontend/ 2>/dev/null | grep -v ":0" | grep -c . || true)
if [ "${GONE:-x}" = "0" ] && [ "${PREFIX:-0}" -ge 1 ] 2>/dev/null; then
  ok "剥注释后：已删的 2 个码 0 处活代码引用；DB 类改用前缀判断（$PREFIX 个文件）"
else
  ng "剥注释后仍有 ${GONE:-读不到} 处引用：${GONE_LIST:-（脚本没跑出结果）}；前缀判断出现在 ${PREFIX} 个文件"
fi

# ============================================================ 组 5 数据口径与契约
say "组 5 · 数据口径与契约"

# ---- D1 count 是整数 ---------------------------------------------------------
item "16 sessions/favorites 的 count 是整数"
C1=$(getf "$B/api/sessions" "d['data']['count']" || true)
C2=$(getf "$B/api/favorites" "d['data']['count']" || true)
if isnum "$C1" && isnum "$C2"; then
  ok "sessions.count=$C1 ；favorites.count=$C2（判据是整数，不是「一位数正则」）"
else
  ng "sessions.count='$C1' ；favorites.count='$C2'"
fi

# ---- D2 B6 中途退出 endedAt 必须 null ----------------------------------------
# ★ 第 3 参数传 'None'：本项要的答案**就是** None，不能被 getf 当成「取不到」
item "17 B6 中途退出的 endedAt = null"
AB=$(getf "$B/api/sessions" "[s for s in d['data']['sessions'] if s['aborted']][0]['endedAt']" "None" || true)
ABN=$(getf "$B/api/sessions" "len([s for s in d['data']['sessions'] if s['aborted']])" || true)
if [ "$AB" = "None" ] && isnum "$ABN" && [ "$ABN" != "0" ]; then
  ok "中途退出的场次 ${ABN} 场，endedAt 全是 null（取不到数据时会判 FAIL，不会因为 None 被误判）"
elif [ "$AB" = "None" ] && [ "${ABN:-0}" = "0" ]; then
  ng "当前库里没有 aborted 场次（取到 0 场），做不了判断 —— 不能因为「没数据」算通过"
else
  ng "endedAt = '$AB'（期望 null）"
fi

# ---- D3 B7 两条硬约束 --------------------------------------------------------
item "18 B7 偏题无改法 / 逻辑错误有改法"
B7A=$(getf "$B/api/favorites" "all(i['correction'] is None for i in d['data']['items'] if i['type']!='logic')" || true)
B7B=$(getf "$B/api/favorites" "all(i['correction'] is not None for i in d['data']['items'] if i['type']=='logic')" || true)
if [ "$B7A" = "True" ] && [ "$B7B" = "True" ]; then
  ok "非 logic 条目 correction 全为 null=$B7A ；logic 条目都有改法=$B7B（判据用 all() 收成单布尔，不是布尔列表）"
else
  ng "非 logic=$B7A ；logic=$B7B（布尔列表当判据会永远 FAIL）"
fi

# ---- D4 §1.4 的 20 个码 ↔ 代码 双向一致 ---------------------------------------
item "19 错误码与 api-contract §1.4 一致"
codes_in_code() {
  { grep -rhoE "'[A-Z][A-Z_0-9]{2,}'" --include='*.js' cloudfunctions/ 2>/dev/null | tr -d "'" | sort -u; } \
    | grep -E '^(INVALID_|LLM_|ASR_|DB_|PAYLOAD_|NOT_FOUND$|METHOD_|INTERNAL_|DUPLICATE$)' \
    | grep -vE '^(LLM_API_KEY|LLM_BASE_URL|LLM_MODEL|ASR_SECRET_ID|ASR_SECRET_KEY|ASR_APPID|ASR_REGION)$'
}
EXPECTED_20=$(cat <<'EOF'
DB_AUTH_FAILED
DB_QUERY_FAILED
DB_TABLE_MISSING
DB_TIMEOUT
DUPLICATE
INTERNAL_ERROR
INVALID_JSON
INVALID_PARAMS
LLM_AUTH_FAILED
LLM_BAD_FORMAT
LLM_BAD_RESPONSE
LLM_ERROR
LLM_NOT_CONFIGURED
LLM_NO_CREDIT
LLM_RATE_LIMITED
LLM_TIMEOUT
LLM_UNREACHABLE
METHOD_NOT_ALLOWED
NOT_FOUND
PAYLOAD_TOO_LARGE
EOF
)
# ASR_ 那 11 个按 5.4 的拍板不纳入本项（见 checks.md §5.4）
ACTUAL_20=$(codes_in_code | grep -v '^ASR_' | sort -u)
D4C=$(diff <(printf '%s\n' "$EXPECTED_20" | sort -u) <(printf '%s\n' "$ACTUAL_20") | grep -cE '^[<>]' || true)
if [ "${D4C:-1}" = "0" ]; then
  ok "文档 20 个码 = 代码里出现的码（$(printf '%s\n' "$ACTUAL_20" | grep -c .) 个，已排除 ASR 类与变量名）"
else
  ng "两边不一致：$(diff <(printf '%s\n' "$EXPECTED_20" | sort -u) <(printf '%s\n' "$ACTUAL_20") | grep -E '^[<>]' | tr '\n' ' ')"
fi

# ---- D5 前端映射表覆盖代码里出现的每个码 --------------------------------------
item "20 前端 friendlyMessage 覆盖代码里每个码"
# ★ 抓法要覆盖两种写法（第一遍只抓带引号的 → 抓出来是空的 → 报「31 个码全没映射」的假失败）：
#   ① 带引号：'INVALID_PARAMS' / "INVALID_PARAMS"
#   ② **无引号的对象键**：`var INPUT_MAP = { INVALID_PARAMS: '…' }` ← api.js 就是这么写的
MAP_CODES=$( { grep -ohE "['\"][A-Z][A-Z_0-9]{2,}['\"]" frontend/js/api.js 2>/dev/null | tr -d "'\"" ; \
               grep -ohE "^[[:space:]]*[A-Z][A-Z_0-9]{2,}[[:space:]]*:" frontend/js/api.js 2>/dev/null | tr -d ' :' ; } \
             | sort -u | grep -E '^(INVALID_|LLM_|ASR_|DB_|PAYLOAD_|NOT_FOUND$|METHOD_|INTERNAL_|DUPLICATE$|HTTP_)' || true )
MAP_N=$(printf '%s\n' "$MAP_CODES" | grep -c . || true)
CODE_N=$(codes_in_code | sort -u | grep -c . || true)
COVER_MISS=$(comm -23 <(codes_in_code | sort -u) <(printf '%s\n' "$MAP_CODES" | sort -u) 2>/dev/null | tr '\n' ' ')
if [ -z "${COVER_MISS// /}" ]; then
  ok "代码里 ${CODE_N} 个码（含 ASR 类）在前端映射表（${MAP_N} 个码）里都有对应中文 —— 这条不需要文档真源，纯代码内部自洽"
else
  ng "前端没有映射的码：$COVER_MISS（D23 §3.1b 就是这一类：英文码被原样显示给用户）"
fi

# ============================================================ 汇总
say "结果"
printf '通过 %s%d%s / 失败 %s%d%s / 跳过 %s%d%s\n' "$G" "$PASS" "$OFF" "$R" "$FAIL" "$OFF" "$Y" "$SKIP" "$OFF"
if [ "$N" != "$TOTAL" ]; then
  printf '%s⚠ 只跑了 %d 项，应为 %d 项 —— 脚本有漏项，按失败计%s\n' "$R" "$N" "$TOTAL" "$OFF"
  FAIL=$((FAIL + 1))
fi
if [ "$SKIP" != "0" ]; then
  printf '%s跳过项不算通过：它意味着「这一项没有拿到证据」%s\n' "$Y" "$OFF"
fi
if [ "$FAIL" = "0" ] && [ "$SKIP" = "0" ]; then
  printf '%s全部通过%s\n' "$G" "$OFF"
fi

cat <<'EOF'

—— 附：本地开发注意（不占检查项编号）——
L1 页面必须走本地服务：cd frontend && python serve.py → http://localhost:8010/pages/topics.html
   不许双击 HTML（file:// 下 fetch 被拦，页面数据加载不出来）
L2 本机有 http_proxy 环境变量：自测本机服务要 curl --noproxy '*'，
   无头 Chrome 建议 --no-proxy-server
EOF

exit $((FAIL + SKIP))
