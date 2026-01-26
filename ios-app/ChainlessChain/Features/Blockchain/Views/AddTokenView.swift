//
//  AddTokenView.swift
//  ChainlessChain
//
//  添加自定义代币视图
//  支持通过合约地址添加ERC-20代币
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 添加代币视图
struct AddTokenView: View {
    let wallet: Wallet
    let onTokenAdded: () -> Void

    @Environment(\.dismiss) var dismiss
    @StateObject private var tokenManager = TokenManager.shared

    @State private var contractAddress = ""
    @State private var tokenInfo: (name: String, symbol: String, decimals: Int)?
    @State private var isValidating = false
    @State private var isAdding = false
    @State private var errorMessage: String?
    @State private var showError = false

    var isValidAddress: Bool {
        contractAddress.starts(with: "0x") && contractAddress.count == 42
    }

    var canAdd: Bool {
        isValidAddress && tokenInfo != nil && !isAdding
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var body: some View {
        NavigationView {
            Form {
                // 合约地址输入
                Section(header: Text("代币合约地址")) {
                    TextField("0x...", text: $contractAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))
                        .onChange(of: contractAddress) { _ in
                            tokenInfo = nil
                            if isValidAddress {
                                Task {
                                    await validateToken()
                                }
                            }
                        }

                    if isValidating {
                        HStack {
                            ProgressView()
                            Text("验证中...")
                                .foregroundColor(.secondary)
                        }
                    }

                    if !contractAddress.isEmpty && !isValidAddress {
                        Label("请输入有效的合约地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 代币信息
                if let info = tokenInfo {
                    Section(header: Text("代币信息")) {
                        HStack {
                            Text("名称")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(info.name)
                                .fontWeight(.medium)
                        }

                        HStack {
                            Text("符号")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(info.symbol)
                                .fontWeight(.medium)
                        }

                        HStack {
                            Text("小数位数")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text("\(info.decimals)")
                                .fontWeight(.medium)
                        }

                        HStack {
                            Text("网络")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(chain.name)
                                .fontWeight(.medium)
                        }
                    }
                }

                // 添加按钮
                Section {
                    Button(action: {
                        Task {
                            await addToken()
                        }
                    }) {
                        HStack {
                            Spacer()

                            if isAdding {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                Text("添加中...")
                            } else {
                                Text("添加代币")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canAdd)
                }
            }
            .navigationTitle("添加代币")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isAdding)
                }
            }
            .alert("错误", isPresented: $showError) {
                Button("确定", role: .cancel) {}
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
        }
    }

    /// 验证代币
    private func validateToken() async {
        isValidating = true
        defer { isValidating = false }

        do {
            let name = try await ContractManager.shared.getTokenName(
                tokenAddress: contractAddress,
                chain: chain
            )

            let symbol = try await ContractManager.shared.getTokenSymbol(
                tokenAddress: contractAddress,
                chain: chain
            )

            let decimals = try await ContractManager.shared.getTokenDecimals(
                tokenAddress: contractAddress,
                chain: chain
            )

            tokenInfo = (name, symbol, decimals)
        } catch {
            errorMessage = "无法读取代币信息，请检查合约地址"
            showError = true
        }
    }

    /// 添加代币
    private func addToken() async {
        isAdding = true
        defer { isAdding = false }

        do {
            _ = try await tokenManager.addToken(
                address: contractAddress,
                chain: chain
            )

            onTokenAdded()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - 预览

#if DEBUG
struct AddTokenView_Previews: PreviewProvider {
    static var previews: some View {
        AddTokenView(wallet: .preview) {}
    }
}
#endif
