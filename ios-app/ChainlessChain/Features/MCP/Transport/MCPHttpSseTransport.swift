import Foundation
import Combine
import CoreCommon

// MARK: - Transport State

/// 传输层状态
public enum MCPTransportState: String {
    case idle = "idle"
    case connecting = "connecting"
    case connected = "connected"
    case disconnected = "disconnected"
    case reconnecting = "reconnecting"
    case error = "error"
}

// MARK: - Transport Error

/// 传输层错误
public enum MCPTransportError: Error, LocalizedError {
    case connectionFailed(String)
    case timeout
    case invalidResponse
    case invalidURL
    case sseDisconnected
    case notConnected
    case encodingError
    case decodingError(String)
    case httpError(statusCode: Int, message: String?)

    public var errorDescription: String? {
        switch self {
        case .connectionFailed(let reason):
            return "连接失败: \(reason)"
        case .timeout:
            return "请求超时"
        case .invalidResponse:
            return "无效响应"
        case .invalidURL:
            return "无效的URL"
        case .sseDisconnected:
            return "SSE连接断开"
        case .notConnected:
            return "未连接到服务器"
        case .encodingError:
            return "请求编码失败"
        case .decodingError(let message):
            return "响应解码失败: \(message)"
        case .httpError(let code, let message):
            return "HTTP错误 \(code): \(message ?? "未知错误")"
        }
    }
}

// MARK: - HTTP+SSE Transport

/// MCP HTTP+SSE 传输层
/// 用于与远程MCP服务器通信
@MainActor
public class MCPHttpSseTransport: NSObject, ObservableObject {

    // MARK: - Configuration

    public struct Config {
        public var baseURL: String
        public var apiKey: String?
        public var headers: [String: String]
        public var timeout: TimeInterval
        public var maxRetries: Int
        public var retryDelay: TimeInterval
        public var useSSL: Bool

        public init(
            baseURL: String,
            apiKey: String? = nil,
            headers: [String: String] = [:],
            timeout: TimeInterval = 30,
            maxRetries: Int = 3,
            retryDelay: TimeInterval = 1,
            useSSL: Bool = true
        ) {
            self.baseURL = baseURL
            self.apiKey = apiKey
            self.headers = headers
            self.timeout = timeout
            self.maxRetries = maxRetries
            self.retryDelay = retryDelay
            self.useSSL = useSSL
        }
    }

    // MARK: - Properties

    private var config: Config
    private var session: URLSession!
    private var sseTask: URLSessionDataTask?
    private var pendingRequests: [String: CheckedContinuation<MCPResponse, Error>] = [:]
    private var requestIdCounter: Int = 0

    @Published public var state: MCPTransportState = .idle
    @Published public var lastError: MCPTransportError?

    /// 事件发布器
    public let connected = PassthroughSubject<Void, Never>()
    public let disconnected = PassthroughSubject<Void, Never>()
    public let reconnected = PassthroughSubject<Void, Never>()
    public let errorOccurred = PassthroughSubject<MCPTransportError, Never>()
    public let notificationReceived = PassthroughSubject<MCPResponse, Never>()

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    public init(config: Config) {
        self.config = config
        super.init()

        // 创建URLSession配置
        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = config.timeout
        sessionConfig.timeoutIntervalForResource = config.timeout * 2

        self.session = URLSession(configuration: sessionConfig, delegate: self, delegateQueue: nil)

        Logger.shared.info("[MCPHttpSseTransport] 已初始化, baseURL: \(config.baseURL)")
    }

    // MARK: - Connection Management

    /// 启动传输层
    public func start() async throws {
        guard state != .connected else {
            Logger.shared.info("[MCPHttpSseTransport] 已连接")
            return
        }

        state = .connecting
        Logger.shared.info("[MCPHttpSseTransport] 正在连接...")

        do {
            // 启动SSE连接
            try await startSSE()

            state = .connected
            connected.send()

            Logger.shared.info("[MCPHttpSseTransport] 连接成功")

        } catch {
            state = .error
            let transportError = MCPTransportError.connectionFailed(error.localizedDescription)
            lastError = transportError
            errorOccurred.send(transportError)
            throw transportError
        }
    }

    /// 停止传输层
    public func stop() async {
        Logger.shared.info("[MCPHttpSseTransport] 正在停止...")

        sseTask?.cancel()
        sseTask = nil

        // 取消所有待处理请求
        for (_, continuation) in pendingRequests {
            continuation.resume(throwing: MCPTransportError.sseDisconnected)
        }
        pendingRequests.removeAll()

        state = .disconnected
        disconnected.send()

        Logger.shared.info("[MCPHttpSseTransport] 已停止")
    }

    // MARK: - Message Sending

    /// 发送JSON-RPC消息
    public func send(_ message: MCPRequest) async throws -> MCPResponse {
        guard state == .connected else {
            throw MCPTransportError.notConnected
        }

        let requestId = message.id ?? generateRequestId()

        Logger.shared.info("[MCPHttpSseTransport] 发送请求: \(message.method)")

        return try await withCheckedThrowingContinuation { continuation in
            pendingRequests[requestId] = continuation

            Task {
                do {
                    let response = try await sendHttpRequest(message)

                    // 检查是否已经被其他方式处理
                    if let pending = pendingRequests.removeValue(forKey: requestId) {
                        pending.resume(returning: response)
                    }

                } catch {
                    if let pending = pendingRequests.removeValue(forKey: requestId) {
                        pending.resume(throwing: error)
                    }
                }
            }

            // 超时处理
            Task {
                try? await Task.sleep(nanoseconds: UInt64(config.timeout * 1_000_000_000))

                if let pending = pendingRequests.removeValue(forKey: requestId) {
                    pending.resume(throwing: MCPTransportError.timeout)
                }
            }
        }
    }

    /// 发送请求并获取原始响应 (用于初始化等)
    public func sendRaw(_ message: [String: Any]) async throws -> [String: Any] {
        guard state == .connected || state == .connecting else {
            throw MCPTransportError.notConnected
        }

        guard let url = URL(string: "\(config.baseURL)/message") else {
            throw MCPTransportError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // 添加认证头
        if let apiKey = config.apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        // 添加自定义头
        for (key, value) in config.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // 编码请求体
        request.httpBody = try JSONSerialization.data(withJSONObject: message)

        Logger.shared.info("[MCPHttpSseTransport] 发送原始请求: \(message["method"] ?? "unknown")")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw MCPTransportError.invalidResponse
        }

        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let errorMessage = String(data: data, encoding: .utf8)
            throw MCPTransportError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
        }

        guard let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MCPTransportError.invalidResponse
        }

        return jsonResponse
    }

    // MARK: - Private Methods

    /// 启动SSE连接
    private func startSSE() async throws {
        guard let url = URL(string: "\(config.baseURL)/sse") else {
            throw MCPTransportError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        // 添加认证头
        if let apiKey = config.apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        // 添加自定义头
        for (key, value) in config.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        sseTask = session.dataTask(with: request)
        sseTask?.resume()

        // 等待一小段时间确保连接建立
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5秒
    }

    /// 发送HTTP请求
    private func sendHttpRequest(_ message: MCPRequest) async throws -> MCPResponse {
        guard let url = URL(string: "\(config.baseURL)/message") else {
            throw MCPTransportError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // 添加认证头
        if let apiKey = config.apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        // 添加自定义头
        for (key, value) in config.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // 编码请求体
        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(message)

        // 重试逻辑
        var lastError: Error = MCPTransportError.connectionFailed("未知错误")

        for attempt in 0..<config.maxRetries {
            do {
                let (data, response) = try await session.data(for: request)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw MCPTransportError.invalidResponse
                }

                guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
                    let errorMessage = String(data: data, encoding: .utf8)
                    throw MCPTransportError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
                }

                let decoder = JSONDecoder()
                let mcpResponse = try decoder.decode(MCPResponse.self, from: data)

                return mcpResponse

            } catch {
                lastError = error

                if attempt < config.maxRetries - 1 {
                    Logger.shared.warning("[MCPHttpSseTransport] 请求失败，正在重试 (\(attempt + 1)/\(config.maxRetries))")
                    try await Task.sleep(nanoseconds: UInt64(config.retryDelay * 1_000_000_000))
                }
            }
        }

        throw lastError
    }

    /// 处理SSE事件
    private func handleSSEEvent(_ event: String, data: String) {
        Logger.shared.info("[MCPHttpSseTransport] SSE事件: \(event)")

        guard let jsonData = data.data(using: .utf8) else { return }

        do {
            let decoder = JSONDecoder()
            let response = try decoder.decode(MCPResponse.self, from: jsonData)

            // 检查是否是待处理请求的响应
            if let id = response.id, let continuation = pendingRequests.removeValue(forKey: id) {
                continuation.resume(returning: response)
            } else {
                // 通知事件
                notificationReceived.send(response)
            }

        } catch {
            Logger.shared.error("[MCPHttpSseTransport] SSE数据解析失败: \(error)")
        }
    }

    /// 生成请求ID
    private func generateRequestId() -> String {
        requestIdCounter += 1
        return "req_\(requestIdCounter)"
    }

    /// 处理连接断开
    private func handleDisconnection() {
        guard state == .connected else { return }

        state = .disconnected
        disconnected.send()

        Logger.shared.warning("[MCPHttpSseTransport] 连接断开")

        // 自动重连
        Task {
            await attemptReconnection()
        }
    }

    /// 尝试重连
    private func attemptReconnection() async {
        guard state != .reconnecting else { return }

        state = .reconnecting
        Logger.shared.info("[MCPHttpSseTransport] 正在重连...")

        for attempt in 0..<config.maxRetries {
            do {
                try await Task.sleep(nanoseconds: UInt64(config.retryDelay * 1_000_000_000 * Double(attempt + 1)))

                try await startSSE()

                state = .connected
                reconnected.send()

                Logger.shared.info("[MCPHttpSseTransport] 重连成功")
                return

            } catch {
                Logger.shared.warning("[MCPHttpSseTransport] 重连失败 (\(attempt + 1)/\(config.maxRetries))")
            }
        }

        state = .error
        let error = MCPTransportError.connectionFailed("重连失败")
        lastError = error
        errorOccurred.send(error)
    }
}

// MARK: - URLSessionDataDelegate

extension MCPHttpSseTransport: URLSessionDataDelegate {

    nonisolated public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        guard let text = String(data: data, encoding: .utf8) else { return }

        // 解析SSE格式
        let lines = text.components(separatedBy: "\n")
        var event = "message"
        var dataBuffer = ""

        for line in lines {
            if line.hasPrefix("event:") {
                event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                dataBuffer += String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            } else if line.isEmpty && !dataBuffer.isEmpty {
                // 事件完成
                Task { @MainActor in
                    self.handleSSEEvent(event, data: dataBuffer)
                }
                dataBuffer = ""
                event = "message"
            }
        }
    }

    nonisolated public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error = error {
            Logger.shared.error("[MCPHttpSseTransport] 任务错误: \(error)")
        }

        Task { @MainActor in
            self.handleDisconnection()
        }
    }
}

// MARK: - Convenience Methods

extension MCPHttpSseTransport {

    /// 初始化MCP会话
    public func initialize() async throws -> MCPServerInfo {
        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": generateRequestId(),
            "method": "initialize",
            "params": [
                "protocolVersion": "2024-11-05",
                "capabilities": [
                    "experimental": [:],
                    "sampling": [:]
                ],
                "clientInfo": [
                    "name": "chainlesschain-ios",
                    "version": "1.1.0"
                ]
            ]
        ]

        let response = try await sendRaw(request)

        guard let result = response["result"] as? [String: Any] else {
            throw MCPTransportError.invalidResponse
        }

        // 发送initialized通知
        let notification: [String: Any] = [
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        ]
        _ = try? await sendRaw(notification)

        // 解析服务器信息
        let serverInfo = MCPServerInfo(
            name: result["serverInfo"] as? [String: Any]?["name"] as? String ?? "unknown",
            version: result["serverInfo"] as? [String: Any]?["version"] as? String ?? "1.0.0",
            protocolVersion: result["protocolVersion"] as? String ?? "2024-11-05"
        )

        return serverInfo
    }

    /// 列出工具
    public func listTools() async throws -> [MCPTool] {
        let request = MCPRequest(method: "tools/list", params: [:])
        let response = try await send(request)

        guard let result = response.result,
              let toolsArray = result.arrayValue as? [[String: Any]] else {
            return []
        }

        return toolsArray.compactMap { dict -> MCPTool? in
            guard let name = dict["name"] as? String else { return nil }

            return MCPTool(
                name: name,
                description: dict["description"] as? String,
                inputSchema: MCPJSONSchema()  // 简化处理
            )
        }
    }

    /// 列出资源
    public func listResources() async throws -> [MCPResource] {
        let request = MCPRequest(method: "resources/list", params: [:])
        let response = try await send(request)

        guard let result = response.result,
              let resourcesArray = result.arrayValue as? [[String: Any]] else {
            return []
        }

        return resourcesArray.compactMap { dict -> MCPResource? in
            guard let uri = dict["uri"] as? String,
                  let name = dict["name"] as? String else { return nil }

            return MCPResource(
                uri: uri,
                name: name,
                description: dict["description"] as? String,
                mimeType: dict["mimeType"] as? String
            )
        }
    }

    /// 调用工具
    public func callTool(name: String, arguments: [String: Any]) async throws -> MCPToolCallResult {
        let params: [String: AnyCodable] = [
            "name": AnyCodable(name),
            "arguments": AnyCodable(arguments)
        ]

        let request = MCPRequest(method: "tools/call", params: params)
        let response = try await send(request)

        if let error = response.error {
            return MCPToolCallResult(
                content: [MCPContent(type: .text, text: error.message)],
                isError: true
            )
        }

        guard let result = response.result else {
            throw MCPTransportError.invalidResponse
        }

        // 解析内容
        var contents: [MCPContent] = []

        if let contentArray = result.arrayValue as? [[String: Any]] {
            for item in contentArray {
                let type = MCPContentType(rawValue: item["type"] as? String ?? "text") ?? .text
                let content = MCPContent(
                    type: type,
                    text: item["text"] as? String
                )
                contents.append(content)
            }
        } else if let text = result.stringValue {
            contents.append(MCPContent(type: .text, text: text))
        }

        return MCPToolCallResult(content: contents, isError: false)
    }

    /// 读取资源
    public func readResource(uri: String) async throws -> MCPResourceContent {
        let params: [String: AnyCodable] = [
            "uri": AnyCodable(uri)
        ]

        let request = MCPRequest(method: "resources/read", params: params)
        let response = try await send(request)

        guard let result = response.result,
              let contents = result.dictValue?["contents"] as? [[String: Any]],
              let first = contents.first else {
            throw MCPTransportError.invalidResponse
        }

        return MCPResourceContent(
            uri: first["uri"] as? String ?? uri,
            mimeType: first["mimeType"] as? String,
            text: first["text"] as? String
        )
    }
}
