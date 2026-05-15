import XCTest
@testable import CoreP2P

/// Phase 1.3 — `PairedDesktopsStore` 真持久化测试（提前完成 1.4 范围）。
final class PairedDesktopsStoreTests: XCTestCase {

    private func makeStore() -> (PairedDesktopsStore, UserDefaults, String) {
        let suiteName = "test-store-\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        let key = "test-key"
        return (PairedDesktopsStore(userDefaults: suite, key: key), suite, key)
    }

    private func makeDesktop(pcPeerId: String = "pc-1", name: String = "Test", pairedAt: Int64 = 1000) -> PairedDesktop {
        PairedDesktop(
            pcPeerId: pcPeerId,
            deviceName: name,
            platform: "darwin",
            lanSignalingUrl: "ws://192.168.1.10:9001",
            relayUrl: "wss://relay.test",
            iceServersJson: #"[{"urls":"stun:stun.l.google.com:19302"}]"#,
            iceExpiry: 2000,
            pairedAt: pairedAt,
            lastSeenAt: pairedAt
        )
    }

    func testInitialDevicesEmpty() async {
        let (store, _, _) = makeStore()
        let devices = await store.devices()
        XCTAssertTrue(devices.isEmpty)
    }

    func testUpsertAddsNewDevice() async {
        let (store, _, _) = makeStore()
        let d = makeDesktop()
        await store.upsert(d)
        let devices = await store.devices()
        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices[0].pcPeerId, "pc-1")
    }

    func testUpsertSamePeerIdPreservesPairedAt() async {
        let (store, _, _) = makeStore()
        await store.upsert(makeDesktop(pairedAt: 1000))
        await store.upsert(makeDesktop(name: "Renamed", pairedAt: 9999))
        let devices = await store.devices()
        XCTAssertEqual(devices.count, 1, "by pcPeerId 去重")
        XCTAssertEqual(devices[0].pairedAt, 1000, "首次配对时间不应被覆盖")
        XCTAssertEqual(devices[0].deviceName, "Renamed", "其它字段应被覆盖")
    }

    func testUpsertDifferentPeerIdAppendsBoth() async {
        let (store, _, _) = makeStore()
        await store.upsert(makeDesktop(pcPeerId: "pc-1"))
        await store.upsert(makeDesktop(pcPeerId: "pc-2"))
        let devices = await store.devices()
        XCTAssertEqual(devices.count, 2)
    }

    func testRemove() async {
        let (store, _, _) = makeStore()
        await store.upsert(makeDesktop(pcPeerId: "pc-1"))
        await store.upsert(makeDesktop(pcPeerId: "pc-2"))
        await store.remove(pcPeerId: "pc-1")
        let devices = await store.devices()
        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices[0].pcPeerId, "pc-2")
    }

    func testClear() async {
        let (store, _, _) = makeStore()
        await store.upsert(makeDesktop())
        await store.clear()
        let devices = await store.devices()
        XCTAssertTrue(devices.isEmpty)
    }

    func testPersistenceAcrossInstances() async {
        let suiteName = "test-persist-\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        let key = "persist-key"
        let store1 = PairedDesktopsStore(userDefaults: suite, key: key)
        await store1.upsert(makeDesktop(pcPeerId: "pc-persist", name: "Persisted Mac"))

        // 全新实例（模拟 app 重启）应能读到
        let store2 = PairedDesktopsStore(userDefaults: suite, key: key)
        let devices = await store2.devices()
        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices[0].pcPeerId, "pc-persist")
        XCTAssertEqual(devices[0].deviceName, "Persisted Mac")
        XCTAssertEqual(devices[0].iceServersJson, #"[{"urls":"stun:stun.l.google.com:19302"}]"#)
    }
}
