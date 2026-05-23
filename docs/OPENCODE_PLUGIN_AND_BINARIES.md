<!-- historical / pre-cleanup: many paths and binary names below are outdated. See README.md and AGENTS.md for current canonical structure. Key changes: clientlib/clientroute → osgp-client, control-surface → control-endpoint, observer-surface → surface-viewer, requestion-surface → requestion-endpoint, glassvein-opencode-router removed from workspace. -->

# OpenCode Plugin & Binaries — 交付说明清单

## 1. 概述

本文档记录 GlassVein + @opensessiongateway/opencode-vein-plugin 的交付制品清单。

**注意**: npm 发布由 Server-Management 负责，GlassVein 管理侧不自行 npm publish。

### 新包说明

- **新包名**: `@opensessiongateway/opencode-vein-plugin`
- **当前版本**: `0.1.1`
- **无 scope 版本**: 已废弃/不可发布，不再使用
- **旧包参考**: `@opensessiongateway/client-opencode-plugin-v2` (仅作参考/兼容，不作为新交付包)

### 版本历史

| 版本 | 状态 | 说明 |
|---|---|---|
| `0.1.0` | PARTIAL | 部署验证版本，协议兼容性未完全验证，不作为最终通过版本 |
| `0.1.1` | CURRENT | 修复 JS/Rust 协议兼容: Hello wire 格式、SessionEnvelope.id UUID、sendWorkspaceRegister |
| `0.1.2` | PLANNED | 协议修复阶段版本 |
| `0.2.0` | PLANNED | 全量迁移版本 (按 MIMO-2/MIMO-4 最终包版本) |

**迁移文档**: 详见 `docs/OPENCODE_VEIN_PLUGIN_MIGRATION.md`

## 2. npm 包

### 2.1 @opensessiongateway/opencode-vein-plugin (当前)

| 项目 | 内容 |
|---|---|
| 包名 | `@opensessiongateway/opencode-vein-plugin` |
| 版本 | `0.1.1` |
| 来源路径 | `integrations/opencode/plugin/` |
| 打包命令 | `cd integrations/opencode/plugin && npm pack` |
| 产物 | `opensessiongateway-opencode-vein-plugin-0.1.1.tgz` |
| 发布责任 | Server-Management |

**注意**: 此包为 opencode 插件，用于连接 GlassVein router。

**安装示例**:
```bash
npm install @opensessiongateway/opencode-vein-plugin@0.1.1
```

### 2.2 @opensessiongateway/glassvein-router (保留)

| 项目 | 内容 |
|---|---|
| 包名 | `@opensessiongateway/glassvein-router` |
| 版本 | `0.1.0` |
| 来源路径 | `packages/glassvein-router/` |
| 打包命令 | `cd packages/glassvein-router && npm pack` |
| 产物 | `opensessiongateway-glassvein-router-0.1.0.tgz` |
| 发布责任 | Server-Management |

### 2.3 旧包参考 (不作为新交付)

| 项目 | 内容 |
|---|---|
| 包名 | `@opensessiongateway/client-opencode-plugin-v2` |
| 状态 | 仅作参考/兼容，不作为 GlassVein 新交付包 |
| 说明 | 旧 osgforopencode 插件，已被 `@opensessiongateway/opencode-vein-plugin` 替代 |

### 2.4 打包步骤

```bash
# 1. 构建 Rust 二进制
cd /workspace/OSG-Project/GlassVein
cargo build --release -p router

# 2. 阶段化本地
cd packages/glassvein-router
./scripts/stage-local.sh

# 3. 打包 npm tgz
npm pack

# 4. 打包 @opensessiongateway/opencode-vein-plugin
cd ../../integrations/opencode/plugin
npm pack

# 5. 产物位置
ls -la *.tgz
```

## 3. Rust Binaries

### 3.1 核心二进制

> **Note**: Some binary names below are outdated. Current canonical names: `control-surface` → `control-endpoint`, `observer-surface` → `surface-viewer`, `glassvein-opencode-router` removed from workspace.

| 二进制 | 包 | 构建命令 | 运行示例 |
|---|---|---|---|
| `router` | `router/` | `cargo build --release -p router` | `cargo run -p router -- --bind-addr 127.0.0.1:7240` |
| ~~`control-surface`~~ | ~~`crates/control-surface/`~~ | ~~`cargo build --release -p control-surface`~~ | → use `control-endpoint` (`endpoints/control/`) |
| ~~`observer-surface`~~ | ~~`crates/observer-surface/`~~ | ~~`cargo build --release -p observer-surface`~~ | → use `surface-viewer` (`endpoints/viewer/`) |
| `alpha-client` | `demos/alpha-client` | `cargo build --release -p alpha-client` | `cargo run -p alpha-client -- --router-url ws://127.0.0.1:7240` |
| `beta-client` | `demos/beta-client` | `cargo build --release -p beta-client` | `cargo run -p beta-client -- --router-url ws://127.0.0.1:7240` |
| `gamma-client` | `demos/gamma-client` | `cargo build --release -p gamma-client` | `cargo run -p gamma-client -- --router-url ws://127.0.0.1:7240` |
| `glassvein-opencode-router` | `crates/glassvein-opencode-router/` | `cargo build --release -p glassvein-opencode-router` | `cargo run -p glassvein-opencode-router` |

### 3.2 一键构建所有

```bash
cd /workspace/OSG-Project/GlassVein
cargo build --release
```

### 3.3 构建产物位置

```
target/release/
├── router
├── control-endpoint      # was control-surface
├── surface-viewer        # was observer-surface
├── requestion-endpoint   # was requestion-surface
├── alpha-client
├── beta-client
├── gamma-client

## 4. 运行命令

### 4.1 启动 Router

```bash
# 本地单例
cargo run -p router -- --bind-addr 127.0.0.1:7240 --tap-capacity 128

# 可选：连接主 GV 网络
cargo run -p router -- --bind-addr 127.0.0.1:7240 --upstream-url ws://main-gv-network:7200
```

### 4.2 启动 Workspace Clients

```bash
# workspace-a
cargo run -p alpha-client -- --router-url ws://127.0.0.1:7240

# workspace-b
cargo run -p gamma-client -- --router-url ws://127.0.0.1:7240
```

### 4.3 启动 Surfaces

```bash
# Observer (接收本地 tap 事件)
cargo run -p observer-surface -- --router-url ws://127.0.0.1:7240

# Control (发送控制命令)
cargo run -p control-surface -- \
  --router-url ws://127.0.0.1:7240 \
  --target workspace-b/runtime-2/session-2 \
  --command addprompt \
  --message "Hello!" \
  --surface-id control-surface-1
```

### 4.4 启动 OpenCode Router

```bash
cargo run -p glassvein-opencode-router
```

## 5. 版本/Commit 信息

| 项目 | 版本 | 说明 |
|---|---|---|
| GlassVein workspace | `0.1.0` | 开发版 |
| @opensessiongateway/opencode-vein-plugin | `0.1.1` | 当前版本，修复协议兼容 |
| @opensessiongateway/glassvein-router | `0.1.0` | npm 路由包 |
| @opensessiongateway/client-opencode-plugin-v2 | - | 旧包，仅作参考 |
| Rust crates | `0.1.0` | workspace 版本 |

**Commit 信息**: 待 MIMO-1/2 回报后补充。

## 6. 交付检查清单

- [ ] @opensessiongateway/opencode-vein-plugin@0.1.1 npm tgz 已打包
- [ ] @opensessiongateway/glassvein-router npm tgz 已打包
- [ ] Rust binaries 已构建 (target/release/)
- [ ] README/运行命令已更新
- [ ] 版本/commit 信息已记录
- [ ] npm tgz 已移交 Server-Management 发布

## 7. 注意事项

1. **npm 发布**: 由 Server-Management 负责，GlassVein 管理侧不自行 npm publish
2. **包名**: 使用 scoped 包名 `@opensessiongateway/opencode-vein-plugin`，无 scope 版本已废弃
3. **Rust 构建**: 使用 `cargo build --release` 构建优化版本
4. **运行依赖**: Router 需先启动，Client/Surface 后连接
5. **端口**: 默认 7240，可通过 `--bind-addr` 修改
6. **上游连接**: 可选，通过 `--upstream-url` 连接主 GV 网络

## 8. 文件结构

```
GlassVein/
├── packages/
│   └── glassvein-router/         # npm 路由包（Rust binary wrapper）
├── integrations/
│   └── opencode/plugin/          # @opensessiongateway/opencode-vein-plugin (TypeScript)
│       ├── package.json
│       ├── src/
│       └── dist/
├── router/                       # Rust router (canonical)
├── core/                         # Rust core routing primitives (canonical)
├── osgp/rust/                    # osgp protocol crate (canonical)
├── endpoints/
│   ├── control/                  # control-endpoint (migrating)
│   ├── viewer/                   # surface-viewer (migrating)
│   └── requestion/               # requestion-endpoint (migrating)
├── crates/
├── crates/
│   ├── surface/                  # surface library (observer + control + query)
│   └── (clientlib, clientroute, control-surface, observer-surface, requestion-surface, glassvein-opencode-router — removed/archived)
├── clients/
│   └── rust/                     # osgp-client (was clientlib + clientroute)
├── osgp/
│   ├── rust/                     # osgp protocol (was session-links)
│   └── ts/                       # @opensessiongateway/osgp
├── demos/
│   ├── alpha-client/
│   ├── gamma-client/
│   └── ...
├── legacy/                       # archived pre-refactor glassvein-* crates
└── docs/
    └── OPENCODE_PLUGIN_AND_BINARIES.md  # 本文档
```
