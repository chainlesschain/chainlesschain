# ChainlessChain CLI Installation Guide

## Quick Start

```bash
npm install -g chainlesschain
chainlesschain setup
```

## Prerequisites

- **Node.js** >= 22.12.0 ([download](https://nodejs.org/))
- **Docker** (optional, for backend services)

## Installation

### 1. Install the CLI

```bash
npm install -g chainlesschain
```

Verify:

```bash
chainlesschain --version
```

### 2. Run the Setup Wizard

```bash
chainlesschain setup
```

The wizard guides you through:

1. Node.js version check
2. Docker availability check (optional)
3. Edition selection (Personal / Enterprise)
4. LLM provider configuration (Ollama / OpenAI / DashScope / DeepSeek / Custom)
5. API key input (for cloud providers)
6. Desktop binary download
7. Configuration saved to `~/.chainlesschain/config.json`
8. Optional: start Docker backend services

### 3. Launch the App

```bash
chainlesschain start
```

### 4. Check Your Environment

```bash
chainlesschain doctor
```

## Platform-Specific Instructions

### Windows

```powershell
nvm install 22.12.0
nvm use 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

### macOS

```bash
nvm install 22.12.0
nvm use 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

### Linux

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22.12.0
npm install -g chainlesschain
chainlesschain setup
```

## Daily Usage

```bash
# Start/Stop
chainlesschain start              # Launch desktop app
chainlesschain stop               # Stop app
chainlesschain stop --all         # Stop app + all services

# Docker Services
chainlesschain services up        # Start backend services
chainlesschain services down      # Stop backend services
chainlesschain services logs -f   # Follow service logs

# Configuration
chainlesschain config list        # Show config
chainlesschain config set llm.provider openai
chainlesschain config set llm.apiKey sk-xxx

# Updates
chainlesschain update             # Check and install updates
chainlesschain update --check     # Check only

# Diagnostics
chainlesschain doctor             # Environment diagnostics
chainlesschain status             # Show running status
```

## Troubleshooting

### Command not found after install

Ensure npm global bin directory is in your PATH:

```bash
npm config get prefix
# Add <output>/bin to your PATH
```

### Binary download fails

Download manually and place in `~/.chainlesschain/bin/`. Or use a proxy:

```bash
HTTPS_PROXY=http://proxy:port chainlesschain setup
```

### Docker services won't start

1. Ensure Docker Desktop is running
2. Check for port conflicts: `chainlesschain doctor`
3. View logs: `chainlesschain services logs`

## Uninstall

```bash
npm uninstall -g chainlesschain
rm -rf ~/.chainlesschain
```
