/**
 * AppStateNotificationTests.swift
 *
 * Integration tests verifying that posting `databaseUnlocked` / `didAuthenticated`
 * notifications does not crash on iOS 16 — the v5.0.3.63 fix replaced
 * `MainActor.assumeIsolated` (iOS 17+) with `Task { @MainActor in ... }` (iOS 13+
 * back-deploy). These tests pin the contract so a future refactor reintroducing
 * an iOS 17-only API in the observer path will fail fast.
 */

import XCTest
import CoreCommon
@testable import ChainlessChain

@MainActor
final class AppStateNotificationTests: XCTestCase {

    // MARK: - Setup & Teardown

    private var appState: AppState!

    override func setUp() async throws {
        // AppState is a singleton; we test through the shared instance.
        appState = AppState.shared

        // Reset publishable state to a known baseline.
        appState.isAuthenticated = false
        appState.isDatabaseUnlocked = false
    }

    override func tearDown() async throws {
        appState = nil
    }

    // MARK: - Notification Observer Smoke Tests

    /// 主回归测试:posting databaseUnlocked notification 必须不崩(iOS 16 兼容)。
    /// v5.0.3.62 之前 observer closure 用 `MainActor.assumeIsolated`,该 API iOS 17+,
    /// 在 iOS 16 上 dyld 找不到符号 → 通知触发瞬间崩。v5.0.3.63 改成
    /// `Task { @MainActor in ... }` 走 iOS 13+ back-deploy。
    func testDatabaseUnlockedNotificationDoesNotCrash() async throws {
        // When: 触发观察的通知
        NotificationCenter.default.post(
            name: AppConstants.Notification.databaseUnlocked,
            object: nil
        )

        // Then: 等下一个 main runloop tick 给 Task @MainActor 调度到
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms

        XCTAssertTrue(appState.isDatabaseUnlocked,
                      "databaseUnlocked notification 应该把 isDatabaseUnlocked flip 到 true")
    }

    func testDidAuthenticatedNotificationDoesNotCrash() async throws {
        NotificationCenter.default.post(
            name: AppConstants.Notification.didAuthenticated,
            object: nil
        )

        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(appState.isAuthenticated,
                      "didAuthenticated notification 应该把 isAuthenticated flip 到 true")
    }

    /// 高频反复 post,确保 Task @MainActor 重复调度不漏不崩。
    func testRepeatedNotificationPostsRemainStable() async throws {
        for _ in 0..<50 {
            NotificationCenter.default.post(
                name: AppConstants.Notification.didAuthenticated,
                object: nil
            )
        }

        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(appState.isAuthenticated)
    }

    // MARK: - 版本号显示防回归

    /// 锁死:UI 用的版本字符串必须 4 段制 (与 desktop / Android 对齐),
    /// 而不是 3 段制 `5.0.3` 或 stale 硬编码 `0.32.0`。
    func testAppConstantsFullVersionIsFourSegments() {
        let full = AppConstants.App.fullVersion
        let segs = full.split(separator: ".")
        XCTAssertEqual(segs.count, 4,
                       "AppConstants.App.fullVersion 必须 4 段: \(full)")
    }

    func testAppConstantsFullVersionTagStartsWithV() {
        XCTAssertTrue(AppConstants.App.fullVersionTag.hasPrefix("v"))
    }

    /// 防 stale 硬编码回潮:AppConstants.App.version 在历史上是 "0.32.0"
    /// 硬编码 stale 了几个月。锁死它必须等同于 `Bundle.appShortVersion`
    /// (i.e. 从 Info.plist 动态读),不能再写死任何字面量。
    func testAppConstantsVersionNotStaleHardcoded() {
        XCTAssertNotEqual(AppConstants.App.version, "0.32.0",
                          "version 不能 stale 硬编码 0.32.0,必须从 Bundle 动态读")
        XCTAssertEqual(AppConstants.App.version, Bundle.appShortVersion)
    }

    func testAppConstantsBundleIdNotLegacyValue() {
        XCTAssertNotEqual(AppConstants.App.bundleId, "com.chainlesschain.ios",
                          "bundleId 不能 stale 硬编码,必须从 Bundle.main.bundleIdentifier 动态读")
    }
}
