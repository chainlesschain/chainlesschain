# SSO 企业认证 CLI（Phase 14）

> `chainlesschain sso` — SAML/OAuth2/OIDC 配置管理 + PKCE + 会话生命周期 + DID 身份桥接。
>
> AES-256-GCM 令牌加密（PBKDF2-sha512 100k 迭代）+ SSO↔DID 身份映射。

---

## 概述

SSO 模块为企业提供单点登录集成，支持 SAML 2.0、OAuth 2.0 和 OpenID Connect
三种协议。包含提供商配置 CRUD、PKCE S256 生成、授权 URL 构建、SAML AuthnRequest
构建、会话生命周期管理，以及 SSO 身份与 DID 的双向桥接。

---

## 核心特性

- **三协议支持** — SAML 2.0 / OAuth 2.0 / OpenID Connect
- **4 种提供商类型** — Azure AD / Okta / Google / Custom（扩展点）
- **PKCE S256** — OAuth2/OIDC 推荐的授权码流程安全增强
- **AES-256-GCM 令牌加密** — PBKDF2-sha512 100k 迭代派生加密密钥
- **会话生命周期** — 发起 / 活跃 / 刷新 / 过期 / 销毁；支持会话有效性校验
- **SSO ↔ DID 桥接** — 同一 SSO 身份可绑定 DID，支持冲突检测
- **V2 治理层** — 35 V2 tests；4 态 provider maturity + 5 态 login lifecycle（`sso_manager_v2_cli.md`）

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│          chainlesschain sso (Phase 14)               │
├─────────────────────────────────────────────────────┤
│  Provider Configs          │  Auth Flow             │
│  SAML / OAuth2 / OIDC      │  PKCE S256             │
│  Azure AD / Okta / Google  │  login-url / saml-     │
│                            │  authn-request         │
├─────────────────────────────────────────────────────┤
│  Session Mgr               │  Token Storage         │
│  create / refresh / expire │  AES-256-GCM           │
│  destroy / valid           │  PBKDF2-sha512 (100k)  │
├─────────────────────────────────────────────────────┤
│  Identity Bridge (SSO ↔ DID)                         │
│  link / unlink / did-for-sso / conflict-check        │
├─────────────────────────────────────────────────────┤
│  SQLite: sso_providers / sso_sessions /              │
│          sso_identities                              │
└─────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                    | 含义                    | 默认                |
| ------------------------- | ----------------------- | ------------------- |
| `protocols`               | 支持协议                | saml / oauth2 / oidc |
| `provider-types`          | 提供商                  | azure-ad / okta / google / custom |
| `token_encryption`        | 令牌加密算法            | AES-256-GCM         |
| `kdf.iterations`          | PBKDF2 迭代次数         | 100000              |
| `kdf.hash`                | 散列算法                | sha512              |
| V2 per-owner active cap   | per memory 文件         | 见 `sso_manager_v2_cli.md` |

查看：`chainlesschain sso protocols`、`sso provider-types`、`sso templates`。

---

## 性能指标

| 操作                         | 典型耗时          |
| ---------------------------- | ----------------- |
| create provider              | < 15 ms           |
| generate-pkce                | < 5 ms            |
| login-url（OAuth2/OIDC）     | < 10 ms           |
| saml-authn-request           | < 15 ms           |
| complete-login（含解密）     | < 30 ms           |
| session-valid                | < 10 ms           |
| link / unlink                | < 15 ms           |
| V2 createLoginV2 dispatch    | < 50 ms           |

---

## 测试覆盖率

```
__tests__/unit/sso-manager.test.js — 110 tests (1140 lines)
```

覆盖：provider CRUD、三协议 login-url 构建、PKCE S256 生成/验证、
SAML AuthnRequest XML 结构、session 生命周期全路径（创建/刷新/过期/销毁）、
token AES-256-GCM 加解密、identity link/unlink、conflict-check。
V2 surface：35 V2 tests（见 `sso_manager_v2_cli.md`）。

---

## 安全考虑

1. **PKCE 防授权码拦截** — OAuth2/OIDC 必用 S256，CLI 默认生成
2. **令牌静态加密** — access/refresh token 以 AES-256-GCM 存 SQLite；密钥派生自环境 secret
3. **SAML XML 签名验证** — `saml-authn-request` 仅构建请求；完整 SAML 响应验证由上层完成，注意 XSW 攻击面
4. **session 过期即失效** — `valid <id>` 应在每次 API 调用前校验；不要缓存会话对象
5. **identity 冲突** — 同一 SSO user-id 绑定多个 DID 时 `conflict-check` 返回 true，需人工解决

---

## 故障排查

**Q: `complete-login` 报 invalid PKCE verifier?**

1. `--verifier` 必须对应之前 `generate-pkce` 的 verifier（code_verifier）
2. 授权码单次有效；重新发起 `login-url` 获取新授权码
3. provider 是否启用了 PKCE（Okta/Azure AD 默认开启）

**Q: `saml-authn-request` 输出的 XML 被 IdP 拒绝?**

1. CLI 只构建 request；签名验证由上层处理
2. `provider show` 检查 `issuer-url` / entity ID 是否正确
3. 测试时可用 `sso test <id>` 检查连通性

**Q: session 一直 valid 但实际服务返回 401?**

1. session 有效性只检查 CLI 侧过期时间，不代表 IdP 侧 token 有效
2. `refresh-session <id>` 主动刷新 access token
3. 或 `destroy-session` 后重新登录

**Q: V2 createLoginV2 报 cap exceeded?**

`sso gov-stats-v2` 查看 per-provider pending-login 数；超过 `perProviderPendingLoginCap` 时新建 login 会失败，等待现有登录完成或 fail 即可。

---

## 关键文件

- `packages/cli/src/commands/sso.js` — Commander 子命令
- `packages/cli/src/lib/sso-manager.js` — 三协议 + PKCE + 加密 + DID 桥接
- `packages/cli/__tests__/unit/sso-manager.test.js` — 单测（110 tests）
- 数据表：`sso_providers` / `sso_sessions` / `sso_identities`
- 设计文档：`docs/design/modules/14_身份权限系统.md`

---

## 使用示例

```bash
# 1. 创建 Azure AD OIDC 提供商
cid=$(chainlesschain sso create --name "Azure AD" --protocol oidc --provider-type azure-ad \
  --client-id <id> --client-secret <secret> \
  --issuer-url https://login.microsoftonline.com/tid/v2.0 --json | jq -r .id)

# 2. PKCE + login-url
pkce=$(chainlesschain sso generate-pkce --json)
verifier=$(echo $pkce | jq -r .verifier)
chainlesschain sso login-url $cid --redirect-uri https://app.example.com/callback

# 3. 完成登录
chainlesschain sso complete-login $cid --code "<auth-code>" --verifier $verifier

# 4. 会话管理
sid=$(chainlesschain sso sessions --json | jq -r '.[0].id')
chainlesschain sso refresh-session $sid
chainlesschain sso valid $sid

# 5. SSO ↔ DID 桥接
chainlesschain sso link --sso-provider $cid --sso-user-id alice@corp --did did:key:z6Mk...
chainlesschain sso conflict-check --provider $cid --sso-user-id alice@corp

# 6. V2 治理统计
chainlesschain sso gov-stats-v2
chainlesschain sso stats --json
```

---

## 目录/枚举

```bash
chainlesschain sso protocols       # 列出支持的协议（saml/oauth2/oidc）
chainlesschain sso provider-types  # 列出提供商类型（azure-ad/okta/google/custom 等）
chainlesschain sso templates       # 列出预置模板
chainlesschain sso template <name> # 查看模板详情
```

---

## 提供商配置

```bash
# 创建 SSO 提供商
chainlesschain sso create --name "Azure AD" --protocol oidc --provider-type azure-ad \
  --client-id <id> --client-secret <secret> --issuer-url https://login.microsoftonline.com/...

# 列出 / 查看 / 更新 / 删除
chainlesschain sso configs
chainlesschain sso show <config-id>
chainlesschain sso update <config-id> --client-id <new-id>
chainlesschain sso delete <config-id>

# 测试连通性
chainlesschain sso test <config-id>
```

---

## 认证流程

```bash
# 生成 PKCE 挑战（S256）
chainlesschain sso generate-pkce

# 构建授权 URL（OAuth2/OIDC）
chainlesschain sso login-url <config-id> --redirect-uri https://app.example.com/callback

# 构建 SAML AuthnRequest
chainlesschain sso saml-authn-request <config-id>

# 完成登录（交换授权码为令牌）
chainlesschain sso complete-login <config-id> --code <auth-code> --verifier <pkce-verifier>
```

---

## 会话管理

```bash
chainlesschain sso sessions                    # 列出活跃会话
chainlesschain sso session <session-id>         # 查看会话详情
chainlesschain sso refresh-session <session-id> # 刷新令牌
chainlesschain sso destroy-session <session-id> # 销毁会话
chainlesschain sso expire-session <session-id>  # 标记过期
chainlesschain sso valid <session-id>           # 验证会话有效性
```

---

## DID 身份桥接

```bash
# 关联 SSO 身份与 DID
chainlesschain sso link --sso-provider <config-id> --sso-user-id <uid> --did <did>

# 取消关联
chainlesschain sso unlink <identity-id>

# 查看身份映射
chainlesschain sso identities
chainlesschain sso did-for-sso --provider <config-id> --sso-user-id <uid>
chainlesschain sso identity-mappings

# 冲突检查（同一 SSO 身份绑定多个 DID）
chainlesschain sso conflict-check --provider <config-id> --sso-user-id <uid>
```

---

## 统计

```bash
chainlesschain sso stats          # SSO 统计
chainlesschain sso stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/14_身份权限系统.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [DID v2.0 →](/chainlesschain/cli-did-v2)
- [Auth →](/chainlesschain/cli-auth)
- [Encrypt →](/chainlesschain/cli-encrypt)
