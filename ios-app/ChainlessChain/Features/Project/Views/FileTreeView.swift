import SwiftUI
import CoreCommon

/// 文件树视图
/// Reference: desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue
struct FileTreeView: View {
    let projectId: String
    var onFileSelected: ((ProjectFileEntity) -> Void)?
    var onFileOperation: ((String, ProjectFileEntity) -> Void)?  // (operation, file)

    @StateObject private var viewModel: FileTreeViewModel
    @State private var showCreateSheet = false
    @State private var createType: CreateType = .file
    @State private var createName: String = ""
    @State private var createParentId: String?

    enum CreateType {
        case file
        case folder
    }

    init(projectId: String,
         onFileSelected: ((ProjectFileEntity) -> Void)? = nil,
         onFileOperation: ((String, ProjectFileEntity) -> Void)? = nil) {
        self.projectId = projectId
        self.onFileSelected = onFileSelected
        self.onFileOperation = onFileOperation
        _viewModel = StateObject(wrappedValue: FileTreeViewModel(projectId: projectId))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            fileTreeToolbar

            Divider()

            // Tree content
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.fileTree.isEmpty {
                emptyStateView
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.fileTree) { node in
                            FileTreeNodeView(
                                node: node,
                                depth: 0,
                                viewModel: viewModel,
                                onSelect: handleFileSelection,
                                onOperation: handleFileOperation
                            )
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .sheet(isPresented: $showCreateSheet) {
            createItemSheet
        }
        .alert("错误", isPresented: .constant(viewModel.error != nil)) {
            Button("确定") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
        .onAppear {
            viewModel.loadFileTree()
        }
    }

    // MARK: - Toolbar

    private var fileTreeToolbar: some View {
        HStack {
            Text("文件")
                .font(.headline)

            Spacer()

            // Create new file
            Menu {
                Button {
                    createType = .file
                    createParentId = nil
                    createName = ""
                    showCreateSheet = true
                } label: {
                    Label("新建文件", systemImage: "doc.badge.plus")
                }

                Button {
                    createType = .folder
                    createParentId = nil
                    createName = ""
                    showCreateSheet = true
                } label: {
                    Label("新建文件夹", systemImage: "folder.badge.plus")
                }
            } label: {
                Image(systemName: "plus")
                    .font(.body)
                    .foregroundColor(.blue)
            }

            // Expand/Collapse all
            Menu {
                Button {
                    viewModel.expandAll()
                } label: {
                    Label("展开全部", systemImage: "arrow.up.left.and.arrow.down.right")
                }

                Button {
                    viewModel.collapseAll()
                } label: {
                    Label("折叠全部", systemImage: "arrow.down.right.and.arrow.up.left")
                }

                Divider()

                Button {
                    viewModel.loadFileTree()
                    viewModel.loadGitStatus()
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(Color(.systemBackground))
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("暂无文件")
                .font(.headline)
                .foregroundColor(.secondary)

            Button {
                createType = .file
                createParentId = nil
                createName = ""
                showCreateSheet = true
            } label: {
                Label("创建文件", systemImage: "plus")
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Create Sheet

    private var createItemSheet: some View {
        NavigationView {
            Form {
                Section {
                    TextField(createType == .file ? "文件名" : "文件夹名", text: $createName)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }

                if createType == .file {
                    Section(footer: Text("支持的格式: .md, .txt, .json, .swift, .js, .py 等")) {
                        // File type suggestions
                        HStack {
                            ForEach(["README.md", "index.js", "main.py"], id: \.self) { suggestion in
                                Button(suggestion) {
                                    createName = suggestion
                                }
                                .buttonStyle(.bordered)
                                .font(.caption)
                            }
                        }
                    }
                }
            }
            .navigationTitle(createType == .file ? "新建文件" : "新建文件夹")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        showCreateSheet = false
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        Task {
                            await createItem()
                        }
                    }
                    .disabled(createName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    // MARK: - Actions

    private func handleFileSelection(_ file: ProjectFileEntity) {
        viewModel.selectFile(file)
        onFileSelected?(file)
    }

    private func handleFileOperation(_ operation: String, _ file: ProjectFileEntity) {
        switch operation {
        case "rename":
            viewModel.startRenaming(file: file)
        case "delete":
            Task {
                do {
                    try await viewModel.deleteFile(fileId: file.id)
                } catch {
                    viewModel.error = error.localizedDescription
                }
            }
        case "createFileIn":
            createType = .file
            createParentId = file.id
            createName = ""
            showCreateSheet = true
        case "createFolderIn":
            createType = .folder
            createParentId = file.id
            createName = ""
            showCreateSheet = true
        default:
            onFileOperation?(operation, file)
        }
    }

    private func createItem() async {
        let name = createName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        do {
            if createType == .file {
                try await viewModel.createFile(name: name, parentId: createParentId)
            } else {
                try await viewModel.createFolder(name: name, parentId: createParentId)
            }
            showCreateSheet = false
        } catch {
            viewModel.error = error.localizedDescription
        }
    }
}

// MARK: - File Tree Node View

struct FileTreeNodeView: View {
    let node: FileTreeNode
    let depth: Int
    @ObservedObject var viewModel: FileTreeViewModel
    let onSelect: (ProjectFileEntity) -> Void
    let onOperation: (String, ProjectFileEntity) -> Void

    @State private var showDeleteConfirm = false

    private var isExpanded: Bool {
        viewModel.expandedNodes.contains(node.id)
    }

    private var isSelected: Bool {
        viewModel.selectedFile?.id == node.id
    }

    private var isEditing: Bool {
        viewModel.editingFileId == node.id
    }

    var body: some View {
        VStack(spacing: 0) {
            // Node row
            nodeRow
                .background(isSelected ? Color.blue.opacity(0.15) : Color.clear)
                .contentShape(Rectangle())
                .onTapGesture {
                    if node.isDirectory {
                        viewModel.toggleExpanded(node.id)
                    } else {
                        onSelect(node.file)
                    }
                }
                .contextMenu {
                    nodeContextMenu
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("删除", systemImage: "trash")
                    }

                    Button {
                        onOperation("rename", node.file)
                    } label: {
                        Label("重命名", systemImage: "pencil")
                    }
                    .tint(.orange)
                }

            // Children (if expanded)
            if node.isDirectory && isExpanded {
                ForEach(node.children) { child in
                    FileTreeNodeView(
                        node: child,
                        depth: depth + 1,
                        viewModel: viewModel,
                        onSelect: onSelect,
                        onOperation: onOperation
                    )
                }
            }
        }
        .alert("确认删除", isPresented: $showDeleteConfirm) {
            Button("取消", role: .cancel) { }
            Button("删除", role: .destructive) {
                onOperation("delete", node.file)
            }
        } message: {
            Text("确定要删除 \"\(node.name)\" 吗？此操作不可撤销。")
        }
    }

    private var nodeRow: some View {
        HStack(spacing: 8) {
            // Indentation
            Spacer()
                .frame(width: CGFloat(depth) * 16)

            // Expand/collapse chevron (for directories)
            if node.isDirectory {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .frame(width: 16)
            } else {
                Spacer()
                    .frame(width: 16)
            }

            // File icon
            Image(systemName: viewModel.getFileIcon(for: node.file))
                .font(.system(size: 14))
                .foregroundColor(Color.fileIconColor(viewModel.getFileIconColor(for: node.file)))
                .frame(width: 20)

            // File name or edit field
            if isEditing {
                TextField("名称", text: $viewModel.editingFileName, onCommit: {
                    Task {
                        await viewModel.confirmRenaming()
                    }
                })
                .textFieldStyle(.plain)
                .font(.subheadline)

                Button {
                    Task {
                        await viewModel.confirmRenaming()
                    }
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                }

                Button {
                    viewModel.cancelRenaming()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.red)
                }
            } else {
                Text(node.name)
                    .font(.subheadline)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                // Git status indicator
                gitStatusIndicator
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var gitStatusIndicator: some View {
        if viewModel.hasConflict(path: node.file.path) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption2)
                .foregroundColor(.red)
        } else if let state = viewModel.getGitState(for: node.file.path) {
            Text(state.rawValue)
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundColor(gitStateColor(state))
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(gitStateColor(state).opacity(0.15))
                .cornerRadius(4)
        }
    }

    private func gitStateColor(_ state: GitFileState) -> Color {
        switch state {
        case .added:
            return .green
        case .modified:
            return .orange
        case .deleted:
            return .red
        case .renamed:
            return .blue
        }
    }

    @ViewBuilder
    private var nodeContextMenu: some View {
        if node.isDirectory {
            Button {
                onOperation("createFileIn", node.file)
            } label: {
                Label("新建文件", systemImage: "doc.badge.plus")
            }

            Button {
                onOperation("createFolderIn", node.file)
            } label: {
                Label("新建文件夹", systemImage: "folder.badge.plus")
            }

            Divider()
        }

        Button {
            onOperation("rename", node.file)
        } label: {
            Label("重命名", systemImage: "pencil")
        }

        Button {
            onOperation("copy", node.file)
        } label: {
            Label("复制", systemImage: "doc.on.doc")
        }

        if !node.isDirectory {
            Button {
                onOperation("open", node.file)
            } label: {
                Label("打开", systemImage: "arrow.up.right.square")
            }

            Button {
                onOperation("share", node.file)
            } label: {
                Label("分享", systemImage: "square.and.arrow.up")
            }
        }

        Divider()

        Button(role: .destructive) {
            showDeleteConfirm = true
        } label: {
            Label("删除", systemImage: "trash")
        }
    }
}

// MARK: - Preview

#Preview {
    FileTreeView(projectId: "test-project")
}
