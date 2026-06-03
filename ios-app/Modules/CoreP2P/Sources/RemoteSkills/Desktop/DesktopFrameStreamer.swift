import Foundation

/// 远程桌面 frame 流式拉取 — Phase 6.6.3 (sub-phase 3 of 6)。
///
/// 实现 Phase 6.6 doc §4.4 状态机：Idle → Streaming → Stopped/Error。
///
/// **协议**（OQ-1 A v0.1, OQ-2 B, OQ-7 A）：
/// - **Pull-based**: 内部 Task 循环调 `getFrameFn(sessionId)` 拉帧
/// - **In-flight = 1**: Task 顺序 await — 前一次响应不来不发下一次 (天然信号量)
/// - **Drop-old cap=1**: AsyncStream(bufferingPolicy: .bufferingNewest(1)) —
///   消费者 (SwiftUI) 慢 → 旧 frame 自动丢，最新 frame 总存在
/// - **错误退避 (Trap D6)**: 收 "Frame rate limit exceeded" → 退避 backoffMs 重试；
///   **任意** 错误连续 > maxConsecutiveErrors 次 → 切 .error 状态 + finish stream
///
/// **caller 用法**：
/// ```swift
/// let streamer = DesktopFrameStreamer(
///     getFrameFn: { sessionId in
///         try await desktop.getFrame(pcPeerId: pc, sessionId: sessionId)
///     }
/// )
/// await streamer.start(sessionId: "S1")
/// for await frame in await streamer.frames {
///     // 渲染 frame.data (base64 JPEG)
/// }
/// // 退出
/// await streamer.stop()
/// ```
public actor DesktopFrameStreamer {

    public enum State: Sendable, Equatable {
        case idle
        case streaming(sessionId: String)
        case stopped
        case error(message: String)
    }

    public typealias GetFrameFn = @Sendable (String) async throws -> DesktopFrameResponse

    private let getFrameFn: GetFrameFn
    private let backoffMs: UInt64
    private let maxConsecutiveErrors: Int

    private var currentState: State = .idle
    private var loopTask: Task<Void, Never>? = nil
    private var consecutiveErrorCount: Int = 0
    private var framesReceived: Int = 0

    // AsyncStream 容量 1 + drop-old (OQ-7 A) — 消费者慢时旧 frame 自动丢
    private let framesContinuation: AsyncStream<DesktopFrameResponse>.Continuation
    public nonisolated let frames: AsyncStream<DesktopFrameResponse>

    public init(
        getFrameFn: @escaping GetFrameFn,
        backoffMs: UInt64 = 50,
        maxConsecutiveErrors: Int = 5
    ) {
        self.getFrameFn = getFrameFn
        self.backoffMs = backoffMs
        self.maxConsecutiveErrors = maxConsecutiveErrors

        var local: AsyncStream<DesktopFrameResponse>.Continuation!
        self.frames = AsyncStream(bufferingPolicy: .bufferingNewest(1)) { c in
            local = c
        }
        self.framesContinuation = local
    }

    // MARK: - Public API

    /// 当前状态（read-only snapshot — 不参与状态机转换）。
    public func state() -> State { currentState }

    /// 已收 frame 数 (running counter)。
    public func receivedCount() -> Int { framesReceived }

    /// 启动 streaming。从 .idle 转 .streaming(sessionId)，起 pull loop Task。
    /// 重复 start 同 sessionId = no-op；不同 sessionId = log warn (caller 应先 stop)。
    public func start(sessionId: String) {
        guard !sessionId.isEmpty else { return }
        switch currentState {
        case .streaming(let existing):
            if existing == sessionId { return }   // no-op
            // 不同 sessionId → 关旧的，开新的
            stopInternal()
            currentState = .streaming(sessionId: sessionId)
            startLoop(sessionId: sessionId)
        case .idle, .stopped, .error:
            currentState = .streaming(sessionId: sessionId)
            consecutiveErrorCount = 0
            startLoop(sessionId: sessionId)
        }
    }

    /// 停止 streaming。从 .streaming 转 .stopped；finish frames stream。
    /// 幂等：从 .stopped / .idle / .error 调亦不报错 (no-op)。
    public func stop() {
        stopInternal()
        if case .streaming = currentState {
            currentState = .stopped
        }
    }

    // MARK: - Internal

    private func stopInternal() {
        loopTask?.cancel()
        loopTask = nil
    }

    private func startLoop(sessionId: String) {
        loopTask = Task { [weak self] in
            await self?.runLoop(sessionId: sessionId)
        }
    }

    private func runLoop(sessionId: String) async {
        while !Task.isCancelled {
            // 检查 state — 用户调 stop 时退出（双重保险）
            switch currentState {
            case .streaming(let active) where active == sessionId:
                break  // 继续循环
            default:
                return  // state 变了，退出
            }

            do {
                let frame = try await getFrameFn(sessionId)
                if Task.isCancelled { return }
                framesContinuation.yield(frame)
                framesReceived += 1
                consecutiveErrorCount = 0
            } catch {
                if Task.isCancelled { return }
                let msg = (error as? RemoteSkillError).flatMap {
                    if case .remoteError(_, let m) = $0 { return m }
                    return nil
                } ?? error.localizedDescription

                consecutiveErrorCount += 1

                // Trap D6: 连续错误超阈值 → fatal
                if consecutiveErrorCount > maxConsecutiveErrors {
                    let detail = "Too many consecutive errors (\(consecutiveErrorCount)); last: \(msg)"
                    currentState = .error(message: detail)
                    framesContinuation.finish()
                    return
                }

                // Rate-limit / 一般错误都走退避
                try? await Task.sleep(nanoseconds: backoffMs * 1_000_000)
            }
        }
    }
}
