import Foundation

// MARK: - Tabs & navigation

/// Chrome tab 元数据 (extension.listTabs / getTab 返单项)。
public struct ChromeTab: Sendable, Equatable {
    public let id: Int
    public let url: String
    public let title: String?
    public let active: Bool
    public let pinned: Bool
    public let windowId: Int?
    public let index: Int?
    public let status: String?         // loading / complete

    public init(id: Int, url: String, title: String? = nil,
                active: Bool = false, pinned: Bool = false,
                windowId: Int? = nil, index: Int? = nil, status: String? = nil) {
        self.id = id; self.url = url; self.title = title
        self.active = active; self.pinned = pinned
        self.windowId = windowId; self.index = index; self.status = status
    }

    internal static func from(_ d: [String: Any]) -> ChromeTab {
        return ChromeTab(
            id: (d["id"] as? Int) ?? 0,
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            active: (d["active"] as? Bool) ?? false,
            pinned: (d["pinned"] as? Bool) ?? false,
            windowId: d["windowId"] as? Int,
            index: d["index"] as? Int,
            status: d["status"] as? String
        )
    }
}

public struct ExtensionTabsListResponse: Sendable, Equatable {
    public let success: Bool
    public let tabs: [ChromeTab]

    public init(success: Bool, tabs: [ChromeTab]) {
        self.success = success; self.tabs = tabs
    }

    public static func decode(_ json: String) throws -> ExtensionTabsListResponse {
        let d = try parseDict(json)
        let arr = (d["tabs"] as? [[String: Any]]) ?? []
        return ExtensionTabsListResponse(
            success: (d["success"] as? Bool) ?? false,
            tabs: arr.map { ChromeTab.from($0) }
        )
    }
}

public struct ExtensionTabResponse: Sendable, Equatable {
    public let success: Bool
    public let tab: ChromeTab?
    public let message: String?

    public init(success: Bool, tab: ChromeTab? = nil, message: String? = nil) {
        self.success = success; self.tab = tab; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionTabResponse {
        let d = try parseDict(json)
        let t = d["tab"] as? [String: Any]
        return ExtensionTabResponse(
            success: (d["success"] as? Bool) ?? false,
            tab: t.map { ChromeTab.from($0) },
            message: d["message"] as? String
        )
    }
}

/// 通用 navigation 响应（navigate/reload/goBack/goForward/closeTab/focusTab）。
public struct ExtensionNavResponse: Sendable, Equatable {
    public let success: Bool
    public let tabId: Int?
    public let url: String?
    public let message: String?

    public init(success: Bool, tabId: Int? = nil, url: String? = nil, message: String? = nil) {
        self.success = success; self.tabId = tabId; self.url = url; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionNavResponse {
        let d = try parseDict(json)
        return ExtensionNavResponse(
            success: (d["success"] as? Bool) ?? false,
            tabId: d["tabId"] as? Int,
            url: d["url"] as? String,
            message: d["message"] as? String
        )
    }
}

/// `extension.canNavigateBack` / `canNavigateForward` — boolean 结果。
public struct ExtensionCanNavigateResponse: Sendable, Equatable {
    public let success: Bool
    public let canNavigate: Bool

    public init(success: Bool, canNavigate: Bool) {
        self.success = success; self.canNavigate = canNavigate
    }

    public static func decode(_ json: String) throws -> ExtensionCanNavigateResponse {
        let d = try parseDict(json)
        return ExtensionCanNavigateResponse(
            success: (d["success"] as? Bool) ?? false,
            canNavigate: (d["canNavigate"] as? Bool) ?? (d["result"] as? Bool) ?? false
        )
    }
}

// MARK: - Screenshot & DOM

/// `extension.captureScreenshot` / `captureFullPageScreenshot` / `captureElementScreenshot` 响应。
public struct ExtensionScreenshotResponse: Sendable, Equatable {
    public let success: Bool
    public let dataUrl: String          // `data:image/png;base64,...`
    public let format: String           // png / jpeg
    public let width: Int?
    public let height: Int?

    public init(success: Bool, dataUrl: String, format: String,
                width: Int? = nil, height: Int? = nil) {
        self.success = success; self.dataUrl = dataUrl; self.format = format
        self.width = width; self.height = height
    }

    public static func decode(_ json: String) throws -> ExtensionScreenshotResponse {
        let d = try parseDict(json)
        return ExtensionScreenshotResponse(
            success: (d["success"] as? Bool) ?? false,
            dataUrl: (d["dataUrl"] as? String) ?? (d["data"] as? String) ?? "",
            format: (d["format"] as? String) ?? "png",
            width: d["width"] as? Int,
            height: d["height"] as? Int
        )
    }
}

/// `extension.executeScript` 响应 — Chrome eval result。
public struct ExtensionExecuteScriptResponse: Sendable, Equatable {
    public let success: Bool
    public let result: String?          // 任意 JSON 序列化为字符串
    public let error: String?

    public init(success: Bool, result: String? = nil, error: String? = nil) {
        self.success = success; self.result = result; self.error = error
    }

    public static func decode(_ json: String) throws -> ExtensionExecuteScriptResponse {
        let d = try parseDict(json)
        let r = d["result"]
        let resultStr: String?
        if let s = r as? String { resultStr = s }
        else if let r = r {
            if let data = try? JSONSerialization.data(withJSONObject: r, options: [.fragmentsAllowed]),
               let s = String(data: data, encoding: .utf8) { resultStr = s }
            else { resultStr = nil }
        } else { resultStr = nil }
        return ExtensionExecuteScriptResponse(
            success: (d["success"] as? Bool) ?? false,
            result: resultStr,
            error: d["error"] as? String
        )
    }
}

/// `extension.getPageContent` 响应。
public struct ExtensionPageContentResponse: Sendable, Equatable {
    public let success: Bool
    public let content: String          // HTML 或 text
    public let format: String?
    public let length: Int?

    public init(success: Bool, content: String, format: String? = nil, length: Int? = nil) {
        self.success = success; self.content = content
        self.format = format; self.length = length
    }

    public static func decode(_ json: String) throws -> ExtensionPageContentResponse {
        let d = try parseDict(json)
        return ExtensionPageContentResponse(
            success: (d["success"] as? Bool) ?? false,
            content: (d["content"] as? String) ?? "",
            format: d["format"] as? String,
            length: d["length"] as? Int
        )
    }
}

// MARK: - Cookies

public struct ChromeCookie: Sendable, Equatable {
    public let name: String
    public let value: String
    public let domain: String?
    public let path: String?
    public let expirationDate: Double?
    public let secure: Bool
    public let httpOnly: Bool
    public let sameSite: String?

    public init(name: String, value: String, domain: String? = nil,
                path: String? = nil, expirationDate: Double? = nil,
                secure: Bool = false, httpOnly: Bool = false, sameSite: String? = nil) {
        self.name = name; self.value = value; self.domain = domain
        self.path = path; self.expirationDate = expirationDate
        self.secure = secure; self.httpOnly = httpOnly; self.sameSite = sameSite
    }

    internal static func from(_ d: [String: Any]) -> ChromeCookie {
        return ChromeCookie(
            name: (d["name"] as? String) ?? "",
            value: (d["value"] as? String) ?? "",
            domain: d["domain"] as? String,
            path: d["path"] as? String,
            expirationDate: d["expirationDate"] as? Double,
            secure: (d["secure"] as? Bool) ?? false,
            httpOnly: (d["httpOnly"] as? Bool) ?? false,
            sameSite: d["sameSite"] as? String
        )
    }
}

public struct ExtensionCookiesResponse: Sendable, Equatable {
    public let success: Bool
    public let cookies: [ChromeCookie]

    public init(success: Bool, cookies: [ChromeCookie]) {
        self.success = success; self.cookies = cookies
    }

    public static func decode(_ json: String) throws -> ExtensionCookiesResponse {
        let d = try parseDict(json)
        let arr = (d["cookies"] as? [[String: Any]]) ?? []
        return ExtensionCookiesResponse(
            success: (d["success"] as? Bool) ?? false,
            cookies: arr.map { ChromeCookie.from($0) }
        )
    }
}

public struct ExtensionCookieResponse: Sendable, Equatable {
    public let success: Bool
    public let cookie: ChromeCookie?
    public let message: String?

    public init(success: Bool, cookie: ChromeCookie? = nil, message: String? = nil) {
        self.success = success; self.cookie = cookie; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionCookieResponse {
        let d = try parseDict(json)
        let c = d["cookie"] as? [String: Any]
        return ExtensionCookieResponse(
            success: (d["success"] as? Bool) ?? false,
            cookie: c.map { ChromeCookie.from($0) },
            message: d["message"] as? String
        )
    }
}

// MARK: - Storage

public struct ExtensionStorageClearResponse: Sendable, Equatable {
    public let success: Bool
    public let cleared: Bool
    public let message: String?

    public init(success: Bool, cleared: Bool, message: String? = nil) {
        self.success = success; self.cleared = cleared; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionStorageClearResponse {
        let d = try parseDict(json)
        return ExtensionStorageClearResponse(
            success: (d["success"] as? Bool) ?? false,
            cleared: (d["cleared"] as? Bool) ?? (d["success"] as? Bool) ?? false,
            message: d["message"] as? String
        )
    }
}

public struct ExtensionStorageQuotaResponse: Sendable, Equatable {
    public let success: Bool
    public let usage: Int64
    public let quota: Int64

    public init(success: Bool, usage: Int64, quota: Int64) {
        self.success = success; self.usage = usage; self.quota = quota
    }

    private static func int64(_ d: [String: Any], _ k: String) -> Int64 {
        if let n = d[k] as? Int64 { return n }
        if let n = d[k] as? Int { return Int64(n) }
        return 0
    }

    public static func decode(_ json: String) throws -> ExtensionStorageQuotaResponse {
        let d = try parseDict(json)
        return ExtensionStorageQuotaResponse(
            success: (d["success"] as? Bool) ?? false,
            usage: int64(d, "usage"),
            quota: int64(d, "quota")
        )
    }
}

// MARK: - Bookmarks

public struct ChromeBookmark: Sendable, Equatable {
    public let id: String
    public let title: String
    public let url: String?              // nil = folder
    public let parentId: String?
    public let dateAdded: Int64?

    public init(id: String, title: String, url: String? = nil,
                parentId: String? = nil, dateAdded: Int64? = nil) {
        self.id = id; self.title = title; self.url = url
        self.parentId = parentId; self.dateAdded = dateAdded
    }

    internal static func from(_ d: [String: Any]) -> ChromeBookmark {
        let dateAdded: Int64?
        if let n = d["dateAdded"] as? Int64 { dateAdded = n }
        else if let n = d["dateAdded"] as? Int { dateAdded = Int64(n) }
        else { dateAdded = nil }
        return ChromeBookmark(
            id: (d["id"] as? String) ?? "",
            title: (d["title"] as? String) ?? "",
            url: d["url"] as? String,
            parentId: d["parentId"] as? String,
            dateAdded: dateAdded
        )
    }
}

public struct ExtensionBookmarksResponse: Sendable, Equatable {
    public let success: Bool
    public let bookmarks: [ChromeBookmark]

    public init(success: Bool, bookmarks: [ChromeBookmark]) {
        self.success = success; self.bookmarks = bookmarks
    }

    public static func decode(_ json: String) throws -> ExtensionBookmarksResponse {
        let d = try parseDict(json)
        let arr = (d["bookmarks"] as? [[String: Any]]) ?? []
        return ExtensionBookmarksResponse(
            success: (d["success"] as? Bool) ?? false,
            bookmarks: arr.map { ChromeBookmark.from($0) }
        )
    }
}

public struct ExtensionBookmarkCreateResponse: Sendable, Equatable {
    public let success: Bool
    public let bookmark: ChromeBookmark?
    public let message: String?

    public init(success: Bool, bookmark: ChromeBookmark? = nil, message: String? = nil) {
        self.success = success; self.bookmark = bookmark; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionBookmarkCreateResponse {
        let d = try parseDict(json)
        let b = d["bookmark"] as? [String: Any]
        return ExtensionBookmarkCreateResponse(
            success: (d["success"] as? Bool) ?? false,
            bookmark: b.map { ChromeBookmark.from($0) },
            message: d["message"] as? String
        )
    }
}

// MARK: - History

public struct ChromeHistoryEntry: Sendable, Equatable {
    public let id: String
    public let url: String
    public let title: String?
    public let lastVisitTime: Double?
    public let visitCount: Int?

    public init(id: String, url: String, title: String? = nil,
                lastVisitTime: Double? = nil, visitCount: Int? = nil) {
        self.id = id; self.url = url; self.title = title
        self.lastVisitTime = lastVisitTime; self.visitCount = visitCount
    }

    internal static func from(_ d: [String: Any]) -> ChromeHistoryEntry {
        return ChromeHistoryEntry(
            id: (d["id"] as? String) ?? "",
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            lastVisitTime: d["lastVisitTime"] as? Double,
            visitCount: d["visitCount"] as? Int
        )
    }
}

public struct ExtensionHistoryResponse: Sendable, Equatable {
    public let success: Bool
    public let entries: [ChromeHistoryEntry]

    public init(success: Bool, entries: [ChromeHistoryEntry]) {
        self.success = success; self.entries = entries
    }

    public static func decode(_ json: String) throws -> ExtensionHistoryResponse {
        let d = try parseDict(json)
        let arr = (d["history"] as? [[String: Any]]) ?? (d["entries"] as? [[String: Any]]) ?? []
        return ExtensionHistoryResponse(
            success: (d["success"] as? Bool) ?? false,
            entries: arr.map { ChromeHistoryEntry.from($0) }
        )
    }
}

public struct ExtensionHistoryDeleteResponse: Sendable, Equatable {
    public let success: Bool
    public let deleted: Int?
    public let message: String?

    public init(success: Bool, deleted: Int? = nil, message: String? = nil) {
        self.success = success; self.deleted = deleted; self.message = message
    }

    public static func decode(_ json: String) throws -> ExtensionHistoryDeleteResponse {
        let d = try parseDict(json)
        return ExtensionHistoryDeleteResponse(
            success: (d["success"] as? Bool) ?? false,
            deleted: d["deleted"] as? Int,
            message: d["message"] as? String
        )
    }
}
