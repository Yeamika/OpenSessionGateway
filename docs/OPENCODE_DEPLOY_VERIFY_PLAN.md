<!-- historical / pre-cleanup: references packages/opencode-vein-plugin which is now at integrations/opencode/plugin/ -->
# OpenCode 部署验证方案

## 1. 概述

本文档描述 GlassVein + OpenSessionGateway 的部署验证方案。

**关键约束**: 部署/容器/osgssh 真实操作由 Server-Management 执行，GlassVein 管理侧只准备验证计划和证据清单。

**迁移文档**: 详见 `docs/OPENCODE_VEIN_PLUGIN_MIGRATION.md` (旧插件 -> 新插件迁移清单)

**无感使用**: 新插件 `@opensessiongateway/opencode-vein-plugin` 应无感替代旧插件，用户按原用法即可创建会话、addprompt、收到 session_update。

## 2. 目标拓扑与组件

```
┌─────────────────────────────────────────────────────────────────────┐
│  容器/服务器                                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  glassvein-opencode-router (Rust)                           │   │
│  │  - 复用 crates/router (RouterNode)                          │   │
│  │  - 接受 TS WS client 连接                                   │   │
│  │  - 可选: 连接主 GV 网络 (upstream)                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  opencode serve (TS)                                        │   │
│  │  - 加载 @opensessiongateway/opencode-vein-plugin            │   │
│  │  - 每工作区一个 WS 连接到 router                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  observer-surface (Rust)                                    │   │
│  │  - 订阅本地 tap 事件                                         │   │
│  │  - 监控 session_update                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  control-surface (Rust)                                     │   │
│  │  - 发送 addprompt 命令                                       │   │
│  │  - 跨域控制                                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 最小改动原则

### 3.1 Server-Management 负责

- 容器/服务器环境准备
- npm tgz 部署
- Rust binaries 部署
- 配置文件部署
- 服务启动/停止

### 3.2 GlassVein 管理侧负责

- 验证计划制定
- 证据清单准备
- 验证结果分析

### 3.3 最小改动清单

| 改动项 | 责任方 | 说明 |
|---|---|---|
| @opensessiongateway/opencode-vein-plugin@0.1.1 npm tgz 部署 | Server-Management | scoped 包，当前版本 |
| @opensessiongateway/glassvein-router npm tgz 部署 | Server-Management | scoped 包 |
| Rust binaries 部署 | Server-Management | `router`, `control-surface`, `observer-surface` |
| 配置文件 | Server-Management | 端口、上游 URL、日志级别 |
| 服务启动 | Server-Management | systemd/docker-compose/k8s |
| 验证执行 | GlassVein | osgssh 登录 + 命令执行 |

**注意**:
- 旧包 `@opensessiongateway/client-opencode-plugin-v2` 仅作参考/兼容，不作为新交付包
- `@opensessiongateway/opencode-vein-plugin@0.1.0` 标记为 PARTIAL，不作为最终通过版本

## 4. 前置制品清单

### 4.1 npm 包

| 制品 | 路径 | 状态 |
|---|---|---|
| `@opensessiongateway/opencode-vein-plugin-0.1.1.tgz` | `integrations/opencode/plugin/` | 待打包 |
| `@opensessiongateway/glassvein-router-0.1.0.tgz` | `packages/glassvein-router/` | 待打包 |

**注意**:
- 旧包 `@opensessiongateway/client-opencode-plugin-v2` 仅作参考/兼容，不作为新交付包
- `@opensessiongateway/opencode-vein-plugin@0.1.0` 标记为 PARTIAL，不作为最终通过版本

**打包命令**:
```bash
cd /workspace/OSG-Project/GlassVein

# 打包 @opensessiongateway/opencode-vein-plugin
cd integrations/opencode/plugin
npm pack

# 打包 @opensessiongateway/glassvein-router
cd packages/glassvein-router
cargo build --release -p router
./scripts/stage-local.sh
npm pack
```

### 4.2 Rust Binaries

| 制品 | 构建命令 | 状态 |
|---|---|---|
| `router` | `cargo build --release -p router` | 待构建 |
| `control-surface` | `cargo build --release -p control-surface` | 待构建 |
| `observer-surface` | `cargo build --release -p observer-surface` | 待构建 |
| `glassvein-opencode-router` | `cargo build --release -p glassvein-opencode-router` | 待构建 |

**一键构建**:
```bash
cd /workspace/OSG-Project/GlassVein
cargo build --release
```

### 4.3 配置文件

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `BIND_ADDR` | `127.0.0.1:7240` | Router 监听地址 |
| `TAP_CAPACITY` | `128` | tap 事件缓冲区大小 |
| `UPSTREAM_URL` | `""` | 可选: 主 GV 网络地址 |
| `LOG_LEVEL` | `info` | 日志级别 |

## 5. 验证步骤

### 5.1 Server-Management 执行

1. **部署 @opensessiongateway/opencode-vein-plugin@0.1.1 npm tgz**
   ```bash
   npm install -g @opensessiongateway/opencode-vein-plugin-0.1.1.tgz
   ```

2. **部署 @opensessiongateway/glassvein-router npm tgz**
   ```bash
   npm install -g @opensessiongateway/glassvein-router-0.1.0.tgz
   ```

3. **部署 Rust binaries**
   ```bash
   cp target/release/{router,control-surface,observer-surface,glassvein-opencode-router} /usr/local/bin/
   ```

4. **启动 glassvein-opencode-router**
   ```bash
   glassvein-opencode-router --bind-addr 127.0.0.1:7240 --tap-capacity 128
   ```

5. **启动 opencode serve + @opensessiongateway/opencode-vein-plugin**
   ```bash
   opencode serve --plugin @opensessiongateway/opencode-vein-plugin
   ```

### 5.2 GlassVein 验证 (通过 osgssh)

1. **登录容器**
   ```bash
   osgssh login <container-name>
   ```

2. **检查 router 运行状态**
   ```bash
   ps aux | grep glassvein-opencode-router
   curl -s http://127.0.0.1:7240/health || echo "no health endpoint"
   ```

3. **检查 @opensessiongateway/opencode-vein-plugin 加载**
   ```bash
   opencode plugins list | grep opencode-vein-plugin
   ```

4. **启动 observer-surface (监控 session_update)**
   ```bash
   observer-surface --router-url ws://127.0.0.1:7240 --kind-filter session_update &
   ```

5. **使用 oca 创建会话 (模型 mimov2.5)**
   ```bash
   oca create-session --model mimov2.5 --workspace test-workspace
   ```

6. **观察第一次 update (session 创建)**
   - observer-surface 应输出 `session_update` 事件
   - 检查字段: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`
   - 机制: plugin 发送 session_update → router 检测 kind → fan-out 给 ObserverSurface

7. **通过 addprompt 发送消息**
   ```bash
   control-surface \
     --router-url ws://127.0.0.1:7240 \
     --target test-workspace/runtime-1/session-1 \
     --command addprompt \
     --message "Hello from verification!" \
     --surface-id verify-control
   ```

8. **观察第二次 update (消息处理)**
   - observer-surface 应输出新的 `session_update` 事件
   - 检查字段: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`
   - 机制: 同第一次，router 自动广播

### 5.3 session_update 广播机制说明

**方案 A: Router 自动广播** (已确认)

- Plugin 发送 `target=this.address`（source=target=self），这是路由目标
- Router 检测 `kind == "session_update"` 后，额外 fan-out 给 ObserverSurface
- Observer 通过本地 tap 接收，不需要 plugin 设置 Broadcast target
- **这是 router 修复，不是 Server-Management 修复**

**observer log 检查字段**:
```json
{
  "type": "forward_peer",
  "summary": {
    "kind": "session_update",  ← 必须
    "source": "workspace-a/runtime-1/session-1",
    "target": "workspace-a/runtime-1/session-1"
  }
}
```

## 6. 证据清单

### 6.1 必须收集的证据

| 证据 | 收集方式 | PASS 判据 |
|---|---|---|
| router 启动日志 | `journalctl -u glassvein-router` 或 docker logs | 无错误，监听端口正确 |
| @opensessiongateway/opencode-vein-plugin 加载 | `opencode plugins list` | 插件已加载 |
| observer-surface 输出 | 终端输出或日志文件 | 收到至少 2 个 `session_update` |
| control-surface 输出 | 终端输出或日志文件 | 命令发送成功 |
| opencode serve 日志 | `journalctl -u opencode` 或 docker logs | 插件加载成功 |
| WS 连接状态 | `netstat -tlnp \| grep 7240` | 端口监听正常 |

### 6.2 证据文件命名

```
evidence/
├── 01-router-startup.log
├── 02-opencode-vein-plugin-load.log
├── 03-observer-first-update.log
├── 04-control-addprompt.log
├── 05-observer-second-update.log
├── 06-opencode-serve.log
└── 07-ws-connection-status.txt
```

## 7. PASS/FAIL 判据

### 7.1 PASS 条件

- [ ] glassvein-opencode-router 启动无错误
- [ ] @opensessiongateway/opencode-vein-plugin 加载成功
- [ ] observer-surface 收到第一次 `session_update` (session 创建)
  - 检查: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`
  - 机制: router 自动广播 (方案 A)
- [ ] control-surface 发送 addprompt 成功
- [ ] observer-surface 收到第二次 `session_update` (消息处理)
  - 检查: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`
  - 机制: router 自动广播 (方案 A)
- [ ] opencode serve + @opensessiongateway/opencode-vein-plugin 正常运行
- [ ] WS 连接稳定，无断连

### 7.2 FAIL 条件

- [ ] router 启动失败或崩溃
- [ ] @opensessiongateway/opencode-vein-plugin 加载失败
- [ ] observer-surface 未收到任何事件
- [ ] observer-surface 收到事件但 `kind` 不是 `session_update`
- [ ] control-surface 命令发送失败
- [ ] opencode serve 无法加载插件
- [ ] WS 连接频繁断开

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| @opensessiongateway/opencode-vein-plugin 未创建 | 无法部署 | 等待 MIMO-2 创建后打包 |
| npm tgz 未打包 | 无法部署 | 提前打包并移交 Server-Management |
| Rust binaries 未构建 | 无法部署 | 提前构建 release 版本 |
| 容器环境不兼容 | 部署失败 | 提前确认容器镜像和依赖 |
| WS 连接超时 | 验证失败 | 调整超时参数，重试机制 |
| 插件加载失败 | opencode 无法使用 | 检查插件路径和权限 |

## 9. 责任分工

| 任务 | 责任方 | 说明 |
|---|---|---|
| 验证计划制定 | GlassVein | 本文档 |
| 证据清单准备 | GlassVein | 第 6 节 |
| npm tgz 打包 | GlassVein | `npm pack` |
| Rust binaries 构建 | GlassVein | `cargo build --release` |
| 容器/服务器部署 | Server-Management | osgssh + systemd/docker |
| 验证执行 | GlassVein (通过 osgssh) | 远程执行命令 |
| 验证结果分析 | GlassVein | PASS/FAIL 判定 |

## 10. 文件结构

```
GlassVein/
├── packages/
│   ├── glassvein-router/         # npm 路由包
│   └── opencode-vein-plugin/     # npm 插件包 (待创建)
├── crates/
│   ├── router/                   # Rust router
│   ├── control-surface/          # 控制面
│   ├── observer-surface/         # 观察面
│   └── glassvein-opencode-router/ # opencode 路由器
├── docs/
│   └── OPENCODE_DEPLOY_VERIFY_PLAN.md  # 本文档
└── evidence/                     # 验证证据 (待创建)
```
