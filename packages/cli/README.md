# chainlesschain CLI

Command-line interface for installing, configuring, and managing [ChainlessChain](https://www.chainlesschain.com) — a decentralized personal AI management system with hardware-level security.

## Quick Start

```bash
npm install -g chainlesschain
chainlesschain setup
```

## Requirements

- **Node.js** >= 22.12.0
- **Docker** (optional, for backend services)

## Commands

### `chainlesschain setup`

Interactive setup wizard. Checks prerequisites, configures LLM provider, downloads the desktop binary, and optionally starts Docker services.

```bash
chainlesschain setup
chainlesschain setup --skip-download    # Skip binary download
chainlesschain setup --skip-services    # Skip Docker setup
```

### `chainlesschain start`

Launch the ChainlessChain desktop application.

```bash
chainlesschain start                    # Launch GUI app
chainlesschain start --headless         # Start backend services only (no GUI)
chainlesschain start --services         # Also start Docker services
```

### `chainlesschain stop`

Stop ChainlessChain.

```bash
chainlesschain stop                     # Stop desktop app
chainlesschain stop --services          # Stop Docker services only
chainlesschain stop --all               # Stop app + Docker services
```

### `chainlesschain status`

Show status of the desktop app, Docker services, and port availability.

```bash
chainlesschain status
```

### `chainlesschain services <action>`

Manage Docker backend services (Ollama, Qdrant, PostgreSQL, Redis, etc.).

```bash
chainlesschain services up              # Start all services
chainlesschain services up ollama redis  # Start specific services
chainlesschain services down            # Stop all services
chainlesschain services logs            # View logs
chainlesschain services logs -f         # Follow logs
chainlesschain services pull            # Pull latest images
```

### `chainlesschain config <action>`

Manage configuration.

```bash
chainlesschain config list              # Show all config values
chainlesschain config get llm.provider  # Get a specific value
chainlesschain config set llm.provider openai
chainlesschain config set llm.apiKey sk-...
chainlesschain config edit              # Open in $EDITOR
chainlesschain config reset             # Reset to defaults
```

### `chainlesschain update`

Check for and install updates.

```bash
chainlesschain update                   # Update to latest stable
chainlesschain update --check           # Check only, don't download
chainlesschain update --channel beta    # Use beta channel
chainlesschain update --channel dev     # Use dev channel
chainlesschain update --force           # Re-download even if exists
```

### `chainlesschain doctor`

Diagnose your environment.

```bash
chainlesschain doctor
```

Checks: Node.js version, npm, Docker, Docker Compose, Git, config directory, binary installation, setup status, port availability, disk space.

## Global Options

```bash
chainlesschain --version   # Show version
chainlesschain --help      # Show help
chainlesschain --verbose   # Enable verbose output
chainlesschain --quiet     # Suppress non-essential output
```

## Configuration

Configuration is stored at `~/.chainlesschain/config.json`. The CLI creates and manages this file automatically during setup.

### Config Schema

```json
{
  "setupCompleted": true,
  "completedAt": "2026-03-11T00:00:00.000Z",
  "edition": "personal",
  "llm": {
    "provider": "ollama",
    "apiKey": null,
    "baseUrl": "http://localhost:11434",
    "model": "qwen2:7b"
  },
  "enterprise": {
    "serverUrl": null,
    "apiKey": null,
    "tenantId": null
  },
  "services": {
    "autoStart": false,
    "dockerComposePath": null
  },
  "update": {
    "channel": "stable",
    "autoCheck": true
  }
}
```

### Supported LLM Providers

| Provider            | Default Model | API Key Required |
| ------------------- | ------------- | ---------------- |
| Ollama (Local)      | qwen2:7b      | No               |
| OpenAI              | gpt-4o        | Yes              |
| DashScope (Alibaba) | qwen-max      | Yes              |
| DeepSeek            | deepseek-chat | Yes              |
| Custom              | —             | Yes              |

## File Structure

```
~/.chainlesschain/
├── config.json        # Configuration
├── bin/               # Downloaded binaries
├── state/             # Runtime state (PID files)
├── services/          # Service configurations
├── logs/              # CLI logs
└── cache/             # Download cache
```

## Development

```bash
cd packages/cli
npm install
npm test                # Run all tests
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e        # End-to-end tests
```

## License

MIT
