import Foundation

/// 知识库 typed RPC wrapper — Phase 6.3。
///
/// 镜像桌面 `knowledge-handler.js` 30 method（v5.0.3 Phase 6.3 step 1/2/3 + 老 9 method）。
///
/// **namespace = `knowledge`**（桌面 `commandRouter.registerHandler("knowledge", ...)`）。
///
/// 复用 `invokeAndDecode` 模板（Extension Phase 6.7 同模式 — method ≥ 10 时统一 helper）。
///
/// 30 method 分组：
/// - **CRUD 基础 9**: createNote / searchNotes / getNoteById / getTags / updateNote / deleteNote / getNotesByTag / getFavorites / syncNote
/// - **list 通用 1**: getNotes（按 folderId / orderBy / limit / offset）
/// - **Folders 5**: getFolders / createFolder / deleteFolder / renameFolder / moveFolder
/// - **Tags CRUD 3**: createTag / deleteTag / renameTag
/// - **Versions 4**: getNoteHistory / getNoteVersion / restoreNoteVersion / compareVersions
/// - **Star/Pin 6**: starNote / getStarredNotes / pinNote / getPinnedNotes / getRecentlyEdited / getRecentlyViewed
/// - **Archive 3**: archiveNote / restoreNote / getArchivedNotes
/// - **Export 2**: exportNote / exportNotes
/// - **Import 2**: importNote / importFromFile
/// - **Tags 高级 3**: mergeTags / addTagsToNote / removeTagsFromNote
public actor KnowledgeCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - CRUD 基础 9

    /// 创建笔记。
    public func createNote(
        pcPeerId: String, title: String, content: String,
        tags: [String] = [], mobileDid: String? = nil
    ) async throws -> CreateNoteResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.createNote: title empty")
        }
        guard !content.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.createNote: content empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.createNote",
            params: ["title": title, "content": content, "tags": tags],
            mobileDid: mobileDid, decoder: CreateNoteResponse.decode
        )
    }

    /// 全文搜索笔记。
    public func searchNotes(
        pcPeerId: String, query: String, limit: Int = 10,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.searchNotes: query empty")
        }
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("knowledge.searchNotes: limit must be > 0")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.searchNotes",
            params: ["query": query, "limit": limit],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    /// 按 ID 取单条笔记。Android 名 `getNote` (走相同桌面 case alias)。
    public func getNoteById(
        pcPeerId: String, noteId: String, mobileDid: String? = nil
    ) async throws -> NoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.getNoteById: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNoteById",
            params: ["noteId": noteId],
            mobileDid: mobileDid, decoder: NoteResponse.decode
        )
    }

    /// Android 风格名 `getNote`（桌面 alias to getNoteById — 39 method 完整对齐）。
    public func getNote(
        pcPeerId: String, noteId: String, mobileDid: String? = nil
    ) async throws -> NoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.getNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNote",
            params: ["noteId": noteId],
            mobileDid: mobileDid, decoder: NoteResponse.decode
        )
    }

    /// 列全 tags（distinct，仅 string 列表）。
    public func getTags(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> TagsResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getTags",
            params: [:], mobileDid: mobileDid, decoder: TagsResponse.decode
        )
    }

    /// 更新笔记（title/content/tags 任一改）。
    public func updateNote(
        pcPeerId: String, noteId: String,
        title: String? = nil, content: String? = nil, tags: [String]? = nil,
        mobileDid: String? = nil
    ) async throws -> UpdateNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.updateNote: noteId empty")
        }
        var params: [String: Any] = ["noteId": noteId]
        if let t = title { params["title"] = t }
        if let c = content { params["content"] = c }
        if let tg = tags { params["tags"] = tg }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.updateNote",
            params: params, mobileDid: mobileDid, decoder: UpdateNoteResponse.decode
        )
    }

    /// 删除笔记（不可逆）。
    public func deleteNote(
        pcPeerId: String, noteId: String, mobileDid: String? = nil
    ) async throws -> DeleteNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.deleteNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.deleteNote",
            params: ["noteId": noteId],
            mobileDid: mobileDid, decoder: DeleteNoteResponse.decode
        )
    }

    /// 按 tag 查笔记。
    public func getNotesByTag(
        pcPeerId: String, tag: String, limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        guard !tag.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.getNotesByTag: tag empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNotesByTag",
            params: ["tag": tag, "limit": limit],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    /// 列收藏笔记（既有 schema 字段 is_favorite）。
    public func getFavorites(
        pcPeerId: String, limit: Int = 50, mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getFavorites",
            params: ["limit": limit],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    /// 同步笔记到向量库（可选 vectorize=true 触发 RAG indexDocument）。
    public func syncNote(
        pcPeerId: String, noteId: String, vectorize: Bool = false,
        mobileDid: String? = nil
    ) async throws -> SyncNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.syncNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.syncNote",
            params: ["noteId": noteId, "vectorize": vectorize],
            mobileDid: mobileDid, decoder: SyncNoteResponse.decode
        )
    }

    // MARK: - 通用 list 1

    /// 通用 list — 按 folderId / orderBy / limit / offset 过滤。Android `getNotes` 对应。
    public func getNotes(
        pcPeerId: String, limit: Int = 50, offset: Int = 0,
        folderId: String? = nil, orderBy: String = "updated_at",
        order: String = "DESC", mobileDid: String? = nil
    ) async throws -> NotesResponse {
        var params: [String: Any] = [
            "limit": limit, "offset": offset,
            "orderBy": orderBy, "order": order,
        ]
        if let f = folderId { params["folderId"] = f }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNotes",
            params: params, mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    // MARK: - Folders 5

    public func getFolders(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> FoldersResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getFolders",
            params: [:], mobileDid: mobileDid, decoder: FoldersResponse.decode
        )
    }

    public func createFolder(
        pcPeerId: String, name: String, parentId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> CreateFolderResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.createFolder: name empty")
        }
        var params: [String: Any] = ["name": name]
        if let p = parentId { params["parentId"] = p }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.createFolder",
            params: params, mobileDid: mobileDid, decoder: CreateFolderResponse.decode
        )
    }

    public func deleteFolder(
        pcPeerId: String, folderId: String, mobileDid: String? = nil
    ) async throws -> FolderActionResponse {
        guard !folderId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.deleteFolder: folderId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.deleteFolder",
            params: ["folderId": folderId],
            mobileDid: mobileDid, decoder: FolderActionResponse.decode
        )
    }

    public func renameFolder(
        pcPeerId: String, folderId: String, name: String,
        mobileDid: String? = nil
    ) async throws -> FolderActionResponse {
        guard !folderId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.renameFolder: folderId empty")
        }
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.renameFolder: name empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.renameFolder",
            params: ["folderId": folderId, "name": name],
            mobileDid: mobileDid, decoder: FolderActionResponse.decode
        )
    }

    public func moveFolder(
        pcPeerId: String, folderId: String, newParentId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> FolderActionResponse {
        guard !folderId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.moveFolder: folderId empty")
        }
        if let p = newParentId, p == folderId {
            throw RemoteSkillError.invalidArgument("knowledge.moveFolder: cannot move into itself")
        }
        var params: [String: Any] = ["folderId": folderId]
        if let p = newParentId { params["newParentId"] = p }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.moveFolder",
            params: params, mobileDid: mobileDid, decoder: FolderActionResponse.decode
        )
    }

    // MARK: - Tags CRUD 3

    public func createTag(
        pcPeerId: String, name: String, color: String = "#666666",
        mobileDid: String? = nil
    ) async throws -> CreateTagResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.createTag: name empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.createTag",
            params: ["name": name, "color": color],
            mobileDid: mobileDid, decoder: CreateTagResponse.decode
        )
    }

    public func deleteTag(
        pcPeerId: String, tagId: String? = nil, name: String? = nil,
        mobileDid: String? = nil
    ) async throws -> TagActionResponse {
        guard tagId != nil || name != nil else {
            throw RemoteSkillError.invalidArgument("knowledge.deleteTag: tagId or name required")
        }
        var params: [String: Any] = [:]
        if let t = tagId { params["tagId"] = t }
        if let n = name { params["name"] = n }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.deleteTag",
            params: params, mobileDid: mobileDid, decoder: TagActionResponse.decode
        )
    }

    public func renameTag(
        pcPeerId: String, newName: String,
        tagId: String? = nil, oldName: String? = nil,
        mobileDid: String? = nil
    ) async throws -> TagActionResponse {
        guard !newName.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.renameTag: newName empty")
        }
        guard tagId != nil || oldName != nil else {
            throw RemoteSkillError.invalidArgument("knowledge.renameTag: tagId or oldName required")
        }
        var params: [String: Any] = ["newName": newName]
        if let t = tagId { params["tagId"] = t }
        if let o = oldName { params["oldName"] = o }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.renameTag",
            params: params, mobileDid: mobileDid, decoder: TagActionResponse.decode
        )
    }

    // MARK: - Versions 4

    public func getNoteHistory(
        pcPeerId: String, noteId: String, limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> NoteVersionsResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.getNoteHistory: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNoteHistory",
            params: ["noteId": noteId, "limit": limit],
            mobileDid: mobileDid, decoder: NoteVersionsResponse.decode
        )
    }

    public func getNoteVersion(
        pcPeerId: String, versionId: String? = nil,
        noteId: String? = nil, versionNumber: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> NoteVersionResponse {
        if versionId == nil && (noteId == nil || versionNumber == nil) {
            throw RemoteSkillError.invalidArgument(
                "knowledge.getNoteVersion: versionId or (noteId + versionNumber) required"
            )
        }
        var params: [String: Any] = [:]
        if let v = versionId { params["versionId"] = v }
        if let n = noteId { params["noteId"] = n }
        if let vn = versionNumber { params["versionNumber"] = vn }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getNoteVersion",
            params: params, mobileDid: mobileDid, decoder: NoteVersionResponse.decode
        )
    }

    public func restoreNoteVersion(
        pcPeerId: String, noteId: String,
        versionId: String? = nil, versionNumber: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> RestoreVersionResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.restoreNoteVersion: noteId empty")
        }
        if versionId == nil && versionNumber == nil {
            throw RemoteSkillError.invalidArgument(
                "knowledge.restoreNoteVersion: versionId or versionNumber required"
            )
        }
        var params: [String: Any] = ["noteId": noteId]
        if let v = versionId { params["versionId"] = v }
        if let vn = versionNumber { params["versionNumber"] = vn }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.restoreNoteVersion",
            params: params, mobileDid: mobileDid, decoder: RestoreVersionResponse.decode
        )
    }

    public func compareVersions(
        pcPeerId: String, noteId: String, versionA: Int, versionB: Int,
        mobileDid: String? = nil
    ) async throws -> CompareVersionsResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.compareVersions: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.compareVersions",
            params: ["noteId": noteId, "versionA": versionA, "versionB": versionB],
            mobileDid: mobileDid, decoder: CompareVersionsResponse.decode
        )
    }

    // MARK: - Star / Pin / Recently 6

    public func starNote(
        pcPeerId: String, noteId: String, starred: Bool? = nil,
        mobileDid: String? = nil
    ) async throws -> NoteFlagResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.starNote: noteId empty")
        }
        var params: [String: Any] = ["noteId": noteId]
        if let s = starred { params["starred"] = s }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.starNote",
            params: params, mobileDid: mobileDid, decoder: NoteFlagResponse.decode
        )
    }

    public func getStarredNotes(
        pcPeerId: String, limit: Int = 50, offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getStarredNotes",
            params: ["limit": limit, "offset": offset],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    public func pinNote(
        pcPeerId: String, noteId: String, pinned: Bool? = nil,
        mobileDid: String? = nil
    ) async throws -> NoteFlagResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.pinNote: noteId empty")
        }
        var params: [String: Any] = ["noteId": noteId]
        if let p = pinned { params["pinned"] = p }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.pinNote",
            params: params, mobileDid: mobileDid, decoder: NoteFlagResponse.decode
        )
    }

    public func getPinnedNotes(
        pcPeerId: String, limit: Int = 50, offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getPinnedNotes",
            params: ["limit": limit, "offset": offset],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    public func getRecentlyEdited(
        pcPeerId: String, limit: Int = 20, offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getRecentlyEdited",
            params: ["limit": limit, "offset": offset],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    public func getRecentlyViewed(
        pcPeerId: String, limit: Int = 20, offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getRecentlyViewed",
            params: ["limit": limit, "offset": offset],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    // MARK: - Archive 3

    public func archiveNote(
        pcPeerId: String, noteId: String, mobileDid: String? = nil
    ) async throws -> NoteFlagResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.archiveNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.archiveNote",
            params: ["noteId": noteId],
            mobileDid: mobileDid, decoder: NoteFlagResponse.decode
        )
    }

    public func restoreNote(
        pcPeerId: String, noteId: String, mobileDid: String? = nil
    ) async throws -> NoteFlagResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.restoreNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.restoreNote",
            params: ["noteId": noteId],
            mobileDid: mobileDid, decoder: NoteFlagResponse.decode
        )
    }

    public func getArchivedNotes(
        pcPeerId: String, limit: Int = 50, offset: Int = 0,
        mobileDid: String? = nil
    ) async throws -> NotesResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.getArchivedNotes",
            params: ["limit": limit, "offset": offset],
            mobileDid: mobileDid, decoder: NotesResponse.decode
        )
    }

    // MARK: - Export 2

    public func exportNote(
        pcPeerId: String, noteId: String, format: String = "markdown",
        mobileDid: String? = nil
    ) async throws -> ExportNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.exportNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.exportNote",
            params: ["noteId": noteId, "format": format],
            mobileDid: mobileDid, decoder: ExportNoteResponse.decode
        )
    }

    public func exportNotes(
        pcPeerId: String, noteIds: [String]? = nil, folderId: String? = nil,
        format: String = "markdown", mobileDid: String? = nil
    ) async throws -> ExportNotesResponse {
        if (noteIds == nil || noteIds?.isEmpty == true) && folderId == nil {
            throw RemoteSkillError.invalidArgument(
                "knowledge.exportNotes: noteIds[] or folderId required"
            )
        }
        var params: [String: Any] = ["format": format]
        if let ids = noteIds { params["noteIds"] = ids }
        if let f = folderId { params["folderId"] = f }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.exportNotes",
            params: params, mobileDid: mobileDid, decoder: ExportNotesResponse.decode
        )
    }

    // MARK: - Import 2

    public func importNote(
        pcPeerId: String, title: String, content: String,
        tags: [String] = [], folderId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ImportNoteResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.importNote: title empty")
        }
        var params: [String: Any] = [
            "title": title, "content": content, "tags": tags,
        ]
        if let f = folderId { params["folderId"] = f }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.importNote",
            params: params, mobileDid: mobileDid, decoder: ImportNoteResponse.decode
        )
    }

    public func importFromFile(
        pcPeerId: String, filename: String, content: String,
        format: String? = nil, folderId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ImportNoteResponse {
        guard !filename.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.importFromFile: filename empty")
        }
        var params: [String: Any] = ["filename": filename, "content": content]
        if let f = format { params["format"] = f }
        if let fd = folderId { params["folderId"] = fd }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.importFromFile",
            params: params, mobileDid: mobileDid, decoder: ImportNoteResponse.decode
        )
    }

    // MARK: - Tags advanced 3

    public func mergeTags(
        pcPeerId: String,
        sourceTagId: String? = nil, sourceName: String? = nil,
        targetTagId: String? = nil, targetName: String? = nil,
        mobileDid: String? = nil
    ) async throws -> MergeTagsResponse {
        guard sourceTagId != nil || sourceName != nil else {
            throw RemoteSkillError.invalidArgument(
                "knowledge.mergeTags: sourceTagId or sourceName required"
            )
        }
        guard targetTagId != nil || targetName != nil else {
            throw RemoteSkillError.invalidArgument(
                "knowledge.mergeTags: targetTagId or targetName required"
            )
        }
        var params: [String: Any] = [:]
        if let s = sourceTagId { params["sourceTagId"] = s }
        if let s = sourceName { params["sourceName"] = s }
        if let t = targetTagId { params["targetTagId"] = t }
        if let t = targetName { params["targetName"] = t }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.mergeTags",
            params: params, mobileDid: mobileDid, decoder: MergeTagsResponse.decode
        )
    }

    public func addTagsToNote(
        pcPeerId: String, noteId: String, tags: [String],
        mobileDid: String? = nil
    ) async throws -> TagsOnNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.addTagsToNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.addTagsToNote",
            params: ["noteId": noteId, "tags": tags],
            mobileDid: mobileDid, decoder: TagsOnNoteResponse.decode
        )
    }

    public func removeTagsFromNote(
        pcPeerId: String, noteId: String, tags: [String],
        mobileDid: String? = nil
    ) async throws -> TagsOnNoteResponse {
        guard !noteId.isEmpty else {
            throw RemoteSkillError.invalidArgument("knowledge.removeTagsFromNote: noteId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "knowledge.removeTagsFromNote",
            params: ["noteId": noteId, "tags": tags],
            mobileDid: mobileDid, decoder: TagsOnNoteResponse.decode
        )
    }

    // MARK: - 内部

    private func invokeAndDecode<T>(
        pcPeerId: String, method: String,
        params: [String: Any], mobileDid: String?,
        decoder: (String) throws -> T
    ) async throws -> T {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId, method: method,
            params: params, mobileDid: mobileDid
        )
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
