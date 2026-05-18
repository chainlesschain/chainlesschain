import Foundation

/// 浏览器自动化 typed RPC wrapper — Phase 6.2 (主屏 batch 1)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/BrowserCommands.kt` 桌面已支持 12 method 子集
/// （桌面 case ⊂ Android 33 method invoke；Android 多 21 method 缺桌面 impl 留 Phase 7+ debt
///  — 含 cookie / form 操作 / element interception / waitForX / generatePdf 等）。
///
/// **与 userBrowser skill 区别**：
/// - `browser` (本): 桌面端 Playwright/Puppeteer 启动 **内置 chromium 实例** 做自动化
/// - `userBrowser` (Phase 6.1B1): 通过 CDP 连接**用户已装** Chrome/Edge/Brave
/// 两者完全独立 — `browser.start` 启的是内置 chromium，与用户浏览器无关。
///
/// **wire 协议**（与桌面 `browser-handler.js` 对齐）：
/// - 引擎生命周期：start / stop / getStatus
/// - 标签页：listTabs / closeTab / focusTab
/// - 导航：openUrl (含新建 tab) / navigate (在已有 tab 内)
/// - 内容：screenshot / takeSnapshot
/// - 交互：act (LLM 自然语言驱动) / findElement
public actor BrowserCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - 引擎生命周期

    public func start(
        pcPeerId: String,
        browserType: String? = nil,    // chromium / firefox / webkit
        headless: Bool? = nil,
        mobileDid: String? = nil
    ) async throws -> BrowserLifecycleResponse {
        var params: [String: Any] = [:]
        if let b = browserType { params["browserType"] = b }
        if let h = headless { params["headless"] = h }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.start",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserLifecycleResponse.decode)
    }

    public func stop(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserLifecycleResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.stop",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserLifecycleResponse.decode)
    }

    public func getStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.getStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserStatusResponse.decode)
    }

    // MARK: - 标签页

    public func listTabs(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserListTabsResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.listTabs",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserListTabsResponse.decode)
    }

    public func closeTab(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserSimpleResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.closeTab: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.closeTab",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserSimpleResponse.decode)
    }

    public func focusTab(
        pcPeerId: String,
        targetId: String,
        mobileDid: String? = nil
    ) async throws -> BrowserSimpleResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.focusTab: targetId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.focusTab",
            params: ["targetId": targetId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserSimpleResponse.decode)
    }

    // MARK: - 导航

    /// 打开新标签页（自动启 browser engine 若未启）。
    public func openUrl(
        pcPeerId: String,
        url: String,
        profileName: String? = nil,
        mobileDid: String? = nil
    ) async throws -> BrowserOpenUrlResponse {
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.openUrl: url empty")
        }
        var params: [String: Any] = ["url": url]
        if let p = profileName { params["profileName"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.openUrl",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserOpenUrlResponse.decode)
    }

    /// 在指定 tab 内导航到新 URL。
    public func navigate(
        pcPeerId: String,
        targetId: String,
        url: String,
        mobileDid: String? = nil
    ) async throws -> BrowserSimpleResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.navigate: targetId empty")
        }
        guard !url.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.navigate: url empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.navigate",
            params: ["targetId": targetId, "url": url],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserSimpleResponse.decode)
    }

    // MARK: - 内容

    public func screenshot(
        pcPeerId: String,
        targetId: String,
        format: String = "png",
        quality: Int? = nil,
        fullPage: Bool = false,
        mobileDid: String? = nil
    ) async throws -> BrowserScreenshotResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.screenshot: targetId empty")
        }
        guard format == "png" || format == "jpeg" || format == "jpg" else {
            throw RemoteSkillError.invalidArgument("browser.screenshot: format must be png/jpeg")
        }
        var params: [String: Any] = [
            "targetId": targetId, "format": format, "fullPage": fullPage
        ]
        if let q = quality {
            guard q >= 1 && q <= 100 else {
                throw RemoteSkillError.invalidArgument("browser.screenshot: quality 1-100")
            }
            params["quality"] = q
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.screenshot",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserScreenshotResponse.decode)
    }

    /// 页面快照（Accessibility tree / DOM snapshot — 适合给 LLM 输入）。
    public func takeSnapshot(
        pcPeerId: String,
        targetId: String,
        format: String? = nil,         // ax / dom / both
        mobileDid: String? = nil
    ) async throws -> BrowserSnapshotResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.takeSnapshot: targetId empty")
        }
        var params: [String: Any] = ["targetId": targetId]
        if let f = format { params["format"] = f }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.takeSnapshot",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserSnapshotResponse.decode)
    }

    // MARK: - 交互

    /// LLM 自然语言驱动浏览器动作（如 "click the login button"，"fill 'foo' in search box"）。
    public func act(
        pcPeerId: String,
        targetId: String,
        instruction: String,
        mobileDid: String? = nil
    ) async throws -> BrowserActResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.act: targetId empty")
        }
        guard !instruction.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.act: instruction empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.act",
            params: ["targetId": targetId, "instruction": instruction],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserActResponse.decode)
    }

    /// 按 selector 查找元素（CSS / XPath）。
    public func findElement(
        pcPeerId: String,
        targetId: String,
        selector: String,
        mobileDid: String? = nil
    ) async throws -> BrowserFindElementResponse {
        guard !targetId.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.findElement: targetId empty")
        }
        guard !selector.isEmpty else {
            throw RemoteSkillError.invalidArgument("browser.findElement: selector empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "browser.findElement",
            params: ["targetId": targetId, "selector": selector],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrowserFindElementResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
