import Foundation
import os.log

/// 日志管理器
public class Logger {
    public static let shared = Logger()

    private let subsystem = AppConstants.App.bundleId
    private var loggers: [String: os.Logger] = [:]

    private init() {}

    /// 获取或创建 Logger
    private func getLogger(category: String) -> os.Logger {
        if let logger = loggers[category] {
            return logger
        }
        let logger = os.Logger(subsystem: subsystem, category: category)
        loggers[category] = logger
        return logger
    }

    /// Debug 日志
    public func debug(_ message: String, category: String = "General") {
        let logger = getLogger(category: category)
        logger.debug("\(message, privacy: .public)")
    }

    /// Info 日志
    public func info(_ message: String, category: String = "General") {
        let logger = getLogger(category: category)
        logger.info("\(message, privacy: .public)")
    }

    /// Warning 日志
    public func warning(_ message: String, category: String = "General") {
        let logger = getLogger(category: category)
        logger.warning("\(message, privacy: .public)")
    }

    /// Error 日志
    public func error(_ message: String, error: Error? = nil, category: String = "General") {
        let logger = getLogger(category: category)
        if let error = error {
            logger.error("\(message, privacy: .public) - Error: \(error.localizedDescription, privacy: .public)")
        } else {
            logger.error("\(message, privacy: .public)")
        }
    }

    /// Critical 日志
    public func critical(_ message: String, error: Error? = nil, category: String = "General") {
        let logger = getLogger(category: category)
        if let error = error {
            logger.critical("\(message, privacy: .public) - Error: \(error.localizedDescription, privacy: .public)")
        } else {
            logger.critical("\(message, privacy: .public)")
        }
    }
}

// MARK: - Convenience Methods

public extension Logger {
    /// 数据库日志
    func database(_ message: String, level: LogLevel = .info) {
        log(message, category: "Database", level: level)
    }

    /// 网络日志
    func network(_ message: String, level: LogLevel = .info) {
        log(message, category: "Network", level: level)
    }

    /// 安全日志
    func security(_ message: String, level: LogLevel = .info) {
        log(message, category: "Security", level: level)
    }

    /// P2P 日志
    func p2p(_ message: String, level: LogLevel = .info) {
        log(message, category: "P2P", level: level)
    }

    /// 同步日志
    func sync(_ message: String, level: LogLevel = .info) {
        log(message, category: "Sync", level: level)
    }

    private func log(_ message: String, category: String, level: LogLevel) {
        switch level {
        case .debug:
            debug(message, category: category)
        case .info:
            info(message, category: category)
        case .warning:
            warning(message, category: category)
        case .error:
            error(message, category: category)
        case .critical:
            critical(message, category: category)
        }
    }
}

// MARK: - Log Level

public enum LogLevel {
    case debug
    case info
    case warning
    case error
    case critical
}
