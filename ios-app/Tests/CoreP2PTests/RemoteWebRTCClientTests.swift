import XCTest
@testable import CoreP2P

/// Phase 2.1 unit tests — `RemoteWebRTCClient`。
///
/// 通过 `FakeWebRTCPeerConnectionTransport` + `FakeSignalClient`（从 Phase
/// 1.2 借用）验证 5 步 handshake、state 流转、ICE candidate 转发、入站
/// 统一流。**不验证真 Google WebRTC SDK 行为**（那需 Mac + 真 PC，留 Phase
/// 2.5 真机 E2E）。
final class RemoteWebRTCClientTests: XCTestCase {

    // MARK: Helpers

    private func makeClient(
        iceJson: String? = #"[{"urls":["stun:stun.l.google.com:19302"]}]"#,
        answerTimeoutSeconds: UInt64 = 1
    ) -> (RemoteWebRTCClient, FakeWebRTCPeerConnectionTransport, FakeSignalClient, DefaultPairingMessageBus, DefaultPairingSignalingGate) {
        let fakeClient = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let bus = DefaultPairingMessageBus()
        let transport = FakeWebRTCPeerConnectionTransport()
        let client = RemoteWebRTCClient(
            signalingGate: gate,
            messageBus: bus,
            transport: transport,
            iceServersProvider: { _ in iceJson },
            answerTimeoutSeconds: answerTimeoutSeconds
        )
        return (client, transport, fakeClient, bus, gate)
    }

    private func collectStates(_ client: RemoteWebRTCClient, count: Int, timeoutMs: UInt64 = 500) async -> [RemoteWebRTCState] {
        var collected: [RemoteWebRTCState] = []
        let task = Task {
            for await s in await client.state {
                collected.append(s)
                if collected.count >= count { return }
            }
        }
        try? await Task.sleep(nanoseconds: timeoutMs * 1_000_000)
        task.cancel()
        return collected
    }

    // MARK: 5-step handshake

    func testConnectHappyPathTransitsToReady() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)

        // 起 connect — 会 await 等 answer，所以放 Task 里
        let connectTask = Task {
            try await client.connect(pcPeerId: "pc-target", localPeerId: "did:cc:abc")
        }

        // 等 connect 走到 waitingAnswer（transport.setRemoteAnswer 还没调）
        try await Task.sleep(nanoseconds: 100_000_000)

        // 模拟 desktop 回 answer
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "fake-answer"))

        // 等 connect 完成
        try await connectTask.value

        // 模拟 transport DC OPEN 回调
        await transport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 50_000_000)

        let state = await client.currentState
        XCTAssertEqual(state, .ready)

        // 验证 transport calls
        XCTAssertEqual(transport.setupCalls.count, 1)
        XCTAssertEqual(transport.setRemoteAnswerCalls.count, 1)
        XCTAssertEqual(transport.setRemoteAnswerCalls[0].sdp, "fake-answer")
    }

    func testConnectIsIdempotentWhenAlreadyReady() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)
        let connectTask = Task { try await client.connect(pcPeerId: "pc-1", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "ans"))
        try await connectTask.value
        await transport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 50_000_000)

        // Second connect — 应 no-op
        try await client.connect(pcPeerId: "pc-1", localPeerId: "did:cc:x")
        XCTAssertEqual(transport.setupCalls.count, 1, "second connect should not re-setup")
    }

    func testConnectSendsOfferViaSignaling() async throws {
        let (client, transport, fakeSignalClient, _, _) = makeClient(answerTimeoutSeconds: 5)
        transport.offerSdpToReturn = "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\n"

        let connectTask = Task {
            try await client.connect(pcPeerId: "pc-target", localPeerId: "did:cc:me")
        }
        try await Task.sleep(nanoseconds: 100_000_000)

        // 验证 SignalClient 收到了 offer envelope
        let sent = await fakeSignalClient.sentForwardedMessages
        XCTAssertGreaterThanOrEqual(sent.count, 1, "should have sent offer to pc-target via signaling")
        XCTAssertEqual(sent[0].toPeerId, "pc-target")
        XCTAssertEqual(sent[0].payload["type"] as? String, "offer")

        // cleanup
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value
    }

    // MARK: Error paths

    func testAnswerTimeoutFailsConnect() async {
        let (client, _, _, _, _) = makeClient(answerTimeoutSeconds: 1)

        do {
            try await client.connect(pcPeerId: "pc-x", localPeerId: "did:cc:y")
            XCTFail("expected throw answerTimeout")
        } catch RemoteWebRTCError.answerTimeout {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
        let state = await client.currentState
        if case .failed = state { /* ok */ } else { XCTFail("expected .failed state") }
    }

    /// **Regression** — 修 P0 continuation 泄漏：answer timeout 后 pendingAnswer
    /// 必须清空，否则下次 connect 会和上次未清的 continuation 撞。
    func testAnswerTimeoutClearsPendingAnswer() async {
        let (client, _, _, _, _) = makeClient(answerTimeoutSeconds: 1)
        // 第一次 connect → timeout 失败
        do {
            try await client.connect(pcPeerId: "pc-x", localPeerId: "did:cc:y")
            XCTFail("expected timeout")
        } catch RemoteWebRTCError.answerTimeout {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
        // pendingAnswer 必须已清
        let hasPending = await client.hasPendingAnswer()
        XCTAssertFalse(hasPending, "answerTimeout 后 pendingAnswer 必须清空，否则 P0 continuation 泄漏复发")
    }

    func testOfferFailureFailsConnect() async {
        let (client, transport, _, _, _) = makeClient()
        transport.offerErrorToThrow = RemoteWebRTCError.offerFailed("test")

        do {
            try await client.connect(pcPeerId: "pc-x", localPeerId: "did:cc:y")
            XCTFail("expected throw")
        } catch RemoteWebRTCError.offerFailed {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    func testSetupPeerConnectionFailureFailsConnect() async {
        let (client, transport, _, _, _) = makeClient()
        struct E: Error {}
        transport.setupErrorToThrow = E()

        do {
            try await client.connect(pcPeerId: "pc-x", localPeerId: "did:cc:y")
            XCTFail("expected throw")
        } catch is E {
            // ok
        } catch {
            XCTFail("wrong error: \(error)")
        }
    }

    // MARK: ICE candidate routing

    func testLocalIceCandidateForwardedToSignaling() async throws {
        let (client, transport, fakeSignalClient, _, _) = makeClient(answerTimeoutSeconds: 5)

        let connectTask = Task { try await client.connect(pcPeerId: "pc-tgt", localPeerId: "did:cc:me") }
        try await Task.sleep(nanoseconds: 100_000_000)

        // 模拟 transport 生成本地 ICE candidate
        let candidate = OutboundIceCandidate(
            sdp: "candidate:1 1 UDP 2122252543 192.168.1.1 54321 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0
        )
        await transport.simulateLocalIceCandidate(candidate)
        try await Task.sleep(nanoseconds: 100_000_000)

        // 验证 ICE 经 signaling 转发到 pc-tgt
        let sent = await fakeSignalClient.sentForwardedMessages
        let iceMessages = sent.filter { $0.payload["type"] as? String == "ice-candidate" }
        XCTAssertGreaterThanOrEqual(iceMessages.count, 1)
        XCTAssertEqual(iceMessages[0].toPeerId, "pc-tgt")
        let payload = iceMessages[0].payload["candidate"] as? [String: Any]
        XCTAssertEqual(payload?["candidate"] as? String, candidate.sdp)
        XCTAssertEqual(payload?["sdpMid"] as? String, "0")

        // cleanup
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value
    }

    func testRemoteIceCandidateAddedToTransport() async throws {
        let (client, transport, _, _, _) = makeClient()
        let candidate = OutboundIceCandidate(sdp: "remote-cand", sdpMid: "1", sdpMLineIndex: 0)
        // Pre-flight setup（绕开 connect 等 answer 的复杂性）— 直接 setupPeerConnection
        try await transport.setupPeerConnection(
            config: .stunOnlyFallback,
            delegate: NoopTransportDelegate()
        )
        try await client.handleRemoteIceCandidate(candidate)
        XCTAssertEqual(transport.addedRemoteCandidates.count, 1)
        XCTAssertEqual(transport.addedRemoteCandidates[0].sdp, "remote-cand")
    }

    // MARK: state stream

    func testStateTransitionsEmittedToStream() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)

        let states = Task { await self.collectStates(client, count: 5, timeoutMs: 500) }

        let connectTask = Task { try await client.connect(pcPeerId: "pc", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "ans"))
        _ = try? await connectTask.value
        await transport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 100_000_000)

        let collected = await states.value
        // 至少含 .signalingConnected, .registered, .creatingOffer, .waitingAnswer, ...,
        // .iceConnecting, .dataChannelOpen, .ready 中的几个
        XCTAssertTrue(collected.contains(.signalingConnected))
        XCTAssertTrue(collected.contains(.creatingOffer))
        XCTAssertTrue(collected.contains(.waitingAnswer))
    }

    // MARK: dataChannelReady derived stream

    func testDataChannelReadyEmitsTrueOnReady() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)

        let dcReadyValues = Task<[Bool], Never> {
            var v: [Bool] = []
            for await ready in await client.dataChannelReady {
                v.append(ready)
                if ready { return v }
            }
            return v
        }

        let connectTask = Task { try await client.connect(pcPeerId: "pc", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value
        await transport.simulateDcStateChange(.open)

        // 等 dcReady stream 收到 true
        let timeoutTask = Task {
            try await Task.sleep(nanoseconds: 500_000_000)
            return false
        }
        async let collected = dcReadyValues.value
        async let timeout = timeoutTask.value
        let result = await collected
        let _ = await timeout

        XCTAssertTrue(result.last ?? false, "dataChannelReady should emit true after DC OPEN")
    }

    // MARK: inboundMessages unified

    func testInboundFromDcEmittedOnInboundStream() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)
        try await transport.setupPeerConnection(
            config: .stunOnlyFallback,
            delegate: NoopTransportDelegate()
        )

        // 直接 setup 后绑 transport delegate 到 client（绕 connect 5 步）
        // 实际场景由 client.connect 自动绑；这里手动 fast-path
        let inboundTask = Task<String?, Never> {
            for await msg in await client.inboundMessages {
                return msg
            }
            return nil
        }

        // 经 connect 让 transport 绑 client.transportDelegate — 简化路径
        let connectTask = Task { try await client.connect(pcPeerId: "pc", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value

        // 模拟 DC 入站消息
        await transport.simulateDcMessage(#"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout"}}"#)

        let received = await inboundTask.value
        XCTAssertNotNil(received)
        XCTAssertTrue(received?.contains("terminal.stdout") ?? false)
    }

    func testInboundFromSignalingForwardedToInboundStream() async throws {
        let (client, _, _, _, _) = makeClient()

        let inboundTask = Task<String?, Never> {
            for await msg in await client.inboundMessages {
                return msg
            }
            return nil
        }
        try await Task.sleep(nanoseconds: 30_000_000)

        await client.emitInboundFromSignaling(#"{"type":"chainlesschain:command:response","payload":{"id":"req-1","result":{}}}"#)

        let received = await inboundTask.value
        XCTAssertNotNil(received)
        XCTAssertTrue(received?.contains("command:response") ?? false)
    }

    // MARK: sendMessage

    func testSendMessageThrowsWhenNotReady() async {
        let (client, _, _, _, _) = makeClient()
        do {
            try await client.sendMessage("hello")
            XCTFail("expected dataChannelNotOpen")
        } catch RemoteWebRTCError.dataChannelNotOpen {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    func testSendMessageWhenReady() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)
        let connectTask = Task { try await client.connect(pcPeerId: "pc", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value
        await transport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 100_000_000)

        try await client.sendMessage("hello-world")
        XCTAssertEqual(transport.sentMessages.count, 1)
        XCTAssertEqual(transport.sentMessages[0], "hello-world")
    }

    // MARK: disconnect

    func testDisconnectClosesTransportAndResetsState() async throws {
        let (client, transport, _, _, _) = makeClient(answerTimeoutSeconds: 5)
        let connectTask = Task { try await client.connect(pcPeerId: "pc", localPeerId: "did:cc:x") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: "x"))
        _ = try? await connectTask.value
        await transport.simulateDcStateChange(.open)
        try await Task.sleep(nanoseconds: 50_000_000)

        await client.disconnect()
        XCTAssertEqual(transport.closeCount, 1)
        let state = await client.currentState
        XCTAssertEqual(state, .disconnected)
    }
}

// MARK: - RemoteWebRTCConfig parse tests

final class RemoteWebRTCConfigTests: XCTestCase {
    func testParseWithValidJson() {
        let json = """
        [
          {"urls": ["stun:stun.l.google.com:19302"]},
          {"urls": ["turn:turn.example.com:3478"], "username": "user", "credential": "pass"}
        ]
        """
        let config = RemoteWebRTCConfig.parse(jsonString: json)
        XCTAssertEqual(config.iceServers.count, 2)
        XCTAssertEqual(config.iceServers[0].urls, ["stun:stun.l.google.com:19302"])
        XCTAssertNil(config.iceServers[0].username)
        XCTAssertEqual(config.iceServers[1].username, "user")
        XCTAssertEqual(config.iceServers[1].credential, "pass")
    }

    func testParseWithStringUrlsField() {
        let json = #"[{"urls": "stun:stun.example.com"}]"#
        let config = RemoteWebRTCConfig.parse(jsonString: json)
        XCTAssertEqual(config.iceServers.count, 1)
        XCTAssertEqual(config.iceServers[0].urls, ["stun:stun.example.com"])
    }

    func testParseFallsBackOnMalformedJson() {
        let config = RemoteWebRTCConfig.parse(jsonString: "not-json")
        XCTAssertEqual(config.iceServers, RemoteWebRTCConfig.stunOnlyFallback.iceServers)
    }

    func testParseFallsBackOnNil() {
        let config = RemoteWebRTCConfig.parse(jsonString: nil)
        XCTAssertEqual(config.iceServers, RemoteWebRTCConfig.stunOnlyFallback.iceServers)
    }

    func testParseFallsBackOnEmptyArray() {
        let config = RemoteWebRTCConfig.parse(jsonString: "[]")
        XCTAssertEqual(config.iceServers, RemoteWebRTCConfig.stunOnlyFallback.iceServers)
    }
}

// MARK: - Helpers

private final class NoopTransportDelegate: WebRTCPeerConnectionTransportDelegate, @unchecked Sendable {
    func onLocalIceCandidate(_ candidate: OutboundIceCandidate) async {}
    func onIceConnectionState(_ state: RTCIceConnectionStateMirror) async {}
    func onDataChannelStateChange(_ state: DataChannelReadyState) async {}
    func onDataChannelMessage(_ text: String) async {}
}
