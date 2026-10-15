# 第二轮预算作用域实施证据（2026-10-15）

对应[实施计划第 11 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#11-第二轮实施记录预算作用域与流式结算2026-10-15)。本轮完成宿主显式启用的进程内模型出口接线，使用离线 provider fixture 和真实 SQLite，不发真实模型请求。正式 36+9 仍为 `NOT_RUN`，预算 `paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。

## 实际结果

| 检查                                 | 结果                                                                                    | 证据                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 测试前源码绑定                       | 父提交 `62b407bbefee02a2ac14495fcef9e59b237c05a7`，18 个改动文件；测试后摘要一致        | [source-binding.json](./source-binding.json)         |
| Node authority / frozen plan / scope | 3 文件，104 项通过；其中作用域与调用链 29 项                                            | [node-tests.xml](./node-tests.xml)                   |
| Vitest 定向回归                      | 15 文件，269 项通过                                                                     | [vitest-tests.json](./vitest-tests.json)             |
| 语法 / 格式                          | 17 个 JS/MJS 语法通过，18 文件 Prettier 通过                                            | [validation-summary.json](./validation-summary.json) |
| 生成物                               | command manifest、help index、completions、CLI reference、protocol document 无漂移      | [validation-summary.json](./validation-summary.json) |
| ESLint                               | `NOT_RUN`，当前工作区缺已声明的 ESLint 包                                               | [validation-summary.json](./validation-summary.json) |
| 能力与版本                           | 当前工作区源码版本；不证明公开发布                                                      | [baseline.json](./baseline.json)                     |
| 出口审查                             | 8 类调用链、48 个词法候选文件、41 个待分类路径；全部 formalCoverage 仍为 `NOT_ATTESTED` | [egress-review.json](./egress-review.json)           |

JUnit 中的父测试组不一定表现为 testcase，104 采用原始 `tests/pass` 注释。269 为本轮按文件的一次定向结果；同首轮重复的测试不再次累计为新增覆盖。原始 JSON/XML 继承上级 `.gitattributes` 的字节保留设置。

## 宿主接入与边界

宿主必须先通过已有证据验证和持久 authority 取得有效 run，再创建 `createFormalBudgetTransport`。在 `withFormalBudgetProviderScope({ transport, runId }, operation)` 的 operation 内调用并完整消费 Agent 生成器、Chat 流及响应正文。作用域不创建 authority、不初始化新预算、不打开 `cc eval` 的正式 gate，也不能作为 OS 沙箱使用。

已接入的 canonical 函数通过 `providerFetch` 读取当前作用域。在作用域内，即使调用者传入另外的 fetch，也不能替换受控出口；没有作用域时保留原调用路径。独立异步作用域互不串账，嵌套替换被拒绝；operation 结束后取消未决请求，继承了旧作用域的延迟工作只能收到关闭错误。宿主应在 operation 内等待所有工作结束。

当前合同仅支持精确 endpoint、模型、输入及完整计费输出上界均经过验证的 `openai-chat`。未覆盖协议、异常头或请求维度在发送前拒绝。首段流式内容立即交付，但 EOF 必须等待完整响应的持久结算；Stop 或缺失 usage 保留全部预留。流式正文可能已经可见，不能因此宣告任务完成或忽略后续核算错误。

Agent 不把预算异常转成正常部分响应，压缩器不以提取摘要掩盖预算异常，Advisor 不把它当作可忽略失败。错误的网络措辞、注入的 fetch、消费者修改响应字节、迟到响应及取消时的 unknown 写入失败均有负例。

这只约束已接线的进程内函数。任意 fetch、SDK、worker、动态加载代码和子进程尚未受到该作用域的系统级隔离，任务进程也尚未通过凭据不可达验收。跨数据库复制/回滚、唯一预算谱系、真实账单/汇率、历史取消费用及输出总上界仍待核验。`egress-review.json` 的词法候选包括非模型网络行为，不能据此计算付费覆盖率。

## 复现

在仓库根运行，无真实 provider 请求：

```powershell
node --test packages/cli/test-node/formal-budget-authority.test.mjs packages/cli/test-node/formal-budget-frozen-plan.node-test.mjs packages/cli/test-node/formal-budget-provider-scope.node-test.mjs
```

Vitest 在 `packages/cli` 下运行 `node ../../node_modules/vitest/vitest.mjs run <测试文件>`；15 个精确文件列在 [validation-summary.json](./validation-summary.json) 的 `vitest.suites`。核对命令如下：

```powershell
node packages/cli/scripts/gen-command-manifest.mjs --check
node packages/cli/scripts/gen-command-help-index.mjs --check
node packages/cli/scripts/gen-shell-completions.mjs --check
node packages/cli/scripts/gen-cli-reference.mjs --check docs/cli/CLI_REFERENCE.generated.md
node packages/cli/scripts/gen-protocol-doc.mjs --check docs/cli/PROTOCOL_CAPABILITY_MANIFEST.generated.md
node packages/cli/scripts/implementation-plan-budget-egress.mjs --output <新的审查输出路径>
node packages/cli/scripts/implementation-plan-status.mjs --output <新的基线输出路径>
```

本轮环境为 Windows x64 / Node 22.22.2。新 Node 文件已加入 `CLI CI` 的三系统验证步骤，但本地结果不代表新准确提交上的 CI 和 Strict Sandbox 通过，也不代表真实 IDE 安装、正式 provider、8h/24h 活跃负载或真人听测完成。本轮没有升级版本、发布包或改变历史共享 $99。
