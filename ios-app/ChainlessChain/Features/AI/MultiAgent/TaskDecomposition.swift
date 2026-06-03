import Foundation
import CoreCommon

// MARK: - TaskDecomposition
/// Enhanced task decomposition and hierarchical planning
/// Provides intelligent task breakdown with dependency analysis
///
/// Features:
/// - Hierarchical task decomposition
/// - Automatic dependency detection
/// - Effort estimation
/// - Parallelization analysis
/// - Critical path identification
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Task Hierarchy

/// Hierarchical task node
class HierarchicalTask: Identifiable, Codable {
    let id: String
    var title: String
    var description: String
    var level: TaskLevel
    var type: DecomposedTaskType
    var status: TaskDecompositionStatus
    var estimatedEffort: TaskEffort
    var dependencies: [String]
    var subtasks: [HierarchicalTask]
    var parentId: String?
    var assignedAgent: String?
    var priority: Int
    var metadata: [String: String]

    init(
        id: String = UUID().uuidString,
        title: String,
        description: String = "",
        level: TaskLevel = .task,
        type: DecomposedTaskType = .implementation,
        estimatedEffort: TaskEffort = .medium,
        dependencies: [String] = [],
        parentId: String? = nil,
        priority: Int = 0
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.level = level
        self.type = type
        self.status = .pending
        self.estimatedEffort = estimatedEffort
        self.dependencies = dependencies
        self.subtasks = []
        self.parentId = parentId
        self.assignedAgent = nil
        self.priority = priority
        self.metadata = [:]
    }

    /// Total effort including subtasks
    var totalEffort: Double {
        let ownEffort = estimatedEffort.hours
        let subtaskEffort = subtasks.reduce(0.0) { $0 + $1.totalEffort }
        return ownEffort + subtaskEffort
    }

    /// Check if all dependencies are satisfied
    func dependenciesSatisfied(completedTasks: Set<String>) -> Bool {
        return Set(dependencies).isSubset(of: completedTasks)
    }
}

/// Task hierarchy level
enum TaskLevel: String, Codable, CaseIterable {
    case epic = "epic"           // Large initiative
    case feature = "feature"     // User-facing feature
    case story = "story"         // User story
    case task = "task"           // Implementation task
    case subtask = "subtask"     // Atomic subtask

    var depth: Int {
        switch self {
        case .epic: return 0
        case .feature: return 1
        case .story: return 2
        case .task: return 3
        case .subtask: return 4
        }
    }
}

/// Decomposed task type
enum DecomposedTaskType: String, Codable {
    case planning = "planning"
    case research = "research"
    case design = "design"
    case implementation = "implementation"
    case testing = "testing"
    case documentation = "documentation"
    case review = "review"
    case deployment = "deployment"
}

/// Task decomposition status
enum TaskDecompositionStatus: String, Codable {
    case pending
    case decomposed
    case inProgress
    case completed
    case blocked
}

/// Task effort estimation
enum TaskEffort: String, Codable, CaseIterable {
    case trivial = "trivial"
    case small = "small"
    case medium = "medium"
    case large = "large"
    case extraLarge = "extra_large"

    var hours: Double {
        switch self {
        case .trivial: return 0.5
        case .small: return 2.0
        case .medium: return 4.0
        case .large: return 8.0
        case .extraLarge: return 16.0
        }
    }

    var storyPoints: Int {
        switch self {
        case .trivial: return 1
        case .small: return 2
        case .medium: return 3
        case .large: return 5
        case .extraLarge: return 8
        }
    }
}

// MARK: - Decomposition Result

/// Task decomposition result
struct DecompositionOutput {
    let rootTask: HierarchicalTask
    let allTasks: [HierarchicalTask]
    let executionPlan: ExecutionPlan
    let metrics: DecompositionMetrics
}

/// Execution plan
struct ExecutionPlan: Codable {
    let phases: [ExecutionPhase]
    let criticalPath: [String]
    let parallelGroups: [[String]]
    let estimatedDuration: TimeInterval
    let resourceRequirements: [String: Int]  // Role -> count
}

/// Execution phase
struct ExecutionPhase: Codable, Identifiable {
    let id: String
    let name: String
    let tasks: [String]
    let dependencies: [String]
    let estimatedDuration: TimeInterval
}

/// Decomposition metrics
struct DecompositionMetrics: Codable {
    let totalTasks: Int
    let totalEffortHours: Double
    let totalStoryPoints: Int
    let maxParallelism: Int
    let criticalPathLength: Int
    let decompositionDepth: Int
    let tasksByType: [String: Int]
    let tasksByLevel: [String: Int]
}

// MARK: - Task Decomposer

/// Hierarchical task decomposer
@MainActor
class TaskDecomposer: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private weak var llmManager: LLMManager?

    @Published private(set) var isDecomposing = false
    @Published private(set) var lastDecomposition: DecompositionOutput?

    // Decomposition templates
    private let templates: [DecomposedTaskType: [String]] = [
        .implementation: ["Design", "Implement", "Test", "Document", "Review"],
        .research: ["Define scope", "Gather information", "Analyze", "Synthesize", "Report"],
        .design: ["Research", "Wireframe", "High-fidelity", "Prototype", "Review"],
        .testing: ["Plan", "Write tests", "Execute", "Report bugs", "Verify fixes"]
    ]

    // MARK: - Singleton

    static let shared = TaskDecomposer()

    // MARK: - Initialization

    init() {}

    /// Set LLM manager
    func setLLMManager(_ manager: LLMManager) {
        self.llmManager = manager
    }

    // MARK: - Decomposition

    /// Decompose task hierarchically
    /// - Parameters:
    ///   - task: Task to decompose
    ///   - targetLevel: Target decomposition level
    ///   - useLLM: Use LLM for intelligent decomposition
    /// - Returns: Decomposition output
    func decompose(
        task: HierarchicalTask,
        targetLevel: TaskLevel = .subtask,
        useLLM: Bool = true
    ) async throws -> DecompositionOutput {
        logger.info("[TaskDecomposer] Decomposing: \(task.title)")
        isDecomposing = true
        defer { isDecomposing = false }

        var rootTask = task
        var allTasks: [HierarchicalTask] = []

        // Recursive decomposition
        try await decomposeRecursively(
            task: &rootTask,
            targetLevel: targetLevel,
            useLLM: useLLM,
            allTasks: &allTasks
        )

        // Analyze dependencies
        analyzeDependencies(tasks: allTasks)

        // Build execution plan
        let executionPlan = buildExecutionPlan(tasks: allTasks)

        // Calculate metrics
        let metrics = calculateMetrics(rootTask: rootTask, allTasks: allTasks)

        let output = DecompositionOutput(
            rootTask: rootTask,
            allTasks: allTasks,
            executionPlan: executionPlan,
            metrics: metrics
        )

        lastDecomposition = output
        return output
    }

    /// Recursive decomposition helper
    private func decomposeRecursively(
        task: inout HierarchicalTask,
        targetLevel: TaskLevel,
        useLLM: Bool,
        allTasks: inout [HierarchicalTask]
    ) async throws {
        allTasks.append(task)

        // Stop if reached target level
        guard task.level.depth < targetLevel.depth else {
            task.status = .decomposed
            return
        }

        // Generate subtasks
        let subtasks: [HierarchicalTask]

        if useLLM, let llm = llmManager {
            subtasks = try await generateSubtasksWithLLM(task: task, llm: llm)
        } else {
            subtasks = generateSubtasksFromTemplate(task: task)
        }

        // Recursively decompose subtasks
        for var subtask in subtasks {
            subtask.parentId = task.id
            try await decomposeRecursively(
                task: &subtask,
                targetLevel: targetLevel,
                useLLM: useLLM,
                allTasks: &allTasks
            )
            task.subtasks.append(subtask)
        }

        task.status = .decomposed
    }

    /// Generate subtasks using LLM
    private func generateSubtasksWithLLM(
        task: HierarchicalTask,
        llm: LLMManager
    ) async throws -> [HierarchicalTask] {
        let nextLevel = TaskLevel.allCases.first { $0.depth == task.level.depth + 1 } ?? .subtask

        let prompt = """
        Decompose this task into subtasks:

        Task: \(task.title)
        Description: \(task.description)
        Current Level: \(task.level.rawValue)
        Target Level: \(nextLevel.rawValue)

        Please provide 3-7 subtasks in JSON format:
        [
          {
            "title": "Subtask title",
            "description": "Brief description",
            "type": "implementation|research|design|testing|documentation|review",
            "effort": "trivial|small|medium|large|extra_large",
            "priority": 0-10
          }
        ]
        """

        let response = try await llm.chat(
            messages: [LLMMessage(role: "user", content: prompt)],
            options: ChatOptions(temperature: 0.3, topP: 0.9, maxTokens: 1000)
        )

        return parseSubtasksFromLLM(response.text, parentId: task.id, level: nextLevel)
    }

    /// Parse subtasks from LLM response
    private func parseSubtasksFromLLM(
        _ response: String,
        parentId: String,
        level: TaskLevel
    ) -> [HierarchicalTask] {
        // Clean JSON
        let cleanedJSON = response
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard let data = cleanedJSON.data(using: .utf8),
              let jsonArray = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return generateSubtasksFromTemplate(task: HierarchicalTask(title: "fallback"))
        }

        return jsonArray.compactMap { dict -> HierarchicalTask? in
            guard let title = dict["title"] as? String else { return nil }

            let description = dict["description"] as? String ?? ""
            let typeStr = dict["type"] as? String ?? "implementation"
            let effortStr = dict["effort"] as? String ?? "medium"
            let priority = dict["priority"] as? Int ?? 0

            return HierarchicalTask(
                title: title,
                description: description,
                level: level,
                type: DecomposedTaskType(rawValue: typeStr) ?? .implementation,
                estimatedEffort: TaskEffort(rawValue: effortStr) ?? .medium,
                parentId: parentId,
                priority: priority
            )
        }
    }

    /// Generate subtasks from template
    private func generateSubtasksFromTemplate(task: HierarchicalTask) -> [HierarchicalTask] {
        let template = templates[task.type] ?? ["Analyze", "Implement", "Verify"]
        let nextLevel = TaskLevel.allCases.first { $0.depth == task.level.depth + 1 } ?? .subtask

        return template.enumerated().map { index, stepName in
            HierarchicalTask(
                title: "\(stepName): \(task.title)",
                description: "\(stepName) phase for \(task.title)",
                level: nextLevel,
                type: inferType(from: stepName),
                estimatedEffort: .medium,
                parentId: task.id,
                priority: template.count - index
            )
        }
    }

    /// Infer task type from name
    private func inferType(from name: String) -> DecomposedTaskType {
        let lower = name.lowercased()
        if lower.contains("design") || lower.contains("wireframe") {
            return .design
        } else if lower.contains("test") || lower.contains("verify") {
            return .testing
        } else if lower.contains("document") {
            return .documentation
        } else if lower.contains("review") {
            return .review
        } else if lower.contains("research") || lower.contains("analyze") {
            return .research
        } else if lower.contains("plan") {
            return .planning
        } else {
            return .implementation
        }
    }

    // MARK: - Dependency Analysis

    /// Analyze and set dependencies
    private func analyzeDependencies(tasks: [HierarchicalTask]) {
        // Simple sequential dependency within same parent
        var tasksByParent: [String?: [HierarchicalTask]] = [:]

        for task in tasks {
            tasksByParent[task.parentId, default: []].append(task)
        }

        for (_, siblings) in tasksByParent {
            let sorted = siblings.sorted { $0.priority > $1.priority }

            for i in 1..<sorted.count {
                let previousId = sorted[i-1].id
                if !sorted[i].dependencies.contains(previousId) {
                    // Note: modifying through reference
                    tasks.first { $0.id == sorted[i].id }?.dependencies.append(previousId)
                }
            }
        }
    }

    // MARK: - Execution Planning

    /// Build execution plan
    private func buildExecutionPlan(tasks: [HierarchicalTask]) -> ExecutionPlan {
        // Find parallel groups (tasks with no dependencies between them)
        var parallelGroups: [[String]] = []
        var scheduled: Set<String> = []
        var remaining = tasks

        while !remaining.isEmpty {
            // Find tasks whose dependencies are all scheduled
            let ready = remaining.filter { task in
                Set(task.dependencies).isSubset(of: scheduled)
            }

            if ready.isEmpty { break }

            let group = ready.map { $0.id }
            parallelGroups.append(group)

            for task in ready {
                scheduled.insert(task.id)
            }

            remaining.removeAll { task in ready.contains { $0.id == task.id } }
        }

        // Build phases
        let phases = parallelGroups.enumerated().map { index, group in
            ExecutionPhase(
                id: "phase_\(index + 1)",
                name: "Phase \(index + 1)",
                tasks: group,
                dependencies: index > 0 ? parallelGroups[index - 1] : [],
                estimatedDuration: group.compactMap { taskId in
                    tasks.first { $0.id == taskId }?.estimatedEffort.hours
                }.max() ?? 0
            )
        }

        // Find critical path (longest path through dependencies)
        let criticalPath = findCriticalPath(tasks: tasks, parallelGroups: parallelGroups)

        // Calculate resource requirements
        var resourceReqs: [String: Int] = [:]
        for task in tasks {
            let role = inferAgentRole(for: task)
            resourceReqs[role, default: 0] += 1
        }

        let totalDuration = phases.reduce(0.0) { $0 + $1.estimatedDuration }

        return ExecutionPlan(
            phases: phases,
            criticalPath: criticalPath,
            parallelGroups: parallelGroups,
            estimatedDuration: totalDuration * 3600,  // Convert hours to seconds
            resourceRequirements: resourceReqs
        )
    }

    /// Find critical path
    private func findCriticalPath(
        tasks: [HierarchicalTask],
        parallelGroups: [[String]]
    ) -> [String] {
        var criticalPath: [String] = []

        for group in parallelGroups {
            // Find task with longest effort in each group
            if let longestTask = group.compactMap({ taskId in
                tasks.first { $0.id == taskId }
            }).max(by: { $0.totalEffort < $1.totalEffort }) {
                criticalPath.append(longestTask.id)
            }
        }

        return criticalPath
    }

    /// Infer agent role for task
    private func inferAgentRole(for task: HierarchicalTask) -> String {
        switch task.type {
        case .implementation: return "coder"
        case .research: return "researcher"
        case .design: return "designer"
        case .testing: return "qa"
        case .documentation: return "documentWriter"
        case .review: return "reviewer"
        case .planning: return "coordinator"
        case .deployment: return "devops"
        }
    }

    // MARK: - Metrics

    /// Calculate decomposition metrics
    private func calculateMetrics(
        rootTask: HierarchicalTask,
        allTasks: [HierarchicalTask]
    ) -> DecompositionMetrics {
        var tasksByType: [String: Int] = [:]
        var tasksByLevel: [String: Int] = [:]
        var totalStoryPoints = 0
        var maxDepth = 0

        for task in allTasks {
            tasksByType[task.type.rawValue, default: 0] += 1
            tasksByLevel[task.level.rawValue, default: 0] += 1
            totalStoryPoints += task.estimatedEffort.storyPoints
            maxDepth = max(maxDepth, task.level.depth)
        }

        return DecompositionMetrics(
            totalTasks: allTasks.count,
            totalEffortHours: rootTask.totalEffort,
            totalStoryPoints: totalStoryPoints,
            maxParallelism: calculateMaxParallelism(tasks: allTasks),
            criticalPathLength: findCriticalPath(tasks: allTasks, parallelGroups: []).count,
            decompositionDepth: maxDepth,
            tasksByType: tasksByType,
            tasksByLevel: tasksByLevel
        )
    }

    /// Calculate maximum parallelism
    private func calculateMaxParallelism(tasks: [HierarchicalTask]) -> Int {
        var groups: [[HierarchicalTask]] = []
        var scheduled: Set<String> = []
        var remaining = tasks

        while !remaining.isEmpty {
            let ready = remaining.filter { Set($0.dependencies).isSubset(of: scheduled) }
            if ready.isEmpty { break }

            groups.append(ready)
            for task in ready {
                scheduled.insert(task.id)
            }
            remaining.removeAll { task in ready.contains { $0.id == task.id } }
        }

        return groups.map { $0.count }.max() ?? 1
    }

    // MARK: - Utility Methods

    /// Flatten task hierarchy
    func flattenHierarchy(_ root: HierarchicalTask) -> [HierarchicalTask] {
        var result = [root]
        for subtask in root.subtasks {
            result.append(contentsOf: flattenHierarchy(subtask))
        }
        return result
    }

    /// Get tasks at specific level
    func getTasks(at level: TaskLevel, from root: HierarchicalTask) -> [HierarchicalTask] {
        return flattenHierarchy(root).filter { $0.level == level }
    }

    /// Get leaf tasks (no subtasks)
    func getLeafTasks(from root: HierarchicalTask) -> [HierarchicalTask] {
        return flattenHierarchy(root).filter { $0.subtasks.isEmpty }
    }
}
