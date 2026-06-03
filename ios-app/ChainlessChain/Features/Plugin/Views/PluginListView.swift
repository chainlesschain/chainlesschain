//
//  PluginListView.swift
//  ChainlessChain
//
//  插件列表视图
//  显示已安装的插件
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 插件列表视图
struct PluginListView: View {
    @StateObject private var viewModel = PluginViewModel.shared
    @State private var showAddPlugin = false
    @State private var showMarketplace = false
    @State private var selectedPlugin: Plugin?

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索栏
                searchBar

                // 分类过滤器
                categoryFilter

                // 插件列表
                if viewModel.isLoading {
                    loadingView
                } else if viewModel.filteredPlugins.isEmpty {
                    emptyView
                } else {
                    pluginsList
                }
            }
            .navigationTitle("插件")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { showMarketplace = true }) {
                            Label("插件市场", systemImage: "storefront")
                        }

                        Button(action: { showAddPlugin = true }) {
                            Label("从文件安装", systemImage: "folder")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showAddPlugin) {
                InstallPluginView()
            }
            .sheet(isPresented: $showMarketplace) {
                PluginMarketplaceView()
            }
            .sheet(item: $selectedPlugin) { plugin in
                PluginDetailView(plugin: plugin)
            }
        }
    }

    // MARK: - 搜索栏

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("搜索插件...", text: $viewModel.searchText)

            if !viewModel.searchText.isEmpty {
                Button(action: {
                    viewModel.searchText = ""
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

    // MARK: - 分类过滤器

    private var categoryFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // 全部
                CategoryChip(
                    title: "全部",
                    count: viewModel.installedPlugins.count,
                    isSelected: viewModel.selectedCategory == nil
                ) {
                    viewModel.selectedCategory = nil
                }

                // 各分类
                ForEach(PluginCategory.allCases, id: \.self) { category in
                    if let count = viewModel.categoryStats[category], count > 0 {
                        CategoryChip(
                            title: category.displayName,
                            count: count,
                            isSelected: viewModel.selectedCategory == category
                        ) {
                            viewModel.selectedCategory = category
                        }
                    }
                }
            }
            .padding(.horizontal)
        }
        .padding(.bottom, 8)
    }

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载插件...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            if viewModel.searchText.isEmpty {
                Text("没有已安装的插件")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("前往插件市场发现更多功能")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Button(action: { showMarketplace = true }) {
                    Text("浏览插件市场")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            } else {
                Text("未找到匹配的插件")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Button("清除搜索") {
                    viewModel.searchText = ""
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
                ForEach(viewModel.filteredPlugins) { plugin in
                    PluginCard(
                        plugin: plugin,
                        isActive: viewModel.isPluginActive(plugin.id)
                    ) {
                        selectedPlugin = plugin
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - 分类标签

struct CategoryChip: View {
    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.subheadline)

                Text("\(count)")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(isSelected ? Color.white.opacity(0.3) : Color.gray.opacity(0.2))
                    .cornerRadius(8)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? Color.blue : Color(.secondarySystemBackground))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

// MARK: - 插件卡片

struct PluginCard: View {
    let plugin: Plugin
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // 图标
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(plugin.category.color.opacity(0.1))
                        .frame(width: 50, height: 50)

                    Image(systemName: plugin.icon ?? plugin.category.icon)
                        .font(.title2)
                        .foregroundColor(plugin.category.color)
                }

                // 信息
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(plugin.name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        if isActive {
                            Text("运行中")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.green.opacity(0.2))
                                .foregroundColor(.green)
                                .cornerRadius(4)
                        }
                    }

                    Text(plugin.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)

                    HStack {
                        Text("v\(plugin.version)")
                            .font(.caption2)
                            .foregroundColor(.secondary)

                        Text("•")
                            .foregroundColor(.secondary)

                        Text(plugin.author)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // 状态指示
                Circle()
                    .fill(plugin.isEnabled ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)
            .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - PluginCategory Extension

extension PluginCategory {
    var color: Color {
        switch self {
        case .productivity: return .blue
        case .dataAnalysis: return .purple
        case .office: return .orange
        case .developer: return .green
        case .communication: return .pink
        case .utility: return .gray
        case .ai: return .indigo
        case .blockchain: return .cyan
        case .custom: return .brown
        }
    }
}

// MARK: - 预览

#if DEBUG
struct PluginListView_Previews: PreviewProvider {
    static var previews: some View {
        PluginListView()
    }
}
#endif
