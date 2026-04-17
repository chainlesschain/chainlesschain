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
chainlesschain agent --agent-id <id>              # Scope memory recall to agent
chainlesschain agent --recall-limit 5             # Inject top-5 memories at startup
chainlesschain agent --no-recall-memory           # Disable startup memory recall
chainlesschain agent --no-stream                  # Disable streamed rendering
chainlesschain agent --bundle ./my-agent-bundle   # Load agent bundle (AGENTS.md + USER.md + skills/ + mcp.json)
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

Phase D–H — shared with Desktop via `@chainlesschain/session-core`.
All persist under `~/.chainlesschain/`; Desktop reads the same files from `<userData>/.chainlesschain/`.

```bash
# Scoped memory (MemoryStore — memory-store.json)
chainlesschain memory store "Prefers TypeScript" --scope global --category preference
chainlesschain memory store "Asked about P2P" --scope session --scope-id sess_123 --tags p2p,q
chainlesschain memory store "Likes Rust" --scope user --scope-id u_alice --category preference
chainlesschain memory recall "typescript" --scope global --json
chainlesschain memory recall "rust" --scope user --scope-id u_alice --json
chainlesschain memory recall --tags p2p --limit 20

# Consolidate a JSONL session's trace into MemoryStore (Phase G)
chainlesschain memory consolidate --session sess_123 --scope agent --agent-id coder
chainlesschain memory consolidate --session sess_123 --dry-run --json

# Per-session approval policy (ApprovalGate — approval-policies.json)
chainlesschain session policy sess_123                        # show current
chainlesschain session policy sess_123 --set trusted          # strict | trusted | autopilot
chainlesschain session policy sess_123 --json

# Beta feature flags (BetaFlags — beta-flags.json)
# Flag format: <feature>-<YYYY-MM-DD>
chainlesschain config beta list [--json]
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01

# Session lifecycle (SessionManager — parked-sessions.json) · Phase H
chainlesschain session lifecycle                              # list running+parked
chainlesschain session lifecycle --status parked --json
chainlesschain session park sess_123                          # markIdle + park
chainlesschain session unpark sess_123                        # restore parked
chainlesschain session end sess_123 --consolidate             # close + write trace→MemoryStore
chainlesschain agent --session sess_123                       # auto-unpark on start
chainlesschain agent --no-park-on-exit                        # close handle on exit instead

# Scriptable StreamRouter (NDJSON on stdout) · Phase H
chainlesschain stream "summarize file X"                      # {type,ts,...} per line
chainlesschain stream "..." --text                            # collect() concatenated text
chainlesschain stream "..." --provider openai --model gpt-4o

# Phase I — Session tail + usage rollup
chainlesschain session tail sess_123                          # follow live JSONL events (NDJSON)
chainlesschain session tail sess_123 --from-start             # replay from byte 0
chainlesschain session tail sess_123 --type tool_call,assistant_message
chainlesschain session tail sess_123 --since 1712000000000 --once
chainlesschain session usage sess_123                         # per-session token rollup
chainlesschain session usage                                  # global rollup
chainlesschain session usage --json --limit 500
```

## Hosted Session API (Phase I)

`cc serve` exposes session-core over WebSocket. Route types (dot-case)
return `<type>.response` envelopes with `{ ok, ... }`:

| Type                    | Payload fields                                          |
| ----------------------- | ------------------------------------------------------- |
| `sessions.list`         | `agentId?`, `status?` → `{ sessions[] }`                |
| `sessions.show`         | `sessionId` → `{ session, source: "live"\|"parked" }`   |
| `sessions.park`         | `sessionId` → `{ parked: true }`                        |
| `sessions.unpark`       | `sessionId` → `{ resumed: true }`                       |
| `sessions.end`          | `sessionId`, `consolidate?`, `scope?`, `scopeId?`, `agentId?` |
| `sessions.policy.get`   | `sessionId` → `{ policy }`                              |
| `sessions.policy.set`   | `sessionId`, `policy` (strict/trusted/autopilot)        |
| `memory.store`          | `content`, `scope?`, `scopeId?`, `tags?`, `category?`   |
| `memory.recall`         | `query?`, `scope?`, `tags?`, `limit?` → `{ results[] }` |
| `memory.delete`         | `id` → `{ deleted: true }`                              |
| `memory.consolidate`    | `sessionId`, `scope?`, `dryRun?`                        |
| `beta.list` / `beta.enable` / `beta.disable` | `flag` (format `<feature>-YYYY-MM-DD`) |
| `usage.session`         | `sessionId` → `{ usage }`                               |
| `usage.global`          | `limit?` → `{ usage: { sessions[], total, byModel[] } }` |

Streaming routes emit intermediate `stream.event` envelopes followed by a
terminal `<type>.end` envelope:

| Type         | Payload fields                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `stream.run` | `prompt`, `provider?`, `model?`, `baseUrl?`, `apiKey?` → events `{type:"stream.event", event}`, end `{ok, text}` |
| `sessions.subscribe` | `events?:string[]` (default: all lifecycle) → events `{type:"stream.event", event:{type:"session.<lifecycle>", session}}`, end `{ok, unsubscribed:true, events}` |

Lifecycle values forwarded by `sessions.subscribe`: `created`, `adopted`,
`touched`, `idle`, `parked`, `resumed`, `closed`.

Cancel a streaming request by sending `{type:"cancel", id}` — the server
calls `AbortController.abort()` which detaches listeners (`sessions.subscribe`)
or aborts the in-flight fetch (`stream.run`).

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
chainlesschain mcp add weather -u https://mcp.example.com/weather            # Streamable HTTP transport (auto-detected)
chainlesschain mcp add weather -u https://mcp.example.com/weather -t http    # Explicit transport (http|sse|stdio)
chainlesschain mcp add weather -u https://... -H Authorization=Bearer+xyz    # Custom headers (repeatable)
chainlesschain mcp tools               # List available tools
chainlesschain mcp scaffold weather                          # Scaffold stdio MCP server in ./weather
chainlesschain mcp scaffold weather -t http -p 4001          # Streamable HTTP + SSE on port 4001
chainlesschain mcp scaffold weather --dry-run --json         # Preview file set without touching disk
chainlesschain mcp scaffold weather -d "Forecasts" -a Alice  # Custom description + package.json author
chainlesschain mcp scaffold weather -o ~/projects/w --force  # Explicit output dir, overwrite existing
chainlesschain mcp registry list                             # Browse curated catalog of community MCP servers
chainlesschain mcp registry list -c database --sort rating --order desc
chainlesschain mcp registry list -t browser,automation --json
chainlesschain mcp registry search git                       # Keyword search (name/description/tags)
chainlesschain mcp registry show filesystem                  # Full entry details (id or short name)
chainlesschain mcp registry install github                   # Register catalog entry as MCP server
chainlesschain mcp registry install github --as gh --auto-connect
chainlesschain mcp registry categories                       # List registry categories
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
chainlesschain compliance frameworks [--json]                                   # List SOC2 / ISO27001 / GDPR templates
chainlesschain compliance report soc2 --format md|html|json [--output file]     # Detailed framework report
chainlesschain compliance report iso27001 --detailed                            # Force template reporter
chainlesschain compliance report gdpr --format html -o gdpr.html                # Write to file
chainlesschain compliance threat-intel import feed.json                         # Import STIX 2.1 bundle
chainlesschain compliance threat-intel list [-t ipv4|domain|url|file-sha256...] # List stored IoCs
chainlesschain compliance threat-intel match 1.2.3.4                            # Match observable; exit 2 on hit
chainlesschain compliance threat-intel stats [--json]                           # Indicator counts per type
chainlesschain compliance threat-intel remove ipv4 1.2.3.4                      # Remove a single indicator
chainlesschain dlp scan / incidents / policy create
chainlesschain siem targets / add-target / export
chainlesschain pqc keys / generate / migration-status / migrate / algorithms
chainlesschain pqc algorithms                     # FIPS 203/204/205 + hybrid catalog
chainlesschain pqc algorithms -f slh-dsa --json   # Filter: 6 SLH-DSA variants (128/192/256 × s/f)
chainlesschain pqc generate SLH-DSA-128s -p signing
chainlesschain pqc generate HYBRID-ED25519-SLH-DSA -p signing
chainlesschain nostr relays / publish / keygen / map-did / dm / dm-decrypt / delete / react
chainlesschain matrix login / rooms / send / thread send|list|roots / space create|add-child|children|list
chainlesschain activitypub actor create / publish / follow / accept / unfollow / like / announce / outbox / inbox / deliver / followers / following
chainlesschain scim users list / create / sync
chainlesschain terraform workspaces / create / plan
chainlesschain hardening baseline collect / compare / audit run
chainlesschain hardening config-check <path>                                    # Real config audit: required keys, placeholders, dangerous defaults
chainlesschain hardening config-check ./config.json -r db.host,server.port      # Validate required keys
chainlesschain hardening config-check ./config.json -f changeme,your-api-key    # Custom forbidden substrings
chainlesschain hardening deploy-check [--json]                                  # Evaluate the 6-item production-deployment checklist (exit 2 if not ready)
chainlesschain stress levels                                                    # List built-in load levels
chainlesschain stress run [-l light|medium|heavy|extreme] [-c N] [-r RPS] [-d MS] [--json]
chainlesschain stress list [-l level] [-s running|complete|stopped] [--limit N] [--json]
chainlesschain stress show <test-id> [--json]                                   # Full metrics + bottlenecks
chainlesschain stress analyze <test-id> [--json]                                # Bottleneck analysis
chainlesschain stress plan <test-id> [--json]                                   # Capacity planning recommendations
chainlesschain stress stop <test-id>                                            # Mark a running test as stopped
chainlesschain reputation observe <did> <score> [-k kind] [-w weight] [--json]  # Record observation (score in [0,1])
chainlesschain reputation score <did> [-d exponential|linear|step|none] [--lambda N] [--alpha N] [--json]
chainlesschain reputation list [-d decay] [--limit N] [--json]                  # List DIDs by aggregated score
chainlesschain reputation anomalies [-m z_score|iqr] [-t threshold] [-d decay] [--json]
chainlesschain reputation optimize [-o accuracy|fairness|resilience|convergence_speed] [-i iterations] [--json]
chainlesschain reputation status <run-id> [--json]                              # Optimization run status
chainlesschain reputation analytics <run-id> [--json]                           # Distribution + anomalies + recommendations
chainlesschain reputation runs [--limit N] [--json]                             # Optimization run history
chainlesschain reputation apply <run-id>                                        # Mark run as applied
chainlesschain reputation objectives [--json]                                   # List supported objectives
chainlesschain rep ...                                                          # Short alias
chainlesschain sla tiers [--json]                                               # List built-in SLA tiers (gold/silver/bronze)
chainlesschain sla create <org-id> [-t gold|silver|bronze] [-d duration-ms] [-f fee] [--json]
chainlesschain sla list [-o org] [-t tier] [-s active|expired|terminated] [--limit N] [--json]
chainlesschain sla show <sla-id> [--json]                                       # Show contract terms + status
chainlesschain sla terminate <sla-id>                                           # Mark contract as terminated
chainlesschain sla record <sla-id> <term> <value>                               # term: availability|response_time|throughput|error_rate
chainlesschain sla metrics <sla-id> [--json]                                    # Aggregated mean/p95 per term
chainlesschain sla check <sla-id> [--json]                                      # Detect violations (p95 for response_time, mean for rest)
chainlesschain sla violations [-s sla-id] [-S minor|moderate|major|critical] [--limit N] [--json]
chainlesschain sla compensate <violation-id> [--json]                           # base × multiplier, capped at 2.0
chainlesschain sla report <sla-id> [--start ms] [--end ms] [--json]             # Compliance % + severity breakdown
chainlesschain tech types [--json]                                              # List tech types / levels / anti-patterns
chainlesschain tech analyze [path] [--json]                                     # Parse package.json / requirements.txt / Cargo.toml / go.mod
chainlesschain tech profile [path] [--json]                                     # Show last analyzed profile
chainlesschain tech detect <file> [--json]                                      # Heuristic anti-pattern scan
chainlesschain tech practice <type> <name> <pattern> <level> [-d desc] [-s score]
chainlesschain tech practices [-t type] [-n name] [-l level] [--limit N] [--json]
chainlesschain tech recommend [--limit N] [--json]                              # Match practices to analyzed stack
chainlesschain dev levels [--json]                                              # List autonomy levels L0..L4
chainlesschain dev phases [--json]                                              # List dev phases (requirement_analysis → deployment)
chainlesschain dev refactor-types [--json]                                      # List known refactoring types
chainlesschain dev start "<requirement>" [-l 0..4] [-b author] [--json]         # Start a new dev session (default L2)
chainlesschain dev list [-s active|paused|completed|failed] [-p phase] [--limit N] [--json]
chainlesschain dev show <session-id> [--json]                                   # Full session details + review feedback
chainlesschain dev phase <session-id> <phase> [--json]                          # Advance to a new phase
chainlesschain dev pause <session-id>                                           # ACTIVE → PAUSED
chainlesschain dev resume <session-id>                                          # PAUSED → ACTIVE
chainlesschain dev complete <session-id>                                        # Mark session completed
chainlesschain dev fail <session-id> [-r reason]                                # Mark session failed
chainlesschain dev review <file> [-s session-id] [--min-score 0.7] [--json]     # Heuristic review (reuses tech detectAntiPatterns)
chainlesschain dev adr <session-id> <title> <decision> [-c context] [-q conseq] [-a alt1,alt2] [-s proposed|accepted|deprecated|superseded] [--render] [--json]
chainlesschain dev adrs [-s session-id] [-S status] [--limit N] [--json]        # List ADRs
chainlesschain collab decision-types [--json]                                   # List 5 decision types
chainlesschain collab strategies [--json]                                       # List 4 conflict resolution strategies
chainlesschain collab metrics [--json]                                          # List 5 quality metrics
chainlesschain collab priorities [--json]                                       # List 5 priority levels (CRITICAL..TRIVIAL)
chainlesschain collab permissions [--json]                                      # List 5 permission tiers (L0..L4)
chainlesschain collab propose <type> "<proposal>" [--json]                      # Create a pending governance decision
chainlesschain collab decisions [-t type] [-s status] [--limit N] [--json]
chainlesschain collab show <decision-id> [--json]                               # Full details + vote list + tally
chainlesschain collab vote <decision-id> <agent-id> <approve|reject|abstain> [-r reason]
chainlesschain collab tally <decision-id> [-q quorum] [-t threshold] [-n totalVoters] [--json]
chainlesschain collab execute <decision-id>                                     # Mark approved decision as executed
chainlesschain collab set-level <agent-id> <0..4> [-r reason] [--json]          # Set agent autonomy level
chainlesschain collab agent <agent-id> [--json]                                 # Show agent autonomy + permissions
chainlesschain collab agents [-l level] [--limit N] [--json]
chainlesschain collab match <required.json> <agent-skills.json> [--json]        # Skill match score
chainlesschain collab optimize <tasks.json> <agents.json> [--json]              # Priority-sorted + skill-scored task assignment
chainlesschain marketplace status-types [--json]                                # List 4 service statuses (draft|published|deprecated|suspended)
chainlesschain marketplace invocation-statuses [--json]                         # List 5 invocation statuses
chainlesschain marketplace publish <name> [-v version] [-d desc] [-e endpoint] [-o owner-did] [-p pricing-json] [-s status] [--json]
chainlesschain marketplace list [-s status] [-o owner] [-n name-substr] [--limit N] [--json]
chainlesschain marketplace show <service-id> [--json]                           # Full service details
chainlesschain marketplace status <service-id> <new-status>                     # Transition (draft|published|deprecated|suspended)
chainlesschain marketplace record <service-id> [-c caller] [-i input-json] [-o output-json] [-s status] [-d duration-ms] [-e error] [--json]
chainlesschain marketplace invocations [-s service-id] [-c caller] [-S status] [--limit N] [--json]
chainlesschain marketplace stats [-s service-id] [--json]                       # Aggregate: total, successRate, avgDurationMs, per-status counts
chainlesschain incentive contribution-types [--json]                            # List 7 contribution types with base rewards
chainlesschain incentive tx-types [--json]                                      # List 4 tx types (transfer|reward|mint|burn)
chainlesschain incentive balance <account-id> [--json]                          # Query account balance + totalEarned/totalSpent
chainlesschain incentive accounts [--limit N] [--json]                          # List accounts (sorted by balance DESC)
chainlesschain incentive mint <to> <amount> [-r reason] [--json]                # Admin op: mint tokens into an account
chainlesschain incentive transfer <from> <to> <amount> [-r reason] [--json]     # Transfer tokens between accounts
chainlesschain incentive history [-a account] [-t type] [--limit N] [--json]    # Transaction history
chainlesschain incentive contribute <user-id> <type> [value] [-m metadata-json] [-a] [-M multiplier] [--json]
chainlesschain incentive reward <contribution-id> [-M multiplier] [--json]      # Reward a previously-recorded contribution
chainlesschain incentive contributions [-u user] [-t type] [--rewarded|--unrewarded] [--limit N] [--json]
chainlesschain incentive leaderboard [--limit N] [--json]                       # Top contributors by total reward earned
chainlesschain kg entity-types [--json]                                         # List 7 standard entity types (Person/Organization/Project/Technology/Document/Concept/Event)
chainlesschain kg add <name> <type> [-p props-json] [-g tags-csv] [--json]      # Add entity
chainlesschain kg list [-t type] [-n name-substr] [-g tag] [--limit N] [--json] # List entities
chainlesschain kg show <entity-id> [--json]                                     # Show entity details
chainlesschain kg remove <entity-id>                                            # Remove entity (cascades to relations)
chainlesschain kg add-relation <source-id> <target-id> <relation-type> [-w weight] [-p props-json] [--json]
chainlesschain kg relations [-s source] [-t target] [-r type] [--limit N] [--json]
chainlesschain kg reason <start-id> [-d max-depth] [--direction out|in|both] [-r rel-type] [--include-start] [--json]
chainlesschain kg stats [--json]                                                # Entity/relation counts + type distribution + avg degree + density
chainlesschain kg export [output-file]                                          # Export graph as JSON (stdout if no file)
chainlesschain kg import <input-file> [--json]                                  # Import graph from JSON file
chainlesschain tenant plans [--json]                                            # List 4 plans (free/starter/pro/enterprise) with quotas
chainlesschain tenant metrics [--json]                                          # List 3 tracked metrics (api_calls/storage_bytes/ai_requests)
chainlesschain tenant create <name> <slug> [-p plan] [-o owner] [-c config-json] [--json]
chainlesschain tenant configure <tenant-id> [-c config] [-p plan] [-s status] [-n name] [--json]
chainlesschain tenant list [-s status] [-p plan] [-o owner-substr] [--limit N] [--json]
chainlesschain tenant show <tenant-id> [--json]                                 # Tenant + active subscription
chainlesschain tenant delete <tenant-id> [--hard]                               # Soft delete by default
chainlesschain tenant record <tenant-id> <metric> <value> [-P period] [--json]
chainlesschain tenant usage <tenant-id> [-P period] [-m metric] [--json]       # Aggregated by metric
chainlesschain tenant subscribe <tenant-id> -p <plan> [-a amount] [-d duration-ms] [--json]
chainlesschain tenant subscription <tenant-id> [--json]                         # Active subscription
chainlesschain tenant cancel <tenant-id>                                        # Cancel active subscription
chainlesschain tenant subscriptions [-t tenant-id] [-s status] [-p plan] [--limit N] [--json]
chainlesschain tenant check-quota <tenant-id> <metric> [-P period] [--json]    # Usage vs plan limit
chainlesschain tenant stats [--json]                                            # Tenant/sub/usage counts + distributions
chainlesschain tenant export <tenant-id> [output-file]                          # JSON snapshot (stdout if no file)
chainlesschain tenant import <input-file>                                       # Restore from JSON snapshot
chainlesschain governance types [--json]                                        # List 4 proposal types (parameter_change/feature_request/policy_update/budget_allocation)
chainlesschain governance statuses [--json]                                     # List 5 proposal statuses
chainlesschain governance impact-levels [--json]                                # List 4 impact levels (low/medium/high/critical)
chainlesschain governance create <title> [-t type] [-d description] [-p proposer-did] [--json]
chainlesschain governance list [-s status] [-t type] [--limit N] [--json]
chainlesschain governance show <proposal-id> [--json]
chainlesschain governance activate <proposal-id> [-d duration-ms] [--json]     # draft → active
chainlesschain governance close <proposal-id> [-q quorum] [-t threshold] [-n total-voters] [--json]  # active → passed/rejected
chainlesschain governance expire <proposal-id>                                  # draft|active → expired
chainlesschain governance vote <proposal-id> <voter-did> <yes|no|abstain> [-r reason] [-w weight] [--json]
chainlesschain governance votes <proposal-id> [--limit N] [--json]
chainlesschain governance tally <proposal-id> [-q quorum] [-t threshold] [-n total-voters] [--json]
chainlesschain governance analyze <proposal-id> [--json]                        # Heuristic impact analysis (risk/benefit/components)
chainlesschain governance predict <proposal-id> [--json]                        # Heuristic vote prediction
chainlesschain governance stats [--json]                                        # Proposal/vote counts + distributions
chainlesschain recommend content-types [--json]                                 # List 4 content types (note/post/article/document)
chainlesschain recommend statuses [--json]                                      # List recommendation statuses
chainlesschain recommend feedback-values [--json]                               # List feedback values (like/dislike/later)
chainlesschain recommend create-profile <user-id> [-t topics-json] [-w weights-json] [--json]
chainlesschain recommend profile <user-id> [--json]                             # Show interest profile
chainlesschain recommend update-profile <user-id> [-t topics-json] [-w weights-json] [-d decay] [--json]
chainlesschain recommend delete-profile <user-id> [--json]
chainlesschain recommend profiles [--limit N] [--json]                          # List all profiles
chainlesschain recommend decay <user-id> [--json]                               # Apply time decay to topic weights
chainlesschain recommend generate <user-id> -p <pool-json> [-l limit] [-m min-score] [--json]
chainlesschain recommend list <user-id> [-s status] [-t type] [-m min-score] [--limit N] [--json]
chainlesschain recommend show <rec-id> [--json]                                 # Show recommendation details
chainlesschain recommend view <rec-id> [--json]                                 # Mark as viewed
chainlesschain recommend feedback <rec-id> <like|dislike|later> [--json]        # Provide feedback
chainlesschain recommend dismiss <rec-id> [--json]                              # Dismiss recommendation
chainlesschain recommend stats <user-id> [--json]                               # Total/pending/viewed/feedback rate
chainlesschain recommend top-interests <user-id> [--limit N] [--json]           # Top weighted topics
chainlesschain recommend suggest <user-id> [--json]                             # Suggest profile adjustments from feedback
chainlesschain crosschain chains [--json]                                       # List 5 supported chains (ethereum/polygon/bsc/arbitrum/solana)
chainlesschain crosschain bridge-statuses [--json]                              # List 6 bridge statuses
chainlesschain crosschain swap-statuses [--json]                                # List 5 swap statuses
chainlesschain crosschain bridge <from> <to> <amount> [-a asset] [-s sender] [-r recipient] [--json]
chainlesschain crosschain bridge-status <bridge-id> <status> [-t tx-hash] [-e error] [--json]
chainlesschain crosschain bridge-show <bridge-id> [--json]
chainlesschain crosschain bridges [-f from-chain] [-t to-chain] [-s status] [--limit N] [--json]
chainlesschain crosschain swap <from> <to> <amount> [-a from-asset] [-b to-asset] [-c counterparty] [-t timeout-ms] [--json]
chainlesschain crosschain swap-claim <swap-id> [-s secret] [-t tx-hash] [--json]
chainlesschain crosschain swap-refund <swap-id> [-t tx-hash] [--json]
chainlesschain crosschain swap-show <swap-id> [--json]
chainlesschain crosschain swap-secret <swap-id> [--json]                        # Reveal HTLC secret (only after claim)
chainlesschain crosschain swaps [-f from-chain] [-s status] [--limit N] [--json]
chainlesschain crosschain send <from> <to> [-p payload] [-c contract] [--json]  # Cross-chain message
chainlesschain crosschain msg-status <msg-id> <status> [-t tx-hash] [--json]
chainlesschain crosschain msg-show <msg-id> [--json]
chainlesschain crosschain messages [-f from] [-t to] [-s status] [--limit N] [--json]
chainlesschain crosschain estimate-fee <from> <to> <amount> [--json]            # Heuristic fee estimate (USD)
chainlesschain crosschain stats [--json]                                        # Bridge/swap/message counts + volume
chainlesschain privacy protocols [--json]                                       # List MPC protocols (shamir/beaver/gmw)
chainlesschain privacy dp-mechanisms [--json]                                   # List DP mechanisms (laplace/gaussian/exponential)
chainlesschain privacy he-schemes [--json]                                      # List HE schemes (paillier/bfv/ckks)
chainlesschain privacy fl-statuses [--json]                                     # List FL statuses
chainlesschain privacy create-model <name> [-t type] [-a arch] [-r rounds] [-l lr] [-p N] [--json]
chainlesschain privacy train <model-id> [--json]                                # Run one training round
chainlesschain privacy fail-model <model-id> [-r reason] [--json]
chainlesschain privacy show-model <model-id> [--json]
chainlesschain privacy models [-s status] [--limit N] [--json]
chainlesschain privacy create-computation <type> [-p proto] [-i ids] [-t threshold] [--json]
chainlesschain privacy submit-share <computation-id> [--json]                   # Submit MPC share
chainlesschain privacy show-computation <computation-id> [--json]
chainlesschain privacy computations [-p proto] [-s status] [--limit N] [--json]
chainlesschain privacy dp-publish [-d data] [-e epsilon] [-m mechanism] [--json] # Publish with DP noise
chainlesschain privacy he-query [-d data] [-o operation] [-s scheme] [--json]    # Simulated HE query
chainlesschain privacy report [--json]                                          # Privacy budget + FL/MPC stats
chainlesschain inference node-statuses [--json]                                 # List node statuses (online/offline/busy/degraded)
chainlesschain inference task-statuses [--json]                                 # List task statuses
chainlesschain inference privacy-modes [--json]                                 # List privacy modes (standard/encrypted/federated)
chainlesschain inference register <node-id> [-e url] [-c caps] [-g gpu-mb] [--json]
chainlesschain inference unregister <id> [--json]                               # Remove inference node
chainlesschain inference heartbeat <id> [--json]                                # Send node heartbeat
chainlesschain inference node-status <id> <status> [--json]                     # Update node status
chainlesschain inference show-node <id> [--json]
chainlesschain inference nodes [-s status] [-c capability] [--limit N] [--json]
chainlesschain inference submit <model> [-i input] [-p priority] [-m mode] [--json]
chainlesschain inference complete <task-id> [-o output] [-d duration-ms] [--json]
chainlesschain inference fail-task <task-id> [-e error] [--json]
chainlesschain inference show-task <task-id> [--json]
chainlesschain inference tasks [-s status] [-m model] [-p privacy] [--limit N] [--json]
chainlesschain inference stats [--json]                                         # Node/task counts + avg latency
chainlesschain trust anchors [--json]                                           # List trust anchors (tpm/tee/secure_element)
chainlesschain trust hsm-vendors [--json]                                       # List HSM vendors (yubikey/ledger/trezor/generic)
chainlesschain trust compliance-levels [--json]                                 # List compliance levels (fips_140_2/fips_140_3/cc_eal4)
chainlesschain trust sat-providers [--json]                                     # List satellite providers (iridium/starlink/beidou)
chainlesschain trust attest <anchor> [-c challenge] [-f fingerprint] [--json]   # Trust attestation
chainlesschain trust attest-show <id> [--json]
chainlesschain trust attestations [-a anchor] [-s status] [--limit N] [--json]
chainlesschain trust interop-test <algorithm> [-p peer] [-l latency-ms] [--json] # PQC interop test
chainlesschain trust interop-tests [-a algorithm] [--limit N] [--json]
chainlesschain trust sat-send <payload> [-p provider] [-r priority] [--json]    # Send satellite message
chainlesschain trust sat-status <id> <status> [--json]                          # Update satellite message status
chainlesschain trust sat-show <id> [--json]
chainlesschain trust sat-messages [-p provider] [-s status] [--limit N] [--json]
chainlesschain trust hsm-register <vendor> [-m model] [-s serial] [-c compliance] [-f firmware] [--json]
chainlesschain trust hsm-remove <id> [--json]
chainlesschain trust hsm-show <id> [--json]
chainlesschain trust hsm-devices [-v vendor] [--limit N] [--json]
chainlesschain trust hsm-sign <device-id> [-d data] [-a algorithm] [--json]     # Sign with HSM
chainlesschain trust stats [--json]                                             # Attestation/interop/satellite/HSM counts
chainlesschain social contact / friend / post / chat / stats
chainlesschain social analyze "<text>" [--top-k 3] [--lang zh|ja|en] [--json]
chainlesschain social detect-lang "<text>" [--json]
chainlesschain social graph add-edge <source> <target> [-t follow|friend|like|mention|block] [-w 1.0] [-m '<json>']
chainlesschain social graph remove-edge <source> <target> [-t follow]
chainlesschain social graph neighbors <did> [-d out|in|both] [-t <type>] [--json]
chainlesschain social graph snapshot [-t <type>]
chainlesschain social graph watch [-e edge:added,edge:removed] [--once]   # NDJSON stream
chainlesschain fusion protocols [--json]                                        # List 4 protocols (did/activitypub/nostr/matrix)
chainlesschain fusion quality-levels [--json]                                   # List quality levels (high/medium/low/harmful)
chainlesschain fusion send -s <source> [-t target] [-f sender] -c <content>     # Cross-protocol message
chainlesschain fusion msg-show <id> [--json]                                    # Show message details
chainlesschain fusion messages [-p protocol] [--limit N] [--json]               # List unified messages
chainlesschain fusion map-identity [-d did] [-a activitypub] [-n nostr] [-m matrix] [--json]
chainlesschain fusion identity <did> [--json]                                   # Look up identity mapping by DID
chainlesschain fusion identities [--limit N] [--json]                           # List identity mappings
chainlesschain fusion verify-identity <id> [--json]                             # Verify identity mapping
chainlesschain fusion assess <content> [-i content-id] [--json]                 # Assess content quality
chainlesschain fusion quality-show <id> [--json]                                # Show quality score details
chainlesschain fusion quality-scores [-l level] [--limit N] [--json]            # List quality scores
chainlesschain fusion quality-report [--json]                                   # Content quality report
chainlesschain fusion translate <text> -t <target-lang> [-s source-lang] [--json]  # Translate text (simulated)
chainlesschain fusion detect-lang <text> [--json]                               # Detect language
chainlesschain fusion translation-stats [--json]                                # Translation cache statistics
chainlesschain fusion stats [--json]                                            # Protocol fusion & AI social stats
chainlesschain infra deal-statuses [--json]                                     # List deal statuses (pending/active/expired/failed)
chainlesschain infra route-types [--json]                                       # List route types (tor/domain_front/mesh_ble/mesh_wifi/direct)
chainlesschain infra deal-create -c <cid> -s <bytes> [-m miner] [-p price] [-d epochs] [--json]
chainlesschain infra deal-status <id> <status> [--json]                         # Update deal status
chainlesschain infra deal-renew <id> [--json]                                   # Renew storage deal
chainlesschain infra deal-show <id> [--json]                                    # Show deal details
chainlesschain infra deals [-s status] [--limit N] [--json]                     # List storage deals
chainlesschain infra version-add -c <cid> [-p parent] [-d dag] [-n peers] [--json]
chainlesschain infra version-show <id> [--json]                                 # Show content version
chainlesschain infra versions [-c cid] [--limit N] [--json]                     # List content versions
chainlesschain infra version-cache <id> [--json]                                # Mark version as cached
chainlesschain infra route-add -t <type> [-e endpoint] [-l latency] [-r reliability] [--json]
chainlesschain infra route-status <id> <status> [--json]                        # Update route status
chainlesschain infra route-remove <id> [--json]                                 # Remove route
chainlesschain infra route-show <id> [--json]                                   # Show route details
chainlesschain infra routes [-t type] [-s status] [--limit N] [--json]          # List anti-censorship routes
chainlesschain infra connectivity [--json]                                      # Connectivity report
chainlesschain infra stats [--json]                                             # Infrastructure statistics
```

## Code Generation Agent (Phase 86)

```bash
chainlesschain codegen templates [--json]                                       # List scaffold templates (react/vue/express/fastapi/spring_boot)
chainlesschain codegen severities [--json]                                      # List review severity levels
chainlesschain codegen rules [--json]                                           # List security rules (eval/sql_injection/xss/path_traversal/command_injection)
chainlesschain codegen platforms [--json]                                       # List CI/CD platforms
chainlesschain codegen generate -p <prompt> [-l lang] [-f framework] [--code <code>] [--files N] [--tokens N]
chainlesschain codegen show <id> [--json]                                       # Show generation details
chainlesschain codegen list [-l lang] [-f framework] [--limit N] [--json]       # List code generations
chainlesschain codegen review -c <code> [-g generation-id] [-l lang] [--json]   # Heuristic security code review
chainlesschain codegen review-show <id> [--json]                                # Show review details + issues
chainlesschain codegen reviews [-l lang] [--limit N] [--json]                   # List code reviews
chainlesschain codegen scaffold -t <template> -n <name> [-o opts-json] [--files N] [--output path] [--json]
chainlesschain codegen scaffold-show <id> [--json]                              # Show scaffold details
chainlesschain codegen scaffolds [-t template] [--limit N] [--json]             # List scaffolds
chainlesschain codegen stats [--json]                                           # Code agent statistics
```

## Autonomous Ops / AIOps (Phase 25)

```bash
chainlesschain ops severities [--json]                                           # List severity levels (P0-P3)
chainlesschain ops statuses [--json]                                             # List incident statuses
chainlesschain ops algorithms [--json]                                           # List detection algorithms (z_score/iqr)
chainlesschain ops rollback-types [--json]                                       # List rollback types (git/docker/config/service/custom)
chainlesschain ops baseline-update <metric> -v <csv-values> [--json]             # Update metric baseline from values
chainlesschain ops baseline-show <metric> [--json]                               # Show metric baseline (mean/stddev/Q1/Q3)
chainlesschain ops baselines [--json]                                            # List metric baselines
chainlesschain ops detect <metric> <value> [-a z_score|iqr] [--json]             # Detect anomaly for a metric value
chainlesschain ops incident-create [-m metric] [-s P0-P3] [-d desc] [--json]     # Create an incident manually
chainlesschain ops incident-show <id> [--json]                                   # Show incident details
chainlesschain ops incident-ack <id> [--json]                                    # Acknowledge an incident
chainlesschain ops incident-resolve <id> [--json]                                # Resolve an incident
chainlesschain ops incident-close <id> [--json]                                  # Close a resolved incident
chainlesschain ops incidents [-s severity] [-S status] [--limit N] [--json]      # List incidents
chainlesschain ops playbook-create -n <name> [-t trigger-json] [-s steps-json] [--json]
chainlesschain ops playbook-show <id> [--json]                                   # Show playbook details
chainlesschain ops playbook-toggle <id> <on|off> [--json]                        # Enable or disable playbook
chainlesschain ops playbook-record <id> <success|failure> [--json]               # Record playbook execution result
chainlesschain ops playbooks [-e|--enabled] [-d|--disabled] [--limit N] [--json] # List playbooks
chainlesschain ops postmortem <id> [--json]                                      # Generate postmortem for resolved incident
chainlesschain ops stats [--json]                                                # AIOps statistics
```

## Database Evolution Framework (Phase 80)

```bash
chainlesschain dbevo migration-statuses [--json]                                 # List migration statuses (success/failed/rolled_back)
chainlesschain dbevo directions [--json]                                         # List migration directions (up/down)
chainlesschain dbevo suggestion-types [--json]                                   # List index suggestion types
chainlesschain dbevo register <version> -u <up-sql> [-d <down-sql>] [--description text] [--json]
chainlesschain dbevo registered [--json]                                         # List registered migrations
chainlesschain dbevo validate [--json]                                           # Validate migrations (gaps, missing down)
chainlesschain dbevo status [--json]                                             # Show current migration status
chainlesschain dbevo up [-t version] [--json]                                    # Migrate up (apply pending)
chainlesschain dbevo down [-t version] [--json]                                  # Rollback migrations
chainlesschain dbevo history [--limit N] [--json]                                # Show migration history
chainlesschain dbevo query-log <sql> <duration-ms> [-s source] [-p params-json] [--json]
chainlesschain dbevo query-stats [--json]                                        # Query statistics (slow queries, avg/max duration)
chainlesschain dbevo slow-threshold <ms> [--json]                                # Set slow query threshold
chainlesschain dbevo query-clear [--json]                                        # Clear query log
chainlesschain dbevo analyze [--min-count N] [--json]                            # Analyze slow queries → index suggestions
chainlesschain dbevo suggestions [-a|--applied] [-p|--pending] [--json]          # List index suggestions
chainlesschain dbevo suggestion-show <id> [--json]                               # Show suggestion details
chainlesschain dbevo apply <id> [--json]                                         # Apply an index suggestion
chainlesschain dbevo stats [--json]                                              # Database evolution statistics
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
chainlesschain serve --bundle ./agent-bundle    # Load bundle for all sessions (AGENTS.md + MCP + approval)
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

## Video Editing Agent (CutClaw-inspired)

```bash
# Full pipeline: deconstruct → plan → assemble → render
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "节奏感强的角色蒙太奇"
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "..." --stream  # NDJSON
chainlesschain video edit --video raw.mp4 --audio bgm.mp3 --instruction "..." --json

# Phase 3: Parallel + quality gate
chainlesschain video edit ... --parallel --review
chainlesschain video edit ... --parallel --concurrency 8    # Max parallel sections

# Phase 4: Audio precision — beat-snap + ducking
chainlesschain video edit ... --use-madmom --snap-beats     # madmom beat detection + snap
chainlesschain video edit ... --ducking                     # Dialogue ducking in audio mix
chainlesschain video edit ... --use-madmom --snap-beats --ducking --parallel --review  # All flags

# Step-by-step (for debugging / Web progress)
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3     # → cached asset hash
chainlesschain video deconstruct --video raw.mp4 --audio bgm.mp3 --use-madmom  # madmom beats
chainlesschain video plan --asset-dir <dir> --instruction "..."      # → shot_plan.json
chainlesschain video assemble --asset-dir <dir> --plan shot_plan.json # → shot_point.json
chainlesschain video assemble ... --parallel --review                 # Parallel + quality gate
chainlesschain video render --video raw.mp4 --points shot_point.json --output final.mp4

# Asset cache management
chainlesschain video assets list                  # List deconstructed assets
chainlesschain video assets show --hash <hash>    # Show asset details
chainlesschain video assets prune --older-than 30 # Clean old caches
```
