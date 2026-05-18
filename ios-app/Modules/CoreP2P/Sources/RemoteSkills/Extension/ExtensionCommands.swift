import Foundation

/// Chrome 扩展控制 typed RPC wrapper — Phase 6.7.1 (sub-phase 1 of 3)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/ExtensionCommands.kt` 95 method
/// 中 **核心 30 method 子集** (Phase 6.7 doc §3 OQ-1 推荐)。剩 65 niche/debugging/
/// emulation/accessibility 留 v0.2。
///
/// **架构**（Phase 6.7 doc §1.1 解决 Plan §7 Trap T4）：
/// iOS → DC RPC `extension.<X>` → 桌面 remote-gateway.js → ExtensionBrowserHandler
/// → 本地 WS server (127.0.0.1:18790) → Chrome 扩展 background script。
/// iOS **完全不接触** 那个本地 WS — 与 Phase 6.1B1/6.6 等 skill wire 100% 一致。
///
/// **clientId** (Phase 6.7 doc §3 OQ-2 A)：v0.1 不传 clientId，桌面端走
/// `getFirstClientId` 自动选第一个连接的 Chrome 扩展实例 (99% 单实例场景)。
/// v0.2 多实例 picker 留 backlog。
///
/// **错误特征 message** (Trap E2)：扩展未连接时桌面返
/// `"No browser extension connected. Please install..."` — UI 端检测此前缀显
/// 引导 banner。本 actor 透传 RemoteSkillError.remoteError。
///
/// **30 method 5 桶分布**：
/// - Tabs & navigation (10): listTabs/getTab/createTab/closeTab/focusTab/
///   navigate/reload/goBack/goForward/canNavigateBack
/// - Screenshot & DOM (5): captureScreenshot/captureFullPageScreenshot/
///   captureElementScreenshot/executeScript/getPageContent
/// - Cookies (5): getCookies/getCookie/setCookie/removeCookie/clearCookies
/// - Storage (5): clearLocalStorage/clearSessionStorage/clearIndexedDBStore/
///   clearBrowsingData/getStorageQuota
/// - Bookmarks + History (5): getBookmarks/searchBookmarks/createBookmark/
///   getHistory/deleteHistory
public actor ExtensionCommands {

    /// 错误 message 特征 — UI 端检测显安装引导（Trap E2 — 桌面端改文案需双向更新）。
    public static let extensionNotConnectedHint = "No browser extension connected"

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - Tabs & navigation (10)

    public func listTabs(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> ExtensionTabsListResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.listTabs",
            params: [:], mobileDid: mobileDid,
            decoder: ExtensionTabsListResponse.decode
        )
    }

    public func getTab(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionTabResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getTab",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionTabResponse.decode
        )
    }

    public func createTab(
        pcPeerId: String, url: String? = nil, active: Bool = true,
        windowId: Int? = nil, mobileDid: String? = nil
    ) async throws -> ExtensionTabResponse {
        var params: [String: Any] = ["active": active]
        if let u = url { params["url"] = u }
        if let w = windowId { params["windowId"] = w }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.createTab",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionTabResponse.decode
        )
    }

    public func closeTab(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.closeTab",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionNavResponse.decode
        )
    }

    public func focusTab(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.focusTab",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionNavResponse.decode
        )
    }

    public func navigate(
        pcPeerId: String, tabId: Int, url: String, mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.navigate: url empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.navigate",
            params: ["tabId": tabId, "url": url], mobileDid: mobileDid,
            decoder: ExtensionNavResponse.decode
        )
    }

    public func reload(
        pcPeerId: String, tabId: Int, bypassCache: Bool = false,
        mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.reload",
            params: ["tabId": tabId, "bypassCache": bypassCache],
            mobileDid: mobileDid, decoder: ExtensionNavResponse.decode
        )
    }

    public func goBack(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.goBack",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionNavResponse.decode
        )
    }

    public func goForward(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionNavResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.goForward",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionNavResponse.decode
        )
    }

    public func canNavigateBack(
        pcPeerId: String, tabId: Int, mobileDid: String? = nil
    ) async throws -> ExtensionCanNavigateResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.canNavigateBack",
            params: ["tabId": tabId], mobileDid: mobileDid,
            decoder: ExtensionCanNavigateResponse.decode
        )
    }

    // MARK: - Screenshot & DOM (5)

    public func captureScreenshot(
        pcPeerId: String, tabId: Int, format: String = "png",
        quality: Int? = nil, mobileDid: String? = nil
    ) async throws -> ExtensionScreenshotResponse {
        guard format == "png" || format == "jpeg" else {
            throw RemoteSkillError.invalidArgument("extension.captureScreenshot: format must be png/jpeg")
        }
        var params: [String: Any] = ["tabId": tabId, "format": format]
        if let q = quality {
            guard q >= 1 && q <= 100 else {
                throw RemoteSkillError.invalidArgument("extension.captureScreenshot: quality 1-100")
            }
            params["quality"] = q
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.captureScreenshot",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionScreenshotResponse.decode
        )
    }

    public func captureFullPageScreenshot(
        pcPeerId: String, tabId: Int, format: String = "png",
        mobileDid: String? = nil
    ) async throws -> ExtensionScreenshotResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.captureFullPageScreenshot",
            params: ["tabId": tabId, "format": format], mobileDid: mobileDid,
            decoder: ExtensionScreenshotResponse.decode
        )
    }

    public func captureElementScreenshot(
        pcPeerId: String, tabId: Int, selector: String,
        mobileDid: String? = nil
    ) async throws -> ExtensionScreenshotResponse {
        guard !selector.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.captureElementScreenshot: selector empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.captureElementScreenshot",
            params: ["tabId": tabId, "selector": selector], mobileDid: mobileDid,
            decoder: ExtensionScreenshotResponse.decode
        )
    }

    public func executeScript(
        pcPeerId: String, tabId: Int, script: String,
        mobileDid: String? = nil
    ) async throws -> ExtensionExecuteScriptResponse {
        guard !script.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.executeScript: script empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.executeScript",
            params: ["tabId": tabId, "script": script], mobileDid: mobileDid,
            decoder: ExtensionExecuteScriptResponse.decode
        )
    }

    public func getPageContent(
        pcPeerId: String, tabId: Int, format: String = "html",
        mobileDid: String? = nil
    ) async throws -> ExtensionPageContentResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getPageContent",
            params: ["tabId": tabId, "format": format], mobileDid: mobileDid,
            decoder: ExtensionPageContentResponse.decode
        )
    }

    // MARK: - Cookies (5)

    public func getCookies(
        pcPeerId: String, url: String? = nil, domain: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ExtensionCookiesResponse {
        var params: [String: Any] = [:]
        if let u = url { params["url"] = u }
        if let d = domain { params["domain"] = d }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getCookies",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionCookiesResponse.decode
        )
    }

    public func getCookie(
        pcPeerId: String, url: String, name: String,
        mobileDid: String? = nil
    ) async throws -> ExtensionCookieResponse {
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.getCookie: url empty")
        }
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.getCookie: name empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getCookie",
            params: ["url": url, "name": name], mobileDid: mobileDid,
            decoder: ExtensionCookieResponse.decode
        )
    }

    public func setCookie(
        pcPeerId: String, url: String, name: String, value: String,
        domain: String? = nil, path: String? = nil, secure: Bool? = nil,
        httpOnly: Bool? = nil, expirationDate: Double? = nil,
        mobileDid: String? = nil
    ) async throws -> ExtensionCookieResponse {
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.setCookie: url empty")
        }
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.setCookie: name empty")
        }
        var params: [String: Any] = ["url": url, "name": name, "value": value]
        if let d = domain { params["domain"] = d }
        if let p = path { params["path"] = p }
        if let s = secure { params["secure"] = s }
        if let h = httpOnly { params["httpOnly"] = h }
        if let e = expirationDate { params["expirationDate"] = e }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.setCookie",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionCookieResponse.decode
        )
    }

    public func removeCookie(
        pcPeerId: String, url: String, name: String,
        mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.removeCookie: url empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.removeCookie",
            params: ["url": url, "name": name], mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    public func clearCookies(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.clearCookies",
            params: [:], mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    // MARK: - Storage (5)

    public func clearLocalStorage(
        pcPeerId: String, tabId: Int? = nil, mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        var params: [String: Any] = [:]
        if let t = tabId { params["tabId"] = t }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.clearLocalStorage",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    public func clearSessionStorage(
        pcPeerId: String, tabId: Int? = nil, mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        var params: [String: Any] = [:]
        if let t = tabId { params["tabId"] = t }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.clearSessionStorage",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    public func clearIndexedDBStore(
        pcPeerId: String, dbName: String, mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        guard !dbName.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.clearIndexedDBStore: dbName empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.clearIndexedDBStore",
            params: ["dbName": dbName], mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    public func clearBrowsingData(
        pcPeerId: String, since: Double? = nil,
        dataTypes: [String] = ["cache", "cookies", "localStorage"],
        mobileDid: String? = nil
    ) async throws -> ExtensionStorageClearResponse {
        var params: [String: Any] = ["dataTypes": dataTypes]
        if let s = since { params["since"] = s }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.clearBrowsingData",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionStorageClearResponse.decode
        )
    }

    public func getStorageQuota(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> ExtensionStorageQuotaResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getStorageQuota",
            params: [:], mobileDid: mobileDid,
            decoder: ExtensionStorageQuotaResponse.decode
        )
    }

    // MARK: - Bookmarks + History (5)

    public func getBookmarks(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> ExtensionBookmarksResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getBookmarks",
            params: [:], mobileDid: mobileDid,
            decoder: ExtensionBookmarksResponse.decode
        )
    }

    public func searchBookmarks(
        pcPeerId: String, query: String, mobileDid: String? = nil
    ) async throws -> ExtensionBookmarksResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.searchBookmarks: query empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.searchBookmarks",
            params: ["query": query], mobileDid: mobileDid,
            decoder: ExtensionBookmarksResponse.decode
        )
    }

    public func createBookmark(
        pcPeerId: String, title: String, url: String,
        parentId: String? = nil, mobileDid: String? = nil
    ) async throws -> ExtensionBookmarkCreateResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.createBookmark: title empty")
        }
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("extension.createBookmark: url empty")
        }
        var params: [String: Any] = ["title": title, "url": url]
        if let p = parentId { params["parentId"] = p }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.createBookmark",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionBookmarkCreateResponse.decode
        )
    }

    public func getHistory(
        pcPeerId: String, query: String? = nil, maxResults: Int = 100,
        startTime: Double? = nil, endTime: Double? = nil,
        mobileDid: String? = nil
    ) async throws -> ExtensionHistoryResponse {
        guard maxResults > 0 else {
            throw RemoteSkillError.invalidArgument("extension.getHistory: maxResults must be > 0")
        }
        var params: [String: Any] = ["maxResults": maxResults]
        if let q = query { params["query"] = q }
        if let s = startTime { params["startTime"] = s }
        if let e = endTime { params["endTime"] = e }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.getHistory",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionHistoryResponse.decode
        )
    }

    public func deleteHistory(
        pcPeerId: String, url: String? = nil,
        startTime: Double? = nil, endTime: Double? = nil,
        mobileDid: String? = nil
    ) async throws -> ExtensionHistoryDeleteResponse {
        var params: [String: Any] = [:]
        if let u = url { params["url"] = u }
        if let s = startTime { params["startTime"] = s }
        if let e = endTime { params["endTime"] = e }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "extension.deleteHistory",
            params: params, mobileDid: mobileDid,
            decoder: ExtensionHistoryDeleteResponse.decode
        )
    }

    // MARK: - 内部

    private func invokeAndDecode<T>(
        pcPeerId: String, method: String,
        params: [String: Any], mobileDid: String?,
        decoder: (String) throws -> T
    ) async throws -> T {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId, method: method,
            params: params, mobileDid: mobileDid
        )
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
