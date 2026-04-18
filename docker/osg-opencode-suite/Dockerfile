FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    procps \
    python3 \
    ripgrep \
    rsync \
    sudo \
    tini \
  && echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node \
  && install -d -o node -g node /workspace /runtime /runtime/opencode-config /runtime/workspaces /runtime/npm-global \
  && npm install -g bun@1.3.11 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY . /sources/OpenSessionGateway

COPY docker/osg-opencode-suite/scripts/ /opt/osg-opencode-suite/scripts/

RUN chmod +x /opt/osg-opencode-suite/scripts/*.sh

ENTRYPOINT ["/usr/bin/tini", "--"]
