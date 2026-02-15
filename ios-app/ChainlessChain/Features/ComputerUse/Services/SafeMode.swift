//
//  SafeMode.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Permission and rate limiting safety system
//  Adapted from: desktop-app-vue/src/main/browser/actions/safe-mode.js
//

import Foundation
import UIKit
import Combine

// MARK: - Permission Check Result

/// Result of a permission check
public struct CUPermissionResult {
    public let allowed: Bool
    public let reason: String?
    public let requiresConfirmation: Bool

    public static let allow = CUPermissionResult(allowed: true, reason: nil, requiresConfirmation: false)

    public static func deny(reason: String) -> CUPermissionResult {
        CUPermissionResult(allowed: false, reason: reason, requiresConfirmation: false)
    }

    public static func confirm(reason: String) -> CUPermissionResult {
        CUPermissionResult(allowed: false, reason: reason, requiresConfirmation: true)
    }
}

// MARK: - Rate Limit Counter

/// Rate limit tracking per category
private struct RateLimitCounter {
    var minuteCount: Int = 0
    var hourCount: Int = 0
    var minuteReset: Date = Date().addingTimeInterval(60)
    var hourReset: Date = Date().addingTimeInterval(3600)

    mutating func increment() {
        let now = Date()
        if now >= minuteReset {
            minuteCount = 0
            minuteReset = now.addingTimeInterval(60)
        }
        if now >= hourReset {
            hourCount = 0
            hourReset = now.addingTimeInterval(3600)
        }
        minuteCount += 1
        hourCount += 1
    }

    func isWithinLimit(perMinute: Int, perHour: Int) -> Bool {
        let now = Date()
        let effectiveMinuteCount = now >= minuteReset ? 0 : minuteCount
        let effectiveHourCount = now >= hourReset ? 0 : hourCount
        return effectiveMinuteCount < perMinute && effectiveHourCount < perHour
    }
}

// MARK: - SafeMode

/// Safety and permission system for Computer Use operations
public class SafeMode: ObservableObject {
    public static let shared = SafeMode()

    @Published public var safetyLevel: CUSafetyLevel = .normal
    @Published public var isEnabled: Bool = true

    // URL filtering
    private var urlWhitelist: [String] = []
    private var urlBlacklist: [String] = ["*://*bank*", "*://*payment*", "*://*admin*"]

    // Restricted regions (areas where clicks are forbidden)
    private var restrictedRegions: [CURegion] = []

    // Rate limiting
    private var rateLimits: [CUActionCategory: (perMinute: Int, perHour: Int)] = [
        .readonly: (perMinute: 60, perHour: 1000),
        .navigation: (perMinute: 20, perHour: 200),
        .input: (perMinute: 30, perHour: 500),
        .click: (perMinute: 30, perHour: 500),
        .mobile: (perMinute: 20, perHour: 200),
        .network: (perMinute: 10, perHour: 100)
    ]
    private var counters: [CUActionCategory: RateLimitCounter] = [:]

    // Category permissions per safety level
    private let levelPermissions: [CUSafetyLevel: Set<CUActionCategory>] = [
        .unrestricted: Set(CUActionCategory.allCases),
        .normal: [.readonly, .navigation, .input, .click, .mobile],
        .cautious: [.readonly, .navigation, .click],
        .strict: [.readonly, .navigation],
        .readonly: [.readonly]
    ]

    // Confirmation requirement per level
    private let requiresConfirmation: [CUSafetyLevel: Set<CUActionCategory>] = [
        .unrestricted: [],
        .normal: [.network],
        .cautious: [.input, .click, .network],
        .strict: [.input, .click, .mobile, .network],
        .readonly: Set(CUActionCategory.allCases)
    ]

    // Confirmation handler
    private var confirmationHandler: ((String) async -> Bool)?

    private let queue = DispatchQueue(label: "com.chainlesschain.cu-safe-mode")

    private init() {
        Logger.shared.info("[SafeMode] Initialized, level: \(safetyLevel.rawValue)")
    }

    // MARK: - Permission Check

    /// Check if an action is permitted
    public func checkPermission(action: CUActionType, params: [String: AnyCodableValue] = [:]) async -> CUPermissionResult {
        guard isEnabled else { return .allow }

        let category = action.category

        // 1. Check category is allowed at current safety level
        guard let allowed = levelPermissions[safetyLevel], allowed.contains(category) else {
            return .deny(reason: "Action category '\(category.displayName)' is not allowed at safety level '\(safetyLevel.displayName)'")
        }

        // 2. Check rate limit
        let withinLimit = queue.sync { () -> Bool in
            guard let limit = rateLimits[category] else { return true }
            let counter = counters[category] ?? RateLimitCounter()
            return counter.isWithinLimit(perMinute: limit.perMinute, perHour: limit.perHour)
        }
        if !withinLimit {
            return .deny(reason: "Rate limit exceeded for \(category.displayName)")
        }

        // 3. Check URL blacklist/whitelist for navigation
        if action == .navigate, let url = params["url"]?.stringValue {
            let urlResult = checkURL(url)
            if !urlResult.allowed { return urlResult }
        }

        // 4. Check restricted regions for coordinate actions
        if let x = params["x"]?.doubleValue, let y = params["y"]?.doubleValue {
            let point = CUPoint(x: x, y: y)
            for region in restrictedRegions {
                if region.contains(point: point) {
                    return .deny(reason: "Coordinates (\(x), \(y)) are in a restricted region")
                }
            }
        }

        // 5. Check if confirmation is required
        if let confirmCategories = requiresConfirmation[safetyLevel],
           confirmCategories.contains(category) {
            if let handler = confirmationHandler {
                let message = "Allow \(action.displayName)?"
                let confirmed = await handler(message)
                if !confirmed {
                    return .deny(reason: "User denied confirmation")
                }
            } else {
                return .confirm(reason: "Action '\(action.displayName)' requires user confirmation at safety level '\(safetyLevel.displayName)'")
            }
        }

        // Increment rate counter
        queue.sync {
            if counters[category] == nil {
                counters[category] = RateLimitCounter()
            }
            counters[category]?.increment()
        }

        return .allow
    }

    // MARK: - URL Checking

    /// Check if a URL is allowed
    private func checkURL(_ url: String) -> CUPermissionResult {
        // Whitelist takes priority
        if !urlWhitelist.isEmpty {
            let isWhitelisted = urlWhitelist.contains { matchesPattern(url: url, pattern: $0) }
            if !isWhitelisted {
                return .deny(reason: "URL not in whitelist: \(url)")
            }
        }

        // Check blacklist
        let isBlacklisted = urlBlacklist.contains { matchesPattern(url: url, pattern: $0) }
        if isBlacklisted {
            return .deny(reason: "URL is blacklisted: \(url)")
        }

        return .allow
    }

    /// Simple glob pattern matching for URLs
    private func matchesPattern(url: String, pattern: String) -> Bool {
        let regexPattern = NSRegularExpression.escapedPattern(for: pattern)
            .replacingOccurrences(of: "\\*", with: ".*")
        guard let regex = try? NSRegularExpression(pattern: "^" + regexPattern + "$", options: .caseInsensitive) else {
            return false
        }
        return regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)) != nil
    }

    // MARK: - Configuration

    /// Set safety level
    public func setLevel(_ level: CUSafetyLevel) {
        safetyLevel = level
        Logger.shared.info("[SafeMode] Safety level changed to: \(level.rawValue)")
    }

    /// Set the confirmation handler
    public func setConfirmationHandler(_ handler: @escaping (String) async -> Bool) {
        confirmationHandler = handler
    }

    /// Add URL to whitelist
    public func addToWhitelist(_ pattern: String) {
        urlWhitelist.append(pattern)
    }

    /// Add URL to blacklist
    public func addToBlacklist(_ pattern: String) {
        urlBlacklist.append(pattern)
    }

    /// Remove URL from whitelist
    public func removeFromWhitelist(_ pattern: String) {
        urlWhitelist.removeAll { $0 == pattern }
    }

    /// Remove URL from blacklist
    public func removeFromBlacklist(_ pattern: String) {
        urlBlacklist.removeAll { $0 == pattern }
    }

    /// Add a restricted region
    public func addRestrictedRegion(_ region: CURegion) {
        restrictedRegions.append(region)
    }

    /// Clear restricted regions
    public func clearRestrictedRegions() {
        restrictedRegions.removeAll()
    }

    /// Set rate limit for a category
    public func setRateLimit(category: CUActionCategory, perMinute: Int, perHour: Int) {
        rateLimits[category] = (perMinute: perMinute, perHour: perHour)
    }

    /// Get current configuration
    public func getConfig() -> [String: Any] {
        [
            "isEnabled": isEnabled,
            "safetyLevel": safetyLevel.rawValue,
            "urlWhitelistCount": urlWhitelist.count,
            "urlBlacklistCount": urlBlacklist.count,
            "restrictedRegionsCount": restrictedRegions.count,
            "rateLimits": rateLimits.mapValues { ["perMinute": $0.perMinute, "perHour": $0.perHour] }
        ]
    }

    /// Reset all counters
    public func resetCounters() {
        queue.sync { counters.removeAll() }
    }
}
