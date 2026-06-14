# P2P N-Peer 冲突解析策略（v1.1 W2.7 决策记录）

> **状态**: ✅ accepted (2026-05-12, v1.1 GA)
> **关联**: [Android 重新定位设计文档](Android_重新定位_设计文档.md) §10 v1.1 / [issue #19 §8.2](https://github.com/chainlesschain/chainlesschain/issues/19)
> **作用域**: 同 DID 多端（手机 A + 手机 B + 桌面）写同一资源时的冲突解析

---

## 1. 背景

v1.0 单 peer pair 没有冲突问题：每个 Android 只与一台桌面同步。v1.1 W2 多设备 N-peer：

```
手机 A ─┐
        ├── 同 DID ─── 桌面 (mobile-bridge.js multi-pair)
手机 B ─┘
```

两台手机都登 `did:cc:user-X`，各自写 `kb:note:n1` 时桌面会收到 2 份并发更新。**v1.1 必须有明确策略避免数据丢失或随机覆盖**。

---

## 2. 选项对比

| 策略 | 优点 | 缺点 | 实施成本 |
|---|---|---|---|
| **LWW (Last-Write-Wins)** | 简单；无 schema 改动；与 Phase 3d 同步格式天然匹配（已有 `updatedAt` 字段） | 覆盖更早写入（可能丢字符）；clock skew 时不可预测 | 0 — 已是默认行为 |
| **CRDT (Yjs / Automerge)** | 真正合并并发编辑；离线编辑可重连恢复 | KB 格式重写 (note content 改 CRDT doc)；桌面 + Android 双端集成；学习曲线陡 | 高 — 5-10 天 |
| **OT (Operational Transform)** | 编辑级合并；适合 collaborative text | 需中心权威协调（与 P2P 模型相悖） | 高且不适配 |
| **Vector clock + 用户介入** | 准确检测冲突；不丢数据 | 用户体验差（每次冲突都要手动选择） | 中 — UI + 协议 改造 |

---

## 3. v1.1 决策：**LWW**

**选择 LWW**：

1. **快速 GA**：v1.1 重点是把 N-peer 跑起来，不是完美合并体验。先 LWW 让多端同步可用，v1.2 视用户反馈决定是否升 CRDT
2. **Phase 3d 已就位**：`updatedAt` 字段在 sync envelope 一直有，桌面 `mobile-bridge-sync.js` 的 UPSERT 已默认按 LWW 行为（`ON CONFLICT DO UPDATE WHERE excluded.updatedAt > existing.updatedAt`）
3. **v1.0 → v1.1 平滑**：现有用户从单 peer 升多 peer 不需要数据迁移
4. **大部分场景影响小**：Android 端主要场景是创建（不冲突）+ 编辑长文（很少两端同时编辑同一条）+ 删除（即便 LWW 偶发误覆盖也是 soft-delete，可恢复）

**用户感知风险**：
- 同时在两台手机编辑同一笔记 → 后保存的覆盖先保存的中间字
- 缓解：UI 显示 "上次同步 N 秒前" + 编辑前刷新提示

---

## 4. 实施细则

### 4.1 桌面侧（已有，无需改）

`desktop-app-vue/src/main/sync/mobile-bridge-sync.js` 的所有 `_apply*` 方法已用 SQLite UPSERT with `WHERE excluded.updatedAt > existing.updatedAt` clause。多端推送时该 clause 自然 LWW。

### 4.2 Android 侧（v1.1 W2.6 已落）

`SyncAuthVerifier` (commit by W2.6) 把 single-peer DID 检查改为 multi-peer set 检查（auth.did 匹配 `connectedPeers` 任一即放行），避免多端 DID 验证冲突。

`SyncCoordinator` (commit by W2.3) 30s push 循环遍历 `connectedPeers.values`，每个 peer 各自调 `pushPendingToDesktopRpc(peerId)`。`pendingChanges` 是设备级总量，每 peer 看到同一份；首个 peer ack 后 mark synced，后续 peer 看到的就少了 — 不会重复推送同一资源。

### 4.3 客户端 timestamp 时钟约束

LWW 强依赖客户端 wall clock：

- Android 用 `System.currentTimeMillis()` (UTC ms since epoch)
- 桌面用 `Date.now()`
- 两端必须 NTP synced（误差 < 1s）

如果 Android 设备 clock 严重偏移（用户手动改时间往未来调几小时），其写入会"赢"未来的所有更新。**Android 端建议**：在 SyncCoordinator push 前 sanity check `if (Math.abs(now - lastSyncedAt) > 30 days) reject and warn user`。v1.2 follow-up。

### 4.4 软删除 LWW 边界

`isDeleted=true` + `updatedAt=now` 是删除操作。LWW 规则下：
- 删除 → 后续编辑：编辑获胜（资源复活）— 符合用户直觉
- 编辑 → 后续删除：删除获胜 — 符合用户直觉
- 同时删除 + 编辑：取决于 ms 时序

**v1.2 follow-up**：评估是否需要 tombstone TTL（保留 `deletedAt` N 天后才物理 GC）让用户能从 trash 恢复。

---

## 5. v1.2+ 升级路径

### 5.1 进 CRDT 触发条件

下列任一发生就升 CRDT：
- 用户报告"我编辑的字消失了"投诉数 > 5/月
- 多端编辑笔记是核心使用模式（>10% MAU 跨端编辑同一资源）
- 团队多人共同编辑同一 DID 下笔记需求出现

### 5.2 候选库

- [Yjs](https://github.com/yjs/yjs) — Web/Node 成熟，需找 Kotlin port 或写 binding
- [Automerge](https://github.com/automerge/automerge) — Rust core + JVM binding (`automerge-jvm`) 在维护中
- 自研 OR-Set + LWW-Map 混合 — 控制力最强但成本最高

### 5.3 迁移策略

CRDT 升级要：
1. 桌面 `kb_items.content` 字段 schema 变更（content 从 string → CRDT doc snapshot）
2. Android 端 KnowledgeItemEntity 同步迁移
3. 历史数据一次性 wrap 成 CRDT initial state
4. 同步 envelope 协议加版本 negotiation（v1 LWW / v2 CRDT），避免老 client 看到新格式 crash

预计 5-10 天工作量；v1.2 W2 / W3 主轴之一。

---

## 6. 验收

v1.1 GA 不要求 LWW E2E 实测（依赖 2 台真机），文档化决策即合格。v1.2 计划：
- E2E：2 台真机各自写同一 note → 桌面 KB 收到 LWW 结果（updatedAt 较新的那条）
- 监控：桌面端记录 LWW 覆盖事件 metric，看真实场景频率

---

## 变更记录

- 2026-05-12 v1.0 (issue #19 W2.7)：初稿，accepted LWW

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。P2P N-Peer 冲突解析策略（v1.1 W2.7 决策记录）：多节点冲突解决。

### 2. 核心特性
N-Peer 冲突 / CRDT / 决策记录。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「P2P N-Peer 冲突解析」。

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
