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

---

## Headless Commands

These commands work without the desktop GUI, using core packages directly.

### `chainlesschain db <action>`

Database management.

```bash
chainlesschain db init                  # Initialize the database
chainlesschain db init --path ./my.db   # Custom database path
chainlesschain db info                  # Show database info (driver, tables, size)
chainlesschain db info --json           # JSON output
chainlesschain db backup [output]       # Create backup
chainlesschain db restore <backup>      # Restore from backup
```

### `chainlesschain note <action>`

Note and knowledge base management.

```bash
chainlesschain note add "My Note" -c "Content here" -t "tag1,tag2"
chainlesschain note list                # List recent notes
chainlesschain note list --category dev --tag important
chainlesschain note show <id>           # Show note by ID prefix
chainlesschain note search "keyword"    # Full-text search
chainlesschain note delete <id>         # Soft delete
```

### `chainlesschain chat`

Start an interactive AI chat session with streaming output.

```bash
chainlesschain chat                     # Default: Ollama qwen2:7b
chainlesschain chat --model llama3      # Use different model
chainlesschain chat --provider openai --api-key sk-...
chainlesschain chat --agent             # Agentic mode (can read/write files)
```

Slash commands in chat: `/exit`, `/model`, `/provider`, `/clear`, `/history`, `/help`

### `chainlesschain ask <question>`

Single-shot AI question (non-interactive).

```bash
chainlesschain ask "What is WebRTC?"
chainlesschain ask "Explain this code" --model gpt-4o --provider openai
chainlesschain ask "Hello" --json       # JSON output with question/answer/model
```

### `chainlesschain llm <action>`

LLM provider management.

```bash
chainlesschain llm models               # List installed Ollama models
chainlesschain llm models --json        # JSON output
chainlesschain llm test                 # Test Ollama connectivity
chainlesschain llm test --provider openai --api-key sk-...
```

### `chainlesschain agent` (alias: `a`)

Start an agentic AI session — the AI can read/write files, run shell commands, search the codebase, and invoke 138 built-in skills.

```bash
chainlesschain agent                    # Default: Ollama qwen2:7b
chainlesschain a --model llama3         # Short alias
chainlesschain agent --provider openai --api-key sk-...
```

Built-in tools: `read_file`, `write_file`, `edit_file`, `run_shell`, `search_files`, `list_dir`, `run_skill`, `list_skills`

### `chainlesschain skill <action>`

Manage and run 138 built-in AI skills.

```bash
chainlesschain skill list               # List all skills grouped by category
chainlesschain skill list --category automation
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON output
chainlesschain skill categories         # Show category breakdown
chainlesschain skill info code-review   # Detailed skill info + docs
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # Search by keyword
chainlesschain skill run code-review "Review this function..."
```

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
npm test                # Run all tests (117 tests across 18 files)
npm run test:unit       # Unit tests only (10 files)
npm run test:integration # Integration tests (3 files)
npm run test:e2e        # End-to-end tests (5 files)
```

### Test Coverage

| Category           | Files  | Tests   | Status          |
| ------------------ | ------ | ------- | --------------- |
| Unit — lib modules | 8      | 52      | All passing     |
| Unit — commands    | 3      | 31      | All passing     |
| Unit — runtime     | 1      | 6       | All passing     |
| Integration        | 3      | 7       | All passing     |
| E2E                | 3      | 21      | All passing     |
| **Total**          | **18** | **117** | **All passing** |

## License

MIT
