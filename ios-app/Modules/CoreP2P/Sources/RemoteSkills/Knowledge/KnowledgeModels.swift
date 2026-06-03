import Foundation

/// 知识库 typed RPC 响应模型 — Phase 6.3 (~30 method)。
///
/// 镜像桌面 `desktop-app-vue/src/main/remote/handlers/knowledge-handler.js`
/// 30 method 全套返回结构。

// MARK: - 核心实体

/// 笔记（核心实体；DB columns 平铺）。
public struct KnowledgeNote: Sendable, Equatable {
    public let id: String           // 桌面用 INTEGER PK，统一序列化为 String 防 64-bit JS Number 截位
    public let title: String
    public let content: String?
    public let tags: [String]
    public let folderId: String?
    public let starred: Bool
    public let pinned: Bool
    public let archived: Bool
    public let category: String?
    public let createdAt: Int64?
    public let updatedAt: Int64?
    public let lastViewedAt: Int64?

    public init(id: String, title: String, content: String? = nil, tags: [String] = [],
                folderId: String? = nil, starred: Bool = false, pinned: Bool = false,
                archived: Bool = false, category: String? = nil,
                createdAt: Int64? = nil, updatedAt: Int64? = nil, lastViewedAt: Int64? = nil) {
        self.id = id; self.title = title; self.content = content; self.tags = tags
        self.folderId = folderId; self.starred = starred; self.pinned = pinned
        self.archived = archived; self.category = category
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.lastViewedAt = lastViewedAt
    }

    internal static func from(_ d: [String: Any]) -> KnowledgeNote {
        let id: String
        if let s = d["id"] as? String { id = s }
        else if let n = d["id"] as? Int64 { id = String(n) }
        else if let n = d["id"] as? Int { id = String(n) }
        else { id = "" }
        var tags: [String] = []
        if let raw = d["tags"] as? String,
           let data = raw.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [String] {
            tags = arr
        } else if let arr = d["tags"] as? [String] {
            tags = arr
        }
        return KnowledgeNote(
            id: id,
            title: (d["title"] as? String) ?? "",
            content: d["content"] as? String,
            tags: tags,
            folderId: d["folder_id"] as? String,
            starred: ((d["starred"] as? Int) ?? 0) != 0,
            pinned: ((d["pinned"] as? Int) ?? 0) != 0,
            archived: ((d["archived"] as? Int) ?? 0) != 0,
            category: d["category"] as? String,
            createdAt: pickInt64(d["created_at"]),
            updatedAt: pickInt64(d["updated_at"]),
            lastViewedAt: pickInt64(d["last_viewed_at"])
        )
    }
}

/// 文件夹。
public struct KnowledgeFolder: Sendable, Equatable {
    public let id: String
    public let name: String
    public let parentId: String?
    public let createdAt: Int64?

    public init(id: String, name: String, parentId: String? = nil, createdAt: Int64? = nil) {
        self.id = id; self.name = name; self.parentId = parentId; self.createdAt = createdAt
    }

    internal static func from(_ d: [String: Any]) -> KnowledgeFolder {
        KnowledgeFolder(
            id: (d["id"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            parentId: d["parent_id"] as? String,
            createdAt: pickInt64(d["created_at"])
        )
    }
}

/// 笔记版本快照。
public struct KnowledgeNoteVersion: Sendable, Equatable {
    public let id: String
    public let noteId: String
    public let versionNumber: Int
    public let title: String
    public let content: String?
    public let tags: String?      // 原始 JSON 字符串（保留 caller 自行决定解析）
    public let createdAt: Int64?
    public let createdByDid: String?

    public init(id: String, noteId: String, versionNumber: Int, title: String,
                content: String? = nil, tags: String? = nil,
                createdAt: Int64? = nil, createdByDid: String? = nil) {
        self.id = id; self.noteId = noteId; self.versionNumber = versionNumber
        self.title = title; self.content = content; self.tags = tags
        self.createdAt = createdAt; self.createdByDid = createdByDid
    }

    internal static func from(_ d: [String: Any]) -> KnowledgeNoteVersion {
        let nid: String
        if let s = d["note_id"] as? String { nid = s }
        else if let n = d["note_id"] as? Int { nid = String(n) }
        else { nid = "" }
        return KnowledgeNoteVersion(
            id: (d["id"] as? String) ?? "",
            noteId: nid,
            versionNumber: (d["version_number"] as? Int) ?? 0,
            title: (d["title"] as? String) ?? "",
            content: d["content"] as? String,
            tags: d["tags"] as? String,
            createdAt: pickInt64(d["created_at"]),
            createdByDid: d["created_by_did"] as? String
        )
    }
}

// MARK: - Response 结构

/// 创建笔记响应。
public struct CreateNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let title: String
    public let message: String

    public init(noteId: String, title: String, message: String) {
        self.noteId = noteId; self.title = title; self.message = message
    }

    public static func decode(_ json: String) throws -> CreateNoteResponse {
        let d = try parseDict(json)
        return CreateNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            title: (d["title"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 更新笔记响应。
public struct UpdateNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let message: String

    public init(noteId: String, message: String) {
        self.noteId = noteId; self.message = message
    }

    public static func decode(_ json: String) throws -> UpdateNoteResponse {
        let d = try parseDict(json)
        return UpdateNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 删除笔记响应。
public struct DeleteNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let message: String

    public init(noteId: String, message: String) {
        self.noteId = noteId; self.message = message
    }

    public static func decode(_ json: String) throws -> DeleteNoteResponse {
        let d = try parseDict(json)
        return DeleteNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 搜索 / 列表通用响应（results / notes 字段都接受）。
public struct NotesResponse: Sendable, Equatable {
    public let notes: [KnowledgeNote]
    public let total: Int
    public let tag: String?     // getNotesByTag 时携带
    public let limit: Int?
    public let offset: Int?

    public init(notes: [KnowledgeNote], total: Int, tag: String? = nil,
                limit: Int? = nil, offset: Int? = nil) {
        self.notes = notes; self.total = total; self.tag = tag
        self.limit = limit; self.offset = offset
    }

    public static func decode(_ json: String) throws -> NotesResponse {
        let d = try parseDict(json)
        let arr = (d["notes"] as? [[String: Any]])
            ?? (d["results"] as? [[String: Any]])
            ?? []
        return NotesResponse(
            notes: arr.map { KnowledgeNote.from($0) },
            total: (d["total"] as? Int) ?? arr.count,
            tag: d["tag"] as? String,
            limit: d["limit"] as? Int,
            offset: d["offset"] as? Int
        )
    }
}

/// 单条笔记响应（getNoteById / getNote）。
public struct NoteResponse: Sendable, Equatable {
    public let note: KnowledgeNote

    public init(note: KnowledgeNote) { self.note = note }

    public static func decode(_ json: String) throws -> NoteResponse {
        let d = try parseDict(json)
        return NoteResponse(note: KnowledgeNote.from(d))
    }
}

/// 全 tag 字符串列表（去重后）。
public struct TagsResponse: Sendable, Equatable {
    public let tags: [String]
    public let total: Int

    public init(tags: [String], total: Int) {
        self.tags = tags; self.total = total
    }

    public static func decode(_ json: String) throws -> TagsResponse {
        let d = try parseDict(json)
        let tags = (d["tags"] as? [String]) ?? []
        return TagsResponse(tags: tags, total: (d["total"] as? Int) ?? tags.count)
    }
}

/// Folders 列表。
public struct FoldersResponse: Sendable, Equatable {
    public let folders: [KnowledgeFolder]
    public let total: Int

    public init(folders: [KnowledgeFolder], total: Int) {
        self.folders = folders; self.total = total
    }

    public static func decode(_ json: String) throws -> FoldersResponse {
        let d = try parseDict(json)
        let arr = (d["folders"] as? [[String: Any]]) ?? []
        return FoldersResponse(
            folders: arr.map { KnowledgeFolder.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// 创建文件夹响应。
public struct CreateFolderResponse: Sendable, Equatable {
    public let folderId: String
    public let name: String
    public let parentId: String?
    public let createdAt: Int64?

    public init(folderId: String, name: String, parentId: String? = nil, createdAt: Int64? = nil) {
        self.folderId = folderId; self.name = name; self.parentId = parentId; self.createdAt = createdAt
    }

    public static func decode(_ json: String) throws -> CreateFolderResponse {
        let d = try parseDict(json)
        return CreateFolderResponse(
            folderId: (d["folderId"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            parentId: d["parentId"] as? String,
            createdAt: pickInt64(d["createdAt"])
        )
    }
}

/// Folder mutating action 通用响应。
public struct FolderActionResponse: Sendable, Equatable {
    public let folderId: String
    public let name: String?
    public let newParentId: String?
    public let deleted: Bool

    public init(folderId: String, name: String? = nil, newParentId: String? = nil, deleted: Bool = false) {
        self.folderId = folderId; self.name = name; self.newParentId = newParentId; self.deleted = deleted
    }

    public static func decode(_ json: String) throws -> FolderActionResponse {
        let d = try parseDict(json)
        return FolderActionResponse(
            folderId: (d["folderId"] as? String) ?? "",
            name: d["name"] as? String,
            newParentId: d["newParentId"] as? String,
            deleted: (d["deleted"] as? Bool) ?? false
        )
    }
}

/// 创建 tag 响应。
public struct CreateTagResponse: Sendable, Equatable {
    public let tagId: String
    public let name: String
    public let color: String
    public let createdAt: Int64?

    public init(tagId: String, name: String, color: String, createdAt: Int64? = nil) {
        self.tagId = tagId; self.name = name; self.color = color; self.createdAt = createdAt
    }

    public static func decode(_ json: String) throws -> CreateTagResponse {
        let d = try parseDict(json)
        return CreateTagResponse(
            tagId: (d["tagId"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            color: (d["color"] as? String) ?? "",
            createdAt: pickInt64(d["createdAt"])
        )
    }
}

/// Tag mutating action (delete / rename) 通用响应。
public struct TagActionResponse: Sendable, Equatable {
    public let deleted: Bool
    public let renamed: Bool
    public let identifier: String?
    public let newName: String?

    public init(deleted: Bool = false, renamed: Bool = false,
                identifier: String? = nil, newName: String? = nil) {
        self.deleted = deleted; self.renamed = renamed
        self.identifier = identifier; self.newName = newName
    }

    public static func decode(_ json: String) throws -> TagActionResponse {
        let d = try parseDict(json)
        return TagActionResponse(
            deleted: (d["deleted"] as? Bool) ?? false,
            renamed: (d["renamed"] as? Bool) ?? false,
            identifier: d["identifier"] as? String,
            newName: d["newName"] as? String
        )
    }
}

/// 版本历史 list 响应。
public struct NoteVersionsResponse: Sendable, Equatable {
    public let noteId: String
    public let versions: [KnowledgeNoteVersion]
    public let total: Int

    public init(noteId: String, versions: [KnowledgeNoteVersion], total: Int) {
        self.noteId = noteId; self.versions = versions; self.total = total
    }

    public static func decode(_ json: String) throws -> NoteVersionsResponse {
        let d = try parseDict(json)
        let arr = (d["versions"] as? [[String: Any]]) ?? []
        return NoteVersionsResponse(
            noteId: pickIdAsString(d["noteId"]),
            versions: arr.map { KnowledgeNoteVersion.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// 单 version 响应。
public struct NoteVersionResponse: Sendable, Equatable {
    public let version: KnowledgeNoteVersion

    public init(version: KnowledgeNoteVersion) { self.version = version }

    public static func decode(_ json: String) throws -> NoteVersionResponse {
        let d = try parseDict(json)
        let ver = (d["version"] as? [String: Any]) ?? [:]
        return NoteVersionResponse(version: KnowledgeNoteVersion.from(ver))
    }
}

/// Restore version 响应。
public struct RestoreVersionResponse: Sendable, Equatable {
    public let noteId: String
    public let restoredFromVersion: Int
    public let message: String

    public init(noteId: String, restoredFromVersion: Int, message: String) {
        self.noteId = noteId; self.restoredFromVersion = restoredFromVersion; self.message = message
    }

    public static func decode(_ json: String) throws -> RestoreVersionResponse {
        let d = try parseDict(json)
        return RestoreVersionResponse(
            noteId: pickIdAsString(d["noteId"]),
            restoredFromVersion: (d["restoredFromVersion"] as? Int) ?? 0,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// Compare versions 响应。
public struct CompareVersionsResponse: Sendable, Equatable {
    public let noteId: String
    public let titleChanged: Bool
    public let contentChanged: Bool
    public let tagsChanged: Bool
    public let contentSizeDelta: Int

    public init(noteId: String, titleChanged: Bool, contentChanged: Bool,
                tagsChanged: Bool, contentSizeDelta: Int) {
        self.noteId = noteId; self.titleChanged = titleChanged
        self.contentChanged = contentChanged; self.tagsChanged = tagsChanged
        self.contentSizeDelta = contentSizeDelta
    }

    public static func decode(_ json: String) throws -> CompareVersionsResponse {
        let d = try parseDict(json)
        let diff = (d["diff"] as? [String: Any]) ?? [:]
        return CompareVersionsResponse(
            noteId: pickIdAsString(d["noteId"]),
            titleChanged: (diff["titleChanged"] as? Bool) ?? false,
            contentChanged: (diff["contentChanged"] as? Bool) ?? false,
            tagsChanged: (diff["tagsChanged"] as? Bool) ?? false,
            contentSizeDelta: (diff["contentSizeDelta"] as? Int) ?? 0
        )
    }
}

/// star/pin 通用响应。
public struct NoteFlagResponse: Sendable, Equatable {
    public let noteId: String
    public let starred: Bool?
    public let pinned: Bool?
    public let archived: Bool?

    public init(noteId: String, starred: Bool? = nil, pinned: Bool? = nil, archived: Bool? = nil) {
        self.noteId = noteId; self.starred = starred; self.pinned = pinned; self.archived = archived
    }

    public static func decode(_ json: String) throws -> NoteFlagResponse {
        let d = try parseDict(json)
        return NoteFlagResponse(
            noteId: pickIdAsString(d["noteId"]),
            starred: d["starred"] as? Bool,
            pinned: d["pinned"] as? Bool,
            archived: d["archived"] as? Bool
        )
    }
}

/// Export 单条响应。
public struct ExportNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let format: String
    public let mime: String
    public let content: String

    public init(noteId: String, format: String, mime: String, content: String) {
        self.noteId = noteId; self.format = format; self.mime = mime; self.content = content
    }

    public static func decode(_ json: String) throws -> ExportNoteResponse {
        let d = try parseDict(json)
        return ExportNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            format: (d["format"] as? String) ?? "markdown",
            mime: (d["mime"] as? String) ?? "text/markdown",
            content: (d["content"] as? String) ?? ""
        )
    }
}

/// Export 批量响应。
public struct ExportNotesResponse: Sendable, Equatable {
    public let notes: [ExportedNoteEntry]
    public let total: Int
    public let format: String

    public init(notes: [ExportedNoteEntry], total: Int, format: String) {
        self.notes = notes; self.total = total; self.format = format
    }

    public static func decode(_ json: String) throws -> ExportNotesResponse {
        let d = try parseDict(json)
        let arr = (d["notes"] as? [[String: Any]]) ?? []
        return ExportNotesResponse(
            notes: arr.map { ExportedNoteEntry.from($0) },
            total: (d["total"] as? Int) ?? arr.count,
            format: (d["format"] as? String) ?? "markdown"
        )
    }
}

public struct ExportedNoteEntry: Sendable, Equatable {
    public let noteId: String
    public let title: String?
    public let format: String?
    public let content: String?
    public let error: String?

    public init(noteId: String, title: String? = nil, format: String? = nil,
                content: String? = nil, error: String? = nil) {
        self.noteId = noteId; self.title = title; self.format = format
        self.content = content; self.error = error
    }

    internal static func from(_ d: [String: Any]) -> ExportedNoteEntry {
        ExportedNoteEntry(
            noteId: pickIdAsString(d["noteId"]),
            title: d["title"] as? String,
            format: d["format"] as? String,
            content: d["content"] as? String,
            error: d["error"] as? String
        )
    }
}

/// Import note 响应。
public struct ImportNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let title: String
    public let imported: Bool

    public init(noteId: String, title: String, imported: Bool) {
        self.noteId = noteId; self.title = title; self.imported = imported
    }

    public static func decode(_ json: String) throws -> ImportNoteResponse {
        let d = try parseDict(json)
        return ImportNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            title: (d["title"] as? String) ?? "",
            imported: (d["imported"] as? Bool) ?? false
        )
    }
}

/// Tag merge 响应。
public struct MergeTagsResponse: Sendable, Equatable {
    public let merged: Bool
    public let sourceName: String
    public let targetName: String
    public let notesUpdated: Int

    public init(merged: Bool, sourceName: String, targetName: String, notesUpdated: Int) {
        self.merged = merged; self.sourceName = sourceName
        self.targetName = targetName; self.notesUpdated = notesUpdated
    }

    public static func decode(_ json: String) throws -> MergeTagsResponse {
        let d = try parseDict(json)
        return MergeTagsResponse(
            merged: (d["merged"] as? Bool) ?? false,
            sourceName: (d["sourceName"] as? String) ?? "",
            targetName: (d["targetName"] as? String) ?? "",
            notesUpdated: (d["notesUpdated"] as? Int) ?? 0
        )
    }
}

/// addTagsToNote / removeTagsFromNote 响应。
public struct TagsOnNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let tags: [String]
    public let added: Int?
    public let removed: Int?

    public init(noteId: String, tags: [String], added: Int? = nil, removed: Int? = nil) {
        self.noteId = noteId; self.tags = tags; self.added = added; self.removed = removed
    }

    public static func decode(_ json: String) throws -> TagsOnNoteResponse {
        let d = try parseDict(json)
        return TagsOnNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            tags: (d["tags"] as? [String]) ?? [],
            added: d["added"] as? Int,
            removed: d["removed"] as? Int
        )
    }
}

/// syncNote 响应。
public struct SyncNoteResponse: Sendable, Equatable {
    public let noteId: String
    public let message: String
    public let vectorized: Bool

    public init(noteId: String, message: String, vectorized: Bool) {
        self.noteId = noteId; self.message = message; self.vectorized = vectorized
    }

    public static func decode(_ json: String) throws -> SyncNoteResponse {
        let d = try parseDict(json)
        return SyncNoteResponse(
            noteId: pickIdAsString(d["noteId"]),
            message: (d["message"] as? String) ?? "",
            vectorized: (d["vectorized"] as? Bool) ?? false
        )
    }
}

// MARK: - 内部 helper

/// Int / Int64 / String 任一都能产出 String — 桌面 noteId 可能任一种。
internal func pickIdAsString(_ v: Any?) -> String {
    if let s = v as? String { return s }
    if let n = v as? Int64 { return String(n) }
    if let n = v as? Int { return String(n) }
    return ""
}

/// Int / Int64 → Int64?。
internal func pickInt64(_ v: Any?) -> Int64? {
    if let n = v as? Int64 { return n }
    if let n = v as? Int { return Int64(n) }
    return nil
}
