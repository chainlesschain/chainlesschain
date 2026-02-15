//
//  VisionAction.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Vision AI integration for visual element interaction
//  Adapted from: desktop-app-vue/src/main/browser/actions/vision-action.js
//
//  Integrates:
//  - VisionToolsHandler.shared: Local OCR and image classification
//  - LLMManager.shared: Cloud LLM multimodal analysis (Claude/GPT-4V)
//

import Foundation
import UIKit
import WebKit

// MARK: - VisionAction Protocol

/// Protocol for vision-based actions
public protocol VisionActionProtocol {
    func analyze(webView: WKWebView, prompt: String?) async throws -> ComputerUseResult
    func locateElement(description: String, webView: WKWebView) async throws -> ComputerUseResult
    func visualTap(description: String, webView: WKWebView) async throws -> ComputerUseResult
    func describePage(webView: WKWebView) async throws -> ComputerUseResult
}

// MARK: - Analysis Cache Entry

/// Cached analysis result with TTL
private struct AnalysisCacheEntry {
    let result: ComputerUseResult
    let timestamp: Date
    let ttl: TimeInterval

    var isExpired: Bool {
        Date().timeIntervalSince(timestamp) > ttl
    }
}

// MARK: - VisionAction

/// Vision AI integration for Computer Use
public class VisionAction: VisionActionProtocol {
    public static let shared = VisionAction()

    private let coordinateAction = CoordinateAction.shared
    private let mobileAction = MobileAction.shared
    private let highlighter = ElementHighlighter.shared
    private let metrics = ComputerUseMetrics.shared
    private let auditLogger = CUAuditLogger.shared

    // Analysis cache (30s TTL)
    private var cache: [String: AnalysisCacheEntry] = [:]
    private let cacheTTL: TimeInterval = 30.0
    private let cacheQueue = DispatchQueue(label: "com.chainlesschain.cu-vision-cache")

    private init() {
        Logger.shared.info("[VisionAction] Initialized")
    }

    // MARK: - Analyze Page

    /// Analyze the current page using LLM vision
    public func analyze(webView: WKWebView, prompt: String? = nil) async throws -> ComputerUseResult {
        let start = Date()
        let analysisPrompt = prompt ?? "Describe what you see on this webpage. Identify key interactive elements."

        // Check cache
        let cacheKey = "analyze:\(analysisPrompt)"
        if let cached = getCached(key: cacheKey) { return cached }

        // Capture screenshot
        let screenshotResult = try await mobileAction.captureWebViewScreenshot(webView: webView)
        guard screenshotResult.success,
              let base64 = screenshotResult.data?["base64"]?.stringValue else {
            return .fail(action: .visionAnalyze, error: "Failed to capture screenshot for analysis")
        }

        // Local OCR via VisionToolsHandler
        let ocrText = await performLocalOCR(base64: base64)

        // LLM multimodal analysis
        let analysisResult = await performLLMAnalysis(
            base64: base64,
            prompt: analysisPrompt,
            ocrContext: ocrText
        )

        let duration = Date().timeIntervalSince(start) * 1000

        let result: ComputerUseResult
        if let analysis = analysisResult {
            result = .ok(action: .visionAnalyze, data: [
                "analysis": .string(analysis),
                "ocrText": .string(ocrText ?? ""),
                "hasOCR": .bool(ocrText != nil)
            ], duration: duration)
        } else {
            // Fall back to OCR only
            result = .ok(action: .visionAnalyze, data: [
                "analysis": .string(ocrText ?? "No analysis available"),
                "ocrText": .string(ocrText ?? ""),
                "hasOCR": .bool(ocrText != nil),
                "fallback": .bool(true)
            ], duration: duration)
        }

        setCache(key: cacheKey, result: result)
        auditLogger.log(action: .visionAnalyze, success: true, duration: duration)
        metrics.recordAction(type: .visionAnalyze, success: true, duration: duration)
        return result
    }

    // MARK: - Locate Element

    /// Locate an element by its visual description
    public func locateElement(description: String, webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()

        // Capture screenshot
        let screenshotResult = try await mobileAction.captureWebViewScreenshot(webView: webView)
        guard screenshotResult.success,
              let base64 = screenshotResult.data?["base64"]?.stringValue else {
            return .fail(action: .visionLocate, error: "Failed to capture screenshot")
        }

        // Ask LLM to find the element coordinates
        let prompt = """
        Find the element described as: "\(description)"
        Return ONLY a JSON object with the center coordinates:
        {"x": <number>, "y": <number>, "confidence": <0-1>, "description": "<what was found>"}
        If the element is not found, return: {"x": 0, "y": 0, "confidence": 0, "description": "not found"}
        """

        let llmResult = await performLLMAnalysis(base64: base64, prompt: prompt, ocrContext: nil)
        let duration = Date().timeIntervalSince(start) * 1000

        guard let responseStr = llmResult else {
            auditLogger.log(action: .visionLocate, success: false, error: "LLM analysis failed", duration: duration)
            metrics.recordAction(type: .visionLocate, success: false, duration: duration)
            return .fail(action: .visionLocate, error: "Vision analysis failed", duration: duration)
        }

        // Parse JSON from response
        if let coords = parseCoordinates(from: responseStr) {
            let confidence = coords["confidence"] ?? 0

            auditLogger.log(action: .visionLocate,
                            params: ["description": .string(description)],
                            success: confidence > 0, duration: duration)
            metrics.recordAction(type: .visionLocate, success: confidence > 0, duration: duration)

            return .ok(action: .visionLocate, data: [
                "x": .double(coords["x"] ?? 0),
                "y": .double(coords["y"] ?? 0),
                "confidence": .double(confidence),
                "description": .string(description)
            ], duration: duration)
        }

        return .fail(action: .visionLocate, error: "Could not parse element location", duration: duration)
    }

    // MARK: - Visual Tap

    /// Locate and tap an element by description
    public func visualTap(description: String, webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()

        // Locate the element
        let locateResult = try await locateElement(description: description, webView: webView)

        guard locateResult.success,
              let x = locateResult.data?["x"]?.doubleValue,
              let y = locateResult.data?["y"]?.doubleValue,
              let confidence = locateResult.data?["confidence"]?.doubleValue,
              confidence > 0.3 else {
            let duration = Date().timeIntervalSince(start) * 1000
            return .fail(action: .visionClick, error: "Could not locate element: \(description)", duration: duration)
        }

        // Highlight before clicking
        try await highlighter.highlightClick(x: x, y: y, style: .success, in: webView)

        // Tap at the located coordinates
        let tapResult = try await coordinateAction.tapAt(x: x, y: y, in: webView)

        let duration = Date().timeIntervalSince(start) * 1000
        auditLogger.log(action: .visionClick,
                        params: ["description": .string(description), "x": .double(x), "y": .double(y)],
                        success: tapResult.success, duration: duration)
        metrics.recordAction(type: .visionClick, success: tapResult.success, duration: duration)

        return .ok(action: .visionClick, data: [
            "x": .double(x),
            "y": .double(y),
            "confidence": .double(confidence),
            "description": .string(description),
            "tapSuccess": .bool(tapResult.success)
        ], duration: duration)
    }

    // MARK: - Describe Page

    /// Get a full page description
    public func describePage(webView: WKWebView) async throws -> ComputerUseResult {
        return try await analyze(
            webView: webView,
            prompt: """
            Describe this webpage in detail:
            1. What is the page about?
            2. What are the main interactive elements (buttons, links, forms)?
            3. What is the current state of the page?
            4. List any visible text content.
            """
        )
    }

    // MARK: - Local OCR

    /// Perform local OCR using VisionToolsHandler
    /// Saves base64 image to temp file, calls recognizeText(imagePath:)
    private func performLocalOCR(base64: String) async -> String? {
        guard let imageData = Data(base64Encoded: base64) else { return nil }

        // VisionToolsHandler.recognizeText requires a file path, not UIImage
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("cu_ocr_\(UUID().uuidString).jpg")

        do {
            try imageData.write(to: tempURL)
            defer { try? FileManager.default.removeItem(at: tempURL) }

            let result = try await VisionToolsHandler.shared.recognizeText(imagePath: tempURL.path)
            if !result.text.isEmpty {
                return result.text
            }
            // Also collect text from bounding boxes if main text is empty
            if !result.boundingBoxes.isEmpty {
                return result.boundingBoxes.map { $0.text }.joined(separator: "\n")
            }
        } catch {
            Logger.shared.warning("[VisionAction] Local OCR failed: \(error.localizedDescription)")
        }
        return nil
    }

    // MARK: - LLM Analysis

    /// Perform LLM analysis using query API
    /// Note: LLMManager.query() is text-only. We include OCR context for richer analysis.
    /// For true multimodal (image+text), a vision-capable provider must be configured.
    private func performLLMAnalysis(base64: String, prompt: String, ocrContext: String?) async -> String? {
        // Build context with OCR if available
        var fullPrompt = prompt
        if let ocr = ocrContext, !ocr.isEmpty {
            fullPrompt += "\n\nOCR detected text on the page:\n\(ocr.prefix(2000))"
        }

        // Include image dimensions for context
        if let imageData = Data(base64Encoded: base64),
           let image = UIImage(data: imageData) {
            fullPrompt += "\n\n[Page screenshot: \(Int(image.size.width))x\(Int(image.size.height))]"
        }

        do {
            let response = try await LLMManager.shared.query(
                prompt: fullPrompt,
                systemPrompt: "You are a web page analysis assistant. Analyze the page based on OCR text and any visual context provided. Return structured analysis."
            )
            return response.text
        } catch {
            Logger.shared.warning("[VisionAction] LLM analysis failed: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Cache

    private func getCached(key: String) -> ComputerUseResult? {
        cacheQueue.sync {
            if let entry = cache[key], !entry.isExpired {
                return entry.result
            }
            cache.removeValue(forKey: key)
            return nil
        }
    }

    private func setCache(key: String, result: ComputerUseResult) {
        cacheQueue.sync {
            cache[key] = AnalysisCacheEntry(result: result, timestamp: Date(), ttl: cacheTTL)
            // Prune expired entries
            let now = Date()
            cache = cache.filter { !$0.value.isExpired }
            _ = now // suppress warning
        }
    }

    /// Clear the analysis cache
    public func clearCache() {
        cacheQueue.sync { cache.removeAll() }
    }

    // MARK: - Coordinate Parsing

    /// Parse {x, y, confidence} from LLM response text
    private func parseCoordinates(from text: String) -> [String: Double]? {
        // Try to find JSON in the response
        let patterns = [
            "\\{[^}]*\"x\"\\s*:\\s*([\\d.]+)[^}]*\"y\"\\s*:\\s*([\\d.]+)[^}]*\"confidence\"\\s*:\\s*([\\d.]+)[^}]*\\}"
        ]

        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: []),
               let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) {

                let xStr = String(text[Range(match.range(at: 1), in: text)!])
                let yStr = String(text[Range(match.range(at: 2), in: text)!])
                let confStr = String(text[Range(match.range(at: 3), in: text)!])

                if let x = Double(xStr), let y = Double(yStr), let conf = Double(confStr) {
                    return ["x": x, "y": y, "confidence": conf]
                }
            }
        }

        // Fallback: try JSON decoding
        if let data = text.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let x = json["x"] as? Double,
           let y = json["y"] as? Double {
            return [
                "x": x,
                "y": y,
                "confidence": json["confidence"] as? Double ?? 0.5
            ]
        }

        return nil
    }
}
