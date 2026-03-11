# RBAC 权限管理 (auth)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 👥 **4 个内置角色**: admin、editor、viewer、agent 覆盖常见场景
- 🔐 **26 个权限范围**: 细粒度控制笔记、会话、LLM、MCP、系统等操作
- ⚡ **通配符匹配**: 支持 `*` 全局权限快速授权
- ⏰ **过期控制**: 角色授权支持自动过期
- 🔍 **权限检查**: 实时验证用户是否拥有指定权限
- 📝 **审计集成**: 所有权限变更自动记录审计日志

## 概述

ChainlessChain CLI 提供基于角色的访问控制（RBAC）权限引擎。

- **4 个内置角色**: admin, editor, viewer, agent
- **26 个权限范围**: 覆盖笔记、会话、LLM、MCP、系统等
- **通配符匹配**: 支持 `*` 全局权限
- **过期控制**: 角色授权支持过期时间

## 命令参考

### auth roles — 列出角色（默认）

```bash
chainlesschain auth roles
chainlesschain auth                     # 等同于 auth roles
```

显示所有角色及其权限。

### auth create-role — 创建角色

```bash
chainlesschain auth create-role <name> -d "描述" -p "note:read,note:write"
```

创建自定义角色并分配权限。

### auth delete-role — 删除角色

```bash
chainlesschain auth delete-role <name>
```

删除自定义角色（内置角色不可删除）。

### auth grant — 授予角色

```bash
chainlesschain auth grant <user> <role>
chainlesschain auth grant user1 editor
chainlesschain auth grant user1 admin --expires 2026-12-31
```

将角色授予用户，可设置过期时间。

### auth revoke — 撤销角色

```bash
chainlesschain auth revoke <user> <role>
```

撤销用户的指定角色。

### auth grant-permission — 授予权限

```bash
chainlesschain auth grant-permission <role> <scope>
chainlesschain auth grant-permission editor "note:delete"
```

为角色添加额外权限。

### auth revoke-permission — 撤销权限

```bash
chainlesschain auth revoke-permission <role> <scope>
```

从角色移除指定权限。

### auth check — 检查权限

```bash
chainlesschain auth check <user> <scope>
chainlesschain auth check user1 "note:write"
```

检查用户是否拥有指定权限。

### auth permissions — 查看用户权限

```bash
chainlesschain auth permissions <user>
```

列出用户的所有有效权限（合并所有角色）。

### auth users — 列出用户

```bash
chainlesschain auth users
chainlesschain auth users --role editor
```

列出所有有角色授权的用户。

### auth scopes — 列出权限范围

```bash
chainlesschain auth scopes
```

显示所有 26 个可用的权限范围。

## 内置角色

| 角色     | 权限                                              |
| -------- | ------------------------------------------------- |
| `admin`  | `*` (全部权限)                                    |
| `editor` | note:*, session:*, llm:*, skill:*, search:*, memory:* |
| `viewer` | note:read, session:read, skill:read, search:read  |
| `agent`  | note:read, note:write, skill:run, llm:chat, search:read |

## 权限范围 (26 个)

```
note:read, note:write, note:delete
session:read, session:write, session:delete
llm:chat, llm:manage, llm:config
mcp:read, mcp:manage, mcp:connect
skill:read, skill:run
search:read, search:manage
memory:read, memory:write, memory:delete
system:config, system:admin, system:audit
did:read, did:manage
encrypt:read, encrypt:manage
auth:manage
```

## 系统架构

```
用户命令 → auth.js (Commander) → permission-engine.js
                                        │
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
                角色管理 (CRUD)    权限检查 (RBAC)   用户授权 (Grant)
                       │                │                │
                       ▼                ▼                ▼
                  roles 表        role_permissions    user_roles 表
                       │                │                │
                       └────────────────┼────────────────┘
                                        ▼
                                 SQLite 数据库
```

## 安全考虑

- 内置角色（admin, editor, viewer, agent）不可删除
- `admin` 角色拥有通配符 `*` 全部权限，授予需谨慎
- 角色授权支持过期时间（`--expires`），建议对临时权限设置过期
- 所有权限变更自动记录审计日志

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `check` 返回 denied | 确认用户已被授予包含该权限的角色 |
| `grant` 失败 | 确认角色名称正确，使用 `auth roles` 查看可用角色 |
| `create-role` 报已存在 | 角色名唯一，使用 `grant-permission` 添加权限 |
| 过期角色仍生效 | 权限检查实时验证过期时间，检查系统时间是否正确 |

## 关键文件

- `packages/cli/src/commands/auth.js` — 命令实现
- `packages/cli/src/lib/permission-engine.js` — 权限引擎库

## 相关文档

- [审计日志](./cli-audit) — 权限变更审计
- [DID 身份](./cli-did) — 身份管理
- [权限系统](./permissions) — 桌面端 RBAC 详情
