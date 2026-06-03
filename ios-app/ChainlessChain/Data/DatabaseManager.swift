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

        // 创建区块链交易表（Phase 1.4）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS blockchain_transactions (
                id TEXT PRIMARY KEY,
                hash TEXT NOT NULL UNIQUE,
                from_address TEXT NOT NULL,
                to_address TEXT NOT NULL,
                value TEXT NOT NULL,
                gas_price TEXT NOT NULL,
                gas_limit TEXT NOT NULL,
                data TEXT,
                nonce INTEGER NOT NULL,
                chain_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                type TEXT NOT NULL,
                block_number INTEGER,
                timestamp INTEGER NOT NULL,
                confirmations INTEGER DEFAULT 0
            )
        """)

        // 创建交易表索引
        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_from
            ON blockchain_transactions(from_address)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_to
            ON blockchain_transactions(to_address)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_chain
            ON blockchain_transactions(chain_id)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_tx_status
            ON blockchain_transactions(status)
        """)

        // 创建Token表（Phase 1.5）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS tokens (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL,
                is_custom INTEGER NOT NULL DEFAULT 0,
                is_verified INTEGER NOT NULL DEFAULT 0,
                icon_url TEXT,
                created_at INTEGER NOT NULL,
                UNIQUE(address, chain_id)
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_token_chain
            ON tokens(chain_id)
        """)

        // 创建NFT表（Phase 1.5）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS nfts (
                id TEXT PRIMARY KEY,
                contract_address TEXT NOT NULL,
                token_id TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                standard TEXT NOT NULL,
                name TEXT,
                image_url TEXT,
                image_data BLOB,
                balance TEXT NOT NULL DEFAULT '1',
                attributes TEXT,
                created_at INTEGER NOT NULL,
                UNIQUE(contract_address, token_id, chain_id)
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_nft_contract
            ON nfts(contract_address)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_nft_chain
            ON nfts(chain_id)
        """)

        // 创建Escrow表（Phase 1.6）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS escrows (
                id TEXT PRIMARY KEY,
                contract_address TEXT NOT NULL,
                escrow_id TEXT NOT NULL,
                buyer TEXT NOT NULL,
                seller TEXT NOT NULL,
                arbitrator TEXT,
                amount TEXT NOT NULL,
                token_address TEXT,
                status TEXT NOT NULL,
                funded_at INTEGER,
                delivered_at INTEGER,
                completed_at INTEGER,
                chain_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(contract_address, escrow_id)
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_escrow_buyer
            ON escrows(buyer)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_escrow_seller
            ON escrows(seller)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_escrow_status
            ON escrows(status)
        """)

        // 创建NFT Listing表（Phase 1.6）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS nft_listings (
                id TEXT PRIMARY KEY,
                listing_id TEXT NOT NULL,
                contract_address TEXT NOT NULL,
                nft_contract TEXT NOT NULL,
                token_id TEXT NOT NULL,
                seller TEXT NOT NULL,
                price TEXT NOT NULL,
                payment_token TEXT,
                status TEXT NOT NULL,
                buyer TEXT,
                nft_id TEXT,
                chain_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(contract_address, listing_id)
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_listing_seller
            ON nft_listings(seller)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_listing_status
            ON nft_listings(status)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_listing_nft
            ON nft_listings(nft_contract, token_id)
        """)

        // 创建NFT Offer表（Phase 1.6）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS nft_offers (
                id TEXT PRIMARY KEY,
                offer_id TEXT NOT NULL,
                contract_address TEXT NOT NULL,
                nft_contract TEXT NOT NULL,
                token_id TEXT NOT NULL,
                buyer TEXT NOT NULL,
                price TEXT NOT NULL,
                payment_token TEXT,
                status TEXT NOT NULL,
                seller TEXT,
                expires_at INTEGER NOT NULL,
                chain_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(contract_address, offer_id)
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_offer_buyer
            ON nft_offers(buyer)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_offer_status
            ON nft_offers(status)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_offer_nft
            ON nft_offers(nft_contract, token_id)
        """)

        // 创建DApp表（Phase 2.0）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS dapps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                description TEXT,
                category TEXT NOT NULL,
                icon_url TEXT,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                visit_count INTEGER NOT NULL DEFAULT 0,
                last_visited INTEGER,
                created_at INTEGER NOT NULL
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_dapp_category
            ON dapps(category)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_dapp_favorite
            ON dapps(is_favorite)
        """)

        // 创建浏览历史表（Phase 2.0）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS browser_history (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                timestamp INTEGER NOT NULL
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_history_timestamp
            ON browser_history(timestamp DESC)
        """)

        // 创建WalletConnect Session表（Phase 2.0）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS walletconnect_sessions (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL UNIQUE,
                relay_protocol TEXT NOT NULL,
                controller TEXT NOT NULL,
                namespaces TEXT NOT NULL,
                expiry INTEGER NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                self_participant TEXT NOT NULL,
                peer_participant TEXT NOT NULL,
                required_namespaces TEXT,
                optional_namespaces TEXT,
                session_properties TEXT,
                created_at INTEGER NOT NULL
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_wc_session_expiry
            ON walletconnect_sessions(expiry)
        """)

        // 创建WalletConnect Request表（Phase 2.0）
        try db.execute("""
            CREATE TABLE IF NOT EXISTS walletconnect_requests (
                id TEXT PRIMARY KEY,
                session_topic TEXT NOT NULL,
                dapp_name TEXT NOT NULL,
                method TEXT NOT NULL,
                params TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                responded_at INTEGER
            )
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_wc_request_session
            ON walletconnect_requests(session_topic)
        """)

        try db.execute("""
            CREATE INDEX IF NOT EXISTS idx_wc_request_status
            ON walletconnect_requests(status)
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
