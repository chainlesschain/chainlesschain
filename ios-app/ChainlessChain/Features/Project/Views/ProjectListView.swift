import SwiftUI
import CoreCommon

/// 项目列表视图
/// Reference: desktop-app-vue/src/renderer/pages/Projects.vue
struct ProjectListView: View {
    @StateObject private var projectManager = ProjectManager.shared
    @State private var searchText = ""
    @State private var selectedStatus: ProjectStatus?
    @State private var selectedType: ProjectType?
    @State private var showCreateSheet = false
    @State private var showFilterSheet = false
    @State private var projectToDelete: ProjectEntity?
    @State private var showDeleteAlert = false

    private let logger = Logger.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Statistics header
                if let stats = projectManager.statistics {
                    statsHeader(stats)
                }

                // Project list
                if projectManager.isLoading {
                    loadingView
                } else if projectManager.projects.isEmpty {
                    emptyStateView
                } else {
                    projectList
                }
            }
            .navigationTitle("项目")
            .searchable(text: $searchText, prompt: "搜索项目")
            .onChange(of: searchText) { _, newValue in
                debounceSearch(query: newValue)
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        filterButton
                        addButton
                    }
                }
            }
            .sheet(isPresented: $showCreateSheet) {
                CreateProjectView()
            }
            .sheet(isPresented: $showFilterSheet) {
                filterSheet
            }
            .alert("删除项目", isPresented: $showDeleteAlert) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    if let project = projectToDelete {
                        deleteProject(project)
                    }
                }
            } message: {
                Text("确定要删除项目「\(projectToDelete?.name ?? "")」吗？此操作不可撤销。")
            }
            .refreshable {
                projectManager.loadProjects(status: selectedStatus, type: selectedType)
            }
        }
    }

    // MARK: - Stats Header

    private func statsHeader(_ stats: ProjectStatistics) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                statCard(title: "全部", value: "\(stats.totalProjects)", icon: "folder.fill", color: .blue)
                statCard(title: "进行中", value: "\(stats.activeProjects)", icon: "play.circle.fill", color: .green)
                statCard(title: "草稿", value: "\(stats.draftProjects)", icon: "doc.fill", color: .gray)
                statCard(title: "已完成", value: "\(stats.completedProjects)", icon: "checkmark.circle.fill", color: .orange)
                statCard(title: "文件数", value: "\(stats.totalFiles)", icon: "doc.text.fill", color: .purple)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func statCard(title: String, value: String, icon: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)

            Text(value)
                .font(.headline)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(width: 70)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - Project List

    private var projectList: some View {
        List {
            ForEach(projectManager.projects) { project in
                NavigationLink(destination: ProjectDetailView(project: project)) {
                    ProjectRowView(project: project)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        projectToDelete = project
                        showDeleteAlert = true
                    } label: {
                        Label("删除", systemImage: "trash")
                    }

                    Button {
                        toggleProjectStatus(project)
                    } label: {
                        Label(
                            project.status == .completed ? "重开" : "完成",
                            systemImage: project.status == .completed ? "arrow.uturn.backward" : "checkmark"
                        )
                    }
                    .tint(project.status == .completed ? .orange : .green)
                }
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 64))
                .foregroundColor(.secondary)

            Text("暂无项目")
                .font(.title2)
                .fontWeight(.medium)

            Text("点击右上角的 + 按钮创建新项目")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button {
                showCreateSheet = true
            } label: {
                Label("创建项目", systemImage: "plus")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("加载中...")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Toolbar Buttons

    private var filterButton: some View {
        Button {
            showFilterSheet = true
        } label: {
            Image(systemName: hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    private var addButton: some View {
        Button {
            showCreateSheet = true
        } label: {
            Image(systemName: "plus")
        }
    }

    private var hasActiveFilters: Bool {
        selectedStatus != nil || selectedType != nil
    }

    // MARK: - Filter Sheet

    private var filterSheet: some View {
        NavigationStack {
            Form {
                Section("项目状态") {
                    Picker("状态", selection: $selectedStatus) {
                        Text("全部").tag(nil as ProjectStatus?)
                        ForEach(ProjectStatus.allCases, id: \.self) { status in
                            Text(status.displayName).tag(status as ProjectStatus?)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("项目类型") {
                    Picker("类型", selection: $selectedType) {
                        Text("全部").tag(nil as ProjectType?)
                        ForEach(ProjectType.allCases, id: \.self) { type in
                            Label(type.displayName, systemImage: type.icon)
                                .tag(type as ProjectType?)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section {
                    Button("清除筛选") {
                        selectedStatus = nil
                        selectedType = nil
                    }
                    .foregroundColor(.red)
                }
            }
            .navigationTitle("筛选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        showFilterSheet = false
                        projectManager.loadProjects(status: selectedStatus, type: selectedType)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func debounceSearch(query: String) {
        // Simple debounce using DispatchQueue
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if query == searchText {
                projectManager.searchProjects(query: query)
            }
        }
    }

    private func deleteProject(_ project: ProjectEntity) {
        do {
            try projectManager.deleteProject(projectId: project.id)
        } catch {
            logger.error("Failed to delete project", error: error, category: "Project")
        }
    }

    private func toggleProjectStatus(_ project: ProjectEntity) {
        let newStatus: ProjectStatus = project.status == .completed ? .active : .completed
        do {
            try projectManager.updateProjectStatus(projectId: project.id, status: newStatus)
        } catch {
            logger.error("Failed to update project status", error: error, category: "Project")
        }
    }
}

// MARK: - Project Row View

struct ProjectRowView: View {
    let project: ProjectEntity

    var body: some View {
        HStack(spacing: 12) {
            // Type icon
            Image(systemName: project.typeIcon)
                .font(.title2)
                .foregroundColor(statusColor)
                .frame(width: 44, height: 44)
                .background(statusColor.opacity(0.1))
                .cornerRadius(10)

            // Project info
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(project.name)
                        .font(.headline)
                        .lineLimit(1)

                    if project.isShared {
                        Image(systemName: "link.circle.fill")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }

                if let description = project.description, !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    // Status badge
                    Text(project.status.displayName)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(statusColor.opacity(0.1))
                        .foregroundColor(statusColor)
                        .cornerRadius(4)

                    // File count
                    Label("\(project.fileCount)", systemImage: "doc")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    // Size
                    Text(project.formattedSize)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Spacer()

                    // Sync status
                    Image(systemName: project.syncStatus.icon)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch project.status {
        case .draft: return .gray
        case .active: return .blue
        case .completed: return .green
        case .archived: return .orange
        }
    }
}

#Preview {
    ProjectListView()
}
