# PDH 派生消费者回执保留与清理

更新：2026-10-06。对应 Palantir 对照改进中的 PAL-DATA / PAL-OPS 基础工作。

PDH 的规范化数据、删除意图和 RAG/KG 投递回执都保存在同一加密数据库。内存索引每次启动使用新消费者 ID，需要重新投递数据；旧进程留下的回执会随启动次数增长。本次增加显式消费者生命周期，允许按批清理已停用内存索引的回执。

## 安全边界

| 消费者或数据                                 | 处理方式                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| 默认生成 ID 的内存索引                       | 注册为 `ephemeral`；持有该代生命周期句柄的注册器可以显式停用              |
| 调用方指定稳定 ID 的持久化索引               | 注册为 `persistent`；允许原 ID 重开，回执保留，不支持该清理路径           |
| 正在同步、重派生或投递的注册器               | 拒绝停用，错误码 `DERIVATION_CONSUMER_BUSY`                               |
| 已停用内存消费者的已知完成/失败/待处理回执   | 按显式 ID 列表清理，每次最多 1,000 行                                     |
| `running` 回执                               | 始终保留；只有原始 claim 的有效完成确认才能改变其状态                     |
| 当前活动消费者、其他活动消费者               | 拒绝清理                                                                  |
| 升级前未登记消费者的历史回执                 | 不推断其内存/持久化属性，保守保留；可登记为持久化，不能事后归为内存消费者 |
| 规范化源数据、派生源意图、删除墓碑、依赖关系 | 此清理 API 不修改                                                         |
| 已停用消费者生命周期记录                     | 保留，防止已清理 ID 被再次用于投递                                        |

迁移 v13 新增 `derivation_consumers` 表。清理只修改 `derivation_deliveries`；校验和删除处于同一 SQLite immediate 事务。任一所选 ID 不符合条件时，整批拒绝。时间戳仅用于观察和排序，不构成自动停用、超时抢占或删除依据。

## 生命周期与运维接口

`AdapterRegistry` 构造时登记消费者。`retireDerivationConsumer()` 只停用当前注册器自己持有的内存代；停用后 `retryDerivations`、`syncAdapter`、`syncAll` 和 `rederive` 拒绝继续工作。持久化消费者返回 `{ retired: false, reason: "persistent" }`。

CLI 和桌面宿主的显式 `close()` 在关闭 vault 前尝试停用空闲代。CLI 还在 hub 成功初始化后注册一个同步进程退出钩子：退出码为 0 时尝试停用，非零或未知退出码仅关闭资源并保留活动状态。重复初始化不叠加钩子，显式关闭会移除钩子，后续重新初始化再注册。仅打开 minimal hub 时，退出只关闭 vault，不创建消费者。

退出钩子同样经过注册器的忙碌检查；同步、重派生或投递尚未完成时，即使调用 `process.exit(0)` 也不会停用该代。Node 的退出事件不能区分所有原因相同的 `exit(0)`，退出码本身不构成业务成功证明。`SIGKILL` 等不触发退出钩子的终止，以及停用失败，都会保留活动代；没有按超时补造停用状态。此路径不自动清理回执，也没有新增异步等待任务结束的关闭协调器。

CLI 可查询候选消费者，再按明确 ID 清理：

```bash
cc hub derivation-consumers --kind ephemeral --state retired --limit 100 --json
cc hub derivation-consumers --kind ephemeral --state retired --after <last-consumer-id> --json
cc hub prune-derivations --consumer <retired-consumer-id> --limit 100 --confirm --json
```

`--consumer` 接受 1～100 个 ID；`--confirm` 确认删除这些代的投递回执。返回中的 `retainedRunning` 表示仍保留未知结果，后续仍需核查。已清空回执的生命周期记录会继续出现在消费者列表中；再次选择该 ID 清理返回零删除，不代表还有待完成工作。CLI 不提供按 ID 强制停用其他进程的命令。

以下为可信宿主内的维护调用；调用方继续负责 vault 的授权边界。生命周期查询不返回停用令牌。

```js
const store = hub.vault.getDerivationStore();

// 按 ID 排序。下一页传入本页最后一个 consumerId。
const candidates = store.listConsumers({
  kind: "ephemeral",
  state: "retired",
  limit: 100,
});

// 必须显式指定要清理的 ID；不通过年龄、启动次数或通配符选择。
const result = store.pruneRetiredConsumers({
  consumerIds: [candidates[0].consumerId],
  activeConsumerId: hub.registry.consumerId,
  limit: 100,
});
// { selectedConsumers, deletedReceipts, remainingReceipts, retainedRunning }
```

`listConsumers` 支持 `state`、`kind`、`afterConsumerId` 和 `limit`；每页最多 1,000 条。`pruneRetiredConsumers` 一次接受 1～100 个明确 ID，总删除上限为 `limit`。`remainingReceipts` 包含保留的 `running` 行，不能将非零数量直接解释为清理失败。

`getState` 的 `consumer` 字段返回不含令牌的生命周期元数据；旧版未登记消费者为 `null`。查询已停用代时，现存回执显示实际历史状态，即使源数据后来更新，也不再将其解释为等待追赶的新任务。没有保留回执的目标显示 `not-retained`，可能是从未投递，也可能已清理，不据此声称投递成功或生成待处理工作。

底层 `registerConsumer({ consumerId, kind })` 对内存消费者返回一次性所有权句柄，其中的 `retirementToken` 应留在宿主进程中。`retireConsumer(handle)` 支持晚到完成：停用后新的 claim 被拒绝，原有合法 claim 仍能完成；其回执才会在下一次显式清理中符合条件。正常宿主通过注册器方法停用；没有按 ID 强制停用其他进程的公共入口。

## 验证与未覆盖范围

真实加密数据库测试覆盖迁移保留历史回执、重开、分页、稳定 ID 保护、活动代保护、忙碌拒绝、退休 ID 不复用、保留未知结果、有效晚到确认、批次限额，以及源数据删除墓碑在回执清理后仍可供新代重建。

CLI wiring 测试使用真实 `AdapterRegistry` 和隔离的 vault/外部适配器替身，验证成功初始化后注册钩子、显式关闭、重复初始化、退出事件的零/非零状态、忙碌保留以及 minimal hub 关闭；不将这些事件级测试描述为真实进程崩溃恢复测试。

本次减少正常关闭内存代的多实体回执积累，仍保留每代生命周期标记。崩溃代及升级前历史回执的人工核查、跨进程关闭协调、保留策略审批、全局磁盘配额、归档与压缩仍待实现，不能据此认定 PAL-OPS 已完成。规范化实体删除也不等价于原始归档的隐私擦除。
