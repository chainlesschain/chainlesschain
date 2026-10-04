# VERIFY-01 只读采集准入校验

`packages/cli/scripts/verify01-collection.mjs` 复用既有 Eval comparison/history 校验和 `buildOutcomeReport`，检查冻结目录、预审配置及导入记录之间的一致性。它不会运行 setup/check、shell、模型或 IDE，不会修改任务状态、写入 history/observations、生成终态证据或授权付费执行。36 个任务和 9 个首次旅程仍为 `NOT_RUN`；实际执行接线仍未完成。

在仓库根目录检查当前冻结目录：

```powershell
node packages/cli/scripts/verify01-collection.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-04 --plan-digest sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0
```

该命令不需要账号或 review，输出 `executionStatus: NOT_RUN`、`reviewValidated: false` 和既有 outcome report：observed=0、36+9 missing、费用为 null；退出码 **2** 表示证据不足。没有开始任务，不能将 coverage 的数值零称为执行成功率。所有输出仅写 stdout。

实际独立验收者仍须审阅每项 setup/check 的内容、确定性反例和允许改动路径。适配器只验证收到的配置及文件摘要，不代替此审阅。review 配置形状如下，`tasks` 必须包含冻结目录的全部 36 个不同任务：

```json
{
  "planDigest": "sha256:<已冻结计划摘要>",
  "catalogDigest": "sha256:<冻结 tasks.json 的 outcomeDigest>",
  "projectCommit": "b2aa3aba082873570e85dce39b00754e5504ff37",
  "tasks": [
    {
      "taskId": "verify-01",
      "setup": {
        "path": "review/verify-01-setup.js",
        "digest": "sha256:<文件字节摘要>"
      },
      "check": {
        "path": "review/verify-01-check.js",
        "digest": "sha256:<文件字节摘要>"
      },
      "allowedChangedPaths": ["packages/cli/__tests__/verify-01.test.js"]
    }
  ]
}
```

上例是格式说明，缺少其余任务和真实摘要，不能通过校验。路径必须是精确的相对文件路径，无通配符或 `..`；允许改动只能从对应任务 `expectedFiles` 和 `sourcePaths` 中选择，必须保留交付文件。setup/check 文件不能同时属于任何任务的允许改动路径。`--review-root` 指定这些已审阅文件的根目录；路径逃出该目录会拒绝。文件只读取和核对字节摘要，绝不加载为模块。

review 的规范 JSON 摘要使用现有 `outcomeDigest(review)`；文件字节摘要使用现有 `evalDigest(bytes)`。独立验收者应在任务执行前保存该摘要，并通过与被校验文件分离的渠道提供 `--review-digest`。工具不会从当前 review 自行生成摘要再将其作为信任依据。摘要锁定不是签名或第三方认证；`--project-sha` 也是声明，不能证明实际 checkout。未来执行端必须从实际项目 checkout 读取 SHA，并将隔离配置、完整 diff、原始验收输出及宿主终态绑定到这份预审配置。

检查预审配置（此命令仍不执行任何任务）：

```powershell
node packages/cli/scripts/verify01-collection.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-04 --plan-digest sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0 --review review.json --review-digest sha256:<执行前外部锁定摘要> --review-root <预审文件目录> --project-sha b2aa3aba082873570e85dce39b00754e5504ff37
```

取得真实执行记录后，可在同一命令追加 `--history history.jsonl --observations observations.json --samples <sample-id>,<sample-id>`。输入沿用现有 Eval history JSONL 和 outcome observations 数组，样本 ID 来自冻结 `plan.json`，不是任务 ID。选定样本必须恰好各有一条 observation，全部提供的历史任务结果都必须被引用；未选定的计划样本继续留在既有报告的 missing 分母。不同首次旅程不能复用同一 `(runId, taskId)`。SHA、comparison、Node/平台声明、终态字段、修改路径或摘要不一致时拒绝。

`terminalVerified` 必须来自实际执行协议采集器；本工具只检查既有字段和关系，不能凭 JSON 证明远端真实性。缺少可验证终态的原始材料必须另行保留，不能为了通过导入补写 true；不完整样本保持 missing，恢复结果未知时不得自动重跑副作用。CLI 记录不能冒充 IDE 操作。任何测试中的受控 fixture 只用于验证适配器，不是独立验收回执，不能写入正式 observations。

费用与对应 task result 的 `totalCostUsd` 逐项一致；null 只能对应 null，不能填零。费用未知的记录仍在报告中保留，但不计任务成功或完整成本。已验证的失败、超时预算或超支由既有 outcome 口径保留为失败，不移出分母。该切片不接入维护回执，因此本工具不负责关闭完整 baseline；后续仍使用既有 `task-outcome-report.mjs` 完成维护窗口汇总。

退出码：**1** 为无效输入；**2** 为尚未执行或 outcome 证据不足；**0** 只可能表示既有报告达到其本地完整基线条件，不是改善 PASS 或生产认证。`productionAttested` 保持 false。目标公开安装、36 项预审实现及独立审阅、实际 provider/双 IDE 执行、原始终态采集、账单和维护观察全部继续开放。
