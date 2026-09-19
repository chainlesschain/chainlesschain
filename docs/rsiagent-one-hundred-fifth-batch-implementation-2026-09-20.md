# 第一百零五次工程实施：Plugin API Facade 异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugin-api.js` 的 secure method 原样 rethrow。权限检查和下游 database/LLM/RAG/UI/file/network 等实现抛出的动态 Error 现在统一为 `PLUGIN_OPERATION_FAILED`；明确的模型/网络治理拒绝继续保留 `CC_AGENT_EVOLUTION_INGRESS_FAILED` code，但 message 也被固定化。

失败统计和 API 调用计数保持不变。`logAPICall` 的错误文本参数本来不写数据库，本批将该未使用参数及 `error.message` 传递一并删除，避免未来持久化实现误用动态正文。

## 主要实现

- Plugin API facade 接入共享稳定 operation Error。
- 新增治理拒绝投影，只白名单保留 `CC_AGENT_EVOLUTION_INGRESS_FAILED` code。
- secure method catch 不再 `throw error`。
- 失败统计仍递增，API stats 写入行为和 schema 不变。
- 删除未使用的 `logAPICall(..., error.message)` 参数。
- 回归注入 secure method secret，并以源码门禁覆盖原样 rethrow 和动态日志参数。

## 验证结果

```text
Plugin API and shared boundaries:
  Test Files  3 passed (3)
  Tests      24 passed (24)

Source gates:
  raw caught-error rethrows in plugin-api.js: 0
  dynamic error.message log argument: 0

ESLint:
  0 errors (5 pre-existing warnings)
```

## 仍未完成

- Plugin Loader、Permission Dialog、Plugin IPC fallback、Skill Marketplace Client 与 Update Manager 仍有原样内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- 真实 OS/network sandbox、第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
