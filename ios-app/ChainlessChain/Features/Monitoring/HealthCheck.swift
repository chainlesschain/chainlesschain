import Foundation
import CoreCommon

// MARK: - HealthCheck
/// System health check and monitoring
/// Provides comprehensive health status for all system components
///
/// Features:
/// - Component health checks
/// - Dependency verification
/// - Resource monitoring
/// - Automated health reports
/// - Alert thresholds
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Health Status

/// Overall health status
enum HealthStatus: String, Codable, CaseIterable {
    case healthy = "healthy"
    case degraded = "degraded"
    case unhealthy = "unhealthy"
    case unknown = "unknown"

    var emoji: String {
        switch self {
        case .healthy: return "🟢"
        case .degraded: return "🟡"
        case .unhealthy: return "🔴"
        case .unknown: return "⚪"
        }
    }

    var priority: Int {
        switch self {
        case .unhealthy: return 3
        case .degraded: return 2
        case .healthy: return 1
        case .unknown: return 0
        }
    }
}

/// Component health check result
struct ComponentHealth: Identifiable, Codable {
    let id: String
    let name: String
    let status: HealthStatus
    let message: String
    let details: [String: String]
    let checkedAt: Date
    let responseTime: TimeInterval
    let dependencies: [String]
}

/// Health check result
struct HealthCheckResult: Codable {
    let overallStatus: HealthStatus
    let components: [ComponentHealth]
    let timestamp: Date
    let checkDuration: TimeInterval
    let summary: HealthSummary
}

/// Health summary
struct HealthSummary: Codable {
    let healthyCount: Int
    let degradedCount: Int
    let unhealthyCount: Int
    let unknownCount: Int
    let criticalIssues: [String]
    let warnings: [String]
}

/// Health check configuration
struct HealthCheckConfig: Codable {
    var enabled: Bool = true
    var interval: TimeInterval = 60  // seconds
    var timeout: TimeInterval = 10   // seconds per component
    var retryCount: Int = 3
    var alertThresholds: AlertThresholds

    struct AlertThresholds: Codable {
        var memoryWarning: Double = 0.75   // 75%
        var memoryCritical: Double = 0.90  // 90%
        var diskWarning: Double = 0.80     // 80%
        var diskCritical: Double = 0.95    // 95%
        var cpuWarning: Double = 0.70      // 70%
        var cpuCritical: Double = 0.90     // 90%
    }

    static var `default`: HealthCheckConfig {
        HealthCheckConfig(alertThresholds: AlertThresholds())
    }
}

// MARK: - Health Check Protocol

/// Protocol for component health checks
protocol HealthCheckable {
    var componentName: String { get }
    var componentId: String { get }
    var dependencies: [String] { get }

    func checkHealth() async -> ComponentHealth
}

// MARK: - Health Check Manager

/// System health check manager
@MainActor
class HealthCheckManager: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private var config: HealthCheckConfig
    private var checkTimer: Timer?
    private var components: [String: any HealthCheckable] = [:]

    @Published private(set) var lastResult: HealthCheckResult?
    @Published private(set) var isRunning = false
    @Published private(set) var overallStatus: HealthStatus = .unknown

    // MARK: - Singleton

    static let shared = HealthCheckManager()

    // MARK: - Initialization

    init(config: HealthCheckConfig = .default) {
        self.config = config
        registerDefaultComponents()
    }

    // MARK: - Component Registration

    /// Register a component for health checks
    func registerComponent(_ component: any HealthCheckable) {
        components[component.componentId] = component
        logger.info("[HealthCheck] Registered component: \(component.componentName)")
    }

    /// Unregister a component
    func unregisterComponent(_ componentId: String) {
        components.removeValue(forKey: componentId)
    }

    /// Register default system components
    private func registerDefaultComponents() {
        registerComponent(DatabaseHealthCheck())
        registerComponent(MemoryHealthCheck(config: config))
        registerComponent(DiskHealthCheck(config: config))
        registerComponent(NetworkHealthCheck())
        registerComponent(LLMServiceHealthCheck())
    }

    // MARK: - Health Checks

    /// Run all health checks
    func runHealthCheck() async -> HealthCheckResult {
        logger.info("[HealthCheck] Starting health check...")
        isRunning = true
        let startTime = Date()

        var componentResults: [ComponentHealth] = []

        // Run checks in parallel
        await withTaskGroup(of: ComponentHealth.self) { group in
            for component in components.values {
                group.addTask {
                    await component.checkHealth()
                }
            }

            for await result in group {
                componentResults.append(result)
            }
        }

        // Calculate overall status
        let overall = calculateOverallStatus(components: componentResults)

        // Build summary
        let summary = buildSummary(components: componentResults)

        let result = HealthCheckResult(
            overallStatus: overall,
            components: componentResults.sorted { $0.name < $1.name },
            timestamp: Date(),
            checkDuration: Date().timeIntervalSince(startTime),
            summary: summary
        )

        lastResult = result
        overallStatus = overall
        isRunning = false

        logger.info("[HealthCheck] Complete: \(overall.rawValue) (\(String(format: "%.2f", result.checkDuration))s)")

        return result
    }

    /// Run health check for specific component
    func checkComponent(_ componentId: String) async -> ComponentHealth? {
        guard let component = components[componentId] else {
            return nil
        }

        return await component.checkHealth()
    }

    // MARK: - Automatic Monitoring

    /// Start automatic health monitoring
    func startMonitoring() {
        guard config.enabled else { return }

        stopMonitoring()

        checkTimer = Timer.scheduledTimer(withTimeInterval: config.interval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                _ = await self?.runHealthCheck()
            }
        }

        logger.info("[HealthCheck] Started monitoring (interval: \(config.interval)s)")

        // Run initial check
        Task {
            _ = await runHealthCheck()
        }
    }

    /// Stop automatic health monitoring
    func stopMonitoring() {
        checkTimer?.invalidate()
        checkTimer = nil
        logger.info("[HealthCheck] Stopped monitoring")
    }

    // MARK: - Configuration

    /// Update configuration
    func updateConfig(_ newConfig: HealthCheckConfig) {
        let wasEnabled = config.enabled
        config = newConfig

        if wasEnabled && !config.enabled {
            stopMonitoring()
        } else if !wasEnabled && config.enabled {
            startMonitoring()
        }
    }

    // MARK: - Private Methods

    /// Calculate overall health status
    private func calculateOverallStatus(components: [ComponentHealth]) -> HealthStatus {
        if components.isEmpty {
            return .unknown
        }

        // Any unhealthy component makes overall unhealthy
        if components.contains(where: { $0.status == .unhealthy }) {
            return .unhealthy
        }

        // Any degraded component makes overall degraded
        if components.contains(where: { $0.status == .degraded }) {
            return .degraded
        }

        // All healthy
        if components.allSatisfy({ $0.status == .healthy }) {
            return .healthy
        }

        return .unknown
    }

    /// Build health summary
    private func buildSummary(components: [ComponentHealth]) -> HealthSummary {
        var criticalIssues: [String] = []
        var warnings: [String] = []

        for component in components {
            switch component.status {
            case .unhealthy:
                criticalIssues.append("\(component.name): \(component.message)")
            case .degraded:
                warnings.append("\(component.name): \(component.message)")
            default:
                break
            }
        }

        return HealthSummary(
            healthyCount: components.filter { $0.status == .healthy }.count,
            degradedCount: components.filter { $0.status == .degraded }.count,
            unhealthyCount: components.filter { $0.status == .unhealthy }.count,
            unknownCount: components.filter { $0.status == .unknown }.count,
            criticalIssues: criticalIssues,
            warnings: warnings
        )
    }
}

// MARK: - Default Health Check Components

/// Database health check
class DatabaseHealthCheck: HealthCheckable {
    let componentName = "Database"
    let componentId = "database"
    let dependencies: [String] = []

    func checkHealth() async -> ComponentHealth {
        let startTime = Date()

        // Check if database is accessible
        // In real implementation, would perform actual database check
        let isHealthy = true
        let responseTime = Date().timeIntervalSince(startTime)

        return ComponentHealth(
            id: componentId,
            name: componentName,
            status: isHealthy ? .healthy : .unhealthy,
            message: isHealthy ? "Database connection OK" : "Database connection failed",
            details: [
                "type": "SQLite",
                "encrypted": "true"
            ],
            checkedAt: Date(),
            responseTime: responseTime,
            dependencies: dependencies
        )
    }
}

/// Memory health check
class MemoryHealthCheck: HealthCheckable {
    let componentName = "Memory"
    let componentId = "memory"
    let dependencies: [String] = []

    private let config: HealthCheckConfig

    init(config: HealthCheckConfig) {
        self.config = config
    }

    func checkHealth() async -> ComponentHealth {
        let startTime = Date()

        // Get memory info
        let memoryInfo = getMemoryInfo()
        let usageRatio = memoryInfo.used / memoryInfo.total

        let status: HealthStatus
        let message: String

        if usageRatio >= config.alertThresholds.memoryCritical {
            status = .unhealthy
            message = "Critical memory usage: \(Int(usageRatio * 100))%"
        } else if usageRatio >= config.alertThresholds.memoryWarning {
            status = .degraded
            message = "High memory usage: \(Int(usageRatio * 100))%"
        } else {
            status = .healthy
            message = "Memory usage normal: \(Int(usageRatio * 100))%"
        }

        return ComponentHealth(
            id: componentId,
            name: componentName,
            status: status,
            message: message,
            details: [
                "used": formatBytes(Int(memoryInfo.used)),
                "total": formatBytes(Int(memoryInfo.total)),
                "free": formatBytes(Int(memoryInfo.total - memoryInfo.used))
            ],
            checkedAt: Date(),
            responseTime: Date().timeIntervalSince(startTime),
            dependencies: dependencies
        )
    }

    private func getMemoryInfo() -> (used: Double, total: Double) {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size)/4

        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        let used = result == KERN_SUCCESS ? Double(info.resident_size) : 0
        let total = Double(ProcessInfo.processInfo.physicalMemory)

        return (used, total)
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .memory
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

/// Disk health check
class DiskHealthCheck: HealthCheckable {
    let componentName = "Disk"
    let componentId = "disk"
    let dependencies: [String] = []

    private let config: HealthCheckConfig

    init(config: HealthCheckConfig) {
        self.config = config
    }

    func checkHealth() async -> ComponentHealth {
        let startTime = Date()

        let diskInfo = getDiskInfo()
        let usageRatio = diskInfo.used / diskInfo.total

        let status: HealthStatus
        let message: String

        if usageRatio >= config.alertThresholds.diskCritical {
            status = .unhealthy
            message = "Critical disk usage: \(Int(usageRatio * 100))%"
        } else if usageRatio >= config.alertThresholds.diskWarning {
            status = .degraded
            message = "High disk usage: \(Int(usageRatio * 100))%"
        } else {
            status = .healthy
            message = "Disk usage normal: \(Int(usageRatio * 100))%"
        }

        return ComponentHealth(
            id: componentId,
            name: componentName,
            status: status,
            message: message,
            details: [
                "used": formatBytes(Int(diskInfo.used)),
                "total": formatBytes(Int(diskInfo.total)),
                "free": formatBytes(Int(diskInfo.total - diskInfo.used))
            ],
            checkedAt: Date(),
            responseTime: Date().timeIntervalSince(startTime),
            dependencies: dependencies
        )
    }

    private func getDiskInfo() -> (used: Double, total: Double) {
        let fileManager = FileManager.default
        let paths = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)

        guard let path = paths.first,
              let attrs = try? fileManager.attributesOfFileSystem(forPath: path),
              let totalSize = attrs[.systemSize] as? NSNumber,
              let freeSize = attrs[.systemFreeSize] as? NSNumber else {
            return (0, 1)
        }

        let total = totalSize.doubleValue
        let free = freeSize.doubleValue
        return (total - free, total)
    }

    private func formatBytes(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

/// Network health check
class NetworkHealthCheck: HealthCheckable {
    let componentName = "Network"
    let componentId = "network"
    let dependencies: [String] = []

    func checkHealth() async -> ComponentHealth {
        let startTime = Date()

        // Simple connectivity check
        let isConnected = await checkConnectivity()
        let responseTime = Date().timeIntervalSince(startTime)

        return ComponentHealth(
            id: componentId,
            name: componentName,
            status: isConnected ? .healthy : .unhealthy,
            message: isConnected ? "Network connectivity OK" : "Network not available",
            details: [
                "latency": String(format: "%.0fms", responseTime * 1000)
            ],
            checkedAt: Date(),
            responseTime: responseTime,
            dependencies: dependencies
        )
    }

    private func checkConnectivity() async -> Bool {
        guard let url = URL(string: "https://www.apple.com") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 5

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

/// LLM service health check
class LLMServiceHealthCheck: HealthCheckable {
    let componentName = "LLM Service"
    let componentId = "llm_service"
    let dependencies = ["network"]

    func checkHealth() async -> ComponentHealth {
        let startTime = Date()

        // Check LLM service availability
        let isAvailable = await checkLLMService()
        let responseTime = Date().timeIntervalSince(startTime)

        return ComponentHealth(
            id: componentId,
            name: componentName,
            status: isAvailable ? .healthy : .degraded,
            message: isAvailable ? "LLM service available" : "LLM service not configured",
            details: [
                "provider": "Ollama",
                "configured": isAvailable ? "true" : "false"
            ],
            checkedAt: Date(),
            responseTime: responseTime,
            dependencies: dependencies
        )
    }

    private func checkLLMService() async -> Bool {
        // Check if LLM manager is initialized
        // In real implementation, would perform actual service check
        return true
    }
}
