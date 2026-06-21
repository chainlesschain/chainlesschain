# 远程 MCP 授权（cc mcp OAuth）

> **版本: Claude-Code 远程 MCP OAuth 平价 | 状态: ✅ 生产可用 | Auth Code + PKCE | 16 单元测试全绿**
>
> 对受 OAuth 保护的远程 HTTP/SSE MCP server，用 `cc mcp login <url>` 走标准 OAuth 2.0 授权码 + PKCE 流程授权一次，token 存盘后在每次 connect 时自动注入 `Authorization: Bearer`。支持令牌过期自动 refresh。

## 概述

越来越多的远程 MCP（Model Context Protocol）server 受 OAuth 保护。`cc mcp login <url>` 实现完整的授权码 + PKCE 浏览器流程：自动发现授权服务器、动态注册客户端、起本地回调、开浏览器授权、换取并存储 token。此后凡是配置中带 `url` 的 MCP server，在 connect 前会自动注入有效的 `Bearer` token（过期且有 refresh token 则先刷新），无需每次手动贴 token。

token 按 **server origin** 索引存储于 `~/.chainlesschain/mcp-oauth.json`，因此同一 origin 的 http/https/path 变体共享同一份授权。

## 核心特性

- 🔐 **授权码 + PKCE**：标准 OAuth 2.0 Authorization Code 流程，PKCE（S256）防授权码拦截
- 🔎 **自动发现**：RFC 9728 protected-resource → `authorization_servers[]` → RFC 8414 `oauth-authorization-server` / OpenID configuration，无元数据则回退 origin
- 📝 **动态注册**：RFC 7591 动态客户端注册（public client，`token_endpoint_auth_method: none`）
- 🌐 **浏览器授权 + 本地回调**：起 `localhost` 回调 server（默认端口 53682，校验 `state` 防 CSRF），自动开系统浏览器
- 💾 **按 origin 存储**：token 存 `~/.chainlesschain/mcp-oauth.json`，按 `URL.origin` 索引
- ♻️ **自动刷新**：connect 前 `ensureValidToken`，过期（60s skew）且有 refresh token + endpoints 则刷新，失败回退旧 token
- 🔌 **透明注入**：`setupMcpFromConfig` 对带 `url` 的 server **若未显式给 `Authorization` 头**则注入 Bearer；显式 `-H Authorization` 头不被覆盖
- 🧪 **纯函数可测**：发现/注册/PKCE/换 token/刷新均为纯函数，`_deps` 注入

## 系统架构

```
cc mcp login <url>
   │
   ▼
┌─────────────────────────── mcp-oauth.js ───────────────────────────┐
│ authorizeInteractive(serverUrl, {scope, clientId, port, ...})       │
│   1. discoverAuthMetadata   RFC 9728 → 8414 / openid-configuration  │
│   2. registerClient         RFC 7591 动态注册（缺 clientId 时）       │
│   3. generatePkce           S256 / base64url                        │
│   4. waitForCallback        起 localhost:53682，校验 state          │
│   5. defaultOpenBrowser     win:start / mac:open / linux:xdg-open   │
│   6. exchangeCodeForToken   换 access/refresh token                  │
│   7. saveStoredToken        ~/.chainlesschain/mcp-oauth.json (origin)│
└─────────────────────────────────────────────────────────────────────┘

connect 时（每次）：
  setupMcpFromConfig → 带 url 且无显式 Authorization
    → ensureValidToken(url)  （过期+有 refresh → refreshAccessToken）
    → connectCfg.headers.Authorization = "Bearer " + token
```

## 命令参考

```bash
cc mcp login <url> [--scope <s>] [--client-id <id>] [--port <n>] [--no-open]
                                              # 授权一次（浏览器流程），存 token
cc mcp logout <url>                           # 按 origin 删除已存 token
cc mcp auth [--json]                          # 列出各 origin 的授权状态（valid/expired/有无 refresh）
```

| flag               | 说明                               |
| ------------------ | ---------------------------------- |
| `--scope <s>`      | 请求的 OAuth scope                 |
| `--client-id <id>` | 跳过动态注册，使用已有 client id   |
| `--port <n>`       | 本地回调端口（默认 53682）         |
| `--no-open`        | 不自动开浏览器（手动打印授权 URL） |

## 配置参考

授权后，MCP 配置中只需给 server 的 `url`，Bearer 会自动注入：

```json
{
  "mcpServers": {
    "remote-tools": { "url": "https://mcp.example.com/sse" }
  }
}
```

- **token 存储**：`~/.chainlesschain/mcp-oauth.json`，按 `serverKey = URL.origin` 索引。
- **过期判定**：`isTokenExpired` 带 60s skew；`ensureValidToken` 到期且有 `refresh_token` + endpoints 时刷新。
- **显式头优先**：若配置中已有静态 `Authorization` 头，则不注入（不覆盖用户显式头）。

## 性能指标

- **一次授权，长期复用**：登录一次后，后续 connect 仅做本地 token 读取（必要时一次刷新请求），无重复浏览器流程。
- **刷新有回退**：刷新失败回退旧 token，不因网络抖动直接断开。
- **回调即时**：本地回调 server 收到授权码后立即换 token 并关闭。

## 测试覆盖率

共 **16** 个单元测试：

```bash
cd packages/cli
npx vitest run __tests__/unit/mcp-oauth.test.js
```

| 覆盖                                                                 | 数量 |
| -------------------------------------------------------------------- | ---- |
| 纯流程（discover/register/pkce/exchange/refresh/token store/expiry） | 14   |
| connect 时 Bearer 注入                                               | 2    |

> 浏览器编排 `authorizeInteractive` 无真 OAuth server 端到端测试（thin glue，纯函数块全测）；`cc mcp auth` / `logout` 有真 CLI e2e。

## 安全考虑

- **PKCE 防拦截**：S256 PKCE 使授权码即便被截获也无法换取 token。
- **state 防 CSRF**：本地回调校验 `state`，拒绝伪造回调。
- **public client**：动态注册为 public client（无 client secret），token 仅存本地。
- **不覆盖显式凭据**：仅在未显式提供 `Authorization` 头时注入，尊重用户手动配置。
- **按 origin 隔离**：token 按 origin 索引，避免跨站串用。

## 故障排查

| 现象                            | 可能原因                                               | 处理                                                                        |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Windows 下 token store 路径不对 | `os.homedir()` 在 Windows 读 `USERPROFILE` 而非 `HOME` | smoke 测试用 `USERPROFILE=$TMP`；正常使用读 `%USERPROFILE%\.chainlesschain` |
| 浏览器没自动打开                | 用了 `--no-open`，或系统无默认浏览器                   | 手动复制打印的授权 URL；或去掉 `--no-open`                                  |
| 回调端口被占用                  | 53682 已被占用                                         | `--port <n>` 指定其它端口                                                   |
| connect 仍 401                  | token 过期且无 refresh token                           | 重新 `cc mcp login <url>`                                                   |
| 显式 token 没生效自动 Bearer    | 配置里已有静态 `Authorization` 头                      | 预期：显式头优先，不被覆盖                                                  |

## 关键文件

| 文件                                            | 说明                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/lib/mcp-oauth.js`             | `generatePkce` / `discoverAuthMetadata` / `registerClient` / `buildAuthorizeUrl` / `exchangeCodeForToken` / `refreshAccessToken` / token store / `authorizeInteractive`（`_deps` 注入） |
| `packages/cli/src/runtime/mcp-config.js`        | `setupMcpFromConfig` connect 前 `ensureValidToken` + Bearer 注入                                                                                                                        |
| `packages/cli/src/commands/mcp.js`              | `cc mcp login \| logout \| auth`                                                                                                                                                        |
| `packages/cli/__tests__/unit/mcp-oauth.test.js` | 16 单元测试                                                                                                                                                                             |

## 使用示例

```bash
# 1) 对受 OAuth 保护的远程 MCP server 授权一次（自动开浏览器）
cc mcp login https://mcp.example.com/sse

# 2) 指定 scope / 自定义回调端口 / 不自动开浏览器
cc mcp login https://mcp.example.com/sse --scope "tools:read" --port 8765 --no-open

# 3) 查看各 server 的授权状态
cc mcp auth --json

# 4) 之后正常用带 url 的 MCP 配置，Bearer 自动注入
cc agent --mcp-config ./mcp.json -p "用远程工具查一下…"

# 5) 注销某 server 的授权
cc mcp logout https://mcp.example.com/sse
```

## 相关文档

- [MCP 集成](./cli-mcp.md)
- [CLI Agent 智能代理](./cli-agent.md)
- [IDE 桥接](./ide-bridge.md)
- [权限系统](./permissions.md)
- [联网搜索 (web_search)](./web-search.md)
