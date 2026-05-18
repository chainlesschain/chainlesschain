//
//  InstallPluginView.swift
//  ChainlessChain
//
//  安装插件视图
//  从文件安装插件
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import UniformTypeIdentifiers

/// 安装插件视图
struct InstallPluginView: View {
    @StateObject private var viewModel = PluginViewModel.shared
    @Environment(\.dismiss) var dismiss

    @State private var showFilePicker = false
    @State private var selectedURL: URL?
    @State private var isValidating = false
    @State private var isInstalling = false
    @State private var validationResult: ValidationResult?
    @State private var installError: Error?

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // 说明
                instructionSection

                // 文件选择区域
                fileSelectionSection

                // 验证结果
                if let result = validationResult {
                    validationResultSection(result)
                }

                Spacer()

                // 安装按钮
                if selectedURL != nil && validationResult?.isValid == true {
                    installButton
                }
            }
            .padding()
            .navigationTitle("安装插件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: [.zip, .folder],
                allowsMultipleSelection: false
            ) { result in
                handleFileSelection(result)
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

    // MARK: - 说明区域

    private var instructionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "info.circle.fill")
                    .foregroundColor(.blue)
                Text("安装说明")
                    .font(.headline)
            }

            VStack(alignment: .leading, spacing: 8) {
                instructionRow(number: 1, text: "选择插件包文件（.zip）或插件文件夹")
                instructionRow(number: 2, text: "系统将自动验证插件的安全性")
                instructionRow(number: 3, text: "确认权限后完成安装")
            }
            .font(.subheadline)
            .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func instructionRow(number: Int, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 20, height: 20)
                .background(Color.blue)
                .clipShape(Circle())

            Text(text)
        }
    }

    // MARK: - 文件选择区域

    private var fileSelectionSection: some View {
        VStack(spacing: 16) {
            if let url = selectedURL {
                // 已选择文件
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.green.opacity(0.1))
                            .frame(width: 60, height: 60)

                        Image(systemName: "checkmark.circle.fill")
                            .font(.title)
                            .foregroundColor(.green)
                    }

                    Text("已选择文件")
                        .font(.headline)

                    Text(url.lastPathComponent)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(1)

                    Button("重新选择") {
                        showFilePicker = true
                    }
                    .font(.subheadline)
                }
            } else {
                // 未选择文件
                Button(action: { showFilePicker = true }) {
                    VStack(spacing: 16) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(style: StrokeStyle(lineWidth: 2, dash: [8]))
                                .foregroundColor(.gray)

                            VStack(spacing: 12) {
                                Image(systemName: "arrow.up.doc.fill")
                                    .font(.system(size: 40))
                                    .foregroundColor(.blue)

                                Text("选择插件文件")
                                    .font(.headline)
                                    .foregroundColor(.primary)

                                Text("支持 .zip 文件或文件夹")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding(40)
                        }
                    }
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
    }

    // MARK: - 验证结果

    private func validationResultSection(_ result: ValidationResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // 状态头部
            HStack {
                Image(systemName: result.isValid ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                    .foregroundColor(result.isValid ? .green : .red)

                Text(result.isValid ? "验证通过" : "验证失败")
                    .font(.headline)

                Spacer()

                if isValidating {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            // 错误列表
            if !result.errors.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("错误")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.red)

                    ForEach(result.errors, id: \.self) { error in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.red)
                                .font(.caption)

                            Text(error)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            // 警告列表
            if !result.warnings.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("警告")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.orange)

                    ForEach(result.warnings, id: \.self) { warning in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                                .font(.caption)

                            Text(warning)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
        .padding()
        .background(result.isValid ? Color.green.opacity(0.1) : Color.red.opacity(0.1))
        .cornerRadius(12)
    }

    // MARK: - 安装按钮

    private var installButton: some View {
        Button(action: installPlugin) {
            HStack {
                if isInstalling {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "arrow.down.circle.fill")
                }
                Text(isInstalling ? "安装中..." : "安装插件")
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

    // MARK: - 方法

    private func handleFileSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            if let url = urls.first {
                selectedURL = url
                validatePlugin(at: url)
            }

        case .failure(let error):
            installError = error
        }
    }

    private func validatePlugin(at url: URL) {
        isValidating = true
        validationResult = nil

        Task {
            defer { isValidating = false }

            do {
                let result = try await PluginValidator.shared.validatePlugin(at: url)
                validationResult = result
            } catch {
                validationResult = ValidationResult(
                    isValid: false,
                    errors: [error.localizedDescription],
                    warnings: []
                )
            }
        }
    }

    private func installPlugin() {
        guard let url = selectedURL else { return }

        isInstalling = true

        Task {
            defer { isInstalling = false }

            do {
                try await viewModel.installPlugin(from: url)
                dismiss()
            } catch {
                installError = error
            }
        }
    }
}

// MARK: - UTType Extension

extension UTType {
    static var zip: UTType {
        UTType(filenameExtension: "zip") ?? .data
    }
}

// MARK: - 预览

#if DEBUG
struct InstallPluginView_Previews: PreviewProvider {
    static var previews: some View {
        InstallPluginView()
    }
}
#endif
