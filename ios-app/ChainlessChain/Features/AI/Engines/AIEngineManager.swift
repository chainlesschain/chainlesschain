import Foundation
import Combine

/// AI引擎管理器
///
/// 负责管理所有AI引擎的生命周期和调度
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/ai-engine-manager.js
public class AIEngineManager: ObservableObject {
    public static let shared = AIEngineManager()

    @Published public private(set) var engines: [AIEngineType: AIEngine] = [:]
    @Published public private(set) var isInitializing: Bool = false

    private init() {
        registerEngines()
    }

    // MARK: - 引擎注册

    /// 注册所有内置引擎
    private func registerEngines() {
        // Phase 1-2: 核心引擎
        engines[.document] = DocumentEngine.shared
        engines[.data] = DataEngine.shared
        engines[.code] = CodeEngine.shared
        engines[.web] = WebEngine.shared
        engines[.knowledge] = KnowledgeEngine.shared

        // Phase 3: 多媒体引擎
        engines[.image] = ImageEngine.shared
        engines[.audio] = AudioEngine.shared
        engines[.video] = VideoEngine.shared

        // Phase 3: 开发工具引擎
        engines[.git] = GitEngine.shared

        // Phase 3: 区块链集成引擎
        engines[.blockchain] = BlockchainEngine.shared

        // Phase 3: 安全和数据引擎
        engines[.security] = SecurityEngine.shared
        engines[.database] = DatabaseEngine.shared
        engines[.sync] = SyncEngine.shared

        // Phase 3: 社交和交易引擎（合并实现）
        engines[.social] = SocialTradeEngine.shared
        engines[.trade] = SocialTradeEngine.shared // 共享同一实例

        // 注意：ProjectEngine 功能可以通过其他引擎组合实现
        // 如需要，可稍后添加独立的ProjectEngine

        Logger.shared.info("已注册 \(engines.count) 个AI引擎")
    }

    /// 注册自定义引擎
    public func register(engine: AIEngine) {
        engines[engine.engineType] = engine
        Logger.shared.info("注册引擎: \(engine.engineName)")
    }

    /// 注销引擎
    public func unregister(engineType: AIEngineType) {
        engines.removeValue(forKey: engineType)
        Logger.shared.info("注销引擎: \(engineType.rawValue)")
    }

    // MARK: - 引擎访问

    /// 获取指定类型的引擎
    public func getEngine(_ type: AIEngineType) -> AIEngine? {
        return engines[type]
    }

    /// 获取所有已注册的引擎
    public func getAllEngines() -> [AIEngine] {
        return Array(engines.values)
    }

    /// 检查引擎是否已注册
    public func isRegistered(_ type: AIEngineType) -> Bool {
        return engines[type] != nil
    }

    // MARK: - 引擎生命周期

    /// 初始化所有引擎
    public func initializeAll() async throws {
        isInitializing = true
        defer { isInitializing = false }

        Logger.shared.info("初始化所有AI引擎...")

        for (type, engine) in engines {
            do {
                try await engine.initialize()
                Logger.shared.info("引擎 \(type.displayName) 初始化成功")
            } catch {
                Logger.shared.error("引擎 \(type.displayName) 初始化失败: \(error)")
                throw error
            }
        }

        Logger.shared.info("所有AI引擎初始化完成")
    }

    /// 初始化指定引擎
    public func initialize(engineType: AIEngineType) async throws {
        guard let engine = engines[engineType] else {
            throw AIEngineManagerError.engineNotFound(engineType)
        }

        try await engine.initialize()
    }

    /// 关闭所有引擎
    public func shutdownAll() async throws {
        Logger.shared.info("关闭所有AI引擎...")

        for (type, engine) in engines {
            do {
                try await engine.shutdown()
                Logger.shared.info("引擎 \(type.displayName) 已关闭")
            } catch {
                Logger.shared.error("引擎 \(type.displayName) 关闭失败: \(error)")
            }
        }

        Logger.shared.info("所有AI引擎已关闭")
    }

    /// 关闭指定引擎
    public func shutdown(engineType: AIEngineType) async throws {
        guard let engine = engines[engineType] else {
            throw AIEngineManagerError.engineNotFound(engineType)
        }

        try await engine.shutdown()
    }

    // MARK: - 任务执行

    /// 执行任务（自动选择合适的引擎）
    /// - Parameters:
    ///   - task: 任务描述
    ///   - parameters: 任务参数
    /// - Returns: 执行结果
    public func execute(
        task: String,
        parameters: [String: Any] = [:]
    ) async throws -> Any {
        // 智能路由：根据任务描述选择合适的引擎
        let engineType = try await selectEngine(forTask: task)

        guard let engine = engines[engineType] else {
            throw AIEngineManagerError.engineNotFound(engineType)
        }

        return try await engine.execute(task: task, parameters: parameters)
    }

    /// 使用指定引擎执行任务
    public func execute(
        engineType: AIEngineType,
        task: String,
        parameters: [String: Any] = [:]
    ) async throws -> Any {
        guard let engine = engines[engineType] else {
            throw AIEngineManagerError.engineNotFound(engineType)
        }

        return try await engine.execute(task: task, parameters: parameters)
    }

    // MARK: - 智能路由

    /// 根据任务描述选择合适的引擎
    private func selectEngine(forTask task: String) async throws -> AIEngineType {
        // 关键词匹配
        let taskLower = task.lowercased()

        if taskLower.contains("pdf") || taskLower.contains("文档") || taskLower.contains("word") {
            return .document
        }

        if taskLower.contains("数据") || taskLower.contains("统计") || taskLower.contains("图表") {
            return .data
        }

        if taskLower.contains("代码") || taskLower.contains("code") || taskLower.contains("git") {
            return .code
        }

        if taskLower.contains("网页") || taskLower.contains("web") || taskLower.contains("http") {
            return .web
        }

        if taskLower.contains("图片") || taskLower.contains("image") || taskLower.contains("ocr") {
            return .image
        }

        if taskLower.contains("知识") || taskLower.contains("搜索") || taskLower.contains("问答") {
            return .knowledge
        }

        if taskLower.contains("区块链") || taskLower.contains("钱包") || taskLower.contains("交易") {
            return .blockchain
        }

        // 默认返回知识引擎
        return .knowledge
    }

    // MARK: - 引擎统计

    /// 获取引擎统计信息
    public func getStatistics() -> [String: Any] {
        var stats: [String: Any] = [:]

        stats["totalEngines"] = engines.count

        var engineStats: [[String: Any]] = []
        for (type, engine) in engines {
            engineStats.append([
                "type": type.rawValue,
                "name": engine.engineName,
                "status": String(describing: engine.status),
                "capabilities": engine.capabilities.count
            ])
        }
        stats["engines"] = engineStats

        return stats
    }
}

// MARK: - AI引擎管理器错误

public enum AIEngineManagerError: LocalizedError {
    case engineNotFound(AIEngineType)
    case engineNotInitialized(AIEngineType)

    public var errorDescription: String? {
        switch self {
        case .engineNotFound(let type):
            return "引擎未找到: \(type.displayName)"
        case .engineNotInitialized(let type):
            return "引擎未初始化: \(type.displayName)"
        }
    }
}
