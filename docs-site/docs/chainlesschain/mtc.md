# 默克尔树证书 (MTC) — 后量子签名压缩 + 联邦治理

> **版本: v0.11 (Phase 0–4 全量落地, 2026-05-03) | 状态: ✅ 生产就绪 | 476 测试 / 6 层 | 30+ CLI 子命令 | 4 种传输 + libp2p auto-discovery | 异构 Ed25519 + SLH-DSA-128F 成员**
>
> 借鉴 IETF PLANTS WG 的 [Merkle Tree Certificates](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/) 协议（与 Cloudflare + Google Chrome 联合推进的 HTTPS 后量子方案同源），把 PQC 切换后单证书 17 KB 暴涨问题压回 ~700 B —— **节省约 97%**；并在此之上叠加联邦 MTCA M-of-N 多签 + 链下治理日志 + 跨联邦互信锚 + 链上 governance-anchor。

## 概述

ChainlessChain 已经从 Ed25519 全面迁向后量子安全签名（FIPS 205 / SLH-DSA-128f）。但单条 SLH-DSA 签名 ≈ 17 KB，DID 文档每周更新一次会让 P2P DHT 流量从 5 GB 暴涨到 170 GB（10K 用户规模）—— 不可接受。

**默克尔树证书（MTC）** 通过批量签发 + RFC 6962 Merkle 树 + inclusion proof 解决：N 张证书共用一棵树，CA 只对树根（tree head）签**一次**。每条证书携带物 = 1 个签名（共享）+ 1 个公钥（共享）+ 1 个 inclusion proof（每条 ~450 B）。

| 场景                   | 朴素 SLH-DSA-128f | MTC（每 envelope） | 节省 |
| ---------------------- | ----------------- | ------------------ | ---- |
| 单 DID 文档            | ~17 KB            | ~700 B             | 96%  |
| 1 K 批次               | ~17 MB            | ~700 KB            | 96%  |
| 8 K 批次               | ~136 MB           | ~5.6 MB            | 96%  |
| DHT 周流量（10K 用户） | ~170 GB           | ~3 GB              | 98%  |

**当前状态**：树头签名支持双算法 —— `--alg ed25519`（默认，小签名 + 经典 128 位安全）与 `--alg slh-dsa-128f`（FIPS 205 后量子 128 位安全，via `@noble/post-quantum@0.6.1`）。同一联邦内成员可异构，单棵树的 threshold 计票按"有效签名"汇总，不区分算法。

**v0.11 的"联邦"形态**：不再是单一 MTCA 私钥签发；而是 N 个独立 MTCA 节点共同签同一棵树（M-of-N multi-sig，`assembleBatchFederated`），通过链下 `governance.log`（每事件单独签名，dedup by event_id，按时间序回放）来管理"谁能签、何时签、怎么撤、怎么 fork/merge"。任何成员变更必须产出有签名的治理事件，否则 verifier 拒绝该联邦的新 landmark。

## 核心特性

- 🌳 **RFC 6962 兼容树**: 域分离前缀（`0x00` leaf / `0x01` node）防签名重放，与 IETF MTC + Certificate Transparency 完全对齐
- 📦 **批量签发**: N 张证书一棵树，CA 一次签名；`MerkleTree` 类 O(log n) 取证 + 子树根 memo
- 📜 **JCS 规范化**: RFC 8785 — 两个独立实现按规范构造的 envelope 必须**逐字节相同**
- 🔐 **双签名算法**: Ed25519（@noble/curves 1.9.7）+ SLH-DSA-128f（@noble/post-quantum 0.6.1，FIPS 205）；可单独使用，也可联邦内异构共存
- 🛡️ **Split-view 防御**: `LandmarkCache.ingest()` 在 namespace + tree_size 相同时强制 root_hash 一致；不一致即 `MTCA_DOUBLE_SIGNED` 拒绝 + 告警
- 💾 **磁盘持久化**: `LandmarkCache.persistDir` + `loadFromDisk()` 启动时重新校验，篡改文件自动跳过
- 🌐 **4 种传输**: InMemory / Filesystem drop-zone / Libp2p direct (TCP+Noise+Yamux) / Libp2p gossipsub
- 🔭 **服务发现 (Phase 3.3)**: `cc mtc federation discover` 通过 filesystem 或 libp2p gossipsub 自动接收成员 announce，`FederationAnnounceCache` 验签 + TTL 失效
- 🏛️ **联邦 M-of-N 多签 (Phase 3)**: `assembleBatchFederated(leaves, signers, threshold)`，单棵树多个独立 MTCA 共同签发；`LandmarkCache` ≥ M-of-N 验证 + pubkey-id 去重；threshold 计票不区分 Ed25519 / SLH-DSA-128F
- 📝 **链下治理日志 (Phase 4)**: `federation/governance.log` 一行一事件，每事件独立签名；事件类型 invite / vote / revoke / rotate-key / threshold-change / fork / merge / cross-trust-create / audit-emit；dedup by `event_id`，按 `issued_at` 排序回放
- 🔄 **跨成员 governance.log 同步 (v0.8)**: `governance-sync-libp2p` 守护进程 + filesystem drop-zone 双路径；`dedupeEventsByEventId` + `sortEventsChronologically` + `verifyGovernanceLog`；多节点视图最终一致
- 🚦 **Quorum 门控 (v0.9)**: `confirm-*` 子命令 pre-flight 检查"有效投票数 ≥ threshold"，不达标拒签；`--no-quorum-check` 显式 bypass 用于紧急情况
- 🌉 **跨联邦互信锚 (v0.3 治理)**: `cross-trust-create` 让联邦 A 显式背书联邦 B 的成员名单 + threshold 快照；支持 multi-hop 信任路径；`validateCrossFederationTrustAnchor` 校验签名链
- 🔍 **离线审计器 (v0.3 治理)**: `auditGovernanceLog(events, opts)` 纯函数离线复盘整条治理日志；输出 violations + recommendations，不依赖网络
- ⛓️ **链上 governance-anchor (v0.3 治理 / Q-COMP-3 已解锁 2026-05-03)**: `computeGovernanceSnapshotHash` + `buildGovernanceAnchorRecord` + `verifyGovernanceAnchor`；`InMemoryChainAnchorClient` / `FilesystemChainAnchorClient` 抽象，可对接真实链
- 📜 **Marketplace 守护进程 (Phase 2)**: `cc mtc publish-skills` 自动监控本地技能目录，按指纹 diff 自动递增 batch-seq，状态文件可被 `publish-status` 检视
- 🛂 **审计 MTC 双轨 (Phase 2)**: `cc audit mtc {emit,reconcile,reconcile-check,status,enable,disable,config,set-interval}`，off-by-default；产线启用仅需 1 行 flag-flip 等 Q-COMP-1/Q-COMP-2 法务出函
- 🌐 **跨链桥集成 (新增)**: `cc crosschain mtc-batch / mtc-status` 把 MTC 树头作为跨链证明随消息上链；bridge MTCA 守护进程
- 🖥️ **桌面 V6 widget**: governance sync-stats / multi-proposal CRDT picker；Web Panel `Mtc.vue` 操作型治理 tab；签名密钥仍 CLI-only
- 🔌 **可插拔签名验证器**: `signatureVerifier` DI；core-mtc 零密码学硬依赖（除 SHA-256 / Ed25519 / SLH-DSA 算法实现）
- 🚦 **服务守护**: `cc mtc serve` 订阅 + 持久化 + 自动验证 + SIGINT 清理；`cc mtc federation governance-sync-serve` 长跑治理同步守护进程
- 🏛️ **Verifier 纯函数**: 零网络、零状态，纯 hash 计算
- 📑 **8 种核心错误码**: `LANDMARK_MISS / LANDMARK_EXPIRED / ROOT_MISMATCH / BAD_TREE_HEAD_SIG / BAD_PROOF_INDEX / BAD_PROOF_LENGTH / PROOF_TREE_SIZE_MISMATCH / MTCA_DOUBLE_SIGNED`，加上联邦层 `INSUFFICIENT_SIGNATURES / DUPLICATE_PUBKEY / UNKNOWN_FEDERATION_MEMBER`
- 🎯 **3 种 leaf 类型**: `did-document` / `skill-manifest` / `audit-event`（audit 端到端可用，但产线 emit 默认关闭）

## 系统架构

```
┌────────────────────────────────────────────────────────────────────────┐
│  Producer (MTCA) — 单签 or 联邦 M-of-N                                  │
│                                                                        │
│  Source ─┬─→ DID DB (cc mtc batch-dids)                                │
│          ├─→ Local skills (cc mtc batch-skills / publish-skills daemon)│
│          ├─→ JSON file (cc mtc batch <input>)                          │
│          └─→ Audit events (cc audit mtc emit, off-by-default)          │
│                          ↓                                             │
│           ┌──────────── core-mtc ────────────┐                         │
│           │ jcs(leaf) → SHA-256 (LEAF_PREFIX) │                         │
│           │  → leafHashes[]                   │                         │
│           │  → MerkleTree(leafHashes)         │                         │
│           │  → root + inclusion proofs        │                         │
│           │                                    │                        │
│           │ tree_head ← {namespace, tree_size,│                         │
│           │   root_hash, issued/expires_at,   │                         │
│           │   issuer}                          │                        │
│           │                                    │                        │
│           │ Sign 路径 1（单签）:                │                         │
│           │   alg ∈ {Ed25519, SLH-DSA-128f}    │                        │
│           │   sig = Sign(prefix ‖ jcs(head))  │                         │
│           │                                    │                        │
│           │ Sign 路径 2（联邦 M-of-N）:          │                         │
│           │   assembleBatchFederated(leaves,  │                         │
│           │     signers[], threshold)          │                        │
│           │   landmark.snapshots[0].signatures │                        │
│           │     = [{alg, issuer, sig, ...}]×N  │                        │
│           │                                    │                        │
│           │ landmark = {schema, snapshots: [{ │                         │
│           │   tree_head, tree_head_id,        │                         │
│           │   signature(s)}], trust_anchors,  │                         │
│           │   federation_id?, threshold?,     │                         │
│           │   publisher_signature}            │                         │
│           │                                    │                        │
│           │ envelope[i] = {leaf, inclusion_   │                         │
│           │   proof: {leaf_index, audit_path, │                         │
│           │   tree_size}, tree_head_id}       │                         │
│           └────────────────────────────────────┘                        │
│                          ↓                                             │
│           Transport.publish(landmark)                                  │
└─────────────────────────┬─────────────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┬──────────────────┐
            ↓             ↓             ↓                  ↓
        InMemory      Filesystem     Libp2p            Libp2p
        (broker)      drop-zone      direct           gossipsub
                       (LAN/USB)    (TCP+Noise)        (topic
                                    + identify)        routing +
                                                       auto-disco)
            └─────────────┼─────────────┴──────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────────────────┐
│  Verifier (cc mtc serve / cc mtc verify / cc mtc federation audit)     │
│                                                                        │
│  Transport.subscribe(prefix) → on landmark:                            │
│    LandmarkCache.ingest():                                             │
│      ✓ schema check                                                    │
│      ✓ tree_head_id = sha256(jcs(tree_head)) match                     │
│      ✓ Signatures: 每条 signatureVerifier(prefix‖canonical, sig)        │
│      ✓ M-of-N: 有效签名数 ≥ threshold（联邦模式）                       │
│      ✓ Pubkey-id 去重（防一人多签作弊）                                │
│      ✓ Split-view: namespace+tree_size → root_hash unique              │
│      ✓ Persist to disk (optional)                                      │
│                                                                        │
│  verify(envelope, cache) → pure function:                              │
│    leafHash = SHA-256(LEAF_PREFIX ‖ jcs(leaf))                         │
│    computed = computeRootFromPath(leafHash, leaf_index,                │
│                                   tree_size, audit_path)               │
│    return computed == cached_tree_head.root_hash                       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  Federation Governance (cc mtc federation governance-* / audit)        │
│                                                                        │
│  governance.log (one event per line, JSON, signed independently):      │
│    {schema:"mtc-federation-governance/v1", event_id, type,             │
│     federation_id, issued_at, payload, signature}                      │
│                                                                        │
│  Sync paths:                                                           │
│    ① governance-publish → drop-zone / libp2p gossipsub                 │
│    ② governance-pull   ← drop-zone / libp2p gossipsub                  │
│    ③ governance-sync-serve = ①+② 长跑守护                              │
│                                                                        │
│  Local replay:                                                         │
│    dedupeEventsByEventId → sortEventsChronologically                   │
│      → replayGovernanceLog → 当前成员名单 + threshold + 状态           │
│                                                                        │
│  Cross-fed trust:                                                      │
│    cross-trust-create → 联邦 A 签发 trust anchor 背书联邦 B            │
│    validateCrossFederationTrustAnchor → 校验整条信任链（multi-hop）    │
│                                                                        │
│  On-chain anchor (Q-COMP-3):                                           │
│    governance-anchor → buildGovernanceAnchorRecord 上链                │
│    governance-verify-anchor → verifyGovernanceAnchor 链上比对          │
└────────────────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块                     | 路径                                              | 职责                                                                           |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `MerkleTree`             | `lib/merkle.js`                                   | RFC 6962 树构造 + 取证 + 验证（O(log n) prove，子树根 memo）                   |
| `Verifier` (`verify`)    | `lib/verifier.js`                                 | 纯函数 envelope 验证，按错误码返回结果                                         |
| `LandmarkCache`          | `lib/landmark-cache.js`                           | 内存 + 磁盘双层缓存，split-view 防御，M-of-N 阈值校验                          |
| `assembleBatch`          | `lib/batch.js`                                    | 单签批次组装（leaves + key + meta → landmark + envelopes）                     |
| `assembleBatchFederated` | `lib/batch.js`                                    | 联邦 M-of-N 批次组装（threshold + signers[]）                                  |
| `Ed25519Signer`          | `lib/signers/ed25519.js`                          | Ed25519 树头签名 + verifier factory（@noble/curves）                           |
| `SlhDsaSigner`           | `lib/signers/slh-dsa.js`                          | SLH-DSA-128F 树头签名 + verifier factory（@noble/post-quantum，FIPS 205）      |
| `JCS`                    | `lib/jcs.js`                                      | RFC 8785 规范化 JSON 包装（依赖 `canonicalize` 包）                            |
| `Transports`             | `lib/transports/{in-memory,filesystem,libp2p}.js` | 4 种 publish/subscribe 后端                                                    |
| `Federation`             | `lib/federation.js`                               | 成员 announce schema + `FederationAnnounceCache`（TTL + 验签）                 |
| `FederationGovernance`   | `lib/federation-governance.js`                    | 治理事件 schema + create/verify/replay + cross-trust + audit + on-chain anchor |
| `cc mtc` 命令            | `packages/cli/src/commands/mtc.js`                | 30+ 子命令薄包装                                                               |

### 数据格式（关键字段）

**Envelope**:

```json
{
  "schema": "mtc-envelope/v1",
  "namespace": "mtc/v1/did/000142",
  "tree_head_id": "sha256:base64url(...)",
  "leaf": { "kind": "did-document", "subject": "...", "content_hash": "..." },
  "inclusion_proof": { "leaf_index": 7, "tree_size": 256, "audit_path": [...] },
  "fallback_signature": null
}
```

**Landmark — 单签**:

```json
{
  "schema": "mtc-landmark/v1",
  "namespace": "mtc/v1/did",
  "snapshots": [{
    "tree_head": { "tree_size": 256, "root_hash": "sha256:...", "issuer": "...", "issued_at": "...", "expires_at": "..." },
    "tree_head_id": "sha256:...",
    "signature": { "alg": "Ed25519", "issuer": "...", "sig": "...", "pubkey_id": "sha256:..." }
  }],
  "trust_anchors": [{ "issuer": "...", "alg": "Ed25519", "pubkey_id": "...", "pubkey_jwk": {...} }],
  "publisher_signature": { ... }
}
```

**Landmark — 联邦 M-of-N**:

```json
{
  "schema": "mtc-landmark/v1",
  "namespace": "mtc/v1/skill",
  "federation_id": "fed:cc:enterprise-skills-001",
  "threshold": 2,
  "snapshots": [{
    "tree_head": { ... },
    "tree_head_id": "sha256:...",
    "signatures": [
      { "alg": "Ed25519",        "issuer": "mtca:cc:fed:m1", "sig": "...", "pubkey_id": "sha256:..." },
      { "alg": "SLH-DSA-128F",   "issuer": "mtca:cc:fed:m2", "sig": "...", "pubkey_id": "sha256:..." },
      { "alg": "Ed25519",        "issuer": "mtca:cc:fed:m3", "sig": "...", "pubkey_id": "sha256:..." }
    ]
  }],
  "trust_anchors": [ /* 每成员一条 */ ],
  "publisher_signature": { ... }
}
```

**Governance Event** (`federation/governance.log` 一行一条):

```json
{
  "schema": "mtc-federation-governance/v1",
  "event_id": "sha256:...",
  "type": "invite | vote | propose-revoke | confirm-revoke | rotate-key | propose-threshold | confirm-threshold | fork | merge | cross-trust-create | audit-emit",
  "federation_id": "fed:cc:enterprise-skills-001",
  "issued_at": "2026-05-03T00:00:00Z",
  "payload": {
    /* type-specific */
  },
  "signature": {
    "alg": "Ed25519",
    "issuer": "mtca:cc:fed:m1",
    "sig": "...",
    "pubkey_id": "sha256:..."
  }
}
```

完整字节级规范见 [`MTC_数据格式_v1.md`](https://design.chainlesschain.com/mtc-data-format-v1) 与 [`MTC_联邦治理_v1.md`](https://design.chainlesschain.com/mtc-federation-governance-v1)。

## 配置参考

### `cc mtc batch-dids` / `batch-skills` / `batch` 共用选项

| 选项                            | 必填                  | 说明                                                                                                   |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `--namespace <ns>`              | ✅                    | 形如 `mtc/v1/did/000001`（kind/scope/batch-seq）                                                       |
| `--issuer <issuer>`             | ✅（单签）            | MTCA 标识，如 `mtca:cc:zQ3sh...`；联邦模式下被 federation-level issuer 覆盖                            |
| `--alg <ed25519\|slh-dsa-128f>` | ❌                    | 签名算法（默认 ed25519）                                                                               |
| `--secret-key-file <path>`      | ❌                    | 单签密钥 hex 文件，复用以保持信任锚稳定（mode 0600）                                                   |
| `--federation <id>`             | ❌                    | 启用联邦 M-of-N 多签；signers 来自 `cc mtc federation join` 注册表，覆盖 `--alg` / `--secret-key-file` |
| `--did <did>`                   | ❌（仅 batch-dids）   | 仅打包指定 DID（可重复），省略 = 全部                                                                  |
| `--skill <name>`                | ❌（仅 batch-skills） | 仅打包指定 skill                                                                                       |
| `--out <dir>`                   | ❌                    | 输出目录（默认 `./mtc-out`）                                                                           |
| `--issued-at <iso>`             | ❌                    | 树头签发时间（默认当前 UTC）                                                                           |
| `--expires-at <iso>`            | ❌                    | 树头过期时间（默认 +7 天）                                                                             |
| `--json`                        | ❌                    | JSON 输出（CI/脚本友好）                                                                               |

### `cc mtc serve` 选项

| 选项                    | 必填 | 说明                                           |
| ----------------------- | ---- | ---------------------------------------------- |
| `--transport <kind>`    | ❌   | `libp2p` / `filesystem`（默认 libp2p）         |
| `--listen <multiaddr>`  | ❌   | libp2p 监听地址（默认 `/ip4/127.0.0.1/tcp/0`） |
| `--connect <multiaddr>` | ❌   | libp2p 启动时拨号的 peer（可重复）             |
| `--mode <kind>`         | ❌   | libp2p `direct` / `gossipsub`（默认 direct）   |
| `--drop-zone <dir>`     | ❌   | filesystem 共享目录                            |
| `--prefix <ns>`         | ❌   | 订阅命名空间前缀（可重复，默认 `mtc/v1/did`）  |
| `--cache-dir <dir>`     | ❌   | LandmarkCache 持久化目录                       |
| `--exit-after <n>`      | ❌   | 收到 N 条后自动退出（CI/test 用）              |

### `cc mtc federation` 子命令族

| 子命令                                                                               | 用途                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `join <fed-id> --member-id <m> [--alg ed25519\|slh-dsa-128f] [--issuer <s>]`         | 生成成员密钥并注册到本地 `~/.chainlesschain/federation/members.json` |
| `leave <fed-id> --member-id <m>`                                                     | 从本地注册表移除成员（不影响远端）                                   |
| `status [fed-id] [--json]`                                                           | 列出已注册联邦及成员                                                 |
| `discover <fed-id> --transport filesystem\|libp2p [--drop-zone <dir>] [--gossipsub]` | 通过 announce 流自动发现成员                                         |
| `invite <fed-id> <candidate>`                                                        | 发起准入提案，写 governance event                                    |
| `vote <fed-id> <candidate> --member-id <m> [--ballot approve\|reject]`               | 对准入提案投票                                                       |
| `propose-revoke <fed-id> <target>` / `confirm-revoke <fed-id> <target>`              | 撤销成员的两阶段流程                                                 |
| `rotate-key <fed-id> --member-id <m>`                                                | 轮换成员密钥（旧密钥保留至 grace period 结束）                       |
| `propose-threshold <fed-id> <new-threshold>` / `confirm-threshold <fed-id>`          | threshold 变更（30 天公示期）                                        |
| `fork <fed-id> <new-fed-id>`                                                         | 联邦分裂，产生独立新 ID                                              |
| `merge <fed-id> <other-fed-id> <new-fed-id>`                                         | 联邦合并，产生独立新 ID                                              |
| `governance-publish <fed-id>` / `governance-pull <fed-id>`                           | 单次同步 governance.log（filesystem / libp2p 二选一）                |
| `governance-sync-serve <fed-id>`                                                     | 长跑双向同步守护进程                                                 |
| `governance-sync-libp2p <fed-id>`                                                    | 仅 libp2p gossipsub 同步路径                                         |
| `governance-sync-stats <fed-id>`                                                     | 查询同步进度 / 健康度                                                |
| `governance-log <fed-id> [--json]`                                                   | 检视本地 governance.log（dedup + sort 后）                           |
| `cross-trust-create <host-fed> <trusted-fed>`                                        | 创建跨联邦互信锚                                                     |
| `cross-trust-validate <anchor-path>`                                                 | 验证跨联邦互信锚（含 multi-hop）                                     |
| `audit <fed-id>`                                                                     | 离线审计（违规 + 建议）                                              |
| `governance-anchor <fed-id>`                                                         | 上链锚定当前治理快照（Q-COMP-3）                                     |
| `governance-verify-anchor <fed-id>`                                                  | 与链上锚比对验证                                                     |

### `cc audit mtc` 子命令族（默认关闭，等 Q-COMP-1/2 出函）

| 子命令                           | 用途                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `enable` / `disable`             | 启用 / 禁用审计事件 emit（持久化到 `.chainlesschain/audit-mtc.json`） |
| `status`                         | 查询当前 enabled、间隔、上次 emit 时间、堆积数                        |
| `config [--key <k> --value <v>]` | 读 / 写配置                                                           |
| `set-interval <seconds>`         | 修改 emit 间隔（默认 60s 短路径 / 3600s 长路径双轨）                  |
| `emit`                           | 手动触发一次 emit（需 enabled）                                       |
| `reconcile` / `reconcile-check`  | 对账：本地审计事件 vs 已发布 audit MTC 树                             |

### `cc crosschain mtc-*`（跨链桥集成）

| 子命令                            | 用途                                                  |
| --------------------------------- | ----------------------------------------------------- |
| `mtc-batch <namespace> <out-dir>` | 把当前批次的 tree-head 组装为跨链证明                 |
| `mtc-status`                      | 查看跨链桥 MTC 守护进程状态、最近一次锚定、待处理消息 |

### 命名空间规则

```
mtc/v1/<kind>(/<scope>)?/<batch-seq>
        │      │           │
        │      │           └─ 6+ 位数字（递增）
        │      └─ 可选，1–64 字符 [a-zA-Z0-9_-]，禁全数字
        └─ did | skill | audit
```

**前缀**（订阅用）：`mtc/v1/did` / `mtc/v1/skill` / `mtc/v1/audit/<scope>`，**不带** batch-seq。

## 性能指标

测试环境：Node 23.11.1, Windows 10 / Intel Core i7

| 操作                                                           | 规模             | 时间                              |
| -------------------------------------------------------------- | ---------------- | --------------------------------- |
| `MerkleTree.root()`                                            | N=8192           | ~5 ms                             |
| `MerkleTree.prove(i)`                                          | N=1024（已构树） | < 5 ms                            |
| `MerkleTree.prove(i)`（首次构树）                              | N=1024           | ~30 ms                            |
| 8K 批次完整端到端（构树 + sign + 全 prove，单签 Ed25519）      | 8192 leaves      | ~250 ms                           |
| 8K 批次完整端到端（构树 + sign + 全 prove，单签 SLH-DSA-128F） | 8192 leaves      | ~330 ms                           |
| 8K 批次完整端到端（联邦 3-of-5 异构）                          | 8192 leaves      | ~520 ms                           |
| 单 envelope `verify()`                                         | path 长 13       | < 1 ms                            |
| Ed25519 树头签名                                               | 17 KB 输入       | < 1 ms                            |
| Ed25519 树头验签                                               | 17 KB 输入       | < 1 ms                            |
| SLH-DSA-128F 树头签名                                          | 17 KB 输入       | ~80 ms                            |
| SLH-DSA-128F 树头验签                                          | 17 KB 输入       | ~5 ms                             |
| `LandmarkCache.ingest()` 单签                                  | 1 snapshot       | ~2 ms（含 sig + split-view 校验） |
| `LandmarkCache.ingest()` 联邦 3-of-5                           | 1 snapshot       | ~12 ms（5 路验签 + 阈值 + 去重）  |
| Libp2p 节点启动（TCP listen）                                  | 单节点           | ~250 ms                           |
| Libp2p direct mode 端到端                                      | 4 envelope       | ~600 ms（含 dial + protocol）     |
| Governance log replay                                          | 100 事件         | ~6 ms（dedup + sort + verify）    |
| Cross-fed trust validation                                     | 3-hop 信任链     | ~3 ms                             |

## 测试覆盖

**总计 476 测试 / 6 层（核心 + CLI + 桌面 + Web Panel + Web Shell + 跨链桥），100% 通过率，零回归**：

### core-mtc 包（234 测试 / 18 文件）

| 测试文件                               | 测试数 | 覆盖范围                                                                                                          |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `hash.test.js`                         | 14     | NIST SHA-256 标准向量、leaf/node hash 域分离、base64url 编解码                                                    |
| `jcs.test.js`                          | 7      | 键序无关、嵌套规范化、特殊字符                                                                                    |
| `merkle-rfc6962.test.js`               | 12     | RFC 6962 标准向量（empty / single / 2-leaf / 3,5,7 不平衡）                                                       |
| `merkle.test.js`                       | 18     | round-trip + audit path 长度 + 错误码 + 篡改检测                                                                  |
| `merkle-tree.test.js`                  | 11     | MerkleTree 类 + 子树根 memo + 性能（n=8192 < 2s）                                                                 |
| `batch.test.js`                        | 3      | `assembleBatch` + `assembleBatchFederated` 端到端                                                                 |
| `e2e.test.js`                          | 18     | 端到端 8/1024 leaf + 9 拒收场景 + split-view 攻击 + 签名验证器集成                                                |
| `landmark-cache-persist.test.js`       | 8      | persistDir 写盘 + loadFromDisk + 篡改检测 + 密钥变更跳过                                                          |
| `ed25519-signer.test.js`               | 10     | keypair gen + signRaw + makeVerifier + makeVerifierFromLandmark                                                   |
| `slh-dsa-signer.test.js`               | 7      | FIPS 205 keypair + sign + verify + 跨实现互操作                                                                   |
| `transports.test.js`                   | 15     | InMemory + Filesystem + 两节点 e2e（包括完整 4 envelope 验证）                                                    |
| `libp2p-transport.test.js`             | 5      | 真 TCP 网络两节点端到端 + protocol negotiation                                                                    |
| `libp2p-gossipsub.test.js`             | 5      | gossipsub mode shape + topic subscription + pubsub peers                                                          |
| `federation.test.js`                   | 11     | announce schema + 自签 + TTL + cache 验签 + 篡改拒收                                                              |
| `federation-discovery.test.js`         | 15     | filesystem drop-zone discovery + 聚合 + 过期清理                                                                  |
| `libp2p-federation-discovery.test.js`  | 9      | libp2p gossipsub discovery 真实多节点                                                                             |
| `federation-governance.test.js`        | 62     | 11 事件类型 create/verify/replay + dedup + sort + cross-trust + audit + on-chain anchor + governance log verifier |
| `federation-governance-libp2p.test.js` | 4      | governance.log 跨节点同步 + quorum 门控集成                                                                       |

### CLI 集成测试（114 测试 / 12 文件）

| 测试文件                                | 测试数 | 覆盖范围                                                                         |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `mtc-cli.test.js`                       | 7      | help / batch / verify / 篡改 → exit 2 / LANDMARK_EXPIRED / inspect               |
| `mtc-did-cli.test.js`                   | 4      | 从 DID DB 全/单/无匹配                                                           |
| `mtc-batch-skills-cli.test.js`          | 3      | 从 CLISkillLoader 全/过滤/无匹配                                                 |
| `mtc-publish-skills-cli.test.js`        | 5      | 守护进程 + 指纹 diff + 自动 batch-seq + 状态文件                                 |
| `mtc-serve-cli.test.js`                 | 3      | filesystem subscribe + ingest + exit + 配置错误                                  |
| `mtc-slh-dsa-cli.test.js`               | 3      | `--alg slh-dsa-128f` 单签 + 验证 + JSON 输出                                     |
| `mtc-federation-cli.test.js`            | 8      | join / leave / status 注册表生命周期                                             |
| `mtc-federation-discover-cli.test.js`   | 10     | filesystem + libp2p 服务发现两路径                                               |
| `mtc-federation-publish-cli.test.js`    | 5      | `--federation` 联邦多签端到端                                                    |
| `mtc-federation-governance-cli.test.js` | 41     | 24 governance 子命令全覆盖 + cross-trust + audit + on-chain anchor + sync daemon |
| `audit-mtc-cli.test.js`                 | 5      | enable/disable/status/emit/reconcile 默认关闭 + 配置往返                         |
| `crosschain-mtc-cli.test.js`            | 20     | `mtc-batch` / `mtc-status` 跨链桥集成 + 错误路径                                 |

### 上层（桌面 V6 widget + Web Panel + Web Shell + 跨链桥 IPC）

约 128 测试，覆盖 governance sync-stats widget / multi-proposal CRDT picker / Mtc.vue 治理 tab / Q-ENG-2 backend bridge / OpLog per-row badge。

```bash
# 跑全套
cd packages/core-mtc && npm test                                              # 234/234
cd packages/cli && npx vitest run __tests__/integration/{mtc,audit-mtc,crosschain-mtc}-*.test.js  # 114/114
```

## 安全考虑

### 密码学保证

- **域分离**: `LEAF_PREFIX = 0x00` / `NODE_PREFIX = 0x01` / `TREE_HEAD_SIG_PREFIX = "mtc/v1/tree-head\n"` / `LANDMARK_SIG_PREFIX = "mtc/v1/landmark\n"` / `GOVERNANCE_SIG_PREFIX = "mtc/v1/governance\n"`，防止跨场景签名重放
- **JCS 规范化**: 同输入永远产出同字节，防止 JSON 解析歧义攻击
- **SHA-256**: 所有内容寻址 + Merkle 节点哈希，128 位安全级别
- **Ed25519**: 树头签名 + 信任锚 + governance 事件签名，128 位经典安全级别
- **SLH-DSA-128F (FIPS 205)**: 后量子级别 128 位安全；通过 `@noble/post-quantum@0.6.1` 提供 hash-based 签名（无椭圆曲线 / 无格假设依赖）
- **混签共存**: 同一联邦内 Ed25519 + SLH-DSA-128F 成员签同一棵树，verifier 按各成员 trust_anchors 中的 alg 字段独立验签

### 攻击面 + 防御

| 攻击                             | 防御机制                                                    | 错误码                      |
| -------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Split-view（同 size 双签不同根） | `LandmarkCache.ingest()` 强制单调性                         | `MTCA_DOUBLE_SIGNED`        |
| 篡改 envelope 内容               | 重算 leaf hash → 不匹配 root                                | `ROOT_MISMATCH`             |
| 篡改 audit_path                  | proof 重算 root 失败                                        | `ROOT_MISMATCH`             |
| 替换 tree_head（不同公钥）       | 签名验证用 trust_anchors 内的公钥                           | `BAD_TREE_HEAD_SIG`         |
| 重放过期 landmark                | `expires_at` 检查                                           | `LANDMARK_EXPIRED`          |
| 篡改 landmark 文件（disk）       | `loadFromDisk` 重新签名校验                                 | 跳过 + `failed[]`           |
| 跨场景签名重放                   | 域分离前缀                                                  | 签名校验失败                |
| 命名空间欺骗                     | `NAMESPACE_RE` 严格校验                                     | `BAD_NAMESPACE`             |
| Schema 注入                      | 显式 schema 字符串匹配                                      | `UNKNOWN_SCHEMA`            |
| Inclusion proof 范围越界         | `0 ≤ leaf_index < tree_size`                                | `BAD_PROOF_INDEX`           |
| Inclusion proof 长度异常         | `audit_path.length` vs 期望值                               | `BAD_PROOF_LENGTH`          |
| Tree size 不匹配                 | `proof.tree_size == cached.tree_size`                       | `PROOF_TREE_SIZE_MISMATCH`  |
| 联邦签名数不达阈值               | `LandmarkCache` 计算有效签名数 ≥ threshold                  | `INSUFFICIENT_SIGNATURES`   |
| 一人多签作弊                     | 按 `pubkey_id` 去重计票                                     | `DUPLICATE_PUBKEY`          |
| 未授权成员签名                   | `trust_anchors` 白名单匹配                                  | `UNKNOWN_FEDERATION_MEMBER` |
| 治理事件伪造                     | 每事件独立签名 + `verifyGovernanceEvent`                    | 拒收 + 不进入 replay        |
| 治理事件重放                     | `event_id = sha256(jcs(payload))` + `dedupeEventsByEventId` | 静默去重                    |
| 治理事件乱序                     | `sortEventsChronologically(by issued_at)`                   | 状态机按时间序回放          |
| 联邦 fork 后回滚到旧成员名单     | governance.log 不可剪裁 + on-chain anchor                   | `GOVERNANCE_LOG_TAMPERED`   |
| 跨联邦伪造背书                   | `validateCrossFederationTrustAnchor` 验整条信任链           | `CROSS_TRUST_INVALID`       |

### 信任模型

- **MTCA 公钥分发**：通过 `landmark.trust_anchors` 自描述。**前提**首份 landmark 通过可信通道送达
- **联邦成员身份**：通过 `cc mtc federation discover` 接收 announce + 治理日志双路径建立；任一缺失都不会让该成员的签名生效
- **撤销**：`landmark.expires_at` 强制 verifier 定期刷新；过期 landmark 自动失效
- **失陷恢复**：MTCA 单成员私钥泄漏 → `propose-revoke` + `confirm-revoke` 两阶段（需 current threshold 多签）→ rotate-key + 公布新 trust_anchor → 旧 landmark 任未过期前仍可被验证（但不应被信任）；新签名换新 issuer 标识，verifier 升级 trust_anchors 后自动停止信任旧 issuer
- **跨联邦互信**：`cross-trust-create` 不是"信任所有未来变更"，而是冻结**当下**的成员名单 + threshold 快照；联邦 B 任何变更都需重新签发 trust anchor

### 当前限制

- ⚠️ Audit 事件 emit 默认关闭（`cc audit mtc enable` 才打开），等 Q-COMP-1/Q-COMP-2 法务出函
- ⚠️ 单棵树的 size 上限：当前实现支持 N ≤ 4M（packed key in `_memo`）；超过需切换为分代 landmark
- ⚠️ Federation Bootstrap 期上限 30 天 — 必须邀请到 ≥ 2 个额外成员，否则降级为永久单签 MTCA
- ⚠️ Quorum 门控只检查 `confirm-*` 子命令；emergency `--no-quorum-check` 可显式 bypass，需配合外部审计

## 故障排除

### 验证失败常见原因

```
✗ Verification failed: LANDMARK_MISS
```

- **原因**：本地 cache 找不到 envelope 引用的 tree_head_id
- **排查**：
  1. 确认你的 cache-dir 是否包含对应 namespace 的 snapshot
  2. 检查 envelope.tree_head_id 与 landmark.snapshots[*].tree_head_id 是否一致
  3. 重新 `cc mtc serve` 拉取最新 landmark

```
✗ Verification failed: ROOT_MISMATCH
```

- **原因**：重算根与 landmark 中的 root_hash 不一致
- **可能性**：
  1. envelope.leaf 被篡改（最常见）
  2. envelope.inclusion_proof.audit_path 被篡改
  3. 错把 envelope-X 的 proof 关联到 envelope-Y
- **排查**：用 `cc mtc landmark inspect` 看树根是否合理；对比生成时的 `--out` 目录原始文件

```
✗ Verification failed: BAD_TREE_HEAD_SIG
```

- **原因**：landmark 中的 tree_head 签名校验失败
- **可能性**：
  1. trust_anchors 与签发时使用的密钥不匹配
  2. landmark 在传输中被篡改
  3. 不同 MTCA 实例的密钥误混
- **排查**：用同一 `--secret-key-file` 重新生成；确认 trust_anchors[0].pubkey_id 一致

```
✗ Verification failed: INSUFFICIENT_SIGNATURES (联邦模式)
```

- **原因**：有效签名数 < threshold
- **可能性**：
  1. 部分成员密钥被撤销但 landmark 仍带其旧签名
  2. 网络分区导致部分成员未及时签
  3. trust_anchors 缺失对应成员公钥
- **排查**：`cc mtc federation status <fed-id>` 看本地注册表；对比 landmark 中的 issuer 列表

```
✗ MTCA_DOUBLE_SIGNED — split-view detected
```

- **原因**：发现同 namespace + tree_size 但不同 root_hash 的两份 landmark
- **可能性**：
  1. MTCA 节点被攻陷，对不同 verifier 群体出不同视图
  2. 多 MTCA 实例使用了同一 namespace（运维误配）
- **响应**：立即停止信任该 issuer；调查 MTCA 节点完整性；启动 `propose-revoke` 流程

### `cc mtc serve` 常见问题

```
ingest failed: NO_SIGNATURE_VERIFIER
```

- **原因**：persistDir 中有旧 snapshot，但当前 cache 还没拿到 trust_anchors
- **修复**：等第一份新 landmark 到达 → cache 用其 trust_anchors 初始化 → 旧 snapshot 自动重新校验

```
mtc serve failed: connect to /ip4/.../tcp/9000/p2p/... failed
```

- **原因**：libp2p `--connect` 的 peer 未启动或网络不通
- **修复**：先确认对端节点的 multiaddr，再用 `nc -zv <ip> <port>` 测试 TCP 连通性

### `cc mtc federation` 常见问题

```
✗ unknown federation "fed:cc:..." — run `cc mtc federation join ... --member-id <m>` first
```

- **原因**：本地 `~/.chainlesschain/federation/members.json` 没有该联邦
- **修复**：先 join 再 batch；或 `cc mtc federation discover` 接收远端 announce

```
✗ confirm-* aborted: quorum not met (need 2, got 1) — use --no-quorum-check to override
```

- **原因**：投票数不够，pre-flight 拒签
- **修复**：等其他成员投票完成；或紧急情况下 `--no-quorum-check` bypass（**会留下警告事件，事后必须由审计复盘**）

```
✗ governance-sync stalled — last sync 47 minutes ago (threshold 5 min)
```

- **原因**：governance-sync-serve 守护进程异常
- **修复**：`cc mtc federation governance-sync-stats <fed-id> --json` 看错误详情；常见是 libp2p mesh 不形成或 drop-zone 文件锁冲突；重启守护进程

### libp2p gossipsub mesh 不形成

**症状**：节点连上了（`getPeers().length > 0`）但订阅者列表是空（`getSubscribers().length === 0`）

**原因**：默认 D=6 mesh 大小阈值在 2 节点测试网络无法形成
**当前方案**：core-mtc 内置 D=1 + Dlo=1 + floodPublish 配置，避免该问题；生产多节点环境可恢复默认值

### `cc audit mtc` 状态异常

```
audit emit refused: feature disabled (run `cc audit mtc enable` after Q-COMP-1 sign-off)
```

- 设计如此：审计 emit 默认关闭，等法务出函才开。`status` 子命令查看当前 enabled 状态、上次 emit、堆积数。

## 关键文件

### 源码

```
packages/core-mtc/
├── package.json                         # @chainlesschain/core-mtc, deps: @noble/curves, @noble/post-quantum, canonicalize, libp2p-gossipsub
├── lib/
│   ├── index.js                         # 公共 API 聚合导出
│   ├── constants.js                     # 域分离前缀、schema 字符串、namespace 正则
│   ├── hash.js                          # SHA-256 + leafHash + nodeHash + base64url
│   ├── jcs.js                           # RFC 8785 规范化包装
│   ├── merkle.js                        # MerkleTree 类 + RFC 6962 算法
│   ├── verifier.js                      # 纯函数 verify(envelope, cache, options)
│   ├── landmark-cache.js                # 内存 + 磁盘双层缓存 + M-of-N 阈值校验
│   ├── batch.js                         # assembleBatch + assembleBatchFederated
│   ├── federation.js                    # 成员 announce schema + FederationAnnounceCache
│   ├── federation-governance.js         # 治理事件 schema + create/verify/replay + cross-trust + audit + on-chain anchor
│   ├── signers/
│   │   ├── ed25519.js                   # @noble/curves 1.9.7
│   │   └── slh-dsa.js                   # @noble/post-quantum 0.6.1, FIPS 205
│   └── transports/
│       ├── index.js                     # 传输层聚合导出
│       ├── types.js                     # 接口约定 + 命名空间工具
│       ├── in-memory.js                 # InMemoryBroker + InMemoryTransport
│       ├── filesystem.js                # FilesystemTransport（drop-zone）
│       └── libp2p.js                    # Libp2pTransport（direct + gossipsub + auto-discovery）
└── __tests__/                           # 18 文件 / 234 测试
```

### CLI 集成

```
packages/cli/
├── src/commands/mtc.js                  # 30+ 子命令（mtc / mtc federation 两族）
├── src/commands/audit.js                # 包含 audit mtc 子命令族
├── src/commands/crosschain.js           # 包含 crosschain mtc-* 子命令
├── __tests__/integration/
│   ├── mtc-cli.test.js                          # 7
│   ├── mtc-did-cli.test.js                      # 4
│   ├── mtc-batch-skills-cli.test.js             # 3
│   ├── mtc-publish-skills-cli.test.js           # 5
│   ├── mtc-serve-cli.test.js                    # 3
│   ├── mtc-slh-dsa-cli.test.js                  # 3
│   ├── mtc-federation-cli.test.js               # 8
│   ├── mtc-federation-discover-cli.test.js      # 10
│   ├── mtc-federation-publish-cli.test.js       # 5
│   ├── mtc-federation-governance-cli.test.js    # 41
│   ├── audit-mtc-cli.test.js                    # 5
│   └── crosschain-mtc-cli.test.js               # 20
└── package.json                                  # 依赖 @chainlesschain/core-mtc
```

### 设计文档（项目根 `docs/design/`）

```
docs/design/
├── 默克尔树证书_MTC_落地方案.md          # 主设计文档（v0.4 起所有 Phase 滚动更新）
├── MTC_数据格式_v1.md                    # v1 字节级规范
├── MTC_联邦治理_v1.md                    # v0.2 治理规范（v0.8/v0.9 增量已落）
├── MTC_跨链桥_v1.md                      # 跨链桥设计
└── 默克尔树证书_MTC_v0.2_评审清单.md      # 16 题决议清单
```

## 使用示例

### 例 1: 最小端到端流程（本地单签）

```bash
# 1. 创建几个 DID
cc did create --name Alice
cc did create --name Bob

# 2. 构造批次（默认 Ed25519）
cc mtc batch-dids \
  --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:zQ3shLocal \
  --secret-key-file ~/.chainlesschain/mtc/mtca.key.hex \
  --out ./mtc-out

# 3. 验证某条 envelope
cc mtc verify ./mtc-out/envelope-000000.json \
  --landmark ./mtc-out/landmark.json
```

### 例 2: 后量子签名（SLH-DSA-128F）

```bash
cc mtc batch-dids \
  --namespace mtc/v1/did/000002 \
  --issuer mtca:cc:zQ3shPQC \
  --alg slh-dsa-128f \
  --secret-key-file ~/.chainlesschain/mtc/mtca-pqc.key.hex \
  --out ./mtc-out-pqc

cc mtc verify ./mtc-out-pqc/envelope-000000.json \
  --landmark ./mtc-out-pqc/landmark.json
# 验签耗时 ~5ms（SLH-DSA-128F），单签耗时 ~80ms（FIPS 205 性能特性）
```

### 例 3: 联邦 3-of-5 多签批次

**3 台机器（成员 m1/m2/m3，threshold 2）**：

```bash
# 各成员 join（生成本地密钥，注册到 ~/.chainlesschain/federation/members.json）
# 机器 A：
cc mtc federation join fed:cc:enterprise --member-id m1 --alg ed25519
# 机器 B：
cc mtc federation join fed:cc:enterprise --member-id m2 --alg slh-dsa-128f   # PQC 成员
# 机器 C：
cc mtc federation join fed:cc:enterprise --member-id m3 --alg ed25519

# 协调者发起准入提案 → 投票 → 确认（governance.log 累积事件）
cc mtc federation invite fed:cc:enterprise candidate-m4   # 协调者
cc mtc federation vote fed:cc:enterprise candidate-m4 --member-id m1 --ballot approve
cc mtc federation vote fed:cc:enterprise candidate-m4 --member-id m2 --ballot approve
# m3 投票后 quorum 达成，自动追加 confirm 事件

# 任一成员组装联邦多签批次（threshold=2 时只需 2 个签名）
cc mtc batch-skills \
  --namespace mtc/v1/skill/000001 \
  --federation fed:cc:enterprise \
  --out ./batches/skills-000001
# 输出 landmark.json 含 ≥ 2 条不同成员的签名（异构 Ed25519 + SLH-DSA-128F）
```

### 例 4: governance.log 跨节点同步（长跑守护）

```bash
# 机器 A（成员 m1）— 长跑双向同步
cc mtc federation governance-sync-serve fed:cc:enterprise \
  --transport libp2p \
  --listen /ip4/0.0.0.0/tcp/9001 \
  --interval 60

# 机器 B（成员 m2）— 拨号 A 后双向同步
cc mtc federation governance-sync-serve fed:cc:enterprise \
  --transport libp2p \
  --connect /ip4/<A_IP>/tcp/9001/p2p/<A_PEERID>

# 任一节点查看同步状态
cc mtc federation governance-sync-stats fed:cc:enterprise --json
# {"federation_id":"fed:cc:enterprise","local_events":42,"peers":[...],"last_sync_at":"...","stalled":false}

# 离线审计（纯函数，不依赖网络）
cc mtc federation audit fed:cc:enterprise
# violations: []
# recommendations:
#   - threshold 2/3 — consider raising to 3/3 for production
```

### 例 5: 跨联邦互信锚（multi-hop）

```bash
# 联邦 A 背书联邦 B 当前快照
cc mtc federation cross-trust-create \
  fed:cc:enterprise-A \
  fed:cc:enterprise-B \
  --out ./trust-anchor-A-trusts-B.json

# 联邦 B 同样背书联邦 C
cc mtc federation cross-trust-create \
  fed:cc:enterprise-B \
  fed:cc:enterprise-C \
  --out ./trust-anchor-B-trusts-C.json

# 联邦 A 验证 multi-hop 信任链：A → B → C
cc mtc federation cross-trust-validate ./trust-anchor-A-trusts-B.json \
  --chain ./trust-anchor-B-trusts-C.json
# ✓ valid 2-hop trust chain (A → B → C)
```

### 例 6: 链上 governance-anchor (Q-COMP-3)

```bash
# 把当前治理快照锚定到链（默认 InMemoryChainAnchorClient，可换 Filesystem 或真实链）
cc mtc federation governance-anchor fed:cc:enterprise --out ./anchor.json
# 输出 anchor record：{snapshot_hash, federation_id, members[], threshold, anchored_tx?}

# 任意 verifier 比对链上 vs 本地
cc mtc federation governance-verify-anchor fed:cc:enterprise \
  --anchor ./anchor.json
# ✓ on-chain anchor matches local governance snapshot
```

### 例 7: Marketplace publish-skills 守护进程

```bash
# 自动监控本地技能目录，按指纹 diff 自动 batch
cc mtc publish-skills \
  --namespace mtc/v1/skill \
  --secret-key-file ~/keys/mtca.hex \
  --state-file ~/.chainlesschain/mtc/publish-state.json \
  --out ./batches \
  --interval 300

# 另一进程查看状态
cc mtc publish-status ~/.chainlesschain/mtc/publish-state.json
# state: idle | last batch-seq: 000017 | next-check: 5min | recent: [batch-15, batch-16, batch-17]
```

### 例 8: 程序化使用（Node.js）

```js
import {
  MerkleTree,
  leafHash,
  jcs,
  encodeHashStr,
  sha256,
  LandmarkCache,
  verify,
  ed25519,
  slhDsa,
  assembleBatchFederated,
  TREE_HEAD_SIG_PREFIX,
  createGovernanceEvent,
  verifyGovernanceLog,
  computeGovernanceSnapshotHash,
  buildGovernanceAnchorRecord,
} from "@chainlesschain/core-mtc";

// 联邦 2-of-3 异构签名
const m1 = ed25519.generateKeyPair();
const m2 = slhDsa.generateKeyPair();
const m3 = ed25519.generateKeyPair();

const items = [{ id: "x" }, { id: "y" }, { id: "z" }];
const leaves = items.map((i) => leafHash(jcs(i)));

const { landmark, envelopes } = assembleBatchFederated(
  leaves,
  [
    { ...m1, alg: "Ed25519", issuer: "mtca:cc:fed:m1" },
    { ...m2, alg: "SLH-DSA-128F", issuer: "mtca:cc:fed:m2" },
    { ...m3, alg: "Ed25519", issuer: "mtca:cc:fed:m3" },
  ],
  {
    threshold: 2,
    federationId: "fed:cc:demo",
    namespace: "mtc/v1/did/000099",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  },
);

// Verifier
const cache = new LandmarkCache({
  signatureVerifier: makeMultiVerifierFromLandmark(landmark),
});
cache.ingest(landmark);

const result = verify(envelopes[0], cache);
console.log(result.ok); // true，含 2/3 签名
```

## 相关文档

### 内部文档

- [设计文档：默克尔树证书 MTC 落地方案](https://design.chainlesschain.com/mtc-landing-plan)
- [设计文档：MTC 数据格式规范 v1](https://design.chainlesschain.com/mtc-data-format-v1)
- [设计文档：MTC 联邦治理 v1](https://design.chainlesschain.com/mtc-federation-governance-v1)
- [设计文档：MTC 跨链桥 v1](https://design.chainlesschain.com/mtc-cross-chain-bridge-v1)
- [设计文档：MTC v0.2 评审清单](https://design.chainlesschain.com/mtc-review-checklist)
- [安全机制设计](https://design.chainlesschain.com/security-design)

### 外部协议

- [IETF draft-ietf-plants-merkle-tree-certs](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/)
- [IETF draft-davidben-tls-merkle-tree-certs](https://datatracker.ietf.org/doc/draft-davidben-tls-merkle-tree-certs/)
- [Cloudflare 博客：Keeping the Internet fast and secure — introducing Merkle Tree Certificates](https://blog.cloudflare.com/bootstrap-mtc/)
- [RFC 6962 — Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962)
- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785)
- [FIPS 180-4 — SHA-256](https://csrc.nist.gov/pubs/fips/180/4/final)
- [FIPS 205 — SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final)

### 相关功能模块

- [Cowork 多智能体协作](/chainlesschain/cowork) — Skill Marketplace 上游（publish-skills 是 cowork 技能发布通道）
- [去中心化身份 2.0](/chainlesschain/did-v2) — DID 文档发布的源头
- [审计日志](/chainlesschain/audit) — 双轨签名（`cc audit mtc`）
- [跨链桥](/chainlesschain/cross-chain-bridge) — `cc crosschain mtc-*` 集成
- [IPFS 存储](/chainlesschain/ipfs-storage) — landmark 长期分发上游
- [后量子全面迁移](/chainlesschain/pqc-ecosystem) — SLH-DSA-128F 算法栈
- [CLI: did 子命令](/chainlesschain/cli-did) · [CLI: p2p 子命令](/chainlesschain/cli-p2p)
