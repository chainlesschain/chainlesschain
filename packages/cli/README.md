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
chainlesschain note history <id>        # Version history
chainlesschain note diff <id> <v1> <v2> # Diff between versions
chainlesschain note revert <id> <ver>   # Revert to a version
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
chainlesschain llm providers            # List 7 built-in LLM providers
chainlesschain llm add-provider <name>  # Add custom provider
chainlesschain llm switch <name>        # Switch active provider
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

---

## Phase 1: AI Intelligence Layer

### `chainlesschain search <query>`

BM25 hybrid keyword search across notes.

```bash
chainlesschain search "machine learning"
chainlesschain search "API design" --mode bm25 --top-k 10
chainlesschain search "security" --json
```

### `chainlesschain tokens <action>`

Token usage tracking and cost analysis.

```bash
chainlesschain tokens show              # Current usage summary
chainlesschain tokens breakdown         # Per-model breakdown
chainlesschain tokens recent            # Recent usage entries
chainlesschain tokens cache             # Cache hit/miss stats
```

### `chainlesschain memory <action>`

Persistent memory management.

```bash
chainlesschain memory show              # Show all memories
chainlesschain memory add "Always use TypeScript"
chainlesschain memory search "coding"   # Search memories
chainlesschain memory delete <id>       # Delete by ID prefix
chainlesschain memory daily             # Today's daily note
chainlesschain memory file              # Show memory file path
```

### `chainlesschain session <action>`

Session persistence and management.

```bash
chainlesschain session list             # List saved sessions
chainlesschain session show <id>        # Show session details
chainlesschain session resume <id>      # Resume a session
chainlesschain session export <id>      # Export as Markdown
chainlesschain session delete <id>      # Delete a session
```

---

## Phase 2: Knowledge & Content Management

### `chainlesschain import <format>`

Import knowledge from external sources.

```bash
chainlesschain import markdown ./docs   # Import markdown directory
chainlesschain import evernote backup.enex  # Import Evernote ENEX
chainlesschain import notion ./export   # Import Notion export
chainlesschain import pdf document.pdf  # Import PDF text
```

### `chainlesschain export <format>`

Export knowledge base.

```bash
chainlesschain export markdown -o ./output  # Export as Markdown files
chainlesschain export site -o ./site        # Export as static HTML site
```

### `chainlesschain git <action>`

Git integration for knowledge versioning.

```bash
chainlesschain git status               # Show git status
chainlesschain git init                 # Initialize git repo
chainlesschain git auto-commit          # Auto-commit all changes
chainlesschain git hooks                # Install pre-commit hooks
chainlesschain git history-analyze      # Analyze repo history
```

### Note Versioning

```bash
chainlesschain note history <id>        # Show version history
chainlesschain note diff <id> <v1> <v2> # Diff between versions
chainlesschain note revert <id> <ver>   # Revert to version
```

---

## Phase 3: MCP & External Integration

### `chainlesschain mcp <action>`

MCP (Model Context Protocol) server management.

```bash
chainlesschain mcp servers              # List configured servers
chainlesschain mcp add <name> -c <cmd>  # Add a server
chainlesschain mcp remove <name>        # Remove a server
chainlesschain mcp connect <name>       # Connect to server
chainlesschain mcp disconnect <name>    # Disconnect
chainlesschain mcp tools                # List available tools
chainlesschain mcp call <server> <tool> # Call a tool
```

### `chainlesschain browse <action>`

Browser automation (headless fetch-based).

```bash
chainlesschain browse fetch <url>       # Fetch page content
chainlesschain browse scrape <url> -s "h2"  # Scrape CSS selector
chainlesschain browse screenshot <url>  # Take screenshot (requires playwright)
```

### `chainlesschain instinct <action>`

Instinct learning — tracks user preferences over time.

```bash
chainlesschain instinct show            # Show learned instincts
chainlesschain instinct categories      # List 6 instinct categories
chainlesschain instinct prompt          # Generate system prompt from instincts
chainlesschain instinct delete <id>     # Delete an instinct
chainlesschain instinct reset           # Clear all instincts
chainlesschain instinct decay           # Decay old instincts
```

---

## Phase 4: Security & Identity

### `chainlesschain did <action>`

DID identity management (Ed25519).

```bash
chainlesschain did create --label "My Identity"
chainlesschain did list
chainlesschain did show <did>
chainlesschain did sign <did> "message"
chainlesschain did verify <did> "message" <signature>
chainlesschain did export <did>
chainlesschain did set-default <did>
chainlesschain did delete <did>
```

### `chainlesschain encrypt / decrypt`

AES-256-GCM file encryption.

```bash
chainlesschain encrypt file <input> -o <output>
chainlesschain encrypt db
chainlesschain encrypt info <file>
chainlesschain encrypt status
chainlesschain decrypt file <input> -o <output>
chainlesschain decrypt db
```

### `chainlesschain auth <action>`

RBAC permission engine.

```bash
chainlesschain auth roles                          # List roles
chainlesschain auth create-role <name>             # Create custom role
chainlesschain auth grant <user> <role>            # Assign role
chainlesschain auth check <user> <scope>           # Check permission
chainlesschain auth permissions <user>             # List user permissions
chainlesschain auth scopes                         # List all 26 scopes
```

### `chainlesschain audit <action>`

Audit logging and compliance.

```bash
chainlesschain audit log                           # Recent events
chainlesschain audit search --type security        # Search by type
chainlesschain audit stats                         # Statistics
chainlesschain audit export --format json          # Export logs
chainlesschain audit purge --before 90             # Purge old logs
chainlesschain audit types                         # List event types
```

---

## Phase 5: P2P, Blockchain & Enterprise

### `chainlesschain p2p <action>`

Peer-to-peer messaging and device pairing.

```bash
chainlesschain p2p status                          # P2P network status
chainlesschain p2p peers                           # List known peers
chainlesschain p2p send <peer-id> "message"        # Send message
chainlesschain p2p inbox                           # View inbox
chainlesschain p2p pair <device-name>              # Pair a device
chainlesschain p2p devices                         # List paired devices
chainlesschain p2p unpair <device-id>              # Unpair a device
```

### `chainlesschain sync <action>`

File and knowledge synchronization.

```bash
chainlesschain sync status                         # Sync status
chainlesschain sync push                           # Push local changes
chainlesschain sync pull                           # Pull remote changes
chainlesschain sync conflicts                      # List conflicts
chainlesschain sync resolve <id> --strategy local  # Resolve conflict
chainlesschain sync log                            # Sync history
chainlesschain sync clear                          # Clear sync state
```

### `chainlesschain wallet <action>`

Digital wallet and asset management.

```bash
chainlesschain wallet create --name "My Wallet"    # Create wallet
chainlesschain wallet list                         # List wallets
chainlesschain wallet balance <address>            # Check balance
chainlesschain wallet set-default <address>        # Set default wallet
chainlesschain wallet delete <address>             # Delete wallet
chainlesschain wallet asset <address> <type> <name> # Create asset
chainlesschain wallet assets [address]             # List assets
chainlesschain wallet transfer <asset-id> <to>     # Transfer asset
chainlesschain wallet history [address]            # Transaction history
chainlesschain wallet summary                      # Overall summary
```

### `chainlesschain org <action>`

Organization management and workflows.

```bash
chainlesschain org create <name>                   # Create organization
chainlesschain org list                            # List organizations
chainlesschain org show <id>                       # Organization details
chainlesschain org delete <id>                     # Delete organization
chainlesschain org invite <org-id> <user-id>       # Invite member
chainlesschain org members <org-id>                # List members
chainlesschain org team-create <org-id> <name>     # Create team
chainlesschain org teams <org-id>                  # List teams
chainlesschain org approval-submit <org-id> <title> # Submit approval
chainlesschain org approvals <org-id>              # List approvals
chainlesschain org approve <request-id>            # Approve request
chainlesschain org reject <request-id>             # Reject request
```

### `chainlesschain plugin <action>`

Plugin marketplace management.

```bash
chainlesschain plugin list                         # List installed plugins
chainlesschain plugin install <name> --version <v> # Install plugin
chainlesschain plugin remove <name>                # Remove plugin
chainlesschain plugin enable <name>                # Enable plugin
chainlesschain plugin disable <name>               # Disable plugin
chainlesschain plugin update <name> --version <v>  # Update plugin
chainlesschain plugin info <name>                  # Plugin details
chainlesschain plugin search <query>               # Search registry
chainlesschain plugin registry                     # List all registry plugins
chainlesschain plugin summary                      # Installation summary
```

---

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

| Provider            | Default Model     | API Key Required |
| ------------------- | ----------------- | ---------------- |
| Ollama (Local)      | qwen2:7b          | No               |
| OpenAI              | gpt-4o            | Yes              |
| Anthropic           | claude-sonnet-4-6 | Yes              |
| DashScope (Alibaba) | qwen-max          | Yes              |
| DeepSeek            | deepseek-chat     | Yes              |
| Gemini (Google)     | gemini-pro        | Yes              |
| Mistral             | mistral-large     | Yes              |
| Custom              | —                 | Yes              |

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
npm test                # Run all tests (903 tests across 47 files)
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e        # End-to-end tests
```

### Test Coverage

| Category                 | Files  | Tests   | Status          |
| ------------------------ | ------ | ------- | --------------- |
| Unit — lib modules       | 25     | 578     | All passing     |
| Unit — commands          | 2      | 43      | All passing     |
| Unit — runtime           | 1      | 6       | All passing     |
| Integration              | 3      | 7       | All passing     |
| E2E                      | 9      | 88      | All passing     |
| Core packages (external) | —      | 118     | All passing     |
| **CLI Total**            | **47** | **903** | **All passing** |

## License

MIT
