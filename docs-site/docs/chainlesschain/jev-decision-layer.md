# Jev Skill 决策层试点

> 可用版本：`chainlesschain@0.166.70`。默认关闭；当前仅支持耐久、单 prompt、headless CLI。项目尚未配置真实 TypeSafe API 凭据，也没有质量、延迟或费用收益结论。

## 概述

`cc agent` 原本会先按目录、权限、兼容性、摘要、撤销状态和检索分数筛选 Skill。Jev 试点在这条既有链路之后增加一个类型化判断：当前任务是否需要 Skill，以及最多五个已准入候选中哪个更合适。

它不是新的执行器。Jev 不能安装、加载、运行或发布 Skill，也不能绕过 CLI 的权限、预算、审批和沙箱。

## 配置参考

1. 安装公开 CLI：

```bash
npm i -g chainlesschain@0.166.70 --registry https://registry.npmjs.org
cc --version
```

2. 获得 TypeSafe API 凭据，并通过环境变量或受管 credential transport 提供。不要把 key 写在命令参数、项目文件或日志中。

PowerShell：

```powershell
$env:TYPESAFE_API_KEY = "<secret>"
```

Bash：

```bash
export TYPESAFE_API_KEY='<secret>'
```

当前项目维护环境尚无该凭据，因此公开版本只证明接线、校验和失败闭合，不证明真实 Jev API 已联调成功。

### 参数参考

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--decision-mode <mode>` | `off` | `off`、`shadow`、`suggest` |
| `--decision-model <model>` | `jev-latest` | TypeSafe 决策模型；正式评测应固定明确版本 |
| `--decision-base-url <url>` | `https://api.typesafe.ai` | 只接受 HTTPS 或 loopback 地址 |
| `--decision-timeout-ms <ms>` | `800` | `50` 到 `30000` 的整数 |

删除 `--decision-mode` 或使用 `--decision-mode off` 即恢复原路径，不读取 TypeSafe 凭据，也不发起决策调用。

## 使用示例：先从 shadow 开始

```bash
cc agent --session jev-pilot-1 \
  --decision-mode shadow \
  -p "检查并修复单元测试"
```

`shadow` 会产生真实网络调用、数据处理和费用，但不会改变 Agent 看到的 Skill 路由。决策观察写入耐久会话，用于后续离线对照。

`suggest` 会把经过校验的建议附加到 `list_skills(query)` 的 `routing.decisionSuggestion`：

```bash
cc agent --session jev-pilot-1 \
  --decision-mode suggest \
  -p "检查并修复单元测试"
```

它仍不会替换原始 `selectedDigest`，也不会自动执行 Skill。未完成真实 shadow 评测和放量门验证前，不建议在普通工作流中启用 `suggest`。

## 核心特性

| 场景 | 支持情况 |
| --- | --- |
| `cc agent --session ... -p "..."` | 支持 |
| `--resume` / `--continue` 的耐久单 prompt 会话 | 支持 |
| `--ephemeral` | 不支持 |
| 交互式 `cc agent` REPL | 不支持 |
| `--input-format stream-json` | 不支持 |
| VS Code / JetBrains Chat 面板 | 不直接支持 |

VS Code `0.37.112` 已在 Open VSX 公开；JetBrains `0.4.133` 已上传并等待 Marketplace 审核。两个 IDE 配套版都不会保存 TypeSafe key，也不会替用户打开 Jev 模式。官方 Microsoft VS Code Marketplace 当前未发布该扩展。

## 系统架构

任务先进入现有 Skill 目录、allow-list、兼容性、撤销和检索链。CLI 只把任务查询及最多五个已准入候选的有界摘要交给 Jev provider，再校验响应 schema、候选身份、概率、模型、deadline 与 usage。`shadow` 的结果只写耐久观察；`suggest` 额外投影有界建议；既有检索器始终保留原始 `selectedDigest` 和执行控制权。

```text
任务 → 既有准入与检索 → 最多 5 个候选摘要 → TypeSafe provider
                                                ↓
耐久观察 ← 预算/用量结算 ← 响应绑定与校验 ← Jev 决策
    ├─ shadow：不改变 Agent 可见路由
    └─ suggest：仅附加 routing.decisionSuggestion
```

## 性能指标

当前没有真实 Jev 效果或成本结论。进入受控 `suggest` 前，评测至少应覆盖无匹配误建议、接受建议错误、候选召回、任务成功率、增量 p95 延迟与每成功任务费用。拟议门槛包括 Recall@K ≥ 95%、无匹配误建议单侧 95% 置信上界 ≤ 2%、接受建议错误上界 ≤ 5%、增量 p95 ≤ 500 ms，且总截止不超过 800 ms；完整统计方案见模块 114。

## 测试覆盖

当前工程测试覆盖契约、TypeSafe provider、决策 runtime、benchmark、Agent `list_skills` 接线与 headless runner。`0.166.70` 的精确发布提交已通过 Linux、Windows、macOS 的 CLI CI 与 CLI Strict Sandbox，并完成 npm OIDC/provenance 和公共安装回读。上述测试证明接线与失败闭合，不替代真实模型兼容性和效果评测。

## 安全考虑

- 只向 provider 发送有界任务查询和最多五个已准入 Skill 的摘要，不发送完整 Skill 文件。
- 请求绑定 tenant、session、turn、context revision、有序候选摘要、策略、模型和 deadline。
- 响应必须匹配当前候选并通过 schema、概率、模型、时限和 usage 校验。
- 每次调用进入 durable session 的预算与模型用量账本；取消、预算终止或账本失败不会被静默吞掉。
- `shadow` 仍是外部数据出口。使用前应确认任务文本和 Skill 摘要符合组织的数据处理政策。

## 故障排查

### `TYPESAFE_API_KEY is required`

当前进程没有从环境变量或受管 credential transport 取得凭据。设置凭据后启动新进程；不要把 key 追加到命令行。

### `requires --session/--resume/--continue`

Jev 观察必须落入耐久会话。增加 `--session <id>`，并移除 `--ephemeral`。

### `single-prompt headless runs only`

当前命令进入了交互 REPL 或 `--input-format stream-json`。改用 `-p` 的单 prompt headless 调用，或把决策模式设为 `off`。

### provider 超时或响应被拒绝

确认 endpoint 使用 HTTPS 或 loopback，timeout 在允许范围内，并检查模型名、配额和网络。响应无效时既有 Skill 路由保持不变；不要通过放宽 schema 或关闭候选身份校验来“修复”。

## 关键文件

- `packages/cli/src/lib/decision-layer/contracts.js`
- `packages/cli/src/lib/decision-layer/provider-authority.js`
- `packages/cli/src/lib/decision-layer/typesafe-provider.js`
- `packages/cli/src/lib/decision-layer/runtime.js`
- `packages/cli/src/lib/decision-layer/benchmark.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/runtime/headless-runner.js`

## 相关文档

只有在冻结数据集上完成无匹配误建议、接受建议错误、覆盖率、任务成功率、延迟、费用和治理对抗测试后，才考虑从 `shadow` 进入受控 `suggest`。工程测试和其他项目的 Jev 指标不能替代本项目中文任务与 Skill 目录上的真实评测。

- [模块 114：Jev 类型化 Skill 决策层设计](/design/modules/114-jev-decision-layer-design)
- [可行性研究与评测方案](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/jev-decision-layer-feasibility-2026-09-22.md)
- [Agent Platform 发布与升级指南](/chainlesschain/agent-platform-release)
- [受治理的 Skill 自进化](/chainlesschain/governed-skill-evolution)
