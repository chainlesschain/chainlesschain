# RSIAgent 第十五次工程实施：独立 PM 业务 grader 与签名任务绑定

> 日期：2026-09-18（Asia/Shanghai）<br>
> 前置实施：[第十四次本地签名 deployment 火山引擎真实烟测](./rsiagent-fourteenth-batch-implementation-2026-09-18.md)<br>
> 后续实施：[第十六次 Desktop PM 只读结果端口与真实 SQLite 回读](./rsiagent-sixteenth-batch-implementation-2026-09-18.md)<br>
> 状态：G02 的本地结果验证器现已接入签名 PM 执行链。文件结果由宿主在 Actor 执行前建立基线并在执行后直接回读；项目和看板结果只从品牌化只读 outcome source 获取。该交付是可审计的本地合同与负例回归，不是目标 Desktop 数据库的生产接线或真实 PM E2E 结论。

## 1. 本批关闭的实际断点

此前的 `pm-result-grader.cjs` 已能安全回读导出文件，并能比较项目和看板状态，但存在两个接线断点：

1. 签名 execution host 的 grade request 没有 `taskId`，独立 grader 无法用宿主生成的请求选择对应私有期望值；
2. 项目和看板 grader 接收普通 `actual` 参数，虽然注释要求数据必须由可信宿主读取，但类型合同本身无法阻止把 Actor 自报结果传进去。

本批没有重写已有低层断言，而是把它们封装到签名 deployment 可组装的独立业务 grader 中。

## 2. 签名执行链变更

[PM execution host](../packages/cli/src/lib/evolution/pm-exploration-execution-host.js) 的 grade request 已提升为 `v2`，并增加：

- `taskId`：精确选择该任务的私有期望；
- `executionRequestDigest`：把 grade request 绑定到 Actor 执行前的规范请求，而不只依赖执行后的 receipt digest。

grader provider 可选注册宿主侧 `prepare` hook。host 在与 Actor 相同的预算 envelope 内、调用 Actor 前，以冻结的 run request 调用该 hook；超时或准备失败时不会继续调用 Actor。普通 grader 不提供 hook 时行为不变。文件业务 grader 利用这个时点验证 artifact root，并要求目标文件尚不存在。

[evidence bundle](../packages/cli/src/lib/evolution/pm-exploration-evidence-bundle.js) 的回放验证同步使用新字段复算 grade request digest，因此不会出现“只在在线路径加字段”的不一致。验证器仍可回读已有 `v1` grade request 回执，但新执行只生成 `v2`；回退仅在回执签名和摘要有效、且唯一失败是 request digest 不匹配时尝试。任务身份没有作为可变调用方数据传给 grader，而是由 execution host 从已验证轮次输入生成，并通过签名 grader receipt 的 `requestDigest` 间接认证。

## 3. 独立业务 grader

[业务 grader adapter](../packages/cli/src/lib/evolution/pm-exploration-business-grader.js) 提供三个能力：

- `createPmExplorationReadOnlyOutcomeSource()`：把主进程提供的项目/看板查询函数封装成不可伪造、无可枚举方法的品牌化 capability；
- `inspectPmExplorationReadOnlyOutcomeSource()`：只返回冻结的 source descriptor 和 digest，不返回查询回调；
- `createPmExplorationBusinessGrader()`：持有私有任务期望，在宿主 grade request 到达时调用低层文件、项目或看板断言，并返回标准 `decision / scoreBasisPoints / resultDigest`，再由既有 Ed25519 grader signer 签发回执。

隔离边界如下：

- Actor 只看到 run request，不接触期望值、artifact baseline、source callback 或 grader handler；
- outcome source 的查询参数只有 plan/environment/source、round/task、execution/receipt/output/trace digest，不包含期望答案；
- source 返回的实际数据库状态不写入回执；私有期望以进程内随机盐承诺后再进入结果摘要，避免公开低熵答案摘要；
- outcome source 同时取得 grader 预算 runtime 的 abort signal，以便目标数据库 adapter 在超时后终止只读查询；
- source、grader signer 和签名 deployment 必须使用同一个 `handlerArtifactDigest`；
- Desktop loader 只向已验签且允许 `desktop` 的 deployment 暴露这些工厂，并拒绝替换过的 source handler digest。

## 4. 三类结果验证

| 类型            | Actor 前检查                                | Actor 后独立检查                                          | 失败结果            |
| --------------- | ------------------------------------------- | --------------------------------------------------------- | ------------------- |
| `file-export`   | root 是真实目录；目标不存在；路径无链接穿越 | 限长 1 MiB 回读、fd/stat 稳定性、inode、realpath、SHA-256 | 内容错误为 `reject` |
| `project-state` | 记录任务与私有期望                          | 从 source 回读并精确比较 `id/name/status`                 | `reject`            |
| `board-export`  | 记录任务与私有期望                          | 从 source 回读 board、task IDs、sprint IDs                | `reject`            |
| 执行失败        | 已准备但不读取业务状态                      | 不调用数据库 source                                       | 签名 `unsafe` 回执  |

文件 baseline 是一次性句柄；同一任务重试必须先重置独立 workspace，再由下一轮 `prepare` 建立新基线。预先存在的“正确文件”会在 Actor 运行前失败关闭并得到 `unsafe` 回执，避免执行新的副作用或把旧产物误计为本轮成功；本轮新写但内容错误的文件得到 `reject`。

## 5. 自动化回归

[业务 grader 测试](../packages/cli/__tests__/unit/pm-exploration-business-grader.test.js) 覆盖：

- 项目状态真实回读并接受；
- Actor 执行成功、数据库状态不匹配时拒绝；
- 看板、任务和 Sprint 身份集合验证；
- Actor 前文件基线与执行后真实字节回读；
- 预先存在的文件即使摘要正确也拒绝；
- Actor 失败时不查询业务状态并签发 `unsafe`；
- 伪造 source、重复 task、accessor expectation 拒绝；
- source 对象不暴露查询回调或私有期望。
- 已认证的历史 `v1` grader receipt 仍可由 evidence bundle 回读，新轮次固定生成 `v2`。

本批验证结果：

| 检查                                                   | 结果                 |
| ------------------------------------------------------ | -------------------- |
| business grader + execution host + deployment loader   | 3 files，73 passed   |
| CLI PM 全组 + deployment loader + signed fixture probe | 14 files，200 passed |

## 6. 保留边界

本批证明的是签名 execution host 可以把具体 PM 任务交给不依赖 Actor 自报的结果 grader，并产生与执行请求精确绑定的签名回执。它仍不证明 G02 在目标环境完全验收：

- outcome source 的“只读”由签名 deployment 选择的 callback 和底层数据库权限共同保证；JavaScript 品牌只能防伪造 capability，不能把有写权限的实现自动变成只读；
- 本批尚未新增连接真实 Desktop Project/Task 数据库的 adapter；后续第十六次实施已补只读 SQL reader，但仍未由 operator deployment 在真实 PM E2E 中启用；
- 未启动 Electron、未调用真实 PM IPC/工具、未验证 DID/RBAC 与持久化副作用清理；
- 当前评分是精确通过/失败的 10000/0 分，不代表完整任务的部分得分标尺；
- 本批未改变 promotion `hold`、未生成生产部署，也未执行等预算 baseline/candidate 效果比较。

下一步应在目标环境提供最小权限的 Project/Task 只读 adapter，并让一个隔离 workspace/database clone 中的真实 PM 任务通过同一 signed deployment 路径执行；只有文件和数据库产物负例、重置证据、DID/RBAC 以及完整签名 evidence bundle 全部通过后，才能把 G02 标记为目标环境完成。
