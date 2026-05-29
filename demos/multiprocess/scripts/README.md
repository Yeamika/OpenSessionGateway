# Demo Scripts

Shared orchestration helpers for the stage scripts.

## `common.sh`

Provides:
- Path constants: `GV_ROOT`, `BIN_DIR`, `LOG_DIR`, `DEMO_ROOT`
- Logging: `pass`, `fail`, `info`, `debug`
- Network: `port_is_listening`, `wait_for_port`, `wait_for_log`
- PID tracking: `init_pid_tracking`, `record_pid`, `cleanup_pids`
- Stage setup: `setup_stage` (creates log dir, registers cleanup trap)
- State: `copy_state_template` (copies demos/ templates to runtime dir)
- Summary: `print_summary`

All scripts must be bounded and include cleanup for background processes.
