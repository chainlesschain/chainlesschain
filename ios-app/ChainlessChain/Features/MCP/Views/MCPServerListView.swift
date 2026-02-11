//
//  MCPServerListView.swift
//  ChainlessChain
//
//  MCP服务器列表视图
//  显示所有配置的MCP服务器及其状态
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// MCP服务器列表视图
struct MCPServerListView: View {
    @StateObject private var viewModel = MCPViewModel.shared
    @State private var showAddServer = false
    @State private var selectedServer: MCPServerConfig?
    @State private var showServerDetail = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 连接状态摘要
                connectionSummary

                // 服务器列表
                if viewModel.isLoading && viewModel.servers.isEmpty {
                    loadingView
                } else if viewModel.servers.isEmpty {
                    emptyView
                } else {
                    serverList
                }
            }
            .navigationTitle("MCP服务器")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        showAddServer = true
                    }) {
                        Image(systemName: "plus")
                    }
                }

                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        Task {
                            await viewModel.checkAllHealth()
                        }
                    }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showAddServer) {
                AddMCPServerView()
            }
            .sheet(item: $selectedServer) { server in
                MCPServerDetailView(server: server)
            }
            .alert("错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage)
            }
            .refreshable {
                viewModel.loadServers()
                await viewModel.checkAllHealth()
            }
        }
    }

    // MARK: - 连接状态摘要

    private var connectionSummary: some View {
        HStack(spacing: 0) {
            SummaryItem(
                title: "已连接",
                value: "\(viewModel.connectedServers.count)",
                color: .green
            )

            Divider()
                .frame(height: 30)

            SummaryItem(
                title: "总计",
                value: "\(viewModel.servers.count)",
                color: .blue
            )

            Divider()
                .frame(height: 30)

            SummaryItem(
                title: "工具",
                value: "\(viewModel.serverTools.count)",
                color: .purple
            )
        }
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载中...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "server.rack")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("没有配置的服务器")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("添加MCP服务器以使用AI工具")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button(action: {
                showAddServer = true
            }) {
                Label("添加服务器", systemImage: "plus.circle.fill")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .cornerRadius(10)
            }

            Spacer()
        }
    }

    // MARK: - 服务器列表

    private var serverList: some View {
        List {
            ForEach(viewModel.servers) { server in
                ServerRow(
                    server: server,
                    health: viewModel.serverHealthStatus[server.id],
                    isConnected: viewModel.connectedServers.contains(where: { $0.id == server.id }),
                    onConnect: {
                        Task {
                            try? await viewModel.connectServer(server.id)
                        }
                    },
                    onDisconnect: {
                        Task {
                            await viewModel.disconnectServer(server.id)
                        }
                    },
                    onTap: {
                        selectedServer = server
                    }
                )
            }
            .onDelete { indexSet in
                Task {
                    for index in indexSet {
                        try? await viewModel.deleteServer(viewModel.servers[index].id)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

// MARK: - 摘要项

struct SummaryItem: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline)
                .fontWeight(.bold)
                .foregroundColor(color)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 服务器行

struct ServerRow: View {
    let server: MCPServerConfig
    let health: MCPServerHealth?
    let isConnected: Bool
    let onConnect: () -> Void
    let onDisconnect: () -> Void
    let onTap: () -> Void

    var statusColor: Color {
        if isConnected {
            return health?.status == .healthy ? .green : .orange
        }
        return .gray
    }

    var statusText: String {
        if isConnected {
            return health?.status == .healthy ? "已连接" : "连接中"
        }
        return "未连接"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // 状态指示器
                ZStack {
                    Circle()
                        .fill(statusColor.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: "server.rack")
                        .foregroundColor(statusColor)
                }

                // 服务器信息
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(server.name)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)

                        if !server.enabled {
                            Text("禁用")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.gray.opacity(0.2))
                                .foregroundColor(.gray)
                                .cornerRadius(4)
                        }
                    }

                    Text(server.baseURL ?? "未配置URL")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)

                    // 延迟信息
                    if let health = health, let latency = health.latency {
                        HStack(spacing: 4) {
                            Image(systemName: "clock")
                                .font(.caption2)
                            Text("\(Int(latency * 1000))ms")
                                .font(.caption2)
                        }
                        .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // 连接/断开按钮
                if server.enabled {
                    Button(action: {
                        if isConnected {
                            onDisconnect()
                        } else {
                            onConnect()
                        }
                    }) {
                        Text(isConnected ? "断开" : "连接")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(isConnected ? .red : .blue)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(isConnected ? Color.red.opacity(0.1) : Color.blue.opacity(0.1))
                            .cornerRadius(6)
                    }
                    .buttonStyle(PlainButtonStyle())
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - 预览

#if DEBUG
struct MCPServerListView_Previews: PreviewProvider {
    static var previews: some View {
        MCPServerListView()
    }
}
#endif
