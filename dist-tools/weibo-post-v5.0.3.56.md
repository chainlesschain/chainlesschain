# 中文社交平台文案 — v5.0.3.56 发版

目标平台：微博 / 即刻 / V2EX / 少数派 / SegmentFault / 公众号摘要
角度：CI 工程透明 — 揭穿 8 个假绿 commit + 打开真 iOS 编译之门
基调：技术诚实、不打鸡血、不堆 emoji、不打官腔

---

## 微博版（≤ 2000 字单条；目标 ~700 字）

```
🛠 ChainlessChain v5.0.3.56 发布 — 维护版本，但值得讲一下。

这一版主要工作是修 iOS CI 的「假绿」问题：之前 8 个 commit 在 GitHub Actions 里全部显示 ✅，但其实从未真编译过。罪魁是双层 mask：

1️⃣ Job 级 `continue-on-error: true` (注释里写 "Stage 1 development"，结果谎了 8 个 release)
2️⃣ Step 级 `xcodebuild | xcpretty || true` (pipe 让 xpretty 的 exit code 0 取代 xcodebuild 的真失败)

一晚 20 iter 收口。主要修复：
✅ 双层 mask 全拔
✅ 改用 native `swift build --target CoreP2P`（绕开 xcodebuild + Package.swift CLI 不可靠的坑）
✅ 程序化把 5 个本地 SPM library wire 进 .xcodeproj（Ruby xcodeproj gem 脚本，CI 跑，不需要 Mac Xcode UI）
✅ 补 4 个缺失 crypto 类型（Ed25519/Base58/DIDIdentity）+ Data.bytes ext + SecKey force-cast
✅ 清 3 个 dead Package.swift dep（CoreBlockchain 目录从未创建 / sqlcipher repo 没 Package.swift / libsignal 的 Swift bindings 在 swift/ 子目录不在 root）
✅ `.gitignore models/` → `/models/` anchor — 解屏蔽 7 个 silent 隐藏的 iOS Swift 文件

诚实披露：iOS app target 自己还有 412 个 pre-Phase-1-5 编译错（缺 ViewModel/Model/Entity ~150 个 + iOS 15 vs 16/17 API 兼容性 + SyncStatus 歧义 + Logger.configure API mismatch 等）。这一版 iOS .ipa 安装包暂跳过 — repo 里写了 4 级修复 roadmap (`memory/ios_app_target_compile_state.md`)。

下载：
🖥️ Win / macOS / Linux + Android 4 ABI：https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
⌨️ CLI: npm i -g chainlesschain → 0.162.0

文档：
📖 https://docs.chainlesschain.com/changelog.html
🎨 https://design.chainlesschain.com

去中心化个人 AI 系统，U盾 / SIMKey 硬件级安全。

#CI #开源 #工程透明
```

字数 ~720。微博放得下。

---

## 即刻版（≤ 1000 字；600 字以内更舒服）

即刻用户喜欢「过程感」+「自我反省」，特别适合这种「我们之前自己都没发现」的话题：

```
v5.0.3.56 发版 — 这一版没有新功能，主要是把 iOS CI 的「假绿」问题修了。

之前的 8 个 Phase 1-5 commit 在 GitHub Actions 都显示 ✅ pass，但前几天才发现：从来就没有真编译过。罪魁是双层 mask：

1) Job-level `continue-on-error: true` —— 注释里写 "Stage 1: allow failures during early development"，结果这个 "Stage 1" 跨了 8 个 release 都没去掉
2) Step-level `xcodebuild | xcpretty || true` —— pipe 让 xcpretty 的 exit code 0 取代了 xcodebuild 的真失败

一晚 20 iter 拔 mask + 修 SPM 路径 + 补缺失类型 + 清 dead dependencies。最后 Phase 1-5 CoreP2P 模块第一次真编绿（run 25923999179）。

但更尴尬的发现：iOS app target 自己还有 412 个 pre-Phase-1-5 老编译错。这些错误一直存在，被 stale pbxproj 错误 path + 双层 mask 联手藏了几年。这一版老老实实承认 — 暂不产 .ipa，repo 里写了 4 级修复 roadmap（极轻 30min 到极重 1-2 周）。

讲这个的核心不是「我们 CI 之前出 bug 了」（每个 CI 都有 bug），而是 mask 这种东西一旦写进 workflow 文件就极容易被忘掉。这次的教训 + memory 文件已经入 repo（memory/feedback_ios_swift_spm_ci_traps.md），如果你也维护一个 GHA workflow 跑 xcodebuild，可以瞄一眼这 4 个 trap。

下载：
github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
```

字数 ~530。

---

## V2EX 版（节点 `/go/share` 或 `/go/programmer`）

V2EX 用户喜欢「实战复盘 + 自我吐槽」结构。这一版本天然适配：

**标题**：`[发版] ChainlessChain v5.0.3.56 — 修 8 个假绿 CI commit + 真 iOS 编译初验证`

**正文**：

```
项目简介：去中心化个人 AI 管理系统。U盾/SIMKey 硬件级加密 + 本地 Ollama + 端到端 P2P，整合知识库、社交、交易。Electron + Vue3 桌面 + Android 原生 + iOS。仓库：https://github.com/chainlesschain/chainlesschain

v5.0.3.56 主要内容：CI 工程债收口，不是 feature release。

# 起因：8 个 commit 假绿了

前两周 iOS Phase 1-5 移植（v5.0.3.55）每次 commit GitHub Actions 都显示 ✅ Build & Test (iOS) success。前几天回头看 log 才发现：从来就没真编译过。罪魁是双层 mask：

1. Job-level `continue-on-error: true` — workflow yaml 注释写 "Stage 1: Allow failures during early development"，结果"Stage 1"在不知不觉间跨了 8 个 release。
2. Step-level `xcodebuild | xcpretty || true` + `xcodebuild | xcpretty || echo "..."` — pipe 让 xcpretty 的 exit code 0 取代 xcodebuild 真失败的 exit code，加上后置 `|| true` 双保险。

两层 mask 联手让 build step 永远 exit 0，job conclusion 永远 success。

# 20 iter 收口

一晚 20 iter，错误层层暴露：

1. 拔 mask → device mismatch（destination 写死 iPhone 15 Pro，但 runner 装的是 iPhone 16 Pro）
2. 改 generic destination + 加 simulator picker → 25 个 broken file ref（pbxproj path 形如 `path = X.swift; sourceTree = "<group>"` 但 group 链没设 path 属性，xcodebuild 落到 ios-app/X.swift 找不到）
3. 修 pbxproj 25 ref 加完整路径 → 残留 2 untracked Swift 文件
4. `.gitignore models/` → `/models/` anchor + 补 2 文件 → SPM module 缺 wiring 暴露
5. workflow 改 swift CLI → `xcodebuild + Package.swift` CLI auto-detect 误判 `/Package.swift`
6-8. 多种姿势尝试用 `.swiftpm/xcode/package.xcworkspace` 给 xcodebuild 喂 SPM，全失败
9. workflow 整体改 native `swift build` → CoreBlockchain target 目录不存在
10. 删 CoreBlockchain → sqlcipher repo 没 Package.swift
11. 删 CoreDatabase+sqlcipher → libsignal repo 没 root Package.swift
12. 删 libsignal dep → CoreP2P 3 个 Phase 1-5 真 Swift bug
13. 修 3 bug → CoreSecurity .bytes ext + SecKey downcast warning-as-error
14. 加 Data.bytes ext + as! SecKey → CoreDID 4 个缺失类型（DIDIdentity/Ed25519/Ed25519KeyPair/Base58）
15. 补 4 类型 + 1 stub property → swift build --product 不限定 build graph 仍编整个 package
16. 改 swift build --target CoreP2P → ✅ Phase 1-5 真编绿（run 25923999179）

完整 commit 链：`e000057e9..741287309` 16 个 fix commit。然后又 4 个 commit 处理：
17. 程序化接 .xcodeproj SPM wiring（`ios-app/scripts/wire_spm_packages.rb` + manual-dispatch workflow）
18. 第一次跑 app target xcodebuild 真编 → 412 错（CoreDatabase DAO/CoreDID/AppState/Features/* 全暴露）
19. 决定 SPM-only fallback 让 release 不阻塞
20. v5.0.3.56 tag → 全 11 step release flow 绿 → 3 doc 站 deploy

# 关键发现：误导性错误信息

最浪费时间的是 `the package manifest at '/Package.swift' cannot be accessed` 这条错误信息，看起来像路径解析问题，实际意思是上游 dep repo 根目录没有 Package.swift（sqlcipher / libsignal 都是 C/Rust 项目，Swift bindings 在子目录）。这条错误**不指明**是哪个 dep 出问题，要在完整 log 里找 `Computing version for <url>` 后第一条 error 才能定位。

被这条信息带歪 8 轮 iter，全在 workspace/xcodeproj 上瞎搞。如果你也维护 SPM CI，这个坑 memory 里有：`feedback_ios_swift_spm_ci_traps.md`。

# 诚实披露：app target 还有 412 错

iOS app target 第一次真编暴露 412 错跨 30+ 文件，是 Phase 1-5 之前的 scaffold 残骸 + 半实现代码 + iOS 15 vs 16/17 API 兼容性。已经写下 4 级修复 roadmap（极轻 30min 到极重 1-2 周）。这一版 iOS .ipa 暂不出 —— `release.yml` build-ios job 临时退回 SPM-only 路径 (commit `faa8e267f`)，让整体 release 不被这 412 错卡死。

# 同批

无新 feature。CLI 0.162.0 不动（npm publish 智能跳过 already_published）。3 个 doc 站同步 deploy。

# 下载

- Win/macOS/Linux + Android 4 ABI：github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.56
- CLI：npm i -g chainlesschain → 0.162.0
- 文档：docs.chainlesschain.com / design.chainlesschain.com

# 自我吐槽

iOS app target 那 412 错本来 Phase 1-5 时代就该暴露，不该藏到现在。但反过来想——如果不是 v5.0.3.56 把双层 mask 拔了，这 412 错可能再藏几年。CI mask 一旦写进 workflow 文件就极容易被忘掉，注释里那句 "Stage 1: Allow failures during early development" 是经典的 "TODO that becomes permanent" 范例。
```

字数 ~1900，V2EX 长贴正常。

---

## 少数派 / SegmentFault 摘要（投稿摘要 ≤ 200 字）

```
ChainlessChain v5.0.3.56 维护版发布。本期主要修 iOS CI 的"假绿"问题——之前 8 个 commit 在 GitHub Actions 显示 success 但从未真编译过，罪魁是 job-level `continue-on-error` + step-level `xcodebuild | xcpretty || true` 双层 mask。一晚 20 iter 拔 mask + 改 swift build native 路径 + 程序化接 .xcodeproj SPM wiring + 补缺失类型 + 清 dead dependencies，Phase 1-5 CoreP2P 模块第一次真编绿。诚实披露 app target 自身仍有 412 个 pre-Phase-1-5 编译错，本版本暂不产 iOS .ipa 安装包。CI 经验已沉淀进 repo memory 供参考。
```

字数 ~225。

---

## 公众号摘要（≤ 64 字标题 + ≤ 120 字摘要）

**标题候选**：
- `ChainlessChain v5.0.3.56 — 拔 iOS CI 双层 mask，揭穿 8 个假绿 commit`（27 字）
- `维护版本也值得写：8 个 CI 假绿 commit 的复盘`（22 字）
- `工程透明：v5.0.3.56 没有 feature，只有诚实`（21 字，最克制）

**摘要候选**（取一）：
- `本期发版无新 feature，主要修 iOS GitHub Actions 的"假绿"问题。之前 8 个 commit 显示 success 但从未真编译过，被 `continue-on-error` 和 `|| true` 双层 mask 联手藏起。一晚 20 iter 收口，Phase 1-5 模块第一次真编绿。app target 自身的 412 个老编译错诚实披露，本版本 iOS .ipa 暂跳过。`（130 字）

---

## 选择建议

| 平台 | 推荐文案 | 投放时间（北京时间） |
|------|----------|------|
| 微博 | 微博版 | 工作日 12:00 / 21:00 |
| 即刻 | 即刻版（最适合该故事调） | 工作日 09:00 / 22:00 |
| V2EX | V2EX 版（长贴技术细节够厚） | 工作日 10:00-11:00 |
| 少数派 / SegmentFault | 摘要版 | 投稿走编辑流程 |
| 公众号 | 摘要 + 重定向 GitHub Release | 工作日 18:00-21:00 |

---

## 对比 v5.0.3.55 文案

| 版本 | 角度 | 受众情绪 |
|------|------|----------|
| v5.0.3.55 | iOS Phase 1-5 4 个 framework 移植落地 | 兴奋 / 进度感 |
| v5.0.3.56 | 8 个假绿 commit 复盘 + 412 错诚实披露 | 反省 / 工程透明 |

两个调子互补，不冲突。如果用户两版都 follow 你的话，会觉得「这个项目既能快推 feature 又能事后诚实复盘」—— 正面形象。

如果只 follow 一版，单独看 v5.0.3.56 也成立 —— "我们维护版也认真写"。
