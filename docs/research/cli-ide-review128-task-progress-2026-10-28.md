# CLI 0.166.128 发布后 36+9 复测跟踪

更新时间：2026-10-28 06:34（北京时间）。

当前跨版本独立验收合格 **32/45**：普通任务 **26/36**，独立首次安装 **6/9**。新版首项仍在执行；没有新增合格证据。该数字是诊断交付验收进度，不改变正式评测的准入状态。

## 已核实的公开版本与执行来源

CLI `0.166.128`、Open VSX `0.37.166`、JetBrains `0.4.183` 及客户端 `v5.0.3.143` 已完成公开制品核验，见[发布回执](./cli/evidence/release128-public/publication.json)。本轮使用相同公开包，任务项目仍冻结在 `b2aa3aba082873570e85dce39b00754e5504ff37`。

本轮驱动源码固定为 `d9f2511b953ca08a7b5013c177250474b3d6fb4e`。首次运行从该提交的 `main` 派发；后续使用指向同一提交的固定引用 `eval-verify01-review128-20261028`，避免并发文档提交改变执行来源。原始派发记录保留，不改写分支归属。

## 当前运行

| 样本 | 实际宿主与入口 | GitHub Actions | 已观察状态 | 独立验收 |
| --- | --- | --- | --- | --- |
| `verify-09` | macOS / JetBrains 2025.2 | [40591672216](https://github.com/chainlesschain/chainlesschain/actions/runs/40591672216) | validate 成功；原生任务执行中 | 待收集 |

已请求 `review_changes=true`。是否真实出现复查提醒、最终用量是否完整、候选断言能否拒绝行为变异，均须从本次原生记录和独立验收回执核对，不能由开关、模型自述或本地对照推定。

[不可变复测计划](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028-plan.json)列出 13 个逐项执行分片，复用既有 32 项合格证据。[本轮收集账本](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028.json)保留全部计划样本；尚未派发的项目不从分母删除。

剩余普通项：`verify-04`、`06`、`07`、`08`、`09`、`10`、`11`、`13`、`19`、`30`。剩余首次安装：`first-run-linux-cli`、`first-run-darwin-cli`、`first-run-darwin-jetbrains`。

## 推进规则

每次只派发一个新样本。下一项开始前，先核对前项完整原生生成、独立验收、全部物理请求用量及 broker 状态，并重新检查保守资金预留。派发结果不明时只读取 GitHub 核对，不自动补发。

原任务、独立验收、模型 `deepseek-v4-flash-ga-260731`、关闭 thinking、20 模型回合、24 物理请求、单请求 8192 输出 token 及六个文件工具保持不变。可选复查在原预算内执行；人工修复和本地正反对照不计为原生合格。

旧未知账单和历史共享 `$99` 责任继续保留；token 估算不等于实际账单。`paidReady:false`、native `NOT_ADMITTED`、自动晋升 `HOLD` 维持原状。只有 45 项均有真实合格证据，才能将本任务标为完成。
