# ChainlessChain v5.0.3.55 — iOS 端镜像移植 / iOS port mirror

> **TL;DR**: Android v1.0 GA validated → iOS port begins. All 4 phases landed framework-complete in one day. ~313 unit tests. Awaits Mac+iPhone+desktop real-device E2E. + `cc pair` Linux pairing CLI + cross-chain multisig provenance + Wear→phone voice forward + 2 P0 leak fixes.

---

## 🎯 iOS port — Phase 1+2+3+4 framework complete

After Android v1.0 GA was validated, the iOS mirror port kicked off. All 4 phases landed framework-complete in a single day, mirroring 1+ year of Android mobile capability (QR pairing / remote terminal / remote-operate framework / Notification skill) onto iOS with UI information architecture 1:1 aligned to the already-validated Android Kt screens.

| Phase | Scope | Tests | Commit |
|-------|-------|------:|--------|
| **1** | Desktop pairing — Flow A (camera scans desktop QR) / Flow B (desktop displays QR for phone) / Manual 6-digit code | 71 | `c30b415a8` |
| **2** | Remote desktop terminal — WebRTC DataChannel + xterm.js WKWebView + 6-method RPC | 163 | `7613ea710` |
| **3** | Remote-operate framework — `RemoteCommandClient` generic RPC + `OfflineQueue` + 4 typed skills (Clipboard / File / Screenshot / SystemInfo) | ~264 | `759a1e907` |
| **4** | Notification skill — `NotificationCommands` actor (11 methods) + LRU dedup 256 + UN center push + optimistic update + offline gate + horizontal-scroll picker + Capsule unread badge | ~313 | `45b485fdd` → `5877b5d84` |

**Real-device E2E** (Phase 1.7 / 2.7 / 3.7 / 4.7) requires Mac + iPhone + real desktop and is handed to user — design docs include the full acceptance matrix.

**Design docs**:
- [iOS Phase 1 Pairing Flow B](https://design.chainlesschain.com/iOS_Phase_1_Pairing_Flow_B.html)
- [iOS Phase 2 Remote Terminal](https://design.chainlesschain.com/iOS_Phase_2_Remote_Terminal.html)
- [iOS Phase 3 Remote Operate Framework](https://design.chainlesschain.com/iOS_Phase_3_Remote_Operate_Framework.html)
- [iOS Phase 4 Notification Skill](https://design.chainlesschain.com/iOS_Phase_4_Notification_Skill.html)

## 🔧 Continuation-leak P0 fixes (2026-05-15 code review)

- `RemoteCommandClient.invoke` — `withThrowingTaskGroup` timeout path didn't auto-resume pooled continuations; long-running sessions leaked `pendingResponses`. Fixed with explicit `do/catch` + `pendingResponses.removeValue(forKey:)?.resume(throwing:)`.
- `RemoteWebRTCClient.waitForAnswer` — `pendingAnswer` not cleared on timeout; next `connect()` collided with the residual continuation. Same shape fix + `hasPendingAnswer()` diagnostic accessor.
- 2 regression tests + 1 integration test verify pools are clean across timeout→immediate-retry sequences.

## 📦 #21 P1 main scope 5/5 fully closed

Android GA after-work scope, one-day landing:

- **A.1** Linux native pairing — `cc pair preflight` (5-item LAN diagnostics: platform / NIC / multicast / port 5353 holders / firewall, exit 0/1/2 CI-grade) + `cc pair token` (generate/list/show/revoke, one-active-DID + atomic write, SSH dev-box scenario) + `systemd` hardening template + [docs/linux/PAIRING.md](https://docs.chainlesschain.com/) 9-section guide. **57 unit tests.**
- **A.2** Three-platform UI consistency design doc v0.1 — 4 must-match items (semantic colors / risk red hex / DID short-display rule 6+4 / m-of-n progress display) + 4 must-differ items (watch ≥48dp / desktop sidebar / car voice-only / phone thumb-zone).
- **B.1** Web-shell private-key signing UI — `MultisigSigner` + in-process WS topic bypassing 6-10s cold start + `SignProposalModal` + unified-key-manager DID routing. **113 unit tests.**
- **B.5** Cross-chain bridge outbound × m-of-n multisig (Layer 1+2, 8 PRs) — CLI `bridge --require-multisig` + `bridge-consume` + `cc_bridges` provenance columns + `crosschain-mtc` helpers + `verifyMultiHopBridgeEnvelope` auto-runs check.
- **C.1** Watch face VoiceMode shortcut — phone NavGraph + wear MessageClient forward + `trigger_source` locked to `WEAR_FORWARD` (anti-spoof, prevents wear-side privilege escalation). **33 unit tests.**

## 🛠️ CLI 0.162.0 (npm)

```bash
npm install -g chainlesschain   # → 0.162.0
cc pair preflight               # NEW — LAN diagnostics (Linux pairing scenarios)
cc pair token generate          # NEW — issue pairing token (SSH dev-box, headless)
cc pair token list / show / revoke
```

## 📥 Downloads

| Platform | File | Size |
|----------|------|-----:|
| **Windows** | [ChainlessChain-Setup-5.0.3-alpha.55.exe](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/ChainlessChain-Setup-5.0.3-alpha.55.exe) | 451 MB |
| Windows portable | [ChainlessChain-Portable-5.0.3-alpha.55.exe](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/ChainlessChain-Portable-5.0.3-alpha.55.exe) | 451 MB |
| **macOS (Apple Silicon)** | [ChainlessChain-5.0.3-alpha.55-arm64.dmg](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/ChainlessChain-5.0.3-alpha.55-arm64.dmg) | 468 MB |
| macOS (Intel) | [ChainlessChain-5.0.3-alpha.55.dmg](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/ChainlessChain-5.0.3-alpha.55.dmg) | 474 MB |
| Linux AppImage | [ChainlessChain-5.0.3-alpha.55.AppImage](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/ChainlessChain-5.0.3-alpha.55.AppImage) | 680 MB |
| Linux .deb | [chainlesschain-desktop-vue_5.0.3-alpha.55_amd64.deb](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/chainlesschain-desktop-vue_5.0.3-alpha.55_amd64.deb) | 351 MB |
| Linux .rpm | [chainlesschain-desktop-vue-5.0.3-alpha.55.x86_64.rpm](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/chainlesschain-desktop-vue-5.0.3-alpha.55.x86_64.rpm) | 352 MB |
| **Android arm64** | [app-arm64-v8a-release.apk](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/app-arm64-v8a-release.apk) | 82 MB |
| Android armv7 | [app-armeabi-v7a-release.apk](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/app-armeabi-v7a-release.apk) | 59 MB |
| Android universal | [app-universal-release.apk](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/app-universal-release.apk) | 124 MB |
| Android AAB (Play) | [app-release.aab](https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.55/app-release.aab) | 71 MB |
| **iOS** | placeholder — real iOS build pipeline pending | 2 KB |

## 🔗 Links

- **CHANGELOG**: https://github.com/chainlesschain/chainlesschain/blob/main/CHANGELOG.md
- **User docs**: https://docs.chainlesschain.com/
- **Design docs**: https://design.chainlesschain.com/
- **Official site**: https://www.chainlesschain.com/

## 🤝 Acknowledgements

iOS port mirrors Android version already real-device E2E validated on Xiaomi 24115RA8EC × Windows git-bash. Plan A.1 design (`docs/design/Android_Remote_Terminal_Plan_A1.md`) and the `feedback_ios_ui_mirrors_validated_android` rule (UI information architecture must mirror real-device-validated Android Kt screens, HIG deviation limited to 6-item whitelist) made this 4-phase one-day mirror feasible.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
