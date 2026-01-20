import SwiftUI
import CoreCommon

/// 项目详情视图
/// Reference: desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue
struct ProjectDetailView: View {
    let project: ProjectEntity

    @StateObject private var projectManager = ProjectManager.shared
    @State private var selectedTab: ProjectTab = .files
    @State private var selectedFile: ProjectFileEntity?
    @State private var showEditSheet = false
    @State private var showShareSheet = false
    @State private var showExportSheet = false
    @State private var showAddFileSheet = false
    @State private var fileToDelete: ProjectFileEntity?
    @State private var showDeleteFileAlert = false

    private let logger = Logger.shared

    enum ProjectTab: String, CaseIterable {
        case files = "文件"
        case chat = "对话"
        case editor = "编辑"
        case git = "Git"
        case info = "信息"

        var icon: String {
            switch self {
            case .files: return "folder"
            case .chat: return "bubble.left.and.bubble.right"
            case .editor: return "doc.text"
            case .git: return "point.3.connected.trianglepath.dotted"
            case .info: return "info.circle"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Project header (collapsed version)
            collapsedHeader

            // Tab bar
            tabBar

            // Tab content
            tabContent
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                toolbarMenu
            }
        }
        .sheet(isPresented: $showEditSheet) {
            EditProjectView(project: project)
        }
        .sheet(isPresented: $showShareSheet) {
            ShareProjectView(project: project)
        }
        .sheet(isPresented: $showExportSheet) {
            ExportMenuView(projectId: project.id, file: selectedFile)
        }
        .sheet(isPresented: $showAddFileSheet) {
            AddFileView(projectId: project.id)
        }
        .alert("删除文件", isPresented: $showDeleteFileAlert) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                if let file = fileToDelete {
                    deleteFile(file)
                }
            }
        } message: {
            Text("确定要删除文件「\(fileToDelete?.name ?? "")」吗？")
        }
        .onAppear {
            projectManager.selectProject(project)
        }
    }

    // MARK: - Collapsed Header

    private var collapsedHeader: some View {
        HStack(spacing: 12) {
            // Type icon
            Image(systemName: project.typeIcon)
                .font(.title2)
                .foregroundColor(statusColor)
                .frame(width: 44, height: 44)
                .background(statusColor.opacity(0.1))
                .cornerRadius(10)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(project.status.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(statusColor.opacity(0.1))
                        .foregroundColor(statusColor)
                        .cornerRadius(4)

                    if project.isShared {
                        Image(systemName: "link")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }

                    Spacer()

                    // Quick stats
                    HStack(spacing: 12) {
                        Label("\(project.fileCount)", systemImage: "doc")
                        Label(project.formattedSize, systemImage: "externaldrive")
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                }

                if let description = project.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(Color(.systemBackground))
    }

    // MARK: - Tab Bar

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(ProjectTab.allCases, id: \.self) { tab in
                    tabButton(tab)
                }
            }
            .padding(.horizontal)
        }
        .background(Color(.systemBackground))
    }

    private func tabButton(_ tab: ProjectTab) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                // If switching to editor without a file, show files instead
                if tab == .editor && selectedFile == nil {
                    selectedTab = .files
                } else {
                    selectedTab = tab
                }
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 18))

                Text(tab.rawValue)
                    .font(.caption)
            }
            .foregroundColor(selectedTab == tab ? .blue : .secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                selectedTab == tab ?
                    Color.blue.opacity(0.1) : Color.clear
            )
            .cornerRadius(8)
        }
        .disabled(tab == .editor && selectedFile == nil)
        .opacity(tab == .editor && selectedFile == nil ? 0.5 : 1)
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .files:
            filesTabContent
        case .chat:
            chatTabContent
        case .editor:
            editorTabContent
        case .git:
            gitTabContent
        case .info:
            infoTabContent
        }
    }

    // MARK: - Files Tab

    private var filesTabContent: some View {
        FileTreeView(
            projectId: project.id,
            onFileSelected: { file in
                selectedFile = file
                if !file.isDirectory {
                    selectedTab = .editor
                }
            },
            onFileOperation: { operation, file in
                handleFileOperation(operation, file: file)
            }
        )
    }

    // MARK: - Chat Tab

    private var chatTabContent: some View {
        ProjectChatView(
            projectId: project.id,
            currentFile: selectedFile,
            onFileOperation: { type, path in
                // Handle file operations from chat
                logger.info("Chat file operation: \(type) - \(path)", category: "Project")
            }
        )
    }

    // MARK: - Editor Tab

    @ViewBuilder
    private var editorTabContent: some View {
        if let file = selectedFile {
            FileEditorView(
                file: file,
                onSave: {
                    projectManager.loadProjectFiles(projectId: project.id)
                },
                onClose: {
                    selectedFile = nil
                    selectedTab = .files
                }
            )
        } else {
            VStack(spacing: 16) {
                Image(systemName: "doc.text")
                    .font(.system(size: 48))
                    .foregroundColor(.secondary)

                Text("请先选择一个文件")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Button {
                    selectedTab = .files
                } label: {
                    Label("浏览文件", systemImage: "folder")
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Git Tab

    private var gitTabContent: some View {
        GitOperationsView(projectId: project.id)
    }

    // MARK: - Info Tab

    private var infoTabContent: some View {
        List {
            Section("基本信息") {
                LabeledContent("项目ID") {
                    Text(project.id)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                LabeledContent("类型", value: project.type.displayName)
                LabeledContent("状态", value: project.status.displayName)
            }

            Section("统计") {
                LabeledContent("文件数量", value: "\(project.fileCount)")
                LabeledContent("总大小", value: project.formattedSize)
            }

            Section("时间") {
                LabeledContent("创建时间", value: project.createdAt.formatted())
                LabeledContent("更新时间", value: project.updatedAt.formatted())
                if let syncedAt = project.lastSyncedAt {
                    LabeledContent("同步时间", value: syncedAt.formatted())
                }
            }

            Section("同步") {
                LabeledContent("同步状态", value: project.syncStatus.displayName)
                if project.isShared {
                    LabeledContent("分享状态", value: "已分享")
                    if let token = project.shareToken {
                        LabeledContent("分享Token") {
                            Text(String(token.prefix(16)) + "...")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            if !project.tags.isEmpty {
                Section("标签") {
                    FlowLayout(spacing: 8) {
                        ForEach(project.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1))
                                .foregroundColor(.blue)
                                .cornerRadius(8)
                        }
                    }
                }
            }

            // Activities section
            Section("最近活动") {
                let activities = projectManager.getProjectActivities(projectId: project.id).prefix(5)
                if activities.isEmpty {
                    Text("暂无活动记录")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(Array(activities)) { activity in
                        ActivityRowView(activity: activity)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Toolbar Menu

    private var toolbarMenu: some View {
        Menu {
            Button {
                showEditSheet = true
            } label: {
                Label("编辑项目", systemImage: "pencil")
            }

            Button {
                showExportSheet = true
            } label: {
                Label("导出", systemImage: "square.and.arrow.up")
            }

            Button {
                showShareSheet = true
            } label: {
                Label("分享", systemImage: "link")
            }

            Divider()

            Menu("更改状态") {
                ForEach(ProjectStatus.allCases, id: \.self) { status in
                    Button {
                        updateStatus(status)
                    } label: {
                        if project.status == status {
                            Label(status.displayName, systemImage: "checkmark")
                        } else {
                            Text(status.displayName)
                        }
                    }
                }
            }

            Divider()

            Button {
                showAddFileSheet = true
            } label: {
                Label("添加文件", systemImage: "doc.badge.plus")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: - Helpers

    private var statusColor: Color {
        switch project.status {
        case .draft: return .gray
        case .active: return .blue
        case .completed: return .green
        case .archived: return .orange
        }
    }

    private func updateStatus(_ status: ProjectStatus) {
        do {
            try projectManager.updateProjectStatus(projectId: project.id, status: status)
        } catch {
            logger.error("Failed to update project status", error: error, category: "Project")
        }
    }

    private func deleteFile(_ file: ProjectFileEntity) {
        do {
            try projectManager.deleteFile(file)
        } catch {
            logger.error("Failed to delete file", error: error, category: "Project")
        }
    }

    private func handleFileOperation(_ operation: String, file: ProjectFileEntity) {
        switch operation {
        case "open":
            selectedFile = file
            selectedTab = .editor
        case "share":
            // Share file
            if let content = file.content {
                let activityVC = UIActivityViewController(
                    activityItems: [content],
                    applicationActivities: nil
                )
                if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let window = windowScene.windows.first,
                   let rootVC = window.rootViewController {
                    rootVC.present(activityVC, animated: true)
                }
            }
        case "delete":
            fileToDelete = file
            showDeleteFileAlert = true
        default:
            logger.debug("Unhandled file operation: \(operation)", category: "Project")
        }
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                      y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }

                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}

// MARK: - File Row View

struct FileRowView: View {
    let file: ProjectFileEntity

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: file.icon)
                .font(.title2)
                .foregroundColor(file.isDirectory ? .blue : .gray)
                .frame(width: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.body)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(file.type.uppercased())
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.gray.opacity(0.2))
                        .cornerRadius(2)

                    if !file.isDirectory {
                        Text(file.formattedSize)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Activity Row View

struct ActivityRowView: View {
    let activity: ProjectActivityEntity

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: activity.actionIcon)
                .font(.title3)
                .foregroundColor(.blue)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                if let description = activity.description {
                    Text(description)
                        .font(.body)
                }

                Text(activity.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Edit Project View

struct EditProjectView: View {
    @Environment(\.dismiss) private var dismiss
    let project: ProjectEntity

    @StateObject private var projectManager = ProjectManager.shared
    @State private var name: String
    @State private var description: String
    @State private var selectedType: ProjectType
    @State private var isSaving = false

    init(project: ProjectEntity) {
        self.project = project
        _name = State(initialValue: project.name)
        _description = State(initialValue: project.description ?? "")
        _selectedType = State(initialValue: project.type)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("项目名称", text: $name)
                    TextField("项目描述", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("项目类型") {
                    Picker("类型", selection: $selectedType) {
                        ForEach(ProjectType.allCases, id: \.self) { type in
                            Label(type.displayName, systemImage: type.icon)
                                .tag(type)
                        }
                    }
                }
            }
            .navigationTitle("编辑项目")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") { saveChanges() }
                        .fontWeight(.semibold)
                        .disabled(name.isEmpty || isSaving)
                }
            }
        }
    }

    private func saveChanges() {
        isSaving = true
        var updatedProject = project
        updatedProject.name = name
        updatedProject.description = description.isEmpty ? nil : description
        updatedProject.type = selectedType

        do {
            try projectManager.updateProject(updatedProject)
            dismiss()
        } catch {
            // Handle error
        }
        isSaving = false
    }
}

// MARK: - Share Project View

struct ShareProjectView: View {
    @Environment(\.dismiss) private var dismiss
    let project: ProjectEntity

    @StateObject private var projectManager = ProjectManager.shared
    @State private var shareToken: String?
    @State private var isGenerating = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "square.and.arrow.up.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(.blue)

                Text("分享项目")
                    .font(.title2)
                    .fontWeight(.bold)

                if project.isShared, let token = project.shareToken {
                    VStack(spacing: 12) {
                        Text("分享链接已生成")
                            .foregroundColor(.secondary)

                        Text(token)
                            .font(.system(.caption, design: .monospaced))
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(8)

                        Button {
                            UIPasteboard.general.string = token
                        } label: {
                            Label("复制链接", systemImage: "doc.on.doc")
                        }
                        .buttonStyle(.borderedProminent)

                        Button(role: .destructive) {
                            cancelShare()
                        } label: {
                            Text("取消分享")
                        }
                    }
                } else {
                    Text("生成分享链接后，其他人可以通过链接访问此项目")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    Button {
                        generateShareLink()
                    } label: {
                        Label("生成分享链接", systemImage: "link.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isGenerating)
                }

                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func generateShareLink() {
        isGenerating = true
        do {
            shareToken = try projectManager.generateShareToken(projectId: project.id)
        } catch {
            // Handle error
        }
        isGenerating = false
    }

    private func cancelShare() {
        do {
            try projectManager.cancelShare(projectId: project.id)
            dismiss()
        } catch {
            // Handle error
        }
    }
}

// MARK: - Add File View

struct AddFileView: View {
    @Environment(\.dismiss) private var dismiss
    let projectId: String

    @StateObject private var projectManager = ProjectManager.shared
    @State private var fileName = ""
    @State private var fileType = "txt"
    @State private var fileContent = ""
    @State private var isDirectory = false
    @State private var isCreating = false

    var body: some View {
        NavigationStack {
            Form {
                Section("文件信息") {
                    TextField("文件名", text: $fileName)
                        .textInputAutocapitalization(.never)

                    Toggle("创建文件夹", isOn: $isDirectory)

                    if !isDirectory {
                        Picker("文件类型", selection: $fileType) {
                            Text("文本 (.txt)").tag("txt")
                            Text("Markdown (.md)").tag("md")
                            Text("JSON (.json)").tag("json")
                            Text("Swift (.swift)").tag("swift")
                            Text("JavaScript (.js)").tag("js")
                            Text("HTML (.html)").tag("html")
                            Text("CSS (.css)").tag("css")
                        }
                    }
                }

                if !isDirectory {
                    Section("文件内容") {
                        TextEditor(text: $fileContent)
                            .frame(minHeight: 200)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
            .navigationTitle("添加文件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("创建") { createFile() }
                        .fontWeight(.semibold)
                        .disabled(fileName.isEmpty || isCreating)
                }
            }
        }
    }

    private func createFile() {
        isCreating = true
        do {
            let fullName = isDirectory ? fileName : "\(fileName).\(fileType)"
            let _ = try projectManager.createFile(
                projectId: projectId,
                name: fullName,
                type: isDirectory ? "folder" : fileType,
                content: isDirectory ? nil : fileContent,
                isDirectory: isDirectory
            )
            dismiss()
        } catch {
            // Handle error
        }
        isCreating = false
    }
}

#Preview {
    NavigationStack {
        ProjectDetailView(project: ProjectEntity(
            name: "测试项目",
            description: "这是一个测试项目的描述",
            type: .document,
            status: .active
        ))
    }
}
