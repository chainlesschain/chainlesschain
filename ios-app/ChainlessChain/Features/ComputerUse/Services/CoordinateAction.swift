//
//  CoordinateAction.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Coordinate-based browser actions via JS injection
//  Adapted from: desktop-app-vue/src/main/browser/actions/coordinate-action.js
//
//  Key difference from desktop: Uses WKWebView.evaluateJavaScript() to dispatch
//  synthetic DOM events instead of Puppeteer CDP protocol.
//

import Foundation
import WebKit

// MARK: - CoordinateAction Protocol

/// Protocol for coordinate-based browser actions
public protocol CoordinateActionProtocol {
    func tapAt(x: Double, y: Double, in webView: WKWebView) async throws -> ComputerUseResult
    func doubleTapAt(x: Double, y: Double, in webView: WKWebView) async throws -> ComputerUseResult
    func longPressAt(x: Double, y: Double, duration: Double, in webView: WKWebView) async throws -> ComputerUseResult
    func typeText(_ text: String, in webView: WKWebView) async throws -> ComputerUseResult
    func pressKey(_ key: String, modifiers: [String], in webView: WKWebView) async throws -> ComputerUseResult
    func scrollAt(x: Double, y: Double, deltaX: Double, deltaY: Double, in webView: WKWebView) async throws -> ComputerUseResult
    func dragFromTo(from: CUPoint, to: CUPoint, steps: Int, in webView: WKWebView) async throws -> ComputerUseResult
    func gesture(_ type: CUGestureType, in webView: WKWebView) async throws -> ComputerUseResult
}

// MARK: - CoordinateAction

/// Implements coordinate-based actions via JavaScript injection into WKWebView
public class CoordinateAction: CoordinateActionProtocol {
    public static let shared = CoordinateAction()

    private let metrics = ComputerUseMetrics.shared
    private let auditLogger = CUAuditLogger.shared

    private init() {
        Logger.shared.info("[CoordinateAction] Initialized")
    }

    // MARK: - Tap

    /// Simulate a tap at coordinates
    public func tapAt(x: Double, y: Double, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let js = """
        (function() {
            const el = document.elementFromPoint(\(x), \(y));
            if (!el) return JSON.stringify({ success: false, error: 'No element at coordinates' });

            const rect = el.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, clientX: \(x), clientY: \(y) };

            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));

            return JSON.stringify({
                success: true,
                tagName: el.tagName,
                id: el.id || null,
                className: el.className || null,
                text: (el.textContent || '').substring(0, 100)
            });
        })();
        """
        return try await executeJS(js, action: .click, params: ["x": .double(x), "y": .double(y)],
                                   webView: webView, start: start)
    }

    // MARK: - Double Tap

    /// Simulate a double tap at coordinates
    public func doubleTapAt(x: Double, y: Double, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let js = """
        (function() {
            const el = document.elementFromPoint(\(x), \(y));
            if (!el) return JSON.stringify({ success: false, error: 'No element at coordinates' });

            const opts = { bubbles: true, cancelable: true, clientX: \(x), clientY: \(y) };

            el.dispatchEvent(new MouseEvent('click', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            el.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }));

            return JSON.stringify({
                success: true,
                tagName: el.tagName,
                text: (el.textContent || '').substring(0, 100)
            });
        })();
        """
        return try await executeJS(js, action: .doubleClick, params: ["x": .double(x), "y": .double(y)],
                                   webView: webView, start: start)
    }

    // MARK: - Long Press

    /// Simulate a long press at coordinates
    public func longPressAt(x: Double, y: Double, duration: Double = 500, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let durationMs = Int(duration)
        let js = """
        (function() {
            return new Promise(resolve => {
                const el = document.elementFromPoint(\(x), \(y));
                if (!el) { resolve(JSON.stringify({ success: false, error: 'No element at coordinates' })); return; }

                const touch = new Touch({
                    identifier: Date.now(),
                    target: el,
                    clientX: \(x),
                    clientY: \(y)
                });

                el.dispatchEvent(new TouchEvent('touchstart', {
                    bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch]
                }));

                setTimeout(() => {
                    el.dispatchEvent(new TouchEvent('touchend', {
                        bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch]
                    }));
                    resolve(JSON.stringify({
                        success: true,
                        tagName: el.tagName,
                        duration: \(durationMs)
                    }));
                }, \(durationMs));
            });
        })();
        """
        return try await executeJS(js, action: .longPress,
                                   params: ["x": .double(x), "y": .double(y), "duration": .double(duration)],
                                   webView: webView, start: start)
    }

    // MARK: - Type Text

    /// Type text into the currently focused element
    public func typeText(_ text: String, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let escapedText = text
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
        let js = """
        (function() {
            const el = document.activeElement;
            if (!el) return JSON.stringify({ success: false, error: 'No focused element' });

            const text = '\(escapedText)';
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeSetter.call(el, el.value + text);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.isContentEditable) {
                document.execCommand('insertText', false, text);
            }

            return JSON.stringify({
                success: true,
                tagName: el.tagName,
                textLength: text.length
            });
        })();
        """
        return try await executeJS(js, action: .type,
                                   params: ["text": .string(String(text.prefix(20)) + (text.count > 20 ? "..." : ""))],
                                   webView: webView, start: start)
    }

    // MARK: - Press Key

    /// Press a keyboard key with optional modifiers
    public func pressKey(_ key: String, modifiers: [String] = [], in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let modObj = modifiers.map { "\($0): true" }.joined(separator: ", ")
        let js = """
        (function() {
            const el = document.activeElement || document.body;
            const opts = {
                key: '\(key)',
                code: '\(key)',
                bubbles: true,
                cancelable: true,
                \(modObj)
            };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keypress', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));

            return JSON.stringify({ success: true, key: '\(key)', modifiers: [\(modifiers.map { "'\($0)'" }.joined(separator: ","))] });
        })();
        """
        return try await executeJS(js, action: .key,
                                   params: ["key": .string(key)],
                                   webView: webView, start: start)
    }

    // MARK: - Scroll

    /// Scroll at coordinates
    public func scrollAt(x: Double, y: Double, deltaX: Double, deltaY: Double, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let js = """
        (function() {
            const el = document.elementFromPoint(\(x), \(y)) || document.scrollingElement || document.body;
            el.scrollBy({ left: \(deltaX), top: \(deltaY), behavior: 'smooth' });

            return JSON.stringify({
                success: true,
                scrollLeft: el.scrollLeft,
                scrollTop: el.scrollTop,
                deltaX: \(deltaX),
                deltaY: \(deltaY)
            });
        })();
        """
        return try await executeJS(js, action: .scroll,
                                   params: ["x": .double(x), "y": .double(y), "deltaX": .double(deltaX), "deltaY": .double(deltaY)],
                                   webView: webView, start: start)
    }

    // MARK: - Drag

    /// Drag from one point to another
    public func dragFromTo(from: CUPoint, to: CUPoint, steps: Int = 10, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()
        let js = """
        (function() {
            return new Promise(resolve => {
                const fromEl = document.elementFromPoint(\(from.x), \(from.y));
                if (!fromEl) { resolve(JSON.stringify({ success: false, error: 'No element at start' })); return; }

                const steps = \(steps);
                let step = 0;

                function easeInOutQuad(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

                const identifier = Date.now();
                fromEl.dispatchEvent(new TouchEvent('touchstart', {
                    bubbles: true, cancelable: true,
                    touches: [new Touch({ identifier, target: fromEl, clientX: \(from.x), clientY: \(from.y) })],
                    changedTouches: [new Touch({ identifier, target: fromEl, clientX: \(from.x), clientY: \(from.y) })]
                }));

                function moveStep() {
                    step++;
                    const progress = easeInOutQuad(step / steps);
                    const cx = \(from.x) + (\(to.x) - \(from.x)) * progress;
                    const cy = \(from.y) + (\(to.y) - \(from.y)) * progress;

                    fromEl.dispatchEvent(new TouchEvent('touchmove', {
                        bubbles: true, cancelable: true,
                        touches: [new Touch({ identifier, target: fromEl, clientX: cx, clientY: cy })],
                        changedTouches: [new Touch({ identifier, target: fromEl, clientX: cx, clientY: cy })]
                    }));

                    if (step < steps) {
                        setTimeout(moveStep, 16);
                    } else {
                        fromEl.dispatchEvent(new TouchEvent('touchend', {
                            bubbles: true, cancelable: true, touches: [],
                            changedTouches: [new Touch({ identifier, target: fromEl, clientX: \(to.x), clientY: \(to.y) })]
                        }));
                        resolve(JSON.stringify({ success: true, from: { x: \(from.x), y: \(from.y) }, to: { x: \(to.x), y: \(to.y) }, steps }));
                    }
                }
                setTimeout(moveStep, 16);
            });
        })();
        """
        return try await executeJS(js, action: .drag,
                                   params: ["fromX": .double(from.x), "fromY": .double(from.y),
                                            "toX": .double(to.x), "toY": .double(to.y)],
                                   webView: webView, start: start)
    }

    // MARK: - Gesture

    /// Perform a gesture
    public func gesture(_ type: CUGestureType, in webView: WKWebView) async throws -> ComputerUseResult {
        let start = Date()

        // Get viewport size and compute gesture path
        let sizeJS = "JSON.stringify({ w: window.innerWidth, h: window.innerHeight })"
        guard let sizeStr = try await webView.evaluateJavaScript(sizeJS) as? String,
              let sizeData = sizeStr.data(using: .utf8),
              let size = try? JSONSerialization.jsonObject(with: sizeData) as? [String: Double],
              let w = size["w"], let h = size["h"] else {
            return .fail(action: .swipe, error: "Cannot determine viewport size")
        }

        let cx = w / 2, cy = h / 2
        let from: CUPoint
        let to: CUPoint

        switch type {
        case .swipeUp: from = CUPoint(x: cx, y: cy + 150); to = CUPoint(x: cx, y: cy - 150)
        case .swipeDown: from = CUPoint(x: cx, y: cy - 150); to = CUPoint(x: cx, y: cy + 150)
        case .swipeLeft: from = CUPoint(x: cx + 150, y: cy); to = CUPoint(x: cx - 150, y: cy)
        case .swipeRight: from = CUPoint(x: cx - 150, y: cy); to = CUPoint(x: cx + 150, y: cy)
        case .pinchIn, .pinchOut:
            // Pinch gestures use scroll with scale
            let direction = type == .pinchIn ? -100.0 : 100.0
            return try await scrollAt(x: cx, y: cy, deltaX: 0, deltaY: direction, in: webView)
        }

        let result = try await dragFromTo(from: from, to: to, steps: 8, in: webView)

        let duration = Date().timeIntervalSince(start) * 1000
        auditLogger.log(action: .swipe, params: ["gesture": .string(type.rawValue)],
                        success: result.success, duration: duration)
        metrics.recordAction(type: .swipe, success: result.success, duration: duration)
        return result
    }

    // MARK: - JS Execution Helper

    /// Execute JavaScript and return a ComputerUseResult
    @MainActor
    private func executeJS(
        _ js: String,
        action: CUActionType,
        params: [String: AnyCodableValue],
        webView: WKWebView,
        start: Date
    ) async throws -> ComputerUseResult {
        do {
            let rawResult = try await webView.evaluateJavaScript(js)
            let duration = Date().timeIntervalSince(start) * 1000

            var resultData: [String: AnyCodableValue] = [:]
            if let str = rawResult as? String,
               let data = str.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

                if let success = json["success"] as? Bool, !success {
                    let error = json["error"] as? String ?? "Unknown error"
                    auditLogger.log(action: action, params: params, success: false, error: error, duration: duration)
                    metrics.recordAction(type: action, success: false, duration: duration)
                    metrics.recordError(action: action, error: error)
                    return .fail(action: action, error: error, duration: duration)
                }

                for (k, v) in json {
                    resultData[k] = .from(v)
                }
            }

            auditLogger.log(action: action, params: params, success: true, duration: duration)
            metrics.recordAction(type: action, success: true, duration: duration)
            return .ok(action: action, data: resultData, duration: duration)

        } catch {
            let duration = Date().timeIntervalSince(start) * 1000
            auditLogger.log(action: action, params: params, success: false, error: error.localizedDescription, duration: duration)
            metrics.recordAction(type: action, success: false, duration: duration)
            metrics.recordError(action: action, error: error.localizedDescription)
            return .fail(action: action, error: error.localizedDescription, duration: duration)
        }
    }
}
