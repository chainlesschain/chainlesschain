import XCTest
@testable import CoreP2P

/// Phase 6.7.1 — `ExtensionCommands` typed wrapper 测试（30 method 5 桶）。
final class ExtensionCommandsTests: XCTestCase {

    private final class InboundChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock(); var dcSent: [String] = []; var dcReady: Bool = true
    }

    private struct Setup { let cmds: ExtensionCommands; let inbound: InboundChannel; let transport: FakeTransport }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock(); transport.dcSent.append(text); transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "ext-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: ExtensionCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqId(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func payload(_ json: String) throws -> [String: Any] {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return d["payload"] as! [String: Any]
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = ["type": "chainlesschain:command:response",
                                  "payload": ["id": reqId, "result": result]]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    private func errorResp(_ inbound: InboundChannel, reqId: String, msg: String) throws {
        let env: [String: Any] = ["type": "chainlesschain:command:response",
                                  "payload": ["id": reqId, "error": msg]]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    // MARK: - Tabs & navigation (10)

    func testListTabsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listTabs(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try payload(s.transport.dcSent[0])["method"] as? String, "extension.listTabs")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "tabs": [
                ["id": 100, "url": "https://a.com", "title": "A", "active": true, "pinned": false],
                ["id": 200, "url": "https://b.com", "title": "B"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tabs.count, 2)
        XCTAssertTrue(r.tabs[0].active)
    }

    func testGetTabDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getTab(pcPeerId: "pc", tabId: 100) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["tabId"] as? Int, 100)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "tab": ["id": 100, "url": "https://a.com", "title": "A"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tab?.id, 100)
    }

    func testCreateTabEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.createTab(pcPeerId: "pc", url: "https://new.com", active: false)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["url"] as? String, "https://new.com")
        XCTAssertEqual(params["active"] as? Bool, false)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "tab": ["id": 300, "url": "https://new.com"]
        ])
        _ = try await task.value
    }

    func testCloseTabFocusTabRouted() async throws {
        let s = await makeSetup()
        for (idx, action) in [
            ("extension.closeTab", { try await s.cmds.closeTab(pcPeerId: "pc", tabId: 100) }),
            ("extension.focusTab", { try await s.cmds.focusTab(pcPeerId: "pc", tabId: 100) })
        ].enumerated() {
            let (expectMethod, fn) = action
            let task = Task { try await fn() }
            try await Task.sleep(nanoseconds: 50_000_000)
            XCTAssertEqual(try payload(s.transport.dcSent[idx])["method"] as? String, expectMethod)
            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: ["success": true, "tabId": 100])
            _ = try await task.value
        }
    }

    func testNavigateValidatesUrl() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.navigate(pcPeerId: "pc", tabId: 100, url: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testNavigateEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.navigate(pcPeerId: "pc", tabId: 100, url: "https://x.com")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["url"] as? String, "https://x.com")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "tabId": 100, "url": "https://x.com"
        ])
        _ = try await task.value
    }

    func testReloadWithBypassCache() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.reload(pcPeerId: "pc", tabId: 100, bypassCache: true)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["bypassCache"] as? Bool, true)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true, "tabId": 100])
        _ = try await task.value
    }

    func testGoBackForwardRouted() async throws {
        let s = await makeSetup()
        for (idx, action) in [
            ("extension.goBack", { try await s.cmds.goBack(pcPeerId: "pc", tabId: 100) }),
            ("extension.goForward", { try await s.cmds.goForward(pcPeerId: "pc", tabId: 100) })
        ].enumerated() {
            let (expectMethod, fn) = action
            let task = Task { try await fn() }
            try await Task.sleep(nanoseconds: 50_000_000)
            XCTAssertEqual(try payload(s.transport.dcSent[idx])["method"] as? String, expectMethod)
            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: ["success": true, "tabId": 100])
            _ = try await task.value
        }
    }

    func testCanNavigateBackDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.canNavigateBack(pcPeerId: "pc", tabId: 100) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true, "canNavigate": true])
        let r = try await task.value
        XCTAssertTrue(r.canNavigate)
    }

    // MARK: - Screenshot & DOM (5)

    func testCaptureScreenshotDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.captureScreenshot(pcPeerId: "pc", tabId: 100, quality: 80)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["quality"] as? Int, 80)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "dataUrl": "data:image/png;base64,iVBORw0KGgo=",
            "format": "png", "width": 1024, "height": 768
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "png")
        XCTAssertEqual(r.width, 1024)
    }

    func testCaptureScreenshotInvalidFormat() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.captureScreenshot(pcPeerId: "pc", tabId: 100, format: "bmp")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCaptureFullPageScreenshot() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.captureFullPageScreenshot(pcPeerId: "pc", tabId: 100)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try payload(s.transport.dcSent[0])["method"] as? String,
                       "extension.captureFullPageScreenshot")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "dataUrl": "/9j/4AA=", "format": "png"
        ])
        _ = try await task.value
    }

    func testCaptureElementScreenshotEmptySelectorThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.captureElementScreenshot(
                pcPeerId: "pc", tabId: 100, selector: ""
            )
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testExecuteScriptDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.executeScript(
                pcPeerId: "pc", tabId: 100, script: "document.title"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "result": "Hello World"
        ])
        let r = try await task.value
        XCTAssertEqual(r.result, "Hello World")
    }

    func testExecuteScriptComplexResultSerializes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.executeScript(pcPeerId: "pc", tabId: 100, script: "1+1")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        // result 是 number, 不是 string — 应被 JSON 序列化为 "2"
        try respond(s.inbound, reqId: id, result: ["success": true, "result": 2])
        let r = try await task.value
        XCTAssertEqual(r.result, "2")
    }

    func testGetPageContentDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getPageContent(pcPeerId: "pc", tabId: 100, format: "text")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "content": "Hello", "format": "text", "length": 5
        ])
        let r = try await task.value
        XCTAssertEqual(r.content, "Hello")
        XCTAssertEqual(r.length, 5)
    }

    // MARK: - Cookies (5)

    func testGetCookiesDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getCookies(pcPeerId: "pc", url: "https://a.com") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "cookies": [
                ["name": "session", "value": "abc123", "domain": "a.com",
                 "secure": true, "httpOnly": true]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.cookies.count, 1)
        XCTAssertEqual(r.cookies[0].name, "session")
        XCTAssertTrue(r.cookies[0].secure)
    }

    func testGetCookieEmptyUrlThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getCookie(pcPeerId: "pc", url: "", name: "x"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testSetCookieEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.setCookie(
                pcPeerId: "pc", url: "https://a.com", name: "k", value: "v",
                domain: "a.com", secure: true
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["url"] as? String, "https://a.com")
        XCTAssertEqual(params["secure"] as? Bool, true)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "cookie": ["name": "k", "value": "v", "domain": "a.com", "secure": true]
        ])
        let r = try await task.value
        XCTAssertEqual(r.cookie?.name, "k")
    }

    func testRemoveAndClearCookies() async throws {
        let s = await makeSetup()
        let t1 = Task { try await s.cmds.removeCookie(pcPeerId: "pc", url: "https://a.com", name: "k") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id1, result: ["success": true])
        _ = try await t1.value

        let t2 = Task { try await s.cmds.clearCookies(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqId(s.transport.dcSent[1])
        try respond(s.inbound, reqId: id2, result: ["success": true])
        _ = try await t2.value
    }

    // MARK: - Storage (5)

    func testClearLocalAndSessionStorage() async throws {
        let s = await makeSetup()
        let t1 = Task { try await s.cmds.clearLocalStorage(pcPeerId: "pc", tabId: 100) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id1, result: ["success": true])
        _ = try await t1.value

        let t2 = Task { try await s.cmds.clearSessionStorage(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqId(s.transport.dcSent[1])
        try respond(s.inbound, reqId: id2, result: ["success": true])
        _ = try await t2.value
    }

    func testClearIndexedDBEmptyDbNameThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.clearIndexedDBStore(pcPeerId: "pc", dbName: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testClearBrowsingDataEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.clearBrowsingData(
                pcPeerId: "pc", since: 1700000000,
                dataTypes: ["cache", "cookies"]
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["dataTypes"] as? [String], ["cache", "cookies"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true, "cleared": true])
        _ = try await task.value
    }

    func testGetStorageQuotaDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStorageQuota(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "usage": 50_000_000, "quota": 1_000_000_000
        ])
        let r = try await task.value
        XCTAssertEqual(r.usage, 50_000_000)
        XCTAssertEqual(r.quota, 1_000_000_000)
    }

    // MARK: - Bookmarks + History (5)

    func testGetBookmarksDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getBookmarks(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "bookmarks": [
                ["id": "1", "title": "Anthropic", "url": "https://anthropic.com"],
                ["id": "2", "title": "Folder", "parentId": "0"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.bookmarks.count, 2)
        XCTAssertEqual(r.bookmarks[0].url, "https://anthropic.com")
        XCTAssertNil(r.bookmarks[1].url)
    }

    func testSearchBookmarksEmptyQueryThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.searchBookmarks(pcPeerId: "pc", query: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCreateBookmarkValidates() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.createBookmark(pcPeerId: "pc", title: "", url: "https://x.com")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do {
            _ = try await s.cmds.createBookmark(pcPeerId: "pc", title: "X", url: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCreateBookmarkEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.createBookmark(
                pcPeerId: "pc", title: "Anthropic", url: "https://anthropic.com"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "bookmark": ["id": "100", "title": "Anthropic", "url": "https://anthropic.com"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.bookmark?.id, "100")
    }

    func testGetHistoryWithFilters() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getHistory(
                pcPeerId: "pc", query: "github", maxResults: 50,
                startTime: 1700000000, endTime: 1700100000
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["query"] as? String, "github")
        XCTAssertEqual(params["maxResults"] as? Int, 50)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "history": [
                ["id": "h1", "url": "https://github.com", "title": "GitHub",
                 "lastVisitTime": 1700050000, "visitCount": 10]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries.count, 1)
    }

    func testGetHistoryFallbackToEntriesKey() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getHistory(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        // 桌面端可能返 "entries" 而非 "history" — decode fallback
        try respond(s.inbound, reqId: id, result: [
            "success": true, "entries": [["id": "x", "url": "https://x.com"]]
        ])
        let r = try await task.value
        XCTAssertEqual(r.entries.count, 1)
    }

    func testDeleteHistoryEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.deleteHistory(pcPeerId: "pc", url: "https://a.com")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "deleted": 5, "message": "deleted"
        ])
        let r = try await task.value
        XCTAssertEqual(r.deleted, 5)
    }

    // MARK: - 错误特征 message (Trap E2)

    func testNotConnectedErrorMessageContainsHint() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listTabs(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try errorResp(s.inbound, reqId: id,
                      msg: "No browser extension connected. Please install...")
        do {
            _ = try await task.value
            XCTFail()
        } catch RemoteSkillError.remoteError(_, let msg) {
            // UI 端依此检测显引导 banner
            XCTAssertTrue(msg.contains(ExtensionCommands.extensionNotConnectedHint))
        } catch { XCTFail("wrong: \(error)") }
    }
}
