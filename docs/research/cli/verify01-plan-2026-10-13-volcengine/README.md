# VERIFY-01 正式 36+9：v3 火山引擎计划

用户明确提出“用火山引擎测试”“可以依据火山引擎做36+9任务”。本版本把原 18 个 OpenAI 任务改为火山引擎，全部 **36 个任务和 9 个独立首次旅程**统一使用 `volcengine / deepseek-v4-flash-ga-260731 / https://ark.cn-beijing.volces.com/api/v3`。九个宿主入口各保留四任务和一次首次旅程。旧 v1/v2 原件、缺失分母和历史证据保留；变更逐样本记录于 [revision.json](./revision.json)。

- v3 指纹：`sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`。
- 沿用 v2 窗口：**2026-10-12T14:46:52.556Z → 2026-10-19T14:46:52.556Z**；北京时间 10 月 12 日 22:46:52.556 至 10 月 19 日 22:46:52.556。
- 固定项目：`b2aa3aba082873570e85dce39b00754e5504ff37`；公开 CLI **0.166.99**、VS Code **0.37.143**、JetBrains **0.4.161**；发行源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b`。
- 目标保持 Windows 11 24H2 x64、Ubuntu 24.04 x64、macOS 15 arm64，Node **22.12.0**；每个系统的 CLI、VS Code、JetBrains 独立验收。
- 全部任务 ID、提示词、交付物和首次旅程 ID 保持；`tasks.json` 与 v2 逐字节一致。普通任务 **$2 / 20 分钟**，首次旅程 **$3 / 30 分钟**；v1/v2/v3 共同占用原 **$99**，没有新增或重置预算。维护上限仍为 16 小时。

当前为 **NOT_RUN，任务 observed=0/36，首次旅程 observed=0/9，paidExecutionReady=false**。本目录没有执行回执。默认 thinking 不覆盖，原 inference/permission 策略不变，不允许 provider/model fallback。精确端点写入 `modelRevision`，使实际比较摘要绑定端点；操作者声明仍需实际请求证据验证。

## 新准确包与 Astra 审阅

本版本需要针对新 planDigest 重新生成全部 evaluator setup/check 脚本包，验证实际 image ID，并由用户授权的 Astra 审阅精确 plan/review/image/source 组合。v2 的成功预检与 Astra 批准仅保存在 `historical*` 字段，明确 `appliesToThisRevision=false`；新 `reviewDigest` 和批准记录为空，状态 **REVIEW_REQUIRED**。AI 审阅不能标为独立真人审阅。

[validate-plan.mjs](./validate-plan.mjs) 校验冻结修订及其初始就绪快照。后续取得新真实回执时，应另存证据并明确更新快照和相应校验，不能仅复制 v2 批准。原生产 bundle 校验器已支持此九分组，不需放宽任务完整性或摘要校验。

## 首批 Linux CLI 五个样本

四个普通任务为 `verify-04`、`verify-13`、`verify-22`、`verify-31`，加独立 `first-run-linux-cli`，均用火山引擎。首批最大 **$11** 从共享 $99 占用。九入口映射见 [execution-readiness.json](./execution-readiness.json)。

仅需火山引擎凭据和账户控制，不再要求 OpenAI 凭据。本地凭据环境名称为 `VOLCENGINE_API_KEY`，仓库配置名称为 `CC_LLM_API_KEY`；这里只记录名称。历史连接诊断不是本计划正式样本，也不证明账户硬额度。预算实现和待完成条件见 [BUDGET_READINESS.md](./BUDGET_READINESS.md)。

无模型调用的校验命令：

```powershell
node docs/research/cli/verify01-plan-2026-10-13-volcengine/validate-plan.mjs
node --test packages/cli/test-node/verify01-volcengine-plan.node-test.mjs
node packages/cli/scripts/verify01-collection.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-13-volcengine --plan-digest sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13
```

collection 当前应退出 2，表示缺少准备材料和正式证据。正式条件落实后，目标 Linux 操作者可使用以下普通任务模板；绝对路径、精确 reviewDigest、实际账户控制和端点配置须由实际环境提供，模板尚未执行：

```bash
node "$TASK_CLI" eval --suite verify01-project-36 \
  --plan-dir "$PLAN_V3" \
  --plan-digest sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13 \
  --review "$REVIEW_ROOT/review.json" --review-digest "$REVIEW_DIGEST" \
  --review-root "$REVIEW_ROOT" --project-root "$FROZEN_PROJECT" \
  --samples verify-04,verify-13,verify-22,verify-31 \
  --provider volcengine --model deepseek-v4-flash-ga-260731 \
  --label 311e01a5ec34a8e433c7abde0e4b6b05bce4513b \
  --evidence-dir "$NEW_TASK_EVIDENCE"
```

首次旅程在独立干净环境完成安装、配置、认证、执行 verify-04 和产物检查，保存五阶段与认证费用，不能复用普通任务 runId。见原 [host capture 协议](../verify01-plan-2026-10-04/HOST_CAPTURE_README.md)。当前源码的新预算或窗口检查不自动成为上述公开发行版本的能力；启动前须核对实际安装身份和实际控制边界。

Windows/macOS native 仍为 **NOT_ADMITTED**。正式目标宿主、真实 IDE 界面、真人辅助技术、固定硬件 SLO 和 8h/24h 观测仍分别需要实际材料；本地 Windows 10、WSL 工程测试与既有运行中的观察不导入本计划样本。

# 冻结后进展

本目录的机器可读 readiness 保留冻结时的未运行快照。新的准确脚本 AI 审阅、预算分配适配、真实诊断与长期观察增量见 [验收证据](../evidence/gap-2026-10-05/continuation-2026-10-13/volcengine-v3/README.md)；正式付费和 native 准入仍未满足。
