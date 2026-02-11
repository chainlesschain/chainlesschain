//
//  PluginModels.swift
//  ChainlessChain
//
//  插件系统数据模型
//  定义插件相关的核心数据结构
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation

// MARK: - Plugin

/// 插件实体
public struct Plugin: Identifiable, Codable, Hashable {
    public let id: String
    public var name: String
    public var version: String
    public var description: String
    public var author: String
    public var homepage: String?
    public var icon: String?
    public var category: PluginCategory
    public var tags: [String]
    public var permissions: PluginPermissions
    public var manifest: PluginManifest

    // 状态
    public var isEnabled: Bool
    public var isInstalled: Bool
    public var installedAt: Date?
    public var updatedAt: Date?

    // 运行时信息
    public var loadedAt: Date?
    public var lastUsedAt: Date?
    public var usageCount: Int

    public init(
        id: String = UUID().uuidString,
        name: String,
        version: String = "1.0.0",
        description: String = "",
        author: String = "",
        homepage: String? = nil,
        icon: String? = nil,
        category: PluginCategory = .utility,
        tags: [String] = [],
        permissions: PluginPermissions = PluginPermissions(),
        manifest: PluginManifest = PluginManifest(),
        isEnabled: Bool = true,
        isInstalled: Bool = false
    ) {
        self.id = id
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.homepage = homepage
        self.icon = icon
        self.category = category
        self.tags = tags
        self.permissions = permissions
        self.manifest = manifest
        self.isEnabled = isEnabled
        self.isInstalled = isInstalled
        self.installedAt = nil
        self.updatedAt = nil
        self.loadedAt = nil
        self.lastUsedAt = nil
        self.usageCount = 0
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    public static func == (lhs: Plugin, rhs: Plugin) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Plugin Category

/// 插件分类
public enum PluginCategory: String, Codable, CaseIterable {
    case productivity = "productivity"
    case dataAnalysis = "data_analysis"
    case office = "office"
    case developer = "developer"
    case communication = "communication"
    case utility = "utility"
    case ai = "ai"
    case blockchain = "blockchain"
    case custom = "custom"

    public var displayName: String {
        switch self {
        case .productivity: return "生产力"
        case .dataAnalysis: return "数据分析"
        case .office: return "办公套件"
        case .developer: return "开发工具"
        case .communication: return "通讯"
        case .utility: return "实用工具"
        case .ai: return "AI增强"
        case .blockchain: return "区块链"
        case .custom: return "自定义"
        }
    }

    public var icon: String {
        switch self {
        case .productivity: return "bolt.fill"
        case .dataAnalysis: return "chart.bar.fill"
        case .office: return "doc.fill"
        case .developer: return "terminal.fill"
        case .communication: return "bubble.left.and.bubble.right.fill"
        case .utility: return "wrench.fill"
        case .ai: return "brain"
        case .blockchain: return "link"
        case .custom: return "puzzlepiece.fill"
        }
    }
}

// MARK: - Plugin State

/// 插件状态
public enum PluginState: String, Codable {
    case notInstalled = "not_installed"
    case installed = "installed"
    case loading = "loading"
    case active = "active"
    case error = "error"
    case disabled = "disabled"
    case updating = "updating"

    public var displayName: String {
        switch self {
        case .notInstalled: return "未安装"
        case .installed: return "已安装"
        case .loading: return "加载中"
        case .active: return "运行中"
        case .error: return "错误"
        case .disabled: return "已禁用"
        case .updating: return "更新中"
        }
    }

    public var color: String {
        switch self {
        case .notInstalled: return "gray"
        case .installed: return "blue"
        case .loading: return "orange"
        case .active: return "green"
        case .error: return "red"
        case .disabled: return "gray"
        case .updating: return "yellow"
        }
    }
}

// MARK: - Plugin Instance

/// 插件运行实例
public class PluginInstance: ObservableObject, Identifiable {
    public let id: String
    public let plugin: Plugin

    @Published public var state: PluginState = .installed
    @Published public var error: PluginError?
    @Published public var lastActivity: Date?

    // 运行时数据
    public var sandbox: PluginSandboxContext?
    public var loadedActions: [String: PluginAction] = [:]

    public init(plugin: Plugin) {
        self.id = plugin.id
        self.plugin = plugin
    }
}

// MARK: - Plugin Action

/// 插件动作
public struct PluginAction: Identifiable, Codable {
    public let id: String
    public let name: String
    public var description: String?
    public var icon: String?
    public var shortcut: String?
    public var inputSchema: PluginSchema?
    public var outputSchema: PluginSchema?
    public var isAsync: Bool
    public var timeout: TimeInterval

    public init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        icon: String? = nil,
        shortcut: String? = nil,
        inputSchema: PluginSchema? = nil,
        outputSchema: PluginSchema? = nil,
        isAsync: Bool = false,
        timeout: TimeInterval = 30
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.shortcut = shortcut
        self.inputSchema = inputSchema
        self.outputSchema = outputSchema
        self.isAsync = isAsync
        self.timeout = timeout
    }
}

// MARK: - Plugin Schema

/// 插件参数模式
public struct PluginSchema: Codable {
    public let type: String
    public var properties: [String: PluginSchemaProperty]
    public var required: [String]

    public init(
        type: String = "object",
        properties: [String: PluginSchemaProperty] = [:],
        required: [String] = []
    ) {
        self.type = type
        self.properties = properties
        self.required = required
    }
}

/// 模式属性
public struct PluginSchemaProperty: Codable {
    public let type: String
    public var description: String?
    public var defaultValue: AnyCodable?
    public var enumValues: [String]?
    public var minimum: Double?
    public var maximum: Double?

    public init(
        type: String,
        description: String? = nil,
        defaultValue: AnyCodable? = nil,
        enumValues: [String]? = nil,
        minimum: Double? = nil,
        maximum: Double? = nil
    ) {
        self.type = type
        self.description = description
        self.defaultValue = defaultValue
        self.enumValues = enumValues
        self.minimum = minimum
        self.maximum = maximum
    }
}

// MARK: - Plugin Error

/// 插件错误
public enum PluginError: Error, LocalizedError {
    case notFound(String)
    case loadFailed(String)
    case executionFailed(String)
    case permissionDenied(String)
    case validationFailed(String)
    case sandboxViolation(String)
    case timeout(String)
    case dependencyMissing(String)
    case versionMismatch(String)
    case signatureInvalid(String)

    public var errorDescription: String? {
        switch self {
        case .notFound(let msg): return "插件未找到: \(msg)"
        case .loadFailed(let msg): return "加载失败: \(msg)"
        case .executionFailed(let msg): return "执行失败: \(msg)"
        case .permissionDenied(let msg): return "权限拒绝: \(msg)"
        case .validationFailed(let msg): return "验证失败: \(msg)"
        case .sandboxViolation(let msg): return "沙箱违规: \(msg)"
        case .timeout(let msg): return "超时: \(msg)"
        case .dependencyMissing(let msg): return "依赖缺失: \(msg)"
        case .versionMismatch(let msg): return "版本不匹配: \(msg)"
        case .signatureInvalid(let msg): return "签名无效: \(msg)"
        }
    }
}

// MARK: - Plugin Action Result

/// 插件动作执行结果
public struct PluginActionResult {
    public let success: Bool
    public let output: Any?
    public let error: PluginError?
    public let executionTime: TimeInterval
    public let metadata: [String: Any]?

    public init(
        success: Bool,
        output: Any? = nil,
        error: PluginError? = nil,
        executionTime: TimeInterval = 0,
        metadata: [String: Any]? = nil
    ) {
        self.success = success
        self.output = output
        self.error = error
        self.executionTime = executionTime
        self.metadata = metadata
    }

    public static func success(_ output: Any?, time: TimeInterval = 0) -> PluginActionResult {
        return PluginActionResult(success: true, output: output, executionTime: time)
    }

    public static func failure(_ error: PluginError, time: TimeInterval = 0) -> PluginActionResult {
        return PluginActionResult(success: false, error: error, executionTime: time)
    }
}

// MARK: - Plugin Event

/// 插件事件
public struct PluginEvent: Identifiable {
    public let id: String
    public let pluginId: String
    public let type: PluginEventType
    public let timestamp: Date
    public let data: [String: Any]?

    public init(
        id: String = UUID().uuidString,
        pluginId: String,
        type: PluginEventType,
        timestamp: Date = Date(),
        data: [String: Any]? = nil
    ) {
        self.id = id
        self.pluginId = pluginId
        self.type = type
        self.timestamp = timestamp
        self.data = data
    }
}

/// 插件事件类型
public enum PluginEventType: String {
    case installed = "installed"
    case uninstalled = "uninstalled"
    case enabled = "enabled"
    case disabled = "disabled"
    case loaded = "loaded"
    case unloaded = "unloaded"
    case actionExecuted = "action_executed"
    case error = "error"
    case updated = "updated"
}

// MARK: - Plugin Sandbox Context

/// 插件沙箱上下文
public class PluginSandboxContext {
    public let pluginId: String
    public var allowedPaths: [String] = []
    public var deniedPaths: [String] = []
    public var networkAllowed: Bool = false
    public var allowedDomains: [String] = []
    public var memoryLimit: Int = 50 * 1024 * 1024 // 50MB
    public var cpuLimit: Double = 0.5 // 50% CPU
    public var fileAccessLog: [FileAccessRecord] = []
    public var networkAccessLog: [NetworkAccessRecord] = []

    public init(pluginId: String) {
        self.pluginId = pluginId
    }
}

/// 文件访问记录
public struct FileAccessRecord {
    public let path: String
    public let operation: String
    public let timestamp: Date
    public let allowed: Bool
}

/// 网络访问记录
public struct NetworkAccessRecord {
    public let url: String
    public let method: String
    public let timestamp: Date
    public let allowed: Bool
}

// MARK: - Marketplace Models

/// 市场插件信息
public struct MarketplacePlugin: Identifiable, Codable {
    public let id: String
    public let name: String
    public let version: String
    public let description: String
    public let author: String
    public let icon: String?
    public let category: PluginCategory
    public let tags: [String]
    public let downloadUrl: String
    public let size: Int
    public let downloads: Int
    public let rating: Double
    public let reviewCount: Int
    public let createdAt: Date
    public let updatedAt: Date
    public let screenshots: [String]
    public let changelog: String?
    public let permissions: PluginPermissions

    public var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }

    public var formattedDownloads: String {
        if downloads >= 1000000 {
            return String(format: "%.1fM", Double(downloads) / 1000000)
        } else if downloads >= 1000 {
            return String(format: "%.1fK", Double(downloads) / 1000)
        }
        return "\(downloads)"
    }
}

/// 插件评论
public struct PluginReview: Identifiable, Codable {
    public let id: String
    public let pluginId: String
    public let userId: String
    public let userName: String
    public let rating: Int
    public let content: String
    public let createdAt: Date
    public var helpful: Int
    public var reported: Bool
}

// MARK: - AnyCodable Helper

/// 通用可编码类型
public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self.value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self.value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "无法解码")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            let context = EncodingError.Context(
                codingPath: container.codingPath,
                debugDescription: "无法编码类型"
            )
            throw EncodingError.invalidValue(value, context)
        }
    }
}
