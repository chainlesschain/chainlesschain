import SwiftUI

/// 组织详情视图
public struct OrganizationDetailView: View {

    let organization: Organization

    @StateObject private var viewModel = OrganizationViewModel()
    @StateObject private var identityManager = IdentityManager.shared

    @State private var selectedTab = 0
    @State private var showAddMemberSheet = false
    @State private var showCreateInviteSheet = false
    @State private var showSettingsSheet = false
    @State private var members: [OrganizationMember] = []
    @State private var invitations: [OrganizationInvitation] = []
    @State private var activities: [OrganizationActivity] = []

    public init(organization: Organization) {
        self.organization = organization
    }

    public var body: some View {
        ZStack {
            if viewModel.isLoading && members.isEmpty {
                ProgressView("加载中...")
            } else {
                contentView
            }
        }
        .navigationTitle(organization.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showCreateInviteSheet = true
                    } label: {
                        Label("创建邀请码", systemImage: "link.badge.plus")
                    }

                    Button {
                        showSettingsSheet = true
                    } label: {
                        Label("组织设置", systemImage: "gearshape")
                    }

                    Divider()

                    NavigationLink {
                        WorkspaceListView(orgId: organization.id)
                    } label: {
                        Label("工作空间", systemImage: "folder.badge.gearshape")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showAddMemberSheet) {
            AddMemberSheet(
                orgId: organization.id,
                viewModel: viewModel,
                onMemberAdded: {
                    Task { await loadMembers() }
                }
            )
        }
        .sheet(isPresented: $showCreateInviteSheet) {
            CreateInviteSheet(
                orgId: organization.id,
                viewModel: viewModel,
                onInviteCreated: {
                    Task { await loadInvitations() }
                }
            )
        }
        .sheet(isPresented: $showSettingsSheet) {
            OrganizationSettingsSheet(organization: organization, viewModel: viewModel)
        }
        .task {
            await loadOrganizationDetails()
        }
    }

    // MARK: - Content View

    private var contentView: some View {
        VStack(spacing: 0) {
            // Organization Header
            organizationHeader
                .padding()
                .background(Color(.systemBackground))

            Divider()

            // Tabs
            Picker("", selection: $selectedTab) {
                Text("成员 (\(members.count))").tag(0)
                Text("邀请码 (\(invitations.count))").tag(1)
                Text("活动").tag(2)
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab Content
            TabView(selection: $selectedTab) {
                membersTab.tag(0)
                invitationsTab.tag(1)
                activitiesTab.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    // MARK: - Organization Header

    private var organizationHeader: some View {
        VStack(spacing: 12) {
            // Avatar
            if let avatar = organization.avatar, let url = URL(string: avatar) {
                AsyncImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    Image(systemName: organization.type.icon)
                        .font(.largeTitle)
                        .foregroundColor(.accentColor)
                }
                .frame(width: 80, height: 80)
                .background(Color.accentColor.opacity(0.1))
                .clipShape(Circle())
            } else {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.1))
                        .frame(width: 80, height: 80)
                    Image(systemName: organization.type.icon)
                        .font(.largeTitle)
                        .foregroundColor(.accentColor)
                }
            }

            // Name and Type
            VStack(spacing: 4) {
                Text(organization.name)
                    .font(.title2)
                    .fontWeight(.bold)

                HStack(spacing: 8) {
                    Badge(text: organization.type.displayName, color: .blue)

                    if organization.visibility == .private {
                        Badge(text: "私有", color: .orange)
                    } else if organization.visibility == .public {
                        Badge(text: "公开", color: .green)
                    }
                }
            }

            // Description
            if let description = organization.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Stats
            HStack(spacing: 30) {
                StatItem(value: "\(members.count)", label: "成员")
                StatItem(value: "\(invitations.filter { $0.isActive }.count)", label: "邀请码")
                StatItem(value: "0", label: "工作空间")
            }
            .padding(.top, 8)
        }
    }

    // MARK: - Members Tab

    private var membersTab: some View {
        VStack(spacing: 0) {
            List {
                ForEach(members) { member in
                    MemberRow(member: member, organization: organization)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if canRemoveMember(member) {
                                Button(role: .destructive) {
                                    Task {
                                        await viewModel.removeMember(
                                            orgId: organization.id,
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
                                ForEach([OrganizationRole.admin, .editor, .viewer], id: \.self) { role in
                                    if role != member.role {
                                        Button {
                                            Task {
                                                await viewModel.updateMemberRole(
                                                    orgId: organization.id,
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
            if canManageMembers {
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

    // MARK: - Invitations Tab

    private var invitationsTab: some View {
        VStack(spacing: 0) {
            List {
                ForEach(invitations.filter { $0.isActive }) { invitation in
                    InvitationRow(invitation: invitation)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task {
                                    await viewModel.revokeInvitation(
                                        invitationId: invitation.id,
                                        orgId: organization.id
                                    )
                                    await loadInvitations()
                                }
                            } label: {
                                Label("撤销", systemImage: "xmark.circle")
                            }
                        }
                }
            }
            .listStyle(.plain)
            .overlay {
                if invitations.isEmpty {
                    Text("暂无邀请码")
                        .foregroundColor(.secondary)
                }
            }

            // Create Invite Button
            Button {
                showCreateInviteSheet = true
            } label: {
                HStack {
                    Image(systemName: "link.badge.plus")
                    Text("创建邀请码")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.accentColor.opacity(0.1))
                .foregroundColor(.accentColor)
            }
        }
    }

    // MARK: - Activities Tab

    private var activitiesTab: some View {
        List {
            ForEach(activities) { activity in
                ActivityRow(activity: activity)
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

    private func loadOrganizationDetails() async {
        await viewModel.switchOrganization(to: organization)
        await loadMembers()
        await loadInvitations()
        await loadActivities()
    }

    private func loadMembers() async {
        do {
            members = try await OrganizationManager.shared.getMembers(orgId: organization.id)
        } catch {
            print("Failed to load members: \(error)")
        }
    }

    private func loadInvitations() async {
        do {
            invitations = try await OrganizationManager.shared.getInvitations(orgId: organization.id)
        } catch {
            print("Failed to load invitations: \(error)")
        }
    }

    private func loadActivities() async {
        do {
            activities = try await OrganizationManager.shared.getActivities(
                orgId: organization.id,
                limit: 50
            )
        } catch {
            print("Failed to load activities: \(error)")
        }
    }

    private var canManageMembers: Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return organization.ownerDID == currentDID ||
               members.first(where: { $0.memberDID == currentDID })?.role == .admin
    }

    private func canRemoveMember(_ member: OrganizationMember) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return member.memberDID != organization.ownerDID &&
               member.memberDID != currentDID &&
               canManageMembers
    }

    private func canUpdateMemberRole(_ member: OrganizationMember) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else { return false }
        return member.memberDID != organization.ownerDID &&
               (organization.ownerDID == currentDID || canManageMembers)
    }
}

// MARK: - Member Row

struct MemberRow: View {
    let member: OrganizationMember
    let organization: Organization

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

                    if member.memberDID == organization.ownerDID {
                        Badge(text: "所有者", color: .purple)
                    } else {
                        Badge(text: member.role.displayName, color: roleColor(member.role))
                    }
                }

                Text(member.memberDID.prefix(20) + "...")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if member.status != .active {
                    Badge(text: statusText(member.status), color: statusColor(member.status))
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func roleColor(_ role: OrganizationRole) -> Color {
        switch role {
        case .owner: return .purple
        case .admin: return .blue
        case .editor: return .green
        case .viewer: return .orange
        case .guest: return .gray
        }
    }

    private func statusText(_ status: MemberStatus) -> String {
        switch status {
        case .active: return "活跃"
        case .inactive: return "不活跃"
        case .suspended: return "已暂停"
        case .removed: return "已移除"
        }
    }

    private func statusColor(_ status: MemberStatus) -> Color {
        switch status {
        case .active: return .green
        case .inactive: return .orange
        case .suspended: return .red
        case .removed: return .gray
        }
    }
}

// MARK: - Invitation Row

struct InvitationRow: View {
    let invitation: OrganizationInvitation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(invitation.inviteCode)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(.semibold)

                Spacer()

                Button {
                    UIPasteboard.general.string = invitation.inviteCode
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundColor(.accentColor)
                }
            }

            HStack(spacing: 12) {
                Label(invitation.role.displayName, systemImage: "person.badge.key")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Label("\(invitation.remainingUses)/\(invitation.maxUses) 可用", systemImage: "number")
                    .font(.caption)
                    .foregroundColor(.secondary)

                if invitation.isValid {
                    Badge(text: "有效", color: .green)
                } else {
                    Badge(text: "已过期", color: .red)
                }
            }

            if let expireAt = invitation.expireAt {
                Text("过期时间: \(expireAt, style: .relative)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Activity Row

struct ActivityRow: View {
    let activity: OrganizationActivity

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

    private func actionIcon(_ action: OrganizationAction) -> String {
        switch action {
        case .createOrganization: return "plus.circle"
        case .updateOrganization: return "pencil.circle"
        case .deleteOrganization: return "trash.circle"
        case .addMember: return "person.badge.plus"
        case .removeMember: return "person.badge.minus"
        case .updateMemberRole: return "person.badge.key"
        default: return "circle"
        }
    }

    private func actionColor(_ action: OrganizationAction) -> Color {
        switch action {
        case .createOrganization, .addMember: return .green
        case .deleteOrganization, .removeMember: return .red
        case .updateOrganization, .updateMemberRole: return .blue
        default: return .gray
        }
    }
}

// MARK: - Stat Item

struct StatItem: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3)
                .fontWeight(.bold)
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Add Member Sheet

struct AddMemberSheet: View {
    let orgId: String
    @ObservedObject var viewModel: OrganizationViewModel
    let onMemberAdded: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var memberDID = ""
    @State private var displayName = ""
    @State private var role: OrganizationRole = .member

    var body: some View {
        NavigationView {
            Form {
                Section("成员信息") {
                    TextField("DID", text: $memberDID)
                    TextField("显示名称", text: $displayName)
                }

                Section("角色") {
                    Picker("角色", selection: $role) {
                        ForEach([OrganizationRole.admin, .editor, .viewer, .guest], id: \.self) { role in
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
                                orgId: orgId,
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

// MARK: - Create Invite Sheet

struct CreateInviteSheet: View {
    let orgId: String
    @ObservedObject var viewModel: OrganizationViewModel
    let onInviteCreated: () -> Void

    @StateObject private var identityManager = IdentityManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var role: OrganizationRole = .member
    @State private var maxUses = 1
    @State private var expiresInDays: Int? = 7

    var body: some View {
        NavigationView {
            Form {
                Section("邀请设置") {
                    Picker("角色", selection: $role) {
                        ForEach([OrganizationRole.admin, .editor, .viewer, .guest], id: \.self) { role in
                            Text(role.displayName).tag(role)
                        }
                    }

                    Stepper("使用次数: \(maxUses)", value: $maxUses, in: 1...100)

                    Toggle("设置过期时间", isOn: Binding(
                        get: { expiresInDays != nil },
                        set: { expiresInDays = $0 ? 7 : nil }
                    ))

                    if expiresInDays != nil {
                        Stepper("有效期: \(expiresInDays ?? 7) 天", value: Binding(
                            get: { expiresInDays ?? 7 },
                            set: { expiresInDays = $0 }
                        ), in: 1...365)
                    }
                }
            }
            .navigationTitle("创建邀请码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        Task {
                            guard let userDID = identityManager.currentIdentity?.did else { return }
                            _ = await viewModel.createInvitation(
                                orgId: orgId,
                                role: role,
                                maxUses: maxUses,
                                expiresInDays: expiresInDays,
                                userDID: userDID
                            )
                            onInviteCreated()
                            dismiss()
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Organization Settings Sheet

struct OrganizationSettingsSheet: View {
    let organization: Organization
    @ObservedObject var viewModel: OrganizationViewModel

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description: String
    @State private var visibility: OrganizationVisibility

    init(organization: Organization, viewModel: OrganizationViewModel) {
        self.organization = organization
        self.viewModel = viewModel
        _name = State(initialValue: organization.name)
        _description = State(initialValue: organization.description ?? "")
        _visibility = State(initialValue: organization.visibility)
    }

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    TextField("组织名称", text: $name)
                    TextField("描述", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("可见性") {
                    Picker("可见性", selection: $visibility) {
                        Text("公开").tag(OrganizationVisibility.public)
                        Text("私有").tag(OrganizationVisibility.private)
                        Text("仅邀请").tag(OrganizationVisibility.inviteOnly)
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("组织设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            await viewModel.updateOrganization(
                                orgId: organization.id,
                                name: name != organization.name ? name : nil,
                                description: description != organization.description ? description : nil
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
        OrganizationDetailView(
            organization: Organization(
                id: "org_123",
                did: "did:example:org123",
                name: "Acme Inc",
                description: "A sample organization",
                type: .company,
                avatar: nil,
                ownerDID: "did:example:owner",
                visibility: .private,
                settings: OrganizationSettings(),
                createdAt: Date(),
                updatedAt: Date()
            )
        )
    }
}
