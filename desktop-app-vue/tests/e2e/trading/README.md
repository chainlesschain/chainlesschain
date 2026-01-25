# 交易市场模块 E2E 测试

## 测试文件列表

| 文件 | 路由 | 测试用例数 |
|------|------|-----------|
| `trading-hub.e2e.test.ts` | `/trading` | 4 |
| `marketplace.e2e.test.ts` | `/marketplace` | 4 |
| `contracts.e2e.test.ts` | `/contracts` | 4 |
| `credit-score.e2e.test.ts` | `/credit-score` | 4 |
| `my-reviews.e2e.test.ts` | `/my-reviews` | 4 |
| `wallet.e2e.test.ts` | `/wallet` | 4 |
| `bridge.e2e.test.ts` | `/bridge` | 4 |

**总计**: 7 个文件，28 个测试用例

## 快速开始

### 运行所有交易市场测试
```bash
npm run test:e2e -- tests/e2e/trading/
```

### 运行单个测试
```bash
npm run test:e2e -- tests/e2e/trading/trading-hub.e2e.test.ts
```

## 测试覆盖的功能

- 交易中心 - 交易概览和统计
- 交易市场 - 商品浏览和交易
- 智能合约 - 合约管理
- 信用评分 - 信用查询
- 我的评价 - 评价管理
- 钱包管理 - 资产管理
- 跨链桥 - 跨链转账

## 相关文档

- [详细测试总结](../TRADING_ENTERPRISE_TESTS_SUMMARY.md)
- [路由映射](../TRADING_ENTERPRISE_ROUTES.md)
- [完成报告](../TRADING_ENTERPRISE_COMPLETION_REPORT.md)
