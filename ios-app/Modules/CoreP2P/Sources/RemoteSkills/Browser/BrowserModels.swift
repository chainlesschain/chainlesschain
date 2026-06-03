import Foundation

/// 浏览器引擎状态（Phase 6.2 — Playwright/Puppeteer driven）。
public struct BrowserEngineStatus: Sendable, Equatable {
    public let running: Bool
    public let browserType: String?       // chromium / firefox / webkit
    public let tabCount: Int?
    public let contextCount: Int?
    public let uptimeSeconds: Int?

    public init(running: Bool, browserType: String? = nil, tabCount: Int? = nil,
                contextCount: Int? = nil, uptimeSeconds: Int? = nil) {
        self.running = running; self.browserType = browserType
        self.tabCount = tabCount; self.contextCount = contextCount
        self.uptimeSeconds = uptimeSeconds
    }
}

/// `browser.getStatus` 响应。
public struct BrowserStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let status: BrowserEngineStatus

    public init(success: Bool, status: BrowserEngineStatus) {
        self.success = success; self.status = status
    }

    public static func decode(_ json: String) throws -> BrowserStatusResponse {
        let d = try parseDict(json)
        let s = (d["status"] as? [String: Any]) ?? d
        return BrowserStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            status: BrowserEngineStatus(
                running: (s["running"] as? Bool) ?? false,
                browserType: s["browserType"] as? String,
                tabCount: s["tabCount"] as? Int,
                contextCount: s["contextCount"] as? Int,
                uptimeSeconds: s["uptimeSeconds"] as? Int
            )
        )
    }
}

/// `browser.start` / `stop` 响应（通用 message + status）。
public struct BrowserLifecycleResponse: Sendable, Equatable {
    public let success: Bool
    public let message: String
    public let status: BrowserEngineStatus?

    public init(success: Bool, message: String, status: BrowserEngineStatus? = nil) {
        self.success = success; self.message = message; self.status = status
    }

    public static func decode(_ json: String) throws -> BrowserLifecycleResponse {
        let d = try parseDict(json)
        let s = (d["status"] as? [String: Any])
        return BrowserLifecycleResponse(
            success: (d["success"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? "",
            status: s.map { dict in
                BrowserEngineStatus(
                    running: (dict["running"] as? Bool) ?? false,
                    browserType: dict["browserType"] as? String,
                    tabCount: dict["tabCount"] as? Int,
                    contextCount: dict["contextCount"] as? Int,
                    uptimeSeconds: dict["uptimeSeconds"] as? Int
                )
            }
        )
    }
}

/// `browser.openUrl` 响应。
public struct BrowserOpenUrlResponse: Sendable, Equatable {
    public let success: Bool
    public let url: String
    public let title: String?
    public let targetId: String?
    public let profileName: String?

    public init(success: Bool, url: String, title: String? = nil,
                targetId: String? = nil, profileName: String? = nil) {
        self.success = success; self.url = url; self.title = title
        self.targetId = targetId; self.profileName = profileName
    }

    public static func decode(_ json: String) throws -> BrowserOpenUrlResponse {
        let d = try parseDict(json)
        return BrowserOpenUrlResponse(
            success: (d["success"] as? Bool) ?? false,
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            targetId: d["targetId"] as? String,
            profileName: d["profileName"] as? String
        )
    }
}

/// 通用 `browser.navigate` / `closeTab` / `focusTab` 响应。
public struct BrowserSimpleResponse: Sendable, Equatable {
    public let success: Bool
    public let url: String?
    public let targetId: String?
    public let message: String?

    public init(success: Bool, url: String? = nil, targetId: String? = nil, message: String? = nil) {
        self.success = success; self.url = url
        self.targetId = targetId; self.message = message
    }

    public static func decode(_ json: String) throws -> BrowserSimpleResponse {
        let d = try parseDict(json)
        return BrowserSimpleResponse(
            success: (d["success"] as? Bool) ?? false,
            url: d["url"] as? String,
            targetId: d["targetId"] as? String,
            message: d["message"] as? String
        )
    }
}

/// 浏览器 tab 信息（区别于 Phase 6.1B1 UserBrowserTab — browser skill 走 Playwright/
/// Puppeteer 控制内置 chromium，UserBrowserTab 走 CDP 直连用户已装 Chrome）。
public struct BrowserTab: Sendable, Equatable {
    public let targetId: String
    public let url: String
    public let title: String?
    public let active: Bool

    public init(targetId: String, url: String, title: String? = nil, active: Bool = false) {
        self.targetId = targetId; self.url = url; self.title = title; self.active = active
    }

    internal static func from(_ d: [String: Any]) -> BrowserTab {
        return BrowserTab(
            targetId: (d["targetId"] as? String) ?? "",
            url: (d["url"] as? String) ?? "",
            title: d["title"] as? String,
            active: (d["active"] as? Bool) ?? false
        )
    }
}

/// `browser.listTabs` 响应。
public struct BrowserListTabsResponse: Sendable, Equatable {
    public let success: Bool
    public let tabs: [BrowserTab]
    public let total: Int

    public init(success: Bool, tabs: [BrowserTab], total: Int) {
        self.success = success; self.tabs = tabs; self.total = total
    }

    public static func decode(_ json: String) throws -> BrowserListTabsResponse {
        let d = try parseDict(json)
        let arr = (d["tabs"] as? [[String: Any]]) ?? []
        return BrowserListTabsResponse(
            success: (d["success"] as? Bool) ?? false,
            tabs: arr.map { BrowserTab.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `browser.screenshot` 响应。
public struct BrowserScreenshotResponse: Sendable, Equatable {
    public let success: Bool
    public let data: String              // base64
    public let format: String            // png / jpeg
    public let width: Int?
    public let height: Int?

    public init(success: Bool, data: String, format: String,
                width: Int? = nil, height: Int? = nil) {
        self.success = success; self.data = data; self.format = format
        self.width = width; self.height = height
    }

    public static func decode(_ json: String) throws -> BrowserScreenshotResponse {
        let d = try parseDict(json)
        return BrowserScreenshotResponse(
            success: (d["success"] as? Bool) ?? false,
            data: (d["data"] as? String) ?? "",
            format: (d["format"] as? String) ?? "png",
            width: d["width"] as? Int,
            height: d["height"] as? Int
        )
    }
}

/// `browser.act` 响应（用 LLM 自然语言驱动浏览器动作，如 "click login button"）。
public struct BrowserActResponse: Sendable, Equatable {
    public let success: Bool
    public let action: String?
    public let element: String?
    public let result: String?
    public let error: String?

    public init(success: Bool, action: String? = nil, element: String? = nil,
                result: String? = nil, error: String? = nil) {
        self.success = success; self.action = action
        self.element = element; self.result = result; self.error = error
    }

    public static func decode(_ json: String) throws -> BrowserActResponse {
        let d = try parseDict(json)
        return BrowserActResponse(
            success: (d["success"] as? Bool) ?? false,
            action: d["action"] as? String,
            element: d["element"] as? String,
            result: d["result"] as? String,
            error: d["error"] as? String
        )
    }
}

/// `browser.findElement` 响应。
public struct BrowserFindElementResponse: Sendable, Equatable {
    public let success: Bool
    public let found: Bool
    public let selector: String?
    public let tagName: String?
    public let text: String?
    public let count: Int

    public init(success: Bool, found: Bool, selector: String? = nil,
                tagName: String? = nil, text: String? = nil, count: Int = 0) {
        self.success = success; self.found = found; self.selector = selector
        self.tagName = tagName; self.text = text; self.count = count
    }

    public static func decode(_ json: String) throws -> BrowserFindElementResponse {
        let d = try parseDict(json)
        return BrowserFindElementResponse(
            success: (d["success"] as? Bool) ?? false,
            found: (d["found"] as? Bool) ?? false,
            selector: d["selector"] as? String,
            tagName: d["tagName"] as? String,
            text: d["text"] as? String,
            count: (d["count"] as? Int) ?? 0
        )
    }
}

/// `browser.takeSnapshot` 响应（页面快照 — Accessibility tree / DOM snapshot）。
public struct BrowserSnapshotResponse: Sendable, Equatable {
    public let success: Bool
    public let snapshotId: String?
    public let format: String?
    public let size: Int?
    public let path: String?
    public let data: String?              // 可能 inline 也可能 path

    public init(success: Bool, snapshotId: String? = nil, format: String? = nil,
                size: Int? = nil, path: String? = nil, data: String? = nil) {
        self.success = success; self.snapshotId = snapshotId
        self.format = format; self.size = size; self.path = path; self.data = data
    }

    public static func decode(_ json: String) throws -> BrowserSnapshotResponse {
        let d = try parseDict(json)
        return BrowserSnapshotResponse(
            success: (d["success"] as? Bool) ?? false,
            snapshotId: d["snapshotId"] as? String,
            format: d["format"] as? String,
            size: d["size"] as? Int,
            path: d["path"] as? String,
            data: d["data"] as? String
        )
    }
}
