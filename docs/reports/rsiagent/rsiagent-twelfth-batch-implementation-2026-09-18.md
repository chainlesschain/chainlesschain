# RSIAgent 第十二次工程实施：签名 Desktop deployment 组装与执行 capability 接线

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十一次真实 Provider 结算进入签名证据与 Ledger](./rsiagent-eleventh-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十三次 Provider settlement 持久化端口与耐久回读](./rsiagent-thirteenth-batch-implementation-2026-09-18.md)<br>
> 状态：签名且允许 `desktop` 的 Evolution deployment 现在可以使用仓库内置工厂组装 PM 计划、四角色签名回执、执行 host、本机火山引擎 provider、证据包和 Ledger；Desktop 主进程只接收不暴露原始方法的品牌化执行 capability。当前机器仍未配置真实签名 deployment，因此本批没有自动启动 Explorer，也没有新增 renderer/IPC 写入口。

## 1. 签名 deployment 的 PM 组装面

[Evolution deployment loader](../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js) 仅在已验签且 descriptor 明确允许 `desktop` 时，向部署入口提供以下内置能力：

- PM plan、journal、Deep 阶段、恢复快照与状态检查；
- execution、grader、merge、evaluator 四角色的 Ed25519 signer/authority；
- execution manifest、四角色 provider、预算执行 host 及 round/merge/evaluate 操作；
- provider-aware evidence bundle v2 的创建与复验；
- 本机 Volcengine provider 的创建、调用、脱敏检查与 settlement 复验；
- PM Ledger adapter、Evolution Ledger durable artifact resolver 和 artifact store。

这些能力不会提供给未签名模块，也不会通过 `additionalFactories` 开放给非 Desktop 命令。deployment 仍必须显式组装并返回 `pmExplorationExecutionHost`；loader 不会自行发起探索。

四个角色的身份还增加了部署字节绑定：

1. `createPmExplorationReceiptSigner` 和 `createPmExplorationReceiptAuthority` 的 `handlerArtifactDigest` 必须等于已经验签的 deployment module digest；
2. execution manifest 中 runner、grader、merger、evaluator 的四个 descriptor 必须再次满足同一摘要；
3. 用替换模块摘要创建 signer 或 manifest 会在 host 组装前失败关闭。

因此，回执所声明的角色实现不能在验签后悄悄改指另一个模块。

## 2. Desktop 主进程 capability 边界

[Desktop deployment adapter](../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js) 对 deployment 返回值执行两次收窄：

- 先由 CLI execution-host 模块的品牌检查确认对象确实是同一模块实例创建的 PM execution host；
- 再把它封装成 Desktop 私有 `WeakMap` capability。对外对象被冻结且没有可枚举字段，也没有 `execute`、`merge` 或 `evaluate` 原始方法。

主进程代码只能通过以下显式函数调用已捕获的 host：

- `executeDesktopPmExplorationRound`
- `mergeDesktopPmExplorationBranches`
- `evaluateDesktopPmExplorationMemory`

访问器属性、Proxy 模块、缺失操作、伪造 host 和未品牌化 Desktop host 都会被拒绝。该 capability 没有接入 preload、renderer 或 IPC，也没有加入 Electron 启动时自动执行路径。

只读 Desktop readiness 也新增 `signed-execution-host` 检查：缺失或伪造 capability 时，静态配置状态为 `blocked`。即使该检查通过，readiness 仍固定 `readyForExecution:false`，必须另行取得真实 provider、工具策略、签名 grader、重启恢复和无残留演练证据。

## 3. 与本机火山引擎的关系

签名 deployment 可通过 `createPmExplorationVolcengineProvider` 复用本机 `volcengine / deepseek-v4-flash-ga-260731` 配置。API key 仍只进入 provider 闭包，不进入 deployment 返回对象、Desktop capability、回执、evidence bundle 或文档。

真实调用仍必须同时持有：

- 品牌化 `AgentEvolutionIngress`；
- execution host 为当前操作签发的预算 runtime；
- 与 execution request digest 绑定的 operation；
- 可定价模型和合法的固定 HTTPS endpoint；
- 如配置 settlement persistence，则必须返回 digest 一致的 durable 确认。

本批完成的是可组装、可验签、可收窄的生产接线路径，不是一次真实受治理 PM 任务。此前 HTTP 200 live probe 只证明本机 provider 连通和 usage 可用，不能代替签名 deployment、真实业务工具、独立 grader 或 Desktop 试点验收。

## 4. 自动化验证

新增或扩展的验证覆盖：

- Desktop 签名 deployment 可见完整 PM 工厂集合；
- signer 与 manifest 拒绝替换后的 handler digest；
- Desktop 能接收品牌化 execution host，并且门面不暴露原始方法；
- round、merge、evaluate 只能经主进程闭包转发到捕获的原始 host；
- 未品牌化 host、访问器属性和伪造 Desktop capability 均失败关闭；
- readiness 在缺失或伪造签名 execution host 时保持 `blocked`；
- 既有预算、四角色回执、provider settlement、evidence bundle v1/v2、Ledger 和多进程恢复回归继续通过。

本批验证结果：

| 检查                                                     | 结果                 |
| -------------------------------------------------------- | -------------------- |
| CLI PM 全组 + deployment loader（CLI 自有 Vitest setup） | 10 files，154 passed |
| deployment loader + Desktop capability 定向检查          | 2 files，74 passed   |
| Desktop deployment + readiness 定向检查                  | 2 files，31 passed   |
| Node syntax                                              | passed               |

从仓库根目录直接运行 CLI 测试不会加载 `packages/cli` 的模型边界 setup；该错误启动方式曾产生 7 个统一的 setup 缺失失败，随后已在 CLI 工作目录使用其正式配置重跑并全部通过。这不是代码回归，也不计入通过数。

## 5. 仍然保留的关闭项

当前机器没有 operator 签发的 Evolution deployment descriptor/trust root，也没有生产独立 signer、一次性 workspace/database clone、真实 DID/RBAC PM 工具 broker、独立业务 grader 或 holdout/Pilot。因此仍不宣称：

- 已完成真实 Desktop Explorer 任务；
- 已完成四角色进程级隔离；
- 已完成断电级 settlement/Ledger durability；
- 已完成合法与越权任务副作用验收；
- 已证明相对 baseline 的等预算效果提升；
- 已取得自动晋级或 release 权限。

后续需要由目标环境提供并审查签名 deployment、四角色密钥托管、真实工具授权、隔离副本和 durability authority，再执行一次完整的 baseline/Explorer 对照。上述条件满足前，Desktop readiness、IPC 写入口和自动晋级保持关闭。
