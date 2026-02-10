import Foundation
import Combine

// MARK: - WorkflowManager
/// Central manager for workflow pipeline execution
/// Ported from PC: workflow/workflow-pipeline.js
///
/// Features:
/// - 6-stage pipeline execution
/// - Quality gate validation
/// - Progress events
/// - Pause/Resume/Cancel
/// - Error recovery
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Stage Executor Protocol

protocol StageExecutorProtocol {
    func execute(stage: WorkflowStage, context: [String: AnyCodableValue]) async throws -> [String: AnyCodableValue]
}

// MARK: - Workflow Manager Delegate

protocol WorkflowManagerDelegate: AnyObject {
    func workflowManager(_ manager: WorkflowManager, didStartWorkflow workflow: Workflow)
    func workflowManager(_ manager: WorkflowManager, didUpdateProgress progress: WorkflowProgress)
    func workflowManager(_ manager: WorkflowManager, didCompleteWorkflow workflow: Workflow)
    func workflowManager(_ manager: WorkflowManager, didFailWorkflow workflow: Workflow, error: WorkflowError)
    func workflowManager(_ manager: WorkflowManager, didChangeState state: WorkflowState, for workflowId: String)
    func workflowManager(_ manager: WorkflowManager, didStartStage stage: WorkflowStage, in workflowId: String)
    func workflowManager(_ manager: WorkflowManager, didCompleteStage stage: WorkflowStage, in workflowId: String)
    func workflowManager(_ manager: WorkflowManager, didPassQualityGate gate: QualityGate, in workflowId: String)
    func workflowManager(_ manager: WorkflowManager, didFailQualityGate gate: QualityGate, in workflowId: String)
}

// MARK: - Workflow Manager

@MainActor
class WorkflowManager: ObservableObject {

    // MARK: - Singleton

    static let shared = WorkflowManager()

    // MARK: - Properties

    private let logger = Logger.shared

    /// Configuration
    @Published var configuration: WorkflowConfiguration

    /// Active workflows
    @Published private(set) var activeWorkflows: [String: Workflow] = [:]

    /// Workflow history
    @Published private(set) var history: [Workflow] = []

    /// Statistics
    @Published private(set) var statistics = WorkflowStatistics()

    /// Stage executors
    private var stageExecutors: [WorkflowStageType: StageExecutorProtocol] = [:]

    /// Quality gate manager
    private let qualityGateManager = QualityGateManager()

    /// Delegate
    weak var delegate: WorkflowManagerDelegate?

    /// Event publishers
    let workflowStarted = PassthroughSubject<Workflow, Never>()
    let workflowCompleted = PassthroughSubject<Workflow, Never>()
    let workflowFailed = PassthroughSubject<(Workflow, WorkflowError), Never>()
    let progressUpdated = PassthroughSubject<WorkflowProgress, Never>()
    let stageStarted = PassthroughSubject<(String, WorkflowStage), Never>()
    let stageCompleted = PassthroughSubject<(String, WorkflowStage), Never>()

    /// Pause control
    private var pauseTokens: [String: CheckedContinuation<Void, Never>?] = [:]
    private var cancellationTokens: [String: Bool] = [:]

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.configuration = WorkflowConfiguration()
        registerDefaultExecutors()
        loadHistory()
    }

    // MARK: - Executor Registration

    /// Register stage executor
    func registerExecutor(_ executor: StageExecutorProtocol, for stageType: WorkflowStageType) {
        stageExecutors[stageType] = executor
        logger.info("[WorkflowManager] Registered executor for \(stageType.displayName)")
    }

    /// Register default executors
    private func registerDefaultExecutors() {
        // Default executors that simulate work
        for stageType in WorkflowStageType.allCases {
            stageExecutors[stageType] = DefaultStageExecutor()
        }
    }

    // MARK: - Workflow Creation

    /// Create a new workflow
    func createWorkflow(title: String, description: String? = nil, stages: [WorkflowStage]? = nil) -> Workflow {
        let workflow = Workflow(
            title: title,
            description: description,
            stages: stages
        )

        logger.info("[WorkflowManager] Created workflow: \(workflow.id)")
        return workflow
    }

    // MARK: - Workflow Execution

    /// Execute a workflow
    func execute(_ workflow: Workflow, input: [String: AnyCodableValue]? = nil, context: [String: AnyCodableValue] = [:]) async throws -> Workflow {
        var workflow = workflow

        // Validate state
        guard workflow.state.canStart else {
            throw WorkflowError.invalidState(current: workflow.state, expected: [.idle])
        }

        logger.info("[WorkflowManager] Starting workflow: \(workflow.id)")

        // Initialize
        workflow.state = .running
        workflow.startTime = Date()
        workflow.input = input
        workflow.context = context
        workflow.currentStageIndex = 0

        activeWorkflows[workflow.id] = workflow
        cancellationTokens[workflow.id] = false

        // Emit start event
        workflowStarted.send(workflow)
        delegate?.workflowManager(self, didStartWorkflow: workflow)
        log(&workflow, level: .info, message: "工作流开始执行")

        do {
            // Execute each stage
            for (index, _) in workflow.stages.enumerated() {
                // Check cancellation
                if cancellationTokens[workflow.id] == true {
                    throw WorkflowError.cancelled
                }

                // Check pause
                if workflow.state == .paused {
                    await waitForResume(workflowId: workflow.id)
                    workflow.state = .running
                }

                workflow.currentStageIndex = index
                activeWorkflows[workflow.id] = workflow

                // Execute stage
                try await executeStage(&workflow, stageIndex: index)
            }

            // Complete
            workflow.state = .completed
            workflow.endTime = Date()
            activeWorkflows.removeValue(forKey: workflow.id)

            // Update statistics
            if let duration = workflow.duration {
                statistics.recordCompletion(duration: duration)
            }

            // Save to history
            history.insert(workflow, at: 0)
            if history.count > 100 {
                history = Array(history.prefix(100))
            }
            saveHistory()

            log(&workflow, level: .info, message: "工作流执行完成")
            workflowCompleted.send(workflow)
            delegate?.workflowManager(self, didCompleteWorkflow: workflow)

            logger.info("[WorkflowManager] Workflow completed: \(workflow.id)")

            return workflow

        } catch let error as WorkflowError {
            workflow.state = .failed
            workflow.endTime = Date()
            activeWorkflows.removeValue(forKey: workflow.id)
            statistics.recordFailure()

            log(&workflow, level: .error, message: "工作流执行失败: \(error.localizedDescription ?? "")")
            workflowFailed.send((workflow, error))
            delegate?.workflowManager(self, didFailWorkflow: workflow, error: error)

            throw error

        } catch {
            let workflowError = WorkflowError.executionFailed(error.localizedDescription)
            workflow.state = .failed
            workflow.endTime = Date()
            activeWorkflows.removeValue(forKey: workflow.id)
            statistics.recordFailure()

            log(&workflow, level: .error, message: "工作流执行失败: \(error.localizedDescription)")
            workflowFailed.send((workflow, workflowError))
            delegate?.workflowManager(self, didFailWorkflow: workflow, error: workflowError)

            throw workflowError
        }
    }

    /// Execute a single stage
    private func executeStage(_ workflow: inout Workflow, stageIndex: Int) async throws {
        var stage = workflow.stages[stageIndex]

        logger.info("[WorkflowManager] Executing stage: \(stage.name)")

        // Start stage
        stage.start()
        workflow.stages[stageIndex] = stage
        emitProgress(workflow)

        stageStarted.send((workflow.id, stage))
        delegate?.workflowManager(self, didStartStage: stage, in: workflow.id)
        log(&workflow, level: .info, message: "开始阶段: \(stage.name)", stageId: stage.id)

        do {
            // Execute each step
            for (stepIndex, _) in stage.steps.enumerated() {
                // Check cancellation
                if cancellationTokens[workflow.id] == true {
                    throw WorkflowError.cancelled
                }

                try await executeStep(&workflow, stageIndex: stageIndex, stepIndex: stepIndex)
            }

            // Run quality gate if configured
            if configuration.enableQualityGates, var gate = stage.qualityGate {
                try await runQualityGate(&gate, workflow: &workflow, stage: &stage)
                stage.qualityGate = gate
            }

            // Complete stage
            stage.complete()
            workflow.stages[stageIndex] = stage

            stageCompleted.send((workflow.id, stage))
            delegate?.workflowManager(self, didCompleteStage: stage, in: workflow.id)
            log(&workflow, level: .info, message: "阶段完成: \(stage.name)", stageId: stage.id)

            emitProgress(workflow)

        } catch {
            stage.fail(error: error.localizedDescription)
            workflow.stages[stageIndex] = stage
            throw error
        }
    }

    /// Execute a single step
    private func executeStep(_ workflow: inout Workflow, stageIndex: Int, stepIndex: Int) async throws {
        var stage = workflow.stages[stageIndex]
        var step = stage.steps[stepIndex]

        logger.info("[WorkflowManager] Executing step: \(step.name)")

        // Start step
        step.start()
        stage.steps[stepIndex] = step
        workflow.stages[stageIndex] = stage
        emitProgress(workflow)

        log(&workflow, level: .info, message: "开始步骤: \(step.name)", stageId: stage.id, stepId: step.id)

        do {
            // Get executor
            guard let executor = stageExecutors[stage.type] else {
                throw WorkflowError.executionFailed("No executor for stage type: \(stage.type)")
            }

            // Execute
            let result = try await executor.execute(stage: stage, context: workflow.context)

            // Complete step
            step.complete(result: result)
            stage.steps[stepIndex] = step
            stage.updateProgress()
            workflow.stages[stageIndex] = stage

            log(&workflow, level: .info, message: "步骤完成: \(step.name)", stageId: stage.id, stepId: step.id)
            emitProgress(workflow)

        } catch {
            step.fail(error: error.localizedDescription)
            stage.steps[stepIndex] = step
            workflow.stages[stageIndex] = stage

            log(&workflow, level: .error, message: "步骤失败: \(step.name) - \(error.localizedDescription)", stageId: stage.id, stepId: step.id)

            throw error
        }
    }

    // MARK: - Quality Gates

    /// Run quality gate
    private func runQualityGate(_ gate: inout QualityGate, workflow: inout Workflow, stage: inout WorkflowStage) async throws {
        logger.info("[WorkflowManager] Running quality gate: \(gate.name)")

        gate.status = .checking
        gate.startTime = Date()

        log(&workflow, level: .info, message: "开始质量门禁: \(gate.name)", stageId: stage.id)

        // Run all checks
        for (index, _) in gate.checks.enumerated() {
            var check = gate.checks[index]
            check.status = .checking

            // Simulate check (in real impl, would run actual checks)
            try await Task.sleep(nanoseconds: 500_000_000) // 0.5s

            // For demo, pass 80% of checks randomly
            let passed = Double.random(in: 0...1) > 0.2
            if passed {
                check.pass(message: "检查通过")
            } else {
                check.fail(message: "检查未通过")
            }

            gate.checks[index] = check
        }

        gate.endTime = Date()

        // Evaluate result
        if gate.isPassed {
            gate.status = .passed
            delegate?.workflowManager(self, didPassQualityGate: gate, in: workflow.id)
            log(&workflow, level: .info, message: "质量门禁通过: \(gate.name)", stageId: stage.id)
        } else {
            gate.status = .failed
            delegate?.workflowManager(self, didFailQualityGate: gate, in: workflow.id)
            log(&workflow, level: .warning, message: "质量门禁失败: \(gate.name)", stageId: stage.id)

            if gate.isBlocking && configuration.stopOnGateFailure {
                throw WorkflowError.qualityGateFailed(gate.name)
            }
        }
    }

    // MARK: - Control

    /// Pause workflow
    func pause(workflowId: String) {
        guard var workflow = activeWorkflows[workflowId],
              workflow.state.canPause else {
            return
        }

        workflow.state = .paused
        workflow.pausedAt = Date()
        activeWorkflows[workflowId] = workflow

        delegate?.workflowManager(self, didChangeState: .paused, for: workflowId)
        logger.info("[WorkflowManager] Paused workflow: \(workflowId)")
    }

    /// Resume workflow
    func resume(workflowId: String) {
        guard var workflow = activeWorkflows[workflowId],
              workflow.state.canResume else {
            return
        }

        workflow.state = .running
        workflow.pausedAt = nil
        activeWorkflows[workflowId] = workflow

        // Resume continuation
        if let continuation = pauseTokens[workflowId] {
            continuation?.resume()
            pauseTokens[workflowId] = nil
        }

        delegate?.workflowManager(self, didChangeState: .running, for: workflowId)
        logger.info("[WorkflowManager] Resumed workflow: \(workflowId)")
    }

    /// Cancel workflow
    func cancel(workflowId: String) {
        guard var workflow = activeWorkflows[workflowId],
              workflow.state.canCancel else {
            return
        }

        cancellationTokens[workflowId] = true

        // Resume if paused
        if let continuation = pauseTokens[workflowId] {
            continuation?.resume()
            pauseTokens[workflowId] = nil
        }

        workflow.state = .cancelled
        workflow.endTime = Date()
        activeWorkflows.removeValue(forKey: workflowId)
        statistics.recordCancellation()

        delegate?.workflowManager(self, didChangeState: .cancelled, for: workflowId)
        logger.info("[WorkflowManager] Cancelled workflow: \(workflowId)")
    }

    /// Wait for resume
    private func waitForResume(workflowId: String) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            pauseTokens[workflowId] = continuation
        }
    }

    // MARK: - Progress

    private func emitProgress(_ workflow: Workflow) {
        let progress = WorkflowProgress(workflow: workflow)
        progressUpdated.send(progress)
        delegate?.workflowManager(self, didUpdateProgress: progress)
    }

    // MARK: - Logging

    private func log(_ workflow: inout Workflow, level: WorkflowLog.LogLevel, message: String, stageId: String? = nil, stepId: String? = nil) {
        let log = WorkflowLog(
            level: level,
            message: message,
            stageId: stageId,
            stepId: stepId
        )
        workflow.logs.append(log)
    }

    // MARK: - History

    private func loadHistory() {
        if let data = UserDefaults.standard.data(forKey: "workflowHistory"),
           let savedHistory = try? JSONDecoder().decode([Workflow].self, from: data) {
            history = savedHistory
        }
    }

    private func saveHistory() {
        if let data = try? JSONEncoder().encode(history) {
            UserDefaults.standard.set(data, forKey: "workflowHistory")
        }
    }

    /// Clear history
    func clearHistory() {
        history.removeAll()
        saveHistory()
    }

    // MARK: - Query

    /// Get workflow by ID
    func getWorkflow(_ id: String) -> Workflow? {
        return activeWorkflows[id] ?? history.first { $0.id == id }
    }

    /// Get all active workflows
    func getActiveWorkflows() -> [Workflow] {
        return Array(activeWorkflows.values)
    }
}

// MARK: - Default Stage Executor

class DefaultStageExecutor: StageExecutorProtocol {
    func execute(stage: WorkflowStage, context: [String: AnyCodableValue]) async throws -> [String: AnyCodableValue] {
        // Simulate work with random delay
        let delay = Double.random(in: 0.5...2.0)
        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

        return [
            "status": .string("completed"),
            "stage": .string(stage.id),
            "timestamp": .string(ISO8601DateFormatter().string(from: Date()))
        ]
    }
}

// MARK: - Quality Gate Manager

class QualityGateManager {
    private let logger = Logger.shared

    /// Create default quality gate for stage
    func createDefaultGate(for stageType: WorkflowStageType) -> QualityGate {
        var checks: [QualityCheck] = []

        switch stageType {
        case .requirements:
            checks = [
                QualityCheck(name: "需求完整性", checkType: .documentation),
                QualityCheck(name: "需求可行性", checkType: .custom)
            ]
        case .design:
            checks = [
                QualityCheck(name: "架构评审", checkType: .custom),
                QualityCheck(name: "接口规范", checkType: .documentation)
            ]
        case .implementation:
            checks = [
                QualityCheck(name: "代码规范", checkType: .linting),
                QualityCheck(name: "单元测试覆盖率", checkType: .testCoverage)
            ]
        case .testing:
            checks = [
                QualityCheck(name: "测试覆盖率", checkType: .testCoverage),
                QualityCheck(name: "性能基准", checkType: .performance)
            ]
        case .review:
            checks = [
                QualityCheck(name: "代码审查", checkType: .codeQuality),
                QualityCheck(name: "安全扫描", checkType: .securityScan)
            ]
        case .deployment:
            checks = [
                QualityCheck(name: "部署验证", checkType: .custom),
                QualityCheck(name: "健康检查", checkType: .custom)
            ]
        }

        return QualityGate(
            name: "\(stageType.displayName)质量门禁",
            checks: checks,
            passThreshold: 0.8,
            isBlocking: stageType == .deployment
        )
    }
}
