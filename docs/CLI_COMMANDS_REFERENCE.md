# CLI Commands Reference

> Complete command reference for `chainlesschain` CLI (also available as `cc`, `clc`, `clchain`)

## System Management

```bash
chainlesschain setup       # Interactive setup wizard
chainlesschain start       # Launch desktop app
chainlesschain stop        # Stop app
chainlesschain status      # Show status
chainlesschain services up # Start Docker services
chainlesschain config list # Show configuration
chainlesschain update      # Check for updates
chainlesschain doctor      # Diagnose environment
```

## Headless Commands (no GUI required)

```bash
chainlesschain db init     # Initialize database
chainlesschain db info     # Database info
chainlesschain note add "Title" -c "Content" -t "tag1,tag2"
chainlesschain note list   # List notes
chainlesschain note search "keyword"
chainlesschain chat        # Interactive AI chat (streaming)
chainlesschain chat --agent # Agentic mode (read/write files)
chainlesschain ask "question" # Single-shot AI query
chainlesschain llm models  # List installed models
chainlesschain llm test    # Test LLM connectivity
chainlesschain agent       # Agentic AI session (Claude Code style)
chainlesschain agent --session <id> # Resume previous agent session
chainlesschain skill list  # List all skills (4-layer: bundled/marketplace/managed/workspace)
chainlesschain skill list --category cli-direct  # List CLI command skill packs
chainlesschain skill run code-review "Review this code"
chainlesschain skill run cli-knowledge-pack "note list"  # Run CLI command via skill pack
chainlesschain skill run cli-identity-pack "did create"  # Run DID via skill pack
chainlesschain skill add my-skill   # Create custom project skill
chainlesschain skill remove my-skill # Remove custom skill
chainlesschain skill sources        # Show skill layer paths and counts
chainlesschain skill sync-cli              # Generate/update 9 CLI command skill packs
chainlesschain skill sync-cli --force      # Force regenerate all packs
chainlesschain skill sync-cli --dry-run    # Preview changes without writing
chainlesschain skill sync-cli --remove     # Remove all CLI packs
chainlesschain skill sync-cli --json       # JSON output
```

## Phase 1: AI Intelligence Layer

```bash
chainlesschain search "keyword"  # BM25 hybrid search
chainlesschain tokens show       # Token usage tracking
chainlesschain memory add "remember this" # Persistent memory
chainlesschain session list      # Session management
```

## Managed Agents Parity (session-core)

Phase D2 / E1 / E2 — shared with Desktop via `@chainlesschain/session-core`.
All three persist under `~/.chainlesschain/`.

```bash
# Scoped memory (MemoryStore — memory-store.json)
chainlesschain memory store "Prefers TypeScript" --scope global --category preference
chainlesschain memory store "Asked about P2P" --scope session --scope-id sess_123 --tags p2p,q
chainlesschain memory recall "typescript" --scope global --json
chainlesschain memory recall --tags p2p --limit 20

# Per-session approval policy (ApprovalGate — approval-policies.json)
chainlesschain session policy sess_123                        # show current
chainlesschain session policy sess_123 --set trusted          # strict | trusted | autopilot
chainlesschain session policy sess_123 --json

# Beta feature flags (BetaFlags — beta-flags.json)
# Flag format: <feature>-<YYYY-MM-DD>
chainlesschain config beta list [--json]
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01
```

## Phase 2: Knowledge & Content Management

```bash
chainlesschain import markdown ./docs  # Import markdown files
chainlesschain import evernote backup.enex # Import Evernote
chainlesschain import pdf document.pdf # Import PDF
chainlesschain export site -o ./site   # Export as static HTML
chainlesschain git status              # Git integration
chainlesschain git auto-commit         # Auto-commit changes
```

## Phase 3: MCP & External Integration

```bash
chainlesschain mcp servers             # List MCP servers
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem"
chainlesschain mcp tools               # List available tools
chainlesschain browse fetch https://example.com  # Fetch web page
chainlesschain browse scrape <url> -s "h2"       # Scrape elements
chainlesschain llm providers           # List 10 LLM providers
chainlesschain llm switch anthropic    # Switch active provider
chainlesschain instinct show           # Learned preferences
```

## Phase 4: Security & Identity

```bash
chainlesschain did create              # Create DID identity (Ed25519)
chainlesschain did list                # List all identities
chainlesschain did sign "message"      # Sign with default DID
chainlesschain encrypt file secret.txt # AES-256-GCM file encryption
chainlesschain decrypt file secret.txt.enc # Decrypt file
chainlesschain auth roles              # List RBAC roles
chainlesschain auth check user1 "note:read" # Check permission
chainlesschain audit log               # Recent audit events
chainlesschain audit stats             # Audit statistics
```

## Phase 5: P2P, Blockchain & Enterprise

```bash
chainlesschain p2p peers               # List P2P peers
chainlesschain p2p send <peer> "msg"   # Send encrypted message
chainlesschain p2p pair "My Phone"     # Pair device
chainlesschain sync status             # Sync status
chainlesschain sync push               # Push local changes
chainlesschain sync pull               # Pull remote changes
chainlesschain wallet create --name "Main" # Create wallet
chainlesschain wallet assets           # List digital assets
chainlesschain wallet transfer <id> <to> # Transfer asset
chainlesschain org create "Acme Corp"  # Create organization
chainlesschain org invite <org> <user> # Invite member
chainlesschain org approve <id>        # Approve request
chainlesschain plugin list             # List installed plugins
chainlesschain plugin install <name>   # Install plugin
chainlesschain plugin search <query>   # Search registry
```

## Project Initialization & Persona

```bash
chainlesschain init                    # Interactive project init
chainlesschain init --bare             # Minimal project structure
chainlesschain init --template code-project --yes
chainlesschain init --template medical-triage --yes
chainlesschain init --template agriculture-expert --yes
chainlesschain init --template general-assistant --yes
chainlesschain init --template ai-media-creator --yes
chainlesschain init --template ai-doc-creator --yes
chainlesschain persona show                # Show current persona
chainlesschain persona set --name "Bot" --role "Helper"
chainlesschain persona set -b "Be polite"
chainlesschain persona set --tools-disabled run_shell
chainlesschain persona reset
```

## Multi-agent Collaboration (Cowork)

```bash
chainlesschain cowork debate <file>    # Multi-perspective code review
chainlesschain cowork compare <prompt> # A/B solution comparison
chainlesschain cowork analyze <path>   # Code analysis
chainlesschain cowork status           # Show cowork status
```

## Phase 6: AI Core (Hooks, Workflow, Memory, A2A)

```bash
chainlesschain hook list / add / run / stats
chainlesschain workflow create / run / templates
chainlesschain hmemory store / recall / consolidate
chainlesschain a2a register / discover / submit
```

## Phase 7: Security & Evolution

```bash
chainlesschain sandbox create / exec / audit
chainlesschain evolution assess / diagnose / learn
chainlesschain evomap federation list-hubs / sync / pressure
chainlesschain evomap gov propose / vote / dashboard
chainlesschain dao propose / vote / delegate / execute / treasury / stats
```

## Phase 8: Blockchain & Enterprise

```bash
chainlesschain economy pay / market list / nft mint
chainlesschain zkp compile / prove / verify
chainlesschain bi query / dashboard create / anomaly
chainlesschain compliance evidence / report / classify / scan
chainlesschain dlp scan / incidents / policy create
chainlesschain siem targets / add-target / export
chainlesschain pqc keys / generate / migration-status / migrate
chainlesschain nostr relays / publish / keygen / map-did
chainlesschain matrix login / rooms / send
chainlesschain scim users list / create / sync
chainlesschain terraform workspaces / create / plan
chainlesschain hardening baseline collect / compare / audit run
chainlesschain social contact / friend / post / chat / stats
```

## Phase 9: Low-Code & Multi-Agent

```bash
chainlesschain lowcode create / components / publish
```

## EvoMap & CLI-Anything

```bash
chainlesschain evomap search / download / publish / list / hubs
chainlesschain cli-anything doctor / scan / register / list / remove
```

## Server & Web Panel

```bash
chainlesschain serve                            # WebSocket server (port 18800)
chainlesschain serve --port 9000 --token <s>    # Custom port + auth
chainlesschain ui                               # Web panel (port 18810)
chainlesschain ui --port 18810 --ws-port 18800 --token <s>
```

## AI Orchestration

```bash
chainlesschain orchestrate "task"               # Auto-detect AI agent
chainlesschain orchestrate "task" --backends claude,gemini --strategy parallel-all
chainlesschain orchestrate detect               # Detect AI CLI tools
chainlesschain orchestrate --status [--json]    # Show status
chainlesschain orchestrate --webhook [--webhook-port 9090]
```
