# 114 可替换模型的类型化 Skill 决策层设计

> 状态：CLI P0 已随 `chainlesschain@0.166.70` 发布，`0.166.71` 已公开 Laya 本地模型和通用 System One 提供方，`0.166.72` 修复本地决策截止并收紧离线质量统计；默认关闭。Laya 已完成一次本地 CPU 真实权重冒烟联调，但中文 CLI 请求误路由到英文权重，热请求延迟超出默认截止；TypeSafe 真实 API 与正式质量、延迟、费用评测尚未完成。<br>
> 核对日期：2026-09-23<br>
> Jev 历史实现提交：`80806fd4e9`；当前 CLI 发布提交：`5f411309b2`；IDE 配套源码提交：`94c4c5a634`。

## 1. 目标与非目标

该模块在既有 Skill 检索和准入之后增加一个可替换、类型化、可审计的决策层。它只回答两个有界问题：

1. 当前任务是否需要候选 Skill；
2. 如果需要，已准入候选中哪一个最合适。

决策层不承担复杂规划、代码生成、权限裁决、Skill 安装、发布或执行。即使返回肯定建议，也不能绕过现有 allow-list、兼容性、摘要、撤销、预算、审批和执行边界。

Jev 是初始托管模型实现，不构成决策层的专属模型依赖。CLI `0.166.71` 通过 `typesafe | laya | system-one` 提供方选择支持开源本地部署；更换模型仍使用相同的有界问题、响应校验和审计路径。Laya 等分类决策模型必须实现原生 System One 协议，普通聊天接口不能直接替代。

## 2. 当前发布范围

| 表面                     | 当前状态                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| CLI                      | `0.166.72` 已公开，支持 `off / shadow / suggest` 与三种 provider      |
| Laya / 通用 System One   | CLI 已发布接线；Laya 本地真实权重冒烟已完成，中文路由和正式评测待解决 |
| 会话                     | 仅耐久、单 prompt、headless `cc agent`                                |
| 交互 REPL                | 不支持；非 `off` 会失败闭合                                           |
| `stream-json` 输入       | 不支持；非 `off` 会失败闭合                                           |
| VS Code / JetBrains 对话 | 不直接支持 Jev 模式；IDE 不保存 TypeSafe 凭据                         |
| TypeSafe 真实 API        | provider 已实现，但当前项目尚无生产凭据，未形成真实兼容性或效果报告   |
| 自动 Skill 执行          | 不支持；建议不产生执行权限                                            |

公开发行身份彼此独立：npm CLI 为 `0.166.72@5f411309b2`；Open VSX `0.37.114@94c4c5a634` 已公开；JetBrains `0.4.135@94c4c5a634` 已上传并通过发行门，当前公开 listing 仍为 `0.4.133`。Microsoft VS Code Marketplace 未发布。

## 3. 数据流与所有权

```text
用户任务
  -> 既有 Skill 目录 / allow-list / 兼容性 / 撤销检查
  -> 既有检索器生成候选和 selectedDigest
  -> 最多 5 个已准入候选的有界摘要
  -> 提供方中立的决策 Runtime
       -> TypeSafe / Laya / 通用 System One provider
       -> POST /v1/systemone（state / questions）
       -> 响应 schema、候选集、概率、模型字段格式、时限与用量校验
       -> 会话预算与模型用量账本结算
       -> skill_decision_observation 持久事件
  -> shadow: 不改变 Agent 可见路由
  -> suggest: 仅附加 routing.decisionSuggestion
```

既有检索器始终拥有原始 `selectedDigest`。决策层不能替换该字段，也不能调用 `run_skill`。`suggest` 只是增加有界元数据；后续是否使用某个 Skill 仍由 Agent 和原有治理链决定。

## 4. 运行模式

| 模式      | 网络调用 | 持久观察 | Agent 可见     | 改变执行 |
| --------- | -------- | -------- | -------------- | -------- |
| `off`     | 否       | 否       | 否             | 否       |
| `shadow`  | 是       | 是       | 否             | 否       |
| `suggest` | 是       | 是       | 是，仅附加建议 | 否       |

默认模式必须保持 `off`。`shadow` 也会调用所选服务、处理数据并消耗推理资源，因此与 `suggest` 使用相同的凭据隔离、预算、截止时间、取消与用量结算边界。本地运行不代表绕过会话预算或省略 usage。

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
| `--decision-timeout-ms` | `800`        | 整数 `50..30000`                                                                             |

上述多提供方参数已随 npm `0.166.71` 公开，`0.166.72` 延续支持；安装后可以运行：

```powershell
cc agent --session laya-pilot-1 --decision-provider laya --decision-mode shadow -p "检查并修复单元测试"
cc agent --session local-decision-1 --decision-provider system-one --decision-model my-local-router --decision-base-url http://127.0.0.1:9000 --decision-mode shadow -p "检查并修复单元测试"
```

非 `off` 模式必须使用 `--session`、`--resume` 或 `--continue` 所代表的耐久会话，不能与 `--ephemeral` 组合。TypeSafe 必须使用 `TYPESAFE_API_KEY` 或对应受管 credential transport；Laya 和通用 System One 只读取可选的 `DECISION_API_KEY`，不会回退到 TypeSafe 凭据。所有提供方都不提供命令行 key 参数。

Laya 只接受 loopback 地址；TypeSafe 与通用 System One 接受 HTTPS 或 loopback。base URL 为服务根地址，provider 追加 `/v1/systemone`。通用提供方必须显式指定地址和模型，避免意外发送到默认云端。

### 5.1 Laya 服务与模型限制

[Laya 官方代码](https://github.com/NandhaKishorM/laya)与 [Hugging Face 权重](https://huggingface.co/convaiinnovations/laya)采用 Apache-2.0。根目录英文模型约 421M 参数、512 tokens；[多语言模型](https://huggingface.co/convaiinnovations/laya-multilingual)约 322M 参数、默认 1024 tokens，包含中文。不同语言和模型版本需要各自评测，不沿用 Jev 的效果结论。

第三方 [laya-serve](https://github.com/stiermid/laya-serve) 可暴露兼容端点，但默认后端为 `fake`，必须显式设置 `LAYA_SERVE_BACKEND=laya`，预加载权重，并通过 Uvicorn 绑定 `127.0.0.1`。部署命令见用户指南。其 Router 自动选择语言；服务 model 别名不能作为实际载入权重的证明。首次运行下载依赖和权重，离线运行需准备本地缓存。

CLI 的字符级有界摘要不等于满足模型的 token 上限。较长中文任务和五个候选可能被上游截断，需要在真实模型上检查保留信息、候选召回、概率校准和延迟。开发时增加 timeout 不能视为已满足正式评测门槛。当前没有把 Laya 上游 benchmark 作为本项目验证结果。

[2026-09-23 本地真实权重冒烟记录](../../research/agents/jev-laya-local-probe-2026-09-23.md)显示：完整 CLI `state` 中的英文候选元数据会使短中文任务被上游 Router 判为英文，载入英文 checkpoint。此 CPU 环境的完整请求热路径约 7–11 秒；仅中文任务文本能触发多语言权重，但改变了 CLI 请求格式，单题结果也不能证明质量。服务返回的模型标签不区分这两种实际权重。默认 800 ms 截止因此仍应失败闭合，不能据此启用 `suggest`。

## 6. 请求与响应绑定

决策请求绑定以下身份：

- tenant、session、turn 与 context revision；
- 有序候选集合及每个候选的 canonical digest；
- 决策策略、问题模板和模型身份；
- deadline、请求摘要与 operation id。

provider 只发送有界任务查询和最多五个已经准入的 Skill 摘要。响应必须通过类型、概率范围、概率和、候选身份、模型字段格式、deadline 与 usage 校验；未知候选、跨请求重放、迟到响应、畸形概率和未结算结果均不能成为可见建议。

网络协议使用 `POST /v1/systemone`，请求体包含 `model`、`state` 和 `questions`，响应携带类型化 `answers`、有效 `usage` 与模型标签。它不是 `/v1/chat/completions`；其他开源模型需要提供此协议的服务适配层才能接入。模型输出始终按不可信响应处理，服务端返回候选之外的选项不得扩展本地权限。

当前模型字段只作有界字符串校验，不要求响应标签等于请求别名，也不证明服务实际载入了指定权重；会话观察和账本记录配置的模型名。Laya 服务即使路由到多语言权重，也可能返回默认 `laya-english` 标签。正式评测须在服务端固定、核验并记录实际 checkpoint，不能以 API 标签替代模型身份验证。

## 7. 预算、取消与失败语义

- 初始工程预算为每次 Skill 查询最多一次决策请求、最多五个候选、默认总截止 800 ms。
- 请求沿用 durable session 的预算和取消信号，并以 `operationId=decision:<id>` 进入模型用量账本。
- 账本写入失败、会话预算终止和用户取消保持终止性，不能被包装成普通“无建议”。
- provider 不可用、超时或响应无效时不会改变既有 Skill 路由；观察中保留稳定原因码供离线分析。
- P0 不启用应用级决策缓存。未来缓存必须绑定 tenant、候选顺序、模型、模板、策略/撤销版本和阈值版本，并在命中后重新执行准入检查。

## 8. IDE 边界

VS Code `0.37.114` 已公开，JetBrains `0.4.135` 已上传待公开；两端只携带 CLI 配套版本与能力边界说明：

- IDE Webview/JCEF 不读取、保存或转发 `TYPESAFE_API_KEY`；
- 交互 IDE 会话不会自动添加 `--decision-mode`；
- IDE 不获得 Skill 路由、加载、执行或发布 authority；
- CLI 未来扩大任一决策模型的使用范围时，仍需单独设计协议、设置、凭据和真实宿主门，不能把当前 headless 接线外推到 IDE。

## 9. 评测与放量门

本地 Laya 冒烟只证明协议与单题行为；当前没有本项目真实 Jev、Laya 或其他模型的统计效果与成本结论。进入受控 `suggest` 前，至少冻结 400 条开发/校准任务和 400 条测试任务，其中测试集至少包含 160 条“无需/无匹配 Skill”任务，并为每个提供方、模型版本和部署环境预注册以下门槛：

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

`shadow` 只能证明建议、弃权、稳定性和额外开销，不能证明 Agent 采用建议后的任务效果。线上放量前还需隔离端到端试验和小流量复核。

CLI 的离线 benchmark 报告 `v2` 同时保留逐题结果、分母/错误数和接受建议错误率、无匹配误建议率的单侧 95% 精确二项上界。零个已接受建议或零个无匹配样本时，对应上界为 `null`，本地质量判定不能通过。报告的 `passed` 只检查传入阈值对应的这两项上界、肯定建议覆盖率和该 benchmark 测量边界内的 p95；它不代表达到本节的冻结样本规模、候选召回、端到端效果、任务成功率、总费用或治理放量门。

## 10. 代码与验证

核心实现：

- `packages/cli/src/lib/decision-layer/contracts.js`
- `packages/cli/src/lib/decision-layer/provider-authority.js`
- `packages/cli/src/lib/decision-layer/providers.js`
- `packages/cli/src/lib/decision-layer/typesafe-provider.js`
- `packages/cli/src/lib/decision-layer/runtime.js`
- `packages/cli/src/lib/decision-layer/benchmark.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/runtime/headless-runner.js`

单元测试覆盖契约、provider、runtime、benchmark、Agent `list_skills` 和 headless 接线。CLI `0.166.72@5f411309b2` 的精确发布提交已通过 Linux、Windows、macOS 的 CLI CI 与 CLI Strict Sandbox，并完成 npm OIDC/provenance 和公共安装回读；该发布证明包含多提供方接线、本地截止失败闭合与离线统计修复，不证明模型效果合格。后续 npm 发布必须在新版本精确提交上重新通过两个工作流的全部操作系统矩阵。模拟 System One 服务的测试只证明协议与失败闭合；本地单题真实权重冒烟仍不能替代冻结数据集模型评测。

## 11. 相关文档

- [可行性研究与评测方案](../../research/agents/jev-decision-layer-feasibility-2026-09-22.md)
- [Laya 本地真实权重联调记录](../../research/agents/jev-laya-local-probe-2026-09-23.md)
- [Jev、Laya 与本地模型决策层用户指南](../../../docs-site/docs/chainlesschain/jev-decision-layer.md)
- [模块 106：Agent Kernel](106_Agent_Kernel设计.md)
- [模块 110：发布与证据边界](110-agent-platform-release-boundaries.md)
- [模块 112：受治理 Skill 演进](112-governed-skill-evolution-design.md)
