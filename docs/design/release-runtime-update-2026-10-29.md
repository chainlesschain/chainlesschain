# CLI .129：公开配对与未发布运行时边界（2026-10-29）

## 公开制品来源

| 渠道        | 当前版本     | 固定源码                                   | 已有验证                                                               |
| ----------- | ------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| CLI         | `0.166.129`  | `fd8a21637ab188dae0c777442d312ae85d420a9b` | 三系统 CLI CI / Strict Sandbox、OIDC 发布、公开归档及来源签名回读      |
| Open VSX    | `0.37.167`   | `800e9cc99711f9f02eb3bbd78eb14600406bdba5` | 正式发行门及公开 VSIX 与 CI 归档逐字节核验                             |
| JetBrains   | `0.4.184`    | `800e9cc99711f9f02eb3bbd78eb14600406bdba5` | 正式发行门；更新 `1205524` 已批准、列出且未隐藏；全部 ZIP 成员字节匹配 |
| PC / 移动端 | `v5.0.3.143` | `036d2b8be2048c98e56e917c93380f169e6a9d7b` | 独立既有发行，五平台构建、22 个资产及桌面更新元数据已核验              |

两个 IDE 都推荐 CLI `.129`。JetBrains 的外层 ZIP 与 CI 字节不同，不能把成员一致写成整包一致。Microsoft Marketplace 暂缓，VS Code 保留版本化 VSIX 安装路径。来源见 [.129 回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release129-public/publication.json)及[客户端独立回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release128-public/product-publication.json)。

## 本版运行时增量

`.129` 加强 `--review-changes` 的上下文隔离，并将实验性 Codex App Server 兼容范围与版本探针收口到统一清单。两条路径仍须显式启用；版本探针通过不扩大生产准入或实验允许列表。

交付复查继承 `.128` 的一次性状态、现有权限和剩余用量预算。成功文件内容变更可以触发一次复查机会，该机会可能包含多次读取、修复和模型请求；复查不等于独立质量验收。配置状态、模型调用用量、实际工具结果、Goal 判断和持久化回执分别记录。

IDE 保留共享推荐、配置读取三态与会话 `/model` 覆盖；`.167 / .184` 包含干净配置目录的首次配置验证。JetBrains 门禁核对最终 Gradle 启动使用的实际 IDE 配置根目录。宿主门通过不替代真实账号首次任务、两个实际会话并行运行或真人无障碍旅程。

## 主分支后续改动与发行边界

以下已进入主分支，**尚未进入上述公开包**：

| 范围           | 已有实现 / 证据                                                               | 尚待验证                                                 |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Goal 预算      | 模型评审共用运行回合、费用和取消信号；未知用量阻断继续                        | 准确发行提交的三系统门禁与真实模型账单                   |
| Goal 产物绑定  | 工具及评审前后核对工作区和产物摘要，拒绝过期或外部改写的成功证据              | 完整崩溃窗口、跨入口恢复与真实任务误报率                 |
| 独立 Goal 验收 | 显式 `verify:` 先冻结验收定义，要求外部检查器返回本次完整断言回执             | 默认 `model:` 不因此改变；真实任务及双 IDE 恢复继续验收  |
| Memory         | 修复磁盘查询取消并复用已验证分片解析结果；命中前仍读取磁盘和核验 generation   | Windows 超标、完整三系统 SLO、Stop / 并发及真实 IDE 旅程 |
| Terra          | 精确 Responses 能力、922K 输入限制、缓存 TTL 计费及预算传递；静态合同门已回读 | 实际账户、端点、账单和官方字段变化自动审查               |

Memory 的 Linux 1K / 10K / 100K 五场景各 100 次结果已核验一致，100K 热 / 冷 p95 为 72.194 / 486.836ms；Windows 本机 10K 为 354.161 / 1036.680ms，仍超出目标。不同平台和样本环境分别统计，不以 Linux 单环境结果宣称整体 SLO 达标。

## 任务、恢复与准入

跨版本合格产物累计 **34/45**，普通 **27/36**、首次入口 **7/9**，剩余 **11** 项。该统计不代表 `.129` 单轮任务成功率或完整原生旅程通过。`.129 verify-11` 的单次派发结果仍不确定，保留原始 intent / request，仅做只读核对，不通过重发判断是否执行过。

恢复前需分别核对工具副作用、已发生用量、持久状态与最终验收；缺少回执不证明此前操作回滚。`NOT_PAID_READY / NOT_ADMITTED / HOLD` 保留，`HOLD` 不作为必须消除的缺陷。

## 发布与文档构建

所需子 npm 包先公开并核验，CLI 再通过准确提交的完整三系统 CLI CI / Strict Sandbox 和 OIDC 发布，公开安装 / 归档回读通过后发布 IDE，客户端最后。主分支后续改动必须按新的冻结源码重新走门禁，不能继承旧版发布成功状态。

设计权威源位于 `docs/design/`；两个 VitePress 站点由同步脚本生成副本。用户文档、设计站和官网应从同一冻结文档提交构建，核对实际 HTML 页面和版本入口，再更新线上站点并保留旧站点供回滚。源码同步、构建成功与线上部署是三个单独状态。

## 相关文档

- [用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-29.html)
- [当前差距与任务表](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-codex-claude-gap-review-2026-10-27.md)
- [公开配对同步记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli-ide-public-docs129-progress-2026-10-29.md)
- [CLI .128 设计（历史）](./release-runtime-update-2026-10-28.md)
