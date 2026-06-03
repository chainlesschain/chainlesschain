# Mastodon + Nostr drafts — v5.0.3.55 announcement

Target audience: privacy-friendly, decentralization-leaning, tech.
Angle: iOS port lead, but emphasize the **decentralization / open-source / hardware-crypto** identity (resonates more here than on X).
Meta-angle: ChainlessChain itself bridges Nostr/ActivityPub/Matrix — "we ship to Nostr because we *are* Nostr-compatible".

---

## Mastodon — 3-toot thread (≤ 500 chars each, default instance cap)

### Toot 1/3 — Hook

```
🚀 ChainlessChain v5.0.3.55 ships.

Android v1.0 GA was real-device validated last week. iOS mirror port started the next day — all 4 phases landed framework-complete inside 24h.

QR pairing · WebRTC remote terminal · remote-operate framework · push notifications. All on iOS now.

Open-source. Decentralized personal AI on hardware-level security (U-Key / SIMKey). Knowledge · Social · Trading.

🧵 1/3

#ChainlessChain #DecentralizedAI #PrivacyTech #SelfHosted
```
~480 chars

### Toot 2/3 — How "4 phases / 1 day" works

```
The "4 phases / 1 day" trick: mirror an already-validated Android version.

1️⃣ Pairing — Flow A/B QR + 6-digit fallback (71 tests)
2️⃣ Terminal — WebRTC DataChannel + xterm.js WKWebView (163 tests)
3️⃣ Remote-operate + 4 typed skills (~264 tests)
4️⃣ Notification skill — 11 RPC methods + UN center push (~313 tests)

UI 1:1 with Android Kt screens. HIG deviation: 6-item whitelist. Android validated on Xiaomi × Win desktop — confidence transfers.

2/3
```
~480 chars

### Toot 3/3 — Also + downloads + closer

```
Also in v5.0.3.55:

• CLI 0.162.0 — `cc pair preflight` Linux LAN diagnostics + `cc pair token` headless pairing
• Cross-chain bridge × m-of-n multisig provenance
• Wear → phone VoiceMode forward
• 2 P0 continuation-leak fixes

Releases: https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55
Docs: https://docs.chainlesschain.com
Design: https://design.chainlesschain.com

3/3

#OpenSource #FOSS #ElectronJS #SwiftUI
```
~480 chars

### Mastodon posting notes
- **Hashtags matter here** — unlike X, Mastodon has no algorithm, discovery is hashtag-based. Use 3-4 per toot, not more.
- **Default 500-char cap** — some instances (mastodon.online, fosstodon.org) raise to 1000+; if you post from such an instance, you can collapse the 3 toots into 2.
- **Image alt text** required by community norm if you attach screenshots. For text-only this thread, no alt needed.
- **CW (content warning)** not needed for product release.
- **Federation lag** — boosts/replies from other instances can take 1-2 min to propagate; don't panic at initial low engagement.
- **Best instances for tech**: fosstodon.org / hachyderm.io / mastodon.social. Post from the project's own instance if it has one; otherwise hachyderm tends to have the strongest dev community right now.

---

## Nostr — single long note (kind 1, ~1800 chars)

```
🚀 ChainlessChain v5.0.3.55 ships — decentralized personal AI on hardware-level security.

Big news: iOS port. Android v1.0 GA was real-device validated last week (Xiaomi 24115RA8EC × Windows git-bash). iOS mirror port started the next day — all 4 phases landed framework-complete inside 24h.

📱 What's now on iOS:
• Phase 1 — Desktop QR pairing (Flow A scans phone / Flow B scans desktop / 6-digit fallback) — 71 tests
• Phase 2 — Remote desktop terminal via WebRTC DataChannel + xterm.js WKWebView — 163 tests
• Phase 3 — Remote-operate framework + 4 typed skills (Clipboard / File / Screenshot / SystemInfo) — ~264 tests
• Phase 4 — Notification skill (11 RPC methods + LRU dedup + iOS UN Center push + optimistic update + offline gate) — ~313 tests

Why so fast? Mirror an already-validated Android version. UI information architecture 1:1 with Android Kotlin screens. HIG deviation limited to a 6-item whitelist. Android side was real-device E2E validated — confidence transfers, not from-scratch design.

🛠️ Also shipping:
• CLI 0.162.0 — `cc pair preflight` Linux LAN diagnostics + `cc pair token` SSH dev-box / headless pairing
• Cross-chain bridge × M-of-N multisig provenance (Layer 1+2, 8 PRs)
• Watch face VoiceMode → phone Wearable Data Layer forward
• 2 P0 continuation-leak fixes in iOS RPC pool

📥 Downloads (Win / macOS / Linux / Android arm64/v7/universal/aab):
https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55

📚 Design docs (4 iOS Phase docs + trap memories):
https://design.chainlesschain.com

Stack: Electron + Vue3 desktop · Kotlin native Android · SwiftUI iOS · libp2p / WebRTC / Signal Protocol · Nostr / Matrix / ActivityPub bridges · U-Key / SIMKey hardware crypto.

139 desktop skills · 28 Android skills · 114 CLI commands · 8000+ tests.

#chainlesschain #nostr #decentralizedai #foss #selfsovereign
```
~1800 chars

### Nostr posting notes
- **No hard char limit** for kind 1 notes but ≤2000 reads well on Damus/Amethyst/Primal. Above that, switch to NIP-23 long-form (kind 30023, see below).
- **Hashtags are tags `t`** in the event JSON — clients render them as discoverable tags. Use 4-6 max.
- **npub mentions** — if there are project maintainers' npubs, drop them as `nostr:npub1...` references; they get notified.
- **Best clients to verify rendering before broadcast**: Damus (iOS) / Amethyst (Android) / nostrudel.ninja or iris.to (web).
- **Cross-poster bridges**: mostr.pub bridges Mastodon ↔ Nostr — if you post on either, the bridge handles the other automatically. But native posts read better than bridged.
- **NIP-05 verification** — make sure the publishing npub has a NIP-05 identifier (e.g., `release@chainlesschain.com` resolved via `/.well-known/nostr.json`) for credibility.
- **Project itself supports Nostr** — this is a meta-bragging-rights moment. Consider explicitly noting: "BTW we just shipped to Nostr from a ChainlessChain client" if you publish via the project's own social stack (Nostr bridge code is in repo, BIP-340/bech32 / NIP-01/02/04 supported per the social-protocols-landing memory).

---

## Nostr — long-form (NIP-23 kind 30023) — optional alternative

If you'd rather post a single long-form article on Highlighter / Yakihonne / nostr.com long-form clients, the GitHub release body (`dist-tools/release-notes-v5.0.3.55.md`) can be reused as-is — it's NIP-23-compatible markdown.

Add this NIP-23 frontmatter:

```yaml
---
title: "ChainlessChain v5.0.3.55 — iOS Port"
summary: "Android v1.0 GA validated → iOS mirror port landed in one day. 4 phases framework-complete, ~313 unit tests."
image: https://www.chainlesschain.com/og-v5.0.3.55.png   # if you have one, else omit
published_at: 1747305846   # 2026-05-15T10:44:06Z unix
t: ["chainlesschain", "nostr", "decentralizedai", "ios", "release"]
---
```

Long-form articles are NIP-23 events (kind 30023). Highlighter (highlighter.com) and Yakihonne (yakihonne.com) are the main reader/publisher web clients; Nostr.com supports reading.

---

## Cross-platform posting matrix

| Platform | Format | Recommended length | Hashtags |
|----------|--------|--------------------|----------|
| Mastodon | 3-toot thread | 480 chars × 3 | 3-4 per toot |
| Nostr (kind 1) | Single long note | ~1800 chars | 4-6 tags |
| Nostr (kind 30023) | NIP-23 long-form | Reuse release notes | 4-6 t-tags |

---

## Single-pass distribution

If you want to fire-and-forget all decentralized channels at once:

1. Post the **Mastodon thread** from your project Mastodon account (or personal). mostr.pub bridge auto-mirrors to Nostr (kind 1).
2. Separately publish the **NIP-23 long-form** to Highlighter or Yakihonne for permanent searchable archive (reuses `release-notes-v5.0.3.55.md`).
3. ActivityPub federation handles fediverse propagation automatically once posted on Mastodon.
