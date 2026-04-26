# 默克尔树证书 (MTC) 用户指南

> v5.0.2.55+ 引入的后量子安全签名压缩方案 — `cc mtc` 命令使用手册。
>
> 涵盖 DID 批量发布、Skill Marketplace 上架、verifier 守护进程配置，以及与
> libp2p / 文件系统多种传输模式的实操。
>
> **最后更新**: 2026-04-26 · 另见：[设计文档站 — MTC 落地方案](/design/mtc-landing-plan)、
> [`docs/design/默克尔树证书_MTC_落地方案.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design)

---

## 1. 这是什么 / 为什么

ChainlessChain 即将切换到**后量子安全签名**（FIPS 205 / SLH-DSA）。但单条 SLH-DSA-128f 签名 ≈ 17 KB，而 DID 文档每周更新一次会让 DHT 流量从 5 GB 涨到 170 GB（10K 用户规模）。

**MTC（Merkle Tree Certificates）** 借鉴 IETF PLANTS WG 协议，把 N 条证书装进一棵 Merkle 树，CA 只对树根（tree head）签**一次**。每条证书携带物从 17 KB 降到 ~700 B，**节省约 97%**。

| 场景 | 朴素 SLH-DSA-128f | MTC（每条 envelope）| 节省 |
|---|---|---|---|
| 单 DID 文档 | ~17 KB | ~700 B | 96% |
| 1 K 批次 | ~17 MB | ~700 KB | 96% |
| 8 K 批次 | ~136 MB | ~5.6 MB | 96% |

**当前实现状态**：树头签名暂用 Ed25519 作为 stopgap；待 `@noble/post-quantum` 上线后切到 SLH-DSA-128f（接口已为此预留）。

---

## 2. 适用场景

- 需要批量发布 DID 文档到 P2P 网络的去中心化身份运营者
- 在 Marketplace 上架 / 验证大量技能的开发者
- 需要离线验证证书包含性的合规审计员
- 部署 verifier 守护进程接收 + 持久化批次的节点运维

所有命令为 Headless 模式，无需桌面应用。

---

## 3. 核心概念（30 秒）

```
producer (MTCA)                    verifier
  ├ 收集 N 条证书                    ├ 订阅 transport
  ├ 构 Merkle 树                     ├ 接收 landmark + 验签
  ├ 签 tree_head                     ├ 缓存到 LandmarkCache
  ├ 打 landmark.json                 │   (磁盘持久化)
  ├ 每条出 envelope.json             └ 拿 envelope.json：
  └ publish 到 transport                 重算 inclusion proof
                                         vs landmark 树根 → ✓
```

| 概念 | 说明 |
|---|---|
| **MTCA** | Merkle Tree Certificate Authority — 收集证书、建树、签树根的角色 |
| **landmark** | 已签的树头快照，含 root_hash + tree_size + 签名 + 信任锚 |
| **envelope** | 单条证书 + inclusion proof（leaf_index, audit_path） |
| **tree_head_id** | tree_head 的 SHA-256 哈希（envelope 引用它，不内嵌全文） |
| **transport** | landmark 分发通道：InMemory / Filesystem / Libp2p |

---

## 4. 命令速查

```bash
# 签发批次（3 种来源）
cc mtc batch <input.json>     --namespace <ns> --issuer <issuer>  # 通用
cc mtc batch-dids             --namespace <ns> --issuer <issuer>  # 从 DID DB
cc mtc batch-skills           --namespace <ns> --issuer <issuer>  # 从本地 skills

# 验证
cc mtc verify <envelope.json> --landmark <landmark.json>

# 检查
cc mtc landmark inspect <landmark.json>

# 守护进程（订阅 + 持久化）
cc mtc serve --transport={libp2p,filesystem} [...] --cache-dir <dir>
```

---

## 5. 实操：从 DID DB 发布批次

### 5.1 创建一些 DID 身份

```bash
cc did create --name Alice
cc did create --name Bob
cc did list --json
```

### 5.2 构造批次

```bash
cc mtc batch-dids \
  --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:zQ3shMyMTCA \
  --out ./mtc-out
```

输出示例：
```
⚠ STOPGAP — tree-head signed with Ed25519 (will switch to SLH-DSA when @noble/post-quantum lands).
✔ Batched 2 DID(s)
  Namespace:    mtc/v1/did/000001
  Tree size:    2
  Root hash:    sha256:mTzhpZFwRun73V7EBgk0z5l-srzAwlL1dF6NLwwclxU
  Tree head ID: sha256:EVWfR9goXamzZ1xfjXj1h9HnE2cgdVZwDD7ZeTSc6k4
  Landmark:     ./mtc-out/landmark.json
  Envelopes:    2 files in ./mtc-out
  Subjects:
    did:chainless:zQ3shAlice...
    did:chainless:zQ3shBob...
```

`./mtc-out/` 目录结构：
```
landmark.json            ← 树根签名快照（含信任锚）
envelope-000000.json     ← Alice 的证书
envelope-000001.json     ← Bob 的证书
```

### 5.3 复用密钥（推荐）

每次 `batch-dids` 默认生成新 Ed25519 密钥对，导致 verifier 无法跨批次共享信任锚。生产用法应固定密钥：

```bash
cc mtc batch-dids \
  --namespace mtc/v1/did/000002 \
  --issuer mtca:cc:zQ3shMyMTCA \
  --secret-key-file ~/.chainlesschain/mtc/mtca.key.hex \
  --out ./mtc-out-v2
```

首次会创建 `mtca.key.hex`（mode 0600，仅 owner 可读）；后续运行复用同一密钥 → 信任锚相同 → verifier 一份配置走天下。

### 5.4 过滤特定 DID

```bash
cc mtc batch-dids \
  --namespace mtc/v1/did/000003 \
  --issuer mtca:cc:zQ3shMyMTCA \
  --did did:chainless:zQ3shAlice... \
  --out ./mtc-out-alice-only
```

可重复 `--did` 选择多条，省略则包含所有身份。

---

## 6. 实操：验证 envelope

最小例子：本机签 + 本机验

```bash
cc mtc verify ./mtc-out/envelope-000000.json \
  --landmark ./mtc-out/landmark.json
```

成功输出：
```
⚠ STOPGAP — tree-head signed with Ed25519 (...)
✔ Envelope verified
  Subject:   did:chainless:zQ3shAlice...
  Kind:      did-document
  Tree size: 2
  Issuer:    mtca:cc:zQ3shMyMTCA
```

**关键错误码**（按 [`MTC_数据格式_v1.md` §11](/design/mtc-data-format-v1) 完整列出）：

| Code | 退出码 | 含义 | 可恢复 |
|---|---|---|---|
| `LANDMARK_MISS` | 2 | 本地 cache 没找到对应 tree_head_id | 拉新 landmark |
| `LANDMARK_EXPIRED` | 2 | tree_head 已过期 | 拉新 landmark |
| `ROOT_MISMATCH` | 2 | inclusion proof 重算根 ≠ 声明根 | ❌ 视为伪造 |
| `BAD_TREE_HEAD_SIG` | 2 | 树头签名验签失败 | ❌ 信任锚不匹配 |
| `MTCA_DOUBLE_SIGNED` | 2 | 同 namespace+tree_size 看到不同根 | ❌ split-view 攻击 |

测试时可加 `--now <ISO>` 模拟过期：

```bash
cc mtc verify envelope.json --landmark landmark.json \
  --now 2027-01-01T00:00:00Z   # 模拟未来时间，触发 LANDMARK_EXPIRED
```

---

## 7. 实操：Marketplace 技能批次

```bash
# 全部技能
cc mtc batch-skills \
  --namespace mtc/v1/skill/000001 \
  --issuer mtca:cc:zQ3shMarket \
  --secret-key-file ~/.chainlesschain/mtc/marketplace.key.hex \
  --out ./skill-batch

# 只发指定技能
cc mtc batch-skills \
  --namespace mtc/v1/skill/000002 \
  --issuer mtca:cc:zQ3shMarket \
  --skill ai-doc-creator \
  --skill code-reviewer
```

每条 leaf 包含技能 manifest 的 content_hash（id+displayName+description+version+category 的 JCS canonical）+ subject `skill:cc:<id>@<version>`。

---

## 8. 实操：守护进程 verifier

`cc mtc serve` 是 verifier daemon 模式：订阅 transport → 拉 landmark → 验签 → 持久化到 LandmarkCache → 显示统计。

### 8.1 文件系统 drop-zone（最简单）

适合局域网共享目录、USB 同步、离线环境。

**节点 A（producer）**：
```bash
# 生成批次到共享目录
cc mtc batch-dids --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:zQ3shMTCA \
  --secret-key-file ~/.chainlesschain/mtc/mtca.key.hex \
  --out ./output

# 推到 drop-zone
cp ./output/landmark.json /shared/mtc-drop/content/
# (或写一个 cc mtc publish-to <drop-zone> 的小脚本)
```

**节点 B（verifier）**：
```bash
cc mtc serve \
  --transport=filesystem \
  --drop-zone /shared/mtc-drop \
  --prefix mtc/v1/did \
  --cache-dir ~/.chainlesschain/mtc/cache
```

输出：
```
✔ filesystem transport watching /shared/mtc-drop
subscribed: mtc/v1/did
[1] mtc/v1/did/000001 tree_size=2 cid=fs:abc...
```

`--exit-after <n>` 在收到 N 条后自动退出（CI 用）；省略则常驻。

### 8.2 Libp2p direct 模式

适合直连两节点的 P2P 场景。

**节点 A**：
```bash
cc mtc serve --transport=libp2p \
  --listen /ip4/0.0.0.0/tcp/9000 \
  --prefix mtc/v1/did \
  --cache-dir ~/.chainlesschain/mtc/cache
# 启动时打印自己的多址：/ip4/127.0.0.1/tcp/9000/p2p/12D3KooW...
```

**节点 B**（连节点 A）：
```bash
cc mtc serve --transport=libp2p \
  --connect /ip4/<A的IP>/tcp/9000/p2p/<A的peerid> \
  --prefix mtc/v1/did
```

A 调用 `cc mtc batch-dids` 后，需自己 publish；目前 publish-to-libp2p 是 Phase 2 工作，当前可手工把 landmark 喂进 transport。

### 8.3 Libp2p gossipsub 模式

订阅 topic 即 namespace prefix。适合多节点广播场景。

```bash
cc mtc serve --transport=libp2p --mode=gossipsub \
  --listen /ip4/0.0.0.0/tcp/9000 \
  --connect <已知节点的多址> \
  --prefix mtc/v1/did
```

配置 `D=1` + `floodPublish` 适配低密度网络（2 节点也能跑）。

---

## 9. 持久化与重启恢复

`--cache-dir <dir>` 启用磁盘镜像。目录结构：
```
~/.chainlesschain/mtc/cache/
  mtc/v1/did/000001/sha256_abc.json    ← snapshot 1
  mtc/v1/did/000002/sha256_def.json    ← snapshot 2
  ...
```

`cc mtc serve` 启动时自动 `loadFromDisk()`：
- ✅ 重新校验每个 snapshot 的签名（用当前信任锚）
- ❌ 篡改文件、密钥变更后的旧文件 → 跳过 + 计入失败列表
- 启动日志：`cache: loaded N prior snapshots, M failed`

---

## 10. 与现有功能的关系

| 现有功能 | MTC 影响 |
|---|---|
| `cc did create/list/resolve` | 不变，DID 生成 + 本地存储完全独立 |
| `cc did publish`（未来） | 默认走 MTC 路径；`--no-mtc` 兜底单签 |
| `cc marketplace publish` | Phase 2 改为入 MTCA 队列 |
| `cc audit emit`（企业版） | Phase 2 双轨签名（实时 Ed25519 + 关批 MTC），合规复核中 |
| 现有 Ed25519 签名 | 长期保留作为 fallback 路径 |

---

## 11. 常见问题

**Q: 现在签出来的 landmark 包含 SLH-DSA 签名吗？**

A: 不，目前 stopgap 是 Ed25519。代码已为 SLH-DSA-128f 预留接口（`signatureVerifier` DI），等 `@noble/post-quantum` npm 上线即切换。所有 stopgap 落地的命令都会显示 `⚠ STOPGAP` 警告。

**Q: 不同节点之间的 verifier 如何信任同一 MTCA？**

A: landmark 文件自带 `trust_anchors[]`（含公钥 JWK）。verifier 用 `makeVerifierFromLandmark(landmark)` 提取 → 信任传递在 landmark 内部完成，不需要预装信任根。**前提**是首份 landmark 通过可信通道（带外）送达。

**Q: 批次大小 N 怎么选？**

A: 当前默认 = 输入条目数。生产建议：
- DID：8192 / 批，每周关一次（推荐与 IETF 节奏对齐）
- Skill：1024 / 批，每月关一次
- Audit（未来）：1024 / 批，每小时关一次（合规复核中）

**Q: split-view 攻击会被检测吗？**

A: 会。`LandmarkCache.ingest()` 在 namespace + tree_size 相同时强制要求 root_hash 一致；不一致即抛 `MTCA_DOUBLE_SIGNED`。详见 [设计文档 §10.1 威胁模型](/design/mtc-landing-plan)。

---

## 12. 进阶：核心库直接调用

```js
import {
  MerkleTree, leafHash, jcs, encodeHashStr, sha256,
  LandmarkCache, verify, ed25519,
  TREE_HEAD_SIG_PREFIX,
} from '@chainlesschain/core-mtc';

// 构造证据
const leaves = items.map(it => leafHash(jcs(it)));
const tree = new MerkleTree(leaves);
const root = tree.root();
const proof = tree.prove(0); // [Buffer, Buffer, ...]

// 签 tree_head
const keys = ed25519.generateKeyPair();
const treeHead = { schema: 'mtc-tree-head/v1', /* ... */ };
const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, jcs(treeHead)]);
const signature = ed25519.signTreeHead(signingInput, { ...keys, issuer: '...' });

// 验证
const cache = new LandmarkCache({
  signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
});
cache.ingest(landmark);
const result = verify(envelope, cache);
```

完整 API 参考详见 [设计文档站 MTC 数据格式规范](/design/mtc-data-format-v1)。
