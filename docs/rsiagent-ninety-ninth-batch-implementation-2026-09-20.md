# 第九十九次工程实施：Plugin Marketplace API 内部异常最小披露

日期：2026-09-20

## 本批结论

本批关闭 `plugins/marketplace-api.js` 的 14 条 catch-and-rethrow 旁路。列表、详情、下载、版本、更新检查、评分、评论、发布、更新、分类、搜索、推荐、举报和统计请求失败时，不再把 Axios/第三方动态 Error 原样交给直接调用者。

统一错误使用固定 message/code，只在 status 为 400–599 安全整数时保留数值。现有 stale-cache 降级行为保持不变；Installer、Manager、Registry、Sandbox 等其他模块的内部 rethrow 不在本批关闭范围内。

## 主要实现

- 新增 `createPluginMarketplaceRequestError`，固定为 `PLUGIN_MARKETPLACE_REQUEST_FAILED`。
- 兼容从 Error 顶层或 Axios `response.status` 读取状态，但只允许 400–599 安全整数。
- 14 条 `throw error` 全部改为稳定错误投影。
- 运行时回归向 Error 和 response body 注入 secret，验证直接调用者拿不到原文。
- 源码门禁断言该模块的 `throw error/err/e` 为 0。

## 验证结果

```text
Plugin Marketplace API and shared boundaries:
  Test Files  3 passed (3)
  Tests      16 passed (16)

Source gate:
  raw caught-error rethrows in marketplace-api.js: 0

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin Installer、Manager、Registry、Sandbox、API facade 与部分 Marketplace 模块仍有内部 rethrow。
- 旧错误数据库行、成功业务 payload 和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
