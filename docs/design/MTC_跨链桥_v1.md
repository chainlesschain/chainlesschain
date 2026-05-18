# MTC 跨链桥设计 v1

> 版本：v0.1（跨链桥首版草案）
> 日期：2026-05-02
> 作者：longfa
> 状态：**草案 / Draft** — 关闭 `默克尔树证书_MTC_落地方案.md` §12 第 6 项「跨链桥的 MTC 化留给独立设计文档」
> 关联：
> - 上层方案：`docs/design/默克尔树证书_MTC_落地方案.md`
> - 数据格式：`docs/design/MTC_数据格式_v1.md`
> - 联邦治理：`docs/design/MTC_联邦治理_v1.md`
> - 现有跨链 CLI：`packages/cli/src/lib/cross-chain.js` + `packages/cli/src/commands/crosschain.js`（19 子命令）
> - 跨链原始设计：`docs/design/modules/54_跨链互操作协议.md`（如存在）
>
> **本文档定位**：把 MTC envelope 嵌入跨链消息 / 桥操作的协议设计。本期不实现 RPC 链适配器（仍 desktop-only），只规范化 envelope 结构 + 桥两侧 MTCA 互信模型 + 与 `cc crosschain` 集成点。

---

## 1. 背景与动机

现有 `cc crosschain` 实现的桥模型（commit `Phase 89`）：
- 5 链支持（ethereum / polygon / bsc / arbitrum / solana）
- AssetBridge: `pending → locked → minted → completed`（lock-mint）
- AtomicSwap: HTLC 5 状态（initiated / hash_locked / claimed / refunded / expired）
- CrossChainMsg: 任意 payload 跨链发送
- 启发式费用估算（无真实 gas oracle）

**当前信任问题**：

1. **桥消息真实性靠链上中继合约**：现状假设 source-chain 上 `BridgeContract.lockEvent` + destination-chain 上 `RelayerOracle` 共同保证。但 oracle 节点本身可能被 censorship / 共谋。
2. **HTLC 不解决"消息内容是否被 MTCA 背书"**：原子性靠密码学，但消息本身不可用 MTC 验证。
3. **跨链 DID 操作无统一证明**：A 链上 DID-A 想向 B 链上 DID-B 转移技能 / 撤销授权时，B 链 verifier 没有标准方式验证 A 链 DID 的当前状态。

**MTC 化的核心收益**：

1. 桥两侧节点可以独立验证消息背后的 MTC envelope，不依赖 oracle 单点
2. 历史可审计：每条跨链消息都可追溯到一个被 MTCA 多签锚定的 batch
3. 与现有 DID / Skill 的 MTC 化无缝衔接（同一套 verifier）

---

## 2. 与上层方案的关系

| 现有 MTC 概念 | 跨链桥使用方式 |
|---|---|
| MTCA（单 / 联邦） | 桥两侧各部署一个 MTCA（或共享一个联邦 MTCA） |
| Tree (kind, scope) | 新增 kind = `bridge`；scope = `<src-chain>:<dst-chain>` |
| Batch | 跨链消息打入桥 MTCA 的 batch，Landmark 锁定一段时间窗内的所有消息 |
| Envelope（per leaf） | 每条跨链消息打成一个 envelope，含 inclusion proof + landmark 路径 |
| Federation | §6 三种互信模式都基于现有 federation 机制 |

**不引入新协议字段**——只新增 kind + 跨链专用 envelope 内层结构。

---

## 3. 设计原则

1. **桥协议层与 MTC 层正交**：现有 lock-mint / HTLC 流程不变，MTC 是**附加证明**（attached proof），不是替代品。
2. **两侧 MTCA 独立可验证**：destination-chain verifier 拿到 envelope + landmark 后必须能脱机完成验证（不需要查 source-chain）。
3. **Landmark 用 IPFS 分发**：与现有 MTC landmark 同一套 IPFS pinning 机制，桥不引入新分发通道。
4. **失败可回滚**：MTC 验证失败时，桥协议层走原有 refund 路径（不因为 MTC 缺失而吞钱）。
5. **延迟可接受**：桥延迟 batch close 时间，最低 60 秒（短窗 batch），符合 §10.1 现有 audit-mtc 短窗模式。
6. **算法异构透明**：source-chain MTCA 用 Ed25519、destination-chain MTCA 用 SLH-DSA-128F，envelope 内 alg 字段标明，verifier 多算法 dispatcher 自动处理。

---

## 4. 整体架构

```
                ┌─────────────────────────────────────────┐
                │            Source Chain (A)             │
                │   AssetBridge.lock() → BridgeMTCA-A     │
                │     ↓ batch every 60s                   │
                │   Landmark-A (signed by MTCA-A)         │
                └─────────────────────────────────────────┘
                                  │
                                  │ IPFS pin (landmark + envelopes)
                                  ↓
                ┌─────────────────────────────────────────┐
                │              Verifier Anywhere          │
                │   (destination chain relayer / wallet / │
                │    third-party auditor — 全部 stateless) │
                └─────────────────────────────────────────┘
                                  │
                                  ↓
                ┌─────────────────────────────────────────┐
                │         Destination Chain (B)           │
                │   BridgeContract.mint(envelope, proof)  │
                │     ↓ verify envelope                   │
                │   BridgeMTCA-B records mint event       │
                │     ↓ batch every 60s                   │
                │   Landmark-B (signed by MTCA-B)         │
                └─────────────────────────────────────────┘
```

- **BridgeMTCA-A** 与 **BridgeMTCA-B** 可以是：
  - 完全独立的两个 MTCA（§6 Independent 模式）
  - 同一个联邦的两个成员（§6 Federated 模式）
  - 互为轻客户端（§6 Light Client 模式）

---

## 5. 数据模型

### 5.1 跨链消息 envelope

```json
{
  "schema": "mtc-bridge-envelope/v1",
  "namespace": "mtc/v1/bridge/eth-polygon/000142",
  "payload": {
    "bridge_op": "lock | mint | refund | swap-init | swap-claim | swap-refund | msg-send",
    "src_chain": "ethereum",
    "dst_chain": "polygon",
    "src_tx_hash": "0x...",
    "dst_tx_hash": "0x... | null",
    "amount": "string (wei / lamports / unit-of-chain)",
    "asset": "string (token symbol or contract addr)",
    "src_did": "did:cc:... | null",
    "dst_did": "did:cc:... | null",
    "swap_id": "uuid | null",
    "msg_payload": "base64url | null",
    "issued_at": "RFC 3339 UTC"
  },
  "leaf_hash": "sha256:...",
  "inclusion_proof": {
    "tree_size": 142,
    "leaf_index": 87,
    "audit_path": ["sha256:...", "..."]
  },
  "landmark_ref": {
    "namespace": "mtc/v1/bridge/eth-polygon/000142",
    "ipfs_cid": "bafy..."
  },
  "signature_alg_hint": "ed25519 | slh-dsa-128f | federation"
}
```

### 5.2 namespace 规则（与 `MTC_数据格式_v1.md` §2 一致 + 跨链专属）

```
namespace ::= "mtc/v1/bridge/" <chain-pair> "/" <batch-seq>
chain-pair ::= <chain-id> "-" <chain-id>             ; 字典序
chain-id   ::= "ethereum" | "polygon" | "bsc" | "arbitrum" | "solana" | <future>
```

合法：
- `mtc/v1/bridge/ethereum-polygon/000001`
- `mtc/v1/bridge/arbitrum-bsc/000042`

非法（必须拒绝）：
- `mtc/v1/bridge/polygon-ethereum/000001`（chain-pair 必须字典序）
- `mtc/v1/bridge/eth-polygon/000001`（必须用全名 chain-id）

字典序约定避免同一对链产生两个 namespace（`A-B` 与 `B-A` 是同一棵树）。

### 5.3 landmark 与 §11.6 的关系

跨链 landmark 复用 `default 默克尔树证书_MTC_落地方案.md` §11.6 描述的 IPFS topic 订阅：

```
mtc-landmark/bridge/ethereum-polygon
mtc-landmark/bridge/arbitrum-bsc
```

各链上的 verifier 节点订阅自己关心的 chain-pair。

---

## 6. 桥两侧 MTCA 互信模型

三种模式可选，由桥运营方根据信任假设选择：

### 6.1 Independent（独立模式）— 推荐用于公共桥

- BridgeMTCA-A 和 BridgeMTCA-B 是两个**完全独立**的 MTCA
- 各自独立打 batch、签 landmark
- destination-chain mint 时验证 source-chain landmark：需要 destination-chain 的 verifier 显式信任 source-chain 的 MTCA 公钥（trust anchor 配置）
- **优点**：故障隔离最好，一侧被攻陷不影响另一侧
- **缺点**：trust anchor 管理负担在 verifier 侧（每对桥都要配两个公钥）

### 6.2 Federated（联邦模式）— 推荐用于企业 / 联盟链桥

- BridgeMTCA-A 和 BridgeMTCA-B 是**同一个联邦**的两个成员（M-of-N 多签）
- 跨链消息的 envelope 由联邦多签 landmark 锚定
- destination-chain verifier 只需信任**一个**联邦 ID（不分 A / B 侧）
- **优点**：trust anchor 管理简化；联邦治理（见 `MTC_联邦治理_v1.md`）天然适用
- **缺点**：联邦内任一成员故障可能影响 threshold；需要 §3 联邦治理规则

### 6.3 Light Client（轻客户端模式）— 推荐用于双向高频桥

- BridgeMTCA-A 维护一份 BridgeMTCA-B 的 landmark cache（反之亦然）
- 跨链消息的 envelope 含**反向锚定**：A→B 的消息在 envelope 内嵌入 B 侧最新 landmark 的 hash（freshness proof）
- destination-chain mint 时只需验证：(a) source landmark 真实，(b) freshness proof 指向 destination 自己最近 N 个 landmark 之一
- **优点**：抗 long-range fork（新 verifier 启动也能快速建立信任）
- **缺点**：实现复杂度最高；landmark cache 同步带宽开销

### 6.4 模式选择决策表

| 场景 | 推荐模式 | 理由 |
|---|---|---|
| 公共 ETH ↔ Polygon 桥 | Independent | 两侧运维主体不同 |
| 企业内多链统一桥 | Federated | 同一治理主体 |
| 高频 + 抗 fork 需求（如 DEX 跨链聚合） | Light Client | 需要 freshness 保证 |
| 测试 / 开发 | Independent | 配置最简单 |

---

## 7. 与现有 `cc crosschain` 的集成点

### 7.1 新增 CLI 子命令

```
cc crosschain mtc-envelope <bridge-id>          # 生成桥操作的 MTC envelope
cc crosschain mtc-verify <envelope-path>        # 客户端验证
cc crosschain mtc-batch                         # 触发桥 MTCA 关批
cc crosschain mtc-status                        # 桥 MTCA 状态（active alg / batch interval / pending count）
cc crosschain mtc-trust-anchor add <chain> <pubkey>     # 配置 Independent 模式 trust anchor
cc crosschain mtc-trust-anchor list
```

### 7.2 现有命令的 MTC opt-in flag

```
cc crosschain bridge <from> <to> <amt> [--mtc]                  # 默认 false；true 时 lock 操作触发 MTC envelope 生成
cc crosschain swap <from> <to> <amt> [--mtc]                    # 同上
cc crosschain send <from> <to> [--payload <p>] [--mtc]
cc crosschain bridge-status <id> <status> [--mtc-envelope <p>]  # 状态推进时附带对方链的 MTC envelope 验证
```

### 7.3 现有 bridge 生命周期不变

```
pending → locked → minted → completed       # MTC envelope 在 locked / minted / completed 三个节点生成
pending → failed                             # MTC envelope 标记 op = "refund"
locked → refunded                            # MTC envelope 标记 op = "refund"，retain 历史 lock envelope
```

### 7.4 与 `core-mtc` 的内部接口

跨链桥 MTC envelope 生成走与 `cc mtc batch-dids` / `batch-skills` 同一条 `assembleBatch` 装配代码（`packages/core-mtc/lib/batch.js`），仅 leaves 来源不同：

```js
// packages/cli/src/lib/cross-chain.js
const { assembleBatch } = require("@chainlesschain/core-mtc/batch");

function assembleBridgeBatch(bridgeOps, key, opts) {
  const leaves = bridgeOps.map(op => ({
    namespace: bridgeNamespace(op.src_chain, op.dst_chain, opts.batch_seq),
    payload: op,
  }));
  return assembleBatch(leaves, key, { kind: "bridge", ...opts });
}
```

---

## 8. 失败模式与回滚

| 失败模式 | 影响 | 回滚策略 |
|---|---|---|
| Source-chain MTCA 离线 | 新 lock 操作无 MTC envelope，但桥协议本身仍工作（`--mtc=false` 默认） | 桥协议层走原有路径，MTC envelope 在 MTCA 恢复后补打（per-op `pending_mtc=true` flag） |
| Destination-chain verifier 拒绝 envelope | mint 操作失败 | 桥协议层走 §7.3 `failed` / `refunded` 路径 |
| Landmark IPFS pin 丢失 | envelope 无法验证（孤儿） | 桥 MTCA 必须在 IPFS 之外保留本地 landmark 拷贝；verifier 可向 MTCA 直接 fetch（HTTP fallback） |
| Federation threshold 不满足（Federated 模式） | 当批次 landmark 不签发 | 桥进入降级模式，临时改为 Independent；同时触发 `MTC_联邦治理_v1.md` §4.3 Dispute |
| Freshness proof 过期（Light Client 模式） | mint 拒绝 | source-chain 必须等下一个 landmark 同步后重发 envelope |

---

## 9. 安全分析

### 9.1 威胁模型

- **T1: Source-chain oracle 共谋伪造跨链消息** — 现有 oracle 模型唯一信任锚就是中继合约，无法防御。
  - **MTC 缓解**：destination-chain 必须 verify envelope；oracle 即使提交假消息，无对应有效 envelope 则 mint 失败。

- **T2: MTCA 私钥泄漏伪造 batch** — 与现有 MTC 单 MTCA 模型同样威胁。
  - **MTC 缓解**：用 §6.2 Federated 模式 + `MTC_联邦治理_v1.md` §7.4 强制 revoke 流程。

- **T3: Long-range fork attack** — 新 verifier 拿到老的恶意 landmark。
  - **MTC 缓解**：用 §6.3 Light Client 模式 + freshness proof。

- **T4: Replay attack（同一 envelope 在两条链上 mint 两次）** — 跨链桥经典威胁。
  - **MTC 缓解**：envelope.payload 含 src_tx_hash + dst_tx_hash；destination-chain MTCA 维护已 mint 的 src_tx_hash 集合，重复 envelope 拒绝。

- **T5: Censorship（中继不转发某些 envelope）** — 现有桥模型无法检测。
  - **MTC 缓解**：landmark 公开发布在 IPFS，第三方审计员可发现"source 已 lock 但 destination 未 mint"的差异。

### 9.2 与单链 MTC 的安全性对比

跨链 MTC 在多数维度等价于单链 MTC（基于同一套 RFC 6962 + JCS + Ed25519/SLH-DSA），额外强化点：
- T1 / T5 是跨链特有威胁，MTC 提供新的检测能力
- T2 / T3 / T4 与单链威胁同源，缓解策略相同

新风险：
- **链间时钟漂移**：envelope.issued_at 在两条链 verifier 上的时序判定可能不一致。本文档要求 verifier 容忍 ± 5 分钟时钟差，超出视为 envelope 无效。
- **链间 finality 差异**：source-chain `locked` 状态可能因 reorg 失效，但 MTC envelope 已签。本文档要求桥 MTCA 必须等待 source-chain finality（ETH 12 块、Polygon 256 块、BSC 15 块、Arbitrum 1 块、Solana 32 slots）后再纳入 batch。

---

## 10. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| envelope schema 命名空间 | `mtc/v1/bridge/<chain-pair>/...` 字典序 | `<src>-<dst>` 方向 | 字典序避免同一对链产生两棵树 |
| 桥 batch 间隔默认 | 60 秒 | 1 小时 / 24 小时 | 跨链业务对延迟敏感；与 audit-mtc 短窗模式对齐 |
| 默认互信模式 | Independent | Federated | trust anchor 配置一次即可，故障隔离最好；公共桥首选 |
| 链 finality 等待 | 各链原生 finality | 统一 N=64 块 | 各链 finality 差异巨大（ETH 12 vs Solana 32 slots），统一会显著拉慢快链 |
| 时钟容忍 | ± 5 分钟 | ± 30 秒 / ± 1 小时 | 与 `MTC_数据格式_v1.md` §5 timestamp 容忍策略对齐 |
| Replay 防护层 | destination MTCA 维护已 mint 集合 | source-chain 嵌入 nonce | destination 侧防护更强（攻击者无法绕过）|
| MTC 化是 opt-in 还是默认 | opt-in（`--mtc` flag） | 默认 on | Phase 1 先共存，验证稳定后 v0.2 切换默认 on |

---

## 11. 后续工作

1. **真实 RPC 链适配器**（仍 NOT done — 外部依赖 desktop 侧大工程）：本文档假设桥 MTCA 能拿到 source-chain finality 信息。需要在 desktop-app-vue 侧补充 RPC 链适配器（与 `crossChainBridge.ts` Pinia store 配合）+ 5 链的 endpoints 接入 + 集成测试矩阵 才能切默认 on。CLI 侧仍是 simulated。**预计解锁条件**：desktop ethers/web3 集成专项 + chain endpoint 商务接入。
2. **Cross-chain DID 解析**（schema 就绪 / 生产路径待解锁）：A 链上 DID-A 在 B 链 verifier 端如何解析为可信公钥 — schema 已与 `MTC_联邦治理_v1.md` v0.11 cross-federation 互信合并（`SCHEMA_CROSS_FED_TRUST_ANCHOR`），生产路径阻塞同 #1。
3. ~~**多跳桥（A → B → C）**~~ — **已完成（v0.11，commit `b312563f0`）**。`SCHEMA_MULTI_HOP_BRIDGE = "mtc-bridge-multihop/v1"` + `buildMultiHopBridgeEnvelope` 强制 chain 连续性 (`leg[i].dst_chain == leg[i+1].src_chain`) + `verifyMultiHopBridgeEnvelope` per-leg 验证。CLI: `cc crosschain mtc-multihop-build/-verify`。
4. ~~**gas-aware batch 触发**~~ — **已完成（v0.11，commit `b312563f0`）**。`shouldCloseBatchGasAware` 启发式：staged ≥ 50 hard-close / current_gas > baseline×1.5 defer / 否则 close。CLI: `cc crosschain mtc-gas-check <chain> --staged-count [--current-gas-usd]`。
5. ~~**桥操作监控 dashboard**~~ — **已完成（v0.11，commit `b312563f0`）**。`Mtc.vue` 跨链桥 tab 新增 "SLA / Monitoring" 卡片 4 统计（status / staged / batches/h / last batch）+ 30s 自动 poll `cc crosschain mtc-sla --json`，可纳入外部 Prometheus / Grafana。
6. ~~**与 SLA Manager 集成**~~ — **已完成（v0.11，commit `b312563f0`）**。`getBridgeMtcSlaMetrics` 输出 `cc sla` 兼容形状（sla_status: ok|degraded|down）+ CLI `cc crosschain mtc-sla [--json]`。

---

## 附录 A — 术语表

| 术语 | 定义 |
|---|---|
| 桥 MTCA (BridgeMTCA) | 专为跨链桥部署的 MTCA，namespace = `mtc/v1/bridge/<chain-pair>/...` |
| chain-pair | 字典序排列的两条链 ID 组合，如 `ethereum-polygon` |
| Freshness proof | Light Client 模式中 envelope 嵌入对方链最近 landmark 的 hash 引用 |
| Trust anchor | destination-chain verifier 信任的 source-chain MTCA 公钥（Independent 模式） |
| Replay set | destination MTCA 维护的"已 mint 过的 src_tx_hash"集合 |
| Reorg-safe finality | 各链原生 finality 块数（ETH 12、Polygon 256、BSC 15、Arbitrum 1、Solana 32 slots） |

---

## 附录 B — 参考资料

- `docs/design/默克尔树证书_MTC_落地方案.md`
- `docs/design/MTC_数据格式_v1.md`
- `docs/design/MTC_联邦治理_v1.md`
- `packages/cli/src/lib/cross-chain.js` — 现有桥实现（CLI port，44 tests）
- `packages/cli/src/commands/crosschain.js` — 19 子命令
- memory: `cross_chain_cli` (Phase 89 跨链互操作协议 CLI port 纪录)
- IETF `draft-ietf-plants-merkle-tree-certs-02` §7 (Trust Anchor 跨域应用)
- 经典桥协议参考：IBC（Cosmos）、Polkadot XCMP、LayerZero
