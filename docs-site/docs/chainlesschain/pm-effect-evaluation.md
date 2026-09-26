# PM 探索效果评测与证据核验

## 概述

截至 2026-09-26，公开 CLI `0.166.76` 包含 PM 效果证据和 Eval 准入代码。本页的离线工具从仓库 `packages/cli` 目录运行，供实验维护者冻结对照计划、检查任务分组和复算报告；它不启动模型，也不提供一键自主探索或 Skill 自动晋升。

## 核心特性

- 冻结 baseline/candidate 的任务、seed、预算和最低完成率增益，再采集结果。
- 运行前检查独立任务族群是否足够，避免花费模型预算后才发现样本不足。
- 冻结 cohort 槽位；缺失、拒绝和失败记录不能通过删行改善分母。
- 重算报告、摘要与用量；宿主另行认证签名回执、准备成本和启动覆盖。

## 系统架构

离线流程为“计划 → 分组预检 → 冻结槽位 → 外部执行与证据收集 → 报告 → 复算”。工具不加载治理 deployment，也不持有执行 authority。可信宿主可为 Eval Gate 配置签名启动准入和 cohort 登记，在 suite resolver 前完成占槽与耐久回读；这属于管理员集成，不是用户可用开关绕过的前置条件。

## 配置参考

在仓库根目录进入 `packages/cli`。准备维护者提供的 suite/policy 输入；`plan-input.json` 包含经校验的 suite/policy、两组快照摘要、与 policy 一致的 3–32 个 seed、每组每 seed 的 token/tool/time/cost 上限，以及事前约定的增益与独立组数门槛。

每个输入必须是普通 UTF-8 JSON 文件，单份最多 16 MiB，兼容 UTF-8 BOM。不能用修改后的计划摘要覆盖实验前登记值。槽位清单支持 1–32 个 slot ID；清单摘要也应在采集前独立保存。

## 使用示例

先查看真实命令帮助：

```bash
cd packages/cli
node scripts/pm-exploration-effect.mjs --help
node scripts/pm-exploration-effect.mjs plan --input plan-input.json
```

在 Windows PowerShell 保存计划时显式使用 UTF-8，并检查退出码：

```powershell
$pmPlanJson = node scripts/pm-exploration-effect.mjs plan --input plan-input.json
if ($LASTEXITCODE -ne 0) { throw 'PM plan generation failed' }
$pmPlanJson | Set-Content -Encoding utf8 -LiteralPath plan.json
node scripts/pm-exploration-effect.mjs inspect --plan plan.json
```

确认任务分组后，把输出中的 `planDigest` 保存到独立实验登记记录。以下 `sha256:...` 是占位符，必须替换为该事前登记摘要；输入 JSON 需按仓库 fixture/维护者合同准备：

```bash
node scripts/pm-exploration-effect.mjs slots --plan plan.json --plan-digest sha256:... --slots slot-input.json
node scripts/pm-exploration-effect.mjs verify-slots --plan plan.json --plan-digest sha256:... --manifest slot-manifest.json
node scripts/pm-exploration-effect.mjs report --plan plan.json --plan-digest sha256:... --runs runs.json
node scripts/pm-exploration-effect.mjs verify --plan plan.json --plan-digest sha256:... --report report.json
```

每个命令将 JSON 写到标准输出；后续引用的 `slot-manifest.json`、`report.json` 需由使用者保存对应输出，工具不会自动创建它们。`runs.json` 必须覆盖冻结任务和 seed，并记录两组准备阶段成本、逐任务结果、失败类别及证据摘要。不要删除失败，也不要补造缺失回执。

## 性能指标

报告按冻结任务族群比较完成率，并保留证据不足与未解析分母。当前没有可对外承诺的真实 PM 收益、延迟或费用改善值。签名执行用量小计不等于全部准备成本和 provider/tool 账单，离线达标也不等于生产收益。

## 测试覆盖

仓库回归覆盖 plan → inspect → report → verify、槽位清单复算、UTF-8/BOM、摘要替换、缺失任务、签名篡改、重复启动、CAS 竞争和 fresh-process 导入次序。公开 `0.166.76` 的三平台 CI 与 Strict Sandbox 证据见[发布与升级指南](./agent-platform-release)。本地 fixture 是工程验证输入，不能替代真实 PM/Pilot 采样。

## 安全考虑

计划和摘要校验不证明事前登记时间或外部回执真实性。Eval authority、信任根、Ledger/witness 与 grader 必须由可信宿主配置；IDE 不持有这些私钥。启动准入仍为可选集成，不能据此宣称所有实际启动都已受控。报告不授予 Pilot、发布或 automatic active promotion 权限；后者保持 HOLD。

## 故障排查

| 结果             | 含义与处理                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| 退出码 `0`       | 帮助/计划成功、预检样本足够或 v2 统计达标；按子命令解释，均不授权晋升   |
| 退出码 `1`       | 参数、编码、文件、结构或摘要无效；修正输入后再运行                      |
| 退出码 `2`       | 分组/证据不足，或仅回读历史 v1 报告；补齐独立证据，不能当作 v2 达标     |
| 退出码 `3`       | 未达统计、安全或预算门槛；保留失败结果用于审阅                          |
| 摘要不匹配       | 检查是否使用原始事前登记计划；不要直接改传新摘要                        |
| suite 启动前拒绝 | 管理员核查 tenant、登记、槽位、截止时间与签名存储；重复槽位不会再次授权 |

## 关键文件

- `packages/cli/scripts/pm-exploration-effect.mjs`：离线工具。
- `packages/cli/src/lib/evolution/pm-exploration-benchmark.js`：计划与报告统计。
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`：评测与签名证据入口。
- `packages/cli/src/lib/evolution/evolution-eval-launch-admission.js`：启动准入。
- `packages/cli/src/lib/evolution/evolution-eval-cohort-enrollment.js`：cohort 登记。
- `packages/cli/__tests__/fixtures/pm-exploration-effect-v1.json`：历史 v1 回读样例；新计划须用 v2 合同。

## 相关文档

- [发布与升级指南](./agent-platform-release)
- [受治理 Skill 演进](./governed-skill-evolution)
- [运行时与评测证据增量设计](/design/agent-runtime-update-2026-09-26)
