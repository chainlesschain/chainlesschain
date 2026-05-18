# 企业版模块 E2E 测试

## 测试文件列表

| 文件 | 路由 | 测试用例数 |
|------|------|-----------|
| `organizations.e2e.test.ts` | `/organizations` | 4 |
| `organization-members.e2e.test.ts` | `/org/test-org/members` | 4 |
| `organization-roles.e2e.test.ts` | `/org/test-org/roles` | 4 |
| `organization-settings.e2e.test.ts` | `/org/test-org/settings` | 4 |
| `organization-activities.e2e.test.ts` | `/org/test-org/activities` | 4 |
| `organization-knowledge.e2e.test.ts` | `/org/test-org/knowledge` | 4 |
| `enterprise-dashboard.e2e.test.ts` | `/enterprise/dashboard` | 4 |
| `permission-management.e2e.test.ts` | `/permissions` | 4 |

**总计**: 8 个文件，32 个测试用例

## 快速开始

### 运行所有企业版测试
```bash
npm run test:e2e -- tests/e2e/enterprise/
```

### 运行单个测试
```bash
npm run test:e2e -- tests/e2e/enterprise/organizations.e2e.test.ts
```

## 测试覆盖的功能

- 组织管理 - 组织列表和管理
- 成员管理 - 成员邀请和管理
- 角色管理 - 角色和权限配置
- 组织设置 - 组织配置
- 活动日志 - 操作审计
- 组织知识库 - 共享文档
- 企业仪表板 - 数据统计
- 权限管理 - 访问控制

## 动态路由说明

企业版测试使用 `test-org` 作为测试组织 ID：
- `/org/:orgId/members` → `/org/test-org/members`
- `/org/:orgId/roles` → `/org/test-org/roles`
- 等等...

## 相关文档

- [详细测试总结](../TRADING_ENTERPRISE_TESTS_SUMMARY.md)
- [路由映射](../TRADING_ENTERPRISE_ROUTES.md)
- [完成报告](../TRADING_ENTERPRISE_COMPLETION_REPORT.md)
