# M-of-N 多签应用扩展 v1（v1.2 prep #3）

> **状态**：设计草案 / 2026-05-12 / 仅设计、不变更代码  
> **范围**：把已有的 MTC `publisher_signature` M-of-N 多签 (Phase 4 federation MTCA) 复用到 **MTC 之外** 的其它高价值原子操作  
> **不替代**：[MTC 联邦治理 v1](./MTC_联邦治理_v1.md) 仍是 MTC 内部治理的权威文档

## 1. 背景与目标

v1.1 之前的多签实现仅存在于 MTC `publisher_signature`：跨 federation 成员对 batch 进行 M-of-N 联合签名（参见 `MTC_联邦治理_v1.md` §6 / 内部 memo `mtc_publisher_sig_threshold.md`）。

v1.2 起，下列场景也需要"必须 ≥ M 签名才生效"的语义：

| 场景 | 触发条件 | 推荐 M-of-N |
|---|---|---|
| **marketplace.purchase 大额** | 商品 price ≥ ¥1000（约 $140） | 2-of-2（买家 + 监护人 / 财务） |
| **DID 关键属性变更** | rotate signing key / change recovery DID | 2-of-3（owner + 2 个 recovery） |
| **跨链桥 outbound** | 单笔金额 ≥ 阈值（链上配置） | 2-of-3（federation 子集） |
| **企业租户 admin 操作** | 删除租户 / 改 RBAC 根策略 | 2-of-N tenant admins |
| **MTC publisher_signature** | 已实现 | N 自定义（v0.5 federation） |

本文档聚焦"如何把 MTC 那套多签模式抽象成跨 feature 复用的中台模块"。

## 2. 复用 MTC 已有抽象

### 2.1 已可直接复用

| 组件 | 位置 | 复用方式 |
|---|---|---|
| `_stripSigsForPublisher` | `@chainlesschain/core-mtc/publisher-signing` | message canonicalization 前对 sig 字段置零（producer / verifier 必须对称喂） |
| Threshold 计票 | `core-mtc/lib/federation/threshold.js` | `Σ(成员签名通过 verifier) ≥ M` |
| 异构验签 | `core-mtc/lib/federation/verifiers/{ed25519,slh-dsa}.js` | dispatch by `alg` field |
| `governance.log` JSONL | `~/.chainlesschain/governance.log` | append-only audit trail |

### 2.2 需新增

- `core-multisig/`（新包，packages/core-multisig）
  - `MultiSigPolicy { domain, m, n, members[], algorithms[] }`
  - `proposeAndSign(domain, payload, signerKey) → { proposalId, sig }`
  - `accumulate(proposalId, sig) → { reachedThreshold: bool, sigs[] }`
  - `verify(domain, payload, sigs[], policy) → boolean`
- 持久层：`multisig_proposals` SQLite 表（schema in §4）
- WS topics：`multisig.propose / .sign / .status / .cancel`

## 3. 协议

### 3.1 消息流

```
Client A (initiator)
  ├─ proposeAndSign(payload, A_sk)
  │     ↓ creates proposal { id, domain, payload, expiresAtMs, sigs: [{ memberDid: A, sig }] }
  ├─ broadcast via WS multisig.propose
  │
Client B (co-signer)
  ├─ receives proposal via WS subscription
  ├─ user reviews payload (UI: 弹审批框 with diff)
  ├─ accumulate(proposalId, B_sig)
  │     ↓ reachedThreshold: true (2-of-2)
  ├─ executor (initiator side) finalizes & runs the operation
```

### 3.2 Canonical message

复用 MTC 的 JCS (RFC 8785)：`canonicalize(payload)` → SHA-256 → 各成员对 hash 签名。**与 MTC 一致：签名前剥离 sigs 字段**（即 `_stripSigsForPublisher` 同款规则），producer / verifier 对称。

### 3.3 防重放

- proposal 必带 `nonce`（uint64 timestamp + 随机后 32 bit）
- proposal 必带 `expiresAtMs`（默认 `now + 24h`，domain 可覆盖）
- 一旦 `reachedThreshold` 成功执行：proposal 标 `consumed`，重复提交直接 reject

### 3.4 撤销 / 拒签

- 任一签名者可发 `multisig.cancel(proposalId, reason)`
- 一旦 cancel：proposal 状态 `cancelled`，所有 sig 作废
- 已 `consumed` 的 proposal 不能 cancel（操作已生效）

### 3.5 超时

- 后台 sweeper 每 5 分钟扫一次 `expiresAtMs < now` 且未 consumed 的 → 标 `expired`
- expired proposal 同样不可 sign

## 4. SQLite Schema

```sql
-- packages/core-multisig/migrations/001_proposals.sql
CREATE TABLE IF NOT EXISTS multisig_proposals (
    id              TEXT    PRIMARY KEY,           -- ULID
    domain          TEXT    NOT NULL,              -- 'marketplace.purchase' | 'did.rotate' | ...
    payload_jcs     TEXT    NOT NULL,              -- canonical JSON (JCS RFC 8785)
    payload_hash    BLOB    NOT NULL,              -- SHA-256(payload_jcs)
    nonce           TEXT    NOT NULL,              -- hex
    expires_at_ms   INTEGER NOT NULL,
    threshold_m     INTEGER NOT NULL,              -- snapshot at propose time
    member_set      TEXT    NOT NULL,              -- JSON [{did, alg}], snapshot
    state           TEXT    NOT NULL,              -- 'pending' | 'reached' | 'consumed' | 'cancelled' | 'expired'
    initiator_did   TEXT    NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS multisig_signatures (
    proposal_id     TEXT    NOT NULL REFERENCES multisig_proposals(id),
    signer_did      TEXT    NOT NULL,
    sig             BLOB    NOT NULL,
    alg             TEXT    NOT NULL,              -- 'ed25519' | 'slh-dsa-128f'
    signed_at_ms    INTEGER NOT NULL,
    PRIMARY KEY (proposal_id, signer_did)
);

CREATE INDEX idx_multisig_state ON multisig_proposals(state, expires_at_ms);
```

Walker (`mobile-bridge-sync.js`) 仅同步状态变更，不同步 sig payload（私钥侧）。

## 5. CLI 表面（Phase 1）

```
cc multisig propose <domain> --payload <file>
cc multisig sign <proposalId>
cc multisig list [--state pending|reached|consumed|...]
cc multisig show <proposalId>
cc multisig cancel <proposalId> --reason <text>
cc multisig policy show <domain>
cc multisig policy set <domain> --m <M> --n <N> --members <comma-list>
```

`policy.show/set` 持久化在 `multisig_policies` 表（结构略，类比 §4）。

## 6. 集成点（feature 侧改造）

### 6.1 marketplace.purchase

```js
// packages/cli/src/commands/marketplace.js (现：直接 execute)
async function purchase(args) {
  const policy = await multisig.getPolicy('marketplace.purchase');
  if (policy && args.amountFen >= policy.threshold) {
    const proposalId = await multisig.propose('marketplace.purchase', args, signerSk);
    return { needsCoSign: true, proposalId, requiredSigs: policy.m };
  }
  return await executePurchase(args);  // legacy path for small amounts
}
```

UI 端 marketplace 显示"等待 N 签名 (1/2)"占位卡。

### 6.2 DID 关键属性变更

```js
// packages/core-did 现有 rotate(...) → wrap with multisig gate when policy exists
async function rotateKey(did, newPubkey) {
  const policy = await multisig.getPolicy('did.rotate');
  if (policy) {
    return await multisig.proposeAndExecute('did.rotate', { did, newPubkey }, sk, policy);
  }
  return doRotate(did, newPubkey);  // single-sig fallback for users without recovery DIDs
}
```

### 6.3 跨链桥 outbound 大额

复用现有 MTC federation 路径：跨链桥 outbound 本身已有 federation watermark；这一节仅是把"watermark 签名 → tx 提交"的两步合一进 multisig 框架。

## 7. 与 MTC publisher_signature 的关系

**复用**：canonicalization 规则、verifier dispatch、governance audit trail。  
**不复用**：MTC publisher_signature 本身仍走 federation 路径（不迁移到 `multisig_proposals` 表，避免历史 batch 重新格式化）。

新模块 `core-multisig` 只覆盖"非 MTC"的多签场景。

## 8. 桌面 / 移动 UI

### 8.1 Desktop V6（web-shell 主路径）
- 新建 plugin `packages/web-panel/src/plugins/multisig`
  - 列表页：proposal 卡片（domain icon + amount + 当前 sig 数 / threshold + 倒计时 expires）
  - 详情页：JCS payload 折叠 diff + member 列表（已签 / 未签）+ Sign / Cancel 按钮
- 通知：proposal 触发 desktop notification（"N1 发起了一笔 ¥1500 的购买，等待你联签"）

### 8.2 Mobile（Android v1.2+）
- `feature-multisig` 模块（新）：`MultiSigListScreen`, `MultiSigDetailScreen`
- 走 P2P sync via mobile-bridge-sync 的 SETTING walker（v1.2 prep #4）
- Push notification（v1.1 P1 vendor push SDK 已具备）

## 9. 安全考量

1. **回放跨 domain**：proposal 的 `payload_jcs` 必含 domain 字段，verifier 必须验 domain 与 policy 匹配
2. **member 名单 race**：proposal 创建时快照 `member_set`，事后改 policy 不影响进行中的 proposal
3. **sig 重排攻击**：sig 列表按 `signer_did` 排序后再 verify，防签名顺序构造重放
4. **PQC 强制最低**：domain policy 可强制要求至少 1 个 SLH-DSA 签名（同 MTC 联邦 §3.4）
5. **私钥离线**：sign 操作必须可在 air-gapped 设备完成（Phase 2：QR proposal 模式）

## 10. Phase 划分（v1.2 → v1.3）

| Phase | 范围 | 验收 |
|---|---|---|
| Phase 0（设计） | 本文档 | doc landed |
| Phase 1（v1.2） | core-multisig 包 + SQLite + CLI（propose/sign/cancel/list/show） | 单元 + 集成测试 ≥ 30，governance.log 写入 |
| Phase 2（v1.2） | marketplace.purchase 大额接线 + Desktop V6 plugin | E2E：2-of-2 走完一笔 ¥1500 购买 |
| Phase 3（v1.3） | DID rotate + Android UI + QR air-gapped propose | 文档 §8.2 全实现 |
| Phase 4（v1.3） | 跨链桥 outbound 接入 + PQC 强制策略 | 端到端 + 联邦 federation 集成测试 |

## 11. 与现有文档关系

- 复用 `MTC_联邦治理_v1.md` §3-§6 的治理 / 审批流程
- 不影响 `MTC_数据格式_v1.md`（MTC 自己的 publisher_signature 格式不变）
- `Phase3d_Mobile_Sync_设计文档.md` SETTING walker 用于 multisig_policies 同步（v1.2 prep #4 内）
- 与 `Android_重新定位_设计文档.md` §10 v1.2 milestone 对齐

## 12. 已知未决（明确 v1.2 不做）

- **门限签名（threshold signature, FROST/BLS）**：本设计是 M 个独立 sig 累加；不引入 threshold-aggregated single-sig（FROST 等），降复杂度。Phase 5+ 评估
- **链上结算**：proposal 不上链；只在 SQLite + governance.log。链上结算属于 cross-chain bridge 范畴
- **Web-only co-sign UX**：v1.2 仅 desktop + CLI，移动 v1.3 起
- **Recovery shard 备份**：multi-sig key 的 Shamir 分片备份独立设计文档（v1.3）

---

**附：与 v1.2 prep 其它 ticket 的依赖**

- prep #1 OfflineQueue TTL：无依赖
- prep #2 TURN ephemeral：无依赖
- prep #3 本文：design only
- prep #4 SETTING walker：multisig_policies 表的同步走 SETTING walker（实现侧）
