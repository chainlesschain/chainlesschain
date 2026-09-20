# 第一百三十八次工程实施：Volcengine Tools 最小披露

## 本批目标

收敛 `volcengine-tools` 对 endpoint、模型、知识库、MCP server、函数名/数量和原始 Error 的日志、异常与工具失败回注，补齐此前 provider client 边界未覆盖的工具客户端。

## 实施结果

- Volcengine Tools 的 14 处诊断/失败调用统一复用 provider 固定日志边界，直接 logger/console 归零。
- HTTP/stream 非成功响应不再读取服务端正文；非治理失败统一为固定 `CC_LLM_PROVIDER_OPERATION_FAILED`。
- 工具解析/执行失败回注给模型的内容只包含固定 message/code，不再携带 caught Error 文本。
- 模型、KB ID、MCP URL、函数名/数量、搜索模式和迭代上限不再进入普通 sink。
- `getConfig` 不再返回 baseURL 或 model，只返回 endpoint/model/API Key 配置状态及有限 timeout。

## 回归与门禁

- Volcengine Tools 隐私与 Desktop ingress 回归：2 test files、5 tests passed。
- 覆盖 HTTP failure body 不读取、固定工具错误、配置 receipt 与源码门禁。
- ESLint：0 errors、0 warnings。
- Prettier 与 `git diff --check` 通过。

## 未完成边界

- 工具成功结果、完整 messages/history、model/usage 等 payload 仍按现有内部合同返回，renderer/下游字段级授权尚未完成。
- 真实 Volcengine 网络、受治理工具执行和 provider E2E 尚未验收。
- 其他 LLM 模块日志/错误通道、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
