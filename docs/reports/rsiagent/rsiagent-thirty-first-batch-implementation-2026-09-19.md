# RSIAgent 第三十一次工程实施：私有 PM grader 进程隔离与硬终止

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第三十次工程实施：视觉点击结果的认证耐久审计合同](./rsiagent-thirtieth-batch-implementation-2026-09-19.md)<br>
> 状态：PM 探索现可把声明式私有 grader 放入受限、可硬终止的独立 Node.js 进程。目标模块字节、authority、监督器、权限策略和截止时间进入 execution manifest；任何模块替换、监督证明失败、目标崩溃或超时都降为 `unsafe`。Actor 本身的进程/文件隔离、生产隐藏集、operator 签名配置和真实 Electron PM E2E 仍未完成，因此 G01/G05 继续为“部分完成”。

## 1. execution manifest v3

原有进程内 grader 继续使用兼容的 execution manifest v2，不会被误标为隔离。只有通过 `createPmExplorationProcessGrader()` 创建的品牌化 provider 才能生成 v3 manifest，并强制签入 `graderIsolation`：

- 隔离模式必须为 `process`；
- 目标 handler ID、revision、operation 和模块字节摘要；
- Eval target digest 与 target authority digest；
- process supervisor authority digest；
- 最长 grader wall-clock deadline。

execution host 会逐字段比较 manifest 与 grader 捕获的隔离描述。把 v3 manifest 换成普通闭包 grader，或替换 target、authority、监督器、模块摘要及截止时间，都会在 Actor 运行前失败关闭。

## 2. 复用可终止的 Eval 进程监督边界

新 adapter 复用现有 Eval process supervisor，而不在 PM 路径复制一套弱化的子进程实现。监督器在装配时读取并锁定目标模块真实字节，调用前后再次核对摘要；目标以数据 URL 载入独立进程，并使用 Node permission model、显式只读/写路径、内存上限、空的启动环境和默认禁止子进程权限。

grader 子进程只收到规范的 grade request，不取得 Actor runtime、工具 broker、grader signer 或宿主回调。生产 grader 如需读取隐藏期望或只读业务结果，必须由 operator 在 sandbox policy 中显式授予所需只读路径；未授权文件访问继续由进程权限边界拒绝。

子进程输出只能包含固定的 `decision / scoreBasisPoints / resultDigest`。多余字段、accessor、非 JSON 输出、超大 stdout/stderr、异常退出和结果格式替换均不能进入签名 grader 回执。

## 3. 监督证明与签名 grader 回执绑定

每次评分会生成一次性 invocation nonce、capability digest、payload digest、target digest 和 deadline。目标完成后，PM adapter 校验监督回执中的：

- 请求、capability、目标、authority、operation 与时间线绑定；
- `isolation: process`、单次调用、硬截止和阻止迟到副作用声明；
- completed-release 撤销、target invocation digest 与 result digest；
- supervisor authority 对 enforcement payload 的同步验签结果。

监督回执摘要、目标摘要、grade request 摘要和子进程原始结果摘要会再次合成为最终 `resultDigest`，再由既有独立 grader signer 签名。grade request 已包含 execution manifest digest，因此签名 grader 回执可传递绑定到 v3 隔离配置；不能只返回一个未绑定的“进程已运行”布尔值。

## 4. 截止时间与外层预算

进程有两条独立停止路径：

1. grader 自己声明的 deadline 先到，由 supervisor 发起 hard-terminate；
2. PM round 的剩余 wall-clock budget 先耗尽，budget signal 立即撤销 invocation capability 并杀死子进程。

两条路径都不会把未完成评分解释为接受；host 签发 `unsafe / 0` grader 回执。正常完成后 capability 也会执行 completed-release，一次 invocation 不能重用。

## 5. 验证与保留边界

CLI 相关回归为 6 files、108 tests passed。新增 5 个真实子进程测试覆盖：

- 私有评分文件只授予 grader 子进程，Actor request 不含私有答案或路径；
- 启动环境为空、未授权文件读取被拒，子进程 PID 与宿主不同；
- v3 process manifest 不能搭配进程内 grader；
- 监督器捕获后替换 grader 模块字节会失败关闭；
- grader deadline 与外层 PM 总预算分别先耗尽时，挂起子进程都被硬终止。

本批没有把现有进程内 business grader 自动声明成已隔离，也没有创建生产隐藏集。仍需完成：

- Actor/Curriculum 自身的进程、上下文、检索、文件与工具隔离；
- 由 operator 签发并固定真实 grader target、sandbox policy、隐藏集与 supervisor authority；
- 真实 Desktop SQLite/workspace 只读目标在子进程内的最小权限 adapter；
- invocation/revocation 证据的生产耐久存储与重启回读；
- 独立未见任务族群上的泄漏负例、污染判定及真实 Electron DID/RBAC PM E2E。

因此，本批缩小了“私有 grader 只是同进程闭包”的缺口，但没有关闭整个 G05。
