# VERIFY-01 正式 36+9：v2 执行计划

原计划窗口已结束，原目录、指纹与缺失样本保留。此版本仅更新观察窗口，沿用全部 36 个任务、9 个独立首次安装样本、固定项目、九入口、模型身份、允许路径、单样本时间/费用限制及共享 **$99** 总上限；没有增加预算。变更依据及新旧摘要见 [revision.json](./revision.json)。

- 新窗口：**2026-10-12 14:46:52.556 UTC 至 2026-10-19 14:46:52.556 UTC**，北京时间 10 月 12 日 22:46:52.556 至 10 月 19 日 22:46:52.556。
- 新指纹：`sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd`。
- 原指纹：`sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0`。
- 固定项目：`b2aa3aba082873570e85dce39b00754e5504ff37`。被测公开产品另绑定 CLI **0.166.99** / VS Code **0.37.143** / JetBrains **0.4.161**，发行源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b`。

两套计划均为 **NOT_RUN，36 项任务 observed=0，9 次首次安装 observed=0**。旧诊断、fixture、安装预检及工程回归不导入本计划 observations。新观察使用新 planDigest，历史缺失分母保留。

## 先做 Linux CLI 五个样本

普通任务为 `verify-04`、`verify-22`（Volcengine）及 `verify-13`、`verify-31`（OpenAI），另独立执行 `first-run-linux-cli`。首批最大预算 **$11**，从共享 $99 中占用，不是新增额度。九入口完整映射和各自四任务/一首次旅程见 [execution-readiness.json](./execution-readiness.json)。

当前已生成针对新指纹的全部 **72 个 setup/check**；本地预览 reviewDigest 为 `sha256:14033f24125c7319f978d5044b2cec16cb5245cfa7019c7879c9d02c2b78dc79`。其 Docker image ID 沿用历史 pin，尚待实际操作者重验；生成和摘要核对不是独立人工预审。[review-preview](./review-preview/README.md) 保存可供审阅的完整包。若 Actions 实际镜像或配置变化，以其新 reviewDigest 重新锁定和预审，不能沿用旧批准。

`VERIFY01 Formal Keyless Preflight` 使用真实 Ubuntu 24.04 / Node 22.12.0 / Docker、固定项目 checkout 和正常公开 CLI 安装，输出新的完整 review 包与原始回执。流程不注入 provider 凭据、不认证模型、不执行 Agent、不产生正式 observations。它的技术通过只关闭预检项目，`paidExecutionReady` 仍为 false。

## 正式启动所需信息

[required-inputs.json](./required-inputs.json) 已列出外部记录位置：独立人工审阅人员/时间/记录摘要；精确模型和端点；受控凭据配置名称；provider 硬额度或可靠实时计量，以及包含失败、补救与全部样本的共享预算控制。只保存记录引用，不填 API key，不把未知费用填零。当前火山仓库配置名称已知为 `CC_LLM_API_KEY`；OpenAI 专用配置与额度记录尚未找到。

现有 `--max-budget-usd` 根据已返回 token usage 累加估算，可能一次调用超额，未定价时停止线不生效；它不证明 provider 硬额度，也没有跨补救/跨样本的 $99 共享 reservation。因此这些外部条件未落实时，正式付费阶段不启动。具体要求沿用[原计划](../verify01-plan-2026-10-04/README.md#执行范围与固定预算)。

窗口启动/发送前拒绝已在本轮源码补齐：CLI 在 checkout/setup 前检查完整任务预算，保存的 Agent binding 在发起模型子进程前重新检查；IDE preparation 在创建工作区/执行 setup 前检查。此保护还需自身 CI/发行；公开 0.166.99 不因此自动取得该新实现。实际 IDE driver 在提交提示词前还须遵守 state.deadline 和窗口边界，提前准备不授予以后发送的时间资格。

## 校验与普通 CLI 执行模板

无模型调用的校验：

```powershell
node docs/research/cli/verify01-plan-2026-10-12-v2/validate-plan.mjs
node packages/cli/scripts/verify01-collection.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-12-v2 --plan-digest sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd
```

collection 当前返回 2，表示证据不足，不表示执行了样本。正式条件齐备后，在目标 Linux 操作者使用自己的绝对路径与外部锁定的 reviewDigest；以下是普通任务的模板，尚未执行：

```bash
node "$TASK_CLI" eval --suite verify01-project-36 \
  --plan-dir "$PLAN_V2" \
  --plan-digest sha256:9c3db6e9b49da0c152b9e5cfba56ade64da50e727591b75d2dc9203ba6ae53cd \
  --review "$REVIEW_ROOT/review.json" --review-digest "$REVIEW_DIGEST" \
  --review-root "$REVIEW_ROOT" --project-root "$FROZEN_PROJECT" \
  --samples verify-04,verify-22 \
  --provider volcengine --model deepseek-v4-flash-ga-260731 \
  --label 311e01a5ec34a8e433c7abde0e4b6b05bce4513b \
  --evidence-dir "$NEW_TASK_EVIDENCE"
```

OpenAI 两题另一次调用，使用 `--samples verify-13,verify-31 --provider openai --model gpt-6-astra`。首次旅程在独立干净环境重新安装、配置、认证、执行 verify-04 并检查产物，保留五阶段和认证费用；不能复用普通任务的同一 runId，不能通过普通 CLI suite 冒充首次安装。已有 [host import](../verify01-plan-2026-10-04/HOST_CAPTURE_README.md) 支持真实 CLI 首次旅程材料；诊断入口不直接输出正式 observations。

Windows 11 24H2 与 macOS 15 arm64 两组三入口仍需实际目标宿主和各自 native 验收准入。辅助技术、固定硬件 SLO、8h/24h 观察分别取得实际回执。人工、机器或窗口不足时保留缺失，不能使用等待时钟、CLI 执行或 CI fixture 替代真实观测。
