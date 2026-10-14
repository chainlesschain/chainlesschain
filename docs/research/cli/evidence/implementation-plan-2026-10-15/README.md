# CLI / IDE 首轮实施证据（2026-10-15）

对应[实施计划](../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md)。本目录保存工程回归、fixture 测量、真实火山诊断和公开元数据，不构成正式 36+9 或发布验收通过证明。时间戳采用 UTC；本机为 Windows x64、Node 22.22.2、i7-4770HQ、约 16GiB 内存。

JSON / XML 保留原始字节，避免 Git 换行转换导致摘要失配；Windows JUnit XML 的 CRLF 通过局部属性声明为合法行尾，其他空白检查保留。

## 1 实际结果

| 检查                                               | 结果                                                                                 | 原始证据                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| CLI / VS Code 页面定向回归，按文件去重             | 31 个文件、440 项断言通过                                                            | [validation-summary.json](./validation-summary.json)及其中关联的 Vitest JSON       |
| 正式预算 authority / transport、冻结计划、模型审查 | 84 项通过                                                                            | [budget-and-review-final.xml](./budget-and-review-final.xml)                       |
| VS Code goal 映射                                  | 2 项通过                                                                             | [vscode-goal-tests.xml](./vscode-goal-tests.xml)                                   |
| JetBrains ChatEvents                               | JDK 21 实际编译，33 项 JUnit 通过                                                    | [jetbrains-tests-final.xml](./jetbrains-tests-final.xml)                           |
| 火山功能诊断                                       | 5 请求、4 项功能检查通过；费用及输出上界未确认                                       | [volcengine-live.json](./volcengine-live.json)                                     |
| 技能与 MCP 目录 fixture                            | 50/200/500；默认 20 个描述、被省略技能可检索、选中后仅加载 1 个正文、精确 MCP schema | [context-loading-final.json](./context-loading-final.json)                         |
| 100K Memory 显式缓存模式                           | 五次采样热查询 p95 854.300ms；查询结果摘要一致                                       | [memory-query-verified-cache-final.json](./memory-query-verified-cache-final.json) |
| 正式任务 / 首次安装                                | `NOT_RUN`，0/36、0/9                                                                 | [baseline-delivery.json](./baseline-delivery.json)                                 |
| 正式预算 / native / 晋升                           | `paidReady:false` / `NOT_ADMITTED` / `HOLD`                                          | [budget-egress.json](./budget-egress.json)及基线清单                               |

Vitest 汇总按同一文件最后一次定向运行计数，不能把重复运行相加。Node 的 JUnit 输出中父级子测试组可能不以 `<testcase>` 表示，84 取其原始 `tests/pass` 统计。Java 的编译与测试已真实执行；VS Code 生成页面测试使用 Happy DOM，未代表真实 Extension Host 安装旅程。

## 2 新实现

- **模型档位**：按精确型号维护 review date、支持档位及倍率；显式 `--service-tier` / `llm.serviceTier` 贯通 headless、stream、REPL 和 Responses 请求。Agent 循环在发出用量开始事件、压缩或 provider 调用前拒绝不支持档位。实际响应档位用于定价，缺失、冲突或未知价格保持未确认。双 IDE 实时提示保留本轮已发生的未确认费用。
- **目标与恢复**：已完成或耗尽的 Goal 再评估不会重复发完成事件；无效、负数、非有限用量不会改变原状态。已有压缩拒绝及持久结算回归通过。两个 IDE 区分 goal 检查与最终完成，预算耗尽显示未完成。
- **上下文**：ledger 替换 entry 时正确迁移 session/turn 索引，清理旧 session 不删除新证据；估算与 observed 分开，`/context` 不把来源账本声称为当前请求账单。技能目录默认 20 个描述、最多 64 个，支持分页和查询；查询的前 64 个候选之外提示进一步细化，不加载正文。
- **MCP**：重新发现 schema、替换连接和移除工具时失效旧 loaded 状态；仅残留旧 stub 的新连接不可用，旧 executor 拒绝执行；特殊 server 名不会取到对象原型中的 instructions。原源码物理 NUL 改成等价的 `\u0000` 转义。
- **Memory**：缓存排序 Collator；新增显式 `verified-memory`，以当前 manifest digest、store revision、authority digest、query digest/bytes、record count 绑定已验证的宿主内存索引。每次操作仍读回 manifest，选中权威分片仍校验；派生磁盘索引在 cache miss 时修复。默认 `validate-disk` 维持逐次验证和 eager repair。
- **证据工具**：新增基线、预算调用链、上下文测量、火山诊断、去重汇总脚本。静态预算审查列出 8 类调用链、47 个词法网络候选文件，其中 42 个路径待进一步分类；这些候选可能是非 LLM 网络操作，不能据此计算付费出口覆盖率。

## 3 火山发现与后续诊断边界

现有 provider 为 `volcengine`，模型为 `deepseek-v4-flash-ga-260731`，端点为北京 Ark API v3。凭据通过现有配置内部读取，没有写入本目录；只读临时 fixture 的正文和模型回复仅保留摘要。

原回执四项功能为：stream + usage、`read_file` 工具往返、压缩保留 `cedar-27` / `deliverables.txt` / 禁止网络及凭据读取约束、首个文本增量后 Stop。压缩所报 saved token 属于估算。

首轮脚本声明 `max_tokens:512`，但第 4 次 usage 报 **4186 output tokens**；本次没有验证 reasoning 与该参数的完整计费语义。第 5 次 Stop 没有完整 usage。已知估算 **$0.0014441**，**总费用 unknown/null**，不按零处理，也未核对 provider 账单。诊断估算停止值 `$0.05` 不是硬预算。

原回执缺执行源码绑定及明文 `max_tokens` 字段，后续脚本新增源码摘要与 `requestedMaxOutputTokens`，并在发现输出超出假设后保存已知用量并停止。没有重跑付费请求覆盖旧证据；`passed:true` 只表示原四项功能检查通过，不表示预算约束验收通过。再次付费运行前须核对未决取消费用、价格/汇率、总计费输出上界及受控出口。原共享 **$99** 不能重置。

## 4 性能观测

| 100K 热查询    | p95        | 采样数 | 解释                                                                                       |
| -------------- | ---------- | ------ | ------------------------------------------------------------------------------------------ |
| 原路径         | 1780.109ms | 3      | [memory-query.json](./memory-query.json)                                                   |
| Collator 单改  | 2417.783ms | 3      | [memory-query-after.json](./memory-query-after.json)；保留负面结果，运行时存在其他测试负载 |
| 显式缓存首轮   | 1568.976ms | 3      | [memory-query-verified-cache.json](./memory-query-verified-cache.json)；仍有额外目录检查   |
| 显式缓存最终轮 | 854.300ms  | 5      | 源码摘要与当前实现一致，无并行重测试                                                       |

最终轮全量扫描 p95 11350.133ms，冷查询 2215.784ms，重建 15464.798ms。热路径较初始观测约改善 52%，仅适用于本机固定查询及显式模式；冷查询、重建和并发 SLO 尚未验收。冷查询是新 Node 进程，未清 OS 文件系统缓存。1K/10K 的三次采样也保留在早期报告中。

显式试用可通过宿主选项 `memoryQueryIndexCacheMode: "verified-memory"` 或环境变量 `CC_CONTEXT_MEMORY_QUERY_CACHE=verified-memory`；不设置时仍为 `validate-disk`。不能把缓存测量自动转换为默认启用决定。

## 5 复现命令

以下命令在仓库根执行，使用现有依赖，不发付费模型请求。完整测试文件选择见 JSON 汇总中的 `cli.suites`。

```powershell
node packages/cli/scripts/implementation-plan-status.mjs --output <新的基线输出路径>
node packages/cli/scripts/implementation-plan-budget-egress.mjs --output <新的审查输出路径>
node packages/cli/scripts/implementation-plan-context-benchmark.mjs --output <新的测量输出路径>
node packages/cli/scripts/implementation-plan-evidence.mjs --output <新的汇总输出路径>

node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/model-catalog-review-evidence.node-test.mjs
node --test packages/vscode-extension/test/goal-events.test.cjs

node packages/cli/scripts/gen-command-manifest.mjs --check
node packages/cli/scripts/gen-command-help-index.mjs --check
node packages/cli/scripts/gen-shell-completions.mjs --check
node packages/cli/scripts/gen-cli-reference.mjs --check docs/cli/CLI_REFERENCE.generated.md
node packages/cli/scripts/gen-protocol-doc.mjs --check docs/cli/PROTOCOL_CAPABILITY_MANIFEST.generated.md
```

Vitest 在 `packages/cli` 目录运行 `node ../../node_modules/vitest/vitest.mjs run <选定测试文件>`。JetBrains 在 `packages/jetbrains-plugin` 下使用完整 JDK 21 执行 `gradlew.bat --no-daemon test --tests com.chainlesschain.ide.ChatEventsTest`。Memory benchmark 参数示例为 `--counts 100000 --samples 5 --cache-mode verified-memory --output <新路径>`，实际参数以脚本 help 为准。

## 6 未完成的验收

1. Runtime / 平台：预算每次物理请求接线、数据库复制/回滚/并发谱系、宿主凭据隔离与后代出口；账单及取消费用核对，验证总计费输出上界。完成后才能改变相应范围的 `paidReady`。
2. QA / 独立验收人：九个目标安装入口、冻结 36 项真实产物与 checker；native 必需样本保留 native 依赖；真实 8h/24h 活跃负载和 NVDA / VoiceOver / Orca 听测。
3. Runtime / IDE：固定真实任务的技能选择质量、多模态事实保留、完整 MCP 组合、重启恢复与 UI 交互 SLO。
4. 发布负责人：候选准确提交的 CLI CI 与 CLI Strict Sandbox 全配置 OS 矩阵；OIDC 子包 → CLI → IDE 发布，再下载回读制品及来源。本轮没有升级版本或发布包。
5. 条件工作包：上游 Codex 目标发行及真实二进制、首个 native 平台和可信服务、云端接续的明确需求与租约方案。

## 7 历史及失败证据

`baseline.json` / `baseline-final.json` / `public-baseline.json` 保留早期采集；公开元数据可见不代表已下载制品或新提交已发布。JetBrains 公开回读仍未捕获。

`cli-tests.json` / `goal-and-memory-tests.json` 是早期回归；`cli-tests-final.json`、`context-tier-tests.json`、`usage-ui-tests.json`、`tier-entry-tests-final.json` 按文件覆盖后组成最终 440 项。`tier-entry-tests.json` 保留一次失败尝试：测试 fixture 显式选择 OpenAI 却沿用了 localhost 端点，Ultrafast 被按自定义端点正确拒绝；补齐官方端点的 fixture 后真实 headless 接线验证通过。

`validation-summary.json` 的源码绑定是在测试后采集的工作区快照，不能追溯性声称为每次运行前冻结的 SHA。Memory 最终测量原始记录已包含源码摘要且与当前实现匹配。正式评测和发布仍需准确提交的原生证据。

最后的 benchmark 帮助检查发现旧脚本不识别 `--help`，误进入 fixture 分支后被本地沙箱的父路径校验拒绝；没有产生付费请求或有效性能样本。已增加独立帮助分支，再次检查只打印参数说明；没有放宽 Memory 的路径校验。
