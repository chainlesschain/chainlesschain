//
//  MCPResourceBrowserView.swift
//  ChainlessChain
//
//  MCP资源浏览器视图
//  浏览和查看服务器提供的资源
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// MCP资源浏览器视图
struct MCPResourceBrowserView: View {
    @StateObject private var viewModel = MCPViewModel.shared
    @State private var selectedResource: MCPResource?
    @State private var resourceContent: MCPResourceContent?
    @State private var isLoadingContent = false
    @State private var showResourceDetail = false

    var body: some View {
        VStack(spacing: 0) {
            // 搜索栏
            searchBar

            // 资源列表或详情
            if selectedResource != nil && showResourceDetail {
                resourceDetailView
            } else {
                resourceListView
            }
        }
    }

    // MARK: - 搜索栏

    private var searchBar: some View {
        HStack {
            if showResourceDetail {
                Button(action: {
                    withAnimation {
                        showResourceDetail = false
                        selectedResource = nil
                        resourceContent = nil
                    }
                }) {
                    Image(systemName: "chevron.left")
                        .foregroundColor(.blue)
                }
            }

            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.gray)

                TextField("搜索资源...", text: $viewModel.searchText)

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
        }
        .padding()
    }

    // MARK: - 资源列表视图

    private var resourceListView: some View {
        Group {
            if viewModel.isLoading {
                loadingView
            } else if viewModel.filteredResources.isEmpty {
                emptyView
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.filteredResources) { resource in
                            ResourceRow(resource: resource) {
                                selectResource(resource)
                            }
                        }
                    }
                    .padding()
                }
            }
        }
    }

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载资源列表...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            if viewModel.searchText.isEmpty {
                Text("没有可用的资源")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("该服务器未提供任何资源")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                Text("未找到匹配的资源")
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

    // MARK: - 资源详情视图

    private var resourceDetailView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 资源信息头部
            if let resource = selectedResource {
                resourceInfoHeader(resource)
            }

            Divider()

            // 内容显示
            if isLoadingContent {
                VStack {
                    Spacer()
                    ProgressView()
                    Text("加载内容...")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Spacer()
                }
            } else if let content = resourceContent {
                resourceContentView(content)
            } else {
                VStack {
                    Spacer()
                    Text("无法加载内容")
                        .foregroundColor(.secondary)
                    Spacer()
                }
            }
        }
    }

    // MARK: - 资源信息头部

    private func resourceInfoHeader(_ resource: MCPResource) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: iconForMimeType(resource.mimeType))
                    .font(.title2)
                    .foregroundColor(.blue)

                VStack(alignment: .leading, spacing: 2) {
                    Text(resource.name)
                        .font(.headline)

                    Text(resource.uri)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                // 复制URI按钮
                Button(action: {
                    UIPasteboard.general.string = resource.uri
                }) {
                    Image(systemName: "doc.on.doc")
                        .foregroundColor(.blue)
                }
            }

            if let description = resource.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            if let mimeType = resource.mimeType {
                HStack {
                    Text("类型:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(mimeType)
                        .font(.caption)
                        .fontWeight(.medium)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 资源内容视图

    private func resourceContentView(_ content: MCPResourceContent) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let text = content.text {
                    // 文本内容
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("内容")
                                .font(.headline)

                            Spacer()

                            Button(action: {
                                UIPasteboard.general.string = text
                            }) {
                                Label("复制", systemImage: "doc.on.doc")
                                    .font(.caption)
                            }
                        }

                        Text(text)
                            .font(.system(.body, design: .monospaced))
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                    }
                }

                if let blob = content.blob {
                    // 二进制内容
                    VStack(alignment: .leading, spacing: 8) {
                        Text("二进制内容")
                            .font(.headline)

                        HStack {
                            Image(systemName: "doc.fill")
                                .font(.largeTitle)
                                .foregroundColor(.blue)

                            VStack(alignment: .leading) {
                                Text("二进制数据")
                                    .font(.subheadline)
                                Text("\(blob.count) 字节")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                    }
                }
            }
            .padding()
        }
    }

    // MARK: - 辅助方法

    private func selectResource(_ resource: MCPResource) {
        selectedResource = resource
        showResourceDetail = true
        loadResourceContent(resource)
    }

    private func loadResourceContent(_ resource: MCPResource) {
        isLoadingContent = true
        resourceContent = nil

        Task {
            defer { isLoadingContent = false }

            do {
                resourceContent = try await viewModel.readResource(uri: resource.uri)
            } catch {
                Logger.shared.error("[MCPResourceBrowser] 加载资源失败: \(error)")
            }
        }
    }

    private func iconForMimeType(_ mimeType: String?) -> String {
        guard let mimeType = mimeType else { return "doc" }

        if mimeType.hasPrefix("text/") {
            return "doc.text"
        } else if mimeType.hasPrefix("image/") {
            return "photo"
        } else if mimeType.hasPrefix("audio/") {
            return "music.note"
        } else if mimeType.hasPrefix("video/") {
            return "video"
        } else if mimeType.contains("json") {
            return "curlybraces"
        } else if mimeType.contains("xml") {
            return "chevron.left.forwardslash.chevron.right"
        }

        return "doc"
    }
}

// MARK: - 资源行

struct ResourceRow: View {
    let resource: MCPResource
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // 图标
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.orange.opacity(0.1))
                        .frame(width: 40, height: 40)

                    Image(systemName: iconForMimeType)
                        .foregroundColor(.orange)
                }

                // 资源信息
                VStack(alignment: .leading, spacing: 4) {
                    Text(resource.name)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    Text(resource.uri)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)

                    if let description = resource.description {
                        Text(description)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // MIME类型标签
                if let mimeType = resource.mimeType {
                    Text(simpleMimeType(mimeType))
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(4)
                }

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

    private var iconForMimeType: String {
        guard let mimeType = resource.mimeType else { return "doc" }

        if mimeType.hasPrefix("text/") {
            return "doc.text"
        } else if mimeType.hasPrefix("image/") {
            return "photo"
        } else if mimeType.contains("json") {
            return "curlybraces"
        }

        return "doc"
    }

    private func simpleMimeType(_ mimeType: String) -> String {
        if let lastPart = mimeType.split(separator: "/").last {
            return String(lastPart)
        }
        return mimeType
    }
}

// MARK: - 预览

#if DEBUG
struct MCPResourceBrowserView_Previews: PreviewProvider {
    static var previews: some View {
        MCPResourceBrowserView()
    }
}
#endif
