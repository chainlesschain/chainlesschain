import XCTest
@testable import CoreP2P

/// Phase 1.3 unit tests — `ScanDesktopPairingViewModel`。
///
/// 覆盖每个 parse 失败分支 + happy path + LAN→relay fallback + 持久化。
/// 与 Android `ScanDesktopPairingViewModelTest.kt` 1:1 对照。
@MainActor
final class ScanDesktopPairingViewModelTests: XCTestCase {

    // MARK: helpers

    private func makeFixedClock(_ now: Int64 = 1_700_000_000_000) -> FixedClock {
        FixedClock(nowMillis: now)
    }

    private func makeViewModel(
        gate: PairingSignalingGate? = nil,
        config: SignalingConfig? = nil,
        store: PairedDesktopsStore? = nil,
        deviceInfo: PairingDeviceInfoProvider? = nil,
        clock: PairingClock? = nil,
        currentDID: String? = "did:cc:test-mobile"
    ) -> (ScanDesktopPairingViewModel, FakeSignalClient, FakePairingDeviceInfoProvider, SignalingConfig, PairedDesktopsStore) {
        let suite = UserDefaults(suiteName: "test-vm-\(UUID().uuidString)")!
        let resolvedConfig = config ?? SignalingConfig(userDefaults: suite)
        resolvedConfig.setRelayUrl("wss://relay.test")
        let resolvedStore = store ?? PairedDesktopsStore(userDefaults: suite, key: "vm-test")
        let fakeClient = FakeSignalClient()
        let resolvedGate = gate ?? DefaultPairingSignalingGate(signalClient: fakeClient)
        let fakeDeviceInfo = (deviceInfo as? FakePairingDeviceInfoProvider) ?? FakePairingDeviceInfoProvider()
        let resolvedClock = clock ?? makeFixedClock()
        let vm = ScanDesktopPairingViewModel(
            signalingGate: resolvedGate,
            signalingConfig: resolvedConfig,
            pairedDesktopsStore: resolvedStore,
            deviceInfoProvider: fakeDeviceInfo,
            clock: resolvedClock,
            currentDIDProvider: { currentDID }
        )
        return (vm, fakeClient, fakeDeviceInfo, resolvedConfig, resolvedStore)
    }

    private func makePayload(
        type: String = "desktop-pairing",
        code: String = "123456",
        pcPeerId: String = "pc-abc",
        timestamp: Int64 = 1_700_000_000_000,
        signalingUrl: String? = "ws://192.168.1.10:9001",
        relayUrl: String? = "wss://relay.example.com",
        deviceInfo: [String: Any] = ["name": "Mac mini", "platform": "darwin"],
        iceServers: [[String: Any]]? = [["urls": "stun:stun.l.google.com:19302"]],
        iceExpiry: Int64 = 1_700_086_400
    ) -> String {
        var dict: [String: Any] = [
            "type": type,
            "code": code,
            "pcPeerId": pcPeerId,
            "timestamp": timestamp,
            "deviceInfo": deviceInfo
        ]
        if let url = signalingUrl { dict["signalingUrl"] = url }
        if let url = relayUrl { dict["relayUrl"] = url }
        if let ice = iceServers { dict["iceServers"] = ice }
        dict["iceExpiry"] = iceExpiry
        let data = try! JSONSerialization.data(withJSONObject: dict)
        return String(data: data, encoding: .utf8)!
    }

    private func waitForState(_ vm: ScanDesktopPairingViewModel, timeoutMs: UInt64 = 500) async {
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 10_000_000)
            switch vm.state {
            case .scanning, .sending: continue
            case .success, .failed: return
            }
        }
    }

    // MARK: parse failure branches

    func testRejectsNonJsonInput() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned("not-json")
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("不是桌面配对码"))
        } else { XCTFail("expected .failed, got \(vm.state)") }
    }

    func testRejectsJsonNotObject() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned("[1,2,3]")
        await waitForState(vm)
        guard case .failed = vm.state else { XCTFail("expected .failed"); return }
    }

    func testRejectsWrongType() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned(makePayload(type: "device-pairing"))
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("不是桌面配对 QR"))
        } else { XCTFail("expected .failed") }
    }

    func testRejectsBadCodeFormat() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned(makePayload(code: "12345"))  // 5 位
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("6 位数字"))
        } else { XCTFail("expected .failed") }
    }

    func testRejectsMissingPcPeerId() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned(makePayload(pcPeerId: ""))
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("pcPeerId"))
        } else { XCTFail("expected .failed") }
    }

    func testRejectsExpiredQR() async {
        // 6min 前的 QR
        let stale = makePayload(timestamp: 1_700_000_000_000 - 6 * 60 * 1000)
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned(stale)
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("过期"))
        } else { XCTFail("expected .failed") }
    }

    func testRejectsWhenNoCurrentDID() async {
        let (vm, _, _, _, _) = makeViewModel(currentDID: nil)
        vm.onQrScanned(makePayload())
        await waitForState(vm)
        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("DID"))
        } else { XCTFail("expected .failed") }
    }

    // MARK: happy path

    func testHappyPathSendsAckAndPersistsAndTransitsSuccess() async throws {
        let (vm, fakeClient, _, config, store) = makeViewModel()
        vm.onQrScanned(makePayload())
        await waitForState(vm)
        guard case .success(let name) = vm.state else { XCTFail("expected .success, got \(vm.state)"); return }
        XCTAssertEqual(name, "Mac mini")

        // signalingUrl + relayUrl 持久化
        XCTAssertEqual(config.getCustomSignalingUrl(), "ws://192.168.1.10:9001")
        XCTAssertEqual(config.getRelayUrl(), "wss://relay.example.com")

        // ack 发送了 — 同时含正确 envelope
        let sent = await fakeClient.sentForwardedMessages
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent[0].toPeerId, "pc-abc")
        XCTAssertEqual(sent[0].payload["type"] as? String, "pair-ack")
        XCTAssertEqual(sent[0].payload["pairingCode"] as? String, "123456")
        XCTAssertEqual(sent[0].payload["mobileDid"] as? String, "did:cc:test-mobile")
        let info = sent[0].payload["deviceInfo"] as? [String: Any]
        XCTAssertEqual(info?["platform"] as? String, "ios")

        // PairedDesktop 写入 + ICE servers 原样存
        let devices = await store.devices()
        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices[0].pcPeerId, "pc-abc")
        XCTAssertEqual(devices[0].deviceName, "Mac mini")
        XCTAssertEqual(devices[0].platform, "darwin")
        XCTAssertNotNil(devices[0].iceServersJson)
        XCTAssertTrue(devices[0].iceServersJson!.contains("stun:stun.l.google.com"))
    }

    // MARK: LAN→relay fallback

    func testLANFailureThenRelaySuccess() async throws {
        // 让 fake client 第一次 sendForwardedMessage 失败，第二次成功
        let fakeClient = FakeSignalClient()
        await fakeClient.setFailNextSendCount(1)
        let suite = UserDefaults(suiteName: "test-fb-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        config.setRelayUrl("wss://relay.fallback.test")
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let vm = ScanDesktopPairingViewModel(
            signalingGate: gate,
            signalingConfig: config,
            pairedDesktopsStore: PairedDesktopsStore(userDefaults: suite, key: "fb-test"),
            deviceInfoProvider: FakePairingDeviceInfoProvider(),
            clock: FixedClock(nowMillis: 1_700_000_000_000),
            currentDIDProvider: { "did:cc:abc" }
        )

        vm.onQrScanned(makePayload())
        await waitForState(vm)

        guard case .success = vm.state else { XCTFail("expected .success after fallback, got \(vm.state)"); return }

        // sendForwardedMessage 应被调用 2 次（LAN 失败 + relay 重试）
        let sent = await fakeClient.sentForwardedMessages
        XCTAssertEqual(sent.count, 2)
        // disconnect 应在 LAN 失败后被调（gate.reset 链接）
        let disconnects = await fakeClient.disconnectCount
        XCTAssertGreaterThanOrEqual(disconnects, 1)
        // signaling URL 切到 relay
        XCTAssertEqual(config.getCustomSignalingUrl(), "wss://relay.fallback.test")
    }

    func testBothLANAndRelayFailTerminalFailed() async throws {
        let fakeClient = FakeSignalClient()
        await fakeClient.setFailNextSendCount(2)  // 两次都失败
        let suite = UserDefaults(suiteName: "test-bf-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        config.setRelayUrl("wss://relay.test")
        let gate = DefaultPairingSignalingGate(signalClient: fakeClient)
        let vm = ScanDesktopPairingViewModel(
            signalingGate: gate,
            signalingConfig: config,
            pairedDesktopsStore: PairedDesktopsStore(userDefaults: suite, key: "bf-test"),
            deviceInfoProvider: FakePairingDeviceInfoProvider(),
            clock: FixedClock(nowMillis: 1_700_000_000_000),
            currentDIDProvider: { "did:cc:abc" }
        )

        vm.onQrScanned(makePayload())
        await waitForState(vm)

        if case .failed(let reason) = vm.state {
            XCTAssertTrue(reason.contains("LAN") && reason.contains("中继"))
        } else { XCTFail("expected .failed, got \(vm.state)") }
    }

    // MARK: idempotent rescan

    func testRescanInScanningStateIgnoresAfterTransit() async {
        let (vm, fakeClient, _, _, _) = makeViewModel()
        vm.onQrScanned(makePayload())
        await waitForState(vm)
        // 已 transit 到 success — 再扫一次应被 .scanning guard 拒（保持 success state）
        vm.onQrScanned(makePayload())
        try? await Task.sleep(nanoseconds: 100_000_000)
        let sent = await fakeClient.sentForwardedMessages
        XCTAssertEqual(sent.count, 1, "second scan after success should be no-op (idempotent)")
    }

    // MARK: retry

    func testRetryReturnsToScanning() async {
        let (vm, _, _, _, _) = makeViewModel()
        vm.onQrScanned("not-json")
        await waitForState(vm)
        guard case .failed = vm.state else { XCTFail("expected .failed"); return }
        vm.retry()
        XCTAssertEqual(vm.state, .scanning)
    }
}

// MARK: - Test helpers

struct FixedClock: PairingClock {
    let nowMillis_: Int64
    init(nowMillis: Int64) { self.nowMillis_ = nowMillis }
    func nowMillis() -> Int64 { nowMillis_ }
}

final class FakePairingDeviceInfoProvider: PairingDeviceInfoProvider, @unchecked Sendable {
    var stubDeviceId = "test-device-id-uuid"
    var stubName = "Test iPhone"
    func deviceId() -> String { stubDeviceId }
    func name() -> String { stubName }
    func platform() -> String { "ios" }
}

// 给 FakeSignalClient 加 failNext 能力（在 PairingSignalingGateTests.swift 里定义）
extension FakeSignalClient {
    func setFailNextSendCount(_ n: Int) async {
        await self.setFailNextSends(n)
    }
}
