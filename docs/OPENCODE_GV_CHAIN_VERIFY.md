<!-- historical / pre-cleanup: references packages/opencode-vein-plugin which is now at integrations/opencode/plugin/ -->
# opencode-vein-plugin GV 链路验证清单

## 1. 当前结论

当前只能确认 `@opensessiongateway/opencode-vein-plugin` 在代码集成层面已经围绕 `VeinManager -> GlassveinWsClient` 主路径完成补齐，并通过本地 `typecheck / build / npm pack` 收口。

不能仅凭本地构建结果断言真实环境已经 live PASS。是否“都能接上 GV”必须通过部署环境链路验证确认。

## 2. 核心原则

所有 opencode 逻辑必须通过一个统一 GV client 进出：

```text
opencode serve
  -> @opensessiongateway/opencode-vein-plugin
  -> VeinManager
  -> GlassveinWsClient
  -> GV router / opencode-router
  -> observer / control surface
```

约束：

- 不允许各 handler 自己创建独立 GV/WebSocket 连接。
- `VeinManager` 是插件内 opencode 上下文、事件映射、control handler 与 GV client 的统一汇聚点。
- router 负责转发与必要 fan-out；opencode 业务行为仍在 plugin/client 侧实现。
- 部署、容器、Verdaccio/npm publish、生产服务操作交由 Server-Management 执行。

## 3. 必须验证的链路

### 2x3 链路矩阵

两类对象（`session_update`、`requestion`）各有 3 条链路：

| 对象类型 | A. 事件上报链路 | B. Control 链路 | C. Snapshot 链路 |
|---|---|---|---|
| `session_update` | session.status → Envelope(kind=session_update) → router → observer | **控制命令不再表达为 session_update**；执行后由 plugin 上报 session_update | ReadRequest(op=session_update_snapshot) → router 转发 → opencode plugin → ReadResponse |
| `requestion` | requestion.asked → Envelope(kind=requestion.asked) → router → observer/RequestionSurface | requestion.response → Envelope(kind=requestion.response) → router → client | ReadRequest(op=requestion_snapshot) → router 转发 → RequestionSurface → ReadResponse |

**关键约束**:
- `session_update` 简洁，不携带 `requestID`；只用于执行后的状态上报，不承载控制命令
- `requestion` 不携带 `permissionID`/`questionID`/`type`/`kind`/`displayID`/`detail`/`event`/`properties`
- Router 对 `session_update` 和 `requestion.*` 做广播
- **Router 只做广播和转发，不 materialize 状态**
- **SessionUpdateSnapshot 权威来源是 opencode plugin 端**
- **RequestionSurface 是独立的缓存视图，不是 router 内置状态**

### 3.1 插件加载链路

目标链路：

```text
opencode serve
  -> 加载 @opensessiongateway/opencode-vein-plugin
  -> createGvPlugin(ctx, config)
  -> VeinManager.start()
```

必须验证：

- 插件包能被 opencode 正确发现与加载。
- 插件入口 export/package contents/ESM 兼容实际 opencode 运行方式。
- `createGvPlugin(ctx, config)` 被调用。
- `VeinManager.start()` 被调用且没有启动期异常。
- 能读取 router URL、workspace directory、runtime/client 基础信息。

PASS 证据：

- opencode serve 日志显示 plugin loaded。
- plugin 日志显示 VeinManager started。
- 没有 package export、模块解析、配置读取错误。

### 3.2 GV 连接与 workspace 注册链路

目标链路：

```text
VeinManager
  -> GlassveinWsClient.connect()
  -> GV WebSocket
  -> Hello frame
  -> workspace_register
```

必须验证：

- `GlassveinWsClient` 成功连接 router。
- 第一帧 Hello 协议格式正确，例如：

```json
{
  "nodeId": "...",
  "role": { "Client": { "address": "..." } },
  "addresses": []
}
```

- `workspace_register` 被发送并被 router 接收。
- router 能识别当前连接对应的 opencode workspace/client。

PASS 证据：

- plugin 日志显示 WebSocket connected。
- router 日志显示 client connected / hello accepted / workspace registered。
- 无协议解析错误、UUID/envelope 格式错误。

### 3.3 opencode 正向事件链路

目标链路：

```text
opencode event hook
  -> VeinManager.processEvent()
  -> EventMapper
  -> GV envelope
  -> router
  -> observer
```

必须覆盖事件：

- `session.status`
- ~~`message.updated`~~（删除标记：不纳入 GV 主链路）
- ~~`message.part.updated`~~（删除标记：不纳入 GV 主链路；详情走读取/query）
- `permission.asked`
- `question.asked`
- ~~`tui.session.select`~~（删除标记：不纳入 GV 主链路）

必须验证：

- 事件进入 `VeinManager.processEvent()`。
- `EventMapper` 输出预期的 GV event：
  - `session_update`
  - `permission.asked`
  - `question.asked`
- router 收到对应 envelope。
- observer 能看到 `session_update`。
- `session_update` 自动广播生效，避免 source/target self-loop 导致 observer 不可见。

PASS 证据：

- observer 至少看到 session 创建/消息处理对应的 `session_update`。
- router 日志显示 `session_update` fan-out 给 observer surface。
- ~~fallback `opencode_event` 在必要场景可见~~（删除标记：不作为验收项）。

#### 3.3.2 `requestion` payload 定稿

`requestion` 统一表达权限请求和问题询问，使用 `requestID` 标识。

**requestion asked payload**:

```json
{
  "sessionID": "ses_xxx",
  "requestID": "req_xxx",
  "title": "Permission: edit file",
  "description": "Allow editing /path/to/file",
  "questions": [
    {
      "options": [
        { "label": "Allow", "description": "Allow this operation" },
        { "label": "Deny", "description": "Deny this operation" }
      ],
      "multiple": false,
      "custom": false
    }
  ],
  "requestedAt": "2026-05-15T10:30:00Z"
}
```

**requestion response control payload**:

```json
{
  "sessionID": "ses_xxx",
  "requestID": "req_xxx",
  "answers": [["Allow"]]
}
```

字段约束：

- `sessionID`：唯一主会话键。
- `requestID`：唯一请求键，用于匹配 response。
- `title`：请求标题。
- `description`：可选描述。
- `questions`：可选问题列表，每个问题可有选项。
- `requestedAt`：请求时间。
- `answers`：响应答案，二维数组（每个问题对应一个答案数组）。

不放入 `requestion` 的内容：

- `permissionID`、`questionID`：不使用。
- `type`、`kind`、`displayID`、`detail`、`event`、`properties`：不使用。

`session_update` 只表达会话状态更新，必须保持简洁；所有会话标识统一使用 `sessionID`。

标准 payload：

```json
{
  "sessionID": "ses_xxx",
  "state": "busy | idle | stopped | waiting",
  "metadata": {
    "reason": "pending | completed | tool | generating | reasoning | compacting | permission | question | aborted | error",
    "extraInfo": "optional short text"
  }
}
```

字段约束：

- `sessionID`：唯一主会话键；不使用 `sessionId`、`session_id`。
- `state`：只允许 `busy`、`idle`、`stopped`、`waiting`。`waiting` 为标准拼写，不使用 `waititing`。
- `metadata.reason`：状态原因，可为空或省略；不作为路由键。
- `metadata.extraInfo`：字符串或 `null`，最多一段简短辅助说明；不作为路由键，不放结构化大对象。

当前可直接捕获或推导的 `reason`：

| reason | 来源 | 说明 |
|---|---|---|
| `pending` | `session.status=idle` 且会话尚未被触达 | 空闲但未完成有效执行 |
| `completed` | `session.status=idle` / `session.idle` 且会话已被触达 | 一轮执行完成 |
| `generating` | `session.status=retry`；也可由 message streaming 推导 | 模型正在生成或重试生成 |
| `tool` | `message.part.updated` 的 tool 类 part | 需要 mapper 补齐 part 类型推导 |
| `reasoning` | `message.part.updated` 的 reasoning 类 part | 需要 mapper 补齐 part 类型推导 |
| `compacting` | `CompactSession` control 或 `session.compacted` | 需要 mapper 将 compact 事件写入 reason |
| `permission` | `permission.asked` | 当前会话等待权限处理 |
| `question` | `question.asked` | 当前会话等待问题回复 |
| `aborted` | `session.error` 且错误为 abort 类；或 AbortSession 结果 | 会话被取消/中止 |
| `error` | `session.error` 非 abort 类 | 会话异常 |

`metadata.extraInfo` 只保留简短人类可读提示，类型固定为字符串：

| 场景 | extraInfo 示例 |
|---|---|
| `permission` | `"permission: edit file"` |
| `question` | `"question: choose an option"` |
| `tool` | 显示 tool 的内容；优先取工具名/命令/参数摘要，例如 `"tool: bash npm test"` |
| `reasoning` / think | 显示小 think 标题；如果没有标题，显示 think 内容前几个字 |
| `compacting` | `"compacting"` |
| `aborted` / `error` | 简短错误摘要，建议截断 |

如果没有明确短提示，`extraInfo` 为空字符串或 `null`。

`tool` 与 `think/reasoning` 的提取规则：

- tool：从 `message.part.updated` 的 tool 类 part 提取可读内容，优先级建议为 `tool/name`、`command`、`input/args` 的短摘要；不要放完整大 JSON。
- think/reasoning：从 reasoning/thinking 类 part 提取标题；若没有标题，从正文清洗后取开头若干字作为 fallback。

不放入 `session_update` 的内容：

- `runtimeExecutionContext`：不再单独需要；用顶层 `sessionID` 即可。
- `permissionID/questionID`：不再作为 GV 字段名使用；permission/question 链路统一暴露 `requestID`。
- `requestID`：只用于 permission/question asked 与 resolve/reply，不放入 `session_update`。
- `displayID`、`instanceWorkspaceDirectory`、token 计数等上下文信息：不放入 `session_update`，需要时通过 `RequestRuntime` 或查询接口获取。
- 完整 message content：详细消息继续走 `opencode_event` 或查询接口。
- 完整原始 opencode event：除调试模式外不默认进入 `extraInfo`。

### 3.4 GV 反向 control 链路

控制链路统一为 `Envelope(kind="session_command")`，payload 用 `command` 区分：
`add_prompt`、`abort_session`、`compact_session`、`create_session`、
`rename_session`、`resume_session`。这些命令不再表达为 `session_update`；
`session_update` 只用于执行后的状态上报。`SetDisplaySession` 删除/不迁移。

目标链路：

```text
control surface
  -> GV router
  -> control_command / ServerEvent
  -> GlassveinWsClient.onControlCommand
  -> VeinManager.handleServerEvent()
  -> opencode ctx/API
```

必须覆盖命令：

- `session_command.add_prompt`
- `session_command.abort_session`
- `session_command.compact_session`
- `session_command.create_session`
- `session_command.rename_session`
- `session_command.resume_session`（当前 adapter 如无底层 API 必须明确返回 unsupported/not implemented）
- ~~`SetDisplaySession`~~（删除/不迁移：不纳入 GV 新主链路）
- `Permission`
- `Question`
- `RequestRuntime`

必须验证：

- control command 能从 surface 到达 router。
- router 能转发到正确 opencode client/plugin。
- `GlassveinWsClient.onControlCommand` 能接收到命令。
- `VeinManager.handleServerEvent()` 能路由到对应 handler。
- handler 能找到正确 workspace/session/context。
- 成功或失败 response 能回到 GV/control surface。

PASS 证据：

- `session_command.add_prompt` 能触发 opencode session 新消息处理。
- `Abort/Compact/Create/Rename` 至少返回明确成功/失败，不允许无响应。
- ~~`SetDisplay`~~ 删除标记：不作为当前验收项。
- `RequestRuntime` 返回当前状态。
- control surface 能收到 response，不出现半断链。

### 3.5 Requestion 单会话直达链路

目标链路：

```text
requestion.asked
  -> 事件携带 sessionID + requestID
  -> router 广播给 observer 和 RequestionSurface
  -> RequestionSurface 缓存 pending 项
  -> control response 携带 sessionID + requestID
  -> 按 sessionID 定位会话，按 requestID 定位该会话内的 pending 项
  -> 调 opencode 响应 API
```

必须验证：

- requestion asked 事件能被发送到 GV。
- router 对 `requestion.*` 做广播。
- RequestionSurface 收到并缓存 pending 项。
- control response 必须携带明确 `sessionID` 与 `requestID`。
- `sessionID` 用于定位会话，`requestID` 用于定位该会话当前要处理的 pending 项。
- 多 session 场景依赖 `sessionID` 隔离；同一 session 多 pending 场景依赖 `requestID` 精确选择。

PASS 证据：

- requestion 请求在 observer/RequestionSurface 侧可见。
- resolve 后 opencode 对应会话继续执行或明确拒绝。
- RequestionSurface 能回答 snapshot 查询。

### 3.6 RequestRuntime 最小只读链路

目标链路：

```text
RequestRuntime
  -> ServerEvent route
  -> RequestRuntime handler
  -> 返回当前 connection/workspace/client/session 状态
```

必须验证：

- 可通过 GV control path 触发 `RequestRuntime`。
- 返回内容至少包含：
  - runtime/plugin 基础状态；
  - router URL / connected 状态；
  - workspace 信息；
  - current client/session 信息；
  - 若指定 session，返回必要 session 状态。
- 该 handler 只读、无副作用。

明确不迁移、不作为缺口：

- `RequestInstanceWorkspaceReload`
- `SessionList`
- `ListAvailableModels`
- `ShowToast`

PASS 证据：

- control surface 收到 runtime 状态 response。
- 未触发 reload、toast、模型列表或完整 session list 副作用。

### 3.7 TUI / MCP 最小适配链路

目标链路：

```text
runtime config
  -> MCP URL / surface discovery
  -> TUI session select/status events
  -> GV event/control context
```

必须验证：

- TUI session select/status 事件不会阻塞插件运行。
- `tui.session.select` 能进入 event mapper。
- MCP URL/config/surface discovery 的最小加载逻辑不会导致启动失败。
- runtime config 能被 control/event 链路使用。

PASS 证据：

- 启动日志无 MCP/config 初始化错误。
- 选择 session 后 observer/control context 能反映目标 session 变化。

### 3.8 包与部署一致性链路

目标链路：

```text
npm package tgz
  -> 安装到部署环境
  -> opencode serve 使用该版本
  -> router binary 包含 session_update 自动广播实现
```

必须验证：

- 部署环境实际运行 `@opensessiongateway/opencode-vein-plugin@0.2.0`，不是旧 `0.1.2`。
- router binary 是包含 `session_update` 自动广播的新版本。
- plugin 与 router 使用兼容的 GV wire/envelope 协议。

PASS 证据：

- `npm ls` / opencode plugin list / 启动日志能证明插件版本。
- router binary 构建时间、版本或日志能证明包含自动广播逻辑。
- observer 真实收到 `session_update`。

## 4. Live 验证最小闭环

最小闭环建议按以下顺序执行：

1. 启动带新广播逻辑的 `glassvein-opencode-router`。
2. 启动 observer surface，监听 `session_update`。
3. 启动 `opencode serve`，加载 `@opensessiongateway/opencode-vein-plugin@0.2.0`。
4. 确认 plugin 连接 router 并完成 `workspace_register`。
5. 创建或选择一个 opencode session。
6. 确认 observer 收到第一次 `session_update`。
7. 通过 control surface 发送 `session_command(add_prompt)`。
8. 确认 opencode session 执行消息处理。
9. 确认 observer 收到第二次 `session_update`。
10. 发送 `RequestRuntime`，确认返回只读状态。
11. 如条件允许，触发 permission/question，验证 resolve/reply 能按 `sessionID` 回到正确 session。

## 5. PASS/FAIL 边界

### 5.1 可以判定 PASS 的条件

- 插件加载成功。
- GV WebSocket connected。
- `workspace_register` 成功。
- 正向 event 能进入 router。
- observer 能看到 `session_update`。
- observer/RequestionSurface 能看到 `requestion.asked`。
- 反向 control 至少完成 `session_command(add_prompt)` 与 `RequestRuntime`。
- control response 能返回，不出现静默超时。
- requestion 若触发，能按 `sessionID + requestID` 回到正确 pending 项；GV 链路不使用 `permissionID/questionID` 字段名。
- RequestionSurface 能回答 snapshot 查询。

### 5.2 不能判定 PASS 的情况

- 只有 `npm run typecheck/build/pack` 成功，但没有 live 连接证据。
- plugin loaded 但没有 `workspace_register`。
- router 收到事件但 observer 看不到 `session_update`。
- control command 发出后没有 response。
- `RequestRuntime` 返回不完整或触发非只读副作用。
- 部署环境仍运行旧 plugin/router。

## 6. 当前管理判断

代码收口结果说明主链路已经完成集成，但真实 GV 接入需要以上 live 验证闭环确认。

下一步若进入部署验证，应把本文件作为 Server-Management 的验证要求之一，由 Server-Management 执行部署/启动/发布类操作，GlassVein 管理侧只做验收标准和结果分析。

## Canonical wire and router boundary

The converged business wire uses `type` + `subtype`:

- `upload`: `session_update`, `requestion_asked`, `requestion_resolved`, `requestion_updated`, `requestion_cancelled`.
- `control`: `add_prompt`, `abort_session`, `compact_session`, `create_session`, `rename_session`, `resume_session`, `requestion_respond`.
- `request`: `list_workspaces`, `read_workspace_info`, `list_session_messages`, `session_update_snapshot`, `requestion_snapshot`, `runtime_requestion_snapshot`, `session_view_snapshot`, `session_update_subscribe`.
- `response`: same subtype as the request/control being answered.

Router sees only network `router`/`endpoint` roles. Upload is not target-routed; it is local fan-out only to endpoint peers declaring `surface_viewer` capability.
