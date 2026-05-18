import SwiftUI

/// 工作空间详情视图
public struct WorkspaceDetailView: View {

    let workspace: Workspace

    @StateObject private var viewModel = WorkspaceViewModel()
    @StateObject private var identityManager = IdentityManager.shared

    @State private var selectedTab = 0
    @State private var showAddMemberSheet = false
    @State private var showAddResourceSheet = false
    @State private var showSettingsSheet = false
    @State private var members: [WorkspaceMember] = []
    @State private var resources: [WorkspaceResource] = []
    @State private var activities: [WorkspaceActivity] = []

    public init(workspace: Workspace) {
        self.workspace = workspace
    }

    public var body: some View {
        ZStack {
            if viewModel.isLoading && members.isEmpty {
                ProgressView("加载中...")
            } else {
                contentView
            }
        }
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showAddMemberSheet = true
                    } label: {
                        Label("添加成员", systemImage: "person.badge.plus")
                    }

                    Button {
                        showAddResourceSheet = true
                    } label: {
                        Label("添加资源", systemImage: "doc.badge.plus")
                    }

                    Divider()

                    Button {
                        showSettingsSheet = true
                    } label: {
                        Label("工作空间设置", systemImage: "gearshape")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showAddMemberSheet) {
            AddWorkspaceMemberSheet(
                workspaceId: workspace.id,
                viewModel: viewModel,
                onMemberAdded: {
                    Task { await loadMembers() }
                }
            )
        }
        .sheet(isPresented: $showAddResourceSheet) {
            AddWorkspaceResourceSheet(
                workspaceId: workspace.id,
                viewModel: viewModel,
                onResourceAdded: {
                    Task { await loadResources() }
                }
            )
        }
        .sheet(isPresented: $showSettingsSheet) {
            WorkspaceSettingsSheet(workspace: workspace, viewModel: viewModel)
        }
        .task {
            await loadWorkspaceDetails()
        }
    }

    // MARK: - Content View

    private var contentView: some View {
        VStack(spacing: 0) {
            // Workspace Header
            workspaceHeader
                .padding()
                .background(Color(.systemBackground))

            Divider()

            // Tabs
            Picker("", selection: $selectedTab) {
                Text("成员 (\(members.count))").tag(0)
                Text("资源 (\(resources.count))").tag(1)
                Text("活动").tag(2)
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab Content
            TabView(selection: $selectedTab) {
                membersTab.tag(0)
                resourcesTab.tag(1)
                activitiesTab.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    // MARK: - Workspace Header

    private var workspaceHeader: some View {
        VStack(spacing: 12) {
            // Icon
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(hex: workspace.color)?.opacity(0.2) ?? Color.accentColor.opacity(0.2))
                    .frame(width: 80, height: 80)

                Image(systemName: workspace.icon)
                    .font(.system(size: 40))
                    .foregroundColor(Color(hex: workspace.color) ?? .accentColor)
            }

            // Name and Type
            VStack(spacing: 4) {
                Text(workspace.name)
                    .font(.title2)
                    .fontWeight(.bold)

                HStack(spacing: 8) {
                    Badge(text: workspace.type.displayName, color: .blue)

                    if workspace.isDefault {
                        Badge(text: "默认", color: .purple)
                    }

                    if workspace.archived {
                        Badge(text: "已归档", color: .gray)
                    }

                    visibilityBadge
                }
            }

            // Description
            if !workspace.description.isEmpty {
                Text(workspace.description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Stats
            HStack(spacing: 30) {
                StatItem(value: "\(members.count)", label: "成员")
                StatItem(value: "\(resources.count)", label: "资源")
                StatItem(value: "\(activities.count)", label: "活动")
            }
            .padding(.top, 8)
        }
    }

    private var visibilityBadge: some View {
        Group {
            switch workspace.visibility {
            case .members:
                Badge(text: "所有成员", color: .green)
            case .admins:
                Badge(text: "仅管理员", color: .orange)
            case .specificRoles:
                Badge(text: "特定角色", color: .red)
            }
        }
    }

    // MARK: - Members Tab

    private var membersTab: some View {
        VStack(spacing: 0) {
            List {
                ForEach(members) { member in
                    WorkspaceMemberRow(member: member)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if canRemoveMember(member) {
                                Button(role: .destructive) {
                                    Task {
                                        await viewModel.removeMember(
                                            workspaceId: workspace.id,
                                            memberDID: member.memberDID
                                        )
                                        await loadMembers()
                                    }
                                } label: {
                                    Label("移除", systemImage: "person.badge.minus")
                                }
                            }
                        }
                        .contextMenu {
                            if canUpdateMemberRole(member) {
                                ForEach([WorkspaceMemberRole.admin, .member, .guest], id: \.self) { role in
                                    if role != member.role {
                                        Button {
                                            Task {
                                                await viewModel.updateMemberRole(
                                                    workspaceId: workspace.id,
                                                    memberDID: member.memberDID,
                                                    newRole: role
                                                )
                                                await loadMembers()
                                            }
                                        } label: {
                                            Label("设为\(role.displayName)", systemImage: "person.badge.key")
                                        }
                                    }
                                }
                            }
                        }
                }
            }
            .listStyle(.plain)
            .overlay {
                if members.isEmpty {
                    Text("暂无成员")
                        .foregroundColor(.secondary)
                }
            }

            // Add Member Button
            if canManageWorkspace {
                Button {
                    showAddMemberSheet = true
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("添加成员")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor.opacity(0.1))
                    .foregroundColor(.accentColor)
                }
            }
        }
    }

    // MARK: - Resources Tab

    private var resourcesTab: some View {
        VStack(spacing: 0) {
            // Resource Type Filter
            if !resources.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(ResourceType.allCases, id: \.self) { type in
                            let count = resources.filter { $0.resourceType == type }.count
                            if count > 0 {
                                ResourceTypeChip(type: type, count: count)
                            }
                        }
                    }
                    .padding()
                }
            }

            List {
                ForEach(resources) { resource in
                    WorkspaceResourceRow(resource: resource)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if canManageWorkspace {
                                Button(role: .destructive) {
                                    Task {
                                        guard let userDID = identityManager.currentIdentity?.did else { return }
                                        await viewModel.removeResource(
                                            workspaceId: workspace.id,
                                            resourceId: resource.resourceId,
                                            userDID: userDID
                                        )
                                        await loadResources()
                                    }
                                } label: {
                                    Label("移除", systemImage: "trash")
                                }
                            }
                        }
                }
            }
            .listStyle(.plain)
            .overlay {
                if resources.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "doc.text")
                            .font(.largeTitle)
                            .foregroundColor(.gray)
                        Text("暂无资源")
                            .foregroundColor(.secondary)
                        Button {
                            showAddResourceSheet = true
                        } label: {
                            Text("添加资源")
                                .font(.subheadline)
                        }
                    }
                }
            }

            // Add Resource Button
            if canManageWorkspace && !resources.isEmpty {
                Button {
                    showAddResourceSheet = true
                } label: {
                    HStack {
                        Image(systemName: "doc.badge.plus")
                        Text("添加资源")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.accentColor.opacity(0.1))
                    .foregroundColor(.accentColor)
                }
            }
        }
    }

    // MARK: - Activities Tab

    private var activitiesTab: some View {
        List {
            ForEach(activities) { activity in
                WorkspaceActivityRow(activity: activity)
            }
        }
        .listStyle(.plain)
        .overlay {
            if activities.isEmpty {
                Text("暂无活动记录")
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Helper Methods

    private func loadWorkspaceDetails() async {
        await viewModel.switchWorkspace(to: workspace)
        await loadMembers()
        await loadResources()
        await loadActivities()
    }

    private func loadMembers() async {
        do {
            members = try await WorkspaceManager.shared.getWorkspaceMembers(workspaceId: workspace.id)
        } catch {
            print("Failed to load members: \(error)")
        }
    }

    private func loadResources() async {
        do {
            resources = try await WorkspaceManager.shared.getWorkspaceResources(workspaceId: workspace.id)
        } catch {
            print("Failed to load resources: \(error)")
        }
    }

    private func loadActivities() async {
        do {
            activities = try await WorkspaceManager.shared.getWorkspaceActivities(
                workspaceId: workspace.id,
                limit: 50
            )
        } catch {
            print("Failed to load activities: \(error)")
        }
    }

    private var canManageWorkspace: Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return workspace.createdBy == currentDID ||
               members.first(where: { $0.memberDID == currentDID })?.role == .admin ||
               members.first(where: { $0.memberDID == currentDID })?.role == .owner
    }

    private func canRemoveMember(_ member: WorkspaceMember) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return member.memberDID != workspace.createdBy &&
               member.memberDID != currentDID &&
               canManageWorkspace
    }

    private func canUpdateMemberRole(_ member: WorkspaceMember) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return member.memberDID != workspace.createdBy && canManageWorkspace
    }
}

// MARK: - Workspace Member Row

struct WorkspaceMemberRow: View {
    let member: WorkspaceMember

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            if let avatar = member.avatar, let url = URL(string: avatar) {
                AsyncImage(url: url) { image in
                    image.resizable()
                } placeholder: {
                    Image(systemName: "person.circle.fill")
                }
                .frame(width: 40, height: 40)
                .clipShape(Circle())
            } else {
                Image(systemName: "person.circle.fill")
                    .font(.largeTitle)
                    .foregroundColor(.gray)
                    .frame(width: 40, height: 40)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(member.displayName)
                        .font(.headline)

                    Badge(text: member.role.displayName, color: memberRoleColor(member.role))
                }

                Text("加入于 \(member.joinedAt, style: .relative)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func memberRoleColor(_ role: WorkspaceMemberRole) -> Color {
        switch role {
        case .owner: return .purple
        case .admin: return .blue
        case .member: return .green
        case .guest: return .gray
        }
    }
}

// MARK: - Workspace Resource Row

struct WorkspaceResourceRow: View {
    let resource: WorkspaceResource

    var body: some View {
        HStack(spacing: 12) {
            // Resource Icon
            ZStack {
                Circle()
                    .fill(resourceTypeColor(resource.resourceType).opacity(0.2))
                    .frame(width: 40, height: 40)

                Image(systemName: resourceTypeIcon(resource.resourceType))
                    .foregroundColor(resourceTypeColor(resource.resourceType))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(resource.resourceName)
                    .font(.headline)

                HStack(spacing: 8) {
                    Badge(text: resource.resourceType.displayName, color: resourceTypeColor(resource.resourceType))

                    Text("添加于 \(resource.addedAt, style: .relative)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func resourceTypeIcon(_ type: ResourceType) -> String {
        switch type {
        case .note: return "note.text"
        case .project: return "folder"
        case .knowledge: return "book"
        case .file: return "doc"
        case .task: return "checkmark.circle"
        }
    }

    private func resourceTypeColor(_ type: ResourceType) -> Color {
        switch type {
        case .note: return .blue
        case .project: return .purple
        case .knowledge: return .orange
        case .file: return .green
        case .task: return .red
        }
    }
}

// MARK: - Workspace Activity Row

struct WorkspaceActivityRow: View {
    let activity: WorkspaceActivity

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: actionIcon(activity.action))
                .foregroundColor(actionColor(activity.action))
                .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                Text(activity.action.displayName)
                    .font(.headline)

                Text(activity.actorDID.prefix(20) + "...")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(activity.timestamp, style: .relative)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func actionIcon(_ action: WorkspaceAction) -> String {
        switch action {
        case .createWorkspace: return "plus.circle"
        case .updateWorkspace: return "pencil.circle"
        case .deleteWorkspace: return "trash.circle"
        case .archiveWorkspace: return "archivebox"
        case .addMember: return "person.badge.plus"
        case .removeMember: return "person.badge.minus"
        case .updateMemberRole: return "person.badge.key"
        case .addResource: return "doc.badge.plus"
        case .removeResource: return "doc.badge.minus"
        case .updateSettings: return "gearshape"
        }
    }

    private func actionColor(_ action: WorkspaceAction) -> Color {
        switch action {
        case .createWorkspace, .addMember, .addResource: return .green
        case .deleteWorkspace, .removeMember, .removeResource: return .red
        case .updateWorkspace, .updateMemberRole, .updateSettings: return .blue
        case .archiveWorkspace: return .orange
        }
    }
}

// MARK: - Resource Type Chip

struct ResourceTypeChip: View {
    let type: ResourceType
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: resourceTypeIcon(type))
                .font(.caption)
            Text("\(type.displayName) (\(count))")
                .font(.subheadline)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(resourceTypeColor(type).opacity(0.2))
        .foregroundColor(resourceTypeColor(type))
        .cornerRadius(16)
    }

    private func resourceTypeIcon(_ type: ResourceType) -> String {
        switch type {
        case .note: return "note.text"
        case .project: return "folder"
        case .knowledge: return "book"
        case .file: return "doc"
        case .task: return "checkmark.circle"
        }
    }

    private func resourceTypeColor(_ type: ResourceType) -> Color {
        switch type {
        case .note: return .blue
        case .project: return .purple
        case .knowledge: return .orange
        case .file: return .green
        case .task: return .red
        }
    }
}

// MARK: - Add Workspace Member Sheet

struct AddWorkspaceMemberSheet: View {
    let workspaceId: String
    @ObservedObject var viewModel: WorkspaceViewModel
    let onMemberAdded: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var memberDID = ""
    @State private var displayName = ""
    @State private var role: WorkspaceMemberRole = .member

    var body: some View {
        NavigationView {
            Form {
                Section("成员信息") {
                    TextField("DID", text: $memberDID)
                    TextField("显示名称", text: $displayName)
                }

                Section("角色") {
                    Picker("角色", selection: $role) {
                        ForEach([WorkspaceMemberRole.admin, .member, .guest], id: \.self) { role in
                            Text(role.displayName).tag(role)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("添加成员")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("添加") {
                        Task {
                            await viewModel.addMember(
                                workspaceId: workspaceId,
                                memberDID: memberDID,
                                displayName: displayName,
                                role: role
                            )
                            onMemberAdded()
                            dismiss()
                        }
                    }
                    .disabled(memberDID.isEmpty || displayName.isEmpty)
                }
            }
        }
    }
}

// MARK: - Add Workspace Resource Sheet

struct AddWorkspaceResourceSheet: View {
    let workspaceId: String
    @ObservedObject var viewModel: WorkspaceViewModel
    let onResourceAdded: () -> Void

    @StateObject private var identityManager = IdentityManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var resourceType: ResourceType = .note
    @State private var resourceId = ""
    @State private var resourceName = ""

    var body: some View {
        NavigationView {
            Form {
                Section("资源类型") {
                    Picker("类型", selection: $resourceType) {
                        ForEach(ResourceType.allCases, id: \.self) { type in
                            HStack {
                                Text(type.displayName)
                            }
                            .tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("资源信息") {
                    TextField("资源ID", text: $resourceId)
                    TextField("资源名称", text: $resourceName)
                }
            }
            .navigationTitle("添加资源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("添加") {
                        Task {
                            guard let userDID = identityManager.currentIdentity?.did else { return }
                            await viewModel.addResource(
                                workspaceId: workspaceId,
                                resourceType: resourceType,
                                resourceId: resourceId,
                                resourceName: resourceName,
                                userDID: userDID
                            )
                            onResourceAdded()
                            dismiss()
                        }
                    }
                    .disabled(resourceId.isEmpty || resourceName.isEmpty)
                }
            }
        }
    }
}

// MARK: - Workspace Settings Sheet

struct WorkspaceSettingsSheet: View {
    let workspace: Workspace
    @ObservedObject var viewModel: WorkspaceViewModel

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description: String
    @State private var color: String
    @State private var icon: String
    @State private var visibility: WorkspaceVisibility

    init(workspace: Workspace, viewModel: WorkspaceViewModel) {
        self.workspace = workspace
        self.viewModel = viewModel
        _name = State(initialValue: workspace.name)
        _description = State(initialValue: workspace.description)
        _color = State(initialValue: workspace.color)
        _icon = State(initialValue: workspace.icon)
        _visibility = State(initialValue: workspace.visibility)
    }

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    TextField("工作空间名称", text: $name)
                    TextField("描述", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("外观") {
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
            }
            .navigationTitle("工作空间设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            await viewModel.updateWorkspace(
                                workspaceId: workspace.id,
                                name: name != workspace.name ? name : nil,
                                description: description != workspace.description ? description : nil,
                                color: color != workspace.color ? color : nil,
                                icon: icon != workspace.icon ? icon : nil,
                                visibility: visibility != workspace.visibility ? visibility : nil
                            )
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        WorkspaceDetailView(
            workspace: Workspace(
                id: "ws_123",
                orgId: "org_123",
                name: "Development",
                description: "Development workspace",
                type: .development,
                color: "#1890ff",
                icon: "hammer",
                isDefault: true,
                visibility: .members,
                allowedRoles: [],
                createdBy: "did:example:creator",
                createdAt: Date(),
                updatedAt: Date(),
                archived: false
            )
        )
    }
}
