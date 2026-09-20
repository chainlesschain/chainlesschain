# 第一百四十次工程实施：LLM 运行时诊断最小披露

## 本批目标

收敛 `llm-state-bus` 与 `stream-controller` 的动态诊断，避免自定义事件名、监听器异常和运行状态进入通用日志。

## 实施结果

- 新增 LLM runtime 固定诊断边界，仅接受 `state-bus`、`stream-controller` 组件和四个白名单事件。
- State Bus 重复绑定与监听器失败不再记录动态事件名或 caught Error。
- Stream Controller 的非法暂停/恢复只记录固定拒绝事件，不再记录当前运行状态。
- 两个消费者的直接 logger/console 与 `error.message` 访问已归零，状态机、事件分发和返回合同保持不变。

## 回归与门禁

- Runtime Privacy、State Bus 与 Stream Controller 回归：4 test files、129 tests passed。
- 新增源码门禁，防止两个消费者重新引入直接 logger/console 或 Error message 读取。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- State Bus 的业务 payload 和 Stream Controller 的内部 `stream-error` 事件合同未在本批改变；跨 IPC 输出仍需独立授权与投影。
- `stream-controller-ipc` 及其他 LLM 模块的日志、错误返回和 sender/tenant/用途授权仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
