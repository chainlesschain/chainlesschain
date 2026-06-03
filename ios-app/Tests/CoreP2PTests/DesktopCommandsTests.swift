import XCTest
@testable import CoreP2P

/// Phase 6.6.1 — `DesktopCommands` typed wrapper 测试（7 outer method + 5 sendInput
/// sub-type；25+ test）。
final class DesktopCommandsTests: XCTestCase {

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

    private struct Setup { let cmds: DesktopCommands; let inbound: InboundChannel; let transport: FakeTransport }

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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "dt-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: DesktopCommands(client: client), inbound: inbound, transport: transport)
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

    // MARK: - startSession

    func testStartSessionEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.startSession(
                pcPeerId: "pc", displayId: 0, quality: 75, maxFps: 20
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "desktop.startSession")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["displayId"] as? Int, 0)
        XCTAssertEqual(params["quality"] as? Int, 75)
        XCTAssertEqual(params["maxFps"] as? Int, 20)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "sessionId": "desktop-1700000000000-abc",
            "displayId": 0, "quality": 75, "maxFps": 20,
            "captureInterval": 50, "width": 1920, "height": 1080
        ])
        let r = try await task.value
        XCTAssertEqual(r.sessionId, "desktop-1700000000000-abc")
        XCTAssertEqual(r.captureInterval, 50)
        XCTAssertEqual(r.width, 1920)
    }

    func testStartSessionInvalidQualityThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.startSession(pcPeerId: "pc", quality: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.startSession(pcPeerId: "pc", quality: 101); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testStartSessionInvalidMaxFpsThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.startSession(pcPeerId: "pc", maxFps: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.startSession(pcPeerId: "pc", maxFps: 100); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - stopSession

    func testStopSessionEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.stopSession(pcPeerId: "pc", sessionId: "S1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "sessionId": "S1", "message": "stopped"
        ])
        let r = try await task.value
        XCTAssertEqual(r.sessionId, "S1")
    }

    func testStopSessionEmptyIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.stopSession(pcPeerId: "pc", sessionId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - getFrame

    func testGetFrameDecodesBase64Data() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getFrame(pcPeerId: "pc", sessionId: "S1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "data": "/9j/4AAQ=", "format": "jpeg",
            "width": 1920, "height": 1080, "size": 51234,
            "captureTime": 15, "encodeTime": 8
        ])
        let r = try await task.value
        XCTAssertEqual(r.data, "/9j/4AAQ=")
        XCTAssertEqual(r.format, "jpeg")
        XCTAssertEqual(r.size, 51234)
        XCTAssertEqual(r.captureTimeMs, 15)
    }

    func testGetFramePropagatesRateLimitError() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getFrame(pcPeerId: "pc", sessionId: "S1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try errorResp(s.inbound, reqId: id, msg: "Frame rate limit exceeded. Wait 12ms")
        do {
            _ = try await task.value
            XCTFail()
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertTrue(msg.contains("Frame rate limit"))
        } catch { XCTFail("wrong: \(error)") }
    }

    func testGetFrameEmptySessionIdThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.getFrame(pcPeerId: "pc", sessionId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - getDisplays / switchDisplay / getStats

    func testGetDisplaysDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDisplays(pcPeerId: "pc", sessionId: "S1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "displays": [
                ["id": 0, "primary": true, "width": 1920, "height": 1080],
                ["id": 1, "primary": false, "width": 3840, "height": 2160]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.displays.count, 2)
        XCTAssertTrue(r.displays[0].primary)
        XCTAssertEqual(r.displays[1].width, 3840)
    }

    func testSwitchDisplayEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.switchDisplay(pcPeerId: "pc", sessionId: "S1", displayId: 1)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["displayId"] as? Int, 1)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "sessionId": "S1", "displayId": 1, "message": "switched"
        ])
        let r = try await task.value
        XCTAssertEqual(r.displayId, 1)
    }

    func testSwitchDisplayNegativeIdThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.switchDisplay(pcPeerId: "pc", sessionId: "S1", displayId: -1)
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetStatsDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getStats(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "totalFrames": 1500, "totalBytes": 75_000_000,
            "avgFrameSize": 50_000, "avgCaptureTime": 15, "avgEncodeTime": 8,
            "activeSessions": 1
        ])
        let r = try await task.value
        XCTAssertEqual(r.totalFrames, 1500)
        XCTAssertEqual(r.totalBytes, 75_000_000)
        XCTAssertEqual(r.activeSessions, 1)
    }

    // MARK: - sendInput sub-dispatch (Trap D5 — 5 typed helper 全部 route)

    func testMouseMoveRoutesViaSendInput() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mouseMove(pcPeerId: "pc", sessionId: "S1", x: 500, y: 400)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        // 关键验证：method 是 desktop.sendInput，**不是** desktop.mouseMove
        XCTAssertEqual(p["method"] as? String, "desktop.sendInput")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["sessionId"] as? String, "S1")
        XCTAssertEqual(params["type"] as? String, "mouse_move")
        let data = params["data"] as! [String: Any]
        XCTAssertEqual(data["x"] as? Int, 500)
        XCTAssertEqual(data["y"] as? Int, 400)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        let r = try await task.value
        XCTAssertTrue(r.success)
    }

    func testMouseClickRoutesViaSendInputWithButton() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mouseClick(pcPeerId: "pc", sessionId: "S1",
                                        button: .right, double: false)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "desktop.sendInput")
        let data = (p["params"] as! [String: Any])["data"] as! [String: Any]
        XCTAssertEqual(data["button"] as? String, "right")
        XCTAssertEqual(data["double"] as? Bool, false)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testMouseDoubleClickSetsDoubleTrue() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mouseDoubleClick(pcPeerId: "pc", sessionId: "S1")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let data = ((try payload(s.transport.dcSent[0]))["params"] as! [String: Any])["data"] as! [String: Any]
        XCTAssertEqual(data["double"] as? Bool, true)
        XCTAssertEqual(data["button"] as? String, "left")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testMouseScrollRoutesViaSendInputWithDxDy() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mouseScroll(pcPeerId: "pc", sessionId: "S1", dx: 0, dy: -5)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "desktop.sendInput")
        let data = (p["params"] as! [String: Any])["data"] as! [String: Any]
        XCTAssertEqual(data["dy"] as? Int, -5)
        XCTAssertEqual(data["dx"] as? Int, 0)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testKeyPressRoutesViaSendInputWithModifiers() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.keyPress(
                pcPeerId: "pc", sessionId: "S1",
                key: "c", modifiers: [.ctrl, .shift]
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "desktop.sendInput")
        let data = (p["params"] as! [String: Any])["data"] as! [String: Any]
        XCTAssertEqual(data["key"] as? String, "c")
        XCTAssertEqual(data["modifiers"] as? [String], ["ctrl", "shift"])

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testKeyPressEmptyKeyThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.keyPress(pcPeerId: "pc", sessionId: "S1", key: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testKeyTypeRoutesViaSendInput() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.keyType(pcPeerId: "pc", sessionId: "S1", text: "hello world")
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "desktop.sendInput")
        let data = (p["params"] as! [String: Any])["data"] as! [String: Any]
        XCTAssertEqual(data["text"] as? String, "hello world")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testKeyTypeEmptyTextThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.keyType(pcPeerId: "pc", sessionId: "S1", text: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testAllSubDispatchEmptySessionIdThrows() async {
        let s = await makeSetup()
        // Trap D5 验证：所有 5 helper sessionId 校验
        do { _ = try await s.cmds.mouseMove(pcPeerId: "pc", sessionId: "", x: 0, y: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.mouseClick(pcPeerId: "pc", sessionId: ""); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.mouseScroll(pcPeerId: "pc", sessionId: "", dy: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.keyPress(pcPeerId: "pc", sessionId: "", key: "a"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
        do { _ = try await s.cmds.keyType(pcPeerId: "pc", sessionId: "", text: "x"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 通用 sendInput direct invoke

    func testSendInputDirectInvoke() async throws {
        let s = await makeSetup()
        // 直接调 sendInput 通用入口（caller 也可绕 typed helper）
        let task = Task {
            try await s.cmds.sendInput(
                pcPeerId: "pc", sessionId: "S1",
                type: "custom_type", data: ["foo": "bar"]
            )
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["type"] as? String, "custom_type")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["success": true])
        _ = try await task.value
    }

    func testSendInputEmptyTypeThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.sendInput(
                pcPeerId: "pc", sessionId: "S1", type: "", data: [:]
            )
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - 错误传播

    func testStartSessionRemoteErrorPropagates() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.startSession(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try errorResp(s.inbound, reqId: id, msg: "robotjs not installed")
        do {
            _ = try await task.value
            XCTFail()
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "robotjs not installed")
        } catch { XCTFail("wrong: \(error)") }
    }
}
