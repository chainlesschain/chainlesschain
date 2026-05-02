# 默克尔树证书 (MTC) 用户指南

> v5.0.2.55+ 引入的后量子安全签名压缩方案 — `cc mtc` 命令使用手册。
>
> 涵盖 DID 批量发布、Skill Marketplace 上架、verifier 守护进程配置，以及与
> libp2p / 文件系统多种传输模式的实操。
>
> **最后更新**: 2026-05-02（v0.5：Phase 0–4 全部落地，含 federation 多签 + libp2p gossipsub auto-discovery） · 另见：[设计文档站 — MTC 落地方案](/design/mtc-landing-plan)、
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

**当前实现状态**：默认 Ed25519（classical，64 B/sig）；通过 `--alg slh-dsa-128f` 可启用 FIPS 205 SLH-DSA-SHA2-128F 后量子签名（17 KB/sig，依赖 `@noble/post-quantum@0.6.1`）。`cc mtc verify` 多算法 dispatcher 自动识别 landmark trust anchor 算法。

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

# Marketplace publisher 守护进程（v0.4 新）
cc mtc publish-skills --namespace-prefix <prefix> --issuer <issuer> \
  --out <dir> --state-file <path> [--once | --interval <s>]

# Federation MTCA — 多签 + 服务发现（v0.5 新）
cc mtc federation join <fed-id> --member-id <m> [--alg ed25519|slh-dsa-128f]
cc mtc federation leave <fed-id> --member-id <m> [--keep-key]
cc mtc federation status [<fed-id>]
cc mtc batch* / publish-skills --federation <id> [--threshold <M>]   # M-of-N
cc mtc federation discover <fed-id>
  --transport filesystem --drop-zone <dir>      # 或
  --transport libp2p --listen <maddr> --connect <peer-maddr>
  [--member-id <m>] [--ttl <s>] [--once]

# Federation 治理（v0.7 新，see design 联邦治理 v1）
cc mtc federation invite <fed-id> <candidate-member-id> --actor <m> --candidate-pubkey-id <id>
cc mtc federation vote <fed-id> <candidate-member-id> --actor <m> --decision approve|reject
cc mtc federation propose-revoke <fed-id> <target-id> --actor <m> --reason <text>
cc mtc federation confirm-revoke <fed-id> <target-id> --actor <m> [--reason key-compromise]
cc mtc federation rotate-key <fed-id> --actor <m> --new-pubkey-id <id> [--new-alg <alg>]
cc mtc federation propose-threshold <fed-id> <new-M> --actor <m>
cc mtc federation fork <fed-id> <new-fed-id> --actor <m> --members <id1,id2,...>
cc mtc federation merge <fed-id> <other-fed-id> <new-fed-id> --actor <m>
cc mtc federation governance-log <fed-id> [--events-only] [--json]

# 验证
cc mtc verify <envelope.json> --landmark <landmark.json>

# 检查
cc mtc landmark inspect <landmark.json>

# Verifier 守护进程（订阅 + 持久化）
cc mtc serve --transport={libp2p,filesystem} [...] --cache-dir <dir>

# Audit 双轨脚手架（v0.4 新，off-by-default — 待法务出函后启用）
cc audit mtc {enable | disable | config | set-interval <s>}    # 配置
cc audit mtc {emit | reconcile | reconcile-check <id> | status}  # 双轨流转

# 跨链桥 MTC 集成（v0.6 新，opt-in via --mtc，see design 跨链桥设计 v1）
cc crosschain mtc-status                     # 配置 + trust anchors + staging/batches
cc crosschain mtc-trust-anchor add <chain> <pubkey-id> --alg --issuer
cc crosschain mtc-trust-anchor list [<chain>]
cc crosschain mtc-trust-anchor remove <chain> <pubkey-id>
cc crosschain mtc-envelope --input <ops.json> --src-chain --dst-chain --batch-seq
cc crosschain mtc-verify <envelope> <landmark>
cc crosschain mtc-batch                      # 关 staging 中所有 op 为批次（按 chain-pair 分组）
cc crosschain bridge|swap|send ... --mtc     # 在原命令成功后写一条 staging op
cc crosschain mtc-serve [--interval <s>] [--once]   # daemon: 周期性 close batch（v0.7 新）
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

### 5.4 选择签名算法（v0.4 / Phase 1.6）

所有 `cc mtc batch*` + `cc mtc publish-skills` 都支持 `--alg`：

```bash
# 默认（classical Ed25519，64 B/sig，全网最快）
cc mtc batch-dids --namespace mtc/v1/did/000001 --issuer mtca:cc:zQ3sh... --alg ed25519

# 后量子（FIPS 205 SLH-DSA-SHA2-128F，17 KB/sig，opt-in）
cc mtc batch-dids --namespace mtc/v1/did/000001 --issuer mtca:cc:zQ3sh... --alg slh-dsa-128f
```

`--secret-key-file` 自动适配密钥长度（Ed25519 = 32 B，SLH-DSA = 64 B），文件首次创建时按所选算法生成。**已存的 Ed25519 key 与 SLH-DSA key 不互通**（不同算法的 trust anchor 单独签发）。

`cc mtc verify` 是多算法 dispatcher，自动按 landmark trust_anchors 内 `alg` 字段识别后选用对应 verifier，**无需 `--alg` 提示**。

### 5.5 过滤特定 DID

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

### 8.4 Marketplace publisher 守护进程（v0.4）

`cc mtc publish-skills` 是 producer 端守护进程：扫描本地 `CLISkillLoader.loadAll()`，对技能集合做 fingerprint（id+version+category+activation+description 的 JCS canonical → SHA-256），与状态文件对比，**仅当指纹变化时**才生成新批次。重复运行不会产生重复批次。

```bash
# 一次性发布（CI / cron 用）
cc mtc publish-skills \
  --namespace-prefix mtc/v1/skill \
  --issuer mtca:cc:zQ3shMarket \
  --out ~/.chainlesschain/marketplace-batches \
  --state-file ~/.chainlesschain/marketplace-state.json \
  --secret-key-file ~/.chainlesschain/mtc/marketplace.key.hex \
  --once

# 守护模式（10 分钟一次，长期运行）
cc mtc publish-skills \
  --namespace-prefix mtc/v1/skill \
  --issuer mtca:cc:zQ3shMarket \
  --out ~/.chainlesschain/marketplace-batches \
  --state-file ~/.chainlesschain/marketplace-state.json \
  --interval 600
```

输出（首次发布）：
```json
{
  "iteration": "published",
  "seq": "000001",
  "namespace": "mtc/v1/skill/000001",
  "tree_head_id": "sha256:...",
  "tree_size": 139,
  "batch_dir": "~/.chainlesschain/marketplace-batches/000001",
  "landmark_path": "~/.chainlesschain/marketplace-batches/000001/landmark.json",
  "envelope_paths": ["..."]
}
```

输出（无变化）：
```json
{ "iteration": "skipped", "reason": "fingerprint unchanged", "last_seq": 1, "fingerprint": "sha256:..." }
```

**状态文件**（`mtc-skill-publish-state/v1`）使用原子写（temp + rename），即使进程崩溃也不会污染。如果该文件被外部损坏，下次启动会**显式报错而非静默重置**到 seq 0。

> 与 `cc mtc serve --transport=filesystem` 配合：把 `--out` 指到 verifier 节点能访问的共享目录（NFS / SMB / USB），verifier 即可订阅 `mtc/v1/skill` 自动 ingest 新批次的 landmark。

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
| `cc marketplace publish` | Phase 2 改为入 MTCA 队列；publisher daemon `cc mtc publish-skills` v0.4 已落地 |
| `cc audit emit`（v1） | 不变，沿用现有 Ed25519 链式哈希审计；`cc audit mtc emit` v0.4 是平行的 MTC 双轨脚手架 |
| `cc audit mtc *`（v0.4 新） | 双轨签名：实时 Ed25519 + 关批 MTC；off-by-default，等保口径出函后单 flag 启用 |
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

## 12. 实操：企业审计双轨脚手架（v0.4）

`cc audit mtc *` 是 Phase 2 audit 路径的双轨签名脚手架：

- **Track 1（实时）**：每条事件 emit 时立刻写一个 staging 文件，附带 Ed25519 签名（content_hash 上签），毫秒级落盘 + 密码学防篡改。
- **Track 2（最终）**：定期或手动调 reconcile 关批，把 staging 中所有事件聚合成 Merkle 树，签 tree_head，输出 landmark + 每事件 envelope（含 inclusion proof）。

> ✅ **2026-05-01 法务出函已收到**（Q-COMP-1 等保三级最终性窗口 + Q-COMP-2 T/ZGCMCA 023—2025 条款）。**脚手架默认仍 `enabled=false`**——`cc audit mtc emit` 在 disabled 状态下会拒绝写入（除非 `--force`）；由各租户在自己的环境通过 `cc audit mtc enable --interval <60|3600>` 显式启用，60s 严判 / 3600s 宽松路径按出函具体口径选择。

### 12.1 启用与配置

```bash
# 查看默认配置（不会启用）
cc audit mtc config --json

# 启用（自定义 namespace + 1 小时批次）
cc audit mtc enable \
  --namespace mtc/v1/audit/org-acme \
  --issuer mtca:cc:zQ3shAuditMTCA \
  --interval 3600

# 切换到 1 分钟严判路径（如果法务要求 sub-minute 最终性）
cc audit mtc set-interval 60

# 关闭
cc audit mtc disable
```

### 12.2 提交事件 + 关批 + 校验

```bash
# 事件入队（Track 1：立刻签 + 落盘到 staging/）
cc audit mtc emit \
  --type auth --operation login \
  --actor alice --risk-level low

# 查看队列
cc audit mtc status

# 关批（Track 2：构树 + 签 tree_head + 输出 envelope + 清空 staging）
cc audit mtc reconcile

# 反查事件落在哪个批次
cc audit mtc reconcile-check 20260501123456-abcdef012345
```

### 12.3 文件布局

启用后，配置目录（默认 `~/.chainlesschain/audit-mtc/`）：

```
audit-mtc/
├── config.json                       # enabled / batch_interval_seconds / namespace / issuer
├── keys/issuer.hex                   # Ed25519 私钥，0o600
├── staging/                          # 待批的事件（Track 1 已签）
│   └── 20260501123456-abc.json
└── batches/
    └── 000001/
        ├── manifest.json             # batch_id / event_ids / tree_head_id
        ├── landmark.json             # 整批的 MTC landmark
        └── envelope-<event-id>.json  # 每事件一份，含 inclusion proof
```

### 12.4 幂等性保证

- `reconcile` 在 staging 为空时是 no-op（返回 `{ skipped: true, reason: "no staged events" }`），可放心丢到 cron。
- 关批用 atomic rename（写到 `batches/.<seq>.tmp/` 再 rename）；崩溃后下次启动会清理 leftover tmp 目录。
- staging 文件**只在 rename 成功后才删除**——保证不会丢事件。
- staging 文件名 / event_id / schema 三处都验签，外部丢进 staging 的伪事件会被 reconcile 跳过并记入 `manifest.malformed_skipped`。

### 12.5 验证脚本（独立校验链路）

任何持有 landmark 的第三方都能离线校验整批：

```js
import {
  LandmarkCache, verify, ed25519,
} from "@chainlesschain/core-mtc";
import fs from "node:fs";

const landmark = JSON.parse(fs.readFileSync("batches/000001/landmark.json", "utf-8"));
const cache = new LandmarkCache({
  signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
});
cache.ingest(landmark);

// 任选一个 envelope
const envelope = JSON.parse(fs.readFileSync("batches/000001/envelope-XXX.json", "utf-8"));
const r = verify(envelope, cache);
console.log(r.ok ? "✓ 该事件确实在批次内" : `✗ ${r.code}`);
```

---

## 13. Federation MTCA — 多签 + 服务发现（v0.5）

### 13.1 设计

不同于单 MTCA 模式（一个节点对树根签一次），federation 模式让 N 个独立节点各自签发同一棵树根；landmark 内嵌 `signatures[]` + `threshold`。Verifier 在 ≥ threshold 个签名验证通过时才接受。等保三级"多签防一人作弊"语义自然落到这条路径。

支持异构成员（部分 Ed25519 + 部分 SLH-DSA）— federation 内每个成员独立选算法，verifier 多算法 dispatcher 自动识别。

### 13.2 加入 / 退出本地 federation 注册表

```bash
# 加入 — 生成密钥（或复用 --key-file）+ 写入 ~/.chainlesschain/federation/members.json
cc mtc federation join fed-acme --member-id node-a --alg ed25519
cc mtc federation join fed-acme --member-id pqc-node --alg slh-dsa-128f

# 查看
cc mtc federation status fed-acme

# 退出（默认连同密钥文件一起删；--keep-key 保留）
cc mtc federation leave fed-acme --member-id node-a
```

**密钥安全**：每成员 secret key 落盘于 `~/.chainlesschain/federation/keys/<fed>.<member>.hex`（mode 0o600）。`wx` 独占创建防止并发 join 写冲突。

### 13.3 用 federation 发布批次（M-of-N）

`cc mtc batch / batch-dids / batch-skills / publish-skills` 全部支持 `--federation <id>` + `--threshold <M>`：

```bash
# 3-of-3 强制全签
cc mtc batch-dids \
  --namespace mtc/v1/did/000001 \
  --issuer mtca:cc:fed-acme \
  --federation fed-acme \
  --out ./mtc-out

# 2-of-3 容许一节点离线
cc mtc publish-skills \
  --namespace-prefix mtc/v1/skill \
  --issuer mtca:cc:fed-marketplace \
  --federation fed-marketplace --threshold 2 \
  --out ~/.chainlesschain/marketplace-batches \
  --state-file ~/.chainlesschain/marketplace-state.json
```

`cc mtc verify` 自动识别 federated landmark — 没有额外标志要传。

### 13.4 服务发现 — Filesystem drop-zone

最简单的跨进程发现：所有成员读写一个共享目录（NFS / Syncthing / SMB / USB）。每节点定期把自签 announce 写到 `<drop-zone>/federation-announces/<fed-id>/`，其他节点扫描 + 验签 + 入 cache。

```bash
# Node A
cc mtc federation discover fed-acme \
  --transport filesystem \
  --drop-zone /shared/fed-zone \
  --member-id node-a \
  --ttl 600 --scan-interval 30

# Node B（listen-only，纯订阅不发布）
cc mtc federation discover fed-acme \
  --transport filesystem \
  --drop-zone /shared/fed-zone
```

Announce TTL 默认 600s，重新发布间隔 = TTL/3。Listen-only 模式（不带 `--member-id`）让 verifier 节点只读订阅。

### 13.5 服务发现 — libp2p gossipsub（真 P2P 自动发现）

```bash
# Bootstrap node
cc mtc federation discover fed-acme \
  --transport libp2p \
  --listen /ip4/0.0.0.0/tcp/9100 \
  --member-id node-a
# 启动时打印自己的多址：/ip4/127.0.0.1/tcp/9100/p2p/12D3...

# 后续节点连接 bootstrap
cc mtc federation discover fed-acme \
  --transport libp2p \
  --listen /ip4/0.0.0.0/tcp/0 \
  --connect /ip4/<bootstrap-ip>/tcp/9100/p2p/<bootstrap-peerid> \
  --member-id node-b
```

Topic 命名：`mtc-federation/v1/<federation-id>`。Mesh 形成后所有成员互相 announce，无需 bootstrap 节点之外的协调。Per-event 验签 + TTL 自动失效 + pubkey-id 去重在 cache 层兜底。

### 13.6 Bug 审计 + 安全说明

- **签名重放保护**：announce 自签 prefix 域分离 `mtc/v1/federation-announce\n`，与 tree-head 签名前缀不冲突。
- **TTL 防陈旧**：cache TTL-evicting；过期 announce 直接拒收（除非 `verifyMemberAnnounce(ann, { allowExpired: true })`）。
- **节点泄漏防护**：libp2p mode `try/catch` 包整个 init，异常路径上 `node.close()` 兜底。
- **scan 重入锁**：filesystem mode 的 `setInterval` 在 scan 还没结束时不重入。

---

## 14. 进阶：核心库直接调用

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
