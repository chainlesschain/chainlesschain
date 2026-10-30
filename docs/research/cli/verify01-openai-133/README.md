# OpenAI 原生 36+9 执行准备

CLI **0.166.133**、Open VSX **0.37.171**、JetBrains **0.4.188** 均已公开核验，随后合并了 [PR #511](https://github.com/chainlesschain/chainlesschain/pull/511)，合并提交为 `5aca37b77d50d7e0bc12bb878582a2fdcd92e664`。

本轮使用独立的 **OpenAI / gpt-6.1-sol / Responses** 诊断身份。原始 36 个任务和九个首次安装任务、固定项目与检查器保持原要求；历史火山结果单列，不补写为本轮 OpenAI 成功。首次安装任务保持独立环境，JetBrains 每个样本使用独立宿主作业。21 个生成单元覆盖 45 个样本，之后由无模型密钥的 Linux Docker 作业独立检查交付。

## 已完成验证

- 工作流原有验证命令：15 个文件、**122/122** 测试通过，零跳过。
- 首次云端运行 [41091588362](https://github.com/chainlesschain/chainlesschain/actions/runs/41091588362) 停在单元预检：120 通过、1 失败、1 平台跳过，生成和验收均未启动、任务模型调用为零。旧火山子集夹具继承了工作流的 OpenAI provider，导致使用错误的版本要求；已显式固定夹具身份并保留未知 provider 与不兼容冻结包拒绝断言。本机在同样的 OpenAI 工作流环境下重新验证 **122/122** 通过。原日志与元数据随本目录保留。
- 发现并复现旧检查器将 provider/model 写死的问题；检查器现使用操作员选择的身份，并继续拒绝 init 或任一用量事件不匹配。终态、工具结算、文件范围与实际交付要求保留。
- 源码审计：66 个候选文件、零未分类、零审查问题、零解析错误；这不构成正式付费或原生生产准入。
- 本地 OpenAI 真实调用共三次，均为 HTTP 200，实际模型为 `gpt-6.1-sol`。首次探针未生成 reasoning 项，原失败保留；随后两请求工具续接通过。本地探针没有覆盖实际空 summary 路径，也不计入 45 个任务。
- 准确公开包清单：[2026-10-30-openai-133.json](../verify01-package-sets/2026-10-30-openai-133.json)，SHA-256 `2ec5541398b4149d092b9ae31199174be8adeca5d59937a767a917ef3d2f4317`。

## 已授权的云端步骤

自动审批最初拒绝将用户本地 OpenAI key 导出到 GitHub；用户随后在会话中明确授权本次导出与完整 45 项执行。授权仅涉及 `chainlesschain/chainlesschain` 的加密 `OPENAI_API_KEY` 槽位，供该手动工作流的可信 broker 使用；CLI/IDE 子进程仅接收局部 broker 令牌。GitHub 工作流会取得调用 OpenAI 的能力，并可能产生 API 费用。代码与回执不保存凭据。

手动执行以下已提交的分支与包清单；实际源码 SHA 和包清单摘要由工作流记录。真实费用仍需账单核对，不把请求或 token 上限称为账户硬额度。

```powershell
gh workflow run verify01-native-task-campaign.yml --ref feature/verify01-openai-133 -f confirm_live=true -f provider=openai -f hosts=all -f entries=all -f package_set=latest -f package_set_file=docs/research/cli/verify01-package-sets/2026-10-30-openai-133.json
```

本轮尚无任务级 OpenAI 成功数。完整生成、失败、用量和独立检查原件应一并保留；不使用首次安装或其他宿主的结果替代缺失样本。
