import Foundation
import CoreCommon

// MARK: - ErrorMonitor
/// AI-powered error monitoring and diagnostics system
/// Provides intelligent error analysis and fix suggestions
///
/// Features:
/// - Error classification by type and severity
/// - AI-powered error diagnosis using local LLM
/// - Auto-fix suggestions
/// - Error pattern learning
/// - Historical error tracking
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Error Types

/// Error severity level
enum ErrorSeverity: String, Codable, CaseIterable {
    case critical = "critical"   // System failure, data loss risk
    case high = "high"           // Major feature broken
    case medium = "medium"       // Feature degraded
    case low = "low"             // Minor issue
    case info = "info"           // Informational

    var priority: Int {
        switch self {
        case .critical: return 5
        case .high: return 4
        case .medium: return 3
        case .low: return 2
        case .info: return 1
        }
    }

    var color: String {
        switch self {
        case .critical: return "red"
        case .high: return "orange"
        case .medium: return "yellow"
        case .low: return "blue"
        case .info: return "gray"
        }
    }
}

/// Error category
enum ErrorCategory: String, Codable, CaseIterable {
    case network = "network"
    case database = "database"
    case authentication = "authentication"
    case validation = "validation"
    case permission = "permission"
    case fileSystem = "file_system"
    case memory = "memory"
    case timeout = "timeout"
    case configuration = "configuration"
    case dependency = "dependency"
    case logic = "logic"
    case unknown = "unknown"
}

/// Monitored error entry
struct MonitoredError: Identifiable, Codable {
    let id: String
    let timestamp: Date
    let message: String
    let category: ErrorCategory
    let severity: ErrorSeverity
    let source: String
    let stackTrace: String?
    let context: [String: String]
    var diagnosis: ErrorDiagnosis?
    var status: ErrorStatus
    var occurrenceCount: Int
    var firstSeen: Date
    var lastSeen: Date

    init(
        id: String = UUID().uuidString,
        message: String,
        category: ErrorCategory = .unknown,
        severity: ErrorSeverity = .medium,
        source: String,
        stackTrace: String? = nil,
        context: [String: String] = [:]
    ) {
        self.id = id
        self.timestamp = Date()
        self.message = message
        self.category = category
        self.severity = severity
        self.source = source
        self.stackTrace = stackTrace
        self.context = context
        self.diagnosis = nil
        self.status = .new
        self.occurrenceCount = 1
        self.firstSeen = Date()
        self.lastSeen = Date()
    }
}

/// Error status
enum ErrorStatus: String, Codable {
    case new = "new"
    case diagnosed = "diagnosed"
    case inProgress = "in_progress"
    case resolved = "resolved"
    case ignored = "ignored"
}

/// Error diagnosis result
struct ErrorDiagnosis: Codable {
    let errorId: String
    let diagnosedAt: Date
    let rootCause: String
    let explanation: String
    let suggestedFixes: [SuggestedFix]
    let relatedErrors: [String]
    let confidence: Float
    let diagnosisSource: DiagnosisSource
}

/// Suggested fix
struct SuggestedFix: Codable, Identifiable {
    let id: String
    let description: String
    let code: String?
    let difficulty: FixDifficulty
    let impact: String
    let steps: [String]
}

/// Fix difficulty
enum FixDifficulty: String, Codable {
    case automatic = "automatic"
    case simple = "simple"
    case moderate = "moderate"
    case complex = "complex"
}

/// Diagnosis source
enum DiagnosisSource: String, Codable {
    case patternMatching = "pattern_matching"
    case llm = "llm"
    case manual = "manual"
}

/// Error statistics
struct ErrorStats: Codable {
    let totalErrors: Int
    let errorsByCategory: [String: Int]
    let errorsBySeverity: [String: Int]
    let errorsByStatus: [String: Int]
    let topErrors: [ErrorFrequency]
    let trendsHourly: [HourlyTrend]
    let averageResolutionTime: TimeInterval?
}

/// Error frequency
struct ErrorFrequency: Codable {
    let message: String
    let count: Int
    let lastSeen: Date
}

/// Hourly trend
struct HourlyTrend: Codable {
    let hour: Int
    let count: Int
}

// MARK: - Error Monitor

/// AI-powered error monitoring system
@MainActor
class ErrorMonitor: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private weak var llmManager: LLMManager?

    @Published private(set) var errors: [String: MonitoredError] = [:]
    @Published private(set) var recentErrors: [MonitoredError] = []
    @Published private(set) var stats: ErrorStats?
    @Published private(set) var isMonitoring = false

    // Error patterns for quick classification
    private let errorPatterns: [ErrorCategory: [String]] = [
        .network: ["ENOTFOUND", "ECONNREFUSED", "timeout", "network", "connection", "socket", "fetch failed"],
        .database: ["SQLITE", "database", "SQL", "query failed", "constraint", "foreign key"],
        .authentication: ["unauthorized", "401", "403", "auth", "token", "credential", "login"],
        .validation: ["validation", "invalid", "required", "must be", "expected"],
        .permission: ["EACCES", "permission denied", "access denied", "not allowed"],
        .fileSystem: ["ENOENT", "file not found", "directory", "path", "read error", "write error"],
        .memory: ["out of memory", "heap", "allocation", "memory pressure"],
        .timeout: ["timeout", "timed out", "deadline", "too slow"],
        .configuration: ["config", "setting", "environment", "missing key"],
        .dependency: ["module not found", "import", "require", "dependency", "package"]
    ]

    // MARK: - Singleton

    static let shared = ErrorMonitor()

    // MARK: - Initialization

    init() {
        startMonitoring()
    }

    /// Set LLM manager for AI diagnosis
    func setLLMManager(_ manager: LLMManager) {
        self.llmManager = manager
    }

    // MARK: - Monitoring

    /// Start error monitoring
    func startMonitoring() {
        guard !isMonitoring else { return }

        isMonitoring = true
        logger.info("[ErrorMonitor] Started monitoring")

        // Hook into system error notifications
        setupErrorHooks()
    }

    /// Stop error monitoring
    func stopMonitoring() {
        isMonitoring = false
        logger.info("[ErrorMonitor] Stopped monitoring")
    }

    /// Setup error hooks
    private func setupErrorHooks() {
        // Note: In a real implementation, this would hook into
        // system-level error handling
    }

    // MARK: - Error Capture

    /// Capture an error
    /// - Parameters:
    ///   - error: The error to capture
    ///   - source: Error source (component/module name)
    ///   - context: Additional context
    func captureError(
        _ error: Error,
        source: String,
        context: [String: String] = []
    ) {
        let message = error.localizedDescription
        let category = classifyError(message: message)
        let severity = assessSeverity(category: category, message: message)

        let monitoredError = MonitoredError(
            message: message,
            category: category,
            severity: severity,
            source: source,
            stackTrace: Thread.callStackSymbols.joined(separator: "\n"),
            context: context
        )

        addError(monitoredError)
    }

    /// Capture error from message
    /// - Parameters:
    ///   - message: Error message
    ///   - source: Error source
    ///   - severity: Optional severity override
    ///   - context: Additional context
    func captureError(
        message: String,
        source: String,
        severity: ErrorSeverity? = nil,
        context: [String: String] = [:]
    ) {
        let category = classifyError(message: message)
        let actualSeverity = severity ?? assessSeverity(category: category, message: message)

        let monitoredError = MonitoredError(
            message: message,
            category: category,
            severity: actualSeverity,
            source: source,
            context: context
        )

        addError(monitoredError)
    }

    /// Add error to monitor
    private func addError(_ error: MonitoredError) {
        // Check for duplicate
        let errorKey = "\(error.source):\(error.message)"

        if var existing = errors.values.first(where: { "\($0.source):\($0.message)" == errorKey }) {
            // Update existing error
            existing.occurrenceCount += 1
            existing.lastSeen = Date()
            errors[existing.id] = existing
        } else {
            // Add new error
            errors[error.id] = error

            // Keep recent errors limited
            recentErrors.insert(error, at: 0)
            if recentErrors.count > 100 {
                recentErrors = Array(recentErrors.prefix(100))
            }

            logger.warning("[ErrorMonitor] New error captured: \(error.category.rawValue) - \(error.message)")
        }

        // Update stats
        updateStats()
    }

    // MARK: - Classification

    /// Classify error by category
    private func classifyError(message: String) -> ErrorCategory {
        let lowerMessage = message.lowercased()

        for (category, patterns) in errorPatterns {
            if patterns.contains(where: { lowerMessage.contains($0.lowercased()) }) {
                return category
            }
        }

        return .unknown
    }

    /// Assess error severity
    private func assessSeverity(category: ErrorCategory, message: String) -> ErrorSeverity {
        let lowerMessage = message.lowercased()

        // Critical indicators
        if lowerMessage.contains("crash") ||
           lowerMessage.contains("fatal") ||
           lowerMessage.contains("data loss") ||
           lowerMessage.contains("corruption") {
            return .critical
        }

        // Category-based severity
        switch category {
        case .memory, .database:
            return .high
        case .authentication, .permission:
            return .high
        case .network, .timeout:
            return .medium
        case .validation, .configuration:
            return .low
        default:
            return .medium
        }
    }

    // MARK: - AI Diagnosis

    /// Diagnose error using AI
    /// - Parameter errorId: Error ID to diagnose
    /// - Returns: Diagnosis result
    func diagnoseError(_ errorId: String) async throws -> ErrorDiagnosis {
        guard let error = errors[errorId] else {
            throw ErrorMonitorError.errorNotFound
        }

        // Try pattern-based diagnosis first
        if let diagnosis = patternBasedDiagnosis(error) {
            errors[errorId]?.diagnosis = diagnosis
            errors[errorId]?.status = .diagnosed
            return diagnosis
        }

        // Use LLM for complex diagnosis
        if let llm = llmManager {
            return try await llmBasedDiagnosis(error, llm: llm)
        }

        // Fallback to basic diagnosis
        return basicDiagnosis(error)
    }

    /// Pattern-based diagnosis
    private func patternBasedDiagnosis(_ error: MonitoredError) -> ErrorDiagnosis? {
        switch error.category {
        case .network:
            return ErrorDiagnosis(
                errorId: error.id,
                diagnosedAt: Date(),
                rootCause: "Network connectivity issue",
                explanation: "The application failed to establish or maintain a network connection.",
                suggestedFixes: [
                    SuggestedFix(
                        id: UUID().uuidString,
                        description: "Check network connectivity",
                        code: nil,
                        difficulty: .simple,
                        impact: "High",
                        steps: ["Verify internet connection", "Check firewall settings", "Test with ping/curl"]
                    ),
                    SuggestedFix(
                        id: UUID().uuidString,
                        description: "Add retry logic",
                        code: """
                        func retryRequest<T>(_ operation: () async throws -> T, maxRetries: Int = 3) async throws -> T {
                            var lastError: Error?
                            for _ in 0..<maxRetries {
                                do {
                                    return try await operation()
                                } catch {
                                    lastError = error
                                    try await Task.sleep(nanoseconds: 1_000_000_000)
                                }
                            }
                            throw lastError ?? NetworkError.unknown
                        }
                        """,
                        difficulty: .moderate,
                        impact: "Medium",
                        steps: ["Add retry wrapper function", "Apply exponential backoff", "Update network calls"]
                    )
                ],
                relatedErrors: [],
                confidence: 0.85,
                diagnosisSource: .patternMatching
            )

        case .timeout:
            return ErrorDiagnosis(
                errorId: error.id,
                diagnosedAt: Date(),
                rootCause: "Operation timeout",
                explanation: "The operation took longer than the allowed time limit.",
                suggestedFixes: [
                    SuggestedFix(
                        id: UUID().uuidString,
                        description: "Increase timeout",
                        code: nil,
                        difficulty: .simple,
                        impact: "Low",
                        steps: ["Identify timeout configuration", "Increase value appropriately"]
                    ),
                    SuggestedFix(
                        id: UUID().uuidString,
                        description: "Optimize operation",
                        code: nil,
                        difficulty: .complex,
                        impact: "High",
                        steps: ["Profile operation", "Identify bottlenecks", "Optimize queries/algorithms"]
                    )
                ],
                relatedErrors: [],
                confidence: 0.80,
                diagnosisSource: .patternMatching
            )

        default:
            return nil
        }
    }

    /// LLM-based diagnosis
    private func llmBasedDiagnosis(
        _ error: MonitoredError,
        llm: LLMManager
    ) async throws -> ErrorDiagnosis {
        let prompt = """
        Diagnose this application error:

        Error Message: \(error.message)
        Category: \(error.category.rawValue)
        Severity: \(error.severity.rawValue)
        Source: \(error.source)
        Context: \(error.context)
        \(error.stackTrace.map { "Stack Trace:\n\($0)" } ?? "")

        Please provide:
        1. Root cause analysis
        2. Detailed explanation
        3. 2-3 suggested fixes with steps
        4. Confidence level (0-1)

        Format as JSON:
        {
          "rootCause": "...",
          "explanation": "...",
          "suggestedFixes": [
            {"description": "...", "difficulty": "simple|moderate|complex", "steps": ["..."]}
          ],
          "confidence": 0.8
        }
        """

        let response = try await llm.chat(
            messages: [LLMMessage(role: "user", content: prompt)],
            options: ChatOptions(temperature: 0.2, topP: 0.9, maxTokens: 1000)
        )

        // Parse LLM response
        let diagnosis = parseAIDiagnosis(error.id, response: response.text)

        errors[error.id]?.diagnosis = diagnosis
        errors[error.id]?.status = .diagnosed

        return diagnosis
    }

    /// Parse AI diagnosis response
    private func parseAIDiagnosis(_ errorId: String, response: String) -> ErrorDiagnosis {
        let cleanedJSON = response
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if let data = cleanedJSON.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

            let rootCause = json["rootCause"] as? String ?? "Unknown"
            let explanation = json["explanation"] as? String ?? "Unable to determine"
            let confidence = json["confidence"] as? Float ?? 0.5

            var fixes: [SuggestedFix] = []
            if let fixesArray = json["suggestedFixes"] as? [[String: Any]] {
                fixes = fixesArray.map { fix in
                    SuggestedFix(
                        id: UUID().uuidString,
                        description: fix["description"] as? String ?? "",
                        code: fix["code"] as? String,
                        difficulty: FixDifficulty(rawValue: fix["difficulty"] as? String ?? "moderate") ?? .moderate,
                        impact: fix["impact"] as? String ?? "Medium",
                        steps: fix["steps"] as? [String] ?? []
                    )
                }
            }

            return ErrorDiagnosis(
                errorId: errorId,
                diagnosedAt: Date(),
                rootCause: rootCause,
                explanation: explanation,
                suggestedFixes: fixes,
                relatedErrors: [],
                confidence: confidence,
                diagnosisSource: .llm
            )
        }

        // Fallback
        return basicDiagnosis(errors[errorId]!)
    }

    /// Basic diagnosis fallback
    private func basicDiagnosis(_ error: MonitoredError) -> ErrorDiagnosis {
        return ErrorDiagnosis(
            errorId: error.id,
            diagnosedAt: Date(),
            rootCause: "Automated diagnosis unavailable",
            explanation: "Error requires manual investigation: \(error.message)",
            suggestedFixes: [
                SuggestedFix(
                    id: UUID().uuidString,
                    description: "Check application logs",
                    code: nil,
                    difficulty: .simple,
                    impact: "High",
                    steps: ["Review recent log entries", "Look for related errors", "Check system resources"]
                )
            ],
            relatedErrors: [],
            confidence: 0.3,
            diagnosisSource: .patternMatching
        )
    }

    // MARK: - Statistics

    /// Update error statistics
    private func updateStats() {
        let allErrors = Array(errors.values)

        var byCategory: [String: Int] = [:]
        var bySeverity: [String: Int] = [:]
        var byStatus: [String: Int] = [:]
        var frequency: [String: Int] = [:]
        var hourlyCount: [Int: Int] = [:]

        for error in allErrors {
            byCategory[error.category.rawValue, default: 0] += error.occurrenceCount
            bySeverity[error.severity.rawValue, default: 0] += error.occurrenceCount
            byStatus[error.status.rawValue, default: 0] += 1
            frequency[error.message, default: 0] += error.occurrenceCount

            let hour = Calendar.current.component(.hour, from: error.lastSeen)
            hourlyCount[hour, default: 0] += 1
        }

        let topErrors = frequency
            .map { ErrorFrequency(message: $0.key, count: $0.value, lastSeen: Date()) }
            .sorted { $0.count > $1.count }
            .prefix(10)

        let hourlyTrends = (0..<24).map { HourlyTrend(hour: $0, count: hourlyCount[$0] ?? 0) }

        stats = ErrorStats(
            totalErrors: allErrors.map { $0.occurrenceCount }.reduce(0, +),
            errorsByCategory: byCategory,
            errorsBySeverity: bySeverity,
            errorsByStatus: byStatus,
            topErrors: Array(topErrors),
            trendsHourly: hourlyTrends,
            averageResolutionTime: nil
        )
    }

    // MARK: - Error Management

    /// Mark error as resolved
    func resolveError(_ errorId: String) {
        errors[errorId]?.status = .resolved
        updateStats()
    }

    /// Ignore error
    func ignoreError(_ errorId: String) {
        errors[errorId]?.status = .ignored
        updateStats()
    }

    /// Clear all errors
    func clearAllErrors() {
        errors.removeAll()
        recentErrors.removeAll()
        updateStats()
    }

    /// Get errors by category
    func getErrors(category: ErrorCategory) -> [MonitoredError] {
        return errors.values.filter { $0.category == category }
    }

    /// Get errors by severity
    func getErrors(severity: ErrorSeverity) -> [MonitoredError] {
        return errors.values.filter { $0.severity == severity }
    }

    /// Get unresolved errors
    func getUnresolvedErrors() -> [MonitoredError] {
        return errors.values.filter { $0.status != .resolved && $0.status != .ignored }
    }
}

// MARK: - Errors

/// Error monitor errors
enum ErrorMonitorError: LocalizedError {
    case errorNotFound
    case diagnosisFailed(String)

    var errorDescription: String? {
        switch self {
        case .errorNotFound:
            return "Error not found"
        case .diagnosisFailed(let msg):
            return "Diagnosis failed: \(msg)"
        }
    }
}
