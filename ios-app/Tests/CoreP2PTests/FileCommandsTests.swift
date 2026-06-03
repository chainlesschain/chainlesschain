import XCTest
@testable import CoreP2P

/// Phase 3.4 — `FileCommands` typed wrapper 测试。
final class FileCommandsTests: XCTestCase {

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
        let cmds: FileCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "fc-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: FileCommands(client: client), inbound: inbound, transport: transport)
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

    // MARK: - list

    func testListDecodesEntries() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.list(pcPeerId: "pc", path: "/Users/me") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "file.listDirectory")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["path"] as? String, "/Users/me")
        XCTAssertEqual(params["showHidden"] as? Bool, false)

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "path": "/Users/me",
            "entries": [
                ["name": "Documents", "path": "/Users/me/Documents", "isDirectory": true],
                ["name": "readme.md", "path": "/Users/me/readme.md", "isDirectory": false, "size": 1024, "modified": 1700000000000]
            ]
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.path, "/Users/me")
        XCTAssertEqual(resp.entries.count, 2)
        XCTAssertTrue(resp.entries[0].isDirectory)
        XCTAssertEqual(resp.entries[1].size, 1024)
        XCTAssertEqual(resp.entries[1].fileExtension, "md")
    }

    func testListEmptyPathDefaultsHome() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.list(pcPeerId: "pc") }  // path 默认 ""
        try await Task.sleep(nanoseconds: 50_000_000)
        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["path"] as? String, "")  // 桌面端会解 home

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: ["path": "/Users/me", "entries": []]))
        let resp = try await task.value
        XCTAssertEqual(resp.path, "/Users/me")
        XCTAssertEqual(resp.entries.count, 0)
    }

    func testListErrorThrowsRemoteError() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.list(pcPeerId: "pc", path: "/nonexistent") }
        try await Task.sleep(nanoseconds: 50_000_000)
        let id = try reqIdFrom(s.transport.dcSent[0])
        let err: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": id, "error": "ENOENT"]
        ]
        s.inbound.send(String(data: try JSONSerialization.data(withJSONObject: err), encoding: .utf8)!)

        do {
            _ = try await task.value
            XCTFail("expected throw")
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "ENOENT")
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - read

    func testReadTextDecodesContent() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.readText(pcPeerId: "pc", path: "/Users/me/readme.md") }
        try await Task.sleep(nanoseconds: 50_000_000)

        let outDict = try JSONSerialization.jsonObject(with: Data(s.transport.dcSent[0].utf8)) as! [String: Any]
        let payload = outDict["payload"] as! [String: Any]
        XCTAssertEqual(payload["method"] as? String, "file.readFile")
        let params = payload["params"] as! [String: Any]
        XCTAssertEqual(params["encoding"] as? String, "utf-8")

        let id = try reqIdFrom(s.transport.dcSent[0])
        s.inbound.send(try responseRaw(reqId: id, result: [
            "content": "# Hello\n",
            "encoding": "utf-8",
            "size": 8
        ]))
        let resp = try await task.value
        XCTAssertEqual(resp.content, "# Hello\n")
        XCTAssertEqual(resp.encoding, "utf-8")
        XCTAssertEqual(resp.size, 8)
    }

    func testReadEmptyPathThrowsInvalidArgument() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.readText(pcPeerId: "pc", path: "")
            XCTFail("expected throw")
        } catch RemoteSkillError.invalidArgument {
            // ok
        } catch {
            XCTFail("wrong: \(error)")
        }
    }

    // MARK: - FileEntry helpers

    func testFileEntryTextLikeExtensionDetect() {
        let md = FileEntry(name: "readme.md", path: "/x.md", isDirectory: false)
        let bin = FileEntry(name: "img.png", path: "/x.png", isDirectory: false)
        let dir = FileEntry(name: "Docs", path: "/Docs", isDirectory: true)
        XCTAssertTrue(md.isLikelyTextFile)
        XCTAssertFalse(bin.isLikelyTextFile)
        XCTAssertFalse(dir.isLikelyTextFile)
        XCTAssertEqual(md.fileExtension, "md")
        XCTAssertEqual(bin.fileExtension, "png")
        XCTAssertNil(dir.fileExtension)
    }
}
