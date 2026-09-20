# 第一百二十九次工程实施：LLM Provider 失败最小披露

## 本批目标

阻断 provider client 在日志已脱敏后，继续通过状态结果、抛出异常、stream rejection 或错误事件把服务端正文、API 地址、查询参数、路径及原始 Error 交给上层。

## 实施结果

- Provider 状态失败统一返回固定 `LLM provider unavailable / CC_LLM_PROVIDER_UNAVAILABLE`，仅附白名单 provider/operation。
- Provider 操作失败统一抛出固定 `LLM provider operation failed / CC_LLM_PROVIDER_OPERATION_FAILED`，不附原始 Error、`cause`、status、URL 或服务端 message。
- OpenAI/DeepSeek/Mistral、Anthropic、Gemini、Ollama 与 LLaVA 的同步、异步和 stream 失败路径均接入稳定错误边界。
- OpenAI 旧 `_formatAPIError` 与 Gemini 旧 `_extractError` 已删除，不再把 baseURL 或 provider message 拼入公开异常。
- LLaVA 错误事件不再携带原始 Error、图片路径或 prompt；治理专用 `CC_AGENT_EVOLUTION_INGRESS_FAILED` 仍按原合同保留。

## 回归与门禁

- Provider 客户端回归：7 test files、55 tests passed、15 skipped。
- 7 类 provider status 负例验证包含 response body 的秘密不进入结果；Ollama 拉取、删除、模型信息失败验证固定 code/provider/operation。
- 源码门禁阻止 provider client 恢复动态 error formatter/extractor、直接 logger 或 console。
- ESLint：0 errors、0 warnings。
- `git diff --check` 通过。

## 未完成边界

- 本批不改变 provider 成功业务 payload，也不声明 `src/main/llm` 中非 `*-client.js` 模块及其他 provider/handler 错误通道已经完成最小披露。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
