# @chainlesschain/personal-data-hub

Personal Data Hub — UnifiedSchema, validators, batch helpers, SQLCipher
LocalVault, and AdapterRegistry for the "data back to the individual"
middleware.

> **v0.4.0 (ships with ChainlessChain v5.0.3.99, 2026-06-08).** Phase 0–13
> of the 13-phase plan in
> [`docs/design/Personal_Data_Hub_Architecture.md`](../../docs/design/Personal_Data_Hub_Architecture.md)
> have landed, plus the multi-platform collection layer. The foundation is
> unchanged: schema + validation + UUID v7 (Phase 0); SQLCipher LocalVault +
> pluggable key providers + migrations (Phase 1); AdapterRegistry + KG/RAG
> derivation (Phase 2); the natural-language AnalysisEngine with a hard
> privacy gate that refuses non-local LLMs unless the caller opts in
> (Phase 3); and production bridges — **CcLLMAdapter** (wraps cc llm-manager:
> Ollama / Volcengine / Anthropic / Gemini / DeepSeek), **CcKgSink**, **CcRagSink**
> — injected at the desktop/CLI entry so this package stays decoupled (Phase 3.5).
>
> **51 adapters are now live** (no longer "later phases"): Email IMAP,
> Alipay bill, 9 AI-chat vendors, WeChat / QQ / Weibo / Bilibili / Douyin /
> Xiaohongshu / Toutiao / Kuaishou social, Telegram / WhatsApp messaging,
> Taobao / JD / Meituan / Pinduoduo shopping, Amap / Baidu-map / Tencent-map /
> Ctrip / 12306 travel, system-data (contacts / calls / sms / location),
> and the developer-activity set (git / shell / vscode / browser-history /
> local-files / win-recent).
>
> **New in v0.4.0 (v5.0.3.99):** adapter **readiness** — split out from the
> loose `healthCheck` sync gate into a real ready/needs_setup/unavailable
> judgment (`registry.readiness()`) with a one-line reason, so "config looks
> fine but nothing collects" is no longer silent; an `adapter-guide.js`
> single-source of import steps reused across web-shell / desktop / CLI /
> Android; new local-direct-read sources (Douyin, WeChat PC, QQ-NT, DingTalk,
> Feishu, WeRead, Apple Health, NetEase Music); email-bill LLM gap-fill
> (Phase 5.5); and iOS encrypted-backup decryption (Phase 7.5b).
>
> Editing `lib/**` requires bumping the package version + `npm publish` +
> the Android `USR_VERSION` sentinel, or real devices keep running stale code
> (see hidden-risk-traps #27/#28).

## What's in here

```
lib/
├── constants.js      enum values (entity types, subtypes, capturedBy, ...)
├── ids.js            UUID v7 (hand-rolled RFC 9562, ~30 LOC, no dep)
├── schemas.js        per-entity validators (Person/Event/Place/Item/Topic)
├── batch.js          NormalizedBatch helpers (empty/merge/validate/partition)
├── migrations.js     LocalVault schema (events/persons/places/items/topics
│                     /sync_watermarks/audit_log/raw_events) + versioning
├── key-providers.js  InMemoryKeyProvider + FileKeyProvider + KeyProvider
│                     contract for platform Keystore impls in later phases
├── vault.js          LocalVault — SQLCipher AES-256, transactional putBatch,
│                     typed put/get, queryEvents, watermarks, audit, key
│                     rotation (WAL-safe), destroy
├── adapter-spec.js   PersonalDataAdapter contract + assertAdapter check
├── adapter-readiness.js readiness() — ready/needs_setup/unavailable + reason,
│                     split out from the loose healthCheck sync gate
├── adapter-guide.js  category-driven import guides (single source of import
│                     steps reused across web-shell / desktop / CLI / Android)
├── adapters/         51 live adapters (email-imap, alipay-bill, ai-chat-history,
│                     wechat / wechat-pc, qq-pc, dingtalk-pc, feishu-pc, weread,
│                     apple-health, netease-music, social-*, shopping-*,
│                     travel-*, system-data, git-activity, vscode, ...)
├── kg-derive.js      UnifiedSchema → KG triples (rdf:type / by / involves /
│                     happened-at / etc.) — engine-agnostic
├── rag-derive.js     UnifiedSchema → RAG (text, metadata) docs for indexing
│                     into BM25 + vector retrievers
├── registry.js       AdapterRegistry — register/list, syncAdapter with full
│                     pipeline (health → sync → archive raw → normalize →
│                     partition valid/invalid → vault → KG sink → RAG sink
│                     → watermark → audit), syncAll, pluggable kgSink/ragSink
├── mock-adapter.js   reference impl + test fixture (deterministic seeded)
├── query-parser.js   heuristic time-window + filter + intent extraction
│                     from natural-language questions
├── prompt-builder.js fact summarization + system/user prompt construction
│                     (system prompt is fact-free; facts go in user role as
│                     marked-untrusted JSON) + citation parser + validator
├── llm-client.js     MockLLMClient (tests) + OllamaClient (default standalone)
│                     conforming to the chat({messages}) → {text, usage}
│                     contract. Production plugs in CcLLMAdapter wrapping
│                     the existing desktop-app-vue llm-manager.
├── analysis.js       AnalysisEngine — orchestrates parseQuery → vault facts
│                     (optional RAG augmentation) → buildPrompt → llm.chat →
│                     parseCitations → validateCitations → audit. Hard
│                     privacy gate refuses non-local LLMs without opt-in.
├── bridges/
│   ├── cc-llm-adapter.js   wraps cc llm-manager.chat → LLMClient
│   ├── cc-kg-sink.js       hub triples → cc addEntity + addRelation
│   ├── cc-rag-sink.js      hub RagDocs → cc BM25 (+ optional vector)
│   └── index.js            re-exports
└── index.js          re-exports
```

## The 5 core entities

Mirrors §5.1 of the design doc. Every adapter normalizes its raw rows into
these five types so the KG / RAG / analysis layers see a consistent shape.

| Type   | Examples                                       |
|--------|------------------------------------------------|
| Person | self / contact / merchant / ai-agent           |
| Event  | message / order / payment / visit / post / ai-message / ai-image-generation / ... |
| Place  | home / restaurant / mom's place                |
| Item   | product / link / media / document              |
| Topic  | "mom's health" / "Python learning" / "AI conversation with DeepSeek" |

All entities share `BaseEntity` fields:
- `id` — UUID v7 (time-ordered)
- `source` — `{ adapter, adapterVersion, capturedAt, capturedBy, originalId? }`
- `ingestedAt` — ms timestamp
- `confidence` — 0..1, optional
- `extra` — schemaless bag for adapter-specific fields

## Usage

```js
const {
  newId,
  validate,
  validatePerson,
  validateBatch,
  partitionBatch,
  PERSON_SUBTYPES,
  EVENT_SUBTYPES,
} = require("@chainlesschain/personal-data-hub");

const person = {
  id: newId(),
  type: "person",
  subtype: PERSON_SUBTYPES.CONTACT,
  names: ["妈妈", "陈某某"],
  identifiers: { phone: ["138-0000-1111"] },
  ingestedAt: Date.now(),
  source: {
    adapter: "wechat",
    adapterVersion: "0.1.0",
    capturedAt: Date.now(),
    capturedBy: "sqlite",
    originalId: "wxid_xyz",
  },
};

const { valid, errors } = validatePerson(person);
// → { valid: true, errors: [] }
```

## Validators never throw

All validators return `{ valid: boolean, errors: string[] }`. This lets the
adapter ingest pipeline collect every bad row in one pass and ship them to
a review queue instead of failing the whole sync window on the first corrupt
entry from a flaky third-party data source.

```js
const { partitionBatch } = require("@chainlesschain/personal-data-hub");

const { valid, invalid, invalidReasons } = partitionBatch(rawBatch);
// commit `valid` to vault, spool `invalid` to review queue
```

## LocalVault quick demo

```js
const fs = require("fs"), os = require("os"), path = require("path");
const {
  LocalVault, generateKeyHex, newId, emptyBatch,
  PERSON_SUBTYPES, EVENT_SUBTYPES,
} = require("@chainlesschain/personal-data-hub");

const v = new LocalVault({
  path: path.join(os.homedir(), ".chainlesschain", "hub.db"),
  key: generateKeyHex(),  // production: pull from a KeyProvider
});
v.open();

const now = Date.now();
const mom = {
  id: newId(), type: "person", subtype: PERSON_SUBTYPES.CONTACT,
  names: ["妈妈"], identifiers: { phone: ["13800001111"] },
  ingestedAt: now,
  source: { adapter: "demo", adapterVersion: "0.1.0", capturedAt: now, capturedBy: "manual" },
};
const order = {
  id: newId(), type: "event", subtype: EVENT_SUBTYPES.ORDER,
  occurredAt: now - 86400000,
  actor: "person-self",
  participants: [mom.id],
  content: { title: "妈妈生日蛋白粉", amount: { value: 288.5, currency: "CNY", direction: "out" } },
  ingestedAt: now,
  source: { adapter: "demo", adapterVersion: "0.1.0", capturedAt: now, capturedBy: "manual", originalId: "ord-42" },
};

v.putBatch({ ...emptyBatch(), persons: [mom], events: [order] });

// Query
const orders = v.queryEvents({ subtype: "order" });

// Adapter dedup before ingest
const exists = v.findBySource("events", "demo", "ord-42");

// Sync watermark
v.setWatermark("demo", "INBOX", { watermark: "42", lastSyncedAt: now });
const wm = v.getWatermark("demo", "INBOX");

// Rotate the master key (WAL-safe — swaps journal mode transparently)
v.rotateKey(generateKeyHex());

v.close();
```

## Key providers

Production builds inject a platform-specific KeyProvider that talks to
DPAPI / Keychain / Android Keystore / iOS Keychain (and optionally wraps
the result in a U-Key/SIMKey hardware key). Implement this 4-method
contract:

```js
{
  async get(name)         // returns hex or null
  async set(name, hexKey) // store hex (validate it's 64 hex chars first)
  async del(name)
  async has(name)
}
```

The package ships `InMemoryKeyProvider` (tests) and `FileKeyProvider`
(dev fallback, stores 0600-perm files on disk). Recommended key names:

- `vault:<vault-id>`      master key for a vault
- `vault:<vault-id>:prev` retained pre-rotation key for emergency recovery
- `adapter:<name>:cookie` per-adapter blobs (used by later-phase adapters)

## Tests

```bash
cd packages/personal-data-hub
npm test
```

**2040 tests** across 121 files covering ID generation, all 5 entity validators,
batch helpers, key providers, vault open/migrations, entity round-trips,
transactional putBatch with rollback, raw_events archive, queryEvents
filters + pagination, sync watermarks, audit log, key rotation (WAL-safe),
destroy, stats, adapter-spec assertion, KG triple derivation, RAG doc
derivation, MockAdapter deterministic behavior, full registry sync E2E
(including health-gating, mid-sync failure recovery, sink failure
tolerance), and the 1k events <30s ingest perf gate.

## Not in this package (yet)

| Concern               | Lives in                                          |
|-----------------------|---------------------------------------------------|
| Platform KeyProviders (DPAPI/Keychain/Keystore) | desktop-app-vue main-process bridge (the package ships the contract + InMemory/File providers) |
| Qdrant vector retrieval | wired into the existing RAG engine at the cc entry (BM25 derivation ships here) |
| AI analysis skills    | `skills/personal-analysis-*/` (the 5 built-in analysis skills) |
| Native SQLCipher build | `better-sqlite3-multiple-ciphers` — host/Electron ABI dual-load handled at the cc entry |

## License

MIT
