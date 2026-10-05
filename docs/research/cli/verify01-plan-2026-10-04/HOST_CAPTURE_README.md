# VERIFY-01 宿主与首次安装原始证据导入

本说明对应未提交工作区的 `packages/cli/scripts/verify01-host-import.mjs`。命令只读取已有材料，校验并输出既有 Eval history、observations 和 outcome report；不运行 IDE、模型、setup/check，不自动保存正式样本。本轮没有真实采集数据，36+9 保持 `NOT_RUN`。以下 JSON/代码均为格式说明，含占位值，不能作为 observations。

## 真实采集前的准备

使用冻结计划指定的 OS/架构、Node 22.12.0、IDE、provider/model、模式和项目 SHA，按任务新建隔离工作区。在工作区之外审阅、锁定并执行 setup/check；Linux Docker pack 的用法与开放项见 [COLLECTION_README](./COLLECTION_README.md)。Windows/macOS native review 不能由 Linux 容器代替。保存公开安装来源、产物版本/字节摘要、实际 runtime 和被测 CLI 源码 SHA，计划中的身份声明不能当作实际来源证明。

双 IDE 会话核心提供可选 `onProtocolRecord(record)`。VS Code 受控 host driver 可通过已有 `ChatViewProvider` 的 `deps.createSession(cfg)` 为真实 `AgentChatSession` 注入 observer；JetBrains 的 `Options.onProtocolRecord` 位于 pure core，实际 `ConversationView`/GUI driver 注入尚未完成。接口默认不启用、不写文件、不提供生产采集设置。driver 必须另行保存原始记录并实际操作 UI，不能将 core fixture 或 CLI headless 冒充宿主旅程。

每题使用一个新会话，保留 init、唯一 user 输入、真实接受回执、唯一终态和退出。当前导入合同不能合并多 user turn 或多个重试会话来挑选成功；重试与人工修复须如实另留首次尝试证据和汇总计数。输入、回执或终态存在序号缺口、旧 generation、重复/外国 session、override、历史 worklog 或附件时拒绝。本计划 prompt 不含附件。

双 IDE 为持久 stream 会话；终态后应由受控 driver 优雅 `end()`，保存实际 exit 0，不能以 `stop()`/强杀并归一化 code 0 代替。VS Code close 在 flush 后记录 exit；Java observer 路径有界等待 stdout 泵，未 drain 不准入。

## Capture manifest 与附件

manifest 的规范化 JSON 摘要使用既有 `outcomeDigest(manifest)`，附件用 `evalDigest(bytes)`。独立锁定 `--capture-digest`，保留附件原始字节；摘要不是签名或第三方认证。所有附件路径必须精确相对 `--capture-root`，无 `..`/symlink，单附件最多 16 MiB。示意：

```json
{
  "schema": "chainlesschain.verify01-host-capture/v1",
  "sampleId": "verify-02",
  "planDigest": "sha256:<冻结计划摘要>",
  "reviewDigest": "sha256:<已审阅配置摘要>",
  "projectCommit": "b2aa3aba082873570e85dce39b00754e5504ff37",
  "sourceCommit": "<被测CLI的40位源码SHA>",
  "entry": "vscode",
  "platform": "win32",
  "os": "Windows 11 24H2",
  "arch": "x64",
  "node": "v22.12.0",
  "host": "1.132.0",
  "runId": "<实际独立run身份>",
  "observedAt": "<实际完整观察结束ISO时间>",
  "elapsedMs": 12345,
  "retries": 0,
  "manualRepairs": 0,
  "failureCause": "unknown",
  "protocol": { "path": "protocol.json", "digest": "sha256:<原始字节摘要>" },
  "ui": { "path": "ui.json", "digest": "sha256:<原始字节摘要>" },
  "check": { "path": "check.json", "digest": "sha256:<原始字节摘要>" },
  "diff": { "path": "diff.json", "digest": "sha256:<原始字节摘要>" }
}
```

`sampleId` 必须从 `plan.json` 选择；示例 `verify-02` 是 Windows VS Code Volcengine 普通任务，不能换成本机 CLI。同一 manifest 只能导入一个样本；其余样本保留 missing。总时间须覆盖冷启动提交、完整协议、验收和重载操作，并在冻结窗口内。首次安装阶段另见后文。

`protocol.json` 是 observer 原样返回的数组，每条包含：

```json
{
  "schema": "chainlesschain.ide-protocol-record/v1",
  "generation": "<该session的UUID>",
  "sequence": 1,
  "at": "<采集ISO时间>",
  "direction": "output",
  "event": { "type": "system", "subtype": "init", "...": "实际CLI事件完整字段" }
}
```

序号从 1 连续，direction 为 input/output/exit，时间不倒退。input 是尝试写入；init 必须确认冻结 provider/model/permission_mode 与 `input_receipts.version:1`，接受事件的 `receipt.sessionId/clientMessageId/inputDigest/eventHash/duplicate` 必须来自实际 CLI。`duplicate` 必须 false；`inputDigest` 对应实际 frozen prompt、空 images、null llm 和 null worklogSessionId，不能自行补造。result 唯一且为最后一个 output；success、`is_error:false`、exit 0、无 signal 才表示成功执行。明确失败终态保留失败，缺费用/usage 保留 null。最后一个 record 必须是 exit，含整数 code、真实 signal 和 `stdoutDrained:true`。

成功样本的 `ui.json` 必须保存以下 6 个实际动作，按顺序为 `submit → background-tab → return-tab → final-result → reload → restored-result`。每条为 `{action,sampleId,sessionId,at}`；final/restored 另有 `resultDigest:evalDigest(UTF8终态文本)`，两处均须与真实 terminal 相同。submit 可早于 cold init，但不能晚于实际 input；result 操作不可早于 terminal，全部动作须在总观察范围内。摘要只绑定操作回执的文字，不能认证 GUI 自动化真实执行。

已验证的明确错误终态可保留这 6 步的非空有序前缀；例如持久化失败使重载后恢复不可完成，不得编造后续动作。若实际完成 final/restored，则其文本摘要仍须匹配原始错误文本（优先字符串 `terminal.error`，否则 `terminal.result`）。这一分支始终导入失败，不补成功或费用；缺终态、缺接受回执、空/乱序 UI 或无完整 check/diff 仍拒绝。此补充覆盖 error-only 持久化错误形状，不宣称所有生产错误和辅助技术旅程已经验证。

`check.json` 必须包含 `taskId`、`reviewDigest`、布尔 `pass`、`detail`、`changedFiles`、空 `unrelatedChanges`、实际 `process`。process 包含固定 `sourceDigest`（该题 reviewed check 字节摘要）、`exitCode:0`、`signal:null`、`error:null`、原始 `stdout`（单个 JSON verdict）及可选原始 stderr。stdout verdict 的 pass 必须与外层一致；PASS 必须包含全部 required deliverables。正文验收输出及 acceptance-evidence 回执也应保存供独立复核，不能仅手写 pass。

`diff.json` 使用已有执行器的完整变更形状：数组，每条 `{path,before,after}`。不存在的一侧为 null，其余侧必须为普通文件，包含 `type:"file"`、真实数值 `mode`、`dependency:false`、`digest`、`bytes` 和完整正文 `bytesBase64`。每侧字节长度和摘要需匹配；路径集合恰好等于 changedFiles，无重复、遗漏或额外未审改动。导入器无法凭声明证明扫描无遗漏，driver 应扫描冻结初始快照与结束工作区并保留独立审查材料，不能只取 Agent 自述的文件列表。

## 首次安装与 CLI 首次任务

first-run 样本必须另有 `firstRun:{cleanEnvironment:boolean,stages:{...}}`。stages 恰当记录 `install/configure/authenticate/tool/artifact` 的 `{passed:boolean,receipt:{path,digest}}`；五份非空原始回执都要保存，失败后各阶段不能申报成功。回执应包含真实公开下载/安装日志、空 profile、配置/授权结果及未运行原因，隐藏密钥。导入器核对字节及关系，**不认证公开安装或账号**。

`tool.passed:false` 早停时不得提供 protocol/stream/invocation/exit/check/ui/diff，不生成 Eval run；保留有效 `failureCause`、总耗时/重试/人工修复、显式 `cost:null` 或已有非负实际费用。即使没有运行任务，也保留已观察的安装失败，其余样本不删分母。

已进入工具阶段的 IDE 首次旅程仍需上述完整协议、UI、check 和 diff。CLI 首次旅程使用 `stream`（真实 stream-json stdout）、`exit`（含 code/signal/finishedAt）、`invocation` 代替 protocol/UI；这三者都是 byte-pinned 附件。invocation 包含实际 `taskId/prompt/provider/model/permissionMode/projectCommit/sourceCommit/startedAt`，精确绑定首次旅程所属任务，stream 必须含真实唯一 init，provider/model/mode/session 与冻结身份一致。CLI 完整旅程同样需 check/diff 和五阶段回执；普通 CLI 任务继续走冻结 suite 执行器。

## 只读导入命令

在仓库根目录，先用 `--help` 查看参数；下面占位符必须替换为真实、独立锁定的值：

```powershell
node packages/cli/scripts/verify01-host-import.mjs --plan-dir docs/research/cli/verify01-plan-2026-10-04 --plan-digest sha256:665a5254c32a9a267cec5e5c85ccb52f938cd0884470546a92f58fae5dcf87a0 --review <review.json> --review-digest sha256:<外部锁定review摘要> --review-root <review目录> --project-sha b2aa3aba082873570e85dce39b00754e5504ff37 --source-sha <被测CLI源码SHA> --manifest <capture.json> --capture-digest sha256:<外部锁定capture摘要> --capture-root <原始附件目录>
```

退出 1 为无效材料；退出 2 为仍缺完整基线。stdout 的 `history.runs` 使用既有 Eval schema，`observations` 使用既有 outcome schema，合并多样本后继续交给 `verify01-collection.mjs` 与 `task-outcome-report.mjs`。不同首次旅程不可复用同一 run/task；不允许将成功 retry覆盖失败首次尝试。没有正式材料时不要导入测试 fixture。

`identityVerified/installationVerified/billingVerified/productionAttested` 始终为 false。原始 evidence 的真实性、人工验收、准确候选 CI、模型账户/账单和维护窗口各有独立证据要求；导入成功不表示整体基线完整、改善 PASS 或发布准入。
