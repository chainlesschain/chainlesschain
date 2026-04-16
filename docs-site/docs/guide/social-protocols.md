# Social Protocols User Guide

> Hands-on guide for the decentralized social protocol surface introduced in v5.0.2.10.
>
> Covers Nostr (NIP-04/09/25), Matrix (Threads/Spaces), ActivityPub C2S, the
> in-process social graph, and language-aware topic classification.
>
> **Last updated**: 2026-04-16 · See also: `docs/CLI_COMMANDS_REFERENCE.md`

---

## 1. Who this guide is for

- Power users who want to federate with the Fediverse / Nostr / Matrix from the CLI
- Agents that need a programmable social surface without Desktop UI
- Developers integrating ChainlessChain as a social-identity layer

All commands below run headless and never require the desktop app.

---

## 2. Nostr — extended NIP support

ChainlessChain implements NIP-01 (events), NIP-04 (encrypted DM), NIP-09
(deletion), NIP-19 (bech32), and NIP-25 (reactions). Signing and key
encoding now go through real BIP-340 schnorr + bech32, shared with the
Desktop main process via `@chainlesschain/session-core/nostr-crypto`.

### 2.1 Key setup

```bash
# Generate a new keypair (npub / nsec + hex)
chainlesschain nostr keygen

# Bind it to an existing DID (bidirectional lookup)
chainlesschain nostr map-did --did did:key:z6Mk... --npub npub1... --nsec nsec1...
```

### 2.2 Relay + public posts

```bash
chainlesschain nostr relays                            # list configured relays
chainlesschain nostr publish --kind 1 --content "hi"   # public text note
```

### 2.3 NIP-04 encrypted direct messages

```bash
# Send — recipient-pubkey is their hex pubkey (not npub)
chainlesschain nostr dm \
  --sender-nsec nsec1... \
  --recipient-pubkey 02ab... \
  --plaintext "meet at 8pm"

# Decrypt an inbound DM (reads ciphertext from the local event store)
chainlesschain nostr dm-decrypt \
  --recipient-nsec nsec1... \
  --sender-pubkey 02ab... \
  --ciphertext "AES-CBC-BASE64?iv=IV-BASE64"
```

Crypto: x-only-pubkey ECDH (pubkey prefixed with `0x02`) → AES-256-CBC
with a fresh 16-byte IV per message. The ciphertext format matches the
reference NIP-04 encoding (`<ct>?iv=<iv>`).

### 2.4 NIP-09 deletion requests

Owners may request deletion of their own events. Subscribing clients
treat matching ids as tombstoned.

```bash
chainlesschain nostr delete \
  --author-nsec nsec1... \
  --event-ids evt1,evt2 \
  --reason "mistake"
```

The kind-5 event carries one `["e", <id>]` tag per deleted event plus
the optional `content` reason.

### 2.5 NIP-25 reactions

```bash
chainlesschain nostr react \
  --author-nsec nsec1... \
  --target-event-id evt-to-like \
  --target-author-pubkey 02ab... \
  --content "+"                                     # or "-" or ":emoji:"
```

The kind-7 event carries both `["e", <target>]` and
`["p", <target-author>]` tags.

---

## 3. Matrix — Threads + Spaces

### 3.1 Threads (MSC3440 / `m.thread`)

```bash
chainlesschain matrix thread send   --room !abc:server --root $eventId --body "reply"
chainlesschain matrix thread list   --room !abc:server --root $eventId
chainlesschain matrix thread roots  --room !abc:server
```

Behind the scenes we attach a `rel_type: m.thread` to outgoing events
and index incoming relations in the `matrix_threads` table so the list
command answers without a roundtrip.

### 3.2 Spaces (`m.space` / `m.space.child`)

```bash
chainlesschain matrix space create      --name "Acme Corp"
chainlesschain matrix space add-child   --space !space:s --child !room:s
chainlesschain matrix space children    --space !space:s
chainlesschain matrix space list
```

---

## 4. ActivityPub C2S

Supports Create (Note), Follow / Accept / Undo, Like, Announce. Inbox
polls a configurable actor; outbox is a local queue delivered via
`POST /deliver`.

```bash
chainlesschain activitypub actor create     --name alice --summary "builder"
chainlesschain activitypub publish          --actor alice --content "hello fedi"
chainlesschain activitypub follow           --actor alice --target https://...
chainlesschain activitypub accept           --actor alice --follow-id <id>
chainlesschain activitypub unfollow         --actor alice --target https://...
chainlesschain activitypub like             --actor alice --target https://...
chainlesschain activitypub announce         --actor alice --target https://...
chainlesschain activitypub outbox           --actor alice
chainlesschain activitypub inbox            --actor alice
chainlesschain activitypub deliver          --actor alice
chainlesschain activitypub followers        --actor alice
chainlesschain activitypub following        --actor alice
```

`ap` is accepted as an alias for `activitypub`.

---

## 5. Social graph

Typed directed edges with weight/metadata, plus a realtime event stream.
Supported types: `follow`, `friend`, `like`, `mention`, `block`.

```bash
# Mutations
chainlesschain social graph add-edge alice bob -t follow -w 1.0 -m '{"note":"met IRL"}'
chainlesschain social graph remove-edge alice bob -t follow

# Queries
chainlesschain social graph neighbors bob -d both --json
chainlesschain social graph snapshot -t follow

# Subscribe — prints edge:added/edge:removed/node:* as NDJSON
chainlesschain social graph watch -e edge:added,edge:removed
chainlesschain social graph watch --once              # first event then exit
```

The graph is in-memory by default and hydrated from the
`social_graph_edges` SQLite table on CLI start. Edges are idempotent —
re-adding updates weight/metadata in place.

---

## 6. Topic classification

Language-aware topic scoring with pluggable lexicons. Default lexicons
ship in EN/ZH/JA for 8 topics (`tech`, `finance`, `sports`, `food`,
`travel`, `music`, `politics`, `health`). CJK is tokenized char-by-char
so multi-char phrases (e.g. "人工智能") match via substring inclusion.

```bash
chainlesschain social detect-lang "今日のサッカーの試合は素晴らしかった"
# → { "language": "ja" }

chainlesschain social analyze "AI and cloud computing" --top-k 3 --json
# → { language: "en", topics: [{topic:"tech", score:0.82, rawScore:5}, ...] }

chainlesschain social analyze "AI software code" --lang zh        # forced language
```

Custom lexicons can be registered programmatically via the
`topic-classifier` lib; see `packages/cli/src/lib/topic-classifier.js`.

---

## 7. Where things are persisted

| Scope | Location |
| --- | --- |
| Nostr relays + events | SQLite `nostr_relays`, `nostr_events` |
| NIP-04 DMs | inline in `nostr_events` (kind 4, encrypted content) |
| NIP-09 deletions | `nostr_events` kind 5 (tombstone-on-subscribe) |
| Matrix threads | `matrix_threads` index table |
| Matrix spaces | `matrix_spaces`, `matrix_space_children` |
| ActivityPub | `ap_actors`, `ap_objects`, `ap_outbox`, `ap_inbox`, `ap_followers` |
| Social graph | `social_graph_edges` (hydrated into memory on start) |

All tables live in the SQLCipher-encrypted application database.

---

## 8. Troubleshooting

- **"Invalid checksum in npubXXX"** — you passed a hand-typed or
  placeholder string. npub/nsec are bech32-checksummed, use `nostr keygen`.
- **"ECDH failed"** on `dm` — `--recipient-pubkey` must be the 32-byte
  x-only hex pubkey (same value you get from `nostr keygen` as
  `publicKeyHex`), **not** the npub bech32 form.
- **`social graph watch` hangs** — by design; pass `--once` for a single
  event, or pipe to `jq` and use Ctrl-C to exit.
- **`social analyze` returns `language: "zh"` for an English string when
  `--lang zh` is forced** — that is expected; lexicon lookup falls back
  to EN for the given topic when the forced language has no entries.
