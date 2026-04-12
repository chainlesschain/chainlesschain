# chainlesschain CLI

Command-line interface for installing, configuring, and managing [ChainlessChain](https://www.chainlesschain.com) — a decentralized personal AI management system with hardware-level security.

## Quick Start

```bash
npm install -g chainlesschain
chainlesschain setup
```

After installation, three equivalent commands are available:

| Command          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `chainlesschain` | Full name                                                         |
| `cc`             | Shortest alias, recommended for daily use                         |
| `clc`            | ChainLessChain abbreviation, avoids `cc` conflict with C compiler |
| `clchain`        | chainlesschain abbreviation, easy to recognize                    |

```bash
cc setup       # equivalent to: chainlesschain setup
clchain start  # equivalent to: chainlesschain start
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
chainlesschain chat                     # Default: Ollama qwen2.5:7b
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
chainlesschain llm providers            # List 10 built-in LLM providers
chainlesschain llm add-provider <name>  # Add custom provider
chainlesschain llm switch <name>        # Switch active provider
```

### `chainlesschain agent` (alias: `a`)

Start an agentic AI session — the AI can read/write files, run shell commands, search the codebase, execute code (Python/Node.js/Bash with auto pip-install), and invoke 138 built-in skills.

```bash
chainlesschain agent                    # Default: Ollama qwen2.5:7b
chainlesschain a --model llama3         # Short alias
chainlesschain agent --provider openai --api-key sk-...
```

Built-in tools (12): `read_file`, `write_file`, `edit_file`, `edit_file_hashed`, `run_shell`, `git`, `search_files`, `list_dir`, `run_skill`, `list_skills`, `run_code`, `spawn_sub_agent`

Agent slash commands: `/plan` (plan mode), `/plan interactive <request>` (LLM-driven planning with skill recommendations), `/model`, `/provider`, `/clear`, `/compact`, `/task`, `/session`, `/stats`, `/auto` (autonomous agent), `/cowork` (multi-agent collaboration), `/sub-agents` (show active/completed sub-agents)

**Sub-Agent Isolation v2** (v0.43.0): Complex tasks are automatically decomposed into isolated sub-agents, each with its own namespaced memory, scoped context, and lifecycle tracking. Use `/sub-agents` inside an agent session to inspect active and completed sub-agents, token usage, and average durations.

### `chainlesschain skill <action>`

Manage and run 138 built-in AI skills across a 4-layer system: bundled < marketplace < managed (global) < workspace (project).

```bash
chainlesschain skill list               # List all skills grouped by category
chainlesschain skill list --category automation
chainlesschain skill list --category cli-direct   # CLI command skill packs
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON output
chainlesschain skill categories         # Show category breakdown
chainlesschain skill info code-review   # Detailed skill info + docs
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # Search by keyword
chainlesschain skill run code-review "Review this function..."
chainlesschain skill add my-skill       # Create custom project skill
chainlesschain skill remove my-skill    # Remove custom skill
chainlesschain skill sources            # Show skill layer paths and counts
```

#### CLI Command Skill Packs

Automatically wraps 63 CLI commands into 9 Agent-callable domain skill packs:

```bash
chainlesschain skill sync-cli              # Generate/update all 9 CLI skill packs
chainlesschain skill sync-cli --force      # Force regenerate all packs
chainlesschain skill sync-cli --dry-run    # Preview changes without writing
chainlesschain skill sync-cli --remove     # Remove all CLI packs
chainlesschain skill sync-cli --json       # JSON output

# Run CLI commands via skill packs (Agent can call these directly)
chainlesschain skill run cli-knowledge-pack "note list"
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill run cli-infra-pack "services up"
chainlesschain skill run cli-ai-query-pack "ask what is RAG"
chainlesschain skill run cli-agent-mode-pack "agent"
chainlesschain skill run cli-web3-pack "wallet assets"
chainlesschain skill run cli-security-pack "encrypt file secret.txt"
chainlesschain skill run cli-enterprise-pack "org list"
chainlesschain skill run cli-integration-pack "mcp servers"
```

| Pack                   | Mode      | Commands                                                 |
| ---------------------- | --------- | -------------------------------------------------------- |
| `cli-knowledge-pack`   | direct    | note, search, memory, session, import, export            |
| `cli-identity-pack`    | direct    | did, auth, audit                                         |
| `cli-infra-pack`       | direct    | setup, start, stop, status, services, config, doctor, db |
| `cli-ai-query-pack`    | llm-query | ask, llm, instinct, tokens                               |
| `cli-agent-mode-pack`  | agent     | agent, chat, cowork                                      |
| `cli-web3-pack`        | direct    | wallet, p2p, sync, did                                   |
| `cli-security-pack`    | direct    | encrypt, decrypt, audit, pqc                             |
| `cli-enterprise-pack`  | direct    | org, plugin, lowcode, compliance                         |
| `cli-integration-pack` | hybrid    | mcp, browse, cli-anything, serve, ui                     |

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

## Project Initialization & Collaboration

### `chainlesschain init`

Initialize a new ChainlessChain project with a `.chainlesschain/` directory, workspace skills, and an optional AI persona.

```bash
chainlesschain init                                         # Interactive template selection
chainlesschain init --bare                                  # Minimal project structure
chainlesschain init --template code-project --yes           # Software project (code-review, refactor, unit-test)
chainlesschain init --template data-science --yes           # Data science / ML project
chainlesschain init --template devops --yes                 # DevOps / infrastructure project
chainlesschain init --template medical-triage --yes         # Medical triage assistant (with Persona)
chainlesschain init --template agriculture-expert --yes     # Agriculture expert (with Persona)
chainlesschain init --template general-assistant --yes      # General-purpose assistant (with Persona)
chainlesschain init --template ai-media-creator --yes       # AI media creator (ComfyUI/AnimateDiff/TTS)
chainlesschain init --template ai-doc-creator --yes         # AI doc creator (LibreOffice/pandoc/doc-edit)
chainlesschain init --template empty --yes                  # Bare project
```

#### AI Media Creator Template (`ai-media-creator`)

Generates 3 workspace skills for AI image/video/audio creation:

```bash
chainlesschain skill run comfyui-image "a sunset over mountains, oil painting style"
chainlesschain skill run comfyui-video '{"prompt":"a cat walking","workflow":"workflows/animatediff.json"}'
chainlesschain skill run audio-gen "你好，欢迎使用 ChainlessChain"
```

| Skill           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `comfyui-image` | ComfyUI REST API image generation (txt2img/img2img, custom workflows) |
| `comfyui-video` | ComfyUI + AnimateDiff video generation (requires workflow JSON)       |
| `audio-gen`     | AI TTS: auto-selects edge-tts → piper-tts → ElevenLabs → OpenAI       |

Also creates a `workflows/` directory with README for saving ComfyUI workflow JSON files.

#### AI Doc Creator Template (`ai-doc-creator`)

Generates 3 workspace skills for AI document creation and editing:

```bash
chainlesschain skill run doc-generate "2026年技术趋势分析报告"
chainlesschain skill run doc-generate '{"topic":"项目方案","format":"docx","style":"proposal"}'
chainlesschain skill run libre-convert "report.docx"
chainlesschain skill run libre-convert '{"input_file":"slides.pptx","format":"pdf"}'
chainlesschain skill run doc-edit '{"input_file":"report.md","instruction":"优化摘要部分"}'
chainlesschain skill run doc-edit '{"input_file":"data.xlsx","instruction":"首字母大写"}'
```

| Skill           | Description                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc-generate`  | AI-generated structured documents: md/html/docx/pdf, 4 styles (report/proposal/manual/readme)                                                     |
| `libre-convert` | LibreOffice headless conversion: docx/pdf/html/odt/pptx/xlsx/png                                                                                  |
| `doc-edit`      | AI edit existing docs: md/txt/html (direct LLM), docx (pandoc/soffice), xlsx (openpyxl, formulas preserved), pptx (python-pptx, charts preserved) |

Requirements: `winget install pandoc` (for docx), `winget install LibreOffice.LibreOffice` (for PDF/format conversion).

Also creates a `templates/` directory with README for document templates.

### `chainlesschain persona <action>`

Manage the AI persona for the current project (set by `init` templates or manually).

```bash
chainlesschain persona show                              # Show current project persona
chainlesschain persona set --name "Bot" --role "Helper" # Set persona name and role
chainlesschain persona set -b "Always respond in English" # Add behavior constraint
chainlesschain persona set --tools-disabled run_shell   # Disable specific tools
chainlesschain persona reset                             # Remove persona, restore default
```

### `chainlesschain cowork <action>`

Multi-agent collaboration for code review and analysis.

```bash
chainlesschain cowork debate <file>                    # Multi-perspective code review
chainlesschain cowork compare <prompt>                 # A/B solution comparison
chainlesschain cowork analyze <path>                   # Code analysis (style/knowledge-graph/decisions)
chainlesschain cowork status                           # Show cowork status
```

---

## Phase 6: AI Core (Hooks, Workflow, Memory, A2A)

### `chainlesschain hook <action>`

Event hook management for extensibility.

```bash
chainlesschain hook list                               # List registered hooks
chainlesschain hook add --event PreToolUse --type sync --command "echo check"
chainlesschain hook remove <id>                        # Remove a hook
chainlesschain hook run PreToolUse                     # Execute hooks for event
chainlesschain hook stats                              # Hook execution statistics
```

### `chainlesschain workflow <action>`

DAG-based workflow orchestration engine.

```bash
chainlesschain workflow create --name "pipeline" --stages '[...]'
chainlesschain workflow list                           # List workflows
chainlesschain workflow run <id>                       # Execute workflow
chainlesschain workflow status <id>                    # Check workflow status
chainlesschain workflow templates                      # List 5 built-in templates
```

### `chainlesschain hmemory <action>`

Hierarchical memory system (working → short-term → long-term).

```bash
chainlesschain hmemory store "fact" --importance 0.8   # Store memory
chainlesschain hmemory recall --layer long-term        # Recall memories
chainlesschain hmemory consolidate                     # Promote memories across layers
chainlesschain hmemory stats                           # Memory statistics
```

### `chainlesschain a2a <action>`

Agent-to-Agent protocol for multi-agent collaboration.

```bash
chainlesschain a2a register --name "agent1" --capabilities '["code"]'
chainlesschain a2a list                                # List registered agents
chainlesschain a2a discover --capability code          # Find agents by capability
chainlesschain a2a submit <agent> "task"               # Submit task to agent
chainlesschain a2a status <task-id>                    # Check task status
```

---

## Phase 7: Security & Evolution

### `chainlesschain sandbox <action>`

Secure sandbox execution environment.

```bash
chainlesschain sandbox create --name "test"            # Create sandbox
chainlesschain sandbox list                            # List sandboxes
chainlesschain sandbox exec <id> "command"             # Execute in sandbox
chainlesschain sandbox audit <id>                      # View audit log
chainlesschain sandbox destroy <id>                    # Destroy sandbox
```

### `chainlesschain evolution <action>`

Self-evolving AI capability assessment and learning.

```bash
chainlesschain evolution assess code-generation        # Assess capability
chainlesschain evolution diagnose                      # Self-diagnosis
chainlesschain evolution learn --domain nlp            # Incremental learning
chainlesschain evolution status                        # Evolution status
```

### `chainlesschain learning <action>`

Autonomous learning loop — tracks execution trajectories, auto-synthesizes skills from successful patterns, and performs periodic self-reflection.

```bash
chainlesschain learning stats                          # Learning loop statistics overview
chainlesschain learning stats --json                   # JSON output
chainlesschain learning trajectories                   # Recent 20 execution trajectories
chainlesschain learning trajectories -n 50             # Specify count
chainlesschain learning trajectories --session <id>    # Filter by session
chainlesschain learning trajectories --json            # JSON output
chainlesschain learning reflect                        # Manual self-reflection trigger
chainlesschain learning reflect --json                 # JSON reflection report
chainlesschain learning synthesize                     # Scan and synthesize new skills
chainlesschain learning synthesize --json              # JSON output
chainlesschain learning cleanup                        # Clean up trajectories older than 90 days
chainlesschain learning cleanup --days 30              # Custom retention period
chainlesschain learning cleanup --json                 # JSON output
```

**Core modules** (7 files in `src/lib/learning/`):

| Module               | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| **TrajectoryStore**  | Records complete execution trajectories (intent → tool chain → result → response)   |
| **OutcomeFeedback**  | Auto-scoring + user feedback + correction detection (Chinese & English)              |
| **SkillSynthesizer** | Extracts reusable patterns from complex successful trajectories into SKILL.md       |
| **SkillImprover**    | Three improvement triggers: error repair, user correction, better trajectory compare |
| **ReflectionEngine** | Periodic self-review with tool stats, score trends, error-prone tool identification  |
| **LearningHooks**    | REPL lifecycle integration — captures prompts, tool calls, responses, session events |
| **LearningTables**   | SQLite schema creation for trajectories, tags, and improvement logs                  |

---

## Phase 8: Blockchain & Enterprise Analytics

### `chainlesschain economy <action>`

Agent economy and micropayment system.

```bash
chainlesschain economy pay <from> <to> 100             # Agent micropayment
chainlesschain economy balance <agent>                  # Check balance
chainlesschain economy market list                      # Browse resource market
chainlesschain economy nft mint <agent>                 # Mint contribution NFT
```

### `chainlesschain zkp <action>`

Zero-Knowledge Proof engine.

```bash
chainlesschain zkp compile --name "age-proof"          # Compile ZKP circuit
chainlesschain zkp prove <circuit> --witness '{}'      # Generate proof
chainlesschain zkp verify <circuit> <proof>            # Verify proof
chainlesschain zkp list                                # List circuits
```

### `chainlesschain bi <action>`

Business Intelligence with natural language queries.

```bash
chainlesschain bi query "show monthly revenue"         # NL→SQL query
chainlesschain bi dashboard create --name "KPI"        # Create dashboard
chainlesschain bi dashboard list                       # List dashboards
chainlesschain bi anomaly --metric sales               # Z-score anomaly detection
```

---

## Phase 9: Low-Code Platform

### `chainlesschain lowcode <action>`

Visual low-code application builder.

```bash
chainlesschain lowcode create --name "app1"            # Create app
chainlesschain lowcode list                            # List apps
chainlesschain lowcode components                      # List 15+ components
chainlesschain lowcode preview <id>                    # Preview app
chainlesschain lowcode publish <id>                    # Publish app
```

---

## EvoMap Gene Exchange Protocol

### `chainlesschain evomap <action>`

Gene exchange protocol for sharing AI capabilities across instances.

```bash
chainlesschain evomap search "tool name"               # Search genes on hub
chainlesschain evomap download <gene-id>                # Download gene
chainlesschain evomap publish --name "my-gene"          # Publish gene to hub
chainlesschain evomap list                              # List local genes
chainlesschain evomap hubs                              # List available hubs
chainlesschain evomap federation list-hubs              # List federated hubs
chainlesschain evomap federation sync <hub>             # Sync genes with hub
chainlesschain evomap federation pressure               # Pressure analytics report
chainlesschain evomap gov propose "title"               # Governance proposal
chainlesschain evomap gov vote <id> for                 # Vote on proposal
chainlesschain evomap gov dashboard                     # Governance dashboard
```

---

## DAO Governance

### `chainlesschain dao <action>`

Decentralized governance with quadratic voting.

```bash
chainlesschain dao propose "title"                      # Create DAO proposal
chainlesschain dao vote <id> for                        # Vote (quadratic voting)
chainlesschain dao delegate <from> <to>                 # Delegate voting power
chainlesschain dao execute <id>                         # Execute passed proposal
chainlesschain dao treasury                             # Show treasury balance
chainlesschain dao stats                                # Governance statistics
```

---

## Phase 8: Security & Compliance

### `chainlesschain compliance <action>`

Compliance evidence collection and reporting (GDPR, SOC2, HIPAA).

```bash
chainlesschain compliance evidence gdpr                 # Collect compliance evidence
chainlesschain compliance report soc2                   # Generate compliance report
chainlesschain compliance classify "text"               # Classify data sensitivity
chainlesschain compliance scan hipaa                    # Scan compliance posture
```

### `chainlesschain dlp <action>`

Data Loss Prevention (DLP) content scanning and policy management.

```bash
chainlesschain dlp scan "content"                       # DLP content scanning
chainlesschain dlp incidents                            # List DLP incidents
chainlesschain dlp policy create --name "rule"          # Create DLP policy
```

### `chainlesschain siem <action>`

Security Information and Event Management (SIEM) integration.

```bash
chainlesschain siem targets                             # List SIEM targets
chainlesschain siem add-target splunk_hec <url>         # Add SIEM export target
chainlesschain siem export <target-id>                  # Export logs to SIEM
```

### `chainlesschain pqc <action>`

Post-Quantum Cryptography key management and migration.

```bash
chainlesschain pqc keys                                 # List PQC keys
chainlesschain pqc generate ML-KEM-768                  # Generate PQC key pair
chainlesschain pqc migration-status                     # PQC migration status
chainlesschain pqc migrate "plan" ML-KEM-768            # Execute PQC migration
```

---

## Phase 8: Communication Bridges

### `chainlesschain nostr <action>`

Nostr protocol bridge for decentralized social messaging.

```bash
chainlesschain nostr relays                             # List Nostr relays
chainlesschain nostr publish "Hello"                    # Publish Nostr event
chainlesschain nostr keygen                             # Generate Nostr keypair
chainlesschain nostr map-did <did> <pubkey>             # Map DID to Nostr
```

### `chainlesschain matrix <action>`

Matrix protocol bridge for federated messaging.

```bash
chainlesschain matrix login                             # Login to Matrix
chainlesschain matrix rooms                             # List Matrix rooms
chainlesschain matrix send <room> "message"             # Send Matrix message
```

### `chainlesschain scim <action>`

SCIM protocol for enterprise user provisioning.

```bash
chainlesschain scim users list                          # List SCIM users
chainlesschain scim users create --name "user"          # Create SCIM user
chainlesschain scim sync <connector-id>                 # Trigger SCIM sync
```

---

## Phase 8: Infrastructure & Hardening

### `chainlesschain terraform <action>`

Infrastructure-as-Code workspace management.

```bash
chainlesschain terraform workspaces                     # List Terraform workspaces
chainlesschain terraform create "prod"                  # Create workspace
chainlesschain terraform plan <workspace-id>            # Run Terraform plan
```

### `chainlesschain hardening <action>`

Security hardening and performance baseline management.

```bash
chainlesschain hardening baseline collect "v1"          # Collect performance baseline
chainlesschain hardening baseline compare <id>          # Compare baseline (regression)
chainlesschain hardening audit run "quarterly"          # Run security audit
```

---

## Phase 8: Social Platform

### `chainlesschain social <action>`

Decentralized social networking features.

```bash
chainlesschain social contact add "Alice"               # Add a contact
chainlesschain social contact list                      # List contacts
chainlesschain social friend add <contact-id>           # Send friend request
chainlesschain social post publish "Hello"              # Publish a post
chainlesschain social chat send <user> "msg"            # Send chat message
chainlesschain social stats                             # Social statistics
```

---

## CLI-Anything: Agent-Native Software Integration

### `chainlesschain cli-anything <action>`

Discover and register external CLI tools as ChainlessChain skills.

```bash
chainlesschain cli-anything doctor                      # Check Python + CLI-Anything environment
chainlesschain cli-anything scan                        # Scan PATH for cli-anything-* tools
chainlesschain cli-anything register <name>             # Register tool as ChainlessChain skill
chainlesschain cli-anything list                        # List registered tools
chainlesschain cli-anything remove <name>               # Remove registered tool
```

---

## Sub-Agent Isolation v2

Introduced in v0.43.0: complex agent tasks are automatically decomposed into isolated **sub-agents**, each running in its own sandboxed context — namespaced memory, scoped context engineering, and full lifecycle tracking.

### Architecture

| Component                  | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `SubAgentRegistry`         | Singleton registry tracking active/completed sub-agents with stats       |
| `NamespacedMemory`         | Per-sub-agent memory namespace, isolated from main session               |
| `ScopedContextEngineering` | Context window scoped to each sub-agent's task                           |
| `SubAgentContext`          | Execution context carrying role, task, iteration count, and token budget |

### Agent Slash Commands

Inside a `chainlesschain agent` session:

```
/sub-agents     Show active sub-agents, completed history, token usage, and avg duration
```

### How It Works

When the agent encounters a complex multi-step task, it spawns one or more sub-agents:

```
Main Agent
├── SubAgent [analyzer]  — reads codebase, writes findings to namespaced memory
├── SubAgent [planner]   — reads findings, proposes implementation plan
└── SubAgent [executor]  — implements plan with isolated context
```

Each sub-agent:

- Has its own memory namespace (no cross-contamination with other sub-agents)
- Carries a scoped context slice (not the full conversation history)
- Is registered with `SubAgentRegistry` for observability
- Reports back to the main agent upon completion

### Example Output of `/sub-agents`

```
Sub-Agent Registry:
  Active: 1  Completed: 3  Tokens: 4821  Avg Duration: 1243ms

  Active Sub-Agents:
    sa-7f3a [executor] Implement the authentication module (iter: 2)

  Recent History (last 10):
    ✓ sa-1a2b [analyzer] Analyzed 12 files, found 3 issues
    ✓ sa-3c4d [planner] Generated 5-step implementation plan
    ✗ sa-5e6f [executor] Failed: missing dependency crypto-utils
```

---

## WebSocket Server Interface

### `chainlesschain serve`

Start a WebSocket server for external tool integration, enabling real-time bidirectional communication with the CLI engine.

```bash
chainlesschain serve                                    # Start WebSocket server (port 18800)
chainlesschain serve --port 9000                        # Custom port
chainlesschain serve --token <secret>                   # Enable token auth
chainlesschain serve --allow-remote --token <secret>    # Allow remote + auth
chainlesschain serve --project /path/to/project         # Default project root for sessions
```

**Session Protocol** (v0.43.0): WebSocket clients can create stateful agent/chat sessions via `session-create`, send messages via `session-message`, resume previous sessions via `session-resume`, and manage sessions via `session-list`/`session-close`. Supports `slash-command` for in-session commands and `session-answer` for interactive Q&A (SlotFiller/Planner).

---

## Web Management Interface (v0.45.8)

### `chainlesschain ui`

Open a browser-based Web management interface — no extra software required. When a built Vue3 panel (`dist/`) is present it is served as static files; otherwise an embedded single-page app is used as fallback.

```bash
chainlesschain ui                       # Auto-detect mode, open browser
chainlesschain ui --port 18810          # Custom HTTP port
chainlesschain ui --ws-port 18800       # Custom WebSocket port
chainlesschain ui --no-open             # Start server without opening browser
chainlesschain ui --token <secret>      # Enable WebSocket auth token
chainlesschain ui --host 0.0.0.0        # Bind to all interfaces (remote access)
chainlesschain ui --web-panel-dir <dir> # Custom dist/ directory (auto-detected by default)
```

> **npm users**: the Vue3 panel is bundled automatically (via `prepublishOnly`) — no build step needed.
> **Source users**: run `npm run build:web-panel` once (from repo root) to build `packages/web-panel/dist/`.

**Two modes** (auto-detected based on current directory):

| Mode             | Trigger                                      | Description                                                    |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **Project mode** | Run from a directory with `.chainlesschain/` | AI automatically loads project context (rules, skills, config) |
| **Global mode**  | Run from any non-project directory           | General-purpose AI management panel                            |

**Features**: Vue3 + Ant Design Vue panel (Dashboard / Chat / Skills / Providers), streaming Markdown output, session management (new/switch/history), Agent/Chat mode toggle, slot-filling interactive dialogs, auto-reconnect (3s), Token auth.

**Ports**: HTTP 18810 (Web UI page + static assets), WebSocket 18800 (reuses `chainlesschain serve` infrastructure).

**Security**: JSON config embedded with XSS-safe Unicode escaping (`\u003c`/`\u003e`); Token auth via `--token`.

---

## AI Orchestration Layer (v0.45.4)

### `chainlesschain orchestrate`

Use ChainlessChain as an orchestration layer — automatically decompose tasks, dispatch to parallel AI coding agents (Claude Code / Codex / Gemini / OpenAI / Ollama), verify with CI/CD, and notify via Telegram / WeCom / DingTalk / Feishu.

```bash
chainlesschain orchestrate "Fix the auth bug"              # Auto-detect AI tool and run
chainlesschain orchestrate "Refactor payments" \
  --backends claude,gemini --strategy parallel-all         # Multi-backend, parallel
chainlesschain orchestrate "Add tests" \
  --ci "npm run test:unit" --retries 5                     # Custom CI + retries
chainlesschain orchestrate "task" --no-ci                  # Skip CI verification
chainlesschain orchestrate "task" --json                   # JSON output (for scripts)
chainlesschain orchestrate detect                          # Detect installed AI CLIs
chainlesschain orchestrate --status                        # Show orchestrator status
chainlesschain orchestrate --status --json                 # JSON status with backends list
chainlesschain orchestrate --webhook                       # Start IM webhook server (port 18820)
chainlesschain orchestrate --webhook --webhook-port 9090   # Custom port
```

**Routing strategies** (`--strategy`):

| Strategy       | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `round-robin`  | Weighted round-robin across all backends (default)             |
| `primary`      | Use first backend, auto-fallback on failure                    |
| `parallel-all` | Run all backends simultaneously, pick best result              |
| `by-type`      | Route by task type (`code-generation` / `analysis` / `review`) |

**Auto-detected backends**: `claude` (CLI), `codex` (CLI), `gemini` / `openai` / `anthropic` (API key env vars), `ollama` (always included as local fallback).

**Notification channels** (configured via env vars):

```bash
TELEGRAM_BOT_TOKEN=...  TELEGRAM_CHAT_ID=...    # Telegram
WECOM_WEBHOOK_URL=...                            # WeCom (企业微信)
DINGTALK_WEBHOOK_URL=...  DINGTALK_SECRET=...   # DingTalk (钉钉)
FEISHU_WEBHOOK_URL=...    FEISHU_SECRET=...     # Feishu (飞书)
```

**Incoming webhooks** — receive task commands from IM platforms:

```bash
chainlesschain orchestrate --webhook --webhook-port 18820
# POST /wecom    (WeCom XML)
# POST /dingtalk (DingTalk JSON)
# POST /feishu   (Feishu JSON + challenge verification)
```

**WebSocket integration** — trigger via `{ "type": "orchestrate", "task": "...", "cwd": "..." }`, receive real-time `orchestrate:event` progress events and final `orchestrate:done`.

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
    "model": "qwen2.5:7b"
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

| Provider                    | Default Model              | API Key Required |
| --------------------------- | -------------------------- | ---------------- |
| Ollama (Local)              | qwen2.5:7b                 | No               |
| OpenAI                      | gpt-4o                     | Yes              |
| Anthropic                   | claude-opus-4-6            | Yes              |
| DeepSeek                    | deepseek-chat              | Yes              |
| DashScope (Alibaba)         | qwen-turbo                 | Yes              |
| Google Gemini               | gemini-2.0-flash           | Yes              |
| Mistral AI                  | mistral-large-latest       | Yes              |
| Volcengine (火山引擎/豆包)  | doubao-seed-1-6-251015     | Yes              |
| Kimi (月之暗面)             | moonshot-v1-auto           | Yes              |
| MiniMax (海螺AI)            | MiniMax-Text-01            | Yes              |
| Custom                      | —                          | Yes              |

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
npm test                # Run all tests (5400+ tests across 201+ files)
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e        # End-to-end tests
```

### Test Coverage

| Category                  | Files   | Tests    | Status          |
| ------------------------- | ------- | -------- | --------------- |
| Unit — lib modules        | 71      | 1750+    | All passing     |
| Unit — commands           | 17      | 400+     | All passing     |
| Unit — runtime            | 1       | 6        | All passing     |
| Unit — WS sessions        | 9       | 156      | All passing     |
| Unit — Skill Packs        | 2       | 57+      | All passing     |
| Unit — AI Templates       | 2       | 130+     | All passing     |
| Unit — Web UI             | 1       | 46       | All passing     |
| Unit — Learning           | 7       | 177      | All passing     |
| Integration               | 13      | 230+     | All passing     |
| Integration — WS session  | 1       | 12       | All passing     |
| Integration — AI Handlers | 2       | 100+     | All passing     |
| Integration — Web UI      | 1       | 29       | All passing     |
| Integration — Learning    | 1       | 12       | All passing     |
| E2E                       | 15      | 260+     | All passing     |
| E2E — Skill Packs         | 1       | 23+      | All passing     |
| E2E — AI Templates        | 4       | 65+      | All passing     |
| E2E — Web UI              | 1       | 24       | All passing     |
| E2E — Learning            | 1       | 16       | All passing     |
| Core packages (external)  | —       | 118      | All passing     |
| **CLI Total**             | **201** | **3360** | **All passing** |

## License

MIT
