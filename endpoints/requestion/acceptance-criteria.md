# Requestion Endpoint 验收标准

> GVS-Requestion 监工使用此文档验收 GVW-Requestion 工人的代码变更。

## 1. 功能完整性

### 1.1 核心缓存功能

| 条目 | 验收标准 |
|------|----------|
| session_update 处理 | 收到 `session_update` upload 后，`SessionStateCache` 正确 upsert session 状态 |
| requestion.asked 处理 | 收到 `requestion_asked` upload 后，`RequestionCache` 正确 upsert pending requestion |
| requestion.updated 处理 | 收到 `requestion_updated` upload 后，更新已有 requestion 的 title/payload |
| requestion.resolved 处理 | 收到 `requestion_resolved` upload 后，从 cache 中移除对应 requestion |
| requestion.cancelled 处理 | 收到 `requestion_cancelled` upload 后，从 cache 中移除对应 requestion |
| 幂等性 | 对同一 requestion 多次 resolved/cancelled 不会导致错误 |
| 缺失字段容缺 | 缺少 sessionID 或 requestID 的 envelope 被忽略，不 panic |

### 1.2 ReadRequest 响应

| 条目 | 验收标准 |
|------|----------|
| SessionUpdateSnapshot | 返回对应 session 的缓存状态，未找到返回 not_found |
| RequestionSnapshot (compat) | 正确返回 session scope 的 requestion 列表，subtype 为 `runtime_requestion_snapshot` |
| RuntimeRequestionSnapshot | 支持 session scope 和 runtime-wide scope，支持 status 过滤 |
| SessionViewSnapshot | 合并返回 session state + requestion 列表 |
| 地址过滤 | 只处理 target 匹配自身地址的 ReadRequest |
| 地址广播 | Domain-only broadcast target（无 runtime/session）也被接受 |

### 1.3 出站控制信封

| 条目 | 验收标准 |
|------|----------|
| requestion_respond 构建 | 构建的信封符合 OSGP canonical control 格式 |
| source 地址 | source 为端点自身地址 |
| target 地址 | target 来自原始 requestion 的 source 地址 |
| decision 映射 | approve → `["approve"]`，reject/deny → `["deny"]`，response → `["<response>"]` |
| ExecutorSessionID | 正确传递到 payload（大小写兼容） |
| ExecutorRuntimeID | 正确传递到 payload（大小写兼容） |

### 1.4 Web / HTTP API

| 条目 | 验收标准 |
|------|----------|
| GET / | 返回正确的 web UI HTML |
| GET /api/requestions | 返回 flat `requestions` + `groupedBySession` + `sessionCount` |
| GET /api/config | 返回当前运行时配置 |
| POST /api/config/reload | 热重载配置文件，保留 pending cache |
| POST /api/respond | 验证必填字段，排队出站控制 |
| POST /mcp | 支持 tools/list、tools/call (list_requestions, respond_requestion, ReloadConfig) |
| MCP ExecutorSessionID | respond_requestion 和 ReloadConfig 必须要求 ExecutorSessionID |

### 1.5 CLI 配置

| 条目 | 验收标准 |
|------|----------|
| 默认配置 | 无参数时使用合理的默认值 |
| --config | 从 JSON 文件加载配置 |
| 参数覆盖 | CLI 参数优先于文件配置 |
| 热重载 | `reload_from_config_path` 正确读取并应用新配置 |
| 验证 | 空 nodeId/routerUrl/webAddr 被拒绝 |

## 2. 测试覆盖

### 2.1 必须通过的测试

```bash
cargo test -p requestion-endpoint
```

### 2.2 测试覆盖矩阵

| 模块 | 测试文件 | 覆盖要求 |
|------|----------|----------|
| cache | cache.rs (内联) | upsert、remove、get_by_session、get_all、grouped_by_session |
| handler | handler_tests.rs | 所有 ReadOperation 类型、canonical upload lifecycle、compat dotted input、幂等性、缺失字段 |
| web | web_tests.rs | API requestions/respond/reload、MCP tools/call、ExecutorSessionID 验证 |
| gv_client | gv_client.rs (内联) | 信封构建、decision 映射、field 别名 |
| cli | cli.rs (内联) | 默认配置、reload、无效配置拒绝 |
| seed | seed.rs (内联) | seed 后计数正确 |

### 2.3 新增功能要求

任何新增功能必须附带对应的单元测试，测试应覆盖：
- 正常路径
- 边界条件
- 错误处理

## 3. 代码规范

### 3.1 文件大小

- 单文件不超过 500 行（含测试）
- 超过时优先拆分为独立模块文件
- 测试代码使用 `#[cfg(test)] #[path = "xxx_tests.rs"] mod xxx_tests;`

### 3.2 架构约束

| 约束 | 说明 |
|------|------|
| 不修改核心层 | 不改 `core`、`router`、`osgp` crate |
| 不修改客户端 | 不改 `clients/rust` |
| 不引入新传输 | WebSocket 是唯一传输协议 |
| 无循环依赖 | 不引入 workspace crate 循环依赖 |
| 无旧协议概念 | 不引入 `ObserverSurface`/`ControlSurface` 作为 router role、`kind` 字段等 |

### 3.3 代码质量

- 无 `cargo clippy` 警告
- 所有公开函数有 doc comment
- 错误处理使用 `anyhow::Result`，不 unwrap 不安全路径
- 日志使用 `tracing`，不使用 `println!`（demo 输出除外）

## 4. 手动验证清单

> 用于端到端手动测试。

1. **启动连接**：端点成功连接到 GV router，发送 Hello + Announce
2. **事件收集**：发送 `requestion_asked` → 出现在 cache 和 web UI
3. **更新合并**：发送 `requestion_updated` → title/payload 更新
4. **审批响应**：从 web UI 点击 approve/reject → 发送 `requestion_respond` 到原始 source
5. **生命周期**：发送 `requestion_resolved` → 从 pending 列表移除
6. **API 查询**：`curl http://127.0.0.1:7318/api/requestions` 返回正确 JSON
7. **MCP 调用**：通过 `/mcp` 调用 `list_requestions` 和 `respond_requestion`
8. **配置热重载**：修改 config 文件 → POST `/api/config/reload` → 新配置生效

## 5. 回归检查

每次代码变更后必须确认：

- [ ] `cargo build -p requestion-endpoint` 无错误
- [ ] `cargo test -p requestion-endpoint` 全部通过
- [ ] `cargo clippy -p requestion-endpoint` 无新增警告
- [ ] 未修改 `core/`、`router/`、`osgp/`、`clients/` 下的文件
