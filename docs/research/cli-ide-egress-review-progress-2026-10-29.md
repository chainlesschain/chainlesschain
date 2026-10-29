# 发行审计阻断与准确源码登记

日期：2026-10-29。第三十六批，承接[Memory 恢复与 CI 回读](./cli-ide-memory-recovery-progress-2026-10-29.md)。Astra 独立审查来源，主代理核对并应用主分支七项登记；直接修改 `main`。Microsoft 暂缓，未发布包或移动原 e7 标签。

| 项目                     | 当前完成情况                 | 证据与边界                                                                                                                                                               |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 固定 e7 CLI CI 第 2 轮   | **终态失败，不能发布**       | 原 Windows integration 5/8 成功；三个 verify-cli 在原源码身份审计失败，缺失后续证据使依赖汇总失败。不是活跃运行或观察超时。                                              |
| 精确 e7 本地复现         | **完成，退出 1**             | 隔离 sparse clone、Node 22.12、e7 HEAD、工作树干净，源码前后摘要稳定；1709 文件扫描，只有 llm.js / llm-connection-probe.js 两项 STALE，parseErrors / skippedPaths 为空。 |
| 当前主分支复现           | **完成，七项待登记**         | 四个新 Web Panel 资产 UNREVIEWED，llm.js、连接探针及 Agent Core STALE；不同于历史 e7 的两项。                                                                            |
| 逐项来源审查             | **完成**                     | 真实出口、委托操作、保守 alias 命中及修改范围分别审查；保持所有扫描根、校验逻辑及付费限制。                                                                              |
| 主分支准确登记           | **已应用，本地原命令通过**   | 82 个候选、0 个未登记 / 过期、0 个解析错误；19 项 inventory 回归通过；源码登记之外没有修改审计 runtime。                                                                 |
| e7 建议补丁              | **仅保存，未应用到发行源码** | 仅两项摘要与理由的可审查 patch；原 scanner 回放两项→零项，不代表 e7 原提交通过，也不替代新提交完整矩阵。                                                                 |
| 正式付费、预算与发行准入 | **未扩大**                   | `paidReady=false`、`runtimeCoverageVerified=false`；公开配对仍为 `.129 / .167 / .184`，产物仍为 34/45。                                                                  |

## 登记内容

| 来源               | 分类                     | 核对结果                                                                                                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Artifacts 资产     | SERVICE_API              | 同源下载和 artifact 服务操作；仍有存储及服务端授权边界。                                                                                   |
| Web Panel 主入口   | REMOTE_EXECUTION_CONTROL | 包含 preload fetch 与可配置 gateway WebSocket，可携带会话、命令及模型请求；不是零成本或只有本机网络的声明。                                |
| MtcAudit 资产      | REMOTE_EXECUTION_CONTROL | 命中的 i.fetch 为 composable 方法，委托主机查询 / 归档；主机可能产生网络与存储效果。                                                       |
| RemoteSession 资产 | REMOTE_EXECUTION_CONTROL | relay / direct WebSocket 可发送提示、审批与中断；加密及去重不证明预算 containment。                                                        |
| llm 命令           | LOCAL_DIAGNOSTIC（保持） | 直接 GET `/api/tags`，默认本地但端点可配置；另一个 llm test 路径委托真实推理。变更增加输入上限显示。                                       |
| 连接探针           | MODEL_REQUEST（保持）    | 一次受 scope 管理的推理 POST；变更保留 cache-write split、service-tier 与地区计费证据，不是免费健康检查。                                  |
| Agent Core         | MODEL_REQUEST（保持）    | 保留六个 providerFetch 和两个 Ollama 出口；修改会刷新 MCP 有效目录、委托前绑定、子任务取消及压缩输入，不能笼统宣称可用工具和模型输入未变。 |

连接探针的理由进一步收窄：缺失必需的 cache-write split 会不可定价；缺少 service-tier / region 时仍可能使用 standard / nonregional 默认估算，不能写成任何价格字段缺失都会拒绝估算。账单验证仍为 false。

这是逐字节分类及理由更新，不是为所有动态 SDK / 子孙进程证明预算覆盖。没有自动接受任意新摘要，也没有删除生成资产、脚本或解析失败的检查。之前的 source-bound 记录保留，当前候选必须匹配其真实字节。

## 证据与后续

原 e7 失败、干净 clone 身份、主线旧失败、两个建议 patch 及原 scanner 回放、实际应用、完整原命令结果和 19 项回归见[证据清单](./cli/evidence/budget-egress-review-2026-10-29/review.json)。GitHub 两种日志下载返回 403 的原回执保留；本地准确源码复现补充了可核对的原因，不把本地输出冒充为未下载到的历史日志。

主分支修补后必须由准确的新提交重新完成 Linux / Windows / macOS 门禁；原 e7 的失败仍然成立，旧成功作业不能转移到新 SHA。本批未发布 npm、IDE 或客户端，也未重放未知的原 verify-11 派发。

> 第三十七批更正：本页的 e7 失败与本批未执行发布仍成立；当前公开 `.130 / .168 / .185` 实际来自另一准确源码 `f3015e7996`，其 CLI 使用 Kernel `0.1.10`。失败 e7 原型不能继续占用或重试该已发布版本，原独立验证标签和失败证据保留。公开配对与后续主线未发布改动见[第三十七批核对](./cli-ide-release130-reconcile-progress-2026-10-29.md)。
