# Twitter/X thread — v5.0.3.56 announcement

Angle: CI engineering hygiene — caught 8 false-success CI commits + opened door to real iOS build
Length: 5 tweets · all ≤ 280 chars (URLs auto-shortened to 23 via t.co)
Tone: technical, paradox-as-hook, no marketing fluff, no rage

---

## 1/5 — Hook (paradox)

```
🛠 ChainlessChain v5.0.3.56 ships.

Maintenance release with an interesting confession: 8 prior commits showed iOS CI ✅, but never actually compiled.

Double-layer mask did it.
  Layer 1: continue-on-error (job-level)
  Layer 2: xcodebuild | xcpretty || true (pipe)

20 iter to dig out. 🧵
```
~275 chars

## 2/5 — The fix chain

```
The unmask path:

✅ Lifted both mask layers
✅ Pivoted to native `swift build --target CoreP2P` — xcodebuild + Package.swift CLI auto-detect is fragile
✅ Wired 5 local SPM products into .xcodeproj via Ruby xcodeproj gem (CI script, not Xcode UI)
✅ Restored Data.bytes ext + 4 missing crypto types
```
~275 chars

## 3/5 — Honest disclosure

```
Honest disclosure:

Phase 1-5 SPM modules now truly compile every push. First "real green" CI run: 25923999179.

But the app target itself = 412 compile errors across 30+ files.

Pre-Phase-1-5 scaffold debt: missing ViewModels, iOS 15 vs 16/17 API gaps, SyncStatus duplicates, Logger API mismatch.

Real .ipa skipped this release.
```
~280 chars

## 4/5 — Lessons doc

```
Lessons captured in repo memory:

• feedback_ios_swift_spm_ci_traps.md — 4 SPM/xcodebuild traps including the misleading "/Package.swift cannot be accessed" red herring (real cause: upstream dep repo has no Package.swift)
• gitignore_models_unanchored_trap.md — case-insensitive subdir trap

Same pattern, two infras.
```
~265 chars

## 5/5 — Closer

```
Open-source. Decentralized personal AI on hardware-level security (U-Key / SIMKey).

🖥 Win/macOS/Linux + Android: github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
⌨️ CLI: npm i -g chainlesschain → 0.162.0

📖 docs.chainlesschain.com
🎨 design.chainlesschain.com
```
~265 chars (URLs → 23 via t.co)

---

## Notes for posting

- **Lead with the paradox** — "8 commits looked green but never compiled" is the unique angle that pays attention. Don't dilute with "we shipped X feature" framing.
- **Tweet 3 is the credibility tweet** — admitting 412 errors openly builds trust more than hiding them. The fact that a maintenance release announces this *is* the announcement.
- **Tweet 4 is the most retweetable** — devs save memory file pointers because pattern (mask hides failure) recurs everywhere. Highlight this in a quote-RT 24-48h later if engagement is good.
- **Avoid hashtag chains** — tech audience finds via timeline and reply graph. Optional: one `#CI` or `#OpenSource` on tweet 5.
- **Times to post** (per X analytics, technical content):
  - Asia/CN: 09:00–11:00 CST (workday morning)
  - US: 09:00–11:00 ET or 14:00–16:00 ET
  - Post the whole thread in a single burst, not spread over hours.
- **Reply preparation**: if someone asks "how did you not notice?" — your honest answer is "we noticed; that's why we wrote down what we saw". Point at memory files. Don't get defensive about the 8 commits — that *is* the credibility.

## What NOT to do

- ❌ Don't position this as "iOS is back!" — app target is still 412 errors away. Mis-framing creates expectations you can't meet next release.
- ❌ Don't combine with v5.0.3.55 announcement. That was a feature release with different angle. This one is *about* the CI lie + the cleanup.
- ❌ Don't run X Premium polls/space asking "should we keep the masks?" — the answer is already in code. Stick to declarative posture.

## zh-CN variant?

Yes, see `weibo-post-v5.0.3.56.md` — same structure, idiomatic phrasing, slightly different emphasis (中文 audience cares more about "工程债 + 收口 story" than "false success exposure").
