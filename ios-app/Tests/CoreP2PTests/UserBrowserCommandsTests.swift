import XCTest
@testable import CoreP2P

/// Phase 6.1B1 — `UserBrowserCommands` (CDP) typed wrapper 测试（18 method, 25 test）。
final class UserBrowserCommandsTests: XCTestCase {

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
        let lock = NSLock()
        var dcSent: [String] = []
        var dcReady: Bool = true
    }

    private struct Setup {
        let cmds: UserBrowserCommands
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "ub-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: UserBrowserCommands(client: client), inbound: inbound, transport: transport)
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
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    // MARK: - 连接

    func testFindBrowsersDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.findBrowsers(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "browsers": [
                ["type": "chrome", "name": "Google Chrome",
                 "executablePath": "/Applications/Google Chrome.app",
                 "defaultPort": 9222],
                ["type": "edge", "name": "Microsoft Edge",
                 "executablePath": "/Applications/Microsoft Edge.app",
                 "defaultPort": 9223, "userDataDir": "/Users/me/Edge"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.browsers.count, 2)
        XCTAssertEqual(r.browsers[0].type, "chrome")
        XCTAssertEqual(r.browsers[1].userDataDir, "/Users/me/Edge")
    }

    func testConnectEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.connect(pcPeerId: "pc", browserType: "edge", port: 9223)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["browserType"] as? String, "edge")
        XCTAssertEqual(params["port"] as? Int, 9223)
        XCTAssertEqual(params["autoLaunch"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "browserType": "edge", "debugPort": 9223,
            "wsEndpoint": "ws://localhost:9223/devtools/browser"
        ])
        let r = try await task.value
        XCTAssertEqual(r.browserType, "edge")
        XCTAssertEqual(r.wsEndpoint, "ws://localhost:9223/devtools/browser")
    }

    func testConnectEmptyBrowserTypeThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.connect(pcPeerId: "pc", browserType: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testDisconnectAndStatusDecodes() async throws {
        let s = await makeSetup()
        let t1 = Task { try await s.cmds.disconnect(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id1, result: ["success": true, "message": "ok"])
        _ = try await t1.value

        let t2 = Task { try await s.cmds.getStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqId(s.transport.dcSent[1])
        try respond(s.inbound, reqId: id2, result: [
            "success": true, "connected": true,
            "browserType": "chrome", "debugPort": 9222,
            "tabCount": 5, "commandCount": 42
        ])
        let r2 = try await t2.value
        XCTAssertTrue(r2.connected)
        XCTAssertEqual(r2.tabCount, 5)
        XCTAssertEqual(r2.commandCount, 42)
    }

    // MARK: - 标签页

    func testListTabsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.listTabs(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "tabs": [
                ["targetId": "T1", "url": "https://a.com", "title": "A",
                 "type": "page", "active": true, "attached": true],
                ["targetId": "T2", "url": "https://b.com", "type": "page"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tabs.count, 2)
        XCTAssertTrue(r.tabs[0].active)
        XCTAssertEqual(r.tabs[1].url, "https://b.com")
    }

    func testGetActiveTabDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getActiveTab(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "tab": ["targetId": "T1", "url": "https://a.com", "title": "A", "type": "page"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tab?.targetId, "T1")
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
            "success": true,
            "tab": ["targetId": "TN", "url": "https://new.com", "type": "page"]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tab?.targetId, "TN")
    }

    func testCloseTabEmptyTargetIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.closeTab(pcPeerId: "pc", targetId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCloseTabEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.closeTab(pcPeerId: "pc", targetId: "T1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "targetId": "T1", "message": "closed"
        ])
        let r = try await task.value
        XCTAssertEqual(r.targetId, "T1")
    }

    func testFocusTabDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.focusTab(pcPeerId: "pc", targetId: "T2") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "targetId": "T2", "message": "focused"
        ])
        let r = try await task.value
        XCTAssertTrue(r.success)
    }

    // MARK: - 导航

    func testNavigateEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.navigate(pcPeerId: "pc", targetId: "T1", url: "https://x.com")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["targetId"] as? String, "T1")
        XCTAssertEqual(params["url"] as? String, "https://x.com")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "targetId": "T1", "url": "https://x.com",
            "frameId": "F1"
        ])
        let r = try await task.value
        XCTAssertEqual(r.frameId, "F1")
    }

    func testNavigateEmptyUrlThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.navigate(pcPeerId: "pc", targetId: "T1", url: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGoBackForwardRefreshAllRouted() async throws {
        let s = await makeSetup()
        for (idx, action) in [
            ("userBrowser.goBack", { try await s.cmds.goBack(pcPeerId: "pc", targetId: "T1") }),
            ("userBrowser.goForward", { try await s.cmds.goForward(pcPeerId: "pc", targetId: "T1") }),
            ("userBrowser.refresh", { try await s.cmds.refresh(pcPeerId: "pc", targetId: "T1") }),
        ].enumerated() {
            let (expectMethod, fn) = action
            let task = Task { try await fn() }
            try await Task.sleep(nanoseconds: 50_000_000)
            let p = try payload(s.transport.dcSent[idx])
            XCTAssertEqual(p["method"] as? String, expectMethod)
            let id = try reqId(s.transport.dcSent[idx])
            try respond(s.inbound, reqId: id, result: ["success": true, "targetId": "T1"])
            _ = try await task.value
        }
    }

    func testRefreshIgnoreCache() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.refresh(pcPeerId: "pc", targetId: "T1", ignoreCache: true)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["ignoreCache"] as? Bool, true)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true, "targetId": "T1"])
        _ = try await task.value
    }

    // MARK: - 页面操作

    func testExecuteScriptEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.executeScript(pcPeerId: "pc", targetId: "T1", script: "1+1")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["script"] as? String, "1+1")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "result": 2, "type": "number"
        ])
        let r = try await task.value
        XCTAssertEqual(r.type, "number")
        // result 字段被序列化为 JSON 字符串
        XCTAssertEqual(r.result, "2")
    }

    func testExecuteScriptEmptyScriptThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.executeScript(pcPeerId: "pc", targetId: "T1", script: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetPageContentDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPageContent(pcPeerId: "pc", targetId: "T1", format: "text") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "content": "Hello", "format": "text",
            "url": "https://a.com", "title": "A", "length": 5
        ])
        let r = try await task.value
        XCTAssertEqual(r.content, "Hello")
        XCTAssertEqual(r.length, 5)
    }

    func testGetPageContentInvalidFormatThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.getPageContent(pcPeerId: "pc", targetId: "T1", format: "xml")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testTabScreenshotEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.screenshot(pcPeerId: "pc", targetId: "T1",
                                        format: "jpeg", quality: 80, fullPage: true)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["quality"] as? Int, 80)
        XCTAssertEqual(params["fullPage"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "data": "/9j/4AAQSk=", "format": "jpeg",
            "width": 1280, "height": 720, "size": 50000
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "jpeg")
        XCTAssertEqual(r.width, 1280)
    }

    func testTabScreenshotQualityRangeThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.screenshot(pcPeerId: "pc", targetId: "T1", quality: 200)
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 用户数据

    func testGetBookmarksDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getBookmarks(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "bookmarks": [
                ["id": "B1", "title": "Anthropic", "url": "https://anthropic.com",
                 "type": "bookmark", "dateAdded": 1700000000000],
                ["id": "B2", "title": "Work", "type": "folder", "parentId": "B0"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.bookmarks.count, 2)
        XCTAssertEqual(r.bookmarks[0].url, "https://anthropic.com")
        XCTAssertEqual(r.bookmarks[1].type, "folder")
    }

    func testGetHistoryWithQueryAndRange() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getHistory(
                pcPeerId: "pc", query: "github",
                maxResults: 50,
                startTime: 1_700_000_000_000, endTime: 1_700_100_000_000
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["query"] as? String, "github")
        XCTAssertEqual(params["maxResults"] as? Int, 50)
        XCTAssertEqual(params["startTime"] as? Int64, 1_700_000_000_000)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 1,
            "items": [
                ["id": "H1", "url": "https://github.com", "title": "GitHub",
                 "lastVisitTime": 1_700_050_000_000, "visitCount": 100, "typedCount": 10]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0].url, "https://github.com")
        XCTAssertEqual(r.items[0].lastVisitTime, 1_700_050_000_000)
        XCTAssertEqual(r.items[0].visitCount, 100)
    }

    func testGetHistoryZeroMaxResultsThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getHistory(pcPeerId: "pc", maxResults: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }
}
