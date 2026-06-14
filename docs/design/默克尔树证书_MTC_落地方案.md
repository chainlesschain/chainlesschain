# 默克尔树证书 (MTC) — ChainlessChain 落地方案

> 版本：v0.5（Phase 0–4 全部落地：Local + 1.5 transports + 1.6 SLH-DSA + 2 marketplace + audit 双轨 + 法务解锁 + Q-ENG-2 backend + 3.1 多签 + 3.2 federation 信任锚 + 3.3 filesystem discovery + 3.4 libp2p gossipsub discovery + 4 desktop/web UI + Op Log per-row 徽章）
> 日期：2026-05-01
> 作者：longfa
> 状态：**Phase 1 + 1.5 完成** + **Phase 2 marketplace publisher daemon 落地** + **Phase 2 audit 双轨脚手架就绪 (off-by-default)** — Local MTCA 端到端管道（DID + Skill）、持久化、Ed25519 实签、3 种传输（InMemory / Filesystem / libp2p direct + gossipsub）、`cc mtc` 6 子命令、`cc audit mtc` 7 子命令；audit 产线启用仍阻塞于 Q-COMP-1/Q-COMP-2 合规出函
> 关联：
> - **协议级字节规范**：`docs/design/MTC_数据格式_v1.md`（v0.1）
> - **评审清单**：`docs/design/默克尔树证书_MTC_v0.2_评审清单.md`（16 题，3 项 ⚠️ 合规待确认）
> - 上游协议：`draft-ietf-plants-merkle-tree-certs-02`（IETF PLANTS WG，2026-03）/ `draft-davidben-tls-merkle-tree-certs-10`
> - 项目内：`docs/design/安全机制设计.md`、`docs/design/modules/21_统一密钥系统.md`、`docs/design/modules/12_插件市场系统.md`、`docs/design/modules/11_企业审计系统.md`
> - 关联版本：ChainlessChain v5.0.2.54 / CLI 0.156.7
>
> **v0.4 落地清单（commit hash）**：
> | 阶段 | commit | 内容 |
> |---|---|---|
> | Phase 1 W1+2+3 | `be70c5b17` | RFC 6962 树 + Verifier + LandmarkCache + `cc mtc batch/verify/landmark inspect`（94 + 7 测试） |
> | Phase 1 W4 持久化 | `8926a5bc0` | LandmarkCache `persistDir` + `loadFromDisk` + Ed25519 signer 模块 |
> | Phase 1 W4 Ed25519 | `a4b88ebda` | CLI 用真实 Ed25519，去掉 alwaysAccept 桩 |
> | Phase 1 W4 DID | `1e63dacc1` | `cc mtc batch-dids` 从本地 DID DB 读 |
> | Phase 1 W5 transport | `58ad63a6b` | InMemory + Filesystem transport（含两节点 e2e） |
> | Phase 1.5 libp2p | `40fa0689a` | 真 libp2p Transport（TCP+Noise+Yamux+identify，自定义协议） |
> | Phase 1.5 gossipsub | `1b0ae1105` | gossipsub mode（@chainsafe/libp2p-gossipsub@14，topic 路由） |
> | Phase 1.5 serve | `4d1a81586` | `cc mtc serve` verifier 守护进程 + core-mtc subpath exports |
> | Phase 2 partial | `67da18480` | `cc mtc batch-skills` 从 CLISkillLoader 读（Marketplace 路径） |
> | Phase 2 batch lift | `c69900c7d` | `assembleBatch` 从 mtc.js 抽到 `core-mtc/lib/batch.js`，所有 batch 路径共用一条装配代码 |
> | Phase 2 marketplace daemon | `c69900c7d` | `cc mtc publish-skills` 守护进程：fingerprint 差量检测 + 自动 seq 递增 + 状态文件持久化（unit 6 + integration 3）|
> | Phase 2 audit 双轨脚手架 | `c69900c7d` | `cc audit mtc enable/disable/config/set-interval/emit/reconcile/reconcile-check/status` — off-by-default，等保 1h/1min 双路径配置可切换；产线启用仍待 Q-COMP-1/Q-COMP-2（unit 22 + integration 5）|
> | E2E + bug audit | `1903b9015` | 跨进程 e2e 6 测试 + 4 个 bug 修复（state file 原子写、staging schema 校验、oldest_queued_at malformed-leading guard、issuer key wx 并发 create）|
> | **Phase 1.6 SLH-DSA 实签** | _本次_ | `core-mtc/lib/signers/slh-dsa.js` (FIPS 205) + `assembleBatch(...)` 接受可选 signer + `cc mtc batch/batch-dids/batch-skills/publish-skills` 全部支持 `--alg slh-dsa-128f` opt-in；`cc mtc verify` 多算法 dispatcher。@noble/post-quantum 0.6.1 落地 npm（unit 7 + integration 3）|
> | **Phase 4 V6 widget** | _本次_ | `MtcStatusPreviewWidget.vue` + DecentralEntries 顶部新增 MTC 入口，显示 audit/批次/算法状态；IPC 缺失时优雅降级（registry test 5 + widget unit 6） |
>
> **累计测试 (v0.5)**：core-mtc 182 + CLI MTC 89 + desktop MTC 33 + web-panel MTC 153 + backend Q-ENG-2 19 = **476 测试，全绿**，覆盖 unit / integration / e2e / desktop-renderer / web-renderer / backend 六层。
>
> **v0.5 bug 审计修了 4 项**（在 v0.4 4 项基础之上）：(1) `MtcInclusionProofDrawer.vue` 桌面 drawer 之前调一个不存在的 `electronAPI.fs.readFile`，改用真实存在的 `electronAPI.file.readContent`；(2) `cc mtc federation discover --transport libp2p` libp2p 节点在初始化中途异常时会泄漏，包 try/catch + cleanup；(3) federation discover daemon 的 `setInterval` 扫描在慢盘上可能重入，加 `scanInProgress` 锁；(4) `cc mtc federation join` 写 key file 改 `wx` 独占创建（与 audit-mtc.js 同 race-safety 策略）。
>
> **v0.4 bug 审计修了 4 项**：(1) `cc mtc publish-skills` 状态文件改 atomic write（temp + rename），崩溃不再静默重置 `last_seq=0`；(2) audit-mtc `listStagingEvents` 加 schema + filename 双校验，伪事件不会进树；(3) `getStatus.oldest_queued_at` 在领头条目损坏时仍能找到首个有效记录；(4) `loadOrCreateIssuerKey` 改 `wx` 独占创建，并发首次 emit 不再生成冲突密钥。
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

### Phase 0 — 协议固化 ✅ **已完成 2026-04-26**
- [x] 锁定 envelope/landmark/tree_head schema（数据格式 §5）
- [x] 锁定 namespace 字符串规则（数据格式 §2.1）
- [x] 锁定树构造算法 = RFC 6962 兼容（数据格式 §3）
- [x] 锁定 JCS 规范化（数据格式 §4）+ 域分离前缀（§3.1）
- [x] 锁定错误码集（数据格式 §11）
- [x] 写 `docs/design/MTC_数据格式_v1.md`

### Phase 1 — Local MTCA 端到端 ✅ **已完成 2026-04-26**
- [x] 新建 `packages/core-mtc/`（lib + 测试，零 Electron 依赖）
- [x] 实现 SHA-256 + RFC 6962 树（`MerkleTree` 类，O(log n) 取证 + 子树根 memo）
- [x] 实现 Verifier 纯函数（按数据格式 §11 错误码） + LandmarkCache 含 split-view 防御
- [x] LandmarkCache 持久化（`persistDir` + `loadFromDisk`，篡改检测）
- [x] Ed25519 真实签名（`lib/signers/ed25519.js`，stopgap，待 SLH-DSA `@noble/post-quantum`）
- [x] CLI：`cc mtc batch / verify / landmark inspect / batch-dids`
- [x] 单测覆盖 102 + CLI 集成 11 = **113 测试**

### Phase 1.5 — 传输层 ✅ **已完成 2026-04-26**
- [x] LandmarkTransport 抽象（`publish` / `subscribe` / `fetch` / `close`）
- [x] **InMemoryTransport** — 同进程 broker（测试用）
- [x] **FilesystemTransport** — drop-zone 目录模式（LAN/USB/离线分发）
- [x] **Libp2pTransport direct 模式** — 真 TCP+Noise+Yamux+identify，自定义协议 `/mtc/landmark/1.0.0`
- [x] **Libp2pTransport gossipsub 模式** — `@chainsafe/libp2p-gossipsub@14`，topic 路由（D=1 + floodPublish 适配低密度网络）
- [x] CLI `cc mtc serve` 守护进程（filesystem / libp2p direct / libp2p gossipsub）
- [x] 两节点端到端测试 + 5 backends × 多场景 = 35+ transport 测试

### Phase 2 — Marketplace + Audit ✅ **全部落地（2026-05-02）**
- [x] Marketplace 路径：`cc mtc batch-skills`（CLISkillLoader → 树）— commit `67da18480`
- [x] Marketplace publisher 守护进程：`cc mtc publish-skills`（fingerprint 差量 + 自动 seq + 状态文件 + filesystem drop-zone 兼容 `cc mtc serve --transport=filesystem`），9 测试
- [x] 审计日志双轨脚手架（off-by-default）：`cc audit mtc emit / reconcile / reconcile-check / status / enable / disable / config / set-interval`；事件文件含实时 Ed25519 签名 + 内容 hash，关批生成 MTC envelope 含 inclusion proof；幂等关批；23 测试
- [x] **Audit 产线启用解锁**（2026-05-01 commit `7f46695eb`）：Q-COMP-1（等保三级最终性窗口）+ Q-COMP-2（T/ZGCMCA 023—2025 条款）法务出函已收到。脚手架默认仍 `enabled=false`，由各租户运行 `cc audit mtc enable --interval <60|3600>` 显式启用。
- [x] **Q-ENG-2 backend 灰度切换**（2026-05-02 commit `cd7ead6fa`）：`backend/project-service` 加 `audit.mtc.*` 配置（默认 `enabled=false`）+ `AuditMtcProperties` + `AuditMtcBridgeService`（fire-and-forget CLI 桥接）+ 在 `OperationLogService.saveLog` 末端调用桥接。tenant allow-list 控制灰度范围。15 JUnit 测试覆盖。生产启用走 `AUDIT_MTC_ENABLED=true` 环境变量。

### Phase 3 — Federation MTCA（部分落地 2026-05-02）
- [x] **P3.1 多签 landmark + CLI（commit `95b861914`）**：`core-mtc/lib/batch.js#assembleBatchFederated` 支持 N 签 + threshold；LandmarkCache 支持 ≥ M-of-N 验证 + pubkey-id 去重。`cc mtc federation join|leave|status` 命令组管理 `~/.chainlesschain/federation/members.json`（atomic write，schema `mtc-federation-registry/v1`），支持 Ed25519 + SLH-DSA-128F 异构成员。+11 core-mtc 单测 + 8 CLI 集成测试。
- [x] **P3.2 Marketplace 联邦信任锚（commit `15c29e9fe`）**：`cc mtc batch / batch-dids / batch-skills / publish-skills` 全部加 `--federation <id>` + `--threshold <n>` flag。Federation mode 从 P3.1 registry 加载所有成员的 key，对同一 tree_head 多签，`cc mtc verify` 多算法 dispatcher 自动接受联邦 landmark。+5 集成测试覆盖 3-of-3 Ed25519、2-of-3 with tampered sig、Ed25519+SLH-DSA 混合联邦、错误路径。
- [x] **P3.3 federation 服务发现 — filesystem（commit `aa13e07a9`，2026-05-02）**：`core-mtc/lib/federation.js` 定义 `mtc-federation-announce/v1` schema，`createMemberAnnounce` 自签 + `verifyMemberAnnounce` 校验签名/TTL/JWK 一致性，`FederationAnnounceCache` TTL-evicting 名册。CLI `cc mtc federation discover <fed-id> --drop-zone <dir>` 通过共享文件系统（NFS / Syncthing / SMB / USB）跨进程发现。+15 core-mtc 单测 + 7 跨进程集成测试。
- [x] **P3.4 federation 服务发现 — libp2p gossipsub（2026-05-02）**：`Libp2pTransport` 加 `publishRaw` / `subscribeRaw` 通用 pubsub API（gossipsub-only），`cc mtc federation discover --transport libp2p --listen <multiaddr> --connect <multiaddr>` 通过 gossipsub topic `mtc-federation/v1/<fed-id>` 真 P2P 自动发现。+9 core-mtc 单测（API 表面、错误路径、本地 dispatch fan-out、跨节点 smoke）+ 3 CLI 集成（libp2p 单节点 announce、错 transport 拒绝、缺 drop-zone 拒绝）。说明：2 节点 gossipsub 测试床的跨节点 mesh 形成时序天然 flaky（与现有 `libp2p-gossipsub.test.js` 一致），所以跨节点 delivery 用 smoke test，签名校验逻辑通过本地 dispatcher 测试做 deterministic 覆盖。

### Phase 4 — Desktop UI ✅ **全部落地（2026-05-02）**
- [x] **V6 Preview Shell 状态 widget** — `MtcStatusPreviewWidget.vue` + `DecentralEntries` 顶部新增 MTC 入口，显示 audit-mtc enabled/批次间隔/staging count/最近批次/签名算法（Ed25519 vs SLH-DSA-128F）；IPC 缺失时优雅降级；6 单测覆盖
- [x] **Web-panel /mtc 路由**（2026-05-02）— 三 tab：Audit 双轨状态（解析 `cc audit mtc status --json`）+ Marketplace publisher 历史（解析新增 `cc mtc publish-status --json`，13 单测）+ Envelope 验证工具（路径输入 + `cc mtc verify --json` 桥接）。新增 CLI 子命令 `cc mtc publish-status <state-file>` 让 web-panel 能查询 publisher 状态文件
- [x] **主进程 IPC 通道**（Phase 4.2，2026-05-02）— `desktop-app-vue/src/main/mtc/mtc-ipc.js` 新增三个 channel：`mtc:get-audit-status` 直接读 `userData/.chainlesschain/audit-mtc/` 内 config + staging + 最新 manifest，`mtc:get-active-alg` 从最新 batch 的 landmark.snapshots[0].signature.alg 推导，`mtc:verify-envelope` 通过 core-mtc in-process 多算法 verifier（无 subprocess）。preload 暴露 `electronAPI.mtc.{getAuditStatus, getActiveAlg, verifyEnvelope}`。注册到 `phase-3-4-social.js`，`safeRegister` fatal:false。15 单测覆盖
- [x] **DID 详情页 MTC 包含证明 drawer**（Phase 4.3，2026-05-02 commit `1ed105226`）：复用组件 `MtcInclusionProofDrawer.vue`，DID 行加 SafetyOutlined 按钮 → 抽屉打开（Envelope + Landmark 路径输入）→ `electronAPI.mtc.verifyEnvelope` 多算法 dispatcher 验证 → 色编码结果卡（subject / kind / tree size / issuer）。
- [x] **Marketplace 列表 MTC 验证按钮**（Phase 4.3，2026-05-02 commit `1ed105226`）：`SkillMarketplacePage.vue` 加 "MTC" 列 + 复用同一 drawer，per-row 按钮提示用户 `cc mtc publish-skills` 的 envelope 路径约定。
- [x] **Web-panel /did MTC 验证按钮（cross-host parity）**（2026-05-02 commit `96c08db20`）：`MtcVerifyDrawer.vue`（基于 `ws.execute('mtc verify --json')` 桥接 `cc serve`）+ `DID.vue` 行级按钮，与 desktop UX 对齐。Marketplace web-panel 不加 per-row 按钮 — `/mtc` Tab 2/3 已覆盖更高效的工作流。

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

| 模块 | 状态 | 实施 |
|---|---|---|
| **`packages/core-mtc/`** | ✅ 已落地 | 完整协议实现：MerkleTree / Verifier / LandmarkCache / Ed25519 signer / 4 transports / **assembleBatch**（v0.4 抽出公共装配） |
| **`packages/cli/src/commands/mtc.js`** | ✅ 已落地 | `cc mtc {batch / verify / landmark inspect / batch-dids / batch-skills / publish-skills / serve}` |
| **`packages/cli/src/lib/audit-mtc.js`** | ✅ 已落地 (v0.4) | 双轨签名 lib：config 门控 / Ed25519 实时 sig / 幂等关批 / staging→batch 迁移 / reconcile-check |
| **`packages/cli/src/commands/audit.js`** | ✅ 已落地 (v0.4) | 新增 `cc audit mtc {enable / disable / config / set-interval / emit / reconcile / reconcile-check / status}` 子命令组 |
| `packages/cli/src/lib/did-manager.js` | ✅ 集成 | `cc mtc batch-dids` 通过 `getAllIdentities/getIdentity` 读 DID DB |
| `packages/cli/src/lib/skill-loader.js` | ✅ 集成 | `cc mtc batch-skills` / `cc mtc publish-skills` 通过 `CLISkillLoader.loadAll()` 读技能 |
| `packages/core-mtc/lib/signers/slh-dsa.js` + `packages/cli/src/lib/pqc-manager.js` | ✅ Phase 1.6 已落地 | SLH-DSA-128f 实签接入，`@noble/post-quantum@0.6.1` 已装；`cc mtc batch / batch-dids / batch-skills / publish-skills --alg slh-dsa-128f` opt-in；`cc mtc verify` 多算法 dispatcher。**实现路径与 v0.3 设想的 `cli/src/pqc/` 不同**——共享签名能力下沉到 `core-mtc/lib/signers/`，CLI 侧只保留 PQC manager |
| `desktop-app-vue/src/main/mtc/mtc-ipc.js` + `MtcInclusionProofDrawer.vue` | ✅ Phase 4 已落地 (2026-05-02) | 三 IPC 通道 `mtc:get-audit-status` / `mtc:get-active-alg` / `mtc:verify-envelope`（preload `electronAPI.mtc.*`）+ DID 详情页 / Marketplace per-row MTC 验证按钮（commit `1ed105226`）。**实现路径与 v0.3 设想的 `services/did-manager.js#submitToMTCA()` 不同**——desktop 通过 IPC bridge + drawer 暴露验证能力，不在 DID manager 加提交方法 |
| `backend/project-service/` | ✅ Phase 2 audit 已接入 (2026-05-02) | Q-COMP-1 + Q-COMP-2 法务/测评出函已到 (2026-05-01) 解除产线阻塞；`AuditMtcBridgeService` (fire-and-forget spawn `cc audit mtc emit`) + `AuditMtcProperties` + `OperationLogService.saveLog` 末端桥接 + `OperationLog.audit_mtc_event_id` 字段 + `V013` 迁移 (commit `70d2cda59`，Q-ENG-2 + Q-PROD-1 决议)；15 JUnit 测试。生产启用走 `AUDIT_MTC_ENABLED=true` (+ 可选 `AUDIT_MTC_TENANT_ALLOW_LIST`)，默认仍 off |
| `desktop-app-vue/src/main/p2p/p2p-manager.js` | ✅ 共享 libp2p 栈 | core-mtc 用同一版 libp2p 3.1.5，无冲突 |
| libp2p / IPFS 适配层 | 新增 `mtc-landmark/<namespace>` topic 订阅 |

---

## 12. 已知限制 / 未解决问题

> 以下分两类：**永久设计权衡 / 运维约束**（不会"完成"，作为读者心智模型保留）和 **代码 / 文档 TODO**（会在路线图推进中关闭）。

**永久限制（设计 / 运维约束）：**

1. **延迟不适合实时场景**：DID 24h 批延迟、Marketplace 1 月批延迟 — 实时通信继续走单条签名
3. **IPFS 可达性**：Phase 1 假设节点能访问 IPFS 公网；离线 / 内网部署下 landmark 分发需走自建 pinning service
4. **Tree size 上限**：单棵树长到 N=2³² 后审计路径 32 层，验证仍 < 1 ms；但单 landmark 文件会很大 — Phase 3 可能需要"分代树根"

**TODO（已完成 / 待补）：**

2. **联邦 MTCA 的治理**：✅ **机制 + 治理文档全落地** — Phase 3 P3.1+P3.2+P3.3 已落（commits `95b861914` 多签 landmark、`15c29e9fe` Marketplace 联邦信任锚、`aa13e07a9` filesystem 服务发现）+ libp2p gossipsub 自动发现 + Ed25519/SLH-DSA 异构联邦；治理规范见 `docs/design/MTC_联邦治理_v1.md`（2026-05-02）— 覆盖 5 阶段联邦生命周期、准入审批 + 候选期权重 0.5、M-of-N 业务场景分级、三种退出路径、Fork/Merge 语义
5. **与现有 audit log 写入路径的语义冲突**：✅ **已解决（2026-05-02 commit `70d2cda59`）** — backend `AuditMtcBridgeService` 解析 `cc audit mtc emit --json` 提取 event_id，via setEmitCallback 通知 `OperationLogService` 写入 `audit_mtc_event_id` 字段（V013 迁移）；web-panel `Audit.vue` 加 MTC 列四态徽章（—/已签未查/待关批/已关批 #N），点击触发 `cc audit mtc reconcile-check` 缓存到 row
6. **跨链桥的 MTC 化**：✅ **设计文档已落** — 见 `docs/design/MTC_跨链桥_v1.md`（2026-05-02）— 新增 `mtc/v1/bridge/<chain-pair>/...` namespace（字典序）、桥两侧 MTCA 三种互信模式（Independent / Federated / Light Client）、跨链特有威胁分析（T1 oracle 共谋 / T5 censorship）、与现有 `cc crosschain` 19 子命令集成点。**实现仍 opt-in（`--mtc` flag）**，待 desktop RPC 链适配器成熟后切默认 on

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

### 14.1 已完成（截至 v0.4）
- ✅ Phase 0 协议固化 — `MTC_数据格式_v1.md`
- ✅ Phase 1 W1+W2+W3 — 核心库 + CLI 5 子命令（`be70c5b17`）
- ✅ Phase 1 W4 持久化 + Ed25519 实签 + DID 集成（`8926a5bc0` / `a4b88ebda` / `1e63dacc1`）
- ✅ Phase 1 W5 — InMemory + Filesystem transport 两节点 e2e（`58ad63a6b`）
- ✅ Phase 1.5 — Libp2p direct + gossipsub 模式 + `cc mtc serve` 守护进程（`40fa0689a` / `1b0ae1105` / `4d1a81586`）
- ✅ Phase 2 partial — Marketplace `cc mtc batch-skills`（`67da18480`）
- ✅ 评审清单 v0.2 — 16 题决议
- ✅ **Phase 2 batch lift** — `assembleBatch` 抽到 `core-mtc/lib/batch.js`，CLI / audit 共用一条装配代码（v0.4 本次）
- ✅ **Phase 2 marketplace daemon** — `cc mtc publish-skills` 差量发布（v0.4 本次）
- ✅ **Phase 2 audit 双轨脚手架** — `cc audit mtc` 8 子命令、off-by-default、60s/3600s 双路径配置；解锁后单 flag 启用（v0.4 本次）

### 14.2 已解锁（Phase 2 audit 产线启用 — 2026-05-01 法务出函）
> **更新 (2026-05-01)**：Q-COMP-1 + Q-COMP-2 法务/测评出函已收到，audit-mtc 产线启用阻塞解除。脚手架 `packages/cli/src/lib/audit-mtc.js` + `cc audit mtc *` 全部 ready。**默认仍 `enabled=false`**，由各租户/组织在自己的环境内通过 `cc audit mtc enable --interval <60|3600>` 显式启用——不全局自动翻盘，保留用户对产线启用时机的控制权。
- ✅ **Q-COMP-1** — 等保三级"防篡改最终性时间窗"口径已确认。脚手架 1h（默认）+ 1min 两条路径均可用，根据出函具体口径选 `--interval 3600`（宽松）或 `--interval 60`（严判）。
- ✅ **Q-COMP-2** — T/ZGCMCA 023—2025 标准条款摘要已收到（具体条款落到组织内部审计报告，不在公开文档展示）。
- ✅ **Q-COMP-3 — 已解锁（2026-05-03 法务出函）**：境内联盟链路径解锁。Phase 1+2 仍走 IPFS pinning + 多副本（不变），但联邦 governance.log 现在可选锚定到链上（hash-only），见 v0.12 实现 — `SCHEMA_GOVERNANCE_ANCHOR` schema + `cc mtc federation governance-anchor / governance-verify-anchor`。生产部署 swap 真实链 client 即可（lib 已 ship in-memory + filesystem mock）。详见 `MTC_联邦治理_v1.md` §11 #2 + `Deferred Items Registry` §14.5。

### 14.3 进行中 / 即将启动
- [x] **Phase 1.6 — SLH-DSA 实签**：✅ `@noble/post-quantum@0.6.1` 落地。`core-mtc/lib/signers/slh-dsa.js` 新增；`assembleBatch(leaves, keys, meta, signer?)` 支持 opt-in；`cc mtc batch/batch-dids/batch-skills/publish-skills --alg slh-dsa-128f` CLI 暴露；`cc mtc verify` 多算法 dispatcher 同时支持 Ed25519 + SLH-DSA-128F 信任锚。Audit-mtc 仍维持 Ed25519（realtime sig + 短窗 batch，PQC 收益边际，未来视产线启用情况单独评估）。
- [x] **Phase 2 backend 灰度切换**（Q-ENG-2 决议，2026-05-02）：`backend/project-service` 加 `audit.mtc.*` 配置（默认 enabled=false） + `AuditMtcProperties` + `AuditMtcBridgeService`（fire-and-forget CLI 桥接，spawn `cc audit mtc emit`）+ 在 `OperationLogService.saveLog` 末端调用桥接。tenant allow-list 控制灰度范围，timeout-ms 防止子进程失控。15 JUnit 测试覆盖（Maven `BUILD SUCCESS`）。生产启用走环境变量 `AUDIT_MTC_ENABLED=true` + 可选 `AUDIT_MTC_TENANT_ALLOW_LIST=tenant-a,tenant-b`。
- [x] **Phase 4 — Desktop + Web UI 全部落地**（2026-05-02）：V6 状态 widget + 主进程 IPC + DID 详情页 MTC 包含证明 drawer + Marketplace per-row 验证按钮 + Web-panel /mtc 三 tab + Web-panel /did 行 MTC 验证（cross-host parity）。详见 §9 Phase 4 列表。
- [x] **audit "待批次关闭" 徽章**（Q-PROD-1 决议 B，2026-05-02 commit `70d2cda59`）：backend 端 `AuditMtcBridgeService` 解析 `cc audit mtc emit --json` stdout 提取 event_id，via setEmitCallback 通知 `OperationLogService` 写入新字段 `audit_mtc_event_id`（V013 迁移 + 索引）；web-panel `audit-parser.js` 暴露 `auditMtcEventId` + `classifyMtcStatus`，Audit.vue 加 MTC 列：—/已签未查/待关批/已关批 #N 四态徽章，点击触发 `cc audit mtc reconcile-check` 缓存到 row。+4 backend 单测、+5 web-panel 单测。

### 14.4 待补设计文档
1. ✅ **联邦 MTCA 治理设计文档**（2026-05-02 落地，文件 `docs/design/MTC_联邦治理_v1.md`）— 关闭 §12 第 2 项的"治理"半截。覆盖 11 节：联邦生命周期 (Bootstrap/Steady/Dispute/Wind-down/Closed)、准入审批流（候选期权重 0.5）、M-of-N 阈值业务场景分级（含 N≥5 强制 PQC 多样性）、主动 leave / 协商 revoke / 强制 revoke 三种退出、密钥轮换、Fork/Merge 语义、与 governance.log + announce + verifier 的接口、6 项决策记录、4 项 v0.2 后续。
2. ✅ **跨链桥的 MTC 化设计文档**（2026-05-02 落地，文件 `docs/design/MTC_跨链桥_v1.md`）— 关闭 §12 第 6 项。覆盖 11 节：与现有 `cc crosschain` 19 子命令集成、新增 `mtc/v1/bridge/<chain-pair>/...` namespace（字典序）、桥两侧 MTCA 三种互信模式（Independent / Federated / Light Client）+ 决策表、5 类失败模式与回滚、5 项威胁模型分析（含跨链特有 T1 oracle 共谋 / T5 censorship）、7 项决策记录、6 项 v0.2 后续。**仍 opt-in（`--mtc` flag），等 desktop RPC 链适配器成熟后切默认 on**。

### 14.5 Deferred Items Registry（v0.12 起 — single source of truth）

跨子文档统一索引所有未完成项 + 阻塞类型 + 预期解锁条件。每项都可在对应设计文档查到详细位置。

**仍 NOT done — 都有明确外部 blocker**

| # | 项 | 子文档位置 | Blocker 类型 | 预期解锁条件 |
|---|---|---|---|---|
| D1 | 真实 RPC 链适配器 | `MTC_跨链桥_v1.md` §11 #1 | 工程依赖 | desktop ethers/web3 集成专项 + 5 链 endpoint 商务接入 + 集成测试矩阵 |
| D2 | Cross-chain DID 解析（生产路径） | `MTC_跨链桥_v1.md` §11 #2 | 同 D1（schema 已就绪） | desktop RPC 适配器解锁后 |
| D3 | 完整 paxos 跨成员实时门控 | `MTC_联邦治理_v1.md` §11.5 | 工程量 | 多周分布式系统专项；当前 §9.6 替代方案 production-ready |
| D4 | Libp2p cross-node wire e2e 真测 | `MTC_联邦治理_v1.md` §11.5 | 测试基础设施 | gossipsub 3+ peer testbed；当前 call-path + dispatch test 覆盖逻辑 |

**永久限制（不会"完成" — 设计权衡）**

| # | 项 | 文档位置 | 说明 |
|---|---|---|---|
| P1 | 延迟不适合实时场景 | §12 #1 | DID 24h / Marketplace 1mo 批延迟；实时通信继续走单签 |
| P2 | IPFS 可达性 | §12 #3 | 离线/内网部署需自建 pinning service — 部署侧问题 |
| P3 | Tree size 上限 | §12 #4 | N=2³² 后单 landmark 文件巨大；Phase 3+ 才会触及 "分代树根" |

**已闭环（v0.6 → v0.12）— 历史参考**

| Round | 关闭项 | Commit |
|---|---|---|
| v0.6 | cross-chain bridge MTC integration（lib + CLI + opt-in） | `0123fd168` `5a9898028` `0f6437f1a` |
| v0.7 | 联邦治理 8 CLI + 桥 MTCA daemon + V6 widget | `1c1e4096d` |
| v0.8 | 跨成员 governance.log filesystem 同步 + 治理 GUI desktop+web | `bb88756d6` `a8fff1f52` |
| v0.9 | sync daemon + libp2p 通道 + quorum 门控 + web 操作型 GUI | `9ad09446f` |
| v0.10 | 多提案 CRDT + sync stats + libp2p smoke + 加固 | `6e90faa9d` |
| v0.10.1 | desktop V6 widget 接 sync-stats | `aedee372d` |
| v0.11 | cross-fed 互信 + 离线审计 + 多跳桥 + gas-aware + SLA + 监控 | `b312563f0` |
| v0.12 | 链上治理锚定（Q-COMP-3 出函解锁） | _本次_ |

### 14.6 上游跟踪
- 关注 `draft-ietf-plants-merkle-tree-certs-03+` 对树头签名算法、consistency proof、JWK 编码 SLH-DSA 的新建议
- 关注 IETF COSE WG 的 SLH-DSA / ML-DSA JWK 草案（数据格式 §13 第 1 项的未决依赖）
- 关注 `@noble/post-quantum` 发布动态

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

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。默克尔树证书（MTC）ChainlessChain 落地方案：MTC 总落地设计。

### 2. 核心特性
MTC 落地 / Phase 0-4 / 联邦 / 跨链。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「MTC 落地方案」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
