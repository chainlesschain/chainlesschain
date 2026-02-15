//
//  ComputerUseMetrics.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Performance metrics collection
//  Adapted from: desktop-app-vue/src/main/browser/actions/computer-use-metrics.js
//

import Foundation
import Combine

// MARK: - Metric Types

/// Types of metrics collected
public enum CUMetricType: String, Codable {
    case counter = "counter"
    case gauge = "gauge"
    case histogram = "histogram"
    case summary = "summary"
}

/// Time range for queries
public enum CUTimeRange: String, Codable {
    case hour = "HOUR"
    case day = "DAY"
    case week = "WEEK"
    case month = "MONTH"
    case all = "ALL"

    var interval: TimeInterval {
        switch self {
        case .hour: return 3600
        case .day: return 86400
        case .week: return 604800
        case .month: return 2592000
        case .all: return .infinity
        }
    }
}

// MARK: - Metric Entry

/// A single metric data point
struct CUMetricEntry: Codable {
    let name: String
    let type: CUMetricType
    let value: Double
    let labels: [String: String]
    let timestamp: Date
}

// MARK: - Action Stats

/// Statistics for a single action type
public struct CUActionStats: Codable {
    public var totalCount: Int = 0
    public var successCount: Int = 0
    public var failureCount: Int = 0
    public var totalDuration: Double = 0
    public var minDuration: Double = .infinity
    public var maxDuration: Double = 0
    public var lastExecuted: Date?

    public var averageDuration: Double {
        totalCount > 0 ? totalDuration / Double(totalCount) : 0
    }

    public var successRate: Double {
        totalCount > 0 ? Double(successCount) / Double(totalCount) * 100 : 0
    }

    mutating func record(success: Bool, duration: Double) {
        totalCount += 1
        if success { successCount += 1 } else { failureCount += 1 }
        totalDuration += duration
        minDuration = min(minDuration, duration)
        maxDuration = max(maxDuration, duration)
        lastExecuted = Date()
    }
}

// MARK: - Session Stats

/// Statistics for a metrics session
public struct CUSessionStats: Codable {
    public let sessionId: String
    public let startTime: Date
    public var endTime: Date?
    public var totalOperations: Int = 0
    public var successfulOperations: Int = 0
    public var failedOperations: Int = 0
    public var totalDuration: Double = 0

    public var successRate: Double {
        totalOperations > 0 ? Double(successfulOperations) / Double(totalOperations) * 100 : 0
    }

    public var averageDuration: Double {
        totalOperations > 0 ? totalDuration / Double(totalOperations) : 0
    }
}

// MARK: - Error Record

/// Record of an error occurrence
public struct CUErrorRecord: Codable, Identifiable {
    public let id: String
    public let action: CUActionType
    public let error: String
    public let normalizedError: String
    public let timestamp: Date
    public var count: Int

    public init(action: CUActionType, error: String) {
        self.id = UUID().uuidString
        self.action = action
        self.error = error
        self.normalizedError = CUErrorRecord.normalize(error)
        self.timestamp = Date()
        self.count = 1
    }

    private static func normalize(_ error: String) -> String {
        // Strip numbers and specifics for grouping
        var normalized = error
        normalized = normalized.replacingOccurrences(
            of: "\\d+",
            with: "N",
            options: .regularExpression
        )
        normalized = normalized.replacingOccurrences(
            of: "\"[^\"]*\"",
            with: "\"...\"",
            options: .regularExpression
        )
        return normalized
    }
}

// MARK: - ComputerUseMetrics

/// Performance metrics collector for Computer Use operations
public class ComputerUseMetrics {
    public static let shared = ComputerUseMetrics()

    private let queue = DispatchQueue(label: "com.chainlesschain.computer-use-metrics")

    // Session tracking
    private var currentSession: CUSessionStats?
    private var sessions: [CUSessionStats] = []

    // Per-action-type stats
    private var actionStats: [CUActionType: CUActionStats] = [:]

    // Error tracking
    private var errors: [CUErrorRecord] = []
    private let maxErrors = 500

    // Time series data
    private var timeSeries: [CUMetricEntry] = []
    private let maxTimeSeriesEntries = 10000

    // Persistence
    private let persistenceURL: URL

    private init() {
        let documentsDir = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first!
        persistenceURL = documentsDir
            .appendingPathComponent(".chainlesschain")
            .appendingPathComponent("computer-use-metrics.json")

        load()
    }

    // MARK: - Session Management

    /// Start a new metrics session
    public func startSession() -> String {
        let sessionId = UUID().uuidString
        queue.sync {
            if var session = currentSession {
                session.endTime = Date()
                sessions.append(session)
            }
            currentSession = CUSessionStats(
                sessionId: sessionId,
                startTime: Date()
            )
        }
        Logger.shared.debug("[ComputerUseMetrics] Session started: \(sessionId)")
        return sessionId
    }

    /// End the current session
    public func endSession() {
        queue.sync {
            if var session = currentSession {
                session.endTime = Date()
                sessions.append(session)
                currentSession = nil
            }
        }
        save()
    }

    // MARK: - Record Metrics

    /// Record an action execution
    public func recordAction(type: CUActionType, success: Bool, duration: Double) {
        queue.sync {
            // Update per-type stats
            var stats = actionStats[type] ?? CUActionStats()
            stats.record(success: success, duration: duration)
            actionStats[type] = stats

            // Update session stats
            if currentSession != nil {
                currentSession!.totalOperations += 1
                if success {
                    currentSession!.successfulOperations += 1
                } else {
                    currentSession!.failedOperations += 1
                }
                currentSession!.totalDuration += duration
            }

            // Add time series entry
            let entry = CUMetricEntry(
                name: "action_execution",
                type: .counter,
                value: duration,
                labels: [
                    "action": type.rawValue,
                    "success": String(success)
                ],
                timestamp: Date()
            )
            timeSeries.append(entry)
            if timeSeries.count > maxTimeSeriesEntries {
                timeSeries.removeFirst(timeSeries.count - maxTimeSeriesEntries)
            }
        }
    }

    /// Record an error
    public func recordError(action: CUActionType, error: String) {
        queue.sync {
            let record = CUErrorRecord(action: action, error: error)
            // Check if similar error exists and increment count
            if let idx = errors.firstIndex(where: { $0.normalizedError == record.normalizedError }) {
                errors[idx].count += 1
            } else {
                errors.append(record)
                if errors.count > maxErrors {
                    errors.removeFirst()
                }
            }
        }
    }

    // MARK: - Query Stats

    /// Get statistics for a specific action type
    public func getActionStats(type: CUActionType) -> CUActionStats? {
        queue.sync { actionStats[type] }
    }

    /// Get all action type statistics
    public func getAllActionStats() -> [CUActionType: CUActionStats] {
        queue.sync { actionStats }
    }

    /// Get current session statistics
    public func getCurrentSession() -> CUSessionStats? {
        queue.sync { currentSession }
    }

    /// Get all historical sessions
    public func getSessions(limit: Int = 50) -> [CUSessionStats] {
        queue.sync { Array(sessions.suffix(limit)) }
    }

    /// Get recent errors
    public func getErrors(limit: Int = 50) -> [CUErrorRecord] {
        queue.sync { Array(errors.suffix(limit)) }
    }

    /// Get top errors by frequency
    public func getTopErrors(limit: Int = 10) -> [CUErrorRecord] {
        queue.sync {
            errors.sorted { $0.count > $1.count }.prefix(limit).map { $0 }
        }
    }

    /// Get overall summary
    public func getSummary() -> [String: Any] {
        queue.sync {
            let totalOps = actionStats.values.reduce(0) { $0 + $1.totalCount }
            let totalSuccess = actionStats.values.reduce(0) { $0 + $1.successCount }
            let totalDuration = actionStats.values.reduce(0.0) { $0 + $1.totalDuration }

            return [
                "totalOperations": totalOps,
                "successRate": totalOps > 0 ? Double(totalSuccess) / Double(totalOps) * 100 : 0,
                "averageDuration": totalOps > 0 ? totalDuration / Double(totalOps) : 0,
                "totalSessions": sessions.count + (currentSession != nil ? 1 : 0),
                "totalErrors": errors.count,
                "actionTypesCovered": actionStats.count
            ]
        }
    }

    // MARK: - Reset

    /// Reset all metrics
    public func reset() {
        queue.sync {
            currentSession = nil
            sessions.removeAll()
            actionStats.removeAll()
            errors.removeAll()
            timeSeries.removeAll()
        }
        save()
        Logger.shared.info("[ComputerUseMetrics] All metrics reset")
    }

    // MARK: - Persistence

    private func save() {
        queue.async { [weak self] in
            guard let self = self else { return }
            let data: [String: Any] = [
                "sessions": self.sessions.count,
                "actionTypes": self.actionStats.count,
                "errors": self.errors.count,
                "savedAt": ISO8601DateFormatter().string(from: Date())
            ]
            do {
                let dir = self.persistenceURL.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let jsonData = try JSONSerialization.data(withJSONObject: data, options: .prettyPrinted)
                try jsonData.write(to: self.persistenceURL)
            } catch {
                Logger.shared.warning("[ComputerUseMetrics] Failed to save: \(error.localizedDescription)")
            }
        }
    }

    private func load() {
        // Metrics are ephemeral by default; load is a no-op for now
        Logger.shared.debug("[ComputerUseMetrics] Initialized")
    }
}
