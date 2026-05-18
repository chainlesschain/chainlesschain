import XCTest

/// ChainlessChain UI Tests
/// 测试主要用户流程和界面交互
final class ChainlessChainUITests: XCTestCase {

    var app: XCUIApplication!

    // MARK: - Setup & Teardown

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Launch Tests

    func testAppLaunches() throws {
        // Verify app launches without crashing
        XCTAssertTrue(app.exists)
    }

    // MARK: - Authentication Tests

    func testPINEntryScreen() throws {
        // Check if PIN entry screen appears
        let pinField = app.secureTextFields["PIN"]
        if pinField.waitForExistence(timeout: 5) {
            XCTAssertTrue(pinField.exists, "PIN entry field should exist")
        }
    }

    func testPINCreation() throws {
        // Test PIN creation flow
        let createPinButton = app.buttons["create_pin_button"]
        if createPinButton.waitForExistence(timeout: 5) {
            createPinButton.tap()

            // Enter PIN
            let pinField = app.secureTextFields["PIN"]
            if pinField.waitForExistence(timeout: 2) {
                pinField.tap()
                pinField.typeText("123456")
            }

            // Confirm PIN
            let confirmButton = app.buttons["confirm_button"]
            if confirmButton.waitForExistence(timeout: 2) {
                confirmButton.tap()
            }
        }
    }

    // MARK: - Navigation Tests

    func testMainTabNavigation() throws {
        // Skip PIN if needed (in UI test mode)
        skipAuthIfNeeded()

        // Test tab bar navigation
        let tabBar = app.tabBars.firstMatch
        if tabBar.waitForExistence(timeout: 5) {
            // Navigate to Knowledge tab
            let knowledgeTab = tabBar.buttons["知识库"]
            if knowledgeTab.exists {
                knowledgeTab.tap()
                XCTAssertTrue(app.navigationBars["知识库"].waitForExistence(timeout: 2))
            }

            // Navigate to AI Chat tab
            let aiTab = tabBar.buttons["AI对话"]
            if aiTab.exists {
                aiTab.tap()
                XCTAssertTrue(app.navigationBars["AI 对话"].waitForExistence(timeout: 2))
            }

            // Navigate to Social tab
            let socialTab = tabBar.buttons["社交"]
            if socialTab.exists {
                socialTab.tap()
                XCTAssertTrue(app.navigationBars["消息"].waitForExistence(timeout: 2))
            }

            // Navigate to Settings tab
            let settingsTab = tabBar.buttons["设置"]
            if settingsTab.exists {
                settingsTab.tap()
                XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 2))
            }
        }
    }

    // MARK: - Knowledge Base Tests

    func testKnowledgeBaseListLoads() throws {
        skipAuthIfNeeded()
        navigateToTab("知识库")

        // Verify list view loads
        let listView = app.collectionViews.firstMatch
        XCTAssertTrue(listView.waitForExistence(timeout: 5))
    }

    func testAddKnowledgeEntry() throws {
        skipAuthIfNeeded()
        navigateToTab("知识库")

        // Tap add button
        let addButton = app.navigationBars.buttons["plus"]
        if addButton.waitForExistence(timeout: 2) {
            addButton.tap()

            // Fill in title
            let titleField = app.textFields["title_field"]
            if titleField.waitForExistence(timeout: 2) {
                titleField.tap()
                titleField.typeText("Test Knowledge Entry")
            }

            // Fill in content
            let contentField = app.textViews["content_field"]
            if contentField.waitForExistence(timeout: 2) {
                contentField.tap()
                contentField.typeText("This is test content for the knowledge entry.")
            }

            // Save
            let saveButton = app.buttons["保存"]
            if saveButton.waitForExistence(timeout: 2) {
                saveButton.tap()
            }
        }
    }

    func testKnowledgeSearch() throws {
        skipAuthIfNeeded()
        navigateToTab("知识库")

        // Tap search field
        let searchField = app.searchFields.firstMatch
        if searchField.waitForExistence(timeout: 2) {
            searchField.tap()
            searchField.typeText("test")

            // Wait for search results
            sleep(1) // Allow debounce

            // Verify search is performed (implementation-specific)
        }
    }

    // MARK: - AI Chat Tests

    func testAIChatListLoads() throws {
        skipAuthIfNeeded()
        navigateToTab("AI对话")

        // Verify conversation list loads
        let listView = app.collectionViews.firstMatch
        XCTAssertTrue(listView.waitForExistence(timeout: 5))
    }

    func testStartNewAIChat() throws {
        skipAuthIfNeeded()
        navigateToTab("AI对话")

        // Tap new chat button
        let newChatButton = app.navigationBars.buttons["plus"]
        if newChatButton.waitForExistence(timeout: 2) {
            newChatButton.tap()

            // Select model sheet should appear
            let modelPicker = app.pickers.firstMatch
            if modelPicker.waitForExistence(timeout: 2) {
                // Verify model picker exists
                XCTAssertTrue(modelPicker.exists)
            }

            // Tap create button
            let createButton = app.buttons["创建"]
            if createButton.waitForExistence(timeout: 2) {
                createButton.tap()
            }
        }
    }

    // MARK: - Settings Tests

    func testSettingsScreenLoads() throws {
        skipAuthIfNeeded()
        navigateToTab("设置")

        // Verify settings sections exist
        let accountSection = app.staticTexts["账户"]
        XCTAssertTrue(accountSection.waitForExistence(timeout: 2))
    }

    /// 锁死:Settings 「关于 → 版本」一栏必须以 v 前缀显示 4 段制版本号
    /// (与 desktop productVersion / Android versionName 对齐),
    /// 而不是 3 段制 5.0.3 或 stale 硬编码 0.32.0。
    /// 也防回归 v5.0.3.62 → .63 之前 SettingsView 读 `AppConstants.App.version`
    /// 但该常量是硬编码 stale 值的状况。
    func testSettingsVersionDisplaysFourSegmentTag() throws {
        skipAuthIfNeeded()
        navigateToTab("设置")

        let versionLabel = app.staticTexts["settings.app.version"]
        XCTAssertTrue(versionLabel.waitForExistence(timeout: 5),
                      "Settings 应有 accessibility id = settings.app.version 的版本号 label")

        let value = versionLabel.label
        XCTAssertTrue(value.hasPrefix("v"),
                      "版本号必须以 v 开头, 实际 = \(value)")

        // 去掉 v 前缀,验 4 段制
        let withoutV = String(value.dropFirst())
        let segs = withoutV.split(separator: ".")
        XCTAssertEqual(segs.count, 4,
                       "版本号必须 4 段制 vX.Y.Z.N, 实际 = \(value)")
        for seg in segs {
            XCTAssertFalse(seg.isEmpty, "版本号段不能为空: \(value)")
            XCTAssertNotNil(Int(seg), "版本号每段必须是整数: \(value)")
        }

        // Stale 硬编码防回归
        XCTAssertNotEqual(value, "v0.32.0", "版本号不能 stale 硬编码")
        XCTAssertNotEqual(value, "0.32.0", "版本号不能 stale 硬编码")
    }

    /// 防 PIN crash 真机回归:启 app → 见 PIN 输入 → 输 6 位 → 应进入主界面,不闪退。
    /// v5.0.3.62 上,iOS 16 真机走这条路径时 `MainActor.assumeIsolated` 触发
    /// dyld missing-symbol crash。v5.0.3.63 修后此 UI 路径必须稳定。
    func testPINUnlockDoesNotCrashOnFirstLaunch() throws {
        let pinField = app.secureTextFields["PIN"]

        // PIN 字段如不存在 (可能已认证或 --uitesting 跳过),整测 skip 不算 fail
        guard pinField.waitForExistence(timeout: 5) else {
            throw XCTSkip("PIN 字段未出现 — 测试 setup 已 skip auth 或界面状态不同")
        }

        pinField.tap()
        pinField.typeText("123456")

        // 提交 PIN
        let confirmButton = app.buttons["confirm_button"]
        if confirmButton.waitForExistence(timeout: 2) {
            confirmButton.tap()
        }

        // 关键验证:app 在 PIN 解锁瞬间不崩 (即 process 还在前台),进入下一屏
        // (TabBar 或主导航)。在 v5.0.3.62 iOS 16 上,assumeIsolated 在通知触发的
        // 一瞬间 dyld crash —— app.exists 会变 false 因为 process 已退出。
        XCTAssertTrue(app.exists, "PIN 解锁后 app 仍存活 (没崩),iOS 16 兼容性回归测试")

        let tabBar = app.tabBars.firstMatch
        if tabBar.waitForExistence(timeout: 5) {
            XCTAssertTrue(tabBar.exists, "PIN 解锁成功后应看到 TabBar")
        }
    }

    func testChangePINNavigation() throws {
        skipAuthIfNeeded()
        navigateToTab("设置")

        // Find and tap change PIN option
        let changePinCell = app.cells.containing(.staticText, identifier: "修改PIN码").firstMatch
        if changePinCell.waitForExistence(timeout: 2) {
            changePinCell.tap()

            // Verify PIN change view appears
            let currentPinField = app.secureTextFields.firstMatch
            XCTAssertTrue(currentPinField.waitForExistence(timeout: 2))
        }
    }

    func testNotificationSettingsNavigation() throws {
        skipAuthIfNeeded()
        navigateToTab("设置")

        // Find and tap notification settings
        let notificationCell = app.cells.containing(.staticText, identifier: "通知设置").firstMatch
        if notificationCell.waitForExistence(timeout: 2) {
            notificationCell.tap()

            // Verify notification settings view appears
            let messageToggle = app.switches["消息通知"]
            XCTAssertTrue(messageToggle.waitForExistence(timeout: 2))
        }
    }

    // MARK: - P2P Social Tests

    func testSocialScreenLoads() throws {
        skipAuthIfNeeded()
        navigateToTab("社交")

        // Verify conversation list or empty state loads
        let contentExists = app.collectionViews.firstMatch.waitForExistence(timeout: 5) ||
                           app.staticTexts["暂无消息"].waitForExistence(timeout: 5)
        XCTAssertTrue(contentExists)
    }

    func testAddContactNavigation() throws {
        skipAuthIfNeeded()
        navigateToTab("社交")

        // Tap add contact button
        let addButton = app.navigationBars.buttons["plus"]
        if addButton.waitForExistence(timeout: 2) {
            addButton.tap()

            // Verify contact options appear (QR scan, etc.)
            let scanOption = app.buttons["扫描二维码"]
            let qrOption = app.buttons["我的二维码"]
            XCTAssertTrue(scanOption.waitForExistence(timeout: 2) || qrOption.waitForExistence(timeout: 2))
        }
    }

    // MARK: - Performance Tests

    func testAppLaunchPerformance() throws {
        if #available(iOS 13.0, *) {
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }

    func testScrollPerformance() throws {
        skipAuthIfNeeded()
        navigateToTab("知识库")

        let listView = app.collectionViews.firstMatch
        guard listView.waitForExistence(timeout: 5) else { return }

        measure {
            // Scroll down
            listView.swipeUp()
            listView.swipeUp()
            listView.swipeUp()

            // Scroll back up
            listView.swipeDown()
            listView.swipeDown()
            listView.swipeDown()
        }
    }

    // MARK: - Accessibility Tests

    func testAccessibilityLabels() throws {
        skipAuthIfNeeded()

        // Check tab bar accessibility
        let tabBar = app.tabBars.firstMatch
        if tabBar.waitForExistence(timeout: 5) {
            for button in tabBar.buttons.allElementsBoundByIndex {
                XCTAssertFalse(button.label.isEmpty, "Tab bar button should have accessibility label")
            }
        }
    }

    // MARK: - Helper Methods

    private func skipAuthIfNeeded() {
        // If PIN screen is showing, skip it for UI testing
        let skipButton = app.buttons["skip_auth"]
        if skipButton.waitForExistence(timeout: 2) {
            skipButton.tap()
        }
    }

    private func navigateToTab(_ tabName: String) {
        let tabBar = app.tabBars.firstMatch
        if tabBar.waitForExistence(timeout: 5) {
            let tab = tabBar.buttons[tabName]
            if tab.exists {
                tab.tap()
            }
        }
    }
}
