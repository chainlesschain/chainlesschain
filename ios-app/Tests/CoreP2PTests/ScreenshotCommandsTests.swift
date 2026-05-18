import XCTest
@testable import CoreP2P

/// Phase 3.5 — `ScreenshotCommands` + `ScreenCaptureResult.decode` 测试。
final class ScreenshotCommandsTests: XCTestCase {

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
        var dcReady = true
    }

    private struct Setup {
        let cmds: ScreenshotCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "ss-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: ScreenshotCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    func testCaptureSuccessDecodesAllFields() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.capture(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "display.screenshot")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["displayId"] as? Int, 0)
        XCTAssertEqual(params["format"] as? String, "png")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "imageBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA",
            "width": 1920,
            "height": 1080,
            "format": "png",
            "timestamp": 1700000000000
        ]))
        let result = try await task.value
        XCTAssertEqual(result.width, 1920)
        XCTAssertEqual(result.height, 1080)
        XCTAssertEqual(result.format, "png")
        XCTAssertEqual(result.timestamp, 1700000000000)
        XCTAssertFalse(result.imageBase64.isEmpty)
    }

    func testCaptureErrorThrowsRemoteError() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.capture(pcPeerId: "pc") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "no display"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)
        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "no display")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testDecodeMissingImageBase64Throws() {
        let json = #"{"width": 100, "height": 100, "format": "png"}"#
        do {
            _ = try ScreenCaptureResult.decode(json)
            XCTFail("expected throw")
        } catch RemoteSkillError.malformedResult {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testDecodeDefaultsFormatPng() throws {
        let json = #"{"imageBase64": "abc", "width": 10, "height": 10}"#
        let result = try ScreenCaptureResult.decode(json)
        XCTAssertEqual(result.format, "png", "缺 format 默认 png")
    }

    func testEstimatedDecodedBytes() {
        let result = ScreenCaptureResult(imageBase64: "AAAAAAAA", width: 1, height: 1, format: "png")
        // 8 chars base64 = 6 bytes raw
        XCTAssertEqual(result.estimatedDecodedBytes, 6)
    }
}
