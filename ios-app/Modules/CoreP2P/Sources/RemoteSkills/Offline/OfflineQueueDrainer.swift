import Foundation

/// 监听 dataChannelReady false→true edge 触发 OfflineCommandQueue.drain — Phase 3.2。
///
/// **架构动机**：网络断连期间 skill 调用 enqueue 进 `OfflineCommandQueue`，
/// 网络恢复时（DC 握手成功 / signaling 重连）需要尽快 drain 把 pending 命令补
/// 发出去。本类订阅 `RemoteWebRTCClient.dataChannelReady` AsyncStream，
/// detect false→true edge 时调 `queue.drain(client:, pcPeerId:)`。
///
/// **lifecycle**：`start()` 起 watch task；`stop()` cancel。idempotent。
///
/// **pcPeerIdProvider**：closure 让 caller 提供当前 active 桌面 peer-id（v0.1
/// 单 desktop session at a time，所以全局只有一个 active）。返 nil 时跳过 drain
/// （没 active 桌面就不 drain；命令留队列等下次）。
public final class OfflineQueueDrainer: @unchecked Sendable {

    private let queue: OfflineCommandQueue
    private let commandClient: RemoteCommandClient
    private let pcPeerIdProvider: @Sendable () async -> String?
    private let dataChannelReadyStream: AsyncStream<Bool>

    private let lock = NSLock()
    private var watchTask: Task<Void, Never>?
    private var lastReady: Bool = false

    public init(
        queue: OfflineCommandQueue,
        commandClient: RemoteCommandClient,
        pcPeerIdProvider: @escaping @Sendable () async -> String?,
        dataChannelReadyStream: AsyncStream<Bool>
    ) {
        self.queue = queue
        self.commandClient = commandClient
        self.pcPeerIdProvider = pcPeerIdProvider
        self.dataChannelReadyStream = dataChannelReadyStream
    }

    deinit {
        watchTask?.cancel()
    }

    /// 起监听。idempotent — 已起则 no-op。
    public func start() {
        lock.lock()
        guard watchTask == nil else { lock.unlock(); return }
        let stream = dataChannelReadyStream
        let weakSelf = WeakBox(self)
        let task = Task {
            for await ready in stream {
                guard let strongSelf = weakSelf.value else { return }
                await strongSelf.handleReadyChange(ready)
            }
        }
        watchTask = task
        lock.unlock()
    }

    /// 停监听。idempotent。
    public func stop() {
        lock.lock()
        watchTask?.cancel()
        watchTask = nil
        lock.unlock()
    }

    // MARK: - Private

    private func handleReadyChange(_ ready: Bool) async {
        let wasFalseToTrue: Bool
        lock.lock()
        wasFalseToTrue = !lastReady && ready
        lastReady = ready
        lock.unlock()

        guard wasFalseToTrue else { return }

        guard let pcPeerId = await pcPeerIdProvider() else {
            return  // 没 active 桌面 — 留命令在队列
        }
        _ = await queue.drain(client: commandClient, pcPeerId: pcPeerId)
    }
}

/// Weak-ref helper — Task 闭包持 strong self 会延迟 deinit；用 box 包成 weak。
private final class WeakBox<T: AnyObject>: @unchecked Sendable {
    weak var value: T?
    init(_ value: T) { self.value = value }
}
