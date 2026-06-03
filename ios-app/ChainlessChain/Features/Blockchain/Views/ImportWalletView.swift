import SwiftUI

/// 导入钱包视图
struct ImportWalletView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = WalletViewModel()

    @State private var importType: ImportType = .mnemonic
    @State private var mnemonicInput = ""
    @State private var privateKeyInput = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var selectedChain: SupportedChain = .ethereumSepolia

    enum ImportType {
        case mnemonic
        case privateKey
    }

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("导入方式")) {
                    Picker("选择导入方式", selection: $importType) {
                        Text("助记词").tag(ImportType.mnemonic)
                        Text("私钥").tag(ImportType.privateKey)
                    }
                    .pickerStyle(.segmented)
                }

                if importType == .mnemonic {
                    mnemonicSection
                } else {
                    privateKeySection
                }

                Section(header: Text("选择网络")) {
                    Picker("网络", selection: $selectedChain) {
                        Text("Ethereum Sepolia").tag(SupportedChain.ethereumSepolia)
                        Text("Polygon Mumbai").tag(SupportedChain.polygonMumbai)
                        Text("Ethereum Mainnet").tag(SupportedChain.ethereumMainnet)
                        Text("Polygon Mainnet").tag(SupportedChain.polygonMainnet)
                    }
                }

                passwordSection

                Section {
                    Button(action: importWallet) {
                        if viewModel.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("导入钱包")
                                .frame(maxWidth: .infinity)
                                .bold()
                        }
                    }
                    .disabled(!isFormValid || viewModel.isLoading)
                }
            }
            .navigationTitle("导入钱包")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
            .alert("错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }

    // MARK: - 子视图

    private var mnemonicSection: some View {
        Section(header: Text("助记词")) {
            TextEditor(text: $mnemonicInput)
                .frame(height: 100)
                .autocapitalization(.none)
                .disableAutocorrection(true)

            Text("请输入12或24个单词，用空格分隔")
                .font(.caption)
                .foregroundColor(.secondary)

            Button(action: pasteFromClipboard) {
                Label("从剪贴板粘贴", systemImage: "doc.on.clipboard")
            }
        }
    }

    private var privateKeySection: some View {
        Section(header: Text("私钥")) {
            SecureField("输入私钥（64位十六进制）", text: $privateKeyInput)
                .autocapitalization(.none)
                .disableAutocorrection(true)

            Text("以0x开头或不带0x前缀均可")
                .font(.caption)
                .foregroundColor(.secondary)

            Button(action: pasteFromClipboard) {
                Label("从剪贴板粘贴", systemImage: "doc.on.clipboard")
            }
        }
    }

    private var passwordSection: some View {
        Section(header: Text("设置密码")) {
            SecureField("输入密码（至少8位）", text: $password)
                .textContentType(.newPassword)

            SecureField("确认密码", text: $confirmPassword)
                .textContentType(.newPassword)

            HStack {
                Image(systemName: "info.circle")
                    .foregroundColor(.blue)
                Text("密码用于加密本地存储的钱包")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - 计算属性

    private var isFormValid: Bool {
        let passwordValid = password.count >= 8 && password == confirmPassword

        if importType == .mnemonic {
            let words = mnemonicInput.trimmingCharacters(in: .whitespacesAndNewlines)
                .split(separator: " ")
            return words.count == 12 || words.count == 24 && passwordValid
        } else {
            let cleanKey = privateKeyInput.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "0x", with: "")
            return cleanKey.count == 64 && passwordValid
        }
    }

    // MARK: - 操作

    private func pasteFromClipboard() {
        if let clipboard = UIPasteboard.general.string {
            if importType == .mnemonic {
                mnemonicInput = clipboard
            } else {
                privateKeyInput = clipboard
            }
        }
    }

    private func importWallet() {
        Task {
            if importType == .mnemonic {
                await viewModel.importFromMnemonic(
                    mnemonic: mnemonicInput.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password,
                    chainId: selectedChain.rawValue
                )
            } else {
                await viewModel.importFromPrivateKey(
                    privateKey: privateKeyInput.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password,
                    chainId: selectedChain.rawValue
                )
            }

            if !viewModel.showError {
                dismiss()
            }
        }
    }
}

// MARK: - 预览

struct ImportWalletView_Previews: PreviewProvider {
    static var previews: some View {
        ImportWalletView()
    }
}
