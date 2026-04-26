# 默克尔树证书 (MTC) — ChainlessChain 落地方案

> 版本：v0.1（首版草案）
> 日期：2026-04-26
> 作者：longfa
> 状态：**草案 / Draft** — 待评审，未进入实施
> 关联：
> - 上游协议：`draft-ietf-plants-merkle-tree-certs-02`（IETF PLANTS WG，2026-03）/ `draft-davidben-tls-merkle-tree-certs-10`
> - 项目内：`docs/design/安全机制设计.md`、`docs/design/modules/21_统一密钥系统.md`、`docs/design/modules/12_插件市场系统.md`、`docs/design/modules/11_企业审计系统.md`
> - 已有依赖：PQC SLH-DSA（FIPS 205，6 变体 + Ed25519 hybrid，`packages/cli` 已落地 33 测试）、libp2p DHT、IPFS 存储、Cowork 多代理
> - 关联版本：ChainlessChain v5.0.2.54 / CLI 0.156.7
>
> **本草案要解决的核心问题**：当 ChainlessChain 全面切换到后量子签名时，DID 文档发布、Skill Marketplace 上架、企业审计日志这三处的**单条签名体积**会从今天的 64 B (Ed25519) 暴涨到 7.8–49 KB (SLH-DSA)。三处都是**高频 + 大批量**写入路径，直接套用 PQC 会让 DHT 流量、IPFS 存储成本、审计日志体积放大 1–3 个量级。

---

## 1. 背景与动机

### 1.1 PQC 切换的体积冲击

ChainlessChain 已落地 PQC SLH-DSA（参见 memory `pqc_slh_dsa.md`）。但目前只在"用户主动签 / 验"的入口启用，**默认数据面仍是 Ed25519**。一旦把默认切到 SLH-DSA，三个高频路径的单条签名体积变化：

| 场景 | 今天（Ed25519） | 切到 SLH-DSA-128f | 切到 SLH-DSA-256f | 倍数 |
|---|---|---|---|---|
| DID 文档（含主签名） | ~512 B | ~17 KB | ~49 KB | 33× / 96× |
| Skill 上架（manifest + sig） | ~2 KB | ~19 KB | ~51 KB | 9× / 25× |
| 审计日志（每条事件 + sig） | ~256 B | ~17 KB | ~49 KB | 66× / 191× |

DID 文档单次更新走 DHT (`libp2p-kad`) 广播，假设全网 10K 活跃身份每周更新一次：今天 DHT 周流量 ~5 GB；切到 SLH-DSA-128f 涨到 ~170 GB；切到 256f 涨到 ~490 GB。**这是不可接受的**。

### 1.2 MTC 的核心价值

借鉴 IETF PLANTS WG 的 Merkle Tree Certificates：
- **批量签发**：一棵 Merkle 树覆盖 N 张证书 / 文档，CA 只对 **树根 (tree head)** 签一次
- **携带物压缩**：客户端拿到的不是 N 个签名，而是 **1 个签名 + 1 个公钥 + 1 个 inclusion proof**（路径 ≈ 32×log₂N 字节）
- **透明性内建**：单棵生长树天然就是 transparency log，不需要额外 CT 基础设施
- **离线验证**：客户端预装 / 带外更新树根快照（landmark），握手 / 验证完全离线

对 ChainlessChain 的直接收益：
- **N=10 K 时**：DHT 周流量从 ~170 GB（SLH-DSA-128f 单签）降到 ~3 GB（树根周签 + 平均 14 层 inclusion proof）
- **N=1 M 时**：单证书携带物 ≈ 17 KB（签名）+ 640 B（20 层 proof） vs 朴素 17 KB × 1 M = 17 GB
- **审计日志**：批量树根可作为 IPFS pinning 的最小单元，整批一致性由树根保证

### 1.3 与 IETF 上游的差异

我们**不是** TLS 场景。差异点：

| 维度 | IETF MTC（HTTPS） | ChainlessChain MTC |
|---|---|---|
| 主体 | 浏览器 ↔ Web 服务器 | DID Owner ↔ 任意 Verifier（P2P / 企业 / Marketplace） |
| 信任锚分发 | Chrome 通过更新通道分发 landmark | libp2p gossipsub + IPFS（CID 寻址）|
| MTCA 角色 | 商业 CA（Cloudflare / DigiCert） | **多模式**：本地自托管 / 企业内置 / 联邦节点 |
| 树头有效期 | ~1 周 | **可配置**（DID 1 周；Skill 1 月；Audit 1 天） |
| 回退 | X.509 兜底 | 单条 PQC 签名兜底（同一 envelope 两路并存） |

---

## 2. 目标与非目标

### 2.1 目标

- **PQC 默认开启不爆炸**：把 DID 发布 / Skill 上架 / Audit 日志三个路径切到 SLH-DSA 后，端到端流量 ≤ 朴素方案的 5%
- **零信任锚单点**：MTCA 不是新的中心化 CA，必须支持本地 / 企业 / 联邦三种部署
- **离线可验**：Verifier 持有最新 landmark 即可完整验证 inclusion proof，无需联网查 CA
- **与现有 PQC 栈复用**：直接复用 `packages/cli/src/pqc/*` 的 SLH-DSA 签名/验证，不引入新算法依赖
- **平滑回退**：landmark 过期 / Verifier 老旧时自动回落到单条 PQC 签名路径，不中断业务
- **与 DHT/IPFS 对齐**：树根快照是 IPFS CID 寻址，DHT 仅广播 CID 而非全文

### 2.2 非目标

- 不替换 IETF MTC（我们是它的"P2P 应用版"，不是 TLS 子集）
- 不做新的密码学原语 — 树哈希用 SHA-256（与 IETF 草案一致），签名用现有 SLH-DSA / Ed25519 hybrid
- 不做 Web UI 上的 MTCA 控制台（首发只暴露 CLI + IPC，UI 后置到 Phase 4）
- 不解决撤销（revocation）问题 — 沿用现有 DID document 的 `revoked` 字段 + 短树头有效期
- 不强制旧用户迁移 — 单条 PQC 签名路径长期保留作为 fallback

---

## 3. 触发矩阵

| 命令 / 上下文 | 行为 |
|---|---|
| `cc did publish`（默认）| 走 MTC 路径；本地 MTCA 排批；24h 内攒满或定时切批 |
| `cc did publish --no-mtc` | 单条 PQC 签名直发 DHT（fallback / 调试） |
| `cc did publish --mtc-mode=federation --mtca <peer-id>` | 提交到联邦 MTCA，等树根上链 |
| `cc marketplace publish <skill>` | 默认进 Marketplace MTCA 队列；本批 closed 后才真正可见 |
| `cc audit emit <event>` | 默认进 audit MTCA（短间隔，1h/批）；批关闭 + IPFS pin 后才认作"已存证" |
| `cc mtc verify <artifact>` | 验证任意 MTC envelope（CLI 通用） |
| `cc mtc landmark fetch` | 主动拉最新 landmark（手动同步） |
| `cc mtc landmark list` | 列本地缓存的 landmark（按 namespace） |

理由：默认开启 MTC 是为了 PQC 切换后流量不炸；显式 `--no-mtc` 留作 CI 调试与极端排障。

---

## 4. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    ChainlessChain 节点                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ DID Manager  │  │ Marketplace  │  │ Audit Logger     │ │
│  │ (本地写入)   │  │ Publisher    │  │ (企业版)         │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬────────┘ │
│         │                 │                    │           │
│         ▼                 ▼                    ▼           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │     MTCA Core (本模块新增 — packages/core-mtc/)     │  │
│  │  ┌───────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │ Batcher   │→ │ Tree     │→ │ Tree-Head Signer │ │  │
│  │  │ (排批)    │  │ Builder  │  │ (SLH-DSA)        │ │  │
│  │  └───────────┘  └──────────┘  └────────┬─────────┘ │  │
│  │                                         │           │  │
│  │  ┌──────────────────────────────────────▼────────┐ │  │
│  │  │ Landmark Publisher (IPFS pin + DHT gossip)   │ │  │
│  │  └──────────────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────┐  │
│  │   MTC Verifier (任意 client 可独立调用)             │  │
│  │   - landmark cache（按 namespace 分桶，本地 LRU）   │  │
│  │   - inclusion-proof verifier（纯函数，零网络）       │  │
│  │   - fallback 检测（landmark 过期 → 拒收 / 回退签名）│  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
      ┌─────────┐     ┌──────────┐     ┌──────────┐
      │ libp2p  │     │  IPFS    │     │ 联邦 MTCA│
      │  DHT    │     │ (CID 寻址)│     │ (可选)   │
      └─────────┘     └──────────┘     └──────────┘
```

### 4.1 三种 MTCA 部署模式

| 模式 | 信任锚 | 适用场景 | Phase |
|---|---|---|---|
| **Local MTCA** | 本节点自有 PQC 主签名 | 单用户、家庭小群、零依赖部署 | Phase 1 |
| **Enterprise MTCA** | 企业根证书签名 | 企业版、内部审计日志 | Phase 2 |
| **Federation MTCA** | M-of-N 联邦签名（threshold sig） | 公共 Marketplace、跨组织 DID | Phase 3 |

三种模式的差异**只在树头签名步骤**，Batcher / Tree Builder / Verifier 完全相同 — 一套代码 + 策略注入。

### 4.2 Namespace 分桶

不同应用场景用不同的 Merkle 树，避免交叉污染：

```
mtc/v1/did/<batch-seq>           # DID 文档
mtc/v1/skill/<batch-seq>         # Marketplace 技能
mtc/v1/audit/<org-id>/<batch-seq> # 企业审计日志（按组织隔离）
```

Verifier 拿到 envelope 时根据 `namespace` 字段查对应 landmark。

---

## 5. 数据格式

### 5.1 MTC Envelope（替换今天的"PQC 单签 envelope"）

```json
{
  "schema": "mtc/v1",
  "namespace": "mtc/v1/did/000142",
  "leaf": {
    "kind": "did-document",
    "subject": "did:cc:zQ3...",
    "content_hash": "sha256:abc...",
    "issued_at": "2026-04-26T10:00:00Z"
  },
  "inclusion_proof": {
    "leaf_index": 4271,
    "tree_size": 8192,
    "audit_path": ["sha256:...", "sha256:...", "..."]
  },
  "tree_head": {
    "namespace": "mtc/v1/did/000142",
    "tree_size": 8192,
    "root_hash": "sha256:...",
    "issued_at": "2026-04-26T12:00:00Z",
    "expires_at": "2026-05-03T12:00:00Z"
  },
  "tree_head_signature": {
    "alg": "SLH-DSA-128f",
    "issuer": "mtca:cc:zQ3...",
    "sig": "base64(...)"
  },
  "fallback_signature": {
    "alg": "Ed25519",
    "key_id": "did:cc:zQ3...#key-1",
    "sig": "base64(...)"
  }
}
```

体积估算（N = 8192 = 2¹³ 棵树）：
- `inclusion_proof.audit_path`：13 × 32 B = **416 B**
- `tree_head` + `tree_head_signature`（SLH-DSA-128f）：~17 KB
- 但 `tree_head` **跨证书共享** — 实际单证书携带物只是 `inclusion_proof` 的 ~416 B + 引用 root hash 的 32 B = **~450 B**

> **关键设计**：tree_head 不内嵌在 envelope 里，只放一个 `tree_head_id = sha256(tree_head_canonical)`。Verifier 从本地 landmark cache 反查 tree_head。这是把单证书体积压到 < 1 KB 的核心。

### 5.2 Landmark（树头快照）

```json
{
  "schema": "mtc-landmark/v1",
  "namespace": "mtc/v1/did",
  "snapshots": [
    {
      "tree_head": { "tree_size": 8192, "root_hash": "...", ... },
      "signature": { "alg": "SLH-DSA-128f", "sig": "...", "issuer": "..." }
    },
    { "tree_size": 16384, "root_hash": "...", ... }
  ],
  "published_at": "2026-04-26T12:00:00Z",
  "ipfs_cid": "bafy...."
}
```

Landmark 通过 **IPFS pin + libp2p gossip** 分发：
- 发布者把 landmark 文件 pin 到 IPFS，得到 CID
- 通过 gossipsub topic `mtc-landmark/<namespace>` 广播 `(namespace, ipfs_cid, tree_size)`
- 订阅者比对本地 `tree_size`，落后即从 IPFS 拉取

---

## 6. 三个落地场景

### 6.1 DID 文档发布（Phase 1）

#### 现状（朴素 PQC）

```
client → sign(did_doc, slh-dsa) → DHT.put(did, signed_doc)
                                   # ~17 KB / 次
```

#### MTC 版

```
client → MTCA.submit(did_doc)              # 进队列
MTCA → 攒批（24h 或 8192 条）
     → 构 Merkle 树 → sign(root, slh-dsa)
     → IPFS.pin(landmark) → gossip(cid)
     → 回写每条 envelope（leaf + proof + tree_head_id）

DHT.put(did, mtc_envelope)                  # ~450 B / 次
                                            # 但是延迟 0–24h
```

**延迟权衡**：DID 文档不是实时数据，24h 批次延迟可接受。紧急更新可用 `--no-mtc` 走单条签名直发。

#### 验证流程

```
verifier 收到 envelope
  ├─ 查本地 landmark cache（namespace + tree_head_id）
  │   └─ 命中：用 root_hash 验 inclusion_proof
  │       └─ 通过：检查 tree_head 未过期 → 接受
  └─ 未命中：拉 landmark from IPFS（CID 已知）→ 验 → 缓存 → 重试
```

### 6.2 Skill Marketplace 上架（Phase 1）

特殊点：
- Marketplace 是**有限信任锚**场景 — Phase 1 默认本地 MTCA（节点自签）
- Skill 体积大（含代码），**leaf 只放 manifest + content hash**，代码本身用 IPFS CID 引用
- 批次关闭周期 1 个月（Skill 不像 DID 频繁更新）

CLI 命令：
```bash
cc marketplace publish ./my-skill        # 进队列
cc marketplace queue                     # 看本地 MTCA 队列
cc marketplace close-batch               # 强制关批（管理员）
cc marketplace verify <skill-id>         # 验证 inclusion
```

### 6.3 企业审计日志（Phase 2）

特殊点：
- **零延迟容忍要求**：审计事件落盘必须立刻有签名
- 解法：**双层签名** — 事件入队时立刻盖 Ed25519 单签（落盘可读），整批关闭后追加 MTC envelope（最终防篡改证明）
- 批次关闭周期 1h（短）
- 树头需上链（任选 ETH/Polygon）— 第三方可验"该批次曾在某时间点存在"

数据双轨：
```
audit_event_001.json    # 事件原文 + Ed25519 sig（实时）
audit_batch_seq_142.mtc # 关批后写入：含本事件的 inclusion proof + 上链交易 hash
```

---

## 7. 与 PQC SLH-DSA 的协同

memory `pqc_slh_dsa.md` 已经落地了 6 个 SLH-DSA 变体 + Ed25519 hybrid + `cc pqc algorithms` 命令。MTC 层**不引入新算法**，只决定哪一步用哪个：

| 操作 | 算法 | 体积 | 频率 |
|---|---|---|---|
| 叶子哈希（leaf）| SHA-256 | 32 B | 每条文档 |
| 内部节点哈希 | SHA-256 | 32 B | 每构树一次 |
| 树头签名 | **SLH-DSA-128f** | ~17 KB | 每批一次（每 24h / 1 月 / 1h）|
| Fallback 单签 | Ed25519 | 64 B | 每条文档 |
| Verifier 持有的公钥 | SLH-DSA pubkey | ~32 B | 一次性，预装/landmark 自带 |

**关键算术**：批大小 N = 8192 时
- 朴素：8192 × 17 KB = **136 MB / 批**
- MTC：1 × 17 KB（树头签）+ 8192 × 450 B（envelope）= **~3.6 MB / 批**
- 节省 **97.4%**

---

## 8. 客户端验证流程（纯函数）

```typescript
// packages/core-mtc/src/verifier.ts (草案)
export async function verifyMTC(
  envelope: MTCEnvelope,
  landmarkCache: LandmarkCache
): Promise<VerifyResult> {
  // 1. 查 landmark
  const treeHead = await landmarkCache.find(
    envelope.namespace,
    envelope.tree_head_id
  );
  if (!treeHead) {
    return { ok: false, reason: 'LANDMARK_MISS', recoverable: true };
  }

  // 2. 查 landmark 是否过期
  if (Date.parse(treeHead.expires_at) < Date.now()) {
    return { ok: false, reason: 'LANDMARK_EXPIRED', recoverable: false };
  }

  // 3. 验 tree_head 的 PQC 签名（一次性，可缓存结果）
  const headOk = await verifyPQC(
    canonicalize(treeHead),
    envelope.tree_head_signature
  );
  if (!headOk) return { ok: false, reason: 'BAD_TREE_HEAD_SIG' };

  // 4. 用 root_hash 验 inclusion proof（纯哈希计算，零网络）
  const computed = computeRoot(
    sha256(canonicalize(envelope.leaf)),
    envelope.inclusion_proof
  );
  if (computed !== treeHead.root_hash) {
    return { ok: false, reason: 'BAD_INCLUSION_PROOF' };
  }

  return { ok: true, leaf: envelope.leaf };
}
```

`computeRoot` 是 IETF RFC 6962 §2.1.1 的标准 audit path 算法，**零依赖 + 纯函数 + 单测易写**。

---

## 9. 实施路径

### Phase 0 — 协议固化（1 周）
- [ ] 锁定 envelope JSON schema（本文档 §5.1）
- [ ] 锁定 landmark schema（§5.2）
- [ ] 锁定 namespace 字符串规则
- [ ] 锁定树构造算法 = RFC 6962 兼容（与 IETF MTC 一致）
- [ ] 写 `docs/design/MTC_数据格式_v1.md`

### Phase 1 — Local MTCA + DID 路径（3 周）
- [ ] 新建 `packages/core-mtc/`（lib + 测试），不依赖 Electron
- [ ] 实现 Batcher / TreeBuilder / TreeHeadSigner（复用 `packages/cli/src/pqc/`）
- [ ] 实现 Verifier（纯函数）+ LandmarkCache（LRU + IPFS 拉取）
- [ ] CLI：`cc mtc verify` / `cc mtc landmark fetch|list`
- [ ] DID 写入路径接入：`cc did publish` 默认走 MTC，`--no-mtc` 兜底
- [ ] 单测覆盖 ≥ 50（参考 `pqc_slh_dsa` 33 测试节奏）
- [ ] 集成测试：本地起两个节点，A 发 DID + 批关闭后 B 通过 IPFS 拉 landmark + 验

### Phase 2 — Marketplace + Audit（2 周）
- [ ] Marketplace publisher 接入 MTCA 队列
- [ ] `cc marketplace publish` / `cc marketplace verify` 上线
- [ ] 企业审计日志双轨签名（实时 Ed25519 + 关批 MTC）
- [ ] 审计批次树根上链（首发 Polygon Mumbai 测试网）

### Phase 3 — Federation MTCA（4 周，可选）
- [ ] M-of-N threshold signing 集成（已有的 cross-chain 基础设施可复用部分）
- [ ] 联邦节点发现（libp2p service discovery）
- [ ] CLI：`cc mtc federation join|leave|status`
- [ ] Marketplace 切换到联邦签名作为信任锚

### Phase 4 — Desktop UI（2 周）
- [ ] V6 Pack：MTC 状态面板（landmark cache 大小、批次队列、最近一次同步时间）
- [ ] DID 详情页面新增"MTC 包含证明"标签
- [ ] Marketplace 列表展示"已通过 MTC 验证"徽章

---

## 10. 安全分析

### 10.1 威胁模型

| 威胁 | 缓解 |
|---|---|
| MTCA 私钥泄漏 | 树头有效期短（≤ 1 周）+ 联邦模式可主动注销节点 |
| 恶意 MTCA 漏签某条文档 | Verifier 只接受持有 inclusion_proof 的 envelope；不在树里 = 不存在 |
| 恶意 MTCA 双花（两棵不同的树同时声称包含 X） | 树头单调性：landmark 必须 `tree_size` 严格递增；不一致的 landmark 直接拒绝 |
| Landmark 旧客户端被钉死老树根 | landmark 有 `expires_at`；过期客户端必须刷新或回退 |
| 中间人替换 inclusion_proof | proof 用 SHA-256 链式哈希，单字节修改 root 全变；攻击者需破 SHA-256 |
| IPFS landmark 不可达 | 双轨：DHT gossip 同时广播 CID + 短文本摘要；客户端 fallback 单签路径 |

### 10.2 隐私

- Inclusion proof **会暴露 tree_size 和 leaf_index** — 这是公开树的固有属性，无法隐藏
- 对隐私敏感场景（私聊消息），**不应**用 MTC — 继续用 P2P 端到端加密 + 单条签名
- DID 文档本身就是公开的，无新增隐私风险
- 审计日志在企业内部本就需要可审计 — 隐私不是目标

### 10.3 撤销

- **不引入证书撤销列表（CRL）/ OCSP**
- 撤销手段：
  1. DID document 本身的 `revoked: true` 字段（已有）
  2. 树头短期有效（landmark 过期 → 强制重新拉取 → 拿到新批次的 revoked 状态）
- 这是 IETF MTC 同款选择 — 用"短寿 + 频繁刷新"替代撤销基础设施

---

## 11. 与现有系统的接口

| 现有模块 | 改动 |
|---|---|
| `packages/cli/src/commands/did.js` | `publish` 加 `--no-mtc` flag；默认走 MTCA |
| `packages/cli/src/commands/marketplace.js` | `publish` 改为入队 |
| `packages/cli/src/pqc/` | **零改动**，MTC 直接 import |
| `desktop-app-vue/src/main/services/did-manager.js` | 增 `submitToMTCA()` 方法 |
| `backend/project-service/` | 企业审计接口加 MTC envelope 字段（向后兼容，旧版本忽略即可） |
| libp2p / IPFS 适配层 | 新增 `mtc-landmark/<namespace>` topic 订阅 |

---

## 12. 已知限制 / 未解决问题

1. **延迟不适合实时场景**：DID 24h 批延迟、Marketplace 1 月批延迟 — 实时通信继续走单条签名
2. **联邦 MTCA 的治理未定**：Phase 3 才考虑；M-of-N 怎么定？谁有权加入？— 需要单独治理设计文档
3. **IPFS 可达性**：Phase 1 假设节点能访问 IPFS 公网；离线 / 内网部署下 landmark 分发需走自建 pinning service
4. **Tree size 上限**：单棵树长到 N=2³² 后审计路径 32 层，验证仍 < 1 ms；但单 landmark 文件会很大 — Phase 3 可能需要"分代树根"
5. **与现有 audit log 写入路径的语义冲突**：现有审计是同步落盘 + 实时可查；改造后"批次关闭前的事件状态"需要 UI 明确表示"待批确认"
6. **未考虑跨链桥的 MTC 化**：留给独立设计文档（关联 memory `cross_chain_cli`）

---

## 13. 决策记录（草案阶段）

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 树哈希算法 | SHA-256 | SHA-3 / Blake3 | 与 IETF MTC + RFC 6962 对齐，工具链成熟 |
| 树头签名算法 | SLH-DSA-128f | ML-DSA / Falcon | 已落地（memory `pqc_slh_dsa`），hash-based 抗量子 |
| 树构造方式 | 单棵生长树（每批扩展） | 每批一棵新树 | 与 IETF 一致，天然 transparency log |
| Landmark 分发 | IPFS + libp2p gossip | HTTP CDN | 去中心化原则，与 ChainlessChain 现有栈一致 |
| Fallback 策略 | envelope 内嵌 Ed25519 单签 | 完全拒收过期请求 | 业务连续性 > 严格性 |
| 批次大小 | DID/skill 8192；audit 1024 | 固定 N | 平衡延迟 / 树高 / 单 landmark 体积 |

---

## 14. 后续步骤

1. **本草案评审**（1 周）— 收集反馈，重点关注 §6.3 审计日志双轨签名是否合理
2. 草案 v0.2 — 锁定数据格式细节后产出 `docs/design/MTC_数据格式_v1.md`
3. 启动 Phase 0 + Phase 1 实施
4. 与 IETF PLANTS WG 草案动态保持跟踪（关注 `draft-ietf-plants-merkle-tree-certs-03+` 是否对树头签名算法选择有新建议）

---

## 附录 A — 术语表

| 术语 | 定义 |
|---|---|
| MTCA | Merkle Tree Certificate Authority — 排批 + 构树 + 签树头的角色 |
| Landmark | 已签名的树头快照（含 root hash + tree size + 签名） |
| Inclusion Proof | 从某叶子到树根的 audit path，由 log₂(N) 个兄弟节点哈希组成 |
| Tree Head | 一棵树某一时刻的根哈希 + 元数据 |
| Namespace | 区分不同应用的 Merkle 树（DID / Skill / Audit） |
| Fallback Signature | envelope 内嵌的单条 PQC 签名，landmark 不可达时使用 |

## 附录 B — 参考资料

- [IETF draft-ietf-plants-merkle-tree-certs-02](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/)
- [IETF draft-davidben-tls-merkle-tree-certs-10](https://datatracker.ietf.org/doc/draft-davidben-tls-merkle-tree-certs/)
- [Cloudflare: Keeping the Internet fast and secure — introducing Merkle Tree Certificates](https://blog.cloudflare.com/bootstrap-mtc/)
- [RFC 6962 — Certificate Transparency](https://datatracker.ietf.org/doc/html/rfc6962)
- [FIPS 205 — SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final)
- 项目内：`docs/design/安全机制设计.md` / `modules/21_统一密钥系统.md` / `modules/12_插件市场系统.md` / `modules/11_企业审计系统.md`
