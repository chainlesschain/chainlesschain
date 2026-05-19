# @chainlesschain/personal-data-hub

Personal Data Hub — UnifiedSchema, validators, and batch helpers for the
"data back to the individual" middleware.

> **Phase 0 prototype** of the 13-phase plan in
> [`docs/design/Personal_Data_Hub_Architecture.md`](../../docs/design/Personal_Data_Hub_Architecture.md).
> This package only covers schema + validation + ID generation. LocalVault,
> AdapterRegistry, KG ingestor, AI analysis layer, and the actual adapters
> (Email, Alipay, AI Chat × 8, WeChat, ...) come in later phases.

## What's in here

```
lib/
├── constants.js      enum values (entity types, subtypes, capturedBy, ...)
├── ids.js            UUID v7 wrappers (time-ordered IDs, sortable by string)
├── schemas.js        per-entity validators (Person/Event/Place/Item/Topic)
├── batch.js          NormalizedBatch helpers (empty/merge/validate/partition)
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

## Tests

```bash
cd packages/personal-data-hub
npm test
```

**53 tests** covering valid fixtures, invalid fixtures, edge cases (empty names,
out-of-range coordinates, unknown subtypes, wrong identifier value types,
missing required fields, malformed amount/price objects, etc).

## Not in this package (yet)

| Concern               | Lives in                                          |
|-----------------------|---------------------------------------------------|
| LocalVault SQLCipher  | Phase 1 — separate package or desktop-app-vue/main |
| AdapterRegistry       | Phase 2 — `packages/personal-data-hub-adapters/`   |
| KG ingestor / RAG     | Phase 2/4 — wired into existing KG / RAG engines  |
| Email/Alipay/AI/WeChat adapters | Phase 5-12 — separate sub-packages       |
| AI analysis skills    | Phase 11 — `skills/personal-analysis-*/`          |

## License

MIT
