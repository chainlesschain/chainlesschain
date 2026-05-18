import XCTest
@testable import CoreP2P

/// Phase 6.1B1 — `DisplayCommands` typed wrapper 测试（11 method）。
final class DisplayCommandsTests: XCTestCase {

    // MARK: - Helpers (shared with other Phase 6.1B1 tests)

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
        let cmds: DisplayCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "disp-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: DisplayCommands(client: client), inbound: inbound, transport: transport)
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
        let s = String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
        inbound.send(s)
    }

    // MARK: - getDisplays

    func testGetDisplaysDecodesList() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDisplays(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(try payload(s.transport.dcSent[0])["method"] as? String, "display.getDisplays")

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "displays": [
                [
                    "id": 0, "label": "Built-in Retina",
                    "bounds": ["x": 0, "y": 0, "width": 2560, "height": 1440],
                    "workArea": ["x": 0, "y": 24, "width": 2560, "height": 1416],
                    "size": ["width": 2560, "height": 1440],
                    "scaleFactor": 2.0, "rotation": 0, "internal": true
                ],
                [
                    "id": 1, "label": "External Dell",
                    "bounds": ["x": 2560, "y": 0, "width": 3840, "height": 2160],
                    "workArea": ["x": 2560, "y": 0, "width": 3840, "height": 2160],
                    "size": ["width": 3840, "height": 2160],
                    "scaleFactor": 1.5, "rotation": 0, "internal": false
                ]
            ],
            "total": 2
        ])
        let r = try await task.value
        XCTAssertEqual(r.displays.count, 2)
        XCTAssertEqual(r.displays[0].label, "Built-in Retina")
        XCTAssertEqual(r.displays[0].scaleFactor, 2.0)
        XCTAssertEqual(r.displays[1].bounds?.width, 3840)
        XCTAssertEqual(r.displays[0].isInternal, true)
    }

    func testGetPrimaryDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getPrimary(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true,
            "display": [
                "id": 0, "label": "Primary",
                "size": ["width": 1920, "height": 1080],
                "scaleFactor": 1.0, "rotation": 0
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.display?.id, 0)
        XCTAssertEqual(r.display?.size?.width, 1920)
    }

    // MARK: - getResolution

    func testGetResolutionWithDisplayId() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getResolution(pcPeerId: "pc", displayId: 1) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "display.getResolution")
        XCTAssertEqual((p["params"] as! [String: Any])["displayId"] as? Int, 1)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "displayId": 1,
            "resolution": [
                "width": 2560, "height": 1440, "scaleFactor": 2.0,
                "effectiveWidth": 1280, "effectiveHeight": 720,
                "aspectRatio": "16:9"
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.width, 2560)
        XCTAssertEqual(r.aspectRatio, "16:9")
    }

    // MARK: - getBrightness / setBrightness

    func testGetBrightnessDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getBrightness(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "brightness": 75, "platform": "darwin"
        ])
        let r = try await task.value
        XCTAssertEqual(r.brightness, 75)
        XCTAssertEqual(r.platform, "darwin")
    }

    func testSetBrightnessValidatesRange() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.setBrightness(pcPeerId: "pc", brightness: 150); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }

        do { _ = try await s.cmds.setBrightness(pcPeerId: "pc", brightness: -5); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testSetBrightnessEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.setBrightness(pcPeerId: "pc", brightness: 50) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["brightness"] as? Int, 50)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "brightness": 50, "message": "set"
        ])
        let r = try await task.value
        XCTAssertEqual(r.brightness, 50)
    }

    // MARK: - getScaling / getRefreshRate / getColorDepth

    func testGetScalingDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getScaling(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "displayId": 0,
            "scaling": ["factor": 1.5, "percentage": 150]
        ])
        let r = try await task.value
        XCTAssertEqual(r.factor, 1.5)
        XCTAssertEqual(r.percentage, 150)
    }

    func testGetRefreshRateDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getRefreshRate(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "refreshRate": 120, "unit": "Hz"
        ])
        let r = try await task.value
        XCTAssertEqual(r.refreshRate, 120)
    }

    func testGetColorDepthDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getColorDepth(pcPeerId: "pc", displayId: 0) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "colorDepth": 24, "bitsPerPixel": 32, "displayId": 0
        ])
        let r = try await task.value
        XCTAssertEqual(r.colorDepth, 24)
        XCTAssertEqual(r.bitsPerPixel, 32)
    }

    // MARK: - screenshot

    func testScreenshotEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.screenshot(pcPeerId: "pc", displayId: 0, format: "png", quality: 90)
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        let params = (try payload(s.transport.dcSent[0]))["params"] as! [String: Any]
        XCTAssertEqual(params["format"] as? String, "png")
        XCTAssertEqual(params["quality"] as? Int, 90)
        XCTAssertEqual(params["displayId"] as? Int, 0)

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "saved": false,
            "data": "iVBORw0KGgo=", "size": 12345,
            "format": "png", "dimensions": ["width": 1920, "height": 1080]
        ])
        let r = try await task.value
        XCTAssertEqual(r.data, "iVBORw0KGgo=")
        XCTAssertEqual(r.width, 1920)
        XCTAssertEqual(r.height, 1080)
    }

    func testScreenshotInvalidQualityThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.screenshot(pcPeerId: "pc", quality: 0); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testScreenshotInvalidFormatThrows() async {
        let s = await makeSetup()
        do { _ = try await s.cmds.screenshot(pcPeerId: "pc", format: "bmp"); XCTFail() }
        catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    // MARK: - getWindowList / getCursorPosition

    func testGetWindowListDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getWindowList(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "total": 2,
            "windows": [
                ["id": "w1", "title": "Editor", "processName": "code",
                 "x": 100, "y": 100, "width": 800, "height": 600,
                 "visible": true, "focused": true],
                ["id": "w2", "title": "Browser", "processName": "chrome",
                 "x": 0, "y": 0, "width": 1920, "height": 1080,
                 "visible": true, "focused": false]
            ]
        ])
        let r = try await task.value
        XCTAssertEqual(r.windows.count, 2)
        XCTAssertEqual(r.windows[0].title, "Editor")
        XCTAssertTrue(r.windows[0].focused ?? false)
        XCTAssertEqual(r.windows[1].bounds?.width, 1920)
    }

    func testDisplayGetCursorPositionDecodes() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getCursorPosition(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "success": true, "displayId": 0, "inWorkArea": true,
            "cursor": ["x": 500, "y": 400]
        ])
        let r = try await task.value
        XCTAssertEqual(r.x, 500)
        XCTAssertEqual(r.y, 400)
        XCTAssertTrue(r.inWorkArea)
    }

    // MARK: - 错误传播

    func testRemoteErrorPropagates() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getDisplays(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqId(s.transport.dcSent[0])
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "X11 not available"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
        do {
            _ = try await task.value
            XCTFail()
        } catch RemoteSkillError.remoteError(_, let m) {
            XCTAssertEqual(m, "X11 not available")
        } catch { XCTFail("wrong: \(error)") }
    }
}
