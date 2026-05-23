#!/usr/bin/env bash
# GlassVein OpenCode Router 首次验收测试
# !! DEPRECATED: references removed crate `glassvein-opencode-router`.
# !! The opencode integration is now at integrations/opencode/plugin/ (TypeScript).
# !! This script is kept for reference only and will NOT run as-is.
# 用法: bash acceptance-test.sh

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
LOG_DIR="/workspace/OSG-Project/.tmp/glassvein-opencode-acceptance-$(date +%Y%m%d-%H%M%S)"
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

# 步骤 1: 启动 Rust Router
info "=== 步骤 1: 启动 Rust Router ==="
cargo run -p glassvein-opencode-router -- --port 0 --token test-token-123 > "$LOG_DIR/01-router.log" 2>&1 &
ROUTER_PID=$!
sleep 2

# 从日志中提取 readiness JSON
if [ -f "$LOG_DIR/01-router.log" ]; then
    # 提取 JSON 行（查找包含 "port" 的行）
    READINESS_JSON=$(grep '"port"' "$LOG_DIR/01-router.log" 2>/dev/null | head -1 || echo "")
    if [ -n "$READINESS_JSON" ]; then
        info "Router readiness JSON: $READINESS_JSON"
        # 提取端口和 token
        ROUTER_PORT=$(echo "$READINESS_JSON" | grep -o '"port":[0-9]*' | cut -d: -f2)
        ROUTER_TOKEN=$(echo "$READINESS_JSON" | grep -o '"token":"[^"]*"' | cut -d: -f2 | tr -d '"')
        ROUTER_WS_URL=$(echo "$READINESS_JSON" | grep -o '"ws_url":"[^"]*"' | cut -d: -f2- | tr -d '"')
        info "Router 端口: $ROUTER_PORT"
        info "Router Token: $ROUTER_TOKEN"
        info "Router WebSocket URL: $ROUTER_WS_URL"
    else
        fail "无法读取 Router readiness JSON"
        exit 1
    fi
else
    fail "Router 日志文件不存在"
    exit 1
fi

# 步骤 2: 启动第一个 client (模拟 workspace-a)
info "=== 步骤 2: 启动第一个 client (workspace-a) ==="
# 由于没有 TS client，使用 alpha-client 模拟
cargo run -p alpha-client -- --router-url ws://127.0.0.1:$ROUTER_PORT --node-id workspace-a-client > "$LOG_DIR/02-client-a.log" 2>&1 &
CLIENT_A_PID=$!
sleep 2

# 步骤 3: 启动第二个 client (模拟 workspace-b)
info "=== 步骤 3: 启动第二个 client (workspace-b) ==="
cargo run -p gamma-client -- --router-url ws://127.0.0.1:$ROUTER_PORT --node-id workspace-b-client > "$LOG_DIR/03-client-b.log" 2>&1 &
CLIENT_B_PID=$!
sleep 2

# 步骤 4: 收集日志
info "=== 步骤 4: 收集日志 ==="
info "Router PID: $ROUTER_PID"
info "Client A PID: $CLIENT_A_PID"
info "Client B PID: $CLIENT_B_PID"

# 等待进程完成
info "等待进程完成 (最多 30 秒)..."
timeout 30 wait || true

# 步骤 5: 验证结果
info "=== 步骤 5: 验证结果 ==="

# 检查 Router 是否成功启动
if grep -q "glassvein-opencode-router ready" "$LOG_DIR/01-router.log" 2>/dev/null; then
    pass "Router 启动成功"
else
    fail "Router 启动失败"
fi

# 检查 Client A 是否连接成功
if grep -q "WebSocket connected" "$LOG_DIR/02-client-a.log" 2>/dev/null; then
    pass "Client A 连接成功"
else
    fail "Client A 连接失败"
fi

# 检查 Client B 是否连接成功
if grep -q "WebSocket connected" "$LOG_DIR/03-client-b.log" 2>/dev/null; then
    pass "Client B 连接成功"
else
    fail "Client B 连接失败"
fi

# 检查 Hello 握手
if grep -q "Hello handshake complete" "$LOG_DIR/02-client-a.log" 2>/dev/null; then
    pass "Client A Hello 握手完成"
else
    fail "Client A Hello 握手失败"
fi

if grep -q "Hello handshake complete" "$LOG_DIR/03-client-b.log" 2>/dev/null; then
    pass "Client B Hello 握手完成"
else
    fail "Client B Hello 握手失败"
fi

# 检查 SessionUpdate 发送
if grep -q "SessionUpdate sent" "$LOG_DIR/02-client-a.log" 2>/dev/null; then
    pass "Client A SessionUpdate 发送成功"
else
    fail "Client A SessionUpdate 发送失败"
fi

if grep -q "SessionUpdate sent" "$LOG_DIR/03-client-b.log" 2>/dev/null; then
    pass "Client B SessionUpdate 发送成功"
else
    fail "Client B SessionUpdate 发送失败"
fi

# 步骤 6: 生成总结报告
info "=== 步骤 6: 生成总结报告 ==="

cat > "$LOG_DIR/summary.txt" << EOF
GlassVein OpenCode Router 首次验收测试报告
==========================================

执行时间: $(date)
日志目录: $LOG_DIR

Router 信息:
- PID: $ROUTER_PID
- 端口: $ROUTER_PORT
- Token: $ROUTER_TOKEN
- WebSocket URL: $ROUTER_WS_URL

Client 信息:
- Client A (workspace-a): PID $CLIENT_A_PID
- Client B (workspace-b): PID $CLIENT_B_PID

验证结果:
- Router 启动: $(grep -q "glassvein-opencode-router ready" "$LOG_DIR/01-router.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client A 连接: $(grep -q "WebSocket connected" "$LOG_DIR/02-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client B 连接: $(grep -q "WebSocket connected" "$LOG_DIR/03-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client A Hello 握手: $(grep -q "Hello handshake complete" "$LOG_DIR/02-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client B Hello 握手: $(grep -q "Hello handshake complete" "$LOG_DIR/03-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client A SessionUpdate: $(grep -q "SessionUpdate sent" "$LOG_DIR/02-client-a.log" 2>/dev/null && echo "PASS" || echo "FAIL")
- Client B SessionUpdate: $(grep -q "SessionUpdate sent" "$LOG_DIR/03-client-b.log" 2>/dev/null && echo "PASS" || echo "FAIL")

关键日志摘录:

Router 日志 (前 20 行):
$(head -20 "$LOG_DIR/01-router.log" 2>/dev/null || echo "(无日志)")

Client A 日志 (前 20 行):
$(head -20 "$LOG_DIR/02-client-a.log" 2>/dev/null || echo "(无日志)")

Client B 日志 (前 20 行):
$(head -20 "$LOG_DIR/03-client-b.log" 2>/dev/null || echo "(无日志)")
EOF

info "总结报告已生成: $LOG_DIR/summary.txt"

# 输出最终结果
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE} GlassVein OpenCode Router 首次验收测试完成${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "日志目录: ${YELLOW}$LOG_DIR${NC}"
echo ""
echo -e "Router 信息:"
echo -e "  PID: ${CYAN}$ROUTER_PID${NC}"
echo -e "  端口: ${CYAN}$ROUTER_PORT${NC}"
echo -e "  Token: ${CYAN}$ROUTER_TOKEN${NC}"
echo -e "  WebSocket URL: ${CYAN}$ROUTER_WS_URL${NC}"
echo ""
echo -e "Client 信息:"
echo -e "  Client A (workspace-a): PID ${CYAN}$CLIENT_A_PID${NC}"
echo -e "  Client B (workspace-b): PID ${CYAN}$CLIENT_B_PID${NC}"
echo ""

# 检查是否所有测试都通过
PASS_COUNT=0
FAIL_COUNT=0

for check in "glassvein-opencode-router ready" "WebSocket connected" "Hello handshake complete" "SessionUpdate sent"; do
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
