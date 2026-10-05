# VERIFY-01 只读采集准入校验

`packages/cli/scripts/verify01-collection.mjs` 复用既有 Eval comparison/history 校验和 `buildOutcomeReport`，检查冻结目录、预审配置及导入记录之间的一致性。它不会运行 setup/check、shell、模型或 IDE，不会修改任务状态、写入 history/observations、生成终态证据或授权付费执行。36 个任务和 9 个首次旅程仍为 `NOT_RUN`。后续新增的 CLI 执行入口见文末；只读校验与实际执行是两个不同命令。

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

上例是格式说明，缺少其余任务和真实摘要，不能通过校验。路径必须是精确的相对文件路径，无通配符或 `..`，每个路径段不得以点或空格结尾；允许改动只能从对应任务 `expectedFiles` 和 `sourcePaths` 中选择，必须保留交付文件。setup/check 文件不能同时属于任何任务的允许改动路径，保护集合忽略大小写以覆盖 Windows 路径别名。`--review-root` 指定这些已审阅文件的根目录；路径逃出该目录会拒绝。文件只读取和核对字节摘要，绝不加载为模块。

review 的规范 JSON 摘要使用现有 `outcomeDigest(review)`；文件字节摘要使用现有 `evalDigest(bytes)`。独立验收者应在任务执行前保存该摘要，并通过与被校验文件分离的渠道提供 `--review-digest`。工具不会从当前 review 自行生成摘要再将其作为信任依据。摘要锁定不是签名或第三方认证；`--project-sha` 也是声明，不能证明实际 checkout。未来执行端必须从实际项目 checkout 读取 SHA，并将隔离配置、完整 diff、原始验收输出及宿主终态绑定到这份预审配置。

检查预审配置（此命令仍不执行任何任务）：

```powershell
node packages/cli/scripts/verify01-collection.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-04 --plan-digest sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0 --review review.json --review-digest sha256:<执行前外部锁定摘要> --review-root <预审文件目录> --project-sha b2aa3aba082873570e85dce39b00754e5504ff37
```

取得真实执行记录后，可在同一命令追加 `--history history.jsonl --observations observations.json --samples <sample-id>,<sample-id> --source-sha <被测CLI源码SHA>`。输入沿用现有 Eval history JSONL 和 outcome observations 数组，样本 ID 来自冻结 `plan.json`，不是任务 ID。选定样本必须恰好各有一条 observation，全部提供的历史任务结果都必须被引用；未选定的计划样本继续留在既有报告的 missing 分母。不同首次旅程不能复用同一 `(runId, taskId)`。SHA、comparison、Node/平台声明、终态字段、修改路径或摘要不一致时拒绝。

`terminalVerified` 必须来自实际执行协议采集器；本工具只检查既有字段和关系，不能凭 JSON 证明远端真实性。缺少可验证终态的原始材料必须另行保留，不能为了通过导入补写 true；不完整样本保持 missing，恢复结果未知时不得自动重跑副作用。CLI 记录不能冒充 IDE 操作。任何测试中的受控 fixture 只用于验证适配器，不是独立验收回执，不能写入正式 observations。

首次安装在任务启动前早停时，沿用既有 outcome 合同接受 `kind:first-run`、`runId:null`、`tool.passed:false`，必须保留全部五阶段的通过/失败状态及回执、有效失败归因、时间和重试记录。阶段不连续、缺回执或缺归因时拒绝；普通任务及已成功进入工具阶段的首次旅程仍须有 Eval run 和终态。早停只计已观察失败，其余未执行任务仍为 missing。

费用与对应 task result 的 `totalCostUsd` 逐项一致；null 只能对应 null，不能填零。费用未知的记录仍在报告中保留，但不计任务成功或完整成本。任务启动前早停没有 Eval 费用源，只校验申报费用为 null 或非负数，保留 null；本工具不能认证申报费用真实性，必须另附原始账单或未计费回执。已验证的失败、超时预算或超支由既有 outcome 口径保留为失败，不移出分母。该切片不接入维护回执，因此本工具不负责关闭完整 baseline；后续仍使用既有 `task-outcome-report.mjs` 完成维护窗口汇总。

退出码：**1** 为无效输入；**2** 为尚未执行或 outcome 证据不足；**0** 只可能表示既有报告达到其本地完整基线条件，不是改善 PASS 或生产认证。`productionAttested` 保持 false。本轮的验收器生成及原始材料导入见以下说明；目标公开安装、整包容器验证及独立人工审阅、实际 provider/双 IDE GUI 执行、账单和维护观察继续开放。

## CLI 执行入口（2026-10-05 后续实施）

`cc eval --suite verify01-plan-2026-10-04` 复用同一冻结合同和原有 runner，仅接受同一 comparison stratum 的普通 CLI 任务。必须显式传入 `--plan-dir`、`--plan-digest`、`--review`、`--review-digest`、`--review-root`、`--project-root`、`--samples`、`--provider`、`--model`、`--label` 和 `--evidence-dir`。参数名可用 `cc eval --help` 核对；其中样本 ID 来自 plan，不是任务 ID。执行需另有账户及费用授权，本说明不构成授权。

`--project-root` 是 HEAD 等于冻结项目提交的 Git checkout。执行端从 Git 对象复制受跟踪文件，不复制开发目录的 `.git`、未跟踪凭据或依赖 junction；setup 负责按锁文件准备依赖。`--review-root` 必须位于被测项目之外，预审配置仍须覆盖全部 36 项任务。setup/check 以执行前捕获的字节在独立 Node 子进程运行，工作目录为 review root，隔离任务工作区通过 `process.argv[1]` 传入。setup 成功退出；check 成功退出并向 stdout 写出单个 JSON `{ "pass": true或false, "detail": "验收说明" }`，其他日志写 stderr。脚本摘要只能锁定内容，不能代替独立审阅或将受信任验收代码沙箱化。

执行记录分开保留冻结项目、被测 CLI 来源、comparison、review、原始 stdout/stderr、完整改动和终态。工作区保留以供独立检查；大回执单独落盘，history 只存摘要引用。只有真实 headless stream-json 成功终态才可确认执行成功，缺少 usage/费用不会补零，未知终态不会补 true。`collectionReady:false` 时命令返回 2；结果仍须通过只读采集器与既有 outcome 汇总，不能将“执行过”直接称为完整基线。

`--dry-run` 只检查离线接线，不能成为正式样本。实际双 IDE 任务必须通过真实宿主适配器；首次安装须另采五阶段旅程，此入口会明确拒绝这两类样本。当前已提供下面的 36 项 setup/check 生成器，尚无独立人工签核、整包容器执行、付费执行或 observations，不改变冻结分母、预算、窗口或 `NOT_RUN` 状态。

## 36 项 setup/check 生成器（本轮工程补充）

`packages/cli/scripts/verify01-review-pack.mjs` 仅生成 operator 配置，不运行模型或任务。要求全新 review 目录，以及验收者从可信镜像渠道另行锁定的 Docker image ID；标签 `node:22.12.0-bookworm-slim` 只是参考，每阶段实际检查 Node 版本。占位值不能作为执行配置：

```powershell
node packages/cli/scripts/verify01-review-pack.mjs --output-dir <新的项目外review目录> --image-id sha256:<独立锁定的64位镜像ID> --plan-dir docs/research/cli/verify01-plan-2026-10-04
```

输出包括 72 个自包含 `.mjs`、`review.json`、`review.sha256` 和 `pack.json`。核对全部规格、允许路径、测试支持文件、确定性反例和 Docker 隔离参数后，独立保存 review 摘要，再将 review 交给前述执行器。不能直接把新生成的摘要称为人工预审认证。生成器拒绝覆盖旧目录；修改 runtime/spec/image 后须生成新 pack 并重新审阅及锁定摘要。

此 pack **只支持 Linux operator + Linux Docker 验收**；native Windows/macOS 的独立 review 尚需准备，不能直接沿用容器结果。安装阶段只挂载隔离 workspace 可写，以 lockfile 执行 `npm ci --ignore-scripts`；测试阶段断网且 workspace、`/review` 和容器根文件系统只读。所有候选测试实际运行，skip/todo/空测试拒绝，反例只接受断言失败；原有基线可保留已有 pending，但至少有实际 passed。测试支持文件和独立纯 JSON Vitest 配置锁定，以 `--configLoader native` 加载，避免默认 bundle 在只读挂载内写临时文件，不读取候选新增配置。

验收脚本按执行器合同以 `node --input-type=module --eval <已捕获脚本字节> <隔离workspace> <外层deadline毫秒时间戳>` 运行，cwd 为 review root；`process.argv[1]` 是工作区，`argv[2]` 为任务剩余预算对应的 deadline。不可用普通 `node script.mjs workspace` 替代这一调用合同。源码变体只在任务工作区临时应用，并在 finally 还原；mutation-only 行为归属映射不扩大 Agent 的允许改动路径。第 34 题计划从内联锁定数据放到 `/review/plan.json`，因为冻结 checkout 早于本目录。

每阶段最多 10 分钟，并为外层预算预留 40 秒清理时间；不足余量时不启动容器。镜像须提供 coreutils `timeout`，容器内部 watchdog 与 Docker client deadline 同时存在；常规超时须确认 `docker rm --force`，不能将外部意外 kill 后的即时清理称为已经实证。脚本将原始执行回执写到 review root 的 `acceptance-evidence`，向 stdout 返回单个 verdict JSON及回执路径/字节摘要。setup 失败退出 1；check 以 `pass:false` 表达负验收。stdout 摘要引用须连同实际回执保留，不能只保存生成时的 `pack.json`。

本机 Docker engine 当前返回 HTTP 500，没有实际整包容器结果；42 个反例仅完成源码唯一匹配及语法核对。`executionStatus:NOT_RUN`、`independentHumanReview:false`、`productionAttested:false` 不变。VS Code/JetBrains 原始协议、tab/reload、完整 diff 与首次旅程材料的只读导入见 [HOST_CAPTURE_README](./HOST_CAPTURE_README.md)。
