# Process Execution Broker - Spawn/Exec Call Site Audit Report

> Audit Date: 2026-07-18
> Auditor: Agent
> Scope: `packages/cli/src`

## Executive Summary

Total direct `child_process` call sites identified: **~85+**
- `spawn`: ~40 call sites
- `spawnSync`: ~25 call sites
- `execSync`: ~15 call sites
- `execFileSync`: ~8 call sites
- `execFile`: ~2 call sites
- `fork`: ~1 call site

## Classification by Risk Category

### A. Agent Self-Spawn (HIGH PRIORITY - must route through Broker)
These are the primary surfaces where the agent spawns sub-agents or child cc processes:

| File | Function | Type | Purpose |
|------|----------|------|---------|
| `commands/agenda.js` | `defaultSpawnAgent()` | spawn | Wakeup/cron scheduled agent execution |
| `commands/background-session.js` | - | spawn | Background session agent |
| `commands/batch.js` | `spawnAgent()` | spawn + execFileSync | Batch agent execution |
| `commands/eval.js` | - | spawn + spawnSync | Eval child processes |
| `commands/loop.js` | `spawnIteration()` | spawn | Loop mode iteration self-spawn |
| `commands/routine.js` | - | spawn + execFile | Routine execution |
| `commands/team.js` | `spawnAgent()` | spawn | Team/cowork multi-agent |
| `gateways/ws/ws-server.js` | - | spawn | WebSocket gateway spawned CLI commands |
| `harness/background-task-manager.js` | - | fork | Background task forked workers |
| `lib/background-agent-supervisor.js` | - | spawn + spawnSync | Background agent supervision |
| `lib/agent-team/team-worktree.js` | - | spawn + execFileSync | Team worktree agent |
| `lib/claude-code-bridge.js` | - | spawn + execSync | Claude Code bridge execution |
| `lib/agent-sandbox.js` | - | spawnSync | Sandbox (docker/bwrap) execution |

### B. MCP Server Process (MEDIUM PRIORITY)
| File | Function | Type | Purpose |
|------|----------|------|---------|
| `harness/mcp-client.js` | - | spawn | MCP stdio server processes |
| `lib/lsp/lsp-client.js` | - | spawn | LSP server processes |

### C. Git Operations (SAFE - can keep direct)
| File | Type | Count |
|------|------|-------|
| `commands/review.js` | spawnSync | 2 |
| `commands/session.js` | execFileSync | 1 |
| `harness/worktree-isolator.js` | execSync | 3 |
| `lib/agent-worktree.js` | execFileSync/execSync | multiple |
| `lib/checkpoint-store.js` | spawnSync | multiple |
| `lib/cloud/bundle.js` | execFileSync | multiple |
| `lib/git-integration.js` | execSync/spawnSync | multiple |

### D. Package/System Management (SAFE - can keep direct)
| File | Type | Purpose |
|------|------|---------|
| `auth/npm-auth.js` | execSync | npm login/whoami |
| `commands/config.js` | execSync | Open editor |
| `commands/init.js` | execSync/spawnSync | Init tool probing |
| `commands/memory.js` | execSync | Open editor |
| `commands/update.js` | execSync | npm install -g |
| `lib/api-key-helper.js` | execSync | Credential helper |
| `lib/chrome-connector.js` | spawn | Chrome debugger |
| `lib/doctor-checkup.js` | execSync/spawnSync | Doctor checks |
| `lib/downloader.js` | execFileSync | Binary downloads |
| `lib/ensure-utf8.js` | execSync | Windows codepage |
| `lib/host-adb-bridge.js` | execFile | ADB bridge |

### E. Hook Execution (BROKER-AWARE already)
| File | Type | Purpose |
|------|------|---------|
| `lib/async-hook-supervisor.cjs` | spawn/spawnSync | Async hooks |
| `lib/hook-manager.js` | execSync | Legacy hook manager |
| `lib/hook-runner.cjs` | spawn/spawnSync | Hook runner |

### F. Evaluation/Benchmark (TEST only)
| File | Type | Purpose |
|------|------|---------|
| `lib/eval/tasks.js` | execFileSync | Eval task fixtures |
| `lib/lsp/benchmark.js` | execFileSync | LSP benchmarks |
| `lib/computer-use/control-backend.js` | spawnSync | Computer use |

### G. Execution Backend
| File | Type | Purpose |
|------|------|---------|
| `lib/execution-backend.js` | execSync | Shell/Docker/SSH backend |

### H. Background Task Worker
| File | Type | Purpose |
|------|------|---------|
| `harness/background-task-worker.js` | execSync | Worker task execution |

## Migration Plan

### Phase 1 (M1 Deliverable)
Create ProcessExecutionBroker with core interface, then migrate:
1. Category A (Agent Self-Spawn) - all HIGH priority sites
2. Instrument with audit events + logging

### Phase 2 (Post-M1)
1. Category B (MCP/LSP) - register server processes as supervised children
2. Keep Categories C/D as `bypassBroker: true` approved calls (with explicit allowlist)

### Phase 3 (M3 deliverable)
3. Route Category E hooks through Broker for unified supervision

## Bypass Allowlist (Initial)
The following patterns will be initially marked as `bypassBroker: true` with reason:
- All `git` command executions (known safe, no agent control over args)
- Editor opening (`$EDITOR`, `vim`, `nano`, etc.)
- Package manager operations (`npm`, `pip`)
- Chrome/ADB debug bridge connections
- Doctor/diagnostic probes
- Windows codepage setup (`chcp`)
- File downloads/extraction (unzip)
- Test fixtures and benchmarks (test-only code)
