//
//  MCPPromptListView.swift
//  ChainlessChain
//
//  MCP Prompt列表视图
//  显示和执行服务器提供的Prompts
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI

/// MCP Prompt列表视图
struct MCPPromptListView: View {
    @StateObject private var viewModel = MCPViewModel.shared
    @State private var selectedPrompt: MCPPrompt?

    var body: some View {
        VStack(spacing: 0) {
            // 搜索栏
            searchBar

            // Prompt列表
            if viewModel.isLoading {
                loadingView
            } else if viewModel.filteredPrompts.isEmpty {
                emptyView
            } else {
                promptsList
            }
        }
        .sheet(item: $selectedPrompt) { prompt in
            MCPPromptExecutionView(prompt: prompt)
        }
    }

    // MARK: - 搜索栏

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("搜索Prompt...", text: $viewModel.searchText)

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
            Text("加载Prompt列表...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
        }
    }

    // MARK: - 空视图

    private var emptyView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "text.bubble")
                .font(.system(size: 50))
                .foregroundColor(.gray)

            if viewModel.searchText.isEmpty {
                Text("没有可用的Prompt")
                    .font(.headline)
                    .foregroundColor(.secondary)

                Text("该服务器未提供任何Prompt")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                Text("未找到匹配的Prompt")
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

    // MARK: - Prompt列表

    private var promptsList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.filteredPrompts) { prompt in
                    PromptCard(prompt: prompt) {
                        selectedPrompt = prompt
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - Prompt卡片

struct PromptCard: View {
    let prompt: MCPPrompt
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                // Prompt头部
                HStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.purple.opacity(0.1))
                            .frame(width: 40, height: 40)

                        Image(systemName: "text.bubble.fill")
                            .foregroundColor(.purple)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(prompt.name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)

                        if let args = prompt.arguments {
                            Text("\(args.count) 个参数")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    Spacer()

                    Image(systemName: "play.circle.fill")
                        .font(.title2)
                        .foregroundColor(.purple)
                }

                // Prompt描述
                if let description = prompt.description {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                // 参数预览
                if let arguments = prompt.arguments, !arguments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(arguments, id: \.name) { arg in
                                HStack(spacing: 4) {
                                    Text(arg.name)
                                        .font(.caption2)

                                    if arg.required {
                                        Text("*")
                                            .font(.caption2)
                                            .foregroundColor(.red)
                                    }
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.purple.opacity(0.1))
                                .cornerRadius(4)
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

// MARK: - Prompt执行视图

struct MCPPromptExecutionView: View {
    let prompt: MCPPrompt
    @StateObject private var viewModel = MCPViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var argumentValues: [String: String] = [:]
    @State private var result: MCPPromptResult?
    @State private var error: Error?
    @State private var isExecuting = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Prompt信息
                    promptInfoSection

                    // 参数输入
                    if let arguments = prompt.arguments, !arguments.isEmpty {
                        argumentsSection(arguments)
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
            .navigationTitle("执行Prompt")
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

    // MARK: - Prompt信息

    private var promptInfoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "text.bubble.fill")
                    .foregroundColor(.purple)
                Text(prompt.name)
                    .font(.headline)
            }

            if let description = prompt.description {
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

    private func argumentsSection(_ arguments: [MCPPromptArgument]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("参数")
                .font(.headline)

            ForEach(arguments, id: \.name) { arg in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(arg.name)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        if arg.required {
                            Text("*")
                                .foregroundColor(.red)
                        }
                    }

                    if let description = arg.description {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    TextField("输入值...", text: Binding(
                        get: { argumentValues[arg.name] ?? "" },
                        set: { argumentValues[arg.name] = $0 }
                    ))
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 执行按钮

    private var executeButton: some View {
        Button(action: executePrompt) {
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
            .background(isExecuting ? Color.gray : Color.purple)
            .cornerRadius(12)
        }
        .disabled(isExecuting)
    }

    // MARK: - 结果显示

    private func resultSection(_ result: MCPPromptResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)

                Text("执行成功")
                    .font(.headline)
            }

            if let description = result.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            // 消息列表
            ForEach(result.messages.indices, id: \.self) { index in
                let message = result.messages[index]

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: message.role == .user ? "person" : "cpu")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text(message.role == .user ? "用户" : "助手")
                            .font(.caption)
                            .fontWeight(.medium)
                    }

                    if let text = message.content.text {
                        Text(text)
                            .font(.body)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(message.role == .user ?
                                         Color.blue.opacity(0.1) : Color(.secondarySystemBackground))
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

    // MARK: - 执行Prompt

    private func executePrompt() {
        isExecuting = true
        result = nil
        error = nil

        Task {
            defer { isExecuting = false }

            do {
                var args: [String: Any] = [:]
                for (key, value) in argumentValues {
                    if !value.isEmpty {
                        args[key] = value
                    }
                }

                result = try await viewModel.executePrompt(
                    promptName: prompt.name,
                    arguments: args
                )

            } catch {
                self.error = error
            }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct MCPPromptListView_Previews: PreviewProvider {
    static var previews: some View {
        MCPPromptListView()
    }
}
#endif
