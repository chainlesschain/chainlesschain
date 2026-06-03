# Android ADR 重评估 v2.0

> **触发**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) v1.3+ A.3（P0 前置，blocks B.3 DID rotate）
> **起稿日期**: 2026-05-12
> **基线**: 设计文档 v0.8（§10 v1.3+ 加 triage 分层）
> **作者**: A.3 P0 前置任务
> **状态**: review 完成稿（一遍过，未经合议）

## 0. 目的与范围

设计文档 §4 共 8 个 ADR（[ADR-1 ~ ADR-8](Android_重新定位_设计文档.md#adr-1--三层定位结构l1-wallet--l2-capture--l3-remote)）于 2026-05-10 v0.1 起草，2026-05-11 v0.2 重写 ADR-5。实施一年后回看，对每个 ADR 做：

1. **真实代码状态 audit**（不依赖 ADR 文本，对 `git ls-files` + grep 验真）
2. **verdict 三选一**：
   - **keep** — ADR 决策当下仍成立，无重做必要
   - **amend** — 决策方向对，实际落地形态偏离原文，需修订 ADR 文本对齐真实
   - **revise** — 决策本身在新数据下需重做（如 v1.3 想做的某项 block 在此 ADR）

review 不是改 ADR — review **产出方向 + 待办**，真改在后续 PR 落（§4 ADR 改动需新增 changelog 条目）。

## 1. 总览

| ADR | 主题 | v0.1 决策 | 2026-05-12 真实 | Verdict | 影响 v1.3+ |
|---|---|---|---|---|---|
| ADR-1 | 三层定位 L1/L2/L3 | B（按场景分层） | M1-M5 全落，registry 收敛 ✅ | **keep** | — |
| ADR-2 | L1 密钥后端三阶段 | B（StrongBox > TEE > 软件） | **partial**：M5 StrongBoxKeyManager ✅；M2 AndroidDIDKeyStore 仍走 EncryptedSharedPreferences + 软件 Ed25519 | **revise** | **blocks B.3 DID rotate** |
| ADR-3 | REMOTE 三道闸 | B（白名单+签名+审批） | mobile-skill-whitelist + mobile-approval-channel ✅ | **keep** | — |
| ADR-4 | Voice Mode | B（REMOTE + 系统 ASR/TTS） | v1.1 Whisper local + v1.2 Auto Phase 1 ✅ | **keep** | — |
| ADR-5 | REMOTE 能力盘点 | cowork/workflow 升级，其他不立项 | M4 RemoteSkillRegistry ✅，其他 0 立项 | **keep** | — |
| ADR-6 | 反向 RPC | B（v1.0 必做） | M4 D2 `eba16a1d8` + M5 `6d482d066` ✅ | **keep** | — |
| ADR-7 | cc-mobile.json 独立配置 | B（assets/ 下独立） | **cc-mobile.json 从未创建**；user_settings 表双端同步已落 | **amend** | — |
| ADR-8 | REMOTE skill registry 来源 | B（开机拉桌面 + 缓存） | 实际是 **disk-first + push-based**，非 fetch-pull；无 signed manifest | **amend** | marketplace 上线后再加 signed manifest |

**结论**：5 keep / 2 amend / 1 revise。**revise 的 ADR-2 是 B.3 DID rotate 的 blocking 项**，需先解。

## 2. 逐 ADR 详评

### ADR-1 — 三层定位结构：keep

**audit**：
- L1 `core-security/strongbox/StrongBoxKeyManager.kt` ✅、`sign/SignAsService.kt` ✅、`sign/AndroidApprovalGate.kt` ✅、`remote/crypto/AndroidDIDKeyStore` ✅
- L2 `CameraOCR` / `VoiceMode` / `LocationTagger` / `PushNotifier` / `ShareReceiver` 全 M2-M3 落地
- L3 `remote/registry/RemoteSkillRegistry.kt` ✅ + `remote/RemoteCommandClient.kt` ✅ + ApprovalUI ✅

**verdict**：**keep**。三层定位是后续所有 ADR 的承载结构，按场景分层验证有效（不靠 skill 数量竞速桌面）。无 v1.3 改动建议。

### ADR-2 — L1 密钥后端三阶段：revise

**audit**（关键发现）：

| 实现 | 路径 | 实际后端 | 设计层 |
|---|---|---|---|
| `StrongBoxKeyManager` | `core-security/strongbox/` | 5-tier 探测（NATIVE_STRONGBOX / NATIVE_TEE / WRAPPER_STRONGBOX / WRAPPER_TEE / SOFTWARE）+ wrapper AES-256-GCM 加密 Ed25519 私钥 | L1 SignAsService 走这条 |
| `AndroidDIDKeyStore` | `app/.../remote/crypto/DIDSigner.kt` | EncryptedSharedPreferences（AES-256-GCM master 走 Keystore，但 **Ed25519 私钥 plain 加密落盘 + 内存解密**） | M2 DID wallet 走这条 |
| `DIDSigner.signWithEd25519` | 同上 | BouncyCastle Ed25519Signer（**纯软件**） | DID 签名走这条 |

**问题**：ADR-2 的 "三阶段" 在 `StrongBoxKeyManager` 完整落地，但 **M2 DID wallet 的日常签名（包括 m-of-n partial signature）从未接入 StrongBoxKeyManager**。当前 m-of-n 多签的 Android 端 partial signature 实际是 **软件 Ed25519**，不在 TEE/StrongBox 内。

**对 v1.3 影响**：
- **B.3 DID rotate** 设计上想 "广播旧→新 DID attestation 让 core-multisig.policy 自动重写 signer 列表"。如果 attestation 由当前 DIDSigner 走软件 Ed25519 签出，attestation 本身没有 TEE 保护，rotation 协议受信任度低
- **B.6 PQC 严格模式** 要求 SLH-DSA partial sig — 现 Android 端 SLH-DSA 也得走软件实现（StrongBox 不支持 SLH-DSA），所以 B.6 实际上不依赖 ADR-2 修订

**verdict**：**revise**。需做两件事：

1. **明确分工**：ADR-2 文本应说明 "三阶段适用于 SignAsService（M5）；M2 DID wallet 的 Ed25519 当前走软件，作为已知限制"。让阅读者不再以为 DID 签名是 TEE 受护的
2. **决定 v1.3 是否补 M2 接入 StrongBoxKeyManager**：
   - **选项 A（推荐）**：补。AndroidDIDKeyStore 改用 `StrongBoxKeyManager.wrapEd25519Private/unwrap` 把私钥包成 `WrappedEd25519Key`，签名时短暂 unwrap 到内存。**工期估 ~1d**（M2 KeyStore 重构 + 迁移现有 plain-encrypted 私钥）
   - **选项 B**：不补。接受当前软件 Ed25519，B.3 DID rotate attestation 走 SignAsService（绕 M2，每次 rotation 触发 BiometricPrompt 一次）。**工期估 ~0.5d**（B.3 设计绕路）
   - **选项 C**：等 Native Ed25519（API 33+）支持稳定后做。等到 2027 Android 主流升级覆盖 80% API 33+ 再统一切

选择 A 还是 B 取决于 GA 反馈 — 用户群是否大量 API 28+ 老设备（适合 A wrapper）vs 主要 API 33+（适合 C native）。**v1.3 主体启动前需先做这个决策**。

### ADR-3 — REMOTE 三道闸：keep

**audit**：
- 白名单：`desktop-app-vue/src/main/security/mobile-skill-whitelist.js` ✅ `d6b3926fa`
- 签名：`DIDSigner.sign` + `RemoteCommandClient` 注入 DID 签名 ✅
- 审批：`AndroidApprovalGate.kt` + `ApprovalDialogHost.kt` + `mobile-approval-channel.js` ✅

**verdict**：**keep**。三道闸全落地，无 v1.3 改动建议。**B.3 DID rotate 完成后**，白名单的 signer DID 引用需配套更新（已记入 B.3 设计依赖）。

### ADR-4 — Voice Mode：keep

**audit**：
- REMOTE chat：v1.0 落地，v1.1 增 Whisper local（memory `android_native_vendor_strategy.md`）
- 系统 ASR/TTS：`AsrSettingsScreen.kt` + `AICommands::TTSResponse` ✅
- 云端 opt-in：v1.2 火山豆包视觉 OCR 已接（memory `screenshot_ocr_cross_shell_memo.md`）

**verdict**：**keep**。Auto Phase 1 voice intent（v1.2）已抽象为 generic IPC 的前置在 #21 C.1 列出，跟 ADR-4 本身无关。

### ADR-5 — REMOTE 能力盘点：keep

**audit**：v0.2 重写表格 9 项能力，实际：
- cowork ✅ 35 .kt → registry 收敛 ✅
- workflow ✅ → registry 收敛 ✅
- trading / marketplace / BI / 多模态 / agent federation / 自治 agent runner — 全 0 立项（验：`grep -r "marketplace" android-app/app/src/main/kotlin` 0 结果）
- 23 *Commands → registry 收敛 ✅

**verdict**：**keep**。v0.2 表格的 "不立项" 决策被一年验证为正确（用户没有发起任何 marketplace/BI mobile-native 需求）。**v1.3 仍坚持 REMOTE 调用桌面，不在 mobile 端做 marketplace native skill**。

### ADR-6 — 反向 RPC：keep

**audit**：
- `mobile-bridge.js` `pendingReverseRpc` Map + `sendReverseRpcRequest` ✅（生效于 M4 D2 + M5）
- Android `ApprovalCommandRouter.kt` 接收 `approval.request` ✅ `eba16a1d8`
- `SignAsService` 配合 ✅ `6d482d066`

**verdict**：**keep**。反向 RPC 是手机变 "跨平台硬件 USB Key" 的承载，v1.0 落地至今稳定。**B.1 web-shell signing UI** 实际上是这条路径在浏览器端的 surface 化（让渲染层也能触发 reverse RPC），不动 ADR-6 本体。

### ADR-7 — cc-mobile.json 独立配置：amend

**audit**（关键发现）：
- `find android-app -name "cc-mobile.json"` → 0 结果。**这个文件从未被创建**
- `desktop-app-vue/src/main/database/database-schema.js` 定义 `user_settings` 表（scope+key+value+updated_at LWW，"UI 主题 / 通知开关 / 语言等"）
- Phase 3d Mobile Sync（memory `phase_3d_mobile_sync_landing.md`）已落地 desktop ↔ Android `user_settings` 双向同步

**问题**：ADR-7 选 B 但实际从未创建该文件 — 决策 silently drifted to "用 user_settings + scope 区分"。ADR 文本与现实背道。

**verdict**：**amend**。ADR-7 文本应改写为：

> **选 B'（v1.2 实际落地）**：不创建独立 `cc-mobile.json` 文件；移动端配置走 `user_settings` 表 + `mobile.*` scope（如 `mobile.biometric.enabled` / `mobile.push.provider`），通过 Phase 3d Sync 与桌面双向同步。**桌面侧仍单管 `mobileBridge.*`**（桌面对手机开放策略，不通过 user_settings 同步）。

理由：
- 关注点分离仍达到（mobile-specific 配置在 `mobile.*` scope；桌面策略在 `mobileBridge.*` config.json）
- 多账户支持白送（user_settings 的 scope 列）
- 同步白送（Phase 3d 已落）
- 包体 / 依赖 0 增（不引入新文件 schema 验证）

**v1.3 行动**：amend ADR-7 文本，加入 changelog v0.9 条目说明 "v1.2 实际落地为 B'，ADR-7 文本同步真实"。无代码改动。

### ADR-8 — REMOTE skill registry：amend

**audit**：
- `RemoteSkillRegistry.kt::initialize()` → disk-first（`store.load()`）→ 失败回退 `SeedRegistry.SKILLS`（hardcoded baseline）
- `updateFromRemote()` 接收 push 而非 active fetch
- **无 signed manifest 验证**（grep `signature|verify` on RemoteSkillRegistry → 0 命中）

**问题**：ADR-8 文本 "开机时从桌面拉取" 隐含 pull-model，但实际落地是 push-model。"+ 缓存" 也不准 — 是 disk-first + seed fallback。

**verdict**：**amend**。ADR-8 文本应改写为：

> **选 B'（v1.2 实际落地）**：`RemoteSkillRegistry` 启动时 **disk-first**，无缓存命中则 fallback to `SeedRegistry` baseline。桌面通过 mobile-bridge **push** 更新（`registry.update` RPC），不是 mobile 主动 pull。**signed manifest 验证 deferred 到 Marketplace 上线后**（届时 manifest 由 marketplace publisher 签发，验签链路 = Ed25519 + 可选 SLH-DSA hybrid）。

理由：
- Push-model 与 Phase 3d 同步 channel 共用 transport，无新机制
- Pull-model 需 mobile 启动时联网，与离线模式冲突
- Signed manifest 在 marketplace 缺位时无 trust anchor，先做也是 self-signed 形式无意义
- DID-signed RPC（M4 D2 ✅）已为单次 update 提供 attestation

**v1.3 行动**：amend ADR-8 文本，加入 changelog v0.9 条目。预留 manifest signature 字段（`SkillMetadata.signature: String? = null`）作为 forward-compat，但不强制验证。**~0.3d 工**（schema 字段 + verifier no-op stub）。

## 3. 下游影响

| v1.3+ 子项 | ADR 修订影响 | 行动 |
|---|---|---|
| **B.3 DID rotate** | ADR-2 revise 决定其 attestation 安全模型 | 等 ADR-2 选项 A/B/C 决策后再开 B.3 design |
| **B.6 PQC 严格模式** | ADR-2 不影响（SLH-DSA 不在 TEE） | 独立推进 |
| **B.2 削 cc 冷启** | 无 ADR 修订影响 | 独立推进 |
| 其他 P1/P2 | 无 ADR 修订影响 | 按 GA 反馈 trigger |

**关键路径**：A.3（本文档收口）→ ADR-2 选项决策（GA 反馈期完成）→ B.3 设计开工。

## 4. Action items

- [ ] **AI-1（P0）**：将本文档 §2 ADR-2 / ADR-7 / ADR-8 的修订建议落回设计文档 §4 ADR 原文（changelog v0.9）。**工期 ~0.3d，写文档**
- [ ] **AI-2（GA 反馈期）**：决定 ADR-2 选项 A vs B vs C（用户群 API 版本分布数据驱动）
- [ ] **AI-3（marketplace 上线前）**：补 `SkillMetadata.signature` 字段 + verifier no-op stub（forward-compat 预留）。**工期 ~0.3d**
- [ ] **AI-4（B.3 design 启动前）**：根据 AI-2 决策结果，设计 B.3 DID rotate 的 attestation 信任链
- [ ] **AI-5（marketplace 上线后）**：补 ADR-8 signed manifest 真验签实现

## 5. 待 GA 反馈 / 待外部触发

- **ADR-2 选项决策需要的数据**：v1.2 GA 上架 1-2 周后的 user agent / API level 分布（Play Console 提供）。若 API 33+ ≥ 80% 选 C；若 API 28-32 占大头选 A
- **ADR-8 signed manifest 触发**：marketplace M0 (PoC) 上线时间未定；触发后 ~1 周内完成签名链路
- **ADR-7 amend**：可立即做（v1.2 已是实际状态，文本对齐真实即可）

## 6. 变更记录

- 2026-05-12 v1.0：初稿，#21 A.3 P0 前置任务产出。8 ADR 全 audit；5 keep / 2 amend / 1 revise；3 个 action items 加入 v1.3 任务队列。
