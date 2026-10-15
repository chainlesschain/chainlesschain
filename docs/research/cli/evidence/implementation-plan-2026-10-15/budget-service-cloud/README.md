# 第十六轮：服务 API 与云端任务出口

日期：2026-10-15。范围：正式预算作用域内的 EvoMap 服务 API、Cloud Runner 和底层 Gateway 入口。源文件为 `packages/cli/src/lib/evomap-client.js`、`packages/cli/src/lib/cloud/cloud-client.js`、`packages/cli/src/lib/gateway-client-resilience.js` 和 `packages/cli/src/lib/formal-budget-provider-scope.js`；预算边界测试为 `packages/cli/test-node/formal-budget-service-cloud-boundary.node-test.mjs`。`CLI CI` 清单及 `budget-egress-reviewed-sources.json` 已同步更新。

## 离线验证

| 命令或检查                                                                                                                                                     | 结果                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `node --test packages/cli/test-node/formal-budget-service-cloud-boundary.node-test.mjs`                                                                        | 4/4 通过；测试不可读取输入、零 fetch/TLS 副作用、作用域外调用和关闭后拒绝。 |
| `node --test packages/cli/test-node/formal-budget-provider-scope.node-test.mjs`                                                                                | 42/42 通过。                                                                |
| 在 `packages/cli` 执行 `vitest run __tests__/unit/cloud-handoff.test.js __tests__/unit/evomap-client.test.js __tests__/unit/gateway-client-resilience.test.js` | 3 文件、43/43 通过。                                                        |
| `node packages/cli/scripts/implementation-plan-budget-egress.mjs --check --include-scripts`                                                                    | 73 个候选；零未分类、零解析错误；`paidReady:false`。                        |
| 四个改动 JS/MJS 源文件及新增测试的 `node --check`；改动代码与清单的 Prettier `--check`                                                                         | 通过。                                                                      |

第一次从仓库根目录运行 Vitest 时，它也扫描了 `.work` 下的旧工作树；该次运行被中止，未计入结果。上表的 43 项为在 `packages/cli` 工作目录重新运行的完整结果。未运行真实付费请求或正式 36+9 样本。

## 准入边界

这些检查只在当前进程携带正式预算作用域时生效，不能证明 SDK、独立进程、已有云端服务或操作系统出口都由宿主治理。账户价格、默认 thinking 的总输出计费上界、历史和取消费用、生产认证检查点、目标宿主隔离、九入口安装及准确提交的远端矩阵仍未具备。正式付费评测、native 和发布保持 HOLD。
