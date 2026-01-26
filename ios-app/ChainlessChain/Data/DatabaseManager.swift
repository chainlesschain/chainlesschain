//
//  DatabaseManager.swift
//  ChainlessChain
//
//  数据库管理器 - SQLite数据库访问
//
//  Created by ChainlessChain on 2026-01-26.
//

import Foundation
import SQLite3

/// 数据库管理器
class DatabaseManager {
    static let shared = DatabaseManager()

    private(set) var db: Database!

    private init() {
        do {
            db = try Database()
            try createTables()
            Logger.shared.info("数据库初始化成功")
        } catch {
            Logger.shared.error("数据库初始化失败: \(error.localizedDescription)")
            fatalError("Failed to initialize database: \(error)")
        }
    }

    private func createTables() throws {
        // 创建区块链钱包表
        try db.execute("""
            CREATE TABLE IF NOT EXISTS blockchain_wallets (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL UNIQUE,
                wallet_type TEXT NOT NULL,
                provider TEXT NOT NULL,
                derivation_path TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
        """)

        // 创建钱包余额表（Phase 1.2）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS wallet_balances (
                wallet_id TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                balance TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL,
                token_address TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (wallet_id, chain_id, COALESCE(token_address, ''))
            )
        """)

        // 创建余额表索引
        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_balance_wallet
            ON wallet_balances(wallet_id)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_balance_chain
            ON wallet_balances(chain_id)
        """)

        Logger.shared.debug("数据库表创建完成")
    }

    // MARK: - 查询方法（Phase 1.2新增）

    /// 执行查询并处理结果
    func query<T>(_ sql: String, parameters: [Any?] = [], transform: (OpaquePointer) -> T?) throws -> [T] {
        var statement: OpaquePointer?
        var results: [T] = []

        // 准备语句
        guard sqlite3_prepare_v2(db.dbPointer, sql, -1, &statement, nil) == SQLITE_OK else {
            let errorMessage = String(cString: sqlite3_errmsg(db.dbPointer))
            throw DatabaseError.prepareFailed(errorMessage)
        }

        defer {
            sqlite3_finalize(statement)
        }

        // 绑定参数
        for (index, parameter) in parameters.enumerated() {
            let bindIndex = Int32(index + 1)

            if let stringValue = parameter as? String {
                sqlite3_bind_text(statement, bindIndex, (stringValue as NSString).utf8String, -1, nil)
            } else if let intValue = parameter as? Int {
                sqlite3_bind_int64(statement, bindIndex, Int64(intValue))
            } else if let doubleValue = parameter as? Double {
                sqlite3_bind_double(statement, bindIndex, doubleValue)
            } else if parameter == nil || parameter is NSNull {
                sqlite3_bind_null(statement, bindIndex)
            }
        }

        // 遍历结果
        while sqlite3_step(statement) == SQLITE_ROW {
            if let result = transform(statement!) {
                results.append(result)
            }
        }

        return results
    }
}

/// 简单的SQLite数据库包装器
class Database {
    private var dbPointer: OpaquePointer?

    init() throws {
        let fileManager = FileManager.default
        let documentsDirectory = try fileManager.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )

        let databaseURL = documentsDirectory.appendingPathComponent("chainlesschain.db")

        Logger.shared.info("数据库路径: \(databaseURL.path)")

        // 打开数据库
        if sqlite3_open(databaseURL.path, &dbPointer) != SQLITE_OK {
            throw DatabaseError.openFailed
        }
    }

    deinit {
        sqlite3_close(dbPointer)
    }

    // MARK: - 执行SQL

    func execute(_ sql: String, _ parameters: Any?...) throws {
        var statement: OpaquePointer?

        // 准备语句
        guard sqlite3_prepare_v2(dbPointer, sql, -1, &statement, nil) == SQLITE_OK else {
            let errorMessage = String(cString: sqlite3_errmsg(dbPointer))
            throw DatabaseError.prepareFailed(errorMessage)
        }

        defer {
            sqlite3_finalize(statement)
        }

        // 绑定参数
        for (index, parameter) in parameters.enumerated() {
            let bindIndex = Int32(index + 1)

            if let stringValue = parameter as? String {
                sqlite3_bind_text(statement, bindIndex, (stringValue as NSString).utf8String, -1, nil)
            } else if let intValue = parameter as? Int {
                sqlite3_bind_int64(statement, bindIndex, Int64(intValue))
            } else if let doubleValue = parameter as? Double {
                sqlite3_bind_double(statement, bindIndex, doubleValue)
            } else if parameter == nil || parameter is NSNull {
                sqlite3_bind_null(statement, bindIndex)
            }
        }

        // 执行
        guard sqlite3_step(statement) == SQLITE_DONE else {
            let errorMessage = String(cString: sqlite3_errmsg(dbPointer))
            throw DatabaseError.executeFailed(errorMessage)
        }
    }

    // MARK: - 查询SQL

    func prepare(_ sql: String) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        var results: [[String: Any]] = []

        // 准备语句
        guard sqlite3_prepare_v2(dbPointer, sql, -1, &statement, nil) == SQLITE_OK else {
            let errorMessage = String(cString: sqlite3_errmsg(dbPointer))
            throw DatabaseError.prepareFailed(errorMessage)
        }

        defer {
            sqlite3_finalize(statement)
        }

        // 获取列数
        let columnCount = sqlite3_column_count(statement)

        // 遍历结果
        while sqlite3_step(statement) == SQLITE_ROW {
            var row: [String: Any] = [:]

            for i in 0..<columnCount {
                let columnName = String(cString: sqlite3_column_name(statement, i))
                let columnType = sqlite3_column_type(statement, i)

                switch columnType {
                case SQLITE_INTEGER:
                    row[columnName] = Int(sqlite3_column_int64(statement, i))
                case SQLITE_FLOAT:
                    row[columnName] = sqlite3_column_double(statement, i)
                case SQLITE_TEXT:
                    if let cString = sqlite3_column_text(statement, i) {
                        row[columnName] = String(cString: cString)
                    }
                case SQLITE_NULL:
                    row[columnName] = NSNull()
                default:
                    break
                }
            }

            results.append(row)
        }

        return results
    }
}

/// 数据库错误
enum DatabaseError: LocalizedError {
    case openFailed
    case prepareFailed(String)
    case executeFailed(String)
    case queryFailed(String)

    var errorDescription: String? {
        switch self {
        case .openFailed:
            return "打开数据库失败"
        case .prepareFailed(let message):
            return "准备SQL语句失败: \(message)"
        case .executeFailed(let message):
            return "执行SQL失败: \(message)"
        case .queryFailed(let message):
            return "查询失败: \(message)"
        }
    }
}
