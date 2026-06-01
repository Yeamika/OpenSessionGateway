# Timer Endpoint Acceptance Criteria

## Overview

This document defines the acceptance criteria for the GlassVein Timer Endpoint, including both the current TypeScript implementation and the planned Rust migration.

## Functional Requirements

### 1. Timer Operations

#### 1.1 One-Shot Timers
- **AC-1.1.1**: Create one-shot timer with valid `afterSeconds` parameter
- **AC-1.1.2**: Timer fires after specified delay (±1 second tolerance)
- **AC-1.1.3**: Timer is automatically deleted after firing
- **AC-1.1.4**: Invalid `afterSeconds` (≤0 or non-integer) returns error

#### 1.2 Periodic Timers
- **AC-1.2.1**: Create periodic timer with valid `everySeconds` parameter
- **AC-1.2.2**: Timer fires at regular intervals (±1 second tolerance)
- **AC-1.2.3**: Timer continues until explicitly deleted
- **AC-1.2.4**: Invalid `everySeconds` (≤0 or non-integer) returns error

#### 1.3 Cron Timers
- **AC-1.3.1**: Create cron timer with valid 5-field UTC expression
- **AC-1.3.2**: Timer fires at correct cron schedule
- **AC-1.3.3**: Invalid cron expression returns error
- **AC-1.3.4**: Cron expression supports:
  - Minute (0-59)
  - Hour (0-23)
  - Day of month (1-31)
  - Month (1-12)
  - Weekday (0-6, 7=Sunday)

#### 1.4 Timer Management
- **AC-1.4.1**: Delete timer by ID with correct runtime/session ownership
- **AC-1.4.2**: Delete non-existent timer returns appropriate error
- **AC-1.4.3**: List timers filtered by runtimeID and sessionID
- **AC-1.4.4**: List all timers (manager operation)
- **AC-1.4.5**: Timer data includes all required fields:
  - `TimerID` (UUID format)
  - `RuntimeID`
  - `SessionID`
  - `ExecutorRuntimeID`
  - `ExecutorSessionID`
  - `Title`
  - `MSG`
  - `TimerType` (one_shot, periodic, cron)
  - `DelaySeconds` / `EverySeconds` / `CronExpr`
  - `createdAt` (ISO 8601)
  - `triggerAt` (ISO 8601)
  - `status` (pending, waiting_runtime)

### 2. MCP API Compliance

#### 2.1 Protocol Requirements
- **AC-2.1.1**: JSON-RPC 2.0 protocol compliance
- **AC-2.1.2**: `initialize` method returns server info and capabilities
- **AC-2.1.3**: `tools/list` method returns available tools
- **AC-2.1.4**: `tools/call` method executes tools and returns results
- **AC-2.1.5**: Proper error codes for invalid requests

#### 2.2 Self Endpoint (`/mcp/timer_scheduler`)
- **AC-2.2.1**: `runtimeID` from query parameter
- **AC-2.2.2**: `ExecutorSessionID` from request body
- **AC-2.2.3**: Tools available:
  - `CreateOneShotTimer`
  - `CreatePeriodicTimer`
  - `CreateCronTimer`
  - `DeleteRuntimeTimer`
  - `ListRuntimeTimers`

#### 2.3 Manager Endpoint (`/mcp/timer_manager`)
- **AC-2.3.1**: `runtimeID` and `sessionID` from request body
- **AC-2.3.2**: `ExecutorSessionID` for caller audit
- **AC-2.3.3**: All self tools plus:
  - `ListAllTimers`
  - `ReloadConfig`

### 3. GlassVein Integration

#### 3.1 WebSocket Client
- **AC-3.1.1**: Connect to GV router at configured URL
- **AC-3.1.2**: Send hello message on connection
- **AC-3.1.3**: Handle ping/pong messages
- **AC-3.1.4**: Automatic reconnection on disconnect
- **AC-3.1.5**: Connection state tracking (disconnected, connecting, connected)

#### 3.2 OSGP Protocol
- **AC-3.2.1**: Timer fire notifications as `control` envelopes
- **AC-3.2.2**: Envelope subtype: `timer.fired`
- **AC-3.2.3**: Proper source/target addresses
- **AC-3.2.4**: Response envelopes for control messages

### 4. Web Interface

#### 4.1 Static File Serving
- **AC-4.1.1**: Serve files from `web/` directory
- **AC-4.1.2**: Correct MIME types for HTML, CSS, JS
- **AC-4.1.3**: SPA fallback to `index.html`
- **AC-4.1.4**: Path traversal protection

#### 4.2 REST API
- **AC-4.2.1**: `GET /api/status` returns config and GV state
- **AC-4.2.2**: `POST /api/config/reload` reloads configuration
- **AC-4.2.3**: `GET /api/timers` lists timers with optional filters
- **AC-4.2.4**: `POST /api/timers` executes timer operations

#### 4.3 Web Executor
- **AC-4.3.1**: Web calls use configured `webExecutor.runtimeID`
- **AC-4.3.2**: Web calls use configured `webExecutor.sessionID`
- **AC-4.3.3**: Web executor injected into manager tool calls

### 5. Configuration

#### 5.1 Configuration File
- **AC-5.1.1**: JSON configuration file support
- **AC-5.1.2**: `--config` command line argument
- **AC-5.1.3**: Safe local defaults when no config provided
- **AC-5.1.4**: Configuration fields:
  - `listen.host` (default: 127.0.0.1)
  - `listen.port` (default: 8789)
  - `gv.routerUrl` (optional)
  - `gv.runtimeID` (default: timer-endpoint)
  - `webExecutor.runtimeID`
  - `webExecutor.sessionID`

#### 5.2 Configuration Reload
- **AC-5.2.1**: Hot reload via HTTP endpoint
- **AC-5.2.2**: Hot reload via MCP tool
- **AC-5.2.3**: Existing timers preserved during reload
- **AC-5.2.4**: GV connection updated if routerUrl changes

## Non-Functional Requirements

### 6. Performance

#### 6.1 Timer Scheduling
- **AC-6.1.1**: Timer scheduling accuracy within 1 second
- **AC-6.1.2**: Support for 10,000+ concurrent timers
- **AC-6.1.3**: Memory usage < 100MB for typical workloads

#### 6.2 API Response Time
- **AC-6.2.1**: MCP tool calls < 100ms
- **AC-6.2.2**: REST API calls < 50ms
- **AC-6.2.3**: Static file serving < 10ms

### 7. Reliability

#### 7.1 Error Handling
- **AC-7.1.1**: Graceful handling of invalid JSON
- **AC-7.1.2**: Proper error messages for all error conditions
- **AC-7.1.3**: No panics or crashes on invalid input

#### 7.2 Resource Management
- **AC-7.2.1**: Graceful shutdown on SIGTERM/SIGINT
- **AC-7.2.2**: Proper cleanup of timer handles
- **AC-7.2.3**: WebSocket connection cleanup on shutdown

### 8. Compatibility

#### 8.1 API Compatibility
- **AC-8.1.1**: All TypeScript API endpoints work in Rust version
- **AC-8.1.2**: JSON request/response format identical
- **AC-8.1.3**: Error codes and messages compatible

#### 8.2 Configuration Compatibility
- **AC-8.2.1**: Existing config files work without modification
- **AC-8.2.2**: Environment variable fallbacks (if applicable)

#### 8.3 Web UI Compatibility
- **AC-8.3.1**: Existing web UI works without modification
- **AC-8.3.2**: All web UI features functional

## Test Requirements

### 9. Unit Tests

#### 9.1 Cron Parser Tests
- **AC-9.1.1**: Valid expression parsing
- **AC-9.1.2**: Invalid expression handling
- **AC-9.1.3**: Edge cases:
  - Leap year February 29
  - Month boundaries (31st vs 30th)
  - Sunday as 0 and 7

#### 9.2 Timer Store Tests
- **AC-9.2.1**: Timer creation with all types
- **AC-9.2.2**: Timer deletion with ownership check
- **AC-9.2.3**: Timer firing logic
- **AC-9.2.4**: Concurrent access safety

#### 9.3 MCP API Tests
- **AC-9.3.1**: JSON-RPC request parsing
- **AC-9.3.2**: Tool parameter validation
- **AC-9.3.3**: Error response formatting

### 10. Integration Tests

#### 10.1 HTTP Server Tests
- **AC-10.1.1**: Static file serving
- **AC-10.1.2**: API endpoint responses
- **AC-10.1.3**: Configuration reload

#### 10.2 WebSocket Client Tests
- **AC-10.2.1**: Connection establishment
- **AC-10.2.2**: Message sending/receiving
- **AC-10.2.3**: Reconnection logic

### 11. End-to-End Tests

#### 11.1 Timer Lifecycle Tests
- **AC-11.1.1**: Create → Wait → Fire → Delete
- **AC-11.1.2**: Multiple timer types
- **AC-11.1.3**: Concurrent operations

## Code Quality Requirements

### 12. Code Standards

#### 12.1 Rust Code Quality
- **AC-12.1.1**: No compiler warnings
- **AC-12.1.2**: Clippy lints clean
- **AC-12.1.3**: Rustfmt formatting applied
- **AC-12.1.4**: Documentation comments for public APIs

#### 12.2 Test Coverage
- **AC-12.2.1**: >90% code coverage for core modules
- **AC-12.2.2**: All public functions tested
- **AC-12.2.3**: Edge cases covered

#### 12.3 Code Organization
- **AC-12.3.1**: Single file ≤ 500 lines
- **AC-12.3.2**: Tests in separate `tests.rs` module
- **AC-12.3.3**: Clear module boundaries

## Documentation Requirements

### 13. Documentation

#### 13.1 README.md
- **AC-13.1.1**: Project overview
- **AC-13.1.2**: Installation instructions
- **AC-13.1.3**: Configuration guide
- **AC-13.1.4**: API documentation

#### 13.2 AGENTS.md
- **AC-13.2.1**: Project rules and constraints
- **AC-13.2.2**: Code standards
- **AC-13.2.3**: Testing requirements

#### 13.3 API Documentation
- **AC-13.3.1**: MCP tool specifications
- **AC-13.3.2**: REST API endpoints
- **AC-13.3.3**: Configuration options

## Acceptance Checklist

### Phase 1: Core Infrastructure
- [ ] Cargo.toml with correct dependencies
- [ ] Configuration management implemented
- [ ] OSGP wire helpers implemented
- [ ] Module structure established

### Phase 2: Core Logic
- [ ] Cron parser with comprehensive tests
- [ ] Timer store with all timer types
- [ ] GlassVein WebSocket client
- [ ] Integration with osgp crate

### Phase 3: API Layer
- [ ] HTTP server with all endpoints
- [ ] MCP API handlers
- [ ] Static file serving
- [ ] REST API implementation

### Phase 4: Integration & Testing
- [ ] Integration tests passing
- [ ] End-to-end tests passing
- [ ] Performance benchmarks met
- [ ] Documentation complete

## Sign-off Criteria

### Technical Sign-off
1. All acceptance criteria met
2. All tests passing
3. Code review completed
4. Performance benchmarks met

### Product Sign-off
1. Feature parity with TypeScript version
2. Web UI fully functional
3. No regressions in existing functionality
4. Documentation complete

---

**Prepared by**: GVS-Timer  
**Date**: 2026-05-27  
**Version**: 1.0
