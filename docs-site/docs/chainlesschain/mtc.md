# 默克尔树证书 (MTC) — 后量子安全签名压缩

> **版本: v0.3 (Phase 1 + 1.5 全部落地, 2026-04-26) | 状态: ✅ 端到端可用 | 154 测试全绿 | 4 种传输 | 6 CLI 子命令**
>
> 借鉴 IETF PLANTS WG 的 [Merkle Tree Certificates](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/) 协议（与 Cloudflare + Google Chrome 联合推进的 HTTPS 后量子方案同源），把 PQC 切换后单证书 17 KB 暴涨问题压回 ~700 B —— **节省约 97%**。

## 概述

ChainlessChain 即将从 Ed25519 切到后量子安全签名（FIPS 205 / SLH-DSA-128f）。但单条 SLH-DSA 签名 ≈ 17 KB，DID 文档每周更新一次会让 P2P DHT 流量从 5 GB 暴涨到 170 GB（10K 用户规模）—— 不可接受。

**默克尔树证书（MTC）** 通过批量签发 + RFC 6962 Merkle 树 + inclusion proof 解决：N 张证书共用一棵树，CA 只对树根（tree head）签**一次**。每条证书携带物 = 1 个签名（共享）+ 1 个公钥（共享）+ 1 个 inclusion proof（每条 ~450 B）。

| 场景 | 朴素 SLH-DSA-128f | MTC（每 envelope）| 节省 |
|---|---|---|---|
| 单 DID 文档 | ~17 KB | ~700 B | 96% |
| 1 K 批次 | ~17 MB | ~700 KB | 96% |
| 8 K 批次 | ~136 MB | ~5.6 MB | 96% |
| DHT 周流量（10K 用户） | ~170 GB | ~3 GB | 98% |

**当前状态**：树头签名暂用 Ed25519 作为 stopgap（@noble/curves）；待 `@noble/post-quantum` 上线后切到 SLH-DSA-128f（接口已为此预留）。

## 核心特性

- 🌳 **RFC 6962 兼容树**: 域分离前缀（`0x00` leaf / `0x01` node）防签名重放，与 IETF MTC + Certificate Transparency 完全对齐
- 📦 **批量签发**: N 张证书一棵树，CA 一次签名；`MerkleTree` 类 O(log n) 取证 + 子树根 memo
- 📜 **JCS 规范化**: RFC 8785 — 两个独立实现按规范构造的 envelope 必须**逐字节相同**
- 🔐 **Ed25519 实签**: 真实签名 + 验签（@noble/curves 1.9.7），stopgap 直到 SLH-DSA 上线
- 🛡️ **Split-view 防御**: `LandmarkCache.ingest()` 在 namespace + tree_size 相同时强制 root_hash 一致；不一致即 `MTCA_DOUBLE_SIGNED` 拒绝 + 告警
- 💾 **磁盘持久化**: `LandmarkCache.persistDir` + `loadFromDisk()` 启动时重新校验，篡改文件自动跳过
- 🌐 **4 种传输**: InMemory / Filesystem drop-zone / Libp2p direct (TCP+Noise+Yamux) / Libp2p gossipsub
- 🔧 **6 CLI 子命令**: `batch / batch-dids / batch-skills / verify / landmark inspect / serve`
- 🔌 **可插拔签名验证器**: `signatureVerifier` DI；core-mtc 零密码学硬依赖
- 🚦 **服务守护**: `cc mtc serve` 订阅 + 持久化 + 自动验证 + SIGINT 清理
- 🏛️ **Verifier 纯函数**: 零网络、零状态，纯 hash 计算
- 📑 **8 种错误码**: `LANDMARK_MISS / LANDMARK_EXPIRED / ROOT_MISMATCH / BAD_TREE_HEAD_SIG / BAD_PROOF_INDEX / BAD_PROOF_LENGTH / PROOF_TREE_SIZE_MISMATCH / MTCA_DOUBLE_SIGNED`
- 🎯 **3 种 leaf 类型**: `did-document` / `skill-manifest` / `audit-event`（audit 阻塞合规复核）
- 📐 **接口形态**: LandmarkTransport `publish/subscribe/fetch/close` 抽象，可扩展至更多后端

## 系统架构

```
┌────────────────────────────────────────────────────────────────┐
│  Producer (MTCA)                                               │
│                                                                │
│  Source ─┬─→ DID DB (cc mtc batch-dids)                        │
│          ├─→ Local skills (cc mtc batch-skills)                │
│          └─→ JSON file (cc mtc batch <input>)                  │
│                          ↓                                     │
│           ┌──────────── core-mtc ────────────┐                 │
│           │ jcs(leaf) → SHA-256 (LEAF_PREFIX) │                 │
│           │  → leafHashes[]                   │                 │
│           │  → MerkleTree(leafHashes)         │                 │
│           │  → root + inclusion proofs        │                 │
│           │                                    │                │
│           │ tree_head ← {namespace, tree_size,│                 │
│           │   root_hash, issued/expires_at,   │                 │
│           │   issuer}                          │                │
│           │                                    │                │
│           │ Sign: Ed25519(TREE_HEAD_PREFIX    │                 │
│           │   ‖ jcs(tree_head))               │                 │
│           │                                    │                │
│           │ landmark = {schema, snapshots: [{ │                 │
│           │   tree_head, tree_head_id,        │                 │
│           │   signature}], trust_anchors,     │                 │
│           │   publisher_signature}            │                 │
│           │                                    │                │
│           │ envelope[i] = {leaf, inclusion_   │                 │
│           │   proof: {leaf_index, audit_path, │                 │
│           │   tree_size}, tree_head_id}       │                 │
│           └────────────────────────────────────┘                │
│                          ↓                                     │
│           Transport.publish(landmark)                          │
└─────────────────────────┬─────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┬──────────────────┐
            ↓             ↓             ↓                  ↓
        InMemory      Filesystem     Libp2p            Libp2p
        (broker)      drop-zone      direct           gossipsub
                       (LAN/USB)    (TCP+Noise)        (topic
                                    + identify)        routing)
            └─────────────┼─────────────┴──────────────────┘
                          ↓
┌────────────────────────────────────────────────────────────────┐
│  Verifier (cc mtc serve / cc mtc verify)                       │
│                                                                │
│  Transport.subscribe(prefix) → on landmark:                    │
│    LandmarkCache.ingest():                                     │
│      ✓ schema check                                            │
│      ✓ tree_head_id = sha256(jcs(tree_head)) match             │
│      ✓ Signature: signatureVerifier(prefix‖canonical, sig)     │
│      ✓ Split-view: namespace+tree_size → root_hash unique      │
│      ✓ Persist to disk (optional)                              │
│                                                                │
│  verify(envelope, cache) → pure function:                      │
│    leafHash = SHA-256(LEAF_PREFIX ‖ jcs(leaf))                 │
│    computed = computeRootFromPath(leafHash, leaf_index,        │
│                                   tree_size, audit_path)       │
│    return computed == cached_tree_head.root_hash               │
└────────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 路径 | 职责 |
|---|---|---|
| `MerkleTree` | `lib/merkle.js` | RFC 6962 树构造 + 取证 + 验证（O(log n) prove，子树根 memo） |
| `Verifier` (`verify`) | `lib/verifier.js` | 纯函数 envelope 验证，按错误码返回结果 |
| `LandmarkCache` | `lib/landmark-cache.js` | 内存 + 磁盘双层缓存，split-view 防御 |
| `Ed25519Signer` | `lib/signers/ed25519.js` | 树头签名 + verifier factory（stopgap） |
| `JCS` | `lib/jcs.js` | RFC 8785 规范化 JSON 包装（依赖 `canonicalize` 包） |
| `Transports` | `lib/transports/{in-memory,filesystem,libp2p}.js` | 4 种 publish/subscribe 后端 |
| `cc mtc` 命令 | `packages/cli/src/commands/mtc.js` | 6 子命令薄包装 |

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

**Landmark**（树头快照）:
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

完整字节级规范见 [`MTC_数据格式_v1.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/MTC_数据格式_v1.md)。

## 配置参考

### `cc mtc batch-dids` 选项

| 选项 | 必填 | 说明 |
|---|---|---|
| `--namespace <ns>` | ✅ | 形如 `mtc/v1/did/000001`（kind/scope/batch-seq） |
| `--issuer <issuer>` | ✅ | MTCA 标识，如 `mtca:cc:zQ3sh...` |
| `--did <did>` | ❌ | 仅打包指定 DID（可重复），省略 = 全部 |
| `--out <dir>` | ❌ | 输出目录（默认 `./mtc-out`） |
| `--issued-at <iso>` | ❌ | 树头签发时间（默认当前 UTC） |
| `--expires-at <iso>` | ❌ | 树头过期时间（默认 +7 天） |
| `--secret-key-file <path>` | ❌ | Ed25519 密钥 hex 文件，复用以保持信任锚稳定（mode 0600） |
| `--json` | ❌ | JSON 输出（CI/脚本友好） |

### `cc mtc serve` 选项

| 选项 | 必填 | 说明 |
|---|---|---|
| `--transport <kind>` | ❌ | `libp2p` / `filesystem`（默认 libp2p） |
| `--listen <multiaddr>` | ❌ | libp2p 监听地址（默认 `/ip4/127.0.0.1/tcp/0`） |
| `--connect <multiaddr>` | ❌ | libp2p 启动时拨号的 peer（可重复） |
| `--mode <kind>` | ❌ | libp2p `direct` / `gossipsub`（默认 direct） |
| `--drop-zone <dir>` | ❌ | filesystem 共享目录 |
| `--prefix <ns>` | ❌ | 订阅命名空间前缀（可重复，默认 `mtc/v1/did`） |
| `--cache-dir <dir>` | ❌ | LandmarkCache 持久化目录 |
| `--exit-after <n>` | ❌ | 收到 N 条后自动退出（CI/test 用） |

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

| 操作 | 规模 | 时间 |
|---|---|---|
| `MerkleTree.root()` | N=8192 | ~5 ms |
| `MerkleTree.prove(i)` | N=1024（已构树） | < 5 ms |
| `MerkleTree.prove(i)`（首次构树）| N=1024 | ~30 ms |
| 8K 批次完整端到端（构树 + sign + 全 prove） | 8192 leaves | ~250 ms |
| 单 envelope `verify()` | path 长 13 | < 1 ms |
| Ed25519 树头签名 | 17 KB 输入 | < 1 ms |
| Ed25519 树头验签 | 17 KB 输入 | < 1 ms |
| `LandmarkCache.ingest()` | 1 snapshot | ~2 ms（含 sig + split-view 校验） |
| Libp2p 节点启动（TCP listen） | 单节点 | ~250 ms |
| Libp2p direct mode 端到端 | 4 envelope | ~600 ms（含 dial + protocol） |

## 测试覆盖

**总计 154 测试，100% 通过率，零回归**：

### core-mtc 包（137 测试）

| 测试文件 | 测试数 | 覆盖范围 |
|---|---|---|
| `hash.test.js` | 14 | NIST SHA-256 标准向量、leaf/node hash 域分离、base64url 编解码 |
| `jcs.test.js` | 7 | 键序无关、嵌套规范化、特殊字符 |
| `merkle-rfc6962.test.js` | 12 | RFC 6962 标准向量（empty / single / 2-leaf / 3,5,7 不平衡） |
| `merkle.test.js` | 32 | round-trip + audit path 长度 + 错误码 + 篡改检测 |
| `merkle-tree.test.js` | 11 | MerkleTree 类 + 子树根 memo + 性能（n=8192 < 2s） |
| `e2e.test.js` | 18 | 端到端 8/1024 leaf + 9 拒收场景 + split-view 攻击 + 签名验证器集成 |
| `landmark-cache-persist.test.js` | 8 | persistDir 写盘 + loadFromDisk + 篡改检测 + 密钥变更跳过 |
| `ed25519-signer.test.js` | 10 | keypair gen + signRaw + makeVerifier + makeVerifierFromLandmark |
| `transports.test.js` | 15 | InMemory + Filesystem + 两节点 e2e（包括完整 4 envelope 验证） |
| `libp2p-transport.test.js` | 5 | 真 TCP 网络两节点端到端 + protocol negotiation |
| `libp2p-gossipsub.test.js` | 5 | gossipsub mode shape + topic subscription + pubsub peers |

### CLI 集成测试（17 测试）

| 测试文件 | 测试数 | 覆盖范围 |
|---|---|---|
| `mtc-cli.test.js` | 7 | help / batch / verify / 篡改 → exit 2 / LANDMARK_EXPIRED / inspect |
| `mtc-did-cli.test.js` | 4 | 从 DID DB 全/单/无匹配 |
| `mtc-batch-skills-cli.test.js` | 3 | 从 CLISkillLoader 全/过滤/无匹配 |
| `mtc-serve-cli.test.js` | 3 | filesystem subscribe + ingest + exit + 配置错误 |

```bash
# 跑全套
cd packages/core-mtc && npm test     # 137/137
cd packages/cli && npx vitest run __tests__/integration/mtc-*.test.js  # 17/17
```

## 安全考虑

### 密码学保证

- **域分离**: `LEAF_PREFIX = 0x00` / `NODE_PREFIX = 0x01` / `TREE_HEAD_SIG_PREFIX = "mtc/v1/tree-head\n"` / `LANDMARK_SIG_PREFIX = "mtc/v1/landmark\n"`，防止跨场景签名重放
- **JCS 规范化**: 同输入永远产出同字节，防止 JSON 解析歧义攻击
- **SHA-256**: 所有内容寻址 + Merkle 节点哈希，128 位安全级别
- **Ed25519 (stopgap)**: 树头签名 + 信任锚，128 位经典安全级别
- **未来 SLH-DSA-128f**: 后量子级别 128 位安全（接口已为此预留）

### 攻击面 + 防御

| 攻击 | 防御机制 | 错误码 |
|---|---|---|
| Split-view（同 size 双签不同根） | `LandmarkCache.ingest()` 强制单调性 | `MTCA_DOUBLE_SIGNED` |
| 篡改 envelope 内容 | 重算 leaf hash → 不匹配 root | `ROOT_MISMATCH` |
| 篡改 audit_path | proof 重算 root 失败 | `ROOT_MISMATCH` |
| 替换 tree_head（不同公钥） | 签名验证用 trust_anchors 内的公钥 | `BAD_TREE_HEAD_SIG` |
| 重放过期 landmark | `expires_at` 检查 | `LANDMARK_EXPIRED` |
| 篡改 landmark 文件（disk） | `loadFromDisk` 重新签名校验 | 跳过 + `failed[]` |
| 跨场景签名重放 | 域分离前缀 | 签名校验失败 |
| 命名空间欺骗 | NAMESPACE_RE 严格校验 | `BAD_NAMESPACE` |
| Schema 注入 | 显式 schema 字符串匹配 | `UNKNOWN_SCHEMA` |
| Inclusion proof 范围越界 | `0 ≤ leaf_index < tree_size` | `BAD_PROOF_INDEX` |
| Inclusion proof 长度异常 | `audit_path.length` vs 期望值 | `BAD_PROOF_LENGTH` |
| Tree size 不匹配 | `proof.tree_size == cached.tree_size` | `PROOF_TREE_SIZE_MISMATCH` |

### 信任模型

- **MTCA 公钥分发**：通过 landmark.trust_anchors 自描述。**前提**首份 landmark 通过可信通道送达
- **撤销**：landmark `expires_at` 强制 verifier 定期刷新；过期 landmark 自动失效
- **失陷恢复**：MTCA 私钥泄漏 → 旧 landmark 任未过期前仍可被验证（但不应被信任）；新签名换新 issuer 标识，verifier 升级 trust_anchors 后自动停止信任旧 issuer

### 当前限制

- ⚠️ Ed25519 是 **stopgap** — 不抗量子计算机攻击。仅适用于过渡期
- ⚠️ Audit 路径双轨签名（Phase 2）阻塞于合规复核（等保三级最终性窗口）
- ⚠️ Federation MTCA 多签机制（Phase 3）暂未实现
- ⚠️ 单棵树的 size 上限：当前实现支持 N ≤ 4M（packed key in `_memo`）；超过需切换为分代 landmark

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
✗ MTCA_DOUBLE_SIGNED — split-view detected
```
- **原因**：发现同 namespace + tree_size 但不同 root_hash 的两份 landmark
- **可能性**：
  1. MTCA 节点被攻陷，对不同 verifier 群体出不同视图
  2. 多 MTCA 实例使用了同一 namespace（运维误配）
- **响应**：立即停止信任该 issuer；调查 MTCA 节点完整性

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

### libp2p gossipsub mesh 不形成

**症状**：节点连上了（`getPeers().length > 0`）但订阅者列表是空（`getSubscribers().length === 0`）

**原因**：默认 D=6 mesh 大小阈值在 2 节点测试网络无法形成
**当前方案**：core-mtc 内置 D=1 + Dlo=1 + floodPublish 配置，避免该问题；生产多节点环境可恢复默认值

## 关键文件

### 源码

```
packages/core-mtc/
├── package.json
├── lib/
│   ├── index.js                    # 公共 API
│   ├── constants.js                # 域分离前缀、schema 字符串、namespace 正则
│   ├── hash.js                     # SHA-256 + leafHash + nodeHash + base64url
│   ├── jcs.js                      # RFC 8785 规范化包装
│   ├── merkle.js                   # MerkleTree 类 + RFC 6962 算法
│   ├── verifier.js                 # 纯函数 verify(envelope, cache, options)
│   ├── landmark-cache.js           # 内存 + 磁盘双层缓存
│   ├── signers/
│   │   └── ed25519.js              # Ed25519 stopgap 签名器
│   └── transports/
│       ├── index.js                # 传输层聚合导出
│       ├── types.js                # 接口约定 + 命名空间工具
│       ├── in-memory.js            # InMemoryBroker + InMemoryTransport
│       ├── filesystem.js           # FilesystemTransport（drop-zone）
│       └── libp2p.js               # Libp2pTransport（direct + gossipsub）
└── __tests__/
    ├── hash.test.js                # 14 测试
    ├── jcs.test.js                 # 7
    ├── merkle.test.js              # 32
    ├── merkle-rfc6962.test.js      # 12 RFC 标准向量
    ├── merkle-tree.test.js         # 11
    ├── e2e.test.js                 # 18 端到端
    ├── landmark-cache-persist.test.js  # 8
    ├── ed25519-signer.test.js      # 10
    ├── transports.test.js          # 15
    ├── libp2p-transport.test.js    # 5 真网络
    └── libp2p-gossipsub.test.js    # 5
```

### CLI 集成

```
packages/cli/
├── src/commands/mtc.js             # 6 子命令薄包装
├── __tests__/integration/
│   ├── mtc-cli.test.js             # batch / verify / inspect (7)
│   ├── mtc-did-cli.test.js         # batch-dids 集成 (4)
│   ├── mtc-batch-skills-cli.test.js # batch-skills 集成 (3)
│   └── mtc-serve-cli.test.js       # serve filesystem (3)
└── package.json                    # @chainlesschain/core-mtc 依赖
```

### 设计文档

```
docs/design/
├── 默克尔树证书_MTC_落地方案.md      # v0.3 主设计文档
├── MTC_数据格式_v1.md                # v0.1 字节级规范
└── 默克尔树证书_MTC_v0.2_评审清单.md  # 16 题决议清单
```

## 使用示例

### 例 1: 最小端到端流程（本地）

```bash
# 1. 创建几个 DID
cc did create --name Alice
cc did create --name Bob

# 2. 构造批次
cc mtc batch-dids \
  --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:zQ3shLocal \
  --secret-key-file ~/.chainlesschain/mtc/mtca.key.hex \
  --out ./mtc-out

# 3. 验证某条 envelope
cc mtc verify ./mtc-out/envelope-000000.json \
  --landmark ./mtc-out/landmark.json
```

### 例 2: 两节点 verifier daemon（filesystem）

**机器 A（producer）**:
```bash
mkdir -p /shared/mtc-drop
cc mtc batch-dids --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:zQ3shCorp \
  --secret-key-file ~/keys/mtca.hex \
  --out ./batches/000001
# 用 FilesystemTransport publish 到 drop-zone（Node 脚本，详见 §12）
```

**机器 B（verifier）**:
```bash
cc mtc serve \
  --transport=filesystem \
  --drop-zone /shared/mtc-drop \
  --prefix mtc/v1/did \
  --cache-dir ~/.chainlesschain/mtc/cache
# 持续运行；新 landmark 到达自动 ingest + 持久化
```

### 例 3: libp2p direct 模式两节点

**机器 A**:
```bash
cc mtc serve --transport=libp2p \
  --listen /ip4/0.0.0.0/tcp/9000 \
  --prefix mtc/v1/did \
  --cache-dir ~/.chainlesschain/mtc/cache
# 启动时打印自身 multiaddr：/ip4/.../tcp/9000/p2p/12D3KooW...
```

**机器 B**:
```bash
cc mtc serve --transport=libp2p \
  --connect /ip4/<A_IP>/tcp/9000/p2p/<A_PEERID> \
  --prefix mtc/v1/did
```

### 例 4: 程序化使用（Node.js）

```js
import {
  MerkleTree, leafHash, jcs, encodeHashStr, sha256,
  LandmarkCache, verify, ed25519,
  TREE_HEAD_SIG_PREFIX,
} from '@chainlesschain/core-mtc';

// 构树 + 签
const items = [{ id: 'x' }, { id: 'y' }];
const leaves = items.map(i => leafHash(jcs(i)));
const tree = new MerkleTree(leaves);

const keys = ed25519.generateKeyPair();
const treeHead = {
  schema: 'mtc-tree-head/v1',
  namespace: 'mtc/v1/did/000001',
  tree_size: leaves.length,
  root_hash: encodeHashStr(tree.root()),
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 7*24*3600*1000).toISOString(),
  issuer: 'mtca:cc:zQ3shTest',
};
const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, jcs(treeHead)]);
const signature = ed25519.signTreeHead(signingInput, {
  ...keys, issuer: treeHead.issuer
});

// 构造 landmark + envelope
const landmark = {
  schema: 'mtc-landmark/v1',
  namespace: 'mtc/v1/did',
  snapshots: [{
    tree_head: treeHead,
    tree_head_id: encodeHashStr(sha256(jcs(treeHead))),
    signature,
  }],
  trust_anchors: [ed25519.trustAnchorEntry(keys.publicKey, treeHead.issuer)],
  publisher_signature: { alg: 'Ed25519', key_id: 'k', sig: 's' },
};

const envelope = {
  schema: 'mtc-envelope/v1',
  namespace: treeHead.namespace,
  tree_head_id: landmark.snapshots[0].tree_head_id,
  leaf: items[0],
  inclusion_proof: {
    leaf_index: 0,
    tree_size: leaves.length,
    audit_path: tree.prove(0).map(b => encodeHashStr(b)),
  },
};

// 验证
const cache = new LandmarkCache({
  signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
});
cache.ingest(landmark);

const result = verify(envelope, cache);
console.log(result.ok); // true
```

### 例 5: gossipsub topic 路由

```bash
# 节点 A
cc mtc serve --transport=libp2p --mode=gossipsub \
  --listen /ip4/0.0.0.0/tcp/9000 \
  --prefix mtc/v1/did

# 节点 B（连 A 后订阅同 topic）
cc mtc serve --transport=libp2p --mode=gossipsub \
  --connect <A 多址> \
  --prefix mtc/v1/did

# 节点 C（订阅不同 topic）
cc mtc serve --transport=libp2p --mode=gossipsub \
  --connect <A 多址> \
  --prefix mtc/v1/skill   # 只接收 skill 相关 landmark
```

## 相关文档

### 内部文档

- [设计文档：默克尔树证书 MTC 落地方案 v0.3](https://design.chainlesschain.com/mtc-landing-plan)
- [设计文档：MTC 数据格式规范 v1](https://design.chainlesschain.com/mtc-data-format-v1)
- [设计文档：MTC 评审清单 v0.2](https://design.chainlesschain.com/mtc-review-checklist)
- [用户指南：默克尔树证书 MTC](/guide/mtc-merkle-tree-certs)
- [安全机制设计](https://design.chainlesschain.com/security-design)

### 外部协议

- [IETF draft-ietf-plants-merkle-tree-certs-02](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/)
- [IETF draft-davidben-tls-merkle-tree-certs-10](https://datatracker.ietf.org/doc/draft-davidben-tls-merkle-tree-certs/)
- [Cloudflare 博客：Keeping the Internet fast and secure — introducing Merkle Tree Certificates](https://blog.cloudflare.com/bootstrap-mtc/)
- [RFC 6962 — Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962)
- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://datatracker.ietf.org/doc/html/rfc8785)
- [FIPS 180-4 — SHA-256](https://csrc.nist.gov/pubs/fips/180/4/final)
- [FIPS 205 — SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final)

### 实施 commit 链

| Commit | 内容 |
|---|---|
| `be70c5b17` | RFC 6962 树 + Verifier + LandmarkCache + `cc mtc batch/verify/landmark inspect` |
| `8926a5bc0` | LandmarkCache 持久化 + Ed25519 signer 模块 |
| `a4b88ebda` | CLI 用真实 Ed25519（去 alwaysAccept 桩） |
| `1e63dacc1` | `cc mtc batch-dids` 从本地 DID DB 读 |
| `58ad63a6b` | InMemory + Filesystem transport（含两节点 e2e） |
| `40fa0689a` | 真 libp2p Transport（TCP+Noise+Yamux+identify） |
| `1b0ae1105` | gossipsub mode（@chainsafe/libp2p-gossipsub@14） |
| `4d1a81586` | `cc mtc serve` verifier 守护进程 |
| `67da18480` | Marketplace `cc mtc batch-skills` |

### 相关功能模块

- [Cowork 多智能体协作](/chainlesschain/cowork) — Skill Marketplace 上游
- [DID 身份系统](/chainlesschain/did) — DID 文档发布的源头
- [审计日志](/chainlesschain/audit) — 未来双轨签名（Phase 2）
- [P2P 网络](/chainlesschain/p2p) — libp2p 栈共享
- [IPFS 存储](/chainlesschain/ipfs-storage) — 未来 landmark 分发上游
