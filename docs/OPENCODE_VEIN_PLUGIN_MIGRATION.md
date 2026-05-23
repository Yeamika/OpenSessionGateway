<!-- historical / pre-cleanup: plugin now at integrations/opencode/plugin/ (not packages/opencode-vein-plugin/) -->
# opencode-vein-plugin 迁移清单

## 1. 概述

本文档记录从旧 `@opensessiongateway/client-opencode-plugin-v2` 迁移到新 `@opensessiongateway/opencode-vein-plugin` 的完整清单。

### 迁移目标

- **无感替代**: 用户按原用法即可创建会话、addprompt、收到 session_update
- **底层切换**: 从 OSG WS 协议切换到 GlassVein router 协议
- **旧包状态**: 仅作源代码参考/兼容，不是新交付包

### 版本规划

| 版本 | 状态 | 说明 |
|---|---|---|
| `0.1.0` | PARTIAL | 部署验证版本 |
| `0.1.1` | CURRENT | 协议修复: Hello wire 格式、SessionEnvelope.id UUID、sendWorkspaceRegister |
| `0.1.2` | PLANNED | 协议修复阶段版本 |
| `0.2.0` | PLANNED | 全量迁移版本 (按 MIMO-2/MIMO-4 最终包版本) |

## 2. 文件迁移清单

### 2.1 插件入口

| 旧文件 | 新文件 | 状态 | 说明 |
|---|---|---|---|
| `index.ts` | `src/index.ts` | 待迁移 | 插件入口，export OsgPlugin |
| `tui.tsx` | `src/tui.tsx` | 待迁移 | TUI 组件，SolidJS |
| `tui-shim.d.ts` | `src/tui-shim.d.ts` | 待迁移 | TUI 类型声明 |

### 2.2 核心库 (lib/)

| 旧文件 | 新文件 | 状态 | 说明 |
|---|---|---|---|
| `lib/config.ts` | `src/lib/config.ts` | 待迁移 | OSG 运行时配置 |
| `lib/constants.ts` | `src/lib/constants.ts` | 待迁移 | 事件常量 |
| `lib/mcp.ts` | `src/lib/mcp.ts` | 待迁移 | MCP 配置应用 |
| `lib/mcp-urls.ts` | `src/lib/mcp-urls.ts` | 待迁移 | MCP URL 解析 |
| `lib/query.ts` | `src/lib/query.ts` | 待迁移 | 查询工具 |
| `lib/tools.ts` | `src/lib/tools.ts` | 待迁移 | 工具定义 |

### 2.3 OSG-opencode 模块

| 旧文件 | 新文件 | 状态 | 说明 |
|---|---|---|---|
| `lib/OSG-opencode/index.ts` | `src/lib/OSG-opencode/index.ts` | 待迁移 | OSGOpencodeClient 主类 |
| `lib/OSG-opencode/manager.ts` | `src/lib/OSG-opencode/manager.ts` | 待迁移 | OsgManager 管理器 |
| `lib/OSG-opencode/ServerEvent.ts` | `src/lib/OSG-opencode/ServerEvent.ts` | 待迁移 | 服务器事件处理 |
| `lib/OSG-opencode/runtime/` | `src/lib/OSG-opencode/runtime/` | 待迁移 | 运行时工具 |
| `lib/OSG-opencode/ws-event/` | `src/lib/OSG-opencode/ws-event/` | 待迁移 | WS 事件处理 |

### 2.4 GlassVein Router 模块

| 旧文件 | 新文件 | 状态 | 说明 |
|---|---|---|---|
| `lib/glassvein-router/index.ts` | `src/lib/glassvein-router/index.ts` | 已存在 | GlassVein router 集成 |
| `lib/glassvein-router/glassvein-ws-client.ts` | `src/lib/glassvein-router/glassvein-ws-client.ts` | 已存在 | WS 客户端 |

## 3. 能力迁移清单

### 3.1 插件生命周期

| 能力 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| 插件注册 | `OsgPlugin(ctx)` | 同 | 待迁移 |
| 配置加载 | `config()` hook | 同 | 待迁移 |
| 事件处理 | `event()` hook | 同 | 待迁移 |
| 清理 | `cleanup()` hook | 同 | 待迁移 |
| Attach 检测 | `attached()` | 同 | 待迁移 |

### 3.2 事件系统

| 事件 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| `session.status` | `OSGOpencodeClient.onEvent()` | 映射到 `Envelope(kind=session_update)` | 待迁移 |
| ~~`message.updated`~~ | `ClientContentExecuteing` | **删除标记**：不纳入 GV 主链路；详情走读取/query | 不迁移 |
| ~~`message.part.updated`~~ | `ClientContentExecuteing` | **删除标记**：不纳入 GV 主链路；详情走读取/query | 不迁移 |
| `permission.asked` | `PermissionAskedPayload` | 映射到 `Envelope(kind=permission)` | 待迁移 |
| `question.asked` | `QuestionAskedPayload` | 映射到 `Envelope(kind=question)` | 待迁移 |
| ~~`tui.session.select`~~ | TUI 事件 | **删除标记**：不纳入 GV 主链路 | 不迁移 |

### 3.3 命令系统

新主链路统一为 `Envelope(kind="session_command")`，payload 使用 `command`
字段区分 `add_prompt` / `abort_session` / `compact_session` /
`create_session` / `rename_session` / `resume_session`。控制命令不再映射成
`session_update`；`session_update` 仅由执行结果或 opencode 状态事件上报。
`SetDisplaySession` 删除/不迁移。

| 命令 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| `add_prompt` | `ctx.session.addPrompt()` | 映射到 `Envelope(kind=session_command, payload.command=add_prompt)` | 待迁移 |
| `abort_session` | `ctx.session.abort()` | 映射到 `Envelope(kind=session_command, payload.command=abort_session)`；执行后再上报 `session_update` | 待迁移 |
| `compact_session` | `ctx.session.compact()` | 映射到 `Envelope(kind=session_command, payload.command=compact_session)`；执行后再上报 `session_update` | 待迁移 |
| `create_session` | `ctx.session.create()` | 映射到 `Envelope(kind=session_command, payload.command=create_session)`；执行后再上报 `session_update` | 待迁移 |
| `ListSession` | `readCurrentSessionList()` | 映射到 `ReadRequest(op=list_workspaces)` | 待迁移 |
| `rename_session` | `ctx.session.rename()` | 映射到 `Envelope(kind=session_command, payload.command=rename_session)`；执行后再上报 `session_update` | 待迁移 |
| `resume_session` | 暂无稳定底层 API | 映射到 `Envelope(kind=session_command, payload.command=resume_session)`；无 API 时必须明确返回 unsupported/not implemented | 待迁移 |
| ~~`SetDisplaySession`~~ | ~~`ctx.session.setDisplay()`~~ | **删除/不迁移**：不纳入 GV 新主链路 | 不迁移 |

### 3.4 状态管理

| 状态 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| `CurrentClientInfo` | `ws-event/CurrentClientInfo.ts` | 迁移 + GlassVein 适配 | 待迁移 |
| `SessionStateRow` | `OSGOpencodeClient` 内部 | 迁移 + GlassVein 适配 | 待迁移 |
| `PermissionRoutes` | `manager.ts` | 不迁移；GV 链路用 `sessionID + requestID` 精确处理 permission | 用户明确不要全局 route map |
| `QuestionRoutes` | `manager.ts` | 不迁移；GV 链路用 `sessionID + requestID` 精确处理 question | 用户明确不要全局 route map |

### 3.5 TUI 组件

| 组件 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| 状态显示 | `tui.tsx` | 迁移 + GlassVein 适配 | 待迁移 |
| 配置保存 | `OSG_TUI_CONFIG_SAVE_EVENT` | 迁移 + GlassVein 适配 | 待迁移 |
| 错误显示 | `OSG_TUI_CONFIG_FAILED_EVENT` | 迁移 + GlassVein 适配 | 待迁移 |

### 3.6 MCP 集成

| 能力 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| MCP 配置应用 | `applyOsgMcpConfig()` | 迁移 + GlassVein 适配 | 待迁移 |
| Surface 发现 | `discoverOsgSurfaces()` | 迁移 + GlassVein 适配 | 待迁移 |

### 3.7 GlassVein Router 集成

| 能力 | 旧实现 | 新实现 | 状态 |
|---|---|---|---|
| WS 连接 | `GlassveinWsClient` | 保留 + 协议修复 | 已存在 |
| Hello 握手 | `{nodeId, role, addresses}` | 同 (camelCase, 无 type tag) | 已修复 |
| 工作区注册 | `sendWorkspaceRegister()` | 同 | 已修复 |
| session_update 广播 | Router 自动 fan-out | 同 | 已修复 |

## 4. 无感使用验收定义

### 4.1 用户视角

用户使用新插件后，**不应感知任何差异**：

1. **创建会话**: `oca create-session --model mimov2.5 --workspace test-workspace`
   - 旧: OSG WS → session_update
   - 新: GlassVein router → session_update (observer 可见)

2. **发送消息**: control path 发送 `Envelope(kind="session_command", payload.command="add_prompt")`
   - 旧: OSG WS → addprompt
   - 新: GlassVein router → session_command(add_prompt) (target session 收到)

3. **收到更新**: observer-surface 监控
   - 旧: OSG WS → session_update
   - 新: GlassVein router tap → session_update (observer 可见)

### 4.2 验收标准

| 验收项 | 旧行为 | 新行为 | 判据 |
|---|---|---|---|
| 插件加载 | `opencode serve --plugin ...` | 同 | 无报错 |
| 创建会话 | session_update 事件 | session_update 事件 | observer 收到 |
| 发送消息 | addprompt 命令 | addprompt 命令 | target 收到 |
| 收到更新 | session_update 事件 | session_update 事件 | observer 收到 |
| TUI 显示 | 状态显示正常 | 状态显示正常 | 无报错 |

### 4.3 验证命令

```bash
# 1. 启动 router
cargo run -p router -- --bind-addr 127.0.0.1:7240 --tap-capacity 128

# 2. 启动 observer
cargo run -p observer-surface -- --router-url ws://127.0.0.1:7240

# 3. 启动 opencode serve + 新插件
opencode serve --plugin @opensessiongateway/opencode-vein-plugin

# 4. 创建会话 (观察第一次 update)
oca create-session --model mimov2.5 --workspace test-workspace

# 5. 发送消息 (观察第二次 update)
cargo run -p control-surface -- \
  --router-url ws://127.0.0.1:7240 \
  --target test-workspace/runtime-1/session-1 \
  --command addprompt \
  --message "Hello!" \
  --surface-id verify-control
```

## 5. 依赖迁移

### 5.1 旧依赖

```json
{
  "@opentui/solid": "0.1.96",
  "@opencode-ai/plugin": "latest",
  "@opencode-ai/sdk": "latest",
  "@opensessiongateway/client-library": "0.0.6",
  "@opensessiongateway/protocol-library": "0.0.5",
  "solid-js": "1.9.11",
  "ws": "^8.18.0"
}
```

### 5.2 新依赖

```json
{
  "@opentui/solid": "0.1.96",           // 保留
  "@opencode-ai/plugin": "latest",       // 保留
  "@opencode-ai/sdk": "latest",          // 保留
  "solid-js": "1.9.11",                  // 保留
  "ws": "^8.18.0",                       // 保留
  // 移除: @opensessiongateway/client-library
  // 移除: @opensessiongateway/protocol-library
  // 新增: GlassVein router 协议内联
}
```

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 旧依赖移除导致功能缺失 | 插件无法正常工作 | 保留旧依赖作参考，必要时内联 |
| TUI 组件不兼容 | 界面显示异常 | 保留 SolidJS 依赖，适配新 API |
| MCP 配置变更 | 工具不可用 | 保留 MCP 配置逻辑，适配新 router |
| session_update 时序差异 | observer 收不到事件 | Router 自动广播已修复 |
| 旧包用户迁移困难 | 用户流失 | 提供迁移指南，保留旧包参考 |

## 7. 待覆盖风险

1. **OSGClient 依赖**: 旧插件依赖 `@opensessiongateway/client-library`，新插件需要内联或替代
2. **protocol-library 依赖**: 旧插件依赖 `@opensessiongateway/protocol-library`，新插件需要内联或替代
3. **TUI 兼容性**: 旧 TUI 组件可能依赖旧 API，需要适配
4. **MCP 配置**: 旧 MCP 配置逻辑可能需要调整
5. **事件时序**: 新旧协议事件时序可能不同，需要验证

## 8. 文件结构

```
GlassVein/integrations/opencode/plugin/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # 插件入口
│   ├── tui.tsx                     # TUI 组件
│   ├── tui-shim.d.ts               # TUI 类型声明
│   └── lib/
│       ├── config.ts               # 配置
│       ├── constants.ts            # 常量
│       ├── mcp.ts                  # MCP 配置
│       ├── mcp-urls.ts             # MCP URL
│       ├── query.ts                # 查询
│       ├── tools.ts                # 工具
│       ├── OSG-opencode/           # OSG 集成
│       │   ├── index.ts
│       │   ├── manager.ts
│       │   ├── ServerEvent.ts
│       │   ├── runtime/
│       │   └── ws-event/
│       └── glassvein-router/       # GlassVein 集成
│           ├── index.ts
│           └── glassvein-ws-client.ts
└── dist/                           # 构建产物
```

## Canonical wire convergence

Use top-level `type` and `subtype` for all business filtering. `kind`, `control.command`, direct legacy commands, and independent permission/question chains are not main protocol routes.

- Upload reports: `type="upload"`, subtype `session_update` or `requestion_*`.
- Control: `type="control"`, subtype command name.
- Request: `type="request"`, subtype read operation. Runtime question/permission listing is unified as `runtime_requestion_snapshot`.
- Response: `type="response"`, subtype mirrors the originating request/control.

Router Hello role is only `router` or `endpoint`. A viewer endpoint can declare `capabilities: ["surface_viewer"]`; router may locally fan out upload to that weak tag without understanding observer/control semantics.
