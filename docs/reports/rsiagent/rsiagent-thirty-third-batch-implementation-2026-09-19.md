# RSIAgent 第三十三次工程实施：PM Merger/Evaluator 进程隔离与签名监督证据

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第三十二次工程实施：PM Actor 进程隔离与父进程预算工具代理](./rsiagent-thirty-second-batch-implementation-2026-09-19.md)<br>
> 状态：PM execution host 的 runner、grader、merger、evaluator 四个角色现均可绑定到彼此独立、可硬终止的受监督子进程。execution manifest v5 固定 merger/evaluator 的目标模块、authority、supervisor 和 deadline；签名 merge/evaluator receipt v2 固定成功监督摘要或显式失败空值。Node 22 permission model 仍不提供网络隔离，Curriculum/Memory 检索/模型出口、operator 生产配置和真实 Electron PM E2E 尚未完成，因此 G01/G05 继续为“部分完成”。

## 1. 四角色进程边界

新增 `createPmExplorationProcessMerger()` 与 `createPmExplorationProcessEvaluator()`。两类 provider 复用品牌化 Eval process supervisor，但使用各自独立的 target operation：

- merger：`pm-exploration-merge`；
- evaluator：`pm-exploration-evaluate`。

每次调用都建立一次性 invocation capability，并绑定请求摘要、target digest、target authority digest、模块字节摘要、supervisor authority digest 和硬 wall-clock deadline。目标模块只接收规范的 merge 或 evaluation request，不取得父进程 signer、host 闭包、工具 broker、grader 私有状态或其他角色 target。

merger/evaluator 不需要调用业务工具，因此未开放 runner 的双向工具 broker。父进程只接受单一规范结果，并在预算执行器内完成字段、digest 和决策范围校验。

## 2. execution manifest v5

manifest 兼容规则为：

- v2：四角色均为进程内 provider；
- v3：仅声明私有 grader 进程隔离；
- v4：必须声明 runner 进程隔离，可同时声明 grader；
- v5：至少声明 merger 或 evaluator 进程隔离，runner/grader 隔离描述仍可选。

v5 新增 `mergerIsolation` 与 `evaluatorIsolation`，分别固定：

- process 模式、目标 operation、handler ID 与 revision；
- target digest、target authority digest 和模块字节摘要；
- supervisor authority digest；
- 角色自己的硬 deadline。

execution host 会逐角色比较 manifest 与品牌化 provider 捕获的隔离描述。以相同 signer 构造的进程内 merger/evaluator 也不能替换已声明的进程 provider。

## 3. 签名 reviewer receipt v2

merger 正常完成监督后，host 校验 supervisor enforcement receipt，并将 `mergerIsolationEvidenceDigest` 写入签名 merge receipt v2。evaluator 同理将 `evaluatorIsolationEvidenceDigest` 写入签名 evaluator receipt v2。

成功的进程调用必须取得合法 SHA-256 监督摘要，缺失摘要时拒绝签发成功回执。若 target 模块替换、崩溃、超时、外层预算终止或监督证明无效：

- merge receipt v2 使用 `failed`/`aborted`，并显式记录 `mergerIsolationEvidenceDigest: null`；
- evaluator receipt v2 使用 `unsafe / 0`，并显式记录 `evaluatorIsolationEvidenceDigest: null`；
- 失败结果不能推进 merge、冻结 Memory 或取得 promotion 资格。

进程内兼容路径继续签发原 v1 回执。监督摘要位于 Ed25519 签名 payload 内，替换摘要会导致 receipt digest/签名校验失败。

## 4. 模块快照、截止时间与终止

merger/evaluator 使用与 runner/grader 相同的模块字节快照和调用前后摘要复核。supervisor 以空启动环境启动 Node 子进程，使用 Node permission model 限定显式文件路径、内存以及 child-process/worker 权限。

以下条件均失败关闭：

- target operation、handler、authority 或 module digest 与 manifest 不同；
- supervisor 捕获 target 后模块字节被替换；
- 目标输出不是规范的普通对象或包含额外字段；
- target deadline 或 PM 总 wall-clock 预算到期；
- target 崩溃、输出越界、协议记录异常或 enforcement attestation 无效；
- 完成监督摘要缺失、重放或被篡改。

deadline 到期时一次性 capability 被撤销，活动子进程由 supervisor 硬终止，不接受迟到结果。

## 5. Desktop 签名部署装配

签名且允许 `desktop` 的 deployment 现在可装配：

- `createPmExplorationProcessMerger()`；
- `inspectPmExplorationMergerIsolation()`；
- `createPmExplorationProcessEvaluator()`；
- `inspectPmExplorationEvaluatorIsolation()`。

这些工厂与既有 process runner、process grader、process supervisor 一起从验签模块装配，不新增 renderer/IPC 写入口，也不自动启动 PM 探索。

## 6. 验证与保留边界

PM、监督和部署相关回归为 **19 files、221 tests passed**。新增覆盖包括：

- runner、grader、merger、evaluator 在完整 Broad → merge → Deep → evaluate 生命周期中均由非父进程 PID 执行；
- manifest v5 同时固定四角色隔离描述；
- merge/evaluator receipt v2 签入监督摘要，篡改摘要校验失败；
- 进程内 merger/evaluator 替换被 host 拒绝；
- merger 模块字节替换在 spawn 前失败；
- 挂起的 merger/evaluator 达到 deadline 后被硬终止；
- 失败回执显式写入空监督摘要，且不能推进 merge 或冻结 Memory；
- v2/v3/v4 manifest 与 v1 receipt 兼容路径继续通过。

仍未完成：

- Node 22 permission model 不限制网络访问；生产环境仍需外部 sandbox、network namespace 或 firewall 阻止子进程绕过受治理出口；
- Curriculum/任务选择、Memory 检索与模型调用尚未全部迁入等价的独立进程和网络边界；
- 尚未装配 operator 签发的真实四角色 target、生产 sandbox policy、模型出口和耐久 child evidence store；
- 未在独立未见隐藏集执行污染/泄漏负例，也未运行真实 Electron DID/RBAC PM E2E；
- 未在目标环境执行等预算 baseline/candidate 重复采样，不能据此关闭 G08。

因此，本批完成的是四角色可声明、可监督、可硬终止且证据进入签名回执的主机合同，不代表生产网络隔离、真实部署或最终效果验收已经完成。
