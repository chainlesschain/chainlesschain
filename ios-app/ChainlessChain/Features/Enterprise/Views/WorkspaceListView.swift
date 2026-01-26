import SwiftUI

/// 工作空间列表视图
public struct WorkspaceListView: View {

    let orgId: String

    @StateObject private var viewModel = WorkspaceViewModel()
    @StateObject private var identityManager = IdentityManager.shared

    @State private var showCreateSheet = false
    @State private var searchText = ""
    @State private var selectedType: WorkspaceType?
    @State private var showArchived = false

    public init(orgId: String) {
        self.orgId = orgId
    }

    public var body: some View {
        ZStack {
            if viewModel.isLoading && viewModel.workspaces.isEmpty {
                ProgressView("加载中...")
            } else if viewModel.workspaces.isEmpty {
                emptyStateView
            } else {
                workspaceListContent
            }
        }
        .navigationTitle("工作空间")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showCreateSheet = true
                    } label: {
                        Label("创建工作空间", systemImage: "plus.circle")
                    }

                    Divider()

                    Toggle("显示已归档", isOn: $showArchived)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .searchable(text: $searchText, prompt: "搜索工作空间")
        .sheet(isPresented: $showCreateSheet) {
            CreateWorkspaceSheet(orgId: orgId, viewModel: viewModel)
        }
        .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("确定") {
                viewModel.clearMessages()
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .overlay(alignment: .top) {
            if let message = viewModel.successMessage {
                SuccessBanner(message: message) {
                    viewModel.clearMessages()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(), value: viewModel.successMessage)
            }
        }
        .task {
            await viewModel.loadWorkspaces(orgId: orgId)
        }
    }

    // MARK: - Subviews

    private var workspaceListContent: some View {
        List {
            // Type Filter Section
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        FilterChip(
                            title: "全部",
                            isSelected: selectedType == nil,
                            action: { selectedType = nil }
                        )

                        ForEach(WorkspaceType.allCases, id: \.self) { type in
                            FilterChip(
                                title: type.displayName,
                                icon: type.icon,
                                isSelected: selectedType == type,
                                action: { selectedType = type }
                            )
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)

            // Workspaces
            ForEach(filteredWorkspaces) { workspace in
                NavigationLink {
                    WorkspaceDetailView(workspace: workspace)
                } label: {
                    WorkspaceRow(workspace: workspace)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if !workspace.archived {
                        Button {
                            Task {
                                guard let userDID = identityManager.currentIdentity?.did else { return }
                                await viewModel.archiveWorkspace(
                                    workspaceId: workspace.id,
                                    userDID: userDID
                                )
                            }
                        } label: {
                            Label("归档", systemImage: "archivebox")
                        }
                        .tint(.orange)
                    } else {
                        Button {
                            Task {
                                guard let userDID = identityManager.currentIdentity?.did else { return }
                                await viewModel.unarchiveWorkspace(
                                    workspaceId: workspace.id,
                                    userDID: userDID
                                )
                            }
                        } label: {
                            Label("取消归档", systemImage: "arrow.uturn.backward")
                        }
                        .tint(.green)
                    }

                    if canDeleteWorkspace(workspace) {
                        Button(role: .destructive) {
                            Task {
                                guard let userDID = identityManager.currentIdentity?.did else { return }
                                await viewModel.deleteWorkspace(
                                    workspaceId: workspace.id,
                                    userDID: userDID
                                )
                            }
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable {
            await viewModel.loadWorkspaces(orgId: orgId)
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "folder.badge.gearshape")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无工作空间")
                .font(.title2)
                .fontWeight(.semibold)

            Text("创建工作空间来组织项目和资源")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button {
                showCreateSheet = true
            } label: {
                Label("创建工作空间", systemImage: "plus.circle.fill")
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .padding(.top, 10)
        }
        .padding()
    }

    // MARK: - Computed Properties

    private var filteredWorkspaces: [Workspace] {
        var workspaces = viewModel.workspaces

        // Search filter
        if !searchText.isEmpty {
            workspaces = viewModel.searchWorkspaces(query: searchText)
        }

        // Type filter
        if let type = selectedType {
            workspaces = workspaces.filter { $0.type == type }
        }

        // Archived filter
        if !showArchived {
            workspaces = workspaces.filter { !$0.archived }
        }

        return workspaces
    }

    private func canDeleteWorkspace(_ workspace: Workspace) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else {
            return false
        }
        return workspace.createdBy == currentDID && !workspace.isDefault
    }
}

// MARK: - Workspace Row

struct WorkspaceRow: View {
    let workspace: Workspace

    @State private var memberCount: Int = 0
    @State private var resourceCount: Int = 0

    var body: some View {
        HStack(spacing: 12) {
            // Workspace Icon
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(hex: workspace.color)?.opacity(0.2) ?? Color.accentColor.opacity(0.2))
                    .frame(width: 50, height: 50)

                Image(systemName: workspace.icon)
                    .font(.title3)
                    .foregroundColor(Color(hex: workspace.color) ?? .accentColor)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(workspace.name)
                        .font(.headline)

                    if workspace.isDefault {
                        Badge(text: "默认", color: .blue)
                    }

                    if workspace.archived {
                        Badge(text: "已归档", color: .gray)
                    }
                }

                if !workspace.description.isEmpty {
                    Text(workspace.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 12) {
                    Label("\(memberCount)", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Label("\(resourceCount)", systemImage: "doc.text")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if workspace.visibility != .members {
                        Image(systemName: workspace.visibility == .admins ? "lock.fill" : "key.fill")
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
        .opacity(workspace.archived ? 0.6 : 1.0)
        .task {
            let viewModel = WorkspaceViewModel()
            memberCount = await viewModel.getMemberCount(for: workspace.id)
            resourceCount = await viewModel.getResourceCount(for: workspace.id)
        }
    }
}

// MARK: - Create Workspace Sheet

struct CreateWorkspaceSheet: View {
    let orgId: String
    @ObservedObject var viewModel: WorkspaceViewModel

    @StateObject private var identityManager = IdentityManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var description = ""
    @State private var type: WorkspaceType = .default
    @State private var color = "#1890ff"
    @State private var icon = "folder"
    @State private var visibility: WorkspaceVisibility = .members
    @State private var isDefault = false

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    TextField("工作空间名称", text: $name)
                    TextField("描述（可选）", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("类型") {
                    Picker("类型", selection: $type) {
                        ForEach(WorkspaceType.allCases, id: \.self) { type in
                            HStack {
                                Image(systemName: type.icon)
                                Text(type.displayName)
                            }
                            .tag(type)
                        }
                    }
                }

                Section("外观") {
                    HStack {
                        Text("图标")
                        Spacer()
                        Picker("", selection: $icon) {
                            ForEach(workspaceIcons, id: \.self) { iconName in
                                Image(systemName: iconName).tag(iconName)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    ColorPicker("颜色", selection: Binding(
                        get: { Color(hex: color) ?? .blue },
                        set: { color = $0.toHex() ?? "#1890ff" }
                    ))
                }

                Section("可见性") {
                    Picker("可见性", selection: $visibility) {
                        Text("所有成员").tag(WorkspaceVisibility.members)
                        Text("仅管理员").tag(WorkspaceVisibility.admins)
                        Text("特定角色").tag(WorkspaceVisibility.specificRoles)
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    Toggle("设为默认工作空间", isOn: $isDefault)
                } footer: {
                    Text("默认工作空间会在进入组织时自动打开")
                }
            }
            .navigationTitle("创建工作空间")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        createWorkspace()
                    }
                    .disabled(name.isEmpty || viewModel.isLoading)
                }
            }
        }
    }

    private func createWorkspace() {
        guard let creatorDID = identityManager.currentIdentity?.did else { return }

        Task {
            await viewModel.createWorkspace(
                orgId: orgId,
                name: name,
                description: description,
                type: type,
                color: color,
                icon: icon,
                visibility: visibility,
                allowedRoles: [],
                creatorDID: creatorDID
            )

            if viewModel.errorMessage == nil {
                dismiss()
            }
        }
    }

    private let workspaceIcons = [
        "folder", "folder.fill", "doc.text", "doc.text.fill",
        "tray", "tray.fill", "archivebox", "archivebox.fill",
        "briefcase", "briefcase.fill", "book", "book.fill",
        "hammer", "hammer.fill", "wrench", "wrench.fill"
    ]
}

// MARK: - Filter Chip

struct FilterChip: View {
    let title: String
    var icon: String? = nil
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.caption)
                }
                Text(title)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.accentColor : Color.secondary.opacity(0.2))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(16)
        }
    }
}

// MARK: - Color Extension

extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            return nil
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    func toHex() -> String? {
        guard let components = cgColor?.components, components.count >= 3 else {
            return nil
        }
        let r = Int(components[0] * 255.0)
        let g = Int(components[1] * 255.0)
        let b = Int(components[2] * 255.0)
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        WorkspaceListView(orgId: "org_123")
    }
}
