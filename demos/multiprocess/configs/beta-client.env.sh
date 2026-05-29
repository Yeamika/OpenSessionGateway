#!/usr/bin/env bash
# beta-client: 2 sessions on west-router
# Binary: bash-clientdummy
# Connects to: west-router ws://127.0.0.1:7202
# Sessions: session-beta-1, session-beta-2

bash-clientdummy \
  --router-url ws://127.0.0.1:7202 \
  --node-id beta-client \
  --domain west \
  --runtime runtime-beta \
  --session session-beta-1 \
  --session session-beta-2 \
  --stay-alive \
  --interactive
