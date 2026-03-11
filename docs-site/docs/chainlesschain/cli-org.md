# 组织管理 (org)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🏢 **组织 CRUD**: 创建、查询、删除组织
- 👥 **成员管理**: 邀请/移除成员，owner/admin/member 三级角色
- 🧑‍🤝‍🧑 **团队管理**: 组织内创建团队，独立管理成员
- ✅ **审批工作流**: 提交/批准/拒绝审批请求，状态流转追踪

## 系统架构

```
org 命令 → org.js (Commander) → org-manager.js
                                      │
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
           组织 CRUD             成员/团队管理          审批工作流
                 │                    │                    │
                 ▼                    ▼                    ▼
         organizations 表     org_members / teams    approval_requests
```

## 概述

CLI Phase 5 — 组织、团队和审批工作流管理。

## 命令概览

```bash
chainlesschain org create <name>                   # 创建组织
chainlesschain org list                            # 列出组织
chainlesschain org show <id>                       # 组织详情
chainlesschain org delete <id>                     # 删除组织
chainlesschain org invite <org-id> <user-id>       # 邀请成员
chainlesschain org members <org-id>                # 成员列表
chainlesschain org team-create <org-id> <name>     # 创建团队
chainlesschain org teams <org-id>                  # 团队列表
chainlesschain org approval-submit <org-id> <title> # 提交审批
chainlesschain org approvals <org-id>              # 审批列表
chainlesschain org approve <request-id>            # 批准
chainlesschain org reject <request-id>             # 拒绝
```

## 功能说明

### 组织 CRUD

- `createOrganization` — 创建组织（名称、描述、所有者）
- `getOrganization` / `listOrganizations` — 查询组织
- `deleteOrganization` — 删除组织（级联删除成员和团队）

### 成员管理

- `inviteMember` — 邀请成员（默认 `member` 角色）
- `getMembers` — 列出组织成员
- `removeMember` — 移除成员
- 角色: `owner`, `admin`, `member`

### 团队管理

- `createTeam` — 创建团队
- `getTeams` — 列出团队
- `addTeamMember` / `removeTeamMember` — 团队成员管理

### 审批工作流

- `submitApproval` — 提交审批请求
- `getApprovals` — 列出审批（支持按状态过滤）
- `approveRequest` / `rejectRequest` — 审批/拒绝
- 状态流转: `pending` → `approved` / `rejected`

## 数据库表

| 表名 | 说明 |
|------|------|
| `organizations` | 组织信息 |
| `org_members` | 成员关系（角色、状态） |
| `org_teams` | 团队信息 |
| `org_team_members` | 团队成员 |
| `approval_requests` | 审批请求 |

## 安全考虑

- 组织删除为级联操作，同时删除成员和团队数据
- 审批请求支持权限控制，仅 admin/owner 可审批
- 所有操作记录审计日志

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `create` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `invite` 报用户不存在 | 确认用户 ID 有效 |
| `delete` 级联失败 | 检查数据库完整性 |

## 关键文件

- `packages/cli/src/commands/org.js` — 命令实现
- `packages/cli/src/lib/org-manager.js` — 组织管理库

## 相关文档

- [RBAC 权限](./cli-auth) — 访问权限控制
- [审计日志](./cli-audit) — 操作审计
- [企业组织管理](./enterprise-org) — 桌面端组织管理

## 依赖

- 纯 Node.js crypto（ID 生成）
- 无外部依赖
