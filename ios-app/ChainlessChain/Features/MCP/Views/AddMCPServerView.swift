//
//  AddMCPServerView.swift
//  ChainlessChain
//
//  添加MCP服务器视图
//  配置新的MCP服务器连接
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// 添加MCP服务器视图
struct AddMCPServerView: View {
    @StateObject private var viewModel = MCPViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var baseURL = ""
    @State private var apiKey = ""
    @State private var timeout: Double = 30
    @State private var maxRetries = 3
    @State private var enabled = true
    @State private var autoConnect = false
    @State private var description = ""

    // 权限设置
    @State private var readOnly = false
    @State private var requireConsent = true
    @State private var maxFileSizeMB = 100

    @State private var isSaving = false
    @State private var isTesting = false
    @State private var testResult: TestResult?

    var body: some View {
        NavigationView {
            Form {
                // 基本信息
                Section(header: Text("基本信息")) {
                    TextField("服务器名称", text: $name)

                    TextField("服务器URL", text: $baseURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()

                    SecureField("API密钥（可选）", text: $apiKey)

                    TextField("描述（可选）", text: $description)
                }

                // 连接设置
                Section(header: Text("连接设置")) {
                    Toggle("启用", isOn: $enabled)

                    Toggle("自动连接", isOn: $autoConnect)

                    HStack {
                        Text("超时时间")
                        Spacer()
                        Text("\(Int(timeout))秒")
                            .foregroundColor(.secondary)
                    }

                    Slider(value: $timeout, in: 5...120, step: 5)

                    Stepper("重试次数: \(maxRetries)", value: $maxRetries, in: 0...10)
                }

                // 权限设置
                Section(header: Text("权限设置")) {
                    Toggle("只读模式", isOn: $readOnly)

                    Toggle("操作需确认", isOn: $requireConsent)

                    Stepper("最大文件大小: \(maxFileSizeMB)MB", value: $maxFileSizeMB, in: 1...1000, step: 10)
                }

                // 测试连接
                Section(header: Text("测试")) {
                    Button(action: testConnection) {
                        HStack {
                            if isTesting {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "antenna.radiowaves.left.and.right")
                            }
                            Text("测试连接")
                        }
                    }
                    .disabled(baseURL.isEmpty || isTesting)

                    if let result = testResult {
                        HStack {
                            Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.success ? .green : .red)

                            VStack(alignment: .leading) {
                                Text(result.success ? "连接成功" : "连接失败")
                                    .font(.subheadline)
                                    .fontWeight(.medium)

                                if let message = result.message {
                                    Text(message)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }

                                if result.success, let latency = result.latency {
                                    Text("延迟: \(Int(latency * 1000))ms")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }

                // 预设服务器
                Section(header: Text("快速添加")) {
                    ForEach(presetServers, id: \.name) { preset in
                        Button(action: {
                            applyPreset(preset)
                        }) {
                            HStack {
                                Image(systemName: preset.icon)
                                    .foregroundColor(.blue)

                                VStack(alignment: .leading) {
                                    Text(preset.name)
                                        .foregroundColor(.primary)
                                    Text(preset.description)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("添加服务器")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        saveServer()
                    }
                    .disabled(!isValid || isSaving)
                }
            }
        }
    }

    // MARK: - 计算属性

    private var isValid: Bool {
        !name.isEmpty && !baseURL.isEmpty
    }

    // MARK: - 预设服务器

    private var presetServers: [PresetServer] {
        [
            PresetServer(
                name: "Filesystem",
                description: "文件系统访问",
                icon: "folder",
                baseURL: "http://localhost:3000/mcp/filesystem",
                readOnly: false
            ),
            PresetServer(
                name: "PostgreSQL",
                description: "PostgreSQL数据库",
                icon: "cylinder",
                baseURL: "http://localhost:3000/mcp/postgres",
                readOnly: false
            ),
            PresetServer(
                name: "SQLite",
                description: "SQLite数据库",
                icon: "cylinder.split.1x2",
                baseURL: "http://localhost:3000/mcp/sqlite",
                readOnly: true
            ),
            PresetServer(
                name: "Git",
                description: "Git仓库操作",
                icon: "arrow.triangle.branch",
                baseURL: "http://localhost:3000/mcp/git",
                readOnly: false
            ),
        ]
    }

    private func applyPreset(_ preset: PresetServer) {
        name = preset.name
        baseURL = preset.baseURL
        readOnly = preset.readOnly
        description = preset.description
    }

    // MARK: - 测试连接

    private func testConnection() {
        isTesting = true
        testResult = nil

        Task {
            defer { isTesting = false }

            let startTime = Date()

            // 模拟测试连接
            do {
                try await Task.sleep(nanoseconds: 1_000_000_000)

                // 简单验证URL格式
                guard URL(string: baseURL) != nil else {
                    testResult = TestResult(success: false, message: "无效的URL格式")
                    return
                }

                let latency = Date().timeIntervalSince(startTime)

                testResult = TestResult(
                    success: true,
                    message: "服务器响应正常",
                    latency: latency
                )
            } catch {
                testResult = TestResult(
                    success: false,
                    message: error.localizedDescription
                )
            }
        }
    }

    // MARK: - 保存服务器

    private func saveServer() {
        isSaving = true

        Task {
            defer { isSaving = false }

            let config = MCPServerConfig(
                name: name,
                transport: .httpSSE,
                enabled: enabled,
                autoConnect: autoConnect,
                baseURL: baseURL,
                apiKey: apiKey.isEmpty ? nil : apiKey,
                timeout: timeout,
                maxRetries: maxRetries,
                permissions: MCPServerPermissions(
                    readOnly: readOnly,
                    requireConsent: requireConsent,
                    maxFileSizeMB: maxFileSizeMB
                ),
                description: description.isEmpty ? nil : description
            )

            do {
                try await viewModel.addServer(config)
                dismiss()
            } catch {
                // 处理错误
                Logger.shared.error("[AddMCPServer] 保存失败: \(error)")
            }
        }
    }
}

// MARK: - 预设服务器

struct PresetServer {
    let name: String
    let description: String
    let icon: String
    let baseURL: String
    let readOnly: Bool
}

// MARK: - 测试结果

struct TestResult {
    let success: Bool
    let message: String?
    var latency: TimeInterval?
}

// MARK: - 安全设置视图

struct MCPSecuritySettingsView: View {
    let server: MCPServerConfig
    @StateObject private var viewModel = MCPViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var permissions: MCPServerPermissions

    init(server: MCPServerConfig) {
        self.server = server
        _permissions = State(initialValue: server.permissions)
    }

    var body: some View {
        NavigationView {
            Form {
                // 基本权限
                Section(header: Text("基本权限")) {
                    Toggle("只读模式", isOn: $permissions.readOnly)

                    Toggle("操作需确认", isOn: $permissions.requireConsent)
                }

                // 文件系统权限
                Section(header: Text("文件系统")) {
                    Stepper(
                        "最大文件大小: \(permissions.maxFileSizeMB)MB",
                        value: $permissions.maxFileSizeMB,
                        in: 1...1000,
                        step: 10
                    )

                    // 允许的路径
                    VStack(alignment: .leading, spacing: 8) {
                        Text("允许的路径")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        ForEach(permissions.allowedPaths, id: \.self) { path in
                            HStack {
                                Text(path)
                                    .font(.caption)
                                Spacer()
                                Button(action: {
                                    permissions.allowedPaths.removeAll { $0 == path }
                                }) {
                                    Image(systemName: "xmark.circle")
                                        .foregroundColor(.red)
                                }
                            }
                        }

                        Button("添加路径") {
                            // TODO: 添加路径输入
                        }
                        .font(.caption)
                    }

                    // 禁止的路径
                    VStack(alignment: .leading, spacing: 8) {
                        Text("禁止的路径")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        ForEach(permissions.forbiddenPaths, id: \.self) { path in
                            HStack {
                                Text(path)
                                    .font(.caption)
                                Spacer()
                                Button(action: {
                                    permissions.forbiddenPaths.removeAll { $0 == path }
                                }) {
                                    Image(systemName: "xmark.circle")
                                        .foregroundColor(.red)
                                }
                            }
                        }

                        Button("添加路径") {
                            // TODO: 添加路径输入
                        }
                        .font(.caption)
                    }
                }

                // 数据库权限
                Section(header: Text("数据库")) {
                    Stepper(
                        "最大结果行数: \(permissions.maxResultRows)",
                        value: $permissions.maxResultRows,
                        in: 100...10000,
                        step: 100
                    )
                }

                // 网络权限
                Section(header: Text("网络")) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("允许的域名")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        ForEach(permissions.allowedDomains, id: \.self) { domain in
                            HStack {
                                Text(domain)
                                    .font(.caption)
                                Spacer()
                                Button(action: {
                                    permissions.allowedDomains.removeAll { $0 == domain }
                                }) {
                                    Image(systemName: "xmark.circle")
                                        .foregroundColor(.red)
                                }
                            }
                        }

                        Button("添加域名") {
                            // TODO: 添加域名输入
                        }
                        .font(.caption)
                    }
                }
            }
            .navigationTitle("安全设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        savePermissions()
                    }
                }
            }
        }
    }

    private func savePermissions() {
        var updatedServer = server
        updatedServer.permissions = permissions

        Task {
            try? await viewModel.updateServer(updatedServer)
            dismiss()
        }
    }
}

// MARK: - 预览

#if DEBUG
struct AddMCPServerView_Previews: PreviewProvider {
    static var previews: some View {
        AddMCPServerView()
    }
}
#endif
