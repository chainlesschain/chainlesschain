# 第十一轮：直接网页与浏览器出口（2026-10-15）

对应[实施计划第 20 节](../../../../cli-ide-codex-claude-implementation-plan-2026-10-15.md#20-第十一轮实施记录直接网页与浏览器出口2026-10-15)。本轮收紧三个进程内网页工具导出，不包含生产部署或真实付费调用。

| 验证            | 结果                                                      | 原始回执                                             |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| 预算 Node 回归  | 11 个文件、222 项通过；新增直接网页边界 5 项              | [node-tests.xml](./node-tests.xml)                   |
| 网页相关 Vitest | 3 个文件、87 项通过                                       | [vitest-web-browser.json](./vitest-web-browser.json) |
| 扩展出口审计    | 1,639 文件、73 候选，未分类/解析错误/跳过均为 0           | [egress-review.json](./egress-review.json)           |
| 测试前源码身份  | 6 个本轮相关文件，测试后摘要不变                          | [source-binding.json](./source-binding.json)         |
| 既有预算回执    | 七个早期预算目录 58 份、第九轮 13 份、第十轮 6 份摘要匹配 | [validation-summary.json](./validation-summary.json) |

`webFetch` 在读取 URL、选项、宿主缓存或发起 HTTP(S) 前拒绝；`fetchPage` 在读取选项、设置定时器和调用 `fetch` 前拒绝；`takeScreenshot` 在加载 Playwright 或读取选项前拒绝。拒绝为 `CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED`、`noReplay:true`。作用域已关闭的异步后代得到 `CC_BUDGET_SCOPE_CLOSED`。本轮连本地网页快照读取也停线，直到可信宿主能给出精确工具合同。

离线用例向 URL、选项、输出路径传入会抛错的代理，HTTP(S) 和全局 `fetch` 桩记录零物理请求；作用域外的 `fetchPage` 使用合成响应，`webFetch` 继续阻止 loopback。现有网页 Vitest 覆盖正常抓取与资源配额。测试中没有访问公共网页。预跑的同一 87 项结果保存在 [vitest-preliminary.json](./vitest-preliminary.json)，不与最终回执累计。

源码分类清单重新绑定三个改动候选：网页抓取和浏览器仍为 `TASK_CONTROLLED_NETWORK`，预算作用域仍为 `BUDGET_BOUNDARY`。分类及测试只证明接线导出的进程内行为；CLI `browse` 的参数与 UI 层、其他直接网络 API、动态 SDK、worker、子进程及 OS 出口没有因此获得隔离。网页 SSRF 防护和宿主资源配额不能代替外部服务账单合同。

原始 Node JUnit 末尾 `tests/pass` 为 222/222，包含父测试组；Vitest 计数来自最终 JSON。环境为 Windows x64、Node 22.22.2，源码身份绑定未提交工作区。三系统准确提交的 `CLI CI` 与 `CLI Strict Sandbox` 回执仍未取得；ESLint 本地依赖缺失。

在仓库根可离线复现：

```powershell
node --test packages/cli/test-node/formal-budget-direct-web-boundary.node-test.mjs
node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts
```

正式评测仍为 `NOT_RUN`（0/36、0/9），`paidReady:false`，native `NOT_ADMITTED`，晋升 `HOLD`。历史共享 **$99** 不重置；本轮真实付费请求为 0。
