import XCTest
@testable import CoreP2P

/// Phase 3.3 — `ClipboardViewModel` 测试。
@MainActor
final class ClipboardViewModelTests: XCTestCase {

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
        var dcReady: Bool = true
    }

    private struct Setup {
        let vm: ClipboardViewModel
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup(currentDID: String? = "did:cc:me") async -> Setup {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "cbvm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let cmds = ClipboardCommands(client: client)
        let vm = ClipboardViewModel(
            pcPeerId: "pc-1",
            clipboard: cmds,
            currentDIDProvider: { currentDID }
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

    // MARK: - copyFromDesktop

    func testCopyFromDesktopHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.copyFromDesktop() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["content": "from desktop", "type": "text"]))
        await task.value

        XCTAssertEqual(s.vm.lastFetchedContent?.content, "from desktop")
        XCTAssertNil(s.vm.lastError)
        XCTAssertFalse(s.vm.busy)
    }

    func testCopyFromDesktopErrorSetsLastError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.copyFromDesktop() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "denied"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)
        await task.value

        XCTAssertNil(s.vm.lastFetchedContent)
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("denied") ?? false)
    }

    // MARK: - pasteToDesktop

    func testPasteToDesktopHappyPath() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.pasteToDesktop(content: "hello") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": true, "bytesWritten": 5]))
        await task.value

        XCTAssertNil(s.vm.lastError)
        XCTAssertEqual(s.vm.lastSentBytes, 5)
        XCTAssertFalse(s.vm.busy)
    }

    func testPasteEmptyContentSkipsAndSetsError() async {
        let s = await makeSetup()
        await s.vm.pasteToDesktop(content: "")
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("内容为空") ?? false)
        XCTAssertEqual(s.transport.dcSent.count, 0)
    }

    func testPasteOkFalseSetsError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.pasteToDesktop(content: "x") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["ok": false]))
        await task.value
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("ok=false") ?? false)
    }

    // MARK: - state helpers

    func testClearErrorResetsLastError() async {
        let s = await makeSetup()
        await s.vm.pasteToDesktop(content: "")  // 触发 error
        XCTAssertNotNil(s.vm.lastError)
        s.vm.clearError()
        XCTAssertNil(s.vm.lastError)
    }

    func testClearFetchedResetsContent() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.copyFromDesktop() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["content": "x", "type": "text"]))
        await task.value
        XCTAssertNotNil(s.vm.lastFetchedContent)
        s.vm.clearFetched()
        XCTAssertNil(s.vm.lastFetchedContent)
    }
}
