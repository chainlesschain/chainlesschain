# Skill 决策层试点：Jev、Laya 与本地模型

> 发布边界：`chainlesschain@0.166.72` 继承 TypeSafe、Laya 与通用 System One 的 `--decision-provider` 接线，并修复本地决策截止时向上抛出超时的行为。默认关闭；仅支持耐久、单 prompt、headless CLI。Laya 已完成一次本地真实权重冒烟联调，尚无冻结数据集的质量、延迟或费用收益结论。

2026-09-24 文档核对基线为 `main@c036888c3c`；[CLI 官网](https://www.chainlesschain.com/cli)与[IDE 官网](https://www.chainlesschain.com/ide)同步展示已公开的 CLI `0.166.72`、Open VSX `0.37.114` 和 JetBrains `0.4.135`。本地决策仍需用户显式启用。

## 概述

`cc agent` 原本会先按目录、权限、兼容性、摘要、撤销状态和检索分数筛选 Skill。决策层在这条既有链路之后增加一个类型化判断：当前任务是否需要 Skill，以及最多五个已准入候选中哪个更合适。它支持 TypeSafe 托管的 Jev、开源本地 Laya，以及实现相同接口的其他模型服务。

决策模型不能安装、加载、运行或发布 Skill，也不能绕过 CLI 的权限、预算、审批和沙箱。切换模型不会改变这些边界。

`--decision-provider` 只选择 Skill 决策模型；主 Agent 的聊天模型仍由 `--provider`、`--model` 等原有配置决定。如需整个 Agent 离线运行，还需配置本地主模型和工具。

## 配置参考

### 安装已发布的 CLI

公开 CLI `0.166.72` 可选择 TypeSafe、Laya 或兼容 System One 的服务：

```bash
npm i -g chainlesschain@0.166.72 --registry https://registry.npmjs.org
cc --version
```

获得 TypeSafe API 凭据，并通过环境变量或受管 credential transport 提供。不要把 key 写在命令参数、项目文件或日志中。

PowerShell：

```powershell
$env:TYPESAFE_API_KEY = "<secret>"
```

Bash：

```bash
export TYPESAFE_API_KEY='<secret>'
```

当前项目维护环境尚无该凭据，因此发布验证只证明接线、校验和失败闭合，不证明真实 Jev API 已联调成功。

### 已发布参数参考

| 参数                             | 默认值       | 说明                                                                                         |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `--decision-mode <mode>`         | `off`        | `off`、`shadow`、`suggest`                                                                   |
| `--decision-provider <provider>` | `typesafe`   | `typesafe`、`laya`、`system-one`                                                             |
| `--decision-model <model>`       | 按提供方选择 | TypeSafe 为 `jev-latest`；Laya 为 `laya`；通用服务必须显式指定                               |
| `--decision-base-url <url>`      | 按提供方选择 | TypeSafe 为 `https://api.typesafe.ai`；Laya 为 `http://127.0.0.1:8000`；通用服务必须显式指定 |
| `--decision-timeout-ms <ms>`     | `800`        | `50` 到 `30000` 的整数                                                                       |

Laya 提供方只允许 loopback 地址。`typesafe` 和 `system-one` 只接受 HTTPS 或 loopback 地址。地址填写服务根地址，CLI 追加 `/v1/systemone`；不要填写 `/v1/chat/completions`。

TypeSafe 必须使用 `TYPESAFE_API_KEY`；本地 Laya 默认不需要 key。Laya 和通用 System One 服务只在需要认证时读取可选的 `DECISION_API_KEY`，不会读取或转发 TypeSafe 凭据。删除 `--decision-mode` 或使用 `--decision-mode off` 即恢复原路径，不读取决策凭据，也不发起决策调用。

### Laya 本地接入

[Laya 官方仓库](https://github.com/NandhaKishorM/laya)及[模型权重](https://huggingface.co/convaiinnovations/laya)采用 Apache-2.0 许可证。它是对有限选项输出概率的分类决策模型，不是聊天生成模型；不能直接把 Hugging Face 地址当作 API，也不能通过 Ollama 的普通聊天接口替代本协议。

可使用第三方 [laya-serve](https://github.com/stiermid/laya-serve) 提供 `/v1/systemone`。以下命令已在本地 CPU 环境以 `0.1.0` 和真实权重完成冒烟联调。它的默认后端是 `fake`，必须显式切换到 `laya`；通过 Uvicorn 仅监听本机：

```powershell
python -m pip install "laya-serve[inference]==0.1.0"
$env:LAYA_SERVE_BACKEND = "laya"
$env:LAYA_SERVE_PRELOAD = "true"
python -m uvicorn laya_serve.app:create_app --factory --host 127.0.0.1 --port 8000
```

首次启动需要下载依赖和权重；离线使用前应准备本地缓存。预加载完成后，在另一个终端运行已安装的 CLI：

```powershell
cc agent --session laya-pilot-1 --decision-provider laya --decision-mode shadow -p "检查并修复单元测试"
```

Laya 根目录英文权重约 421M 参数，最大序列长度 512 tokens；中文等语言使用约 322M 参数、默认 1024 tokens 的[多语言权重](https://huggingface.co/convaiinnovations/laya-multilingual)。该服务通过上游 Router 自动选择语言；请求中的 `model=laya` 是服务别名，不是权重选择器。默认响应标签 `laya-english` 也不能证明实际加载的是英文权重；`LAYA_SERVE_SERVING_MODEL` 仅修改标签。评测须固定并核验实际模型 checkpoint。

较长任务和候选摘要可能被模型截断，必须单独评测中文路由、上下文长度和候选召回。首次加载、CPU 推理可能超过默认 800 ms，可在实验时显式调整超时；调整不代表已满足正式延迟门槛。

[本地联调记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/jev-laya-local-probe-2026-09-23.md)显示，完整 CLI 请求中的英文候选元数据使一个短中文任务被上游 Router 判为英文，并载入英文权重；该 CPU 环境的完整请求热路径约 7–11 秒。只发送中文任务文本可触发多语言权重，但这不是当前 CLI 的请求格式，单题结果也不支持质量结论。服务响应的 `model` 标签不能证明实际权重。`0.166.72` 将本地决策截止记录为 `provider-timeout` 和未知用量，不会把它误当作用户取消；用户取消和账本失败仍会终止请求。

### 其他本地或自托管模型

服务必须原生实现 `POST /v1/systemone`：请求包含 `model`、`state`、`questions`，响应包含按问题返回的类型化 `answers`、有效 `usage` 和模型标签。仅兼容 OpenAI Chat Completions 的模型服务需要另行实现该适配层。

```powershell
cc agent --session local-decision-1 --decision-provider system-one --decision-model my-local-router --decision-base-url http://127.0.0.1:9000 --decision-mode shadow -p "检查并修复单元测试"
```

`system-one` 不猜测模型名或地址；两者必须显式指定。需要认证时在运行前设置 `$env:DECISION_API_KEY = "<secret>"`。选择远程 HTTPS 服务时，任务文本和候选摘要会发送至该服务。

## 使用示例：先从 shadow 开始

```bash
cc agent --session jev-pilot-1 \
  --decision-mode shadow \
  -p "检查并修复单元测试"
```

以上 `cc` 示例均适用于已发布的 `0.166.72`。`shadow` 会调用所选服务并产生数据处理和推理开销，但不会改变 Agent 看到的 Skill 路由。决策观察写入耐久会话，用于后续离线对照。

`suggest` 会把经过校验的建议附加到 `list_skills(query)` 的 `routing.decisionSuggestion`：

```bash
cc agent --session jev-pilot-1 \
  --decision-mode suggest \
  -p "检查并修复单元测试"
```

它仍不会替换原始 `selectedDigest`，也不会自动执行 Skill。未完成真实 shadow 评测和放量门验证前，不建议在普通工作流中启用 `suggest`。

## 核心特性

| 场景                                           | 支持情况   |
| ---------------------------------------------- | ---------- |
| `cc agent --session ... -p "..."`              | 支持       |
| `--resume` / `--continue` 的耐久单 prompt 会话 | 支持       |
| `--ephemeral`                                  | 不支持     |
| 交互式 `cc agent` REPL                         | 不支持     |
| `--input-format stream-json`                   | 不支持     |
| VS Code / JetBrains Chat 面板                  | 不直接支持 |

VS Code `0.37.114` 已在 Open VSX 公开，JetBrains `0.4.135` 已在 Marketplace 公开；两端均推荐 CLI `0.166.72`。两个 IDE 配套版都不会保存决策模型凭据，也不会替用户打开决策模式。官方 Microsoft VS Code Marketplace 当前未发布该扩展。

## 系统架构

任务先进入现有 Skill 目录、allow-list、兼容性、撤销和检索链。CLI 只把任务查询及最多五个已准入候选的有界摘要交给所选 provider，再校验响应 schema、候选身份、概率、模型字段格式、deadline 与 usage。模型字段校验不能证明实际使用的权重。`shadow` 的结果只写耐久观察；`suggest` 额外投影有界建议；既有检索器始终保留原始 `selectedDigest` 和执行控制权。

```text
任务 → 既有准入与检索 → 最多 5 个候选摘要 → TypeSafe / Laya / System One
                                                ↓
耐久观察 ← 预算/用量结算 ← 响应绑定与校验 ← 类型化决策
    ├─ shadow：不改变 Agent 可见路由
    └─ suggest：仅附加 routing.decisionSuggestion
```

## 性能指标

本地 Laya 单题冒烟不构成效果与成本结论；当前没有本项目的真实 Jev、Laya 或其他模型统计效果与成本结论。进入受控 `suggest` 前，评测至少应覆盖无匹配误建议、接受建议错误、候选召回、任务成功率、增量 p95 延迟与每成功任务费用。拟议门槛包括 Recall@K ≥ 95%、无匹配误建议单侧 95% 置信上界 ≤ 2%、接受建议错误上界 ≤ 5%、增量 p95 ≤ 500 ms，且总截止不超过 800 ms；完整统计方案见模块 114。上游 Laya 的 benchmark 不能作为本项目实测结果。

## 测试覆盖

工程测试覆盖契约、provider、决策 runtime、benchmark、Agent `list_skills` 接线与 headless runner。`0.166.72@5f411309b2` 的精确发布提交已通过 Linux、Windows、macOS 的 CLI CI 与 CLI Strict Sandbox，并完成 npm OIDC/provenance 和公共安装回读；这些记录覆盖多提供方接线、截止观察与离线统计修复。本地真实权重单题冒烟不包含冻结数据集的模型质量结论。

## 安全考虑

- 只向 provider 发送有界任务查询和最多五个已准入 Skill 的摘要，不发送完整 Skill 文件。
- 请求绑定 tenant、session、turn、context revision、有序候选摘要、策略、模型和 deadline。
- 响应必须匹配当前候选并通过 schema、概率、模型字段格式、时限和 usage 校验。
- 每次调用进入 durable session 的预算与模型用量账本；取消、预算终止或账本失败不会被静默吞掉。
- `shadow` 也会把任务文本和候选摘要交给所选服务；远程服务属于外部数据出口。本地部署需确认服务使用真实本地后端、已缓存权重且未配置远程转发。

## 故障排查

### `TYPESAFE_API_KEY is required`

当前进程没有从环境变量或受管 credential transport 取得凭据。设置凭据后启动新进程；不要把 key 追加到命令行。

### `requires --session/--resume/--continue`

所有提供方的决策观察都必须落入耐久会话。增加 `--session <id>`，并移除 `--ephemeral`。

### `single-prompt headless runs only`

当前命令进入了交互 REPL 或 `--input-format stream-json`。改用 `-p` 的单 prompt headless 调用，或把决策模式设为 `off`。

### provider 超时或响应被拒绝

确认 endpoint 使用 HTTPS 或 loopback（Laya 仅允许 loopback），timeout 在允许范围内，并检查模型名、配额和网络。Laya 还需确认真实后端启用、模型已加载、端口一致；HTTP 200 的 `fake` 响应只能证明协议接线。响应无效时既有 Skill 路由保持不变；不要通过放宽 schema 或关闭候选身份校验来“修复”。

## 关键文件

- `packages/cli/src/lib/decision-layer/contracts.js`
- `packages/cli/src/lib/decision-layer/provider-authority.js`
- `packages/cli/src/lib/decision-layer/providers.js`
- `packages/cli/src/lib/decision-layer/typesafe-provider.js`
- `packages/cli/src/lib/decision-layer/runtime.js`
- `packages/cli/src/lib/decision-layer/benchmark.js`
- `packages/cli/src/runtime/agent-core.js`
- `packages/cli/src/runtime/headless-runner.js`

## 相关文档

只有在冻结数据集上完成无匹配误建议、接受建议错误、覆盖率、任务成功率、延迟、费用和治理对抗测试后，才考虑从 `shadow` 进入受控 `suggest`。工程测试和其他项目的模型指标不能替代本项目中文任务与 Skill 目录上的真实评测。

- [模块 114：可替换模型的类型化 Skill 决策层设计](/design/modules/114-jev-decision-layer-design)
- [可行性研究与评测方案](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/jev-decision-layer-feasibility-2026-09-22.md)
- [Agent Platform 发布与升级指南](/chainlesschain/agent-platform-release)
- [受治理的 Skill 自进化](/chainlesschain/governed-skill-evolution)
