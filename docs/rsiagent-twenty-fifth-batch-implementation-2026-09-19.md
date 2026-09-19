# RSIAgent 第二十五次工程实施：隔离 PM clone 恢复控制器合同

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十四次工程实施：工作区恢复集、学习语义与等预算效果合同](./rsiagent-twenty-fourth-batch-implementation-2026-09-19.md)<br>
> 状态：仓库内已交付用途单一、品牌化的隔离 clone 恢复控制器合同、统一恢复迁移链头、当前进程 taint 解除与重启重建回归；目标宿主的真实 clone owner、平台级可崩溃恢复切换和断电演练仍未完成，不能据此宣称生产恢复闭环已经关闭。

## 1. 恢复控制器边界

新增 [Desktop PM clone recovery controller](../desktop-app-vue/src/main/evolution/desktop-pm-clone-recovery-controller.js)。该工厂只暴露给签名 Evolution deployment，不复用全局 `DatabaseManager.close()` 或 `switchDatabase()`，原因是后两者指向应用当前数据库，不能证明操作对象是隔离 clone。

控制器要求签名 deployment 注入以下用途单一端口：

- recovery-set 精确回读；
- 隔离 clone 独占租约获取；
- clone 数据库连接关闭及写句柄排空；
- 数据库与 workspace recovery set 的可崩溃恢复切换；
- clone 重新打开；
- 数据库与 workspace 独立重采集；
- 恢复事件耐久提交及精确回读确认；
- 已提交租约的最终释放。

所有端口在工厂边界捕获为 direct function，controller 本身通过 `WeakMap` 品牌化。Desktop loader 只接受签名 deployment 返回的品牌化 controller，并把恢复调用固定绑定到已认证回读的失败链头；普通空链头或成功链头不会自动触发恢复。代理函数、accessor 字段、额外字段、错误 schema 或不完整确认均失败关闭。

## 2. 固定恢复顺序

`recoverFailedClone()` 仅接受拥有 v2 recovery-set acknowledgement 的失败迁移。执行顺序固定为：

1. 校验失败证据、pre-run 数据库 seal 和 recovery snapshot ack；
2. 从 durability authority 同步回读并复核数据库/workspace 原始字节；
3. 比较 clone 数据库路径摘要与应用主数据库路径摘要，相同则在取得租约前拒绝；
4. 获取同时绑定 manifest、clone identity、数据库路径、workspace root 和失败迁移的独占租约；
5. 关闭 clone 连接并要求写句柄已经排空；
6. 调用宿主切换端口，并要求其明确证明 `transactionallyRecoverable: true` 与 `mainDatabaseUntouched: true`；
7. 重新打开同一 clone；
8. 独立重采集数据库和 workspace，逐字节复算并要求双 seal 与保留介质完全一致；
9. 构造绑定失败证据、snapshot ack、双 seal 和 switch receipt 的恢复事件；
10. 只接受同时认证、耐久且精确回读的恢复提交确认，最后释放租约。

任何取得租约后的异常都会把 controller 置为 `poisoned`；成功后置为 `recovered`。两种状态都不可重用，避免在提交结果不明或生命周期已经结束后重复切换。

## 3. 不触碰应用主数据库

控制器在文件替换前同时执行三层约束：

- 工厂固定应用主数据库路径摘要；
- recovery set 固定待恢复 clone 的数据库路径摘要；
- 独占租约和 switch acknowledgement 再次回显两类身份及 `mainDatabaseExcluded/mainDatabaseUntouched`。

若恢复目标等于应用主数据库，controller 会在调用 `acquireExclusiveClone` 前失败。仓库没有提供把普通 Desktop 主库包装成 clone owner 的默认 adapter，也没有实现基于两次普通目录 rename 的伪“原子替换”。真实切换必须由目标平台提供可崩溃恢复语义并接受独立故障演练。

## 4. 恢复事件仍保持非晋级语义

恢复事件固定绑定：

- manifest 与 clone identity；
- 来源失败迁移 revision/evidence digest；
- 前序状态迁移 digest；
- recovery snapshot ack digest；
- 恢复后的数据库/workspace seal digest；
- 平台 switch receipt digest。

控制器只在收到认证、耐久、精确回读的提交确认后返回成功，结果仍固定 `qualifiesForPromotion: false`。恢复数据可用性不等于候选经验通过 Eval/Review/Promotion。

[PM transition committer](../packages/cli/src/lib/evolution/pm-exploration-transition-committer.js) 现将该恢复事件作为 `success`、`failure` 之外的第三种 `recovery` 链头：重新复算 event digest、耐久提交并在重启回读时验证。Desktop 只在完整 controller 结果返回后推进 recovery revision、恢复数据库 seal、把 recovery event digest 设为下一轮前序摘要并解除当前 host 的 taint；重启后也会从认证 recovery 链头重建同一状态。恢复事件不允许再携带一份递归 recovery snapshot。

## 5. 回归证据

新增 [controller 回归](../desktop-app-vue/src/main/evolution/__tests__/desktop-pm-clone-recovery-controller.test.js)，覆盖：

- 完整独占恢复顺序与一次性状态机；
- 恢复目标等于应用主数据库时，在取得租约前拒绝；
- 缺少可崩溃恢复切换证明时，拒绝重开、提交和释放；
- 数据库读回 seal 被替换时，不提交恢复事件并保持 poisoned。

本轮当前工作树核心回归为：Desktop 11 files、113 tests，CLI 受影响核心集 8 files、112 tests，session-core 全量 26 files、558 tests，合计 45 files、783 tests passed。CLI transition committer 单文件为 9 tests passed。另一次扩大到通用 skill 装载文件的运行因既有开放句柄未自行退出，手动终止且不计入绿灯；终止前没有失败输出。新增/改动文件 ESLint 为 0 errors；仓库既有测试文件仍保留原有 `curly` warnings。

## 6. 保留边界

- 控制器是宿主能力合同，不是 Windows、macOS 或 Linux clone-root 原子切换实现；
- 当前没有 operator 签发的真实 clone owner、生产 durability authority 或断电/进程崩溃故障演练；
- 恢复事件已并入 transition recovery 的统一链头格式，当前 host 与重启状态都会依据认证结果解除 taint；这仍依赖 operator writer 对事件顺序和 durable readback 的真实保证；
- 因此本批关闭了 G02/G04 的仓库协议缺口，但没有关闭目标环境的真实宿主验收项；
- 没有新增 renderer/IPC 写入口，没有操作应用主数据库，没有执行发布。

下一步应在目标宿主实现并签发 clone owner adapter 与 recovery writer，执行进程崩溃/断电注入：验证切换中任一点失败都能恢复到旧 clone 或已认证的新 clone、应用主数据库始终未触碰，并在重启后复核 recovery 链头与双 seal 后继续下一轮。
