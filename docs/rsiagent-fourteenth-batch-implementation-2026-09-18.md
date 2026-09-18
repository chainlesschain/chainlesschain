# RSIAgent 第十四次工程实施：本地签名 deployment 火山引擎真实烟测

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十三次 Provider settlement 持久化端口与耐久回读](./rsiagent-thirteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十五次独立 PM 业务 grader 与签名任务绑定](./rsiagent-fifteenth-batch-implementation-2026-09-18.md)<br>
> 状态：仓库现在有一个必须显式确认付费调用的开发探针，可在隔离临时配置根中生成 Ed25519 TEST deployment，通过普通 descriptor/profile 验证路径装载单文件 Desktop host，再执行本机火山引擎、预算计量、受治理 ingress 和 durable settlement 链路。该结果是 TEST deployment 验收，不是 operator 签发的生产部署。

## 1. 可重复探针

[签名 Volcengine PM 探针](../packages/cli/scripts/pm-exploration-signed-volcengine-live-probe.mjs) 执行以下步骤：

1. 没有 `--confirm-live` 时，在生成临时密钥和发起网络请求前拒绝执行；
2. 在系统临时目录下创建独立 `CHAINLESSCHAIN_HOME` 和单文件 deployment host；
3. 调用与 `cc evolution deployment init-test` 相同的实现，生成临时 Ed25519 key、descriptor、trust root 和启用的 TEST profile；
4. 通过普通 `loadEvolutionDeploymentCommandDependencies("desktop")` 路径重新验签并从认证字节装载 host；
5. host 只编排 loader 提供的 provider、artifact ports 和 settlement adapter 工厂，并强制 settlement handler digest 等于已认证模块 digest；
6. 从调用方私有 capability 取得本机 Volcengine 配置和明确标记为 TEST 的 ingress/storage authority；deployment 源码、descriptor 和输出均不包含 API key；
7. 在预算 runtime 内执行最小真实请求，把 provider usage/费用 settlement 写入 artifact，并要求 synthetic 文件副本 retain 和精确字节 resolve；
8. 复验 durable ack，完成 evolution ingress，然后只输出 usage、费用、摘要和治理状态；
9. 无论成功或失败，删除该次临时 profile、测试私钥、状态、artifact 和 replica。

仓库脚本入口：

```bash
npm run test:pm-exploration-signed-volcengine-live
```

该 npm script 已固定传入 `--confirm-live`，因此执行它会产生一次真实、可计费的网络调用。直接运行底层脚本时仍需显式传入该标志。

## 2. 本机真实结果

2026-09-18 本机配置使用 `volcengine / deepseek-v4-flash-ga-260731`，内置 HTTPS endpoint。成功烟测结果：

| 字段              | 结果                                                 |
| ----------------- | ---------------------------------------------------- |
| signed deployment | verified，`deploymentMode:test`，revision 1          |
| promotion policy  | `hold`                                               |
| provider          | HTTP 成功；回复正文未输出                            |
| usage             | input 249，output 23，cache read/create 0，total 272 |
| estimated cost    | `$0.0000413`                                         |
| budget            | succeeded，0 tool calls                              |
| ingress           | completed                                            |
| settlement        | artifact digest 与 durable ack 复验通过              |
| durability        | synthetic filesystem replica；不是生产断电证明       |
| secret handling   | credential 未输出；response content 未输出           |

首次使用 256 总 token 上限时，provider 回传实际 usage 后预算门按设计以 `max-tokens` 失败关闭，没有继续生成 settlement。探针随后把总上限调整为 1024，模型输出上限仍为 8，并仅重试一次成功。该过程验证了预算依据供应商实际 usage 计量，而不是按调用方预估值放行。

## 3. 无网络自动化回归

探针同时支持内部 `--fixture` 模式，供自动化验证完整签名和持久化路径，不发起网络调用。`--fixture` 与 `--confirm-live` 互斥，避免把 fixture 误记为真实结果。

[fixture 回归](../packages/cli/__tests__/unit/pm-exploration-signed-volcengine-probe.test.js) 验证：

- TEST descriptor 由临时根签发并从 saved profile 重新验签；
- 签名 host 能取得品牌化 ingress、provider 和 settlement store；
- handler artifact digest 与 deployment module digest 相同；
- provider usage 进入预算 runtime、settlement artifact 和 durable replica；
- evolution run 完成，promotion 保持 `hold`；
- 输出不包含测试 API key 或 fixture 回复正文；
- fixture/live 双标志被拒绝。

验证结果：

| 检查                                           | 结果                       |
| ---------------------------------------------- | -------------------------- |
| signed live-probe fixture                      | 1 file，2 passed           |
| CLI PM 全组 + deployment loader + signed probe | 12 files，159 passed       |
| artifact ports 基础回归                        | 42 passed，1 skipped       |
| Node syntax / Prettier / ESLint                | passed / passed / 0 errors |

## 4. 结论边界

本批比此前直接 HTTP 探针多证明了：真实本机 provider 可以在已验签 TEST host、受治理 model ingress、预算 runtime 和 settlement durability port 中闭环运行。它仍不能证明生产可用，因为：

- TEST deployment 使用本机临时 Ed25519 key，不是 operator PKI/HSM/KMS 身份；
- ingress、artifact authority 和 durability authority 是明确标记的测试实现；
- Desktop 的调用方私有 additional factory 提供这些测试 authority，不是目标环境正式 composition；
- 文件 replica 只验证协议、fsync 文件和精确回读，不代表跨主机副本、WORM 或掉电恢复；
- 请求没有调用真实 PM 工具，没有验证 DID/RBAC、workspace/database clone 或副作用清理；
- 本次真实请求没有执行 PM 工具或独立业务评分；后续第十五次实施已补本地业务 grader 合同，但仍没有目标数据库 adapter、真实 PM E2E、holdout/Pilot、baseline 对照或四角色进程隔离。

因此输出明确区分 `governedPmTestRun:true` 与 `productionGovernedPmRun:false`。Desktop readiness、renderer/IPC 写入口、自动 Explorer、自动晋级和 release 权限继续保持关闭。
