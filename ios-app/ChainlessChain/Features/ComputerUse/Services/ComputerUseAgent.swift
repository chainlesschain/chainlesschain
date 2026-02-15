//
//  ComputerUseAgent.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Main orchestrator integrating all Computer Use capabilities
//  Adapted from: desktop-app-vue/src/main/browser/computer-use-agent.js
//

import Foundation
import WebKit
import Combine

// MARK: - ComputerUseAgent

/// Unified Computer Use agent that orchestrates all sub-modules
public class ComputerUseAgent: ObservableObject {
    public static let shared = ComputerUseAgent()

    // Sub-modules
    private let coordinateAction = CoordinateAction.shared
    private let mobileAction = MobileAction.shared
    private let visionAction = VisionAction.shared
    private let elementHighlighter = ElementHighlighter.shared
    private let networkInterceptor = NetworkInterceptor.shared
    private let screenRecorder = ScreenRecorder.shared
    private let actionReplay = ActionReplay.shared
    private let safeMode = SafeMode.shared
    private let templateActions = TemplateActions.shared
    private let workflowEngine = ComputerUseWorkflowEngine.shared
    private let metrics = ComputerUseMetrics.shared
    private let auditLogger = CUAuditLogger.shared

    // State
    @Published public private(set) var isInitialized: Bool = false
    @Published public var operationMode: CUOperationMode = .auto

    // Execution history
    private var history: [ComputerUseResult] = []
    private let maxHistory = 200
    private let historyQueue = DispatchQueue(label: "com.chainlesschain.cu-history")

    // Retry configuration
    private let maxRetries = 3
    private let retryBaseDelay: UInt64 = 500_000_000 // 500ms in nanoseconds

    // Events
    public let actionExecuted = PassthroughSubject<ComputerUseResult, Never>()

    private init() {
        Logger.shared.info("[ComputerUseAgent] Created")
    }

    // MARK: - Initialize

    /// Initialize the agent and register tools
    public func initialize() {
        guard !isInitialized else { return }

        let sessionId = metrics.startSession()
        auditLogger.setSession(sessionId)

        // Register tools with ToolManager
        ComputerUseToolRegistration.registerAll(agent: self)

        isInitialized = true
        Logger.shared.info("[ComputerUseAgent] Initialized, session: \(sessionId)")
    }

    /// Shutdown the agent
    public func shutdown() {
        metrics.endSession()
        isInitialized = false
        Logger.shared.info("[ComputerUseAgent] Shutdown")
    }

    // MARK: - Execute Action

    /// Execute a Computer Use action with safety checks and retry logic
    @MainActor
    public func execute(
        action: CUActionType,
        params: [String: AnyCodableValue] = [:],
        webView: WKWebView
    ) async throws -> ComputerUseResult {
        // Safety check
        let permission = await safeMode.checkPermission(action: action, params: params)
        if !permission.allowed {
            let reason = permission.reason ?? "Permission denied"
            return .fail(action: action, error: reason)
        }

        // Execute with retry
        var lastResult: ComputerUseResult?
        var attempts = 0

        while attempts <= maxRetries {
            if attempts > 0 {
                let backoff = retryBaseDelay * UInt64(pow(2.0, Double(attempts - 1)))
                try await Task.sleep(nanoseconds: backoff)
                Logger.shared.debug("[ComputerUseAgent] Retry \(attempts) for \(action.rawValue)")
            }

            let result = await performAction(action: action, params: params, webView: webView)
            lastResult = result

            // Record in history
            historyQueue.sync {
                history.append(result)
                if history.count > maxHistory { history.removeFirst() }
            }
            actionExecuted.send(result)

            if result.success { return result }

            attempts += 1
        }

        return lastResult ?? .fail(action: action, error: "Max retries exceeded")
    }

    // MARK: - Action Dispatch

    /// Route action to the appropriate sub-module
    @MainActor
    private func performAction(
        action: CUActionType,
        params: [String: AnyCodableValue],
        webView: WKWebView
    ) async -> ComputerUseResult {
        do {
            switch action {
            // Coordinate actions
            case .click:
                let x = params["x"]?.doubleValue ?? 0
                let y = params["y"]?.doubleValue ?? 0
                return try await coordinateAction.tapAt(x: x, y: y, in: webView)

            case .doubleClick:
                let x = params["x"]?.doubleValue ?? 0
                let y = params["y"]?.doubleValue ?? 0
                return try await coordinateAction.doubleTapAt(x: x, y: y, in: webView)

            case .longPress:
                let x = params["x"]?.doubleValue ?? 0
                let y = params["y"]?.doubleValue ?? 0
                let duration = params["duration"]?.doubleValue ?? 500
                return try await coordinateAction.longPressAt(x: x, y: y, duration: duration, in: webView)

            case .type:
                let text = params["text"]?.stringValue ?? ""
                return try await coordinateAction.typeText(text, in: webView)

            case .key:
                let key = params["key"]?.stringValue ?? ""
                return try await coordinateAction.pressKey(key, in: webView)

            case .scroll:
                let x = params["x"]?.doubleValue ?? 0
                let y = params["y"]?.doubleValue ?? 0
                let dx = params["deltaX"]?.doubleValue ?? 0
                let dy = params["deltaY"]?.doubleValue ?? 0
                return try await coordinateAction.scrollAt(x: x, y: y, deltaX: dx, deltaY: dy, in: webView)

            case .drag:
                let from = CUPoint(
                    x: params["fromX"]?.doubleValue ?? 0,
                    y: params["fromY"]?.doubleValue ?? 0
                )
                let to = CUPoint(
                    x: params["toX"]?.doubleValue ?? 0,
                    y: params["toY"]?.doubleValue ?? 0
                )
                return try await coordinateAction.dragFromTo(from: from, to: to, in: webView)

            case .swipe:
                let gestureStr = params["gesture"]?.stringValue ?? "SWIPE_UP"
                let gesture = CUGestureType(rawValue: gestureStr) ?? .swipeUp
                return try await coordinateAction.gesture(gesture, in: webView)

            case .pinch:
                let gestureStr = params["gesture"]?.stringValue ?? "PINCH_IN"
                let gesture = CUGestureType(rawValue: gestureStr) ?? .pinchIn
                return try await coordinateAction.gesture(gesture, in: webView)

            // Navigation
            case .navigate:
                let url = params["url"]?.stringValue ?? ""
                guard let urlObj = URL(string: url) else {
                    return .fail(action: .navigate, error: "Invalid URL: \(url)")
                }
                webView.load(URLRequest(url: urlObj))
                return .ok(action: .navigate, data: ["url": .string(url)])

            case .wait:
                let ms = params["duration"]?.doubleValue ?? 1000
                try await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
                return .ok(action: .wait, data: ["waited": .double(ms)])

            // Screenshots
            case .screenshot:
                return try await mobileAction.captureWebViewScreenshot(webView: webView)

            case .appScreenshot:
                return try await mobileAction.captureAppScreenshot()

            // Vision actions
            case .visionClick:
                let desc = params["description"]?.stringValue ?? ""
                return try await visionAction.visualTap(description: desc, webView: webView)

            case .visionAnalyze:
                let prompt = params["prompt"]?.stringValue
                return try await visionAction.analyze(webView: webView, prompt: prompt)

            case .visionLocate:
                let desc = params["description"]?.stringValue ?? ""
                return try await visionAction.locateElement(description: desc, webView: webView)

            case .visionDescribe:
                return try await visionAction.describePage(webView: webView)

            // Mobile actions
            case .deviceInfo:
                return mobileAction.getDeviceInfo()

            case .haptic:
                let typeStr = params["type"]?.stringValue ?? "medium"
                let hapticType = CUHapticType(rawValue: typeStr) ?? .medium
                return mobileAction.triggerHaptic(type: hapticType)

            // Network
            case .interceptNetwork:
                try await networkInterceptor.activate(webView: webView)
                return .ok(action: .interceptNetwork, data: ["activated": .bool(true)])

            case .mockResponse:
                let urlPattern = params["urlPattern"]?.stringValue ?? ""
                let body = params["responseBody"]?.stringValue ?? "{}"
                let status = params["status"]?.intValue ?? 200
                networkInterceptor.addMockRule(CUMockRule(
                    urlPattern: urlPattern,
                    responseBody: body,
                    responseStatus: status
                ))
                return .ok(action: .mockResponse, data: ["urlPattern": .string(urlPattern)])
            }
        } catch {
            return .fail(action: action, error: error.localizedDescription)
        }
    }

    // MARK: - History

    /// Get execution history
    public func getHistory(limit: Int = 50) -> [ComputerUseResult] {
        historyQueue.sync { Array(history.suffix(limit)) }
    }

    /// Clear history
    public func clearHistory() {
        historyQueue.sync { history.removeAll() }
    }

    // MARK: - Sub-module Access

    /// Access sub-modules for advanced usage
    public var coordinate: CoordinateAction { coordinateAction }
    public var mobile: MobileAction { mobileAction }
    public var vision: VisionAction { visionAction }
    public var highlighter: ElementHighlighter { elementHighlighter }
    public var network: NetworkInterceptor { networkInterceptor }
    public var recorder: ScreenRecorder { screenRecorder }
    public var replay: ActionReplay { actionReplay }
    public var safety: SafeMode { safeMode }
    public var templates: TemplateActions { templateActions }
    public var workflow: ComputerUseWorkflowEngine { workflowEngine }
    public var metricsCollector: ComputerUseMetrics { metrics }
    public var audit: CUAuditLogger { auditLogger }
}
