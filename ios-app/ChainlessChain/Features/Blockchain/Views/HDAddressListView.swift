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
    @State private var showPasswordInput = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var pendingDeriveCount: Int = 5
    @State private var editingAddress: HDDerivedAddress?
    @State private var deleteAddress: HDDerivedAddress?

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
                        DerivedAddressRow(
                            address: address,
                            onCopy: {
                                // 复制地址
                                UIPasteboard.general.string = address.address
                            },
                            onEditLabel: {
                                editingAddress = address
                            },
                            onDelete: {
                                deleteAddress = address
                            }
                        )
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
                pendingDeriveCount = count
                showDeriveSheet = false
                showPasswordInput = true
            }
        }
        .sheet(isPresented: $showPasswordInput) {
            PasswordInputSheet(wallet: wallet) { password in
                await deriveBatchAddressesWithPassword(password: password, count: pendingDeriveCount)
            }
        }
        .sheet(item: $editingAddress) { address in
            EditLabelSheet(address: address) { newLabel in
                await updateLabel(for: address, newLabel: newLabel)
            }
        }
        .alert("错误", isPresented: $showError) {
            Button("确定", role: .cancel) {}
        } message: {
            if let error = errorMessage {
                Text(error)
            }
        }
        .alert("删除地址", isPresented: Binding(
            get: { deleteAddress != nil },
            set: { if !$0 { deleteAddress = nil } }
        )) {
            Button("取消", role: .cancel) {
                deleteAddress = nil
            }
            Button("删除", role: .destructive) {
                if let address = deleteAddress {
                    Task {
                        await deleteAddressConfirmed(address)
                    }
                }
            }
        } message: {
            if let address = deleteAddress {
                Text("确定要删除地址 \(address.displayAddress) 吗？此操作无法撤销。")
            }
        }
    }

    /// 使用密码批量派生地址
    private func deriveBatchAddressesWithPassword(password: String, count: Int) async {
        isLoading = true
        defer { isLoading = false }

        do {
            // 使用密码解密助记词
            let mnemonic = try await WalletManager.shared.exportMnemonic(
                walletId: wallet.id,
                password: password
            )

            // 批量派生地址
            let addresses = try await hdDerivation.deriveAddresses(
                for: wallet,
                mnemonic: mnemonic,
                count: count
            )

            Logger.shared.info("派生地址成功: \(addresses.count)个")

        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    /// 更新地址标签
    private func updateLabel(for address: HDDerivedAddress, newLabel: String) async {
        do {
            try await hdDerivation.updateAddressLabel(addressId: address.id, label: newLabel)
            Logger.shared.info("标签更新成功: \(newLabel)")
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    /// 删除地址（已确认）
    private func deleteAddressConfirmed(_ address: HDDerivedAddress) async {
        do {
            try await hdDerivation.deleteDerivedAddress(addressId: address.id)
            Logger.shared.info("地址删除成功")
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
    let onEditLabel: () -> Void
    let onDelete: () -> Void

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

            Button(action: onEditLabel) {
                Label("编辑标签", systemImage: "tag")
            }

            Divider()

            Button(role: .destructive, action: onDelete) {
                Label("删除地址", systemImage: "trash")
            }
        }
    }
}

/// 派生地址表单
struct DeriveAddressSheet: View {
    let wallet: Wallet
    let onDerive: (Int) -> Void

    @Environment(\.dismiss) var dismiss
    @State private var deriveCount = 5

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
                        onDerive(deriveCount)
                    }) {
                        Text("继续")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle("派生新地址")
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
}

/// 密码输入表单
struct PasswordInputSheet: View {
    let wallet: Wallet
    let onUnlock: (String) async -> Void

    @Environment(\.dismiss) var dismiss
    @State private var password = ""
    @State private var isProcessing = false
    @State private var showPassword = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("钱包验证")) {
                    Text("需要输入密码以解锁钱包并派生新地址")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section(header: Text("密码")) {
                    HStack {
                        if showPassword {
                            TextField("请输入钱包密码", text: $password)
                                .textContentType(.password)
                                .autocapitalization(.none)
                        } else {
                            SecureField("请输入钱包密码", text: $password)
                                .textContentType(.password)
                                .autocapitalization(.none)
                        }

                        Button(action: {
                            showPassword.toggle()
                        }) {
                            Image(systemName: showPassword ? "eye.slash" : "eye")
                                .foregroundColor(.gray)
                        }
                    }
                }

                Section {
                    Button(action: {
                        Task {
                            isProcessing = true
                            await onUnlock(password)
                            isProcessing = false
                            dismiss()
                        }
                    }) {
                        if isProcessing {
                            HStack {
                                ProgressView()
                                Text("正在解锁...")
                            }
                            .frame(maxWidth: .infinity)
                        } else {
                            Text("解锁并派生")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(password.isEmpty || isProcessing)
                }
            }
            .navigationTitle("输入密码")
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

/// 编辑标签表单
struct EditLabelSheet: View {
    let address: HDDerivedAddress
    let onSave: (String) async -> Void

    @Environment(\.dismiss) var dismiss
    @State private var label: String
    @State private var isProcessing = false

    init(address: HDDerivedAddress, onSave: @escaping (String) async -> Void) {
        self.address = address
        self.onSave = onSave
        _label = State(initialValue: address.label ?? "")
    }

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("地址")) {
                    Text(address.address)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(.secondary)
                }

                Section(header: Text("标签")) {
                    TextField("请输入标签（可选）", text: $label)
                        .autocapitalization(.none)

                    Text("标签可以帮助您识别不同的地址用途")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section {
                    Button(action: {
                        Task {
                            isProcessing = true
                            await onSave(label)
                            isProcessing = false
                            dismiss()
                        }
                    }) {
                        if isProcessing {
                            HStack {
                                ProgressView()
                                Text("正在保存...")
                            }
                            .frame(maxWidth: .infinity)
                        } else {
                            Text("保存")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isProcessing)
                }
            }
            .navigationTitle("编辑标签")
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
        .previewDisplayName("地址列表")

        DeriveAddressSheet(wallet: .preview) { _ in }
            .previewDisplayName("派生表单")

        PasswordInputSheet(wallet: .preview) { _ in }
            .previewDisplayName("密码输入")

        EditLabelSheet(address: .preview) { _ in }
            .previewDisplayName("编辑标签")
    }
}
#endif
