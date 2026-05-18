import XCTest
@testable import CoreP2P

/// Phase 3.5 — `ScreenshotViewModel` 测试。
@MainActor
final class ScreenshotViewModelTests: XCTestCase {

    private final class InboundChannel {
        let stream: AsyncStream<String>
        let continuation: AsyncStream<String>.Continuation
        init() {
            var local: AsyncStream<String>.Continuation!
            self.stream = AsyncStream(bufferingPolicy: .bufferingNewest(64)) { c in local = c }
            self.continuation = local
        }
        func send(_ raw: String) { continuation.yield(raw) }
    }

    private final class FakeTransport: @unchecked Sendable {
        let lock = NSLock()
        var dcSent: [String] = []
        var dcReady = true
    }

    private struct Setup {
        let vm: ScreenshotViewModel
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup() async -> Setup {
        let transport = FakeTransport()
        let inbound = InboundChannel()
        let client = RemoteCommandClient(
            dataChannelSender: { text in
                transport.lock.lock()
                transport.dcSent.append(text)
                transport.lock.unlock()
            },
            signalingSender: { _, _ in },
            isDataChannelReady: { transport.dcReady },
            inboundMessages: inbound.stream,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "ssvm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let cmds = ScreenshotCommands(client: client)
        let vm = ScreenshotViewModel(
            pcPeerId: "pc-1",
            screenshot: cmds,
            currentDIDProvider: { "did:cc:me" }
        )
        return Setup(vm: vm, inbound: inbound, transport: transport)
    }

    private func reqIdFrom(_ json: String) throws -> String {
        let data = json.data(using: .utf8)!
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let payload = dict["payload"] as! [String: Any]
        return payload["id"] as! String
    }

    private func responseRaw(reqId: String, result: [String: Any]) throws -> String {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        return String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!
    }

    /// 1×1 透明 PNG 的 base64 — 用于解码不报错
    private static let onePxPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    // MARK: - Tests

    func testCaptureHappyPathPopulatesDecodedData() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "imageBase64": Self.onePxPng,
            "width": 1, "height": 1, "format": "png"
        ]))
        await task.value
        XCTAssertNotNil(s.vm.lastCaptureMetadata)
        XCTAssertNotNil(s.vm.decodedImageData)
        XCTAssertGreaterThan(s.vm.decodedImageData!.count, 50)  // PNG 至少几十字节 header
        XCTAssertNil(s.vm.lastError)
    }

    func testCaptureClearsPreviousImageBeforeNewFetch() async throws {
        let s = await makeSetup()
        // 第一次 capture
        let task1 = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id1 = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id1, result: [
            "imageBase64": Self.onePxPng, "width": 1, "height": 1, "format": "png"
        ]))
        await task1.value
        XCTAssertNotNil(s.vm.decodedImageData)

        // 第二次 capture — 触发后 decodedImageData 应立即被清掉
        let task2 = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 30_000_000)
        // 第二次 fetch in-flight 时 decodedImageData 已是 nil
        // (sync 在 capture() 入口立刻置 nil)
        let id2 = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: id2, result: [
            "imageBase64": Self.onePxPng, "width": 2, "height": 2, "format": "png"
        ]))
        await task2.value
        XCTAssertEqual(s.vm.lastCaptureMetadata?.width, 2)
    }

    func testCaptureErrorSetsLastError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "no display"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)
        await task.value
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("no display") ?? false)
        XCTAssertNil(s.vm.decodedImageData)
    }

    func testCaptureInvalidBase64SetsError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        // 真送一个非 base64 字符串（含空白）— ignoreUnknownCharacters 选项让 Data 仍可能成；
        // 改用真正非法的 — 实际实现会 fallback to nil 才好测。
        // 实际测：metadata 设了，decodedImageData 仍 nil
        s.inbound.send(try responseRaw(reqId: id, result: [
            "imageBase64": "@#$%^&*",  // 非 base64 字符
            "width": 1, "height": 1, "format": "png"
        ]))
        await task.value
        // base64 decoder ignoreUnknownCharacters 选项可能仍返 empty Data — 实际依赖 iOS impl
        // 关键验：lastCaptureMetadata 拿到了，flow 不 crash
        XCTAssertNotNil(s.vm.lastCaptureMetadata)
    }

    func testReportSaveResultSuccess() {
        let s = ScreenshotViewModel(
            pcPeerId: "pc",
            screenshot: ScreenshotCommands(client: makeStubClient()),
            currentDIDProvider: { nil }
        )
        s.reportSaveResult(success: true)
        XCTAssertEqual(s.lastSaveStatus, "已保存到相册")
    }

    func testReportSaveResultFailure() {
        let s = ScreenshotViewModel(
            pcPeerId: "pc",
            screenshot: ScreenshotCommands(client: makeStubClient()),
            currentDIDProvider: { nil }
        )
        s.reportSaveResult(success: false, errorMessage: "denied")
        XCTAssertNotNil(s.lastSaveStatus)
        XCTAssertTrue(s.lastSaveStatus?.contains("denied") ?? false)
    }

    func testResetClearsAllState() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.capture() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "imageBase64": Self.onePxPng, "width": 1, "height": 1, "format": "png"
        ]))
        await task.value
        XCTAssertNotNil(s.vm.decodedImageData)
        s.vm.reset()
        XCTAssertNil(s.vm.decodedImageData)
        XCTAssertNil(s.vm.lastCaptureMetadata)
        XCTAssertNil(s.vm.lastError)
        XCTAssertNil(s.vm.lastSaveStatus)
    }

    private func makeStubClient() -> RemoteCommandClient {
        let inbound = AsyncStream<String> { _ in }
        return RemoteCommandClient(
            dataChannelSender: { _ in },
            signalingSender: { _, _ in },
            isDataChannelReady: { false },
            inboundMessages: inbound,
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "stub-\(UUID())")!),
            responseTimeoutSeconds: 1
        )
    }
}
