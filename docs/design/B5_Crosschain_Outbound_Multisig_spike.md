# B.5 跨链桥 outbound × m-of-n 多签 — spike v0.6

> **Issue**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) B.5（GA 后续 scope · P1）
> **状态**: 🟢 Layer 1 ✅ 收口 + Layer 2 PR1 ✅ landed (2026-05-15)
> **作者**: 2026-05-15
> **关联**: [m-of-n 应用扩展 v1](MofN_多签_应用扩展_v1.md) / [MTC 跨链桥 v1](MTC_跨链桥_v1.md) / memory `mtc_landing_v0_11.md` Q-COMP-3
> **下一步**: Layer 2 PR2 — 把 `partial_sigs_json` 喂进 `cross-chain-mtc.js:buildMultiHopBridgeEnvelope` 的 publisher_signature（MTC v0.11 hybrid pattern 复用）

---

## 1. 现状摸底（2026-05-15 真实代码）

| 表面 | 现状 | 文件 |
|---|---|---|
| **核心 multisig 包** | `@chainlesschain/core-multisig` v0.1.0 — pending/reached/consumed/cancelled/expired 状态机；任意 string `domain` 字段 | `packages/core-multisig/` |
| **唯一被多签 gate 的 domain** | `marketplace.purchase` → finalize via `marketplace.consume` | `desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js:36` |
| **crosschain CLI 命令** | `cc crosschain bridge / swap / message`（Phase 89，1575 行）— **纯 SQLite accounting，0 真 RPC** | `packages/cli/src/commands/crosschain.js` + `packages/cli/src/lib/cross-chain.js` |
| **crosschain 支持的链** | ethereum (chainId 1) / polygon (137) / bsc (56) / arbitrum (42161) / chainless (0) 5 条 | `cross-chain.js:SUPPORTED_CHAINS` |
| **crosschain × MTC** | `cross-chain-mtc.js` 已落 trust anchor / bridge envelope / multi-hop / SLA — **MTC 签名层接，但无 m-of-n** | `packages/cli/src/lib/cross-chain-mtc.js` |
| **真链上 RPC** | 0 调用（`grep -c "ethers\\|cosmjs\\|broadcastTx" cross-chain*.js` = 0） | — |

**核心发现**：基础设施 80% 已经在了。差的只是把 m-of-n gate 从 `marketplace.*` 扩展到 `crosschain.*`，以及把现有 crosschain `lock_tx_hash` / `mint_tx_hash` 字段 wired 到真 ethers.js/cosmjs broadcast。

---

## 2. 三层分解（按工期 + 外部依赖排序）

### Layer 1 — multisig domain gating（~0.5d 工，0 外部依赖）

把 `cc crosschain bridge` 命令加 `--require-multisig` opt-in flag。流程：

```
bridge --from ethereum --to chainless --amount 100 --require-multisig
  ↓
1. core-multisig.propose({domain: "crosschain.bridge.outbound", payload: {...bridge args}})
   返回 proposalId + 首签
2. 其它 signer 通过 web-shell /multisig 看到提案 → 各自签
3. 达 m-of-n 阈值 → multisig state → "reached"
4. 调 crosschain.bridge.consume(proposalId) → bridgeAsset() 真正 insert cc_bridges row
                                                  + multisig state → "consumed"
```

**镜像 marketplace.purchase 已有 pattern**：

| marketplace | crosschain | 备注 |
|---|---|---|
| `marketplace.purchase` domain | `crosschain.bridge.outbound` domain | 一对一 |
| `marketplace.consume` finalize topic | `crosschain.bridge.consume` finalize topic | 一对一 |
| `multisig-handlers.js` 已有 `MULTISIG_PURCHASE_DOMAIN` 常量 | 加 `MULTISIG_BRIDGE_OUTBOUND_DOMAIN` 常量 | 同一文件 |
| Multisig.vue `callMultisigTopic` 已抽 helper | 复用，0 改 | UI 0 改 |

**Layer 1 PR 拆分（建议各 ~150-300 行）**：

| PR | 状态 | 文件 | 描述 |
|---|---|---|---|
| 1 | ✅ landed | `packages/cli/src/commands/crosschain.js` + `__tests__/integration/crosschain-multisig-e2e.test.js` | `bridge --require-multisig` flag + `bridge-consume <proposalId>` 子命令 + `MULTISIG_BRIDGE_OUTBOUND_DOMAIN` 常量 + `_bridgePropose` / `_bridgeConsume` helpers；**11 E2E tests** 全过（happy 2-of-2 / 1-of-1 reaches immediately / 4 error paths / 3 regression paths / text output）+ 103 既有 crosschain 测试 0 regression |
| 2 | ✅ landed | `desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js` + `__tests__/multisig-handlers.test.js` | 加 `MULTISIG_BRIDGE_OUTBOUND_DOMAIN` 常量 + `crosschain.bridge.consume` in-process WS topic（mirror `marketplace.consume`：domain gate + state gate + finalize + return `{status, proposalId, payload}`）；**8 new unit tests** + 23 既有 multisig handler 测试 0 regression + 27 web-shell test files / 409 tests 全过；bootstrap spread 自动注入新 topic 无需改 wiring |
| 3 | ✅ landed | `packages/web-panel/src/views/Multisig.vue` | (1) 列表 + 详情 各加 "执行跨链桥" 按钮（reached + domain === crosschain.bridge.outbound 时显示）(2) 新 `onBridgeConsume()` 调 `callMultisigTopic("crosschain.bridge.consume", ...)` (3) 双路径 UX：isEmbedded 走 in-process topic 只 finalize，弹 Modal 提示 CLI follow-up；cc serve 走 subprocess 真插入 cc_bridges row 显示 bridgeId (4) fix typo `crosschain.outbound` → `crosschain.bridge.outbound` 在 loadAll policies discovery (5) alert 文案重写覆盖新 domain；build 通过 + postbuild auto-sync 到 CLI assets；1867/1867 web-panel 测试 0 regression |
| 4 | ✅ landed | `docs/design/MofN_多签_应用扩展_v1.md` | 实施进度表加 Phase 4a/4b/4c/5 行；§6.3 跨链桥 outbound 从 1 行 stub 扩成完整段（CLI 代码 + marketplace ↔ crosschain 对照表 + Layer 2/3 待做项）；新 §8.3 web-panel Multisig.vue 接通段（isEmbedded 双路径表 + 性能对比 + UI 元素）；新 Phase 4a 落地清单段（代码位置 + CLI 流程 + 11+8 测试覆盖）；§10 Phase 划分表 rebrand `v1.3` → `GA 后续 scope` 对齐 Android #21 v0.10 政策；§11 加 spike doc 反链 |

**PR2 实测（2026-05-15）**：
- WS topic `crosschain.bridge.consume`：mirror `marketplace.consume` shape，gate 4 路径（not_found / wrong_domain / state ≠ reached / finalize-fail）+ happy path 返 `{status:"consumed", proposalId, payload}`
- 设计注：web-shell 不持 crosschain DB，**不做 `cc_bridges` row insert**；插入交给 caller（CLI `cc crosschain bridge-consume` 或 future executor）。Mirror marketplace.consume 也只 finalize 不 process payment，stub 语义一致
- 异步 `_safeParseJcs` 容错保留：payloadJcs 解析失败返 null，handler 仍走 finalize 路径不挂

**PR1 实测（2026-05-15）**：
- CLI 调用：`cc crosschain bridge ethereum polygon 100 --require-multisig --initiator did:cc:foo --key /tmp/foo.hex` → 返 `{status:"needs_co_sign", proposalId, requiredSigs, payload}`
- 其它 signer：`cc multisig sign <proposalId> --signer did:cc:bar --key /tmp/bar.hex` → 达阈
- 完成：`cc crosschain bridge-consume <proposalId>` → 真 insert `cc_bridges` row + proposal state → `consumed`
- 错误路径：缺 --initiator / 缺 --key / 缺 policy / pending state / not_found / wrong_domain / already_consumed 全部返 exit code 2 + structured JSON
- 兼容性：不传 `--require-multisig` 走原 direct path，0 regression

### Layer 2 — bridge envelope m-of-n signing（PR1 ✅ landed 2026-05-15）

Layer 1 只把 **是否推进 bridge** gate 在多签后，但 bridge envelope 本身（`bridgeAsset` 写入 SQLite 的 row 数据）仍是单 signer 的。Layer 2 把多签 partial sigs 嵌入 bridge envelope，让 onchain verifier 能验 m-of-n。

**Layer 2 PR 拆分**：

| PR | 状态 | 文件 | 描述 |
|---|---|---|---|
| 1 | ✅ landed | `packages/cli/src/lib/cross-chain.js` + `packages/cli/src/commands/crosschain.js` + 测试扩展 | (1) `cc_bridges` schema 加 3 列（`multisig_proposal_id` / `signers_did_json` / `partial_sigs_json`）+ index 走 idempotent `_addColumnIfMissing(db, table, col, def)` ALTER TABLE helper (2) `bridgeAsset(db, args, multisigContext?)` 第三参数收 `{proposalId, signers, partialSigs}` 并 INSERT 进新列 (3) `_bridgeConsume` 从 `got.signatures` 抽 signer DID + alg + sig hex 喂进 multisigContext (4) `bridge-show` 文本输出加 Multisig / Signers / Sigs 三行，opt-out 当列 NULL (5) `consumeResult` 返回 `signers[]` + `partialSigCount` 给 caller (6) 13 E2E tests（happy 2-of-2 加 6 行 provenance 断言 + 1-of-1 加 3 行 + 2 新 test cases：legacy direct bridge 三列 NULL / bridge-show 文本输出含 Multisig 段）+ 83 cross-chain unit + 130 crosschain-mtc 测试 0 regression |
| 2 | ⏳ pending | `packages/cli/src/lib/cross-chain-mtc.js:buildMultiHopBridgeEnvelope` | 把 `partial_sigs_json` 喂进 publisher_signature；改 single producer key → **strip-all-sigs JCS + m-of-n partial sigs concatenation**（参 memory `mtc_publisher_sig_threshold.md`，MTC v0.11 已支持 hybrid Ed25519+SLH-DSA）。verifier 加 m-of-n 路径接受多个 alg 混合 |
| 3 | ⏳ pending | `cross-chain-mtc.js:verifyBridgeEnvelope` + `verifyMultiHopBridgeEnvelope` | verifier 侧识别带 m-of-n provenance 的 envelope；reject 不达 threshold；同 alg + cross-alg 都覆盖 |

**前置依赖**：Layer 1 必先落 — Layer 2 需要稳定的 multisig proposal lifecycle 作 input。✅ PR1 已落，PR2/PR3 自然解锁。

### Layer 3 — 真链上 broadcast（external-blocked，不在本 spike）

调 ethers.js / cosmjs / @polkadot 等 SDK 把 Layer 2 envelope 推到真链：

```javascript
const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
const wallet = new ethers.Wallet(hotKey, provider);
const tx = await wallet.sendTransaction({ to: bridgeContract, data: envelopeAbiData });
db.update("cc_bridges", { lock_tx_hash: tx.hash, status: "submitted" });
```

**为什么 external-blocked**（memory `mtc_landing_v0_11.md` Q-COMP-3 已 sign-off）：
- 测试网账户需要先充值（Sepolia ETH / OPS Mumbai MATIC 等），需 marketing/finance 决策
- 真桥合约部署需要外部 auditor sign-off（Halborn / OpenZeppelin Audit 估 6-8w/合约）
- 主网 broadcast 需要 KYC + 跨境合规（设计文档 §1 三层定位的"链下治理 + 链上结算"分割原则要明确）

**建议**：Layer 3 单独开 spike issue（不属 B.5 当前 scope），需要 finance + legal sign-off 后再启动。

---

## 3. spike 验收（Layer 1 落地的判断标准）

- [ ] `cc crosschain bridge --require-multisig --from ethereum --to chainless --amount 100` 返回 `proposalId`，不 insert `cc_bridges` row
- [ ] `cc multisig sign <proposalId> --did <signer-did>` 各 signer 可签（complete with existing multisig CLI）
- [ ] 达 m-of-n 阈值后 `cc crosschain bridge consume <proposalId>` 真正 insert row + 多签 state → consumed
- [ ] web-shell `/multisig` 列表能看到 `crosschain.bridge.outbound` 提案，详情显示 payload `{fromChain, toChain, amount, sender, recipient}`
- [ ] 已达阈 proposal 在 `Multisig.vue` 可点 "执行" 调 `crosschain.bridge.consume` WS topic
- [ ] 单测：~25 unit + 1 integration（CLI propose → CLI sign×M → web-shell finalize → DB 行真存在）
- [ ] 文档：本 spike doc + `MofN_多签_应用扩展_v1.md` §8 加 crosschain 段

---

## 4. 与既有设计文档的关系

| 文档 | 关系 |
|---|---|
| [`MofN_多签_应用扩展_v1.md`](MofN_多签_应用扩展_v1.md) | §8 "Mobile（Android v1.2+）" 之后加 §9 "Crosschain Outbound（GA 后续 scope）" |
| [`MTC_跨链桥_v1.md`](MTC_跨链桥_v1.md) | bridge envelope 的 MTC publisher_signature 层是 Layer 2 的扩展点 |
| Android 重新定位设计文档 §10 B.5 | 本 spike 是 B.5 的实施细节落地 |

---

## 5. 风险 & 决策点

| 风险 | 缓解 | 决策点 |
|---|---|---|
| **Layer 2 schema 改动 backward-compat**：`cc_bridges` 加列对老 row 兼容？ | 加 `ALTER TABLE` migration + default null；老 row `multisig_proposal_id IS NULL` 走 legacy 路径 | Layer 2 启动前文档化 migration |
| **跨平台一致性**：CLI bridge propose 后 mobile/web-shell 都能签？ | core-multisig 是 transport-agnostic，proposal store 是 shared SQLite，自然同步 | 0 |
| **Q-COMP-3 法律 sign-off 推迟到 Layer 3** | Layer 1+2 纯链下，与法律无关 | Layer 3 issue 单独开时再处理 |
| **marketplace.purchase 与 crosschain.bridge.outbound 同时进行 sweep**？ | 两 domain 独立 policy，互不影响 | 0 |

---

## 6. 下一步

1. **用户审视本 spike** — 同意三层分解 + Layer 1 PR 拆法
2. 批 Layer 1 — 4 PR 顺序 land（CLI / web-shell handler / UI / docs）
3. Layer 2 开新 spike doc（依赖 Layer 1 落地后的实际 envelope shape）
4. Layer 3 开独立 GA 后续 scope issue（external sign-off chain）

