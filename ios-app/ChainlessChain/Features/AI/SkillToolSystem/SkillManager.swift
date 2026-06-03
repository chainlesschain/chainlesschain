import Foundation
import Combine

/// 技能管理器
///
/// 负责管理所有技能的注册、查找、执行
/// 参考：PC端 desktop-app-vue/src/main/skill-tool-system/
public class SkillManager: ObservableObject {
    public static let shared = SkillManager()

    @Published public private(set) var skills: [Skill] = []
    @Published public private(set) var isLoading: Bool = false

    private var skillsById: [String: Skill] = [:]
    private var skillsByCategory: [SkillCategory: [Skill]] = [:]

    private init() {
        loadBuiltinSkills()
    }

    // MARK: - 技能注册

    /// 注册技能
    public func register(_ skill: Skill) {
        // 检查是否已存在
        if skillsById[skill.id] != nil {
            Logger.shared.warning("技能 '\(skill.name)' 已存在，将覆盖")
        }

        // 注册到字典
        skillsById[skill.id] = skill

        // 按分类组织
        if skillsByCategory[skill.category] == nil {
            skillsByCategory[skill.category] = []
        }
        skillsByCategory[skill.category]?.append(skill)

        // 更新数组
        updateSkillsList()

        Logger.shared.info("技能已注册: \(skill.name) (\(skill.id))")
    }

    /// 批量注册技能
    public func registerAll(_ skills: [Skill]) {
        for skill in skills {
            register(skill)
        }
    }

    /// 注销技能
    public func unregister(skillId: String) {
        guard let skill = skillsById[skillId] else {
            return
        }

        skillsById.removeValue(forKey: skillId)
        skillsByCategory[skill.category]?.removeAll { $0.id == skillId }

        updateSkillsList()

        Logger.shared.info("技能已注销: \(skill.name)")
    }

    // MARK: - 技能查找

    /// 根据ID获取技能
    public func getSkill(id: String) -> Skill? {
        return skillsById[id]
    }

    /// 根据分类获取技能
    public func getSkills(category: SkillCategory) -> [Skill] {
        return skillsByCategory[category] ?? []
    }

    /// 搜索技能
    public func search(criteria: SkillSearchCriteria) -> [Skill] {
        var results = skills

        // 按查询字符串过滤
        if let query = criteria.query, !query.isEmpty {
            let lowercaseQuery = query.lowercased()
            results = results.filter { skill in
                skill.name.lowercased().contains(lowercaseQuery) ||
                skill.description.lowercased().contains(lowercaseQuery) ||
                skill.tags.contains(where: { $0.lowercased().contains(lowercaseQuery) })
            }
        }

        // 按分类过滤
        if let categories = criteria.categories, !categories.isEmpty {
            results = results.filter { categories.contains($0.category) }
        }

        // 按级别过滤
        if let levels = criteria.levels, !levels.isEmpty {
            results = results.filter { levels.contains($0.level) }
        }

        // 按标签过滤
        if let tags = criteria.tags, !tags.isEmpty {
            results = results.filter { skill in
                tags.contains(where: { tag in skill.tags.contains(tag) })
            }
        }

        // 按启用状态过滤
        if let isEnabled = criteria.isEnabled {
            results = results.filter { $0.isEnabled == isEnabled }
        }

        return results
    }

    /// 获取所有分类的技能分组
    public func getSkillGroups() -> [SkillGroup] {
        return SkillCategory.allCases.compactMap { category in
            let categorySkills = skillsByCategory[category] ?? []
            guard !categorySkills.isEmpty else { return nil }
            return SkillGroup(category: category, skills: categorySkills)
        }
    }

    // MARK: - 技能执行

    /// 执行技能
    public func execute(skillId: String, input: [String: Any]) async throws -> SkillExecutionResult {
        guard let skill = skillsById[skillId] else {
            throw SkillError.skillNotFound(skillId)
        }

        guard skill.isEnabled else {
            throw SkillError.skillDisabled(skill.name)
        }

        let startTime = Date()
        var toolsUsed: [String] = []

        do {
            // 获取技能需要的所有工具
            let toolManager = ToolManager.shared
            var output: Any? = nil

            // 执行技能的所有工具
            for toolId in skill.toolIds {
                guard let tool = toolManager.getTool(id: toolId) else {
                    throw SkillError.toolNotFound(toolId)
                }

                let toolInput = ToolInput(parameters: input)
                let toolOutput = try await toolManager.execute(toolId: toolId, input: toolInput)

                if !toolOutput.success {
                    throw SkillError.toolExecutionFailed(tool.name, toolOutput.error ?? "未知错误")
                }

                output = toolOutput.data
                toolsUsed.append(toolId)
            }

            let executionTime = Date().timeIntervalSince(startTime)

            return SkillExecutionResult(
                skillId: skillId,
                success: true,
                output: output,
                error: nil,
                executionTime: executionTime,
                toolsUsed: toolsUsed
            )

        } catch {
            let executionTime = Date().timeIntervalSince(startTime)

            return SkillExecutionResult(
                skillId: skillId,
                success: false,
                output: nil,
                error: error,
                executionTime: executionTime,
                toolsUsed: toolsUsed
            )
        }
    }

    // MARK: - 私有方法

    private func updateSkillsList() {
        skills = Array(skillsById.values).sorted { $0.name < $1.name }
    }

    /// 加载内置技能
    private func loadBuiltinSkills() {
        isLoading = true

        // 加载内置技能
        let builtinSkills = BuiltinSkills.all

        registerAll(builtinSkills)

        isLoading = false

        Logger.shared.info("加载了 \(skills.count) 个内置技能")
    }
}

// MARK: - 技能错误

public enum SkillError: LocalizedError {
    case skillNotFound(String)
    case skillDisabled(String)
    case toolNotFound(String)
    case toolExecutionFailed(String, String)

    public var errorDescription: String? {
        switch self {
        case .skillNotFound(let id):
            return "技能未找到: \(id)"
        case .skillDisabled(let name):
            return "技能已禁用: \(name)"
        case .toolNotFound(let id):
            return "工具未找到: \(id)"
        case .toolExecutionFailed(let name, let error):
            return "工具执行失败 '\(name)': \(error)"
        }
    }
}
