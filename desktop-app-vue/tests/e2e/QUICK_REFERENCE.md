# E2E 测试快速参考

## 新增测试模块 (2026-01-25)

### 交易市场模块 (`tests/e2e/trading/`)
```
✅ 7 个测试文件 | 28 个测试用例

trading-hub.e2e.test.ts       → /trading
marketplace.e2e.test.ts       → /marketplace
contracts.e2e.test.ts         → /contracts
credit-score.e2e.test.ts      → /credit-score
my-reviews.e2e.test.ts        → /my-reviews
wallet.e2e.test.ts            → /wallet
bridge.e2e.test.ts            → /bridge
```

### 企业版模块 (`tests/e2e/enterprise/`)
```
✅ 8 个测试文件 | 32 个测试用例

organizations.e2e.test.ts              → /organizations
organization-members.e2e.test.ts       → /org/test-org/members
organization-roles.e2e.test.ts         → /org/test-org/roles
organization-settings.e2e.test.ts      → /org/test-org/settings
organization-activities.e2e.test.ts    → /org/test-org/activities
organization-knowledge.e2e.test.ts     → /org/test-org/knowledge
enterprise-dashboard.e2e.test.ts       → /enterprise/dashboard
permission-management.e2e.test.ts      → /permissions
```

## 快速命令

### 运行所有新测试
```bash
npm run test:e2e -- tests/e2e/trading/ tests/e2e/enterprise/
```

### 运行交易市场测试
```bash
npm run test:e2e -- tests/e2e/trading/
```

### 运行企业版测试
```bash
npm run test:e2e -- tests/e2e/enterprise/
```

### 运行单个测试
```bash
npm run test:e2e -- tests/e2e/trading/trading-hub.e2e.test.ts
```

### 验证测试结构
```bash
node tests/e2e/verify-new-tests.js
```

## 测试统计

| 模块 | 文件数 | 测试用例数 | 路由数 |
|------|--------|-----------|--------|
| 交易市场 | 7 | 28 | 7 |
| 企业版 | 8 | 32 | 8 |
| **总计** | **15** | **60** | **15** |

## 文档位置

- 📄 详细总结: `TRADING_ENTERPRISE_TESTS_SUMMARY.md`
- 📄 路由映射: `TRADING_ENTERPRISE_ROUTES.md`
- 📄 完成报告: `TRADING_ENTERPRISE_COMPLETION_REPORT.md`
- 📄 验证脚本: `verify-new-tests.js`

## 验证结果

```
✅ 所有测试文件验证通过！
总文件数: 15
验证通过: 15
验证失败: 0
总测试用例数: 60
```

## 测试结构模板

每个测试文件包含：
1. ✓ 路由访问测试
2. ✓ UI 元素测试
3. ✓ 组件渲染测试
4. ✓ 加载状态测试

## 注意事项

- 所有路由使用 `?e2e=true` 参数
- 动态路由使用 `test-org` 作为组织 ID
- 每个测试文件独立启动/关闭应用
- 使用 `launchElectronApp` 和 `closeElectronApp`

---
📅 创建日期: 2026-01-25
📦 工作目录: C:\code\chainlesschain\desktop-app-vue
