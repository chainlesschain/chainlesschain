# 第一百三十一次工程实施：LLM Core IPC 失败边界

## 本批目标

封住 `llm-ipc-core` 顶层 handler 的原始异常与动态状态返回，防止 prompt、配置、provider 响应、路径、Error/cause 或诊断附加字段跨 Electron IPC 暴露。

## 实施结果

- `check-status` 失败统一返回固定 `LLM service unavailable / CC_LLM_IPC_UNAVAILABLE` 与白名单 component/operation。
- query、chat、template chat、query stream、get/set config、clear context 与 embeddings 失败统一返回固定 `CC_LLM_IPC_OPERATION_FAILED`。
- `list-models` 保持失败返回空数组的兼容合同，但日志改由固定隐私边界记录。
- `CC_AGENT_EVOLUTION_INGRESS_FAILED` 会被重建为无 cause 的固定错误，只保留治理 code 和白名单 component/operation，不原样 rethrow。
- Chat 顶层 catch 不再把原始异常交给 ErrorMonitor 分析或把 AI diagnosis/recommendations 附回公开 Error。
- 源码门禁禁止十个顶层 catch 恢复旧动态日志、`error.message` 状态返回或原始 ErrorMonitor 分析。

## 回归与门禁

- Core + Selector IPC 隐私回归：2 test files、6 tests passed。
- 覆盖十个 core handler、hostile Error accessor、配置秘密、prompt/上下文秘密及治理错误重建。
- ESLint：0 errors、0 warnings。
- `git diff --check` 通过。

## 未完成边界

- Core handler 内部降级、RAG/MCP/session/cache 等日志及成功业务 payload 尚未统一最小披露；get-config 成功字段也需单独投影。
- `llm-manager`、其他 LLM IPC 分组与 selector 内部业务日志仍待收口。
- Electron JavaScript 入口前的原生致命 stderr、tenant HMAC、生产日志保留/访问控制仍未完成。
- G03 仍为部分完成，真实 Electron/browser/provider E2E 与生产 authority/隐私验收仍不可省略。
