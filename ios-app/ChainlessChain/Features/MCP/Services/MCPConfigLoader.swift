import Foundation
import Combine
import CoreCommon

// MARK: - MCP Configuration

/// MCP整体配置
public struct MCPConfiguration: Codable {
    public var enabled: Bool
    public var servers: [String: MCPServerConfig]
    public var trustedServers: [String]
    public var allowUntrustedServers: Bool
    public var defaultPermissions: MCPDefaultPermissions

    public init(
        enabled: Bool = true,
        servers: [String: MCPServerConfig] = [:],
        trustedServers: [String] = [],
        allowUntrustedServers: Bool = false,
        defaultPermissions: MCPDefaultPermissions = MCPDefaultPermissions()
    ) {
        self.enabled = enabled
        self.servers = servers
        self.trustedServers = trustedServers
        self.allowUntrustedServers = allowUntrustedServers
        self.defaultPermissions = defaultPermissions
    }
}

/// MCP默认权限
public struct MCPDefaultPermissions: Codable {
    public var requireConsent: Bool
    public var readOnly: Bool

    public init(requireConsent: Bool = true, readOnly: Bool = false) {
        self.requireConsent = requireConsent
        self.readOnly = readOnly
    }
}

// MARK: - MCP Config Loader

/// MCP配置加载器
@MainActor
public class MCPConfigLoader: ObservableObject {

    // MARK: - Singleton

    public static let shared = MCPConfigLoader()

    // MARK: - Properties

    private var configPath: URL?
    private var fileWatcher: DispatchSourceFileSystemObject?

    @Published public var config: MCPConfiguration?
    @Published public var lastLoadTime: Date?
    @Published public var lastError: Error?

    /// 事件发布器
    public let configLoaded = PassthroughSubject<MCPConfiguration, Never>()
    public let configChanged = PassthroughSubject<MCPConfigChange, Never>()
    public let configError = PassthroughSubject<Error, Never>()

    // MARK: - Initialization

    private init() {
        configPath = resolveConfigPath()
        Logger.shared.info("[MCPConfigLoader] 已初始化, 配置路径: \(configPath?.path ?? "未知")")
    }

    // MARK: - Loading

    /// 加载配置
    @discardableResult
    public func load(watch: Bool = false) -> MCPConfiguration {
        Logger.shared.info("[MCPConfigLoader] 正在加载配置...")

        do {
            guard let path = configPath, FileManager.default.fileExists(atPath: path.path) else {
                Logger.shared.warning("[MCPConfigLoader] 配置文件不存在，使用默认配置")
                let defaultConfig = getDefaultConfig()
                config = defaultConfig
                configLoaded.send(defaultConfig)
                return defaultConfig
            }

            let data = try Data(contentsOf: path)
            let fullConfig = try JSONDecoder().decode(FullAppConfig.self, from: data)

            let mcpConfig = fullConfig.mcp ?? getDefaultConfig()

            // 验证配置
            try validateConfig(mcpConfig)

            config = mcpConfig
            lastLoadTime = Date()

            Logger.shared.info("[MCPConfigLoader] 配置加载成功")
            Logger.shared.info("  启用: \(mcpConfig.enabled)")
            Logger.shared.info("  服务器数量: \(mcpConfig.servers.count)")

            configLoaded.send(mcpConfig)

            // 设置文件监控
            if watch {
                startWatching()
            }

            return mcpConfig

        } catch {
            Logger.shared.error("[MCPConfigLoader] 配置加载失败: \(error)")

            lastError = error
            configError.send(error)

            let defaultConfig = getDefaultConfig()
            config = defaultConfig
            return defaultConfig
        }
    }

    /// 获取当前配置
    public func getConfig() -> MCPConfiguration {
        if config == nil {
            return load()
        }
        return config!
    }

    /// 获取服务器配置
    public func getServerConfig(_ serverName: String) -> MCPServerConfig? {
        return getConfig().servers[serverName]
    }

    /// 获取启用的服务器列表
    public func getEnabledServers() -> [String] {
        return getConfig().servers.filter { $0.value.enabled }.map { $0.key }
    }

    /// 获取自动连接的服务器列表
    public func getAutoConnectServers() -> [String] {
        return getConfig().servers.filter { $0.value.enabled && $0.value.autoConnect }.map { $0.key }
    }

    // MARK: - Reload

    /// 重新加载配置
    public func reload() -> MCPConfiguration {
        Logger.shared.info("[MCPConfigLoader] 正在重新加载配置...")

        let oldConfig = config
        let newConfig = load(watch: false)

        // 检测变更
        if let old = oldConfig {
            let changes = detectChanges(old: old, new: newConfig)

            if !changes.isEmpty {
                Logger.shared.info("[MCPConfigLoader] 配置变更:")
                for change in changes {
                    Logger.shared.info("  - \(change)")
                }

                configChanged.send(MCPConfigChange(oldConfig: old, newConfig: newConfig, changes: changes))
            }
        }

        return newConfig
    }

    // MARK: - Saving

    /// 保存配置
    public func save(_ newConfig: MCPConfiguration) throws {
        guard let path = configPath else {
            throw MCPConfigError.invalidPath
        }

        // 读取完整配置
        var fullConfig: FullAppConfig

        if FileManager.default.fileExists(atPath: path.path) {
            let data = try Data(contentsOf: path)
            fullConfig = try JSONDecoder().decode(FullAppConfig.self, from: data)
        } else {
            fullConfig = FullAppConfig()
        }

        // 更新MCP部分
        fullConfig.mcp = newConfig

        // 保存
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(fullConfig)

        try data.write(to: path)

        // 更新当前配置
        config = newConfig
        lastLoadTime = Date()

        Logger.shared.info("[MCPConfigLoader] 配置已保存")

        configLoaded.send(newConfig)
    }

    /// 添加服务器配置
    public func addServer(_ serverName: String, config serverConfig: MCPServerConfig) throws {
        var currentConfig = getConfig()
        currentConfig.servers[serverName] = serverConfig
        try save(currentConfig)
    }

    /// 移除服务器配置
    public func removeServer(_ serverName: String) throws {
        var currentConfig = getConfig()
        currentConfig.servers.removeValue(forKey: serverName)
        try save(currentConfig)
    }

    /// 更新服务器配置
    public func updateServer(_ serverName: String, config serverConfig: MCPServerConfig) throws {
        var currentConfig = getConfig()
        currentConfig.servers[serverName] = serverConfig
        try save(currentConfig)
    }

    // MARK: - File Watching

    /// 开始监控配置文件
    public func startWatching() {
        guard let path = configPath else { return }

        stopWatching()

        let fileDescriptor = open(path.path, O_EVTONLY)
        guard fileDescriptor >= 0 else {
            Logger.shared.error("[MCPConfigLoader] 无法打开文件监控")
            return
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: .write,
            queue: .main
        )

        source.setEventHandler { [weak self] in
            Logger.shared.info("[MCPConfigLoader] 配置文件已变更，正在重新加载...")

            // 防抖 - 等待500ms
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                _ = self?.reload()
            }
        }

        source.setCancelHandler {
            close(fileDescriptor)
        }

        source.resume()
        fileWatcher = source

        Logger.shared.info("[MCPConfigLoader] 已开始监控配置文件")
    }

    /// 停止监控配置文件
    public func stopWatching() {
        fileWatcher?.cancel()
        fileWatcher = nil
        Logger.shared.info("[MCPConfigLoader] 已停止监控配置文件")
    }

    // MARK: - Private Methods

    /// 解析配置路径
    private func resolveConfigPath() -> URL? {
        // iOS: Application Support目录
        guard let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }

        let configDir = appSupport.appendingPathComponent(".chainlesschain", isDirectory: true)

        // 确保目录存在
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)

        return configDir.appendingPathComponent("config.json")
    }

    /// 获取默认配置
    private func getDefaultConfig() -> MCPConfiguration {
        return MCPConfiguration(
            enabled: true,
            servers: [:],  // iOS默认不配置服务器
            trustedServers: [
                "@modelcontextprotocol/server-filesystem",
                "@modelcontextprotocol/server-fetch"
            ],
            allowUntrustedServers: false,
            defaultPermissions: MCPDefaultPermissions(
                requireConsent: true,
                readOnly: false
            )
        )
    }

    /// 验证配置
    private func validateConfig(_ config: MCPConfiguration) throws {
        // 验证每个服务器配置
        for (name, serverConfig) in config.servers {
            try validateServerConfig(name, config: serverConfig)
        }
    }

    /// 验证服务器配置
    private func validateServerConfig(_ name: String, config: MCPServerConfig) throws {
        // 跳过禁用的服务器
        guard config.enabled else { return }

        // HTTP-SSE需要baseURL
        if config.transport == .httpSSE {
            guard let baseURL = config.baseURL, !baseURL.isEmpty else {
                throw MCPConfigError.invalidServerConfig(name, "HTTP-SSE传输需要baseURL")
            }

            guard URL(string: baseURL) != nil else {
                throw MCPConfigError.invalidServerConfig(name, "无效的baseURL")
            }
        }
    }

    /// 检测配置变更
    private func detectChanges(old: MCPConfiguration, new: MCPConfiguration) -> [String] {
        var changes: [String] = []

        // 检查启用状态
        if old.enabled != new.enabled {
            changes.append("MCP \(new.enabled ? "已启用" : "已禁用")")
        }

        let oldServers = Set(old.servers.keys)
        let newServers = Set(new.servers.keys)

        // 新增的服务器
        for server in newServers.subtracting(oldServers) {
            changes.append("新增服务器: \(server)")
        }

        // 移除的服务器
        for server in oldServers.subtracting(newServers) {
            changes.append("移除服务器: \(server)")
        }

        // 变更的服务器
        for server in oldServers.intersection(newServers) {
            let oldServer = old.servers[server]!
            let newServer = new.servers[server]!

            if oldServer.enabled != newServer.enabled {
                changes.append("服务器 \(server): \(newServer.enabled ? "已启用" : "已禁用")")
            }

            if oldServer.baseURL != newServer.baseURL {
                changes.append("服务器 \(server): URL已变更")
            }
        }

        return changes
    }
}

// MARK: - Supporting Types

/// 完整应用配置 (用于读取config.json)
private struct FullAppConfig: Codable {
    var mcp: MCPConfiguration?
    var llm: AnyCodable?
    var rag: AnyCodable?

    init() {
        mcp = nil
        llm = nil
        rag = nil
    }
}

/// 配置变更
public struct MCPConfigChange {
    public let oldConfig: MCPConfiguration
    public let newConfig: MCPConfiguration
    public let changes: [String]
}

/// 配置错误
public enum MCPConfigError: Error, LocalizedError {
    case invalidPath
    case invalidServerConfig(String, String)
    case parseError(String)

    public var errorDescription: String? {
        switch self {
        case .invalidPath:
            return "无效的配置路径"
        case .invalidServerConfig(let name, let reason):
            return "服务器 \(name) 配置无效: \(reason)"
        case .parseError(let message):
            return "配置解析错误: \(message)"
        }
    }
}

// MARK: - Server Config Presets

extension MCPServerConfig {

    /// 创建Filesystem服务器配置
    public static func filesystem(
        baseURL: String,
        apiKey: String? = nil,
        allowedPaths: [String] = ["notes/", "imports/", "exports/"],
        forbiddenPaths: [String] = ["data/ukey/", "data/did/private-keys/"],
        readOnly: Bool = false
    ) -> MCPServerConfig {
        return MCPServerConfig(
            name: "filesystem",
            transport: .httpSSE,
            enabled: true,
            autoConnect: true,
            baseURL: baseURL,
            apiKey: apiKey,
            permissions: MCPServerPermissions(
                allowedPaths: allowedPaths,
                forbiddenPaths: forbiddenPaths,
                readOnly: readOnly
            ),
            description: "文件系统服务器"
        )
    }

    /// 创建PostgreSQL服务器配置
    public static func postgres(
        baseURL: String,
        apiKey: String? = nil,
        allowedSchemas: [String] = ["public"],
        forbiddenTables: [String] = ["users", "credentials"],
        readOnly: Bool = true
    ) -> MCPServerConfig {
        return MCPServerConfig(
            name: "postgres",
            transport: .httpSSE,
            enabled: false,
            autoConnect: false,
            baseURL: baseURL,
            apiKey: apiKey,
            permissions: MCPServerPermissions(
                readOnly: readOnly,
                allowedSchemas: allowedSchemas,
                forbiddenTables: forbiddenTables
            ),
            description: "PostgreSQL数据库服务器"
        )
    }

    /// 创建Fetch服务器配置
    public static func fetch(
        baseURL: String,
        apiKey: String? = nil,
        allowedDomains: [String] = [],
        forbiddenDomains: [String] = []
    ) -> MCPServerConfig {
        return MCPServerConfig(
            name: "fetch",
            transport: .httpSSE,
            enabled: true,
            autoConnect: true,
            baseURL: baseURL,
            apiKey: apiKey,
            permissions: MCPServerPermissions(
                allowedDomains: allowedDomains,
                forbiddenDomains: forbiddenDomains
            ),
            description: "HTTP请求服务器"
        )
    }
}
