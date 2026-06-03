import XCTest
@testable import CoreP2P

/// Phase 6.6.3 — `DesktopFrameStreamer` actor 测试（pull loop + 退避 + drop-old）。
final class DesktopFrameStreamerTests: XCTestCase {

    // 通用 mock getFrame：使用 actor-isolated counter 控制返成功/失败/序列
    private actor FrameSource {
        var callCount: Int = 0
        var maxCalls: Int = Int.max
        var errorAtCalls: Set<Int> = []
        var errorMessage: String = "Frame rate limit exceeded"
        var sleepNsBeforeReturn: UInt64 = 0  // 模拟慢响应

        func setup(maxCalls: Int? = nil, errorAt: Set<Int> = [],
                   errorMessage: String? = nil, sleepNs: UInt64 = 0) {
            if let m = maxCalls { self.maxCalls = m }
            self.errorAtCalls = errorAt
            if let msg = errorMessage { self.errorMessage = msg }
            self.sleepNsBeforeReturn = sleepNs
        }

        func getFrame(sessionId: String) async throws -> DesktopFrameResponse {
            callCount += 1
            let n = callCount
            if errorAtCalls.contains(n) {
                throw RemoteSkillError.remoteError(reqId: "r\(n)", message: errorMessage)
            }
            if n > maxCalls {
                throw RemoteSkillError.remoteError(reqId: "r\(n)", message: "max reached")
            }
            if sleepNsBeforeReturn > 0 {
                try await Task.sleep(nanoseconds: sleepNsBeforeReturn)
            }
            return DesktopFrameResponse(
                success: true,
                data: "frame\(n)",
                format: "jpeg",
                width: 1920, height: 1080,
                size: 1000 + n
            )
        }

        func count() -> Int { callCount }
    }

    // MARK: - Helper

    private func makeStreamer(
        source: FrameSource,
        backoffMs: UInt64 = 10,
        maxConsecutiveErrors: Int = 5
    ) -> DesktopFrameStreamer {
        return DesktopFrameStreamer(
            getFrameFn: { sessionId in
                try await source.getFrame(sessionId: sessionId)
            },
            backoffMs: backoffMs,
            maxConsecutiveErrors: maxConsecutiveErrors
        )
    }

    private func collectFrames(
        from streamer: DesktopFrameStreamer,
        count: Int,
        timeoutSec: Double = 2.0
    ) async -> [DesktopFrameResponse] {
        var collected: [DesktopFrameResponse] = []
        let task = Task { () -> [DesktopFrameResponse] in
            for await frame in await streamer.frames {
                collected.append(frame)
                if collected.count >= count { break }
            }
            return collected
        }
        let result = await withTaskGroup(of: [DesktopFrameResponse].self) { group in
            group.addTask { await task.value }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeoutSec * 1_000_000_000))
                task.cancel()
                return []
            }
            let first = await group.next() ?? []
            group.cancelAll()
            return first
        }
        return result
    }

    // MARK: - 启动 + 状态

    func testInitialStateIsIdle() async {
        let source = FrameSource()
        let streamer = makeStreamer(source: source)
        let st = await streamer.state()
        XCTAssertEqual(st, .idle)
    }

    func testStartTransitionsToStreaming() async {
        let source = FrameSource()
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")
        let st = await streamer.state()
        if case .streaming(let id) = st {
            XCTAssertEqual(id, "S1")
        } else {
            XCTFail("Expected .streaming(S1), got \(st)")
        }
        await streamer.stop()
    }

    func testStartEmptySessionIdIgnored() async {
        let source = FrameSource()
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "")
        XCTAssertEqual(await streamer.state(), .idle)
    }

    // MARK: - Frame 拉取

    func testReceivesFramesInOrder() async {
        let source = FrameSource()
        await source.setup(maxCalls: 5)
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")

        let frames = await collectFrames(from: streamer, count: 3)
        await streamer.stop()

        XCTAssertGreaterThanOrEqual(frames.count, 3)
        // 收到的 frame 是按 yield 顺序传递的 (drop-old 可能跳号，但顺序保 monotonic)
        XCTAssertEqual(frames[0].data, "frame1")
        // frames[1] 可能是 frame2 也可能因 drop-old 跳到 frame3+；只验单调递增
        for i in 1..<frames.count {
            let prev = Int(frames[i - 1].data.replacingOccurrences(of: "frame", with: "")) ?? 0
            let curr = Int(frames[i].data.replacingOccurrences(of: "frame", with: "")) ?? 0
            XCTAssertGreaterThan(curr, prev, "Frame data should be monotonically increasing")
        }
    }

    func testStopCancelsLoop() async throws {
        let source = FrameSource()
        await source.setup(sleepNs: 50_000_000)  // 50ms per frame
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")

        try await Task.sleep(nanoseconds: 200_000_000)  // 200ms
        await streamer.stop()
        let countAfterStop = await source.count()

        try await Task.sleep(nanoseconds: 200_000_000)  // 再等 200ms
        let countLater = await source.count()

        // stop 后 count 不应再增长 (允许 +1 容忍 in-flight 完成)
        XCTAssertLessThanOrEqual(countLater - countAfterStop, 1,
                                 "stop should halt the loop")
        XCTAssertEqual(await streamer.state(), .stopped)
    }

    // MARK: - 错误退避

    func testRateLimitErrorTriggersBackoffAndRetry() async throws {
        let source = FrameSource()
        // 第 1, 2 call 报 rate limit，第 3 起成功
        await source.setup(maxCalls: 10, errorAt: [1, 2],
                           errorMessage: "Frame rate limit exceeded. Wait 12ms")
        let streamer = makeStreamer(source: source, backoffMs: 10)
        await streamer.start(sessionId: "S1")

        let frames = await collectFrames(from: streamer, count: 1, timeoutSec: 2.0)
        await streamer.stop()

        XCTAssertGreaterThanOrEqual(frames.count, 1, "Should recover after backoff")
        // 第 1 个成功 frame 应来自 call 3 之后
        let firstNum = Int(frames[0].data.replacingOccurrences(of: "frame", with: "")) ?? 0
        XCTAssertGreaterThanOrEqual(firstNum, 3)
    }

    func testConsecutiveErrorsTriggerFatalState() async throws {
        let source = FrameSource()
        // 前 10 次全错 (> maxConsecutiveErrors=3) → 触发 fatal
        await source.setup(maxCalls: 100, errorAt: Set(1...10),
                           errorMessage: "some persistent error")
        let streamer = makeStreamer(source: source, backoffMs: 5, maxConsecutiveErrors: 3)
        await streamer.start(sessionId: "S1")

        // 等足够时间让 4+ 错误累积 (4 × 5ms + buffer)
        try await Task.sleep(nanoseconds: 200_000_000)
        let st = await streamer.state()
        if case .error(let msg) = st {
            XCTAssertTrue(msg.contains("Too many consecutive errors"))
            XCTAssertTrue(msg.contains("persistent error"))
        } else {
            XCTFail("Expected .error after consecutive failures, got \(st)")
        }

        // frames stream 应已 finish — for-await 立即结束
        var stillEmitting = false
        let task = Task {
            for await _ in await streamer.frames {
                stillEmitting = true
                break
            }
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        task.cancel()
        XCTAssertFalse(stillEmitting, "stream should be finished after fatal")
    }

    func testTransientErrorsDoNotTriggerFatal() async throws {
        let source = FrameSource()
        // 第 1, 3, 5 错 (中间有成功，重置 consecutive counter)
        await source.setup(maxCalls: 20, errorAt: [1, 3, 5])
        let streamer = makeStreamer(source: source, backoffMs: 5, maxConsecutiveErrors: 3)
        await streamer.start(sessionId: "S1")

        let frames = await collectFrames(from: streamer, count: 3, timeoutSec: 2.0)
        let st = await streamer.state()

        // 不应该是 .error — 每次错误后下次成功重置计数
        if case .error = st {
            XCTFail("Should not be .error: transient errors are reset by successes; got \(st)")
        }
        XCTAssertGreaterThanOrEqual(frames.count, 3)
        await streamer.stop()
    }

    // MARK: - 多 session 切换

    func testRestartWithSameSessionIsNoOp() async throws {
        let source = FrameSource()
        await source.setup(sleepNs: 30_000_000)
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")
        try await Task.sleep(nanoseconds: 50_000_000)
        let count1 = await source.count()

        // 再 start 同 sessionId — 应该 no-op，不重启 loop
        await streamer.start(sessionId: "S1")
        try await Task.sleep(nanoseconds: 50_000_000)
        let count2 = await source.count()

        // count2 应该是 count1 自然增长（不重置）— 不验严格数字 (timing flaky)，
        // 只验状态保持 streaming(S1)
        XCTAssertGreaterThan(count2, 0)
        if case .streaming(let id) = await streamer.state() {
            XCTAssertEqual(id, "S1")
        } else {
            XCTFail("Should still be streaming S1")
        }
        await streamer.stop()
    }

    func testRestartWithDifferentSessionSwitchesLoop() async throws {
        let source = FrameSource()
        await source.setup(sleepNs: 30_000_000)
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")
        try await Task.sleep(nanoseconds: 50_000_000)

        // 切到不同 sessionId — 应停旧 loop 开新 loop
        await streamer.start(sessionId: "S2")
        if case .streaming(let id) = await streamer.state() {
            XCTAssertEqual(id, "S2")
        } else {
            XCTFail("Should be streaming S2")
        }
        await streamer.stop()
    }

    // MARK: - 幂等性

    func testStopFromIdleIsNoOp() async {
        let streamer = makeStreamer(source: FrameSource())
        await streamer.stop()
        XCTAssertEqual(await streamer.state(), .idle)  // 仍 idle
    }

    func testDoubleStopIsNoOp() async {
        let source = FrameSource()
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")
        await streamer.stop()
        await streamer.stop()
        XCTAssertEqual(await streamer.state(), .stopped)
    }

    // MARK: - 计数

    func testReceivedCountIncrements() async throws {
        let source = FrameSource()
        await source.setup(maxCalls: 5)
        let streamer = makeStreamer(source: source)
        await streamer.start(sessionId: "S1")

        _ = await collectFrames(from: streamer, count: 3)
        await streamer.stop()

        let count = await streamer.receivedCount()
        XCTAssertGreaterThanOrEqual(count, 3)
    }
}
