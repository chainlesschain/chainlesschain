import Foundation

/// Production `RemoteSessionWebSocket` backed by `URLSessionWebSocketTask`.
/// The `RemoteSessionClient` protocol logic is transport-agnostic and unit-tested
/// with a fake socket; this is the thin glue that speaks to a real relay. Delegate
/// callbacks (open/close) + a self-rescheduling receive loop are funneled into the
/// same `RemoteSessionWebSocketListener` surface the Android okhttp factory uses.
public final class URLSessionRemoteSessionWebSocket: NSObject, RemoteSessionWebSocket, URLSessionWebSocketDelegate {

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private weak var listener: RemoteSessionWebSocketListener?
    private var closed = false

    /// Factory matching `RemoteSessionWebSocketFactory`: opens the relay and starts
    /// the receive loop. Pass this to `RemoteSessionClient(webSocketFactory:)`.
    public static func factory(
        configuration: URLSessionConfiguration = .default
    ) -> RemoteSessionWebSocketFactory {
        { url, listener in
            URLSessionRemoteSessionWebSocket.connect(
                url: url,
                listener: listener,
                configuration: configuration
            )
        }
    }

    @discardableResult
    public static func connect(
        url: String,
        listener: RemoteSessionWebSocketListener,
        configuration: URLSessionConfiguration = .default
    ) -> URLSessionRemoteSessionWebSocket {
        let socket = URLSessionRemoteSessionWebSocket()
        socket.listener = listener
        guard let parsed = URL(string: url) else {
            listener.webSocket(socket, didFailWithError: URLError(.badURL))
            return socket
        }
        let session = URLSession(configuration: configuration, delegate: socket, delegateQueue: nil)
        let task = session.webSocketTask(with: parsed)
        socket.session = session
        socket.task = task
        task.resume()
        socket.receiveNext()
        return socket
    }

    // MARK: RemoteSessionWebSocket

    public func send(_ text: String) {
        task?.send(.string(text)) { [weak self] error in
            guard let self, let error else { return }
            self.listener?.webSocket(self, didFailWithError: error)
        }
    }

    public func close(code: Int, reason: String) {
        closed = true
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        task?.cancel(with: closeCode, reason: reason.data(using: .utf8))
        session?.finishTasksAndInvalidate()
    }

    // MARK: Receive loop

    private func receiveNext() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.listener?.webSocket(self, didReceiveText: text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.listener?.webSocket(self, didReceiveText: text)
                    }
                @unknown default:
                    break
                }
                if !self.closed { self.receiveNext() }
            case .failure(let error):
                if !self.closed { self.listener?.webSocket(self, didFailWithError: error) }
            }
        }
    }

    // MARK: URLSessionWebSocketDelegate

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        listener?.webSocketDidOpen(self)
    }

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        let text = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        listener?.webSocket(self, didCloseWithCode: closeCode.rawValue, reason: text)
    }
}
