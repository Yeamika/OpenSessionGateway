#!/usr/bin/env bash
# GlassVein OpenCode Router 完整验收测试
# !! DEPRECATED: references removed crate `glassvein-opencode-router` and old
# !! crate names `observer-surface` / `control-surface`.
# !! Replacements:
# !!   glassvein-opencode-router → removed (integrations/opencode/plugin)
# !!   observer-surface          → surface-viewer (endpoint)
# !!   control-surface           → control-endpoint (endpoint)
# 覆盖：TS client、observer-surface、control-surface、GV router 连接

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# 创建日志目录
LOG_DIR="/workspace/OSG-Project/.tmp/glassvein-opencode-full-acceptance-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
info "日志目录: $LOG_DIR"

# 清理函数
cleanup() {
    info "清理后台进程..."
    jobs -p 2>/dev/null | xargs -r kill 2>/dev/null || true
    wait 2>/dev/null || true
    info "清理完成"
}
trap cleanup EXIT

# 步骤 1: 启动主 GV Router
info "=== 步骤 1: 启动主 GV Router ==="
cargo run -p router -- --node-id root-router --bind-addr 127.0.0.1:7200 --tap-capacity 128 > "$LOG_DIR/01-gv-router.log" 2>&1 &
GV_ROUTER_PID=$!
sleep 2

# 检查 GV Router 是否成功启动
if grep -q "router started" "$LOG_DIR/01-gv-router.log" 2>/dev/null; then
    pass "GV Router 启动成功"
    GV_ROUTER_PORT=7200
    GV_ROUTER_URL="ws://127.0.0.1:7200"
else
    fail "GV Router 启动失败"
    exit 1
fi

# 步骤 2: 启动 opencode-router（连接到 GV Router）
info "=== 步骤 2: 启动 opencode-router ==="
cargo run -p glassvein-opencode-router -- --port 0 --token test-token-123 --gv-router-url ws://127.0.0.1:7200 > "$LOG_DIR/02-opencode-router.log" 2>&1 &
OPENCODE_ROUTER_PID=$!
sleep 2

# 从日志中提取 readiness JSON
if [ -f "$LOG_DIR/02-opencode-router.log" ]; then
    READINESS_JSON=$(grep '"port"' "$LOG_DIR/02-opencode-router.log" 2>/dev/null | head -1 || echo "")
    if [ -n "$READINESS_JSON" ]; then
        info "opencode-router readiness JSON: $READINESS_JSON"
        OPENCODE_ROUTER_PORT=$(echo "$READINESS_JSON" | grep -o '"port":[0-9]*' | cut -d: -f2)
        OPENCODE_ROUTER_TOKEN=$(echo "$READINESS_JSON" | grep -o '"token":"[^"]*"' | cut -d: -f2 | tr -d '"')
        OPENCODE_ROUTER_WS_URL=$(echo "$READINESS_JSON" | grep -o '"ws_url":"[^"]*"' | cut -d: -f2- | tr -d '"')
        info "opencode-router 端口: $OPENCODE_ROUTER_PORT"
        info "opencode-router Token: $OPENCODE_ROUTER_TOKEN"
        info "opencode-router WebSocket URL: $OPENCODE_ROUTER_WS_URL"
    else
        fail "无法读取 opencode-router readiness JSON"
        exit 1
    fi
else
    fail "opencode-router 日志文件不存在"
    exit 1
fi

# 步骤 3: 启动 observer-surface 连接到 GV Router
info "=== 步骤 3: 启动 observer-surface ==="
cargo run -p observer-surface -- --router-url ws://127.0.0.1:7200 --kind-filter session_update > "$LOG_DIR/03-observer-surface.log" 2>&1 &
OBSERVER_PID=$!
sleep 2

# 检查 observer-surface 是否成功连接
if grep -q "connected to" "$LOG_DIR/03-observer-surface.log" 2>/dev/null; then
    pass "observer-surface 连接成功"
else
    fail "observer-surface 连接失败"
fi

# 步骤 4: 启动 control-surface 连接到 GV Router
info "=== 步骤 4: 启动 control-surface ==="
cargo run -p control-surface -- --router-url ws://127.0.0.1:7200 --target domain-a/runtime-alpha/session-alpha --command addprompt --message "Hello from control-surface" > "$LOG_DIR/04-control-surface.log" 2>&1 &
CONTROL_PID=$!
sleep 2

# 检查 control-surface 是否成功连接
if grep -q "connected to" "$LOG_DIR/04-control-surface.log" 2>/dev/null; then
    pass "control-surface 连接成功"
else
    fail "control-surface 连接失败"
fi

# 步骤 5: 启动 TS client 连接到 opencode-router
info "=== 步骤 5: 启动 TS client (workspace-a) ==="
cargo run -p alpha-client -- --router-url ws://127.0.0.1:$OPENCODE_ROUTER_PORT --node-id workspace-a-client > "$LOG_DIR/05-ts-client-a.log" 2>&1 &
TS_CLIENT_A_PID=$!
sleep 2

# 检查 TS client 是否成功连接
if grep -q "WebSocket connected" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null; then
    pass "TS client A 连接成功"
else
    fail "TS client A 连接失败"
fi

# 步骤 6: 启动第二个 TS client 连接到 opencode-router
info "=== 步骤 6: 启动 TS client (workspace-b) ==="
cargo run -p gamma-client -- --router-url ws://127.0.0.1:$OPENCODE_ROUTER_PORT --node-id workspace-b-client > "$LOG_DIR/06-ts-client-b.log" 2>&1 &
TS_CLIENT_B_PID=$!
sleep 2

# 检查 TS client 是否成功连接
if grep -q "WebSocket connected" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null; then
    pass "TS client B 连接成功"
else
    fail "TS client B 连接失败"
fi

# 步骤 7: 等待进程完成
info "=== 步骤 7: 等待进程完成 ==="
info "等待进程完成 (最多 30 秒)..."
sleep 10

# 步骤 8: 验证结果
info "=== 步骤 8: 验证结果 ==="

# 检查 GV Router 是否成功启动
if grep -q "router started" "$LOG_DIR/01-gv-router.log" 2>/dev/null; then
    pass "GV Router 启动成功"
else
    fail "GV Router 启动失败"
fi

# 检查 opencode-router 是否成功启动
if grep -q "glassvein-opencode-router ready" "$LOG_DIR/02-opencode-router.log" 2>/dev/null; then
    pass "opencode-router 启动成功"
else
    fail "opencode-router 启动失败"
fi

# 检查 opencode-router 是否连接到 GV Router
if grep -q "registered with GV router" "$LOG_DIR/02-opencode-router.log" 2>/dev/null; then
    pass "opencode-router 连接 GV Router 成功"
else
    fail "opencode-router 连接 GV Router 失败"
fi

# 检查 observer-surface 是否连接成功
if grep -q "connected to" "$LOG_DIR/03-observer-surface.log" 2>/dev/null; then
    pass "observer-surface 连接成功"
else
    fail "observer-surface 连接失败"
fi

# 检查 control-surface 是否连接成功
if grep -q "connected to" "$LOG_DIR/04-control-surface.log" 2>/dev/null; then
    pass "control-surface 连接成功"
else
    fail "control-surface 连接失败"
fi

# 检查 TS client A 是否连接成功
if grep -q "WebSocket connected" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null; then
    pass "TS client A 连接成功"
else
    fail "TS client A 连接失败"
fi

# 检查 TS client B 是否连接成功
if grep -q "WebSocket connected" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null; then
    pass "TS client B 连接成功"
else
    fail "TS client B 连接失败"
fi

# 检查 TS client A Hello 握手
if grep -q "Hello handshake complete" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null; then
    pass "TS client A Hello 握手完成"
else
    fail "TS client A Hello 握手失败"
fi

# 检查 TS client B Hello 握手
if grep -q "Hello handshake complete" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null; then
    pass "TS client B Hello 握手完成"
else
    fail "TS client B Hello 握手失败"
fi

# 检查 TS client A SessionUpdate 发送
if grep -q "SessionUpdate sent" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null; then
    pass "TS client A SessionUpdate 发送成功"
else
    fail "TS client A SessionUpdate 发送失败"
fi

# 检查 TS client B SessionUpdate 发送
if grep -q "SessionUpdate sent" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null; then
    pass "TS client B SessionUpdate 发送成功"
else
    fail "TS client B SessionUpdate 发送失败"
fi

# 步骤 9: 生成总结报告
info "=== 步骤 9: 生成总结报告 ==="

cat > "$LOG_DIR/summary.txt" << EOF
GlassVein OpenCode Router 完整验收测试报告
==========================================

执行时间: $(date)
日志目录: $LOG_DIR

Router 信息:
- GV Router PID: $GV_ROUTER_PID
- GV Router 端口: $GV_ROUTER_PORT
- GV Router WebSocket URL: $GV_ROUTER_URL
- opencode-router PID: $OPENCODE_ROUTER_PID
- opencode-router 端口: $OPENCODE_ROUTER_PORT
- opencode-router Token: $OPENCODE_ROUTER_TOKEN
- opencode-router WebSocket URL: $OPENCODE_ROUTER_WS_URL

Client 信息:
- observer-surface PID: $OBSERVER_PID
- control-surface PID: $CONTROL_PID
- TS Client A (workspace-a): PID $TS_CLIENT_A_PID
- TS Client B (workspace-b): PID $TS_CLIENT_B_PID

验证结果:
- GV Router 启动: $(grep -q "router started" "$LOG_DIR/01-gv-router.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- opencode-router 启动: $(grep -q "glassvein-opencode-router ready" "$LOG_DIR/02-opencode-router.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- opencode-router 连接 GV Router: $(grep -q "registered with GV router" "$LOG_DIR/02-opencode-router.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- observer-surface 连接: $(grep -q "connected to" "$LOG_DIR/03-observer-surface.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- control-surface 连接: $(grep -q "connected to" "$LOG_DIR/04-control-surface.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client A 连接: $(grep -q "WebSocket connected" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client B 连接: $(grep -q "WebSocket connected" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client A Hello 握手: $(grep -q "Hello handshake complete" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client B Hello 握手: $(grep -q "Hello handshake complete" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client A SessionUpdate: $(grep -q "SessionUpdate sent" "$LOG_DIR/05-ts-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- TS Client B SessionUpdate: $(grep -q "SessionUpdate sent" "$LOG_DIR/06-ts-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")

关键日志摘录:

GV Router 日志 (前 20 行):
$(head -20 "$LOG_DIR/01-gv-router.log" 2>/dev/null || echo "(无日志)")

opencode-router 日志 (前 20 行):
$(head -20 "$LOG_DIR/02-opencode-router.log" 2>/dev/null || echo "(无日志)")

observer-surface 日志 (前 20 行):
$(head -20 "$LOG_DIR/03-observer-surface.log" 2>/dev/null || echo "(无日志)")

control-surface 日志 (前 20 行):
$(head -20 "$LOG_DIR/04-control-surface.log" 2>/dev/null || echo "(无日志)")

TS Client A 日志 (前 20 行):
$(head -20 "$LOG_DIR/05-ts-client-a.log" 2>/dev/null || echo "(无日志)")

TS Client B 日志 (前 20 行):
$(head -20 "$LOG_DIR/06-ts-client-b.log" 2>/dev/null || echo "(无日志)")
EOF

info "总结报告已生成: $LOG_DIR/summary.txt"

# 输出最终结果
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE} GlassVein OpenCode Router 完整验收测试完成${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "日志目录: ${YELLOW}$LOG_DIR${NC}"
echo ""
echo -e "Router 信息:"
echo -e "  GV Router PID: ${CYAN}$GV_ROUTER_PID${NC}"
echo -e "  GV Router 端口: ${CYAN}$GV_ROUTER_PORT${NC}"
echo -e "  GV Router WebSocket URL: ${CYAN}$GV_ROUTER_URL${NC}"
echo -e "  opencode-router PID: ${CYAN}$OPENCODE_ROUTER_PID${NC}"
echo -e "  opencode-router 端口: ${CYAN}$OPENCODE_ROUTER_PORT${NC}"
echo -e "  opencode-router Token: ${CYAN}$OPENCODE_ROUTER_TOKEN${NC}"
echo -e "  opencode-router WebSocket URL: ${CYAN}$OPENCODE_ROUTER_WS_URL${NC}"
echo ""
echo -e "Client 信息:"
echo -e "  observer-surface PID: ${CYAN}$OBSERVER_PID${NC}"
echo -e "  control-surface PID: ${CYAN}$CONTROL_PID${NC}"
echo -e "  TS Client A (workspace-a): PID ${CYAN}$TS_CLIENT_A_PID${NC}"
echo -e "  TS Client B (workspace-b): PID ${CYAN}$TS_CLIENT_B_PID${NC}"
echo ""

# 检查是否所有测试都通过
PASS_COUNT=0
FAIL_COUNT=0

for check in "router started" "glassvein-opencode-router ready" "registered with GV router" "connected to" "WebSocket connected" "Hello handshake complete" "SessionUpdate sent"; do
    if grep -q "$check" "$LOG_DIR"/*.log 2>/dev/null; then
        ((PASS_COUNT++))
    else
        ((FAIL_COUNT++))
    fi
done

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN} 验收测试结果: PASS ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
else
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED} 验收测试结果: FAIL ($PASS_COUNT/$((PASS_COUNT + FAIL_COUNT)))${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
fi
