# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainlessChain is a decentralized personal AI management system with hardware-level security (U-Key/SIMKey). It integrates three core features:

1. **Knowledge Base Management** - Personal second brain with RAG-enhanced search
2. **Decentralized Social** - DID-based identity, P2P encrypted messaging, social forums
3. **Decentralized Trading** - Digital asset management, marketplace, smart contracts

**Current Version**: see `package.json.productVersion` (Evolution Edition — 144 Desktop Skills + 25 Android REMOTE Skills (24 seeded in SeedRegistry) + 158 CLI Commands + 30,000+ Tests; MTC v0.11 — Phases 0–4 fully landed + 跨联邦信任锚 + 离线审计 + 多跳路由 + Gas 感知 + SLA tracker + 监控仪表板; federation MTCA M-of-N multi-sig + filesystem/libp2p gossipsub auto-discovery + heterogeneous Ed25519+SLH-DSA + Q-ENG-2 backend bridge + OpLog per-row badge; 476 MTC tests across 6 layers)

**Version hierarchy** (values live in their respective files, do not duplicate here):
- Product line: `package.json.productVersion` (marketing / release notes / docs — single source of truth, format `vX.Y.Z.N`)
- CLI npm: `packages/cli/package.json` `version` field (alpha prerelease track, independent)
- Desktop app: `desktop-app-vue/package.json` `version` field — **must follow productVersion** as `X.Y.Z-alpha.N` (semver-compatible derivation; required so electron-updater can compare versions; before v5.0.3.37 this was static `1.1.2-alpha` and auto-updater never offered any update across 6 productVersion bumps)
- Monorepo root: `package.json` `version` field (workspaces aggregate, not published, independent)

**Primary Application**: `desktop-app-vue/` (Electron + Vue3) - This is the main development focus.

## Configuration Management

### Unified Configuration Directory (`.chainlesschain/`)

**Location:**
- Windows: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`
- macOS: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/`
- Linux: `~/.config/chainlesschain-desktop-vue/.chainlesschain/`

**Key Files:**
- **`.chainlesschain/config.json`**: Main configuration file (git-ignored)
- **`.chainlesschain/rules.md`**: Project coding rules - **READ THIS FIRST!** (priority > CLAUDE.md)
- **`desktop-app-vue/src/main/config/unified-config-manager.js`**: Configuration manager

**Priority:** Environment variables > `.chainlesschain/config.json` > Defaults

## Quick Start Commands

```bash
# Desktop App
cd desktop-app-vue && npm install && npm run dev

# CLI
cd packages/cli && npm install && npm test

# Backend (Docker)
docker-compose up -d
```

## Git Workflow — auto push to github + gitee (installed 2026-05-12, gitee re-added 2026-05-28 after .git slim)

After every `git commit` on this repo, `.husky/post-commit` automatically pushes to **both `github` and `gitee` remotes** (skips `github-https`, which is the HTTPS mirror of github). **No manual `git push` needed** — that runs by default. Uses `--no-verify` to skip the pre-push `vue-tsc` check (~60s saved per commit); type-checking still runs in CI.

If the hook fires but a push fails, it prints `[post-commit] WARN <remote> push FAILED` with the last 5 lines of error. Retry manually with `git push <remote> main`. Force-pushes (amend / rebase) are not automated — the hook detects rewritten HEAD and warns; use `git push --force-with-lease=main:<expected-sha>` manually after confirming no parallel-session race (see memory `feedback_parallel_session_git_race.md` + `feedback_dual_remote_push.md`).

**Internal Android binaries (2026-05-28 split)**: Termux Node + cc-cli.tgz + frida-inject-arm/arm64 + 20 .so files are **no longer tracked in git**. They live in GitHub Release [`internal-binaries-android-v<binariesVersion>`](https://github.com/chainlesschain/chainlesschain/releases/tag/internal-binaries-android-v20260528) and are fetched at gradle build time by the `downloadInternalBinaries` task in `android-app/build.gradle.kts` (verified against sha256 in `android-app/binaries-manifest.txt`). The prior pattern (`node-runtime-bundle.yml` doing `git add + commit + push` of fresh binaries) had bloated `.git` to 3.4 GB / 24 cc-cli.tgz versions; the slim brought it to ~2.1 GB (size-pack 1.97 GiB) and re-enabled gitee dual-push. To refresh, the workflow uploads new files to a new release version then bumps `binariesVersion` via a tiny text-only commit. See `git_slim_2026_05_28_recipe` memory entry for the full recipe + risks.

Fresh clones inherit the hook via `npm install` (husky's `prepare` script sets `core.hooksPath=.husky/_`).

## CLI Commands Reference

**See [`docs/CLI_COMMANDS_REFERENCE.md`](docs/CLI_COMMANDS_REFERENCE.md)** for the full 90-command reference (thin index → 6 sub-files in `docs/cli/`). Read on demand, not auto-loaded.

Key CLI entry points:
- `cc setup/start/stop/status/doctor` — system management
- `cc chat/ask/agent/skill` — AI headless commands
- `cc note/search/memory/session` — knowledge & sessions
- `cc mcp/browse/did/encrypt/auth` — integrations & security
- `cc cowork/workflow/hook/a2a` — multi-agent & orchestration

## Feature Index

**See [`docs/FEATURES.md`](docs/FEATURES.md)** for the complete list (144 desktop skills, 25 Android REMOTE skills).

Key highlights:
- **AI Engine**: Cowork Multi-Agent, Plan Mode, Instinct Learning, Skills System (141 built-in)
- **Enterprise**: RBAC, SSO, Audit & Compliance, Org Management
- **Integration**: MCP, Browser Automation, Computer Use, IPFS
- **v3.0-v4.0**: Pipeline Orchestrator, NL Programming, Multimodal, Agent Federation
- **v5.0.0+**: IPC Domain Split, DI Container, A2A, Workflow Engine, ZKP, Low-Code, BI Engine

## Architecture Overview

### Key Modules

| Layer | Path | Description |
|-------|------|-------------|
| Desktop Main | `desktop-app-vue/src/main/` | Electron main process (AI, IPC, Security, Enterprise) |
| Desktop Renderer | `desktop-app-vue/src/renderer/` | Vue3 + TypeScript (113 Pinia stores) |
| CLI | `packages/cli/` | npm CLI (~2MB, 158 commands, Commander) |
| Java Backend | `backend/project-service/` | Spring Boot 3.1.11 + Java 17 + PostgreSQL |
| Python AI | `backend/ai-service/` | FastAPI + Ollama + Qdrant |
| Android | `android-app/` | 25 REMOTE skills (SeedRegistry, post-v1.0 GA reposition) |

### Technology Stack

- **Desktop**: Electron 39.2.6, Vue 3.4, TypeScript 5.9.3, Ant Design Vue 4.1, Pinia 2.1.7
- **Backend**: Java 17 + Spring Boot 3.1.11, Python FastAPI, PostgreSQL 16, Redis 7
- **P2P/Crypto**: libp2p, WebRTC, Signal Protocol, SQLCipher (AES-256)
- **Search**: BM25/TF-IDF (natural), Vector (Qdrant)

## Environment Variables

Key variables (see `desktop-app-vue/.env.example` or `config/.env.example`):
```bash
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
DB_HOST=localhost:5432
REDIS_HOST=localhost:6379
```

## Known Limitations

1. **U-Key**: Windows only (macOS/Linux simulation mode)
2. **GPU**: Docker Ollama requires NVIDIA GPU for acceleration

## Documentation References

- **Hidden-Risk Traps Handbook (改前必看)**: `docs/internal/hidden-risk-traps.md` (26 silent-failure patterns #6-#31: docs sync / npm publish / CI mask / git race / lint-staged / E2E / Node 23 / hoisting / Android update / SQLite TEXT / commit-msg / Android remote / GH immutable / Android R8 minify / WebView post-onload cookie race / GNU tar @LongLink / MediaPipe JNI OUT_OF_RANGE → SIGABRT / bs3mc-bs3 ABI dual-load / Android Bootstrap @Singleton+Mutex race / SQLite partial-index `IF NOT EXISTS` drift / Legacy-GPU Chromium 0xc0000602 fail-fast / USR_VERSION sentinel cache miss / workspace dep npm publish stale / parallel-session empty-tree index-race / cosmetic-green CI masking (continue-on-error + always-exit-0 watcher) / e2e server-readiness timeout 冷启动高负载提前到期 + per-test/child timeout 倒挂. Read BEFORE touching `release.yml` / `.github/workflows/` / `.husky/` / `packages/*/package.json` / SQLite handlers / `electron-builder.yml` / `desktop-app-vue/src/main/index.js` (Electron 启动逻辑) / Android `app/build.gradle.kts` deps / `SocialCookieWebViewScreen.kt` / `LocalFilesystemBootstrapper.kt` (or any手写 tar parser) / `packages/personal-data-hub/lib/migrations.js` / `packages/personal-data-hub/lib/**` (Android cc 子进程依赖；改后必 bump version + npm publish + USR_VERSION，traps #27+#28 联合) / `packages/cli/lib/**` / `packages/cli/__tests__/e2e/**` (server-readiness/timeout 预算，trap #31) / `pdh/llm/MediaPipeLlmEngine.kt` / any PDH SQLite reader, OR doing release publish / cross-session rebase / V5 baseline E2E / Android `UpdateChecker.kt` / `gh release` cleanup / user 报 Windows "installer 闪退" / 真机装新 APK 但 PDH 行为没变)
- **Architecture Patterns**: `docs/claude/CLAUDE-patterns.md` (44k — read on demand when working with patterns)
- **Architecture Decisions**: `docs/claude/CLAUDE-decisions.md`
- **Troubleshooting**: `docs/claude/CLAUDE-troubleshooting.md` (22k — read on demand when debugging issues)
- **System Design**: `docs/design/系统设计_主文档.md`
- **Quick Start**: `docs/quick-start/QUICK_START.md`, `docs/quick-start/HOW_TO_RUN.md`
- **README**: `README.md` (Chinese), `README_EN.md` (English)

### Doc-site source-of-truth (改文档前**必看**)

`docs-site/` 与 `docs-site-design/` 的 `docs/design/**/*.md` 都是**自动同步生成**的副本，**不是 git tracked 的源文件**。直接编辑这些副本会被下一次同步脚本覆盖（且 git status 看不到，定位极隐蔽）。

| 副本（不要改） | 同步脚本 | **真正的源文件（改这里）** |
|---|---|---|
| `docs-site/docs/design/**/*.md` | `docs-site/scripts/sync-design-docs.js` | `docs/design/**/*.md`（项目根，git tracked，常带中文文件名）|
| `docs-site-design/docs/**/*.md`（不含 `index.md`） | `docs-site-design/scripts/sync-docs.js` | 同上 — `docs/design/**/*.md`（项目根）|

要改设计文档：(1) `git ls-files --error-unmatch <path>` 确认是否 tracked；(2) 若不是，找对应的 `sync-*.js` 看 `sourceDir` 找源；(3) 改源 + 跑 `node <sync-script>` 让两份副本刷新。`docs-site/docs/guide/**` 是 git tracked 的源文件，可以直接改。

**加新中文文件名的源文档**：两 sync 脚本共享 `docs/design/_filename-map.json`（single source）。加映射改 JSON 即可，两 site 同时生效。值为字符串时两 site 用同名，值为 `{"docs-site": "...", "docs-site-design": "..."}` 对象时各 site 用各自 key。

**例外白名单（每个 docs site 自管，不来自源）**：`index.md` 和 `.vitepress/`（在 EXCLUDE 里）。

类似的"生成产物 vs 源"也存在于其它子树（如 `desktop-app-vue/docs/api/generated/`），编辑前先确认。

## Rules (path-scoped, auto-loaded)

Detailed rules are in `.claude/rules/` and only load when working in matching paths:

| Rule File | Scope |
|-----------|-------|
| `desktop-dev.md` | `desktop-app-vue/**` |
| `cli-dev.md` | `packages/cli/**`, `packages/core-*/**` |
| `testing.md` | `**/*.test.*`, `**/tests/**` |
| `encoding.md` | `**/*.js`, `**/*.ts`, `**/*.vue` |
| `eslint-style.md` | `**/*.ts`, `**/*.vue`, `**/*.js` |
| `backend.md` | `backend/**` |
