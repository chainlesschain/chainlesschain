import Foundation
import CoreCommon

// MARK: - CrashReporter
/// Crash collection and reporting system
/// Captures, stores, and reports application crashes
///
/// Features:
/// - Crash capture with symbolication
/// - Device and app context collection
/// - Local crash storage
/// - Crash grouping and deduplication
/// - Report generation
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Crash Types

/// Crash report
struct CrashReport: Identifiable, Codable {
    let id: String
    let timestamp: Date
    let crashType: CrashType
    let reason: String
    let stackTrace: String
    let appContext: AppContext
    let deviceContext: DeviceContext
    let userInfo: [String: String]
    var status: CrashStatus
    var groupId: String?

    init(
        id: String = UUID().uuidString,
        crashType: CrashType,
        reason: String,
        stackTrace: String,
        appContext: AppContext,
        deviceContext: DeviceContext,
        userInfo: [String: String] = [:]
    ) {
        self.id = id
        self.timestamp = Date()
        self.crashType = crashType
        self.reason = reason
        self.stackTrace = stackTrace
        self.appContext = appContext
        self.deviceContext = deviceContext
        self.userInfo = userInfo
        self.status = .new
        self.groupId = nil
    }
}

/// Crash type
enum CrashType: String, Codable, CaseIterable {
    case signal = "signal"                  // SIGSEGV, SIGBUS, etc.
    case exception = "exception"            // NSException, Swift error
    case outOfMemory = "out_of_memory"      // OOM
    case watchdog = "watchdog"              // App hang/watchdog timeout
    case cpuLimit = "cpu_limit"             // CPU resource limit exceeded
    case unknown = "unknown"
}

/// Crash status
enum CrashStatus: String, Codable {
    case new = "new"
    case grouped = "grouped"
    case reported = "reported"
    case resolved = "resolved"
    case ignored = "ignored"
}

/// Application context at crash time
struct AppContext: Codable {
    let appVersion: String
    let buildNumber: String
    let bundleId: String
    let launchTime: Date
    let uptime: TimeInterval
    let foreground: Bool
    let currentScreen: String?
    let recentActions: [String]
}

/// Device context
struct DeviceContext: Codable {
    let model: String
    let osVersion: String
    let osName: String
    let locale: String
    let timezone: String
    let memoryTotal: UInt64
    let memoryFree: UInt64
    let diskTotal: UInt64
    let diskFree: UInt64
    let batteryLevel: Float?
    let isCharging: Bool?
    let jailbroken: Bool
}

/// Crash group (for deduplication)
struct CrashGroup: Identifiable, Codable {
    let id: String
    let signature: String  // Unique crash signature
    let crashType: CrashType
    let reason: String
    let firstSeen: Date
    var lastSeen: Date
    var occurrenceCount: Int
    var affectedVersions: Set<String>
    var crashIds: [String]
}

/// Crash statistics
struct CrashStats: Codable {
    let totalCrashes: Int
    let crashesByType: [String: Int]
    let crashesByVersion: [String: Int]
    let crashFreeTrends: [DayTrend]
    let topCrashGroups: [CrashGroupSummary]
    let crashFreeRate: Double

    struct DayTrend: Codable {
        let date: Date
        let crashes: Int
        let sessions: Int
    }

    struct CrashGroupSummary: Codable {
        let groupId: String
        let reason: String
        let count: Int
        let lastSeen: Date
    }
}

// MARK: - Crash Reporter

/// Crash reporter and collector
@MainActor
class CrashReporter: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private let fileManager = FileManager.default
    private var crashesDirectory: URL

    @Published private(set) var crashes: [String: CrashReport] = [:]
    @Published private(set) var crashGroups: [String: CrashGroup] = [:]
    @Published private(set) var stats: CrashStats?
    @Published private(set) var isEnabled = true

    private var recentActions: [String] = []
    private let maxRecentActions = 50
    private var launchTime: Date = Date()

    // MARK: - Singleton

    static let shared = CrashReporter()

    // MARK: - Initialization

    init() {
        // Setup crashes directory
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        crashesDirectory = appSupport.appendingPathComponent("Crashes", isDirectory: true)

        try? fileManager.createDirectory(at: crashesDirectory, withIntermediateDirectories: true)

        // Load existing crashes
        loadCrashes()

        // Setup crash handlers
        setupCrashHandlers()

        logger.info("[CrashReporter] Initialized")
    }

    // MARK: - Setup

    /// Setup crash handlers
    private func setupCrashHandlers() {
        // Note: In a real implementation, this would set up:
        // - Signal handlers (SIGSEGV, SIGBUS, SIGABRT, etc.)
        // - NSUncaughtExceptionHandler
        // - Thread monitoring

        // For this implementation, we'll capture Swift errors manually
    }

    /// Record user action (for crash context)
    func recordAction(_ action: String) {
        recentActions.append("\(Date().timeIntervalSince1970): \(action)")
        if recentActions.count > maxRecentActions {
            recentActions.removeFirst()
        }
    }

    // MARK: - Crash Capture

    /// Capture a crash
    func captureCrash(
        type: CrashType,
        reason: String,
        stackTrace: String? = nil,
        userInfo: [String: String] = [:]
    ) {
        let trace = stackTrace ?? Thread.callStackSymbols.joined(separator: "\n")

        let appContext = buildAppContext()
        let deviceContext = buildDeviceContext()

        let crash = CrashReport(
            crashType: type,
            reason: reason,
            stackTrace: trace,
            appContext: appContext,
            deviceContext: deviceContext,
            userInfo: userInfo
        )

        addCrash(crash)
    }

    /// Capture Swift error as crash
    func captureError(_ error: Error, context: String? = nil) {
        let reason = context.map { "\($0): \(error.localizedDescription)" } ?? error.localizedDescription

        captureCrash(
            type: .exception,
            reason: reason,
            userInfo: ["errorType": String(describing: type(of: error))]
        )
    }

    /// Add crash to storage
    private func addCrash(_ crash: CrashReport) {
        var mutableCrash = crash

        // Find or create crash group
        let signature = generateCrashSignature(crash)
        if let existingGroup = crashGroups.values.first(where: { $0.signature == signature }) {
            // Add to existing group
            var group = existingGroup
            group.occurrenceCount += 1
            group.lastSeen = Date()
            group.crashIds.append(crash.id)
            group.affectedVersions.insert(crash.appContext.appVersion)
            crashGroups[group.id] = group

            mutableCrash.groupId = group.id
            mutableCrash.status = .grouped
        } else {
            // Create new group
            let group = CrashGroup(
                id: UUID().uuidString,
                signature: signature,
                crashType: crash.crashType,
                reason: crash.reason,
                firstSeen: Date(),
                lastSeen: Date(),
                occurrenceCount: 1,
                affectedVersions: [crash.appContext.appVersion],
                crashIds: [crash.id]
            )
            crashGroups[group.id] = group

            mutableCrash.groupId = group.id
            mutableCrash.status = .grouped
        }

        crashes[crash.id] = mutableCrash

        // Save crash
        saveCrash(mutableCrash)

        // Update stats
        updateStats()

        logger.error("[CrashReporter] Captured crash: \(crash.crashType.rawValue) - \(crash.reason)")
    }

    // MARK: - Context Building

    /// Build app context
    private func buildAppContext() -> AppContext {
        let bundle = Bundle.main
        let appVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        let buildNumber = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
        let bundleId = bundle.bundleIdentifier ?? "Unknown"

        return AppContext(
            appVersion: appVersion,
            buildNumber: buildNumber,
            bundleId: bundleId,
            launchTime: launchTime,
            uptime: Date().timeIntervalSince(launchTime),
            foreground: true,  // Would check UIApplication.shared.applicationState
            currentScreen: nil,  // Would track current view
            recentActions: recentActions
        )
    }

    /// Build device context
    private func buildDeviceContext() -> DeviceContext {
        let processInfo = ProcessInfo.processInfo

        return DeviceContext(
            model: getDeviceModel(),
            osVersion: processInfo.operatingSystemVersionString,
            osName: "iOS",
            locale: Locale.current.identifier,
            timezone: TimeZone.current.identifier,
            memoryTotal: processInfo.physicalMemory,
            memoryFree: getFreeMemory(),
            diskTotal: getDiskSpace().total,
            diskFree: getDiskSpace().free,
            batteryLevel: nil,  // Would get from UIDevice
            isCharging: nil,
            jailbroken: isJailbroken()
        )
    }

    /// Get device model
    private func getDeviceModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machineMirror = Mirror(reflecting: systemInfo.machine)
        let identifier = machineMirror.children.reduce("") { identifier, element in
            guard let value = element.value as? Int8, value != 0 else { return identifier }
            return identifier + String(UnicodeScalar(UInt8(value)))
        }
        return identifier
    }

    /// Get free memory
    private func getFreeMemory() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size)/4

        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        if result == KERN_SUCCESS {
            return ProcessInfo.processInfo.physicalMemory - info.resident_size
        }
        return 0
    }

    /// Get disk space
    private func getDiskSpace() -> (total: UInt64, free: UInt64) {
        let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)
        guard let path = paths.first,
              let attrs = try? fileManager.attributesOfFileSystem(forPath: path),
              let total = attrs[.systemSize] as? NSNumber,
              let free = attrs[.systemFreeSize] as? NSNumber else {
            return (0, 0)
        }
        return (total.uint64Value, free.uint64Value)
    }

    /// Check if device is jailbroken
    private func isJailbroken() -> Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        let jailbreakPaths = [
            "/Applications/Cydia.app",
            "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/bin/bash",
            "/usr/sbin/sshd",
            "/etc/apt"
        ]

        for path in jailbreakPaths {
            if fileManager.fileExists(atPath: path) {
                return true
            }
        }
        return false
        #endif
    }

    // MARK: - Crash Signature

    /// Generate crash signature for grouping
    private func generateCrashSignature(_ crash: CrashReport) -> String {
        // Extract key frames from stack trace
        let frames = crash.stackTrace
            .components(separatedBy: "\n")
            .prefix(5)
            .map { frame -> String in
                // Extract function name from frame
                if let range = frame.range(of: "\\$[\\w]+", options: .regularExpression) {
                    return String(frame[range])
                }
                return frame
            }
            .joined(separator: "|")

        // Create signature from type + reason + top frames
        let components = [crash.crashType.rawValue, crash.reason, frames]
        let combined = components.joined(separator: "::")

        // Hash the combined string
        return combined.hashValue.description
    }

    // MARK: - Storage

    /// Save crash to disk
    private func saveCrash(_ crash: CrashReport) {
        let url = crashesDirectory.appendingPathComponent("\(crash.id).json")

        do {
            let data = try JSONEncoder().encode(crash)
            try data.write(to: url)
        } catch {
            logger.error("[CrashReporter] Failed to save crash: \(error)")
        }
    }

    /// Load crashes from disk
    private func loadCrashes() {
        do {
            let files = try fileManager.contentsOfDirectory(at: crashesDirectory, includingPropertiesForKeys: nil)

            for file in files where file.pathExtension == "json" {
                if let data = try? Data(contentsOf: file),
                   let crash = try? JSONDecoder().decode(CrashReport.self, from: data) {
                    crashes[crash.id] = crash
                }
            }

            // Rebuild groups
            rebuildCrashGroups()

            logger.info("[CrashReporter] Loaded \(crashes.count) crashes")
        } catch {
            logger.error("[CrashReporter] Failed to load crashes: \(error)")
        }
    }

    /// Rebuild crash groups from loaded crashes
    private func rebuildCrashGroups() {
        crashGroups.removeAll()

        for crash in crashes.values {
            let signature = generateCrashSignature(crash)

            if var group = crashGroups.values.first(where: { $0.signature == signature }) {
                group.occurrenceCount += 1
                group.crashIds.append(crash.id)
                group.affectedVersions.insert(crash.appContext.appVersion)
                if crash.timestamp > group.lastSeen {
                    group.lastSeen = crash.timestamp
                }
                if crash.timestamp < group.firstSeen {
                    // Note: firstSeen is let, would need to make it var for this
                }
                crashGroups[group.id] = group
            } else {
                let group = CrashGroup(
                    id: UUID().uuidString,
                    signature: signature,
                    crashType: crash.crashType,
                    reason: crash.reason,
                    firstSeen: crash.timestamp,
                    lastSeen: crash.timestamp,
                    occurrenceCount: 1,
                    affectedVersions: [crash.appContext.appVersion],
                    crashIds: [crash.id]
                )
                crashGroups[group.id] = group
            }
        }

        updateStats()
    }

    // MARK: - Statistics

    /// Update crash statistics
    private func updateStats() {
        var byType: [String: Int] = [:]
        var byVersion: [String: Int] = [:]

        for crash in crashes.values {
            byType[crash.crashType.rawValue, default: 0] += 1
            byVersion[crash.appContext.appVersion, default: 0] += 1
        }

        let topGroups = crashGroups.values
            .sorted { $0.occurrenceCount > $1.occurrenceCount }
            .prefix(10)
            .map { CrashStats.CrashGroupSummary(
                groupId: $0.id,
                reason: $0.reason,
                count: $0.occurrenceCount,
                lastSeen: $0.lastSeen
            )}

        stats = CrashStats(
            totalCrashes: crashes.count,
            crashesByType: byType,
            crashesByVersion: byVersion,
            crashFreeTrends: [],  // Would calculate from session data
            topCrashGroups: Array(topGroups),
            crashFreeRate: 0.99  // Would calculate from session data
        )
    }

    // MARK: - Reporting

    /// Generate crash report for submission
    func generateReport(for crashId: String) -> String? {
        guard let crash = crashes[crashId] else { return nil }

        return """
        =========== CRASH REPORT ===========
        ID: \(crash.id)
        Type: \(crash.crashType.rawValue)
        Time: \(crash.timestamp)

        Reason:
        \(crash.reason)

        === App Context ===
        Version: \(crash.appContext.appVersion) (\(crash.appContext.buildNumber))
        Uptime: \(String(format: "%.1f", crash.appContext.uptime))s

        === Device Context ===
        Model: \(crash.deviceContext.model)
        OS: \(crash.deviceContext.osName) \(crash.deviceContext.osVersion)

        === Stack Trace ===
        \(crash.stackTrace)

        === Recent Actions ===
        \(crash.appContext.recentActions.joined(separator: "\n"))
        ====================================
        """
    }

    /// Export all crashes
    func exportAllCrashes() -> Data? {
        return try? JSONEncoder().encode(Array(crashes.values))
    }

    // MARK: - Management

    /// Mark crash as resolved
    func resolveCrash(_ crashId: String) {
        crashes[crashId]?.status = .resolved
        saveCrash(crashes[crashId]!)
    }

    /// Delete crash
    func deleteCrash(_ crashId: String) {
        crashes.removeValue(forKey: crashId)

        let url = crashesDirectory.appendingPathComponent("\(crashId).json")
        try? fileManager.removeItem(at: url)

        rebuildCrashGroups()
    }

    /// Clear all crashes
    func clearAllCrashes() {
        crashes.removeAll()
        crashGroups.removeAll()

        if let files = try? fileManager.contentsOfDirectory(at: crashesDirectory, includingPropertiesForKeys: nil) {
            for file in files {
                try? fileManager.removeItem(at: file)
            }
        }

        updateStats()
    }

    /// Get crashes for a group
    func getCrashes(forGroup groupId: String) -> [CrashReport] {
        guard let group = crashGroups[groupId] else { return [] }
        return group.crashIds.compactMap { crashes[$0] }
    }
}
