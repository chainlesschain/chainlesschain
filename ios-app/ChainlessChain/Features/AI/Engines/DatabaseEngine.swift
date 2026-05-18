import Foundation
import SQLite
import SQLite3

/// 数据库引擎
///
/// 负责数据库操作、查询优化、数据管理等任务
public class DatabaseEngine: BaseAIEngine {

    public static let shared = DatabaseEngine()

    private init() {
        super.init(
            type: .database,
            name: "数据库引擎",
            description: "处理数据库操作、查询优化、数据管理等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(id: "query", name: "执行查询", description: "执行SQL查询"),
            AIEngineCapability(id: "insert", name: "插入数据", description: "向数据库插入数据"),
            AIEngineCapability(id: "update", name: "更新数据", description: "更新数据库记录"),
            AIEngineCapability(id: "delete", name: "删除数据", description: "删除数据库记录"),
            AIEngineCapability(id: "optimize", name: "优化查询", description: "优化SQL查询性能"),
            AIEngineCapability(id: "backup", name: "数据备份", description: "备份数据库"),
            AIEngineCapability(id: "analyze", name: "数据分析", description: "分析数据库性能和使用情况")
        ]
    }

    public override func initialize() async throws {
        try await super.initialize()
        Logger.shared.info("数据库引擎初始化完成")
    }

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        switch task {
        case "query":
            return try await executeQuery(parameters: parameters)
        case "optimize":
            return try await optimizeQuery(parameters: parameters)
        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    private func executeQuery(parameters: [String: Any]) async throws -> [String: Any] {
        guard let sql = parameters["sql"] as? String else {
            throw AIEngineError.invalidParameters("缺少sql参数")
        }

        // Only allow SELECT queries for safety — no mutations from AI engine
        let trimmed = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard trimmed.hasPrefix("SELECT") else {
            return [
                "error": "Only SELECT queries are allowed through the AI engine",
                "sql": sql,
                "result": [] as [Any],
                "rowsAffected": 0
            ]
        }

        do {
            let rows: [[String: Any]] = try DatabaseManager.shared.query(sql) { stmt in
                var row: [String: Any] = [:]
                let columnCount = sqlite3_column_count(stmt)
                for i in 0..<columnCount {
                    let name = String(cString: sqlite3_column_name(stmt, i))
                    let type = sqlite3_column_type(stmt, i)
                    switch type {
                    case SQLITE_INTEGER:
                        row[name] = sqlite3_column_int64(stmt, i)
                    case SQLITE_FLOAT:
                        row[name] = sqlite3_column_double(stmt, i)
                    case SQLITE_TEXT:
                        row[name] = String(cString: sqlite3_column_text(stmt, i))
                    case SQLITE_NULL:
                        row[name] = NSNull()
                    default:
                        row[name] = String(cString: sqlite3_column_text(stmt, i))
                    }
                }
                return row
            }

            return [
                "result": rows,
                "rowsAffected": rows.count,
                "sql": sql
            ]
        } catch {
            return [
                "error": error.localizedDescription,
                "sql": sql,
                "result": [] as [Any],
                "rowsAffected": 0
            ]
        }
    }

    private func optimizeQuery(parameters: [String: Any]) async throws -> [String: Any] {
        guard let sql = parameters["sql"] as? String else {
            throw AIEngineError.invalidParameters("缺少sql参数")
        }

        let prompt = """
        请优化以下SQL查询：

        \(sql)

        请提供：
        1. 优化后的SQL
        2. 性能提升说明
        3. 索引建议
        """

        let optimization = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个数据库优化专家。"
        )

        return [
            "originalSQL": sql,
            "optimization": optimization
        ]
    }
}
