import XCTest
@testable import CoreP2P

/// Phase 2.4 prereq — `WebSocketSignalClient.forwardedMessages` 多订阅入口
/// emit 测试。验证：
/// - 任意 type=message 入站 raw 都 yield 到 forwardedMessages
/// - pairing:confirmation 仍同时 emit 到 PairingMessageBus（向后兼容 Phase 1）
/// - 非 type=message 帧（registered/pong/error）不 emit 到 forwardedMessages
final class WebSocketSignalClientForwardedStreamTests: XCTestCase {

    private func buildClient() -> (WebSocketSignalClient, FakeWebSocketTransport, DefaultPairingMessageBus) {
        let suite = UserDefaults(suiteName: "fwd-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        config.setRelayUrl("wss://signaling.test")
        let bus = DefaultPairingMessageBus()
        let transport = FakeWebSocketTransport()
        let client = WebSocketSignalClient(
            signalingConfig: config,
            messageBus: bus,
            transportFactory: { transport },
            backoff: .standard,
            pingIntervalSeconds: 60
        )
        return (client, transport, bus)
    }

    func testForwardedMessageEmitsToStream() async throws {
        let (client, transport, _) = buildClient()
        try await client.connect()

        let received = Task<String?, Never> {
            for await msg in client.forwardedMessages {
                return msg
            }
            return nil
        }
        try await Task.sleep(nanoseconds: 30_000_000)

        let raw = #"{"type":"message","from":"pc-1","payload":{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s1","data":"x","seq":1}},"timestamp":1700}"#
        transport.injectIncoming(raw)

        let result = await received.value
        XCTAssertNotNil(result)
        XCTAssertTrue(result?.contains("terminal.stdout") ?? false)
    }

    func testPairingConfirmationStillRoutedToBus() async throws {
        let (client, transport, bus) = buildClient()
        try await client.connect()

        var fwdCount = 0
        var busCount = 0

        let fwdTask = Task {
            for await _ in client.forwardedMessages {
                fwdCount += 1
                if fwdCount >= 1 { return }
            }
        }
        let busTask = Task {
            for await _ in bus.confirmations {
                busCount += 1
                if busCount >= 1 { return }
            }
        }

        try await Task.sleep(nanoseconds: 30_000_000)

        let raw = #"{"type":"message","from":"pc","payload":{"type":"pairing:confirmation","pairingCode":"123456","pcPeerId":"pc","timestamp":1700}}"#
        transport.injectIncoming(raw)

        try await Task.sleep(nanoseconds: 200_000_000)
        fwdTask.cancel()
        busTask.cancel()

        XCTAssertEqual(fwdCount, 1, "pairing:confirmation should also emit to forwardedMessages")
        XCTAssertEqual(busCount, 1, "pairing:confirmation should still route to PairingMessageBus")
    }

    func testNonMessageTypeDoesNotEmitToForwarded() async throws {
        let (client, transport, _) = buildClient()
        try await client.connect()

        var emitted = false
        let task = Task {
            for await _ in client.forwardedMessages {
                emitted = true
                return
            }
        }
        try await Task.sleep(nanoseconds: 30_000_000)
        transport.injectIncoming(#"{"type":"registered","peerId":"x"}"#)
        transport.injectIncoming(#"{"type":"pong","timestamp":1}"#)
        transport.injectIncoming(#"{"type":"error","error":"foo"}"#)
        try await Task.sleep(nanoseconds: 200_000_000)
        task.cancel()
        XCTAssertFalse(emitted, "registered/pong/error should not emit to forwardedMessages")
    }
}
