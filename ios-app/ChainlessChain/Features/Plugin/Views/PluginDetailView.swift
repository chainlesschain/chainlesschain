//
//  PluginDetailView.swift
//  ChainlessChain
//
//  插件详情视图
//  显示插件详细信息和操作
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 插件详情视图
struct PluginDetailView: View {
    let plugin: Plugin
    @StateObject private var viewModel = PluginViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var showSettings = false
    @State private var showUninstallConfirm = false
    @State private var isExecuting = false
    @State private var actionResult: PluginActionResult?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 头部信息
                    headerSection

                    // 状态和操作
                    statusSection

                    // 动作列表
                    if !plugin.manifest.actions.isEmpty {
                        actionsSection
                    }

                    // 权限信息
                    permissionsSection

                    // 插件信息
                    infoSection

                    // 删除按钮
                    deleteSection
                }
                .padding()
            }
            .navigationTitle("插件详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                PluginSettingsView(plugin: plugin)
            }
            .alert("确认卸载", isPresented: $showUninstallConfirm) {
                Button("取消", role: .cancel) {}
                Button("卸载", role: .destructive) {
                    uninstallPlugin()
                }
            } message: {
                Text("确定要卸载 \(plugin.name) 吗？此操作不可撤销。")
            }
        }
    }

    // MARK: - 头部信息

    private var headerSection: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(plugin.category.color.opacity(0.1))
                    .frame(width: 70, height: 70)

                Image(systemName: plugin.icon ?? plugin.category.icon)
                    .font(.largeTitle)
                    .foregroundColor(plugin.category.color)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(plugin.name)
                    .font(.title2)
                    .fontWeight(.bold)

                Text("v\(plugin.version)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                HStack {
                    Text(plugin.category.displayName)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(plugin.category.color.opacity(0.1))
                        .foregroundColor(plugin.category.color)
                        .cornerRadius(4)

                    if viewModel.isPluginActive(plugin.id) {
                        Text("运行中")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.green.opacity(0.1))
                            .foregroundColor(.green)
                            .cornerRadius(4)
                    }
                }
            }

            Spacer()
        }
    }

    // MARK: - 状态和操作

    private var statusSection: some View {
        VStack(spacing: 12) {
            // 启用/禁用开关
            HStack {
                Text("启用插件")
                    .font(.subheadline)

                Spacer()

                Toggle("", isOn: Binding(
                    get: { plugin.isEnabled },
                    set: { newValue in
                        Task {
                            if newValue {
                                try? await viewModel.enablePlugin(plugin.id)
                            } else {
                                try? await viewModel.disablePlugin(plugin.id)
                            }
                        }
                    }
                ))
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)

            // 激活/停用按钮
            Button(action: toggleActive) {
                HStack {
                    if isExecuting {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: viewModel.isPluginActive(plugin.id) ? "stop.fill" : "play.fill")
                    }
                    Text(viewModel.isPluginActive(plugin.id) ? "停用" : "激活")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(viewModel.isPluginActive(plugin.id) ? Color.orange : Color.blue)
                .cornerRadius(12)
            }
            .disabled(!plugin.isEnabled || isExecuting)
        }
    }

    // MARK: - 动作列表

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("可用动作")
                .font(.headline)

            ForEach(plugin.manifest.actions) { action in
                ActionRow(action: action) {
                    executeAction(action)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 权限信息

    private var permissionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("权限")
                .font(.headline)

            let permissions = plugin.permissions.grantedPermissions

            if permissions.isEmpty {
                Text("此插件不需要特殊权限")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                ForEach(permissions, id: \.self) { permission in
                    HStack {
                        Image(systemName: permissionIcon(permission))
                            .foregroundColor(permissionColor(permission))
                            .frame(width: 24)

                        Text(permissionDisplayName(permission))
                            .font(.subheadline)

                        Spacer()
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 插件信息

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("信息")
                .font(.headline)

            Group {
                InfoRow(label: "作者", value: plugin.author)
                InfoRow(label: "版本", value: plugin.version)

                if let homepage = plugin.homepage {
                    InfoRow(label: "主页", value: homepage)
                }

                if let installedAt = plugin.installedAt {
                    InfoRow(label: "安装时间", value: formatDate(installedAt))
                }

                if let lastUsedAt = plugin.lastUsedAt {
                    InfoRow(label: "上次使用", value: formatDate(lastUsedAt))
                }

                InfoRow(label: "使用次数", value: "\(plugin.usageCount)")
            }

            // 标签
            if !plugin.tags.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("标签")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    FlowLayout(spacing: 8) {
                        ForEach(plugin.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 删除按钮

    private var deleteSection: some View {
        Button(action: { showUninstallConfirm = true }) {
            HStack {
                Image(systemName: "trash")
                Text("卸载插件")
            }
            .font(.headline)
            .foregroundColor(.red)
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.red.opacity(0.1))
            .cornerRadius(12)
        }
    }

    // MARK: - 方法

    private func toggleActive() {
        isExecuting = true

        Task {
            defer { isExecuting = false }

            if viewModel.isPluginActive(plugin.id) {
                await viewModel.deactivatePlugin(plugin.id)
            } else {
                try? await viewModel.activatePlugin(plugin.id)
            }
        }
    }

    private func executeAction(_ action: PluginActionDefinition) {
        isExecuting = true

        Task {
            defer { isExecuting = false }

            do {
                actionResult = try await viewModel.executeAction(plugin.id, action: action.id)
            } catch {
                // 错误处理
            }
        }
    }

    private func uninstallPlugin() {
        Task {
            try? await viewModel.uninstallPlugin(plugin.id)
            dismiss()
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func permissionIcon(_ permission: String) -> String {
        if permission.contains("filesystem") { return "folder" }
        if permission.contains("network") { return "network" }
        if permission.contains("system") { return "gearshape.2" }
        if permission.contains("ai") { return "brain" }
        if permission.contains("blockchain") { return "link" }
        return "checkmark.shield"
    }

    private func permissionColor(_ permission: String) -> Color {
        if permission.contains("transfer") || permission.contains("sign") { return .red }
        if permission.contains("write") || permission.contains("shell") { return .orange }
        return .blue
    }

    private func permissionDisplayName(_ permission: String) -> String {
        let mapping: [String: String] = [
            "filesystem.read": "读取文件",
            "filesystem.write": "写入文件",
            "filesystem.execute": "执行程序",
            "network.http": "HTTP网络访问",
            "network.websocket": "WebSocket连接",
            "system.clipboard": "剪贴板访问",
            "system.notifications": "发送通知",
            "system.shell": "Shell执行",
            "ai.chat": "AI对话",
            "ai.embedding": "向量嵌入",
            "ai.toolUse": "AI工具使用",
            "blockchain.read": "读取区块链",
            "blockchain.sign": "签名交易",
            "blockchain.transfer": "转账权限"
        ]
        return mapping[permission] ?? permission
    }
}

// MARK: - 动作行

struct ActionRow: View {
    let action: PluginActionDefinition
    let onExecute: () -> Void

    var body: some View {
        HStack {
            Image(systemName: action.icon ?? "play.circle")
                .foregroundColor(.blue)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(action.name)
                    .font(.subheadline)

                if let description = action.description {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Button(action: onExecute) {
                Image(systemName: "play.fill")
                    .foregroundColor(.white)
                    .padding(8)
                    .background(Color.blue)
                    .cornerRadius(8)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
    }
}

// MARK: - 信息行

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            Text(value)
                .font(.subheadline)
        }
    }
}

// MARK: - 流式布局

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.replacingUnspecifiedDimensions().width, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)

        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y), proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var maxHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += maxHeight + spacing
                    maxHeight = 0
                }

                positions.append(CGPoint(x: x, y: y))
                maxHeight = max(maxHeight, size.height)
                x += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: y + maxHeight)
        }
    }
}

// MARK: - 预览

#if DEBUG
struct PluginDetailView_Previews: PreviewProvider {
    static var previews: some View {
        PluginDetailView(plugin: Plugin(
            name: "Test Plugin",
            version: "1.0.0",
            description: "A test plugin for preview"
        ))
    }
}
#endif
