# 第一百六十一次工程实施：CLI Volcengine 函数进程隔离与硬终止

## 本批目标

继续优先完成 CLI 函数执行缺口：把函数实现从 authority 所在进程移入可强制终止的受限子进程，使忽略 `AbortSignal` 的实现也不能越过签名 deadline 继续产生迟到副作用，并为调用、撤销和监督结果保留可验证证据。

## 实施结果

- 新增品牌化 `VolcengineFunctionProcessExecutor`。它只接受现有品牌化 Eval process supervisor，以及 operation 固定为 `volcengine-function-execute`、isolation 固定为 `process` 的声明式目标；目标模块在 supervisor 捕获时按 SHA-256 固定字节，执行前后再次校验，源文件替换会失败关闭。
- 函数实现运行在 Node permission model 子进程中，父进程不向它传入 callable、closure 或环境变量。文件读写权限和内存上限继续由 supervisor 的显式 sandbox policy 控制，子进程退出、输出越界、协议错误与目标崩溃均不能生成成功结果。
- 函数原始 `requestDigest` 直接贯穿 supervision request、target invocation、revocation 与三类耐久 child evidence；随机 invocation/capability nonce 另行绑定 payload、目标和 deadline，避免把同一业务请求替换到其他目标或调用实例。
- 进入父进程摘要与 spawn 之前，请求会递归投影为有深度、字段数和 1 MiB 字节上限的 plain JSON；Proxy、accessor、循环、非有限数字、原型键和非数据字段均失败关闭。执行 context 的 `signal` 也只从 own data property 读取，调用方 getter 不会在隔离边界前执行。
- deadline 由函数请求提供，不在执行器内延长。监督器到期后对活动子进程发送 `SIGKILL`，等待进程关闭，再签发 `hard-terminate` 撤销与 `terminated` supervision receipt；执行器复验目标、结果、时序、隔离、硬 deadline、迟到副作用阻断、调用次数、撤销结果和 supervisor attestation 后才决定成功或固定 deadline 失败。
- 上层 authority 撤销或 deadline 触发 `AbortSignal` 时，进程执行器同步请求同一 capability 的硬终止；即使目标实现不观察信号，整个执行进程仍会被杀死。完成路径则签发 `completed-release`，并复验结果摘要与 target invocation evidence。
- 进程执行器拒绝未配置 durable child evidence store 的 supervisor。正常执行会耐久留存 invocation、revocation、supervision 三类证据；超时执行留存 revocation 与 supervision 证据，外部可用同一函数请求摘要定位证据链。
- 签名 Desktop deployment loader 已提供该工厂，并强制 process target 的 `handlerArtifactDigest` 等于已认证 deployment 模块摘要，防止以未验签目标替换受信函数实现。现有 replay-protected function authority 可直接使用该品牌化执行函数。

## 回归与门禁

- 新增 5 个进程执行器测试：真实子进程 PID、请求摘要贯穿三类耐久证据、与 replay-protected function authority 组合、deadline 与上层 authority abort 两条硬杀路径及迟到文件不存在、缺失耐久 evidence store、错误 operation 和父进程 accessor 拒绝。
- 真实 Windows 子进程在 deadline 后被终止；等待超过目标原计划写入时间后，迟到文件仍不存在，且目标 PID 已退出。
- 进程执行器、通用 process supervisor、函数 authority 与签名 deployment loader 定向回归：4 test files、109 tests passed。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 本批提供并验证 CLI 进程执行路径，但现有 Desktop 组合尚未强制所有生产 function authority 使用该执行器；仍需在目标 deployment 中实际配置 target、sandbox policy、生产 child evidence store 与 function audit writer，并完成 Electron/preload/renderer/Volcengine 工具循环 E2E。
- Node 22 permission model 可限制文件系统和子进程能力，但没有覆盖本报告要求的独立网络命名空间；生产网络出口仍需外部 sandbox/container/OS policy 阻断和验证。
- `SIGKILL` 能阻止目标进程之后的副作用，不能回滚截止前已经提交的不可逆外部操作；操作级幂等、补偿、两阶段提交和人工恢复仍需按具体函数实现。
- supervisor attestation 与 child evidence store 的生产签发者、密钥轮换、跨主机副本和故障矩阵仍待目标环境验收。
