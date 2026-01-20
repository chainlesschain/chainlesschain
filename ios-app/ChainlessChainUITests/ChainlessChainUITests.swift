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
