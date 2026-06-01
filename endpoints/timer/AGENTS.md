# Timer Endpoint Memory

## Scope

- Applies to `GlassVein/endpoints/timer/` and its subdirectories.
- Timer endpoint provides scheduling services for GlassVein ecosystem.
- Currently TypeScript implementation, migrating to Rust.

## Current Implementation

### TypeScript Version (Legacy)
- **Location**: `GlassVein/endpoints/timer/`
- **Runtime**: Node.js (ES modules)
- **Dependencies**: Zero-dependency implementation
- **Status**: Active, scheduled for Rust migration

### Key Files
- `src/main.js` - Entry point, configuration loading
- `src/config.js` - Configuration management
- `src/timer-store.js` - Timer state and scheduling
- `src/mcp-api.js` - MCP JSON-RPC API handlers
- `src/gv-client.js` - GlassVein WebSocket client
- `src/http-server.js` - HTTP server and routing
- `src/cron.js` - Cron expression parser
- `src/osgp-wire.js` - OSGP envelope helpers

### Test Files
- `test/config.test.js` - Configuration tests
- `test/mcp-api.test.js` - MCP API tests
- `test/timer-store.test.js` - Timer store tests

## Architecture

### Timer Types
1. **One-shot**: Single execution after delay
2. **Periodic**: Regular interval execution
3. **Cron**: UTC cron expression scheduling

### API Endpoints
1. **MCP Self**: `/mcp/timer_scheduler?runtimeID=<runtime>`
2. **MCP Manager**: `/mcp/timer_manager`
3. **REST API**: `/api/timers`, `/api/status`, `/api/config/reload`
4. **Web UI**: `/` (static files)

### GlassVein Integration
- WebSocket client connects to GV router
- Timer fire notifications as OSGP `control` envelopes
- Envelope subtype: `timer.fired`
- Automatic reconnection logic

## Configuration

### Configuration File
```json
{
  "listen": { "host": "127.0.0.1", "port": 8789 },
  "gv": { "routerUrl": "ws://127.0.0.1:7200", "runtimeID": "timer-endpoint" },
  "webExecutor": { "runtimeID": "timer-web-caller", "sessionID": "timer-web-session" }
}
```

### Command Line
```sh
npm start -- --config ./config.local.json
```

## Development Rules

### Code Standards
- Single file ≤ 500 lines (including tests)
- Tests in separate test files
- TypeScript: ES modules, no external dependencies
- Rust: Follow GlassVein workspace conventions

### Testing Requirements
- Unit tests for all core modules
- Integration tests for API endpoints
- End-to-end tests for timer lifecycle
- >90% code coverage target

### Documentation
- README.md for user documentation
- AGENTS.md for agent memory (this file)
- ACCEPTANCE.md for acceptance criteria
- MIGRATION_PLAN.md for Rust migration

## Migration Status

### Current Phase
- **Phase 0**: Analysis and planning (completed)
- **Phase 1**: Core infrastructure (next)
- **Phase 2**: Core logic
- **Phase 3**: API layer
- **Phase 4**: Integration and testing

### Migration Documents
- `MIGRATION_PLAN.md` - Detailed migration strategy
- `ACCEPTANCE.md` - Acceptance criteria for Rust version

## Communication

### Team Structure
- **GVS-Timer**: Supervisor (this agent)
- **GVW-Timer**: Worker agent (ses_197cb0984ffeGGwJnXlQV9aWIE)
- **GVMM**: Project manager (upstream)

### Communication Protocol
- Task assignment via mailbox
- Progress reports via mailbox
- Code reviews via acceptance process

## Work Rules

### Code Changes
- TypeScript changes: Direct modification in `src/` and `test/`
- Rust changes: Will be in new `src/` directory after migration
- Web UI changes: Modify `web/` directory

### Testing
- Run `npm test` for TypeScript tests
- Run `cargo test` for Rust tests (after migration)
- Validate with `npm run check` for syntax checking

### Documentation Updates
- Update README.md for user-facing changes
- Update AGENTS.md for memory changes
- Update ACCEPTANCE.md for requirement changes

## Current Tasks

### Immediate
1. Create GVW-Timer worker session ✓
2. Plan TypeScript → Rust migration ✓
3. Create acceptance criteria ✓
4. Create AGENTS.md memory ✓

### Next
1. Send migration tasks to GVW-Timer
2. Monitor progress
3. Review code submissions
4. Update documentation

## References

### Project Documents
- `/workspace/OSG-Project/AGENTS.md` - Workspace rules
- `/workspace/OSG-Project/GlassVein/AGENTS.md` - GlassVein rules
- `/workspace/OSG-Project/GlassVein/endpoints/timer/README.md` - User documentation

### Related Endpoints
- `endpoints/console/` - Rust TUI endpoint (reference)
- `endpoints/requestion/` - Rust HTTP endpoint (reference)

---

**Last Updated**: 2026-05-27  
**Updated By**: GVS-Timer
