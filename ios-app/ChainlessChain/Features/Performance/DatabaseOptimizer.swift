import Foundation
import SQLite3
import Combine
import CoreCommon

// MARK: - Database Statistics

/// 数据库统计信息
public struct DatabaseStatistics {
    public var totalTables: Int = 0
    public var totalIndexes: Int = 0
    public var databaseSizeBytes: Int64 = 0
    public var walSizeBytes: Int64 = 0
    public var queryCount: Int = 0
    public var slowQueryCount: Int = 0
    public var averageQueryTimeMs: Double = 0
    public var cacheHitRate: Double = 0

    public var databaseSizeMB: Double {
        Double(databaseSizeBytes) / (1024 * 1024)
    }
}

// MARK: - Query Metrics

/// 查询指标
public struct QueryMetrics {
    public let sql: String
    public let startTime: Date
    public let endTime: Date
    public let rowsAffected: Int
    public let parameters: [Any]?

    public var duration: TimeInterval {
        endTime.timeIntervalSince(startTime)
    }

    public var durationMs: Double {
        duration * 1000
    }

    public var isSlow: Bool {
        durationMs > 100 // 超过100ms视为慢查询
    }
}

// MARK: - Index Recommendation

/// 索引建议
public struct IndexRecommendation {
    public let tableName: String
    public let columns: [String]
    public let reason: String
    public let estimatedImprovement: String

    public var createStatement: String {
        let indexName = "idx_\(tableName)_\(columns.joined(separator: "_"))"
        return "CREATE INDEX IF NOT EXISTS \(indexName) ON \(tableName)(\(columns.joined(separator: ", ")))"
    }
}

// MARK: - Prepared Statement Cache

/// 预编译语句缓存
public class PreparedStatementCache {

    private var cache: [String: OpaquePointer] = [:]
    private let lock = NSLock()
    private let maxSize: Int

    public init(maxSize: Int = 50) {
        self.maxSize = maxSize
    }

    /// 获取或创建预编译语句
    public func get(db: OpaquePointer, sql: String) -> OpaquePointer? {
        lock.lock()
        defer { lock.unlock() }

        if let stmt = cache[sql] {
            sqlite3_reset(stmt)
            sqlite3_clear_bindings(stmt)
            return stmt
        }

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            return nil
        }

        // 缓存满时清理
        if cache.count >= maxSize {
            evictOldest()
        }

        cache[sql] = stmt
        return stmt
    }

    /// 清空缓存
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        for stmt in cache.values {
            sqlite3_finalize(stmt)
        }
        cache.removeAll()
    }

    private func evictOldest() {
        // 简单策略：移除第一个
        if let first = cache.first {
            sqlite3_finalize(first.value)
            cache.removeValue(forKey: first.key)
        }
    }

    deinit {
        clear()
    }
}

// MARK: - Batch Operation

/// 批量操作
public class BatchOperation {

    private let db: OpaquePointer
    private var operations: [(String, [Any]?)] = []
    private let batchSize: Int

    public init(db: OpaquePointer, batchSize: Int = 100) {
        self.db = db
        self.batchSize = batchSize
    }

    /// 添加操作
    public func add(sql: String, params: [Any]? = nil) {
        operations.append((sql, params))

        if operations.count >= batchSize {
            execute()
        }
    }

    /// 执行所有操作
    @discardableResult
    public func execute() -> Bool {
        guard !operations.isEmpty else { return true }

        // 开始事务
        var success = sqlite3_exec(db, "BEGIN TRANSACTION", nil, nil, nil) == SQLITE_OK

        if success {
            for (sql, params) in operations {
                var stmt: OpaquePointer?

                guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
                    success = false
                    break
                }

                // 绑定参数
                if let params = params {
                    for (index, param) in params.enumerated() {
                        bindParameter(stmt: stmt!, index: Int32(index + 1), value: param)
                    }
                }

                if sqlite3_step(stmt) != SQLITE_DONE {
                    success = false
                }

                sqlite3_finalize(stmt)

                if !success { break }
            }
        }

        // 提交或回滚
        if success {
            sqlite3_exec(db, "COMMIT", nil, nil, nil)
        } else {
            sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
        }

        operations.removeAll()
        return success
    }

    private func bindParameter(stmt: OpaquePointer, index: Int32, value: Any) {
        switch value {
        case let intValue as Int:
            sqlite3_bind_int64(stmt, index, Int64(intValue))
        case let int64Value as Int64:
            sqlite3_bind_int64(stmt, index, int64Value)
        case let doubleValue as Double:
            sqlite3_bind_double(stmt, index, doubleValue)
        case let stringValue as String:
            sqlite3_bind_text(stmt, index, stringValue, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        case let dataValue as Data:
            dataValue.withUnsafeBytes { ptr in
                sqlite3_bind_blob(stmt, index, ptr.baseAddress, Int32(dataValue.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
        case is NSNull:
            sqlite3_bind_null(stmt, index)
        default:
            sqlite3_bind_null(stmt, index)
        }
    }
}

// MARK: - Database Optimizer

/// 数据库优化器
@MainActor
public class DatabaseOptimizer: ObservableObject {

    // MARK: - Singleton

    public static let shared = DatabaseOptimizer()

    // MARK: - Properties

    private var db: OpaquePointer?
    private let statementCache = PreparedStatementCache()
    private var queryMetrics: [QueryMetrics] = []
    private let metricsLock = NSLock()

    @Published public private(set) var statistics = DatabaseStatistics()
    @Published public private(set) var isOptimizing = false

    /// 慢查询阈值（毫秒）
    public var slowQueryThresholdMs: Double = 100

    /// 最大保留指标数
    private let maxMetricsCount = 1000

    // MARK: - Initialization

    private init() {
        Logger.shared.info("[DatabaseOptimizer] 已初始化")
    }

    /// 设置数据库
    public func setDatabase(_ db: OpaquePointer) {
        self.db = db
        configureDatabase()
    }

    // MARK: - Configuration

    /// 配置数据库优化选项
    private func configureDatabase() {
        guard let db = db else { return }

        // 启用WAL模式
        sqlite3_exec(db, "PRAGMA journal_mode=WAL", nil, nil, nil)

        // 设置缓存大小（-2000 = 2MB）
        sqlite3_exec(db, "PRAGMA cache_size=-2000", nil, nil, nil)

        // 设置临时存储在内存
        sqlite3_exec(db, "PRAGMA temp_store=MEMORY", nil, nil, nil)

        // 设置同步模式
        sqlite3_exec(db, "PRAGMA synchronous=NORMAL", nil, nil, nil)

        // 启用外键约束
        sqlite3_exec(db, "PRAGMA foreign_keys=ON", nil, nil, nil)

        // 启用自动VACUUM
        sqlite3_exec(db, "PRAGMA auto_vacuum=INCREMENTAL", nil, nil, nil)

        // 设置mmap大小（256MB）
        sqlite3_exec(db, "PRAGMA mmap_size=268435456", nil, nil, nil)

        Logger.shared.info("[DatabaseOptimizer] 数据库配置完成")
    }

    // MARK: - Query Tracking

    /// 记录查询指标
    public func recordQuery(_ metrics: QueryMetrics) {
        metricsLock.lock()
        defer { metricsLock.unlock() }

        queryMetrics.append(metrics)

        // 限制数量
        if queryMetrics.count > maxMetricsCount {
            queryMetrics.removeFirst(queryMetrics.count - maxMetricsCount)
        }

        // 更新统计
        Task { @MainActor in
            self.statistics.queryCount += 1
            if metrics.isSlow {
                self.statistics.slowQueryCount += 1
            }

            let totalDuration = self.queryMetrics.reduce(0) { $0 + $1.durationMs }
            self.statistics.averageQueryTimeMs = totalDuration / Double(self.queryMetrics.count)
        }
    }

    /// 获取慢查询列表
    public func getSlowQueries(limit: Int = 20) -> [QueryMetrics] {
        metricsLock.lock()
        defer { metricsLock.unlock() }

        return queryMetrics
            .filter { $0.isSlow }
            .sorted { $0.durationMs > $1.durationMs }
            .prefix(limit)
            .map { $0 }
    }

    // MARK: - Optimization

    /// 执行完整优化
    public func optimize() async {
        guard let db = db else { return }

        isOptimizing = true
        defer { isOptimizing = false }

        Logger.shared.info("[DatabaseOptimizer] 开始优化...")

        // 1. VACUUM
        await vacuum()

        // 2. 分析表
        await analyze()

        // 3. 检查完整性
        _ = await checkIntegrity()

        // 4. 更新统计
        await updateStatistics()

        Logger.shared.info("[DatabaseOptimizer] 优化完成")
    }

    /// VACUUM数据库
    public func vacuum() async {
        guard let db = db else { return }

        Logger.shared.info("[DatabaseOptimizer] 执行VACUUM...")

        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                sqlite3_exec(db, "VACUUM", nil, nil, nil)
                continuation.resume()
            }
        }
    }

    /// 分析所有表
    public func analyze() async {
        guard let db = db else { return }

        Logger.shared.info("[DatabaseOptimizer] 执行ANALYZE...")

        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                sqlite3_exec(db, "ANALYZE", nil, nil, nil)
                continuation.resume()
            }
        }
    }

    /// 检查数据库完整性
    public func checkIntegrity() async -> Bool {
        guard let db = db else { return false }

        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }

        guard sqlite3_prepare_v2(db, "PRAGMA integrity_check", -1, &stmt, nil) == SQLITE_OK else {
            return false
        }

        if sqlite3_step(stmt) == SQLITE_ROW {
            if let result = sqlite3_column_text(stmt, 0) {
                let resultStr = String(cString: result)
                let isOK = resultStr == "ok"

                if !isOK {
                    Logger.shared.error("[DatabaseOptimizer] 完整性检查失败: \(resultStr)")
                }

                return isOK
            }
        }

        return false
    }

    /// 增量WAL检查点
    public func checkpoint() async {
        guard let db = db else { return }

        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                sqlite3_wal_checkpoint_v2(db, nil, SQLITE_CHECKPOINT_PASSIVE, nil, nil)
                continuation.resume()
            }
        }
    }

    // MARK: - Index Management

    /// 创建索引
    public func createIndex(table: String, columns: [String], unique: Bool = false) async -> Bool {
        guard let db = db else { return false }

        let indexName = "idx_\(table)_\(columns.joined(separator: "_"))"
        let uniqueStr = unique ? "UNIQUE" : ""
        let sql = "CREATE \(uniqueStr) INDEX IF NOT EXISTS \(indexName) ON \(table)(\(columns.joined(separator: ", ")))"

        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let result = sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
                if result {
                    Logger.shared.info("[DatabaseOptimizer] 创建索引: \(indexName)")
                }
                continuation.resume(returning: result)
            }
        }
    }

    /// 删除索引
    public func dropIndex(name: String) async -> Bool {
        guard let db = db else { return false }

        let sql = "DROP INDEX IF EXISTS \(name)"

        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let result = sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
                continuation.resume(returning: result)
            }
        }
    }

    /// 获取索引列表
    public func getIndexes() -> [(name: String, table: String, columns: String)] {
        guard let db = db else { return [] }

        var indexes: [(String, String, String)] = []
        var stmt: OpaquePointer?

        let sql = """
            SELECT name, tbl_name, sql FROM sqlite_master
            WHERE type='index' AND sql IS NOT NULL
        """

        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_finalize(stmt) }

        while sqlite3_step(stmt) == SQLITE_ROW {
            let name = String(cString: sqlite3_column_text(stmt, 0))
            let table = String(cString: sqlite3_column_text(stmt, 1))
            let sqlStr = String(cString: sqlite3_column_text(stmt, 2))

            indexes.append((name, table, sqlStr))
        }

        return indexes
    }

    /// 分析并建议索引
    public func recommendIndexes() -> [IndexRecommendation] {
        var recommendations: [IndexRecommendation] = []

        // 基于慢查询分析
        let slowQueries = getSlowQueries(limit: 50)

        for query in slowQueries {
            // 简单分析：查找WHERE和ORDER BY子句
            let sql = query.sql.uppercased()

            if let whereRange = sql.range(of: "WHERE"),
               let orderRange = sql.range(of: "ORDER BY") ?? sql.range(of: "GROUP BY") {

                // 提取表名
                if let fromRange = sql.range(of: "FROM"),
                   let tableEndRange = sql.range(of: " ", range: fromRange.upperBound..<sql.endIndex) {
                    let tableName = String(sql[fromRange.upperBound..<tableEndRange.lowerBound]).trimmingCharacters(in: .whitespaces)

                    recommendations.append(IndexRecommendation(
                        tableName: tableName,
                        columns: ["<待分析>"],
                        reason: "慢查询 (\(Int(query.durationMs))ms)",
                        estimatedImprovement: "可能提升10-100倍"
                    ))
                }
            }
        }

        return recommendations
    }

    // MARK: - Statistics

    /// 更新统计信息
    public func updateStatistics() async {
        guard let db = db else { return }

        var stats = DatabaseStatistics()

        // 表数量
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='table'", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW {
                stats.totalTables = Int(sqlite3_column_int(stmt, 0))
            }
            sqlite3_finalize(stmt)
        }

        // 索引数量
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM sqlite_master WHERE type='index'", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW {
                stats.totalIndexes = Int(sqlite3_column_int(stmt, 0))
            }
            sqlite3_finalize(stmt)
        }

        // 数据库大小
        if sqlite3_prepare_v2(db, "PRAGMA page_count", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW {
                let pageCount = sqlite3_column_int64(stmt, 0)
                sqlite3_finalize(stmt)

                if sqlite3_prepare_v2(db, "PRAGMA page_size", -1, &stmt, nil) == SQLITE_OK {
                    if sqlite3_step(stmt) == SQLITE_ROW {
                        let pageSize = sqlite3_column_int64(stmt, 0)
                        stats.databaseSizeBytes = pageCount * pageSize
                    }
                }
            }
            sqlite3_finalize(stmt)
        }

        // WAL大小
        if sqlite3_prepare_v2(db, "PRAGMA wal_checkpoint", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW {
                let walPages = sqlite3_column_int64(stmt, 1)
                stats.walSizeBytes = walPages * 4096 // 默认页面大小
            }
            sqlite3_finalize(stmt)
        }

        // 保留查询统计
        stats.queryCount = statistics.queryCount
        stats.slowQueryCount = statistics.slowQueryCount
        stats.averageQueryTimeMs = statistics.averageQueryTimeMs

        statistics = stats
    }

    // MARK: - Batch Operations

    /// 创建批量操作
    public func createBatchOperation(batchSize: Int = 100) -> BatchOperation? {
        guard let db = db else { return nil }
        return BatchOperation(db: db, batchSize: batchSize)
    }

    // MARK: - Statement Cache

    /// 获取预编译语句
    public func prepareStatement(sql: String) -> OpaquePointer? {
        guard let db = db else { return nil }
        return statementCache.get(db: db, sql: sql)
    }

    /// 清空语句缓存
    public func clearStatementCache() {
        statementCache.clear()
    }
}

// MARK: - Query Helper

extension DatabaseOptimizer {

    /// 执行查询并记录指标
    public func executeQuery<T>(
        sql: String,
        params: [Any]? = nil,
        mapper: (OpaquePointer) -> T?
    ) -> [T] {
        guard let db = db else { return [] }

        let startTime = Date()
        var results: [T] = []

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_finalize(stmt) }

        // 绑定参数
        if let params = params {
            for (index, param) in params.enumerated() {
                bindParameter(stmt: stmt!, index: Int32(index + 1), value: param)
            }
        }

        while sqlite3_step(stmt) == SQLITE_ROW {
            if let result = mapper(stmt!) {
                results.append(result)
            }
        }

        let endTime = Date()
        let metrics = QueryMetrics(
            sql: sql,
            startTime: startTime,
            endTime: endTime,
            rowsAffected: results.count,
            parameters: params
        )
        recordQuery(metrics)

        return results
    }

    private func bindParameter(stmt: OpaquePointer, index: Int32, value: Any) {
        switch value {
        case let intValue as Int:
            sqlite3_bind_int64(stmt, index, Int64(intValue))
        case let int64Value as Int64:
            sqlite3_bind_int64(stmt, index, int64Value)
        case let doubleValue as Double:
            sqlite3_bind_double(stmt, index, doubleValue)
        case let stringValue as String:
            sqlite3_bind_text(stmt, index, stringValue, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        case let dataValue as Data:
            dataValue.withUnsafeBytes { ptr in
                sqlite3_bind_blob(stmt, index, ptr.baseAddress, Int32(dataValue.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
        default:
            sqlite3_bind_null(stmt, index)
        }
    }
}
