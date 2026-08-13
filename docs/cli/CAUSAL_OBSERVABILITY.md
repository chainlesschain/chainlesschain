# CLI 因果可观测性

`cc session observability` 把经过验证的 session 用量与 delivery flow 中的
diff、gate、artifact、PR 和 merge 结果放进同一份 JSON 报告。关联不是根据时间或
文件名猜测，而是由 delivery state 显式声明，并绑定到 session transcript 的精确
`headHash` 和 `eventCount`。

本功能适合生成团队交付报告和 CI 预算门。它不会导出 prompt、tool 参数、tool
结果或原始日志。

## 1. 为新 Agent session 写入 scope

创建 session 时用下面三个可选参数声明可观测性范围：

```bash
cc agent \
  --observability-workspace workspace-a \
  --observability-team team-a \
  --observability-policy policy-a \
  "完成并验证当前改动"
```

这些参数支持普通 headless、`--input-format stream-json` 和交互式 Agent。至少提供
一个参数后，新 JSONL session 的第一个 `session_start` 事件会写入：

```json
{
  "observabilityScope": {
    "workspaceId": "workspace-a",
    "teamId": "team-a",
    "policyId": "policy-a"
  },
  "usageTelemetryProtocol": "call-ledger",
  "usageTelemetryVersion": 1
}
```

未提供的维度会保存为 `null`。scope 字符串会去除首尾空白，最长 256 个字符，且
不能包含控制字符。

scope 是 session 创建时的 authority，不会在 resume 时被新参数覆盖。旧 session
若没有 `observabilityScope`，不能补写为可信 authority；需要创建新的 scoped
session。显式提供任一 observability scope 参数会自动启用 session 持久化，以便形成
可复核的 transcript authority；这些参数不能与 `--ephemeral` 同时使用，冲突会在
Agent 运行前被拒绝。

> `workspaceId`、`teamId` 和 `policyId` 是调用者声明并由 transcript 固定的标签。
> 它们不是组织成员资格、策略实际执行或 workspace 所有权证明。

### 调用级用量账本（`call-ledger@1`）

带 scope 的新 session 会同时声明 `usageTelemetryProtocol: "call-ledger"` 和
`usageTelemetryVersion: 1`。账本为每次可能计费的模型调用生成有界 `callId`，并只保留
provider、model、source 和计量结果；source 取值为 `model`、
`semantic-compaction` 或 `subagent`。已知用量还可保存经过长度和控制字符净化的调用归因标签
（origin、skill、subagentId、role、parentSessionId 和 depth），用于区分嵌套调用来源。它不保存
prompt、响应正文、provider 错误文本或工具参数/结果。

每个模型调用必须按以下顺序形成一对记录：

1. 在进入 provider 调用前持久化 `model_usage_started`；
2. provider 返回结构合法的用量时，用同一 `callId` 写入 `token_usage`，状态为已知；
3. provider 调用失败、未返回合法用量，或 transport 结果无法确定时，用同一 `callId`
   写入 `model_usage_unknown`，状态为未知。

`model_usage_unknown` 只保留归一化代码：`provider_call_failed`、
`provider_usage_missing` 或 `provider_transport_outcome_unknown`。只有 started、没有结算的
调用也会在 verified projection 完成时计为未知。重复结算、无 started 的模型结算，或
同一 `callId` 的 provider/model/source 发生变化会直接使报告失败，而不会猜测或按零
用量处理。声明了协议却没有任何模型 started 证据，以及未声明协议的旧 session，都会
把用量完整性标为未知。

自动 LLM 重试会另写 `llm_retry`，用于 `maxRetries` 计数和按原因/模型汇总。因为失败的
provider 尝试仍可能产生未上报费用，每条 `llm_retry` 也会加入未知用量证据；因此 token、
USD 和 retry-ratio 预算不能仅凭后一次成功调用判为通过。严格账本还会关闭无法逐次加括号
记录的透明跨 provider fallback，避免隐藏额外尝试。

工具调用使用相同原则：执行前写入 `tool_call_started`，完成后用同一 ID 和 tool 名写入
`tool_call` settlement，其中包含错误状态和可用的 `duration_ms`。一批并行工具会先写完
该批所有 started 边界，再开始执行。缺少 started、ID、settlement 或 duration 会降低
tool telemetry/timing coverage；重复或改名结算会使报告失败。工具 P50/P95 只使用合法
的非负毫秒样本。

## 2. 取得可粘贴的 session binding

在 session 完成后，用精确 session ID 读取当前 transcript authority：

```bash
cc session observability-authority <session-id> --json
```

输出示例：

```json
{
  "causality": {
    "scope": {
      "workspaceId": "workspace-a",
      "teamId": "team-a",
      "policyId": "policy-a"
    },
    "sessions": [
      {
        "sessionId": "session-a",
        "headHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "eventCount": 123
      }
    ]
  }
}
```

命令输出已经是可粘贴的 delivery 配置片段，直接把整个 `causality` 对象放进
delivery-init 配置即可：

```json
{
  "causality": {
    "scope": {
      "workspaceId": "workspace-a",
      "teamId": "team-a",
      "policyId": "policy-a"
    },
    "sessions": [
      {
        "sessionId": "session-a",
        "headHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "eventCount": 123
      }
    ]
  }
}
```

应在 contributing session 不再追加事件后获取 binding。之后若继续 resume 或写入该
session，transcript head/count 会变化，旧 delivery binding 会被报告命令判为 stale，
而不会悄悄归因到新内容。

## 3. 在 delivery state 中固定关联

把 `causality` 与常规 delivery-init 配置放在同一 JSON 对象中：

```json
{
  "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "diff": {
    "baseCommitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "headCommitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "digest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "changedFiles": ["src/example.js"]
  },
  "environment": {
    "os": "linux",
    "arch": "x64",
    "runtime": "node",
    "runtimeVersion": "22.12.0",
    "dependencyDigest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  },
  "requiredGates": [{ "id": "cli-ci", "always": true, "matrix": ["linux"] }],
  "analysis": {
    "confidence": 1,
    "dependencyGraphComplete": true,
    "languageServicesComplete": true,
    "testHistoryComplete": true,
    "classifications": [
      {
        "path": "src/example.js",
        "language": "javascript",
        "ecosystem": "npm",
        "confidence": 1
      }
    ]
  },
  "unverified": [],
  "sideEffects": [],
  "causality": {
    "scope": {
      "workspaceId": "workspace-a",
      "teamId": "team-a",
      "policyId": "policy-a"
    },
    "sessions": [
      {
        "sessionId": "session-a",
        "headHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "eventCount": 123
      }
    ]
  }
}
```

然后初始化 delivery flow：

```bash
cc artifacts delivery-init delivery-config.json --json
```

`delivery-init` 返回一个 envelope；`cc session observability` 需要的是其中的原始
`state` 对象，而不是整个 envelope。例如可用 `jq` 保存：

```bash
cc artifacts delivery-init delivery-config.json --json \
  | jq '.state' > delivery-state.json
```

`causality` 会进入 flow identity 和 `stateDigest`，后续 delivery state revision 会
继续保留它。每个 delivery 最多绑定 128 个唯一 session；每个 binding 必须包含安全
session ID、64 位十六进制 `headHash` 和正整数 `eventCount`。要进入同一份报告，同一
delivery 绑定的所有 session scope 必须与 `causality.scope` 完全相同，包括值为
`null` 的维度。

旧 delivery state 可以没有 `causality`。这类 state 在无 scope filter 时仍能进入报告，
但会产生 `delivery-session-link-missing` evidence gap，不能提供 token 到 delivery 的
关联。

## 4. 创建 observability request

报告命令读取一个 request JSON。`deliveryStates` 至少包含一个路径；相对路径以
request 文件所在目录为基准：

```json
{
  "schema": "chainlesschain.causal-observability-request",
  "version": 1,
  "deliveryStates": [
    "delivery-state.json",
    "releases/second-delivery-state.json"
  ],
  "filter": {
    "workspaceId": "workspace-a",
    "teamId": "team-a",
    "policyId": "policy-a"
  },
  "budgets": {
    "maxTokens": 100000,
    "maxUsd": 5,
    "maxRetries": 2,
    "maxRetryRatio": 0.1,
    "maxToolP95Ms": 500
  }
}
```

`schema` 和 `version` 可省略，但推荐显式写出。重复的 delivery path 会去重。

### 过滤

`filter` 支持 `workspaceId`、`teamId` 和 `policyId`。已提供的维度按精确值匹配，多个
维度之间是 AND；省略或 `null` 表示该维度不限制。过滤对象匹配的是 delivery state
中受 `stateDigest` 保护的 `causality.scope`，报告只包含匹配 delivery 及其关联 session。

命令行过滤会覆盖 request 中同名的已定义字段：

```bash
cc session observability request.json \
  --workspace workspace-a \
  --team team-a \
  --policy policy-a
```

显式命令行过滤值必须是非空字符串；例如 `--workspace ""` 或只有空白的值会被拒绝，
而不会退回 request 中的值。

命令仍会验证 request 所列的全部 delivery state，但会先按 filter 选择 delivery，再只
读取入选 delivery 关联的 session。因此，未入选 delivery 的 transcript 损坏或不可用
不会阻塞目标报告；入选 session 的 authority 验证不会被过滤绕过。在入选集合中，
相同 `flowId` 和相同 `stateDigest` 的重复 delivery authority 会去重；相同 `flowId`
出现不同 `stateDigest` 会在读取任何 session 前失败。

### 预算与告警

支持以下上限：

| 字段 / 参数                           | 指标                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `maxTokens` / `--max-tokens`          | 聚合 input + output + cache-read + cache-creation token |
| `maxUsd` / `--max-usd`                | 可计价 token 的估算 USD                                 |
| `maxRetries` / `--max-retries`        | 自动 LLM retry 次数                                     |
| `maxRetryRatio` / `--max-retry-ratio` | `LLM retries / token-usage calls`，范围 0..1            |
| `maxToolP95Ms` / `--max-tool-p95-ms`  | tool latency P95，毫秒                                  |

命令行提供的预算逐字段覆盖 request，其他 request 预算继续生效：

```bash
cc session observability request.json \
  --max-tokens 100000 \
  --max-usd 5 \
  --max-retries 2 \
  --max-retry-ratio 0.1 \
  --max-tool-p95-ms 500 \
  --strict-budget
```

实际值严格大于上限才是 `exceeded`；等于上限仍为 `within_budget`。报告完整且有数据时，
未配置任何上限的状态为 `not_evaluated`。

以下情况不会被误报为通过，而是 `unknown`：

- 模型调用结算为 `model_usage_unknown`、只有 started 没有结算、出现 `llm_retry`，或
  session 没有完整的 `call-ledger@1` 协议证据；
- 配置了 token 上限但存在上述未知用量时，除非已知 token 下界已经越界；
- 配置了 USD 上限，但存在未知用量或无法计价的 token；
- 配置了 retry-ratio 上限，但模型用量不完整，或有 retry 却没有已知 token-usage
  settlement 可作分母；
- 配置了 tool P95 上限，但没有 latency 样本、tool timing coverage 小于 100%，或工具
  started/settlement 账本不完整；唯一例外是把所有缺失 duration 保守按 `0ms` 补齐后计算的
  nearest-rank P95 下界仍严格大于上限，此时即使观测不完整也可确定为 `exceeded`；
- filter 没有选中任何 delivery，报告 completeness 为 `no_data`；
- 已选 delivery 缺少 session binding 等因果证据，报告 completeness 为 `partial`。

`no_data` 报告的 totals 为零并包含 `causal-selection-empty` 告警；`partial` 报告包含
`causal-evidence-incomplete` 告警。两者的预算状态都是 `unknown`，因此配合
`--strict-budget` 时退出码为 2，即使没有数值预算越界。

每个 session 通过 verified projection reader 流式聚合；投影只保留有界汇总，不把原始
event 数组载入报告生成器。每个 session 最多保留 100,000 个 tool timing 样本，超过上限
会失败关闭；报告最多选择 512 个唯一 session，并在读取 transcript 前检查该上限。P50/P95 使用 nearest-rank。session 投影不会保留 prompt 或 tool payload，但会在上述固定上限内保留 duration 数值以计算分位数。
因此报告级 tool P95 采用所有已选 session P95 的最大值
（`conservative-max-session-p95`）；它是不会低估任一 session P95 的保守预算值，
不是把所有原始 tool 样本重新合并计算。session 的 `tools.p95DurationLowerBoundMs` 与 totals 的
`toolP95DurationLowerBoundMs` 使用“缺失样本按 `0ms`”得到可证明的数学下界；不完整样本触发的
`tool-latency-budget-unobserved` alert 同时输出观测值 `actual` 和该 `lowerBound`。retry ratio 是基于已记录 token-usage call
的近似比率。`maxRetries` 直接比较已记录 retry 次数；未知模型用量不会抹掉这个计数，
但会让 token、USD 和 retry-ratio 的结论保持保守。

USD 是模型价格表计算的估算值，不是供应商账单。当前实现会应用本地
`llm.pricing` 覆盖进行估价；报告的 `pricing.tableDigest` 绑定本次实际使用的合并价格表。

## 5. 输出和退出码

直接输出 JSON：

```bash
cc session observability request.json
```

私有文件导出：

```bash
cc session observability request.json \
  --output reports/causal-observability.json \
  --strict-budget
```

`--output` 的父目录必须已存在并通过可信路径/身份检查。目标必须尚不存在；命令绝不
覆盖已有文件。报告先写入同目录的 owner-only 临时文件，再用 hard link 原子发布到
目标；如果另一个进程抢先创建目标，发布会失败。临时 link 删除后，再验证目标的
owner-only 权限（Windows 同时应用私有 ACL）。
目标已存在或并发创建时命令返回 1，原文件内容保持不变。

不带 `--output` 时 stdout 始终是 JSON，`--json` 可省略。带 `--output` 且不带
`--json` 时 stdout 输出最终绝对路径；同时带 `--json` 时不额外输出路径，报告只写入
文件。错误写到 stderr。

| 退出码 | 含义                                                                     |
| ------ | ------------------------------------------------------------------------ |
| `0`    | 报告成功；未使用 strict gate，或预算为 `within_budget` / `not_evaluated` |
| `1`    | request、文件身份、delivery/session authority、scope 或导出失败          |
| `2`    | 报告已成功生成，但 `--strict-budget` 下预算为 `exceeded` 或 `unknown`    |

退出码 2 时报告仍会先写入 stdout 或 `--output` 文件，便于 CI 保存告警证据。

## 6. 报告内容

报告 schema 为 `chainlesschain.causal-observability-report` version 1，主要包含：

- `authority`：已验证 session/delivery 数量、用量协议/tool telemetry 完整性和 evidence
  gaps；
- `totals`：input/output/cache-read/cache-creation/预算 token、估算 USD、unpriced token、
  LLM retry、tool call/error/retry、耗时与 timing coverage；
- `budget`：规范化上限、逐项 alert 和总状态；
- `deliveries`：diff digest 与文件数、gate 选择/结果、artifact、PR、merge；
- `sessions`：精确 transcript authority、scope、`call-ledger` assurance、模型用量完整性与
  `unknownEvidence`、retry 和聚合 tool 指标；
- `graph`：`session -> delivery -> diff/gate/artifact/pr/merge` 节点和边；
- `reportDigest`：对除自身外的规范化报告内容计算的 SHA-256 摘要。

`totals.totalTokens` 保留 input + output 语义；`totals.budgetTokens` 还会加上
cache-read 与 cache-creation，并作为 `maxTokens` 的实际比较值。

同一 session 被多个 delivery 引用时，用量只在 totals 中计算一次。delivery 投影只输出
changed-file 数量，不输出文件路径；session 投影不包含 prompt、tool 参数、tool 结果或
原始日志。模型名、tool 名、MCP/plugin 名、scope、commit SHA、artifact ID 和 PR 编号
仍属于报告元数据，分享前应按组织策略处理。

## 7. 验证与保证边界

报告生成会 fail closed 检查：

1. request 和 delivery 输入必须是最大 16 MiB 的有效 UTF-8 JSON、普通单硬链接文件；
   读取期间路径/句柄身份或文件大小发生变化会失败。
2. delivery state 必须通过 schema/version、`stateDigest` 和 hash-chained lineage 验证。
3. session transcript 在 writer lock 下完成整条 hash chain、持久化 head/count sidecar 和
   machine-local anti-rollback witness 验证。
4. delivery binding 的 `headHash`、`eventCount` 必须与当前 verified transcript 精确一致。
5. session `observabilityScope` 必须与 delivery `causality.scope` 完全一致。
6. `call-ledger@1` 的协议/version 标记必须成对且受支持；模型/工具调用 ID 的重复结算、
   无 started 的模型结算和 provider/model/source/tool 身份变化会失败。
7. canonical session JSONL 的每条物理记录最多为 16 MiB（UTF-8 bytes）；写入时在 append 前、
   正向/反向读取和尾记录修复时在 UTF-8 decode / `JSON.parse` 前执行同一上限，超限会以
   `CC_SESSION_JSONL_RECORD_TOO_LARGE` 失败关闭。

scoped session 的运行时写入同样 fail closed。模型或工具的 started 记录必须先成功持久化，
provider 或工具实现才会开始；started 写失败时不会发起该调用。已执行调用的 known/unknown
或 tool settlement 写失败属于终止性错误，会中止当前运行并阻止后续计费调用。若进程在
started 与 settlement 之间崩溃，之后的 verified projection 会把该模型调用或工具调用
保守标为未结算，而不会当作零费用或零延迟。语义压缩、子 Agent 和隔离 Skill 的模型调用、
自动重试及工具调用也使用同一真实调用 ID 和严格写前/结算边界；子调用会逐次转发真实明细，
不会用聚合计数或合成调用 ID 代替。

这些检查证明“某个受摘要保护的 delivery state 声明关联到某个精确、已验证的 session
revision”。它们不证明：

- 某个 token 或 tool call 在语义上造成了特定 hunk；关联是 delivery 作者的显式声明；
- scope 标签对应真实组织身份、成员关系或实际生效的策略；
- session/delivery/report 来自可信远端签名者；这些摘要不是数字签名；
- 估算 USD 等于最终账单；
- machine-local anti-rollback witness 可替代跨机器透明日志或外部公证。

`reportDigest` 包含 `generatedAt`，因此相同输入在不同时间重新生成时通常会得到不同
digest。若报告需要长期审计，应连同原始 verified delivery state、session authority
和生成环境证据一起归档。
