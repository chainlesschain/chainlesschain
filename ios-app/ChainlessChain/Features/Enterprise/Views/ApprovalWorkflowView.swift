import SwiftUI
import Combine

/// 审批工作流视图
public struct ApprovalWorkflowView: View {
    @StateObject private var viewModel = ApprovalWorkflowViewModel()
    @State private var selectedTab = 0

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 标签选择器
                Picker("", selection: $selectedTab) {
                    Text("待审批").tag(0)
                    Text("我的请求").tag(1)
                    Text("审批历史").tag(2)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                // 内容区域
                tabContent
            }
            .navigationTitle("审批中心")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await viewModel.refresh() } }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
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
            PendingApprovalsView(viewModel: viewModel)
        case 1:
            MyRequestsView(viewModel: viewModel)
        case 2:
            ApprovalHistoryView(viewModel: viewModel)
        default:
            EmptyView()
        }
    }
}

// MARK: - Pending Approvals View

private struct PendingApprovalsView: View {
    @ObservedObject var viewModel: ApprovalWorkflowViewModel

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.pendingApprovals.isEmpty {
                EmptyStateView(
                    icon: "checkmark.circle",
                    title: "没有待审批项",
                    message: "当前没有需要您审批的请求"
                )
            } else {
                List {
                    ForEach(viewModel.pendingApprovals) { request in
                        ApprovalRequestRow(request: request, viewModel: viewModel)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - My Requests View

private struct MyRequestsView: View {
    @ObservedObject var viewModel: ApprovalWorkflowViewModel

    var body: some View {
        Group {
            if viewModel.myRequests.isEmpty {
                EmptyStateView(
                    icon: "doc.text",
                    title: "没有审批请求",
                    message: "您还没有提交过审批请求"
                )
            } else {
                List {
                    ForEach(viewModel.myRequests) { request in
                        MyRequestRow(request: request, viewModel: viewModel)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Approval History View

private struct ApprovalHistoryView: View {
    @ObservedObject var viewModel: ApprovalWorkflowViewModel

    var body: some View {
        Group {
            if viewModel.history.isEmpty {
                EmptyStateView(
                    icon: "clock",
                    title: "没有审批历史",
                    message: "还没有完成的审批记录"
                )
            } else {
                List {
                    ForEach(viewModel.history) { request in
                        HistoryRow(request: request)
                    }
                }
                .listStyle(PlainListStyle())
            }
        }
    }
}

// MARK: - Approval Request Row

private struct ApprovalRequestRow: View {
    let request: ApprovalRequestSummary
    @ObservedObject var viewModel: ApprovalWorkflowViewModel
    @State private var showingDetail = false
    @State private var comment = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 标题行
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.workflowName)
                        .font(.headline)

                    Text(request.requesterName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                StepBadge(current: request.currentStep + 1, total: request.totalSteps)
            }

            // 资源信息
            HStack {
                Label(request.resourceType, systemImage: "folder")
                if let resourceId = request.resourceId {
                    Text("/ \(resourceId)")
                }
                Spacer()
                Text(request.action)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(4)
            }
            .font(.caption)
            .foregroundColor(.secondary)

            // 操作按钮
            HStack(spacing: 12) {
                Button(action: {
                    Task {
                        await viewModel.approveRequest(request.id, comment: nil)
                    }
                }) {
                    HStack {
                        Image(systemName: "checkmark")
                        Text("同意")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button(action: {
                    showingDetail = true
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

            // 时间
            Text("提交于 \(formatDate(request.createdAt))")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
        .sheet(isPresented: $showingDetail) {
            RejectCommentSheet(
                request: request,
                comment: $comment,
                onReject: {
                    Task {
                        await viewModel.rejectRequest(request.id, comment: comment)
                        showingDetail = false
                    }
                }
            )
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - My Request Row

private struct MyRequestRow: View {
    let request: ApprovalRequestSummary
    @ObservedObject var viewModel: ApprovalWorkflowViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.workflowName)
                        .font(.headline)

                    Text("\(request.resourceType) / \(request.action)")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                StatusBadge(status: request.status)
            }

            HStack {
                StepBadge(current: request.currentStep + 1, total: request.totalSteps)

                Spacer()

                if request.status == .pending {
                    Button("取消") {
                        Task {
                            await viewModel.cancelRequest(request.id)
                        }
                    }
                    .font(.caption)
                    .foregroundColor(.red)
                }
            }

            Text("提交于 \(formatDate(request.createdAt))")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - History Row

private struct HistoryRow: View {
    let request: ApprovalRequestSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.workflowName)
                        .font(.headline)

                    Text(request.requesterName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                StatusBadge(status: request.status)
            }

            HStack {
                Text("\(request.resourceType) / \(request.action)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if let completedAt = request.completedAt {
                    Text("完成于 \(formatDate(completedAt))")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Step Badge

private struct StepBadge: View {
    let current: Int
    let total: Int

    var body: some View {
        Text("步骤 \(current)/\(total)")
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.blue.opacity(0.1))
            .cornerRadius(4)
    }
}

// MARK: - Status Badge

private struct StatusBadge: View {
    let status: ApprovalRequestStatus

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
        case .pending: return "待审批"
        case .approved: return "已通过"
        case .rejected: return "已拒绝"
        case .expired: return "已过期"
        case .cancelled: return "已取消"
        }
    }

    private var statusColor: Color {
        switch status {
        case .pending: return .orange
        case .approved: return .green
        case .rejected: return .red
        case .expired: return .gray
        case .cancelled: return .gray
        }
    }
}

// MARK: - Empty State View

private struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            Text(title)
                .font(.headline)
                .foregroundColor(.secondary)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reject Comment Sheet

private struct RejectCommentSheet: View {
    let request: ApprovalRequestSummary
    @Binding var comment: String
    let onReject: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("审批信息")) {
                    LabeledContent("工作流", value: request.workflowName)
                    LabeledContent("请求人", value: request.requesterName)
                    LabeledContent("操作", value: request.action)
                }

                Section(header: Text("拒绝原因")) {
                    TextEditor(text: $comment)
                        .frame(minHeight: 100)
                }
            }
            .navigationTitle("拒绝审批")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("确认拒绝") {
                        onReject()
                    }
                    .foregroundColor(.red)
                }
            }
        }
    }
}

// MARK: - View Model

@MainActor
class ApprovalWorkflowViewModel: ObservableObject {
    @Published var pendingApprovals: [ApprovalRequestSummary] = []
    @Published var myRequests: [ApprovalRequestSummary] = []
    @Published var history: [ApprovalRequestSummary] = []
    @Published var isLoading = false

    private let manager = ApprovalWorkflowManager.shared

    // 当前用户 DID（从认证服务获取）
    private var currentUserDid: String {
        // TODO: 从认证服务获取
        return "did:test:current-user"
    }

    // 当前组织 ID
    private var currentOrgId: String {
        // TODO: 从组织管理器获取
        return "org-default"
    }

    func loadData() async {
        isLoading = true

        do {
            pendingApprovals = try await manager.getPendingApprovals(
                approverDid: currentUserDid,
                orgId: currentOrgId
            )

            myRequests = try await manager.getApprovalHistory(
                orgId: currentOrgId,
                requesterDid: currentUserDid
            ).filter { $0.status == .pending }

            history = try await manager.getApprovalHistory(
                orgId: currentOrgId,
                limit: 50
            ).filter { $0.status != .pending }

        } catch {
            Logger.shared.error("[ApprovalWorkflowView] 加载数据失败: \(error)")
        }

        isLoading = false
    }

    func refresh() async {
        await loadData()
    }

    func approveRequest(_ requestId: String, comment: String?) async {
        do {
            _ = try await manager.approveRequest(
                requestId: requestId,
                approverDid: currentUserDid,
                comment: comment
            )
            await loadData()
        } catch {
            Logger.shared.error("[ApprovalWorkflowView] 审批失败: \(error)")
        }
    }

    func rejectRequest(_ requestId: String, comment: String?) async {
        do {
            _ = try await manager.rejectRequest(
                requestId: requestId,
                approverDid: currentUserDid,
                comment: comment
            )
            await loadData()
        } catch {
            Logger.shared.error("[ApprovalWorkflowView] 拒绝失败: \(error)")
        }
    }

    func cancelRequest(_ requestId: String) async {
        do {
            _ = try await manager.cancelRequest(
                requestId: requestId,
                cancellerDid: currentUserDid
            )
            await loadData()
        } catch {
            Logger.shared.error("[ApprovalWorkflowView] 取消失败: \(error)")
        }
    }
}

// MARK: - Preview

struct ApprovalWorkflowView_Previews: PreviewProvider {
    static var previews: some View {
        ApprovalWorkflowView()
    }
}
