import XCTest
@testable import CoreP2P

/// Phase 3.4 — `FileBrowserViewModel` 测试。
@MainActor
final class FileBrowserViewModelTests: XCTestCase {

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
        let vm: FileBrowserViewModel
        let inbound: InboundChannel
        let transport: FakeTransport
    }

    private func makeSetup(platform: String = "darwin") async -> Setup {
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "fbvm-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        let file = FileCommands(client: client)
        let vm = FileBrowserViewModel(
            pcPeerId: "pc-1",
            platform: platform,
            file: file,
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

    // MARK: - Tests

    func testRefreshPopulatesEntriesSortedDirsFirst() async throws {
        let s = await makeSetup()
        let refreshTask = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "path": "/Users/me",
            "entries": [
                ["name": "zfile.txt", "path": "/Users/me/zfile.txt", "isDirectory": false],
                ["name": "Apps", "path": "/Users/me/Apps", "isDirectory": true],
                ["name": "alpha", "path": "/Users/me/alpha", "isDirectory": false],
                ["name": "Docs", "path": "/Users/me/Docs", "isDirectory": true]
            ]
        ]))
        await refreshTask.value
        // 验证排序：目录先（按名 asc），然后文件（按名 asc）
        XCTAssertEqual(s.vm.entries.map { $0.name }, ["Apps", "Docs", "alpha", "zfile.txt"])
        XCTAssertEqual(s.vm.resolvedPath, "/Users/me")
    }

    func testNavigateToDirectoryUpdatesCurrentPath() async throws {
        let s = await makeSetup()
        // 初始 refresh
        let initial = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "path": "/Users/me",
            "entries": [["name": "Docs", "path": "/Users/me/Docs", "isDirectory": true]]
        ]))
        await initial.value

        // 进 Docs
        let navigate = Task { await s.vm.navigate(to: s.vm.entries[0]) }
        try await Task.sleep(nanoseconds: 50_000_000)
        // 第 2 笔 outbound = 进入新 path 后的 list
        let id2 = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: id2, result: [
            "path": "/Users/me/Docs", "entries": []
        ]))
        await navigate.value
        XCTAssertEqual(s.vm.resolvedPath, "/Users/me/Docs")
        XCTAssertEqual(s.vm.currentPath, "/Users/me/Docs")
    }

    func testNavigateUpFromSubdir() async throws {
        let s = await makeSetup()
        let initial = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "path": "/Users/me/Docs/Sub", "entries": []
        ]))
        await initial.value

        let up = Task { await s.vm.navigateUp() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id2 = try reqIdFrom(s.transport.dcSent[1])
        s.inbound.send(try responseRaw(reqId: id2, result: ["path": "/Users/me/Docs", "entries": []]))
        await up.value
        XCTAssertEqual(s.vm.currentPath, "/Users/me/Docs")
    }

    func testOpenTextFilePopulatesContent() async throws {
        let s = await makeSetup()
        let entry = FileEntry(name: "readme.md", path: "/Users/me/readme.md", isDirectory: false)

        let open = Task { await s.vm.openFile(entry) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "content": "# Hello\n",
            "encoding": "utf-8",
            "size": 8
        ]))
        await open.value
        XCTAssertEqual(s.vm.openedTextContent?.content, "# Hello\n")
        XCTAssertEqual(s.vm.openedFilePath, "/Users/me/readme.md")
    }

    func testOpenBinaryFileSetsError() async {
        let s = await makeSetup()
        let binEntry = FileEntry(name: "img.png", path: "/x.png", isDirectory: false)
        await s.vm.openFile(binEntry)
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("text") ?? false)
        XCTAssertEqual(s.transport.dcSent.count, 0, "不应发请求")
    }

    func testOpenDirectoryIsNoop() async {
        let s = await makeSetup()
        let dirEntry = FileEntry(name: "Docs", path: "/Docs", isDirectory: true)
        await s.vm.openFile(dirEntry)
        XCTAssertNil(s.vm.openedTextContent)
        XCTAssertEqual(s.transport.dcSent.count, 0)
    }

    func testCloseOpenedFileResetsState() async throws {
        let s = await makeSetup()
        let entry = FileEntry(name: "x.txt", path: "/x.txt", isDirectory: false)
        let open = Task { await s.vm.openFile(entry) }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "content": "abc", "encoding": "utf-8"
        ]))
        await open.value
        XCTAssertNotNil(s.vm.openedTextContent)
        s.vm.closeOpenedFile()
        XCTAssertNil(s.vm.openedTextContent)
        XCTAssertNil(s.vm.openedFilePath)
    }

    func testBreadcrumbSegmentsReflectsResolvedPath() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        s.inbound.send(try responseRaw(reqId: try reqIdFrom(s.transport.dcSent[0]), result: [
            "path": "/Users/me/Docs", "entries": []
        ]))
        await task.value
        XCTAssertEqual(s.vm.breadcrumbSegments(), ["Users", "me", "Docs"])
    }

    func testListErrorSetsLastError() async throws {
        let s = await makeSetup()
        let task = Task { await s.vm.refresh() }
        try await Task.sleep(nanoseconds: 50_000_000)
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": try reqIdFrom(s.transport.dcSent[0]), "error": "permission denied"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)
        await task.value
        XCTAssertNotNil(s.vm.lastError)
        XCTAssertTrue(s.vm.lastError?.contains("permission denied") ?? false)
    }
}
