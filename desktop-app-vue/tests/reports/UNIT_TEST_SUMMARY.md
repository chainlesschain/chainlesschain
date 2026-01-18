# 单元测试总结

本次为以下四个核心功能模块编写了单元测试：

## 1. Git Manager - ahead/behind commits 计算逻辑

**文件**: `tests/unit/git/git-manager.test.js`

**测试覆盖**:

- ✅ 没有配置远程仓库时返回 ahead=0, behind=0
- ✅ 本地分支不存在时返回 ahead=0, behind=0
- ✅ 远程分支不存在时返回 ahead=本地commits数量, behind=0
- ✅ 本地和远程完全同步时返回 ahead=0, behind=0
- ✅ 本地领先远程（ahead commits）的正确计算
- ✅ 远程领先本地（behind commits）的正确计算
- ✅ 本地和远程都有独有commits（分叉）时的正确计算
- ✅ 错误处理：出错时返回 ahead=0, behind=0
- ✅ 边界情况：空仓库、完全分叉等

**核心测试点**:

- 通过模拟 `git.resolveRef` 和 `git.log` 来测试不同场景
- 验证共同祖先的查找逻辑
- 确保错误情况下不影响系统稳定性

---

## 2. File Permission Manager - 文件所有者权限自动判断

**文件**: `tests/unit/file/file-permission-manager.test.js`

**测试覆盖**:

- ✅ 通过 project_id 识别项目所有者并自动授予所有权限
- ✅ 非项目所有者不自动获得 manage 权限
- ✅ 没有 project_id 的文件跳过项目所有者检查
- ✅ 直接权限检查（file_permissions 表）
- ✅ 权限等级判断（edit包含view，view不包含edit等）
- ✅ 基于角色的权限检查
- ✅ 组织级别权限检查（通过 organizationManager）
- ✅ 边界情况：文件不存在、项目不存在等
- ✅ 权限层级顺序：项目所有者优先级最高

**核心测试点**:

- 验证所有者权限的自动判断逻辑（project.user_id === userDID）
- 测试权限继承和层级关系
- 确保权限检查的完整性和正确性

---

## 3. Contract Engine - 订阅和技能交换合约执行逻辑

**文件**: `tests/unit/trade/contract-engine.test.js`

**测试覆盖**:

### 订阅合约（SUBSCRIPTION）:

- ✅ 释放订阅费用给服务提供者
- ✅ 正确记录已支付周期数（paidPeriods）
- ✅ 计算下次付款时间（nextPaymentAt）
- ✅ 处理没有托管ID的情况
- ✅ 更新元数据（lastPaymentAt, paidPeriods, nextPaymentAt）

### 技能交换合约（SKILL_EXCHANGE）:

- ✅ 标记当前用户完成状态
- ✅ 双方都完成时设置交换完成时间（exchangeCompletedAt）
- ✅ 只有一方完成时不设置交换完成时间
- ✅ 双方都完成时退回托管
- ✅ 单方完成时不操作托管
- ✅ 处理没有当前用户DID的情况

### 边界情况:

- ✅ 未知合约类型的处理
- ✅ 元数据为null或空字符串的初始化

**核心测试点**:

- 验证订阅周期付费的自动化处理
- 测试技能交换双方完成状态的跟踪
- 确保托管资金的正确释放和退回

---

## 4. Bridge Manager - 从数据库加载桥接合约

**文件**: `tests/unit/blockchain/bridge-manager.test.js`

**测试覆盖**:

- ✅ 加载所有类型为 'bridge' 的合约
- ✅ 加载名称包含 'bridge' 的合约
- ✅ 按部署时间降序加载（最新的优先）
- ✅ 从数据库加载并解析 ABI
- ✅ ABI 已存在时不被覆盖
- ✅ 处理无效的 ABI JSON
- ✅ 处理 abi_json 为 null 的情况
- ✅ 支持同时加载多条链的桥接合约（Ethereum, BSC, Polygon, Arbitrum等）
- ✅ 错误处理：数据库查询失败、返回null、返回空数组
- ✅ 数据不完整的合约被跳过
- ✅ registerBridgeContract 方法的正确性
- ✅ 初始化时自动加载桥接合约
- ✅ 重复初始化不重复加载

**核心测试点**:

- 验证从 deployed_contracts 表加载桥接合约的逻辑
- 测试多链支持（bridgeContracts Map的正确管理）
- 确保 ABI 加载和解析的正确性
- 验证错误处理的健壮性

---

## 测试框架和工具

- **测试框架**: Vitest（项目已配置）
- **Mock工具**: 使用 `jest.fn()` 进行函数模拟
- **断言风格**: Jest/Vitest 风格（expect）

## 运行测试

```bash
# 运行所有单元测试
npm run test:unit

# 运行特定测试文件
npm test -- tests/unit/git/git-manager.test.js
npm test -- tests/unit/file/file-permission-manager.test.js
npm test -- tests/unit/trade/contract-engine.test.js
npm test -- tests/unit/blockchain/bridge-manager.test.js

# 运行测试并查看覆盖率
npm run test:coverage
```

## 注意事项

1. 所有测试都使用了完整的 mock 依赖，不依赖真实的数据库或外部服务
2. 测试覆盖了正常流程、边界情况和错误处理
3. 每个测试都独立运行，使用 `beforeEach` 和 `afterEach` 进行清理
4. 测试文件符合项目的 vitest 配置（`vitest.config.ts`）

## 测试统计

- **总测试文件**: 4
- **测试用例数**: 约 50+
- **覆盖场景**: 正常流程、边界情况、错误处理、并发场景

---

**创建时间**: 2026-01-03  
**测试框架**: Vitest
**状态**: ✅ 完成
