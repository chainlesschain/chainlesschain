---
paths:
  - "desktop-app-vue/**"
---

# Desktop App Development Rules

## Build & Run

```bash
cd desktop-app-vue
npm install
npm run dev                # Development mode (Vite + Electron)
npm run build:main         # Build main process (required before dev if modified)
npm run build              # Full build
npm run make:win           # Package for Windows
```

## Architecture

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

## Adding a New Feature

1. Define IPC channel in `src/main/index.js`
2. Implement logic in main process module
3. Create Vue component in `src/renderer/`
4. Add Pinia store if needed
5. Update routes for new pages

## Database

- File: `data/chainlesschain.db` (encrypted with SQLCipher AES-256)
- Schema: `src/main/database.js`
- Always use prepared statements
- Table categories: Core (notes, conversations, DID, P2P), Memory (embeddings, metadata), AI (instincts, knowledge graph, decisions), Enterprise (RBAC, org, approval), Collaboration (CRDT, sessions), Storage (IPFS), Analytics

## U-Key Integration

**Windows Only**: Via Koffi FFI, SDK in `SIMKeySDK-20220416/`, default PIN: `123456`
**macOS/Linux**: Simulation mode only

## Technology Stack

- **Electron**: 39.2.6, **Vue**: 3.4, **TypeScript**: 5.9.3, **UI**: Ant Design Vue 4.1
- **State**: Pinia 2.1.7 (46 TypeScript stores)
- **P2P**: libp2p 3.1.2, WebRTC (wrtc), **Crypto**: Signal Protocol
- **Image**: Sharp, Tesseract.js, **Git**: isomorphic-git
- **Search**: natural (BM25/TF-IDF), Qdrant (Vector)
