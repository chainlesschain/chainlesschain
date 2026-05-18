import XCTest
@testable import CoreP2P

/// Phase 1.1 scaffold sanity tests — 验证 CoreP2P 模块内符号存在且能基本互通。
///
/// **历史**：本文件之前是 aspirational ghost code（引用 P2PMessage / MessageQueue /
/// MessageDeduplicator / PeerInfo / SignalingMessage / BatchProcessor /
/// ExponentialBackoff / WebRTCManagerDelegate 等不存在的类型），@testable
/// import CoreP2P 也无源可 import（CoreP2P 目录之前不存在）。Phase 1.1 创建
/// 模块时一并替换为这套 scaffold sanity test，避免 build break。完整 unit
/// 覆盖在 Phase 1.2-1.4（参见 design doc §10.1 测试矩阵）。
final class CoreP2PScaffoldTests: XCTestCase {

    // MARK: - PairedDesktop Codable round-trip

    func testPairedDesktopCodableRoundTrip() throws {
        let original = PairedDesktop(
            pcPeerId: "pc-abcdef123",
            deviceName: "Test Desktop",
            platform: "win32",
            lanSignalingUrl: "ws://192.168.1.10:9001",
            relayUrl: "wss://signaling.chainlesschain.com",
            iceServersJson: #"[{"urls":"stun:stun.l.google.com:19302"}]"#,
            iceExpiry: 1_700_000_000,
            pairedAt: 1_700_000_000_000,
            lastSeenAt: 1_700_000_000_000
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(PairedDesktop.self, from: data)

        XCTAssertEqual(decoded.pcPeerId, "pc-abcdef123")
        XCTAssertEqual(decoded.deviceName, "Test Desktop")
        XCTAssertEqual(decoded.platform, "win32")
        XCTAssertEqual(decoded.lanSignalingUrl, "ws://192.168.1.10:9001")
        XCTAssertEqual(decoded.relayUrl, "wss://signaling.chainlesschain.com")
        XCTAssertEqual(decoded.iceExpiry, 1_700_000_000)
        XCTAssertEqual(decoded.pairedAt, 1_700_000_000_000)
        XCTAssertEqual(decoded, original)
    }

    func testPairedDesktopIdMatchesPeerId() {
        let d = PairedDesktop(pcPeerId: "pc-1", deviceName: "x", pairedAt: 0, lastSeenAt: 0)
        XCTAssertEqual(d.id, d.pcPeerId)
    }

    // MARK: - PairingConfirmation

    func testPairingConfirmationFields() {
        let c = PairingConfirmation(
            pairingCode: "123456",
            pcPeerId: "pc-xyz",
            deviceInfo: ["name": "MacBook Pro", "platform": "darwin"],
            timestamp: 1_700_000_000_000
        )
        XCTAssertEqual(c.pairingCode, "123456")
        XCTAssertEqual(c.pcPeerId, "pc-xyz")
        XCTAssertEqual(c.deviceInfo?["platform"], "darwin")
    }

    // MARK: - PairingClock

    func testSystemPairingClockReturnsCurrentMillis() {
        let clock = SystemPairingClock()
        let now = clock.nowMillis()
        let expected = Int64(Date().timeIntervalSince1970 * 1000)
        // 允许 1 秒漂移
        XCTAssertLessThan(abs(now - expected), 1000)
    }

    // MARK: - SignalingConfig

    func testSignalingConfigRelayUrlDefault() {
        let suite = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        XCTAssertEqual(config.getRelayUrl(), SignalingConfig.defaultRelayUrl)
        XCTAssertNil(config.getCustomSignalingUrl())
    }

    func testSignalingConfigPersistence() {
        let suite = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let config = SignalingConfig(userDefaults: suite)
        config.setCustomSignalingUrl("ws://192.168.1.20:9001")
        config.setRelayUrl("wss://relay.example.com")
        XCTAssertEqual(config.getCustomSignalingUrl(), "ws://192.168.1.20:9001")
        XCTAssertEqual(config.getRelayUrl(), "wss://relay.example.com")
    }

    // MARK: - PairingMessageBus

    func testDefaultPairingMessageBusEmitAndReceive() async {
        let bus = DefaultPairingMessageBus()
        let confirmation = PairingConfirmation(
            pairingCode: "654321",
            pcPeerId: "pc-1",
            deviceInfo: nil,
            timestamp: 0
        )
        // 起订阅前发不出去（buffer-newest，没人接 = 丢）；订阅起来后再发
        let task = Task { () -> PairingConfirmation? in
            for await c in bus.confirmations {
                return c
            }
            return nil
        }
        // 给订阅者一点时间起 task
        try? await Task.sleep(nanoseconds: 10_000_000)
        bus.emit(confirmation)
        let received = await task.value
        XCTAssertEqual(received?.pairingCode, "654321")
    }

    // MARK: - PairedDesktopsStore (Phase 1.4 占位)

    func testPairedDesktopsStoreInitialState() async {
        let suite = UserDefaults(suiteName: "test-\(UUID().uuidString)")!
        let store = PairedDesktopsStore(userDefaults: suite, key: "test")
        let devices = await store.devices()
        XCTAssertTrue(devices.isEmpty, "Phase 1.1 占位返空，1.4 接 UserDefaults 持久化")
    }
}
