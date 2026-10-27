# CLI / IDE 差距优化第六批：MCP 紧凑目录与请求投影

日期：2026-10-27。承接[第五批检索记录](./cli-ide-mcp-search-progress-2026-10-27.md)，第五批已提交为 `9f7e71f194`。本批增加显式启用的紧凑 MCP 目录，处理初始请求中逐工具 stub 的线性增长问题。

## 启用方式

以下配置属于本批尚未发布的源码功能。默认仍为 `stubs`；已有配置不会自动迁移。

在 CLI 已支持的 `settings.json` 层中配置：

```json
{
  "mcp": {
    "toolSearch": {
      "enabled": true,
      "catalogMode": "compact",
      "maxResults": 5
    }
  }
}
```

也可在 PowerShell 中为后续启动的 CLI 进程设置：

```powershell
$env:CC_TOOL_SEARCH = '1'
$env:CC_TOOL_SEARCH_CATALOG = 'compact'
```

`CC_TOOL_SEARCH_CATALOG=stubs` 可恢复原展示方式。`enabled:auto` 仍使用已有 schema 成本阈值；`enabled:false` 继续关闭延迟加载。IDE 复用其 CLI 进程的设置与环境，新配置在后续进程启动时读取。

## 展示目录与执行权限分开

宿主继续保存完整的 MCP 定义、执行器、描述符及权限名单；`agentLoop` 的执行上限仍从完整目录计算。紧凑投影应用在模型请求与上下文预算入口，隐藏尚未发现的延迟工具 schema。

| 阶段         | 紧凑模式中的 MCP 工具定义                                  |
| ------------ | ---------------------------------------------------------- |
| 初始请求     | `tool_search` 及 `alwaysLoad` 固定加载项                   |
| 查看服务目录 | 不加载 schema，后续请求目录保持不变                        |
| 搜索选中工具 | 下一次请求加入选中工具的完整 schema                        |
| 调用选中工具 | 使用原工具名与原执行器，通过既有权限、Hook、账本及调度流程 |

新增投影由[共享 MCP 搜索模块](../../packages/cli/src/runtime/mcp-tool-search.js)提供，[Agent Core](../../packages/cli/src/runtime/agent-core.js)在预算规划与实际模型请求组装时使用它。没有新增通用转发工具，也没有把搜索结果当成执行授权。

模型看不到某个 schema 不代表宿主忘记了该工具的权限。反过来，模型搜索到候选也不会扩大原有权限：搜索与服务目录按当前宿主工具名单过滤；禁用工具仍不能被调用。

## 按需发现与更新

`tool_search` 保留关键词与 `select:<精确名称>` 查询。紧凑模式还支持 `query: "servers:"`，配合 `offset`、`max_results` 查看当前允许发现的延迟工具所在服务；固定加载项已直接出现在工具列表中。

服务目录默认沿用结果上限，最多 50 条一页；标签限制为 192 个 UTF-16 单元，超长标签明确标记截断，并在可用时提供精确工具名示例。分页本身不加载 schema，偏移针对当前 live 目录，不承诺目录更新前后的快照一致性。

发现的 schema 按首次加载顺序加入请求，已有选中项排在后续新增项前面。原始宿主目录保持原有引用及内容。默认 stub 模式继续保持此前的稳定工具前缀；紧凑模式的展示目录会随发现、撤销和 schema 变化而更新，缓存收益需要单独测量。

连接替换、stale 条目、移除和权限裁剪均继续生效。已有的未加载工具直接调用恢复路径保留，但先返回 schema，不先执行服务器操作。子代理继承继续使用原合同；缺少搜索入口的受限目录保留其原有展示方式。

## 来源记录与边界

[Headless 来源记录](../../packages/cli/src/runtime/headless-runner.js)和 [REPL 来源记录](../../packages/cli/src/repl/agent-repl.js)保存投影后的目录；`describeMcpToolContext()` 分别统计宿主完整目录和可见定义，提供紧凑模式及可见延迟项数量。

来源记录仍属于运行时观察，不代表最终 provider usage 或账单核验。本批没有提高现有 ledger 的验证等级，也没有把估算节省标记成真实费用收益。

已加载 schema 会累积，本批没有自动驱逐。宿主内存、完整目录扫描和搜索仍随工具数量增长；本批减少的是模型请求中 MCP 工具定义的初始展示成本。小目录、固定加载项较多或大量工具最终都被调用的场景，需要分别评估。

## 离线基线与验证

测量脚本：[紧凑目录基线](../../packages/cli/scripts/mcp-compact-catalog-benchmark.mjs)。复用第五批固定双语样本与目录生成器，比较相同权限目录在初始和选中五个 schema 后的展示成本。原始结果保存在[测量 JSON](./cli/evidence/mcp-compact-catalog-2026-10-27/catalog-benchmark.json)，记录 fixture 和实现摘要。

本机环境为 Windows x64、Node `22.22.2`、ICU `78.2`。下表只统计 MCP 额外工具定义的估算 token，不含内置工具、消息、返回 schema 的 tool result、缓存计费或实际 provider usage：

| MCP 工具数 | 原 stub 目录  | 紧凑初始目录 | 选中五个 schema 后 | 宿主保留定义数 |
| ---------- | ------------- | ------------ | ------------------ | -------------- |
| 200        | 11,402 token  | 225 token    | 1,955 token        | 201            |
| 1000       | 56,202 token  | 225 token    | 1,955 token        | 1001           |
| 5000       | 284,202 token | 225 token    | 1,955 token        | 5001           |

这批固定样本的初始 MCP 定义估算分别下降约 98.03%、99.60%、99.92%。它不代表总请求 token 或实际费用按同比例下降。初始可见额外定义为一个搜索入口；选中五个 schema 后为六个。各档全部固定查询在两种展示模式下返回相同排序，服务目录只返回首批五条且不预加载 schema。

报告继续保留 `providerCalls:0`、`providerUsageMeasured:false`、`billingVerified:false`、`taskQualityVerified:false`。第五批已提交的历史测量保持原样，没有用新实现重写旧证据。

| 检查             | 结果                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终组合回归     | 18 个文件、295 项通过，0 失败；覆盖紧凑目录、原检索、Provider 适配、权限上限、子代理继承、账本、上下文和模型 profile                         |
| 紧凑模式定向测试 | 14 项通过，包含在 295 项中；覆盖分页与标签上限、固定加载、直接调用恢复、权限裁剪、撤销及来源持久化                                           |
| 实际请求序列化   | OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Ollama 四条路径的模拟 HTTP 请求均检查初始及加载后定义；不作为真实账号连接证明 |
| 模拟 Agent 调用  | 搜索后可通过原权限与账本路径调用原 MCP 名称；禁用目标时不加载其 schema、不执行 MCP 调用；预算入口使用相同投影                                |
| 静态与证据检查   | JavaScript 语法、Prettier、实现与 fixture 摘要、本地链接及 `git diff --check` 通过                                                           |
| ESLint           | 本地仍缺少 `@eslint-community/eslint-utils`，未能启动，不记为通过                                                                            |

初轮组合回归曾发现两项夹具问题：新增来源测试未明确启用持久化及注入 `appendAuthorityEvent`；原有 MCP 配置测试会真实探测本机 Python / pip / Node / git 而碰到其 30 秒截止。现补齐显式测试存储确认，并通过已有环境探测注入点隔离无关进程；原 30 秒截止、权限和断开连接断言全部保留。生产持久化、环境探测和权限逻辑未因此放宽。最终 295 项为修正后的结果，早期定向次数不重复累加。

```bash
# packages/cli；只计算本地工具定义估算，不请求真实模型或 MCP 服务
node scripts/mcp-compact-catalog-benchmark.mjs --output ../../docs/research/cli/evidence/mcp-compact-catalog-2026-10-27/catalog-benchmark.json

# 最终组合回归
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/mcp-compact-catalog.test.js __tests__/unit/mcp-compact-catalog-benchmark.test.js __tests__/unit/mcp-tool-search.test.js __tests__/unit/mcp-tool-search-benchmark.test.js __tests__/unit/agent-tool-search-loop.test.js __tests__/unit/agent-core-openai-responses.test.js __tests__/unit/agent-core-tool-capability-fence.test.js __tests__/unit/agent-core-tool-admission.test.js __tests__/unit/subagent-inheritance.test.js __tests__/unit/agent-core-mcp-ledger.test.js __tests__/unit/headless-runner-mcp-ledger.test.js __tests__/unit/context-breakdown.test.js __tests__/unit/context-source-ledger.test.js __tests__/unit/mcp-tool-metadata-budget.test.js __tests__/unit/agent-mcp-config.test.js __tests__/unit/agent-core-python-cache.test.js __tests__/unit/provider-context-image-transport.test.js __tests__/unit/provider-model-profile.test.js --maxWorkers 1
```

本批尚未发布，也未进行真实账号的付费请求及任务 A/B。发布仍受准确提交、三系统 CI 与既有发行顺序约束；正式任务 campaign、native 准入和账单核验继续独立跟踪。
