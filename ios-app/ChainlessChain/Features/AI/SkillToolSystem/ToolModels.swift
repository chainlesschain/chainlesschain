//
//  ToolModels.swift
//  ChainlessChain
//
//  Core type definitions for the Tool system
//  Referenced by: ToolManager, BuiltinTools, AdvancedTools, and all tool definition files
//  Reference: desktop-app-vue/src/main/skill-tool-system/
//

import Foundation

// MARK: - Tool Parameter Type

/// Types of tool parameters
public enum ToolParameterType: String, Codable {
    case string = "string"
    case number = "number"
    case boolean = "boolean"
    case array = "array"
    case object = "object"
    case url = "url"
}

// MARK: - Tool Parameter

/// Definition of a tool parameter
public struct ToolParameter: Codable, Hashable {
    public let name: String
    public let type: ToolParameterType
    public let description: String
    public let required: Bool
    public let defaultValue: String?

    public init(
        name: String,
        type: ToolParameterType,
        description: String,
        required: Bool = true,
        defaultValue: String? = nil
    ) {
        self.name = name
        self.type = type
        self.description = description
        self.required = required
        self.defaultValue = defaultValue
    }
}

// MARK: - Tool Example

/// Example usage for a tool
public struct ToolExample: Codable, Hashable {
    public let description: String
    public let input: [String: String]
    public let output: String

    public init(
        description: String,
        input: [String: String] = [:],
        output: String = ""
    ) {
        self.description = description
        self.input = input
        self.output = output
    }
}

// MARK: - Tool

/// Tool definition
public struct Tool: Identifiable, Codable, Hashable {
    public let id: String
    public let name: String
    public let description: String
    public let category: SkillCategory
    public let parameters: [ToolParameter]
    public let returnType: ToolParameterType
    public let returnDescription: String
    public let examples: [ToolExample]
    public let tags: [String]
    public let rateLimit: Int?

    public init(
        id: String,
        name: String,
        description: String,
        category: SkillCategory = .general,
        parameters: [ToolParameter] = [],
        returnType: ToolParameterType = .object,
        returnDescription: String = "",
        examples: [ToolExample] = [],
        tags: [String] = [],
        rateLimit: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.category = category
        self.parameters = parameters
        self.returnType = returnType
        self.returnDescription = returnDescription
        self.examples = examples
        self.tags = tags
        self.rateLimit = rateLimit
    }

    /// Validate input parameters against this tool's parameter definitions
    public func validate(input: ToolInput) throws {
        for param in parameters where param.required {
            if input.getString(param.name) == nil &&
               input.getInt(param.name) == nil &&
               input.getDouble(param.name) == nil &&
               input.getBool(param.name) == nil &&
               input.getArray(param.name) == nil &&
               input.getObject(param.name) == nil {
                if param.defaultValue == nil {
                    throw ToolError.executionFailed(name, "Missing required parameter: \(param.name)")
                }
            }
        }
    }
}

// MARK: - Tool Input

/// Input wrapper for tool execution
public struct ToolInput {
    public let parameters: [String: Any]

    public init(parameters: [String: Any]) {
        self.parameters = parameters
    }

    /// Get a string parameter
    public func getString(_ key: String) -> String? {
        parameters[key] as? String
    }

    /// Get an integer parameter
    public func getInt(_ key: String) -> Int? {
        if let val = parameters[key] as? Int { return val }
        if let val = parameters[key] as? Double { return Int(val) }
        if let val = parameters[key] as? String { return Int(val) }
        return nil
    }

    /// Get a double parameter
    public func getDouble(_ key: String) -> Double? {
        if let val = parameters[key] as? Double { return val }
        if let val = parameters[key] as? Int { return Double(val) }
        if let val = parameters[key] as? Float { return Double(val) }
        if let val = parameters[key] as? String { return Double(val) }
        return nil
    }

    /// Get a boolean parameter
    public func getBool(_ key: String) -> Bool? {
        if let val = parameters[key] as? Bool { return val }
        if let val = parameters[key] as? Int { return val != 0 }
        if let val = parameters[key] as? String { return val.lowercased() == "true" }
        return nil
    }

    /// Get an array parameter
    public func getArray(_ key: String) -> [Any]? {
        parameters[key] as? [Any]
    }

    /// Get a dictionary parameter
    public func getObject(_ key: String) -> [String: Any]? {
        parameters[key] as? [String: Any]
    }
}

// MARK: - Tool Output

/// Result of tool execution
public enum ToolOutput {
    case success(data: Any)
    case failure(error: String)

    /// Whether the execution was successful
    public var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }

    /// Get the data (if success)
    public var data: Any? {
        if case .success(let data) = self { return data }
        return nil
    }

    /// Get the error (if failure)
    public var error: String? {
        if case .failure(let error) = self { return error }
        return nil
    }
}

// MARK: - Tool Executor

/// Closure type for executing a tool
public typealias ToolExecutor = (ToolInput) async throws -> ToolOutput

// MARK: - Skill Category (mirror of Features/AI/Skills/SkillSystem.swift)

/// 技能分类 — copied here so the in-pbxproj subset of files (ToolModels +
/// ComputerUseToolRegistration) sees it. The original definition in
/// SkillSystem.swift is not in xcodeproj compile sources yet.
public enum SkillCategory: String, Codable, CaseIterable {
    case codeReview = "code-review"
    case git
    case documentation
    case testing
    case refactoring
    case debugging
    case analysis
    case generation
    case general
    case custom
    case document
    case data
    case web
    case knowledge
    case code
    case system
    case blockchain
    case communication
    case media
}

// MARK: - Tool Error (mirror of ToolManager.swift)

/// 工具错误 — mirror of ToolManager.swift definition so ToolModels.swift
/// throw-site at line 117 compiles before ToolManager.swift is wired in.
public enum ToolError: LocalizedError {
    case toolNotFound(String)
    case executorNotFound(String)
    case executionFailed(String, String)
    case rateLimitExceeded(Int)

    public var errorDescription: String? {
        switch self {
        case .toolNotFound(let id):
            return "工具未找到: \(id)"
        case .executorNotFound(let id):
            return "工具执行器未找到: \(id)"
        case .executionFailed(let name, let error):
            return "工具执行失败 '\(name)': \(error)"
        case .rateLimitExceeded(let limit):
            return "超出速率限制: 每分钟最多 \(limit) 次调用"
        }
    }
}

// MARK: - Tool Manager (minimal stub)

/// 工具管理器 — minimal stub so ComputerUseToolRegistration.shared.register/.unregister
/// compile. Real implementation in ToolManager.swift (not in xcodeproj compile
/// sources yet). When that file is wired in, delete this stub.
public final class ToolManager {
    public static let shared = ToolManager()

    private var toolsById: [String: Tool] = [:]
    private var executors: [String: ToolExecutor] = [:]

    private init() {}

    public func register(_ tool: Tool, executor: @escaping ToolExecutor) {
        toolsById[tool.id] = tool
        executors[tool.id] = executor
    }

    public func unregister(toolId: String) {
        toolsById.removeValue(forKey: toolId)
        executors.removeValue(forKey: toolId)
    }
}
