//
//  MCPToolsListView.swift
//  ChainlessChain
//
//  MCP工具列表视图
//  显示服务器提供的所有工具
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// MCP工具列表视图
struct MCPToolsListView: View {
    @StateObject private var viewModel = MCPViewModel.shared
    @State private var selectedTool: MCPTool?
    @State private var showToolExecution = false

    var body: some View {
        VStack(spacing: 0) {
            // 搜索栏
            searchBar

            // 工具列表
            if viewModel.isLoading {
                loadingView
            } else if viewModel.filteredTools.isEmpty {
                emptyView
            } else {
                toolsList
            }
        }
        .sheet(item: $selectedTool) { tool in
            MCPToolExecutionView(tool: tool)
        }
    }

    // MARK: - 搜索栏

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("搜索工具...", text: $viewModel.searchText)

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

    // MARK: - 加载视图

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
            Text("加载工具列表...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            if viewModel.searchText.isEmpty {
                Text("没有可用的工具")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("该服务器未提供任何工具")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                Text("未找到匹配的工具")
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

    // MARK: - 工具列表

    private var toolsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.filteredTools) { tool in
                    ToolCard(tool: tool) {
                        selectedTool = tool
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - 工具卡片

struct ToolCard: View {
    let tool: MCPTool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                // 工具头部
                HStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 40, height: 40)

                        Image(systemName: "wrench")
                            .foregroundColor(.blue)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(tool.name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        Text("\(tool.inputSchema.properties.count) 个参数")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    Image(systemName: "play.circle.fill")
                        .font(.title2)
                        .foregroundColor(.blue)
                }

                // 工具描述
                if let description = tool.description {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                // 参数预览
                if !tool.inputSchema.properties.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(Array(tool.inputSchema.properties.keys.prefix(5)), id: \.self) { key in
                                let isRequired = tool.inputSchema.required.contains(key)

                                HStack(spacing: 4) {
                                    Text(key)
                                        .font(.caption2)

                                    if isRequired {
                                        Text("*")
                                            .font(.caption2)
                                            .foregroundColor(.red)
                                    }
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(4)
                            }

                            if tool.inputSchema.properties.count > 5 {
                                Text("+\(tool.inputSchema.properties.count - 5)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
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

// MARK: - 工具执行视图

struct MCPToolExecutionView: View {
    let tool: MCPTool
    @StateObject private var viewModel = MCPViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var paramValues: [String: String] = [:]
    @State private var result: MCPToolCallResult?
    @State private var error: Error?
    @State private var isExecuting = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // 工具信息
                    toolInfoSection

                    // 参数输入
                    if !tool.inputSchema.properties.isEmpty {
                        paramsSection
                    }

                    // 执行按钮
                    executeButton

                    // 结果显示
                    if let result = result {
                        resultSection(result)
                    }

                    // 错误显示
                    if let error = error {
                        errorSection(error)
                    }
                }
                .padding()
            }
            .navigationTitle("执行工具")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
        }
    }

    // MARK: - 工具信息

    private var toolInfoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "wrench")
                    .foregroundColor(.blue)
                Text(tool.name)
                    .font(.headline)
            }

            if let description = tool.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - 参数输入

    private var paramsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("参数")
                .font(.headline)

            ForEach(Array(tool.inputSchema.properties.keys.sorted()), id: \.self) { key in
                let property = tool.inputSchema.properties[key]!
                let isRequired = tool.inputSchema.required.contains(key)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(key)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        if isRequired {
                            Text("*")
                                .foregroundColor(.red)
                        }

                        Text("(\(property.type))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    if let description = property.description {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    // 根据类型显示不同的输入控件
                    if let enumValues = property.enum {
                        Picker(key, selection: Binding(
                            get: { paramValues[key] ?? "" },
                            set: { paramValues[key] = $0 }
                        )) {
                            Text("选择...").tag("")
                            ForEach(enumValues, id: \.self) { value in
                                Text(value).tag(value)
                            }
                        }
                        .pickerStyle(.menu)
                    } else if property.type == "boolean" {
                        Toggle("", isOn: Binding(
                            get: { paramValues[key] == "true" },
                            set: { paramValues[key] = $0 ? "true" : "false" }
                        ))
                    } else {
                        TextField("输入值...", text: Binding(
                            get: { paramValues[key] ?? "" },
                            set: { paramValues[key] = $0 }
                        ))
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 执行按钮

    private var executeButton: some View {
        Button(action: executeTool) {
            HStack {
                if isExecuting {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "play.fill")
                }
                Text("执行")
            }
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding()
            .background(isExecuting ? Color.gray : Color.blue)
            .cornerRadius(12)
        }
        .disabled(isExecuting)
    }

    // MARK: - 结果显示

    private func resultSection(_ result: MCPToolCallResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: result.isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                    .foregroundColor(result.isError ? .red : .green)

                Text(result.isError ? "执行失败" : "执行成功")
                    .font(.headline)
            }

            ForEach(result.content.indices, id: \.self) { index in
                let content = result.content[index]

                VStack(alignment: .leading, spacing: 4) {
                    Text("输出 \(index + 1)")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if let text = content.text {
                        Text(text)
                            .font(.system(.body, design: .monospaced))
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 错误显示

    private func errorSection(_ error: Error) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)

                Text("错误")
                    .font(.headline)
            }

            Text(error.localizedDescription)
                .font(.subheadline)
                .foregroundColor(.red)
        }
        .padding()
        .background(Color.red.opacity(0.1))
        .cornerRadius(12)
    }

    // MARK: - 执行工具

    private func executeTool() {
        isExecuting = true
        result = nil
        error = nil

        Task {
            defer { isExecuting = false }

            do {
                // 构建参数
                var params: [String: Any] = [:]
                for (key, value) in paramValues {
                    if !value.isEmpty {
                        let property = tool.inputSchema.properties[key]

                        switch property?.type {
                        case "integer":
                            params[key] = Int(value) ?? value
                        case "number":
                            params[key] = Double(value) ?? value
                        case "boolean":
                            params[key] = value == "true"
                        default:
                            params[key] = value
                        }
                    }
                }

                result = try await viewModel.callTool(
                    toolName: tool.name,
                    params: params
                )

            } catch {
                self.error = error
            }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct MCPToolsListView_Previews: PreviewProvider {
    static var previews: some View {
        MCPToolsListView()
    }
}
#endif
