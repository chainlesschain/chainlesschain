# 第九十七次工程实施：Marketplace 配置地址最小披露

日期：2026-09-20

## 本批结论

本批关闭 `MarketplaceClient.getConfig()` 返回连接目标 `baseURL` 的路径。配置摘要现在只报告地址是否已配置，并继续保留 timeout、重试上限、认证状态和客户端可用状态，不返回实际 endpoint。

仓库检索确认该方法没有生产调用方，也没有对应 IPC/preload 通道，当前仅由单元测试直接调用。因此无需扩大授权面；在方法源头使用非敏感投影即可避免未来调用者误传播连接地址。

## 主要实现

- `getConfig()` 删除原始 `baseURL`。
- 新增布尔字段 `hasBaseURL`，仅表明地址配置是否存在。
- JSDoc 明确该接口是“不含 endpoint 值”的非敏感摘要。
- 回归向配置地址注入 secret，验证返回对象既没有 `baseURL` 字段，也不含原文。

## 验证结果

```text
Marketplace client and plugin boundaries:
  Test Files  3 passed (3)
  Tests      65 passed (65)

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- Plugin/Marketplace 成功业务 payload、manifest、详情、列表、评论、评分与发布数据仍需字段级用途授权和容量限制。
- 内部 rethrow、旧错误数据库行和跨 tenant 读取治理尚未完成。
- sandbox/第三方 SDK/provider 原生日志、tenant HMAC 与生产 Electron E2E 仍待完成。
