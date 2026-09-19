# 第九十四次工程实施：Marketplace HTTP Client 错误响应最小披露

日期：2026-09-20

## 本批结论

本批关闭 Marketplace HTTP Client 把服务端 message、完整 `apiResponse`、网络错误和 setup Error 传播到公开方法结果的路径。捕获失败统一返回 `MARKETPLACE_OPERATION_FAILED`；仅当 status 是 400–599 的安全整数时保留该数值，错误响应正文不再进入结果。

显式调用方输入校验（例如空搜索关键字）仍返回受控文案。健康检查保留 `healthy/unhealthy` 状态与原有 baseURL 字段，但动态连接错误不再拼入 `error`；原始异常只进入严格 Plugin logger。

## 主要实现

- 标准 API `success:false` 响应不再从远端 `data.message` 构造 Error，也不附加 `apiResponse`。
- HTTP status 映射改为固定文案；400/404/409/422/500 和未知状态均不拼接响应 message。
- `_handleMethodError` 固定返回 marketplace descriptor，删除 `apiData`，只允许 400–599 安全整数 status。
- health check 失败返回固定 descriptor，注入 Error 只进入脱敏日志。
- 回归覆盖 client unavailable、health secret、Error message/API response secret、合法 status 保留及字符串 status 丢弃。

## 验证结果

```text
Marketplace client and plugin boundaries:
  Test Files  3 passed (3)
  Tests      65 passed (65)

ESLint:
  0 errors (1 pre-existing warning)
```

## 仍未完成

- 成功 marketplace 响应、插件详情/列表、manifest、评论/评分与发布数据仍需字段级用途授权和容量限制。
- health 成功/失败 payload 中的 baseURL 是否可向各 renderer 角色披露仍需策略裁决。
- Marketplace/Plugin 内部直接调用者仍可能收到原始 rethrow；旧错误数据库行和跨 tenant 读取治理未完成。
- 第三方 SDK/provider 原生日志、tenant HMAC、生产保留/删除、访问告警与真实 Electron E2E 仍待完成。
