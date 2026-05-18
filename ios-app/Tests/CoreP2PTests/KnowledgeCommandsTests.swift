import XCTest
@testable import CoreP2P

/// Phase 6.3 — `KnowledgeCommands` (`knowledge` namespace) typed wrapper 测试。
/// 桌面 30 method + iOS getNote alias = 31 wrap method 全套。
final class KnowledgeCommandsTests: XCTestCase {

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
        let cmds: KnowledgeCommands
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
            featureFlags: PlanA1FeatureFlags(defaults: UserDefaults(suiteName: "knowledge-\(UUID())")!),
            responseTimeoutSeconds: 2
        )
        await client.start()
        return Setup(cmds: KnowledgeCommands(client: client), inbound: inbound, transport: transport)
    }

    private func reqId(_ json: String) throws -> String {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return ((d["payload"] as! [String: Any])["id"] as! String)
    }

    private func payload(_ json: String) throws -> [String: Any] {
        let d = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!) as! [String: Any]
        return d["payload"] as! [String: Any]
    }

    private func respond(_ inbound: InboundChannel, reqId: String, result: [String: Any]) throws {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "result": result]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    private func respondFailure(_ inbound: InboundChannel, reqId: String, message: String) throws {
        let env: [String: Any] = [
            "type": "chainlesschain:command:response",
            "payload": ["id": reqId, "error": ["message": message]]
        ]
        inbound.send(String(data: try JSONSerialization.data(withJSONObject: env), encoding: .utf8)!)
    }

    private func waitForSend(_ s: Setup, count: Int = 1) async throws {
        var attempts = 0
        while attempts < 40 {
            s.transport.lock.lock()
            let n = s.transport.dcSent.count
            s.transport.lock.unlock()
            if n >= count { return }
            try await Task.sleep(nanoseconds: 10_000_000)
            attempts += 1
        }
        XCTFail("did not see \(count) sends")
    }

    // MARK: - CRUD 基础

    func testCreateNoteEnvelopeAndDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.createNote(
                pcPeerId: "pc", title: "T", content: "Body", tags: ["a", "b"]
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.createNote")
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["title"] as? String, "T")
        XCTAssertEqual(params["content"] as? String, "Body")
        XCTAssertEqual(params["tags"] as? [String], ["a", "b"])

        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "noteId": 42, "title": "T", "message": "ok"
        ])
        let r = try await task.value
        XCTAssertEqual(r.noteId, "42") // 整数→String 标准化
        XCTAssertEqual(r.title, "T")
    }

    func testCreateNoteEmptyTitleThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.createNote(pcPeerId: "pc", title: "", content: "x")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testCreateNoteEmptyContentThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.createNote(pcPeerId: "pc", title: "T", content: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testSearchNotesDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.searchNotes(pcPeerId: "pc", query: "hello")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "results": [
                ["id": 1, "title": "N1", "content": "hello world", "tags": "[\"x\"]"],
                ["id": 2, "title": "N2", "content": "hello!"]
            ],
            "total": 2
        ])
        let r = try await task.value
        XCTAssertEqual(r.total, 2)
        XCTAssertEqual(r.notes[0].id, "1")
        XCTAssertEqual(r.notes[0].title, "N1")
        XCTAssertEqual(r.notes[0].tags, ["x"]) // 桌面返字符串 JSON → 解析成数组
    }

    func testSearchNotesEmptyQueryThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.searchNotes(pcPeerId: "pc", query: "")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testGetNoteByIdDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getNoteById(pcPeerId: "pc", noteId: "5")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.getNoteById")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "id": 5, "title": "T", "content": "Body", "tags": "[]",
            "starred": 1, "pinned": 0, "archived": 0, "folder_id": nil,
            "created_at": 1_700_000_000_000, "updated_at": 1_700_000_001_000
        ])
        let r = try await task.value
        XCTAssertEqual(r.note.id, "5")
        XCTAssertEqual(r.note.starred, true)
        XCTAssertEqual(r.note.pinned, false)
        XCTAssertEqual(r.note.createdAt, 1_700_000_000_000)
    }

    func testGetNoteUsesAliasMethodName() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getNote(pcPeerId: "pc", noteId: "9")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.getNote")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "id": 9, "title": "T", "tags": "[]"
        ])
        let r = try await task.value
        XCTAssertEqual(r.note.id, "9")
    }

    func testGetTagsDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getTags(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["tags": ["work", "personal", "ideas"], "total": 3])
        let r = try await task.value
        XCTAssertEqual(r.tags, ["work", "personal", "ideas"])
    }

    func testUpdateNoteOmitsUnsetParams() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.updateNote(pcPeerId: "pc", noteId: "3", content: "New body")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["noteId"] as? String, "3")
        XCTAssertEqual(params["content"] as? String, "New body")
        XCTAssertNil(params["title"])
        XCTAssertNil(params["tags"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 3, "message": "ok"])
        let r = try await task.value
        XCTAssertEqual(r.noteId, "3")
    }

    func testDeleteNoteEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.deleteNote(pcPeerId: "pc", noteId: "7") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.deleteNote")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 7, "message": "ok"])
        let r = try await task.value
        XCTAssertEqual(r.noteId, "7")
    }

    func testGetNotesByTagEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getNotesByTag(pcPeerId: "pc", tag: "work", limit: 20)
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["tag"] as? String, "work")
        XCTAssertEqual(params["limit"] as? Int, 20)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "results": [["id": 1, "title": "T", "tags": "[\"work\"]"]],
            "total": 1, "tag": "work"
        ])
        let r = try await task.value
        XCTAssertEqual(r.tag, "work")
        XCTAssertEqual(r.notes.count, 1)
    }

    func testSyncNoteVectorizeFlag() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.syncNote(pcPeerId: "pc", noteId: "1", vectorize: true)
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual((p["params"] as! [String: Any])["vectorize"] as? Bool, true)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "message": "ok", "vectorized": true])
        let r = try await task.value
        XCTAssertTrue(r.vectorized)
    }

    // MARK: - getNotes 通用 list

    func testGetNotesIncludesFolderIdWhenSet() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getNotes(pcPeerId: "pc", limit: 10, folderId: "folder-1")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["folderId"] as? String, "folder-1")
        XCTAssertEqual(params["limit"] as? Int, 10)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        let r = try await task.value
        XCTAssertEqual(r.total, 0)
    }

    // MARK: - Folders

    func testGetFoldersDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getFolders(pcPeerId: "pc") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "folders": [
                ["id": "f1", "name": "Inbox", "parent_id": nil, "created_at": 100],
                ["id": "f2", "name": "Archive", "parent_id": "f1", "created_at": 200]
            ],
            "total": 2
        ])
        let r = try await task.value
        XCTAssertEqual(r.folders.count, 2)
        XCTAssertEqual(r.folders[0].name, "Inbox")
        XCTAssertEqual(r.folders[1].parentId, "f1")
    }

    func testCreateFolderEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.createFolder(pcPeerId: "pc", name: "Work", parentId: "root")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["name"] as? String, "Work")
        XCTAssertEqual(params["parentId"] as? String, "root")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "folderId": "f-99", "name": "Work", "parentId": "root", "createdAt": 100
        ])
        let r = try await task.value
        XCTAssertEqual(r.folderId, "f-99")
    }

    func testMoveFolderIntoItselfThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.moveFolder(pcPeerId: "pc", folderId: "f1", newParentId: "f1")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testDeleteFolderDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.deleteFolder(pcPeerId: "pc", folderId: "f1") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["folderId": "f1", "deleted": true])
        let r = try await task.value
        XCTAssertTrue(r.deleted)
    }

    // MARK: - Tags CRUD

    func testCreateTagDefaultsColor() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.createTag(pcPeerId: "pc", name: "urgent") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["color"] as? String, "#666666")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "tagId": "t1", "name": "urgent", "color": "#666666", "createdAt": 100
        ])
        let r = try await task.value
        XCTAssertEqual(r.color, "#666666")
    }

    func testDeleteTagNoIdOrNameThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.deleteTag(pcPeerId: "pc")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testRenameTagOldNameVariant() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.renameTag(pcPeerId: "pc", newName: "new", oldName: "old")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["newName"] as? String, "new")
        XCTAssertEqual(params["oldName"] as? String, "old")
        XCTAssertNil(params["tagId"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["renamed": true, "newName": "new"])
        let r = try await task.value
        XCTAssertTrue(r.renamed)
    }

    // MARK: - Versions

    func testGetNoteHistoryDecode() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getNoteHistory(pcPeerId: "pc", noteId: "5") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "noteId": 5,
            "versions": [
                ["id": "v1", "note_id": 5, "version_number": 2, "title": "T2", "created_at": 200],
                ["id": "v2", "note_id": 5, "version_number": 1, "title": "T1", "created_at": 100]
            ],
            "total": 2
        ])
        let r = try await task.value
        XCTAssertEqual(r.noteId, "5")
        XCTAssertEqual(r.versions[0].versionNumber, 2)
        XCTAssertEqual(r.versions[1].versionNumber, 1)
    }

    func testGetNoteVersionRequiresVersionIdOrPair() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.getNoteVersion(pcPeerId: "pc")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testRestoreNoteVersionEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.restoreNoteVersion(pcPeerId: "pc", noteId: "1", versionNumber: 2)
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "noteId": 1, "restoredFromVersion": 2, "message": "Note restored"
        ])
        let r = try await task.value
        XCTAssertEqual(r.restoredFromVersion, 2)
    }

    func testCompareVersionsDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.compareVersions(pcPeerId: "pc", noteId: "1", versionA: 1, versionB: 2)
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "noteId": 1,
            "diff": [
                "titleChanged": false,
                "contentChanged": true,
                "tagsChanged": false,
                "contentSizeDelta": 42
            ]
        ])
        let r = try await task.value
        XCTAssertTrue(r.contentChanged)
        XCTAssertEqual(r.contentSizeDelta, 42)
    }

    // MARK: - Star / Pin / Recently

    func testStarNoteToggleOmitsFlag() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.starNote(pcPeerId: "pc", noteId: "1") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertNil(params["starred"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "starred": true])
        let r = try await task.value
        XCTAssertEqual(r.starred, true)
    }

    func testPinNoteExplicitFalse() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.pinNote(pcPeerId: "pc", noteId: "1", pinned: false) }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["pinned"] as? Bool, false)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "pinned": false])
        let r = try await task.value
        XCTAssertEqual(r.pinned, false)
    }

    func testGetStarredNotesEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.getStarredNotes(pcPeerId: "pc", limit: 5, offset: 10)
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["limit"] as? Int, 5)
        XCTAssertEqual(params["offset"] as? Int, 10)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        let r = try await task.value
        XCTAssertEqual(r.total, 0)
    }

    func testGetRecentlyViewedMethodName() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getRecentlyViewed(pcPeerId: "pc") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.getRecentlyViewed")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["notes": [], "total": 0])
        _ = try await task.value
    }

    // MARK: - Archive

    func testArchiveNoteFlag() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.archiveNote(pcPeerId: "pc", noteId: "1") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.archiveNote")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "archived": true])
        let r = try await task.value
        XCTAssertEqual(r.archived, true)
    }

    func testGetArchivedNotesEnvelope() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.getArchivedNotes(pcPeerId: "pc") }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        XCTAssertEqual(p["method"] as? String, "knowledge.getArchivedNotes")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "notes": [["id": 1, "title": "T", "archived": 1, "tags": "[]"]],
            "total": 1
        ])
        let r = try await task.value
        XCTAssertEqual(r.notes[0].archived, true)
    }

    // MARK: - Export / Import

    func testExportNoteMarkdownDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.exportNote(pcPeerId: "pc", noteId: "1", format: "markdown")
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "noteId": 1, "format": "markdown", "mime": "text/markdown",
            "content": "# Title\n\nBody\n"
        ])
        let r = try await task.value
        XCTAssertEqual(r.format, "markdown")
        XCTAssertTrue(r.content.contains("# Title"))
    }

    func testExportNotesRequiresIdsOrFolder() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.exportNotes(pcPeerId: "pc")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testExportNotesByIdsDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.exportNotes(pcPeerId: "pc", noteIds: ["1", "2"])
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "notes": [
                ["noteId": 1, "title": "# A", "format": "markdown", "content": "# A\n"],
                ["noteId": 2, "error": "Note not found"]
            ],
            "total": 2, "format": "markdown"
        ])
        let r = try await task.value
        XCTAssertEqual(r.total, 2)
        XCTAssertNotNil(r.notes[1].error)
    }

    func testImportNoteEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.importNote(pcPeerId: "pc", title: "T", content: "C", folderId: "f1")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["title"] as? String, "T")
        XCTAssertEqual(params["folderId"] as? String, "f1")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 99, "title": "T", "imported": true])
        let r = try await task.value
        XCTAssertTrue(r.imported)
        XCTAssertEqual(r.noteId, "99")
    }

    func testImportFromFileEnvelope() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.importFromFile(
                pcPeerId: "pc", filename: "draft.md",
                content: "# H1\n\nbody", format: nil
            )
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["filename"] as? String, "draft.md")
        XCTAssertEqual(params["content"] as? String, "# H1\n\nbody")
        XCTAssertNil(params["format"])
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "title": "H1", "imported": true])
        let r = try await task.value
        XCTAssertEqual(r.title, "H1")
    }

    // MARK: - Tags advanced

    func testMergeTagsByNameDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.mergeTags(pcPeerId: "pc", sourceName: "work", targetName: "job")
        }
        try await waitForSend(s)
        let p = try payload(s.transport.dcSent[0])
        let params = p["params"] as! [String: Any]
        XCTAssertEqual(params["sourceName"] as? String, "work")
        XCTAssertEqual(params["targetName"] as? String, "job")
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: [
            "merged": true, "sourceName": "work", "targetName": "job", "notesUpdated": 3
        ])
        let r = try await task.value
        XCTAssertTrue(r.merged)
        XCTAssertEqual(r.notesUpdated, 3)
    }

    func testMergeTagsMissingSourceThrows() async {
        let s = await makeSetup()
        do {
            _ = try await s.cmds.mergeTags(pcPeerId: "pc", targetName: "tgt")
            XCTFail()
        } catch RemoteSkillError.invalidArgument { } catch { XCTFail("wrong: \(error)") }
    }

    func testAddTagsToNoteDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.addTagsToNote(pcPeerId: "pc", noteId: "1", tags: ["a", "b"])
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "tags": ["x", "a", "b"], "added": 2])
        let r = try await task.value
        XCTAssertEqual(r.tags, ["x", "a", "b"])
        XCTAssertEqual(r.added, 2)
    }

    func testRemoveTagsFromNoteDecode() async throws {
        let s = await makeSetup()
        let task = Task {
            try await s.cmds.removeTagsFromNote(pcPeerId: "pc", noteId: "1", tags: ["b"])
        }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respond(s.inbound, reqId: id, result: ["noteId": 1, "tags": ["a", "c"], "removed": 1])
        let r = try await task.value
        XCTAssertEqual(r.tags, ["a", "c"])
        XCTAssertEqual(r.removed, 1)
    }

    // MARK: - error path

    func testRemoteErrorPropagates() async throws {
        let s = await makeSetup()
        let task = Task { try await s.cmds.deleteNote(pcPeerId: "pc", noteId: "999") }
        try await waitForSend(s)
        let id = try reqId(s.transport.dcSent[0])
        try respondFailure(s.inbound, reqId: id, message: "Note not found")
        do {
            _ = try await task.value
            XCTFail()
        } catch RemoteSkillError.remoteError(_, let msg) {
            XCTAssertEqual(msg, "Note not found")
        } catch { XCTFail("wrong: \(error)") }
    }
}
