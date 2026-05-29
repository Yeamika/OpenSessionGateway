#!/usr/bin/env bash
# alpha-client: 2 sessions on east-router
# Binary: bash-clientdummy
# Connects to: east-router ws://127.0.0.1:7201
# Sessions: session-alpha-1, session-alpha-2

bash-clientdummy \
  --router-url ws://127.0.0.1:7201 \
  --node-id alpha-client \
  --domain east \
  --runtime runtime-alpha \
  --session session-alpha-1 \
  --session session-alpha-2 \
  --stay-alive \
  --interactive
