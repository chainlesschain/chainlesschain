//
//  ActionReplay.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Action replay engine with breakpoint support
//  Adapted from: desktop-app-vue/src/main/browser/actions/action-replay.js
//

import Foundation
import WebKit
import Combine

// MARK: - Replay Action

/// A recorded action to be replayed
public struct CUReplayAction: Codable, Identifiable {
    public let id: String
    public let index: Int
    public let type: CUActionType
    public let params: [String: AnyCodableValue]
    public let delay: Double // ms before this action

    public init(index: Int, type: CUActionType, params: [String: AnyCodableValue], delay: Double = 500) {
        self.id = UUID().uuidString
        self.index = index
        self.type = type
        self.params = params
        self.delay = delay
    }
}

// MARK: - Replay Result

/// Result of replaying a single action
public struct CUReplayActionResult: Codable {
    public let actionIndex: Int
    public let success: Bool
    public let error: String?
    public let duration: Double
}

// MARK: - Action Executor

/// Closure type for executing a replay action
public typealias CUActionExecutor = (CUReplayAction, WKWebView) async throws -> ComputerUseResult

// MARK: - ActionReplay

/// Replays recorded action sequences with speed control and breakpoints
public class ActionReplay: ObservableObject {
    public static let shared = ActionReplay()

    @Published public private(set) var state: CUReplayState = .idle
    @Published public private(set) var currentIndex: Int = 0
    @Published public private(set) var mode: CUReplayMode = .normal
    @Published public private(set) var results: [CUReplayActionResult] = []

    private var actions: [CUReplayAction] = []
    private var breakpoints: Set<Int> = []
    private var executors: [CUActionType: CUActionExecutor] = [:]
    private weak var webView: WKWebView?

    // Continuation for step-by-step mode
    private var stepContinuation: CheckedContinuation<Void, Never>?

    // Event publisher
    public let actionCompleted = PassthroughSubject<CUReplayActionResult, Never>()
    public let replayCompleted = PassthroughSubject<[CUReplayActionResult], Never>()

    private init() {
        registerDefaultExecutors()
        Logger.shared.info("[ActionReplay] Initialized")
    }

    // MARK: - Register Executors

    /// Register an executor for an action type
    public func registerExecutor(for type: CUActionType, executor: @escaping CUActionExecutor) {
        executors[type] = executor
    }

    /// Register all default executors using CoordinateAction and MobileAction
    private func registerDefaultExecutors() {
        let coordinate = CoordinateAction.shared
        let mobile = MobileAction.shared

        registerExecutor(for: .click) { action, webView in
            let x = action.params["x"]?.doubleValue ?? 0
            let y = action.params["y"]?.doubleValue ?? 0
            return try await coordinate.tapAt(x: x, y: y, in: webView)
        }

        registerExecutor(for: .doubleClick) { action, webView in
            let x = action.params["x"]?.doubleValue ?? 0
            let y = action.params["y"]?.doubleValue ?? 0
            return try await coordinate.doubleTapAt(x: x, y: y, in: webView)
        }

        registerExecutor(for: .type) { action, webView in
            let text = action.params["text"]?.stringValue ?? ""
            return try await coordinate.typeText(text, in: webView)
        }

        registerExecutor(for: .key) { action, webView in
            let key = action.params["key"]?.stringValue ?? ""
            return try await coordinate.pressKey(key, in: webView)
        }

        registerExecutor(for: .scroll) { action, webView in
            let x = action.params["x"]?.doubleValue ?? 0
            let y = action.params["y"]?.doubleValue ?? 0
            let dx = action.params["deltaX"]?.doubleValue ?? 0
            let dy = action.params["deltaY"]?.doubleValue ?? 0
            return try await coordinate.scrollAt(x: x, y: y, deltaX: dx, deltaY: dy, in: webView)
        }

        registerExecutor(for: .navigate) { action, webView in
            let url = action.params["url"]?.stringValue ?? ""
            guard let urlObj = URL(string: url) else {
                return .fail(action: .navigate, error: "Invalid URL: \(url)")
            }
            await MainActor.run { webView.load(URLRequest(url: urlObj)) }
            return .ok(action: .navigate, data: ["url": .string(url)])
        }

        registerExecutor(for: .screenshot) { _, webView in
            return try await mobile.captureWebViewScreenshot(webView: webView)
        }

        registerExecutor(for: .wait) { action, _ in
            let ms = action.params["duration"]?.doubleValue ?? 1000
            try await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
            return .ok(action: .wait, data: ["waited": .double(ms)])
        }

        registerExecutor(for: .visionClick) { action, webView in
            let desc = action.params["description"]?.stringValue ?? ""
            return try await VisionAction.shared.visualTap(description: desc, webView: webView)
        }
    }

    // MARK: - Load Actions

    /// Load an action sequence for replay
    public func load(actions: [CUReplayAction]) {
        self.actions = actions
        self.currentIndex = 0
        self.results = []
        self.state = .idle
        Logger.shared.info("[ActionReplay] Loaded \(actions.count) actions")
    }

    /// Load from JSON data
    public func loadFromJSON(_ data: Data) throws {
        let decoded = try JSONDecoder().decode([CUReplayAction].self, from: data)
        load(actions: decoded)
    }

    // MARK: - Playback Control

    /// Start or resume replay
    @MainActor
    public func play(webView: WKWebView, mode: CUReplayMode = .normal) async {
        guard !actions.isEmpty else { return }

        self.webView = webView
        self.mode = mode
        self.state = .playing

        Logger.shared.info("[ActionReplay] Playing from index \(currentIndex), mode: \(mode.rawValue)")

        while currentIndex < actions.count && state == .playing {
            let action = actions[currentIndex]

            // Check breakpoint
            if breakpoints.contains(currentIndex) && mode != .stepByStep {
                state = .paused
                Logger.shared.info("[ActionReplay] Hit breakpoint at index \(currentIndex)")
                break
            }

            // Apply delay (adjusted by speed)
            if action.delay > 0 && mode != .instant {
                let adjustedDelay = action.delay / mode.speedMultiplier
                try? await Task.sleep(nanoseconds: UInt64(adjustedDelay * 1_000_000))
            }

            // Execute the action
            let result = await executeAction(action, webView: webView)
            results.append(result)
            actionCompleted.send(result)

            if !result.success {
                state = .error
                Logger.shared.error("[ActionReplay] Action failed at index \(currentIndex): \(result.error ?? "")")
                break
            }

            currentIndex += 1

            // Step-by-step: wait for next step signal
            if mode == .stepByStep && currentIndex < actions.count {
                state = .stepping
                await withCheckedContinuation { continuation in
                    stepContinuation = continuation
                }
                if state != .playing { break }
            }
        }

        if currentIndex >= actions.count && state == .playing {
            state = .completed
            replayCompleted.send(results)
            Logger.shared.info("[ActionReplay] Replay completed: \(results.count) actions")
        }
    }

    /// Pause replay
    public func pause() {
        guard state == .playing else { return }
        state = .paused
    }

    /// Resume from pause
    @MainActor
    public func resume() async {
        guard state == .paused || state == .stepping, let webView = webView else { return }
        state = .playing

        if let cont = stepContinuation {
            stepContinuation = nil
            cont.resume()
        } else {
            await play(webView: webView, mode: mode)
        }
    }

    /// Step to next action (step-by-step mode)
    public func stepNext() {
        guard state == .stepping else { return }
        state = .playing
        stepContinuation?.resume()
        stepContinuation = nil
    }

    /// Stop replay
    public func stop() {
        state = .idle
        stepContinuation?.resume()
        stepContinuation = nil
    }

    /// Jump to a specific index
    public func jumpTo(index: Int) {
        guard index >= 0 && index < actions.count else { return }
        currentIndex = index
    }

    // MARK: - Breakpoints

    /// Toggle a breakpoint at an index
    public func toggleBreakpoint(at index: Int) {
        if breakpoints.contains(index) {
            breakpoints.remove(index)
        } else {
            breakpoints.insert(index)
        }
    }

    /// Get all breakpoints
    public func getBreakpoints() -> Set<Int> { breakpoints }

    /// Clear all breakpoints
    public func clearBreakpoints() { breakpoints.removeAll() }

    // MARK: - Execute

    private func executeAction(_ action: CUReplayAction, webView: WKWebView) async -> CUReplayActionResult {
        let start = Date()

        guard let executor = executors[action.type] else {
            return CUReplayActionResult(
                actionIndex: action.index,
                success: false,
                error: "No executor for action type: \(action.type.rawValue)",
                duration: 0
            )
        }

        do {
            let result = try await executor(action, webView)
            let duration = Date().timeIntervalSince(start) * 1000
            return CUReplayActionResult(
                actionIndex: action.index,
                success: result.success,
                error: result.error,
                duration: duration
            )
        } catch {
            let duration = Date().timeIntervalSince(start) * 1000
            return CUReplayActionResult(
                actionIndex: action.index,
                success: false,
                error: error.localizedDescription,
                duration: duration
            )
        }
    }

    // MARK: - Export

    /// Export actions as JSON
    public func exportActions() -> Data? {
        try? JSONEncoder().encode(actions)
    }

    /// Export results as JSON
    public func exportResults() -> Data? {
        try? JSONEncoder().encode(results)
    }

    /// Total actions count
    public var totalActions: Int { actions.count }

    /// Progress percentage
    public var progress: Double {
        actions.isEmpty ? 0 : Double(currentIndex) / Double(actions.count) * 100
    }
}
