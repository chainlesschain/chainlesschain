//
//  HDAddressListView.swift
//  ChainlessChain
//
//  HD派生地址列表视图
//  显示和管理HD钱包派生的所有地址
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// HD地址列表视图
struct HDAddressListView: View {
    let wallet: Wallet

    @StateObject private var hdDerivation = HDWalletDerivation.shared
    @State private var showDeriveSheet = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showError = false

    var derivedAddresses: [HDDerivedAddress] {
        hdDerivation.getDerivedAddresses(for: wallet.id)
    }

    var body: some View {
        List {
            // 主地址
            Section(header: Text("主地址")) {
                MainAddressRow(wallet: wallet)
            }

            // 派生地址
            if !derivedAddresses.isEmpty {
                Section(header: HStack {
                    Text("派生地址")
                    Spacer()
                    Text("\(derivedAddresses.count)个")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }) {
                    ForEach(derivedAddresses) { address in
                        DerivedAddressRow(address: address) {
                            // 复制地址
                            UIPasteboard.general.string = address.address
                        }
                    }
                }
            }

            // 操作按钮
            Section {
                Button(action: {
                    showDeriveSheet = true
                }) {
                    Label("派生新地址", systemImage: "plus.circle.fill")
                }
                .disabled(isLoading)
            }
        }
        .navigationTitle("地址管理")
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading {
                ProgressView("正在派生地址...")
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(10)
                    .shadow(radius: 10)
            }
        }
        .sheet(isPresented: $showDeriveSheet) {
            DeriveAddressSheet(wallet: wallet) { count in
                await deriveBatchAddresses(count: count)
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

    /// 批量派生地址
    private func deriveBatchAddresses(count: Int) async {
        isLoading = true
        defer { isLoading = false }

        do {
            // 需要助记词才能派生
            // 这里应该提示用户输入密码解锁钱包获取助记词
            // 简化实现：假设助记词已保存在安全位置
            errorMessage = "需要输入密码解锁钱包以派生新地址"
            showError = true

            // TODO: 实现密码输入和助记词解密流程
            // let mnemonic = try await unlockAndGetMnemonic()
            // let addresses = try await hdDerivation.deriveAddresses(
            //     for: wallet,
            //     mnemonic: mnemonic,
            //     count: count
            // )
            // Logger.shared.info("派生地址成功: \(addresses.count)个")

        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

/// 主地址行
struct MainAddressRow: View {
    let wallet: Wallet

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("钱包地址")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Text(wallet.derivationPath)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(4)
            }

            HStack {
                Text(wallet.address)
                    .font(.system(.body, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                Button(action: {
                    UIPasteboard.general.string = wallet.address
                }) {
                    Image(systemName: "doc.on.doc")
                        .foregroundColor(.blue)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// 派生地址行
struct DerivedAddressRow: View {
    let address: HDDerivedAddress
    let onCopy: () -> Void

    @State private var showEditLabel = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                // 索引
                Text("#\(address.index)")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.blue)
                    .frame(width: 30, alignment: .leading)

                // 标签
                if let label = address.label {
                    Text(label)
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    Text("未命名")
                        .font(.caption)
                        .foregroundColor(.gray)
                }

                Spacer()

                // 派生路径
                Text(address.displayPath)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(4)
            }

            HStack {
                Text(address.address)
                    .font(.system(.callout, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                Button(action: onCopy) {
                    Image(systemName: "doc.on.doc")
                        .foregroundColor(.blue)
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button(action: onCopy) {
                Label("复制地址", systemImage: "doc.on.doc")
            }

            Button(action: { showEditLabel = true }) {
                Label("编辑标签", systemImage: "tag")
            }

            Divider()

            Button(role: .destructive, action: {}) {
                Label("删除地址", systemImage: "trash")
            }
        }
    }
}

/// 派生地址表单
struct DeriveAddressSheet: View {
    let wallet: Wallet
    let onDerive: (Int) async -> Void

    @Environment(\.dismiss) var dismiss
    @State private var deriveCount = 5
    @State private var isProcessing = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("派生设置")) {
                    Stepper("派生数量: \(deriveCount)", value: $deriveCount, in: 1...20)

                    Text("将派生 \(deriveCount) 个新地址")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section(header: Text("派生路径")) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("基础路径: m/44'/60'/0'/0")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        let nextIndex = HDWalletDerivation.shared.getNextAddressIndex(for: wallet.id)
                        Text("起始索引: \(nextIndex)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("结束索引: \(nextIndex + deriveCount - 1)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section {
                    Button(action: {
                        Task {
                            isProcessing = true
                            await onDerive(deriveCount)
                            isProcessing = false
                            dismiss()
                        }
                    }) {
                        if isProcessing {
                            HStack {
                                ProgressView()
                                Text("正在派生...")
                            }
                        } else {
                            Text("开始派生")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isProcessing)
                }
            }
            .navigationTitle("派生新地址")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isProcessing)
                }
            }
        }
    }
}

// MARK: - 预览

#if DEBUG
struct HDAddressListView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            HDAddressListView(wallet: .preview)
        }

        DeriveAddressSheet(wallet: .preview) { _ in }
            .previewDisplayName("派生表单")
    }
}
#endif
