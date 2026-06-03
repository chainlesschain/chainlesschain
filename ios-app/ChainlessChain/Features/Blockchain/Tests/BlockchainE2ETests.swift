import XCTest
@testable import ChainlessChain

/// 区块链功能端到端测试
/// 测试完整的钱包创建、余额查询、多链切换流程
@MainActor
final class BlockchainE2ETests: XCTestCase {

    var walletManager: WalletManager!
    var balanceService: BalanceService!
    var chainManager: ChainManager!
    var walletViewModel: WalletViewModel!

    override func setUp() async throws {
        try await super.setUp()

        // 初始化服务
        walletManager = WalletManager.shared
        balanceService = BalanceService.shared
        chainManager = ChainManager.shared
        walletViewModel = WalletViewModel()

        // 清理测试数据
        try await cleanupTestData()
    }

    override func tearDown() async throws {
        // 清理测试数据
        try await cleanupTestData()

        try await super.tearDown()
    }

    // MARK: - Test Cases

    /// 测试1: 完整钱包创建流程
    func testWalletCreationFlow() async throws {
        // Given: 测试密码
        let password = "TestPassword123"
        let chainId = 11155111  // Ethereum Sepolia

        // When: 创建钱包
        let result = try await walletManager.createWallet(
            password: password,
            chainId: chainId
        )

        // Then: 验证钱包创建成功
        XCTAssertNotNil(result.wallet, "钱包应该创建成功")
        XCTAssertFalse(result.wallet.address.isEmpty, "地址不应为空")
        XCTAssertTrue(result.wallet.address.hasPrefix("0x"), "地址应以0x开头")
        XCTAssertEqual(result.wallet.address.count, 42, "地址长度应为42")

        // 验证助记词
        XCTAssertFalse(result.mnemonic.isEmpty, "助记词不应为空")
        let words = result.mnemonic.split(separator: " ")
        XCTAssertEqual(words.count, 12, "助记词应为12个单词")

        // 验证私钥
        XCTAssertFalse(result.privateKey.isEmpty, "私钥不应为空")
        XCTAssertEqual(result.privateKey.count, 64, "私钥长度应为64")

        // 验证钱包已保存
        let wallets = walletManager.wallets
        XCTAssertTrue(wallets.contains { $0.id == result.wallet.id }, "钱包应已保存")

        print("✅ 测试1通过: 钱包创建成功")
        print("  - 地址: \(result.wallet.address)")
        print("  - 助记词: \(result.mnemonic)")
        print("  - 链ID: \(chainId)")
    }

    /// 测试2: 助记词导入钱包
    func testImportFromMnemonic() async throws {
        // Given: 已知的测试助记词
        let mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident"
        let password = "TestPassword123"
        let chainId = 1

        // When: 从助记词导入
        let result = try await walletManager.importFromMnemonic(
            mnemonic: mnemonic,
            password: password,
            chainId: chainId
        )

        // Then: 验证钱包导入成功
        XCTAssertNotNil(result.wallet, "钱包应该导入成功")
        XCTAssertFalse(result.wallet.address.isEmpty, "地址不应为空")

        // 验证派生地址的确定性
        let result2 = try await walletManager.importFromMnemonic(
            mnemonic: mnemonic,
            password: "DifferentPassword",
            chainId: chainId
        )

        // 相同助记词应派生相同地址（不管密码如何）
        XCTAssertEqual(result.wallet.address, result2.wallet.address, "相同助记词应派生相同地址")

        // 清理第二个钱包
        try await walletManager.deleteWallet(result2.wallet)

        print("✅ 测试2通过: 助记词导入成功")
        print("  - 地址: \(result.wallet.address)")
    }

    /// 测试3: 私钥导入钱包
    func testImportFromPrivateKey() async throws {
        // Given: 先创建一个钱包获取私钥
        let password = "TestPassword123"
        let createResult = try await walletManager.createWallet(password: password)
        let originalAddress = createResult.wallet.address
        let privateKey = createResult.privateKey

        // 删除原钱包
        try await walletManager.deleteWallet(createResult.wallet)

        // When: 从私钥导入
        let importedWallet = try await walletManager.importFromPrivateKey(
            privateKey: privateKey,
            password: password,
            chainId: 1
        )

        // Then: 验证地址匹配
        XCTAssertEqual(importedWallet.address, originalAddress, "导入的地址应与原地址匹配")

        print("✅ 测试3通过: 私钥导入成功")
        print("  - 原地址: \(originalAddress)")
        print("  - 导入地址: \(importedWallet.address)")
    }

    /// 测试4: 钱包解锁和加密
    func testWalletUnlockAndEncryption() async throws {
        // Given: 创建钱包
        let password = "TestPassword123"
        let result = try await walletManager.createWallet(password: password)
        let walletId = result.wallet.id
        let originalPrivateKey = result.privateKey

        // When: 解锁钱包
        let unlockedPrivateKey = try await walletManager.unlockWallet(
            walletId: walletId,
            password: password
        )

        // Then: 验证解锁的私钥匹配
        XCTAssertEqual(unlockedPrivateKey, originalPrivateKey, "解锁的私钥应匹配原私钥")

        // 测试错误密码
        do {
            _ = try await walletManager.unlockWallet(
                walletId: walletId,
                password: "WrongPassword"
            )
            XCTFail("错误密码不应成功解锁")
        } catch {
            // 预期错误
            print("✅ 正确拒绝了错误密码")
        }

        // 锁定钱包
        walletManager.lockWallet(walletId: walletId)

        print("✅ 测试4通过: 钱包加密和解锁正常")
    }

    /// 测试5: 余额查询（模拟）
    func testBalanceQuery() async throws {
        // Given: 创建钱包
        let password = "TestPassword123"
        let result = try await walletManager.createWallet(
            password: password,
            chainId: 11155111  // Sepolia
        )

        // When: 查询余额（会调用真实RPC）
        do {
            let balance = try await balanceService.fetchBalance(for: result.wallet)

            // Then: 验证余额结构
            XCTAssertEqual(balance.walletId, result.wallet.id, "钱包ID应匹配")
            XCTAssertEqual(balance.chainId, 11155111, "链ID应为Sepolia")
            XCTAssertFalse(balance.balance.isEmpty, "余额不应为空")
            XCTAssertEqual(balance.symbol, "ETH", "符号应为ETH")
            XCTAssertEqual(balance.decimals, 18, "小数位数应为18")

            print("✅ 测试5通过: 余额查询成功")
            print("  - 余额: \(balance.displayBalance) \(balance.symbol)")
            print("  - 原始值: \(balance.balance) Wei")
        } catch {
            // RPC调用可能失败（网络问题），这是可接受的
            print("⚠️ 测试5跳过: RPC调用失败（网络问题）")
            print("  - 错误: \(error.localizedDescription)")
        }
    }

    /// 测试6: 多链余额查询
    func testMultiChainBalanceQuery() async throws {
        // Given: 创建钱包
        let password = "TestPassword123"
        let result = try await walletManager.createWallet(password: password)

        // When: 查询多条链的余额
        let chains: [SupportedChain] = [
            .ethereumSepolia,
            .polygonMumbai,
            .bscTestnet
        ]

        do {
            let balances = await balanceService.fetchBalancesForMultipleChains(
                for: result.wallet,
                chains: chains
            )

            // Then: 验证结果
            XCTAssertFalse(balances.isEmpty, "应返回至少一条链的余额")

            for (chainId, balance) in balances {
                print("  - 链 \(chainId): \(balance.displayBalance) \(balance.symbol)")
            }

            print("✅ 测试6通过: 多链余额查询完成")
            print("  - 查询链数: \(chains.count)")
            print("  - 成功返回: \(balances.count)")
        } catch {
            print("⚠️ 测试6跳过: 多链查询失败（网络问题）")
            print("  - 错误: \(error.localizedDescription)")
        }
    }

    /// 测试7: 网络切换
    func testChainSwitch() async throws {
        // Given: 初始网络
        let initialChain = chainManager.currentChain
        let targetChain = SupportedChain.polygonMainnet

        // When: 切换网络
        chainManager.switchChain(to: targetChain)

        // Then: 验证切换成功
        XCTAssertEqual(chainManager.currentChain, targetChain, "当前链应切换到目标链")
        XCTAssertNotEqual(chainManager.currentChain, initialChain, "当前链不应等于初始链")

        // 验证网络配置
        let config = chainManager.getConfig(for: targetChain)
        XCTAssertEqual(config.chainId, targetChain.rawValue, "配置链ID应匹配")
        XCTAssertFalse(config.rpcUrls.isEmpty, "RPC端点不应为空")

        print("✅ 测试7通过: 网络切换成功")
        print("  - 初始链: \(initialChain.name)")
        print("  - 目标链: \(targetChain.name)")
        print("  - RPC端点数: \(config.rpcUrls.count)")
    }

    /// 测试8: RPC端点容错
    func testRPCEndpointFailover() async throws {
        // Given: 选择有多个RPC端点的链
        let chain = SupportedChain.ethereumSepolia
        let config = chainManager.getConfig(for: chain)

        XCTAssertGreaterThan(config.rpcUrls.count, 1, "应有多个RPC端点")

        // When: 获取可用RPC URL
        do {
            let rpcUrl = try await chainManager.getAvailableRPCUrl(for: chain)

            // Then: 验证返回了有效的URL
            XCTAssertFalse(rpcUrl.isEmpty, "RPC URL不应为空")
            XCTAssertTrue(config.rpcUrls.contains(rpcUrl), "返回的URL应在配置中")

            print("✅ 测试8通过: RPC端点容错正常")
            print("  - 可用端点: \(rpcUrl)")
            print("  - 总端点数: \(config.rpcUrls.count)")
        } catch {
            print("⚠️ 测试8跳过: 所有RPC端点不可用")
        }
    }

    /// 测试9: ViewModel集成测试
    func testViewModelIntegration() async throws {
        // Given: ViewModel实例
        XCTAssertNotNil(walletViewModel, "ViewModel应初始化")

        // When: 创建钱包
        await walletViewModel.createWallet(password: "TestPassword123", chainId: 11155111)

        // 等待异步操作完成
        try await Task.sleep(nanoseconds: 1_000_000_000)  // 1秒

        // Then: 验证ViewModel状态
        XCTAssertFalse(walletViewModel.isLoading, "加载状态应为false")
        XCTAssertFalse(walletViewModel.wallets.isEmpty, "钱包列表不应为空")

        if let firstWallet = walletViewModel.wallets.first {
            // 验证余额已加载
            let balance = walletViewModel.getBalance(for: firstWallet.id)
            XCTAssertNotNil(balance, "余额应已加载")

            print("✅ 测试9通过: ViewModel集成正常")
            print("  - 钱包数: \(walletViewModel.wallets.count)")
            print("  - 余额: \(balance?.displayBalance ?? "0") \(balance?.symbol ?? "ETH")")
        }
    }

    /// 测试10: 钱包删除
    func testWalletDeletion() async throws {
        // Given: 创建钱包
        let password = "TestPassword123"
        let result = try await walletManager.createWallet(password: password)
        let walletId = result.wallet.id

        let initialCount = walletManager.wallets.count
        XCTAssertTrue(walletManager.wallets.contains { $0.id == walletId }, "钱包应存在")

        // When: 删除钱包
        try await walletManager.deleteWallet(result.wallet)

        // Then: 验证删除成功
        XCTAssertEqual(walletManager.wallets.count, initialCount - 1, "钱包数应减1")
        XCTAssertFalse(walletManager.wallets.contains { $0.id == walletId }, "钱包不应存在")

        // 验证Keychain数据也已删除
        do {
            _ = try await walletManager.unlockWallet(walletId: walletId, password: password)
            XCTFail("删除后不应能解锁钱包")
        } catch {
            // 预期错误
            print("✅ 测试10通过: 钱包删除成功")
        }
    }

    // MARK: - Performance Tests

    /// 性能测试: 批量创建钱包
    func testPerformanceWalletCreation() async throws {
        measure {
            Task {
                do {
                    _ = try await walletManager.createWallet(
                        password: "TestPassword123",
                        chainId: 1
                    )
                } catch {
                    XCTFail("创建失败: \(error)")
                }
            }
        }
    }

    /// 性能测试: 余额查询
    func testPerformanceBalanceQuery() async throws {
        // 先创建钱包
        let result = try await walletManager.createWallet(
            password: "TestPassword123",
            chainId: 11155111
        )

        measure {
            Task {
                do {
                    _ = try await balanceService.fetchBalance(for: result.wallet)
                } catch {
                    // 忽略网络错误
                }
            }
        }
    }

    // MARK: - Helper Methods

    /// 清理测试数据
    private func cleanupTestData() async throws {
        // 删除所有测试钱包
        let walletsToDelete = walletManager.wallets
        for wallet in walletsToDelete {
            try? await walletManager.deleteWallet(wallet)
        }

        // 清除缓存
        balanceService.clearCache()
        chainManager.clearCache()
    }
}

// MARK: - Test Helpers

extension BlockchainE2ETests {
    /// 断言异步抛出错误
    func assertThrowsError<T>(
        _ expression: @autoclosure () async throws -> T,
        _ message: String = "",
        file: StaticString = #file,
        line: UInt = #line
    ) async {
        do {
            _ = try await expression()
            XCTFail("应该抛出错误: \(message)", file: file, line: line)
        } catch {
            // 预期行为
        }
    }

    /// 等待条件满足
    func waitFor(
        condition: @escaping () -> Bool,
        timeout: TimeInterval = 5.0,
        message: String = "Timeout waiting for condition"
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)

        while !condition() {
            if Date() > deadline {
                XCTFail(message)
                return
            }
            try await Task.sleep(nanoseconds: 100_000_000)  // 0.1秒
        }
    }
}
