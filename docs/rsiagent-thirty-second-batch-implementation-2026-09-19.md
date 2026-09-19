# RSIAgent 第三十二次工程实施：PM Actor 进程隔离与父进程预算工具代理

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第三十一次工程实施：私有 PM grader 进程隔离与硬终止](./rsiagent-thirty-first-batch-implementation-2026-09-19.md)<br>
> 状态：PM Actor 与私有 grader 现可同时运行在各自受限、可硬终止的子进程中。Actor 不再取得父进程工具闭包；token 计量和工具调用通过品牌化双向 broker 回到父进程，由既有预算和 manifest 白名单裁决。execution manifest v4 与签名 execution receipt v2 分别绑定隔离配置和监督证据。Node 22 permission model 不提供网络隔离，生产模型/网络出口、operator 签名配置和真实 Electron PM E2E 仍未完成，因此 G01/G05 继续为“部分完成”。

## 1. execution manifest v4

新增 `createPmExplorationProcessRunner()` 与 `runnerIsolation` 描述。v4 manifest 固定：

- runner target 的 handler ID、revision、operation、模块字节摘要；
- target digest、target authority digest 与 process supervisor authority digest；
- `process` 隔离模式和 `parent-budgeted-tools` broker 模式；
- runner 的硬 wall-clock deadline；
- 原有 runner signer、工具白名单、tool policy、环境、计划和 pre-run seal；
- 可选的 v3 私有 grader 隔离描述，使 Actor 与 grader 可同时隔离。

进程内 runner 仍使用 manifest v2；仅隔离 grader 使用 v3；隔离 runner 使用 v4。execution host 会比较品牌化 provider 捕获的描述与 manifest，进程内 runner 不能替换 v4 runner，target、authority、supervisor、模块摘要或 deadline 变化也不能静默生效。

## 2. 父进程拥有预算和工具

Eval process supervisor 增加了可选的品牌化双向 runtime broker，普通 Eval 和 grader 的单输入/单输出协议保持不变。process runner 的目标模块只得到：

- 规范的 PM run request；
- 异步 `recordTokens(count)`；
- 异步 `invokeTool(toolId, input)`。

每次 token 或工具请求均通过有界 JSON line 协议返回父进程。父进程继续调用 `executePmExplorationBudgetedOperation`，因此：

- token 总数由父进程累计，超限会中止预算 signal；
- tool ID 必须出现在签名 manifest 白名单中；
- tool input/output 继续受 1 MiB、JSON、深度和节点边界约束；
- 真正的 tool broker、模型凭据和宿主回调不会进入 Actor 子进程；
- 未结算 broker 请求、重复/伪造 request ID、额外 stdout 记录和协议替换均失败关闭。

Actor 即使捕获并吞掉 broker 返回的拒绝，也不能继续提交结果：预算 signal 会撤销 invocation capability 并硬终止子进程。

## 3. 文件、进程和上下文边界

runner 使用与私有 grader 相同的模块字节快照、调用前后摘要复核、Node permission model、显式 fs read/write 路径、内存上限、空启动环境和默认禁止 child-process/worker 权限。测试中的 Actor 尝试读取未授权私有 grader 文件时得到拒绝；其 PID 与父进程、grader 进程均不同。

Actor 只看到 run request。该请求包含训练分区、计划、环境、任务、输入 Memory 和 manifest 摘要，不包含 grader target、隐藏期望、grader signer、监督器端口或私有文件路径。工具调用也只返回 manifest 允许的业务投影。

## 4. 签名 execution receipt v2

process runner 正常完成后，supervisor 对请求、目标、authority、结果、时间线、单次 capability 和 completed-release 撤销签发 enforcement receipt。PM host 验签后计算 `runnerIsolationEvidenceDigest`，并把它写入 execution receipt v2 再由独立 runner signer 签名。

隔离 runner 失败或被终止时，v2 receipt 显式记录 `runnerIsolationEvidenceDigest: null`，不会伪造完成证明。进程内兼容路径继续签发 v1 receipt。篡改监督摘要会导致 execution receipt digest/Ed25519 校验失败。

外层 execution result 也回显同一监督摘要，便于调用方立即审计；权威证据仍是签名 execution receipt。

## 5. 终止和失败语义

以下任一条件都会阻止 Actor 结果成为成功执行：

- 请求 manifest 白名单之外的工具；
- token、tool-call 或 PM wall-clock 总预算耗尽；
- runner 自己的 process deadline 到期；
- target 模块在 supervisor 捕获后被替换；
- broker 协议无效、输出过大、目标崩溃或监督证明无效；
- Actor 返回时仍有未结算的 broker 请求。

失败 execution receipt 使用 `failed` 或 `aborted` 状态，后续 grader 只能得到 `unsafe / 0`，不会把隔离故障降格为有效候选经验。

## 6. 验证与保留边界

完整 PM/监督/部署相关回归为 18 files、216 tests passed。新增 runner 覆盖包括：

- Actor 与 grader 同时运行在不同受限子进程；
- 文件拒绝、空启动环境、父/子 PID 分离和私有 grader 数据不进入 Actor/tool request；
- token 计量与允许工具由父进程执行并进入签名指标；
- 工具越权和 token 超限即使被 Actor 捕获也触发硬终止；
- v4 manifest 拒绝进程内 runner 替换；
- 模块字节替换在 spawn 前失败；
- target deadline 挂起进程被硬终止；
- runner 监督摘要进入签名 receipt，篡改失败。

仍未完成：

- Node 22 permission model 不限制网络访问；生产环境必须由外部 sandbox/network namespace/firewall 禁止 Actor 绕过父进程模型与工具出口；
- Curriculum/规划器、Memory 检索和模型调用尚未全部迁入同等级隔离边界；
- 尚未装配 operator 签发的真实 runner/grader target、生产 sandbox policy、模型出口和耐久 child evidence store；
- 未在独立未见隐藏集执行污染/泄漏负例，也未运行真实 Electron DID/RBAC PM E2E。

因此，本批完成了 PM Actor 的进程、文件和父进程工具代理合同，但尚未关闭 G01/G05 的生产网络、完整角色和目标环境验收边界。
