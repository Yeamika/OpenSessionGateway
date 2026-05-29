#!/usr/bin/env bash
# delta-client: 1 session on east-router
# Binary: bash-clientdummy
# Connects to: east-router ws://127.0.0.1:7201
# Sessions: session-delta-1

bash-clientdummy \
  --router-url ws://127.0.0.1:7201 \
  --node-id delta-client \
  --domain east \
  --runtime runtime-delta \
  --session session-delta-1 \
  --stay-alive \
  --interactive
