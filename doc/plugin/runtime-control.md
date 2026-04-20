# runtime-control

## 1.代码入口

- `plugins/runtime-control/index.ts`
- `plugins/runtime-control/surface.ts`
- `plugins/runtime-control/tools/*.ts`
- `plugins/runtime-control/types.ts`

route segment：`runtime_control`

公开 endpoint：`/api/v2/mcp/runtime_control`

## 2.JSON-RPC 行为

代码：`plugins/runtime-control/surface.ts`

支持的方法：

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

`tools/list` 返回的工具集当前包括：

- `ListRuntime`
- `ListClientDisplays`
- `ListActivedSessions`
- `ListClientInstanceWorkspaces`
- `ListRuntimeAvailableModels`
- `GetSessionLastUsedModel`
- `RequestRuntime`
- `CreateNewSession`
- `RenameClientSession`
- `SetClientDisplaySession`
- `AbortClientSession`
- `CompactSession`
- `AddPrompt`
- `ReloadClientInstanceWorkspace`
- `ListRuntimePermissions`
- `GetRuntimePermission`
- `ResolveRuntimePermission`

说明：

- `runtime-control` 属于 `s-MCP` 控制面。
- 该层允许承载服务端归属与鉴权参数。
- 这些参数不应默认透传到 `c-s` / ws / runtime 执行链路。

## 2.1 拟新增工具

围绕 session 恢复与上下文维护，下一步准备新增：

- `ResumeSessionInLoop`
- `RevertSession`
- `UnrevertSession`

这些工具的目标分别是：

- `ResumeSessionInLoop`：不插入任何新 message，直接让客户端重新进入当前 session 的 loop。
- `RevertSession`：回退到指定 message 或 part 之前，处理坏 prompt 或错误上下文。
- `UnrevertSession`：恢复先前的回退状态。

## 3.工具分组

### 3.1 Runtime / Session 查询

- `ListRuntime`
- `ListActivedSessions`
- `RequestRuntime`

### 3.2 Session 控制

- `CreateNewSession`
- `RenameClientSession`
- `AbortClientSession`
- `CompactSession`
- `AddPrompt`

`CreateNewSession` 约束：

- `ExecutorSessionID` 属于 `s-MCP` 层参数。
- 该参数用于服务端做执行归属与策略判断。
- 下游客户端创建 session 的真实协议不应包含该字段。

拟新增：

- `ResumeSessionInLoop`
- `RevertSession`
- `UnrevertSession`

### 3.3 Workspace / Display

- `ListClientDisplays`
- `SetClientDisplaySession`
- `ListClientInstanceWorkspaces`
- `ReloadClientInstanceWorkspace`

### 3.4 Model / Permission

- `ListRuntimeAvailableModels`
- `GetSessionLastUsedModel`
- `ListRuntimePermissions`
- `GetRuntimePermission`
- `ResolveRuntimePermission`

### 3.5 Session 状态与恢复

当前 OSG 已扩展为三字段模型：

- `state`
- `reason`
- `meta`

对外控制面已不再继续暴露旧的粗粒度字段 `status / sessionStatus / currentStatus`。

当前状态：

- `idle`
- `busy`
- `waiting`
- `stopped`

当前原因枚举：

- `idle`
  - `completed`
  - `pending`
- `busy`
  - `tool`
  - `generating`
  - `reasoning`
  - `compacting`
- `waiting`
  - `permission`
  - `question`
- `stopped`
  - `aborted`
  - `error`

当前 `meta` 主要承载：

- `toolName`
- `startedAt`
- `finishReason`
- `message`
- `attempt`
- `detail`

当前已稳定产出的原因包括：

- `pending`
- `completed`
- `tool`
- `generating`
- `compacting`
- `permission`
- `question`
- `aborted`
- `error`

当前 `reasoning` 已保留在模型中，但客户端侧暂未稳定上报。

## 4.宿主依赖

`runtime-control` 依赖 `context.osg` 中的方法。

关键宿主调用在：

- `server/lib/plugins/host.ts`
- `server/lib/plugins/worker-runtime.mjs`

例如：

- `osg_request_runtime`
- `osg_create_new_session`
- `osg_add_prompt`
- `osg_list_runtime_instance_workspaces`
- `osg_list_runtime_permissions`
- `osg_get_runtime_permission`
- `osg_resolve_runtime_permission`

## 5.Permission 相关设计

- `runtime-control` 不接管客户端的 Permission 状态机。
- 它只负责：
  - 收集 pending permission
  - 提供查询入口
  - 把 resolve 命令路由回客户端

## 6.Question 相关位置

- 当前 `runtime-control` 已提供 Question 工具集。
- 设计上它与 Permission 同属控制面，而真实状态机仍在客户端。

## 7.ResumeSessionInLoop 语义说明

- 该能力不等价于 `AddPrompt`。
- 该能力不会新增任何用户消息。
- 该能力的语义是：让客户端重新进入当前 session 的执行 loop。
- 该能力适用于异常中断后的继续执行，不适用于回复 permission 或 question 后的自动续跑场景。
