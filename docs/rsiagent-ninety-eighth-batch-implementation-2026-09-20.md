# 第九十八次工程实施：Marketplace Client 内部异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `MarketplaceClient` 在 request/setup interceptor 和重试耗尽时原样 rethrow 第三方动态 Error 的路径。内部请求失败现在统一生成固定 message/code，只允许 400–599 安全整数 status 以及 HTTP、network、transient 三个布尔分类继续传播。

网络错误码也限制到既有瞬态错误白名单，未知动态 code 归一为 `ERR_NETWORK`。显式、受控的 API 状态文案仍保留；其他 Plugin/Marketplace 模块的内部 rethrow 不在本批关闭范围内。

## 主要实现

- 新增 `createMarketplaceRequestError` 固定内部请求错误的 message/code。
- request interceptor 和 response setup error 不再 `Promise.reject(error)`。
- `_requestWithRetry` 在终止重试和安全兜底时不再 `throw error/lastError`。
- 原始 status 仅在 400–599 安全整数范围内保留。
- network code 只允许既有瞬态错误白名单，未知值归一化。
- 回归覆盖含 secret 的重试终止异常和非数值 status 丢弃。

## 验证结果

```text
Marketplace client and plugin boundaries:
  Test Files  3 passed (3)
  Tests      67 passed (67)

Source gate:
  raw throw/reject(error) in marketplace-client.js: 0

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin Installer、Manager、Registry、Sandbox、API 与其他 Marketplace 模块仍有内部 rethrow，需要逐类保留受控语义并移除第三方异常正文。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
