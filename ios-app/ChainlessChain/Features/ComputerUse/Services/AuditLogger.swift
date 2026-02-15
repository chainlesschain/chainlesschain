//
//  AuditLogger.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Security audit logging with risk assessment
//  Adapted from: desktop-app-vue/src/main/browser/actions/audit-logger.js
//

import Foundation
import Combine

// MARK: - Audit Entry

/// A single audit log entry
public struct CUAuditEntry: Codable, Identifiable {
    public let id: String
    public let timestamp: Date
    public let action: CUActionType
    public let params: [String: AnyCodableValue]
    public let riskLevel: CURiskLevel
    public let success: Bool
    public let error: String?
    public let duration: Double
    public let sessionId: String?

    public init(
        action: CUActionType,
        params: [String: AnyCodableValue],
        riskLevel: CURiskLevel,
        success: Bool,
        error: String? = nil,
        duration: Double = 0,
        sessionId: String? = nil
    ) {
        self.id = UUID().uuidString
        self.timestamp = Date()
        self.action = action
        self.params = CUAuditEntry.sanitizeParams(params)
        self.riskLevel = riskLevel
        self.success = success
        self.error = error
        self.duration = duration
        self.sessionId = sessionId
    }

    /// Sanitize parameters to mask sensitive data
    private static func sanitizeParams(_ params: [String: AnyCodableValue]) -> [String: AnyCodableValue] {
        let sensitiveKeys = Set(["password", "token", "secret", "apiKey", "api_key",
                                  "authorization", "cookie", "credential", "private_key"])
        var sanitized = params
        for key in sanitized.keys {
            let lowerKey = key.lowercased()
            if sensitiveKeys.contains(where: { lowerKey.contains($0) }) {
                sanitized[key] = .string("***REDACTED***")
            }
        }
        return sanitized
    }
}

// MARK: - AuditLogger

/// Security audit logger for Computer Use operations
public class CUAuditLogger: ObservableObject {
    public static let shared = CUAuditLogger()

    private let queue = DispatchQueue(label: "com.chainlesschain.cu-audit-logger")

    // In-memory log
    @Published public private(set) var entries: [CUAuditEntry] = []
    private let maxInMemory = 1000

    // Current session
    private var currentSessionId: String?

    // File persistence
    private let logDirectory: URL

    // Event publisher
    public let entryAdded = PassthroughSubject<CUAuditEntry, Never>()

    private init() {
        let documentsDir = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first!
        logDirectory = documentsDir
            .appendingPathComponent(".chainlesschain")
            .appendingPathComponent("audit-logs")

        do {
            try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        } catch {
            Logger.shared.error("[AuditLogger] Failed to create log directory: \(error.localizedDescription)")
        }

        Logger.shared.info("[AuditLogger] Initialized, log dir: \(logDirectory.path)")
    }

    // MARK: - Session

    /// Set the current session ID
    public func setSession(_ sessionId: String) {
        queue.sync { currentSessionId = sessionId }
    }

    // MARK: - Logging

    /// Log an operation
    public func log(
        action: CUActionType,
        params: [String: AnyCodableValue] = [:],
        success: Bool,
        error: String? = nil,
        duration: Double = 0
    ) {
        let riskLevel = assessRisk(action: action, params: params)
        let sessionId = queue.sync { currentSessionId }

        let entry = CUAuditEntry(
            action: action,
            params: params,
            riskLevel: riskLevel,
            success: success,
            error: error,
            duration: duration,
            sessionId: sessionId
        )

        queue.sync {
            entries.append(entry)
            if entries.count > maxInMemory {
                entries.removeFirst(entries.count - maxInMemory)
            }
        }

        // Persist to file
        persistEntry(entry)

        // Publish event
        entryAdded.send(entry)

        // Log high-risk operations to system log
        if riskLevel == .high || riskLevel == .critical {
            Logger.shared.warning("[AuditLogger] High-risk operation: \(action.rawValue), risk: \(riskLevel.rawValue)")
        }
    }

    // MARK: - Risk Assessment

    /// Assess the risk level of an action
    private func assessRisk(action: CUActionType, params: [String: AnyCodableValue]) -> CURiskLevel {
        // High risk: navigation to unknown URLs, network interception
        switch action {
        case .navigate:
            if let url = params["url"]?.stringValue {
                if url.contains("login") || url.contains("auth") || url.contains("payment") {
                    return .high
                }
                return .medium
            }
            return .low

        case .interceptNetwork, .mockResponse:
            return .high

        case .type:
            // Check if typing into a password field
            if let selector = params["selector"]?.stringValue,
               selector.contains("password") {
                return .high
            }
            return .medium

        case .click, .doubleClick, .longPress, .visionClick:
            return .medium

        case .drag, .swipe, .pinch:
            return .medium

        case .screenshot, .appScreenshot, .visionAnalyze, .visionDescribe, .visionLocate:
            return .low

        case .scroll, .wait, .deviceInfo:
            return .low

        case .key:
            return .medium

        case .haptic:
            return .low
        }
    }

    // MARK: - Query

    /// Get entries filtered by criteria
    public func query(
        actionTypes: [CUActionType]? = nil,
        riskLevels: [CURiskLevel]? = nil,
        successOnly: Bool? = nil,
        since: Date? = nil,
        until: Date? = nil,
        limit: Int = 100
    ) -> [CUAuditEntry] {
        queue.sync {
            var result = entries

            if let actionTypes = actionTypes {
                result = result.filter { actionTypes.contains($0.action) }
            }
            if let riskLevels = riskLevels {
                result = result.filter { riskLevels.contains($0.riskLevel) }
            }
            if let successOnly = successOnly {
                result = result.filter { $0.success == successOnly }
            }
            if let since = since {
                result = result.filter { $0.timestamp >= since }
            }
            if let until = until {
                result = result.filter { $0.timestamp <= until }
            }

            return Array(result.suffix(limit))
        }
    }

    /// Get statistics summary
    public func getStats() -> [String: Any] {
        queue.sync {
            let total = entries.count
            let successful = entries.filter { $0.success }.count
            let byRisk: [String: Int] = [
                "low": entries.filter { $0.riskLevel == .low }.count,
                "medium": entries.filter { $0.riskLevel == .medium }.count,
                "high": entries.filter { $0.riskLevel == .high }.count,
                "critical": entries.filter { $0.riskLevel == .critical }.count
            ]
            let byAction = Dictionary(grouping: entries, by: { $0.action.rawValue })
                .mapValues { $0.count }

            return [
                "totalEntries": total,
                "successRate": total > 0 ? Double(successful) / Double(total) * 100 : 0,
                "byRiskLevel": byRisk,
                "byAction": byAction
            ]
        }
    }

    // MARK: - Export

    /// Export logs as JSON data
    public func exportJSON() -> Data? {
        queue.sync {
            try? JSONEncoder().encode(entries)
        }
    }

    /// Export logs as CSV string
    public func exportCSV() -> String {
        queue.sync {
            let dateFormatter = ISO8601DateFormatter()
            var csv = "id,timestamp,action,riskLevel,success,error,duration,sessionId\n"
            for entry in entries {
                let error = entry.error?.replacingOccurrences(of: ",", with: ";") ?? ""
                csv += "\(entry.id),\(dateFormatter.string(from: entry.timestamp)),\(entry.action.rawValue),"
                csv += "\(entry.riskLevel.rawValue),\(entry.success),\"\(error)\","
                csv += "\(entry.duration),\(entry.sessionId ?? "")\n"
            }
            return csv
        }
    }

    // MARK: - Clear

    /// Clear all in-memory logs
    public func clear() {
        queue.sync {
            entries.removeAll()
        }
        Logger.shared.info("[AuditLogger] In-memory logs cleared")
    }

    // MARK: - File Persistence

    /// Persist a single entry to JSONL file (daily rotation)
    private func persistEntry(_ entry: CUAuditEntry) {
        queue.async { [weak self] in
            guard let self = self else { return }

            let dateStr = Self.dayFormatter.string(from: Date())
            let fileURL = self.logDirectory.appendingPathComponent("audit-\(dateStr).jsonl")

            guard let data = try? JSONEncoder().encode(entry),
                  var line = String(data: data, encoding: .utf8) else { return }
            line += "\n"

            if FileManager.default.fileExists(atPath: fileURL.path) {
                if let handle = try? FileHandle(forWritingTo: fileURL) {
                    handle.seekToEndOfFile()
                    handle.write(line.data(using: .utf8) ?? Data())
                    handle.closeFile()
                }
            } else {
                try? line.data(using: .utf8)?.write(to: fileURL)
            }
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}
