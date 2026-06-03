import XCTest
@testable import CoreP2P

/// Phase 6.1B1 — `InputCommands` typed wrapper 测试。
///
/// 覆盖 10 method × (1 happy path envelope + decode + 1 error path) = 20+ test。
final class InputCommandsTests: XCTestCase {

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
        let cmds: InputCommands
        let client: RemoteCommandClient
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "input-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let cmds = InputCommands(client: client)
        return Setup(cmds: cmds, client: client, inbound: inbound, transport: transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func payloadFrom(_ json: String) throws -> [String: Any] {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        return dict["payload"] as! [String: Any]
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    private func errorRaw(reqId: String, message: String) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": message]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    // MARK: - sendKeyPress

    func testSendKeyPressEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.sendKeyPress(pcPeerId: "pc", key: "enter") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.sendKeyPress")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["key"] as? String, "enter")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "key": "enter", "message": "Key \"enter\" sent"
        ]))
        let resp = try await task.value
        XCTAssertTrue(resp.success)
        XCTAssertEqual(resp.key, "enter")
    }

    func testSendKeyPressEmptyKeyThrowsInvalidArgument() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.sendKeyPress(pcPeerId: "pc", key: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch { XCTFail("wrong: \(error)") }
    }

    func testSendKeyPressRemoteErrorPropagates() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.sendKeyPress(pcPeerId: "pc", key: "f1") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try errorRaw(reqId: id, message: "Keyboard input is disabled"))
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "Keyboard input is disabled")
        } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - sendKeyCombo

    func testSendKeyComboWithModifiersEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.sendKeyCombo(pcPeerId: "pc", key: "c", modifiers: [.ctrl, .shift])
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.sendKeyCombo")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["key"] as? String, "c")
        XCTAssertEqual(params["modifiers"] as? [String], ["ctrl", "shift"])

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "key": "c", "modifiers": ["ctrl", "shift"], "message": "ok"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.modifiers, ["ctrl", "shift"])
    }

    func testSendKeyComboEmptyKeyThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.sendKeyCombo(pcPeerId: "pc", key: "", modifiers: [.ctrl])
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - typeText

    func testTypeTextEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.typeText(pcPeerId: "pc", text: "hello", delay: 30) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.typeText")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["text"] as? String, "hello")
        XCTAssertEqual(params["delay"] as? Int, 30)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "length": 5, "delay": 30, "message": "typed"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.length, 5)
        XCTAssertEqual(resp.delay, 30)
    }

    func testTypeTextEmptyThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.typeText(pcPeerId: "pc", text: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testTypeTextNegativeDelayThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.typeText(pcPeerId: "pc", text: "x", delay: -1)
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - mouseMove

    func testMouseMoveAbsoluteEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseMove(pcPeerId: "pc", x: 100, y: 200) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.mouseMove")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["x"] as? Int, 100)
        XCTAssertEqual(params["y"] as? Int, 200)
        XCTAssertEqual(params["relative"] as? Bool, false)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "x": 100, "y": 200, "relative": false, "message": "moved"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.x, 100)
        XCTAssertEqual(resp.y, 200)
    }

    func testMouseMoveRelativeEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseMove(pcPeerId: "pc", x: 5, y: -3, relative: true) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payloadFrom(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["relative"] as? Bool, true)
        XCTAssertEqual(params["x"] as? Int, 5)
        XCTAssertEqual(params["y"] as? Int, -3)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "x": 5, "y": -3, "relative": true, "message": "moved"
        ]))
        let resp = try await task.value
        XCTAssertTrue(resp.relative)
    }

    // MARK: - mouseClick / mouseDoubleClick

    func testMouseClickWithoutCoordsEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseClick(pcPeerId: "pc", button: .right) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payloadFrom(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["button"] as? String, "right")
        XCTAssertNil(params["x"])
        XCTAssertNil(params["y"])

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "button": "right", "message": "clicked"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.button, "right")
        XCTAssertNil(resp.x)
    }

    func testMouseClickWithCoordsEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseClick(pcPeerId: "pc", button: .left, x: 50, y: 60) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payloadFrom(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["x"] as? Int, 50)
        XCTAssertEqual(params["y"] as? Int, 60)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "button": "left", "x": 50, "y": 60, "message": "clicked"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.x, 50)
        XCTAssertEqual(resp.y, 60)
    }

    func testMouseDoubleClickRoutesToDoubleClickMethod() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseDoubleClick(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.mouseDoubleClick")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "button": "left", "message": "double-clicked"
        ]))
        let resp = try await task.value
        XCTAssertTrue(resp.success)
    }

    // MARK: - mouseDrag

    func testMouseDragEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mouseDrag(pcPeerId: "pc", startX: 10, startY: 20, endX: 100, endY: 200)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payloadFrom(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["startX"] as? Int, 10)
        XCTAssertEqual(params["startY"] as? Int, 20)
        XCTAssertEqual(params["endX"] as? Int, 100)
        XCTAssertEqual(params["endY"] as? Int, 200)
        XCTAssertEqual(params["button"] as? String, "left")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "startX": 10, "startY": 20, "endX": 100, "endY": 200, "message": "drag"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.endX, 100)
        XCTAssertEqual(resp.endY, 200)
    }

    // MARK: - mouseScroll

    func testMouseScrollEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.mouseScroll(pcPeerId: "pc", direction: .up, amount: 5) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payloadFrom(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["direction"] as? String, "up")
        XCTAssertEqual(params["amount"] as? Int, 5)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "direction": "up", "amount": 5, "message": "scrolled"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.direction, "up")
        XCTAssertEqual(resp.amount, 5)
    }

    func testMouseScrollZeroAmountThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.mouseScroll(pcPeerId: "pc", amount: 0)
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - getCursorPosition / getKeyboardLayout

    func testGetCursorPositionDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getCursorPosition(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.getCursorPosition")
        let params = payload["params"] as! [String: Any]
        XCTAssertTrue(params.isEmpty)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "x": 800, "y": 600
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.x, 800)
        XCTAssertEqual(resp.y, 600)
    }

    func testGetKeyboardLayoutDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getKeyboardLayout(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "layout": "US", "platform": "darwin"
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.layout, "US")
        XCTAssertEqual(resp.platform, "darwin")
        XCTAssertNil(resp.error)
    }

    func testGetKeyboardLayoutWithErrorField() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getKeyboardLayout(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": false, "layout": "", "platform": "linux", "error": "xkb not installed"
        ]))
        let resp = try await task.value
        XCTAssertFalse(resp.success)
        XCTAssertEqual(resp.error, "xkb not installed")
    }

    // MARK: - 便捷快捷键

    func testCopyShortcutSendsCtrlC() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.copy(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let payload = try payloadFrom(s.transport.dcSent[0])
        XCTAssertEqual(payload["method"] as? String, "input.sendKeyCombo")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["key"] as? String, "c")
        XCTAssertEqual(params["modifiers"] as? [String], ["ctrl"])

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "success": true, "key": "c", "modifiers": ["ctrl"], "message": "ok"
        ]))
        _ = try await task.value
    }

    func testPasteSavedSelectAllUndoShortcuts() async throws {
        let s = await makeSetup()
        for (action, expectKey): (() async throws -> KeyComboResponse, String) in [
            ({ try await s.cmds.paste(pcPeerId: "pc") }, "v"),
            ({ try await s.cmds.save(pcPeerId: "pc") }, "s"),
            ({ try await s.cmds.selectAll(pcPeerId: "pc") }, "a"),
            ({ try await s.cmds.undo(pcPeerId: "pc") }, "z"),
        ] {
            let before = s.transport.dcSent.count
            let task = Task { try await action() }
            try await Task.sleep(nanoseconds: 50_000_000)
            let payload = try payloadFrom(s.transport.dcSent[before])
            let params = payload["params"] as! [String: Any]
            XCTAssertEqual(params["key"] as? String, expectKey)

            let id = try reqIdFrom(s.transport.dcSent[before])
            s.inbound.send(try responseRaw(reqId: id, result: [
                "success": true, "key": expectKey, "modifiers": ["ctrl"], "message": "ok"
            ]))
            _ = try await task.value
        }
    }
}
