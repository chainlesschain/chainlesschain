# 低代码 REST 连接探针

更新：2026-10-06；本地源码能力，未发布。`AppBuilder.testConnection` 现对既有 `rest` 类型执行真实 HTTP(S) HEAD 请求，并由现有 `lowcode:test-connection` IPC 等待实际结果。其他数据库类型继续返回 `unsupported`。

## 配置与调用

```js
const source = builder.addDataSource(appId, "Health endpoint", "rest", {
  url: "http://127.0.0.1:8080/health",
  timeoutMs: 5000,
});
const result = await builder.testConnection(source.id);
```

目标地址由用户显式配置；探针只在调用测试接口时运行，启动或载入设计不会自动连接。数据源必须属于已存在的应用；配置持久化失败会抛错，不将该数据源作为已配置返回或继续留在内存列表。

支持字段为 `url`、可选 `timeoutMs`、可选且只能为 `HEAD` 的 `method`。URL 限 HTTP/HTTPS、最多 4096 字符，不允许 userinfo 或 fragment；未知配置字段拒绝。认证 Header、auth 配置及其他方法明确不支持。超时默认 5000 ms，允许整数 100–15000 ms。

使用 Node 原生 HTTP/HTTPS，不新增依赖。请求固定 HEAD，不读取业务正文，不跟随重定向、不自动重试、不附带 cookies 或认证 Header、不使用进程代理环境变量。HTTPS 保留原生证书校验。总截止时间覆盖 DNS、建连及响应 Header，响应 Header 上限 16 KiB；到期销毁请求。

## 返回语义

| 状态             | probed | 含义                                                  |
| ---------------- | ------ | ----------------------------------------------------- |
| reachable        | true   | HEAD 返回 2xx，提供真实 httpStatus 与测量的 latencyMs |
| http-error       | true   | 非 2xx/3xx，如 401、403、404、405 或 500              |
| redirect-blocked | true   | 3xx，不访问 Location                                  |
| timeout          | true   | 总期限已到，不自动重试                                |
| network-error    | true   | 建连、TLS、网络或 Header 协议错误                     |
| invalid-config   | false  | URL、超时或配置字段不符合契约                         |
| unsupported      | false  | 类型、认证或方法不支持                                |
| not-found        | false  | 数据源不存在                                          |

固定错误码分别使用 `REST_PROBE_HTTP_ERROR`、`REST_PROBE_REDIRECT_BLOCKED`、`REST_PROBE_TIMEOUT`、`REST_PROBE_NETWORK_ERROR`、`REST_PROBE_INVALID_CONFIG`、`REST_PROBE_AUTH_OR_METHOD_UNSUPPORTED`、`DATASOURCE_PROBE_UNSUPPORTED` 和 `DATASOURCE_NOT_FOUND`。主进程异常由 IPC 转为固定 `DATASOURCE_PROBE_FAILED`，不回显异常正文。

结果不回显配置 URL、响应 Header、Location 或正文。`success: true` 仅代表此时端点对 HEAD 返回成功；不能证明登录权限、数据查询、schema、真实业务数据集或应用运行。测试后数据源仍为 `configured`，设计发布仍为 `design-published`、`deployed: false`、`runtimeStatus: unsupported`，没有生成预览/部署 URL。

## 本地验证

在 Windows / Node 22.22.2，使用 Vitest 4.1.10、真实本地 HTTP 服务和 better-sqlite3 12.11.1 验证：固定 HEAD、真实耗时、2xx、401/403/404/405/500、重定向不跟随、总超时、关闭的端点、无效配置、认证/方法拒绝、SQLite 配置重载、IPC 等待与可克隆结果。数据库写入失败和不存在的父应用另有回归。

```powershell
# cwd: desktop-app-vue
node ../node_modules/vitest/vitest.mjs run --config vitest.enterprise-capabilities.config.mjs
```

六文件 118 项通过，0 失败、0 跳过；其中 REST 探针专项 21 项。该组还回归现有自动化、SCIM 及能力 IPC 状态，不代表这些外部系统已经验收。

尚需真实环境：用户提供只读健康检查端点、对应网络和证书条件；带认证接口及数据查询连接器需要另行实现和授权。本次未接入真实业务租户、数据源凭据管理、应用运行时部署或 GUI 流程，也没有执行对外部署。
