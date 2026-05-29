#!/usr/bin/env bash
# gamma-client: 2 sessions on nested-router
# Binary: bash-clientdummy
# Connects to: nested-router ws://127.0.0.1:7203
# Sessions: session-gamma-1, session-gamma-2

bash-clientdummy \
  --router-url ws://127.0.0.1:7203 \
  --node-id gamma-client \
  --domain nested \
  --runtime runtime-gamma \
  --session session-gamma-1 \
  --session session-gamma-2 \
  --stay-alive \
  --interactive
