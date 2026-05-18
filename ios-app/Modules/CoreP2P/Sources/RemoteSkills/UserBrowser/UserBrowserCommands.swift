import Foundation

/// 用户浏览器（CDP）控制 typed RPC wrapper — Phase 6.1B1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/UserBrowserCommands.kt`。
/// 18 method 全 wired，桌面 `user-browser-handler.js` 与 Android 100% 名称对齐
/// （Coverage doc §1.4：A=18 D=18 ✓=18）。
///
/// 通过 Chrome DevTools Protocol (CDP) 连接和控制用户已安装的真实浏览器
/// （Chrome / Edge / Brave / Chromium）。与 `extension` skill 区别：
/// - `extension` = Chrome 扩展独立 WS 子系统（chainlesschain extension 注入）
/// - `userBrowser` = CDP 协议直连用户已装浏览器（无需安装 chainlesschain extension）
///
/// **wire 协议**（与桌面 `user-browser-handler.js` 对齐）：
/// 5 大类 18 method：
/// 1. 连接：`findBrowsers` / `connect` / `disconnect` / `getStatus`
/// 2. 标签页：`listTabs` / `getActiveTab` / `createTab` / `closeTab` / `focusTab`
/// 3. 导航：`navigate` / `goBack` / `goForward` / `refresh`
/// 4. 页面操作：`executeScript` / `getPageContent` / `screenshot`
/// 5. 用户数据：`getBookmarks` / `getHistory`
public actor UserBrowserCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - 连接管理

    /// 查找可用浏览器（扫桌面已装 Chrome / Edge / Brave 等）。
    public func findBrowsers(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> FindBrowsersResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.findBrowsers",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, FindBrowsersResponse.decode)
    }

    /// 连接到指定浏览器（mutating；可能 autoLaunch）。
    public func connect(
        pcPeerId: String,
        browserType: String = "chrome",
        port: Int? = nil,
        autoLaunch: Bool = true,
        mobileDid: String? = nil
    ) async throws -> ConnectBrowserResponse {
        guard !browserType.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.connect: browserType empty")
        }
        var params: [String: Any] = [
            "browserType": browserType,
            "autoLaunch": autoLaunch
        ]
        if let p = port { params["port"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.connect",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ConnectBrowserResponse.decode)
    }

    /// 断开 CDP 连接。
    public func disconnect(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> DisconnectBrowserResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.disconnect",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DisconnectBrowserResponse.decode)
    }

    /// 连接状态。
    public func getStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserConnectionStatus {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.getStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserConnectionStatus.decode)
    }

    // MARK: - 标签页

    /// 列所有标签页。
    public func listTabs(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> UserBrowserTabsResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.listTabs",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserTabsResponse.decode)
    }

    /// 获取当前活动标签页。
    public func getActiveTab(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> UserBrowserTabResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.getActiveTab",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserTabResponse.decode)
    }

    /// 创建新标签页（mutating）。
    public func createTab(
        pcPeerId: String,
        url: String? = nil,
        active: Bool = true,
        mobileDid: String? = nil
    ) async throws -> UserBrowserTabResponse {
        var params: [String: Any] = ["active": active]
        if let u = url { params["url"] = u }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.createTab",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserTabResponse.decode)
    }

    /// 关闭标签页（mutating）。
    public func closeTab(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> CloseTabResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.closeTab: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.closeTab",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, CloseTabResult.decode)
    }

    /// 聚焦标签页（mutating UI 状态）。
    public func focusTab(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> FocusTabResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.focusTab: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.focusTab",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, FocusTabResult.decode)
    }

    // MARK: - 导航

    /// 导航到 URL（mutating）。
    public func navigate(
        pcPeerId: String,
        targetId: String,
        url: String,
        mobileDid: String? = nil
    ) async throws -> NavigateResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.navigate: targetId empty")
        }
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.navigate: url empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.navigate",
            params: ["targetId": targetId, "url": url],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NavigateResult.decode)
    }

    /// 后退。
    public func goBack(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> NavigationResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.goBack: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.goBack",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NavigationResult.decode)
    }

    /// 前进。
    public func goForward(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> NavigationResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.goForward: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.goForward",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NavigationResult.decode)
    }

    /// 刷新页面。
    public func refresh(
        pcPeerId: String,
        targetId: String,
        ignoreCache: Bool = false,
        mobileDid: String? = nil
    ) async throws -> NavigationResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.refresh: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.refresh",
            params: ["targetId": targetId, "ignoreCache": ignoreCache],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, NavigationResult.decode)
    }

    // MARK: - 页面操作

    /// 执行 JavaScript（高危 Admin；应配 ApprovalGate）。
    public func executeScript(
        pcPeerId: String,
        targetId: String,
        script: String,
        mobileDid: String? = nil
    ) async throws -> ScriptExecutionResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.executeScript: targetId empty")
        }
        guard !script.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.executeScript: script empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.executeScript",
            params: ["targetId": targetId, "script": script],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ScriptExecutionResult.decode)
    }

    /// 获取页面内容（html / text）。
    public func getPageContent(
        pcPeerId: String,
        targetId: String,
        format: String = "html",
        mobileDid: String? = nil
    ) async throws -> PageContentResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.getPageContent: targetId empty")
        }
        guard format == "html" || format == "text" else {
            throw RemoteSkillError.invalidArgument("userBrowser.getPageContent: format must be html/text")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.getPageContent",
            params: ["targetId": targetId, "format": format],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PageContentResult.decode)
    }

    /// 截图（与 `display.screenshot` 不同：此为 tab 级；`display` 为整屏）。
    public func screenshot(
        pcPeerId: String,
        targetId: String,
        format: String = "png",
        quality: Int? = nil,
        fullPage: Bool = false,
        mobileDid: String? = nil
    ) async throws -> UserBrowserScreenshotResult {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("userBrowser.screenshot: targetId empty")
        }
        guard format == "png" || format == "jpeg" || format == "jpg" else {
            throw RemoteSkillError.invalidArgument("userBrowser.screenshot: format must be png/jpeg")
        }
        var params: [String: Any] = [
            "targetId": targetId,
            "format": format,
            "fullPage": fullPage
        ]
        if let q = quality {
            guard q >= 1 && q <= 100 else {
                throw RemoteSkillError.invalidArgument("userBrowser.screenshot: quality must be 1-100")
            }
            params["quality"] = q
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.screenshot",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserScreenshotResult.decode)
    }

    // MARK: - 用户数据

    /// 获取书签（可按 folderId 过滤）。
    public func getBookmarks(
        pcPeerId: String,
        folderId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> UserBrowserBookmarksResponse {
        var params: [String: Any] = [:]
        if let f = folderId { params["folderId"] = f }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.getBookmarks",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserBookmarksResponse.decode)
    }

    /// 获取历史记录（可按 query / 时间范围 过滤）。
    public func getHistory(
        pcPeerId: String,
        query: String? = nil,
        maxResults: Int = 100,
        startTime: Int64? = nil,
        endTime: Int64? = nil,
        mobileDid: String? = nil
    ) async throws -> UserBrowserHistoryResponse {
        guard maxResults > 0 else {
            throw RemoteSkillError.invalidArgument("userBrowser.getHistory: maxResults must be > 0")
        }
        var params: [String: Any] = ["maxResults": maxResults]
        if let q = query { params["query"] = q }
        if let s = startTime { params["startTime"] = s }
        if let e = endTime { params["endTime"] = e }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "userBrowser.getHistory",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UserBrowserHistoryResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):
            return try decoder(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
