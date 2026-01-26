import SwiftUI

/// 组织列表视图
public struct OrganizationListView: View {

    @StateObject private var viewModel = OrganizationViewModel()
    @StateObject private var identityManager = IdentityManager.shared

    @State private var showCreateSheet = false
    @State private var showJoinSheet = false
    @State private var searchText = ""
    @State private var selectedType: OrganizationType?
    @State private var showTypeFilter = false

    public init() {}

    public var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.organizations.isEmpty {
                    ProgressView("加载中...")
                } else if viewModel.organizations.isEmpty {
                    emptyStateView
                } else {
                    organizationListContent
                }
            }
            .navigationTitle("我的组织")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    identitySwitcherButton
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            showCreateSheet = true
                        } label: {
                            Label("创建组织", systemImage: "plus.circle")
                        }

                        Button {
                            showJoinSheet = true
                        } label: {
                            Label("加入组织", systemImage: "person.badge.plus")
                        }

                        Divider()

                        Button {
                            showTypeFilter.toggle()
                        } label: {
                            Label("筛选", systemImage: "line.3.horizontal.decrease.circle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "搜索组织")
            .sheet(isPresented: $showCreateSheet) {
                CreateOrganizationSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $showJoinSheet) {
                JoinOrganizationSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $showTypeFilter) {
                OrganizationTypeFilterSheet(
                    selectedType: $selectedType,
                    isPresented: $showTypeFilter
                )
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
        }
        .task {
            await viewModel.loadOrganizations()
        }
    }

    // MARK: - Subviews

    private var organizationListContent: some View {
        List {
            ForEach(filteredOrganizations) { org in
                NavigationLink {
                    OrganizationDetailView(organization: org)
                } label: {
                    OrganizationRow(organization: org)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if canDeleteOrganization(org) {
                        Button(role: .destructive) {
                            Task {
                                guard let userDID = identityManager.currentIdentity?.did else { return }
                                await viewModel.deleteOrganization(orgId: org.id, userDID: userDID)
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
            await viewModel.loadOrganizations()
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "building.2")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无组织")
                .font(.title2)
                .fontWeight(.semibold)

            Text("创建或加入组织，开始协作")
                .font(.subheadline)
                .foregroundColor(.secondary)

            HStack(spacing: 15) {
                Button {
                    showCreateSheet = true
                } label: {
                    Label("创建组织", systemImage: "plus.circle.fill")
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }

                Button {
                    showJoinSheet = true
                } label: {
                    Label("加入组织", systemImage: "person.badge.plus.fill")
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.secondary.opacity(0.2))
                        .foregroundColor(.primary)
                        .cornerRadius(10)
                }
            }
            .padding(.top, 10)
        }
        .padding()
    }

    private var identitySwitcherButton: some View {
        Menu {
            ForEach(identityManager.identities) { identity in
                Button {
                    Task {
                        try? await identityManager.switchIdentity(to: identity)
                    }
                } label: {
                    HStack {
                        Text(identity.displayLabel)
                        if identity.isActive {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                if let avatar = identityManager.currentIdentity?.avatar {
                    AsyncImage(url: URL(string: avatar)) { image in
                        image.resizable()
                    } placeholder: {
                        Image(systemName: "person.circle.fill")
                    }
                    .frame(width: 30, height: 30)
                    .clipShape(Circle())
                } else {
                    Image(systemName: "person.circle.fill")
                        .font(.title3)
                }

                Text(identityManager.currentIdentity?.displayName ?? "未登录")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
        }
    }

    // MARK: - Computed Properties

    private var filteredOrganizations: [Organization] {
        var orgs = viewModel.organizations

        // 搜索过滤
        if !searchText.isEmpty {
            orgs = viewModel.searchOrganizations(query: searchText)
        }

        // 类型过滤
        if let type = selectedType {
            orgs = orgs.filter { $0.type == type }
        }

        return orgs
    }

    private func canDeleteOrganization(_ org: Organization) -> Bool {
        guard let currentDID = identityManager.currentIdentity?.did else {
            return false
        }
        return org.ownerDID == currentDID
    }
}

// MARK: - Organization Row

struct OrganizationRow: View {
    let organization: Organization

    @State private var memberCount: Int = 0

    var body: some View {
        HStack(spacing: 12) {
            // Organization Icon
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 50, height: 50)

                if let avatar = organization.avatar, let url = URL(string: avatar) {
                    AsyncImage(url: url) { image in
                        image
                            .resizable()
                            .scaledToFill()
                    } placeholder: {
                        Image(systemName: organization.type.icon)
                            .foregroundColor(.accentColor)
                    }
                    .frame(width: 50, height: 50)
                    .clipShape(Circle())
                } else {
                    Image(systemName: organization.type.icon)
                        .font(.title3)
                        .foregroundColor(.accentColor)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(organization.name)
                        .font(.headline)

                    Badge(text: organization.type.displayName, color: typeColor(organization.type))
                }

                if let description = organization.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 12) {
                    Label("\(memberCount) 成员", systemImage: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if organization.visibility == .private {
                        Label("私有", systemImage: "lock.fill")
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
        .task {
            memberCount = await OrganizationViewModel().getMemberCount(for: organization.id)
        }
    }

    private func typeColor(_ type: OrganizationType) -> Color {
        switch type {
        case .startup: return .orange
        case .company: return .blue
        case .community: return .green
        case .opensource: return .purple
        case .education: return .red
        case .personal: return .gray
        }
    }
}

// MARK: - Create Organization Sheet

struct CreateOrganizationSheet: View {
    @ObservedObject var viewModel: OrganizationViewModel
    @StateObject private var identityManager = IdentityManager.shared

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var description = ""
    @State private var type: OrganizationType = .personal
    @State private var visibility: OrganizationVisibility = .private

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    TextField("组织名称", text: $name)
                    TextField("描述（可选）", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("组织类型") {
                    Picker("类型", selection: $type) {
                        ForEach(OrganizationType.allCases, id: \.self) { type in
                            HStack {
                                Text(type.icon)
                                Text(type.displayName)
                            }
                            .tag(type)
                        }
                    }
                }

                Section("可见性") {
                    Picker("可见性", selection: $visibility) {
                        ForEach([OrganizationVisibility.public, .private, .inviteOnly], id: \.self) { vis in
                            Text(vis.displayName).tag(vis)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("创建组织")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        createOrganization()
                    }
                    .disabled(name.isEmpty || viewModel.isLoading)
                }
            }
        }
    }

    private func createOrganization() {
        guard let ownerDID = identityManager.currentIdentity?.did else { return }

        Task {
            await viewModel.createOrganization(
                name: name,
                description: description,
                type: type,
                visibility: visibility,
                ownerDID: ownerDID
            )

            if viewModel.errorMessage == nil {
                dismiss()
            }
        }
    }
}

// MARK: - Join Organization Sheet

struct JoinOrganizationSheet: View {
    @ObservedObject var viewModel: OrganizationViewModel
    @StateObject private var identityManager = IdentityManager.shared

    @Environment(\.dismiss) private var dismiss

    @State private var inviteCode = ""
    @State private var displayName = ""

    var body: some View {
        NavigationView {
            Form {
                Section("邀请码") {
                    TextField("输入邀请码", text: $inviteCode)
                        .textInputAutocapitalization(.characters)
                }

                Section("显示名称") {
                    TextField("您的名称", text: $displayName)
                }

                Section {
                    Text("请输入组织邀请码和您的显示名称")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("加入组织")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("加入") {
                        joinOrganization()
                    }
                    .disabled(inviteCode.isEmpty || displayName.isEmpty || viewModel.isLoading)
                }
            }
        }
        .onAppear {
            displayName = identityManager.currentIdentity?.displayName ?? ""
        }
    }

    private func joinOrganization() {
        guard let memberDID = identityManager.currentIdentity?.did else { return }

        Task {
            let success = await viewModel.joinWithInvite(
                inviteCode: inviteCode.uppercased(),
                memberDID: memberDID,
                displayName: displayName
            )

            if success {
                dismiss()
            }
        }
    }
}

// MARK: - Organization Type Filter Sheet

struct OrganizationTypeFilterSheet: View {
    @Binding var selectedType: OrganizationType?
    @Binding var isPresented: Bool

    var body: some View {
        NavigationView {
            List {
                Button {
                    selectedType = nil
                    isPresented = false
                } label: {
                    HStack {
                        Text("全部")
                        Spacer()
                        if selectedType == nil {
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentColor)
                        }
                    }
                }

                ForEach(OrganizationType.allCases, id: \.self) { type in
                    Button {
                        selectedType = type
                        isPresented = false
                    } label: {
                        HStack {
                            Text(type.icon)
                            Text(type.displayName)
                            Spacer()
                            if selectedType == type {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.accentColor)
                            }
                        }
                    }
                    .foregroundColor(.primary)
                }
            }
            .navigationTitle("筛选类型")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        isPresented = false
                    }
                }
            }
        }
    }
}

// MARK: - Reusable Components

struct Badge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.2))
            .foregroundColor(color)
            .cornerRadius(4)
    }
}

struct SuccessBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)
            Text(message)
                .font(.subheadline)
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(radius: 5)
        .padding()
    }
}

// MARK: - Preview

#Preview {
    OrganizationListView()
}
