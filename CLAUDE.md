# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: v5.0.2.4 (Evolution Edition - 138 Desktop Skills + Android 28 Skills + MCP Remote Registry + Phase 1-102 Complete + AI Agent 2.0 + Web3 Deepening + Enterprise Platform + Self-Evolving AI + CLI 64 Commands/5104+ Tests + Persona System + Agent Context Engineering + Autonomous Agent + EvoMap + 10 LLM Providers + 3 Proxy Relays + Task Model Selector + CLI-Anything Integration + WebSocket Server + WebSocket Sessions + SlotFiller + InteractivePlanner + Agent Intelligence + Sub-Agent Isolation v2 + CLI Command Skill Packs (9 Packs/101 Tests) + AI Media Creator Template (ComfyUI/AnimateDiff/TTS) + AI Doc Creator Template (LibreOffice/pandoc/doc-generate/libre-convert/doc-edit) + AI Orchestration Layer (Claude Code/Codex/Multi-Agent/CI/Notifications/Webhooks) + 5136+ Tests + 12 Store Test Files) - Updated 2026-03-21

**Primary Application**: `desktop-app-vue/` (Electron + Vue3) - This is the main development focus.

## Configuration Management

### Unified Configuration Directory (`.chainlesschain/`)

**Location:**

- **Production/Development**: `{Electron userData}/.chainlesschain/`
  - Windows: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`
  - macOS: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/`
  - Linux: `~/.config/chainlesschain-desktop-vue/.chainlesschain/`

**Key Files:**

- **`.chainlesschain/config.json`**: Main configuration file (git-ignored)
- **`.chainlesschain/rules.md`**: Project coding rules - **READ THIS FIRST!** (priority > CLAUDE.md)
- **`desktop-app-vue/src/main/config/unified-config-manager.js`**: Configuration manager implementation

**Configuration Priority:** Environment variables > `.chainlesschain/config.json` > Default configuration

## Memory Bank System

Project uses Memory Bank system to maintain AI assistant cross-session context:

| File                        | Purpose                        | Update Trigger               |
| --------------------------- | ------------------------------ | ---------------------------- |
| `CLAUDE.md`                 | Main project docs & AI guide   | Major feature changes        |
| `CLAUDE-patterns.md`        | Verified architecture patterns | New patterns discovered      |
| `CLAUDE-decisions.md`       | Architecture Decision Records  | Major architecture decisions |
| `CLAUDE-troubleshooting.md` | Known issues & solutions       | New issues resolved          |
| `CLAUDE-activeContext.md`   | Current session state          | Each session end             |

## Critical Build & Development Commands

### Desktop Application (Primary Focus)

```bash
cd desktop-app-vue
npm install
npm run dev                # Development mode (Vite + Electron)
npm run build:main         # Build main process (required before dev if modified)
npm run build              # Full build
npm run make:win           # Package for Windows
npm run test:db            # Run database tests
npm run test:ukey          # Run U-Key tests
```

### CLI Package

```bash
cd packages/cli
npm install
npm test                   # Run all tests (3050+ tests, 130+ files)
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e           # End-to-end tests
```

**CLI commands** (after `npm install -g chainlesschain`; also available as `cc`, `clc`, or `clchain`):

```bash
# System management
chainlesschain setup       # Interactive setup wizard
chainlesschain start       # Launch desktop app
chainlesschain stop        # Stop app
chainlesschain status      # Show status
chainlesschain services up # Start Docker services
chainlesschain config list # Show configuration
chainlesschain update      # Check for updates
chainlesschain doctor      # Diagnose environment

# Headless commands (no GUI required)
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

# Phase 1 AI Intelligence Layer
chainlesschain search "keyword"  # BM25 hybrid search
chainlesschain tokens show       # Token usage tracking
chainlesschain memory add "remember this" # Persistent memory
chainlesschain session list      # Session management

# Phase 2 Knowledge & Content Management
chainlesschain import markdown ./docs  # Import markdown files
chainlesschain import evernote backup.enex # Import Evernote
chainlesschain import pdf document.pdf # Import PDF
chainlesschain export site -o ./site   # Export as static HTML
chainlesschain git status              # Git integration
chainlesschain git auto-commit         # Auto-commit changes

# Phase 3 MCP & External Integration
chainlesschain mcp servers             # List MCP servers
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem"
chainlesschain mcp tools               # List available tools
chainlesschain browse fetch https://example.com  # Fetch web page
chainlesschain browse scrape <url> -s "h2"       # Scrape elements
chainlesschain llm providers           # List 10 LLM providers
chainlesschain llm switch anthropic    # Switch active provider
chainlesschain instinct show           # Learned preferences

# Phase 4 Security & Identity
chainlesschain did create              # Create DID identity (Ed25519)
chainlesschain did list                # List all identities
chainlesschain did sign "message"      # Sign with default DID
chainlesschain encrypt file secret.txt # AES-256-GCM file encryption
chainlesschain decrypt file secret.txt.enc # Decrypt file
chainlesschain auth roles              # List RBAC roles
chainlesschain auth check user1 "note:read" # Check permission
chainlesschain audit log               # Recent audit events
chainlesschain audit stats             # Audit statistics

# Phase 5 P2P, Blockchain & Enterprise
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

# Project initialization
chainlesschain init                    # Interactive project init
chainlesschain init --bare             # Minimal project structure
chainlesschain init --template code-project --yes # Use template
chainlesschain init --template medical-triage --yes  # Medical triage (with Persona)
chainlesschain init --template agriculture-expert --yes # Agriculture expert (with Persona)
chainlesschain init --template general-assistant --yes  # General assistant (with Persona)
chainlesschain init --template ai-media-creator --yes   # AI media creator (ComfyUI/AnimateDiff/TTS + 3 workspace skills)
chainlesschain init --template ai-doc-creator --yes     # AI doc creator (LibreOffice/pandoc + doc-generate/libre-convert/doc-edit skills)

# Persona management
chainlesschain persona show                # Show current project persona
chainlesschain persona set --name "Bot" --role "Helper"  # Set persona
chainlesschain persona set -b "Be polite"  # Add behavior constraint
chainlesschain persona set --tools-disabled run_shell    # Disable tools
chainlesschain persona reset               # Remove persona, restore default

# Multi-agent collaboration (Cowork)
chainlesschain cowork debate <file>    # Multi-perspective code review
chainlesschain cowork compare <prompt> # A/B solution comparison
chainlesschain cowork analyze <path>   # Code analysis (style/knowledge-graph/decisions)
chainlesschain cowork status           # Show cowork status

# Phase 6 AI Core (Hooks, Workflow, Memory, A2A)
chainlesschain hook list               # List registered hooks
chainlesschain hook add --event PreToolUse --type sync --command "echo check"
chainlesschain hook run PreToolUse     # Execute hooks for event
chainlesschain hook stats              # Hook execution statistics
chainlesschain workflow create --name "pipeline" --stages '[...]'
chainlesschain workflow run <id>       # Execute DAG workflow
chainlesschain workflow templates      # List 5 built-in templates
chainlesschain hmemory store "fact" --importance 0.8  # Store memory
chainlesschain hmemory recall --layer long-term       # Recall memories
chainlesschain hmemory consolidate     # Promote memories across layers
chainlesschain a2a register --name "agent1" --capabilities '["code"]'
chainlesschain a2a discover --capability code  # Find agents
chainlesschain a2a submit <agent> "task"       # Submit task

# Phase 7 Security & Evolution
chainlesschain sandbox create --name "test"    # Create sandbox
chainlesschain sandbox exec <id> "command"     # Execute in sandbox
chainlesschain sandbox audit <id>              # View audit log
chainlesschain evolution assess code-generation # Assess capability
chainlesschain evolution diagnose              # Self-diagnosis
chainlesschain evolution learn --domain nlp    # Incremental learning

# Phase 7 EvoMap Federation + DAO Governance
chainlesschain evomap federation list-hubs     # List federated hubs
chainlesschain evomap federation sync <hub>    # Sync genes with hub
chainlesschain evomap federation pressure      # Pressure analytics report
chainlesschain evomap gov propose "title"      # Governance proposal
chainlesschain evomap gov vote <id> for        # Vote on proposal
chainlesschain evomap gov dashboard            # Governance dashboard
chainlesschain dao propose "title"             # Create DAO proposal
chainlesschain dao vote <id> for               # Vote (quadratic voting)
chainlesschain dao delegate <from> <to>        # Delegate voting power
chainlesschain dao execute <id>                # Execute passed proposal
chainlesschain dao treasury                    # Show treasury balance
chainlesschain dao stats                       # Governance statistics

# Phase 8 Blockchain & Enterprise
chainlesschain economy pay <from> <to> 100     # Agent micropayment
chainlesschain economy market list              # Browse resource market
chainlesschain economy nft mint <agent>         # Mint contribution NFT
chainlesschain zkp compile --name "age-proof"   # Compile ZKP circuit
chainlesschain zkp prove <circuit> --witness '{}' # Generate proof
chainlesschain zkp verify <circuit> <proof>     # Verify proof
chainlesschain bi query "show monthly revenue"  # NL→SQL query
chainlesschain bi dashboard create --name "KPI" # Create dashboard
chainlesschain bi anomaly --metric sales        # Z-score detection

# Phase 8 Security & Compliance
chainlesschain compliance evidence gdpr        # Collect compliance evidence
chainlesschain compliance report soc2          # Generate compliance report
chainlesschain compliance classify "text"      # Classify data sensitivity
chainlesschain compliance scan hipaa           # Scan compliance posture
chainlesschain dlp scan "content"              # DLP content scanning
chainlesschain dlp incidents                   # List DLP incidents
chainlesschain dlp policy create --name "rule" # Create DLP policy
chainlesschain siem targets                    # List SIEM targets
chainlesschain siem add-target splunk_hec <url> # Add SIEM export target
chainlesschain siem export <target-id>         # Export logs to SIEM
chainlesschain pqc keys                        # List PQC keys
chainlesschain pqc generate ML-KEM-768         # Generate PQC key pair
chainlesschain pqc migration-status            # PQC migration status
chainlesschain pqc migrate "plan" ML-KEM-768   # Execute PQC migration

# Phase 8 Communication Bridges
chainlesschain nostr relays                    # List Nostr relays
chainlesschain nostr publish "Hello"           # Publish Nostr event
chainlesschain nostr keygen                    # Generate Nostr keypair
chainlesschain nostr map-did <did> <pubkey>    # Map DID to Nostr
chainlesschain matrix login                    # Login to Matrix
chainlesschain matrix rooms                    # List Matrix rooms
chainlesschain matrix send <room> "message"    # Send Matrix message
chainlesschain scim users list                 # List SCIM users
chainlesschain scim users create --name "user" # Create SCIM user
chainlesschain scim sync <connector-id>        # Trigger SCIM sync

# Phase 8 Infrastructure & Hardening
chainlesschain terraform workspaces            # List Terraform workspaces
chainlesschain terraform create "prod"         # Create workspace
chainlesschain terraform plan <workspace-id>   # Run Terraform plan
chainlesschain hardening baseline collect "v1" # Collect performance baseline
chainlesschain hardening baseline compare <id> # Compare baseline (regression)
chainlesschain hardening audit run "quarterly" # Run security audit

# Phase 8 Social Platform
chainlesschain social contact add "Alice"      # Add a contact
chainlesschain social contact list             # List contacts
chainlesschain social friend add <contact-id>  # Send friend request
chainlesschain social post publish "Hello"     # Publish a post
chainlesschain social chat send <user> "msg"   # Send chat message
chainlesschain social stats                    # Social statistics

# Phase 9 Low-Code & Multi-Agent
chainlesschain lowcode create --name "app1"     # Create app
chainlesschain lowcode components               # List 15+ components
chainlesschain lowcode publish <id>             # Publish app

# EvoMap Gene Exchange Protocol
chainlesschain evomap search "tool name"        # Search genes on hub
chainlesschain evomap download <gene-id>        # Download gene
chainlesschain evomap publish --name "my-gene"  # Publish gene to hub
chainlesschain evomap list                      # List local genes
chainlesschain evomap hubs                      # List available hubs

# CLI-Anything: Agent-Native Software Integration
chainlesschain cli-anything doctor              # Check Python + CLI-Anything environment
chainlesschain cli-anything scan                # Scan PATH for cli-anything-* tools
chainlesschain cli-anything register <name>     # Register tool as ChainlessChain skill
chainlesschain cli-anything list                # List registered tools
chainlesschain cli-anything remove <name>       # Remove registered tool

# WebSocket Server Interface
chainlesschain serve                            # Start WebSocket server (port 18800)
chainlesschain serve --port 9000                # Custom port
chainlesschain serve --token <secret>           # Enable token auth
chainlesschain serve --allow-remote --token <s> # Allow remote + auth
chainlesschain serve --project /path/to/project # Default project root for sessions

# Web UI (browser-based management interface)
chainlesschain ui                               # Open web UI (project or global mode)
chainlesschain ui --port 18810                  # Custom HTTP port
chainlesschain ui --ws-port 18800               # Custom WebSocket port
chainlesschain ui --no-open                     # Start server without opening browser
chainlesschain ui --token <secret>              # Enable auth token

# AI Orchestration Layer (Claude Code/Codex as execution agents)
chainlesschain orchestrate "Fix the auth bug"   # Run task via auto-detected AI agent
chainlesschain orchestrate "task" --backends claude,gemini --strategy parallel-all
chainlesschain orchestrate "task" --ci "npm test" --retries 5  # Custom CI + retries
chainlesschain orchestrate detect               # Detect installed AI CLI tools
chainlesschain orchestrate --status             # Show orchestrator status
chainlesschain orchestrate --status --json      # JSON status (includes backends list)
chainlesschain orchestrate --webhook            # Start HTTP webhook server (port 18820)
chainlesschain orchestrate --webhook --webhook-port 9090  # Custom port
```

### Backend Services (Docker-based)

```bash
docker-compose up -d       # Start all services
docker-compose down        # Stop services
docker-compose logs -f     # View logs
docker exec chainlesschain-ollama ollama pull qwen2:7b  # Pull LLM model
```

### Java Backend Services

```bash
cd backend/project-service
mvn clean compile && mvn spring-boot:run
mvn test
```

### Python AI Service

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Root-level Commands

```bash
npm run dev:desktop-vue    # Run desktop app from root
npm run docker:up          # Start Docker services
npm run lint && npm run format
```

## Feature Index

**See [`FEATURES.md`](FEATURES.md) for the complete feature list** (138 desktop features, 28 Android skills).

Key highlights:

- **AI Engine**: Cowork Multi-Agent, Plan Mode, Instinct Learning, Skills System (138 built-in)
- **Enterprise**: RBAC, SSO, Audit & Compliance, Org Management, Real-time Collaboration
- **Integration**: MCP, Browser Automation, Computer Use, IPFS, Analytics Dashboard
- **v3.0-v4.0**: Pipeline Orchestrator, NL Programming, Multimodal Collaboration, Autonomous Ops, Agent Federation
- **v5.0.0 (Phase 78-100)**: IPC Domain Split, DI Container, A2A Protocol, Workflow Engine, Hierarchical Memory 2.0, Agent Economy, ZKP Engine, Cross-Chain Bridge, Low-Code Platform, Enterprise KG, BI Engine, Self-Evolving AI

## Architecture Overview

### Desktop Application (Primary Focus)

**Structure**: `desktop-app-vue/src/`

**Main Process** (`main/`):

- **Core**: `index.js` (entry), `database.js` (SQLite/SQLCipher), `config/`, `utils/`, `core/` (DI container, shared cache, event bus, resource pool)
- **IPC**: `ipc/` (middleware, lazy loader, 10 domain files)
- **Security**: `ukey/` (hardware), `did/` (identity, DID v2), `p2p/` (encrypted messaging), `security/` (sandbox v2)
- **AI Engine**: `ai-engine/` (plan-mode, agents, cowork, autonomous, a2a, workflow, memory, perception, code-agent, knowledge, evolution), `llm/` (session, memory, instinct)
- **Enterprise**: `permission/` (RBAC), `auth/` (SSO), `audit/`, `enterprise/` (org, low-code, bi, automation, saas)
- **Blockchain**: `blockchain/` (agent economy, cross-chain bridge, DAO governance v2)
- **Crypto**: `crypto/` (ZKP engine, privacy computing)
- **Integration**: `mcp/`, `browser/` (automation + computer-use), `marketplace/` (plugin ecosystem v2), `hooks/`
- **Runtime**: `runtime/` (universal runtime, hot update, profiler)
- **Advanced**: `collaboration/` (CRDT/Yjs), `ipfs/`, `rag/` (hybrid search), `analytics/`, `performance/`
- **Database**: `database/` (migration manager, query builder, index optimizer)

**Renderer Process** (`renderer/`):

- **Vue3 + TypeScript**: `pages/`, `components/`, `stores/` (51 Pinia stores), `router/`

### CLI Package (`packages/cli/`)

Lightweight npm CLI (~2MB pure JS) for installing, configuring, and managing ChainlessChain. Downloads pre-built binaries on demand.

- **Entry**: `bin/chainlesschain.js` → `src/index.js` (Commander)
- **Commands**: `src/commands/` (setup, start, stop, status, services, config, update, doctor, db, note, chat, ask, llm, agent, skill, search, tokens, memory, session, import, export, git, mcp, browse, instinct, did, encrypt, auth, audit, p2p, sync, wallet, org, plugin, init, persona, cowork, hook, workflow, hmemory, a2a, sandbox, evolution, economy, zkp, bi, lowcode, dao, compliance, dlp, siem, pqc, nostr, matrix, scim, terraform, hardening, social, cli-anything)
- **REPL**: `src/repl/` (chat-repl.js — streaming chat, agent-repl.js — agentic with 10 tools + 138 skills + Plan Mode + /cowork + Context Engineering + Sub-Agent Isolation)
- **Runtime**: `src/runtime/` (bootstrap.js — 7-stage headless init)
- **Libraries**: `src/lib/` (platform, paths, downloader, process-manager, service-manager, config-manager, version-checker, logger, prompts, checksum, bm25-search, token-tracker, response-cache, session-manager, memory-manager, plan-mode, cli-context-engineering, permanent-memory, autonomous-agent, content-recommender, evomap-client, evomap-manager, knowledge-importer, knowledge-exporter, note-versioning, git-integration, pdf-parser, mcp-client, llm-providers, browser-automation, instinct-manager, did-manager, crypto-manager, permission-engine, audit-logger, p2p-manager, sync-manager, wallet-manager, org-manager, plugin-manager, project-detector, skill-loader, cowork-adapter, cowork/debate-review-cli, cowork/ab-comparator-cli, cowork/code-knowledge-graph-cli, cowork/decision-kb-cli, cowork/project-style-analyzer-cli, hook-manager, workflow-engine, hierarchical-memory, a2a-protocol, sandbox-v2, evolution-system, agent-economy, zkp-engine, bi-engine, agent-coordinator, service-container, app-builder, evomap-federation, evomap-governance, dao-governance, compliance-manager, dlp-engine, siem-exporter, pqc-manager, nostr-bridge, matrix-bridge, scim-manager, terraform-manager, hardening-manager, social-manager, cli-anything-bridge, ws-server, ws-session-manager, ws-agent-handler, ws-chat-handler, interaction-adapter, agent-core, chat-core, slot-filler, interactive-planner)
- **Core packages**: core-env, shared-logger, core-infra, core-config, core-db (118 core tests + 2385 CLI tests = 2503 total)
- **Dependencies**: commander, @inquirer/prompts, chalk, ora, semver + @chainlesschain/core-\* packages

### Backend Services

- **project-service**: Spring Boot 3.1.11 + Java 17 + PostgreSQL + Redis + MyBatis Plus 3.5.9
- **ai-service**: FastAPI + Python + Ollama + Qdrant + 14+ cloud LLM providers

### Android Application

28 skills (12 Kotlin handlers, 8 doc-only, 8 REMOTE delegated to desktop). See `MEMORY.md` for details.

### Database Schema

**SQLite + SQLCipher (AES-256)** - File: `data/chainlesschain.db`

**Table categories**: Core (notes, conversations, DID, P2P), Memory (embeddings, metadata), AI (instincts, knowledge graph, decisions), Enterprise (RBAC, org, approval), Collaboration (CRDT, sessions), Storage (IPFS), Analytics

**Schema definition**: See `desktop-app-vue/src/main/database.js` for full schema and migrations.

## Technology Stack

### Desktop App

- **Electron**: 39.2.6, **Vue**: 3.4, **TypeScript**: 5.9.3, **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7 (46 TypeScript stores)
- **P2P**: libp2p 3.1.2, WebRTC (wrtc), **Crypto**: Signal Protocol
- **Image**: Sharp, Tesseract.js, **Git**: isomorphic-git
- **Search**: natural (BM25/TF-IDF), Qdrant (Vector)

### Backend

- **Java**: 17 + Spring Boot 3.1.11 + MyBatis Plus 3.5.9
- **Python**: FastAPI, Ollama, Qdrant
- **Databases**: PostgreSQL 16, Redis 7, SQLite

## Common Development Workflows

### Adding a New Feature

1. Define IPC channel in `src/main/index.js`
2. Implement logic in main process module
3. Create Vue component in `src/renderer/`
4. Add Pinia store if needed
5. Update routes for new pages

### Working with Database

- File: `data/chainlesschain.db` (encrypted)
- Schema: `src/main/database.js`
- Always use prepared statements

## U-Key Integration

**Windows Only**: Via Koffi FFI, SDK in `SIMKeySDK-20220416/`, default PIN: `123456`
**macOS/Linux**: Simulation mode only

## Environment Variables

Key variables (see `.env.example`):

```bash
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Testing

```bash
# Desktop - Unit Tests
cd desktop-app-vue
npm run test:db            # Database tests
npm run test:ukey          # U-Key hardware tests
npm run test:unit          # All unit tests (Vitest)
npm run test:security      # Security tests (OWASP)

# Desktop - Integration Tests
npm run test:integration   # Frontend-backend integration
npm run test:e2e           # End-to-end user journey tests

# Backend
cd backend/project-service && mvn test
cd backend/ai-service && pytest
```

## Code Style & Commit Conventions

Semantic commits: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

Example: `feat(rag): add reranker support`

## Code Quality & ESLint Best Practices

### Common ESLint Errors to Avoid

When writing new code, follow these guidelines to prevent common ESLint violations:

#### 1. Use ES6 Imports Instead of CommonJS Require

**❌ Wrong (causes @typescript-eslint/no-require-imports):**

```javascript
const axios = require("axios");
const { ipcMain } = require("electron");
```

**✅ Correct:**

```javascript
import axios from "axios";
import { ipcMain } from "electron";
```

**Note**: Only use `require()` in CommonJS `.js` files in the main process where necessary. All TypeScript files (`.ts`, `.tsx`) and renderer code must use ES6 imports.

#### 2. Handle Unused Variables in Catch Blocks

**❌ Wrong (causes @typescript-eslint/no-unused-vars + no-empty):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  // 'err' is unused
  // Empty catch block
}
```

**✅ Correct - Option A (log the error):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  console.error("Operation failed:", err);
}
```

**✅ Correct - Option B (ignore with underscore + comment):**

```javascript
try {
  await riskyOperation();
} catch (_err) {
  // Explicitly ignore error - operation is optional
  // Intentionally empty - non-critical operation
}
```

**✅ Correct - Option C (no-catch-all with specific handling):**

```javascript
try {
  await riskyOperation();
} catch (err) {
  // Handle specific error scenarios
  if (err.code === "ENOENT") {
    return null; // File not found is expected
  }
  throw err; // Re-throw unexpected errors
}
```

#### 3. Remove Unused Imports and Variables

**❌ Wrong (causes @typescript-eslint/no-unused-vars):**

```javascript
import { ref, computed, onMounted } from "vue"; // onMounted not used

export default {
  setup() {
    const count = ref(0);
    const unusedVar = ref("test"); // Never used

    return { count };
  },
};
```

**✅ Correct:**

```javascript
import { ref } from "vue"; // Only import what you use

export default {
  setup() {
    const count = ref(0);

    return { count };
  },
};
```

#### 4. File Type Specific Rules

**Main Process Files (.js in `src/main/`):**

- Use CommonJS (`module.exports`, `require()`) for consistency with existing code
- Use ES6 imports only if the entire module is ES6

**Renderer Files (.ts, .tsx, .vue in `src/renderer/`):**

- Always use ES6 imports/exports
- TypeScript strict mode enabled
- Use type annotations for function parameters and return types

**Test Files (.test.js, .spec.js):**

- Follow the same import style as the file being tested
- Use Vitest mocking patterns (see MEMORY.md)

### Pre-commit Checklist

Before committing, ensure:

1. ✅ Run `npm run lint` - all ESLint errors fixed
2. ✅ Run `npm run format` - code is properly formatted
3. ✅ No unused imports or variables
4. ✅ All catch blocks either handle errors or have explanatory comments
5. ✅ ES6 imports used in all TypeScript/renderer code

### ESLint Configuration

Project uses:

- **Main**: `@typescript-eslint/parser` + `eslint-plugin-vue`
- **Rules**: See `desktop-app-vue/.eslintrc.js`
- **Auto-fix**: Many issues can be auto-fixed with `npm run lint -- --fix`

## Chinese Encoding (中文乱码) Prevention

Windows defaults to the system codepage (CP936/GBK for Chinese Windows), which causes UTF-8 output to display as garbled text. Follow these rules to prevent encoding issues:

### Entry Points Must Set UTF-8

Both the CLI and Desktop entry points call `chcp 65001` at startup to switch Windows console to UTF-8. **Do NOT remove this**.

- **CLI**: `packages/cli/bin/chainlesschain.js` imports `ensure-utf8.js`
- **Desktop**: `desktop-app-vue/src/main/index.js` runs `chcp 65001` inline
- **Utility**: `packages/cli/src/lib/ensure-utf8.js` - shared encoding helper

### Rules for Child Processes

```javascript
// ✅ CORRECT - Always specify encoding for execSync/spawnSync
execSync("some-command", { encoding: "utf-8" });

// ✅ CORRECT - For cmd.exe spawn, prepend chcp 65001
spawn("cmd.exe", ["/c", "chcp 65001 >nul && " + script], { ... });

// ✅ CORRECT - Explicitly decode Buffer as utf8
child.stdout.on("data", (data) => data.toString("utf8"));

// ❌ WRONG - data.toString() uses system default (GBK on Chinese Windows)
child.stdout.on("data", (data) => data.toString());

// ❌ WRONG - No encoding specified, returns Buffer
execSync("some-command");
```

### Rules for File I/O

```javascript
// ✅ CORRECT - Always specify utf-8
fs.readFileSync(path, "utf-8");
fs.writeFileSync(path, content, "utf-8");

// ❌ WRONG - Returns Buffer, not string
fs.readFileSync(path);
```

### HTML Output

Always include `<meta charset="UTF-8">` in generated HTML files.

## Known Limitations

1. **U-Key**: Windows only (macOS/Linux simulation mode)
2. **GPU**: Docker Ollama requires NVIDIA GPU for acceleration

## Troubleshooting

### Port Conflicts

| Service         | Port  |
| --------------- | ----- |
| Vite Dev        | 5173  |
| Signaling       | 9001  |
| Ollama          | 11434 |
| Qdrant          | 6333  |
| PostgreSQL      | 5432  |
| Redis           | 6379  |
| Project Service | 9090  |
| AI Service      | 8001  |

### Build Failures

- **Electron**: Run `npm run build:main` before `npm run dev`
- **Spring Boot**: Check MyBatis Plus 3.5.9 and jakarta imports
- **Python**: Ensure `httpx<0.26.0`

See `CLAUDE-troubleshooting.md` for detailed issue solutions (database, LLM, P2P, Electron, U-Key, performance).

## Documentation References

- **System Design**: `docs/design/系统设计_主文档.md`, `docs/design/系统设计_个人移动AI管理系统.md`
- **Browser Automation**: `docs/design/modules/09_浏览器自动化系统.md`
- **Quick Start**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)
- **Memory System**: `docs/features/PERMANENT_MEMORY_INTEGRATION.md`
- **Error Handler**: `docs/guides/IPC_ERROR_HANDLER_GUIDE.md`
- **Phase 2 Summary**: `docs/reports/phase2/PHASE2_FINAL_SUMMARY.md`
- **Active Context**: `CLAUDE-activeContext.md`
