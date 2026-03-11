# 组织管理 (org)

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

## 依赖

- 纯 Node.js crypto（ID 生成）
- 无外部依赖
