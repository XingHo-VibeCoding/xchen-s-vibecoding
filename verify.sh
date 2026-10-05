#!/usr/bin/env bash
# =============================================================================
# verify.sh · Day 17 板块④：真库验证（自动跑，你只需看输出）
# =============================================================================
# 干什么：
#   1. 打公网 /api/sessions 与 /api/favorites，看返回形状对不对
#   2. 验参数化：topicId 过滤、limit 限制、非法参数被挡
#   3. ★ 清单完成标准：改一行数据库数据 → 刷新接口 → 返回跟着变
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

say "1. GET /api/sessions"
R=$(curl -s --max-time 25 "$BASE/api/sessions")
echo "$R" | head -c 600; echo
echo "$R" | jqq "d['ok']"  >/dev/null 2>&1 && ok "返回的是合法 JSON 且带 ok 字段" || bad "返回不是预期的 JSON"
echo "$R" | jqq "d['data']['count']" | grep -qx '[0-9]' && ok "data.count 存在：$(echo "$R" | jqq "d['data']['count']")" || bad "data.count 缺失"

say "2. GET /api/favorites"
R2=$(curl -s --max-time 25 "$BASE/api/favorites")
echo "$R2" | head -c 600; echo
echo "$R2" | jqq "d['data']['count']" | grep -qx '[0-9]' && ok "data.count 存在：$(echo "$R2" | jqq "d['data']['count']")" || bad "data.count 缺失"

say "3. 参数化验证"
N=$(curl -s --max-time 25 "$BASE/api/sessions?topicId=T1" | jqq "d['data']['count']")
[ "$N" = "2" ] && ok "topicId=T1 过滤出 $N 场（库里 T1 只有 2场）" || bad "topicId=T1 得到 '$N'，应为 2"
L=$(curl -s --max-time 25 "$BASE/api/sessions?limit=1" | jqq "d['data']['count']")
[ "$L" = "1" ] && ok "limit=1 只返回 $L 条" || bad "limit=1 得到 '$L' 条"
E=$(curl -s --max-time 25 "$BASE/api/sessions?topicId=T9" | jqq "d['error']['code']")
[ "$E" = "INVALID_PARAMS" ] && ok "非法 topicId=T9 被挡下（错误码 $E）" || bad "非法参数没被挡住，得到 '$E'"
E2=$(curl -s --max-time 25 "$BASE/api/sessions?limit=abc" | jqq "d['error']['code']")
[ "$E2" = "INVALID_PARAMS" ] && ok "非法 limit=abc 被挡下（错误码 $E2）" || bad "非法 limit 没被挡住，得到 '$E2'"

say "4. 中途退出的场次（B6：endedAt 必须是 null，不能是字符串）"
curl -s --max-time 25 "$BASE/api/sessions" | jqq "[s for s in d['data']['sessions'] if s['aborted']][0]['endedAt']" | grep -qx 'None' \
  && ok "中途退出的那场 endedAt = null" || bad "中途退出的 endedAt 不是 null"

say "5. 偏题/精彩句子的 correction 必须是 null（B7）"
curl -s --max-time 25 "$BASE/api/favorites" | jqq "[i['correction'] is None for i in d['data']['items'] if i['type']!='logic']" | grep -qx 'True' \
  && ok "非 logic 类型条目的 correction 全是 null" || bad "有非 logic 条目的correction 不是 null"

say "6. ★ 改一行数据 → 接口跟着变（清单完成标准）"
#★ 先确认接口真的能读到数据再动库。
#   这个顺序不能反：接口读不到时 nickname 取到的是空串，
#   若照样执行 UPDATE 再用空串改回，**原值就被永久写成空字符串了**
#   （Day 17 首跑时 S-MOCK-01 的 nickname 恰好本就是空，才没出事——
#    在有真实昵称的库上跑这脚本会真丢数据）。
PROBE=$(curl -s --max-time 25 "$BASE/api/sessions" | jqq "d['data']['count']")
if [ -z "$PROBE" ]; then
  bad "接口还读不到数据，跳过本步（**没有动库**）"
  say "结果"
  printf '\033[31m有项目未通过\033[0m\n'
  exit $FAILED
fi

BEFORE=$(curl -s --max-time 25 "$BASE/api/sessions" | jqq "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]")
echo "  改之前 S-MOCK-01 的 nickname = '$BEFORE'"
MARK="验证戳$(date +%H%M%S)"
echo "  现在把库里的 nickname 改成 '$MARK' …"
tcb db execute -e "$ENV" --sql "UPDATE sessions SET nickname='$MARK' WHERE session_id='S-MOCK-01'" >/dev/null 2>&1
sleep 1
AFTER=$(curl -s --max-time 25 "$BASE/api/sessions" | jqq "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]")
echo "  改之后 = '$AFTER'"
[ "$AFTER" = "$MARK" ] && ok "接口跟着库里的变化返回了（不是缓存的旧值）" || bad "改了库但接口仍返回 '$AFTER'"
echo "  改回原值…"
tcb db execute -e "$ENV" --sql "UPDATE sessions SET nickname='$BEFORE' WHERE session_id='S-MOCK-01'" >/dev/null 2>&1
RESTORED=$(curl -s --max-time 25 "$BASE/api/sessions" | jqq "[s['nickname'] for s in d['data']['sessions'] if s['sessionId']=='S-MOCK-01'][0]")
[ "$RESTORED" = "$BEFORE" ] && ok "已改回'$BEFORE'" || echo "  ⚠️ 改回失败，当前是 '$RESTORED'，请手动执行：UPDATE sessions SET nickname='$BEFORE' WHERE session_id='S-MOCK-01';"

say "结果"
[ "$FAILED" = "0" ] && printf '\033[32m全部通过\033[0m\n' || printf '\033[31m有项目未通过\033[0m\n'
exit $FAILED
