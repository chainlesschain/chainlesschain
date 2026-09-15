# 三指标基线统计入口实施（2026-09-15）

## 交付与边界

本批落实差距分析 1.3、1.4、9.3 的基线统计部分。新增只读脚本，将冻结的计划样本、现有 Eval 历史、首次运行回执引用和维护工时合并为 JSON 报告。统计脚本本身不启动模型、不修改部署配置、不执行发布，也不把本地合同测试变成真实任务基线。其后使用本机已有火山模型完成了[小规模真实任务试点](./cli/evidence/outcome-metrics/2026-09-15/README.md)。

- [统计模块](../packages/cli/src/lib/eval/outcomes.js)：固定分母、预算判断、分层结果、首次运行漏斗、成本汇总。
- [脚本入口](../packages/cli/scripts/task-outcome-report.mjs)：输入大小限制、计划指纹检查与明确退出码。
- [共享证据判断](../packages/cli/src/lib/eval/evidence.js)：既有严格 Eval 与新报告复用相同执行成功和记录完整性判断。
- [Eval 费用归因](../packages/cli/src/commands/eval.js)：从已验证的唯一成功终态提取 usage 和 `total_cost_usd`，经 runner 写入任务结果与历史，避免事后按价格表猜测。
- [定向测试](../packages/cli/__tests__/unit/task-outcome-report.test.js)：验证缺失样本、失败终态、重试费用、人工补救、错误版本、证据复用、首次安装失败、工时缺失及脚本退出码。

报告只给出 `BASELINE_RECORDED` 或 `INSUFFICIENT_EVIDENCE`，`improvementVerdict` 固定为 `NOT_EVALUATED`，`productionAttested` 固定为 `false`。前者表示已提供完整的本地测量输入，允许基线成功率为零；不表示效果提升或生产验收通过。计划指纹防止误改分母，不能证明操作者在运行前冻结了计划；应将计划和指纹交由独立审阅者留存。

## 使用流程

在 `packages/cli` 目录执行：

```powershell
# 运行前完成计划并将指纹留存到评测记录。
node scripts/task-outcome-report.mjs --plan plan.json --fingerprint

# 执行既有真实 Eval 时，用精确提交作为 label，并声明模型与比较环境。
node bin/chainlesschain.js eval --provider <provider> --model <model> --comparison-context context.json --history history.jsonl --label <40位提交SHA> --json

# 收集真实旅程与工时后，替换下面的指纹，生成只读 JSON 基线。
node scripts/task-outcome-report.mjs --plan plan.json --plan-digest <已冻结的sha256指纹> --history history.jsonl --observations observations.json --maintenance maintenance.json
```

退出码：`0` 为本地基线记录完整；`2` 为证据不足；`1` 为输入非法或计划指纹变化。脚本仅向 stdout 输出报告，输入文件保持原样。尚未运行时可仅传 `--plan` 和 `--plan-digest`，所有计划样本仍进入分母并显示缺失，退出 `2`。

也可使用 `npm run eval:outcomes -- --help` 查看入口说明。该入口是仓库内评测工具，不新增产品 CLI 命令。

真实 Eval 会使用指定模型额度，应先确定时间、费用和权限预算。本文中的命令是执行说明，本批没有运行真实模型调用。

## 输入合同

### 1. `plan.json`

| 字段 | 内容 |
| --- | --- |
| `schema` | `chainlesschain.outcome-plan/v1` |
| `commitSha` | 本轮被测产物对应的 40 位小写提交 SHA，必须与 Eval 的 `label` 一致 |
| `currency` | 统一的三字母币种；费用由采集方先按记录的汇率归一，脚本不换汇 |
| `window.start/end` | 固定观察窗口，UTC ISO 格式，如 `2026-09-15T00:00:00.000Z` |
| `samples` | 运行前登记的 1–10000 个样本；真实任务与首次旅程分别登记，重复采样使用独立 ID |

每个样本包含：

```json
{
  "id": "windows-cli-fix-build-01",
  "kind": "task",
  "taskId": "fix-build",
  "stratum": "windows-cli-provider-model-revision",
  "comparisonDigest": "sha256:<64位摘要>",
  "timeBudgetMs": 120000,
  "costBudget": 1
}
```

以上是字段示意，摘要占位符必须替换。`kind` 仅允许 `task` 或 `first-run`。`comparisonDigest` 为 `outcomeDigest(expectedComparison)`，其中 `expectedComparison` 使用现有 `createEvalComparison` 构造，绑定 corpus、provider/model、环境/权限/inference 摘要及运行时。应根据将要使用的环境在运行前构造，不能在看到失败结果后改计划。一个 `stratum` 应对应固定的 OS/入口/模型配置。

当前内置 `builtin` 套件有 10 个任务，只能用作小规模基线。文档建议的 30–50 个真实项目任务仍需选择真实需求、冻结仓库快照和独立验收器；不能通过将内置任务重复运行三次，宣称已覆盖 30 个不同任务。

### 2. `history.jsonl`

直接使用现有 `cc eval --history` 产物，不复制另一套执行终态。正式统计要求 `chainlesschain.eval-history/v1`、完整比较身份、非 dry-run、匹配的提交及观察窗口。每个样本引用 `runId` 和计划里的 `taskId`；同一 `(runId, taskId)` 不允许重复充当两个样本。

有合法产物但执行失败时保留失败及费用；损坏行、缺少结果、不同模型、错误版本和缺失预算数据都不能产生该样本的成功结果。工具依据本地声明和文件进行一致性检查，不远程验签，也不证明声明对应真实模型身份。

### 3. `observations.json`

JSON 数组，每项对应一个计划样本：

```json
[
  {
    "sampleId": "windows-cli-fix-build-01",
    "runId": "来自Eval历史的runId",
    "observedAt": "2026-09-15T10:30:00.000Z",
    "elapsedMs": 60000,
    "cost": 0.2,
    "retries": 1,
    "manualRepairs": 0
  }
]
```

`observedAt` 是本次尝试结束时间；结束及按 `elapsedMs` 还原的开始必须落在观察窗口内。费用和耗时覆盖本次尝试的全部失败、重试和人工补救，不只记录最后一次成功。人工补救数大于零时不计为原始成功；正常文档配置、授权及必要信息输入不算人工修复。缺数据应保留缺失，不填假零。

失败样本还需 `failureCause`，取值为 `install`、`configuration-identity`、`model-protocol`、`tools-permissions`、`retrieval-context`、`recovery`、`artifact`、`environment`、`budget` 或 `manual-repair`。它表示采集方根据回执确认的主要原因；未提供时保留 `unknown`，报告证据不足。报告同时输出原因计数和逐样本证据问题，便于选择下一批修复；不会凭错误文案猜测归因。

`first-run` 样本还需 `firstRun`：

```json
{
  "cleanEnvironment": true,
  "stages": {
    "install": { "passed": true, "receipt": "evidence/install.json" },
    "configure": { "passed": true, "receipt": "evidence/configure.json" },
    "authenticate": { "passed": true, "receipt": "evidence/authenticate.json" },
    "tool": { "passed": true, "receipt": "evidence/tool.json" },
    "artifact": { "passed": true, "receipt": "evidence/artifact.json" }
  }
}
```

回执引用由采集方提供，脚本不会打开其路径、联网取回或认证内容。失败阶段及因上游失败而未运行的后续阶段均填 `passed:false`，引用对应失败或跳过记录。若在工具/模型任务启动前失败，可用 `runId:null`；它是已观察的失败旅程，不要求伪造 Eval 成功记录。首个任务成功必须另外有真实 Eval 执行及产物证据，只有所有阶段通过、环境干净且无需额外人工修复，才计为首次成功。

### 4. `maintenance.json`

```json
{
  "window": {
    "start": "2026-09-15T00:00:00.000Z",
    "end": "2026-09-16T00:00:00.000Z"
  },
  "complete": false,
  "entries": [
    { "id": "support-001", "category": "support", "hours": 1.5, "evidenceRef": "ticket/001" },
    { "id": "build-001", "category": "construction", "hours": 4, "evidenceRef": "ticket/002" }
  ]
}
```

窗口必须与计划一致。分类固定为 `repair`、`support`、`compatibility`、`release`、`test-infrastructure`、`construction`；最后一项单列建设成本，不混入持续维护总人时。只有记录完整且所有计划样本已有观察时，才报告每 100 次尝试的维护人时；缺失数据时输出 `null`，保留已知工时。空记录只有采集方明确声明完整时才可表示零人时。

## 验证与仍待完成的工作

本批定向验证覆盖新增统计、费用归因和既有严格 Eval 证据判断：Windows 下 10 个测试文件、189 个测试全部通过；ESLint 与 `git diff --check` 通过。本地合同测试使用显式测试模型与虚构回执，不能计入三指标真实基线。

```powershell
# 工作目录：packages/cli
..\..\node_modules\.bin\vitest.cmd run __tests__/unit/task-outcome-report.test.js __tests__/unit/eval-evidence.test.js __tests__/unit/eval-command.test.js __tests__/unit/eval-runner.test.js __tests__/unit/eval-timeout-kill.test.js __tests__/unit/llm-config-defaults.test.js __tests__/unit/config-security.test.js __tests__/unit/config-keys.test.js __tests__/unit/settings-config.test.js __tests__/integration/eval-strict-cli.test.js
..\..\node_modules\.bin\eslint.cmd src/lib/eval/outcomes.js src/lib/eval/evidence.js src/lib/eval/runner.js src/lib/llm-config-defaults.js src/commands/eval.js src/commands/config.js src/commands/agent.js scripts/task-outcome-report.mjs __tests__/unit/task-outcome-report.test.js __tests__/unit/eval-command.test.js __tests__/unit/eval-timeout-kill.test.js __tests__/unit/llm-config-defaults.test.js
```

| 剩余工作 | 完成所需证据/输入 |
| --- | --- |
| 30–50 个真实项目任务与首次旅程矩阵 | 目标任务、承诺支持的 OS/入口/模型、独立验收器、重复次数、时间及费用预算 |
| G01/G03/G06/G08 等真实失败排序及修复 | 对应真实身份、模型和目标宿主的逐样本结果；当前没有本批新实测数据可据以选择最大失败原因 |
| 维护成本基线 | 固定观察窗口的真实工时和任务量；本地编码耗时不能代替产品维护成本 |
| 改善/退化判定、统计区间与扩大决策 | 先取得可比基线，再冻结最小改善、允许退化、维护预算；当前报告不计算显著性或输出改善 PASS |
| G04/G07/G09/G10/G11 剩余目标环境验收 | 精确 SHA 多平台、真实身份/KMS/witness、容量 formal 和双设备证据，沿用原独立验收门 |

本批已经交付可运行的基线统计入口，关闭一个可复现的跨 provider 模型覆盖问题，并完成 Windows/CLI/火山模型内置任务的小规模重复实测。真实产品任务集、干净公开安装、多平台和维护观察窗口仍未完成，因而未将任何 G01–G11 项目改为生产完全完成。
