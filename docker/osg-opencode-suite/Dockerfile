FROM postgres:15

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    nodejs \
    npm \
    procps \
    python3 \
    ripgrep \
    rsync \
    tini \
  && npm install -g bun@1.3.11 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY docker/osg-opencode-suite/scripts/ /opt/osg-opencode-suite/scripts/

RUN chmod +x /opt/osg-opencode-suite/scripts/*.sh

ENTRYPOINT ["/usr/bin/tini", "--"]
