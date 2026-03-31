# Stage 1: Builder
FROM debian:bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    jq \
    ripgrep \
    fzf \
    tmux \
    sudo \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python 3 + uv
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "/tmp/awscliv2.zip" \
    && cd /tmp && unzip awscliv2.zip && ./aws/install && rm -rf /tmp/aws*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Install nah (safety layer — Phase 2 will configure it)
ENV PATH="/root/.local/bin:$PATH"
RUN pip3 install --break-system-packages nah

# Create users
RUN groupadd -g 1000 claude && useradd -m -u 1000 -g claude claude
RUN groupadd -g 999 audit && useradd -m -u 999 -g audit -s /bin/false audit

# Create directories
RUN mkdir -p /home/claude/.claude /home/claude/.local /var/audit/receipts \
    && chown -R claude:claude /home/claude \
    && chown -R audit:audit /var/audit \
    && chmod 700 /var/audit

# Add uv to claude's PATH
RUN echo 'export PATH="/root/.local/bin:$HOME/.local/bin:$PATH"' >> /home/claude/.bashrc

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER claude
WORKDIR /home/claude/work

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
