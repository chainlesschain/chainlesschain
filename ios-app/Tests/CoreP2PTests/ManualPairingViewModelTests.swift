import XCTest
@testable import CoreP2P

/// Phase 1.6 unit tests — `ManualPairingViewModel`。
///
/// 覆盖 code 校验 / 提交 happy path / sendAck 失败 / confirmation 匹配 / timeout。
@MainActor
final class ManualPairingViewModelTests: XCTestCase {

    // MARK: helpers

    private func makeVM(
        currentDID: String? = "did:cc:test-mobile",
        clock: PairingClock = FixedClock(nowMillis: 1_700_000_000_000)
    ) -> (ManualPairingViewModel, FakeSignalClient, DefaultPairingMessageBus) {
        let fakeClient = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let bus = DefaultPairingMessageBus()
        let vm = ManualPairingViewModel(
            signalingGate: gate,
            messageBus: bus,
            deviceInfoProvider: FakePairingDeviceInfoProvider(),
            clock: clock,
            currentDIDProvider: { currentDID }
        )
        return (vm, fakeClient, bus)
    }

    private func wait(for predicate: @escaping () -> Bool, timeoutMs: UInt64 = 1000) async {
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while Date() < deadline {
            if predicate() { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    // MARK: code validation

    func testRejectsCodeShorterThan6() {
        let (vm, _, _) = makeVM()
        vm.code = "12345"
        vm.submit()
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("6 位"))
        } else { XCTFail("expected .failed, got \(vm.state)") }
    }

    func testRejectsCodeLongerThan6IfFilteredStillNot6() {
        // "abcdef" → filter 数字 → "" → < 6
        let (vm, _, _) = makeVM()
        vm.code = "abcdef"
        vm.submit()
        guard case .failed = vm.state else { XCTFail(); return }
    }

    func testFiltersNonDigitsBeforeValidation() async {
        // "1a2b3c4d5e6f" → filter → "123456" → 6 位 → 提交成功
        let (vm, fakeClient, _) = makeVM()
        vm.code = "1a2b3c4d5e6f"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }
        guard case .waitingForConfirm(let code, _) = vm.state else { XCTFail(); return }
        XCTAssertEqual(code, "123456")
        let sent = await fakeClient.sentForwardedMessages
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].toPeerId, "pairing-code:123456")
    }

    // MARK: DID guard

    func testRejectsWhenNoDID() {
        let (vm, _, _) = makeVM(currentDID: nil)
        vm.code = "123456"
        vm.submit()
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("DID"))
        } else { XCTFail() }
    }

    // MARK: happy submit

    func testHappyPathSendsAckWithCorrectPeerIdAndEnvelope() async {
        let (vm, fakeClient, _) = makeVM()
        vm.code = "654321"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }

        guard case .waitingForConfirm(let code, let expiresAt) = vm.state else {
            XCTFail("expected .waitingForConfirm, got \(vm.state)")
            return
        }
        XCTAssertEqual(code, "654321")
        XCTAssertEqual(expiresAt, 1_700_000_000_000 + 60 * 1000)

        let sent = await fakeClient.sentForwardedMessages
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].toPeerId, "pairing-code:654321",
                       "peerId 必须用 pairing-code: 别名 — 桌面端按此别名 register 才能收到")
        XCTAssertEqual(sent[0].payload["type"] as? String, "pair-ack")
        XCTAssertEqual(sent[0].payload["pairingCode"] as? String, "654321")
        XCTAssertEqual(sent[0].payload["mobileDid"] as? String, "did:cc:test-mobile")
        let info = sent[0].payload["deviceInfo"] as? [String: Any]
        XCTAssertEqual(info?["platform"] as? String, "ios")

        // 同时 ensureRegistered 应已被调（gate 内部触发）
        let registers = await fakeClient.registerCalls
        XCTAssertEqual(registers.count, 1)
        XCTAssertEqual(registers[0].peerId, "did:cc:test-mobile")
    }

    // MARK: sendAck failure

    func testSendAckFailureTransitsToFailedWithFriendlyMessage() async {
        let fakeClient = FakeSignalClient()
        await fakeClient.setFailNextSends(2)  // gate 重试一次也失败
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let bus = DefaultPairingMessageBus()
        let vm = ManualPairingViewModel(
            signalingGate: gate,
            messageBus: bus,
            deviceInfoProvider: FakePairingDeviceInfoProvider(),
            clock: FixedClock(nowMillis: 1_700_000_000_000),
            currentDIDProvider: { "did:cc:abc" }
        )
        vm.code = "999000"
        vm.submit()
        await wait { if case .failed = vm.state { return true }; return false }
        guard case .failed(let reason) = vm.state else { XCTFail(); return }
        XCTAssertTrue(reason.contains("通知桌面失败"))
        XCTAssertTrue(reason.contains("扫描桌面"), "失败文案应建议改用扫描方式")
    }

    // MARK: confirmation

    func testMatchingConfirmationTransitsToCompleted() async {
        let (vm, _, bus) = makeVM()
        vm.code = "777888"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }

        bus.emit(PairingConfirmation(
            pairingCode: "777888",
            pcPeerId: "pc-some",
            deviceInfo: nil,
            timestamp: 1_700_000_000_000
        ))
        await wait { vm.state == .completed }
        XCTAssertEqual(vm.state, .completed)
    }

    func testNonMatchingConfirmationCodeIgnored() async {
        let (vm, _, bus) = makeVM()
        vm.code = "111222"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }

        bus.emit(PairingConfirmation(
            pairingCode: "999999",  // 不匹配
            pcPeerId: "pc-other",
            deviceInfo: nil,
            timestamp: 0
        ))
        try? await Task.sleep(nanoseconds: 100_000_000)
        guard case .waitingForConfirm = vm.state else {
            XCTFail("应留在 .waitingForConfirm")
            return
        }
    }

    // MARK: timeout

    func testTimeoutTransitsToFailedWithGuidance() async {
        let (vm, _, _) = makeVM()
        vm.code = "456789"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }
        vm._testTriggerTimeout()
        guard case .failed(let reason) = vm.state else { XCTFail(); return }
        XCTAssertTrue(reason.contains("60 秒"))
        XCTAssertTrue(reason.contains("扫描桌面"), "超时文案应建议改用扫描方式")
        XCTAssertTrue(reason.contains("456789"), "应在文案里 echo 用户输入的 code")
    }

    // MARK: reset

    func testResetReturnsToEnteringAndClearsCode() async {
        let (vm, _, _) = makeVM()
        vm.code = "555555"
        vm.submit()
        await wait { if case .waitingForConfirm = vm.state { return true }; return false }
        vm.reset()
        XCTAssertEqual(vm.state, .entering)
        XCTAssertEqual(vm.code, "")
    }
}
