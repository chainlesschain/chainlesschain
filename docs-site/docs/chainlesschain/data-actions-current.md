# 数据投影恢复、项目任务修改与风险检查

> 2026-10-08 最新回读：公开 CLI **0.166.93**、Open VSX **0.37.138**、JetBrains **0.4.156**，IDE 推荐 CLI `0.166.93`；Session Core **0.3.18**、Context/Memory Kernel **0.1.8**、PDH **0.4.64**。CLI/IDE 发行提交 `65e8c21d3a`；独立产品 **v5.0.3.140** 来自 `f733f92cb9`，已公开桌面、Android 与 iOS 制品。源码核对至 `1e5477aebe`。组织目标、授权记忆、站内通知、IDE 调查恢复与 RRSI 有界读取已进入本轮对应制品；后续 Windows 冻结工具链及 Node runtime 验证仍是实验，未获生产准入。 详见[发布指南](./agent-platform-release)。

## 2026-10-07 历史研究批：受控创建、风险血缘与运维

Palantir 第五批已合入主线：个人项目可经当前预览和原生确认创建规范任务；风险记录、admission、人工确认与描述 ActionRun 同事务关联，独立人工反馈追加保存而不改原规则。新[项目目标面板](./project-goals-current)将风险、建议、原生动作和独立验收接通。个人目标与组织任务工作台已进入产品 .139；组织共享目标、多级审批关联、转移/风险/验收/记忆扩展见[组织项目指南](./organization-project-current)。真实业务效果仍待验收。

审计默认只投影元数据，受限诊断按用途/读写权限分开并有期限；不能把保存原始敏感文本作为默认排错方式。低代码 REST 探针真正执行 HTTP(S) HEAD 并显示超时/错误，但可达不证明账号登录、数据查询或应用部署；SCIM 出站仍不支持。

PDH 运维补充派生 consumer 状态、未登记历史核查、有界 dry-run/清理与存储预算。running/unknown 回执保留，当前 KG/BM25 为内存投影，向量目的地和真实崩溃效果尚未验收。上一轮公开 CLI/PDH 的投影恢复与离线预览继续可用。

## 概述

CLI 投影维护和离线预览使用公开 `0.166.93`；产品 `v5.0.3.140` 已包含个人与组织受控任务动作、目标面板、组织风险及双主体转移。离线快照仍不直接执行桌面动作。

本页说明公开 CLI/PDH 与桌面源码的三类操作：恢复个人数据中台的 KG/BM25 投影、经明确确认修改个人项目的待办任务描述、检查逾期和依赖阻塞。使用前确认所运行的源码和宿主能力；公开版安装与 IDE 升级见[发布指南](./agent-platform-release)。

## 核心特性

- **数据与索引分开确认**：实体保存成功后，KG/RAG 投递失败会留下可查询、可重试的记录。
- **任务预览后确认**：只修改已保存 `pending` 任务的描述，成功提交与回执在一个原生 SQLite 事务完成。
- **风险检查可回查**：识别任务逾期和直接依赖未完成，保存检查时点；不预测交付结果。
- **有界维护**：重试有上限；清理只接受明确选定的已退休临时 consumer，不自动删除未知运行回执。
- **能力状态如实显示**：自动化模拟、低代码设计发布、尚未支持的 SCIM 出站同步分别标记。

## 系统架构

个人数据先进入加密 Vault，实体与投影期望版本一同落盘，当前宿主的内存 KG 和 BM25 分别确认投递。新 consumer 会重建内存索引；当前 CLI 和桌面 wiring 没有连接向量目的地。

任务动作由渲染界面发起，主进程获取当前 DID、校验所有权并显示原生确认框；渲染界面和离线 JSON 都不能自行授予权限。CLI 风险评估与任务预览只处理快照，不连接真实任务执行服务。

## 使用示例

### 1. 检查索引积压并重试

以下命令已随公开 CLI `0.166.90` / PDH `0.4.63` 发行：

```bash
cc hub derivation-status --json
cc hub derivation-status --adapter local-files --scope account-scope --json
cc hub retry-derivations --limit 100 --json
cc hub derivation-state event event-id --json
```

先查看状态和失败原因，再重试。同步水位前进不代表检索索引已经更新。重试读取最新规范化实体与墓碑，不重新采集源账号，也不重放原始归档；同 consumer 的未知 `running` 投递保持受保护。

### 2. 修改个人项目的待办描述

1. 在本轮桌面源码打开项目详情，点击“项目任务”。
2. 选择实际已保存的任务，确认其状态为 `pending`，项目为 `draft` 或 `active`。
3. 编辑“描述内容”，点击“预览修改”，核对原描述与新描述。
4. 点击“确认此修改”，在原生确认框中明确确认；默认选择为取消。
5. 在“修改记录”查看结果。只有 `succeeded` 表示已提交；取消、拒绝或未知结果不算成功。

此入口使用 `project_tasks`，不含团队看板任务、AI 临时执行计划或示例任务。主进程当前 DID 必须与个人项目 `user_id` 一致；组织项目及存在工作区/资源关联的项目当前不支持。描述前后各限 8192 UTF-8 字节，中文多字节字符按字节计算。

如果预览后任务发生任何版本变化，重新读取并预览；如果已有 `running/queued/unknown` 回执，先核对实际状态。刷新、重开、换幂等键都不能绕过阻塞，也没有自动重放入口。

### 3. 检查交付风险

在“项目任务”点击“检查交付风险”，界面展示本次逾期、直接依赖阻塞信号、来源时间和检查记录 ID；数据不足时只显示提示，不展示具体原因列表。“修改记录”对应描述动作回执。历史风险记录可通过 `electronAPI.project.getRiskReview({ reviewId })` 读取，当前抽屉没有风险历史列表入口；历史只代表其检查时点，不是当前任务状态或修改成功证明。

CLI 可对已准备的离线快照做只读检查：

```bash
cc project risk-evaluate --snapshot risk-snapshot.json --json
cc project task-description-preview --snapshot task-description-snapshot.json --json
```

快照结构见 Session Core 的 `business-object-contract.js`、`project-risk-evaluation.js` 与相关 fixture。文件最多 2 MiB；任务预览返回 `authority: "unverified-snapshot"`，不验证 JSON 中的 DID、不写数据库，也没有 CLI live execute 命令。风险结果 `insufficient-data` 的退出码为 2，不能当作没有风险。

### 4. 维护已退休的投影回执

```bash
cc hub derivation-consumers --kind ephemeral --state retired --limit 100 --json
```

先检查实际 consumer ID、类型和状态。确认选定对象后，可将 `retired-consumer-id` 替换为实际已退休临时 ID：

```bash
cc hub prune-derivations --consumer retired-consumer-id --limit 100 --confirm --json
```

只可选择已退休 ephemeral consumer；混入活动、persistent、未登记或其他不符合条件的 ID 会整批拒绝。合法清理仍保留未知 running 回执、源意图、墓碑和依赖。`retainedRunning` 是保护结果；`remainingReceipts` 非零可能只是本次上限已到。`not-retained` 不是成功记录。异常退出或忙碌 consumer 不因时间经过而自动退休，当前没有强制退休其他进程的 CLI。

## 配置参考

| 项目                           | 默认与限制                                                          |
| ------------------------------ | ------------------------------------------------------------------- |
| `retry-derivations --limit`    | 默认 100，允许 1–1000；支持 adapter/scope 筛选                      |
| `prune-derivations --consumer` | 明确指定 1–100 个已退休 ephemeral ID，必须 `--confirm`              |
| 清理批次                       | 每次最多 1000 条非 running 回执                                     |
| 桌面任务列表                   | 默认 50、最多 100 条，按 ID 翻页                                    |
| 描述动作历史                   | 默认 20、最多 50 条，按插入顺序倒序翻页                             |
| 风险检查                       | 最多 1000 个任务、每任务 1000 条依赖、共 10000 条边                 |
| 在线风险来源                   | `desktop.project-tasks/v1`；状态 `pending/running/completed/failed` |
| 离线风险来源                   | 还可显式指定 `desktop.task-manager/v1`，不能混用状态                |
| 审计                           | CLI 结构化敏感字段脱敏，不是任意正文秘密识别器                      |

沿用现有 Vault 解锁及认证配置。adapter/scope 只是筛选条件，不是权限设置。真实项目修改要求支持 immediate 事务的原生 SQLite 宿主。

## 性能指标

当前公布的是输入与分页预算，没有跨平台性能 SLO 或业务收益结论。启动重建最多排空 100 页 × 1000 次投递，积压可分批重试。风险规则仅检查逾期及直接依赖；它不运行模型，也不改变任务截止日期和状态。

## 测试覆盖

源码测试覆盖 PDH 加密 Vault 的投递失败、恢复、删除、ID 冲突和 consumer 清理保护；任务服务覆盖权限撤销、预览版本变化、取消、事务回滚和未知回执阻塞；风险覆盖缺列、损坏依赖、历史篡改和撤权；Vue 组件及 IPC 有交互与边界回归。这些测试不等同于真实 Electron GUI E2E。本次静态站点构建另执行用户文档结构和内部链接检查。

## 安全考虑

- `cc hub delete-entity` 删除规范化实体并排队移除索引，原始归档仍在；重新导入可能恢复。它不删除来源平台的数据，也不构成隐私擦除。
- 任务回执保存摘要和证据，不保存描述正文或原始幂等键；摘要不能替代身份和授权检查。
- 只改描述不会解决逾期、依赖阻塞或其他任务风险；旧 CRUD 也尚未全部接入受控服务。
- 自动化普通执行为 `unsupported`、显式模拟为 `simulated`；低代码发布只保存设计，SCIM 此处出站 provider 未执行真实同步。不要把这些状态当作外部操作成功。

## 故障排查

| 现象                          | 处理                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `unknown command`             | 升级至公开 CLI 0.166.90，并确认实际执行的 CLI 路径          |
| 索引未更新                    | 检查 `derivation-status` 的失败与当前 consumer，再分批重试  |
| `DERIVATION_ID_CONFLICT`      | 修复来源标识冲突；重复重试不能消除碰撞                      |
| 任务入口拒绝操作              | 确认当前 DID 是项目真实所有者、项目为个人项目、状态符合条件 |
| 预览陈旧                      | 重新读取实际任务并预览；完整版本变化会拒绝提交              |
| `running/queued/unknown` 阻塞 | 核对已有回执与实际状态，勿把换键或重开当作恢复              |
| 风险 `insufficient-data`      | 修复缺失列、不完整任务集或损坏依赖，重新检查                |
| 历史风险读取被拒绝            | 检查当前所有权及原任务是否被删除或移出项目                  |
| consumer 未退休               | 可能异常退出或仍忙碌；没有超时强退入口                      |
| 清理保留 running              | 未知投递受保护；不要把保留回执误判为可重放                  |

## 关键文件

- `packages/cli/src/commands/hub.js`、`project.js`：命令参数和快照读取。
- `packages/personal-data-hub/lib/derivation-store.js`：投影与回执生命周期。
- `packages/session-core/lib/task-description-action-service.js`：真实描述动作。
- `packages/session-core/lib/project-risk-evaluation.js`、`project-risk-review-service.js`：离线规则和在线历史。
- `desktop-app-vue/src/renderer/components/projects/ProjectTaskDescriptionDrawer.vue`：用户操作入口。
- `desktop-app-vue/src/main/task/task-description-ipc.js`：主进程身份及确认边界。

## 相关文档

- [发布与升级](./agent-platform-release)
- [个人数据中台](./personal-data-hub)
- [CLI 项目管理](./cli-project)
- [工作流自动化](./workflow-automation)
- [低代码平台](./low-code-platform)
- [SCIM 用户配置](./scim)
- [本轮设计](/design/data-actions-update-2026-10-06)
