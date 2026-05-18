import Foundation
import Combine

/// 23 个 skill commands 的统一注册表 — Phase 3.1。
///
/// 镜像 Android `RemoteSkillRegistry.kt`（230 LOC）。启动流程：
/// 1. `RegistryStore.load` 从 disk 读最近一次同步的 metadata
/// 2. 若 disk 为空（首启 / 损坏），fallback 到 [SeedRegistry.SKILLS]
/// 3. 业务可通过 [updateFromRemote] 把桌面下发的更新合并进来 + 持久化
///
/// **UI 友好**：
/// - `skillsPublisher()` Combine source 自动随更新刷新，SwiftUI 直接订
/// - `listByCategory` / `listByRisk` 用于 UI 分组渲染
/// - `requiresApproval` 给 sign / switchActive 类操作做 ApprovalUI gate
///
/// **位置**：CoreP2P 模块（同 Phase 1+2 placement），SwiftPM 单测可直接 import。
public actor RemoteSkillRegistry {

    public enum Source: Sendable, Equatable {
        case disk      // 从 RegistryStore.load 加载
        case seed      // disk 空 → fallback SeedRegistry
    }

    private let store: RegistryStore
    private var skills: [SkillMetadata] = []
    private var byNamespace: [String: SkillMetadata] = [:]
    private(set) var initialized: Bool = false
    private var manifestVerifier: ManifestSignatureVerifier = NoOpManifestVerifier()

    nonisolated private let subject: CurrentValueSubject<[SkillMetadata], Never>

    public init(store: RegistryStore) {
        self.store = store
        self.subject = CurrentValueSubject<[SkillMetadata], Never>([])
    }

    // MARK: - Public API

    /// 启动初始化：先尝试从 disk 加载；失败则使用 [SeedRegistry]。Idempotent。
    /// 返回实际生效的 source（"disk" / "seed"）。
    @discardableResult
    public func initialize() async -> Source {
        let loaded = store.load()
        let source: Source
        let effective: [SkillMetadata]
        if loaded.isEmpty {
            source = .seed
            effective = SeedRegistry.SKILLS
        } else {
            source = .disk
            effective = loaded
        }
        replaceAll(effective)
        initialized = true
        return source
    }

    /// 桌面下发新 skill list（Marketplace M0 落地后）。
    /// **当前 stage** (Phase 3 v0.1)：NoOpManifestVerifier 直接 accept。
    /// **未来**：Marketplace M0 注入真验签后，签名失败 throw。
    public func updateFromRemote(_ skills: [SkillMetadata], signature: String? = nil, publicKey: String? = nil) async throws {
        let json = (try? JSONEncoder().encode(skills)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let valid = await manifestVerifier.verify(manifestJson: json, signature: signature, publicKey: publicKey)
        guard valid else {
            throw RegistryError.signatureInvalid
        }
        replaceAll(skills)
        store.save(skills)
    }

    /// 替换 manifest 验签器（forward-compat for ADR-8 amend / Marketplace M0）。
    public func setManifestVerifier(_ v: ManifestSignatureVerifier) {
        manifestVerifier = v
    }

    /// 当前所有 skills（snapshot）。
    public func allSkills() -> [SkillMetadata] {
        skills
    }

    /// 按 namespace 查 skill metadata。
    public func skill(for namespace: String) -> SkillMetadata? {
        byNamespace[namespace]
    }

    /// 按 category 分组（"ai"/"browser"/"system"/"data"/"ui"/"control"/"infra"）。
    public func listByCategory() -> [String: [SkillMetadata]] {
        Dictionary(grouping: skills, by: { $0.category })
    }

    /// 按 risk 过滤。
    public func listByRisk(_ risk: SkillRiskTag) -> [SkillMetadata] {
        skills.filter { $0.risk == risk }
    }

    /// 判断某 skill 调用是否需要 ApprovalUI 二次确认。
    /// - Parameters:
    ///   - namespace: skill namespace（如 "ai"）
    ///   - method: 方法名（可选，用于 method-level override 决策）
    public func requiresApproval(namespace: String, method: String? = nil) -> Bool {
        guard let skill = byNamespace[namespace] else {
            return true  // 未知 namespace → 保守要求 approval
        }
        // method-level override 优先
        if let methodName = method,
           let methods = skill.methods,
           let m = methods.first(where: { $0.name == methodName }) {
            if let override = m.requiresApprovalOverride { return override }
            if let riskOverride = m.riskOverride { return riskOverride == .Privileged }
        }
        return skill.requiresApproval
    }

    /// 给 SwiftUI 视图订阅的 Combine publisher（nonisolated 访问）。
    /// Subject 内部由 actor `replaceAll` 写入；订阅者拿到 latest list。
    public nonisolated func skillsPublisher() -> AnyPublisher<[SkillMetadata], Never> {
        subject.eraseToAnyPublisher()
    }

    // MARK: - Private

    private func replaceAll(_ newSkills: [SkillMetadata]) {
        skills = newSkills
        byNamespace = Dictionary(uniqueKeysWithValues: newSkills.map { ($0.namespace, $0) })
        subject.send(newSkills)
    }
}

public enum RegistryError: Error, Equatable, Sendable {
    case signatureInvalid
    case decodeFailed(String)
}
