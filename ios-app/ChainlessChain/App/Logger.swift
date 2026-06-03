//
//  Logger.swift
//  ChainlessChain
//
//  统一日志管理器
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import os.log

/// 日志级别
enum LogLevel: Int, Comparable {
    case debug = 0
    case info = 1
    case warning = 2
    case error = 3

    static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        return lhs.rawValue < rhs.rawValue
    }

    var prefix: String {
        switch self {
        case .debug: return "🔍 DEBUG"
        case .info: return "ℹ️ INFO"
        case .warning: return "⚠️ WARNING"
        case .error: return "❌ ERROR"
        }
    }
}

/// 统一日志管理器
class Logger {
    static let shared = Logger()

    private let subsystem = Bundle.main.bundleIdentifier ?? "com.chainlesschain"
    private var osLog: OSLog

    #if DEBUG
    private var minLevel: LogLevel = .debug
    #else
    private var minLevel: LogLevel = .info
    #endif

    private init() {
        self.osLog = OSLog(subsystem: subsystem, category: "default")
    }

    // MARK: - 公共日志方法

    func debug(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(level: .debug, message: message, file: file, function: function, line: line)
    }

    func info(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(level: .info, message: message, file: file, function: function, line: line)
    }

    func warning(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(level: .warning, message: message, file: file, function: function, line: line)
    }

    func error(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(level: .error, message: message, file: file, function: function, line: line)
    }

    // MARK: - 核心日志方法

    private func log(level: LogLevel, message: String, file: String, function: String, line: Int) {
        guard level >= minLevel else { return }

        let fileName = (file as NSString).lastPathComponent
        let timestamp = DateFormatter.logFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(level.prefix) [\(fileName):\(line)] \(function) - \(message)"

        // 输出到控制台
        print(logMessage)

        // 输出到系统日志
        if #available(iOS 14.0, *) {
            let osLogType: OSLogType
            switch level {
            case .debug:
                osLogType = .debug
            case .info:
                osLogType = .info
            case .warning:
                osLogType = .default
            case .error:
                osLogType = .error
            }
            os_log("%{public}@", log: osLog, type: osLogType, logMessage)
        }
    }

    // MARK: - 配置方法

    func setMinLevel(_ level: LogLevel) {
        self.minLevel = level
    }

    func setCategory(_ category: String) {
        self.osLog = OSLog(subsystem: subsystem, category: category)
    }
}

// MARK: - 日期格式化扩展

private extension DateFormatter {
    static let logFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()
}
