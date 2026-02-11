//
//  PluginMarketplaceView.swift
//  ChainlessChain
//
//  插件市场视图
//  浏览和下载插件
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 插件市场视图
struct PluginMarketplaceView: View {
    @StateObject private var viewModel = PluginViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var searchText = ""
    @State private var selectedCategory: PluginCategory?
    @State private var selectedPlugin: MarketplacePlugin?
    @State private var sortBy: SortOption = .downloads

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索栏
                searchBar

                // 过滤和排序
                filterBar

                // 插件列表
                if viewModel.isLoading {
                    loadingView
                } else if viewModel.marketplacePlugins.isEmpty {
                    emptyView
                } else {
                    pluginsList
                }
            }
            .navigationTitle("插件市场")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: refresh) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(item: $selectedPlugin) { plugin in
                MarketplacePluginDetailView(plugin: plugin)
            }
            .onAppear {
                Task {
                    await viewModel.loadMarketplacePlugins()
                }
            }
        }
    }

    // MARK: - 搜索栏

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("搜索插件...", text: $searchText)
                .onSubmit {
                    Task {
                        await viewModel.searchMarketplace(searchText)
                    }
                }

            if !searchText.isEmpty {
                Button(action: {
                    searchText = ""
                    Task {
                        await viewModel.loadMarketplacePlugins()
                    }
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
        .padding()
    }

    // MARK: - 过滤栏

    private var filterBar: some View {
        HStack {
            // 分类选择
            Menu {
                Button("全部") {
                    selectedCategory = nil
                }

                ForEach(PluginCategory.allCases, id: \.self) { category in
                    Button(category.displayName) {
                        selectedCategory = category
                    }
                }
            } label: {
                HStack {
                    Text(selectedCategory?.displayName ?? "全部分类")
                        .font(.subheadline)
                    Image(systemName: "chevron.down")
                        .font(.caption)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }

            Spacer()

            // 排序
            Menu {
                ForEach(SortOption.allCases, id: \.self) { option in
                    Button(option.displayName) {
                        sortBy = option
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "arrow.up.arrow.down")
                    Text(sortBy.displayName)
                        .font(.subheadline)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载插件市场...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "tray")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            Text("没有找到插件")
                .font(.headline)
                .foregroundColor(.secondary)

            if !searchText.isEmpty {
                Button("清除搜索") {
                    searchText = ""
                    Task {
                        await viewModel.loadMarketplacePlugins()
                    }
                }
                .font(.subheadline)
            }

            Spacer()
        }
    }

    // MARK: - 插件列表

    private var pluginsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(sortedPlugins) { plugin in
                    MarketplacePluginCard(plugin: plugin) {
                        selectedPlugin = plugin
                    }
                }
            }
            .padding()
        }
    }

    // 排序后的插件
    private var sortedPlugins: [MarketplacePlugin] {
        var plugins = viewModel.marketplacePlugins

        // 应用分类过滤
        if let category = selectedCategory {
            plugins = plugins.filter { $0.category == category }
        }

        // 应用排序
        switch sortBy {
        case .downloads:
            plugins.sort { $0.downloads > $1.downloads }
        case .rating:
            plugins.sort { $0.rating > $1.rating }
        case .newest:
            plugins.sort { $0.updatedAt > $1.updatedAt }
        case .name:
            plugins.sort { $0.name < $1.name }
        }

        return plugins
    }

    private func refresh() {
        Task {
            await viewModel.loadMarketplacePlugins()
        }
    }
}

// MARK: - 排序选项

enum SortOption: CaseIterable {
    case downloads
    case rating
    case newest
    case name

    var displayName: String {
        switch self {
        case .downloads: return "下载量"
        case .rating: return "评分"
        case .newest: return "最新"
        case .name: return "名称"
        }
    }
}

// MARK: - 市场插件卡片

struct MarketplacePluginCard: View {
    let plugin: MarketplacePlugin
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                // 头部
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(plugin.category.color.opacity(0.1))
                            .frame(width: 50, height: 50)

                        Image(systemName: plugin.icon ?? plugin.category.icon)
                            .font(.title2)
                            .foregroundColor(plugin.category.color)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(plugin.name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        Text(plugin.author)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 4) {
                        HStack(spacing: 2) {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundColor(.yellow)
                            Text(String(format: "%.1f", plugin.rating))
                                .font(.caption)
                                .fontWeight(.medium)
                        }

                        Text(plugin.formattedDownloads)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // 描述
                Text(plugin.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                // 底部信息
                HStack {
                    // 标签
                    HStack(spacing: 4) {
                        ForEach(plugin.tags.prefix(3), id: \.self) { tag in
                            Text(tag)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }

                    Spacer()

                    // 大小
                    Text(plugin.formattedSize)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - 市场插件详情视图

struct MarketplacePluginDetailView: View {
    let plugin: MarketplacePlugin
    @StateObject private var viewModel = PluginViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var isInstalling = false
    @State private var installError: Error?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 头部
                    headerSection

                    // 描述
                    descriptionSection

                    // 截图
                    if !plugin.screenshots.isEmpty {
                        screenshotsSection
                    }

                    // 权限
                    permissionsSection

                    // 更新日志
                    if let changelog = plugin.changelog {
                        changelogSection(changelog)
                    }

                    // 信息
                    infoSection
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
            }
            .alert("安装失败", isPresented: .constant(installError != nil)) {
                Button("确定") {
                    installError = nil
                }
            } message: {
                Text(installError?.localizedDescription ?? "未知错误")
            }
        }
    }

    // MARK: - 头部

    private var headerSection: some View {
        VStack(spacing: 16) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(plugin.category.color.opacity(0.1))
                        .frame(width: 80, height: 80)

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

                    HStack(spacing: 12) {
                        HStack(spacing: 2) {
                            Image(systemName: "star.fill")
                                .foregroundColor(.yellow)
                            Text(String(format: "%.1f", plugin.rating))
                                .fontWeight(.medium)
                            Text("(\(plugin.reviewCount))")
                                .foregroundColor(.secondary)
                        }
                        .font(.subheadline)

                        Text("•")
                            .foregroundColor(.secondary)

                        Text("\(plugin.formattedDownloads) 下载")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()
            }

            // 安装按钮
            Button(action: installPlugin) {
                HStack {
                    if isInstalling {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "arrow.down.circle.fill")
                    }
                    Text(isInstalling ? "安装中..." : "安装")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(isInstalling ? Color.gray : Color.blue)
                .cornerRadius(12)
            }
            .disabled(isInstalling)
        }
    }

    // MARK: - 描述

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("介绍")
                .font(.headline)

            Text(plugin.description)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - 截图

    private var screenshotsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("截图")
                .font(.headline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(plugin.screenshots, id: \.self) { screenshot in
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .frame(width: 200, height: 120)
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.gray)
                            )
                    }
                }
            }
        }
    }

    // MARK: - 权限

    private var permissionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("权限要求")
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
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - 更新日志

    private func changelogSection(_ changelog: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("更新日志")
                .font(.headline)

            Text(changelog)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - 信息

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("信息")
                .font(.headline)

            Group {
                InfoRow(label: "作者", value: plugin.author)
                InfoRow(label: "版本", value: plugin.version)
                InfoRow(label: "大小", value: plugin.formattedSize)
                InfoRow(label: "分类", value: plugin.category.displayName)
                InfoRow(label: "更新时间", value: formatDate(plugin.updatedAt))
            }
        }
    }

    // MARK: - 方法

    private func installPlugin() {
        isInstalling = true

        Task {
            do {
                try await viewModel.installFromMarketplace(plugin)
                dismiss()
            } catch {
                installError = error
            }

            isInstalling = false
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
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
            "network.http": "HTTP网络访问",
            "ai.chat": "AI对话",
            "blockchain.sign": "签名交易"
        ]
        return mapping[permission] ?? permission
    }
}

// MARK: - 预览

#if DEBUG
struct PluginMarketplaceView_Previews: PreviewProvider {
    static var previews: some View {
        PluginMarketplaceView()
    }
}
#endif
