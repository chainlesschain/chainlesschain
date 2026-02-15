//
//  NetworkInterceptor.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Network request interception and mocking
//  Adapted from: desktop-app-vue/src/main/browser/actions/network-interceptor.js
//
//  Key difference from desktop: Uses JS injection to override fetch()/XMLHttpRequest
//  and WKContentRuleListStore for URL blocking, instead of CDP interception.
//

import Foundation
import WebKit
import Combine

// MARK: - Intercepted Request

/// A logged network request
public struct CUInterceptedRequest: Identifiable, Codable {
    public let id: String
    public let url: String
    public let method: String
    public let resourceType: String
    public let timestamp: Date
    public let status: Int?
    public let blocked: Bool

    public init(url: String, method: String, resourceType: String, status: Int? = nil, blocked: Bool = false) {
        self.id = UUID().uuidString
        self.url = url
        self.method = method
        self.resourceType = resourceType
        self.timestamp = Date()
        self.status = status
        self.blocked = blocked
    }
}

// MARK: - Mock Rule

/// A rule for mocking network responses
public struct CUMockRule: Identifiable, Codable {
    public let id: String
    public let urlPattern: String
    public let method: String?
    public let responseBody: String
    public let responseStatus: Int
    public let responseHeaders: [String: String]
    public var isEnabled: Bool

    public init(
        urlPattern: String,
        method: String? = nil,
        responseBody: String,
        responseStatus: Int = 200,
        responseHeaders: [String: String] = ["Content-Type": "application/json"],
        isEnabled: Bool = true
    ) {
        self.id = UUID().uuidString
        self.urlPattern = urlPattern
        self.method = method
        self.responseBody = responseBody
        self.responseStatus = responseStatus
        self.responseHeaders = responseHeaders
        self.isEnabled = isEnabled
    }
}

// MARK: - NetworkInterceptor

/// Network request interceptor for WKWebView
public class NetworkInterceptor: ObservableObject {
    public static let shared = NetworkInterceptor()

    @Published public private(set) var isActive: Bool = false
    @Published public private(set) var requests: [CUInterceptedRequest] = []
    @Published public var mockRules: [CUMockRule] = []
    @Published public var blockedPatterns: [String] = []

    private let maxRequests = 500
    private let queue = DispatchQueue(label: "com.chainlesschain.cu-network-interceptor")

    // JS injection script name for message handler
    private let handlerName = "cuNetworkInterceptor"

    private init() {
        Logger.shared.info("[NetworkInterceptor] Initialized")
    }

    // MARK: - Activation

    /// Install network interception JS into a WKWebView
    @MainActor
    public func activate(webView: WKWebView) async throws {
        let mockRulesJSON = (try? String(data: JSONEncoder().encode(mockRules), encoding: .utf8)) ?? "[]"
        let blockedJSON = (try? String(data: JSONEncoder().encode(blockedPatterns), encoding: .utf8)) ?? "[]"

        let js = """
        (function() {
            if (window.__cuNetworkIntercepted) return;
            window.__cuNetworkIntercepted = true;

            const mockRules = \(mockRulesJSON);
            const blockedPatterns = \(blockedJSON);
            const requestLog = [];

            function matchesPattern(url, pattern) {
                const regex = new RegExp(pattern.replace(/\\*/g, '.*'));
                return regex.test(url);
            }

            function findMockRule(url, method) {
                return mockRules.find(r => r.isEnabled && matchesPattern(url, r.urlPattern) &&
                    (!r.method || r.method === method));
            }

            function isBlocked(url) {
                return blockedPatterns.some(p => matchesPattern(url, p));
            }

            function logRequest(url, method, type, status, blocked) {
                const entry = { url, method, type, status, blocked, timestamp: Date.now() };
                requestLog.push(entry);
                if (requestLog.length > 200) requestLog.shift();
                try {
                    window.webkit.messageHandlers.\(handlerName).postMessage(JSON.stringify(entry));
                } catch(e) {}
            }

            // Override fetch
            const origFetch = window.fetch;
            window.fetch = async function(input, init) {
                const url = typeof input === 'string' ? input : input.url;
                const method = (init && init.method) || 'GET';

                if (isBlocked(url)) {
                    logRequest(url, method, 'fetch', 0, true);
                    throw new Error('Request blocked by NetworkInterceptor');
                }

                const mock = findMockRule(url, method);
                if (mock) {
                    logRequest(url, method, 'fetch', mock.responseStatus, false);
                    return new Response(mock.responseBody, {
                        status: mock.responseStatus,
                        headers: mock.responseHeaders
                    });
                }

                try {
                    const response = await origFetch.call(this, input, init);
                    logRequest(url, method, 'fetch', response.status, false);
                    return response;
                } catch(e) {
                    logRequest(url, method, 'fetch', 0, false);
                    throw e;
                }
            };

            // Override XMLHttpRequest
            const origXHROpen = XMLHttpRequest.prototype.open;
            const origXHRSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function(method, url) {
                this.__cuMethod = method;
                this.__cuUrl = url;
                return origXHROpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(body) {
                const url = this.__cuUrl;
                const method = this.__cuMethod || 'GET';

                if (isBlocked(url)) {
                    logRequest(url, method, 'xhr', 0, true);
                    this.dispatchEvent(new Event('error'));
                    return;
                }

                const mock = findMockRule(url, method);
                if (mock) {
                    logRequest(url, method, 'xhr', mock.responseStatus, false);
                    Object.defineProperty(this, 'status', { value: mock.responseStatus });
                    Object.defineProperty(this, 'responseText', { value: mock.responseBody });
                    Object.defineProperty(this, 'readyState', { value: 4 });
                    this.dispatchEvent(new Event('readystatechange'));
                    this.dispatchEvent(new Event('load'));
                    return;
                }

                this.addEventListener('load', function() {
                    logRequest(url, method, 'xhr', this.status, false);
                });
                return origXHRSend.apply(this, arguments);
            };

            window.__cuGetRequestLog = function() { return JSON.stringify(requestLog); };
        })();
        """

        let userScript = WKUserScript(
            source: js,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        webView.configuration.userContentController.addUserScript(userScript)

        // Also inject into current page
        try await webView.evaluateJavaScript(js)

        isActive = true
        Logger.shared.info("[NetworkInterceptor] Activated")
    }

    /// Deactivate network interception
    @MainActor
    public func deactivate(webView: WKWebView) async throws {
        let js = """
        (function() {
            window.__cuNetworkIntercepted = false;
        })();
        """
        try await webView.evaluateJavaScript(js)

        isActive = false
        Logger.shared.info("[NetworkInterceptor] Deactivated")
    }

    // MARK: - Mock Rules

    /// Add a mock rule
    public func addMockRule(_ rule: CUMockRule) {
        mockRules.append(rule)
        Logger.shared.debug("[NetworkInterceptor] Mock rule added: \(rule.urlPattern)")
    }

    /// Remove a mock rule
    public func removeMockRule(id: String) {
        mockRules.removeAll { $0.id == id }
    }

    /// Clear all mock rules
    public func clearMockRules() {
        mockRules.removeAll()
    }

    // MARK: - Block Patterns

    /// Add a URL pattern to block
    public func addBlockPattern(_ pattern: String) {
        blockedPatterns.append(pattern)
    }

    /// Remove a block pattern
    public func removeBlockPattern(_ pattern: String) {
        blockedPatterns.removeAll { $0 == pattern }
    }

    // MARK: - Request Log

    /// Process a logged request from JS
    public func processLogEntry(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let request = CUInterceptedRequest(
            url: json["url"] as? String ?? "",
            method: json["method"] as? String ?? "GET",
            resourceType: json["type"] as? String ?? "unknown",
            status: json["status"] as? Int,
            blocked: json["blocked"] as? Bool ?? false
        )

        queue.sync {
            requests.append(request)
            if requests.count > maxRequests {
                requests.removeFirst(requests.count - maxRequests)
            }
        }
    }

    /// Get recent request log
    @MainActor
    public func getRequestLog(webView: WKWebView) async throws -> [CUInterceptedRequest] {
        let js = "window.__cuGetRequestLog ? window.__cuGetRequestLog() : '[]'"
        if let resultStr = try await webView.evaluateJavaScript(js) as? String,
           let data = resultStr.data(using: .utf8),
           let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return entries.map {
                CUInterceptedRequest(
                    url: $0["url"] as? String ?? "",
                    method: $0["method"] as? String ?? "GET",
                    resourceType: $0["type"] as? String ?? "unknown",
                    status: $0["status"] as? Int,
                    blocked: $0["blocked"] as? Bool ?? false
                )
            }
        }
        return requests
    }

    /// Clear request log
    public func clearLog() {
        queue.sync { requests.removeAll() }
    }

    /// Get request statistics
    public func getStats() -> [String: Any] {
        queue.sync {
            let total = requests.count
            let blocked = requests.filter { $0.blocked }.count
            let byType = Dictionary(grouping: requests, by: { $0.resourceType }).mapValues { $0.count }
            return [
                "totalRequests": total,
                "blockedRequests": blocked,
                "mockRulesCount": mockRules.count,
                "blockPatternsCount": blockedPatterns.count,
                "byResourceType": byType
            ]
        }
    }
}
