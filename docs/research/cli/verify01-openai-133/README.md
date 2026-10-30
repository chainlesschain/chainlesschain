# OpenAI 原生 36+9 执行与结果

CLI **0.166.133**、Open VSX **0.37.171**、JetBrains **0.4.188** 均已公开核验，随后合并了 [PR #511](https://github.com/chainlesschain/chainlesschain/pull/511)，合并提交为 `5aca37b77d50d7e0bc12bb878582a2fdcd92e664`。

完整 OpenAI 实测已完成：**39/45** 通过独立验收，其中普通任务 **31/36**、独立首次运行 **8/9**。生成通过 **44/45**。598 个上游请求均有完整用量记录，token 费用估算 **$30.660472**，实际账单未知。逐项结果、失败原因及来源绑定见 [完整报告](run-41117741513/REPORT.md)、[JSON](run-41117741513/results.json) 和 [CSV](run-41117741513/results.csv)。工作流保留真实失败结论，不构成正式生产准入。

本轮使用独立的 **OpenAI / gpt-6.1-sol / Responses** 诊断身份。原始 36 个任务和九个首次安装任务、固定项目与检查器保持原要求；历史火山结果单列，不补写为本轮 OpenAI 成功。首次安装任务保持独立环境，JetBrains 每个样本使用独立宿主作业。21 个生成单元覆盖 45 个样本，之后由无模型密钥的 Linux Docker 作业独立检查交付。

## 已完成验证

- 工作流原有验证命令：15 个文件、**122/122** 测试通过，零跳过。
- 首次云端运行 [41091588362](https://github.com/chainlesschain/chainlesschain/actions/runs/41091588362) 停在单元预检：120 通过、1 失败、1 平台跳过，生成和验收均未启动、任务模型调用为零。旧火山子集夹具继承了工作流的 OpenAI provider，导致使用错误的版本要求；已显式固定夹具身份并保留未知 provider 与不兼容冻结包拒绝断言。本机在同样的 OpenAI 工作流环境下重新验证 **122/122** 通过。原日志与元数据随本目录保留。
- 发现并复现旧检查器将 provider/model 写死的问题；检查器现使用操作员选择的身份，并继续拒绝 init 或任一用量事件不匹配。终态、工具结算、文件范围与实际交付要求保留。
- 精确执行源码审计（含 `--include-scripts`）：83 个候选文件、零未分类、零审查问题、零解析错误；这不构成正式付费或原生生产准入。
- 本地 OpenAI 真实调用共三次，均为 HTTP 200，实际模型为 `gpt-6.1-sol`。首次探针未生成 reasoning 项，原失败保留；随后两请求工具续接通过。本地探针没有覆盖实际空 summary 路径，也不计入 45 个任务。
- 上述三次为早期探针。随后又用未修改的公开 CLI 完成一次原生 Responses 流式端到端探针：**1 个上游请求、用量完整、终态通过、无回退**，token 估算 **$0.00221**，实际账单仍未知；该探针也不计为任务验收。
- 准确公开包清单：[2026-10-30-openai-133.json](../verify01-package-sets/2026-10-30-openai-133.json)，SHA-256 `2ec5541398b4149d092b9ae31199174be8adeca5d59937a767a917ef3d2f4317`。

## 原生协议接线修正

第二轮 [41097104348](https://github.com/chainlesschain/chainlesschain/actions/runs/41097104348) 通过预检，但本地兼容端点使公开 CLI 选择 Chat Completions，而评测 broker 仅接受 Responses。已下载的 44 个样本回执均记录上游请求 **0**；余下 `verify-27` 作业在启动前取消，没有执行步骤。该轮是评测接线失败，不是模型质量结果。

新执行保留公开 CLI 的官方 OpenAI 地址，通过源代码绑定的操作员启动器及 fetch 转发器接入局部 broker，保持原生 Responses 序列化和能力选择。没有修改已安装 CLI 文件、产品端点判定、TLS 或证书规则。转发器只接受固定官方 Responses POST 和局部 capability，并使用实际安装 CLI 的同一个预算作用域模块；激活正式作用域时会在读取凭据/URL 之前及每次请求前拒绝。真实账户 key 仍仅在 broker 中，原请求、用量与文件范围限制保留。

新增四项验证覆盖空 summary 与请求内容、取消信号、错误端点/认证拒绝、正式作用域拒绝，以及 IDE 启动器的命令与退出状态。相同 OpenAI 工作流环境下完整验证现为 **16 个文件、126/126**，零失败、零跳过。离线公开 CLI 捕获和真实流式探针均证明实际请求为 `/v1/responses`，不是协议降级或安装文件补丁。

## 本轮执行与凭据清理

用户在会话中明确授权本次导出与完整 45 项执行。授权仅涉及 `chainlesschain/chainlesschain` 的加密 `OPENAI_API_KEY` 槽位，供该手动工作流的可信 broker 使用；CLI/IDE 子进程仅接收局部 broker 令牌。模型任务全部结束后，已删除本次新建的 repository secret 并核验不存在；用户本地配置未修改。[清理回执](run-41117741513/secret-cleanup.json) 不包含凭据。

本轮执行源码为 `0d063552701fc1609aaf5674dfacf42efb1e2154`，运行 [41117741513](https://github.com/chainlesschain/chainlesschain/actions/runs/41117741513)。以下为历史执行参数，后续重跑仍需独立配置凭据与核对已完成样本。真实费用仍需账单核对，不把请求或 token 上限称为账户硬额度。

```powershell
gh workflow run verify01-native-task-campaign.yml --ref feature/verify01-openai-133 -f confirm_live=true -f provider=openai -f hosts=all -f entries=all -f package_set=latest -f package_set_file=docs/research/cli/verify01-package-sets/2026-10-30-openai-133.json
```

本轮 45 份生成摘要和 45 份独立验收摘要均已核对。未通过样本为 `verify-08`、`verify-13`、`verify-19`、`verify-26`、`verify-36` 和 `first-run-darwin-vscode`：两项未拒绝行为变异，三项候选回归失败，一项候选行为检查通过但原生宿主退出超时。失败候选没有人工修补，已完成的付费样本没有重跑。

原始错误路径的真实回归证据来自本轮 Linux CLI 子集：50 个请求中，45 个含工具结果、30 个回放 reasoning，91 次空 summary，缺失 summary **0** 次。它们包含在本轮 598 个请求内，不另计样本。[源码审计](run-41117741513/source-audit.json) 保留诊断范围与正式准入限制。
