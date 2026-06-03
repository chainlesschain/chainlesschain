import Foundation
@testable import CoreP2P

/// In-memory fake transport for unit testing `WebSocketSignalClient` 不依赖真 socket。
/// 测试侧可：
/// - `injectIncoming(_:)` 模拟 server 发来的消息
/// - 读 `sentMessages` 验证客户端发出去的 JSON shape
/// - `simulateClosed()` 触发自动重连路径
final class FakeWebSocketTransport: WebSocketTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _isOpen = false
    private var _sentMessages: [String] = []
    private var _pingCount = 0
    private var inboundContinuations: [CheckedContinuation<String, Error>] = []
    private var inboundBuffer: [String] = []
    private var connectError: Error?

    /// 配置 connect 失败（测试 reconnect 路径）
    var connectErrorToThrow: Error?

    var sentMessages: [String] {
        lock.lock(); defer { lock.unlock() }
        return _sentMessages
    }

    var pingCount: Int {
        lock.lock(); defer { lock.unlock() }
        return _pingCount
    }

    var isOpen: Bool {
        lock.lock(); defer { lock.unlock() }
        return _isOpen
    }

    func connect(to url: URL) async throws {
        if let err = connectErrorToThrow {
            throw err
        }
        lock.lock()
        _isOpen = true
        lock.unlock()
    }

    func send(text: String) async throws {
        lock.lock()
        guard _isOpen else {
            lock.unlock()
            throw WebSocketTransportError.notConnected
        }
        _sentMessages.append(text)
        lock.unlock()
    }

    func receive() async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            lock.lock()
            if !_isOpen {
                lock.unlock()
                cont.resume(throwing: WebSocketTransportError.closed)
                return
            }
            if !inboundBuffer.isEmpty {
                let next = inboundBuffer.removeFirst()
                lock.unlock()
                cont.resume(returning: next)
                return
            }
            inboundContinuations.append(cont)
            lock.unlock()
        }
    }

    func sendPing() async throws {
        lock.lock()
        guard _isOpen else {
            lock.unlock()
            throw WebSocketTransportError.notConnected
        }
        _pingCount += 1
        lock.unlock()
    }

    func close() {
        lock.lock()
        _isOpen = false
        let waiting = inboundContinuations
        inboundContinuations.removeAll()
        lock.unlock()
        // 唤醒所有等待者抛 closed
        for cont in waiting {
            cont.resume(throwing: WebSocketTransportError.closed)
        }
    }

    // MARK: Test API

    /// 模拟 server 发来一条消息。若有 receive 等待中则立即唤醒；否则缓冲。
    func injectIncoming(_ text: String) {
        lock.lock()
        if !inboundContinuations.isEmpty {
            let cont = inboundContinuations.removeFirst()
            lock.unlock()
            cont.resume(returning: text)
            return
        }
        inboundBuffer.append(text)
        lock.unlock()
    }

    /// 模拟 socket 异常关闭（不是 client 主动调 close）— 触发自动重连路径
    func simulateClosed() {
        close()
    }

    func reset() {
        lock.lock()
        _sentMessages.removeAll()
        _pingCount = 0
        inboundBuffer.removeAll()
        lock.unlock()
    }
}
