import XCTest
@testable import CoreP2P

/// Phase 1.5 unit tests — `DesktopPairingViewModel` (Flow A)。
///
/// 与 Android `DesktopPairingViewModelTest.kt` 1:1 对照。
@MainActor
final class DesktopPairingViewModelTests: XCTestCase {

    // MARK: helpers

    private func makeVM(
        currentDID: String? = "did:cc:test-mobile",
        codeGenerator: @escaping () -> String = { "654321" },
        clock: PairingClock = FixedClock(nowMillis: 1_700_000_000_000)
    ) -> (DesktopPairingViewModel, FakeSignalClient, DefaultPairingMessageBus) {
        let fakeClient = FakeSignalClient()
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let bus = DefaultPairingMessageBus()
        let vm = DesktopPairingViewModel(
            signalingGate: gate,
            messageBus: bus,
            deviceInfoProvider: FakePairingDeviceInfoProvider(),
            clock: clock,
            currentDIDProvider: { currentDID },
            codeGenerator: codeGenerator
        )
        return (vm, fakeClient, bus)
    }

    /// Wait for state to leave .idle (or .displaying if waiting for confirmation).
    private func wait(predicate: @escaping () -> Bool, timeoutMs: UInt64 = 1000) async {
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while Date() < deadline {
            if predicate() { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    // MARK: startPairing

    func testStartPairingWithoutDIDFails() {
        let (vm, _, _) = makeVM(currentDID: nil)
        vm.startPairing()
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("DID"))
        } else { XCTFail("expected .failed, got \(vm.state)") }
    }

    func testStartPairingHappyPathTransitsToDisplaying() {
        let (vm, _, _) = makeVM()
        vm.startPairing()
        guard case .displaying(let json, let code, let expiresAt) = vm.state else {
            XCTFail("expected .displaying, got \(vm.state)")
            return
        }
        XCTAssertEqual(code, "654321")
        XCTAssertEqual(expiresAt, 1_700_000_000_000 + 5 * 60 * 1000)
        // payload JSON 含必需字段
        XCTAssertTrue(json.contains("\"type\":\"device-pairing\""))
        XCTAssertTrue(json.contains("\"code\":\"654321\""))
        XCTAssertTrue(json.contains("\"did\":\"did:cc:test-mobile\""))
        XCTAssertTrue(json.contains("\"deviceId\":\"test-device-id-uuid\""))
        XCTAssertTrue(json.contains("\"platform\":\"ios\""))
    }

    func testStartPairingCallsEnsureRegisteredWithDID() async {
        let (vm, fakeClient, _) = makeVM()
        vm.startPairing()
        // ensureRegistered 是 fire-and-forget Task — 等下让它跑
        await wait { Task.isCancelled == false }
        try? await Task.sleep(nanoseconds: 100_000_000)
        let registers = await fakeClient.registerCalls
        XCTAssertEqual(registers.count, 1, "ensureRegistered 应被调一次")
        XCTAssertEqual(registers[0].peerId, "did:cc:test-mobile",
                       "peer-id 必须用 DID — 否则 server 找不到 confirmation 目标")
    }

    func testStartPairingTwiceResetsCodeAndTimestamp() {
        var counter = 0
        let codes = ["111111", "222222"]
        let (vm, _, _) = makeVM(codeGenerator: {
            defer { counter += 1 }
            return codes[counter]
        })
        vm.startPairing()
        if case .displaying(_, let code1, _) = vm.state {
            XCTAssertEqual(code1, "111111")
        } else { XCTFail() }
        vm.startPairing()
        if case .displaying(_, let code2, _) = vm.state {
            XCTAssertEqual(code2, "222222", "second startPairing 应生成新 code")
        } else { XCTFail() }
    }

    // MARK: confirmation handling

    func testMatchingConfirmationTransitsToCompleted() async {
        let (vm, _, bus) = makeVM(codeGenerator: { "888888" })
        vm.startPairing()
        guard case .displaying = vm.state else { XCTFail(); return }

        // bus emit confirmation with matching code
        bus.emit(PairingConfirmation(
            pairingCode: "888888",
            pcPeerId: "pc-xyz",
            deviceInfo: ["name": "Mac", "platform": "darwin"],
            timestamp: 1_700_000_000_000
        ))
        await wait { vm.state == .completed }
        XCTAssertEqual(vm.state, .completed)
    }

    func testNonMatchingConfirmationCodeIsIgnored() async {
        let (vm, _, bus) = makeVM(codeGenerator: { "888888" })
        vm.startPairing()
        bus.emit(PairingConfirmation(
            pairingCode: "999000",  // 不匹配
            pcPeerId: "pc-other",
            deviceInfo: nil,
            timestamp: 1_700_000_000_000
        ))
        try? await Task.sleep(nanoseconds: 100_000_000)
        guard case .displaying = vm.state else {
            XCTFail("应留在 .displaying，got \(vm.state)")
            return
        }
    }

    func testConfirmationOutsideDisplayingStateIsIgnored() async {
        let (vm, _, bus) = makeVM()
        // 起 idle 状态 emit
        bus.emit(PairingConfirmation(pairingCode: "123456", pcPeerId: "pc", deviceInfo: nil, timestamp: 0))
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(vm.state, .idle, "Idle 状态收 confirmation 应忽略")
    }

    // MARK: expiry

    func testExpiryTransitsToExpired() {
        // 用 _testTriggerExpiry 直接触发，不等真 5min
        let (vm, _, _) = makeVM()
        vm.startPairing()
        guard case .displaying = vm.state else { XCTFail(); return }
        vm._testTriggerExpiry()
        XCTAssertEqual(vm.state, .expired)
    }

    func testExpiryIgnoredAfterCompleted() {
        let (vm, _, bus) = makeVM(codeGenerator: { "777777" })
        vm.startPairing()
        bus.emit(PairingConfirmation(pairingCode: "777777", pcPeerId: "pc", deviceInfo: nil, timestamp: 0))
        // 给订阅 task 一刻完成
        let exp = expectation(description: "completed")
        Task {
            await wait { vm.state == .completed }
            exp.fulfill()
        }
        wait(for: [exp], timeout: 1)
        // 模拟 expiry 触发 — 应被状态 guard 忽略
        vm._testTriggerExpiry()
        XCTAssertEqual(vm.state, .completed, "completed 后 expiry 应不改变状态")
    }

    // MARK: cancelPairing

    func testCancelPairingReturnsToIdle() {
        let (vm, _, _) = makeVM()
        vm.startPairing()
        guard case .displaying = vm.state else { XCTFail(); return }
        vm.cancelPairing()
        XCTAssertEqual(vm.state, .idle)
    }

    // MARK: defaultCodeGenerator

    func testDefaultCodeGeneratorProduces6DigitNumber() {
        for _ in 0..<20 {
            let code = DesktopPairingViewModel.defaultCodeGenerator()
            XCTAssertEqual(code.count, 6)
            XCTAssertNotNil(Int(code))
            XCTAssertGreaterThanOrEqual(Int(code) ?? 0, 100_000)
            XCTAssertLessThanOrEqual(Int(code) ?? 0, 999_999)
        }
    }
}
