# B.1 web-shell private key signing — spike v0.4

> **Issue**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) B.1（GA 后续 scope · P1）
> **状态**: 🟢 PR1 ✅ + PR2a ✅ + PR2b ✅ + PR3 ✅ landed (2026-05-15) — **B.1 主体闭环**
> **作者**: 2026-05-15
> **关联**: [Android 重新定位 §10 B.1](Android_重新定位_设计文档.md) / [MofN 多签应用扩展](MofN_多签_应用扩展_v1.md) / [三端 UI Consistency §2.4](三端_UI_Consistency_设计文档.md)
> **下一步**: B.1 主体已闭环。Follow-ups（不在 B.1 scope 内）：(1) software 私钥加密 store 让 unified source 支持 entry.source==='software' 真签名 (2) CLI `cc multisig sign --keystore` flag (3) SignProposalModal 加 'unified' radio option

---

## 1. 准入条件重评（2026-05-15）

设计文档 §10 B.1 **原 framing**："v1.2 `/multisig` 只能列 + 取消 + 执行已达阈提案，不能本地签（私钥在 desktop main 进程 / U-Key 硬件，渲染层拿不到）。需先接通 Unified KeyStore（v1.2 还没收口），再加 SignProposalModal"

**重评后真实情况**（2026-05-15 audit）：

| 组件 | 状态 | 位置 |
|---|---|---|
| `UnifiedKeyManager` (BIP-32 派生 + `unified_keys` SQLite + KEY_PURPOSES/KEY_SOURCES) | ✅ 已落（v1.1.0 标） | `desktop-app-vue/src/main/ukey/unified-key-manager.js` 274 行 |
| `ukey:sign` IPC + ukeyManager.sign() | ✅ 已落（renderer 可调） | `desktop-app-vue/src/main/ukey/ukey-ipc.js:161` |
| `ukey:derive-key` / `ukey:list-keys` IPC | ✅ 已落 | `ukey-ipc.js:299/309` |
| 9 配套 modules（pkcs11/skf/multi-device/contract/hw-wallet/threshold/fido2/satellite-sim） | ✅ 已落 | `ukey/` 目录 |
| `unified_keys` schema | ✅ id/purpose/source/derivation_path/public_key/key_hash/algorithm/device_id/is_primary | `unified-key-manager.js:67-81` |
| **Multisig-aware signing middleware** | ❌ → ✅ **PR1 此次** | `ukey/multisig-signer.js` 新增 |
| **`multisig.sign` web-shell WS topic** | ❌ → ✅ **PR1 此次** | `web-shell/handlers/multisig-handlers.js` 新增 topic |
| Key↔DID 映射查询 IPC | ❌ → ⏳ PR3 | `unified_keys` 表加 `did` 列 + index |
| `SignProposalModal.vue` 组件 | ❌ → ⏳ PR2 | `packages/web-panel/src/views/` 新增 |
| Renderer 端 PIN/Biometric 流程对接 multisig | ❌ → ⏳ PR2 | ukey:verify-pin + multisig.sign 协调 |

**结论**：Unified KeyStore infra ✅ ready；B.1 真 scope 是把这条 IPC/topic/UI 链拼起来，**不需要等 KeyStore "收口"**。

---

## 2. 三层 PR 拆分

| PR | 状态 | 文件 | 描述 |
|---|---|---|---|
| 1 | ✅ landed (2026-05-15) | `ukey/multisig-signer.js` + `web-shell/handlers/multisig-handlers.js` + 2 测试文件 | (1) `createMultisigSigner({runtimeFactory?, ukeySigner?})` 工厂；4 sources 派发（hex / path / ukey / unified）(2) `signProposal({proposalId, signerDid, alg?, source, params})` API 返 `mgr.sign` shape (3) `multisig.sign` WS topic mirror marketplace.consume pattern，domain 错码（INVALID_KEY / UKEY_NOT_WIRED / UNIFIED_NOT_IMPLEMENTED / INVALID_SOURCE / KEY_PATH_NOT_FOUND / KEY_PATH_NOT_FILE）软化成 `{accepted:false, reason}`，programming 错误（INVALID_ARGS）re-throw (4) 22 MultisigSigner unit + 9 handler unit tests + 31 既有 handler 0 regression |
| 2a | ✅ landed (2026-05-15) | `core-multisig/lib/proposals.js` + `ukey/multisig-signer.js` + 16 new tests | (1) **core-multisig** `mgr.signWithExternal({proposalId, signer, signCallback})` 新 async API — caller 提供 `signCallback(canonicalBytes, alg) → Promise<Buffer>` 代替 secretKey；secret 永远不进函数 input。mirror sign() 检查 (state/membership/alg/duplicate)，加 5 个外部错码（`missing_sign_callback` / `sign_callback_failed` (含 detail) / `sign_callback_returned_non_buffer` / `sig_self_verify_failed` 既有） (2) **MultisigSigner** source='ukey' 直接走 `mgr.signWithExternal(..., signCallback: ukeySigner)` — 不再 throw NOT_IMPLEMENTED；hex/path 仍走原 `mgr.sign` 同步路径 (3) 10 core-multisig signWithExternal unit tests (happy / missing callback / not_found / duplicate / not_a_member / alg_mismatch / sig_self_verify_failed / non-buffer / callback throw / hybrid Ed25519+SLH-DSA / mgr.sign+signWithExternal interop) (4) 5 MultisigSigner ukey path tests (NOT_WIRED / delegation / error pass-through / alg default / close on throw) (5) 0 regression in 31 existing handler tests |
| 2b | ✅ landed (2026-05-15) | `multisig-signer.js` (`buildUkeyManagerSigner` helper) + `web-shell-bootstrap.js` (wire `signerFactory`) + `SignProposalModal.vue` (new) + `Multisig.vue` (签名按钮 + onSign 流程) | (1) **architecture pivot**: renderer 不持 electronAPI（web-panel 通过 WS 走主进程）；改在 **main 进程 web-shell-bootstrap** wire `ukeySigner` 回调，注入 `createMultisigSigner` via `signerFactory` 选项 (2) `buildUkeyManagerSigner(ukeyManager) → (bytes, alg) → Promise<Buffer>` adapter — 4 normalised driver return shapes (direct Buffer / `{signature:Buffer\|hex\|base64}` / `{sig:...}` / 失败 throw) (3) `SignProposalModal.vue` — domain badge + Proposal ID + 阈值 + 已签数 + payload hash 短码 (per A.2 §2.4.c head 8 + tail 4) + signer DID dropdown + source picker (ukey 推荐 / hex 调试) + danger 按钮 (per A.2 §2.1.a) + 高风险警示 alert (4) `Multisig.vue` 列表 actions 加 "签名" 按钮 (state===pending) + 详情 drawer 同步加按钮 + `onSignFromList` / `onSignFromDetail` / `onSigned` 流程 (5) `multisig.sign` topic 路径走通：embedded 走 `ws.sendRaw`，cc serve 走 `crosschain bridge-consume` fallback (6) +10 buildUkeyManagerSigner unit tests + 75/75 全过 + web-panel build green |
| 3 | ✅ landed (2026-05-15) | `ukey/unified-key-manager.js` schema + DID 索引 + `MultisigSigner unified` 真实现 + `web-shell-bootstrap` wire + 13 PR3 tests | (1) `unified_keys` 表 idempotent ALTER TABLE 加 `did TEXT` 列 + `idx_unified_keys_did` 索引（mirror crosschain Layer 2 PR1 PRAGMA pattern） (2) `findKeyForDid(did) → entry|null` 查询；defensive on null db / non-string did / sql throw (3) `setDidForKey(keyId, did)` 把 existing 已派生 key 绑到 multisig member DID + emit `key:did-bound` event (4) `MultisigSigner.signProposal source='unified'` 真分发：`findKeyForDid` → `entry.source==='ukey'` 复用 PR2a 的 ukeySigner callback (经 mgr.signWithExternal) / `software\|simkey\|tee` throws `UNIFIED_SOURCE_NOT_IMPLEMENTED` (待加密 secret store) / 未找到 throws `UNIFIED_DID_NOT_FOUND` / 缺 unifiedKeyManager throws `UNIFIED_NOT_WIRED` (5) `web-shell-bootstrap.js` 加 `options.unifiedKeyManager` typedef + 注入到 `createMultisigSigner` (6) **架构约束**：今天 `unified_keys` 表仅存公钥+元数据，所以 entry.source==='ukey' 是唯一真签名路径；software 子分支留 throws 提示需要 follow-up 加密 secret store (7) +13 PR3 tests (5 unified-key-manager findKeyForDid + 3 setDidForKey + 5 MultisigSigner unified path) + 0 regression 113/113 |

**B.1 主体已闭环**：PR1 (middleware seam) → PR2a (signWithExternal API) → PR2b (UI + ukey wire) → PR3 (DID routing)。renderer 可以：(a) 选 source='ukey' 直接走硬件 (b) 选 source='unified' 经 DID 查 unified_keys 路由到 ukey。secretKey 永不出 main 进程边界。

**Follow-ups（不属 B.1 scope）**：

| F | 描述 | 工期估 |
|---|---|---|
| F1 | software 加密 secret store + unified source 'software' 分支真签名 | ~1d（设计 + 加密 + tests） |
| F2 | CLI `cc multisig sign --keystore --signer <did>` flag (CLI 复用 unified-key-manager 路径) | ~0.5d（需 SQLite shared 或 IPC 抽象决策） |
| F3 | SignProposalModal 加 'unified' radio option，当 DID 已绑定时优先 | ~0.3d |
| F4 | UnifiedKeyManager IPC handler `unified-key:bind-did(keyId, did)` 让 renderer 能管理绑定 | ~0.3d |

---

## 3. PR1 设计要点

### 3.1 不让 renderer 持有 secret key

`signProposal` 不接 `secretKey: Buffer` 直接 input。强制走 source 派发：renderer **必须**告诉后端用哪个 key source，后端去拿、签、不返回 secret。

**Source 协议**：
```js
signer.signProposal({
  proposalId: "msp_abc",
  signerDid: "did:cc:alice",
  alg: "Ed25519",             // 可选，默认 Ed25519
  source: "hex" | "path" | "ukey" | "unified",
  params: {
    secretKeyHex?: string,    // source=hex
    keyPath?: string,         // source=path (regular file w/ hex)
    // ukey/unified 在 PR2/PR3 落
  },
});
```

`source='hex'` 是 CLI back-compat 路径，**renderer 不应使用** —— PR2 SignProposalModal 只暴露 ukey + unified。hex/path 留给 CLI 测试 + smoke。

### 3.2 错码分流：domain 错软化 / 程序错抛出

```
INVALID_KEY / INVALID_KEY_PATH / KEY_PATH_NOT_FOUND / KEY_PATH_NOT_FILE
  → 软化成 {accepted:false, reachedThreshold:false, reason:"INVALID_KEY", detail:"..."}
UKEY_NOT_WIRED / UKEY_NOT_IMPLEMENTED / UNIFIED_NOT_IMPLEMENTED / INVALID_SOURCE
  → 软化（PR1 占位错码）
INVALID_ARGS（renderer 漏字段）
  → throw（renderer 程序 bug 不应静默）
```

Renderer 用 `r.accepted === true` 判成功，否则展示 `r.reason` + `r.detail`。

### 3.3 close 总是被调

`signProposal` 用 try/finally 包 `mgr.close()`，无论 mgr.sign 抛错 / source 参数解析失败 / 任意中间步骤都释放 SQLite handle。22 个 unit tests 里 2 个专门验 close 调用次数。

### 3.4 与 Layer 1/2 一致的 dependency injection

`runtimeFactory` 选项 mirror multisig-handlers.js + crosschain.js 已用的注入 seam — 测试用 `vi.fn` 替换真 SQLite 打开，生产路径用默认 `_loadRuntime` import CLI multisig-runtime.js。

---

## 4. 与三端 UI Consistency 文档的关系

A.2 baseline `三端_UI_Consistency_设计文档.md` §2.4.c 要求"所有签名操作必须显示 payload SHA-256 前 8 字符 + 后 4 字符 hex（共 13 字符）"。

PR2 SignProposalModal 落地时：
- 顶部 banner 显示 `payload hash: a1b2c3d4...ef89` (13 字符)
- tap/click 展开完整 64 字符 hex
- 二次确认 button 用 `danger` 色 (`--cc-danger`)，per §2.1.a 高风险红规则

PR2 也必须实施 §2.4.b 形态：Desktop V6 用 Modal.confirm + U-Key PIN 或 software password，不直接走 Modal alone。

---

## 5. 与 CLI `cc multisig sign` 的衔接

现 CLI 命令：
```bash
cc multisig sign <proposalId> --signer <did> --alg Ed25519 --key <hex|path>
```

PR1 后多了内部 MultisigSigner 中间层，但 CLI 路径**不变** —— CLI 自己用 `mgr.sign` + `readSecretKey` 直接走，没必要走 MultisigSigner（CLI 进程持 secret 是合理的）。

PR3 落 unified source 后会加 CLI flag：
```bash
cc multisig sign <proposalId> --signer <did> --keystore  # 走 unified-key-manager
cc multisig sign <proposalId> --signer <did> --ukey      # 走硬件 (Win only)
```

---

## 6. 风险 & 决策点

| 风险 | 缓解 | 决策点 |
|---|---|---|
| PR2 `signWithExternal` 改 core-multisig API surface | 加新方法不破 backward-compat；既有 `mgr.sign` 不变 | PR2 设计阶段过用户 review |
| PR3 `unified_keys` 加 `did` 列违反原 schema "公钥 + metadata, NO private keys" 原则 | DID 是公开标识 ≠ 私钥，加 `did` 列不破不破私钥隔离 | PR3 schema migration 透明 |
| Renderer 误用 source='hex' 暴露 secret to UI | PR2 SignProposalModal 只 expose ukey + unified picker；hex/path 是 CLI 内部用 | PR2 UI 设计阶段 review |
| ukey hardware Windows-only（memo: known limitation） | MultisigSigner.source='ukey' 在 macOS/Linux 走 simulation；UI 不展示该 picker | PR2 Modal 按平台条件 render |

---

## 变更记录

- 2026-05-15 v0.4：**PR3 landed — B.1 主体闭环** — `unified_keys.did` 列 idempotent migration + `findKeyForDid` + `setDidForKey` + MultisigSigner unified source 真分发（entry.source==='ukey' 复用 PR2a ukeySigner callback；software/simkey/tee 留 UNIFIED_SOURCE_NOT_IMPLEMENTED 待 follow-up 加密 secret store）。`web-shell-bootstrap` 加 `unifiedKeyManager` 注入。13 PR3 unit tests + 113/113 全过。架构约束：今天 unified_keys 仅存公钥+元数据，所以 unified source 真签名只能路由到 ukey；software 真签名是 F1 follow-up。
- 2026-05-15 v0.3：**PR2b landed** — `buildUkeyManagerSigner` adapter + `web-shell-bootstrap.js` 注入 `signerFactory` + `SignProposalModal.vue` (payload hash 短码 / danger 按钮 / source picker) + `Multisig.vue` "签名" 按钮 (list/detail) 加 `onSignFromList` / `onSignFromDetail` / `onSigned` 流程。架构 pivot：renderer 走 WS topic 而非 electronAPI（与 web-panel embedded 设计一致），ukeySigner 在 **main 进程** boot 时 wire。10 PR2b unit tests + 75/75 全过 + web-panel build green。
- 2026-05-15 v0.2：**PR2a landed** — `core-multisig.signWithExternal(...)` async API（caller 提供 `signCallback` 代替 secretKey）+ `MultisigSigner` source='ukey' 真 wiring。10 core-multisig + 5 MultisigSigner 新 unit tests + 0 regression (86 core-multisig + 65 desktop multisig)。PR2 拆 PR2a (backend，已落) + PR2b (UI 端 SignProposalModal + ukey IPC factory，下一步)。
- 2026-05-15 v0.1：A.2 baseline 后即开 B.1 PR1。重评 Unified KeyStore 准入条件（infra 已 ready）+ 落地 MultisigSigner middleware + multisig.sign WS topic + 31 tests + 0 regression。PR2/3 列入下一步。
