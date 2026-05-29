#!/usr/bin/env bash
# omega-client: 1 session on nested-router
# Binary: bash-clientdummy
# Connects to: nested-router ws://127.0.0.1:7203
# Sessions: session-omega-1

bash-clientdummy \
  --router-url ws://127.0.0.1:7203 \
  --node-id omega-client \
  --domain nested \
  --runtime runtime-omega \
  --session session-omega-1 \
  --stay-alive \
  --interactive
