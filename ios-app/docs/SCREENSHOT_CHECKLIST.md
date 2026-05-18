# iOS Screenshot Checklist — ChainlessChain

> Apple requires screenshots for **at least one display class**. For broadest reach submit the two iPhone classes (6.7" + 5.5") plus iPad if you support iPad. Up to 10 screenshots per class; 3-5 well-chosen is enough.

**Target version**: 5.0.3 (build 56)

---

## 1. Required Display Classes (as of 2026-05)

| Class | Device proxy | Portrait pixels | Required? |
|-------|--------------|----------------|-----------|
| **6.9"** (iPhone 16 Pro Max) | iPhone 15/16 Pro Max | 1320 × 2868 | Recommended (newest) |
| **6.7"** (iPhone 14/15 Pro Max) | iPhone 14/15 Pro Max | 1290 × 2796 | **Required** if you don't ship 6.9" |
| **6.5"** (iPhone 11 Pro Max / XS Max) | iPhone 11 Pro Max | 1284 × 2778 or 1242 × 2688 | Recommended legacy |
| **5.5"** (iPhone 8 Plus) | iPhone 8 Plus | 1242 × 2208 | **Required** until 2026 sunset — submit even if you don't ship to old hw |
| **iPad 13"** (iPad Pro M4) | iPad Pro 13" | 2064 × 2752 | Required only if you support iPad |
| **iPad 12.9"** (older iPad Pro) | iPad Pro 12.9" | 2048 × 2732 | Required only if iPad |

**Strategy for ChainlessChain**:
- ✅ Submit 6.7" (1290 × 2796) — covers all modern iPhone Pro Max
- ✅ Submit 5.5" (1242 × 2208) — required by Apple, "scaled down" 6.7" art is acceptable since 5.5" devices are nearly extinct
- ⏳ iPad: skip until iPad Pro layout is finalized (Info.plist supports iPad orientations, but UI is iPhone-first)

---

## 2. Asset Rules

- **Format**: PNG or JPG, no transparency, no rounded corners (Apple adds them)
- **Color space**: sRGB or P3
- **DPI**: doesn't matter; only pixel count enforced
- **Status bar**: hide via `xcrun simctl status_bar override` or include in design
- **No alpha**, **no device frame** (don't paint an iPhone bezel around your screenshot)
- **Localization**: zh-Hans set + en set (project supports both); set primary language per App Store Connect locale

---

## 3. Screenshot Slots — ChainlessChain Mapping

Pick 3-5 of these per locale. Order matters: first 3 are visible without scroll in App Store search results.

| # | Screen | Source (SwiftUI feature) | Headline (zh) | Headline (en) |
|---|--------|--------------------------|---------------|---------------|
| 1 | **AI Chat** | `Features/AI/Views/ChatView.swift` | 与本地 / 云端 AI 对话 | Chat with local + cloud AI |
| 2 | **Knowledge Base** | `Features/Knowledge/Views/...` | 你的第二大脑，端到端加密 | Your second brain, E2E encrypted |
| 3 | **DID / Identity** | `Features/Auth/Views/...` | 去中心化身份，密钥归你 | Decentralized identity, keys are yours |
| 4 | **Social / P2P Chat** | `Features/Social/Views/...` | 端到端加密的 P2P 社交 | E2E encrypted P2P social |
| 5 | **Remote Operate** | `Features/RemoteOperate/Views/RemoteOperateView.swift` | 远程操控桌面，5 个 tab | Remote control your desktop |
| 6 | **Remote Terminal** | `Features/RemoteTerminal/Views/...` | 手机里的桌面终端 | Desktop terminal in your pocket |
| 7 | **Pairing (QR)** | `Features/Pairing/Views/...` | 扫码配对，无需服务器 | QR pair, no server in between |
| 8 | **Settings / Privacy** | `Features/Settings/Views/...` | 数据归你，导出/删除随时 | Your data, your control |

**Recommended order for v5.0.3 launch**: 1 → 2 → 5 → 4 → 3 (lead with AI hook, anchor with KB, then differentiators).

---

## 4. Capture Workflow

### Option A: Simulator (faster, current)

```bash
# 1. Launch the desired simulator
xcrun simctl boot "iPhone 15 Pro Max"
open -a Simulator

# 2. Build & install
cd ios-app
xcodebuild -scheme ChainlessChain -destination "platform=iOS Simulator,name=iPhone 15 Pro Max" -derivedDataPath build install

# 3. Apply demo status bar (full bars, no clutter)
xcrun simctl status_bar "iPhone 15 Pro Max" override \
  --time "9:41" \
  --dataNetwork wifi \
  --wifiBars 3 \
  --batteryState charged \
  --batteryLevel 100

# 4. Navigate to the target screen, then capture
xcrun simctl io "iPhone 15 Pro Max" screenshot ~/Desktop/cc-shot-01.png

# 5. Reset
xcrun simctl status_bar "iPhone 15 Pro Max" clear
```

### Option B: Real device (highest fidelity)

- Xcode → Window → Devices and Simulators → Take Screenshot
- Requires the device, but produces real text rendering and font metrics

### Option C: Automation (`fastlane snapshot`)

If you want reproducible per-locale screenshots, set up `fastlane snapshot`:

```bash
cd ios-app
fastlane snapshot init
# Edit Snapfile to set devices + languages
fastlane snapshot
```

Currently **not wired** — set up only if you need to regenerate for every release.

---

## 5. Pre-submission Checklist

- [ ] 6.7" PNG × 5 in zh-Hans
- [ ] 6.7" PNG × 5 in en
- [ ] 5.5" PNG × 5 in zh-Hans (can be downsampled from 6.7" via `sips -z 2208 1242 in.png`)
- [ ] 5.5" PNG × 5 in en
- [ ] No private data visible (DIDs, mnemonics, real contact names, IP addresses)
  - **Mnemonic words**: never appear in screenshots
  - **DID strings**: use synthetic prefix `did:cc:demo-...`
  - **Friend names**: use placeholders like "Alice", "Bob", "知识助手"
- [ ] Status bar shows 9:41 / WiFi / charged (App Store convention)
- [ ] No watermarks, no "DRAFT", no Xcode launch screen
- [ ] If marketplace / wallet screens are included: no real balances, no real ticker prices
- [ ] Filenames follow `cc-{class}-{locale}-{nn}-{slug}.png`, e.g.
      `cc-67-zh-01-ai-chat.png`, `cc-67-en-02-knowledge-base.png`
- [ ] Stored at `ios-app/store-assets/screenshots/v5.0.3/` (create directory on first capture)

---

## 6. App Preview Video (optional, 15-30s)

If submitting a preview video:
- 6.7": 1080 × 1920 or 1080 × 2340, .mov/.mp4
- Max 30 seconds, no music with unlicensed audio
- Captured from real device or simulator; no Mac UI in frame

Skip for v5.0.3 launch; add in v5.0.4+ if conversion data warrants.
