# 第一百二十八次工程实施：LLM Provider 日志隐私边界

## 本批目标

阻断 OpenAI-compatible、Anthropic、Gemini、Ollama 与 LLaVA 适配器把请求头、查询参数 API Key、prompt、响应正文、路径或完整 Error 写入普通持久化日志。

## 实施结果

- 新增统一 `provider-log-privacy` 边界；日志只接受固定消息、白名单 provider/operation 和有界 retry 次数。
- 该边界不接收也不检查 Error，因而不会触发 Error/Proxy accessor，更不会传递 Axios config、header、URL、request/response body、message 或 stack。
- OpenAI、DeepSeek、Mistral、Anthropic、Gemini、Ollama 与 LLaVA 已全部接线；LLaVA 模型拉取与初始化日志不再包含模型名。
- 业务异常传播合同保持不变；本批只收紧日志 sink，不把日志边界误写成业务响应治理。
- 递归源码门禁覆盖 `src/main/llm/*-client.js`，禁止 provider client 重新直连通用 logger 或 console。

## 回归与门禁

- Provider 客户端回归：7 test files、54 tests passed、15 skipped。
- 隐私负例覆盖带秘密的 hostile Error/Proxy、未知 provider/operation 和越界 retry 计数。
- ESLint：0 errors（7 条既有未使用 catch 参数 warning）。
- `git diff --check` 通过。

## 未完成边界

- Provider 返回的业务异常文本仍可能经上层响应或其他非 provider-client 模块处理；本批只证明选定适配器的普通日志 sink 不再接收这些内容。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，不能据此解除生产 authority、隐私审批或真实 Electron/browser/provider E2E 要求。
