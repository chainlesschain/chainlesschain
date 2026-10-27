# CLI / IDE 差距优化第七批：Skills 多语言目录检索

日期：2026-10-27。承接[差距复核](./cli-ide-codex-claude-gap-review-2026-10-27.md)与[实施计划 CTX-03](./cli-ide-codex-claude-implementation-plan-2026-10-15.md#ctx-03-衡量并降低无关上下文)。上一批 MCP 紧凑目录已提交为 `b9968d5060`。本批处理技能描述检索，不改变技能正文的加载与执行规则。

## 已复现的问题与修复

源码基线 `b9968d50609540e6d04612a30482aed72bc0a43a` 的本地纯函数探针复现以下问题，没有调用模型或执行技能：

| 请求           | 描述或技能名                      | 修复前             | 本批结果       |
| -------------- | --------------------------------- | ------------------ | -------------- |
| `repair tests` | `repairTests`；描述未重复这两个词 | 无候选             | 可找到目标     |
| `Ｖｉｔｅｓｔ` | 描述包含 `Vitest`                 | 无候选             | 可找到目标     |
| 数据导出       | 仅有“数字时钟”技能                | 因共享“数”字而选中 | 无候选，不选择 |

新增[技能检索分词器](../../packages/cli/src/lib/skill-search-tokenizer.js)，使用 NFKC 归一化及 `Intl.Segmenter` 中文词边界，过滤常用请求套话；支持中文、英文、混合请求与带重音文字。拆分 camelCase、HTTP 等缩写边界、kebab-case 和 snake_case，同时保留原复合名称词项，兼容小写精确名称检索。

[共享检索路由](../../packages/cli/src/lib/skill-retrieval-router.js)使用该分词器，因此 `cc skill search` 与 Agent 的 `list_skills` 采用相同的描述检索逻辑。[BM25 引擎](../../packages/cli/src/lib/bm25-search.js)新增可选的领域分词器；其他 RAG 调用继续使用原默认分词行为。

只索引名称、显示名、标签、描述和分类。技能正文不参与召回；排序仍使用原 BM25、已验证向量与 outcome 合同。原有内容摘要、撤销、路径、OS、能力、命名空间、同名冲突和子代理技能名单继续生效。检索候选不授予执行权限。

主计划同步移除了负责人、责任角色列和人天估算，保留工作包、优先级、依赖与验收条件。

## 文件目录测量

新增[固定双语样本](../../packages/cli/__tests__/fixtures/skill-search-multilingual-v1.json)和[离线测量脚本](../../packages/cli/scripts/skill-search-benchmark.mjs)，实际生成 50 / 200 / 500 份 `SKILL.md`，经生产 loader 与 `list_skills` 入口验证；与共享路由结果逐条比较。

原始结果：[search-benchmark.json](./cli/evidence/skill-search-2026-10-27/search-benchmark.json)。包含样本和源码摘要、环境、逐条候选及延迟；本机 Windows x64、Node `22.22.2`、ICU `78.2`。

每档使用相同的 17 条固定请求：13 条正例、4 条负例。延迟采集重复 8 轮，共 136 次，每次重建描述词法索引，统计范围不包含文件发现及工具派发。

| 技能数 | 固定正例 Recall@5 | 正例错误选择 / 负例选择 | 检索 p95 | 完整目录估算 token | 首屏 20 项估算 token |
| ------ | ----------------- | ----------------------- | -------- | ------------------ | -------------------- |
| 50     | 13/13             | 0 / 0                   | 9.06ms   | 1,857              | 751                  |
| 200    | 13/13             | 0 / 0                   | 29.83ms  | 7,482              | 751                  |
| 500    | 13/13             | 0 / 0                   | 67.64ms  | 18,732             | 751                  |

六项目标技能均位于首屏之外，仍可按描述找到。三档在检索前后均保持正文缓存为 0；显式 materialize 一个选中技能后缓存为 1，并验证正文中的固定约束标记存在。正文专有标记作为负例，不能用于描述检索。

上述 token 仅按目录结果数组序列化后的 UTF-8 字节数除以 4 估算，不含工具结果外壳、路由证据、其他上下文或实际账单。分页能力此前已实现，本批提供新测量，不将分页收益归因于本批分词修复。描述发现仍需读文件验证内容身份；正文缓存为 0 不代表没有文件 I/O。

## 验证与后续边界

本批定向回归覆盖全角、中文单字误匹配、混合请求、Unicode、名称词边界、原名称检索、分页外召回及受限技能列表；另核验正文按需加载及无 provider 请求。新增 BM25 领域分词器验证覆盖 index / add / search / remove。

| 检查           | 结果                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终组合回归   | 17 个套件、252 项通过，0 失败；包含 Skills 路由、CLI 与 Agent 入口、决策、向量 authority、撤销、Windows 持久存储运行时复核、预算、loader 和来源记录 |
| 离线目录测量   | 50 / 200 / 500 项全部完成；每档 17 条固定请求、136 次计时；无 provider 调用                                                                         |
| 静态与证据检查 | 修改的 JavaScript 语法、代码与新增文档 Prettier、`git diff --check`、源码和样本摘要及 148 个本地文档链接通过                                        |
| ESLint         | 缺少本地依赖 `@eslint-community/eslint-utils`，未能启动，不计为通过                                                                                 |

最终组合回归耗时约 252 秒，包含既有 Windows 私有存储进程测试；未修改其超时或放宽持久化合同。早期定向回归已被上述组合结果覆盖，不重复累计测试数。

复现命令：

```bash
# packages/cli；仅本地描述检索、临时文件和正文加载，无模型请求
node scripts/skill-search-benchmark.mjs --output ../../docs/research/cli/evidence/skill-search-2026-10-27/search-benchmark.json

node ../../node_modules/vitest/vitest.mjs run __tests__/unit/skill-search-tokenizer.test.js __tests__/unit/skill-search-benchmark.test.js __tests__/unit/skill-retrieval-router.test.js __tests__/unit/skill-retrieval-router-benchmark.test.js __tests__/unit/skill-command-search.test.js __tests__/unit/bm25-search.test.js __tests__/unit/agent-core-skill-mcp.test.js __tests__/unit/agent-core-skill-path-scope.test.js __tests__/unit/agent-core-skill-decision.test.js __tests__/unit/skill-runtime-revalidation.test.js __tests__/unit/skill-retrieval-revocation-authority.test.js __tests__/unit/skill-retrieval-revocation-ledger-adapter.test.js __tests__/unit/skill-vector-authority.test.js __tests__/unit/skill-host-budget.test.js __tests__/unit/skill-loader-lazy-body.test.js __tests__/unit/skill-loader.test.js __tests__/unit/context-source-ledger.test.js --maxWorkers 1
```

固定样本只能证明这些描述请求的召回和选择；没有执行实际技能任务或同题模型 A/B，不推导真实误调用率与任务收益。分词依赖 Node / ICU 版本；中文同义词、跨语言语义检索及更复杂的歧义仍需独立样本评估。当前路由仍为每次查询重建索引，500 项延迟不能外推更大目录的 SLO。

保留 `providerCalls:0`、`providerUsageMeasured:false`、`billingVerified:false`、`taskQualityVerified:false`。本批尚未发布，不改变现有付费、native 和正式任务验收状态。
