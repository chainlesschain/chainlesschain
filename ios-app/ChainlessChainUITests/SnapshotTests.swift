import XCTest

/// Snapshot Tests
/// 用于生成 App Store 截图和视觉回归测试
final class SnapshotTests: XCTestCase {

    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--uitesting", "--snapshots"]
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - App Store Screenshots

    /// 生成知识库截图
    func testKnowledgeBaseScreenshot() throws {
        skipAuth()
        navigateToTab("知识库")

        // Wait for content to load
        sleep(2)

        takeScreenshot(name: "01_KnowledgeBase")
    }

    /// 生成 AI 对话截图
    func testAIChatScreenshot() throws {
        skipAuth()
        navigateToTab("AI对话")

        // Wait for content to load
        sleep(2)

        takeScreenshot(name: "02_AIChat")
    }

    /// 生成社交消息截图
    func testSocialScreenshot() throws {
        skipAuth()
        navigateToTab("社交")

        // Wait for content to load
        sleep(2)

        takeScreenshot(name: "03_Social")
    }

    /// 生成设置截图
    func testSettingsScreenshot() throws {
        skipAuth()
        navigateToTab("设置")

        // Wait for content to load
        sleep(2)

        takeScreenshot(name: "04_Settings")
    }

    /// 生成新建知识条目截图
    func testNewKnowledgeEntryScreenshot() throws {
        skipAuth()
        navigateToTab("知识库")

        let addButton = app.navigationBars.buttons["plus"]
        if addButton.waitForExistence(timeout: 2) {
            addButton.tap()
            sleep(1)
            takeScreenshot(name: "05_NewKnowledgeEntry")
        }
    }

    /// 生成 AI 对话详情截图
    func testAIChatDetailScreenshot() throws {
        skipAuth()
        navigateToTab("AI对话")

        // Start a new chat
        let addButton = app.navigationBars.buttons["plus"]
        if addButton.waitForExistence(timeout: 2) {
            addButton.tap()

            let createButton = app.buttons["创建"]
            if createButton.waitForExistence(timeout: 2) {
                createButton.tap()
                sleep(1)
                takeScreenshot(name: "06_AIChatDetail")
            }
        }
    }

    // MARK: - Dark Mode Screenshots

    func testDarkModeKnowledgeBase() throws {
        // Note: This requires setting up dark mode in the app
        skipAuth()
        navigateToTab("知识库")
        sleep(2)
        takeScreenshot(name: "07_KnowledgeBase_Dark")
    }

    // MARK: - Helper Methods

    private func skipAuth() {
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

    private func takeScreenshot(name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
