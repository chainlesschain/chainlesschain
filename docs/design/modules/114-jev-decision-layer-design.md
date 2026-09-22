# 114 Jev 类型化 Skill 决策层设计

> 状态：CLI P0 已随 `chainlesschain@0.166.70` 发布；默认关闭，真实 TypeSafe API 兼容性、质量、延迟与费用评测尚未完成。<br>
> 核对日期：2026-09-22<br>
> 实现提交：`80806fd4e9`；CLI 发布提交：`75778a75e1`；当前文档与 IDE 配套提交：`d3c6ee9ba5`。

## 1. 目标与非目标

该模块在既有 Skill 检索和准入之后增加一个可替换、类型化、可审计的决策层。它只回答两个有界问题：

1. 当前任务是否需要候选 Skill；
2. 如果需要，已准入候选中哪一个最合适。

决策层不承担复杂规划、代码生成、权限裁决、Skill 安装、发布或执行。即使返回肯定建议，也不能绕过现有 allow-list、兼容性、摘要、撤销、预算、审批和执行边界。

## 2. 当前发布范围

| 表面 | 当前状态 |
| --- | --- |
| CLI | `0.166.70` 已公开，支持 `off / shadow / suggest` |
| 会话 | 仅耐久、单 prompt、headless `cc agent` |
| 交互 REPL | 不支持；非 `off` 会失败闭合 |
| `stream-json` 输入 | 不支持；非 `off` 会失败闭合 |
| VS Code / JetBrains 对话 | 不直接支持 Jev 模式；IDE 不保存 TypeSafe 凭据 |
| TypeSafe 真实 API | provider 已实现，但当前项目尚无生产凭据，未形成真实兼容性或效果报告 |
| 自动 Skill 执行 | 不支持；建议不产生执行权限 |

公开发行身份彼此独立：npm CLI 为 `0.166.70@75778a75e1`；Open VSX `0.37.112@d3c6ee9ba5` 已公开；JetBrains `0.4.133@d3c6ee9ba5` 已上传并通过发行门，当前仍等待 Marketplace 人工审核/公开 listing。Microsoft VS Code Marketplace 未发布。

## 3. 数据流与所有权

```text
用户任务
  -> 既有 Skill 目录 / allow-list / 兼容性 / 撤销检查
  -> 既有检索器生成候选和 selectedDigest
  -> 最多 5 个已准入候选的有界摘要
  -> Jev 决策 Runtime
       -> TypeSafe /v1/systemone provider
       -> 响应 schema、候选集、概率、模型、时限与用量校验
       -> 会话预算与模型用量账本结算
       -> skill_decision_observation 持久事件
  -> shadow: 不改变 Agent 可见路由
  -> suggest: 仅附加 routing.decisionSuggestion
```

既有检索器始终拥有原始 `selectedDigest`。决策层不能替换该字段，也不能调用 `run_skill`。`suggest` 只是增加有界元数据；后续是否使用某个 Skill 仍由 Agent 和原有治理链决定。

## 4. 运行模式

| 模式 | 网络调用 | 持久观察 | Agent 可见 | 改变执行 |
| --- | --- | --- | --- | --- |
| `off` | 否 | 否 | 否 | 否 |
| `shadow` | 是 | 是 | 否 | 否 |
| `suggest` | 是 | 是 | 是，仅附加建议 | 否 |

默认模式必须保持 `off`。`shadow` 也会产生网络请求、数据处理和费用，因此与 `suggest` 使用相同的凭据、预算、截止时间、取消与用量结算边界。

## 5. CLI 契约

```powershell
$env:TYPESAFE_API_KEY = "<secret>"
cc agent --session jev-pilot-1 --decision-mode shadow -p "检查并修复单元测试"
```

| 参数 | 默认值 | 约束 |
| --- | --- | --- |
| `--decision-mode` | `off` | `off`、`shadow`、`suggest` |
| `--decision-model` | `jev-latest` | 应在正式评测前冻结明确模型版本 |
| `--decision-base-url` | `https://api.typesafe.ai` | 仅 HTTPS 或 loopback |
| `--decision-timeout-ms` | `800` | 整数 `50..30000` |

非 `off` 模式必须使用 `--session`、`--resume` 或 `--continue` 所代表的耐久会话，不能与 `--ephemeral` 组合。凭据仅从 `TYPESAFE_API_KEY` 或受管 credential transport 读取，不提供命令行 key 参数，避免 secret 进入 shell history 和进程参数。

## 6. 请求与响应绑定

决策请求绑定以下身份：

- tenant、session、turn 与 context revision；
- 有序候选集合及每个候选的 canonical digest；
- 决策策略、问题模板和模型身份；
- deadline、请求摘要与 operation id。

provider 只发送有界任务查询和最多五个已经准入的 Skill 摘要。响应必须通过类型、概率范围、概率和、候选身份、模型、deadline 与 usage 校验；未知候选、跨请求重放、迟到响应、畸形概率和未结算结果均不能成为可见建议。

## 7. 预算、取消与失败语义

- 初始工程预算为每次 Skill 查询最多一次决策请求、最多五个候选、默认总截止 800 ms。
- 请求沿用 durable session 的预算和取消信号，并以 `operationId=decision:<id>` 进入模型用量账本。
- 账本写入失败、会话预算终止和用户取消保持终止性，不能被包装成普通“无建议”。
- provider 不可用、超时或响应无效时不会改变既有 Skill 路由；观察中保留稳定原因码供离线分析。
- P0 不启用应用级决策缓存。未来缓存必须绑定 tenant、候选顺序、模型、模板、策略/撤销版本和阈值版本，并在命中后重新执行准入检查。

## 8. IDE 边界

VS Code `0.37.112` 和 JetBrains `0.4.133` 只携带 CLI 配套版本与能力边界说明：

- IDE Webview/JCEF 不读取、保存或转发 `TYPESAFE_API_KEY`；
- 交互 IDE 会话不会自动添加 `--decision-mode`；
- IDE 不获得 Skill 路由、加载、执行或发布 authority；
- CLI 未来扩大 Jev 使用范围时，仍需单独设计协议、设置、凭据和真实宿主门，不能把当前 headless 接线外推到 IDE。

## 9. 评测与放量门

当前没有真实 Jev 效果或成本结论。进入受控 `suggest` 前，至少冻结 400 条开发/校准任务和 400 条测试任务，其中测试集至少包含 160 条“无需/无匹配 Skill”任务，并预注册以下门槛：

| 门槛 | 要求 |
| --- | --- |
| 治理不变量 | 未授权、撤销、跨租户、未结算结果等对抗测试全部通过 |
| 候选召回 | Recall@K ≥ 95%；不足时先修召回 |
| 无匹配误建议 | 单侧 95% 二项置信上界 ≤ 2% |
| 接受建议错误 | 单侧 95% 置信上界 ≤ 5%，肯定建议覆盖率 ≥ 50% |
| 端到端效果 | 实际误调用点估计相对下降 ≥ 20%，配对区间支持改善 |
| 任务成功率 | 95% 置信下界不低于基线 -1 个百分点 |
| 延迟 | 增量 p95 ≤ 500 ms，单次总截止 ≤ 800 ms |
| 费用 | 每成功任务总费用不高于基线 5%，且不超会话/每日硬预算 |

`shadow` 只能证明建议、弃权、稳定性和额外开销，不能证明 Agent 采用建议后的任务效果。线上放量前还需隔离端到端试验和小流量复核。

## 10. 代码与验证

核心实现：

- `packages/cli/src/lib/decision-layer/contracts.js`
- `packages/cli/src/lib/decision-layer/provider-authority.js`
- `packages/cli/src/lib/decision-layer/typesafe-provider.js`
- `packages/cli/src/lib/decision-layer/runtime.js`
- `packages/cli/src/lib/decision-layer/benchmark.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/runtime/headless-runner.js`

单元测试覆盖契约、provider、runtime、benchmark、Agent `list_skills` 和 headless 接线。CLI `0.166.70` 的精确发布提交已通过 Linux、Windows、macOS 的 CLI CI 与 CLI Strict Sandbox，并完成 npm OIDC/provenance 和公共安装回读；这些工程门不替代真实模型评测。

## 11. 相关文档

- [可行性研究与评测方案](../../research/agents/jev-decision-layer-feasibility-2026-09-22.md)
- [Jev 决策层用户指南](../../../docs-site/docs/chainlesschain/jev-decision-layer.md)
- [模块 106：Agent Kernel](106_Agent_Kernel设计.md)
- [模块 110：发布与证据边界](110-agent-platform-release-boundaries.md)
- [模块 112：受治理 Skill 演进](112-governed-skill-evolution-design.md)
