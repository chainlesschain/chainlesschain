# 第一百七十三次工程实施：LLM Stream Controller 事件与成功回执最小披露

## 本批目标

关闭核心 `StreamController` 及 `llm-ipc-stream` 辅助桥接把 chunk 正文、完成结果、取消原因、异常对象、时间戳和内部状态直接广播或返回的缺口，同时保留流生命周期通知、控制器关联和有界统计用途。

## 实施结果

- Runtime 隐私边界新增 8 类公开流事件白名单；start、chunk、pause、resume、cancel、complete、stream-error 和 reset 统一返回冻结的 `CC_LLM_STREAM_EVENT` / component / event 回执，未知事件固定降级为 `unknown`。
- `StreamController` 不再通过 EventEmitter 发布 chunk、result、stats、reason、Error、处理计数或时间戳；取消信号只使用固定原因，调用方传入的私密取消文本不会进入 `AbortSignal.reason`。
- `llm-ipc-stream` 的 chunk/pause/resume/cancel/complete/error 六类 renderer 广播只返回 controllerId 和固定事件描述；任意上游扩展字段不会被展开，错误事件使用稳定 `CC_LLM_STREAM_FAILED` code。
- 控制器创建只返回关联所需的 controllerId，pause/resume/cancel/destroy 只返回固定成功回执；stats 只允许有限状态、布尔暂停标志和非负有限计数/速率字段，时间戳、限制对象与任意扩展被删除，Proxy/accessor 异常失败关闭。
- 生产调用方处理流正文时使用 `processChunk(chunk)` 的原参数，不依赖 EventEmitter 的业务载荷；cleanup 订阅方只依赖事件发生，因此状态机、缓冲和清理语义保持不变。

## 回归与门禁

- Stream Controller、runtime privacy、辅助 IPC 与旧注册边界定向回归：6 test files、169 tests passed。
- 完整主 LLM 回归：41 test files、598 tests passed、15 skipped。
- 相关 ESLint：0 errors。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 启动阶段另行注册的 `stream-controller-ipc.js` 12 个旧 handler 仍会返回 buffer、result、时间戳和内部统计，也尚未完成 sender/DID tenant/用途授权；本批不据此声明整个流控制面关闭。
- Test-data 的输入、用途授权与成功回执后续已由第一百七十四批收口；selector 及其他 LLM 模块的成功 payload、业务事件、日志/错误通道和订阅授权仍待处理。
- 企业 purpose/RBAC、身份切换中止与撤销、真实 Electron renderer/preload/provider E2E、tenant HMAC 和生产日志访问治理仍需目标环境验收。
