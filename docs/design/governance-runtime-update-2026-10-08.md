# 组织目标、授权记忆与运行时保护增量设计

日期：2026-10-08；代码基线：`381f8018efe0ecd26c105be40b186460cd41466e`。根据最新 Git 拓扑、实际代码和研究证据整理。发布范围以 `e812a89952` 文件树与祖先关系核对，提交时间不决定进入发行与否。

> 历史快照：本页保留 `381f8018ef` / `.139` 的发行边界。最新 `.93` / `.140` 已承接下列组织目标、记忆、通知和运行时保护，见[最新核对](release-runtime-update-2026-10-08-latest.md)。

## 发行与源码范围（前次核对）

2026-10-08 核对：公开 CLI **0.166.92**、Open VSX **0.37.137**、JetBrains **0.4.155**，两个 IDE 均推荐 CLI `0.166.92`；Session Core **0.3.17**、Context/Memory Kernel **0.1.7**、PDH **0.4.64**。发行提交 `e812a89952`，产品 **v5.0.3.139** 已公开。主线核对至 `381f8018ef`：产品已包含个人目标巡检/动作/独立验收与组织任务工作台；个人记忆面板、组织转移/风险/共享目标/巡检/验收/记忆、站内通知和 IDE 调查循环恢复属于后续源码。

| 能力                                                         | e812 公开产品 / 包         | 381 主线增量                               |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------------ |
| 个人目标巡检、受控动作、独立验收                             | 包含核心、IPC 和桌面面板   | 后续授权与通知扩展                         |
| 组织任务工作台、逐级审批、原生任务写入                       | 包含                       | 扩展目标动作关联                           |
| 个人目标 Memory Kernel 服务与 IPC                            | 包含基础；没有记忆操作面板 | 记忆操作面板                               |
| 个人项目转移到组织、组织风险检查                             | 未包含                     | 双主体授权、风险与动作血缘                 |
| 组织共享目标、周期巡检、目标动作、独立验收、共享记忆         | 未包含                     | 共享预算、权限版本、多级审批及独立业务验证 |
| 授权站内通知、静默策略、目标深链接                           | 未包含                     | 引用投影、来源重验、重开补投递             |
| IDE 调查循环恢复、Git 谓词结果                               | 未包含                     | 进展分类、有界总结和明确停滞结束           |
| RRSI writer 锁、认证 fresh pair、只读 Registry、完整文件身份 | 包含                       | 原文/限制、目录锚点、有界 index/产物读取   |

CLI 0.166.92、Open VSX 0.37.137、JetBrains 0.4.155 与产品 v5.0.3.139 的四个发行标签绑定 e812；Session Core 0.3.17、Memory Kernel 0.1.7 与 PDH 0.4.64 保持独立包版本。模块存在于 CLI 依赖不表示有用户可用的 CLI 桌面目标命令。

## 组织项目与目标合同

组织宿主每次读取/写入复核真实登录 DID、实际成员关系、项目归属和当前策略。组织任务能力以 task.read/create/update-description/approve 授予；个人项目转移需要个人所有者与组织侧双主体授权，并在最终提交时重验。

共享目标默认只保存意图，不开启巡检或允许任务动作。授权成员明确配置监控、期限、预算及允许范围；目标修订、成员撤权、策略变化使旧证据与旧执行授权失效。整个目标跨成员共用次数与时间额度，受 principal 全局额度约束。当前规则检查仅覆盖逾期和未完成直接依赖。

风险检查 → 建议 → 当前目标意图 → 提议与预览 → 逐级审批 → 请求者原生确认 → 原生任务动作/回执 → 独立目标验收。当前只开放创建任务和修改任务描述。审批通过不直接执行，也不授权额外操作；实际请求者是固定执行者。未知 ActionRun 沿原 requestId/intentId 恢复，不换身份重放或退回已占预算。

组织独立验收支持非空项目全部任务完成、选定风险消除、跨成员目标动作均处理、授权成员原生人工确认。历史目标版本中的 running/unknown 动作仍阻止完成；验收事实、报告、用量和目标 CAS 在同一原生事务提交。成功关闭未来巡检，在途任务另行排空，不伪造同步停止。项目库与独立调度账本没有共同原子事务，结算投影可按原发生身份恢复。

## 授权目标记忆

统一 Memory Kernel 保存正文与生命周期，目标只保存精确 kind/id/version 引用。个人目标作用域由可信宿主派生 store/actor/project/goal；组织记忆由组织项目与目标共享作用域隔离，goal.memory.read/write/delete 分别授权。事实、Agent 推断和执行备注保留分类，不能作为业务完成证明。

用户显式保存、修正 successor、撤销本目标使用权、删除及恢复操作；输出读取前精确复核 active/reinforced、到期、scope/sink、revision/digest、当前权限与 grant epoch。成员可共同读取或修正，但未决操作仅原操作者恢复。撤权或删除先持久拒绝读取，再协调清理；partial 保留拒绝与可恢复回执。purged 是逻辑清理，不认证 SQLite WAL、备份、导出文件的物理擦除。

Renderer 遇到读取失败、到期、身份/版本/代际变化清除列表和修正框旧正文；翻页替换旧页，不积累正文。当前没有模型 dispatch/usage/output-time 自动注入，不能称为自动记忆增强回答。

## 持久站内通知

监控检查、预算、建议与通用通知引用在项目事务中一起提交；投影失败回滚。相同风险按语义去重，来源推进不重置已读。静默策略和命名时区免打扰窗口持久化，重开恢复待投递；控制改变阻断旧待投递提示。

列表、计数、标为已读与打开都复核宿主身份和源权限，不复制目标/任务/记忆正文，不自动发 OS 通知。点击重新读取目标 ID 后定位目标抽屉，不依赖前 20 个列表项；界面显示最近 50 条。通知是历史检查提示，当前状态需再次检查。

## RRSI 存储和有界读取

Registry 与 History 绑定真实 backend 实例、目录、认证锚点和原文限制。认证 fresh pair、writer 维护锁及只读 construction 已进入 e812；后续主线添加空运行目录、观察 Skill 原文和单调限制、prefix/anchor 保留、安装 route 的 open-only 核查与原产物目录关联。相关控制仍不能替代生产来源和永久防回滚门。

trusted index snapshot 最大 64 MiB。最新默认产物前校验、中间读取、后校验三阶段都使用 expectedSize ≤ 1 MiB 的同一有界读取 helper，每次最大 64 KiB 分块，追加一个字节探测 EOF；前后检查 BigInt stat/文件身份、大小、链接及元数据，失败关闭 fd。三阶段不是同一原子快照，未建立生命周期 inode pin。

list/get、source publish、无 bounds verify 和任意 override 的 I/O 尚非全路径有界。完整 v2/retention 图、独立安装根、持久 pin/高水位、producer 来源及 alias/Release 准入继续实施。真实 A/B/C NOT_RUN，必需质量回执 qualityVerdictVerified=false，自动晋升保持 HOLD。

## IDE 调查与任务进展

remote-read-loop-guard 识别重复 Git/GitHub 调查与相同证据读取；真正进展会重置相应重复状态，紧凑状态轮询有专门处理。先提供恢复指导，持续重复时只给一次禁止工具的证据总结机会；总结应回答原问题并明确未知项，再请求工具返回 CC_AGENT_INSPECTION_STALLED，运行以停滞原因结束。不能把这一结束解释为任务成功。

git merge-base --is-ancestor 退出码 1 表示合法 predicateResult:false，进展跟踪器保留布尔谓词与退出码，不把它标成工具失败。Git inspection 仍属于探索，重复相同查询继续计入调查预算，不因 false 结果重置进展计数。此行为进入后续主线，未进入公开 CLI 0.166.92。

## 关键代码与 Git 依据

| 实现                  | 关键文件（仓库根相对路径）                                                                                                                      | 提交                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 组织任务与转移        | packages/session-core/lib/organization-task-action-service.js；organization-project-transfer-service.js                                         | 567d2c8c4c、8653b0872b                         |
| 组织目标与审批        | packages/session-core/lib/organization-project-goal-service.js；organization-project-goal-workflow.js                                           | dd310a7422、28f13ff07c                         |
| 组织巡检/验收/记忆    | packages/session-core/lib/organization-project-goal-monitoring.js；organization-project-goal-completion.js；organization-project-goal-memory.js | 4e0f98c974、3fee1c4bae、20496b72fe             |
| 个人记忆 UI/通知      | desktop-app-vue/src/renderer/components/projects/ProjectGoalMemoryPanel.vue；packages/session-core/lib/project-goal-notifications.js            | 1ac7a69dcf、ad0142a243                         |
| RRSI 有界 index/bytes | packages/cli/src/lib/artifact-store.js；bounded-artifact-file-read.js；evolution/evolution-artifact-ports.js                                    | 3e2d1042db、27f4be457e、e39f983b5f、0e83f05105 |
| IDE 调查恢复          | packages/cli/src/lib/remote-read-loop-guard.js；task-progress-tracker.js；runtime/agent-core.js                                                 | 3e1a7d0e0e、bf56068724、47ad7b9f8e             |

## 验证范围

本轮文档以源码、Git 拓扑和已存在研究回归证据为依据，没有重跑产品业务回归。通知批记录 598 项、RRSI 默认三阶段批记录 254 通过/6 平台跳过并有 WSL FIFO 定向验证；历史批次不相加，不替代准确候选提交的三平台发布门。真实 Electron GUI、真实组织租户/模型输出和独立业务效果仍需验收。

公开发行证据见[发行制品回读记录（2026-10-07）](https://github.com/chainlesschain/chainlesschain/blob/381f8018ef/docs/research/cli/evidence/release-publication-0.166.92-e812.json)与[发布指南](https://docs.chainlesschain.com/chainlesschain/agent-platform-release.html)。实施记录见[DMM](https://github.com/chainlesschain/chainlesschain/blob/381f8018ef/docs/research/agents/dots-muse-mods-implementation-progress-2026-10-07.md)和[RRSI](https://github.com/chainlesschain/chainlesschain/blob/381f8018ef/docs/research/agents/rrsi-implementation-progress-2026-10-07.md)。
