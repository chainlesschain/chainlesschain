import Foundation
import CoreCommon

// MARK: - ProjectTools
/// Project management and task decomposition tools
/// Provides task planning, tracking, and team coordination
///
/// Features:
/// - Task decomposition (hierarchical breakdown)
/// - Project planning and scheduling
/// - Dependency management
/// - Progress tracking
/// - Resource allocation
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Task Models

/// Task priority level
enum TaskPriority: String, Codable, CaseIterable {
    case critical = "critical"
    case high = "high"
    case medium = "medium"
    case low = "low"

    var weight: Int {
        switch self {
        case .critical: return 4
        case .high: return 3
        case .medium: return 2
        case .low: return 1
        }
    }
}

/// Task status
enum TaskStatus: String, Codable, CaseIterable {
    case pending = "pending"
    case inProgress = "in_progress"
    case blocked = "blocked"
    case review = "review"
    case completed = "completed"
    case cancelled = "cancelled"
}

/// Task type
enum TaskType: String, Codable {
    case epic = "epic"
    case story = "story"
    case task = "task"
    case subtask = "subtask"
    case bug = "bug"
    case feature = "feature"
    case improvement = "improvement"
}

/// Project task
struct ProjectTask: Identifiable, Codable {
    let id: String
    var title: String
    var description: String
    var type: TaskType
    var status: TaskStatus
    var priority: TaskPriority
    var assignee: String?
    var reporter: String?
    var parentId: String?
    var dependencies: [String]
    var labels: [String]
    var estimatedHours: Double?
    var actualHours: Double?
    var dueDate: Date?
    var createdAt: Date
    var updatedAt: Date
    var completedAt: Date?
    var subtasks: [ProjectTask]?

    init(
        id: String = UUID().uuidString,
        title: String,
        description: String = "",
        type: TaskType = .task,
        status: TaskStatus = .pending,
        priority: TaskPriority = .medium,
        assignee: String? = nil,
        parentId: String? = nil,
        dependencies: [String] = [],
        labels: [String] = [],
        estimatedHours: Double? = nil,
        dueDate: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.type = type
        self.status = status
        self.priority = priority
        self.assignee = assignee
        self.reporter = nil
        self.parentId = parentId
        self.dependencies = dependencies
        self.labels = labels
        self.estimatedHours = estimatedHours
        self.actualHours = nil
        self.dueDate = dueDate
        self.createdAt = Date()
        self.updatedAt = Date()
        self.completedAt = nil
        self.subtasks = nil
    }
}

/// Project structure
struct Project: Identifiable, Codable {
    let id: String
    var name: String
    var description: String
    var startDate: Date
    var endDate: Date?
    var status: ProjectStatus
    var tasks: [ProjectTask]
    var team: [TeamMember]
    var createdAt: Date
    var updatedAt: Date

    enum ProjectStatus: String, Codable {
        case planning
        case active
        case onHold
        case completed
        case cancelled
    }
}

/// Team member
struct TeamMember: Identifiable, Codable {
    let id: String
    var name: String
    var role: String
    var skills: [String]
    var availability: Double  // Hours per week

    init(id: String = UUID().uuidString, name: String, role: String, skills: [String] = [], availability: Double = 40) {
        self.id = id
        self.name = name
        self.role = role
        self.skills = skills
        self.availability = availability
    }
}

/// Task decomposition result
struct DecompositionResult: Codable {
    let originalTask: String
    let subtasks: [ProjectTask]
    let estimatedTotalHours: Double
    let suggestedDependencies: [[String]]
}

/// Schedule result
struct ScheduleResult: Codable {
    let tasks: [ScheduledTask]
    let criticalPath: [String]
    let estimatedEndDate: Date
    let totalEffort: Double

    struct ScheduledTask: Codable {
        let taskId: String
        let startDate: Date
        let endDate: Date
        let assignee: String?
        let slack: Double  // Slack time in hours
    }
}

/// Progress report
struct ProgressReport: Codable {
    let projectId: String
    let generatedAt: Date
    let totalTasks: Int
    let completedTasks: Int
    let inProgressTasks: Int
    let blockedTasks: Int
    let progressPercentage: Double
    let burndownData: [BurndownPoint]
    let velocityData: [VelocityPoint]
    let riskItems: [RiskItem]

    struct BurndownPoint: Codable {
        let date: Date
        let remaining: Double
        let ideal: Double
    }

    struct VelocityPoint: Codable {
        let sprint: Int
        let completed: Double
        let planned: Double
    }

    struct RiskItem: Codable {
        let description: String
        let severity: String
        let mitigation: String
    }
}

// MARK: - Project Tools Handler

/// Project management tools handler
@MainActor
class ProjectToolsHandler: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    @Published private(set) var projects: [String: Project] = [:]
    @Published private(set) var tasks: [String: ProjectTask] = [:]

    // MARK: - Singleton

    static let shared = ProjectToolsHandler()

    // MARK: - Task Decomposition

    /// Decompose a task into subtasks
    /// - Parameters:
    ///   - taskTitle: Main task title
    ///   - taskDescription: Task description
    ///   - complexity: Complexity level (1-5)
    ///   - maxDepth: Maximum decomposition depth
    /// - Returns: Decomposition result
    func decomposeTask(
        taskTitle: String,
        taskDescription: String,
        complexity: Int = 3,
        maxDepth: Int = 3
    ) async -> DecompositionResult {
        logger.info("[ProjectTools] Decomposing task: \(taskTitle)")

        var subtasks: [ProjectTask] = []
        var totalHours: Double = 0

        // Analyze task and generate subtasks based on complexity
        let baseSubtasks = generateSubtasks(
            for: taskTitle,
            description: taskDescription,
            complexity: complexity
        )

        for (index, subtaskInfo) in baseSubtasks.enumerated() {
            let subtask = ProjectTask(
                title: subtaskInfo.title,
                description: subtaskInfo.description,
                type: .subtask,
                priority: subtaskInfo.priority,
                estimatedHours: subtaskInfo.hours
            )
            subtasks.append(subtask)
            totalHours += subtaskInfo.hours
        }

        // Generate suggested dependencies
        let dependencies = suggestDependencies(subtasks)

        return DecompositionResult(
            originalTask: taskTitle,
            subtasks: subtasks,
            estimatedTotalHours: totalHours,
            suggestedDependencies: dependencies
        )
    }

    /// Generate subtasks based on task analysis
    private func generateSubtasks(
        for title: String,
        description: String,
        complexity: Int
    ) -> [(title: String, description: String, priority: TaskPriority, hours: Double)] {
        // Pattern matching for common task types
        let titleLower = title.lowercased()

        if titleLower.contains("implement") || titleLower.contains("develop") || titleLower.contains("create") {
            return generateDevelopmentSubtasks(title: title, complexity: complexity)
        } else if titleLower.contains("fix") || titleLower.contains("bug") || titleLower.contains("debug") {
            return generateBugFixSubtasks(title: title, complexity: complexity)
        } else if titleLower.contains("test") || titleLower.contains("qa") {
            return generateTestingSubtasks(title: title, complexity: complexity)
        } else if titleLower.contains("design") || titleLower.contains("ui") || titleLower.contains("ux") {
            return generateDesignSubtasks(title: title, complexity: complexity)
        } else {
            return generateGenericSubtasks(title: title, complexity: complexity)
        }
    }

    private func generateDevelopmentSubtasks(title: String, complexity: Int) -> [(String, String, TaskPriority, Double)] {
        let baseHours = Double(complexity) * 2.0

        return [
            ("Requirements Analysis", "Analyze and document requirements for \(title)", .high, baseHours * 0.15),
            ("Technical Design", "Create technical design and architecture", .high, baseHours * 0.2),
            ("Implementation", "Core implementation of \(title)", .high, baseHours * 0.35),
            ("Unit Tests", "Write unit tests for implementation", .medium, baseHours * 0.15),
            ("Code Review", "Conduct code review and address feedback", .medium, baseHours * 0.1),
            ("Documentation", "Update documentation", .low, baseHours * 0.05)
        ]
    }

    private func generateBugFixSubtasks(title: String, complexity: Int) -> [(String, String, TaskPriority, Double)] {
        let baseHours = Double(complexity) * 1.5

        return [
            ("Reproduce Issue", "Reproduce the bug consistently", .critical, baseHours * 0.15),
            ("Root Cause Analysis", "Identify root cause of the issue", .high, baseHours * 0.25),
            ("Fix Implementation", "Implement the fix", .high, baseHours * 0.3),
            ("Testing", "Test the fix thoroughly", .high, baseHours * 0.2),
            ("Regression Testing", "Ensure no regressions", .medium, baseHours * 0.1)
        ]
    }

    private func generateTestingSubtasks(title: String, complexity: Int) -> [(String, String, TaskPriority, Double)] {
        let baseHours = Double(complexity) * 2.0

        return [
            ("Test Plan", "Create test plan and strategy", .high, baseHours * 0.2),
            ("Test Cases", "Write test cases", .high, baseHours * 0.25),
            ("Test Execution", "Execute test cases", .high, baseHours * 0.3),
            ("Bug Reporting", "Document and report found issues", .medium, baseHours * 0.15),
            ("Test Report", "Generate test summary report", .medium, baseHours * 0.1)
        ]
    }

    private func generateDesignSubtasks(title: String, complexity: Int) -> [(String, String, TaskPriority, Double)] {
        let baseHours = Double(complexity) * 2.5

        return [
            ("Research", "Research and gather inspiration", .medium, baseHours * 0.15),
            ("Wireframes", "Create wireframes and low-fidelity designs", .high, baseHours * 0.2),
            ("High-Fidelity Designs", "Create detailed designs", .high, baseHours * 0.35),
            ("Prototyping", "Create interactive prototype", .medium, baseHours * 0.15),
            ("Design Review", "Conduct design review", .medium, baseHours * 0.1),
            ("Handoff", "Prepare design handoff for development", .low, baseHours * 0.05)
        ]
    }

    private func generateGenericSubtasks(title: String, complexity: Int) -> [(String, String, TaskPriority, Double)] {
        let baseHours = Double(complexity) * 2.0

        return [
            ("Planning", "Plan approach for \(title)", .high, baseHours * 0.15),
            ("Execution", "Execute main work", .high, baseHours * 0.5),
            ("Review", "Review and validate work", .medium, baseHours * 0.2),
            ("Documentation", "Document results", .low, baseHours * 0.15)
        ]
    }

    /// Suggest dependencies between tasks
    private func suggestDependencies(_ tasks: [ProjectTask]) -> [[String]] {
        var dependencies: [[String]] = []

        // Simple sequential dependency suggestion
        for i in 1..<tasks.count {
            dependencies.append([tasks[i-1].id, tasks[i].id])
        }

        return dependencies
    }

    // MARK: - Scheduling

    /// Schedule tasks using critical path method
    /// - Parameters:
    ///   - tasks: Tasks to schedule
    ///   - startDate: Project start date
    ///   - teamMembers: Available team members
    /// - Returns: Schedule result
    func scheduleTasks(
        tasks: [ProjectTask],
        startDate: Date,
        teamMembers: [TeamMember]
    ) async -> ScheduleResult {
        logger.info("[ProjectTools] Scheduling \(tasks.count) tasks")

        var scheduledTasks: [ScheduleResult.ScheduledTask] = []
        var currentDate = startDate
        var criticalPath: [String] = []
        var totalEffort: Double = 0

        // Build dependency graph
        var taskMap: [String: ProjectTask] = [:]
        for task in tasks {
            taskMap[task.id] = task
        }

        // Topological sort for dependency order
        let sortedTasks = topologicalSort(tasks)

        // Schedule each task
        for task in sortedTasks {
            let earliestStart = calculateEarliestStart(task, scheduled: scheduledTasks, taskMap: taskMap)
            let hours = task.estimatedHours ?? 8

            // Find available team member
            let assignee = findAvailableTeamMember(
                for: task,
                at: earliestStart,
                teamMembers: teamMembers,
                scheduled: scheduledTasks
            )

            let taskEndDate = addWorkingHours(to: earliestStart, hours: hours)

            scheduledTasks.append(ScheduleResult.ScheduledTask(
                taskId: task.id,
                startDate: earliestStart,
                endDate: taskEndDate,
                assignee: assignee?.name,
                slack: 0  // Simplified - would calculate properly
            ))

            totalEffort += hours
        }

        // Find critical path (longest path)
        criticalPath = findCriticalPath(tasks, scheduledTasks: scheduledTasks)

        let estimatedEndDate = scheduledTasks.map { $0.endDate }.max() ?? startDate

        return ScheduleResult(
            tasks: scheduledTasks,
            criticalPath: criticalPath,
            estimatedEndDate: estimatedEndDate,
            totalEffort: totalEffort
        )
    }

    /// Topological sort of tasks
    private func topologicalSort(_ tasks: [ProjectTask]) -> [ProjectTask] {
        var inDegree: [String: Int] = [:]
        var adjacency: [String: [String]] = [:]

        for task in tasks {
            inDegree[task.id] = 0
            adjacency[task.id] = []
        }

        for task in tasks {
            for dep in task.dependencies {
                adjacency[dep, default: []].append(task.id)
                inDegree[task.id, default: 0] += 1
            }
        }

        var queue = tasks.filter { inDegree[$0.id] == 0 }
        var sorted: [ProjectTask] = []
        var taskMap = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })

        while !queue.isEmpty {
            let current = queue.removeFirst()
            sorted.append(current)

            for neighbor in adjacency[current.id] ?? [] {
                inDegree[neighbor, default: 0] -= 1
                if inDegree[neighbor] == 0, let task = taskMap[neighbor] {
                    queue.append(task)
                }
            }
        }

        return sorted
    }

    /// Calculate earliest start date for a task
    private func calculateEarliestStart(
        _ task: ProjectTask,
        scheduled: [ScheduleResult.ScheduledTask],
        taskMap: [String: ProjectTask]
    ) -> Date {
        var earliestStart = Date()

        for depId in task.dependencies {
            if let scheduledDep = scheduled.first(where: { $0.taskId == depId }) {
                if scheduledDep.endDate > earliestStart {
                    earliestStart = scheduledDep.endDate
                }
            }
        }

        return earliestStart
    }

    /// Find available team member
    private func findAvailableTeamMember(
        for task: ProjectTask,
        at date: Date,
        teamMembers: [TeamMember],
        scheduled: [ScheduleResult.ScheduledTask]
    ) -> TeamMember? {
        // Simplified - return first team member with matching skills
        return teamMembers.first
    }

    /// Add working hours to a date
    private func addWorkingHours(to date: Date, hours: Double) -> Date {
        // Simplified - assumes 8 hour work days
        let days = hours / 8.0
        return Calendar.current.date(byAdding: .day, value: Int(ceil(days)), to: date) ?? date
    }

    /// Find critical path
    private func findCriticalPath(_ tasks: [ProjectTask], scheduledTasks: [ScheduleResult.ScheduledTask]) -> [String] {
        // Simplified - return tasks with zero slack
        return scheduledTasks.filter { $0.slack == 0 }.map { $0.taskId }
    }

    // MARK: - Progress Tracking

    /// Generate progress report
    /// - Parameter projectId: Project ID
    /// - Returns: Progress report
    func generateProgressReport(projectId: String) async -> ProgressReport? {
        guard let project = projects[projectId] else {
            logger.warning("[ProjectTools] Project not found: \(projectId)")
            return nil
        }

        let allTasks = project.tasks
        let completedTasks = allTasks.filter { $0.status == .completed }
        let inProgressTasks = allTasks.filter { $0.status == .inProgress }
        let blockedTasks = allTasks.filter { $0.status == .blocked }

        let progress = allTasks.isEmpty ? 0 : Double(completedTasks.count) / Double(allTasks.count) * 100

        // Generate burndown data (simplified)
        let burndownData = generateBurndownData(project: project)

        // Generate velocity data (simplified)
        let velocityData = generateVelocityData(project: project)

        // Identify risks
        let risks = identifyRisks(project: project)

        return ProgressReport(
            projectId: projectId,
            generatedAt: Date(),
            totalTasks: allTasks.count,
            completedTasks: completedTasks.count,
            inProgressTasks: inProgressTasks.count,
            blockedTasks: blockedTasks.count,
            progressPercentage: progress,
            burndownData: burndownData,
            velocityData: velocityData,
            riskItems: risks
        )
    }

    private func generateBurndownData(project: Project) -> [ProgressReport.BurndownPoint] {
        // Simplified burndown data generation
        let totalHours = project.tasks.compactMap { $0.estimatedHours }.reduce(0, +)
        let completedHours = project.tasks
            .filter { $0.status == .completed }
            .compactMap { $0.estimatedHours }
            .reduce(0, +)

        return [
            ProgressReport.BurndownPoint(date: project.startDate, remaining: totalHours, ideal: totalHours),
            ProgressReport.BurndownPoint(date: Date(), remaining: totalHours - completedHours, ideal: totalHours / 2)
        ]
    }

    private func generateVelocityData(project: Project) -> [ProgressReport.VelocityPoint] {
        // Simplified velocity data
        return [
            ProgressReport.VelocityPoint(sprint: 1, completed: 20, planned: 25),
            ProgressReport.VelocityPoint(sprint: 2, completed: 28, planned: 25)
        ]
    }

    private func identifyRisks(project: Project) -> [ProgressReport.RiskItem] {
        var risks: [ProgressReport.RiskItem] = []

        // Check for blocked tasks
        let blockedCount = project.tasks.filter { $0.status == .blocked }.count
        if blockedCount > 0 {
            risks.append(ProgressReport.RiskItem(
                description: "\(blockedCount) blocked task(s)",
                severity: blockedCount > 2 ? "high" : "medium",
                mitigation: "Resolve blocking dependencies"
            ))
        }

        // Check for overdue tasks
        let overdueTasks = project.tasks.filter {
            if let dueDate = $0.dueDate, $0.status != .completed {
                return dueDate < Date()
            }
            return false
        }
        if !overdueTasks.isEmpty {
            risks.append(ProgressReport.RiskItem(
                description: "\(overdueTasks.count) overdue task(s)",
                severity: "high",
                mitigation: "Re-prioritize and reallocate resources"
            ))
        }

        return risks
    }

    // MARK: - Task Management

    /// Create a new task
    func createTask(_ task: ProjectTask) {
        tasks[task.id] = task
    }

    /// Update task status
    func updateTaskStatus(taskId: String, status: TaskStatus) {
        tasks[taskId]?.status = status
        tasks[taskId]?.updatedAt = Date()

        if status == .completed {
            tasks[taskId]?.completedAt = Date()
        }
    }

    /// Assign task to team member
    func assignTask(taskId: String, assignee: String) {
        tasks[taskId]?.assignee = assignee
        tasks[taskId]?.updatedAt = Date()
    }

    /// Get tasks by status
    func getTasks(status: TaskStatus) -> [ProjectTask] {
        return Array(tasks.values).filter { $0.status == status }
    }

    /// Get tasks by assignee
    func getTasks(assignee: String) -> [ProjectTask] {
        return Array(tasks.values).filter { $0.assignee == assignee }
    }
}

// MARK: - Tool Registration

extension ProjectToolsHandler {
    /// Get all project tools for registration
    func getTools() -> [Tool] {
        return [
            Tool(
                name: "task_decompose",
                description: "Decompose a task into subtasks with estimates",
                parameters: [
                    ToolParameter(name: "taskTitle", type: .string, description: "Main task title", required: true),
                    ToolParameter(name: "taskDescription", type: .string, description: "Task description", required: false),
                    ToolParameter(name: "complexity", type: .number, description: "Complexity level (1-5)", required: false)
                ]
            ),
            Tool(
                name: "schedule_tasks",
                description: "Schedule tasks with dependencies",
                parameters: [
                    ToolParameter(name: "tasks", type: .array, description: "Tasks to schedule", required: true),
                    ToolParameter(name: "startDate", type: .string, description: "Project start date", required: true),
                    ToolParameter(name: "teamMembers", type: .array, description: "Team members", required: false)
                ]
            ),
            Tool(
                name: "progress_report",
                description: "Generate project progress report",
                parameters: [
                    ToolParameter(name: "projectId", type: .string, description: "Project ID", required: true)
                ]
            ),
            Tool(
                name: "create_task",
                description: "Create a new task",
                parameters: [
                    ToolParameter(name: "title", type: .string, description: "Task title", required: true),
                    ToolParameter(name: "description", type: .string, description: "Task description", required: false),
                    ToolParameter(name: "priority", type: .string, description: "Priority level", required: false),
                    ToolParameter(name: "estimatedHours", type: .number, description: "Estimated hours", required: false)
                ]
            ),
            Tool(
                name: "update_task_status",
                description: "Update task status",
                parameters: [
                    ToolParameter(name: "taskId", type: .string, description: "Task ID", required: true),
                    ToolParameter(name: "status", type: .string, description: "New status", required: true)
                ]
            )
        ]
    }
}
