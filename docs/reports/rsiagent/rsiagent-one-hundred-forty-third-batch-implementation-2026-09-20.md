# 第一百四十三次工程实施：Volcengine 内置函数 Capability 边界

## 本批目标

移除 `volcengine-ipc` 中可直接访问笔记数据库、文件系统、P2P 意图和系统信息的旧本地执行器。即使后续恢复 Volcengine Function Calling，也必须先取得与当前 actor、tenant、sender 和固定用途绑定的主进程 capability，并取得可校验的执行回执。

## 实施结果

- `volcengine-ipc` 已删除九类内置函数的数据库、文件系统、系统信息与本地消息实现，不再包含 `getDatabase`、`readFile`、`readdir`、`hostname` 等直接副作用路径。
- 新增 `volcengine-function-capability`：host 是保存在私有 `WeakMap` 中的冻结空对象，只能由捕获过的 authority port 创建；伪造普通对象不能通过品牌校验。
- authority descriptor 固定绑定 schema、authority、tenant、`model-tool-execution` 用途、函数白名单和 `authenticated-durable-readback` 审计模式。旧 `database`、`filesystem` 等 executor selector 不再选择本地实现，唯一受理值为 `capability`。
- 每次执行请求绑定主进程授权产生的 actor DID、tenant、sender、IPC operation、函数名、参数摘要、请求 ID 和请求摘要。renderer 额外参数不会替换授权上下文。
- 参数与结果只接受有界 plain JSON；Proxy、accessor、循环引用、危险键、非有限数值、过深/过多字段和超限 payload 均在 authority 副作用前失败关闭。参数上限为 64 KiB，结果上限为 256 KiB。
- authority 必须原子执行并返回同时绑定 request digest 与 result digest 的耐久回执；回执 schema、authority、tenant、actor、purpose、函数名、audit mode 或时间不匹配时，工具结果不会进入模型循环。
- capability 缺失、tenant 不一致、函数不在 authority 白名单、authority 异常或回执不匹配均统一为 `CC_AGENT_EVOLUTION_INGRESS_FAILED`，不携带路径、参数、函数结果或 authority 异常文本。
- Desktop 注册点已预留 `volcengineFunctionExecutionHost` 依赖。当前签名 deployment 未提供该能力，因此 Function Calling 继续失败关闭，不会回退到旧本地实现。

## 回归与门禁

- Volcengine capability、IPC 授权、IPC 隐私与 Tools 隐私定向回归：4 test files、27 tests passed。
- 完整 LLM 主进程回归：32 test files、509 tests passed、15 tests skipped。
- 新增 opaque host、actor/tenant/sender/purpose 绑定、legacy selector、伪造 host、函数白名单、accessor 参数、错误回执与 authority 异常覆盖。
- 相关新增与修改模块 ESLint：0 errors、0 warnings。
- Desktop 主进程构建、JavaScript 语法检查与 `git diff --check` 通过。

## 未完成边界

- 尚未在签名 evolution deployment 中实现并装配真实 `volcengineFunctionExecutionAuthority`；当前 capability 合同只提供失败关闭边界，不声明数据库、文件、P2P 或系统信息工具已经可用。
- 每类业务函数仍需独立的资源范围、最小字段投影、审批、撤销、deadline、取消和不可逆副作用恢复策略；不得在 IPC 模块重新加入本地 switch 实现。
- Volcengine provider 成功 payload、真实网络工具循环、Electron renderer/preload、企业 tenant/RBAC、身份切换与撤销仍需目标环境 E2E。
- G03 仍为部分完成；生产 authority、tenant HMAC、生产日志治理以及真实 Electron/browser/provider/custody 验收不因本批实现而关闭。
