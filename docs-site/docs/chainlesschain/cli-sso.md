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
