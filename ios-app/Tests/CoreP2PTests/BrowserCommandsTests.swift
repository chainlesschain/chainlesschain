import XCTest
@testable import CoreP2P

/// Phase 6.2 — `BrowserCommands` typed wrapper 测试（12 method 桌面子集）。
final class BrowserCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: BrowserCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "br-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: BrowserCommands(client: client), inbound: inbound, transport: transport)
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

    // MARK: - 引擎生命周期

    func testStartWithParamsAndStatus() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.start(pcPeerId: "pc", browserType: "chromium", headless: true)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["browserType"] as? String, "chromium")
        XCTAssertEqual(params["headless"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "message": "Browser started",
            "status": ["running": true, "browserType": "chromium", "tabCount": 1]
        ])
        let r = try await task.value
        XCTAssertEqual(r.status?.tabCount, 1)
        XCTAssertEqual(r.status?.browserType, "chromium")
    }

    func testStopDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.stop(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "message": "Browser stopped"
        ])
        let r = try await task.value
        XCTAssertEqual(r.message, "Browser stopped")
    }

    func testGetStatusDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStatus(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "status": ["running": true, "browserType": "chromium",
                       "tabCount": 3, "contextCount": 1, "uptimeSeconds": 300]
        ])
        let r = try await task.value
        XCTAssertTrue(r.status.running)
        XCTAssertEqual(r.status.tabCount, 3)
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
                ["targetId": "T1", "url": "https://a.com", "title": "A", "active": true],
                ["targetId": "T2", "url": "https://b.com", "title": "B"]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.tabs.count, 2)
        XCTAssertTrue(r.tabs[0].active)
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
        XCTAssertEqual(r.targetId, "T2")
    }

    // MARK: - 导航

    func testOpenUrlEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.openUrl(pcPeerId: "pc", url: "https://example.com", profileName: "work")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["url"] as? String, "https://example.com")
        XCTAssertEqual(params["profileName"] as? String, "work")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "url": "https://example.com",
            "title": "Example Domain", "targetId": "TN", "profileName": "work"
        ])
        let r = try await task.value
        XCTAssertEqual(r.title, "Example Domain")
        XCTAssertEqual(r.profileName, "work")
    }

    func testOpenUrlEmptyUrlThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.openUrl(pcPeerId: "pc", url: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testNavigateEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.navigate(pcPeerId: "pc", targetId: "T1", url: "https://x.com")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "url": "https://x.com", "targetId": "T1"
        ])
        let r = try await task.value
        XCTAssertEqual(r.url, "https://x.com")
    }

    // MARK: - 内容

    func testScreenshotDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.screenshot(
                pcPeerId: "pc", targetId: "T1", format: "jpeg", quality: 80, fullPage: true
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["format"] as? String, "jpeg")
        XCTAssertEqual(params["fullPage"] as? Bool, true)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "data": "/9j/4AA=", "format": "jpeg",
            "width": 1920, "height": 1080
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "jpeg")
        XCTAssertEqual(r.width, 1920)
    }

    func testTakeSnapshotDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.takeSnapshot(pcPeerId: "pc", targetId: "T1", format: "ax")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "snapshotId": "SN1", "format": "ax", "size": 1024
        ])
        let r = try await task.value
        XCTAssertEqual(r.snapshotId, "SN1")
        XCTAssertEqual(r.format, "ax")
    }

    // MARK: - 交互

    func testActEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.act(
                pcPeerId: "pc", targetId: "T1", instruction: "click the login button"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["instruction"] as? String, "click the login button")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "action": "click", "element": "button[type=submit]",
            "result": "clicked"
        ])
        let r = try await task.value
        XCTAssertEqual(r.action, "click")
        XCTAssertEqual(r.result, "clicked")
    }

    func testActEmptyInstructionThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.act(pcPeerId: "pc", targetId: "T1", instruction: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testFindElementDecodes() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.findElement(
                pcPeerId: "pc", targetId: "T1", selector: "button.submit"
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "found": true, "selector": "button.submit",
            "tagName": "BUTTON", "text": "Submit", "count": 1
        ])
        let r = try await task.value
        XCTAssertTrue(r.found)
        XCTAssertEqual(r.tagName, "BUTTON")
        XCTAssertEqual(r.count, 1)
    }

    func testFindElementEmptySelectorThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.findElement(pcPeerId: "pc", targetId: "T1", selector: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }
}
