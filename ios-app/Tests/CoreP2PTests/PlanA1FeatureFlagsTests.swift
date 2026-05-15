import XCTest
@testable import CoreP2P

/// Phase 2.2 — `PlanA1FeatureFlags` UserDefaults 持久化 + 默认值测试。
final class PlanA1FeatureFlagsTests: XCTestCase {

    private func makeFlags() -> (PlanA1FeatureFlags, UserDefaults) {
        let suite = UserDefaults(suiteName: "test-flags-\(UUID().uuidString)")!
        return (PlanA1FeatureFlags(defaults: suite), suite)
    }

    func testDefaultsWhenUnset() {
        let (flags, _) = makeFlags()
        XCTAssertTrue(flags.preferDataChannel)
        XCTAssertEqual(flags.dcSendTimeoutMs, 5000)
        XCTAssertTrue(flags.fallbackOnDcFailure)
    }

    func testPersistsBoolFlags() {
        let (flags, _) = makeFlags()
        flags.preferDataChannel = false
        flags.fallbackOnDcFailure = false
        XCTAssertFalse(flags.preferDataChannel)
        XCTAssertFalse(flags.fallbackOnDcFailure)
    }

    func testPersistsTimeoutWithMinimum() {
        let (flags, _) = makeFlags()
        flags.dcSendTimeoutMs = 8000
        XCTAssertEqual(flags.dcSendTimeoutMs, 8000)

        // 太小 (< 100) 应被钳制
        flags.dcSendTimeoutMs = 10
        XCTAssertEqual(flags.dcSendTimeoutMs, 100)
    }

    func testPersistenceAcrossInstances() {
        let suiteName = "test-persist-\(UUID().uuidString)"
        let suite = UserDefaults(suiteName: suiteName)!
        let flags1 = PlanA1FeatureFlags(defaults: suite)
        flags1.preferDataChannel = false
        flags1.dcSendTimeoutMs = 7777

        let flags2 = PlanA1FeatureFlags(defaults: suite)
        XCTAssertFalse(flags2.preferDataChannel)
        XCTAssertEqual(flags2.dcSendTimeoutMs, 7777)
        XCTAssertTrue(flags2.fallbackOnDcFailure)  // 未改默认 true
    }

    func testZeroOrNegativeTimeoutFallsBackToDefault() {
        let (flags, suite) = makeFlags()
        // 直接写 0 模拟 stored=0 路径
        suite.set(0, forKey: "terminal.dcSendTimeoutMs")
        XCTAssertEqual(flags.dcSendTimeoutMs, 5000, "stored=0 should return default")
    }
}
