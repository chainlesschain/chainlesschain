import Foundation

/// 抽象 WS transport — 让 [WebSocketSignalClient] 可对 fake transport 做单测，
/// 不依赖真 socket。生产用 [URLSessionWebSocketTransport]。
public protocol WebSocketTransport: AnyObject {
    func connect(to url: URL) async throws
    func send(text: String) async throws
    /// Returns next inbound text message。底层若关闭抛 [WebSocketTransportError.closed]。
    func receive() async throws -> String
    func sendPing() async throws
    func close()
    var isOpen: Bool { get }
}

public enum WebSocketTransportError: Error {
    case closed
    case notConnected
    case binaryFrameUnsupported
}

/// `URLSessionWebSocketTask` 包装 — Phase 1.2 production transport。
///
/// **iOS 特化注意**（design doc §6.2）：
/// - `URLSessionWebSocketTask.receive` 是单次：每收一条必须再调 receive 才能收下一条。
///   `receive()` 这里返一条后由调用方循环。
/// - URLSession 默认会对 server-initiated ping 自动 pong 响应（不需要我们处理 inbound ping）
/// - `sendPing(pongReceiveHandler:)` 是 WS 帧级 ping，与 server 心跳互通；与 app 层的
///   `{type:"ping"}` JSON 消息**不同**（后者是协议级 keepalive，本 transport 不发）
public final class URLSessionWebSocketTransport: NSObject, WebSocketTransport, URLSessionWebSocketDelegate {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var openContinuation: CheckedContinuation<Void, Error>?
    private let lock = NSLock()

    public override init() {
        super.init()
    }

    public var isOpen: Bool {
        lock.lock(); defer { lock.unlock() }
        guard let task = task else { return false }
        return task.state == .running
    }

    public func connect(to url: URL) async throws {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        let task = session.webSocketTask(with: url)
        lock.lock()
        self.session = session
        self.task = task
        lock.unlock()

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            self.openContinuation = cont
            task.resume()
        }
    }

    public func send(text: String) async throws {
        guard let task = task, task.state == .running else {
            throw WebSocketTransportError.notConnected
        }
        try await task.send(.string(text))
    }

    public func receive() async throws -> String {
        guard let task = task, task.state == .running else {
            throw WebSocketTransportError.closed
        }
        let message = try await task.receive()
        switch message {
        case .string(let text):
            return text
        case .data:
            throw WebSocketTransportError.binaryFrameUnsupported
        @unknown default:
            throw WebSocketTransportError.binaryFrameUnsupported
        }
    }

    public func sendPing() async throws {
        guard let task = task, task.state == .running else {
            throw WebSocketTransportError.notConnected
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            task.sendPing { error in
                if let error = error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume()
                }
            }
        }
    }

    public func close() {
        lock.lock()
        let task = self.task
        let session = self.session
        self.task = nil
        self.session = nil
        lock.unlock()
        task?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
    }

    // MARK: URLSessionWebSocketDelegate

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        openContinuation?.resume()
        openContinuation = nil
    }

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        // 若 connect 时仍在等待 open，立即 fail
        openContinuation?.resume(throwing: WebSocketTransportError.closed)
        openContinuation = nil
    }
}
