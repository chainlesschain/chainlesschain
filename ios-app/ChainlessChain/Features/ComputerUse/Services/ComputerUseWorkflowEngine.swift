//
//  ComputerUseWorkflowEngine.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Workflow engine with conditions, loops, parallel execution
//  Adapted from: desktop-app-vue/src/main/browser/actions/workflow-engine.js
//
//  Note: This is separate from the existing WorkflowManager (project pipelines).
//  This engine is specifically for Computer Use automation workflows.
//

import Foundation
import WebKit
import JavaScriptCore
import Combine

// MARK: - Workflow Definition

/// A complete workflow definition
public struct CUWorkflow: Codable, Identifiable {
    public let id: String
    public var name: String
    public var description: String
    public var steps: [CUWorkflowStep]
    public var variables: [String: AnyCodableValue]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        name: String,
        description: String = "",
        steps: [CUWorkflowStep] = [],
        variables: [String: AnyCodableValue] = [:]
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.steps = steps
        self.variables = variables
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

// MARK: - Workflow Step

/// A single step in a workflow
public struct CUWorkflowStep: Codable, Identifiable {
    public let id: String
    public let type: CUWorkflowStepType
    public var label: String?
    public var config: [String: AnyCodableValue]

    public init(type: CUWorkflowStepType, label: String? = nil, config: [String: AnyCodableValue] = [:]) {
        self.id = UUID().uuidString
        self.type = type
        self.label = label
        self.config = config
    }
}

// MARK: - Workflow Execution Context

/// Context passed through workflow execution
public class CUWorkflowContext {
    public var variables: [String: AnyCodableValue]
    public var results: [String: ComputerUseResult] = [:]
    public var stepIndex: Int = 0

    public init(variables: [String: AnyCodableValue] = [:]) {
        self.variables = variables
    }

    /// Substitute ${var} references in a string
    public func substitute(_ template: String) -> String {
        var result = template
        for (key, value) in variables {
            let replacement: String
            switch value {
            case .string(let s): replacement = s
            case .int(let i): replacement = String(i)
            case .double(let d): replacement = String(d)
            case .bool(let b): replacement = String(b)
            default: replacement = ""
            }
            result = result.replacingOccurrences(of: "${\(key)}", with: replacement)
        }
        return result
    }

    /// Set a variable
    public func set(_ key: String, value: AnyCodableValue) {
        variables[key] = value
    }
}

// MARK: - ComputerUseWorkflowEngine

/// Executes Computer Use workflows with conditions, loops, and parallel steps
public class ComputerUseWorkflowEngine: ObservableObject {
    public static let shared = ComputerUseWorkflowEngine()

    @Published public private(set) var state: CUWorkflowState = .idle
    @Published public private(set) var currentStepIndex: Int = 0
    @Published public private(set) var workflows: [CUWorkflow] = []

    private var currentWorkflow: CUWorkflow?
    private var context: CUWorkflowContext?
    private weak var webView: WKWebView?
    private weak var agent: ComputerUseAgent?

    // Events
    public let stepCompleted = PassthroughSubject<(index: Int, success: Bool), Never>()
    public let workflowCompleted = PassthroughSubject<Bool, Never>()

    // Persistence
    private let storageURL: URL

    // JSContext for script evaluation
    private lazy var jsContext: JSContext = {
        let ctx = JSContext()!
        ctx.exceptionHandler = { _, exception in
            Logger.shared.warning("[WorkflowEngine] JS error: \(exception?.toString() ?? "unknown")")
        }
        return ctx
    }()

    private init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        storageURL = docs.appendingPathComponent(".chainlesschain").appendingPathComponent("workflows")

        do {
            try FileManager.default.createDirectory(at: storageURL, withIntermediateDirectories: true)
        } catch {
            Logger.shared.error("[WorkflowEngine] Failed to create dir: \(error.localizedDescription)")
        }

        loadWorkflows()
        Logger.shared.info("[WorkflowEngine] Initialized with \(workflows.count) workflows")
    }

    // MARK: - Workflow Management

    /// Save a workflow
    public func saveWorkflow(_ workflow: CUWorkflow) {
        if let idx = workflows.firstIndex(where: { $0.id == workflow.id }) {
            workflows[idx] = workflow
        } else {
            workflows.append(workflow)
        }
        persistWorkflow(workflow)
    }

    /// Delete a workflow
    public func deleteWorkflow(id: String) {
        workflows.removeAll { $0.id == id }
        let fileURL = storageURL.appendingPathComponent("\(id).json")
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// Get a workflow by ID
    public func getWorkflow(id: String) -> CUWorkflow? {
        workflows.first { $0.id == id }
    }

    // MARK: - Execution

    /// Run a workflow
    @MainActor
    public func run(
        workflow: CUWorkflow,
        webView: WKWebView,
        agent: ComputerUseAgent,
        variables: [String: AnyCodableValue] = [:]
    ) async throws {
        guard state == .idle || state == .completed || state == .failed else {
            throw CUWorkflowError.alreadyRunning
        }

        currentWorkflow = workflow
        self.webView = webView
        self.agent = agent

        var allVars = workflow.variables
        for (k, v) in variables { allVars[k] = v }
        context = CUWorkflowContext(variables: allVars)

        state = .running
        currentStepIndex = 0

        Logger.shared.info("[WorkflowEngine] Running workflow: \(workflow.name)")

        do {
            try await executeSteps(workflow.steps)
            state = .completed
            workflowCompleted.send(true)
            Logger.shared.info("[WorkflowEngine] Workflow completed: \(workflow.name)")
        } catch {
            state = .failed
            workflowCompleted.send(false)
            Logger.shared.error("[WorkflowEngine] Workflow failed: \(error.localizedDescription)")
            throw error
        }
    }

    /// Pause the running workflow
    public func pause() {
        guard state == .running else { return }
        state = .paused
    }

    /// Resume a paused workflow
    public func resume() {
        guard state == .paused else { return }
        state = .running
    }

    /// Cancel the running workflow
    public func cancel() {
        state = .cancelled
    }

    // MARK: - Step Execution

    @MainActor
    private func executeSteps(_ steps: [CUWorkflowStep]) async throws {
        for (index, step) in steps.enumerated() {
            guard state == .running else {
                if state == .paused {
                    // Wait for resume
                    while state == .paused {
                        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
                    }
                    if state == .cancelled { throw CUWorkflowError.cancelled }
                } else if state == .cancelled {
                    throw CUWorkflowError.cancelled
                } else {
                    break
                }
            }

            currentStepIndex = index

            do {
                try await executeStep(step)
                stepCompleted.send((index: index, success: true))
            } catch {
                stepCompleted.send((index: index, success: false))
                throw error
            }
        }
    }

    @MainActor
    private func executeStep(_ step: CUWorkflowStep) async throws {
        guard let webView = webView, let agent = agent, let context = context else {
            throw CUWorkflowError.notInitialized
        }

        switch step.type {
        case .action:
            try await executeActionStep(step, webView: webView, agent: agent, context: context)

        case .condition:
            try await executeConditionStep(step, webView: webView, context: context)

        case .loop:
            try await executeLoopStep(step, webView: webView, context: context)

        case .wait:
            let ms = step.config["duration"]?.doubleValue ?? 1000
            try await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))

        case .parallel:
            try await executeParallelStep(step, webView: webView, agent: agent, context: context)

        case .subWorkflow:
            try await executeSubWorkflow(step, webView: webView, agent: agent, context: context)

        case .script:
            try executeScriptStep(step, context: context)
        }
    }

    // MARK: - Action Step

    @MainActor
    private func executeActionStep(
        _ step: CUWorkflowStep,
        webView: WKWebView,
        agent: ComputerUseAgent,
        context: CUWorkflowContext
    ) async throws {
        guard let actionStr = step.config["action"]?.stringValue,
              let action = CUActionType(rawValue: actionStr) else {
            throw CUWorkflowError.invalidStep("Missing or invalid action type")
        }

        var params: [String: AnyCodableValue] = [:]
        if case .dictionary(let dict) = step.config["params"] {
            for (k, v) in dict {
                if let s = v.stringValue {
                    params[k] = .string(context.substitute(s))
                } else {
                    params[k] = v
                }
            }
        }

        let result = try await agent.execute(action: action, params: params, webView: webView)
        context.results[step.id] = result

        if !result.success {
            // Check retry config
            let maxRetries = step.config["maxRetries"]?.intValue ?? 0
            if maxRetries > 0 {
                for attempt in 1...maxRetries {
                    let backoff = UInt64(pow(2.0, Double(attempt)) * 500_000_000)
                    try await Task.sleep(nanoseconds: backoff)
                    let retry = try await agent.execute(action: action, params: params, webView: webView)
                    if retry.success {
                        context.results[step.id] = retry
                        return
                    }
                }
            }
            throw CUWorkflowError.stepFailed(step.label ?? step.id, result.error ?? "Unknown error")
        }
    }

    // MARK: - Condition Step

    @MainActor
    private func executeConditionStep(
        _ step: CUWorkflowStep,
        webView: WKWebView,
        context: CUWorkflowContext
    ) async throws {
        guard let conditionExpr = step.config["condition"]?.stringValue else {
            throw CUWorkflowError.invalidStep("Missing condition expression")
        }

        let resolvedExpr = context.substitute(conditionExpr)
        let conditionResult = evaluateExpression(resolvedExpr)

        // Decode then/else branches
        if conditionResult {
            if case .array(let thenSteps) = step.config["then"] {
                let decoded = try decodeSteps(from: thenSteps)
                try await executeSteps(decoded)
            }
        } else {
            if case .array(let elseSteps) = step.config["else"] {
                let decoded = try decodeSteps(from: elseSteps)
                try await executeSteps(decoded)
            }
        }
    }

    // MARK: - Loop Step

    @MainActor
    private func executeLoopStep(
        _ step: CUWorkflowStep,
        webView: WKWebView,
        context: CUWorkflowContext
    ) async throws {
        let loopType = step.config["loopType"]?.stringValue ?? "times"
        let maxIterations = step.config["maxIterations"]?.intValue ?? 100

        guard case .array(let bodyValues) = step.config["body"] else {
            throw CUWorkflowError.invalidStep("Missing loop body")
        }
        let body = try decodeSteps(from: bodyValues)

        switch loopType {
        case "times":
            let count = step.config["count"]?.intValue ?? 1
            for i in 0..<min(count, maxIterations) {
                context.set("__loopIndex", value: .int(i))
                try await executeSteps(body)
            }

        case "while":
            guard let condition = step.config["condition"]?.stringValue else { break }
            var iteration = 0
            while evaluateExpression(context.substitute(condition)) && iteration < maxIterations {
                context.set("__loopIndex", value: .int(iteration))
                try await executeSteps(body)
                iteration += 1
            }

        default:
            throw CUWorkflowError.invalidStep("Unknown loop type: \(loopType)")
        }
    }

    // MARK: - Parallel Step

    @MainActor
    private func executeParallelStep(
        _ step: CUWorkflowStep,
        webView: WKWebView,
        agent: ComputerUseAgent,
        context: CUWorkflowContext
    ) async throws {
        guard case .array(let branchValues) = step.config["branches"] else {
            throw CUWorkflowError.invalidStep("Missing parallel branches")
        }

        // For safety on iOS (single WKWebView), execute "parallel" steps sequentially
        // True parallelism would require multiple web views
        for branchValue in branchValues {
            if case .array(let branchSteps) = branchValue {
                let decoded = try decodeSteps(from: branchSteps)
                try await executeSteps(decoded)
            }
        }
    }

    // MARK: - Sub-Workflow Step

    @MainActor
    private func executeSubWorkflow(
        _ step: CUWorkflowStep,
        webView: WKWebView,
        agent: ComputerUseAgent,
        context: CUWorkflowContext
    ) async throws {
        guard let workflowId = step.config["workflowId"]?.stringValue,
              let subWorkflow = getWorkflow(id: workflowId) else {
            throw CUWorkflowError.invalidStep("Sub-workflow not found")
        }

        // Execute sub-workflow steps directly in current context
        try await executeSteps(subWorkflow.steps)
    }

    // MARK: - Script Step

    private func executeScriptStep(_ step: CUWorkflowStep, context: CUWorkflowContext) throws {
        guard let script = step.config["script"]?.stringValue else {
            throw CUWorkflowError.invalidStep("Missing script")
        }

        let resolvedScript = context.substitute(script)

        // Expose variables to JSContext
        for (key, value) in context.variables {
            switch value {
            case .string(let s): jsContext.setObject(s, forKeyedSubscript: key as NSString)
            case .int(let i): jsContext.setObject(i, forKeyedSubscript: key as NSString)
            case .double(let d): jsContext.setObject(d, forKeyedSubscript: key as NSString)
            case .bool(let b): jsContext.setObject(b, forKeyedSubscript: key as NSString)
            default: break
            }
        }

        let result = jsContext.evaluateScript(resolvedScript)

        // Store result back
        if let resultStr = result?.toString() {
            context.set("__scriptResult", value: .string(resultStr))
        }
    }

    // MARK: - Expression Evaluation

    private func evaluateExpression(_ expr: String) -> Bool {
        let result = jsContext.evaluateScript("Boolean(\(expr))")
        return result?.toBool() ?? false
    }

    // MARK: - Step Decoding

    private func decodeSteps(from values: [AnyCodableValue]) throws -> [CUWorkflowStep] {
        // Convert AnyCodableValue array back to JSON and decode
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let data = try encoder.encode(values)
        return (try? decoder.decode([CUWorkflowStep].self, from: data)) ?? []
    }

    // MARK: - Persistence

    private func persistWorkflow(_ workflow: CUWorkflow) {
        let fileURL = storageURL.appendingPathComponent("\(workflow.id).json")
        do {
            let data = try JSONEncoder().encode(workflow)
            try data.write(to: fileURL)
        } catch {
            Logger.shared.error("[WorkflowEngine] Failed to save workflow: \(error.localizedDescription)")
        }
    }

    private func loadWorkflows() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: storageURL, includingPropertiesForKeys: nil) else { return }

        for file in files where file.pathExtension == "json" {
            if let data = try? Data(contentsOf: file),
               let workflow = try? JSONDecoder().decode(CUWorkflow.self, from: data) {
                workflows.append(workflow)
            }
        }
        workflows.sort { $0.updatedAt > $1.updatedAt }
    }

    /// Total steps in current workflow
    public var totalSteps: Int { currentWorkflow?.steps.count ?? 0 }

    /// Progress percentage
    public var progress: Double {
        let total = totalSteps
        return total > 0 ? Double(currentStepIndex) / Double(total) * 100 : 0
    }
}

// MARK: - Errors

enum CUWorkflowError: LocalizedError {
    case alreadyRunning
    case notInitialized
    case cancelled
    case invalidStep(String)
    case stepFailed(String, String)

    var errorDescription: String? {
        switch self {
        case .alreadyRunning: return "Workflow is already running"
        case .notInitialized: return "Workflow engine not initialized"
        case .cancelled: return "Workflow was cancelled"
        case .invalidStep(let msg): return "Invalid workflow step: \(msg)"
        case .stepFailed(let step, let error): return "Step '\(step)' failed: \(error)"
        }
    }
}
