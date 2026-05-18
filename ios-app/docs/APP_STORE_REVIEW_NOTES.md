# App Store Review Notes — ChainlessChain

> Template for filling in App Store Connect → App Information → "App Review Information". Update before each submission.

**Last updated**: 2026-05-16
**Target version**: 5.0.3 (build 56)

---

## 1. Sign-In Information (Demo Account)

ChainlessChain uses **Decentralized Identifiers (DID)** instead of phone/email login. No traditional account is required.

**For Apple reviewer**:

```
First-launch flow:
  1. Tap "创建身份 / Create Identity" on the welcome screen.
  2. The app generates a DID locally (Ed25519 + SLH-DSA hybrid key).
     A 12-word mnemonic is shown — reviewer may tap "Skip Backup" to proceed.
  3. The app enters the main UI without any further sign-in.

No internet connectivity is strictly required to launch.
No demo username/password is needed.
```

If the reviewer needs to test **paired desktop features** (远程操控 / Remote Operate, 远程终端 / Remote Terminal):

- A pre-paired desktop environment will be active at IP/Tailscale URL on file
  (provide bridge URL in submission if available)
- Or, request reviewer to skip these tabs — they degrade gracefully to an
  empty state when no pairing exists.

---

## 2. Contact Information

| Field | Value |
|-------|-------|
| First name | _(submitter)_ |
| Last name | _(submitter)_ |
| Email | review@chainlesschain.com _(create before submission)_ |
| Phone | +86 400-1068-687 |

---

## 3. Notes for Reviewer

```
ChainlessChain is a decentralized personal AI management app built on
P2P end-to-end encryption. Three key things the reviewer should know:

1. NO SERVER LOGIN
   User identity is a DID (Decentralized Identifier) generated locally.
   No phone number, email, or password is required. This is by design,
   not an omission. Mnemonic backup is offered but skippable for review.

2. AI FEATURES ARE OPTIONAL AND USER-CONFIGURED
   The app ships with no built-in LLM. Users may optionally configure
   external services (OpenAI, Anthropic, Volcengine, local Ollama, etc.).
   Without configuration, the AI chat tab will show a setup prompt rather
   than fail. The reviewer is not expected to configure any LLM to evaluate
   core functionality (knowledge base, social, identity, settings).

3. P2P / REMOTE FEATURES REQUIRE A SECOND DEVICE
   The 远程操控 / Remote Operate tab and 远程终端 / Remote Terminal tab
   require a paired ChainlessChain desktop client. On a fresh install with
   no pairing, these tabs show a "Pair a device" empty state — this is
   correct behavior. The reviewer may safely skip these tabs.

PRIVACY:
   All user content (notes, messages, identity keys) is stored on-device
   in a SQLCipher-encrypted database. P2P messages use the Signal Protocol
   for end-to-end encryption. The app does not transmit user content to
   our servers. See PRIVACY_POLICY.md for details.

EXPORT COMPLIANCE:
   Set ITSAppUsesNonExemptEncryption=false per EAR 5D002.c.1 (end-to-end
   user content encryption + authentication + digital signatures only,
   no government bypass, no third-party encryption service).
```

---

## 4. Sensitive Capabilities — Justification Crib Sheet

If asked about specific permissions:

| Permission | Used For |
|-----------|----------|
| `NSCameraUsageDescription` | QR code scanning (device pairing, friend add) + optional photo capture for knowledge base |
| `NSPhotoLibraryUsageDescription` | User chooses photos to attach to notes or messages |
| `NSMicrophoneUsageDescription` | Voice message recording in P2P chat |
| `NSSpeechRecognitionUsageDescription` | Optional voice → text in chat (uses on-device recognition on iOS 13+; older devices fall back to Apple servers per Apple's policy) |
| `NSFaceIDUsageDescription` | Optional biometric unlock for app and DID keychain access |
| `NSLocalNetworkUsageDescription` + Bonjour `_chainlesschain._tcp` | Local LAN P2P device discovery (e.g., desktop on same WiFi). Does not transmit user content unencrypted. |

---

## 5. Common Rejection Triggers — Pre-flight Defense

**5.1.1 Privacy / Data Use**:
  - Privacy policy URL filled and reachable: https://chainlesschain.com/privacy
  - In-app privacy summary shown on first launch (Settings → Privacy)
  - No data collected without active user action

**4.2 Minimum Functionality**:
  - App provides standalone value (knowledge management, identity, encrypted notes)
  - Not merely a web view wrapper — native SwiftUI throughout, with native modules
    for P2P, crypto, persistence

**3.1.5(b) Cryptocurrencies**:
  - If marketplace / trading features are enabled in the submitted build,
    they handle user-held assets via DID wallet (custody by user, not by us)
  - No in-app cryptocurrency purchases via IAP (would require dedicated review)
  - **If submitting a build with these features disabled by feature flag,
    note that here so reviewer does not look for them.**

**5.1.2(i) AI-generated content**:
  - AI outputs are clearly labeled as AI-generated (avatar + "AI" tag in chat)
  - No human impersonation
  - Disclaimer shown in AI settings before first use

**2.5.4 VoIP / background**:
  - If Background Modes → Voice over IP is enabled, justify here.
    Currently only "Remote notifications" and "Background fetch" are needed.

---

## 6. Build-Specific Notes (fill in per submission)

```
Build: 5.0.3 (56)
Submission date: 2026-MM-DD
Headline changes from previous review:
  - <e.g. "Added Remote Notifications skill (Phase 4)">
  - <e.g. "Bumped from 0.36 to 5.0.3 to align with product line">

Known issues acknowledged by team (not blockers):
  - <e.g. "Desktop pairing flow B requires desktop v5.0.3.50+">

Feature flags enabled in this build:
  - <e.g. "marketplace=false (trading features hidden)">
  - <e.g. "ai.chat=true (LLM tab visible)">
```

---

## 7. Contact Path if Rejected

1. Read full rejection in App Store Connect → Resolution Center
2. If the issue is a misunderstanding of P2P/DID model: reply with the
   "NO SERVER LOGIN" / "P2P FEATURES REQUIRE..." paragraphs from §3 above
3. If a 5.1 / 5.2 / 3.1 hard rejection: escalate to legal counsel before
   replying; do not concede broad policy changes informally
4. Track each rejection + resolution in `docs/releases/ios-rejection-log.md`
   (create on first occurrence)
