# 交易市场和企业版模块路由映射

## 交易市场模块路由

| 序号 | 路由路径 | 页面名称 | 测试文件 | 测试用例数 |
|------|----------|----------|----------|-----------|
| 1 | `/trading` | 交易中心 | `trading/trading-hub.e2e.test.ts` | 4 |
| 2 | `/marketplace` | 交易市场 | `trading/marketplace.e2e.test.ts` | 4 |
| 3 | `/contracts` | 智能合约 | `trading/contracts.e2e.test.ts` | 4 |
| 4 | `/credit-score` | 信用评分 | `trading/credit-score.e2e.test.ts` | 4 |
| 5 | `/my-reviews` | 我的评价 | `trading/my-reviews.e2e.test.ts` | 4 |
| 6 | `/wallet` | 钱包管理 | `trading/wallet.e2e.test.ts` | 4 |
| 7 | `/bridge` | 跨链桥 | `trading/bridge.e2e.test.ts` | 4 |

**小计**: 7 个路由，28 个测试用例

## 企业版模块路由

| 序号 | 路由路径 | 页面名称 | 测试文件 | 测试用例数 |
|------|----------|----------|----------|-----------|
| 1 | `/organizations` | 组织管理 | `enterprise/organizations.e2e.test.ts` | 4 |
| 2 | `/org/test-org/members` | 成员管理 | `enterprise/organization-members.e2e.test.ts` | 4 |
| 3 | `/org/test-org/roles` | 角色管理 | `enterprise/organization-roles.e2e.test.ts` | 4 |
| 4 | `/org/test-org/settings` | 组织设置 | `enterprise/organization-settings.e2e.test.ts` | 4 |
| 5 | `/org/test-org/activities` | 活动日志 | `enterprise/organization-activities.e2e.test.ts` | 4 |
| 6 | `/org/test-org/knowledge` | 组织知识库 | `enterprise/organization-knowledge.e2e.test.ts` | 4 |
| 7 | `/enterprise/dashboard` | 企业仪表板 | `enterprise/enterprise-dashboard.e2e.test.ts` | 4 |
| 8 | `/permissions` | 权限管理 | `enterprise/permission-management.e2e.test.ts` | 4 |

**小计**: 8 个路由，32 个测试用例

## 总计

- **总路由数**: 15 个
- **总测试文件数**: 15 个
- **总测试用例数**: 60 个

## 测试 URL 格式

所有测试都使用 `?e2e=true` 查询参数来标识 E2E 测试模式：

```typescript
// 示例
window.location.hash = '#/trading?e2e=true';
window.location.hash = '#/org/test-org/members?e2e=true';
```

## 动态路由参数

企业版模块中的组织相关页面使用动态路由参数 `:orgId`，在测试中统一使用 `test-org`：

| 路由模式 | 测试路由 |
|---------|---------|
| `/org/:orgId/members` | `/org/test-org/members` |
| `/org/:orgId/roles` | `/org/test-org/roles` |
| `/org/:orgId/settings` | `/org/test-org/settings` |
| `/org/:orgId/activities` | `/org/test-org/activities` |
| `/org/:orgId/knowledge` | `/org/test-org/knowledge` |

## 测试执行命令

### 按模块运行

```bash
# 交易市场模块
npm run test:e2e -- tests/e2e/trading/

# 企业版模块
npm run test:e2e -- tests/e2e/enterprise/
```

### 运行单个测试

```bash
# 交易中心
npm run test:e2e -- tests/e2e/trading/trading-hub.e2e.test.ts

# 组织管理
npm run test:e2e -- tests/e2e/enterprise/organizations.e2e.test.ts

# 成员管理
npm run test:e2e -- tests/e2e/enterprise/organization-members.e2e.test.ts
```

### 运行所有新测试

```bash
npm run test:e2e -- tests/e2e/trading/ tests/e2e/enterprise/
```

## 测试覆盖的功能点

### 交易市场模块

1. **交易中心** - 交易概览、统计信息、订单管理
2. **交易市场** - 商品浏览、搜索、购买
3. **智能合约** - 合约部署、执行、管理
4. **信用评分** - 信用查询、历史记录、等级展示
5. **我的评价** - 评价列表、星级管理
6. **钱包管理** - 资产查看、转账、地址管理
7. **跨链桥** - 跨链转账、历史记录

### 企业版模块

1. **组织管理** - 组织列表、创建、编辑
2. **成员管理** - 成员列表、邀请、角色分配
3. **角色管理** - 角色创建、权限配置
4. **组织设置** - 基本信息、配置选项
5. **活动日志** - 操作记录、审计日志
6. **组织知识库** - 共享文档、知识管理
7. **企业仪表板** - 数据统计、可视化图表
8. **权限管理** - 权限矩阵、访问控制

## 相关文档

- 测试总结: `tests/e2e/TRADING_ENTERPRISE_TESTS_SUMMARY.md`
- 验证脚本: `tests/e2e/verify-new-tests.js`
- 辅助工具: `tests/e2e/helpers/common.ts`
