//
//  ComputerUseToolRegistration.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Registers 12 AI tools with ToolManager
//  Maps desktop tool names to iOS implementations.
//

import Foundation
import WebKit

// MARK: - ComputerUseToolRegistration

/// Registers Computer Use tools with the ToolManager singleton
public enum ComputerUseToolRegistration {

    /// Register all 12 Computer Use tools
    public static func registerAll(agent: ComputerUseAgent) {
        let tools = createToolDefinitions()

        for (tool, executor) in tools {
            ToolManager.shared.register(tool, executor: executor)
        }

        Logger.shared.info("[ComputerUseToolRegistration] Registered \(tools.count) Computer Use tools")
    }

    /// Unregister all Computer Use tools
    public static func unregisterAll() {
        let toolIds = [
            "tool.computer-use.browser_click",
            "tool.computer-use.visual_click",
            "tool.computer-use.browser_type",
            "tool.computer-use.browser_key",
            "tool.computer-use.browser_scroll",
            "tool.computer-use.browser_screenshot",
            "tool.computer-use.analyze_page",
            "tool.computer-use.browser_navigate",
            "tool.computer-use.browser_wait",
            "tool.computer-use.desktop_screenshot",
            "tool.computer-use.desktop_click",
            "tool.computer-use.desktop_type"
        ]

        for id in toolIds {
            ToolManager.shared.unregister(toolId: id)
        }

        Logger.shared.info("[ComputerUseToolRegistration] Unregistered all Computer Use tools")
    }

    // MARK: - Tool Definitions

    private static func createToolDefinitions() -> [(tool: Tool, executor: ToolExecutor)] {
        return [
            browserClickTool(),
            visualClickTool(),
            browserTypeTool(),
            browserKeyTool(),
            browserScrollTool(),
            browserScreenshotTool(),
            analyzePageTool(),
            browserNavigateTool(),
            browserWaitTool(),
            desktopScreenshotTool(),
            desktopClickTool(),
            desktopTypeTool()
        ]
    }

    // MARK: - 1. browser_click

    private static func browserClickTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_click",
            name: "browser_click",
            description: "Click at coordinates in the browser. Dispatches tap/click events at (x, y).",
            category: .general,
            parameters: [
                ToolParameter(name: "x", type: .number, description: "X coordinate", required: true),
                ToolParameter(name: "y", type: .number, description: "Y coordinate", required: true)
            ],
            returnType: .object,
            returnDescription: "Click result with element info",
            tags: ["computer-use", "browser", "click"]
        )

        let executor: ToolExecutor = { input in
            let x = input.getDouble("x") ?? 0
            let y = input.getDouble("y") ?? 0

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .click,
                params: ["x": .double(x), "y": .double(y)],
                webView: webView
            )
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "Click failed")
        }

        return (tool, executor)
    }

    // MARK: - 2. visual_click

    private static func visualClickTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.visual_click",
            name: "visual_click",
            description: "Click an element by its visual description using AI vision.",
            category: .general,
            parameters: [
                ToolParameter(name: "description", type: .string, description: "Visual description of the element to click", required: true)
            ],
            returnType: .object,
            returnDescription: "Click result with located coordinates and confidence",
            tags: ["computer-use", "vision", "click"]
        )

        let executor: ToolExecutor = { input in
            let description = input.getString("description") ?? ""

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .visionClick,
                params: ["description": .string(description)],
                webView: webView
            )
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "Visual click failed")
        }

        return (tool, executor)
    }

    // MARK: - 3. browser_type

    private static func browserTypeTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_type",
            name: "browser_type",
            description: "Type text into the currently focused element in the browser.",
            category: .general,
            parameters: [
                ToolParameter(name: "text", type: .string, description: "Text to type", required: true)
            ],
            returnType: .object,
            returnDescription: "Type result",
            tags: ["computer-use", "browser", "type", "input"]
        )

        let executor: ToolExecutor = { input in
            let text = input.getString("text") ?? ""

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .type,
                params: ["text": .string(text)],
                webView: webView
            )
            return result.success
                ? .success(data: ["typed": text.count])
                : .failure(error: result.error ?? "Type failed")
        }

        return (tool, executor)
    }

    // MARK: - 4. browser_key

    private static func browserKeyTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_key",
            name: "browser_key",
            description: "Press a keyboard key (Enter, Tab, Escape, etc.).",
            category: .general,
            parameters: [
                ToolParameter(name: "key", type: .string, description: "Key name (Enter, Tab, Escape, etc.)", required: true)
            ],
            returnType: .object,
            returnDescription: "Key press result",
            tags: ["computer-use", "browser", "key"]
        )

        let executor: ToolExecutor = { input in
            let key = input.getString("key") ?? ""

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .key,
                params: ["key": .string(key)],
                webView: webView
            )
            return result.success
                ? .success(data: ["key": key])
                : .failure(error: result.error ?? "Key press failed")
        }

        return (tool, executor)
    }

    // MARK: - 5. browser_scroll

    private static func browserScrollTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_scroll",
            name: "browser_scroll",
            description: "Scroll the page at specified coordinates.",
            category: .general,
            parameters: [
                ToolParameter(name: "x", type: .number, description: "X coordinate", required: false, defaultValue: "0"),
                ToolParameter(name: "y", type: .number, description: "Y coordinate", required: false, defaultValue: "0"),
                ToolParameter(name: "deltaX", type: .number, description: "Horizontal scroll amount", required: false, defaultValue: "0"),
                ToolParameter(name: "deltaY", type: .number, description: "Vertical scroll amount", required: true)
            ],
            returnType: .object,
            returnDescription: "Scroll result",
            tags: ["computer-use", "browser", "scroll"]
        )

        let executor: ToolExecutor = { input in
            let x = input.getDouble("x") ?? 0
            let y = input.getDouble("y") ?? 0
            let dx = input.getDouble("deltaX") ?? 0
            let dy = input.getDouble("deltaY") ?? 0

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .scroll,
                params: ["x": .double(x), "y": .double(y), "deltaX": .double(dx), "deltaY": .double(dy)],
                webView: webView
            )
            return result.success
                ? .success(data: ["scrolled": true])
                : .failure(error: result.error ?? "Scroll failed")
        }

        return (tool, executor)
    }

    // MARK: - 6. browser_screenshot

    private static func browserScreenshotTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_screenshot",
            name: "browser_screenshot",
            description: "Capture a screenshot of the current browser page.",
            category: .general,
            parameters: [],
            returnType: .object,
            returnDescription: "Screenshot as base64 JPEG with dimensions",
            tags: ["computer-use", "browser", "screenshot"]
        )

        let executor: ToolExecutor = { _ in
            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .screenshot,
                webView: webView
            )
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "Screenshot failed")
        }

        return (tool, executor)
    }

    // MARK: - 7. analyze_page

    private static func analyzePageTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.analyze_page",
            name: "analyze_page",
            description: "Analyze the current page using AI vision (OCR + LLM multimodal).",
            category: .general,
            parameters: [
                ToolParameter(name: "prompt", type: .string, description: "Analysis prompt", required: false)
            ],
            returnType: .object,
            returnDescription: "Page analysis with OCR text and AI description",
            tags: ["computer-use", "vision", "analyze"]
        )

        let executor: ToolExecutor = { input in
            let prompt = input.getString("prompt")

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            var params: [String: AnyCodableValue] = [:]
            if let prompt = prompt { params["prompt"] = .string(prompt) }

            let result = try await ComputerUseAgent.shared.execute(
                action: .visionAnalyze,
                params: params,
                webView: webView
            )
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "Analysis failed")
        }

        return (tool, executor)
    }

    // MARK: - 8. browser_navigate

    private static func browserNavigateTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_navigate",
            name: "browser_navigate",
            description: "Navigate the browser to a URL.",
            category: .general,
            parameters: [
                ToolParameter(name: "url", type: .string, description: "URL to navigate to", required: true)
            ],
            returnType: .object,
            returnDescription: "Navigation result",
            tags: ["computer-use", "browser", "navigate"]
        )

        let executor: ToolExecutor = { input in
            let url = input.getString("url") ?? ""

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .navigate,
                params: ["url": .string(url)],
                webView: webView
            )
            return result.success
                ? .success(data: ["url": url])
                : .failure(error: result.error ?? "Navigation failed")
        }

        return (tool, executor)
    }

    // MARK: - 9. browser_wait

    private static func browserWaitTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.browser_wait",
            name: "browser_wait",
            description: "Wait for a specified duration (milliseconds).",
            category: .general,
            parameters: [
                ToolParameter(name: "duration", type: .number, description: "Wait time in milliseconds", required: true)
            ],
            returnType: .object,
            returnDescription: "Wait completion",
            tags: ["computer-use", "browser", "wait"]
        )

        let executor: ToolExecutor = { input in
            let duration = input.getDouble("duration") ?? 1000

            let result = try await ComputerUseAgent.shared.execute(
                action: .wait,
                params: ["duration": .double(duration)],
                webView: await ComputerUseToolRegistration.getActiveWebView()!
            )
            return result.success
                ? .success(data: ["waited": duration])
                : .failure(error: result.error ?? "Wait failed")
        }

        return (tool, executor)
    }

    // MARK: - 10. desktop_screenshot (mapped to app screenshot on iOS)

    private static func desktopScreenshotTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.desktop_screenshot",
            name: "desktop_screenshot",
            description: "Capture a screenshot of the entire app (app-level on iOS).",
            category: .general,
            parameters: [],
            returnType: .object,
            returnDescription: "App screenshot as base64 JPEG",
            tags: ["computer-use", "mobile", "screenshot"]
        )

        let executor: ToolExecutor = { _ in
            let result = try await MobileAction.shared.captureAppScreenshot()
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "App screenshot failed")
        }

        return (tool, executor)
    }

    // MARK: - 11. desktop_click (mapped to browser click on iOS)

    private static func desktopClickTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.desktop_click",
            name: "desktop_click",
            description: "Click at coordinates (executes within WKWebView on iOS).",
            category: .general,
            parameters: [
                ToolParameter(name: "x", type: .number, description: "X coordinate", required: true),
                ToolParameter(name: "y", type: .number, description: "Y coordinate", required: true)
            ],
            returnType: .object,
            returnDescription: "Click result",
            tags: ["computer-use", "mobile", "click"]
        )

        let executor: ToolExecutor = { input in
            let x = input.getDouble("x") ?? 0
            let y = input.getDouble("y") ?? 0

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .click,
                params: ["x": .double(x), "y": .double(y)],
                webView: webView
            )
            return result.success
                ? .success(data: result.data?.mapValues { $0.toAny() } ?? [:])
                : .failure(error: result.error ?? "Click failed")
        }

        return (tool, executor)
    }

    // MARK: - 12. desktop_type (mapped to browser type on iOS)

    private static func desktopTypeTool() -> (tool: Tool, executor: ToolExecutor) {
        let tool = Tool(
            id: "tool.computer-use.desktop_type",
            name: "desktop_type",
            description: "Type text (executes within focused WKWebView element on iOS).",
            category: .general,
            parameters: [
                ToolParameter(name: "text", type: .string, description: "Text to type", required: true)
            ],
            returnType: .object,
            returnDescription: "Type result",
            tags: ["computer-use", "mobile", "type"]
        )

        let executor: ToolExecutor = { input in
            let text = input.getString("text") ?? ""

            guard let webView = await ComputerUseToolRegistration.getActiveWebView() else {
                return .failure(error: "No active WebView")
            }

            let result = try await ComputerUseAgent.shared.execute(
                action: .type,
                params: ["text": .string(text)],
                webView: webView
            )
            return result.success
                ? .success(data: ["typed": text.count])
                : .failure(error: result.error ?? "Type failed")
        }

        return (tool, executor)
    }

    // MARK: - Active WebView Helper

    /// Get the currently active WKWebView from the ViewModel
    @MainActor
    static func getActiveWebView() -> WKWebView? {
        return ComputerUseViewModel.shared.webView
    }
}

// MARK: - AnyCodableValue Conversion Helper

extension AnyCodableValue {
    /// Convert to Any for ToolOutput compatibility
    func toAny() -> Any {
        switch self {
        case .string(let v): return v
        case .int(let v): return v
        case .double(let v): return v
        case .bool(let v): return v
        case .array(let v): return v.map { $0.toAny() }
        case .dictionary(let v): return v.mapValues { $0.toAny() }
        case .null: return NSNull()
        }
    }
}
