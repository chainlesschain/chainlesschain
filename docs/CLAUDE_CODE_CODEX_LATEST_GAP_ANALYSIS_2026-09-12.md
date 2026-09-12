# ChainlessChain 对照 Claude Code 与 Codex 最新版本的差距与优化建议

> 审计日期：2026-09-12（Asia/Shanghai）<br>
> 二次复审：2026-09-12；增加完整入口追踪、失败事件探针和反证核对，修订 G01–G04、G06、G08–G11 的范围与优先级；本次仅更新文档，不修复生产代码。<br>
> ChainlessChain 仓库基线：`0f55ec9050c26f90c96a42bc736a124ed78d259c`<br>
> 复审工作树截点：2026-09-12 16:45（Asia/Shanghai），HEAD 已前进至 `f2d7376265e7f96fa95af595625b0b13c105732a`（Android 模型出站修复）；另有他人未提交的 setup/doctor/readiness 修改，单列于 G01，未纳入已完成结论。<br>
> 源码版本：根项目 `5.0.3.54`、产品标识 `v5.0.3.137`、CLI `0.166.45`、Desktop `5.0.3-alpha.137`、VS Code `0.37.95`、JetBrains `0.4.122`<br>
> Claude Code 官方最新发布记录：`2.1.269`，2026-09-11<br>
> Codex CLI 官方最新稳定发布记录：`0.154.0`，2026-09-09；配套 Python SDK `0.154.0` 的记录日期为 2026-09-10<br>
> 参考格式：[自进化差距分析](./AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)，沿用“结论 → 外部能力 → 项目底座 → 优先级 → 路线图 → 验收与限制”结构<br>
> 证据口径：官方文档在线复核 + 当前源码审计 + 有限本地验证；源码版本不等同于已公开发布版本，工作流定义不等同于本次提交的 CI 通过证明。

## 1. 结论先行

ChainlessChain 当前最需要优化的是**把已有 Agent 能力交付成可配置、可验证、跨入口一致的用户流程**。项目已经具备统一运行时、上下文压缩、后台 Agent、权限与沙箱、插件、Memory、Eval、App Server 和受治理演化等大量底座。继续按功能名称追赶，容易重复建设；围绕实际任务成功率、首次运行成功率和维护成本收敛，收益更明确。

本次审计确认的主要问题是：

1. **首次使用的就绪判断仍需闭合。** 普通模型调用要求认证治理入口；已提交基线的 `setup`、`doctor` 与 IDE runtime READY 不足以证明模型任务可运行。复审时工作树已开始补 setup/doctor 检查，但按具体命令、factory 判断就绪的合同尚未闭合，不能直接标为完成。
2. **最新模型主链与实验集成需要分别完善。** 内部 OpenAI 路径仍主要使用 Chat Completions。Codex App Server 适配器尚未接入产品主链，除了矩阵未覆盖 `0.154.0`，还复现了提交结果不明时回退执行、失败终态被投影为成功两个接线前风险；不能将它们表述为默认 Codex 路径的生产故障。
3. **通用评测与专用正式门之间存在能力落差。** `cc eval --trend` 在没有基线或删题后仍可能返回“无回归”；runner 的产物检查通过也不等于执行成功。项目已有更严格的 Graph 评测门，适合复用到通用 Eval 和插件作者的一键双臂报告入口。
4. **默认 canonical 中文记忆召回有可复现盲点。** 连续中文按整句分词，句内关键词查询可能完全无结果；legacy SQLite 子串搜索存在，但该默认路径不会自动回落。上下文预算已有内部显式窗口覆盖，仍需统一模型能力与 token 估算。
5. **真实部署和规模验证需要与合同测试分开。** 已有 live-provider、IDE 真宿主和三平台测试，但部分真实模型旅程仍使用测试治理宿主。不能据此推导默认安装、真实身份与签名部署、生产自进化全部可用。

Claude Code 值得优先借鉴的是插件作者评测流程，以及配置、任务状态和恢复行为的持续打磨；Codex 值得借鉴的是模型能力协商、非阻塞澄清体验和会话控制接口。项目已经支持多问题挂起、带外答案与乱序归属，不能将异步交互整体列为缺失。以上是产品与架构取舍判断，不是两者编码正确率的实测排名。

### 1.1 本次状态标记

| 标记           | 含义                                                              |
| -------------- | ----------------------------------------------------------------- |
| 已实现         | 找到当前源码及调用关系；不自动代表所有环境可用                    |
| 本次复现       | 本次执行了对应局部检查，记录输入和结果                            |
| 待目标环境验证 | 有实现或测试机制，但本次没有核验所需真实部署、模型、OS 或发布产物 |
| 建议新增       | 本报告建议的工作，尚未因编写文档而实现                            |

旧报告中“尚未统一演化/Memory 内核”“没有自动压缩”“没有 IDE E2E”等历史判断，不能直接作为本次待办。本文只对当前基线仍有依据的差距提出建议。

## 2. 外部方案实际提供了什么

### 2.1 最新版本和比较边界

| 对象             | 本次核验基线            | 使用边界                                                               |
| ---------------- | ----------------------- | ---------------------------------------------------------------------- |
| Claude Code      | `2.1.269`，2026-09-11   | 以官方更新日志和功能文档为准；账号、provider、组织配置仍可能影响可用性 |
| Codex CLI        | `0.154.0`，2026-09-09   | CLI、IDE、桌面和云端能力分别判断；实验功能不视为生产承诺               |
| Codex Python SDK | `0.154.0`，2026-09-10   | SDK 记录日期与 CLI 日期不同，不用 SDK 更新日期代替 CLI 发布日期        |
| ChainlessChain   | 本文头部 SHA 与源码版本 | 本次没有核验 npm、Open VSX、JetBrains Marketplace 的最新线上版本       |

版本来自实际打开的 [Claude Code 更新日志](https://code.claude.com/docs/en/changelog) 与 [ChatGPT / Codex 更新日志](https://learn.chatgpt.com/docs/changelog)。搜索摘要曾返回较旧版本，本报告以打开后的当前页面为准；未将预发布、构建输入归档或桌面更新混作稳定 CLI 版本。

这里比较的是 Agent 产品和工程实现。CLI 版本、基础模型版本、API 协议以及桌面功能是不同层级；支持填写某个模型名称，也不能直接证明 reasoning、工具调用、缓存和恢复均已兼容。

### 2.2 Claude Code：评测已进入插件作者的常规工作流

`2.1.269` 新增 `claude plugin eval`，并改善后台任务状态、压缩后的仓库状态以及恢复会话行为。对本项目最直接的新增参照，是将插件效果验证做成公开命令。[官方更新日志](https://code.claude.com/docs/en/changelog)

插件评测支持任务用例与 grader、默认重复运行、默认无插件对照、JSON/HTML 输出和 CI 阈值；评测及模型 grader 会实际消耗模型额度。官方同时说明，评测隔离不构成针对插件自身代码的安全边界，通过评测也不等于插件安全。[Plugin evals](https://code.claude.com/docs/en/plugin-evals)

其他需要保留的比较边界：

- `/goal` 用独立 evaluator 判断进度，但 evaluator 不独立执行命令或读取文件，仍依赖执行 Agent 展示的证据。[Goals](https://code.claude.com/docs/en/goal)
- Dynamic Workflows 以 JavaScript 编排并行子代理，适合批量迁移和审查；工作流脚本本身没有直接文件/终端访问，也不支持一般性的运行中用户输入。[Workflows](https://code.claude.com/docs/en/workflows)
- Auto Memory 可跨会话保留项目经验，但主会话记忆是本机存储，同仓库 worktree 共享；它不自动构成跨设备知识发布与撤销系统。[Memory](https://code.claude.com/docs/en/memory)

因此，项目应对标其“插件作者能直接验证效果”的使用流程，同时保留自己的部署授权、版本绑定和晋升审计机制。不能继续用“Claude Code 只有记笔记，没有正式插件评测”作为差异化依据。

### 2.3 Codex：交互连续性、会话管理与协议边界更加清楚

`0.154.0` 的相关增量包括异步回答问题、实验性 worktree、Windows 共享后台服务，以及插件刷新、OAuth 刷新和恢复权限的改进。旧 `codex mcp-server` 入口已移除；连接外部 MCP server 的能力仍保留。[官方更新日志](https://learn.chatgpt.com/docs/changelog)

需要分开看三组能力：

- **会话控制：** App Server 提供 thread/turn 生命周期及能力查询，但官方仍将该命令和 WebSocket 传输标为实验性，不支持生产工作负载。接口中“稳定字段”与产品级生产支持不是同一承诺。[App Server](https://learn.chatgpt.com/docs/app-server)
- **长任务与并行：** CLI、IDE 和桌面支持 Goal 工作流及子代理；子代理有独立执行成本，并继承父级的相关权限约束。[Long-running work](https://learn.chatgpt.com/docs/long-running-work)、[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- **经验复用：** 本地 Memories 有生成与使用控制，默认关闭；Record & Replay 将演示转为 Skill，当前限 macOS 且依赖 Computer Use。它们提供经验复用入口，但所引用文档没有建立所有 Skill 修改都必须经过自动灰度晋升的承诺。[Memories](https://learn.chatgpt.com/docs/customization/memories)、[Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)

Auto-review 可减少跨权限边界时的人工打断，但官方明确它会出错，不能代替沙箱。因此本项目应同时改进权限解释和真实隔离能力，不能把模型批准当作隔离证明。[Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)

### 2.4 对本项目的直接启发

| 维度     | Claude Code 参照         | Codex 参照                 | ChainlessChain 应优先交付                |
| -------- | ------------------------ | -------------------------- | ---------------------------------------- |
| 插件效果 | 作者可直接执行评测       | Skill/插件与会话运行时结合 | 复用 Eval，交付插件专属双臂报告          |
| 长任务   | 目标判断与后台状态       | Goal、子代理、会话控制     | 可解释的运行/等待/阻断状态，真实恢复验收 |
| 用户澄清 | 主会话与工作流边界不同   | 运行中异步回答             | 区分可异步偏好与必须等待的授权           |
| 记忆     | 本机项目经验             | 受控本地记忆、演示转 Skill | 中文召回、证据来源和撤销约束同时成立     |
| 集成     | CLI/SDK/插件工作流       | App Server 和模型能力查询  | 当前上游版本兼容证据与明确降级           |
| 安全     | 权限、受管设置与执行隔离 | 沙箱加自动审查             | 支持范围可见，不能实施的策略明确阻断     |

表中外部能力来源见本节各功能链接；项目的具体差距和证据见后续章节。

## 3. 本项目已经具备、应保留的能力

| 已有能力                  | 当前证据                                                                                                                                                                                                                | 本轮应如何复用                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 统一 Agent 执行与压缩     | [运行时](../packages/cli/src/runtime/agent-core.js#L13121) 已使用 authenticated ingress 对应的 canonical compactor，并有压缩持久化与 CAS 路径                                                                           | 优化模型 profile、预算和真实兼容性，不另建压缩内核 |
| Anthropic thinking 与缓存 | [缓存请求](../packages/cli/src/runtime/agent-core.js#L11103)、[thinking 处理](../packages/cli/src/runtime/agent-core.js#L12391)                                                                                         | 保留 signature/tool replay，补支持模型的真实验证   |
| 后台 Agent 生命周期       | [Supervisor](../packages/cli/src/lib/background-agent-supervisor.js#L1908) 已有交互恢复、身份与 heartbeat/CAS                                                                                                           | 增加分页和容量测量，继续使用现有状态权威           |
| 外部 Agent 协议分离       | [External adapters](../packages/cli/src/lib/external-agent-adapters.js#L7) 区分 Claude stream-json 与 Codex exec JSONL                                                                                                  | 复用终态、错误和 usage 投影，不混用两家参数        |
| App Server 与多宿主       | [Server](../packages/cli/src/lib/app-server/server.js#L424) 已支持 thread/turn；[存储工厂](../packages/cli/src/lib/app-server/rollout-store-factory.js#L13) 有 JSONL/SQLite                                             | 做迁移验收，不从头复制会话服务器                   |
| 通用 Eval                 | [命令和 headless runner](../packages/cli/src/commands/eval.js#L94) 支持真实 Agent、JSON、历史与趋势                                                                                                                     | 补正式证据门及插件作者入口                         |
| 统一 Memory               | [公开 search](../packages/cli/src/lib/context-memory-kernel/memory-service.js#L544) 调用共享 kernel                                                                                                                     | 在现有 scope、sink、撤销边界内增强召回             |
| 受治理演化                | [部署 profile v4](../packages/cli/src/lib/evolution/evolution-deployment-profile.js#L18) 已有版本下限、根轮换和撤销；[部署状态](../packages/cli/src/lib/evolution/evolution-deployment-config.js#L43) 保留自动晋升 HOLD | 做真实目标环境试点，保留签名与发布控制             |
| IDE、远控与发布门         | [IDE 工作流](../.github/workflows/ide-extensions.yml#L638)、[ARM64 工作流](../.github/workflows/ide-arm64-validation.yml#L88)、[远控配对测试](../packages/cli/__tests__/integration/remote-control-start.test.js#L114)  | 补最新宿主和真实部署旅程，不把已有测试列为缺失     |

另需保留历史完成事实：[Context/Memory 设计文档](./design/modules/108_Context_Memory_Kernel设计.md#L565) 已记录 `e93dc817ae7f65159ffa754472ebdac30de34180` 的三平台、soak、26 槽证据及 production-close。该记录是已有成果；本次没有重新访问远端验签，后面的召回与容量问题也不推翻该版本的既有合同验收。

## 4. 优先级总览

P0 指阻碍基础使用，或在作为正式发布/自动晋升依据前必须关闭的问题；P1 指主要能力和一致性差距；P2 指规模与获取成本优化。条件性 P0 不代表当前默认配置已经造成事故。

| ID  | 优先级                    | 当前不足                                       | 优先交付结果                              | 证据性质                       |
| --- | ------------------------- | ---------------------------------------------- | ----------------------------------------- | ------------------------------ |
| G01 | P0                        | 组件就绪与模型任务就绪未形成统一指引           | 独立 readiness 状态及可执行部署指引       | 源码与正常 CLI 入口复现        |
| G02 | P1；作正式 gate 前 P0     | 通用 Eval 可比性不足，执行失败与产物通过未分层 | 复用正式门，保留执行/产物/证据独立状态    | 本次复现                       |
| G03 | P1                        | OpenAI 协议、模型目录和上下文预算不统一        | 版本化 provider profile 与 Responses 适配 | 已审计源码                     |
| G04 | P2；接入该实验适配器前 P0 | 未接线适配器存在不明提交回退与终态投影问题     | 先关闭协议反例，再验证当前版本            | fake client 复现；非生产路径   |
| G05 | P1                        | 插件作者没有一键效果对照入口                   | 插件 Eval、双臂报告、CI 退出码            | 已审计源码                     |
| G06 | P1                        | 默认 canonical 中文句内关键词召回不足          | 治理约束内的多语言混合检索                | 本次复现                       |
| G07 | P1                        | 严格沙箱的联网/OS/后台组合受限                 | 可执行能力矩阵及重点组合补齐              | 已审计源码                     |
| G08 | P2；体验优化              | 已有异步传输，同一调用 loop 的非阻塞澄清待完善 | 在现有协议上区分可选澄清与阻断授权        | 异步反证通过；调度需跨入口验收 |
| G09 | P1；自动晋升前 P0         | 测试宿主/live provider 与真实部署验收有间隔    | 正式产物完整旅程及单 Skill 生产试点       | 待目标环境验证                 |
| G10 | P2；规模承诺前升级        | 持久 Memory、后台列表和演化账本容量边界不同    | 实际存储路径容量曲线与索引/迁移           | 已审计源码与基准定义           |
| G11 | P2                        | 远控配置与 IDE 分发渠道仍有使用摩擦            | 连通性向导、渠道说明、安装回读            | 已审计源码与工作流             |

建议先完成 G01、G02，再并行推进 G03 与 G05/G06。G04 保持实验隔离，只有计划接线时才提升为前置 P0；G08 是现有能力上的体验增强。G09 的完整旅程应贯穿各批次，不放到所有功能完成后才开始。

## 5. P0：先补齐可用性和证据真实性

### 5.1 G01：把“配置已保存”与“能够运行模型任务”分别判断

**已提交基线事实。** [ask.js](../packages/cli/src/commands/ask.js#L109) 在无 authenticated ingress 时抛出 `CC_AGENT_EVOLUTION_INGRESS_FAILED`；[共享模型调用入口](../packages/cli/src/lib/evolution/governed-model-turn.js#L36) 同样要求宿主拥有的 composition factory。此条件对普通模型任务也有影响。

在该已提交基线中，`setup` 完成 provider/key 等步骤后直接显示 `Setup complete!`，`doctor` 未包含专门的 deployment/authority 检查；[VS Code readiness](../packages/vscode-extension/src/runtime-compatibility.js#L25) 主要依据版本、桥接端口和 workspace trust。前两项在以下未提交修改中已经开始改善，不再笼统当作当前工作树完全缺失。

**二次复审实测。** 正常 CLI 的 [部署 loader](../packages/cli/src/lib/evolution/evolution-deployment-loader.js#L490) 在没有相应环境配置或 deployment profile 时返回空值；不存在可据此推定的默认可信宿主。隔离用户目录和安全锚、清空继承模型凭据并拦截网络后，`cc evolution deployment status --json` 返回 `source:none / effectiveEnabled:false / verified:false`；使用本地 Ollama 参数，或先通过 `config set` 保存 provider/model/baseUrl 再执行 `cc ask`，均在联网前以缺少 authenticated ingress 退出。普通 `agent --print --max-turns 1 --ephemeral` 同样因缺少 authenticated composition factory 退出；各次网络尝试均为 0。没有实跑交互式 setup wizard，不能把此结果写成完整安装旅程。

**工作树中的修复进展与剩余反例。** 截点时他人修改的 [setup](../packages/cli/src/commands/setup.js#L190) 已增加提示并区分 `Setup complete` 与 `Setup saved`，[doctor](../packages/cli/src/lib/doctor-checkup.js#L391) 已加入部署 section。但新增 [readiness helper](../packages/cli/src/lib/evolution/evolution-deployment-config.js#L27) 仅判断 `effectiveEnabled && verified`。只读输入 `{effectiveEnabled:true, verified:true, commands:["evolution"]}` 仍返回 `ready:true`，而 [loader 命令白名单](../packages/cli/src/lib/evolution/evolution-deployment-loader.js#L538) 会拒绝未包含的 `ask/agent`，随后还需验证模块导出及实际 factory。此为该未提交 helper 的局部反例，不是完整签名部署的 E2E 复现；建议按目标命令和可用依赖细化判定，再核验跨入口一致性。本报告未改动这些源码或相关测试。

**实际影响与限定。** 用户可能已经配置模型，也看到组件 READY，却仍无法完成第一次请求。IDE 的 READY 本来描述 CLI/bridge runtime，[doctor](../packages/vscode-extension/src/ide-doctor.js#L48) 也沿用这一语义；不能把组件状态本身认定为错误逻辑。问题是缺少独立、醒目的“模型任务就绪”组合状态和部署指引。上述探针验证了阻断发生在模型请求前，没有完成安装到真实任务的全旅程，也没有证明完整可信部署不可用。

**建议。** 复用现有 [部署配置入口](../packages/vscode-extension/src/evolution-deployment-config.js#L35)，统一输出环境、模型、凭据引用、deployment、沙箱的独立状态；保留原来的组件 READY，但增加“任务可运行”的组合判定。返回稳定错误码、阻断原因和对应配置操作。提供可安装、可验签的受限宿主方案，不能自动生成测试 authority 来填补生产条件。

**验收。** 空配置、仅有模型配置、完整可信部署、部署被撤销四种状态，在 CLI/VS Code/JetBrains/`cc ui` 中一致；未就绪时在模型请求前解释原因，完整部署时能完成一个最小真实任务。

### 5.2 G02：通用 Eval 的趋势、产物和执行状态应分别判定

**当前事实。** [computeTrend](../packages/cli/src/lib/eval/trend.js#L86) 对零条或单条有效历史返回 `regressed:false`；消失的任务进入 `newlyMissing`，但 [阻断条件](../packages/cli/src/lib/eval/trend.js#L142) 只考虑既有用例失败和总通过率下降。[CLI](../packages/cli/src/commands/eval.js#L237) 仅在 `trend.regressed` 为真时设置失败退出码。

**本次纯函数复现：**

| 输入                                | 当前返回                                                | 作为正式 gate 的问题                  |
| ----------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| 没有有效历史                        | `runs:0, direction:"n/a", regressed:false`              | 没有可供比较的基线                    |
| 基线 `a,b` 全通过，新结果只保留 `a` | `newlyMissing:["b"], direction:"flat", regressed:false` | 删掉用例后仍保持 100%，无法证明无回归 |

**二次复审新增反例。** [runner](../packages/cli/src/lib/eval/runner.js#L145) 虽记录 `agentOk`，但 [任务 pass](../packages/cli/src/lib/eval/runner.js#L160) 只取决于 `task.check()`。使用真实内置 `greeting.txt` checker 和进程内虚拟文件系统，预置合法产物后，Agent 返回 `ok:false`、抛错或返回超时失败三种输入均得到 `passed:1 / total:1 / agentOk:false`；抛错样例仍保留 `agent error: provider failed`。随后 [history](../packages/cli/src/commands/eval.js#L309) 只保存逐题 `id/pass`，[退出码](../packages/cli/src/commands/eval.js#L339) 也仅看产物检查的通过数。

这证明“正确产物 + 失败执行终态”仍可算任务通过，不证明默认干净工作区中的 provider 失败会自动全通过。[既有 no-op 测试](../packages/cli/__tests__/unit/eval-runner.test.js#L182) 明确要求 0%；有价值的部分产物也不应丢弃。应区分产物正确性与执行可靠性，再明确哪种 gate 要求二者都通过。

**已有反证与复用对象。** 项目并不缺少严格评测基础：[Graph 正式评测](../packages/cli/scripts/graph-collaboration-quality-eval.mjs#L266) 已核对冻结任务集合，[跨平台证据](../packages/cli/scripts/graph-collaboration-quality-eval.mjs#L515) 已绑定 commit/provider/model，[control](../packages/cli/scripts/graph-collaboration-quality-eval.mjs#L1159) 与 [candidate](../packages/cli/scripts/graph-collaboration-quality-eval.mjs#L1271) 均检查进程退出及相应终态。上述缺口限定为通用 Eval，不外推到 Graph 或受治理 `EvolutionEvalGate`；没有证据说明 npm 权威发布门目前只依赖通用命令。

**建议。** 保留诊断模式的 `n/a`，复用已有正式门，为通用 gate 增加可比性检查：至少两份有效运行、任务集合一致、corpus/model/provider/环境/权限指纹一致、证据未过期。缺基线、删题、损坏记录和配置混用返回 `INSUFFICIENT_EVIDENCE` 或失败退出码。分别持久化 `artifactCheckPassed`、`executionSucceeded`、错误/超时和证据完整性；正式可靠性 gate 要求这些条件共同成立。复用现有带 digest 的报告，减少重复协议。

**验收。** 缺基线、单条历史、删题、模型切换、损坏 JSONL 和 dry-run 均不能得到正式 PASS；合法产物伴随非零退出、异常或超时时，保留产物结果但不能得到执行可靠性 PASS。history 导出后仍能重建这些状态；同任务集合、执行成功且证据完整的真实无回归才能通过。

### 5.3 自动晋升前的条件性 P0

部署配置已有签名、撤销和版本控制；[状态投影](../packages/cli/src/lib/evolution/evolution-deployment-config.js#L43) 仍明确 `autoPromotion:"hold"`。应保持这一边界，直到 G09 的目标环境证据闭合。

不能以测试 grader、测试签名宿主、论文数值或本地合同测试通过，替代实际 Skill 在目标模型上的收益、真实身份审阅及可回滚效果。本轮不修改运行配置，也不把“解除 HOLD”作为文档交付的一部分。

## 6. 按能力梳理：模型、评测、记忆与交互主链

### 6.1 G03：统一模型能力 profile，再补原生协议

**证据。** 内部 OpenAI 流式与非流式请求分别位于 [agent-core.js:11313](../packages/cli/src/runtime/agent-core.js#L11313) 和 [11353](../packages/cli/src/runtime/agent-core.js#L11353)，均走 `/chat/completions`，尚未在此路径接入 Responses items 或 reasoning 配置。[provider-options](../packages/cli/src/lib/provider-options.js#L65) 的辅助配置存在，但不能据此声称该主链已经使用它。

官方迁移文档明确区分两种协议，并指出从 GPT-5.4 起，Chat Completions 不支持非 `none` reasoning effort 下的工具调用。因此需要核验具体模型、协议和工具组合，不能只替换模型名。[Responses 迁移说明](https://developers.openai.com/api/docs/guides/migrate-to-responses)

此外，[内置模型目录](../packages/cli/src/lib/llm-providers.js#L30) 仍包含较旧候选；[窗口映射](../packages/cli/src/lib/model-context-window.js#L46) 对未知模型落到 provider 默认值，OpenAI 为 128000、Anthropic 为 200000。[canonical planner](../packages/cli/src/lib/context-memory-kernel/provider-context.js#L132) 确实使用该映射；[message adapter](../packages/cli/src/lib/context-memory-kernel/message-adapter.js#L143) 与 [另一路 compressor](../packages/cli/src/harness/prompt-compressor.js#L172) 的 token 估计方法也不相同。

**已有能力限定。** canonical planner 已支持内部参数 `contextMemoryModelWindowTokens` 覆盖静态窗口，不能把“第一次支持显式覆盖”列为新增需求；本次未确认该参数在全部用户配置入口可见。

**建议交付。** 用同一版本化 profile 描述 endpoint、工具调用、reasoning、窗口、最大输出、token 估算、vision 和缓存能力；复用现有窗口覆盖，统一配置来源并展示“确认值/估算值”。为支持的 OpenAI 模型接入 Responses，保留其他 provider 的兼容路径；新协议必须继续经过现有治理 ingress、usage 和取消机制。

**验收。** 实际支持模型分别完成 reasoning+tool 往返、流式取消、压缩后继续、模型切换和 usage/cached-token 归账；中文、代码、大工具 schema 的预算误差有测量结果。未经这些验证，不承诺“支持所有最新模型”。

### 6.2 G04：实验 Codex App Server 适配器须先修正协议，再考虑接线

**证据。** [适配器矩阵](../packages/cli/src/lib/codex-app-server-adapter.js#L5) 只包含 `0.149.0/0.150.0/0.150.1`；[CI 矩阵](../.github/workflows/codex-app-server-compatibility.yml#L63) 也是这三版。本次直接调用 `isCodexAppServerVersionCompatible("0.154.0", matrix)` 返回 `false`。

**接线路径纠正。** 该适配器目前没有产品调用方。[兼容脚本](../packages/cli/scripts/codex-app-server-compatibility.mjs#L315) 主动扫描生产引用，removal drill 还要求无生产依赖；[外部 Agent 工厂](../packages/cli/src/lib/external-agent-adapters.js#L257) 实际选择的是另一条 `CodexAdapter` / `codex exec --json` 路径。因此旧矩阵不等于默认 Codex 功能受限，以下也不是已证实的生产事故。当前维持 P2；准备接入该实验组件前，两项失败反例必须作为 P0 关闭。

**二次复审的无副作用 fake-client 反例：**

| 输入事件或故障                                                          | 当前结果                                                            | 接线前风险                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `turn/start` 请求中先收到 `turn/started`，随后因响应丢失抛 `ECONNRESET` | `upstreamAccepted:1, fallbackCalls:1, fallback:true`                | 原任务已经被接受，仍可能启动第二条执行路径 |
| `turn/completed`，其中 `params.turn.status:"failed"` 并含嵌套 `error`   | 返回 `terminal:"completed", error:null`，投影状态也改成 `completed` | 失败执行被展示或结算为成功                 |

第一个问题来自 [admitted 标志](../packages/cli/src/lib/codex-app-server-adapter.js#L188) 在 `turn/start` 成功响应之后才置真，以及 [catch fallback](../packages/cli/src/lib/codex-app-server-adapter.js#L211)；已有保护只能覆盖“已收到成功响应”，不能覆盖“服务端接受但响应丢失”。第二个问题来自 [终态投影](../packages/cli/src/lib/codex-app-server-adapter.js#L68) 仅按方法名 `turn/failed` 判断失败。官方合同明确 `turn/completed` 也用于失败或中断，需读取 `turn.status`，并保留失败的 error。[App Server 生命周期](https://learn.chatgpt.com/docs/app-server)

**建议交付。** 保留未接线状态；按官方 `turn.status/error` 投影终态，对提交结果不明执行状态核对或幂等处理，不能将连接错误直接等同于未提交。复用 [兼容检查脚本](../packages/cli/scripts/codex-app-server-compatibility.mjs#L25)，加入上述故障注入，以及 `0.154.0` 的 schema、初始化、消息类型、取消与恢复测试；外部事件不能冒充用户授权。通过后再扩展矩阵，并单独审阅产品接线。

**验收。** 失败、中断、成功终态不能互相覆写；模拟“已接受 + 响应丢失”时不触发未经核对的第二次执行；确认未提交才可按策略回退。Linux/Windows/macOS 对同一候选 SHA 和指定上游版本生成报告。fake 探针不替代真实 Codex 集成测试，也不改变上游实验性质。

### 6.3 G05：将通用 Eval 整理成插件作者可用的产品入口

**证据。** [plugin validate](../packages/cli/src/commands/plugin.js#L1434) 检查 manifest、组件、路径及可选签名；没有执行效果评测。当前插件命令未注册 `eval`；[通用 Eval](../packages/cli/src/commands/eval.js#L184) 已有真实 runner 和 JSON/历史输出，但 [getSuite](../packages/cli/src/lib/eval/tasks.js#L638) 只接收 `builtin`。

**建议交付。** 在现有 runner 上增加插件 suite 加载和版本/digest 绑定，形成“作者生成用例 → 候选运行 → 与关闭插件、基线插件比较 → 审阅报告”的流程。建议入口可采用 `cc plugin eval <path>`，这是拟新增命令，不是当前可执行功能。

报告同时包含正确性、触发率、无关改动、token/成本、耗时和失败轨迹；支持本地 JSON/HTML。默认使用低副作用 fixture，模型 grader 与任务执行成本可见；将评测通过和安全审查分别展示。

**验收。** 在同模型、同 fixture 和同预算下验证候选增益；换模型或插件升级后重跑。至少覆盖“应触发”“不应触发”“插件无增益”“插件降低结果质量”。复用 G02 的严格 gate，不能用 dry-run 宣称效果提升。

### 6.4 G06：增强默认 canonical 中文记忆召回，保持治理过滤

**证据。** [memory-reducer](../packages/context-memory-kernel/lib/memory-reducer.js#L311) 按字母、数字及 `_`、`-` 以外的字符分隔词项；连续中文句子成为一个 token，匹配依赖词项相等，[候选过滤](../packages/context-memory-kernel/lib/memory-reducer.js#L378) 又要求 lexical 得分大于零。[CLI search](../packages/cli/src/lib/context-memory-kernel/memory-service.js#L544) 实际走这一 kernel。

**二次复审限定。** [CLI bin](../packages/cli/bin/chainlesschain.js#L6) 默认选择 `canonical_default`。[legacy SQLite search](../packages/cli/src/lib/memory-manager.js#L117) 已有 `LIKE` 子串匹配，但 [memory 命令](../packages/cli/src/commands/memory.js#L361) 互斥选择 canonical/legacy，不在 canonical 空结果时自动回落；[模型上下文召回](../packages/cli/src/lib/context-memory-kernel/provider-context.js#L103) 也直接交付用户文本给 canonical 路径。因此不能写成“全项目完全不支持中文搜索”，也不能用另一条搜索实现的存在否定这里的召回反例。

本次构造 active 项目记忆 `偏好使用确定性测试`，不添加 tags/summary，保持相同 scope 与允许的 `provider.local` sink：

| 查询                 | 结果数 |
| -------------------- | -----: |
| `偏好使用确定性测试` |      1 |
| `确定性测试`         |      0 |

**建议交付。** 先加入可解释的中文分词或 ngram，建立可靠的词法基线；再根据真实评测增加受治理向量候选与轻量 rerank。所有候选仍经过 scope、sink、tombstone、revision 和敏感级别过滤；新索引不能成为绕过撤销的第二份权威记忆。

**验收。** 建立中英混合检索集，报告 Recall@k/MRR、冲突与过期记忆误召回、删除后再召回、p95 和成本。分别比较词法改进与语义检索的增益，避免为简单查询引入不必要模型调用。

### 6.5 G07：交付可用的沙箱组合，并明确系统支持范围

**当前边界。**

| 路径                       | 当前限制与证据                                                                                                                                                                                    | 优化方向                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Docker/bubblewrap 受控联网 | [agent-sandbox](../packages/cli/src/lib/agent-sandbox.js#L329) 对“网络开启 + 域名 allow/deny”直接拒绝，原因是缺少不可绕过的后端执行边界                                                           | 增加真正执行域名限制的 egress 后端；或提供独立、有限范围的依赖获取任务 |
| Docker 文件隔离            | [同文件](../packages/cli/src/lib/agent-sandbox.js#L353) 对细粒度文件 allow/deny 拒绝并提示 bubblewrap                                                                                             | 明确后端能力选择，配置前检测组合是否可实施                             |
| macOS 严格隔离             | [CI](../.github/workflows/cli-strict-sandbox.yml#L391) 因 `sandbox-exec` 条件固定 `macos-15`；[运行时](../packages/cli/src/lib/process-execution-broker/platform-sandbox.js#L2140) 仍依赖该二进制 | 增加最新目标系统探测和验收；必要时提供替代隔离环境                     |
| Windows 后台落盘           | [平台后端](../packages/cli/src/lib/process-execution-broker/platform-sandbox.js#L4343) 不支持部分 `detached + 数字文件描述符 stdio` 组合                                                          | 使用受控宿主转发日志，验证进程树取消及强退回收                         |

这是“某些策略组合无法执行”的可用性边界。项目已经有真实平台隔离和失败关闭，不能笼统评价为“没有沙箱”或“不安全”。代理环境变量也不能替代域名强制约束。

**验收。** 展示 requested/applied/unsupported；受控联网覆盖域名、IP 直连、DNS、重定向、清空代理环境与子进程；平台报告写明 OS 版本、架构和后端。已有三平台通过记录只能证明对应矩阵，不能外推到未测系统。

### 6.6 G08：让可选澄清与独立工作并行

**已有能力与反证。** [Headless pending Map](../packages/cli/src/runtime/headless-stream.js#L2470) 支持多个挂起问题，[答案处理](../packages/cli/src/runtime/headless-stream.js#L3590) 通过带外通道结算，不进入普通 turn 队列；[WebSocket interaction adapter](../packages/cli/src/lib/interaction-adapter.js#L340) 同样支持多问题。[VS Code question_request](../packages/vscode-extension/src/chat/chat-events.js#L302) 已渲染问题卡片并携带 ID/binding。纯 fake WebSocket 中同时提出两个问题、逆序回答，得到 `pendingBefore:2 / pendingAfter:0`，答案仍正确归属于原问题。

**剩余建议。** [Agent runtime](../packages/cli/src/runtime/agent-core.js#L7251) 的当前工具调用仍 `await interaction.askUser`，回答后才返回；本次未找到该调用主动返回“问题待答”、使同一父 loop 继续独立工作的工具语义。它不表示并行后台子代理全部停止，更不表示没有异步交互。将本项收窄为 P2 的非阻塞澄清体验优化，新增前需跨入口确认用户需求。

**建议交付。** 复用现有问题 ID、binding、解决状态及回答来源，补充非阻塞语义、任务依赖和需要的 revision 失效规则。偏好或补充信息可在独立任务继续时收集；需要授权或决定方案分支的问题仍阻断相应动作。用户的新回答应能使过期计划和批准失效。

**验收。** 新增目标是用户未回答配色时，同一工作流可继续独立读取项目；等待发布授权时仍不能发布。已有“两个问题并行挂起且乱序不串答”作为回归保持项；另外覆盖断线恢复、超时和预选项不产生授权，以及 CLI、IDE、App Server 终态一致性。

### 6.7 G09：将真实模型测试推进到真实部署完整旅程

**已有验证。** [IDE provider 工作流](../.github/workflows/ide-roadmap-live-provider.yml#L88) 在常规路径运行三平台 loopback；[live job](../.github/workflows/ide-roadmap-live-provider.yml#L159) 已提供定时/手动真实 provider 验证，但运行在 Ubuntu，使用配置的 provider/model。

**证据边界。** [旅程脚本](../packages/cli/scripts/ide-roadmap-live-provider-trajectory.mjs#L14) 导入测试 composition，并在 [运行时创建它](../packages/cli/scripts/ide-roadmap-live-provider-trajectory.mjs#L875)。因此其 live 结果可验证真实外部模型和测试治理宿主的结合，不能替代真实签名部署、身份和持久 authority 的完整验收。

**二次复审补充已有窄试点。** 仓库另有 [governed-learning Volcengine pilot](../packages/cli/scripts/governed-learning-volcengine-pilot.mjs#L710)，构造签名 descriptor，并 [注入真实 CLI](../packages/cli/scripts/governed-learning-volcengine-pilot.mjs#L795)，不能将项目测试概括为只有 mock/loopback。脚本 [limitations](../packages/cli/scripts/governed-learning-volcengine-pilot.mjs#L1148) 同时明确：生成与 grader 同模型/provider/主机，authority 临时，signer/witness 同宿主而非生产 KMS/HSM，Windows 使用测试 fsync shim，且不执行晋升或 active deployment。本轮没有重跑该付费模型试点；它是可复用的真实模型与签名 CLI 验证路径，不替代跨故障域及正式部署验收。

IDE 本身也已有真宿主门，不应重建。[VS Code App Server pilot](../packages/vscode-extension/package.json#L582) 默认关闭，[JetBrains 常规会话](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/AgentChatSession.java#L108) 仍使用 CLI stream-json。需要明确两条路径的迁移条件和共享合同，不能仅因存在 pilot 就认定项目落后。

**建议先交付一条纵向旅程：**

```text
公开产物干净安装
    → 配置模型与真实受信宿主
    → 在 IDE 提交一个修复任务
    → 审阅工具请求、改动和测试结果
    → 中断/重连后继续同一任务
    → 导出绑定产物、模型、部署和提交的证据
```

随后选择一个低副作用 Skill，完成真实 baseline/candidate 配对评测、独立 grader、人审、shadow/canary 和 rollback。复用 [目标矩阵评测](../packages/cli/src/lib/evolution/skill-target-matrix-eval.js#L41) 与 [签名报告投影](../packages/cli/src/lib/evolution/wikiskill-benchmark.js#L535)。测试 fixture 中的 [固定 arm 分数](../packages/cli/__tests__/unit/wikiskill-benchmark-execution-host.test.js#L180) 只能验证合同，不能充当学习收益。

**验收。** 证据绑定真实模型、corpus、Skill digest、权限、部署 revision 和精确提交；目标环境身份、签名服务、存储及独立 witness 分别核验。用户能看到“未配置”“测试通过”“真实部署验证通过”三个不同层次。

## 7. P2：产品体验、生态与规模化

### 7.1 G10：测量实际持久路径，再优化容量

| 对象            | 当前实现与限制                                                                                                                                                                                                                            | 应补的测量或工作                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 持久 Memory     | [DurableJsonMemoryPort](../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js#L168) 读取完整 JSON；[query](../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js#L213) 在锁内读取并 clone records           | 1k/10k/100k 持久记录的冷启动、并发读写/删除、锁等待、p95/p99 和峰值内存       |
| Memory 算法基准 | [benchmark](../packages/context-memory-kernel/scripts/context-memory-benchmark.mjs#L5) 使用 InMemoryMemoryPort，另有直接 rank 的容量测试                                                                                                  | 与持久端口基准分列，不用内存算法结果代替磁盘 authority 延迟                   |
| 后台任务列表    | [Supervisor list](../packages/cli/src/lib/background-agent-supervisor.js#L2041) 同步枚举、读取并排序状态 JSON                                                                                                                             | 先测 1k/10k 历史任务，再增加只读索引、分页与归档，保留 lease/CAS              |
| 演化账本        | [v2 backend](../packages/cli/src/lib/evolution/evolution-ledger-v2-manifest-backend.js#L421) 已有 sealed digest segment；[head store](../packages/cli/src/lib/evolution/evolution-ledger-file-manifest-head-store.js#L211) 明确 localOnly | 继续完成 live event payload、批次 finalize 和带恢复日志的迁移，再验证更大规模 |

**容量单位纠正。** [持久端口默认限制](../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js#L24) 为 64 MiB 文件和 100,000 条 **audit events**，不是已承诺支持 100,000 条记忆；[事件上限](../packages/cli/src/lib/context-memory-kernel/durable-memory-port.js#L247) 到达后拒绝提交，更新、删除也消耗事件。表中 1k/10k/100k 是拟测量档位，需记录实际可达范围、配置与拒绝阈值；不能直接用内存算法结果承诺持久容量。

这些源码说明潜在的规模瓶颈，不证明当前用户已经发生卡顿。先提供基线曲线，再决定索引、分段、SQLite 等方案，避免因规模假设更换整个存储系统。

[账本 soak](../packages/cli/scripts/evolution-ledger-reliability-soak.mjs#L274) 明确 `testAuthority:true`、`qualifiesForProduction:false`；既有 10k 测试成果应保留，旧路线中的 250,000-event 目标、磁盘写满、断电和跨故障域 witness 应分别验证。项目也已提供 [appendBatch](../packages/cli/src/lib/evolution/evolution-ledger.js#L4476)，不再把“首次增加 batch API”列为待办。

### 7.2 G11：降低跨设备使用与 IDE 获取成本

**远控已存在。** [远控服务](../packages/cli/src/lib/remote-control.js#L210) 对 LAN 使用显式开关，relay 来自配置，approve scope 需要授权；[VS Code](../packages/vscode-extension/src/remote-control-host.js#L139) 会拒绝展示手机无法访问的 loopback 二维码，并已有可达性说明。下一步应复用现有说明与诊断，测量真实 relay 连通性、网络切换恢复及撤销旅程，再完善跨设备向导；不能将现有二维码说明列为首次新增。

[VS Code Remote Doctor](../packages/vscode-extension/src/remote-doctor.js#L48) 和 [JetBrains RemoteDoctor](../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/RemoteDoctor.java) 也已提供远程桥接诊断。它们侧重 IDE/SSH/WSL 等环境，不能直接替代手机 relay 双设备旅程；应扩展已有诊断，不另建同名模块。

**发布已有门禁。** [IDE 工作流](../.github/workflows/ide-extensions.yml#L638) 已连接真宿主、SSH/container/browser 等验收；[JetBrains 矩阵](../.github/workflows/ide-extensions.yml#L838) 列出三 OS 与指定 IDE 版本。应周期检查当前承诺支持的最新宿主版本是否进入矩阵。

**渠道需要讲清楚。** [官方 VS Code Marketplace](../.github/workflows/ide-extensions.yml#L797) 是显式 dispatch 的 exact-tag backfill，常规 Open VSX 路径与其不同。建议安装页展示各渠道可用版本、推荐 CLI、自动更新方式和最后回读时间。本次未查询线上 listing，不据工作流配置推断商店当前是否有扩展。

**验收。** 新用户按安装页完成一次实际安装；两台设备完成连接、断网重连和撤销；状态与线上产物回读一致。先测成功率和耗时，再确定是否值得增加托管服务或改变发布渠道。

## 8. 90 天建议路线图

以下为建议节奏，实际排期取决于人力、受支持模型与目标部署资源；不代表所有生产基础设施可在固定日期自动完成。

| 阶段        | 重点                             | 交付物                                                            | 退出条件                                               |
| ----------- | -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| 第 1–14 天  | G01、G02                         | readiness 合同、诊断接线、复用 Eval 严格门及执行终态              | 首次运行前置条件明确；缺证据/失败执行不再获正式 PASS   |
| 第 15–30 天 | G03、G05、G06                    | provider profile/首条 Responses 路径、插件作者 Eval、中文召回基线 | 目标模型真实工具往返通过；插件报告可复现；中文反例关闭 |
| 第 31–60 天 | G07、G09                         | 重点沙箱组合、正式产物和真实宿主旅程                              | 指定 OS/IDE 的完整任务、恢复与权限验收通过             |
| 第 61–90 天 | G09 受限试点、G10、G11；按需 G08 | 配对效果、持久容量曲线、远控/安装及非阻塞澄清体验                 | 达到约定正确性和成本要求，具备实际回滚证据             |

G04 不作为默认产品升级的硬依赖；若决定接入 Codex App Server 实验适配器，应在接线前完成失败终态、提交结果不明和指定版本矩阵验收。

每一批都保留独立、可审阅的交付物。基础问答就绪、模型协议兼容、插件作者评测和自动晋升是不同里程碑，不要求用户等待整份演化路线完成才能获得正常 Agent 功能。

## 9. 建议验收标准

### 9.1 功能与证据门

| 领域       | 必须验证                                                               | 不能替代它的结果                           |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| 首次运行   | 干净配置到真实任务；阻断原因跨入口一致                                 | 仅 `--help`、保存 API key 或 bridge READY  |
| 最新模型   | 目标模型的请求参数、工具往返、取消、恢复、usage                        | 模型名出现在下拉框                         |
| Codex 集成 | 区分实际 exec 路径与实验适配器；后者接线前关闭终态/不明提交反例        | 仅安装成功、更新版本白名单或 fake 探针通过 |
| 插件效果   | 同 fixture/model/budget 的对照与重复运行                               | 插件 schema 校验成功                       |
| 回归门     | 基线/任务集合完整、执行成功、产物检查通过，可比性检查通过              | 无历史、删题后 100%、失败终态但产物通过    |
| 记忆       | 中文/英文检索效果和权限、撤销测试同时通过                              | 仅能写入或搜索完整原句                     |
| 沙箱       | 目标 OS 上实际执行策略，拒绝路径有确定原因                             | 配置文件声明、代理环境变量、其他 OS 绿灯   |
| 长任务     | 进程退出、断线、取消、恢复后不重复结算                                 | 单次顺利完成                               |
| 演化       | 真实 grader/authority、配对效果、晋升及回滚证据                        | 固定分数 fixture、论文结果、HOLD 状态      |
| npm 发布   | 同一 release commit 的 CLI CI 与 CLI Strict Sandbox 全部已配置 OS 通过 | 本地测试、旧提交、部分矩阵或超时结果       |

最后一行沿用仓库 [AGENTS.md](../AGENTS.md#L49) 的权威发布要求；本次是审计文档工作，没有执行发布。

### 9.2 做一次公平的三方任务比较

建议先建 30–50 个小规模项目任务：缺陷修复、跨文件重构、测试补齐、长会话恢复、中文要求、插件触发与不触发等。任务规模是试点建议，不是统计充分性证明。

应报告两种实验：同一模型在可支持的运行框架中比较，观察框架与工具影响；各产品推荐配置分别比较，观察实际产品体验。两组不能混成同一个“谁更聪明”的结论。模型无法对齐时明确记录。

固定仓库快照、任务、工具权限、网络、上下文输入、最大成本和时间预算；正确性由外部测试或独立验收判定。记录：

- 任务成功率和无关改动率。
- 首次可运行成功率、首次有用输出时间、完成时间 p50/p95。
- 每个成功任务的 token/成本、缓存命中和重试次数。
- 用户干预次数，分别归因为授权、缺信息、系统故障或工具不支持。
- 中断后恢复成功率和重复副作用次数。

同一任务重复运行，保留逐题结果和不确定性；不要仅用一次平均分宣布全面领先。语义评测与执行正确性分开，真实模型调用成本在运行前设限。

## 10. 不建议照搬的部分

- 不按命令或模块数量定义竞争力。优先关闭首次任务和真实效果链路中的具体问题。
- 不把上游 App Server 的实验功能变成本项目必须依赖的生产控制面。
- 不为减少配置步骤删除治理 ingress，也不为联网方便把代理环境变量当作强制隔离。
- 不因上游发布新模型就只修改默认名称；先完成模型能力、协议和验收证据。
- 不把 Auto Memory、Record & Replay、plugin eval 或模型自评直接等同于生产自动晋升。
- 不在每个入口各写一套 readiness、token 估算或评测状态；复用现有 manifest、kernel、receipt 与部署配置。

## 11. 审计范围与限制

### 11.1 范围

本次重点审计 CLI runtime、外部 Agent adapters、模型与上下文、Memory、Eval、插件、受治理 Evolution、App Server、VS Code/JetBrains 的相关入口及 CI 定义。Desktop 按相关共享路径和发布信息检查；未逐一审计全部桌面页面、移动端、后端服务与区块链模块。

官方资料使用在线实际打开的页面，Codex 部分按 OpenAI Docs 的官方来源核验方式处理。外部产品功能、平台范围与实验性质据此分别标注；未对两家底层模型做编码能力实测，也未做价格/套餐比较。

### 11.2 首轮保留的验证结果

| 检查                                                   | 结果                                              | 能证明什么                                               |
| ------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| `isCodexAppServerVersionCompatible("0.154.0", matrix)` | `false`                                           | 当前 App Server 白名单不含本次最新上游版本               |
| `computeTrend` 空历史及删题输入                        | 均为 `regressed:false`；删题被列入 `newlyMissing` | 通用趋势门的具体证据完整性缺口                           |
| canonical Memory 中文查询                              | 完整句 1 条，句内关键词 0 条                      | 指定 active/scoped/sink 条件下的召回盲点                 |
| CLI 现有定向测试                                       | 3 文件，22 passed，0 failed                       | adapters 和 trend 的已有合同测试通过                     |
| VS Code 现有定向测试                                   | 4 文件，17 passed，0 failed，0 skipped            | pilot、remote host、doctor、readiness 的已有状态逻辑通过 |

首轮本地执行的现有测试命令（不是二次复审重复运行记录）：

```powershell
# 工作目录：packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/codex-app-server-adapter.test.js __tests__/unit/external-agent-adapters.test.js __tests__/unit/eval-trend.test.js

# 工作目录：packages/vscode-extension
node --test test/app-server-pilot.test.cjs test/remote-control-host.test.cjs test/ide-doctor.test.cjs test/runtime-compatibility.test.cjs
```

这 39 项通过不能消除上文缺口：既有测试可以正确验证当前合同，同时未覆盖新增产品要求或正式 gate 的完整性要求。它们也不是三方真实性能比较、真实 IDE 宿主全旅程或生产部署验收。

### 11.3 未验证事项

本次没有运行付费模型对比、配置生产身份/密钥服务、开启自动晋升、执行大规模 soak，或核验当前 SHA 的远端 GitHub Actions 全矩阵及商店产物。引用历史文档中的完成记录时均保留其原提交与范围，不能视为当前所有代码的重新认证。

除 G01 显式标记的工作树修改外，源码链接按本文基线检查；后续或并发修改可能使行号移动。复审过程中其他任务提交了 Android 修复，本报告没有将其冒充本轮成果，也未扩展为移动端全面审计。未来复审应更新基线、对应证据和状态，并保留“已完成、待目标验证、建议新增”的区别。

### 11.4 二次复审证据与结论修订

| 检查                                            | 结果与范围                                             | 对报告的修订                                                          |
| ----------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 正常 CLI 的部署状态、保存模型配置后 `ask/agent` | 未配受信宿主时阻断；网络尝试均为 0                     | G01 增加完整入口证据；不声称已跑 setup/IDE 全旅程                     |
| 未提交 readiness helper                         | `commands:["evolution"]` 也可 `ready:true`             | 记录修复已开始、命令级就绪仍待闭合；不覆盖他人源码                    |
| Eval 真实内置 checker + 虚拟文件系统            | 正确产物配 `ok:false`、抛错、超时失败均可 `pass:true`  | G02 补执行与产物分层，并承认已有 Graph 严格门                         |
| 实验 Codex adapter：服务端先接受、再丢响应      | `upstreamAccepted:1, fallbackCalls:1`                  | 撤回“准入后失败均不会重跑”；接线前必须关闭                            |
| 实验 Codex adapter：官方失败事件形状            | `turn.status:failed` 被投影成 `terminal:completed`     | 补具体协议错误；不推断默认产品已发生事故                              |
| WebSocket 两问题同时挂起、逆序答复              | pending 从 2 到 0，答案归属正确                        | G08 收窄为同一调用 loop 的体验建议，降为 P2                           |
| `eval-runner.test.js`                           | 1 文件、26 passed、exit 0，208.87 秒                   | 原有 no-op/防篡改测试通过，不覆盖新增失败终态反例                     |
| 既有源码反证                                    | 有窗口覆盖、legacy 中文子串、签名 CLI 窄试点及远程诊断 | G03/G06/G09/G11 不再重复建议已有功能；G10 区分 audit event 与记忆数量 |

二次复审补跑命令：

```powershell
# 工作目录：packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/eval-runner.test.js
```

两轮现有定向测试合计 65 项通过，其中首轮 39、二次复审新增 26；不是同一轮完整测试套件。fake client、虚拟文件系统和函数探针仅证明指定输入下的局部行为，不计入上述现有测试数量。CLI 探针使用隔离临时配置且拦截网络，不修改用户配置、不调用付费模型；本轮只将审计结果写入本 Markdown。

## 12. 最终建议

下一轮最值得优先投入的是：**首次任务可运行、最新模型协议适配、可信 Eval 门、插件作者评测、中文记忆召回**。这五项都有明确用户收益和当前代码依据，且可以沿用现有核心组件完成。

ChainlessChain 的可持续差异化方向，是将多模型、本地知识、跨入口协作与受治理 Skill 演化结合，并用真实任务结果证明价值。项目已经具备相当多的实现基础；接下来的里程碑应以“用户完成了什么、在哪个版本和环境通过验证”命名，让工程能力转化为可确认的产品能力。
