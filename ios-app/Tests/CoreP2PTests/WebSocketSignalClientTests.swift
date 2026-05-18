import XCTest
@testable import CoreP2P

/// Phase 1.2 unit tests — `WebSocketSignalClient` 通过 `FakeWebSocketTransport`
/// 验证 wire protocol、reconnect、ping、pairing-confirmation 路由等行为。
///
/// 真 socket round-trip 验证延后到 Phase 1.7 真机 E2E（design doc §10.3）。
final class WebSocketSignalClientTests: XCTestCase {

    // MARK: helpers

    private func buildClient(
        backoff: ReconnectBackoff = .standard,
        pingInterval: UInt64 = 60  // 测试默认拉长，避免 ping 干扰
    ) -> (WebSocketSignalClient, FakeWebSocketTransport, SignalingConfig, DefaultPairingMessageBus) {
        let suite = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        config.setRelayUrl("wss://signaling.chainlesschain.com")
        let bus = DefaultPairingMessageBus()
        let transport = FakeWebSocketTransport()
        let client = WebSocketSignalClient(
            signalingConfig: config,
            messageBus: bus,
            transportFactory: { transport },
            backoff: backoff,
            pingIntervalSeconds: pingInterval
        )
        return (client, transport, config, bus)
    }

    private func parseJSON(_ s: String) -> [String: Any]? {
        guard let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    // MARK: connect

    func testConnectIsIdempotent() async throws {
        let (client, transport, _, _) = buildClient()
        try await client.connect()
        try await client.connect()  // 二次调用：no-op，不抛
        XCTAssertTrue(transport.isOpen)
    }

    func testConnectThrowsWhenTransportFails() async {
        let (client, transport, _, _) = buildClient()
        struct E: Error {}
        transport.connectErrorToThrow = E()
        do {
            try await client.connect()
            XCTFail("expected throw")
        } catch is E {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    // MARK: register

    func testRegisterSendsCorrectJson() async throws {
        let (client, transport, _, _) = buildClient()
        try await client.connect()
        try await client.register(peerId: "did:cc:abc", metadata: ["name": "Alice's iPhone", "version": "17.0"])

        // 等一下让 send 落
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.sentMessages.count, 1)
        let parsed = parseJSON(transport.sentMessages[0])
        XCTAssertEqual(parsed?["type"] as? String, "register")
        XCTAssertEqual(parsed?["peerId"] as? String, "did:cc:abc")
        XCTAssertEqual(parsed?["deviceType"] as? String, "mobile")
        let info = parsed?["deviceInfo"] as? [String: Any]
        XCTAssertEqual(info?["name"] as? String, "Alice's iPhone")
        XCTAssertEqual(info?["version"] as? String, "17.0")
    }

    func testRegisterFailsWhenNotConnected() async {
        let (client, _, _, _) = buildClient()
        do {
            try await client.register(peerId: "did:cc:x", metadata: [:])
            XCTFail("expected throw")
        } catch WebSocketTransportError.notConnected {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    // MARK: sendForwardedMessage

    func testSendForwardedMessageWiresEnvelope() async throws {
        let (client, transport, _, _) = buildClient()
        try await client.connect()
        try await client.sendForwardedMessage(
            toPeerId: "pc-xyz",
            payload: [
                "type": "pair-ack",
                "pairingCode": "123456",
                "mobileDid": "did:cc:abc",
                "timestamp": 1_700_000_000_000
            ]
        )
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(transport.sentMessages.count, 1)
        let parsed = parseJSON(transport.sentMessages[0])
        XCTAssertEqual(parsed?["type"] as? String, "message")
        XCTAssertEqual(parsed?["to"] as? String, "pc-xyz")
        let payload = parsed?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["type"] as? String, "pair-ack")
        XCTAssertEqual(payload?["pairingCode"] as? String, "123456")
    }

    // MARK: receive — pairing:confirmation routes to bus

    func testIncomingPairingConfirmationRoutesToBus() async throws {
        let (client, transport, _, bus) = buildClient()
        try await client.connect()

        // 起订阅
        let received: PairingConfirmation? = await withCheckedContinuation { cont in
            Task {
                for await c in bus.confirmations {
                    cont.resume(returning: c)
                    return
                }
                cont.resume(returning: nil)
            }
            // give subscriber a moment
            Task {
                try? await Task.sleep(nanoseconds: 30_000_000)
                let envelope: [String: Any] = [
                    "type": "message",
                    "from": "pc-xyz",
                    "payload": [
                        "type": "pairing:confirmation",
                        "pairingCode": "654321",
                        "pcPeerId": "pc-xyz",
                        "deviceInfo": ["name": "Mac mini", "platform": "darwin"],
                        "timestamp": 1_700_000_000_000
                    ],
                    "timestamp": 1_700_000_000_000
                ]
                let json = String(data: try! JSONSerialization.data(withJSONObject: envelope), encoding: .utf8)!
                transport.injectIncoming(json)
            }
        }

        XCTAssertEqual(received?.pairingCode, "654321")
        XCTAssertEqual(received?.pcPeerId, "pc-xyz")
        XCTAssertEqual(received?.deviceInfo?["platform"], "darwin")
    }

    func testIncomingNonPairingMessageDoesNotEmitToBus() async throws {
        let (client, transport, _, bus) = buildClient()
        try await client.connect()

        // 1ms 内 bus 不应 emit — 用 Task.sleep + race 验证
        var emitted = false
        let listenTask = Task {
            for await _ in bus.confirmations {
                emitted = true
                return
            }
        }
        let envelope: [String: Any] = [
            "type": "message",
            "from": "pc-xyz",
            "payload": ["type": "ice-candidate", "candidate": "a=foo"]
        ]
        transport.injectIncoming(String(data: try! JSONSerialization.data(withJSONObject: envelope), encoding: .utf8)!)
        try await Task.sleep(nanoseconds: 100_000_000)
        listenTask.cancel()
        XCTAssertFalse(emitted)
    }

    func testIncomingRegisteredAndPongDoNotCrash() async throws {
        let (client, transport, _, _) = buildClient()
        try await client.connect()
        transport.injectIncoming(#"{"type":"registered","peerId":"did:cc:x"}"#)
        transport.injectIncoming(#"{"type":"pong","timestamp":1700000000000}"#)
        try await Task.sleep(nanoseconds: 100_000_000)
        // no assertion needed — just verify no crash + transport still open
        XCTAssertTrue(transport.isOpen)
    }

    func testIncomingMalformedJsonIsIgnored() async throws {
        let (client, transport, _, _) = buildClient()
        try await client.connect()
        transport.injectIncoming("not-json")
        transport.injectIncoming(#"{"missing":"type"}"#)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(transport.isOpen)
    }

    // MARK: reconnect

    func testReconnectAfterUnexpectedClose() async throws {
        // 短 backoff for test speed
        let backoff = ReconnectBackoff(initialDelayMs: 30, maxDelayMs: 100, multiplier: 2.0, maxAttempts: 5)
        let (client, transport, _, _) = buildClient(backoff: backoff)
        try await client.connect()
        try await client.register(peerId: "did:cc:abc", metadata: ["name": "x"])
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(transport.sentMessages.count, 1)  // register

        // simulate server-side disconnect — receive will throw closed → schedule reconnect
        transport.simulateClosed()

        // wait beyond first backoff
        try await Task.sleep(nanoseconds: 200_000_000)

        // 新的 transport 实例由 transportFactory 创建（注：我们 fake 复用同实例
        // 是因为 closure capture 同一引用；reconnect 会在同一 transport 上 connect 再次
        // 而 FakeWebSocketTransport.connect 只翻 _isOpen，不重置 sentMessages —— 因此
        // 重连成功后会 re-send register（line 117-120 of WebSocketSignalClient）→
        // sentMessages 应至少有 2 条
        XCTAssertGreaterThanOrEqual(transport.sentMessages.count, 2, "reconnect should have re-sent register")
        let secondParsed = parseJSON(transport.sentMessages[1])
        XCTAssertEqual(secondParsed?["type"] as? String, "register")
        XCTAssertEqual(secondParsed?["peerId"] as? String, "did:cc:abc")
    }

    func testExplicitDisconnectStopsReconnect() async throws {
        let backoff = ReconnectBackoff(initialDelayMs: 30, maxDelayMs: 100, multiplier: 2.0, maxAttempts: 5)
        let (client, transport, _, _) = buildClient(backoff: backoff)
        try await client.connect()
        try await client.register(peerId: "did:cc:abc", metadata: [:])
        try await Task.sleep(nanoseconds: 30_000_000)

        await client.disconnect()
        XCTAssertFalse(transport.isOpen)
        try await Task.sleep(nanoseconds: 200_000_000)

        // 显式 disconnect 后不会自动 reconnect → sentMessages 不增（仍是 1：register）
        XCTAssertEqual(transport.sentMessages.count, 1)
    }

    // MARK: ping

    func testPingLoopSendsPings() async throws {
        let (client, transport, _, _) = buildClient(pingInterval: 1)
        try await client.connect()
        try await Task.sleep(nanoseconds: 1_300_000_000)  // 等 1.3s
        await client.disconnect()
        XCTAssertGreaterThanOrEqual(transport.pingCount, 1)
    }

    // MARK: currentPeerId 不变量

    func testCurrentPeerIdNotMutatedBySendForwardedMessage() async throws {
        // 这个测试通过观察 reconnect 行为 indirect 验证：
        // 若 sendForwardedMessage 错改了 currentPeerId 为 toPeerId，
        // reconnect 自动 re-register 会注册成 toPeerId（pc-xyz），与 register 的 did:cc:abc 不同。
        let backoff = ReconnectBackoff(initialDelayMs: 30, maxDelayMs: 100, multiplier: 2.0, maxAttempts: 5)
        let (client, transport, _, _) = buildClient(backoff: backoff)
        try await client.connect()
        try await client.register(peerId: "did:cc:abc", metadata: [:])
        try await client.sendForwardedMessage(toPeerId: "pc-xyz-target", payload: ["type": "pair-ack"])
        try await Task.sleep(nanoseconds: 30_000_000)

        transport.simulateClosed()
        try await Task.sleep(nanoseconds: 200_000_000)

        // 找最后一条 register 验证 peerId 仍是 did:cc:abc，不是 pc-xyz-target
        let registers = transport.sentMessages.compactMap(parseJSON).filter { $0["type"] as? String == "register" }
        XCTAssertGreaterThanOrEqual(registers.count, 2)
        XCTAssertEqual(registers.last?["peerId"] as? String, "did:cc:abc",
                       "currentPeerId must NOT be mutated by sendForwardedMessage (Plan A.1 echo-loop trap)")
    }

    // MARK: ReconnectBackoff

    func testReconnectBackoffStandard() {
        let b = ReconnectBackoff.standard
        XCTAssertEqual(b.delayMillis(attempt: 0), 500)
        XCTAssertEqual(b.delayMillis(attempt: 1), 1000)
        XCTAssertEqual(b.delayMillis(attempt: 2), 2000)
        XCTAssertEqual(b.delayMillis(attempt: 3), 4000)
        XCTAssertEqual(b.delayMillis(attempt: 4), 8000)
        XCTAssertEqual(b.delayMillis(attempt: 5), 10000)  // capped
        XCTAssertEqual(b.delayMillis(attempt: 100), 10000)  // capped
    }
}
