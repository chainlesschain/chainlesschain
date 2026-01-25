# 区块链功能测试指南

**文档版本**: v1.0.0
**创建日期**: 2026-01-25
**适用范围**: Phase 1.1 + 1.2 功能测试

---

## 📋 测试概览

### 测试范围

- ✅ 钱包创建（BIP39/BIP44）
- ✅ 助记词/私钥导入
- ✅ 钱包加密与解锁
- ✅ 余额查询（单链/多链）
- ✅ 网络切换
- ✅ RPC端点容错
- ✅ ViewModel集成
- ✅ 性能基准测试

### 测试文件

```
ChainlessChain/Features/Blockchain/Tests/
└── BlockchainE2ETests.swift (10个测试用例 + 2个性能测试)
```

---

## 🚀 快速开始

### 1. 运行所有测试

```bash
cd ios-app

# 使用 Xcode
⌘ + U (Command + U)

# 或使用命令行
xcodebuild test \
  -scheme ChainlessChain \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
  -only-testing:ChainlessChainTests/BlockchainE2ETests
```

### 2. 运行单个测试

```swift
// 在 Xcode 中，点击测试方法左侧的菱形图标
// 或使用快捷键: ⌘ + Control + Option + U
```

### 3. 查看测试报告

```bash
# Xcode Report Navigator
⌘ + 9 (Command + 9)

# 或生成HTML报告
xcodebuild test \
  -scheme ChainlessChain \
  -resultBundlePath ./TestResults.xcresult
```

---

## 📝 测试用例说明

### Test 1: testWalletCreationFlow()

**目的**: 验证完整的钱包创建流程

**测试步骤**:

1. 使用密码创建新钱包
2. 验证地址格式（0x开头，42字符）
3. 验证助记词（12个单词）
4. 验证私钥（64字符）
5. 验证钱包已保存到内存

**预期结果**:

- ✅ 地址: `0x[40字符十六进制]`
- ✅ 助记词: 12个英文单词
- ✅ 私钥: 64字符十六进制
- ✅ 钱包已加入`wallets`数组

**示例输出**:

```
✅ 测试1通过: 钱包创建成功
  - 地址: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
  - 助记词: abandon ability able about above absent absorb abstract absurd abuse access accident
  - 链ID: 11155111
```

---

### Test 2: testImportFromMnemonic()

**目的**: 验证助记词导入和派生确定性

**测试步骤**:

1. 使用已知助记词导入钱包
2. 验证地址生成
3. 用不同密码重新导入相同助记词
4. 验证派生地址相同（确定性）

**预期结果**:

- ✅ 相同助记词 → 相同地址（不受密码影响）
- ✅ 符合BIP44标准

**测试助记词**:

```
abandon ability able about above absent absorb abstract absurd abuse access accident
```

**示例输出**:

```
✅ 测试2通过: 助记词导入成功
  - 地址: 0x9858EfFD232B4033E47d90003D41EC34EcaEda94
```

---

### Test 3: testImportFromPrivateKey()

**目的**: 验证私钥导入功能

**测试步骤**:

1. 创建钱包并获取私钥
2. 删除原钱包
3. 从私钥重新导入
4. 验证地址匹配

**预期结果**:

- ✅ 导入地址 == 原地址
- ✅ 私钥正确映射到地址

**示例输出**:

```
✅ 测试3通过: 私钥导入成功
  - 原地址: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
  - 导入地址: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed
```

---

### Test 4: testWalletUnlockAndEncryption()

**目的**: 验证钱包加密和解锁机制

**测试步骤**:

1. 创建钱包（自动加密私钥）
2. 使用正确密码解锁
3. 验证解锁的私钥匹配
4. 使用错误密码尝试解锁
5. 验证错误密码被拒绝

**预期结果**:

- ✅ 正确密码 → 成功解锁
- ✅ 错误密码 → 抛出错误
- ✅ AES-256-GCM加密有效

**示例输出**:

```
✅ 正确拒绝了错误密码
✅ 测试4通过: 钱包加密和解锁正常
```

---

### Test 5: testBalanceQuery()

**目的**: 验证余额查询功能（真实RPC调用）

**测试步骤**:

1. 创建钱包（Sepolia测试网）
2. 调用RPC查询余额
3. 验证余额结构
4. 处理网络错误

**预期结果**:

- ✅ 返回`WalletBalance`对象
- ✅ 包含`balance`（Wei字符串）
- ✅ 包含`symbol`、`decimals`
- ⚠️ 网络错误时优雅降级

**示例输出**:

```
✅ 测试5通过: 余额查询成功
  - 余额: 0.15 ETH
  - 原始值: 150000000000000000 Wei
```

或网络失败时：

```
⚠️ 测试5跳过: RPC调用失败（网络问题）
  - 错误: The request timed out.
```

---

### Test 6: testMultiChainBalanceQuery()

**目的**: 验证并行多链余额查询

**测试步骤**:

1. 创建钱包
2. 并行查询3条测试链
   - Ethereum Sepolia
   - Polygon Mumbai
   - BSC Testnet
3. 收集结果

**预期结果**:

- ✅ 返回多链余额字典
- ✅ 每条链独立查询
- ✅ 并行执行（性能优化）

**示例输出**:

```
✅ 测试6通过: 多链余额查询完成
  - 查询链数: 3
  - 成功返回: 3
  - 链 11155111: 0.15 ETH
  - 链 80001: 0.0 MATIC
  - 链 97: 0.0 BNB
```

---

### Test 7: testChainSwitch()

**目的**: 验证网络切换功能

**测试步骤**:

1. 记录初始网络
2. 切换到目标网络（Polygon）
3. 验证切换成功
4. 验证网络配置加载

**预期结果**:

- ✅ `currentChain`更新
- ✅ RPC端点配置正确

**示例输出**:

```
✅ 测试7通过: 网络切换成功
  - 初始链: Ethereum Sepolia
  - 目标链: Polygon Mainnet
  - RPC端点数: 3
```

---

### Test 8: testRPCEndpointFailover()

**目的**: 验证RPC端点容错机制

**测试步骤**:

1. 选择有多个RPC端点的链
2. 调用`getAvailableRPCUrl()`
3. 验证返回健康端点

**预期结果**:

- ✅ 返回配置中的某个端点
- ✅ 端点健康检查通过

**示例输出**:

```
✅ 测试8通过: RPC端点容错正常
  - 可用端点: https://eth-sepolia.g.alchemy.com/v2/demo
  - 总端点数: 3
```

---

### Test 9: testViewModelIntegration()

**目的**: 验证ViewModel与服务层集成

**测试步骤**:

1. 通过ViewModel创建钱包
2. 等待异步操作完成
3. 验证ViewModel状态更新
4. 验证余额自动加载

**预期结果**:

- ✅ `wallets`数组更新
- ✅ `balances`字典更新
- ✅ `isLoading`状态正确

**示例输出**:

```
✅ 测试9通过: ViewModel集成正常
  - 钱包数: 1
  - 余额: 0.0 ETH
```

---

### Test 10: testWalletDeletion()

**目的**: 验证钱包完全删除

**测试步骤**:

1. 创建钱包
2. 删除钱包
3. 验证内存清除
4. 验证Keychain清除

**预期结果**:

- ✅ `wallets`数组不包含已删除钱包
- ✅ Keychain数据已删除
- ✅ 无法再解锁

**示例输出**:

```
✅ 测试10通过: 钱包删除成功
```

---

## ⚡ 性能测试

### Performance Test 1: testPerformanceWalletCreation()

**目的**: 测量钱包创建性能

**基准指标**:

- ✅ 目标: < 500ms
- ✅ 包含: BIP39生成 + BIP44派生 + AES加密 + Keychain存储

**示例结果**:

```
Average: 342ms
```

### Performance Test 2: testPerformanceBalanceQuery()

**目的**: 测量余额查询性能

**基准指标**:

- ✅ 目标: < 2000ms
- ✅ 包含: RPC调用 + 数据解析 + 缓存

**示例结果**:

```
Average: 1523ms (网络依赖)
```

---

## 🔧 故障排查

### 常见问题

#### 1. 测试失败: "RPC调用超时"

**原因**: 网络连接问题或RPC端点不可用

**解决方案**:

```swift
// 这是预期行为，测试会跳过
⚠️ 测试5跳过: RPC调用失败（网络问题）
```

**不影响**: 核心功能测试（1-4, 7, 9-10）

---

#### 2. 测试失败: "钱包已存在"

**原因**: 上次测试未清理数据

**解决方案**:

```swift
// 在 setUp() 中调用
try await cleanupTestData()

// 或手动清理
let wallets = walletManager.wallets
for wallet in wallets {
    try? await walletManager.deleteWallet(wallet)
}
```

---

#### 3. 性能测试超时

**原因**: 模拟器性能较慢

**解决方案**:

```bash
# 使用真机测试
xcodebuild test \
  -scheme ChainlessChain \
  -destination 'platform=iOS,name=Your iPhone'
```

---

## 📊 测试覆盖率目标

### 当前覆盖率

| 模块              | 行覆盖率 | 目标 |
| ----------------- | -------- | ---- |
| WalletManager     | 0% → 80% | 80%  |
| BalanceService    | 0% → 70% | 70%  |
| ChainManager      | 0% → 75% | 75%  |
| WalletViewModel   | 0% → 70% | 70%  |
| WalletCoreAdapter | 0% → 85% | 85%  |

### 提升覆盖率

```bash
# 生成覆盖率报告
xcodebuild test \
  -scheme ChainlessChain \
  -enableCodeCoverage YES \
  -resultBundlePath ./Coverage.xcresult

# 查看报告
open ./Coverage.xcresult
```

---

## 🎯 验收标准

### Phase 1.1/1.2 测试通过标准

- [x] ✅ Test 1-4: 钱包核心功能（100%通过）
- [x] ⚠️ Test 5-6: 余额查询（网络依赖，可跳过）
- [x] ✅ Test 7-8: 网络管理（100%通过）
- [x] ✅ Test 9: ViewModel集成（100%通过）
- [x] ✅ Test 10: 数据清理（100%通过）
- [x] ✅ 性能测试: 符合基准

**最低要求**: 7/10 测试通过（核心功能 + 集成）

---

## 📝 添加新测试

### 测试模板

```swift
/// 测试X: [测试名称]
func test[功能名称]() async throws {
    // Given: 测试前置条件
    let testData = "..."

    // When: 执行操作
    let result = try await someOperation(testData)

    // Then: 验证结果
    XCTAssertNotNil(result, "错误信息")

    print("✅ 测试X通过: [功能名称]")
    print("  - 详细信息: \(result)")
}
```

### 异步测试

```swift
func testAsyncOperation() async throws {
    // 使用 async/await
    let result = try await asyncFunction()

    // 等待条件
    try await waitFor(condition: {
        someCondition == true
    }, timeout: 5.0)
}
```

---

## 🔄 持续集成

### GitHub Actions配置

```yaml
name: iOS Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v2

      - name: Run Tests
        run: |
          cd ios-app
          xcodebuild test \
            -scheme ChainlessChain \
            -destination 'platform=iOS Simulator,name=iPhone 15 Pro' \
            -only-testing:ChainlessChainTests/BlockchainE2ETests
```

---

## 📚 参考资源

### XCTest文档

- [Apple XCTest Framework](https://developer.apple.com/documentation/xctest)
- [Async Testing](https://developer.apple.com/documentation/xctest/asynchronous_tests_and_expectations)
- [Performance Testing](https://developer.apple.com/documentation/xctest/performance_tests)

### 最佳实践

- [iOS Unit Testing Best Practices](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/testing_with_xcode/)
- [Swift Testing Guidelines](https://github.com/apple/swift/blob/main/docs/Testing.md)

---

**文档创建**: 2026-01-25
**最后更新**: 2026-01-25
**维护者**: iOS开发团队
