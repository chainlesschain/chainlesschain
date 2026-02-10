import Foundation
import Combine
import CoreCommon

// MARK: - Skill Models

/// 技能定义
public struct Skill: Identifiable, Codable {
    public let id: String
    public var name: String
    public var description: String
    public var version: String
    public var author: String?
    public var category: SkillCategory
    public var source: SkillSource

    /// 触发命令 (如 /code-review)
    public var command: String

    /// 命令别名
    public var aliases: [String]

    /// 技能提示词模板
    public var promptTemplate: String

    /// 所需工具列表
    public var requiredTools: [String]

    /// 门控条件
    public var gates: SkillGates

    /// 参数定义
    public var parameters: [SkillParameter]

    /// 示例用法
    public var examples: [SkillExample]

    /// 是否启用
    public var isEnabled: Bool

    /// 优先级 (用于覆盖)
    public var priority: Int

    /// 元数据
    public var metadata: [String: String]

    /// 创建时间
    public var createdAt: Date

    /// 更新时间
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        name: String,
        description: String = "",
        version: String = "1.0.0",
        author: String? = nil,
        category: SkillCategory = .general,
        source: SkillSource = .bundled,
        command: String,
        aliases: [String] = [],
        promptTemplate: String,
        requiredTools: [String] = [],
        gates: SkillGates = SkillGates(),
        parameters: [SkillParameter] = [],
        examples: [SkillExample] = [],
        isEnabled: Bool = true,
        priority: Int = 0,
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.version = version
        self.author = author
        self.category = category
        self.source = source
        self.command = command.hasPrefix("/") ? command : "/\(command)"
        self.aliases = aliases
        self.promptTemplate = promptTemplate
        self.requiredTools = requiredTools
        self.gates = gates
        self.parameters = parameters
        self.examples = examples
        self.isEnabled = isEnabled
        self.priority = priority
        self.metadata = metadata
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

/// 技能分类
public enum SkillCategory: String, Codable, CaseIterable {
    case codeReview = "code-review"
    case git = "git"
    case documentation = "documentation"
    case testing = "testing"
    case refactoring = "refactoring"
    case debugging = "debugging"
    case analysis = "analysis"
    case generation = "generation"
    case general = "general"
    case custom = "custom"

    public var displayName: String {
        switch self {
        case .codeReview: return "代码审查"
        case .git: return "Git操作"
        case .documentation: return "文档"
        case .testing: return "测试"
        case .refactoring: return "重构"
        case .debugging: return "调试"
        case .analysis: return "分析"
        case .generation: return "生成"
        case .general: return "通用"
        case .custom: return "自定义"
        }
    }
}

/// 技能来源
public enum SkillSource: String, Codable {
    case bundled = "bundled"     // 内置技能
    case managed = "managed"     // 托管技能 (从服务器下载)
    case workspace = "workspace" // 工作空间技能 (用户自定义)

    public var priority: Int {
        switch self {
        case .bundled: return 0
        case .managed: return 1
        case .workspace: return 2  // 更高优先级，可覆盖
        }
    }
}

/// 技能门控条件
public struct SkillGates: Codable {
    /// 支持的平台
    public var platforms: [String]

    /// 所需二进制依赖
    public var binaryDependencies: [String]

    /// 所需环境变量
    public var environmentVariables: [String]

    /// 最低系统版本
    public var minOSVersion: String?

    /// 所需权限
    public var requiredPermissions: [String]

    public init(
        platforms: [String] = ["ios", "macos"],
        binaryDependencies: [String] = [],
        environmentVariables: [String] = [],
        minOSVersion: String? = nil,
        requiredPermissions: [String] = []
    ) {
        self.platforms = platforms
        self.binaryDependencies = binaryDependencies
        self.environmentVariables = environmentVariables
        self.minOSVersion = minOSVersion
        self.requiredPermissions = requiredPermissions
    }
}

/// 技能参数
public struct SkillParameter: Codable {
    public let name: String
    public let type: ParameterType
    public let description: String
    public var isRequired: Bool
    public var defaultValue: String?
    public var choices: [String]?

    public enum ParameterType: String, Codable {
        case string
        case number
        case boolean
        case file
        case directory
        case choice
    }

    public init(
        name: String,
        type: ParameterType = .string,
        description: String,
        isRequired: Bool = false,
        defaultValue: String? = nil,
        choices: [String]? = nil
    ) {
        self.name = name
        self.type = type
        self.description = description
        self.isRequired = isRequired
        self.defaultValue = defaultValue
        self.choices = choices
    }
}

/// 技能示例
public struct SkillExample: Codable {
    public let command: String
    public let description: String

    public init(command: String, description: String) {
        self.command = command
        self.description = description
    }
}

/// 技能执行上下文
public struct SkillExecutionContext {
    public let skill: Skill
    public let arguments: [String: Any]
    public let workingDirectory: URL?
    public let selectedFiles: [URL]
    public let conversationId: String?

    public init(
        skill: Skill,
        arguments: [String: Any] = [:],
        workingDirectory: URL? = nil,
        selectedFiles: [URL] = [],
        conversationId: String? = nil
    ) {
        self.skill = skill
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.selectedFiles = selectedFiles
        self.conversationId = conversationId
    }
}

/// 技能执行结果
public struct SkillExecutionResult {
    public let success: Bool
    public let prompt: String?
    public let error: Error?
    public let metadata: [String: Any]

    public init(
        success: Bool,
        prompt: String? = nil,
        error: Error? = nil,
        metadata: [String: Any] = [:]
    ) {
        self.success = success
        self.prompt = prompt
        self.error = error
        self.metadata = metadata
    }
}

// MARK: - Skill Gating

/// 技能门控检查器
public class SkillGating {

    public static let shared = SkillGating()

    private init() {}

    /// 检查技能是否可用
    public func checkGates(_ skill: Skill) -> GateCheckResult {
        var failures: [GateFailure] = []

        // 1. 平台检查
        if !checkPlatform(skill.gates.platforms) {
            failures.append(GateFailure(
                type: .platform,
                message: "当前平台不支持此技能",
                details: "需要: \(skill.gates.platforms.joined(separator: ", "))"
            ))
        }

        // 2. 系统版本检查
        if let minVersion = skill.gates.minOSVersion {
            if !checkOSVersion(minVersion) {
                failures.append(GateFailure(
                    type: .osVersion,
                    message: "系统版本过低",
                    details: "需要 iOS \(minVersion) 或更高版本"
                ))
            }
        }

        // 3. 二进制依赖检查
        for binary in skill.gates.binaryDependencies {
            if !checkBinaryAvailable(binary) {
                failures.append(GateFailure(
                    type: .binaryDependency,
                    message: "缺少依赖: \(binary)",
                    details: "请确保 \(binary) 已安装"
                ))
            }
        }

        // 4. 环境变量检查
        for envVar in skill.gates.environmentVariables {
            if !checkEnvironmentVariable(envVar) {
                failures.append(GateFailure(
                    type: .environmentVariable,
                    message: "缺少环境变量: \(envVar)",
                    details: "请设置环境变量 \(envVar)"
                ))
            }
        }

        // 5. 权限检查
        for permission in skill.gates.requiredPermissions {
            if !checkPermission(permission) {
                failures.append(GateFailure(
                    type: .permission,
                    message: "缺少权限: \(permission)",
                    details: "请授予 \(permission) 权限"
                ))
            }
        }

        return GateCheckResult(
            passed: failures.isEmpty,
            failures: failures
        )
    }

    private func checkPlatform(_ platforms: [String]) -> Bool {
        #if os(iOS)
        return platforms.contains("ios") || platforms.isEmpty
        #elseif os(macOS)
        return platforms.contains("macos") || platforms.isEmpty
        #else
        return false
        #endif
    }

    private func checkOSVersion(_ minVersion: String) -> Bool {
        let currentVersion = ProcessInfo.processInfo.operatingSystemVersion
        let currentString = "\(currentVersion.majorVersion).\(currentVersion.minorVersion)"
        return currentString.compare(minVersion, options: .numeric) != .orderedAscending
    }

    private func checkBinaryAvailable(_ binary: String) -> Bool {
        // iOS 上大多数二进制不可用，除非是内置的
        let availableBinaries = ["git", "swift", "xcode-select"]
        return availableBinaries.contains(binary.lowercased())
    }

    private func checkEnvironmentVariable(_ name: String) -> Bool {
        return ProcessInfo.processInfo.environment[name] != nil
    }

    private func checkPermission(_ permission: String) -> Bool {
        // 简化的权限检查
        switch permission {
        case "camera", "photos", "microphone", "location":
            // 实际应用中需要检查具体权限状态
            return true
        default:
            return true
        }
    }

    public struct GateCheckResult {
        public let passed: Bool
        public let failures: [GateFailure]
    }

    public struct GateFailure {
        public let type: GateType
        public let message: String
        public let details: String
    }

    public enum GateType {
        case platform
        case osVersion
        case binaryDependency
        case environmentVariable
        case permission
    }
}

// MARK: - Markdown Skill Parser

/// Markdown 技能解析器
public class MarkdownSkillParser {

    public static let shared = MarkdownSkillParser()

    private init() {}

    /// 从 Markdown 内容解析技能
    public func parse(_ content: String, source: SkillSource = .workspace) throws -> Skill {
        var name = ""
        var description = ""
        var version = "1.0.0"
        var author: String?
        var category = SkillCategory.general
        var command = ""
        var aliases: [String] = []
        var promptTemplate = ""
        var requiredTools: [String] = []
        var gates = SkillGates()
        var parameters: [SkillParameter] = []
        var examples: [SkillExample] = []

        let lines = content.components(separatedBy: .newlines)
        var currentSection = ""
        var sectionContent: [String] = []

        for line in lines {
            // 解析标题
            if line.hasPrefix("# ") {
                name = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)
                continue
            }

            // 解析二级标题 (节)
            if line.hasPrefix("## ") {
                // 保存上一个节的内容
                processSection(currentSection, content: sectionContent,
                              description: &description, command: &command,
                              aliases: &aliases, promptTemplate: &promptTemplate,
                              requiredTools: &requiredTools, parameters: &parameters,
                              examples: &examples, gates: &gates)

                currentSection = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces).lowercased()
                sectionContent = []
                continue
            }

            // 解析 YAML 前置元数据
            if line.hasPrefix("---") {
                continue
            }

            // 解析元数据行
            if line.contains(":") && currentSection.isEmpty {
                let parts = line.split(separator: ":", maxSplits: 1)
                if parts.count == 2 {
                    let key = String(parts[0]).trimmingCharacters(in: .whitespaces).lowercased()
                    let value = String(parts[1]).trimmingCharacters(in: .whitespaces)

                    switch key {
                    case "version":
                        version = value
                    case "author":
                        author = value
                    case "category":
                        category = SkillCategory(rawValue: value) ?? .general
                    case "command":
                        command = value
                    default:
                        break
                    }
                }
                continue
            }

            sectionContent.append(line)
        }

        // 处理最后一个节
        processSection(currentSection, content: sectionContent,
                      description: &description, command: &command,
                      aliases: &aliases, promptTemplate: &promptTemplate,
                      requiredTools: &requiredTools, parameters: &parameters,
                      examples: &examples, gates: &gates)

        guard !name.isEmpty else {
            throw SkillParseError.missingName
        }

        guard !command.isEmpty else {
            throw SkillParseError.missingCommand
        }

        return Skill(
            name: name,
            description: description,
            version: version,
            author: author,
            category: category,
            source: source,
            command: command,
            aliases: aliases,
            promptTemplate: promptTemplate,
            requiredTools: requiredTools,
            gates: gates,
            parameters: parameters,
            examples: examples
        )
    }

    private func processSection(
        _ section: String,
        content: [String],
        description: inout String,
        command: inout String,
        aliases: inout [String],
        promptTemplate: inout String,
        requiredTools: inout [String],
        parameters: inout [SkillParameter],
        examples: inout [SkillExample],
        gates: inout SkillGates
    ) {
        let text = content.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)

        switch section {
        case "description", "描述":
            description = text

        case "command", "命令":
            command = text

        case "aliases", "别名":
            aliases = text.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }

        case "prompt", "提示词", "template", "模板":
            promptTemplate = text

        case "tools", "工具":
            requiredTools = text.components(separatedBy: "\n")
                .filter { $0.hasPrefix("- ") }
                .map { String($0.dropFirst(2)).trimmingCharacters(in: .whitespaces) }

        case "parameters", "参数":
            parameters = parseParameters(content)

        case "examples", "示例":
            examples = parseExamples(content)

        case "gates", "门控", "requirements", "要求":
            gates = parseGates(content)

        default:
            break
        }
    }

    private func parseParameters(_ lines: [String]) -> [SkillParameter] {
        var params: [SkillParameter] = []
        var currentParam: (name: String, type: SkillParameter.ParameterType, desc: String, required: Bool)?

        for line in lines {
            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                // 保存上一个参数
                if let param = currentParam {
                    params.append(SkillParameter(
                        name: param.name,
                        type: param.type,
                        description: param.desc,
                        isRequired: param.required
                    ))
                }

                // 解析新参数
                let content = String(line.dropFirst(2))
                let parts = content.components(separatedBy: ":")
                if parts.count >= 2 {
                    let name = parts[0].trimmingCharacters(in: .whitespaces)
                    let desc = parts[1].trimmingCharacters(in: .whitespaces)
                    let required = content.contains("(required)") || content.contains("(必需)")

                    currentParam = (name, .string, desc, required)
                }
            }
        }

        // 保存最后一个参数
        if let param = currentParam {
            params.append(SkillParameter(
                name: param.name,
                type: param.type,
                description: param.desc,
                isRequired: param.required
            ))
        }

        return params
    }

    private func parseExamples(_ lines: [String]) -> [SkillExample] {
        var examples: [SkillExample] = []

        for line in lines {
            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                let content = String(line.dropFirst(2))
                if content.hasPrefix("`") {
                    // 解析 `command` - description 格式
                    if let endTick = content.dropFirst().firstIndex(of: "`") {
                        let cmd = String(content[content.index(after: content.startIndex)..<endTick])
                        let desc = String(content[content.index(after: endTick)...])
                            .trimmingCharacters(in: .whitespaces)
                            .trimmingCharacters(in: CharacterSet(charactersIn: "- "))
                        examples.append(SkillExample(command: cmd, description: desc))
                    }
                } else {
                    examples.append(SkillExample(command: content, description: ""))
                }
            }
        }

        return examples
    }

    private func parseGates(_ lines: [String]) -> SkillGates {
        var platforms: [String] = []
        var binaries: [String] = []
        var envVars: [String] = []
        var permissions: [String] = []
        var minOS: String?

        for line in lines {
            let lower = line.lowercased()
            if lower.contains("platform") || lower.contains("平台") {
                platforms = extractListItems(from: line)
            } else if lower.contains("binary") || lower.contains("二进制") {
                binaries = extractListItems(from: line)
            } else if lower.contains("env") || lower.contains("环境变量") {
                envVars = extractListItems(from: line)
            } else if lower.contains("permission") || lower.contains("权限") {
                permissions = extractListItems(from: line)
            } else if lower.contains("ios") || lower.contains("version") || lower.contains("版本") {
                if let version = extractVersion(from: line) {
                    minOS = version
                }
            }
        }

        return SkillGates(
            platforms: platforms.isEmpty ? ["ios", "macos"] : platforms,
            binaryDependencies: binaries,
            environmentVariables: envVars,
            minOSVersion: minOS,
            requiredPermissions: permissions
        )
    }

    private func extractListItems(from line: String) -> [String] {
        // 提取逗号分隔或括号内的列表
        if let start = line.firstIndex(of: "["),
           let end = line.firstIndex(of: "]") {
            let content = String(line[line.index(after: start)..<end])
            return content.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        }

        if let colonIndex = line.firstIndex(of: ":") {
            let content = String(line[line.index(after: colonIndex)...])
            return content.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        }

        return []
    }

    private func extractVersion(from line: String) -> String? {
        let pattern = #"(\d+\.\d+(?:\.\d+)?)"#
        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) {
            return String(line[Range(match.range(at: 1), in: line)!])
        }
        return nil
    }

    public enum SkillParseError: Error, LocalizedError {
        case missingName
        case missingCommand
        case invalidFormat

        public var errorDescription: String? {
            switch self {
            case .missingName: return "技能定义缺少名称"
            case .missingCommand: return "技能定义缺少命令"
            case .invalidFormat: return "技能定义格式无效"
            }
        }
    }
}

// MARK: - Skill Registry

/// 技能注册表
public class SkillRegistry {

    public static let shared = SkillRegistry()

    private var skills: [String: Skill] = [:]  // command -> Skill
    private var aliasMap: [String: String] = [] // alias -> command
    private let lock = NSLock()

    private init() {}

    /// 注册技能
    public func register(_ skill: Skill) {
        lock.lock()
        defer { lock.unlock() }

        let command = skill.command.lowercased()

        // 检查是否需要覆盖
        if let existing = skills[command] {
            if skill.source.priority <= existing.source.priority {
                Logger.shared.debug("[SkillRegistry] 跳过低优先级技能: \(skill.name)")
                return
            }
        }

        skills[command] = skill

        // 注册别名
        for alias in skill.aliases {
            let normalizedAlias = alias.hasPrefix("/") ? alias.lowercased() : "/\(alias.lowercased())"
            aliasMap[normalizedAlias] = command
        }

        Logger.shared.info("[SkillRegistry] 已注册技能: \(skill.name) (\(command))")
    }

    /// 注销技能
    public func unregister(_ command: String) {
        lock.lock()
        defer { lock.unlock() }

        let normalizedCommand = command.hasPrefix("/") ? command.lowercased() : "/\(command.lowercased())"

        if let skill = skills.removeValue(forKey: normalizedCommand) {
            // 移除别名
            for alias in skill.aliases {
                let normalizedAlias = alias.hasPrefix("/") ? alias.lowercased() : "/\(alias.lowercased())"
                aliasMap.removeValue(forKey: normalizedAlias)
            }
            Logger.shared.info("[SkillRegistry] 已注销技能: \(skill.name)")
        }
    }

    /// 获取技能
    public func get(_ commandOrAlias: String) -> Skill? {
        lock.lock()
        defer { lock.unlock() }

        let normalized = commandOrAlias.hasPrefix("/") ? commandOrAlias.lowercased() : "/\(commandOrAlias.lowercased())"

        // 直接查找
        if let skill = skills[normalized] {
            return skill
        }

        // 通过别名查找
        if let command = aliasMap[normalized] {
            return skills[command]
        }

        return nil
    }

    /// 获取所有技能
    public func getAll() -> [Skill] {
        lock.lock()
        defer { lock.unlock() }
        return Array(skills.values)
    }

    /// 按分类获取技能
    public func getByCategory(_ category: SkillCategory) -> [Skill] {
        lock.lock()
        defer { lock.unlock() }
        return skills.values.filter { $0.category == category }
    }

    /// 搜索技能
    public func search(_ query: String) -> [Skill] {
        lock.lock()
        defer { lock.unlock() }

        let lowercased = query.lowercased()
        return skills.values.filter { skill in
            skill.name.lowercased().contains(lowercased) ||
            skill.command.lowercased().contains(lowercased) ||
            skill.description.lowercased().contains(lowercased) ||
            skill.aliases.contains { $0.lowercased().contains(lowercased) }
        }
    }

    /// 清空注册表
    public func clear() {
        lock.lock()
        defer { lock.unlock() }
        skills.removeAll()
        aliasMap.removeAll()
    }

    /// 技能数量
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return skills.count
    }
}

// MARK: - Skill Loader

/// 技能加载器
public class SkillLoader {

    public static let shared = SkillLoader()

    private let registry = SkillRegistry.shared
    private let parser = MarkdownSkillParser.shared
    private let fileManager = FileManager.default

    /// 内置技能目录
    private var bundledSkillsURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("Skills")
    }

    /// 托管技能目录
    private var managedSkillsURL: URL? {
        try? fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("ChainlessChain")
            .appendingPathComponent("skills")
            .appendingPathComponent("managed")
    }

    /// 工作空间技能目录
    private var workspaceSkillsURL: URL?

    private init() {}

    /// 设置工作空间路径
    public func setWorkspace(_ url: URL) {
        workspaceSkillsURL = url.appendingPathComponent(".chainlesschain").appendingPathComponent("skills")
    }

    /// 加载所有技能
    public func loadAll() async throws {
        Logger.shared.info("[SkillLoader] 开始加载技能...")

        // 1. 加载内置技能 (最低优先级)
        loadBundledSkills()

        // 2. 加载托管技能
        if let managedURL = managedSkillsURL {
            try await loadSkillsFromDirectory(managedURL, source: .managed)
        }

        // 3. 加载工作空间技能 (最高优先级)
        if let workspaceURL = workspaceSkillsURL {
            try await loadSkillsFromDirectory(workspaceURL, source: .workspace)
        }

        Logger.shared.info("[SkillLoader] 技能加载完成，共 \(registry.count) 个技能")
    }

    /// 加载内置技能
    private func loadBundledSkills() {
        // 注册内置的代码审查技能
        registry.register(BuiltinSkills.codeReview)

        // 注册内置的 Git 提交技能
        registry.register(BuiltinSkills.gitCommit)

        // 注册内置的代码解释技能
        registry.register(BuiltinSkills.explainCode)

        // 注册内置的重构技能
        registry.register(BuiltinSkills.refactor)

        // 注册内置的测试生成技能
        registry.register(BuiltinSkills.generateTests)

        Logger.shared.info("[SkillLoader] 已加载 5 个内置技能")
    }

    /// 从目录加载技能
    private func loadSkillsFromDirectory(_ directory: URL, source: SkillSource) async throws {
        guard fileManager.fileExists(atPath: directory.path) else {
            return
        }

        let contents = try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let markdownFiles = contents.filter { $0.pathExtension == "md" }

        for file in markdownFiles {
            do {
                let content = try String(contentsOf: file, encoding: .utf8)
                let skill = try parser.parse(content, source: source)

                // 检查门控
                let gateResult = SkillGating.shared.checkGates(skill)
                if gateResult.passed {
                    registry.register(skill)
                } else {
                    Logger.shared.warning("[SkillLoader] 技能 \(skill.name) 未通过门控检查")
                }
            } catch {
                Logger.shared.error("[SkillLoader] 解析技能文件失败: \(file.lastPathComponent) - \(error)")
            }
        }
    }

    /// 重新加载技能
    public func reload() async throws {
        registry.clear()
        try await loadAll()
    }

    /// 从 URL 加载单个技能
    public func loadSkill(from url: URL, source: SkillSource = .workspace) throws -> Skill {
        let content = try String(contentsOf: url, encoding: .utf8)
        let skill = try parser.parse(content, source: source)
        registry.register(skill)
        return skill
    }
}

// MARK: - Built-in Skills

/// 内置技能定义
public enum BuiltinSkills {

    /// 代码审查技能
    public static let codeReview = Skill(
        name: "Code Review",
        description: "对代码进行全面审查，检查潜在问题、代码风格和最佳实践",
        version: "1.0.0",
        author: "ChainlessChain",
        category: .codeReview,
        source: .bundled,
        command: "/code-review",
        aliases: ["cr", "review"],
        promptTemplate: """
        请对以下代码进行全面的代码审查：

        {{code}}

        请从以下几个方面进行分析：
        1. **代码质量**: 可读性、可维护性、代码结构
        2. **潜在问题**: Bug、边界条件、异常处理
        3. **性能**: 时间复杂度、空间复杂度、资源使用
        4. **安全性**: 输入验证、敏感数据处理、常见漏洞
        5. **最佳实践**: 命名规范、设计模式、语言特性使用

        请提供具体的改进建议和代码示例。
        """,
        requiredTools: ["read_file"],
        parameters: [
            SkillParameter(name: "file", type: .file, description: "要审查的文件路径", isRequired: false),
            SkillParameter(name: "focus", type: .choice, description: "重点关注的方面", choices: ["quality", "security", "performance", "all"])
        ],
        examples: [
            SkillExample(command: "/code-review src/main.swift", description: "审查指定文件"),
            SkillExample(command: "/cr --focus=security", description: "重点审查安全性")
        ]
    )

    /// Git 提交技能
    public static let gitCommit = Skill(
        name: "Git Commit",
        description: "分析更改并生成符合规范的 Git 提交信息",
        version: "1.0.0",
        author: "ChainlessChain",
        category: .git,
        source: .bundled,
        command: "/git-commit",
        aliases: ["commit", "gc"],
        promptTemplate: """
        请分析以下 Git 变更，并生成一个符合 Conventional Commits 规范的提交信息：

        {{changes}}

        提交信息格式要求：
        1. 类型: feat/fix/docs/style/refactor/test/chore
        2. 范围: 可选，描述影响的模块
        3. 描述: 简洁明了，使用祈使句
        4. 正文: 可选，详细描述变更原因和内容
        5. 页脚: 可选，关联的 issue 或 breaking changes

        示例格式：
        ```
        feat(auth): 添加用户登录功能

        - 实现用户名密码登录
        - 添加 JWT token 生成
        - 集成登录状态持久化

        Closes #123
        ```
        """,
        requiredTools: ["bash"],
        gates: SkillGates(binaryDependencies: ["git"]),
        examples: [
            SkillExample(command: "/git-commit", description: "生成当前变更的提交信息"),
            SkillExample(command: "/commit --staged", description: "只分析已暂存的变更")
        ]
    )

    /// 代码解释技能
    public static let explainCode = Skill(
        name: "Explain Code",
        description: "详细解释代码的功能、逻辑和实现细节",
        version: "1.0.0",
        author: "ChainlessChain",
        category: .documentation,
        source: .bundled,
        command: "/explain-code",
        aliases: ["explain", "ec"],
        promptTemplate: """
        请详细解释以下代码：

        {{code}}

        解释内容应包括：
        1. **功能概述**: 这段代码的主要作用
        2. **逐行解释**: 关键代码行的含义
        3. **数据流**: 数据如何在代码中流动
        4. **依赖关系**: 使用了哪些外部依赖
        5. **使用场景**: 这段代码通常在什么情况下使用

        请使用通俗易懂的语言，适合{{level}}开发者理解。
        """,
        requiredTools: ["read_file"],
        parameters: [
            SkillParameter(name: "level", type: .choice, description: "目标读者水平", defaultValue: "intermediate", choices: ["beginner", "intermediate", "advanced"])
        ],
        examples: [
            SkillExample(command: "/explain-code src/auth.swift", description: "解释认证模块代码"),
            SkillExample(command: "/explain --level=beginner", description: "以初学者视角解释")
        ]
    )

    /// 重构技能
    public static let refactor = Skill(
        name: "Refactor",
        description: "分析代码并提供重构建议",
        version: "1.0.0",
        author: "ChainlessChain",
        category: .refactoring,
        source: .bundled,
        command: "/refactor",
        aliases: ["rf"],
        promptTemplate: """
        请分析以下代码并提供重构建议：

        {{code}}

        重构目标：{{goal}}

        请提供：
        1. **当前问题**: 代码中存在的问题
        2. **重构方案**: 具体的重构步骤
        3. **重构后代码**: 完整的重构后代码
        4. **改进说明**: 重构带来的具体改进
        5. **风险评估**: 重构可能带来的风险

        请确保重构后的代码保持原有功能不变。
        """,
        requiredTools: ["read_file", "write_file"],
        parameters: [
            SkillParameter(name: "goal", type: .choice, description: "重构目标", defaultValue: "readability", choices: ["readability", "performance", "testability", "modularity"])
        ],
        examples: [
            SkillExample(command: "/refactor src/utils.swift", description: "重构工具模块"),
            SkillExample(command: "/rf --goal=performance", description: "以性能优化为目标重构")
        ]
    )

    /// 测试生成技能
    public static let generateTests = Skill(
        name: "Generate Tests",
        description: "为代码生成单元测试",
        version: "1.0.0",
        author: "ChainlessChain",
        category: .testing,
        source: .bundled,
        command: "/generate-tests",
        aliases: ["test", "gt"],
        promptTemplate: """
        请为以下代码生成单元测试：

        {{code}}

        测试要求：
        1. **测试框架**: {{framework}}
        2. **覆盖率**: 尽可能覆盖所有代码路径
        3. **边界条件**: 测试边界情况和异常情况
        4. **命名规范**: 使用描述性的测试方法名
        5. **AAA模式**: Arrange-Act-Assert

        请生成完整的测试文件，包括必要的导入和设置。
        """,
        requiredTools: ["read_file", "write_file"],
        parameters: [
            SkillParameter(name: "framework", type: .choice, description: "测试框架", defaultValue: "XCTest", choices: ["XCTest", "Quick", "Nimble"])
        ],
        examples: [
            SkillExample(command: "/generate-tests src/calculator.swift", description: "为计算器模块生成测试"),
            SkillExample(command: "/test --framework=Quick", description: "使用 Quick 框架")
        ]
    )
}

// MARK: - Skill Executor

/// 技能执行器
@MainActor
public class SkillExecutor: ObservableObject {

    public static let shared = SkillExecutor()

    private let registry = SkillRegistry.shared
    private let gating = SkillGating.shared

    @Published public private(set) var isExecuting = false
    @Published public private(set) var currentSkill: Skill?

    private init() {}

    /// 解析用户命令
    public func parseCommand(_ input: String) -> (command: String, arguments: [String: String])? {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("/") else { return nil }

        let parts = trimmed.components(separatedBy: .whitespaces)
        guard !parts.isEmpty else { return nil }

        let command = parts[0]
        var arguments: [String: String] = [:]

        for part in parts.dropFirst() {
            if part.hasPrefix("--") {
                let argParts = part.dropFirst(2).split(separator: "=", maxSplits: 1)
                if argParts.count == 2 {
                    arguments[String(argParts[0])] = String(argParts[1])
                } else if argParts.count == 1 {
                    arguments[String(argParts[0])] = "true"
                }
            } else {
                // 位置参数作为 "file" 或 "input"
                if arguments["file"] == nil {
                    arguments["file"] = part
                } else if arguments["input"] == nil {
                    arguments["input"] = part
                }
            }
        }

        return (command, arguments)
    }

    /// 执行技能
    public func execute(_ input: String, context: [String: Any] = [:]) async throws -> SkillExecutionResult {
        guard let (command, arguments) = parseCommand(input) else {
            return SkillExecutionResult(
                success: false,
                error: SkillExecutionError.invalidCommand
            )
        }

        guard let skill = registry.get(command) else {
            return SkillExecutionResult(
                success: false,
                error: SkillExecutionError.skillNotFound(command)
            )
        }

        // 门控检查
        let gateResult = gating.checkGates(skill)
        guard gateResult.passed else {
            return SkillExecutionResult(
                success: false,
                error: SkillExecutionError.gateCheckFailed(gateResult.failures)
            )
        }

        // 检查必需参数
        for param in skill.parameters where param.isRequired {
            if arguments[param.name] == nil {
                return SkillExecutionResult(
                    success: false,
                    error: SkillExecutionError.missingParameter(param.name)
                )
            }
        }

        isExecuting = true
        currentSkill = skill
        defer {
            isExecuting = false
            currentSkill = nil
        }

        // 构建提示词
        let prompt = buildPrompt(skill: skill, arguments: arguments, context: context)

        return SkillExecutionResult(
            success: true,
            prompt: prompt,
            metadata: [
                "skill": skill.name,
                "command": command,
                "arguments": arguments
            ]
        )
    }

    private func buildPrompt(skill: Skill, arguments: [String: String], context: [String: Any]) -> String {
        var prompt = skill.promptTemplate

        // 替换参数
        for (key, value) in arguments {
            prompt = prompt.replacingOccurrences(of: "{{\(key)}}", with: value)
        }

        // 替换上下文
        for (key, value) in context {
            if let stringValue = value as? String {
                prompt = prompt.replacingOccurrences(of: "{{\(key)}}", with: stringValue)
            }
        }

        // 设置默认值
        for param in skill.parameters {
            if let defaultValue = param.defaultValue {
                prompt = prompt.replacingOccurrences(of: "{{\(param.name)}}", with: defaultValue)
            }
        }

        // 清理未替换的占位符
        let pattern = #"\{\{[^}]+\}\}"#
        if let regex = try? NSRegularExpression(pattern: pattern) {
            prompt = regex.stringByReplacingMatches(
                in: prompt,
                range: NSRange(prompt.startIndex..., in: prompt),
                withTemplate: ""
            )
        }

        return prompt
    }

    public enum SkillExecutionError: Error, LocalizedError {
        case invalidCommand
        case skillNotFound(String)
        case gateCheckFailed([SkillGating.GateFailure])
        case missingParameter(String)
        case executionFailed(String)

        public var errorDescription: String? {
            switch self {
            case .invalidCommand:
                return "无效的命令格式，命令应以 / 开头"
            case .skillNotFound(let command):
                return "未找到技能: \(command)"
            case .gateCheckFailed(let failures):
                let messages = failures.map { $0.message }.joined(separator: ", ")
                return "技能门控检查失败: \(messages)"
            case .missingParameter(let name):
                return "缺少必需参数: \(name)"
            case .executionFailed(let reason):
                return "技能执行失败: \(reason)"
            }
        }
    }
}

// MARK: - Skill Manager

/// 技能管理器 (统一入口)
@MainActor
public class SkillManager: ObservableObject {

    public static let shared = SkillManager()

    public let loader = SkillLoader.shared
    public let registry = SkillRegistry.shared
    public let executor = SkillExecutor.shared
    public let gating = SkillGating.shared

    @Published public private(set) var isLoaded = false
    @Published public private(set) var skills: [Skill] = []

    private init() {}

    /// 初始化
    public func initialize() async {
        do {
            try await loader.loadAll()
            skills = registry.getAll()
            isLoaded = true
            Logger.shared.info("[SkillManager] 初始化完成，共 \(skills.count) 个技能")
        } catch {
            Logger.shared.error("[SkillManager] 初始化失败: \(error)")
        }
    }

    /// 执行技能命令
    public func execute(_ command: String, context: [String: Any] = [:]) async throws -> SkillExecutionResult {
        return try await executor.execute(command, context: context)
    }

    /// 获取技能
    public func getSkill(_ command: String) -> Skill? {
        return registry.get(command)
    }

    /// 搜索技能
    public func search(_ query: String) -> [Skill] {
        return registry.search(query)
    }

    /// 按分类获取技能
    public func getSkillsByCategory(_ category: SkillCategory) -> [Skill] {
        return registry.getByCategory(category)
    }

    /// 重新加载技能
    public func reload() async {
        do {
            try await loader.reload()
            skills = registry.getAll()
            Logger.shared.info("[SkillManager] 重新加载完成")
        } catch {
            Logger.shared.error("[SkillManager] 重新加载失败: \(error)")
        }
    }

    /// 设置工作空间
    public func setWorkspace(_ url: URL) {
        loader.setWorkspace(url)
    }
}
