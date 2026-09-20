# 第九十六次工程实施：Marketplace Health 地址最小披露

日期：2026-09-20

## 本批结论

本批关闭 Marketplace `checkHealth()` 在成功和失败回执中返回服务端 `baseURL` 的路径。健康检查现在只报告 `healthy/unhealthy`，成功时附带本次请求延迟；连接目标地址不再随健康结果传播。

代码检索确认生产代码没有消费健康回执中的 `baseURL`，因此该收窄不影响现有调用链。`getConfig()` 仍保留管理配置查询能力，其 renderer 可见性和读取授权需要单独裁决，本批不把它误算为已关闭。

## 主要实现

- 健康检查成功结果删除 `data.baseURL`。
- 健康检查失败结果删除 `data.baseURL`。
- 成功与失败回归均断言健康数据不含 `baseURL`。
- 原有动态 Error 最小披露、稳定失败 descriptor 与 latency 行为保持不变。

## 验证结果

```text
Marketplace client and plugin boundaries:
  Test Files  3 passed (3)
  Tests      65 passed (65)

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- `getConfig()` 的配置 `baseURL` 仍需基于 renderer 角色和用途进行读取授权。
- Plugin/Marketplace 成功业务 payload、manifest、详情、列表、评论、评分与发布数据仍需字段级用途授权和容量限制。
- 内部 rethrow、旧错误数据库行、sandbox/第三方日志、tenant HMAC 与生产 Electron E2E 仍待完成。
