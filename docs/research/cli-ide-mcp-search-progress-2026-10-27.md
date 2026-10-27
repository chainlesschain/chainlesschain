# CLI / IDE 差距优化第五批：MCP 中文检索与大目录基线

日期：2026-10-27。承接[差距复核报告](./cli-ide-codex-claude-gap-review-2026-10-27.md)第 4.7 节及[第四批会话模型记录](./cli-ide-session-model-progress-2026-10-27.md)。本批处理 MCP 工具发现的词法检索质量，并建立可复跑的离线目录规模测量。

## 已修复行为

原搜索只按空格、逗号拆词。例如查询“请帮我读取文件内容”，无法把完整句子与描述中分散的“读取”“文件”“内容”对应起来；同一词重复出现也会重复加分，单个宽泛名称命中可能排在覆盖整个请求的候选前面。

新增[检索排序模块](../../packages/cli/src/runtime/mcp-tool-search-ranking.js)，由原有 [MCP 搜索入口](../../packages/cli/src/runtime/mcp-tool-search.js)调用：

- 使用 Node 的 `Intl.Segmenter` 拆分中文词语，识别常见中文标点，过滤自然语句中的部分虚词。
- 在关键词匹配阶段统一 NFKC 和大小写，使全角关键词可以匹配对应文本；驼峰工具名称补充单词边界。
- 对重复查询词去重，先比较覆盖了多少查询词，再保留名称与描述命中的 3:1 权重；同分使用稳定的名称顺序。
- 只维护前 K 个排序候选；关键词路径直接扫描现有目录，避免每次查询都复制完整目录。
- 通过 WeakMap 复用每个目录条目的标准化文本。描述变化时重新生成；该缓存不保存额外 schema 或调用权限。

这仍是词法搜索。它没有自动翻译模型、同义词扩展、向量调用或跨语言语义保证；英文与中文查询分别需要名称或描述中存在相应词语。

## 原有调用与权限边界

`select:<名称>` 继续使用精确身份匹配，不将全角名称或相似拼写当成另一个工具。`+term` 继续要求名称包含指定片段，片段不做中文拆分或虚词过滤。单独使用 `help` 等英文词时仍可搜索同名工具。

搜索不会标记 schema 已加载，也不会改写发给模型的工具列表。`executeToolSearch()` 仍只加载实际返回的候选；直接调用未加载工具的既有 schema 提示与恢复路径保留。

条目撤销、连接替换或 schema 更新仍通过原有目录与执行器代次判断。排序缓存不能把已移除、stale 或旧连接的条目重新加入结果。新增回归覆盖热查询后替换描述、替换执行器、标记 stale、删除条目，以及不同连接顺序下的相同前 K 个结果。

## 可复跑的离线测量

新增[固定样本](../../packages/cli/__tests__/fixtures/mcp-tool-search-multilingual-v1.json)与[测量脚本](../../packages/cli/scripts/mcp-tool-search-benchmark.mjs)，完整结果保存为[测量 JSON](./cli/evidence/mcp-tool-search-2026-10-27/lexical-benchmark.json)。

样本包含 12 个双语工具、18 条正查询及 4 条负查询，覆盖文件、工单、消息、数据库、部署、截图、混合文字和全角输入；以无关目录条目补足 200、1000、5000 工具。它是固定合成目录，未覆盖真实生态中的歧义、恶意描述、同义词和跨语言翻译。

旧比较器复现此前按空格、逗号拆词的包含匹配，并与新排序器使用同一目录和 stale 过滤。两个比较器均不执行工具或加载 schema。每档预热后交替运行两个比较器，各测 110 次；记录 Node、ICU、系统、CPU、fixture 摘要和实现文件摘要。

测量环境：Windows x64、Node `22.22.2`、ICU `78.2`、Intel Core i7-4770HQ @ 2.20GHz。以下为最终源码的一次本机测量，不作为专用硬件 SLO：

| 工具数 | 旧 Recall@5 | 新 Recall@5 | 旧热查询 p95 | 新热查询 p95 | 新目录首次查询 |
| ------ | ----------- | ----------- | ------------ | ------------ | -------------- |
| 200    | 27.8%       | 100%        | 0.82ms       | 0.79ms       | 7.50ms         |
| 1000   | 27.8%       | 100%        | 4.90ms       | 3.11ms       | 6.79ms         |
| 5000   | 27.8%       | 100%        | 13.73ms      | 9.73ms       | 52.71ms        |

每档新 MRR 为 1，旧 MRR 为 0.278；两者负查询误召回均为 0/4。新排序的候选准确比例为约 56.0%，旧比较器约 18.5%；召回完整并不表示所有候选都适合调用。

延迟从已经构建的 deferred 目录开始计时，不包括连接、schema 准入及 CLI 启动。首次查询每档只测一次，指该目录文本缓存尚未建立，不代表独立进程冷启动；热查询每档各 110 次。不同档位沿用同一进程的 ICU 状态，GC 与外部负载可能影响结果。原始样本、实现摘要与每条查询排序均保留在 JSON 中。

指标含义：Recall@5 是每条正查询召回相关工具的比例再取平均，多相关工具查询不会被当成单次命中率；MRR 使用首个相关候选的名次。候选准确比例按实际返回数量计算。负查询误召回与工具误调用是不同指标，本批没有执行真实工具任务，因此不报告误调用率。

## 初始上下文与成本

本批仍为每工具一个 stub。工具数量增长时，初始工具目录仍线性增长；关键词排序没有减少工具列表中的 stub 数量。JSON 中的完整 schema 和 stub token 均为项目现有估算器的结果。

| 工具数 | 完整 schema 目录估算 | stub 目录估算 |
| ------ | -------------------- | ------------- |
| 200    | 69,512 token         | 11,402 token  |
| 1000   | 347,112 token        | 56,202 token  |
| 5000   | 1,735,112 token      | 284,202 token |

这两列反映已有 schema 延迟加载的差别。新旧排序器共享完全相同的 stub 列表，因此本批没有新增的初始目录 token 节省；5000 工具时目录仍明显偏大。

报告保留 `providerCalls:0`、`providerUsageMeasured:false`、`billingVerified:false`、`taskQualityVerified:false`、`semanticRecallMeasured:false`。没有把样本召回提高、已有 schema 延迟加载节省或毫秒级本地延迟写成真实任务通过率及费用下降。

紧凑 server / namespace 目录、最终 provider 请求来源归因、真实任务 A/B、同义词与语义召回仍需后续实现和独立验收。

## 验证与复跑

| 检查              | 结果                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 最终定向回归      | 10 个文件、206 项通过，0 失败；覆盖检索、模拟 Agent 循环、metadata 预算、配置与调用账本、上下文统计、环境缓存           |
| 检索与 Agent 路径 | 精确名称、英文自然语句及连续中文搜索后，schema 在 tool result 中返回，实际模拟 MCP 调用成功；工具列表引用及内容保持稳定 |
| 测量合同          | 验证 Recall 的分母、多相关工具、负查询误召回、目录不变、零 schema 预加载及有限测量参数                                  |
| 静态与证据检查    | JavaScript 语法、Prettier、实现与测量摘要、本地文档链接及 `git diff --check` 通过                                       |
| ESLint            | 本地缺少 `@eslint-community/eslint-utils`，未能启动；不记为通过                                                         |

复测中 `headless-runner-mcp-ledger.test.js` 的首个恢复用例曾连续超过原有 15 秒截止。分阶段诊断显示耗时集中在进入 MCP 解析前的环境探测；该夹具此前会真实探测本机 Python、pip、Node 和 git，并允许环境中的 MCP 自动发现。现通过已有 `_environmentProcessDeps` 测试注入点和显式空 MCP 解析隔离这些无关依赖；需要模拟调用的用例继续提供自己的连接。原有 15 秒上限、恢复拒绝和同一会话写入断言全部保留，生产环境探测与账本逻辑未改。最终加入环境缓存合同共同复测，206 项全部通过。

早期的 48 项及 203 项分批检查包含在最终回归中，不重复累加。所有模型与 MCP 调用均为注入的本地模拟；本批没有执行真实付费调用。

```bash
# packages/cli：离线基线，不请求真实模型或 MCP 服务
node scripts/mcp-tool-search-benchmark.mjs --output ../../docs/research/cli/evidence/mcp-tool-search-2026-10-27/lexical-benchmark.json

# 本批相关回归
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/mcp-tool-search.test.js __tests__/unit/mcp-tool-search-benchmark.test.js __tests__/unit/agent-tool-search-loop.test.js __tests__/unit/mcp-tool-metadata-budget.test.js __tests__/unit/agent-mcp-config.test.js __tests__/unit/agent-core-mcp-ledger.test.js __tests__/unit/headless-runner-mcp-ledger.test.js __tests__/unit/context-breakdown.test.js __tests__/unit/context-source-ledger.test.js __tests__/unit/agent-core-python-cache.test.js --maxWorkers 1
```

本批为尚未发布的源码及本地离线证据。正式任务 campaign 的数量、付费与 native 准入、跨平台准确提交发布门禁继续分别跟踪，不据此关闭整份 MCP 或上下文验收。
