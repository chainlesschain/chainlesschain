# 114 可替换模型的类型化 Skill 决策层设计

> 状态：CLI P0 已随 `chainlesschain@0.166.70` 发布，`0.166.71` 增加 Laya 本地模型和通用 System One 提供方，`0.166.72` 修复本地决策截止并收紧离线质量统计；当前公开 CLI `0.166.77` 已将决策 HTTP 请求与响应各限制为 256 KiB，并使未知用量的答案及后续决策模型调用失败闭合。决策模式仍默认关闭。Laya 已完成一次本地 CPU 真实权重冒烟联调，但中文 CLI 请求误路由到英文权重，热请求延迟超出默认截止；TypeSafe 真实 API 与正式质量、延迟、费用评测尚未完成。<br>
> 发行与 CLI 契约核对日期：2026-09-27；原文基线：`main@c036888c3c`；当前主线基线：`main@1777dadc0b`。<br>
> Jev 历史实现提交：`80806fd4e9`；Jev 截止与评测修复发布提交：`5f411309b2`；当前公开 CLI 发布提交：`8d97c58153`。

## 1. 目标与非目标

该模块在既有 Skill 可见性过滤和检索之后增加一个可替换、类型化、可审计的决策层。这里的候选进入范围不等于获得 `run_skill` 执行准入。它只回答两个有界问题：

1. 当前任务是否需要候选 Skill；
2. 如果需要，当前可见候选中哪一个最合适。

决策层不承担复杂规划、代码生成、权限裁决、Skill 安装、发布或执行。即使返回肯定建议，也不能绕过现有 allow-list、兼容性、摘要、撤销、预算、审批和执行边界。

Jev 是初始托管模型实现，不构成决策层的专属模型依赖。CLI `0.166.71` 通过 `typesafe | laya | system-one` 提供方选择支持开源本地部署；更换模型仍使用相同的有界问题、响应校验和审计路径。Laya 等分类决策模型必须实现原生 System One 协议，普通聊天接口不能直接替代。

## 2. 当前发布范围

| 表面                     | 当前状态                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| CLI                      | `0.166.77` 已公开，延续 `off / shadow / suggest` 与三种 provider      |
| Laya / 通用 System One   | CLI 已发布接线；Laya 本地真实权重冒烟已完成，中文路由和正式评测待解决 |
| 会话                     | 仅耐久、单 prompt、headless `cc agent`                                |
| 交互 REPL                | 不支持；非 `off` 会失败闭合                                           |
| `stream-json` 输入       | 不支持；非 `off` 会失败闭合                                           |
| VS Code / JetBrains 对话 | 不直接支持 Jev 模式；IDE 不保存 TypeSafe 凭据                         |
| TypeSafe 真实 API        | provider 已实现，但当前项目尚无生产凭据，未形成真实兼容性或效果报告   |
| 自动 Skill 执行          | 不支持；建议不产生执行权限                                            |

公开发行身份彼此独立：npm CLI 当前为 `0.166.77@8d97c58153`，其中 Jev 修复的首次发行是 `0.166.72@5f411309b2`；Open VSX `0.37.118@a7d582cd89` 已公开并推荐 CLI `0.166.77`。JetBrains Marketplace 当前公开 `0.4.138@f88fb58fc3`，推荐 CLI `0.166.76`；`0.4.139@a7d582cd89` 已成功上传并推荐 CLI `0.166.77`，但公开列表尚未回读到该版。Microsoft VS Code Marketplace 未发布。上述后续版本不扩大 Jev 的 headless 接入范围，精确发行证据见[2026-09-26 运行时增量设计](../agent-runtime-update-2026-09-26.md)。

官网发布页与本设计共用上述制品边界；本次文档同步未产生新的 CLI、IDE 或 Desktop 制品。[CLI 官网](https://www.chainlesschain.com/cli)与[IDE 官网](https://www.chainlesschain.com/ide)展示的是已公开版本，部署站点不代表扩大决策层的运行范围。

## 3. 数据流与所有权

```text
用户任务
  -> 既有 Skill 目录 / allow-list / 兼容性 / 撤销检查
  -> 既有检索器生成候选和 selectedDigest
  -> 最多 5 个当前可见候选的有界摘要
  -> 提供方中立的决策 Runtime
       -> TypeSafe / Laya / 通用 System One provider
       -> POST /v1/systemone（state / questions）
       -> 本地答案、候选集、概率和模型字段校验；本地调用截止
       -> 模型用量账本事件；启用时接入会话预算
       -> skill_decision_observation 持久事件
  -> shadow: 不改变 Agent 可见路由
  -> suggest: 仅附加 routing.decisionSuggestion
```

既有检索器始终拥有原始 `selectedDigest`。决策层不能替换该字段，也不能调用 `run_skill`。`suggest` 只是增加有界元数据；后续是否使用某个 Skill 仍由 Agent 和原有治理链决定。

当前唯一接入点是 Agent 的带 `query` 的 `list_skills`：目录、allow-list 和工作目录先过滤，检索器再排序并处理此入口的撤销/兼容性条件，决策运行时只接收前五个候选；无 `query` 或无候选时不会请求模型。检索器在此入口仅收到操作系统目标，不能把它支持的全部可选 capability/path 检查视为已执行。工具返回的原始候选列表及检索器选中项保持原样。候选建议仅出现在 `routing.decisionSuggestion`，不是工具调用参数，也不代表 Agent 实际采纳。当前接入没有覆盖普通 `cc skill` 列表、每个 Agent turn 或 IDE 对话。

## 4. 运行模式

| 模式      | 网络调用 | 持久观察 | Agent 可见     | 改变执行 |
| --------- | -------- | -------- | -------------- | -------- |
| `off`     | 否       | 否       | 否             | 否       |
| `shadow`  | 是       | 是       | 否             | 否       |
| `suggest` | 是       | 是       | 是，仅附加建议 | 否       |

默认模式必须保持 `off`。`shadow` 也会调用所选服务、处理数据并消耗推理资源，因此与 `suggest` 使用相同的凭据隔离、截止时间、取消与用量账本边界；若启用会话预算，两种模式均受它约束。耐久会话本身不会自动启用会话硬预算，本地运行也不应被解释为零费用或可省略 usage。

## 5. CLI 契约

已发布的 Jev 兼容用法：

```powershell
$env:TYPESAFE_API_KEY = "<secret>"
cc agent --session jev-pilot-1 --decision-mode shadow -p "检查并修复单元测试"
```

| 参数                    | 默认值       | 约束                                                                                         |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `--decision-mode`       | `off`        | `off`、`shadow`、`suggest`                                                                   |
| `--decision-provider`   | `typesafe`   | `typesafe`、`laya`、`system-one`                                                             |
| `--decision-model`      | 按提供方选择 | TypeSafe 为 `jev-latest`；Laya 为 `laya`；通用服务必须显式指定                               |
| `--decision-base-url`   | 按提供方选择 | TypeSafe 为 `https://api.typesafe.ai`；Laya 为 `http://127.0.0.1:8000`；通用服务必须显式指定 |
| `--decision-timeout-ms` | `800`        | 整数 `50..30000`；约束 provider 调用，不含前后持久化与结果校验                               |

上述多提供方参数已随 npm `0.166.71` 公开，`0.166.72` 延续支持；安装后可以运行：

```powershell
cc agent --session laya-pilot-1 --decision-provider laya --decision-mode shadow -p "检查并修复单元测试"
cc agent --session local-decision-1 --decision-provider system-one --decision-model my-local-router --decision-base-url http://127.0.0.1:9000 --decision-mode shadow -p "检查并修复单元测试"
```

非 `off` 模式必须使用 `--session`、`--resume` 或 `--continue` 所代表的耐久会话，不能与 `--ephemeral` 组合。TypeSafe 必须使用 `TYPESAFE_API_KEY` 或对应受管 credential transport；Laya 和通用 System One 只读取可选的 `DECISION_API_KEY`，不会回退到 TypeSafe 凭据。所有提供方都不提供命令行 key 参数。

Laya 只接受 loopback 地址；TypeSafe 与通用 System One 接受 HTTPS 或 loopback。base URL 为服务根地址，provider 追加 `/v1/systemone`。通用提供方必须显式指定地址和模型，避免意外发送到默认云端。

### 5.1 Laya 服务与模型限制

[Laya 官方代码](https://github.com/NandhaKishorM/laya)与 [Hugging Face 权重](https://huggingface.co/convaiinnovations/laya)采用 Apache-2.0。根目录英文模型约 421M 参数、512 tokens；[多语言模型](https://huggingface.co/convaiinnovations/laya-multilingual)约 322M 参数、默认 1024 tokens，包含中文。不同语言和模型版本需要各自评测，不沿用 Jev 的效果结论。

第三方 [laya-serve](https://github.com/stiermid/laya-serve) 可暴露兼容端点，但默认后端为 `fake`，必须显式设置 `LAYA_SERVE_BACKEND=laya`，并通过 Uvicorn 绑定 `127.0.0.1`。用户指南采用预加载权重以避开首请求加载成本；[本地冒烟](../../research/agents/jev-laya-local-probe-2026-09-23.md)使用 `LAYA_SERVE_PRELOAD=false`，证明预加载不是协议必需条件。其 Router 自动选择语言；服务 model 别名不能作为实际载入权重的证明。首次运行下载依赖和权重，离线运行需准备本地缓存。

CLI 的字符级有界摘要不等于满足模型的 token 上限。较长中文任务和五个候选可能被上游截断，需要在真实模型上检查保留信息、候选召回、概率校准和延迟。开发时增加 timeout 不能视为已满足正式评测门槛。当前没有把 Laya 上游 benchmark 作为本项目验证结果。

[2026-09-23 本地真实权重冒烟记录](../../research/agents/jev-laya-local-probe-2026-09-23.md)显示：完整 CLI `state` 中的英文候选元数据会使短中文任务被上游 Router 判为英文，载入英文 checkpoint。此 CPU 环境的完整请求热路径约 7–11 秒；仅中文任务文本能触发多语言权重，但改变了 CLI 请求格式，单题结果也不能证明质量。服务返回的模型标签不区分这两种实际权重。默认 800 ms 截止因此仍应失败闭合，不能据此启用 `suggest`。

## 6. 请求与响应绑定

CLI 在本地构造的 `chainlesschain.skill-decision-request/v1` 绑定以下身份：

- tenant、session、turn 与 context revision；
- 有序候选集合及每个候选的内容摘要，形成 `candidateSetDigest`；
- `policyDigest`、请求摘要 `requestDigest` 与 `decisionId`。

本地候选 ID 按检索顺序生成 `c1..c5`，与 Skill ID 和摘要的映射留在 CLI。当前入口每次最多发送五个当前可见候选；契约层容许至多八个，但不是 CLI 当前配置。外发 `state` 含最多 4096 字符的任务查询以及候选名称、描述、类别和标签，不包含 Skill 正文、仓库文件或会话全文。每条描述在本地最多 16384 字符，`state` 的 UTF-8 序列化上限为 96 KiB；`choice.criteria` 又会引用描述。CLI `0.166.77` 在最终 `{model, state, questions}` JSON 序列化后限制为 256 KiB UTF-8，超限不发起 `fetch`。这些是字符/字节保护，不是模型 token 上限，也不保证 Laya 不截断。

同一请求固定提出 `needs_skill`（Noul）、`best_skill`（含 `none` 的 Choice）和每个候选的 `fits_cN`（Noul），合计候选数加两个问题。`none` 表示模型明确判断全部候选不适合；`abstain` 表示证据不足；`unavailable` 表示本次调用未得到可用判断，三者不能合并统计。

网络协议使用 `POST /v1/systemone`，请求体只有 `model`、`state` 和 `questions`，响应读取类型化 `answers`、`usage` 与模型标签。它不是 `/v1/chat/completions`；其他开源模型需要提供此协议的服务适配层才能接入。CLI 校验答案键与问题一一对应、类型和候选 ID，要求概率为 `[0, 1]` 内有限数，Choice 分布覆盖所有候选及 `none`，总和与 1 的差不超过 `0.02`。模型输出始终按不可信响应处理，候选之外的选项不得扩展本地权限。

当前传输**不会**把 `decisionId`、`requestDigest`、tenant/session、候选摘要、策略版本或 deadline 发给服务，也不要求服务回显。因此请求绑定和结果摘要是 CLI 本地审计绑定，不能声称已由远端回显证明防重放；服务若对另一请求返回同形答案，现有协议无法单靠响应区分。当前入口的 `contextRevision` 是固定标识，未提供实时上下文版本；调用方未传入 `policyDigest` 时使用静态默认摘要，它不能证明撤销或策略状态仍是最新。当前 HTTP 调用由本地 `AbortSignal` 控制截止，并在拿到响应后按当次候选集合校验。若未来要跨进程复用、缓存或让服务参与防重放，须版本化扩展传输与回执，要求服务回显请求摘要并验证时限、tenant 与模型身份；在此之前维持不缓存、不开启自动执行。

当前模型字段只作有界字符串校验，不要求响应标签等于请求别名，也不证明服务实际载入了指定权重；会话观察和账本记录配置的模型名。Laya 服务即使路由到多语言权重，也可能返回默认 `laya-english` 标签。正式评测须在服务端固定、核验并记录实际 checkpoint，不能以 API 标签替代模型身份验证。

### 6.1 出口与凭据边界

当前 provider 由 CLI 宿主创建并直接通过 `fetch` 发送固定投影 `{model, state, questions}`，使用 `AbortSignal`，且禁止 HTTP 重定向。配置阶段只允许 TypeSafe/通用服务使用 HTTPS 或 loopback，Laya 限 loopback；通用服务仍需显式选择地址和模型。TypeSafe 凭据与本地/通用服务的可选凭据分别读取，Bearer 头只交给所选 provider，观察与用量事件不保存密钥。地址校验发生在配置阶段；本地审计摘要不等于网络出口已受 `agent-evolution-ingress` 准入。CLI `0.166.77` 对最终请求 JSON 限制 256 KiB，并在真实 Fetch 响应流解析 JSON 前限制 256 KiB，超限取消读取且不返回模型答案。注入的测试 transport 若只提供 `json()` 而没有响应流，则在解析后校验序列化大小；它不是生产 Fetch 的流读取路径。

这条决策调用目前没有接入 `agent-evolution-ingress` 的 `prepareModelRequest()`、外发证据投影和准入回读；现有模型投影接受聊天消息与工具，不接受原生 `state + questions`。因此，本地请求摘要、会话用量事件和 `skill_decision_observation` 不能被描述为已经完成同一 `EvolutionRun` 的受治理模型入口。要将决策层纳入要求该入口的部署，需先增加类型化请求投影，绑定**最终外发字节**、tenant、策略和目标 endpoint，并在准入回读成功后发送；拒绝或证据持久化失败必须在网络前终止，不能回退到直连 `fetch`。这属于后续工程门，不改变当前默认关闭的 CLI 试点事实。

### 6.2 建议判定与 Agent 可见字段

当前运行时的三个本地阈值均默认为 `0.5`，依次按下表判定；阈值是工程试点值，不能作为跨模型校准结论。`best_skill.confidence` 使用 Choice 答案自己的字段，不把 Noul 概率改名为统一置信度。

| 判定顺序 | 条件                                       | 状态与原因码                                    |
| -------- | ------------------------------------------ | ----------------------------------------------- |
| 1        | `needs_skill.noul < needsSkill`            | `no-match` / `needs-skill-below-threshold`      |
| 2        | `best_skill.choice === "none"`             | `no-match` / `choice-none`                      |
| 3        | `best_skill.confidence < choiceConfidence` | `abstain` / `choice-confidence-below-threshold` |
| 4        | 选中候选的 `fits_cN.noul < candidateFit`   | `abstain` / `candidate-fit-below-threshold`     |
| 5        | 上述条件均不成立                           | `suggestion` / `accepted`                       |

只有 `suggestion` 会填充 `selectedDigest` 和 `selectedSkillId`；`no-match`、`abstain`、`unavailable` 的选中项均为 `null`。`suggest` 模式仍会将这四类状态连同原因码、`needsSkillProbability`、`choiceConfidence`、`decisionId` 和 `receiptRef` 附加给 Agent，供其识别明确无匹配和服务故障；`shadow` 仅写观察事件，不附加字段。Agent 看到的建议没有执行权，消费前仍应核对最新准入、撤销和摘要。

## 7. 预算、取消与失败语义

- 初始工程限制为每次带查询的 `list_skills` 最多一次决策请求、最多五个候选，provider 调用默认在 800 ms 后发出取消信号。此截止从用量 started 持久化后才建立，不覆盖检索、账本写入、响应校验和观察写入，也不是端到端 800 ms 硬上界。
- 请求沿用 durable session 的预算和取消信号，并以 `source=model`、`operationId=decision:<decisionId>` 进入模型用量账本。调用前持久化 `model_usage_started`；成功时校验并持久化 `token_usage`，调用失败或缺少有效用量时持久化 `model_usage_unknown`，不能将未知用量填零。
- 账本写入失败、会话预算终止和用户取消保持终止性，不能被包装成普通“无建议”。
- 普通 provider 故障、超时或响应无效在账本与预算未触发终止错误时，不会改变既有 Skill 路由；观察中保留稳定原因码供离线分析。
- P0 不启用应用级决策缓存。未来缓存必须绑定 tenant、候选顺序、模型、模板、策略/撤销版本和阈值版本，并在命中后重新执行准入检查。

失败发生的阶段决定是否已有网络调用和观察事件。`model_usage_started` 持久化失败时调用不会发出；请求已发出后若 provider 失败或超时，账本写 `model_usage_unknown`，若预算未因此终止，正常写入观察后以 `unavailable` 返回。答案结构无效是在用量结算之后发现的：若服务带有效 usage，账本可已有 `token_usage`，随后仍记录 `unavailable`，不能把它改写成未知用量。会话预算拒绝、用户取消或任一账本写入失败属于终止错误，不生成可消费的决策结果；观察写入失败同样终止，已发生的外发和用量不会因此回滚。调用前已取消时不会写 started；调用中取消时可能已有 started 和 unknown。只有完成观察持久化后才会返回 `receiptRef` 和 `suggest` 可见字段。

当前 `skill_decision_observation` 为 `chainlesschain.skill-decision-observation/v1`，记录 `decisionId`、模式、tenant/session/turn、请求和候选集摘要、配置的 provider/model、状态、原因码、选中摘要、结果摘要、起止时间、延迟与 `observationDigest`。它不保存任务原文、候选描述、API key 或完整模型答案。`receiptRef` 指向该观察摘要；用量由同一持久会话的独立账本事件记录，而不是嵌入观察事件。观察写入失败也按持久化错误终止调用。

未知用量是独立账本状态；是否终止还取决于会话预算宿主的 unknown-settlement 策略。CLI 不指定 `--session-budget` 或 `--session-max-*` 时默认没有该预算根。CLI `0.166.77` 让直接调用包装器在账本持久化后向决策运行时返回 `known / unknown` 结算状态：缺失或畸形 usage 已写 `model_usage_unknown` 时，结果只形成 `unavailable / provider-usage-unknown` 观察，选中项和结果摘要均为空，不成为 Skill 建议；启用预算根时原有终止错误仍优先传播。任一决策调用持久化 `model_usage_unknown` 后，同一运行时后续查询只写 `unavailable / provider-usage-unknown-blocked` 观察而不请求 provider；恢复 headless 会话时也从已验证的历史事件检查 `decision:` 用量边界并初始化该阻断。真实 JSONL 集成测试已证明正常恢复时不再次调用决策 provider，篡改记录时在模型调用前拒绝恢复。并发中已经发出的调用无法追溯取消；阻断只覆盖此决策 provider，不是主 Agent 的全会话费用熔断。受控 `suggest` 放量前仍须以预算根和异常退出测试证明预算终态、跨进程后续调用限制，并将 observation 与账本事件按 `decisionId`/`operationId` 关联复核。

## 8. IDE 边界

当前公开的 Open VSX `0.37.118` 与 JetBrains `0.4.138` 不直接接入 Jev 对话；已上传待公开的 JetBrains `0.4.139` 同样不接入。IDE 只携带 CLI 配套版本与能力边界说明：

- IDE Webview/JCEF 不读取、保存或转发 `TYPESAFE_API_KEY`；
- 交互 IDE 会话不会自动添加 `--decision-mode`；
- IDE 不获得 Skill 路由、加载、执行或发布 authority；
- CLI 未来扩大任一决策模型的使用范围时，仍需单独设计协议、设置、凭据和真实宿主门，不能把当前 headless 接线外推到 IDE。

## 9. 评测与放量门

本地 Laya 冒烟只证明协议与单题行为；当前没有本项目真实 Jev、Laya 或其他模型的统计效果与成本结论。进入受控 `suggest` 前，至少冻结 400 条开发/校准任务和 400 条测试任务，其中测试集至少包含 160 条“无需/无匹配 Skill”任务，并为每个提供方、模型版本和部署环境预注册以下门槛：

CLI 已提供显式 `--decision-mode suggest` 开关，但运行时不会读取离线 benchmark 报告来自动批准放量。下表是部署/实验准入门，不应把开关可用或单份报告 `passed` 当作门槛已满足。

| 门槛         | 要求                                                 |
| ------------ | ---------------------------------------------------- |
| 治理不变量   | 未授权、撤销、跨租户、未结算结果等对抗测试全部通过   |
| 候选召回     | Recall@K ≥ 95%；不足时先修召回                       |
| 无匹配误建议 | 单侧 95% 二项置信上界 ≤ 2%                           |
| 接受建议错误 | 单侧 95% 置信上界 ≤ 5%，肯定建议覆盖率 ≥ 50%         |
| 端到端效果   | 实际误调用点估计相对下降 ≥ 20%，配对区间支持改善     |
| 任务成功率   | 95% 置信下界不低于基线 -1 个百分点                   |
| 延迟         | 增量 p95 ≤ 500 ms，单次总截止 ≤ 800 ms               |
| 费用         | 每成功任务总费用不高于基线 5%，且不超会话/每日硬预算 |

表中的单次总截止是未来放量门槛；当前 `--decision-timeout-ms=800` 只约束 provider 调用，两者不能直接等同。`shadow` 只能证明建议、弃权、稳定性和额外开销，不能证明 Agent 采用建议后的任务效果。线上放量前还需隔离端到端试验和小流量复核。

冻结任务按会话、来源或模板分组切分，避免同题改写同时进入校准集和测试集；标签允许多个可接受摘要、空集合及无法裁定，争议由独立标注者复核。分别报告中文、英文、无匹配、相近技能和候选遗漏切片。候选召回以“真值技能进入检索候选”的任务为分子、所有有可接受 Skill 的任务为分母；已给出肯定建议的错误率以实际肯定建议数为分母；无匹配误建议率以真值为空的任务数为分母。现有离线 benchmark 要求 `acceptableDigests` 属于传入候选，不能测候选遗漏或单独证明 Recall@K；召回须从检索前真值和检索输出另算。隔离端到端对照需固定候选、主模型、工具版本和预算，独立验收任务成功，按任务或会话分组估计效果区间，避免把模型建议正确率当作实际误调用下降。

CLI 的离线 benchmark 报告 `v2` 同时保留逐题结果、分母/错误数和接受建议错误率、无匹配误建议率的单侧 95% 精确二项上界。零个已接受建议或零个无匹配样本时，对应上界为 `null`，本地质量判定不能通过。报告的 `passed` 只检查传入阈值对应的这两项上界、肯定建议覆盖率和该 benchmark 测量边界内的 p95；它不代表达到本节的冻结样本规模、候选召回、端到端效果、任务成功率、总费用或治理放量门。

## 10. 代码与验证

核心实现：

- `packages/cli/src/lib/decision-layer/contracts.js`
- `packages/cli/src/lib/decision-layer/provider-authority.js`
- `packages/cli/src/lib/decision-layer/providers.js`
- `packages/cli/src/lib/decision-layer/typesafe-provider.js`
- `packages/cli/src/lib/decision-layer/runtime.js`
- `packages/cli/src/lib/decision-layer/benchmark.js`
- `packages/cli/src/lib/direct-model-usage.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/runtime/headless-runner.js`

单元测试覆盖契约、provider、runtime、benchmark、Agent `list_skills` 和 headless 接线；另验证请求预检、分块响应超限取消、声明长度超限拒绝、真实 loopback HTTP 超限响应、缺失/畸形 usage 的失败闭合，以及同一运行时和恢复的注入会话不再调用决策 provider。真实 JSONL 集成测试覆盖未知决策用量后的恢复阻断与篡改记录的恢复拒绝，使用隔离的临时 CLI home 和安全锚目录。CLI `0.166.72@5f411309b2` 首次发行了多提供方接线、本地截止失败闭合与离线统计修复；当前公开的 `0.166.77@8d97c58153` 已在其精确提交上通过 Linux、Windows、macOS 的 CLI CI 与 CLI Strict Sandbox，并完成 npm OIDC/provenance 和公共制品回读，覆盖本节的报文与用量修复。这些发行门证明代码与制品一致，不证明模型效果合格。后续 npm 发布仍须在新版本精确提交上重新通过两个工作流的全部操作系统矩阵。模拟 System One 服务的测试只证明协议与失败闭合；本地单题真实权重冒烟仍不能替代冻结数据集模型评测。

在 `packages/cli` 运行定向回归可用 `npm.cmd test -- __tests__/unit/decision-layer-contracts.test.js __tests__/unit/decision-layer-providers.test.js __tests__/unit/decision-layer-typesafe-provider.test.js __tests__/unit/decision-layer-runtime.test.js __tests__/unit/decision-layer-benchmark.test.js __tests__/unit/direct-model-usage.test.js __tests__/unit/agent-core-skill-decision.test.js __tests__/unit/headless-skill-decision.test.js __tests__/integration/headless-decision-usage-resume.test.js`。它覆盖本地契约与失败路径，不会调用真实 TypeSafe/Laya 服务。

### 10.1 下一轮工程与验收

| 工作项           | 当前依据                                                                                      | 完成条件                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 受治理类型化出口 | 决策 provider 当前直接 `fetch`，聊天模型投影不覆盖 `state + questions`                        | 最终外发字节先投影、准入并回读；拒绝及持久化失败时无网络请求；真实宿主回归覆盖         |
| 用量闭合         | CLI `0.166.77` 已阻断未知用量的建议与同会话后续决策 provider 调用；真实 JSONL 恢复和篡改拒绝测试已通过 | 异常退出/预算根验证及账本与观察关联；全会话费用仍由预算根约束 |
| 全程截止         | 当前 800 ms 只覆盖 provider 调用                                                              | 从查询到观察写入测量增量延迟；慢 started、网络和慢观察均纳入截止/迟到建议测试          |
| 报文大小         | CLI `0.166.77` 已对最终请求 JSON 与响应流设 256 KiB 上限，并通过 loopback HTTP 回归及三平台发行门 | 继续监测真实服务对边界报文的兼容性 |
| 请求新鲜度       | `contextRevision` 固定、默认 `policyDigest` 静态，服务不回显绑定                              | 消费建议前复核实时候选摘要、撤销和策略；若跨进程复用，增加版本化请求回显和过期拒绝测试 |
| 模型适配         | Laya 中文 CLI 输入误路由，完整请求超过默认截止                                                | 固定并记录实际 checkpoint；按真实 tokenizer 验证完整请求、截断、语言路由与冷/热延迟    |
| 效果资格         | TypeSafe 真实 API 与冻结数据集报告缺失                                                        | 各提供方按第 9 节独立完成校准、冻结测试、隔离端到端对照及小流量复核                    |

这些项目均未因文档补全而变成已发布能力。凡修改 CLI/npm 制品，仍按本仓库发布门在新精确提交上核对完整工作流矩阵。

## 11. 相关文档

- [可行性研究与评测方案](../../research/agents/jev-decision-layer-feasibility-2026-09-22.md)
- [Laya 本地真实权重联调记录](../../research/agents/jev-laya-local-probe-2026-09-23.md)
- [Jev、Laya 与本地模型决策层用户指南](../../../docs-site/docs/chainlesschain/jev-decision-layer.md)
- [模块 106：Agent Kernel](106_Agent_Kernel设计.md)
- [模块 110：发布与证据边界](110-agent-platform-release-boundaries.md)
- [模块 112：受治理 Skill 演进](112-governed-skill-evolution-design.md)
- [2026-09-26 Agent 运行时与发行证据](../agent-runtime-update-2026-09-26.md)
