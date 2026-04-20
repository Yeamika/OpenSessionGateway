# runtime-control

## 1.定位

- 提供 runtime、session、workspace 的统一控制面。
- 提供 `Permission` 与 `Question` 的统一控制入口。

## 2.边界

- 不托管客户端内部状态机。
- 只负责收集状态、暴露控制入口、把控制命令路由回客户端。
- `runtime-control` 属于 `s-MCP` 控制面。
- `runtime-control` 可接收服务端控制上下文参数，但这些参数不应默认进入 `c-s`。

## 2.1 CreateNewSession 约束

- `CreateNewSession` 属于 `s-MCP` 控制项。
- 其服务端控制面上下文与客户端真实执行参数应分层处理。
- 控制面参数不应直接等同于客户端运行时协议参数。

## 3.当前主链路

- runtime 查询
- session 查询与创建
- prompt 注入
- workspace 重载
- permission 控制
- question 控制

## 4.拟新增控制项

### 4.1 Session 状态增强

- 当前 session 状态需要从简单的 `idle / busy / error` 扩展为更稳定的状态模型。
- 目标不是只给出一个状态字符串，而是同时表达当前状态、当前原因和必要补充信息。

建议方向：

- `idle`
- `busy`
- `waiting`
- `stopped`

并通过 `reason` 与 `meta` 表达：

- tool 执行
- model 生成
- compacting
- waiting permission
- waiting question
- aborted
- error

其中建议的基础状态原因为：

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

更细的说明信息不再继续拆分状态，而放到 `meta` 中表达。

### 4.2 ResumeSessionInLoop

- `ResumeSessionInLoop` 用于让客户端重新进入当前 session 的执行 loop。
- 该能力不新增 prompt，不插入新的 message。
- 该能力的目标是继续当前 session 执行，而不是恢复底层 provider stream。

### 4.3 CompactSession

- `CompactSession` 用于主动触发会话压缩。
- 目标是给长会话释放上下文窗口，而不是改变 session 的归属与托管边界。

### 4.4 RevertSession / UnrevertSession

- 当 session 因坏 prompt 或错误上下文无法继续时，优先通过回退恢复，而不是直接删除 prompt。
- `RevertSession` 与 `UnrevertSession` 的语义比 `RemovePrompt` 更稳定，也更符合客户端已有原语。
