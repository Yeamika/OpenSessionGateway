<!-- historical / pre-cleanup: references packages/opencode-vein-plugin which is now at integrations/opencode/plugin/ -->
# RequestionSurface 设计文档

## 1. 概述

RequestionSurface 是一个**独立的缓存视图**，持续收集 `requestion.*` 和 `session_update` 事件，并回答发给自身地址的查询请求。

**关键约束**:
- RequestionSurface **不是 router 内置状态**
- RequestionSurface 是独立的 peer，通过 WebSocket 连接到 router
- RequestionSurface 通过本地 tap 接收广播事件
- RequestionSurface 可回答发给自身地址的 ReadRequest

## 2. 架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Router                                                         │
│  - 广播 session_update 给 ObserverSurface                       │
│  - 广播 requestion.* 给 ObserverSurface 和 RequestionSurface    │
│  - 转发 ReadRequest/ReadResponse                                │
│  - 不 materialize 状态                                          │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Observer       │  │  Requestion     │  │  Control        │
│  Surface        │  │  Surface        │  │  Surface        │
│  (只读观察)      │  │  (缓存+查询)    │  │  (发送命令)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 3. 职责

### 3.1 事件收集

RequestionSurface 持续收集以下事件：

| 事件类型 | 来源 | 缓存策略 |
|---|---|---|
| `requestion.asked` | router 广播 | 缓存 pending 项 |
| `requestion.response` | router 广播 | 标记已响应 |
| `session_update` | router 广播 | 缓存最新状态 |

### 3.2 查询回答

RequestionSurface 可回答发给自身地址的 ReadRequest：

| 操作 | 说明 | 数据来源 |
|---|---|---|
| `requestion_snapshot` | 返回当前 pending 的 requestion 列表 | 本地缓存 |
| `session_update_snapshot` | 返回最新的 session_update 状态 | 本地缓存 |

**注意**: RequestionSurface 回答的是**缓存副本**，不是权威来源。

### 3.3 可靠性边界

| 场景 | 行为 | 风险 |
|---|---|---|
| RequestionSurface 重启 | 缓存丢失 | 重新收集需要时间 |
| 事件 lagged | 部分事件丢失 | 缓存不完整 |
| Router 重启 | 所有连接断开 | 需要重新连接和收集 |

**建议**: RequestionSurface 适合作为**辅助查询**，不作为关键路径依赖。

## 4. 缓存格式

### 4.1 Requestion 缓存

```typescript
type RequestionCacheEntry = {
  sessionID: string;
  requestID: string;
  title: string;
  description?: string | null;
  questions?: Array<{
    options?: Array<{ label: string; description?: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
  requestedAt: string;
  status: "pending" | "responded";
  response?: {
    answers: string[][];
    respondedAt: string;
  };
};
```

### 4.2 SessionUpdate 缓存

```typescript
type SessionUpdateCacheEntry = {
  sessionID: string;
  state: "busy" | "idle" | "stopped" | "waiting";
  metadata?: {
    reason?: string;
    extraInfo?: string | null;
  };
  updatedAt: string;
};
```

## 5. 查询返回格式

### 5.1 RequestionSnapshot 响应

```json
{
  "requestId": "uuid",
  "traceId": "uuid",
  "status": { "type": "ok" },
  "data": {
    "pending": [
      {
        "sessionID": "ses_xxx",
        "requestID": "req_xxx",
        "title": "Permission: edit file",
        "description": "Allow editing /path/to/file",
        "questions": [...],
        "requestedAt": "2026-05-15T10:30:00Z"
      }
    ],
    "responded": [...]
  },
  "responderNodeId": "requestion-surface-1"
}
```

### 5.2 SessionUpdateSnapshot 响应

```json
{
  "requestId": "uuid",
  "traceId": "uuid",
  "status": { "type": "ok" },
  "data": {
    "sessions": {
      "ses_xxx": {
        "state": "busy",
        "metadata": {
          "reason": "generating",
          "extraInfo": "generating response"
        },
        "updatedAt": "2026-05-15T10:30:00Z"
      }
    }
  },
  "responderNodeId": "requestion-surface-1"
}
```

## 6. 连接流程

```
1. RequestionSurface 连接到 router
2. 发送 Hello: { nodeId: "requestion-surface-1", role: "observer_surface", addresses: [...] }
3. 接收 HelloReply
4. 开始接收 tap 事件 (requestion.* 和 session_update)
5. 缓存事件到本地
6. 等待 ReadRequest 查询
```

## 7. 与 ObserverSurface 的区别

| 特性 | ObserverSurface | RequestionSurface |
|---|---|---|
| 事件接收 | 本地 tap | 本地 tap |
| 缓存 | 无 | 有 |
| 查询回答 | 无 | 有 |
| 职责 | 只读观察 | 缓存+查询 |
| 可靠性 | 事件丢失可接受 | 缓存丢失需重建 |

## 8. 关键约束

1. **RequestionSurface 不是 router 内置状态**
   - 独立的 peer，通过 WebSocket 连接
   - 可以有多个 RequestionSurface 实例

2. **SessionUpdateSnapshot 权威来源是 plugin 端**
   - RequestionSurface 只缓存副本
   - 查询结果可能略有延迟

3. **Router 只做广播和转发**
   - Router 不 materialize 状态
   - Router 只转发 ReadRequest/ReadResponse

4. **缓存可靠性**
   - 重启后缓存丢失
   - 事件 lagged 可能导致缓存不完整
   - 适合作为辅助查询，不作为关键路径依赖
