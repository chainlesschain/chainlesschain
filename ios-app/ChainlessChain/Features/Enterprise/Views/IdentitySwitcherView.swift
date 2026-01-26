import SwiftUI

/// 身份切换器视图
public struct IdentitySwitcherView: View {

    @StateObject private var identityManager = IdentityManager.shared
    @StateObject private var orgViewModel = OrganizationViewModel()

    @State private var showAddIdentitySheet = false
    @State private var showIdentityDetailSheet: Identity?
    @State private var searchText = ""

    public init() {}

    public var body: some View {
        NavigationView {
            ZStack {
                if identityManager.identities.isEmpty {
                    emptyStateView
                } else {
                    identityListContent
                }
            }
            .navigationTitle("身份管理")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showAddIdentitySheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "搜索身份")
            .sheet(isPresented: $showAddIdentitySheet) {
                AddIdentitySheet(identityManager: identityManager)
            }
            .sheet(item: $showIdentityDetailSheet) { identity in
                IdentityDetailSheet(identity: identity, identityManager: identityManager)
            }
        }
    }

    // MARK: - Subviews

    private var identityListContent: some View {
        List {
            // Current Identity Section
            if let currentIdentity = identityManager.currentIdentity {
                Section {
                    CurrentIdentityCard(identity: currentIdentity)
                } header: {
                    Text("当前身份")
                }
            }

            // Personal Identities
            let personalIdentities = identityManager.getPersonalIdentities()
            if !personalIdentities.isEmpty {
                Section {
                    ForEach(filteredIdentities(personalIdentities)) { identity in
                        IdentityRow(
                            identity: identity,
                            isCurrent: identity.id == identityManager.currentIdentity?.id
                        )
                        .onTapGesture {
                            switchToIdentity(identity)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                deleteIdentity(identity)
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                            .disabled(identity.isActive)

                            Button {
                                showIdentityDetailSheet = identity
                            } label: {
                                Label("详情", systemImage: "info.circle")
                            }
                            .tint(.blue)
                        }
                    }
                } header: {
                    Text("个人身份")
                }
            }

            // Organization Identities
            let orgIdentities = identityManager.getOrganizationIdentities()
            if !orgIdentities.isEmpty {
                Section {
                    ForEach(filteredIdentities(orgIdentities)) { identity in
                        IdentityRow(
                            identity: identity,
                            isCurrent: identity.id == identityManager.currentIdentity?.id
                        )
                        .onTapGesture {
                            switchToIdentity(identity)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                deleteIdentity(identity)
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                            .disabled(identity.isActive)

                            Button {
                                showIdentityDetailSheet = identity
                            } label: {
                                Label("详情", systemImage: "info.circle")
                            }
                            .tint(.blue)
                        }
                    }
                } header: {
                    Text("组织身份")
                } footer: {
                    Text("组织身份与您加入的组织关联")
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable {
            // Refresh identities
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无身份")
                .font(.title2)
                .fontWeight(.semibold)

            Text("创建个人身份或加入组织")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button {
                showAddIdentitySheet = true
            } label: {
                Label("添加身份", systemImage: "plus.circle.fill")
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

    // MARK: - Helper Methods

    private func filteredIdentities(_ identities: [Identity]) -> [Identity] {
        if searchText.isEmpty {
            return identities
        }
        return identities.filter { identity in
            identity.displayName.localizedCaseInsensitiveContains(searchText) ||
            identity.did.localizedCaseInsensitiveContains(searchText) ||
            (identity.orgName?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    private func switchToIdentity(_ identity: Identity) {
        Task {
            do {
                try await identityManager.switchIdentity(to: identity)
            } catch {
                print("Failed to switch identity: \(error)")
            }
        }
    }

    private func deleteIdentity(_ identity: Identity) {
        Task {
            do {
                try await identityManager.deleteIdentity(id: identity.id)
            } catch {
                print("Failed to delete identity: \(error)")
            }
        }
    }
}

// MARK: - Current Identity Card

struct CurrentIdentityCard: View {
    let identity: Identity

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                // Avatar
                if let avatar = identity.avatar, let url = URL(string: avatar) {
                    AsyncImage(url: url) { image in
                        image.resizable()
                    } placeholder: {
                        Image(systemName: "person.circle.fill")
                    }
                    .frame(width: 60, height: 60)
                    .clipShape(Circle())
                } else {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.accentColor)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(identity.displayName)
                        .font(.title3)
                        .fontWeight(.bold)

                    if identity.isOrganization, let orgName = identity.orgName {
                        HStack(spacing: 6) {
                            Image(systemName: "building.2")
                                .font(.caption)
                            Text(orgName)
                                .font(.subheadline)
                        }
                        .foregroundColor(.secondary)
                    }

                    if let role = identity.roleDisplayName {
                        Badge(text: role, color: .blue)
                    }
                }

                Spacer()

                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundColor(.green)
            }

            Divider()

            // DID
            VStack(alignment: .leading, spacing: 4) {
                Text("DID")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(identity.did)
                    .font(.caption)
                    .fontDesign(.monospaced)
                    .foregroundColor(.primary)
            }

            // Last Used
            if let lastUsed = identity.lastUsedAt {
                HStack {
                    Text("上次使用:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(lastUsed, style: .relative)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color.accentColor.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Identity Row

struct IdentityRow: View {
    let identity: Identity
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            if let avatar = identity.avatar, let url = URL(string: avatar) {
                AsyncImage(url: url) { image in
                    image.resizable()
                } placeholder: {
                    Image(systemName: "person.circle.fill")
                }
                .frame(width: 44, height: 44)
                .clipShape(Circle())
            } else {
                Image(systemName: identity.isOrganization ? "building.2.crop.circle" : "person.circle.fill")
                    .font(.largeTitle)
                    .foregroundColor(isCurrent ? .accentColor : .gray)
                    .frame(width: 44, height: 44)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(identity.displayName)
                        .font(.headline)

                    if isCurrent {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }

                if identity.isOrganization, let orgName = identity.orgName {
                    HStack(spacing: 6) {
                        Image(systemName: "building.2")
                            .font(.caption)
                        Text(orgName)
                            .font(.caption)
                    }
                    .foregroundColor(.secondary)
                }

                HStack(spacing: 8) {
                    if let role = identity.roleDisplayName {
                        Badge(text: role, color: .blue)
                    }

                    if identity.isPersonal {
                        Badge(text: "个人", color: .purple)
                    }
                }
            }

            Spacer()

            if isCurrent {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Image(systemName: "arrow.right.circle")
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Add Identity Sheet

struct AddIdentitySheet: View {
    @ObservedObject var identityManager: IdentityManager

    @Environment(\.dismiss) private var dismiss

    @State private var did = ""
    @State private var displayName = ""
    @State private var avatar = ""
    @State private var isPersonal = true

    var body: some View {
        NavigationView {
            Form {
                Section("身份信息") {
                    TextField("DID", text: $did)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    TextField("显示名称", text: $displayName)

                    TextField("头像URL（可选）", text: $avatar)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section {
                    Toggle("个人身份", isOn: $isPersonal)
                } footer: {
                    Text(isPersonal ? "创建一个独立的个人身份" : "创建与组织关联的身份")
                }

                Section {
                    Text("提示: 加入组织时会自动创建对应的组织身份")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("添加身份")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("添加") {
                        addIdentity()
                    }
                    .disabled(did.isEmpty || displayName.isEmpty)
                }
            }
        }
    }

    private func addIdentity() {
        Task {
            do {
                _ = try await identityManager.createIdentity(
                    did: did,
                    displayName: displayName,
                    avatar: avatar.isEmpty ? nil : avatar,
                    orgId: nil,
                    orgName: nil,
                    role: nil
                )
                dismiss()
            } catch {
                print("Failed to add identity: \(error)")
            }
        }
    }
}

// MARK: - Identity Detail Sheet

struct IdentityDetailSheet: View {
    let identity: Identity
    @ObservedObject var identityManager: IdentityManager

    @Environment(\.dismiss) private var dismiss

    @State private var displayName: String
    @State private var avatar: String

    init(identity: Identity, identityManager: IdentityManager) {
        self.identity = identity
        self.identityManager = identityManager
        _displayName = State(initialValue: identity.displayName)
        _avatar = State(initialValue: identity.avatar ?? "")
    }

    var body: some View {
        NavigationView {
            Form {
                Section("基本信息") {
                    LabeledContent("DID") {
                        Text(identity.did)
                            .font(.caption)
                            .fontDesign(.monospaced)
                            .foregroundColor(.secondary)
                    }

                    TextField("显示名称", text: $displayName)

                    TextField("头像URL", text: $avatar)
                        .textInputAutocapitalization(.never)
                }

                if identity.isOrganization {
                    Section("组织信息") {
                        if let orgName = identity.orgName {
                            LabeledContent("组织") {
                                Text(orgName)
                            }
                        }

                        if let role = identity.roleDisplayName {
                            LabeledContent("角色") {
                                Text(role)
                            }
                        }
                    }
                }

                Section("统计") {
                    LabeledContent("创建时间") {
                        Text(identity.createdAt, style: .date)
                    }

                    if let lastUsed = identity.lastUsedAt {
                        LabeledContent("上次使用") {
                            Text(lastUsed, style: .relative)
                        }
                    }

                    LabeledContent("状态") {
                        Text(identity.isActive ? "活跃" : "未激活")
                            .foregroundColor(identity.isActive ? .green : .secondary)
                    }
                }

                if !identity.isActive {
                    Section {
                        Button {
                            Task {
                                try? await identityManager.switchIdentity(to: identity)
                                dismiss()
                            }
                        } label: {
                            HStack {
                                Spacer()
                                Text("切换到此身份")
                                Spacer()
                            }
                        }
                    }
                }
            }
            .navigationTitle("身份详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        updateIdentity()
                    }
                    .disabled(displayName.isEmpty)
                }
            }
        }
    }

    private func updateIdentity() {
        Task {
            do {
                try await identityManager.updateIdentity(
                    id: identity.id,
                    displayName: displayName != identity.displayName ? displayName : nil,
                    avatar: avatar != identity.avatar ? (avatar.isEmpty ? nil : avatar) : nil
                )
                dismiss()
            } catch {
                print("Failed to update identity: \(error)")
            }
        }
    }
}

// MARK: - Identity Switcher Menu (Compact Version)

/// 紧凑型身份切换菜单，用于工具栏
public struct IdentitySwitcherMenu: View {

    @StateObject private var identityManager = IdentityManager.shared
    @State private var showFullView = false

    public init() {}

    public var body: some View {
        Menu {
            // Current Identity
            if let current = identityManager.currentIdentity {
                Section {
                    Button {} label: {
                        HStack {
                            Image(systemName: "person.circle.fill")
                            VStack(alignment: .leading) {
                                Text(current.displayName)
                                    .fontWeight(.semibold)
                                if let orgName = current.orgName {
                                    Text(orgName)
                                        .font(.caption)
                                }
                            }
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                    }
                    .disabled(true)
                }
            }

            // Quick Switch
            Section("切换身份") {
                ForEach(identityManager.identities.filter { !$0.isActive }) { identity in
                    Button {
                        Task {
                            try? await identityManager.switchIdentity(to: identity)
                        }
                    } label: {
                        HStack {
                            Image(systemName: identity.isOrganization ? "building.2" : "person")
                            Text(identity.displayLabel)
                        }
                    }
                }
            }

            Divider()

            // Manage Identities
            Button {
                showFullView = true
            } label: {
                Label("管理身份", systemImage: "gearshape")
            }
        } label: {
            HStack(spacing: 8) {
                if let avatar = identityManager.currentIdentity?.avatar, let url = URL(string: avatar) {
                    AsyncImage(url: url) { image in
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

                Image(systemName: "chevron.down")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .sheet(isPresented: $showFullView) {
            IdentitySwitcherView()
        }
    }
}

// MARK: - Preview

#Preview("Identity Switcher View") {
    IdentitySwitcherView()
}

#Preview("Identity Switcher Menu") {
    NavigationView {
        Text("Content")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    IdentitySwitcherMenu()
                }
            }
    }
}
