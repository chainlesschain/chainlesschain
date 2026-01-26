import Foundation
import Combine

/// AI引擎类型
public enum AIEngineType: String, CaseIterable {
    case document = "document"       // 文档引擎
    case data = "data"               // 数据引擎
    case code = "code"               // 代码引擎
    case web = "web"                 // Web引擎
    case image = "image"             // 图像引擎
    case video = "video"             // 视频引擎
    case audio = "audio"             // 音频引擎
    case knowledge = "knowledge"     // 知识引擎
    case project = "project"         // 项目引擎
    case git = "git"                 // Git引擎
    case blockchain = "blockchain"   // 区块链引擎
    case social = "social"           // 社交引擎
    case trade = "trade"             // 交易引擎
    case security = "security"       // 安全引擎
    case database = "database"       // 数据库引擎
    case sync = "sync"               // 同步引擎

    var displayName: String {
        switch self {
        case .document: return "文档引擎"
        case .data: return "数据引擎"
        case .code: return "代码引擎"
        case .web: return "Web引擎"
        case .image: return "图像引擎"
        case .video: return "视频引擎"
        case .audio: return "音频引擎"
        case .knowledge: return "知识引擎"
        case .project: return "项目引擎"
        case .git: return "Git引擎"
        case .blockchain: return "区块链引擎"
        case .social: return "社交引擎"
        case .trade: return "交易引擎"
        case .security: return "安全引擎"
        case .database: return "数据库引擎"
        case .sync: return "同步引擎"
        }
    }

    var icon: String {
        switch self {
        case .document: return "doc.text"
        case .data: return "chart.bar"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .web: return "globe"
        case .image: return "photo"
        case .video: return "video"
        case .audio: return "waveform"
        case .knowledge: return "brain.head.profile"
        case .project: return "folder"
        case .git: return "arrow.triangle.branch"
        case .blockchain: return "link"
        case .social: return "person.2"
        case .trade: return "cart"
        case .security: return "lock.shield"
        case .database: return "cylinder"
        case .sync: return "arrow.triangle.2.circlepath"
        }
    }
}

/// AI引擎状态
public enum AIEngineStatus {
    case idle           // 空闲
    case initializing   // 初始化中
    case running        // 运行中
    case error(Error)   // 错误
}

/// AI引擎能力
public struct AIEngineCapability: Hashable {
    public let id: String
    public let name: String
    public let description: String

    public init(id: String, name: String, description: String) {
        self.id = id
        self.name = name
        self.description = description
    }
}

/// AI引擎协议
///
/// 所有AI引擎必须实现此协议
public protocol AIEngine: AnyObject {
    /// 引擎类型
    var engineType: AIEngineType { get }

    /// 引擎名称
    var engineName: String { get }

    /// 引擎描述
    var engineDescription: String { get }

    /// 引擎状态
    var status: AIEngineStatus { get }

    /// 支持的能力列表
    var capabilities: [AIEngineCapability] { get }

    /// 初始化引擎
    func initialize() async throws

    /// 执行任务
    /// - Parameters:
    ///   - task: 任务描述
    ///   - parameters: 任务参数
    /// - Returns: 任务结果
    func execute(task: String, parameters: [String: Any]) async throws -> Any

    /// 停止引擎
    func shutdown() async throws
}

/// AI引擎基类
///
/// 提供默认实现和通用功能
open class BaseAIEngine: AIEngine, ObservableObject {
    public let engineType: AIEngineType
    public let engineName: String
    public let engineDescription: String

    @Published public private(set) var status: AIEngineStatus = .idle

    public var capabilities: [AIEngineCapability] {
        return []
    }

    // 依赖的管理器
    protected let skillManager = SkillManager.shared
    protected let toolManager = ToolManager.shared
    protected let llmManager = LLMManager.shared

    public init(type: AIEngineType, name: String, description: String) {
        self.engineType = type
        self.engineName = name
        self.engineDescription = description
    }

    // MARK: - 生命周期

    open func initialize() async throws {
        Logger.shared.info("\(engineName) 初始化中...")
        status = .initializing

        // 子类重写此方法实现特定的初始化逻辑

        status = .idle
        Logger.shared.info("\(engineName) 初始化完成")
    }

    open func execute(task: String, parameters: [String: Any]) async throws -> Any {
        Logger.shared.info("\(engineName) 执行任务: \(task)")
        status = .running

        // 子类重写此方法实现特定的执行逻辑
        // 默认实现返回空字典
        defer {
            status = .idle
        }

        return [:]
    }

    open func shutdown() async throws {
        Logger.shared.info("\(engineName) 关闭中...")
        status = .idle
    }

    // MARK: - 辅助方法

    /// 使用LLM生成内容
    protected func generateWithLLM(
        prompt: String,
        systemPrompt: String? = nil
    ) async throws -> String {
        return try await llmManager.generateText(
            prompt: prompt,
            systemPrompt: systemPrompt
        )
    }

    /// 执行工具
    protected func executeTool(
        toolId: String,
        parameters: [String: Any]
    ) async throws -> ToolOutput {
        let input = ToolInput(parameters: parameters)
        return try await toolManager.execute(toolId: toolId, input: input)
    }

    /// 执行技能
    protected func executeSkill(
        skillId: String,
        parameters: [String: Any]
    ) async throws -> SkillExecutionResult {
        return try await skillManager.execute(skillId: skillId, input: parameters)
    }
}

// MARK: - AI引擎错误

public enum AIEngineError: LocalizedError {
    case notInitialized
    case invalidParameters(String)
    case executionFailed(String)
    case capabilityNotSupported(String)

    public var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "引擎未初始化"
        case .invalidParameters(let message):
            return "无效的参数: \(message)"
        case .executionFailed(let message):
            return "执行失败: \(message)"
        case .capabilityNotSupported(let capability):
            return "不支持的能力: \(capability)"
        }
    }
}
