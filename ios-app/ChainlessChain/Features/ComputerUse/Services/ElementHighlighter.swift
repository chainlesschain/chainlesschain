//
//  ElementHighlighter.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Visual element highlighting via JS overlay injection
//  Adapted from: desktop-app-vue/src/main/browser/actions/element-highlighter.js
//

import Foundation
import WebKit

// MARK: - Highlight Style

/// Predefined highlight styles
public enum CUHighlightStyle: String, Codable {
    case `default` = "default"
    case success = "success"
    case error = "error"
    case warning = "warning"
    case info = "info"
    case pulse = "pulse"
    case outline = "outline"

    var borderColor: String {
        switch self {
        case .default: return "rgba(0, 120, 255, 0.8)"
        case .success: return "rgba(40, 200, 60, 0.8)"
        case .error: return "rgba(255, 60, 60, 0.8)"
        case .warning: return "rgba(255, 180, 0, 0.8)"
        case .info: return "rgba(100, 180, 255, 0.8)"
        case .pulse: return "rgba(0, 120, 255, 0.8)"
        case .outline: return "rgba(255, 100, 100, 0.8)"
        }
    }

    var backgroundColor: String {
        switch self {
        case .default: return "rgba(0, 120, 255, 0.1)"
        case .success: return "rgba(40, 200, 60, 0.1)"
        case .error: return "rgba(255, 60, 60, 0.1)"
        case .warning: return "rgba(255, 180, 0, 0.1)"
        case .info: return "rgba(100, 180, 255, 0.1)"
        case .pulse: return "rgba(0, 120, 255, 0.15)"
        case .outline: return "transparent"
        }
    }

    var borderWidth: Int {
        self == .outline ? 3 : 2
    }
}

// MARK: - ElementHighlighter

/// Highlights elements in WKWebView for debugging and demonstration
public class ElementHighlighter {
    public static let shared = ElementHighlighter()

    private var activeHighlightIds: [String] = []

    private init() {
        Logger.shared.info("[ElementHighlighter] Initialized")
    }

    // MARK: - Highlight by Bounds

    /// Highlight a rectangular region
    @MainActor
    public func highlightBounds(
        x: Double, y: Double, width: Double, height: Double,
        style: CUHighlightStyle = .default,
        label: String? = nil,
        duration: Double = 3.0,
        in webView: WKWebView
    ) async throws -> String {
        let highlightId = "cu-highlight-\(UUID().uuidString.prefix(8))"

        let labelHtml = label.map { """
            <div style="position:absolute;top:-22px;left:0;background:\(style.borderColor);
                 color:white;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;
                 font-family:-apple-system,sans-serif;">\($0)</div>
        """ } ?? ""

        let animationCSS = style == .pulse ? """
            @keyframes cu-pulse { 0%,100%{opacity:0.8} 50%{opacity:0.3} }
            animation: cu-pulse 1.5s ease-in-out infinite;
        """ : ""

        let js = """
        (function() {
            const overlay = document.createElement('div');
            overlay.id = '\(highlightId)';
            overlay.style.cssText = `
                position: fixed; z-index: 2147483647; pointer-events: none;
                left: \(x)px; top: \(y)px; width: \(width)px; height: \(height)px;
                border: \(style.borderWidth)px solid \(style.borderColor);
                background: \(style.backgroundColor);
                border-radius: 4px; box-sizing: border-box;
                transition: opacity 0.3s ease;
                \(animationCSS)
            `;
            overlay.innerHTML = '\(labelHtml.replacingOccurrences(of: "'", with: "\\'"))';
            document.body.appendChild(overlay);

            if (\(duration) > 0) {
                setTimeout(() => {
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.remove(), 300);
                }, \(duration * 1000));
            }

            return '\(highlightId)';
        })();
        """
        _ = try await webView.evaluateJavaScript(js)

        activeHighlightIds.append(highlightId)
        return highlightId
    }

    // MARK: - Highlight by Selector

    /// Highlight an element matching a CSS selector
    @MainActor
    public func highlightSelector(
        selector: String,
        style: CUHighlightStyle = .default,
        label: String? = nil,
        duration: Double = 3.0,
        in webView: WKWebView
    ) async throws -> String? {
        let escapedSelector = selector
            .replacingOccurrences(of: "'", with: "\\'")

        let boundsJS = """
        (function() {
            const el = document.querySelector('\(escapedSelector)');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        })();
        """
        guard let resultStr = try await webView.evaluateJavaScript(boundsJS) as? String,
              let data = resultStr.data(using: .utf8),
              let bounds = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
              let x = bounds["x"], let y = bounds["y"],
              let w = bounds["width"], let h = bounds["height"] else {
            Logger.shared.warning("[ElementHighlighter] Element not found: \(selector)")
            return nil
        }

        return try await highlightBounds(
            x: x, y: y, width: w, height: h,
            style: style, label: label ?? selector,
            duration: duration, in: webView
        )
    }

    // MARK: - Highlight Click Point

    /// Show a click indicator at a point
    @MainActor
    public func highlightClick(
        x: Double, y: Double,
        style: CUHighlightStyle = .default,
        in webView: WKWebView
    ) async throws {
        let js = """
        (function() {
            const dot = document.createElement('div');
            dot.style.cssText = `
                position: fixed; z-index: 2147483647; pointer-events: none;
                left: \(x - 15)px; top: \(y - 15)px; width: 30px; height: 30px;
                border-radius: 50%;
                border: 2px solid \(style.borderColor);
                background: \(style.backgroundColor);
                transition: transform 0.3s ease, opacity 0.3s ease;
            `;
            document.body.appendChild(dot);

            requestAnimationFrame(() => {
                dot.style.transform = 'scale(2)';
                dot.style.opacity = '0';
            });
            setTimeout(() => dot.remove(), 500);
        })();
        """
        _ = try await webView.evaluateJavaScript(js)
    }

    // MARK: - Remove Highlights

    /// Remove a specific highlight
    @MainActor
    public func removeHighlight(id: String, in webView: WKWebView) async throws {
        let js = """
        (function() {
            const el = document.getElementById('\(id)');
            if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
        })();
        """
        _ = try await webView.evaluateJavaScript(js)
        activeHighlightIds.removeAll { $0 == id }
    }

    /// Remove all active highlights
    @MainActor
    public func removeAll(in webView: WKWebView) async throws {
        for id in activeHighlightIds {
            try await removeHighlight(id: id, in: webView)
        }
        activeHighlightIds.removeAll()
    }

    // MARK: - Batch Highlight

    /// Highlight multiple elements at once
    @MainActor
    public func highlightMultiple(
        selectors: [String],
        style: CUHighlightStyle = .info,
        duration: Double = 3.0,
        in webView: WKWebView
    ) async throws -> [String] {
        var ids: [String] = []
        for selector in selectors {
            if let id = try await highlightSelector(
                selector: selector, style: style, duration: duration, in: webView
            ) {
                ids.append(id)
            }
        }
        return ids
    }

    /// Count of active highlights
    public var activeCount: Int { activeHighlightIds.count }
}
