# ChainlessChain 对照 Palantir 的能力差距与优化建议

本报告结合 ChainlessChain 当前源码、既有 CLI 与 IDE 差距分析、Palantir 官方文档及其 GitHub 开源仓库，判断哪些能力值得学习、哪些现有实现可以复用，以及如何安排后续工作。评估日期为 2026-10-06。

后续修改与验证见[实施进度表](./palantir-gap-implementation-progress-2026-10-06.md)。本报告保留原始评估基线，当前能力应结合实施记录判断。

**最值得学习的是把数据、业务对象、受控操作和效果验证贯通。** ChainlessChain 已有 Data Hub、知识图谱、Agent、权限、审批、协议与评测基础；当前更有价值的投入，是让这些能力支持可核验的业务流程。源码抽查还发现若干具体问题：通用自动化执行仍生成模拟结果，低代码连接测试返回随机延迟，SCIM 出站同步尚为模拟，同 ID 的 RAG 更新被桥接层跳过，CLI 审计脱敏只处理顶层固定字段。

建议保留本项目的个人数据所有权、本地优先、端侧推理、硬件身份与 P2P 协作方向，在现有模块之上补充轻量、版本化的业务对象与操作契约。Palantir 的企业平台架构提供参考，但本报告不建议整体迁移到其技术栈。

## 一 评估范围与证据口径

### 代码与资料基线

- 本地源码：`main@c630b646589a9923711992a8d358cd9f83bd4f9c`，审计开始时工作区干净。
- 本地 CLI 源码版本：`0.166.89`。源码候选、公开安装包和已验收能力分别判断。
- 用户指定参考：[CLI 分析](../cli/cli-claude-code-codex-gap-analysis-2026-10-05.md)、[IDE 分析](../ide/ide-claude-code-codex-gap-analysis-2026-10-05.md)。同时读取[后续实施状态](../cli-ide-gap-implementation-2026-10-05.md)和[续做验证记录](../cli-ide-gap-validation-2026-10-05.md)，避免重新立项已修复问题。
- Palantir 平台范围：Foundry、Ontology、AIP、Workshop、Apollo。Gotham 的专门业务能力不作为本项目默认建设目标。
- GitHub 范围：[Palantir 组织](https://github.com/palantir)中的 12 个相关仓库。筛选参考语言、用途和维护状态；并非对组织所有仓库的完整审计。
- 重点源码阅读：`osdk-ts` 的业务操作定义与调用实现，以及 `dialogue` 的重试与并发限制实现。其余仓库阅读 README 相关段落和元数据。
- [结构化证据](./evidence/palantir-gap-audit-2026-10-06.json)记录上游完整 SHA、抽查路径、探针结果及范围限制。

### 判断标准

| 标记     | 本文含义                                                     |
| -------- | ------------------------------------------------------------ |
| 局部复现 | 运行当前生产函数，注入内存存储与日志替身；未启动真实产品宿主 |
| 静态确认 | 阅读实际方法和调用入口，可以确认所述分支；未执行完整用户旅程 |
| 架构建议 | 根据抽查范围提出改进，不等于已证明全库不存在相关实现         |
| 历史证据 | 引用仓库绑定既定 SHA 和环境的回执，本次未重跑                |
| 官方声明 | Palantir 文档或开源代码说明的能力，未在其真实租户中比较测试  |

两份参考报告正文保留了原审计快照。后续模型目录、Memory 查询索引、IDE Doctor 与冷启动等已有实现，不再按原缺项重开。`6196cd065d` 的 Docker review pack 已有 36/36 题、42 个反例通过的归档；这属于工程验证。正式 36 项真实任务与 9 次首次安装仍为 `NOT_RUN`，不能据此宣布真实任务完成率或产品优劣。[续做验证记录](../cli-ide-gap-validation-2026-10-05.md)

本次执行了四组局部探针，没有修改产品代码，没有调用付费模型、Palantir 实例或真实连接器，也没有重跑产品测试和发布流程。

## 二 Palantir 值得借鉴的能力

Palantir 的 Ontology 把数据映射为现实业务中的对象、属性和关联，并通过 Actions、Functions 与安全控制支持业务操作。这里的 Ontology 既描述对象，也定义对象可以怎样变化。[Ontology 官方说明](https://www.palantir.com/docs/foundry/ontology/overview/)

Actions 将操作参数、校验、对象变化和附带效果集中定义，使不同应用使用同一操作逻辑。对本项目而言，值得学习的是让桌面、CLI、IDE 和移动端对同一次业务操作采用相同语义。[Action types 官方说明](https://www.palantir.com/docs/foundry/action-types/overview/)

| 对标维度        | Palantir 的公开能力                         | 本项目适合学习的内容                                     |
| --------------- | ------------------------------------------- | -------------------------------------------------------- |
| 数据整合        | Foundry 数据处理与 Data Lineage             | 来源、转换版本、依赖、过期状态和重建范围可以查询         |
| 业务语义        | Ontology 对象、关联、属性和操作             | 项目、任务、文档、人员等在不同入口使用稳定身份和契约     |
| AI 进入业务流程 | AIP、对象工具与业务操作                     | AI 的建议能够转为受控操作，并核验操作后的业务状态        |
| 权限与模型访问  | 数据安全控制与模型 Markings 策略            | 将对象访问、数据用途和模型出站限制接到实际执行边界       |
| 业务应用        | Workshop 基于对象数据、Actions 和 Functions | 工作台展示业务对象、证据、可执行操作和结果               |
| 效果评测        | AIP Evals 比较函数、模型、版本和多次执行    | 评测真实业务结果，保留失败、拒绝、费用未知和多次运行差异 |
| 部署运维        | Apollo 根据健康反馈和约束推进变更           | 版本配对、运行能力、健康状态、升级限制和回退证据统一展示 |

上述表格依据官方说明归纳；对 ChainlessChain 的迁移方向是本报告建议。[Data Lineage](https://www.palantir.com/docs/foundry/data-lineage/overview/)、[AIP 模型访问控制](https://www.palantir.com/docs/foundry/aip/control-llm-data-access-with-markings/)、[Workshop](https://www.palantir.com/docs/foundry/workshop/overview/)、[AIP Evals](https://www.palantir.com/docs/foundry/aip-evals/overview/)、[Apollo](https://www.palantir.com/docs/apollo/core/how-apollo-works/)

## 三 GitHub 仓库的具体学习价值

### 优先阅读与复用方式

| 仓库                                                                                                                                 | 本次看到的实现或说明                                                             | 对本项目的适用方式                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [osdk-ts](https://github.com/palantir/osdk-ts/tree/90da45384efe5511167b3842002d74856955da34)                                         | 分离 API 类型、客户端、生成器和 OAuth；Action 参数有类型定义，调用区分校验与执行 | 优先学习对象与操作契约、生成式 SDK、明确的校验模式；本项目业务后端继续由现有模块提供                            |
| [foundry-platform-typescript](https://github.com/palantir/foundry-platform-typescript/tree/4320149c31bcbcc2d176564d9259e343d9702d2b) | 按 API namespace 发布；README 说明生成代码更新与 API 版本的检查规则              | 学习按领域生成客户端、固定规范版本、检查生成代码漂移                                                            |
| [foundry-platform-python](https://github.com/palantir/foundry-platform-python/tree/ec852badbdaeca5479b1880fd890d9717d2d8615)         | 从 API specification 自动生成；区分平台 SDK 与 Ontology SDK                      | 为 FastAPI、Python 工具和 Node 客户端提供一致业务模型；避免手工重复定义请求与响应                               |
| [conjure](https://github.com/palantir/conjure/tree/b9a43622b8d87815451343d08915cfb05f550e72)                                         | 从统一定义产生多语言接口；支持枚举、联合类型等；有 wire verification 工具        | 沿用已有 JSON Schema 与 agent-protocol，把方法扩展到业务 HTTP/IPC 契约；可以先验证现有 OpenAPI/JSON Schema 方案 |
| [dialogue](https://github.com/palantir/dialogue/tree/43e804c27c25a1e35e6ed0c4ab413dfaf1a13bbc)                                       | HTTP RPC 客户端具有并发限制、排队、重试、流式处理、连接复用和指标                | 学习 provider、连接器和后台服务的资源预算；根据本项目副作用语义决定是否重试                                     |
| [safe-logging](https://github.com/palantir/safe-logging/tree/78166ae6f7fdc4bce16941fb1f189dc74dc56f13)                               | 参数明确标为 SafeArg 或 UnsafeArg，异常也有对应结构                              | 建立日志字段安全等级；JS/Python 采用相同规范，Java 可评估直接使用库                                             |
| [tracing-java](https://github.com/palantir/tracing-java/tree/34aad9843a1a854e0f597a25a635570a75ddd41d)                               | 跨服务传递 trace/span，支持跨线程追踪和追踪测试                                  | 学习上下文传播与测试；复用项目已有 OpenTelemetry，统一业务操作与 Agent 执行的关联                               |
| [gradle-baseline](https://github.com/palantir/gradle-baseline/tree/2cff8f94a0704eb979bcd10dcecc9ae4e7701fdd)                         | 可复现归档、显式依赖、类重复检查、编码和 Java 工具链规则                         | Android 与 JetBrains 可选择适用检查；Spring Boot Maven 服务采用等效门，不更换构建系统                           |
| [gradle-consistent-versions](https://github.com/palantir/gradle-consistent-versions/tree/0b97028d7769822d46b5554a4ec6ad362424697f)   | 用约束和锁文件固定多模块依赖图                                                   | 学习依赖一致性与可解释升级；与 npm 锁文件、Maven dependencyManagement 分别衔接                                  |
| [policy-bot](https://github.com/palantir/policy-bot/tree/c130390c87e5569a6819f87c9b4c631944c1b346)                                   | 按文件、作者、分支和团队组合 PR 审批规则，并提供状态检查                         | 有多人职责分工时可评估使用；先把权限、协议、发布相关变更的审阅规则落实到现有 GitHub 门                          |
| [blueprint](https://github.com/palantir/blueprint/tree/51cd1ff7545954d6a1e27320449754d58bf37216)                                     | 为桌面复杂数据界面设计的 React 组件体系                                          | 学习对象表格、筛选、批量操作与交互一致性；桌面和 Web Panel 继续使用现有 Vue 与 Ant Design Vue                   |
| [aip-community-registry](https://github.com/palantir/aip-community-registry/tree/290499c785b3738130a988e34159cb340253cb84)           | 提供个人财务、旅行、项目、费用、连接器和评测反馈等示例                           | 学习小场景的交付组织方式，优先选择与 Data Hub 和项目管理相关的示例；示例成熟度需逐项判断                        |

### 从源码得到的两个关键启发

`osdk-ts` 的 [ActionDefinition.ts](https://github.com/palantir/osdk-ts/blob/90da45384efe5511167b3842002d74856955da34/packages/api/src/ontology/ActionDefinition.ts)定义参数类型、对象引用、可空性等元数据；[applyAction.ts](https://github.com/palantir/osdk-ts/blob/90da45384efe5511167b3842002d74856955da34/packages/client/src/actions/applyAction.ts)提供 `$validateOnly`，将校验失败作为明确错误，并处理对象与关联的编辑结果。业务校验与写入实际由 Foundry 服务执行。这说明可复用的重点是统一契约与调用语义，SDK 本身并不提供本地业务数据库和权限服务。

`dialogue` 的 [RetryingChannel.java](https://github.com/palantir/dialogue/blob/43e804c27c25a1e35e6ed0c4ab413dfaf1a13bbc/dialogue-core/src/main/java/com/palantir/dialogue/core/RetryingChannel.java)包含重试次数、退避、抖动和请求分类；[并发限制器](https://github.com/palantir/dialogue/blob/43e804c27c25a1e35e6ed0c4ab413dfaf1a13bbc/dialogue-core/src/main/java/com/palantir/dialogue/core/CautiousIncreaseAggressiveDecreaseConcurrencyLimiter.java)根据反馈调整并发。迁移到本项目时，应区分只读检索、模型请求和有副作用的业务写入；写入结果未知时沿用现有不自动重放的合同。

### 采用边界

OSDK 与 Foundry SDK 是访问 Palantir 平台的客户端；这些仓库不等于 Foundry、AIP 或 Apollo 的完整服务端实现。只有需要连接真实 Palantir 实例时，才适合直接引入对应 SDK。

GitHub API 未识别 `osdk-ts` 和 `foundry-platform-typescript` 的仓库级许可证。抽查的 `@osdk/api/package.json` 与所读 OSDK 源文件标注 Apache-2.0；本文不将这一结果推广到所有包。其余表列仓库 API 标识为 Apache-2.0，后续直接复用时仍应核验所选版本和文件。

本次筛选还确认 `tslint`、`atlasdb` 为 archived。现有 ESLint 与 SQLite/SQLCipher、关系数据存储不因热门仓库列表而替换。Conjure README 将 `conjure-backcompat` 标为尚未开源，也不能把它列为可直接安装的开源依赖。

## 四 本项目已有基础与主要差距

| 领域           | 已有基础与源码依据                                                                                                                                                                                                                                               | 本次判断                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 数据接入       | [personal-data-hub](../../../packages/personal-data-hub/README.md)已有 UnifiedSchema、SQLCipher Vault、AdapterRegistry、来源与账号范围、readiness、水位和重试机制                                                                                                | 可以复用接入骨架；连接器数量不能代替逐来源的实际可用性与效果证据             |
| 语义与知识图谱 | [schemas.js](../../../packages/personal-data-hub/lib/schemas.js)、[kg-derive.js](../../../packages/personal-data-hub/lib/kg-derive.js)、[CcKgSink](../../../packages/personal-data-hub/lib/bridges/cc-kg-sink.js)；知识图谱技能已有 OWL/JSON-LD 和 ontology 文档 | 有语义建模基础；抽查范围尚未发现贯通业务对象、操作和权限的统一版本化契约     |
| Agent 与协议   | [agent-protocol](../../../packages/agent-protocol/README.md)、[agent-sdk](../../../packages/agent-sdk/README.md)、共享 runtime、Graph 与 Workbench                                                                                                               | 继续共用运行时；为业务对象和操作添加契约，不新增 Agent 引擎                  |
| 权限与审批     | [PermissionEngine](../../../desktop-app-vue/src/main/permission/permission-engine.js)、[审批工作流](../../../desktop-app-vue/src/main/permission/approval-workflow-manager.js)、CLI authority 与 grant ledger                                                    | 有实质治理基础；需要证明对象访问、操作执行与模型出站在目标业务路径上一致生效 |
| 隐私与出站     | [AnalysisEngine](../../../packages/personal-data-hub/lib/analysis.js)默认拒绝非本地模型；[pdh-egress](../../../packages/cli/src/lib/pdh-egress.js)报告出站；运行时还有权限和沙箱控制                                                                             | 不能写成没有隐私控制；建议按业务数据来源与用途形成统一策略和可解释结果       |
| 自动化         | 桌面与 CLI 均有流程、日志；CLI 还有权限预检、持久执行 ID 和重复执行处理                                                                                                                                                                                          | 抽查通用连接器节点仍为模拟，需要补实际调用、核验和明确能力标记               |
| 应用搭建       | AppBuilder 有设计、版本、数据源与回滚；现有项目、任务和工作台可复用                                                                                                                                                                                              | 设计与状态管理已有实现，连接测试和发布方法尚不足以证明运行中的业务应用       |
| 可观测性       | CLI 已有 OpenTelemetry、OTLP、trace context、规范化 ID 和默认内容遮盖                                                                                                                                                                                            | 应统一业务操作关联和审计字段规范；本次发现特定审计函数脱敏范围有限           |
| 评测与发行     | 冻结评测、宿主采集、准确提交矩阵、OIDC 和公开包回读已有工程基础                                                                                                                                                                                                  | 优先执行现有验收，再增加业务流程样本；保留真实任务与工程门的不同结论         |

Data Hub 的五类实体在 CcKgSink 中映射为现有图谱类型，其中 Place、Item、Topic 暂归入 Concept 并保留 `hubKind`。这是可理解的兼容适配，但业务操作不应依赖展示名称或通用 Concept 标签来推断规则。应增加显式类型、版本和操作声明。[CcKgSink 源码](../../../packages/personal-data-hub/lib/bridges/cc-kg-sink.js)

## 五 需要先处理的具体问题

### PAL CAP 01 通用自动化的模拟结果与完成状态

**局部复现：**桌面 `enterprise/automation/automation-engine.js:223` 的 `executeFlow()`只遍历步骤，生成 `status:completed` 和空输出。探针使用未注册连接器与未实现动作，仍得到流程和步骤完成，并写入一条内存日志。IPC 的 `automation:execute` 调用这一方法，说明它是实际入口的方法，而非仅测试 fixture。

**静态确认：**CLI `automation-engine.js` 的通用执行方法具备权限预检、持久执行记录和重复执行处理，但节点调用仍走 `_simulateNodeOutput()`。不能因为已有治理结构就宣布 Gmail、Slack 等连接器完成了实际写入，也不能将这一结论扩大到整个 Agent 工具系统。

建议优先新增或统一 `executionMode: simulation/live`、连接器的真实能力声明和独立结果回执。未实现的 live 操作返回明确不支持；模拟完成只表示流程演练完成。第一批实际调用复用现有工具、调度、权限与连接器边界。

验收应覆盖：未注册连接器、未实现动作、缺少配置、权限拒绝、取消、超时、远端已接受但回执丢失。最后一种保留 `unknown`，不能自动重发。

### PAL APP 01 低代码连接测试与发布缺少运行验证

**局部复现：**`app-builder.js:312` 的 `testConnection()`对已经登记的数据源直接返回 `success:true`，延迟来自 `Math.random()`。探针设置不可用的合成域名，没有发起网络请求，也返回成功。该数字不能作为真实连接延迟或可用性指标。

**静态确认：**`publish()`修改应用状态并保存；`preview()`返回设计与 `preview://` 标识。所读方法没有生成应用产物、部署回执或健康检查。已有设计存储、版本恢复能力应保留，但“设计发布”和“运行实例可用”需要分别表达。

建议复用真实数据源 probe，标注当前方法是否仅验证配置；未接通的数据源显示待配置或不支持。应用发布完成条件至少包括产物摘要、对象与操作依赖、运行能力检查和目标入口回读。优先在现有 Vue 工作台实现一个可运行模板，再考虑完整拖拽搭建平台。

### PAL ID 01 SCIM 出站同步仍为模拟

**静态确认：**`enterprise/scim-sync.js:119` 的 `syncProvider()`明确注释当前为模拟，没有访问已登记 provider 的 SCIM endpoint，却记录 success 并发出 completed 事件。这只涉及该出站同步方法，不否定项目已有 SSO 和 SCIM 服务端能力。

建议将“连接器已登记”“源端已认证”“用户或群组变更已应用”“同步已核验”分开。真实企业接入存在需求时，先交付一个 IdP，验收分页、限流、增量水位、账号停用、映射冲突与重试；同时验证身份变更对现有会话权限的影响。未接通时保留模拟标记。

### PAL DATA 01 RAG 桥的同 ID 更新被去重跳过

**局部复现：**`CcRagSink.write()`用 `_writtenIds` 对进程内已写入 ID 去重。先写入 `same-source-id/version-one`，再写入相同 ID 的 `version-two`，第二次结果是 `indexed:0, skipped:1`，索引仍保留旧内容。

这个探针证明所读桥的同 ID 更新语义，未证明生产用户已遭遇旧答案。需要结合来源实体是否可变、是否采用不可变版本 ID 和实际 sink 复用方式判断影响。

建议定义稳定对象 ID 与内容版本：可变对象采用按版本 upsert 或旧版本失效；不可变记录明确产生新的版本 ID 并关联前序。KG、BM25、可选向量索引分别报告派生状态与重试范围。不要把所有去重移除，否则可能重复计算和重复记账。

验收应覆盖更新、删除、重新派生、进程重启、部分 sink 失败，以及回答引用的来源版本。源数据更新完成不应直接等同于所有检索派生物已刷新。

### PAL AUDIT 01 特定 CLI 审计函数只做顶层脱敏

**局部复现：**`packages/cli/src/lib/audit-logger.js:114` 的 `sanitizeDetails()`只遮盖顶层固定键。合成探针中顶层 `token`被遮盖，嵌套 `nested.token`与 `Authorization`保留。`logEvent()`将其结果序列化到审计表，因此值得检查所有相关调用的字段来源。

项目桌面共享 logger 已有递归清理，CLI telemetry 也默认遮盖内容。改进应统一现有能力，不能笼统宣布整个项目日志未脱敏。本次没有使用真实凭据，也没有证明实际生产泄露。

建议采用类似 SafeArg/UnsafeArg 的字段分类，以默认允许记录的元数据为主，补充有界递归、大小与深度限制，以及错误、header、URL 参数等结构的处理。运行日志和审计证据还需区分访问权限、加密与保留期限。

验收应覆盖大小写与别名、数组与嵌套对象、Error、循环引用、header、URL 和受限原始诊断。数据摘要不能自动被视为已匿名化，尤其是短值和可枚举值。

## 六 建议建设的业务对象与操作层

### 最小对象契约

建议先围绕已有项目管理建设 `Project`、`Task`、`Document`、`Person`、`Decision` 与 `ActionRun`，不一次性定义覆盖所有行业的本体。

| 契约内容 | 建议最小字段或语义                                               | 复用基础                                         |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| 对象身份 | `objectType`、`objectId`、个人或组织范围、账号来源范围           | UnifiedSchema、来源 ID、账号 scope、现有业务主键 |
| 对象版本 | `schemaVersion`、`objectVersion`、时间与内容修订                 | 现有版本管理、CAS 与快照机制                     |
| 关联     | 关联类型、双方对象引用、约束与来源                               | KG triples、现有任务与项目关系                   |
| 操作定义 | `actionType`、版本、参数 schema、权限、前置条件、风险和执行能力  | agent-protocol、工具声明、permission authority   |
| 操作回执 | 操作 ID、审批引用、执行 ID、对象变化、外部回执和终态             | durable receipt、执行日志、approval ledger       |
| 数据出处 | 来源对象及版本、转换或抽取版本、模型 profile、派生时间和证据引用 | source 元数据、KG/RAG derivation、模型合同       |

这是一组建议字段，不是已实现协议。可以评估独立的共享契约包；业务读取和写入继续通过已有 Vault、项目、任务和知识模块，避免额外建立同一业务数据的权威副本。

现有 `agent-protocol` 已有 schema、严格应用校验、传输兼容边界、Kotlin/Swift 生成和 breaking-change 检查。Conjure 的主要启发可以在此基础上落实为领域 schema 与客户端生成，不必重新建设协议基础设施。

### 操作执行的统一流程

建议业务操作经过以下顺序：

`读取当前对象与版本 → 生成操作提议 → 校验参数与影响 → 按规则审批 → 执行时重验权限与版本 → 提交变化 → 核验结果 → 保存回执与业务反馈`

首次试点可以完全在本地项目与任务模块完成。桌面按钮、CLI 和 Agent 只作为不同调用入口，使用同一个 Action 服务及权限边界。

本地事务可以保证本地对象变化的一致性；外部系统写入需要独立的 outbox、幂等键或远端回执。不能将两者承诺为跨所有系统的原子事务。只有执行语义和业务允许时才提供补偿，无法撤销的操作应在提议阶段明确说明。

审批应绑定操作版本、目标对象版本和影响摘要。审批后对象、策略或参数改变，需按合同重新检查。沿用现有 session generation、authority revision、fence 和取消清理能力，不另建第四套 workflow/session engine。

### 数据血缘与派生更新

现有 `source.adapter`、`adapterVersion`、`capturedAt`、`originalId`与 `scope`提供很好的起点，但记录来源仍不足以回答完整的业务问题：某个答案用了哪版数据，哪次转换产生它，来源被删除后哪些派生物和报告受到影响。

建议把来源、转换、对象版本、索引版本、操作和评测结果关联起来，提供“新鲜、待派生、失败、已撤销、未知”的状态。血缘查询本身也需要权限过滤，避免通过关联信息暴露受限对象。

删除和撤销先在权威数据层生效，并同步阻止新读取；随后按依赖清理或重建 BM25、向量、KG 和缓存。对于已经提交给外部服务的数据，应记录其实际保留与删除能力，不能保证未被证明的远端删除效果。

### 对象权限与模型出站

Palantir 的 Markings 文档提供了模型访问策略，但该页具体按请求 token 可访问的 mandatory Markings 判断，并允许注册模型配置覆盖。不能把它简化成自动检查每个请求字段，更不应原样复制覆盖语义。[官方策略细节](https://www.palantir.com/docs/foundry/aip/control-llm-data-access-with-markings/)

对本项目，建议基于已有权限和隐私机制，明确个人与组织范围、允许用途、数据来源限制、模型位置和策略版本。把检查接到检索、prompt 组装、工具结果、导出和远端操作的实际边界，派生数据继承必要限制。

这一项属于架构与验收建议。本次抽查没有证明项目存在通用权限绕过。应先做路径盘点和负向验收，再决定增加哪些字段或 enforcement，不用新的设置页面代替执行检查。

## 七 工作台与真实业务评测

### 首选试点为项目交付风险处置

本项目已经有项目、任务、团队、审批和项目管理旅程测试，适合作为第一条业务流程。建议先复用这些数据，补充项目文档和会议纪要，形成如下场景：

1. 汇总某个项目的逾期任务、未解决事项和交付材料，标注来源及版本。
2. AI 生成风险解释和建议，将建议保持为待确认操作。
3. 操作者查看目标对象、修改差异、权限和影响，例如新增风险任务或调整任务负责人。
4. 按业务规则完成审批，由已有项目或任务模块执行，检查当前对象版本。
5. 工作台展示实际变化与回执；失败、取消或结果未知有明确处理入口。
6. 记录人工修正和后续结果，成为评测样本。

第一阶段可使用现有本地数据，不依赖所有企业连接器先接通。该试点验收通过后，再考虑个人财务归因或知识到任务转化等 Data Hub 场景。

### 工作台围绕对象与证据组织

借鉴 Workshop 的对象数据和操作机制，以及 Blueprint 的复杂数据交互方式，在现有 Workbench 中提供对象列表、详情、关联证据、操作预览和回执。CLI、桌面、IDE 继续读取相同能力状态。移动端可以先提供摘要、审批和通知。

低代码优先交付“项目风险处置”这一可运行模板，再逐步开放表格、筛选、图表和操作按钮配置。表格或图表显示有数据，并不等于权限、操作和刷新机制已经验收。

### 业务评测与现有工程门衔接

AIP Evals 的价值在于比较实际函数结果、模型和版本，并观察多次执行差异。建议将这一方法用于现有 Eval/outcome 与反馈机制，不重新建立评测平台。[AIP Evals](https://www.palantir.com/docs/foundry/aip-evals/overview/)

| 指标       | 需要记录的内容                                             |
| ---------- | ---------------------------------------------------------- |
| 业务结果   | 目标对象最终状态满足独立业务断言；区分演练与实际执行       |
| 证据正确性 | 关键判断可回到授权范围内的来源版本；保留过期与缺失证据     |
| 受控操作   | 权限拒绝、审批变化、版本冲突和取消按合同处理               |
| 重复副作用 | 超时、断线和恢复不产生未预期的重复业务操作                 |
| 数据刷新   | 更新、删除和重新派生后，检索与报告能反映正确版本           |
| 人工投入   | 修正次数、确认耗时和恢复成本；样本和统计方法固定           |
| 成本与性能 | 实际 usage、费用 unknown、阶段耗时与并发条件；目标另行确定 |
| 跨端一致性 | 同一操作身份、能力状态、审批和回执在各目标入口一致         |

为试点单独建立业务样本集和负向案例，不改变既有 36+9 的固定分母。成功率、效率提升和性能门应在样本、环境与目标确定后报告，当前不能给出与 Palantir 的量化排名。

## 八 实施顺序与完成条件

下表是建议顺序，不是工期承诺。当前没有证据支持将所有差距统一列为安全 P0；扩大 live 连接器或企业治理支持声明前，应完成对应验证。

| ID             | 优先级                   | 交付内容                                    | 完成条件                                                      |
| -------------- | ------------------------ | ------------------------------------------- | ------------------------------------------------------------- |
| PAL CAP 01     | P1 第一批                | 桌面与 CLI 自动化明确模拟、实际和不支持状态 | 未实现操作不再作为实际业务成功；已接通动作有真实回执与负例    |
| PAL APP 01     | P1 第一批                | 连接测试与应用发布反映实际能力              | 合成不可用源不会被判为真实连接成功；设计与运行实例状态分开    |
| PAL AUDIT 01   | P1 第一批                | 统一审计字段分类与有界脱敏                  | 嵌套、header、异常与 URL 用例通过；受限诊断另有访问与保留规则 |
| PAL DATA 01    | P1 第二批                | 同 ID 更新、删除和派生状态合同              | 更新后检索引用正确版本；部分失败可恢复且不重复写入            |
| PAL ONT 01     | P1 第二批                | 六类试点对象及少量版本化操作                | 参数与版本校验、权限、审批和回执在 CLI 与桌面共用             |
| PAL LINEAGE 01 | P1 第三批                | 试点数据到判断和操作的血缘查询              | 可查询来源版本、转换、派生失败及更新影响；查询遵守权限        |
| PAL EVAL 01    | P1 第三批                | 项目交付风险试点与独立业务验收              | 保留真实执行、失败、取消、unknown、人工修正和费用记录         |
| PAL ID 01      | P1 状态修正，P2 真实接入 | SCIM 模拟标记；按需求接入一个 IdP           | 实际创建、更新、停用与会话权限影响完成目标环境验证            |
| PAL POLICY 01  | P1 路径盘点，P2 扩展     | 对象读取、派生与模型出站策略统一            | 每条声明支持路径有实际 enforcement 和撤销负例                 |
| PAL OPS 01     | P2 条件项                | 应用、对象与策略的配对发布、健康反馈及回退  | 可说明目标实例运行哪版、哪些能力已验证，迁移与回退已演练      |

推荐先交付前四项的具体修正，再建立最小对象与操作契约，最后完成一个业务流程。发布时继续遵守现有准确提交全矩阵和 OIDC 规则，顺序保持子 npm 包 → CLI → IDE；对象或策略迁移还需单独验证数据兼容与恢复。

## 九 当前不优先建设的内容

- 不以对标为理由建设完整 Spark 数据平台、全行业本体、通用数字孪生或大规模设备控制中心；先确定数据量、用户和业务需求。
- 不为直接使用 Blueprint 重写 Vue 工作台。优先迁移交互方法与能力状态设计。
- 不整体替换已有协议、Agent、Graph、scheduler、Memory 或权限引擎；新增业务契约通过适配层复用。
- 不把自建云 handoff 写成完整跨机器恢复；继续采用原报告的能力边界与条件性建设顺序。
- 不采用未知结果自动重试，或把可撤销本地编辑与不可撤销外部操作统一处理。
- 不用模块数、连接器数、仓库星数、单测数量或演练成功率代表业务交付质量。

## 十 本次验证与限制

| 验证                         | 观察结果                                            | 证明范围                                         |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| 桌面通用自动化生产方法       | 未注册连接器步骤返回 completed、空输出，写一条日志  | 内存存储与日志替身，无 Electron、IPC 和外部系统  |
| AppBuilder 连接测试生产方法  | 不可用合成 endpoint 返回 success，未访问网络        | 该函数不执行真实连接测试；随机延迟不是测量       |
| CcRagSink 两次同 ID 写入     | 第二次 skipped，保留第一版内容                      | 单进程桥接更新语义；实际业务影响尚需调用路径验证 |
| CLI sanitizeDetails 生产函数 | 顶层 token 被遮盖，嵌套 token 和 Authorization 保留 | 合成数据的函数边界，无真实泄露或利用结论         |
| SCIM 与 CLI 自动化路径       | 分别确认模拟同步和模拟节点输出                      | 静态源码证据，未执行真实 provider 或租户旅程     |
| Palantir 开源代码与文档      | 固定 12 个仓库 SHA，抽查重点源文件                  | 不代表已运行其平台，不支持产品成功率比较         |

本机探针环境为 Windows / Node `22.22.2`。上游 GitHub API 在完成仓库与 README 读取后出现公开请求配额限制；重点源文件改为读取固定 SHA 的公开源码归档。没有运行下载的上游代码。

完整来源与结果见[结构化证据](./evidence/palantir-gap-audit-2026-10-06.json)。后续实施应绑定新的源码 SHA 和目标入口，局部探针、宿主工程验证、实际连接器、真实模型和业务验收分别保留结论。
