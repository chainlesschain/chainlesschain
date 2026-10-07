# RRSI 当前实现、离线回放与证据边界

> 2026-10-08；源码基线 `381f8018ef`。公开 .92 包含 Registry/writer 基础与完整文件身份；后续有界读取需当前源码。真实实验 `NOT_RUN`，automatic promotion `HOLD`。

## 概述

RRSI 在固定基线 A、无正则 RSI B 和正则化 RRSI C 之间，以隔离数据池、共同预算、完整观察分母和事前统计合同比较候选。它旨在防止训练收益、选择集泄漏或缺费用的结果被当作可发布收益。

本页从 `docs/research/agents/rrsi-implementation-plan-2026-10-07.md`、最新实施进度（含三阶段产物字节读取） 及相应代码补齐。统计 v2、耐久预注册、必需 HOLD 质量回执及 Registry/History/backend 关联已经实现；生产来源门、真实费用与统计校准尚未完成。

## 核心特性

- 训练（train）、选择（select）、验证（gate-validation）、测试（gate-test）和审计（audit）五池独立合同，候选变化范围与父版本冻结。
- 准备、筛选及终评预占覆盖 token、工具、墙钟、费用和执行次数。
- 原生三角计划、签名登记/准入、行与完整 census 保留缺失观察。
- 统计 v2 在任务内聚合固定重复，使用来源组及事前权重。
- History 强制统计注册早于受控预占/派发；尚未认证外部真实观察时间。质量回执固定 HOLD，缺少选择质量准入阻止新的终评派发。
- 真实对象/存储图关联阻止相同路径或复制 JSON 替代当前 backend。

## 系统架构

冻结 campaign 与有效父版本 → 准备计账/PM broad → 筛选原生计划和逐臂预占 → enrollment/launch admission → sealed 行和 census → 统计/质量回执 → 耐久 History。当前组装支持 off/shadow；enforced 的生产准入不足时拒绝。

Registry/History/backend 使用真实实例的私有品牌和捕获端口，调用前重读存储关联和有效父版本。普通 callback、相同路径、相同租户或重开的历史 JSON 不恢复当前执行权限。这些关联尚不是永久来源约束或正式 Release/Review/Pilot 全链路准入。

## 存储保护与读取范围（最新源码）

Registry/History 关联继续扩展认证 fresh pair、空运行目录、只读 construction、原文保留、单调限制、目录/安装 route/历史前缀核查。trusted index snapshot 最大 64 MiB；默认产物前校验、读取、后校验三个阶段都按 expectedSize ≤ 1 MiB 有界读取，最多 64 KiB 分块并探测 EOF，核对完整 BigInt 文件身份和元数据，失败关闭句柄。

三阶段不是原子快照。list/get、source publish、无 bounds verify 与任意 override 尚非全路径有界。完整 v2/retention 图、独立安装根、持久 pin/高水位、producer 和 alias/Release 准入未闭合；这些保护不解除质量 HOLD。参见[最新设计](/design/governance-runtime-update-2026-10-08)。

## 使用示例

研究目录提供不调用模型的合成回放。先在源码环境安装仓库依赖，查阅脚本参数：

```bash
node packages/cli/scripts/rrsi-offline-replay.mjs --help
node packages/cli/scripts/rrsi-offline-replay.mjs --demo
node packages/cli/scripts/rrsi-offline-replay.mjs --input replay.json --campaign-digest sha256:...
```

使用 `--demo` 回放仓库合成 fixture；外部输入必须同时提供观察前独立保存的 `--campaign-digest`，示例省略号需替换为真实摘要。回放只读取有界 JSON，不改输入；示例选择可输出 `shadow-selected` 或 `HOLD`。该脚本是源码研究入口，不是公开安装后的 `cc rrsi` 命令。

真实实验必须另建冻结合同，绑定实际五池来源、父版本、目标环境、模型、价格和完整预算。不要把 fixture 的摘要、测试密钥或合成费用重新标为生产身份。当前工程仍拒绝缺质量准入的新 v2 generalization 派发。

## 配置参考

配置冻结 campaign、task/source group、seed、variant、target、依赖锁及运行时 manifest。统计协议事前保存完整比较×池×variant×target family、alpha、bootstrap/RNG 承诺、minimum groups、停止规则和操作上限。不能看过结果后删比较、改权重或给旧协议追加预算。

准备阶段课程规划、探索、候选提议、记忆蒸馏、失败重试与环境重置共享不可退还的尝试上限。模式为 off/shadow；未知结果、未结算费用、超支或未确认清理阻断下一次派发。

## 性能指标

离线输入上限 2 MiB，严格 UTF-8 解码。原生三角图每 task×seed×arm×variant×target 有两份计划观察，预算必须覆盖全图。重复 seed/replica 不增加独立来源组。

统计 v2 使用 cluster bootstrap 和有限样本 Hoeffding 界的外包络。研究目录合成网格仍为 HOLD，没有证明生产覆盖率、功效、真实 PM 收益、模型费用或部署时延。

## 测试覆盖

研究记录的耐久预注册批 441/441 通过；质量回执批 86 项独立用例通过；Registry/History 关联批 170 项通过、1 项既有 Windows 平台跳过。它们覆盖真实文件 Ledger、签名验证、head CAS、损坏、响应丢失及进程恢复，但使用测试权威。各历史批次有重叠，不累计成正式样本或总测试数。

准确主线的跨平台发行矩阵、真实 A/B/C、一次性未见集、实际费用/清理和生产来源/质量认证尚未由这些记录完成。

## 安全考虑

当前质量回执始终 `decision:HOLD`、`qualityVerdictVerified:false`。来源独立性、真实账单、校准和生产权威未验证；Registry 关联也保留 `originCutoverAuthenticated:false` 和 `productionAuthorityVerified:false`。外部 PASS 或合成回放成功不能解除这些条件。

失败、超时、unknown 及缺费用保留原分母和预占；只能核对同一执行，不换 ID 重跑。Registry writer 维护协调、认证 fresh pair 和只读构造已有本地控制实现；完整来源/高水位/retention 以及生产 cutover 与准入仍需完成。

## 故障排查

| 状态                   | 含义与处理                                                  |
| ---------------------- | ----------------------------------------------------------- |
| HOLD / QUALITY_HOLD    | 缺少必需来源、质量、费用或校准；按原记录补齐，不能强改 PASS |
| 输入无效               | 检查严格 schema、UTF-8、大小、池/来源与候选路径             |
| 未结算 / unknown       | 使用原 History 与执行身份对账；不要重新派发                 |
| 预算不足               | 对完整测量图建立新的事前合同；不要修改冻结旧历史            |
| head 或父版本变化      | 刷新当前真实关联与计划，拒绝旧凭据                          |
| 历史回执可读但不能执行 | 历史快照不具有 live 品牌和当前 freshness，只供审计          |

离线回放退出码：0 为合成 shadow 选择，2 为 HOLD，1 为输入错误；退出码 0 不是生产质量或发布成功。

## 关键文件

- `rrsi-contracts.js`、`rrsi-selector.js`、`rrsi-history-ledger-adapter.js`、`rrsi-pm-execution-bridge.js`。
- `rrsi-native-evaluation-plan.js`、`rrsi-native-evaluation-batch.js`、`rrsi-native-eval-row-collector.js`、`rrsi-native-batch-evidence.js`。
- `rrsi-native-group-statistics.js`、`rrsi-native-statistics-protocol.js`、`rrsi-native-quality-receipt.js`、`rrsi-registry-history-binding.js`。
- 研究与逐文件证据：`docs/research/agents/rrsi-implementation-progress-2026-10-07.md` 和其 `evidence/` 引用。

## 相关文档

- [增量设计](/design/project-goals-rrsi-update-2026-10-07)
- [PM 效果评测](./pm-effect-evaluation)
- [受治理 Skill 演进](./governed-skill-evolution)
- [项目目标与独立验收](./project-goals-current)
- [公开发行与升级](./agent-platform-release)
