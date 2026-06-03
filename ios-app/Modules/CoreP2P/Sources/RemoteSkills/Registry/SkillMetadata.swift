import Foundation

/// 远程 skill 元数据 — Phase 3.1。与 Android `SkillMetadata.kt` 字段 1:1（Android
/// 的 `androidSourceFile` 在 iOS 改名 `nativeSourceFile` 通用化两端）。
///
/// **粒度**：file + method 双级。
/// - file 级：23 entries 对应 23 个 commands skill
/// - method 级：可选 [methods] 列表，2 个 namespace (ai / knowledge) 由 SeedRegistry
///   提供初始值；其余通过 `RemoteSkillRegistry.updateFromRemote` 从桌面下发动态合并。
public struct SkillMetadata: Codable, Sendable, Equatable, Identifiable {
    /// 命名空间，如 "ai" / "extension" / "system.info"；唯一标识。
    public let namespace: String

    /// UI 展示名，如 "AI 对话" / "Chrome 扩展控制"。
    public let displayName: String

    /// 一句话描述。
    public let description: String

    /// 类别，UI 分组用："ai" / "browser" / "system" / "data" / "ui" / "control" / "infra"。
    public let category: String

    /// 风险等级，决定默认 ApprovalUI 行为。
    public let risk: SkillRiskTag

    /// 是否强制 ApprovalUI 二次确认。默认从 risk 推（Privileged → true，其余 false）。
    public let requiresApproval: Bool

    /// 传输通道："handler-rpc"（默认 desktop-app-vue handlers）/ "extension-ws"
    /// （仅 ExtensionCommands 走 Chrome 扩展独立 WS）。
    public let transport: String

    /// iOS 端对应 Swift 文件名（仅供调试索引；不参与运行时调度）。
    /// Phase 3 v0.1 多数 skill 是 "NotImplementedYet.swift"（占位），仅 4 个 Phase 3
    /// 实现的 skill 指向真实文件。
    public let nativeSourceFile: String

    /// 该 skill 下 RPC 入口数量（即 method 数）；UI 展示用。
    public let methodCount: Int

    /// 方法级 metadata（M4 D1）。可选；空 = 仅 file-level 数据。
    public let methods: [MethodMetadata]?

    public var id: String { namespace }

    public init(
        namespace: String,
        displayName: String,
        description: String,
        category: String,
        risk: SkillRiskTag,
        requiresApproval: Bool? = nil,
        transport: String = "handler-rpc",
        nativeSourceFile: String,
        methodCount: Int,
        methods: [MethodMetadata]? = nil
    ) {
        self.namespace = namespace
        self.displayName = displayName
        self.description = description
        self.category = category
        self.risk = risk
        self.requiresApproval = requiresApproval ?? (risk == .Privileged)
        self.transport = transport
        self.nativeSourceFile = nativeSourceFile
        self.methodCount = methodCount
        self.methods = methods
    }
}

/// 方法级 metadata（M4 D1）— 可选 sub-entry 用于细粒度 ApprovalUI 决策。
public struct MethodMetadata: Codable, Sendable, Equatable {
    /// 方法名，如 "createNote" / "chat"。
    public let name: String
    /// 一句话描述。
    public let description: String
    /// 参数个数。
    public let paramCount: Int
    /// 参数概述，如 "title, content, folderId?, tags?"。
    public let paramSummary: String?
    /// 返回类型 hint，如 "CreateNoteResponse"。
    public let returnTypeHint: String?
    /// risk override — 用于 file-level risk 与 method-level 不同的情况。
    /// 如 knowledge.deleteNote (不可逆) 即使 file-level 是 Mutating，方法级也升 Privileged。
    public let riskOverride: SkillRiskTag?
    /// requiresApproval override — 即使 risk 推导值不要求，强制 ApprovalUI。
    public let requiresApprovalOverride: Bool?

    public init(
        name: String,
        description: String,
        paramCount: Int,
        paramSummary: String? = nil,
        returnTypeHint: String? = nil,
        riskOverride: SkillRiskTag? = nil,
        requiresApprovalOverride: Bool? = nil
    ) {
        self.name = name
        self.description = description
        self.paramCount = paramCount
        self.paramSummary = paramSummary
        self.returnTypeHint = returnTypeHint
        self.riskOverride = riskOverride
        self.requiresApprovalOverride = requiresApprovalOverride
    }
}
