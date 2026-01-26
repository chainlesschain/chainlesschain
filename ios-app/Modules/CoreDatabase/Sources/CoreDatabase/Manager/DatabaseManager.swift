import Foundation
import SQLite3
import CoreCommon
import CoreSecurity

/// 数据库管理器
public class DatabaseManager {
    public static let shared = DatabaseManager()

    private var db: OpaquePointer?
    private let logger = Logger.shared
    private let queue = DispatchQueue(label: "com.chainlesschain.database", qos: .userInitiated)

    private var isOpen = false

    private init() {}

    // MARK: - Database Lifecycle

    /// 打开数据库
    public func open(password: String) throws {
        try queue.sync {
            guard !isOpen else { return }

            let dbPath = try getDatabasePath()
            logger.database("Opening database at: \(dbPath)")

            // 打开数据库
            var tempDb: OpaquePointer?
            let result = sqlite3_open(dbPath, &tempDb)

            guard result == SQLITE_OK, let database = tempDb else {
                let errorMessage = String(cString: sqlite3_errmsg(tempDb))
                logger.database("Failed to open database: \(errorMessage)", level: .error)
                throw DatabaseError.openFailed(errorMessage)
            }

            db = database

            // 设置 SQLCipher 密钥
            try setEncryptionKey(password)

            // 验证数据库是否可读
            try verifyDatabase()

            // 运行迁移
            try runMigrations()

            isOpen = true
            logger.database("Database opened successfully")

            // 发送通知
            NotificationCenter.default.post(name: AppConstants.Notification.databaseUnlocked, object: nil)
        }
    }

    /// 关闭数据库
    public func close() {
        queue.sync {
            guard isOpen, let database = db else { return }

            sqlite3_close(database)
            db = nil
            isOpen = false

            logger.database("Database closed")
        }
    }

    /// 检查数据库是否已打开
    public var isDatabaseOpen: Bool {
        return isOpen
    }

    // MARK: - Database Path

    /// 获取数据库路径
    private func getDatabasePath() throws -> String {
        let fileManager = FileManager.default

        guard let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw DatabaseError.pathNotFound
        }

        let dataURL = documentsURL.appendingPathComponent("data")

        // 创建 data 目录
        if !fileManager.fileExists(atPath: dataURL.path) {
            try fileManager.createDirectory(at: dataURL, withIntermediateDirectories: true)
        }

        return dataURL.appendingPathComponent(AppConstants.Database.name).path
    }

    /// 检查数据库是否存在
    public func databaseExists() -> Bool {
        do {
            let path = try getDatabasePath()
            return FileManager.default.fileExists(atPath: path)
        } catch {
            return false
        }
    }

    // MARK: - Encryption

    /// 设置加密密钥
    private func setEncryptionKey(_ password: String) throws {
        guard let database = db else {
            throw DatabaseError.notOpen
        }

        // 使用 PBKDF2 派生密钥
        let salt = try getOrCreateSalt()
        let derivedKey = try CryptoManager.shared.deriveKey(
            password: password,
            salt: salt,
            iterations: AppConstants.Database.pbkdf2Iterations,
            keyLength: AppConstants.Database.encryptionKeySize
        )

        let keyHex = derivedKey.hexString
        let pragmaKey = "PRAGMA key = \"x'\(keyHex)'\";"

        var statement: OpaquePointer?
        let result = sqlite3_exec(database, pragmaKey, nil, nil, nil)

        guard result == SQLITE_OK else {
            let errorMessage = String(cString: sqlite3_errmsg(database))
            logger.database("Failed to set encryption key: \(errorMessage)", level: .error)
            throw DatabaseError.encryptionFailed(errorMessage)
        }

        // 设置 SQLCipher 参数
        sqlite3_exec(database, "PRAGMA cipher_page_size = 4096;", nil, nil, nil)
        sqlite3_exec(database, "PRAGMA kdf_iter = 256000;", nil, nil, nil)
        sqlite3_exec(database, "PRAGMA cipher_hmac_algorithm = HMAC_SHA256;", nil, nil, nil)
        sqlite3_exec(database, "PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA256;", nil, nil, nil)

        logger.database("Encryption key set successfully")
    }

    /// 获取或创建盐值
    private func getOrCreateSalt() throws -> Data {
        let keychain = KeychainManager.shared
        let saltKey = "database.salt"

        do {
            return try keychain.load(forKey: saltKey)
        } catch KeychainError.notFound {
            // 生成新盐值
            let salt = try CryptoManager.shared.generateRandomBytes(count: AppConstants.Crypto.saltSize)
            try keychain.save(salt, forKey: saltKey)
            logger.database("Generated new database salt")
            return salt
        }
    }

    /// 验证数据库可读性
    private func verifyDatabase() throws {
        guard let database = db else {
            throw DatabaseError.notOpen
        }

        var statement: OpaquePointer?
        let sql = "SELECT count(*) FROM sqlite_master;"

        let result = sqlite3_prepare_v2(database, sql, -1, &statement, nil)
        defer { sqlite3_finalize(statement) }

        guard result == SQLITE_OK else {
            let errorMessage = String(cString: sqlite3_errmsg(database))
            throw DatabaseError.verificationFailed(errorMessage)
        }

        let stepResult = sqlite3_step(statement)
        guard stepResult == SQLITE_ROW else {
            throw DatabaseError.verificationFailed("Cannot read database")
        }

        logger.database("Database verification passed")
    }

    // MARK: - SQL Execution

    /// 执行 SQL 语句
    @discardableResult
    public func execute(_ sql: String) throws -> Int {
        return try queue.sync {
            guard let database = db else {
                throw DatabaseError.notOpen
            }

            var errorMessage: UnsafeMutablePointer<CChar>?
            let result = sqlite3_exec(database, sql, nil, nil, &errorMessage)

            if result != SQLITE_OK {
                let message: String
                if let errorPtr = errorMessage {
                    message = String(cString: errorPtr)
                    sqlite3_free(errorPtr)
                } else {
                    message = "Unknown error"
                }
                logger.database("SQL execution failed: \(message)", level: .error)
                throw DatabaseError.executionFailed(message)
            }

            let changes = Int(sqlite3_changes(database))
            return changes
        }
    }

    /// 执行查询
    public func query<T>(_ sql: String, parameters: [Any?] = [], mapper: (OpaquePointer) -> T?) throws -> [T] {
        return try queue.sync {
            guard let database = db else {
                throw DatabaseError.notOpen
            }

            var statement: OpaquePointer?
            let prepareResult = sqlite3_prepare_v2(database, sql, -1, &statement, nil)

            guard prepareResult == SQLITE_OK, let stmt = statement else {
                let errorMessage = String(cString: sqlite3_errmsg(database))
                throw DatabaseError.queryFailed(errorMessage)
            }

            defer { sqlite3_finalize(stmt) }

            // 绑定参数
            try bindParameters(stmt, parameters: parameters)

            var results: [T] = []

            while sqlite3_step(stmt) == SQLITE_ROW {
                if let item = mapper(stmt) {
                    results.append(item)
                }
            }

            return results
        }
    }

    /// 执行单行查询
    public func queryOne<T>(_ sql: String, parameters: [Any?] = [], mapper: (OpaquePointer) -> T?) throws -> T? {
        let results: [T] = try query(sql, parameters: parameters, mapper: mapper)
        return results.first
    }

    /// 绑定参数
    private func bindParameters(_ statement: OpaquePointer, parameters: [Any?]) throws {
        for (index, param) in parameters.enumerated() {
            let bindIndex = Int32(index + 1)

            switch param {
            case nil:
                sqlite3_bind_null(statement, bindIndex)
            case let intValue as Int:
                sqlite3_bind_int64(statement, bindIndex, Int64(intValue))
            case let int64Value as Int64:
                sqlite3_bind_int64(statement, bindIndex, int64Value)
            case let doubleValue as Double:
                sqlite3_bind_double(statement, bindIndex, doubleValue)
            case let stringValue as String:
                sqlite3_bind_text(statement, bindIndex, stringValue, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            case let dataValue as Data:
                dataValue.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(statement, bindIndex, bytes.baseAddress, Int32(dataValue.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
                }
            case let boolValue as Bool:
                sqlite3_bind_int(statement, bindIndex, boolValue ? 1 : 0)
            default:
                throw DatabaseError.invalidParameter("Unsupported parameter type at index \(index)")
            }
        }
    }

    /// 获取最后插入的 ID
    public func lastInsertRowId() -> Int64 {
        guard let database = db else { return 0 }
        return sqlite3_last_insert_rowid(database)
    }

    // MARK: - Transactions

    /// 开始事务
    public func beginTransaction() throws {
        try execute("BEGIN TRANSACTION;")
    }

    /// 提交事务
    public func commit() throws {
        try execute("COMMIT;")
    }

    /// 回滚事务
    public func rollback() throws {
        try execute("ROLLBACK;")
    }

    /// 在事务中执行
    public func transaction<T>(_ block: () throws -> T) throws -> T {
        try beginTransaction()
        do {
            let result = try block()
            try commit()
            return result
        } catch {
            try? rollback()
            throw error
        }
    }

    // MARK: - Migration

    /// 运行数据库迁移
    private func runMigrations() throws {
        // 创建 migrations 表
        try execute("""
            CREATE TABLE IF NOT EXISTS migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
        """)

        let currentVersion = try getCurrentVersion()
        let targetVersion = AppConstants.Database.version

        if currentVersion < targetVersion {
            logger.database("Running migrations from v\(currentVersion) to v\(targetVersion)")

            for version in (currentVersion + 1)...targetVersion {
                try runMigration(version: version)
            }
        }
    }

    /// 获取当前数据库版本
    private func getCurrentVersion() throws -> Int {
        let result: Int? = try queryOne("SELECT MAX(version) FROM migrations;") { stmt in
            return Int(sqlite3_column_int(stmt, 0))
        }
        return result ?? 0
    }

    /// 运行单个迁移
    private func runMigration(version: Int) throws {
        logger.database("Running migration v\(version)")

        switch version {
        case 1:
            try migration_v1()
        case 2:
            try migration_v2()
        default:
            break
        }

        // 记录迁移
        try execute("INSERT INTO migrations (version, applied_at) VALUES (\(version), \(Date().timestampMs));")
        logger.database("Migration v\(version) completed")
    }

    /// 迁移 v1: 创建核心表
    private func migration_v1() throws {
        // 用户设置表
        try execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // DID 身份表
        try execute("""
            CREATE TABLE IF NOT EXISTS did_identities (
                id TEXT PRIMARY KEY,
                did TEXT NOT NULL UNIQUE,
                public_key TEXT NOT NULL,
                private_key_encrypted TEXT NOT NULL,
                display_name TEXT,
                avatar_url TEXT,
                is_primary INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // 联系人表
        try execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                did TEXT NOT NULL UNIQUE,
                display_name TEXT,
                avatar_url TEXT,
                public_key TEXT,
                status TEXT DEFAULT 'pending',
                is_blocked INTEGER DEFAULT 0,
                added_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // 对话表
        try execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'direct',
                title TEXT,
                participant_dids TEXT NOT NULL,
                last_message_id TEXT,
                last_message_at INTEGER,
                unread_count INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                is_muted INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // 消息表
        try execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                sender_did TEXT NOT NULL,
                content_encrypted TEXT NOT NULL,
                content_type TEXT DEFAULT 'text',
                status TEXT DEFAULT 'sent',
                reply_to_id TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
        """)

        // 知识库表
        try execute("""
            CREATE TABLE IF NOT EXISTS knowledge_items (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                content_type TEXT DEFAULT 'text',
                tags TEXT,
                category TEXT,
                source_url TEXT,
                is_favorite INTEGER DEFAULT 0,
                view_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted INTEGER DEFAULT 0
            );
        """)

        // AI 对话表
        try execute("""
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                title TEXT,
                model TEXT NOT NULL,
                system_prompt TEXT,
                temperature REAL DEFAULT 0.7,
                total_tokens INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // AI 消息表
        try execute("""
            CREATE TABLE IF NOT EXISTS ai_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tokens INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id)
            );
        """)

        // 社交帖子表
        try execute("""
            CREATE TABLE IF NOT EXISTS social_posts (
                id TEXT PRIMARY KEY,
                author_did TEXT NOT NULL,
                content TEXT NOT NULL,
                media_urls TEXT,
                like_count INTEGER DEFAULT 0,
                comment_count INTEGER DEFAULT 0,
                share_count INTEGER DEFAULT 0,
                is_liked INTEGER DEFAULT 0,
                visibility TEXT DEFAULT 'public',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // 数字资产表
        try execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                balance TEXT NOT NULL,
                contract_address TEXT,
                chain_id TEXT,
                decimals INTEGER DEFAULT 18,
                icon_url TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        """)

        // 创建索引
        try execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);")
        try execute("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);")
        try execute("CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_items(created_at);")
        try execute("CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);")
        try execute("CREATE INDEX IF NOT EXISTS idx_contacts_did ON contacts(did);")

        logger.database("Created v1 schema with core tables")
    }

    // MARK: - Maintenance

    /// 执行 VACUUM
    public func vacuum() throws {
        try execute("VACUUM;")
        logger.database("Database vacuumed")
    }

    /// 重置数据库
    public func reset() throws {
        close()

        let path = try getDatabasePath()
        try FileManager.default.removeItem(atPath: path)

        logger.database("Database reset")
    }
}

// MARK: - Database Error

public enum DatabaseError: Error, LocalizedError {
    case openFailed(String)
    case notOpen
    case pathNotFound
    case encryptionFailed(String)
    case verificationFailed(String)
    case executionFailed(String)
    case queryFailed(String)
    case invalidParameter(String)
    case migrationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .openFailed(let message):
            return "Failed to open database: \(message)"
        case .notOpen:
            return "Database is not open"
        case .pathNotFound:
            return "Database path not found"
        case .encryptionFailed(let message):
            return "Encryption failed: \(message)"
        case .verificationFailed(let message):
            return "Database verification failed: \(message)"
        case .executionFailed(let message):
            return "SQL execution failed: \(message)"
        case .queryFailed(let message):
            return "Query failed: \(message)"
        case .invalidParameter(let message):
            return "Invalid parameter: \(message)"
        case .migrationFailed(let message):
            return "Migration failed: \(message)"
        }
    }
}
