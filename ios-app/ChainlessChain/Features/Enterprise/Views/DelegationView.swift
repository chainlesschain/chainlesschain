import SwiftUI
import Combine

/// 权限委派视图
public struct DelegationView: View {
    @StateObject private var viewModel = DelegationViewModel()
    @State private var selectedTab = 0
    @State private var showingCreateSheet = false

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 标签选择器
                Picker("", selection: $selectedTab) {
                    Text("收到的委派").tag(0)
                    Text("发出的委派").tag(1)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                // 内容区域
                tabContent
            }
            .navigationTitle("权限委派")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingCreateSheet = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateDelegationSheet(viewModel: viewModel, isPresented: $showingCreateSheet)
            }
            .task {
                await viewModel.loadData()
            }
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            ReceivedDelegationsView(viewModel: viewModel)
        case 1:
            SentDelegationsView(viewModel: viewModel)
        default:
            EmptyView()
        }
    }
}

// MARK: - Received Delegations View

private struct ReceivedDelegationsView: View {
    @ObservedObject var viewModel: DelegationViewModel

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.receivedDelegations.isEmpty {
                EmptyDelegationView(
                    message: "没有收到的委派",
                    subtitle: "其他用户可以将权限委派给您"
                )
            } else {
                List {
                    ForEach(viewModel.receivedDelegations, id: \.id) { delegation in
                        ReceivedDelegationRow(delegation: delegation, viewModel: viewModel)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Sent Delegations View

private struct SentDelegationsView: View {
    @ObservedObject var viewModel: DelegationViewModel

    var body: some View {
        Group {
            if viewModel.sentDelegations.isEmpty {
                EmptyDelegationView(
                    message: "没有发出的委派",
                    subtitle: "点击右上角的 + 创建新的权限委派"
                )
            } else {
                List {
                    ForEach(viewModel.sentDelegations, id: \.id) { delegation in
                        SentDelegationRow(delegation: delegation, viewModel: viewModel)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Received Delegation Row

private struct ReceivedDelegationRow: View {
    let delegation: PermissionDelegation
    @ObservedObject var viewModel: DelegationViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 标题行
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("来自: \(delegation.delegatorDid.suffix(8))")
                        .font(.headline)

                    if let reason = delegation.reason {
                        Text(reason)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                DelegationStatusBadge(status: delegation.status)
            }

            // 权限列表
            PermissionTagsView(permissions: delegation.permissions)

            // 时间范围
            HStack {
                Label(formatDate(delegation.startDate), systemImage: "calendar")
                Text("-")
                Text(formatDate(delegation.endDate))
            }
            .font(.caption)
            .foregroundColor(.secondary)

            // 操作按钮
            if delegation.status == .pending {
                HStack(spacing: 12) {
                    Button(action: {
                        Task {
                            await viewModel.acceptDelegation(delegation.id)
                        }
                    }) {
                        HStack {
                            Image(systemName: "checkmark")
                            Text("接受")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)

                    Button(action: {
                        Task {
                            await viewModel.rejectDelegation(delegation.id)
                        }
                    }) {
                        HStack {
                            Image(systemName: "xmark")
                            Text("拒绝")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter.string(from: date)
    }
}

// MARK: - Sent Delegation Row

private struct SentDelegationRow: View {
    let delegation: PermissionDelegation
    @ObservedObject var viewModel: DelegationViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 标题行
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("委派给: \(delegation.delegateDid.suffix(8))")
                        .font(.headline)

                    if let reason = delegation.reason {
                        Text(reason)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                DelegationStatusBadge(status: delegation.status)
            }

            // 权限列表
            PermissionTagsView(permissions: delegation.permissions)

            // 资源范围
            if let scope = delegation.resourceScope {
                HStack {
                    Label(scope.resourceType, systemImage: "folder")
                    if let resourceId = scope.resourceId {
                        Text("/ \(resourceId)")
                    }
                }
                .font(.caption)
                .foregroundColor(.secondary)
            }

            // 时间范围
            HStack {
                Label("\(formatDate(delegation.startDate)) - \(formatDate(delegation.endDate))",
                      systemImage: "calendar")

                Spacer()

                if delegation.status == .active || delegation.status == .pending {
                    Button("撤销") {
                        Task {
                            await viewModel.revokeDelegation(delegation.id)
                        }
                    }
                    .font(.caption)
                    .foregroundColor(.red)
                }
            }
            .font(.caption)
            .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter.string(from: date)
    }
}

// MARK: - Permission Tags View

private struct PermissionTagsView: View {
    let permissions: [String]

    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(permissions, id: \.self) { permission in
                Text(permission)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(4)
            }
        }
    }
}

// MARK: - Flow Layout

private struct FlowLayout: Layout {
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

    private struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in width: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if x + size.width > width && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }

                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
                self.size.width = max(self.size.width, x)
            }

            self.size.height = y + rowHeight
        }
    }
}

// MARK: - Delegation Status Badge

private struct DelegationStatusBadge: View {
    let status: DelegationStatus

    var body: some View {
        Text(statusText)
            .font(.caption)
            .fontWeight(.medium)
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor)
            .cornerRadius(4)
    }

    private var statusText: String {
        switch status {
        case .pending: return "待接受"
        case .active: return "生效中"
        case .expired: return "已过期"
        case .revoked: return "已撤销"
        case .rejected: return "已拒绝"
        }
    }

    private var statusColor: Color {
        switch status {
        case .pending: return .orange
        case .active: return .green
        case .expired: return .gray
        case .revoked: return .red
        case .rejected: return .red
        }
    }
}

// MARK: - Empty Delegation View

private struct EmptyDelegationView: View {
    let message: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.2.badge.gearshape")
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            Text(message)
                .font(.headline)
                .foregroundColor(.secondary)

            Text(subtitle)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Create Delegation Sheet

private struct CreateDelegationSheet: View {
    @ObservedObject var viewModel: DelegationViewModel
    @Binding var isPresented: Bool

    @State private var delegateDid = ""
    @State private var selectedPermissions: Set<String> = []
    @State private var reason = ""
    @State private var endDate = Date().addingTimeInterval(86400 * 7)
    @State private var resourceType = ""
    @State private var resourceId = ""

    private let availablePermissions = [
        "knowledge.read", "knowledge.write", "knowledge.delete",
        "project.read", "project.write", "project.manage",
        "workspace.read", "workspace.write"
    ]

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("被委派人")) {
                    TextField("DID", text: $delegateDid)
                }

                Section(header: Text("委派权限")) {
                    ForEach(availablePermissions, id: \.self) { permission in
                        Button(action: {
                            if selectedPermissions.contains(permission) {
                                selectedPermissions.remove(permission)
                            } else {
                                selectedPermissions.insert(permission)
                            }
                        }) {
                            HStack {
                                Text(permission)
                                Spacer()
                                if selectedPermissions.contains(permission) {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.blue)
                                }
                            }
                        }
                        .foregroundColor(.primary)
                    }
                }

                Section(header: Text("资源范围（可选）")) {
                    TextField("资源类型", text: $resourceType)
                    TextField("资源 ID", text: $resourceId)
                }

                Section(header: Text("其他信息")) {
                    TextField("委派原因", text: $reason)

                    DatePicker("到期时间",
                              selection: $endDate,
                              in: Date()...,
                              displayedComponents: [.date, .hourAndMinute])
                }
            }
            .navigationTitle("创建委派")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        isPresented = false
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("创建") {
                        Task {
                            await createDelegation()
                        }
                    }
                    .disabled(delegateDid.isEmpty || selectedPermissions.isEmpty)
                }
            }
        }
    }

    private func createDelegation() async {
        let scope: ResourceScope? = resourceType.isEmpty ? nil :
            ResourceScope(resourceType: resourceType, resourceId: resourceId.isEmpty ? nil : resourceId)

        await viewModel.createDelegation(
            delegateDid: delegateDid,
            permissions: Array(selectedPermissions),
            resourceScope: scope,
            reason: reason.isEmpty ? nil : reason,
            endDate: endDate
        )

        isPresented = false
    }
}

// MARK: - View Model

@MainActor
class DelegationViewModel: ObservableObject {
    @Published var receivedDelegations: [PermissionDelegation] = []
    @Published var sentDelegations: [PermissionDelegation] = []
    @Published var isLoading = false

    private let permissionEngine = PermissionEngine.shared

    // 当前用户 DID
    private var currentUserDid: String {
        // NOTE: 使用占位符 DID 用于 UI 演示。生产环境中应从 IdentityManager 获取
        // 集成方式: IdentityManager.shared.currentUserDid
        return "did:test:current-user"
    }

    // 当前组织 ID
    private var currentOrgId: String {
        // NOTE: 使用占位符组织 ID 用于 UI 演示。生产环境中应从 OrganizationManager 获取
        // 集成方式: OrganizationManager.shared.currentOrganizationId
        return "org-default"
    }

    func loadData() async {
        isLoading = true

        do {
            receivedDelegations = try await permissionEngine.getDelegations(
                userDid: currentUserDid,
                orgId: currentOrgId,
                type: .received
            )

            sentDelegations = try await permissionEngine.getDelegations(
                userDid: currentUserDid,
                orgId: currentOrgId,
                type: .delegated
            )
        } catch {
            Logger.shared.error("[DelegationView] 加载数据失败: \(error)")
        }

        isLoading = false
    }

    func acceptDelegation(_ delegationId: String) async {
        do {
            _ = try await permissionEngine.acceptDelegation(
                delegationId: delegationId,
                delegateDid: currentUserDid
            )
            await loadData()
        } catch {
            Logger.shared.error("[DelegationView] 接受委派失败: \(error)")
        }
    }

    func rejectDelegation(_ delegationId: String) async {
        do {
            _ = try await permissionEngine.rejectDelegation(
                delegationId: delegationId,
                delegateDid: currentUserDid
            )
            await loadData()
        } catch {
            Logger.shared.error("[DelegationView] 拒绝委派失败: \(error)")
        }
    }

    func revokeDelegation(_ delegationId: String) async {
        do {
            try await permissionEngine.revokeDelegation(
                delegationId: delegationId,
                revokedBy: currentUserDid
            )
            await loadData()
        } catch {
            Logger.shared.error("[DelegationView] 撤销委派失败: \(error)")
        }
    }

    func createDelegation(
        delegateDid: String,
        permissions: [String],
        resourceScope: ResourceScope?,
        reason: String?,
        endDate: Date
    ) async {
        do {
            _ = try await permissionEngine.delegatePermissions(
                orgId: currentOrgId,
                delegatorDid: currentUserDid,
                delegateDid: delegateDid,
                permissions: permissions,
                resourceScope: resourceScope,
                reason: reason,
                startDate: Date(),
                endDate: endDate
            )
            await loadData()
        } catch {
            Logger.shared.error("[DelegationView] 创建委派失败: \(error)")
        }
    }
}

// MARK: - Preview

struct DelegationView_Previews: PreviewProvider {
    static var previews: some View {
        DelegationView()
    }
}
