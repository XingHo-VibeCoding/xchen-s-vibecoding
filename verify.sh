#!/usr/bin/env bash
# =============================================================================
# verify.sh · Day 17 板块④：真库验证（自动跑，你只需看输出）
# =============================================================================
# 干什么：
#   1. 打公网 /api/sessions 与 /api/favorites，看返回形状对不对
#   2. 验参数化：topicId 过滤、limit 限制、非法参数被挡
#   3. ★ 清单完成标准：改一行数据库数据 → 刷新接口 → 返回跟着变
#   4. ★ Day 18 补：本次验证发出了多少次数据库请求（资源点怎么算，见第 7 项）
#
# 用法：bash verify.sh
# =============================================================================

BASE="https://cxj1528-d4g55ng0o54cbe296-1499954233.ap-shanghai.app.tcloudbase.com"
ENV="cxj1528-d4g55ng0o54cbe296"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
FAILED=0

# jq 未必装了，退化成python 解析
jqq() { python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

# ★ Day 18 加：取一个字段的带重试版。
#   为什么需要：verify.sh 有 20 多次公网请求，任何一次抖动（curl 超时、
#   网关偶发 502）都会让变量变成空串，然后报出一句**与真实原因无关的 FAIL**
#   ——实测出现过「topicId=T1 得到 ''」，而重跑就是好的。
#   → 网络抖动不该被记成「接口有问题」，重试三次再判。
#
# ★★ 第 3 个参数是「**额外**算有效的值」（默认只有非空）：
#   有些检查要的答案**恰好是** None —— B6 验「中途退出的场次 endedAt 必须是
#   null」，python 打印 None 就是 'None'；库里也确实有 nickname 为 null 的行
#   （S-MOCK-03）。不区分的话那些检查会永远失败。
#
#   ★★ 第一版我把语义写反了（写成「只有第 3 参数才算有效」），
#      结果 nickname 取不到 → 返回空串 → 第 6 项拿空串去改库，
#      **把 S-MOCK-01 的昵称永久写空**。判据是「非空 **或者** 等于 $3」。
getf() { # $1=URL  $2=python 表达式  $3=额外的有效值
  local v=""
  for _ in 1 2 3; do
    v=$(curl -s --max-time 25 "$1" | jqq "$2")
    if [ -n "$v" ] && { [ -z "${3:-}" ] || [ "$v" != "None" ] || [ "$v" = "$3" ]; }; then
      echo "$v"; return 0
    fi
    sleep 1
  done
  echo ""
}

# ★纯数字判定（Day 18 修）：原来用 grep -qx '[0-9]'，
#   只能匹配**一位数**——count 一旦变成 10 就会误判成「缺失」。
isnum() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

say "1. GET /api/sessions"
R=$(curl -s --max-time 25 "$BASE/api/sessions")
echo "$R" | head -c 600; echo
echo "$R" | jqq "d['ok']"  >/dev/null 2>&1 && ok "返回的是合法 JSON 且带 ok 字段" || bad "返回不是预期的 JSON"
CNT=$(getf "$BASE/api/sessions" "d['data']['count']")
isnum "$CNT" && ok "data.count 存在：$CNT" || bad "data.count 缺失"

say "2. GET /api/favorites"
R2=$(curl -s --max-time 25 "$BASE/api/favorites")
echo "$R2" | head -c 600; echo
CNT2=$(getf "$BASE/api/favorites" "d['data']['count']")
isnum "$CNT2" && ok "data.count 存在：$CNT2" || bad "data.count 缺失"

say "3. 参数化验证"
N=$(getf "$BASE/api/sessions?topicId=T1" "d['data']['count']")
[ "$N" = "2" ] && ok "topicId=T1 过滤出 $N 场（库里 T1 只有 2场）" || bad "topicId=T1 得到 '$N'，应为 2"
L=$(getf "$BASE/api/sessions?limit=1" "d['data']['count']")
[ "$L" = "1" ] && ok "limit=1 只返回 $L 条" || bad "limit=1 得到 '$L' 条"
E=$(getf "$BASE/api/sessions?topicId=T9" "d['error']['code']")
[ "$E" = "INVALID_PARAMS" ] && ok "非法 topicId=T9 被挡下（错误码 $E）" || bad "非法参数没被挡住，得到 '$E'"
E2=$(getf "$BASE/api/sessions?limit=abc" "d['error']['code']")
[ "$E2" = "INVALID_PARAMS" ] && ok "非法 limit=abc 被挡下（错误码 $E2）" || bad "非法 limit 没被挡住，得到 '$E2'"

say "4. 中途退出的场次（B6：endedAt 必须是 null，不能是字符串）"
# ★ 第 3 个参数传 'None'：这条要的答案**就是** None，不能被getf 当成「取不到」
[ "$(getf "$BASE/api/sessions" "[s for s in d['data']['sessions'] if s['aborted']][0]['endedAt']" "None")" = "None" ] \
  && ok "中途退出的那场 endedAt = null" || bad "中途退出的 endedAt 不是 null"

say "5. 偏题/精彩句子的 correction 必须是 null，逻辑错误必须有改法（B7）"
# ★ Day 18 修：原来写成
#     [i['correction'] is None for i in ... if i['type']!='logic']
#   那是一条**布尔列表**，打印出来是 "[True, True]"，
#   再去 grep -qx 'True' 比对永远不成立 → **判据本身是坏的**，
#   数据完全合规也报 FAIL。正确写法是 all(...) 收成一个布尔值。
B7=$(getf "$BASE/api/favorites" "all(i['correction'] is None for i in d['data']['items'] if i['type']!='logic')")
[ "$B7" = "True" ] && ok "非 logic 类型条目的 correction 全是 null" || bad "有非 logic 条目的 correction 不是 null（判据读到 '$B7'）"

B7B=$(getf "$BASE/api/favorites" "all(i['correction'] is not None for i in d['data']['items'] if i['type']=='logic')")
[ "$B7B" = "True" ] && ok "logic 类型条目的 correction 都有改法（B7 反面）" || bad "有 logic 条目的 correction 是 null"

say "6. ★ 改一行数据 → 接口跟着变（清单完成标准）"
#★ 先确认接口真的能读到数据再动库。
#   这个顺序不能反：接口读不到时 nickname 取到的是空串，
#   若照样执行 UPDATE 再用空串改回，**原值就被永久写成空字符串了**
#   （Day 17 首跑时 S-MOCK-01 的 nickname 恰好本就是空，才没出事——
#    在有真实昵称的库上跑这脚本会真丢数据）。
PROBE=$(getf "$BASE/api/sessions" "d['data']['count']")
if [ -z "$PROBE" ]; then
  bad "接口还读不到数据，跳过本步（**没有动库**）"
  say "结果"
  printf '\033[31m有项目未通过\033[0m\n'
  exit $FAILED
fi

# ★★ Day 18 补的第二道保护：接口能读**不等于**这一行取到了。
#   实测过一次真实事故：getf 的重试逻辑写错，S-MOCK-01 的 nickname 取成空串，
#   脚本却照样往下走，用空串把库里的「小陈」覆盖成空 —— **原值永久丢失**。
#   → 动库之前必须确认「原值取到了」，否则一步都不许动。
BEFORE=$(getf "$BASE/api/sessions" "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]" "None")
if [ -z "$BEFORE" ]; then
  bad "取不到 S-MOCK-01 的 nickname 原值，跳过本步（**没有动库**）"
  say "结果"
  printf '\033[31m有项目未通过\033[0m\n'
  exit $FAILED
fi

echo "  改之前 S-MOCK-01 的 nickname = '$BEFORE'"
MARK="验证戳$(date +%H%M%S)"
echo "  现在把库里的 nickname 改成 '$MARK' …"
# ★ 昵称里可能有单引号（O'Brien），直接插进 SQL 会破语句。
#   这里只用「自己刚生成的时间戳」去改，不动原值 —— 但恢复那步要写原值，
#   所以恢复用参数化（见下）。
tcb db execute -e "$ENV" --sql "UPDATE sessions SET nickname='$MARK' WHERE session_id='S-MOCK-01'" >/dev/null 2>&1
sleep 1
AFTER=$(getf "$BASE/api/sessions" "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]" "None")
echo "  改之后 = '$AFTER'"
[ "$AFTER" = "$MARK" ] && ok "接口跟着库里的变化返回了（不是缓存的旧值）" || bad "改了库但接口仍返回 '$AFTER'"
echo "  改回原值…"
# ★ 恢复这步必须处理「原值含单引号」与「原值本来就是 NULL」两种情况：
#   · 含单引号（O'Brien）→ 直接插值会破 SQL，必须转义
#   · 本来是 NULL →接口返回 null，要写 SQL NULL 而不是字符串 'None'
#   两件事Day 17 都没想到，直到 Day 18 真的把昵称写成空才发现。
ESCAPED=$(printf '%s' "$BEFORE" | sed "s/'/''/g")
if [ "$BEFORE" = "None" ]; then
  tcb db execute -e "$ENV" --sql "UPDATE sessions SET nickname=NULL WHERE session_id='S-MOCK-01'" >/dev/null 2>&1
else
  tcb db execute -e "$ENV" --sql "UPDATE sessions SET nickname='$ESCAPED' WHERE session_id='S-MOCK-01'" >/dev/null 2>&1
fi
RESTORED=$(getf "$BASE/api/sessions" "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]" "None")
[ "$RESTORED" = "$BEFORE" ] && ok "已改回'$BEFORE'" || echo "  ⚠️ 改回失败，当前是 '$RESTORED'（原本 '$BEFORE'）。请手动执行：UPDATE sessions SET nickname='$ESCAPED' WHERE session_id='S-MOCK-01';"

# -----------------------------------------------------------------------------
# 7. 本次验证发了多少库请求（Day 18 新增）
#
# 为什么加这一项：PG 按「5 分钟窗口」计费（342 点/(核·小时)，共享实例 0.5 核
# → 一个活跃窗口 ≈ 14.25 点）。免费版 3000 点/月 ≈ 210 个窗口 ≈ 17.5 小时/月。
# 知道自己一轮验证烧多少点，才知道还能验多少次。
#
# 它**不连真库**：把 write 的 httpdb 换成只记录不发请求的模块，
# 再发真请求看记录里有几条 —— 目的是「数发了几次」。
# -----------------------------------------------------------------------------
say "7. 本次验证发出了多少次数据库请求（不连真库，只数次数）"
# node 路径：优先用托管版（隔离环境），找不到再退回 PATH 里的 node
NODE_BIN="C:/Users/26629/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
[ -x "$NODE_BIN" ] || NODE_BIN="node"

if [ -f ".count-db-requests.js" ] && command -v "$NODE_BIN" >/dev/null 2>&1; then
  "$NODE_BIN" .count-db-requests.js
  [ $? -eq 0 ] || bad "库请求计数有项目未通过（见上）"
else
  echo "  跳过：找不到 .count-db-requests.js 或 node"
fi

say "结果"
[ "$FAILED" = "0" ] && printf '\033[32m全部通过\033[0m\n' || printf '\033[31m有项目未通过\033[0m\n'
exit $FAILED
