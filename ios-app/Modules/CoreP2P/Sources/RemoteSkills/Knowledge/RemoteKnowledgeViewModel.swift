import Foundation
import SwiftUI

/// Phase 6.4 UI — `KnowledgeView` 的 @MainActor ViewModel。
///
/// 不重写 wrap 逻辑；纯协调 [KnowledgeCommands]（actor）+ @Published UI 状态。
/// 过滤切换 (All / Starred / Pinned / Archived) 走对应 wrap method，不在本地 filter
/// 以避免 N+1 加载（桌面 SQL 已 WHERE 过滤）。
@MainActor
public final class RemoteKnowledgeViewModel: ObservableObject {

    public enum FilterTab: String, CaseIterable, Identifiable {
        case all, starred, pinned, archived
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .all: return "全部"
            case .starred: return "星标"
            case .pinned: return "置顶"
            case .archived: return "归档"
            }
        }
        public var icon: String {
            switch self {
            case .all: return "doc.text"
            case .starred: return "star"
            case .pinned: return "pin"
            case .archived: return "archivebox"
            }
        }
    }

    @Published public var notes: [KnowledgeNote] = []
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String?
    @Published public var searchQuery: String = ""
    @Published public var selectedFilter: FilterTab = .all

    private let commands: KnowledgeCommands
    private let pcPeerIdProvider: @Sendable () async -> String?

    public init(commands: KnowledgeCommands, pcPeerIdProvider: @escaping @Sendable () async -> String?) {
        self.commands = commands
        self.pcPeerIdProvider = pcPeerIdProvider
    }

    /// 按 selectedFilter 自动拉对应 wrap 接口；search query 非空时走 searchNotes 优先。
    public func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        guard let pcPeerId = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"
            return
        }
        do {
            let trimmed = searchQuery.trimmingCharacters(in: .whitespaces)
            let resp: NotesResponse
            if !trimmed.isEmpty {
                resp = try await commands.searchNotes(pcPeerId: pcPeerId, query: trimmed, limit: 50)
            } else {
                switch selectedFilter {
                case .all:
                    resp = try await commands.getNotes(pcPeerId: pcPeerId, limit: 50)
                case .starred:
                    resp = try await commands.getStarredNotes(pcPeerId: pcPeerId, limit: 50)
                case .pinned:
                    resp = try await commands.getPinnedNotes(pcPeerId: pcPeerId, limit: 50)
                case .archived:
                    resp = try await commands.getArchivedNotes(pcPeerId: pcPeerId, limit: 50)
                }
            }
            self.notes = resp.notes
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    /// 创建笔记并立刻 reload。
    public func createNote(title: String, content: String, tags: [String] = []) async {
        guard let pcPeerId = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"
            return
        }
        do {
            _ = try await commands.createNote(
                pcPeerId: pcPeerId, title: title, content: content, tags: tags
            )
            await load()
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    /// Toggle star。立刻 update 本地 + 后台 reload。
    public func toggleStar(_ note: KnowledgeNote) async {
        guard let pcPeerId = await pcPeerIdProvider() else { return }
        do {
            let new = !note.starred
            _ = try await commands.starNote(pcPeerId: pcPeerId, noteId: note.id, starred: new)
            // Optimistic 局部刷新
            if let idx = notes.firstIndex(where: { $0.id == note.id }) {
                let n = notes[idx]
                notes[idx] = KnowledgeNote(
                    id: n.id, title: n.title, content: n.content, tags: n.tags,
                    folderId: n.folderId, starred: new, pinned: n.pinned, archived: n.archived,
                    category: n.category, createdAt: n.createdAt, updatedAt: n.updatedAt,
                    lastViewedAt: n.lastViewedAt
                )
            }
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    public func archive(_ note: KnowledgeNote) async {
        guard let pcPeerId = await pcPeerIdProvider() else { return }
        do {
            _ = try await commands.archiveNote(pcPeerId: pcPeerId, noteId: note.id)
            // 从当前列表移除（除非当前 filter == archived）
            if selectedFilter != .archived {
                notes.removeAll { $0.id == note.id }
            }
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    public func restore(_ note: KnowledgeNote) async {
        guard let pcPeerId = await pcPeerIdProvider() else { return }
        do {
            _ = try await commands.restoreNote(pcPeerId: pcPeerId, noteId: note.id)
            // archived 列表里要移除
            if selectedFilter == .archived {
                notes.removeAll { $0.id == note.id }
            }
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    public func delete(_ note: KnowledgeNote) async {
        guard let pcPeerId = await pcPeerIdProvider() else { return }
        do {
            _ = try await commands.deleteNote(pcPeerId: pcPeerId, noteId: note.id)
            notes.removeAll { $0.id == note.id }
        } catch {
            self.errorMessage = String(describing: error)
        }
    }
}
