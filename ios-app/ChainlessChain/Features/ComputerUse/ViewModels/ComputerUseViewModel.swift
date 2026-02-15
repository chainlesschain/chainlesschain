//
//  ComputerUseViewModel.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - ViewModel binding agent state to UI
//

import Foundation
import WebKit
import Combine
import SwiftUI

// MARK: - ComputerUseViewModel

/// ViewModel connecting ComputerUseAgent to SwiftUI views
@MainActor
public class ComputerUseViewModel: ObservableObject {
    public static let shared = ComputerUseViewModel()

    // Agent reference
    private let agent = ComputerUseAgent.shared

    // WebView managed by the browser view
    @Published public var webView: WKWebView?
    @Published public var currentURL: String = ""
    @Published public var pageTitle: String = ""
    @Published public var isLoading: Bool = false

    // UI State
    @Published public var selectedTab: Int = 0
    @Published public var isInitialized: Bool = false
    @Published public var lastResult: ComputerUseResult?
    @Published public var errorMessage: String?
    @Published public var showingError: Bool = false

    // Mode
    @Published public var operationMode: CUOperationMode = .auto
    @Published public var safetyLevel: CUSafetyLevel = .normal

    // Recording state
    @Published public var isRecording: Bool = false
    @Published public var recordingFrameCount: Int = 0

    // Metrics
    @Published public var totalOperations: Int = 0
    @Published public var successRate: Double = 0

    private var cancellables = Set<AnyCancellable>()

    private init() {
        setupBindings()
    }

    // MARK: - Setup

    private func setupBindings() {
        // Listen for action events
        agent.actionExecuted
            .receive(on: DispatchQueue.main)
            .sink { [weak self] result in
                self?.lastResult = result
                self?.updateMetrics()
                if !result.success {
                    self?.errorMessage = result.error
                    self?.showingError = true
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Initialize

    /// Initialize the Computer Use system
    public func initialize() {
        agent.initialize()
        isInitialized = true
    }

    /// Shutdown
    public func shutdown() {
        agent.shutdown()
        isInitialized = false
    }

    // MARK: - Actions

    /// Execute an action
    public func executeAction(_ action: CUActionType, params: [String: AnyCodableValue] = [:]) async {
        guard let webView = webView else {
            errorMessage = "No active WebView"
            showingError = true
            return
        }

        do {
            lastResult = try await agent.execute(action: action, params: params, webView: webView)
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    /// Navigate to URL
    public func navigateTo(_ urlString: String) async {
        var url = urlString
        if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
            if url.contains(".") {
                url = "https://\(url)"
            } else {
                let encoded = url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                url = "https://www.google.com/search?q=\(encoded)"
            }
        }
        currentURL = url
        await executeAction(.navigate, params: ["url": .string(url)])
    }

    /// Take a screenshot
    public func takeScreenshot() async -> String? {
        guard let webView = webView else { return nil }
        do {
            let result = try await agent.execute(action: .screenshot, webView: webView)
            return result.data?["base64"]?.stringValue
        } catch {
            return nil
        }
    }

    /// Tap at coordinates
    public func tapAt(x: Double, y: Double) async {
        await executeAction(.click, params: ["x": .double(x), "y": .double(y)])
    }

    /// Visual tap by description
    public func visualTap(description: String) async {
        await executeAction(.visionClick, params: ["description": .string(description)])
    }

    /// Analyze page
    public func analyzePage(prompt: String? = nil) async -> String? {
        var params: [String: AnyCodableValue] = [:]
        if let prompt = prompt { params["prompt"] = .string(prompt) }
        await executeAction(.visionAnalyze, params: params)
        return lastResult?.data?["analysis"]?.stringValue
    }

    // MARK: - Recording

    /// Toggle recording
    public func toggleRecording() {
        guard let webView = webView else { return }

        if isRecording {
            agent.recorder.stopRecording()
            isRecording = false
        } else {
            do {
                try agent.recorder.startRecording(webView: webView)
                isRecording = true
            } catch {
                errorMessage = error.localizedDescription
                showingError = true
            }
        }
    }

    // MARK: - Safety

    /// Update safety level
    public func setSafetyLevel(_ level: CUSafetyLevel) {
        safetyLevel = level
        agent.safety.setLevel(level)
    }

    // MARK: - Metrics

    private func updateMetrics() {
        let summary = agent.metricsCollector.getSummary()
        totalOperations = summary["totalOperations"] as? Int ?? 0
        successRate = summary["successRate"] as? Double ?? 0
    }

    /// Get history
    public var history: [ComputerUseResult] {
        agent.getHistory()
    }

    /// Get audit entries
    public var auditEntries: [CUAuditEntry] {
        agent.audit.entries
    }
}
