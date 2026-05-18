import SwiftUI
import CoreP2P

/// Phase 6.4 — 远程知识库 UI（KnowledgeCommands 31 method 用得起来的入口）。
///
/// MVP scope：notes list + 4 filter tab + 搜索 + 新建 + 单项 swipe action
/// (星标 / 归档 / 还原 / 删除)。defer：文件夹树 / tags 视图 / 版本历史 / 导入导出
/// (那些是二级 sheet，本 v0.1 不做)。
///
/// 入口：RemoteOperateView → 第 14 tab "知识"。
struct KnowledgeView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies

    var body: some View {
        Inner(pcPeerId: pcPeerId, commands: remoteDeps.knowledge)
    }
}

// MARK: - Inner View (EnvironmentObject 已注入后构造 StateObject 模式)

private struct Inner: View {
    @StateObject private var viewModel: RemoteKnowledgeViewModel
    @State private var showCreateSheet = false

    init(pcPeerId: String, commands: KnowledgeCommands) {
        let captured = pcPeerId
        _viewModel = StateObject(wrappedValue: RemoteKnowledgeViewModel(
            commands: commands,
            pcPeerIdProvider: { captured }
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            filterPicker
            searchBar
            Divider()

            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = viewModel.errorMessage {
                errorBanner(err)
            } else if viewModel.notes.isEmpty {
                emptyState
            } else {
                notesList
            }
        }
        .navigationTitle("远程知识库")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: { showCreateSheet = true }) {
                    Image(systemName: "square.and.pencil")
                }
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateNoteSheet { title, content, tags in
                Task {
                    await viewModel.createNote(title: title, content: content, tags: tags)
                    showCreateSheet = false
                }
            }
        }
        .task {
            await viewModel.load()
        }
        .onChange(of: viewModel.selectedFilter) { _ in
            Task { await viewModel.load() }
        }
    }

    private var filterPicker: some View {
        Picker("过滤", selection: $viewModel.selectedFilter) {
            ForEach(RemoteKnowledgeViewModel.FilterTab.allCases) { tab in
                Label(tab.label, systemImage: tab.icon).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            TextField("搜索笔记…", text: $viewModel.searchQuery)
                .textFieldStyle(.plain)
                .onSubmit { Task { await viewModel.load() } }
            if !viewModel.searchQuery.isEmpty {
                Button(action: {
                    viewModel.searchQuery = ""
                    Task { await viewModel.load() }
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(8)
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private func errorBanner(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle).foregroundColor(.orange)
            Text("加载失败")
                .font(.headline)
            Text(msg)
                .font(.caption).foregroundColor(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal)
            Button("重试") { Task { await viewModel.load() } }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.largeTitle).foregroundColor(.secondary)
            Text("无笔记")
                .font(.headline).foregroundColor(.secondary)
            Text(viewModel.searchQuery.isEmpty
                 ? "点右上 + 新建第一条笔记"
                 : "无匹配 \"\(viewModel.searchQuery)\" 的笔记")
                .font(.caption).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var notesList: some View {
        List {
            ForEach(viewModel.notes, id: \.id) { note in
                NoteRow(note: note)
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { await viewModel.toggleStar(note) }
                        } label: {
                            Label(note.starred ? "取消" : "星标",
                                  systemImage: note.starred ? "star.slash" : "star")
                        }
                        .tint(.yellow)
                    }
                    .swipeActions(edge: .trailing) {
                        if viewModel.selectedFilter == .archived {
                            Button {
                                Task { await viewModel.restore(note) }
                            } label: {
                                Label("还原", systemImage: "tray.and.arrow.up")
                            }
                            .tint(.blue)
                        } else {
                            Button {
                                Task { await viewModel.archive(note) }
                            } label: {
                                Label("归档", systemImage: "archivebox")
                            }
                            .tint(.orange)
                        }
                        Button(role: .destructive) {
                            Task { await viewModel.delete(note) }
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await viewModel.load()
        }
    }
}

/// 单行笔记 — title + content 1 行 preview + tags + 状态徽章。
private struct NoteRow: View {
    let note: KnowledgeNote

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(note.title.isEmpty ? "(无标题)" : note.title)
                    .font(.body).fontWeight(.medium)
                Spacer()
                if note.starred { Image(systemName: "star.fill").foregroundColor(.yellow).font(.caption) }
                if note.pinned { Image(systemName: "pin.fill").foregroundColor(.orange).font(.caption) }
                if note.archived { Image(systemName: "archivebox.fill").foregroundColor(.gray).font(.caption) }
            }
            if let content = note.content, !content.isEmpty {
                Text(content)
                    .font(.caption).foregroundColor(.secondary)
                    .lineLimit(2)
            }
            if !note.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(note.tags.prefix(4), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.blue.opacity(0.15))
                            .cornerRadius(4)
                    }
                    if note.tags.count > 4 {
                        Text("+\(note.tags.count - 4)").font(.caption2).foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// 新建笔记 sheet。
private struct CreateNoteSheet: View {
    var onSave: (String, String, [String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var content = ""
    @State private var tagsText = ""

    var body: some View {
        NavigationView {
            Form {
                Section("标题") {
                    TextField("笔记标题", text: $title)
                }
                Section("内容") {
                    TextEditor(text: $content)
                        .frame(minHeight: 200)
                }
                Section("标签 (逗号分隔)") {
                    TextField("如：work, ideas", text: $tagsText)
                        .autocapitalization(.none)
                }
            }
            .navigationTitle("新建笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        let tags = tagsText
                            .split(separator: ",")
                            .map { $0.trimmingCharacters(in: .whitespaces) }
                            .filter { !$0.isEmpty }
                        onSave(title, content, tags)
                    }
                    .disabled(title.isEmpty || content.isEmpty)
                }
            }
        }
    }
}
