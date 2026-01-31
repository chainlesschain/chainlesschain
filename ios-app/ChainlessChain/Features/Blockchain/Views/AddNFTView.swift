//
//  AddNFTView.swift
//  ChainlessChain
//
//  添加NFT视图
//  支持手动添加ERC-721和ERC-1155 NFT
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 添加NFT视图
struct AddNFTView: View {
    let wallet: Wallet
    let onNFTAdded: () -> Void

    @Environment(\.dismiss) var dismiss
    @StateObject private var nftManager = NFTManager.shared

    @State private var contractAddress = ""
    @State private var tokenId = ""
    @State private var isValidating = false
    @State private var isAdding = false
    @State private var errorMessage: String?
    @State private var showError = false

    var isValidContractAddress: Bool {
        contractAddress.starts(with: "0x") && contractAddress.count == 42
    }

    var isValidTokenId: Bool {
        !tokenId.isEmpty && Int(tokenId) != nil
    }

    var canAdd: Bool {
        isValidContractAddress && isValidTokenId && !isAdding && !isValidating
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var body: some View {
        NavigationView {
            Form {
                // 合约地址输入
                Section(header: Text("NFT合约地址")) {
                    TextField("0x...", text: $contractAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))

                    if !contractAddress.isEmpty && !isValidContractAddress {
                        Label("请输入有效的合约地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Token ID输入
                Section(header: Text("Token ID")) {
                    TextField("例如: 1", text: $tokenId)
                        .keyboardType(.numberPad)
                        .font(.system(.body, design: .monospaced))

                    if !tokenId.isEmpty && !isValidTokenId {
                        Label("请输入有效的Token ID", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 说明
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "info.circle")
                                .foregroundColor(.blue)
                            Text("如何获取NFT信息？")
                                .font(.headline)
                        }

                        Text("1. 访问区块链浏览器（如 Etherscan）")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("2. 搜索您的钱包地址")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("3. 在「ERC-721 Token Txns」或「ERC-1155 Token Txns」中查找NFT")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("4. 复制合约地址和Token ID")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                // 添加按钮
                Section {
                    Button(action: {
                        Task {
                            await addNFT()
                        }
                    }) {
                        HStack {
                            Spacer()

                            if isAdding {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                Text("添加中...")
                            } else if isValidating {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                Text("验证中...")
                            } else {
                                Text("添加NFT")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canAdd)
                }
            }
            .navigationTitle("添加NFT")
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

    /// 添加NFT
    private func addNFT() async {
        isAdding = true
        defer { isAdding = false }

        do {
            _ = try await nftManager.addNFT(
                contractAddress: contractAddress,
                tokenId: tokenId,
                chain: chain,
                ownerAddress: wallet.address
            )

            onNFTAdded()
            dismiss()
        } catch NFTError.notOwner {
            errorMessage = "您不是该NFT的所有者，无法添加"
            showError = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - 预览

#if DEBUG
struct AddNFTView_Previews: PreviewProvider {
    static var previews: some View {
        AddNFTView(wallet: .preview) {}
    }
}
#endif
