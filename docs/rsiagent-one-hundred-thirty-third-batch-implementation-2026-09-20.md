# 第一百三十三次工程实施：LLM Core 内部日志最小披露

## 本批目标

收敛 `llm-ipc-core` 内部 RAG、MCP、session、cache、模型选择和模板流程的普通日志，阻断输入规模、token、provider/model、session/agent/tool/template 标识及原始异常进入通用 sink。

## 实施结果

- Core 不再直接导入通用 logger，也不存在直接 `logger.*` 或 `console.*` 调用。
- 47 处内部诊断调用统一进入 `llm-ipc-privacy`，只输出固定消息、`core` component 与白名单事件名。
- 未知动态事件名固定降级为 `unknown`，不允许把调用参数、配置、业务标识或 Error 透传到 sink。
- ErrorMonitor 暂停预检查改用固定 IPC failure，不再靠异常 message 文本判断是否重新抛出。
- MCP 工具执行失败回注给模型的内容改为固定 message/code，不再包含工具抛出的原始错误文本。
- 既有 governance 回归已改为验证固定隐私错误，同时继续验证 manager、app、全局实例、共享 tracker/cache 与 prompt compressor 的引用连续性。

## 回归与门禁

- LLM IPC、governance、config projection 与 Core/Selector 隐私回归：5 test files、83 tests passed。
- 新增 Core 源码门禁，禁止直接通用 logger/console，并验证所有静态内部事件均属于隐私边界白名单。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- Core 返回的 chat/RAG/cache/optimization 等成功 payload 仍按现有合同返回，尚未完成字段级 renderer 授权与最小披露。
- `llm-manager`、stream/token/alert/budget/retention/test-data 等其他 LLM IPC 分组和 renderer 日志仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
