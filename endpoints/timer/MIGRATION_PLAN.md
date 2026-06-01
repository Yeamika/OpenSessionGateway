# Timer Endpoint: TypeScript → Rust Migration Plan

## Overview

This document outlines the migration plan for converting the GlassVein Timer Endpoint from TypeScript/Node.js to Rust.

## Current State

### TypeScript Implementation
- **Location**: `GlassVein/endpoints/timer/`
- **Runtime**: Node.js (ES modules)
- **Dependencies**: None (zero-dependency implementation)
- **Architecture**: 
  - HTTP server with static file serving
  - MCP JSON-RPC API endpoints
  - WebSocket client for GlassVein router connection
  - In-memory timer storage with scheduling
  - Cron expression parser
  - Browser-based web UI

### Key Modules
1. `main.js` - Entry point, configuration loading
2. `config.js` - Configuration management
3. `timer-store.js` - Timer state and scheduling logic
4. `mcp-api.js` - MCP JSON-RPC API handlers
5. `gv-client.js` - GlassVein WebSocket client
6. `http-server.js` - HTTP server and routing
7. `cron.js` - Cron expression parser
8. `osgp-wire.js` - OSGP envelope helpers

### Test Coverage
- `config.test.js` - Configuration tests
- `mcp-api.test.js` - MCP API tests
- `timer-store.test.js` - Timer store tests

## Migration Strategy

### Phase 1: Core Infrastructure (Week 1)
1. **Create Rust project structure**
   - Initialize Cargo project with workspace integration
   - Set up dependencies (tokio, serde, etc.)
   - Define module structure

2. **Implement configuration management**
   - Port `config.js` → `config.rs`
   - Support JSON configuration files
   - Environment variable fallbacks

3. **Implement OSGP wire helpers**
   - Port `osgp-wire.js` → `osgp_wire.rs`
   - Use existing `osgp` crate types
   - Envelope creation and parsing

### Phase 2: Core Logic (Week 2)
1. **Implement cron parser**
   - Port `cron.js` → `cron.rs`
   - Five-field UTC cron expression parsing
   - Next trigger time calculation
   - Comprehensive test suite

2. **Implement timer store**
   - Port `timer-store.js` → `timer_store.rs`
   - In-memory timer storage
   - Timer lifecycle management (create, delete, fire)
   - Scheduling with tokio tasks

3. **Implement GlassVein client**
   - Port `gv-client.js` → `gv_client.rs`
   - WebSocket connection management
   - Reconnection logic
   - Message sending/receiving

### Phase 3: API Layer (Week 3)
1. **Implement HTTP server**
   - Port `http-server.js` → `web.rs`
   - Static file serving for web UI
   - REST API endpoints
   - Configuration reload endpoint

2. **Implement MCP API handlers**
   - Port `mcp-api.js` → `mcp_api.rs`
   - JSON-RPC 2.0 protocol
   - Self and manager tool sets
   - Tool execution and response formatting

3. **Implement web UI serving**
   - Serve existing `web/` directory
   - MIME type handling
   - SPA fallback routing

### Phase 4: Integration & Testing (Week 4)
1. **Integration testing**
   - End-to-end timer lifecycle tests
   - WebSocket connection tests
   - MCP API compliance tests

2. **Performance optimization**
   - Memory usage optimization
   - Connection pooling
   - Scheduling efficiency

3. **Documentation**
   - Update README.md
   - API documentation
   - Configuration guide

## Technical Decisions

### HTTP Framework
**Choice**: `axum` (from tokio ecosystem)
- **Rationale**: 
  - Built on tokio/hyper, good ecosystem integration
  - Type-safe extractors and handlers
  - WebSocket support built-in
  - Active maintenance and community

### Async Runtime
**Choice**: `tokio`
- **Rationale**: Already used in other GlassVein endpoints
- **Features**: `macros`, `rt`, `rt-multi-thread`, `sync`, `net`, `io-util`, `time`

### WebSocket Client
**Choice**: `tokio-tungstenite`
- **Rationale**: Already used in other GlassVein endpoints
- **Integration**: Works well with tokio runtime

### Serialization
**Choice**: `serde` + `serde_json`
- **Rationale**: Standard Rust serialization
- **Features**: Derive macros for configuration types

### Error Handling
**Choice**: `anyhow`
- **Rationale**: Already used in other GlassVein endpoints
- **Usage**: Application-level error handling

### Logging
**Choice**: `tracing` + `tracing-subscriber`
- **Rationale**: Already used in other GlassVein endpoints
- **Features**: Structured logging, environment filter

### UUID Generation
**Choice**: `uuid`
- **Rationale**: Already used in other GlassVein endpoints
- **Usage**: Timer ID generation

## Module Structure

```
timer-endpoint/
├── Cargo.toml
├── src/
│   ├── main.rs          # Entry point, configuration, component initialization
│   ├── config.rs        # Configuration management
│   ├── timer_store.rs   # Timer state and scheduling
│   ├── mcp_api.rs       # MCP JSON-RPC API handlers
│   ├── gv_client.rs     # GlassVein WebSocket client
│   ├── web.rs           # HTTP server and routing
│   ├── cron.rs          # Cron expression parser
│   ├── osgp_wire.rs     # OSGP envelope helpers
│   └── tests.rs         # Test module
└── web/                 # Browser UI (unchanged)
```

## Dependencies

```toml
[dependencies]
anyhow.workspace = true
axum = { version = "0.7", features = ["ws"] }
futures-util.workspace = true
serde = { workspace = true, features = ["derive"] }
serde_json.workspace = true
osgp.workspace = true
tokio = { workspace = true, features = ["macros", "rt", "rt-multi-thread", "sync", "net", "io-util", "time"] }
tokio-tungstenite.workspace = true
tracing.workspace = true
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid.workspace = true
```

## Acceptance Criteria

### Functional Requirements
1. **Timer Operations**
   - Create one-shot timers with delay
   - Create periodic timers with interval
   - Create cron timers with expression
   - Delete timers by ID
   - List timers by runtime/session

2. **MCP API Compliance**
   - JSON-RPC 2.0 protocol support
   - Self endpoint (`/mcp/timer_scheduler`)
   - Manager endpoint (`/mcp/timer_manager`)
   - All tools implemented:
     - `CreateOneShotTimer`
     - `CreatePeriodicTimer`
     - `CreateCronTimer`
     - `DeleteRuntimeTimer`
     - `ListRuntimeTimers`
     - `ListAllTimers`
     - `ReloadConfig`

3. **GlassVein Integration**
   - WebSocket connection to GV router
   - Automatic reconnection
   - Timer fire notifications as `control` envelopes
   - OSGP-shaped addresses and envelopes

4. **Web Interface**
   - Static file serving for existing web UI
   - REST API for timer management
   - Configuration reload endpoint
   - Status endpoint

### Non-Functional Requirements
1. **Performance**
   - Timer scheduling accuracy within 1 second
   - Support for 10,000+ concurrent timers
   - Memory usage < 100MB for typical workloads

2. **Reliability**
   - Graceful shutdown on SIGTERM/SIGINT
   - Timer persistence across configuration reloads
   - Error recovery without data loss

3. **Compatibility**
   - Configuration file format compatibility
   - API endpoint compatibility
   - Web UI compatibility

## Testing Strategy

### Unit Tests
1. **Cron Parser Tests**
   - Valid expression parsing
   - Invalid expression handling
   - Edge cases (leap years, month boundaries)

2. **Timer Store Tests**
   - Timer creation and deletion
   - Timer firing logic
   - Concurrent access safety

3. **MCP API Tests**
   - JSON-RPC request/response format
   - Tool parameter validation
   - Error handling

### Integration Tests
1. **HTTP Server Tests**
   - Static file serving
   - API endpoint responses
   - Configuration reload

2. **WebSocket Client Tests**
   - Connection establishment
   - Message sending/receiving
   - Reconnection logic

### End-to-End Tests
1. **Timer Lifecycle Tests**
   - Create → Wait → Fire → Delete
   - Multiple timer types
   - Concurrent operations

## Migration Checklist

### Week 1: Core Infrastructure
- [ ] Create Cargo.toml with dependencies
- [ ] Implement `config.rs`
- [ ] Implement `osgp_wire.rs`
- [ ] Set up module structure
- [ ] Basic main.rs skeleton

### Week 2: Core Logic
- [ ] Implement `cron.rs` with tests
- [ ] Implement `timer_store.rs` with tests
- [ ] Implement `gv_client.rs`
- [ ] Integration with osgp crate

### Week 3: API Layer
- [ ] Implement `web.rs` (HTTP server)
- [ ] Implement `mcp_api.rs`
- [ ] Static file serving
- [ ] REST API endpoints

### Week 4: Integration & Testing
- [ ] Integration tests
- [ ] Performance testing
- [ ] Documentation updates
- [ ] Acceptance testing

## Risks and Mitigations

### Risk 1: Cron Parser Compatibility
- **Risk**: Rust cron parser may behave differently than JavaScript version
- **Mitigation**: Comprehensive test suite with edge cases from TypeScript implementation

### Risk 2: WebSocket Client Stability
- **Risk**: Reconnection logic may not match Node.js behavior
- **Mitigation**: Use proven patterns from other GlassVein endpoints

### Risk 3: Performance Regression
- **Risk**: Rust implementation may have different performance characteristics
- **Mitigation**: Benchmark against TypeScript implementation, optimize hot paths

### Risk 4: Configuration Compatibility
- **Risk**: JSON parsing may have subtle differences
- **Mitigation**: Use serde with careful field mapping, test with existing config files

## Success Metrics

1. **Functional Parity**: All TypeScript features implemented in Rust
2. **Test Coverage**: >90% code coverage for core modules
3. **Performance**: Timer scheduling latency < 10ms
4. **Reliability**: Zero data loss during normal operation
5. **Compatibility**: Existing web UI works without modification

## Timeline

- **Week 1**: Core infrastructure and configuration
- **Week 2**: Core logic (cron, timer store, GV client)
- **Week 3**: API layer (HTTP, MCP, web serving)
- **Week 4**: Integration, testing, documentation

## Resources

1. **Reference Implementations**
   - `endpoints/console/` - Rust endpoint structure
   - `endpoints/requestion/` - HTTP server patterns
   - `clients/rust/` - WebSocket client patterns

2. **Documentation**
   - GlassVein AGENTS.md - Project rules and constraints
   - OSGP crate documentation - Protocol types
   - Tokio documentation - Async runtime patterns

3. **Tools**
   - Cargo workspace configuration
   - Rust analyzer for IDE support
   - Tokio console for debugging

---

**Prepared by**: GVS-Timer  
**Date**: 2026-05-27  
**Version**: 1.0
