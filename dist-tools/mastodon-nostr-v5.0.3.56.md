# Mastodon + Nostr drafts — v5.0.3.56 announcement

Target audience: privacy-friendly, decentralization-leaning, dev/engineering folks who appreciate **engineering hygiene** and **honest project posture**.
Angle: CI engineering — caught 8 false-success commits, fixed double-layer mask, opened the door to real iOS app build.
Meta-angle: maintenance release that's worth talking about *because* it admits prior CI was a lie.

---

## Mastodon — 3-toot thread (≤ 500 chars each, default instance cap)

### Toot 1/3 — Hook

```
🛠 ChainlessChain v5.0.3.56 ships.

Maintenance release, but interesting one: we caught 8 prior commits where iOS CI showed "success" — but never actually compiled.

Double-layer mask did it:
1️⃣ continue-on-error: true (job-level)
2️⃣ `xcodebuild | xcpretty || true` (pipe-level)

Both layers swallowed real failures into green checkmarks.

20 iter overnight to dig out. Now SPM Phase 1-5 truly compiles on every push.

🧵 1/3

#CI #OpenSource #DevHonesty
```
~470 chars

### Toot 2/3 — What we fixed + what we found

```
The 20-iter unmask chain:

✅ Lifted `continue-on-error` + `|| true` from build steps
✅ Pivoted to native `swift build --target CoreP2P` (xcodebuild + Package.swift CLI is a maze)
✅ Wired 5 local SPM products into .xcodeproj programmatically (script, not Xcode UI)
✅ Restored Data.bytes ext, SecKey force-cast, 4 missing crypto types

But honest truth: app target itself = **412 compile errors** across 30+ files. Pre-Phase-1-5 scaffold debt. Real iOS .ipa skipped this release.

2/3
```
~485 chars

### Toot 3/3 — Decentralization + downloads

```
Open-source. Decentralized personal AI on hardware-level security (U-Key / SIMKey). Knowledge · Social · Trading.

🖥 Win/macOS/Linux: github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
📱 Android: 4 ABI variants on the same release
⌨️ CLI: npm i -g chainlesschain → 0.162.0

The CI lessons:
📖 docs.chainlesschain.com/changelog
🎨 design.chainlesschain.com

#ChainlessChain #PrivacyTech
```
~365 chars

---

## Nostr — single-note variant (no thread, ≤ 2000 chars typical Damus/Amethyst)

```
🛠 ChainlessChain v5.0.3.56 — maintenance release worth talking about.

We caught 8 prior commits where iOS GitHub Actions showed "success" — but never actually compiled. Double-layer mask hid the failures:

1) Job-level `continue-on-error: true` (Stage 1 development comment lied across 8 releases)
2) Pipe-level `xcodebuild | xcpretty || true` (pipe replaces xcodebuild's exit code with xcpretty's 0)

20 iter overnight to dig out. Headline outcomes:

✅ Both mask layers removed
✅ Pivoted to native `swift build --target CoreP2P` (xcodebuild + Package.swift CLI auto-detect is fragile)
✅ 5 local SPM products wired into .xcodeproj programmatically (Ruby xcodeproj gem script, runs in CI — Xcode UI not required)
✅ Restored Data.bytes extension, SecKey force-cast, 4 missing crypto types (Ed25519/Ed25519KeyPair/Base58/DIDIdentity)
✅ Cleaned 3 dead Package.swift dependencies (CoreBlockchain dir never existed; sqlcipher repo has no Package.swift; libsignal has Swift bindings under swift/ subdir not root)
✅ `.gitignore models/` → `/models/` anchor — un-hid 7 silent-ignored Swift files

Honest disclosure: app target xcodebuild build still has **412 compile errors** across 30+ files (pre-Phase-1-5 scaffold debt). Real iOS .ipa skipped this release. Roadmap doc in repo for what it takes (4-level estimate from 30min to 1-2 weeks).

🖥 Releases: github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
📖 docs.chainlesschain.com/changelog
🎨 design.chainlesschain.com — iOS Phase 1-5 design docs

#ChainlessChain #DecentralizedAI #PrivacyTech #OpenSource #CICD
```
~1750 chars

---

## Notes for posting

- **Mastodon thread**: post toots in burst with 2-3s pauses (script `dist-tools/post-mastodon-thread-v5.0.3.56.sh` if we write it). Each toot replies-to the previous one.
- **Tone calibration**: this is *not* a feature release. Most Mastodon users on fosstodon.org / mastodon.social tech instances will appreciate the honesty more than they would yet another "we shipped X" announcement. Lead with the false-success angle — it's the unique value.
- **Hashtag policy**: Mastodon DOES surface hashtags (Federation timeline). `#CI #OpenSource #DevHonesty` for thread 1 is fine. Nostr ignores hashtags but doesn't penalize them; safe to include.
- **Reply hooks**: people will likely ask "how did you not notice for 8 commits?" — point at the memory file `feedback_continue_on_error_silent_regression.md` (already exists for desktop e2e false-success case) + new `feedback_ios_swift_spm_ci_traps.md` (this session). The pattern matters: the same memory came up before in a different test infra.
- **Timing**:
  - Asia: 21:00–23:00 CST (decentralized social peaks in CN evening)
  - EU/US: 14:00–16:00 ET (covers Atlantic + US East/Central morning)

## Don't write a 3-toot thread because…

If on reflection the team prefers a single statement (less performative for a maintenance release): use the **Nostr single-note variant** verbatim on Mastodon too — Mastodon also supports 500+ char posts on instances with raised limits, but for 500-char default a 2-toot version is cleaner:

```
Toot 1: Toot 1 above (hook)
Toot 2: combined Toot 2 + Toot 3
```

User choice.
