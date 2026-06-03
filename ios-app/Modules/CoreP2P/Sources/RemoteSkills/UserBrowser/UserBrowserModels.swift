import Foundation

// MARK: - 连接管理

public struct AvailableBrowser: Sendable, Equatable {
    public let type: String       // chrome / edge / brave / chromium
    public let name: String
    public let executablePath: String
    public let defaultPort: Int
    public let userDataDir: String?

    public init(type: String, name: String, executablePath: String,
                defaultPort: Int, userDataDir: String? = nil) {
        self.type = type; self.name = name
        self.executablePath = executablePath
        self.defaultPort = defaultPort; self.userDataDir = userDataDir
    }

    internal static func from(_ d: [String: Any]) -> AvailableBrowser {
        return AvailableBrowser(
            type: (d["type"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            executablePath: (d["executablePath"] as? String) ?? "",
            defaultPort: (d["defaultPort"] as? Int) ?? 9222,
            userDataDir: d["userDataDir"] as? String
        )
    }
}

public struct FindBrowsersResponse: Sendable, Equatable {
    public let success: Bool
    public let browsers: [AvailableBrowser]

    public init(success: Bool, browsers: [AvailableBrowser]) {
        self.success = success; self.browsers = browsers
    }

    public static func decode(_ json: String) throws -> FindBrowsersResponse {
        let d = try parseDict(json)
        let arr = (d["browsers"] as? [[String: Any]]) ?? []
        return FindBrowsersResponse(
            success: (d["success"] as? Bool) ?? true,
            browsers: arr.map { AvailableBrowser.from($0) }
        )
    }
}

public struct ConnectBrowserResponse: Sendable, Equatable {
    public let success: Bool
    public let browserType: String
    public let debugPort: Int
    public let wsEndpoint: String?
    public let message: String?

    public init(success: Bool, browserType: String, debugPort: Int,
                wsEndpoint: String? = nil, message: String? = nil) {
        self.success = success; self.browserType = browserType
        self.debugPort = debugPort; self.wsEndpoint = wsEndpoint; self.message = message
    }

    public static func decode(_ json: String) throws -> ConnectBrowserResponse {
        let d = try parseDict(json)
        return ConnectBrowserResponse(
            success: (d["success"] as? Bool) ?? false,
            browserType: (d["browserType"] as? String) ?? "",
            debugPort: (d["debugPort"] as? Int) ?? 0,
            wsEndpoint: d["wsEndpoint"] as? String,
            message: d["message"] as? String
        )
    }
}

public struct DisconnectBrowserResponse: Sendable, Equatable {
    public let success: Bool
    public let message: String?

    public init(success: Bool, message: String? = nil) {
        self.success = success; self.message = message
    }

    public static func decode(_ json: String) throws -> DisconnectBrowserResponse {
        let d = try parseDict(json)
        return DisconnectBrowserResponse(
            success: (d["success"] as? Bool) ?? false,
            message: d["message"] as? String
        )
    }
}

public struct BrowserConnectionStatus: Sendable, Equatable {
    public let success: Bool
    public let connected: Bool
    public let browserType: String?
    public let debugPort: Int?
    public let tabCount: Int?
    public let connectTime: Int64?
    public let commandCount: Int?

    public init(success: Bool, connected: Bool, browserType: String? = nil,
                debugPort: Int? = nil, tabCount: Int? = nil,
                connectTime: Int64? = nil, commandCount: Int? = nil) {
        self.success = success; self.connected = connected; self.browserType = browserType
        self.debugPort = debugPort; self.tabCount = tabCount
        self.connectTime = connectTime; self.commandCount = commandCount
    }

    public static func decode(_ json: String) throws -> BrowserConnectionStatus {
        let d = try parseDict(json)
        let connectTime: Int64?
        if let n = d["connectTime"] as? Int64 { connectTime = n }
        else if let n = d["connectTime"] as? Int { connectTime = Int64(n) }
        else { connectTime = nil }
        return BrowserConnectionStatus(
            success: (d["success"] as? Bool) ?? true,
            connected: (d["connected"] as? Bool) ?? false,
            browserType: d["browserType"] as? String,
            debugPort: d["debugPort"] as? Int,
            tabCount: d["tabCount"] as? Int,
            connectTime: connectTime,
            commandCount: d["commandCount"] as? Int
        )
    }
}

// MARK: - 标签页

public struct UserBrowserTab: Sendable, Equatable {
    public let targetId: String
    public let url: String
    public let title: String?
    public let type: String
    public let attached: Bool
    public let active: Bool
    public let favIconUrl: String?

    public init(targetId: String, url: String, title: String? = nil,
                type: String, attached: Bool = false, active: Bool = false,
                favIconUrl: String? = nil) {
        self.targetId = targetId; self.url = url; self.title = title
        self.type = type; self.attached = attached; self.active = active
        self.favIconUrl = favIconUrl
    }

    internal static func from(_ d: [String: Any]) -> UserBrowserTab {
        return UserBrowserTab(
            targetId: (d["targetId"] as? String) ?? "",
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            type: (d["type"] as? String) ?? "page",
            attached: (d["attached"] as? Bool) ?? false,
            active: (d["active"] as? Bool) ?? false,
            favIconUrl: d["favIconUrl"] as? String
        )
    }
}

public struct UserBrowserTabsResponse: Sendable, Equatable {
    public let success: Bool
    public let tabs: [UserBrowserTab]
    public let total: Int

    public init(success: Bool, tabs: [UserBrowserTab], total: Int) {
        self.success = success; self.tabs = tabs; self.total = total
    }

    public static func decode(_ json: String) throws -> UserBrowserTabsResponse {
        let d = try parseDict(json)
        let arr = (d["tabs"] as? [[String: Any]]) ?? []
        return UserBrowserTabsResponse(
            success: (d["success"] as? Bool) ?? false,
            tabs: arr.map { UserBrowserTab.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct UserBrowserTabResponse: Sendable, Equatable {
    public let success: Bool
    public let tab: UserBrowserTab?
    public let message: String?

    public init(success: Bool, tab: UserBrowserTab? = nil, message: String? = nil) {
        self.success = success; self.tab = tab; self.message = message
    }

    public static func decode(_ json: String) throws -> UserBrowserTabResponse {
        let d = try parseDict(json)
        let t = d["tab"] as? [String: Any]
        return UserBrowserTabResponse(
            success: (d["success"] as? Bool) ?? false,
            tab: t.map { UserBrowserTab.from($0) },
            message: d["message"] as? String
        )
    }
}

public struct CloseTabResult: Sendable, Equatable {
    public let success: Bool
    public let targetId: String?
    public let message: String?

    public init(success: Bool, targetId: String? = nil, message: String? = nil) {
        self.success = success; self.targetId = targetId; self.message = message
    }

    public static func decode(_ json: String) throws -> CloseTabResult {
        let d = try parseDict(json)
        return CloseTabResult(
            success: (d["success"] as? Bool) ?? false,
            targetId: d["targetId"] as? String,
            message: d["message"] as? String
        )
    }
}

public struct FocusTabResult: Sendable, Equatable {
    public let success: Bool
    public let targetId: String?
    public let message: String?

    public init(success: Bool, targetId: String? = nil, message: String? = nil) {
        self.success = success; self.targetId = targetId; self.message = message
    }

    public static func decode(_ json: String) throws -> FocusTabResult {
        let d = try parseDict(json)
        return FocusTabResult(
            success: (d["success"] as? Bool) ?? false,
            targetId: d["targetId"] as? String,
            message: d["message"] as? String
        )
    }
}

// MARK: - 导航

public struct NavigateResult: Sendable, Equatable {
    public let success: Bool
    public let targetId: String?
    public let url: String?
    public let frameId: String?
    public let errorText: String?

    public init(success: Bool, targetId: String? = nil, url: String? = nil,
                frameId: String? = nil, errorText: String? = nil) {
        self.success = success; self.targetId = targetId; self.url = url
        self.frameId = frameId; self.errorText = errorText
    }

    public static func decode(_ json: String) throws -> NavigateResult {
        let d = try parseDict(json)
        return NavigateResult(
            success: (d["success"] as? Bool) ?? false,
            targetId: d["targetId"] as? String,
            url: d["url"] as? String,
            frameId: d["frameId"] as? String,
            errorText: d["errorText"] as? String
        )
    }
}

public struct NavigationResult: Sendable, Equatable {
    public let success: Bool
    public let targetId: String?
    public let message: String?

    public init(success: Bool, targetId: String? = nil, message: String? = nil) {
        self.success = success; self.targetId = targetId; self.message = message
    }

    public static func decode(_ json: String) throws -> NavigationResult {
        let d = try parseDict(json)
        return NavigationResult(
            success: (d["success"] as? Bool) ?? false,
            targetId: d["targetId"] as? String,
            message: d["message"] as? String
        )
    }
}

// MARK: - 页面操作

public struct ScriptExecutionResult: Sendable, Equatable {
    public let success: Bool
    public let result: String?
    public let type: String?
    public let error: String?
    public let exceptionDetails: String?

    public init(success: Bool, result: String? = nil, type: String? = nil,
                error: String? = nil, exceptionDetails: String? = nil) {
        self.success = success; self.result = result; self.type = type
        self.error = error; self.exceptionDetails = exceptionDetails
    }

    public static func decode(_ json: String) throws -> ScriptExecutionResult {
        let d = try parseDict(json)
        // result 字段可能是 any 类型 — 序列化为字符串方便上层处理
        let resultStr: String?
        if let r = d["result"] as? String { resultStr = r }
        else if let r = d["result"] {
            if let data = try? JSONSerialization.data(withJSONObject: r, options: [.fragmentsAllowed]),
               let s = String(data: data, encoding: .utf8) {
                resultStr = s
            } else { resultStr = nil }
        } else { resultStr = nil }
        return ScriptExecutionResult(
            success: (d["success"] as? Bool) ?? false,
            result: resultStr,
            type: d["type"] as? String,
            error: d["error"] as? String,
            exceptionDetails: d["exceptionDetails"] as? String
        )
    }
}

public struct PageContentResult: Sendable, Equatable {
    public let success: Bool
    public let content: String?
    public let format: String?
    public let url: String?
    public let title: String?
    public let length: Int?

    public init(success: Bool, content: String? = nil, format: String? = nil,
                url: String? = nil, title: String? = nil, length: Int? = nil) {
        self.success = success; self.content = content; self.format = format
        self.url = url; self.title = title; self.length = length
    }

    public static func decode(_ json: String) throws -> PageContentResult {
        let d = try parseDict(json)
        return PageContentResult(
            success: (d["success"] as? Bool) ?? false,
            content: d["content"] as? String,
            format: d["format"] as? String,
            url: d["url"] as? String,
            title: d["title"] as? String,
            length: d["length"] as? Int
        )
    }
}

public struct UserBrowserScreenshotResult: Sendable, Equatable {
    public let success: Bool
    public let data: String  // base64
    public let format: String
    public let width: Int?
    public let height: Int?
    public let size: Int?

    public init(success: Bool, data: String, format: String,
                width: Int? = nil, height: Int? = nil, size: Int? = nil) {
        self.success = success; self.data = data; self.format = format
        self.width = width; self.height = height; self.size = size
    }

    public static func decode(_ json: String) throws -> UserBrowserScreenshotResult {
        let d = try parseDict(json)
        return UserBrowserScreenshotResult(
            success: (d["success"] as? Bool) ?? false,
            data: (d["data"] as? String) ?? "",
            format: (d["format"] as? String) ?? "png",
            width: d["width"] as? Int,
            height: d["height"] as? Int,
            size: d["size"] as? Int
        )
    }
}

// MARK: - 用户数据

public struct UserBrowserBookmark: Sendable, Equatable {
    public let id: String
    public let title: String
    public let url: String?
    public let parentId: String?
    public let dateAdded: Int64?
    public let type: String  // bookmark / folder

    public init(id: String, title: String, url: String? = nil,
                parentId: String? = nil, dateAdded: Int64? = nil,
                type: String = "bookmark") {
        self.id = id; self.title = title; self.url = url
        self.parentId = parentId; self.dateAdded = dateAdded; self.type = type
    }

    internal static func from(_ d: [String: Any]) -> UserBrowserBookmark {
        let dateAdded: Int64?
        if let n = d["dateAdded"] as? Int64 { dateAdded = n }
        else if let n = d["dateAdded"] as? Int { dateAdded = Int64(n) }
        else { dateAdded = nil }
        return UserBrowserBookmark(
            id: (d["id"] as? String) ?? "",
            title: (d["title"] as? String) ?? "",
            url: d["url"] as? String,
            parentId: d["parentId"] as? String,
            dateAdded: dateAdded,
            type: (d["type"] as? String) ?? "bookmark"
        )
    }
}

public struct UserBrowserBookmarksResponse: Sendable, Equatable {
    public let success: Bool
    public let bookmarks: [UserBrowserBookmark]
    public let total: Int

    public init(success: Bool, bookmarks: [UserBrowserBookmark], total: Int) {
        self.success = success; self.bookmarks = bookmarks; self.total = total
    }

    public static func decode(_ json: String) throws -> UserBrowserBookmarksResponse {
        let d = try parseDict(json)
        let arr = (d["bookmarks"] as? [[String: Any]]) ?? []
        return UserBrowserBookmarksResponse(
            success: (d["success"] as? Bool) ?? false,
            bookmarks: arr.map { UserBrowserBookmark.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct UserBrowserHistoryItem: Sendable, Equatable {
    public let id: String
    public let url: String
    public let title: String?
    public let lastVisitTime: Int64
    public let visitCount: Int
    public let typedCount: Int?

    public init(id: String, url: String, title: String? = nil,
                lastVisitTime: Int64, visitCount: Int, typedCount: Int? = nil) {
        self.id = id; self.url = url; self.title = title
        self.lastVisitTime = lastVisitTime; self.visitCount = visitCount
        self.typedCount = typedCount
    }

    internal static func from(_ d: [String: Any]) -> UserBrowserHistoryItem {
        let lastVisitTime: Int64
        if let n = d["lastVisitTime"] as? Int64 { lastVisitTime = n }
        else if let n = d["lastVisitTime"] as? Int { lastVisitTime = Int64(n) }
        else { lastVisitTime = 0 }
        return UserBrowserHistoryItem(
            id: (d["id"] as? String) ?? "",
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            lastVisitTime: lastVisitTime,
            visitCount: (d["visitCount"] as? Int) ?? 0,
            typedCount: d["typedCount"] as? Int
        )
    }
}

public struct UserBrowserHistoryResponse: Sendable, Equatable {
    public let success: Bool
    public let items: [UserBrowserHistoryItem]
    public let total: Int

    public init(success: Bool, items: [UserBrowserHistoryItem], total: Int) {
        self.success = success; self.items = items; self.total = total
    }

    public static func decode(_ json: String) throws -> UserBrowserHistoryResponse {
        let d = try parseDict(json)
        let arr = (d["items"] as? [[String: Any]]) ?? []
        return UserBrowserHistoryResponse(
            success: (d["success"] as? Bool) ?? false,
            items: arr.map { UserBrowserHistoryItem.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}
