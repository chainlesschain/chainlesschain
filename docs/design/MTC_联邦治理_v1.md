# MTC 联邦治理设计 v1

> 版本：v0.1（治理首版草案）
> 日期：2026-05-02
> 作者：longfa
> 状态：**草案 / Draft** — 关闭 `默克尔树证书_MTC_落地方案.md` §12 第 2 项「治理」半截
> 关联：
> - 上层方案：`docs/design/默克尔树证书_MTC_落地方案.md`
> - 数据格式：`docs/design/MTC_数据格式_v1.md`
> - 机制层实现：`packages/core-mtc/lib/federation.js`、`packages/core-mtc/lib/batch.js#assembleBatchFederated`、`packages/cli/src/commands/mtc.js federation` 子命令组（commits `95b861914` / `15c29e9fe` / `aa13e07a9`）
>
> **本文档定位**：纯治理 / 运营规范，不引入新协议字段。机制层（多签 landmark、announce schema、服务发现）已在 §9 Phase 3 落地，本文档只产出"谁能签、何时签、怎么撤"的规则。

---

## 1. 背景

`默克尔树证书_MTC_落地方案.md` §12 第 2 项原文：

> **联邦 MTCA 的治理未定**：Phase 3 才考虑；M-of-N 怎么定？谁有权加入？— 需要单独治理设计文档

机制层已经做完：
- `assembleBatchFederated` 支持 N 签 + threshold（commit `95b861914`）
- LandmarkCache ≥ M-of-N 验证 + pubkey-id 去重
- `cc mtc federation join|leave|status` 管理 `~/.chainlesschain/federation/members.json`
- filesystem drop-zone + libp2p gossipsub 两条服务发现路径
- 异构 Ed25519 + SLH-DSA-128F 成员可在同一联邦共存

但**谁有权加入、怎么定 M、撤销怎么走**这些政策问题没有规则文档。本文档补齐。

---

## 2. 设计原则

1. **链下治理 + 链上（树上）验证**：治理决策（准入 / 撤销 / 阈值变更）由人类 / 制度执行，写入治理日志；MTC 协议只负责验证当下成员名单的签名是否满足 threshold。
2. **保守默认 + 显式升级**：新建联邦默认 1-of-1 单签（等价于无联邦），threshold 提升必须显式 `federation set-threshold` 操作并经审批。
3. **不可静默失效**：任何成员变更（join/leave/revoke/rotate）必须产出有签名的治理事件，记入 `federation/governance.log`，否则 verifier 拒绝该联邦的新 landmark。
4. **算法异构友好**：threshold 计票按"有效签名"计算，不区分 Ed25519 与 SLH-DSA-128F；但**审批流**强制要求至少一个成员持 PQC 密钥（防止 PQC 过渡期被全 Ed25519 联邦回滚）。
5. **退出优先于驱逐**：成员主动 leave 比强制 revoke 优先；revoke 仅在主动退出失败 + 信任根破坏 + 长期不响应三种情况下启用。
6. **联邦不可继承**：联邦不存在"父子关系"。Fork 后产生两个独立联邦 ID，老 landmark 仍然有效但不接受新 batch；Merge 必须新建联邦 ID。

---

## 3. 治理范围与边界

| 项目 | 在治理范围 | 不在治理范围 |
|---|---|---|
| 成员准入 / 退出 / 撤销 | ✅ §5 / §7 | — |
| M-of-N threshold 设定与变更 | ✅ §6 | — |
| 异构算法成员的计票规则 | ✅ §6.3 | — |
| 联邦 Fork / Merge 语义 | ✅ §8 | — |
| 单成员的密钥轮换流程 | ✅ §7.4 | — |
| 治理事件签名格式 | ✅ §9.1 | — |
| 单成员节点的运维（部署 / 监控） | — | 由各成员自管 |
| 联邦内部分歧裁决（业务争议） | — | 走业务侧合同 / 仲裁 |
| Cross-federation 互信 | — | 见 §11 后续工作 |

---

## 4. 联邦生命周期

```
[Bootstrap] → [Steady] ⇄ [Dispute] → [Wind-down] → [Closed]
                  ↓
              [Fork] → 产生新联邦 ID
              [Merge] → 产生新联邦 ID
```

### 4.1 Bootstrap（创建期）

- 由**发起人**创建联邦：`cc mtc federation create <fed-id> --bootstrap-member <member-id>`
- 此时 N=1, M=1，等价于单 MTCA
- Bootstrap 期上限 30 天 — 必须在期满前至少邀请到 2 个额外成员，否则降级为永久单签 MTCA（联邦概念退化）
- Bootstrap 期内的所有 landmark 标 `bootstrap=true`，verifier 仍接受但记 warning

### 4.2 Steady（运营期）

- 所有成员变更必须满足当前 threshold 的多签
- threshold 变更需 `current-threshold` 多签 + 30 天公示期（写入 `governance.log`）
- 公示期内任一成员可签 `veto`，veto 数 ≥ ⌊N/3⌋ 时阻断

### 4.3 Dispute（争议期）

触发条件（任一）：
- 任一成员在 7 天内连续 3 次签错（fork tree head / 数据格式不合规）
- ≥ ⌊N/3⌋ 成员投 `dispute` 票

进入 Dispute 后：
- 联邦暂停接受新 batch（已有 landmark 仍可验证）
- 必须在 14 天内完成裁决：`continue` / `revoke-member <id>` / `wind-down` 三选一
- 裁决需当前 threshold 多签

### 4.4 Wind-down（下线期）

- 联邦不再产新 batch
- 已有 landmark 永久有效（IPFS pinning 由各成员自决继续）
- 30 天后转 Closed

### 4.5 Closed

- 联邦 ID 进入归档名单
- 不可重用同名 ID 创建新联邦
- 历史 landmark 仍可被任意 verifier 验证（基于归档的成员名单 + threshold 快照）

---

## 5. 准入机制

### 5.1 准入条件（必要）

候选成员必须满足：

1. **持有有效 DID**（`did:cc:*`），DID 文档已在主链 publish
2. **持有 MTCA 密钥**（Ed25519 或 SLH-DSA-128F），公钥可被 `cc mtc federation announce` 自签
3. **可被联邦中至少一个现有成员通过传输层（filesystem drop-zone / libp2p）路由到**
4. **承诺 SLA**：candidate 必须在加入后的 90 天内保持 ≥ 95% 的 batch 签名响应率（详见 §5.4）

### 5.2 准入审批流

```
[候选人 invite-request] → [现有成员投票] → [≥ M 票通过] → [候选期 30 天] → [转正成员]
                                                                ↓ 失败
                                                          [回到 invite-request]
```

- 邀请：现有成员 A 执行 `cc mtc federation invite <fed-id> <candidate-did>` → 写入 `governance.log`
- 投票：其他成员 7 天内 `cc mtc federation vote <invite-id> --approve | --reject`
- 通过门槛：`approve` 票数 ≥ 当前 threshold M
- 候选期（30 天）：候选人可参与签名但**计票时权重 0.5**（避免新成员立刻拥有完整投票权）；满 30 天且 SLA 达标自动转正

### 5.3 候选期权重 0.5 的 threshold 处理

设当前 N=5（含 2 候选 + 3 转正），M=3：
- 转正成员每签 1 票
- 候选成员每签 0.5 票
- 满足条件：`Σ(签名权重) ≥ M`，即 3 个转正 OR 2 转正+2 候选 OR 1 转正+4 候选 都满足

### 5.4 SLA 违约处理

候选期内任一 7 天窗口签名响应率 < 95% → 候选期重置（重新计 30 天）；候选期内累计 3 次重置 → 自动驱逐回 invite-request 状态。

转正后 SLA 不强制（避免运维抖动导致驱逐），但纳入 `federation status --sla` 输出供成员参考。

---

## 6. M-of-N 阈值规则

### 6.1 业务场景分级

| 场景 | 推荐 threshold | 理由 |
|---|---|---|
| 个人 / 家庭联邦（N ≤ 3） | M = ⌈N/2⌉ | 半数即可，避免单点离线影响日常使用 |
| 小团队 / 社区（N = 3–7） | M = ⌈2N/3⌉ | 三分之二多数，兼顾活性与防共谋 |
| 企业内部 / 多部门（N = 5–15） | M = ⌈2N/3⌉ + 1 | 强多数，需要明确合规上签字 |
| 跨组织 / 公共 Marketplace（N ≥ 7） | M = ⌈3N/4⌉ | 接近共识门槛，防恶意成员合谋 |
| 法定高风险（金融 / 医疗审计） | M = N - 1 或 M = N | 几乎无单点容错，签字即背书 |

threshold 选择是治理决策，本文档只给推荐区间。`cc mtc federation set-threshold` 必须在创建时或 §4.2 公示流程中显式设定。

### 6.2 threshold 变更流程

1. 任一成员发起 `cc mtc federation propose-threshold <new-M>`
2. 写入 `governance.log` 公示
3. 30 天公示期内 ≥ ⌊N/3⌋ 成员可投 `veto`，veto 通过则提案作废
4. 公示期满，提案需当前 M 多签确认（`cc mtc federation confirm-threshold <proposal-id>`）
5. 确认后立即生效，下一个 batch 起 verifier 按 new-M 计票

### 6.3 异构算法成员的计票规则

`assembleBatchFederated` 接受 Ed25519 + SLH-DSA-128F 任意混合的成员签名。计票规则：

- **每个有效签名计 1 票**（不分算法），与签名字节大小无关
- **threshold 满足判定**：`Σ(成员签名通过 verifier 验证) ≥ M`
- **算法多样性硬约束**：N ≥ 5 的联邦必须至少有 1 个 SLH-DSA-128F 成员（PQC 过渡期反全 Ed25519 联邦保护）；不满足时 `cc mtc federation status` 输出 `pqc_warning: true`，但不阻断签名

### 6.4 不允许的配置

- M = 0（无意义，等价于无签名）
- M > N（不可能满足）
- M < ⌈N/2⌉ 且 N > 3（少数派签名，不构成"联邦背书"）— `set-threshold` 拒绝

---

## 7. 成员撤销与轮换

### 7.1 三种退出场景

| 场景 | 触发方 | 流程 | 保留时间 |
|---|---|---|---|
| 主动 leave | 成员自己 | §7.2 | 立即生效 |
| 协商 revoke | 联邦多签 | §7.3 | 7 天宽限 |
| 强制 revoke | 联邦多签 + Dispute | §7.4 | 立即生效 |

### 7.2 主动 leave

```
cc mtc federation leave <fed-id>
```

- 成员自签 `leave-intent` 事件，写入 `governance.log`
- 立即从 active member set 移除
- 老 landmark 上该成员的签名仍然有效（不可追溯撤销）
- 该成员的密钥进入 `archived-keys.json`，verifier 在验证历史 landmark 时仍可使用

### 7.3 协商 revoke

适用：成员长期不响应 / SLA 持续低 / 主动违反治理约定但未到 Dispute 程度。

1. 任一成员发起 `cc mtc federation propose-revoke <member-id> --reason <text>`
2. 7 天宽限期内被撤销成员可主动 leave（避免污点记录）
3. 期满未 leave，需当前 M 多签 `cc mtc federation confirm-revoke <proposal-id>`
4. 确认后该成员立即从 active set 移除，密钥进 `archived-keys.json`

### 7.4 强制 revoke（仅 Dispute 期）

适用：信任根破坏（密钥泄漏证据 / 双签不同 tree head / 数据格式恶意篡改）。

- 进入 §4.3 Dispute 流程
- 14 天内必须完成裁决
- 裁决决议为 `revoke-member` 时，被撤销成员密钥进入 `compromised-keys.json`（区别于 `archived-keys.json`）
- verifier 在验证**该成员被撤销之后**签的任何 landmark 时直接拒绝；之前签的仍接受但标 `compromised_signer_warning`

### 7.5 密钥轮换

成员可在不离开联邦的情况下轮换密钥：

```
cc mtc federation rotate-key <fed-id> --new-pubkey <hex>
```

- 旧密钥需签一个 `key-rotation` 事件（证明授权）
- 新密钥需自签一个 `announce`（证明持有）
- 写入 `governance.log`，立即生效
- 旧密钥进 `archived-keys.json`（验证历史 landmark 用）

---

## 8. 联邦 Fork / Merge

### 8.1 Fork

适用：联邦内部出现不可调和的策略分歧（如 threshold 不同意见、准入策略冲突）。

- 任一子集成员可发起 `cc mtc federation fork <fed-id> --new-id <new-fed-id> --members <id1,id2,...>`
- 必须 ≥ ⌊N/3⌋ 成员联署
- 老联邦仍然存在；分裂出去的成员**同时**离开老联邦（自动触发 §7.2 leave）
- 新联邦走 §4.1 Bootstrap 流程
- Fork 不继承老联邦的 batch 序号 / IPFS pinning（独立运营）

### 8.2 Merge

适用：两个小联邦希望合并成一个大联邦。

- 任一联邦成员发起 `cc mtc federation propose-merge <fed-id-a> <fed-id-b> --new-id <merged-id>`
- 两个联邦各自走 §4.2 Steady 内的提案流程，**双方都通过**才执行
- Merge 创建新联邦 ID（不重用旧 ID）
- 老联邦进入 §4.4 Wind-down
- 合并后 N = N_a + N_b，threshold 必须显式 `set-threshold`（不自动加和）

---

## 9. 与现有机制的接口

### 9.1 治理事件 schema

所有治理事件遵循统一 envelope（写入 `~/.chainlesschain/federation/governance.log`）：

```json
{
  "schema": "mtc-federation-governance/v1",
  "fed_id": "string",
  "event_type": "invite | vote | leave | propose-revoke | confirm-revoke | rotate-key | propose-threshold | confirm-threshold | fork | merge | dispute | wind-down",
  "event_id": "uuid-v4",
  "issued_at": "RFC 3339 UTC",
  "actor_member_id": "string",
  "payload": { /* event-type-specific */ },
  "signature": {
    "alg": "ed25519 | slh-dsa-128f",
    "key_id": "sha256:...",
    "value": "base64url-no-padding"
  }
}
```

签名输入：`Buffer.concat([Buffer.from("mtc/v1/federation-governance\n"), jcs(eventWithoutSignature)])`

### 9.2 与现有 registry 的关系

`~/.chainlesschain/federation/members.json` 是**当前生效**的成员名单（schema `mtc-federation-registry/v1`）。

`~/.chainlesschain/federation/governance.log` 是**完整变更历史**。`members.json` 必须可由 governance.log 回放生成 — 任何不一致视为损坏，回放为准。

### 9.3 与 announce / discover 的关系

`mtc-federation-announce/v1`（`packages/core-mtc/lib/federation.js`）只证明"我是 fed-id 的成员、持有这个公钥"。准入合法性由本文档治理流程保证 — discover 拿到的 announce 必须能在 active members.json 中找到匹配 member-id，否则丢弃。

### 9.4 与 verifier 的关系

`assembleBatchFederated` 产生的 landmark 携带 `federation_id` + 成员签名集。verifier（`packages/core-mtc/lib/verifier.js`）按以下顺序检查：

1. landmark.federation_id 在 verifier 已知联邦白名单中
2. 加载该联邦在 landmark.tree_head.timestamp 时刻的有效成员名单（按 governance.log 回放）
3. 验证每个签名能映射到一个有效成员
4. `Σ(有效签名权重) ≥ threshold`（候选成员权重 0.5）
5. 至少一个签名来自非 `compromised-keys.json` 的成员

---

## 10. 决策记录

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 治理日志位置 | `~/.chainlesschain/federation/governance.log` 本地 | 链上合约 | Phase 1+2 决议不上链；governance.log 由各成员独立维护，verifier 通过 IPFS pinning 拿到合并视图 |
| 候选期权重 | 0.5 | 0（无投票权） | 0.5 鼓励候选人尽快参与运营，又不让新成员立即取得完整话语权 |
| threshold 公示期 | 30 天 | 7 天 / 90 天 | 与企业季度审批节奏对齐；7 天太仓促，90 天阻塞业务 |
| Bootstrap 期上限 | 30 天 | 90 天 / 无上限 | 防止"声称是联邦但永远只有 1 人"的退化；与候选期对齐 |
| 算法多样性硬约束阈值 | N ≥ 5 才强制至少 1 PQC | 全联邦强制 | 小联邦（N ≤ 4）可能 PQC key 难凑齐，强制反而阻塞 |
| Fork 联署门槛 | ⌊N/3⌋ | ⌈N/2⌉ | Fork 是分裂权利，门槛不应过高；半数支持已经足以走 §4.2 调和 |

---

## 11. 后续工作

1. **Cross-federation 互信**：本文档覆盖单联邦治理。当两个联邦的 verifier 需要互相承认对方的 landmark 时（如 Marketplace 跨平台 publishing），需要 `cross-federation-trust-anchor` schema —留给 v0.2。
2. **链上治理选项**：当 Q-COMP-3 解锁境内联盟链路径时，`governance.log` 可选锚定到链上（hash-only），提升历史不可篡改强度 — 留给 Phase 3 末。
3. **治理 GUI**：`cc mtc federation *` CLI 已 ready，desktop / web-panel 上的可视化（成员列表 + 投票面板 + governance.log timeline）排在 v5.0.4+。
4. **审计第三方**：联邦治理日志的第三方审计接口（独立审计员能否离线 verify governance.log → members.json 的回放）— 留给 v0.2。

---

## 附录 A — 术语表

| 术语 | 定义 |
|---|---|
| 联邦 (Federation) | 由 N 个独立 MTCA 节点组成的多签证书签发组 |
| 成员 (Member) | 联邦中的一个 MTCA 节点，由 DID + MTCA 公钥唯一标识 |
| Threshold (M) | 满足"联邦背书"所需的最小有效签名数 |
| 候选人 (Candidate) | 已通过投票但未满 30 天候选期的成员，签名权重 0.5 |
| 转正成员 (Active Member) | 完成候选期且 SLA 达标的成员，签名权重 1.0 |
| Bootstrap 期 | 联邦创建后的前 30 天，N 可暂时为 1 |
| Steady 期 | 正常运营期 |
| Dispute 期 | 出现争议时的暂停期，14 天内必须裁决 |
| Wind-down 期 | 联邦下线期，30 天后转 Closed |
| Compromised Key | 因密钥泄漏被强制撤销的密钥，verifier 拒绝其后续签名 |
| Archived Key | 主动 leave 或正常轮换的旧密钥，verifier 仅用于验证历史 landmark |

---

## 附录 B — 参考资料

- `docs/design/默克尔树证书_MTC_落地方案.md` §9 Phase 3 落地纪录
- `docs/design/MTC_数据格式_v1.md` — envelope / landmark / 签名输入规范
- `packages/core-mtc/lib/federation.js` — announce schema + 签名实现
- `packages/core-mtc/lib/batch.js#assembleBatchFederated` — 联邦多签装配
- RFC 6962 §3 (Maximum Merge Delay 的治理含义)
- IETF `draft-ietf-plants-merkle-tree-certs-02` §6 (Trust Anchor 治理建议)
