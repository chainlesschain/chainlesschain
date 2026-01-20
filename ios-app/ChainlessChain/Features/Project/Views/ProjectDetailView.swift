import SwiftUI
import CoreCommon

/// 项目详情视图
struct ProjectDetailView: View {
    let project: ProjectEntity

    @StateObject private var projectManager = ProjectManager.shared
    @State private var selectedTab = 0
    @State private var showEditSheet = false
    @State private var showShareSheet = false
    @State private var showAddFileSheet = false
    @State private var fileToDelete: ProjectFileEntity?
    @State private var showDeleteFileAlert = false

    private let logger = Logger.shared

    var body: some View {
        VStack(spacing: 0) {
            // Project header
            projectHeader

            // Tab picker
            Picker("", selection: $selectedTab) {
                Text("文件").tag(0)
                Text("活动").tag(1)
                Text("信息").tag(2)
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab content
            TabView(selection: $selectedTab) {
                filesTab.tag(0)
                activitiesTab.tag(1)
                infoTab.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showEditSheet = true
                    } label: {
                        Label("编辑", systemImage: "pencil")
                    }

                    Button {
                        showShareSheet = true
                    } label: {
                        Label("分享", systemImage: "square.and.arrow.up")
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
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showEditSheet) {
            EditProjectView(project: project)
        }
        .sheet(isPresented: $showShareSheet) {
            ShareProjectView(project: project)
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

    // MARK: - Project Header

    private var projectHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                // Type icon
                Image(systemName: project.typeIcon)
                    .font(.title)
                    .foregroundColor(statusColor)
                    .frame(width: 56, height: 56)
                    .background(statusColor.opacity(0.1))
                    .cornerRadius(12)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(project.status.displayName)
                            .font(.caption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(statusColor.opacity(0.1))
                            .foregroundColor(statusColor)
                            .cornerRadius(4)

                        if project.isShared {
                            Label("已分享", systemImage: "link")
                                .font(.caption)
                                .foregroundColor(.blue)
                        }

                        Spacer()

                        Image(systemName: project.syncStatus.icon)
                            .foregroundColor(.secondary)
                    }

                    if let description = project.description, !description.isEmpty {
                        Text(description)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                }
            }

            // Stats row
            HStack(spacing: 20) {
                Label("\(project.fileCount) 个文件", systemImage: "doc")
                Label(project.formattedSize, systemImage: "externaldrive")
                Label(project.updatedAt.formatted(date: .abbreviated, time: .shortened), systemImage: "clock")
            }
            .font(.caption)
            .foregroundColor(.secondary)

            // Tags
            if !project.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
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
        }
        .padding()
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Files Tab

    private var filesTab: some View {
        VStack {
            if projectManager.currentFiles.isEmpty {
                emptyFilesView
            } else {
                filesList
            }
        }
    }

    private var emptyFilesView: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("暂无文件")
                .font(.headline)

            Button {
                showAddFileSheet = true
            } label: {
                Label("添加文件", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var filesList: some View {
        List {
            ForEach(projectManager.currentFiles) { file in
                FileRowView(file: file)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            fileToDelete = file
                            showDeleteFileAlert = true
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
            }

            // Add file button
            Button {
                showAddFileSheet = true
            } label: {
                Label("添加文件", systemImage: "plus.circle")
                    .foregroundColor(.blue)
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Activities Tab

    private var activitiesTab: some View {
        let activities = projectManager.getProjectActivities(projectId: project.id)

        return Group {
            if activities.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)

                    Text("暂无活动记录")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(activities) { activity in
                    ActivityRowView(activity: activity)
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Info Tab

    private var infoTab: some View {
        List {
            Section("基本信息") {
                LabeledContent("项目ID", value: project.id)
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
                }
            }
        }
        .listStyle(.insetGrouped)
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
