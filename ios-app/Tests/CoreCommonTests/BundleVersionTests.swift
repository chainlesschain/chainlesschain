import XCTest
@testable import CoreCommon

/// 验证 Bundle 版本号 helper 与 AppConstants.App 动态字段。
///
/// 背景：v5.0.3.63 release 之前 `AppConstants.App.version` 是硬编码 `"0.32.0"`,
/// `buildNumber` 是 `"32"`,`bundleId` 是错误的 `"com.chainlesschain.ios"`。SettingsView
/// 显示这俩，导致用户在 5.0.3.63 .ipa 上看到的「版本」栏依然是 0.32.0。
/// 这套测试锁死这些值必须从 Bundle 动态读取。
final class BundleVersionTests: XCTestCase {

    // MARK: - Bundle Extension

    func testAppShortVersionIsNotEmpty() {
        XCTAssertFalse(Bundle.appShortVersion.isEmpty,
                       "appShortVersion 必须返回非空值（从 Bundle 取不到时也要 fallback 默认）")
    }

    func testAppBuildNumberIsNotEmpty() {
        XCTAssertFalse(Bundle.appBuildNumber.isEmpty,
                       "appBuildNumber 必须返回非空值")
    }

    func testAppFullVersionFormat() {
        // 在 unit test bundle 中 CFBundleShortVersionString 可能不存在，fallback 为 "0.0.0"。
        // 不论 fallback 还是真值,必须是 4 段制 X.Y.Z.N。
        let full = Bundle.appFullVersion
        let segments = full.split(separator: ".")
        XCTAssertEqual(segments.count, 4,
                       "appFullVersion 必须是 4 段制 X.Y.Z.N,实际 = \(full)")
        for seg in segments {
            XCTAssertFalse(seg.isEmpty, "appFullVersion 段不能为空: \(full)")
        }
    }

    func testAppFullVersionTagHasVPrefix() {
        let tag = Bundle.appFullVersionTag
        XCTAssertTrue(tag.hasPrefix("v"), "appFullVersionTag 必须以 v 开头,实际 = \(tag)")
        let withoutV = String(tag.dropFirst())
        XCTAssertEqual(withoutV, Bundle.appFullVersion,
                       "appFullVersionTag 去掉 v 后必须等于 appFullVersion")
    }

    func testAppDisplayNameIsNotEmpty() {
        XCTAssertFalse(Bundle.appDisplayName.isEmpty)
    }

    // MARK: - AppConstants.App Bridging

    func testAppConstantsVersionDelegatesToBundle() {
        XCTAssertEqual(AppConstants.App.version, Bundle.appShortVersion,
                       "AppConstants.App.version 必须从 Bundle 动态读 — 不能 stale 硬编码")
    }

    func testAppConstantsBuildNumberDelegatesToBundle() {
        XCTAssertEqual(AppConstants.App.buildNumber, Bundle.appBuildNumber)
    }

    func testAppConstantsFullVersionFormat() {
        XCTAssertEqual(AppConstants.App.fullVersion, Bundle.appFullVersion)
    }

    func testAppConstantsFullVersionTagFormat() {
        XCTAssertEqual(AppConstants.App.fullVersionTag, Bundle.appFullVersionTag)
    }

    func testAppConstantsBundleIdNotLegacyValue() {
        // 历史 bug:`AppConstants.App.bundleId` 曾硬编码为 `com.chainlesschain.ios`,
        // 但真实 Info.plist 配的是 `com.chainlesschain.ChainlessChain` (CodeSign 也基于这个)。
        // 改成 Bundle.main.bundleIdentifier 动态读后,此值不应再是 legacy `.ios` 字串。
        XCTAssertNotEqual(AppConstants.App.bundleId, "com.chainlesschain.ios",
                          "bundleId 必须从 Bundle.main.bundleIdentifier 动态读, 不能 stale 硬编码")
    }

    func testAppNameIsChainlessChain() {
        XCTAssertEqual(AppConstants.App.name, "ChainlessChain")
    }

    // MARK: - 锁版本号语义

    func testFullVersionStartsWithShortVersion() {
        let full = Bundle.appFullVersion
        let short = Bundle.appShortVersion
        XCTAssertTrue(full.hasPrefix(short + "."),
                      "appFullVersion (\(full)) 必须以 appShortVersion (\(short)) + . 开头")
    }

    func testFullVersionEndsWithBuildNumber() {
        let full = Bundle.appFullVersion
        let build = Bundle.appBuildNumber
        XCTAssertTrue(full.hasSuffix("." + build),
                      "appFullVersion (\(full)) 必须以 . + appBuildNumber (\(build)) 结尾")
    }
}
