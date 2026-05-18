import Foundation

/// `RemoteSkillRegistry` 持久层 — Phase 3.1。
///
/// UserDefaults JSON（与 Phase 1 `PairedDesktopsStore` 同模式）。失败容忍：
/// decode 失败 = 返空数组，caller 应 fallback 到 `SeedRegistry`。
///
/// **non-actor**：内部无可变状态，纯函数式 load/save；caller (RemoteSkillRegistry actor)
/// 已串行化所有访问。
public final class RegistryStore: @unchecked Sendable {
    private let userDefaults: UserDefaults
    private let key: String

    public init(
        userDefaults: UserDefaults = .standard,
        key: String = "remote_skill_registry"
    ) {
        self.userDefaults = userDefaults
        self.key = key
    }

    /// 从 UserDefaults 加载已持久化的 skill list。失败返空数组。
    public func load() -> [SkillMetadata] {
        guard let data = userDefaults.data(forKey: key) else { return [] }
        do {
            return try JSONDecoder().decode([SkillMetadata].self, from: data)
        } catch {
            // schema 演进 / decode 错 → 返空让 caller fallback to seed
            return []
        }
    }

    /// 持久化整个 skill list。覆盖式写。失败 silent（与 Phase 1 store 一致）。
    public func save(_ skills: [SkillMetadata]) {
        do {
            let data = try JSONEncoder().encode(skills)
            userDefaults.set(data, forKey: key)
        } catch {
            // best-effort — 下次 load 会返空，re-seed 接住
        }
    }

    /// 清空持久化数据（测试或 reset 时用）。
    public func clear() {
        userDefaults.removeObject(forKey: key)
    }
}
