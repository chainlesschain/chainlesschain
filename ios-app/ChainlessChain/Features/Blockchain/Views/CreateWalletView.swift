import SwiftUI

/// 创建钱包视图
struct CreateWalletView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = WalletViewModel()

    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var selectedChain: SupportedChain = .ethereumSepolia  // 默认测试网
    @State private var agreedToTerms = false
    @State private var showMnemonicSheet = false
    @State private var createdMnemonic = ""

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("网络选择")) {
                    Picker("选择网络", selection: $selectedChain) {
                        // 主网
                        Section(header: Text("主网")) {
                            Text("Ethereum Mainnet").tag(SupportedChain.ethereumMainnet)
                            Text("Polygon Mainnet").tag(SupportedChain.polygonMainnet)
                            Text("BSC Mainnet").tag(SupportedChain.bscMainnet)
                            Text("Arbitrum One").tag(SupportedChain.arbitrumOne)
                            Text("Optimism").tag(SupportedChain.optimismMainnet)
                        }

                        // 测试网
                        Section(header: Text("测试网")) {
                            Text("Ethereum Sepolia").tag(SupportedChain.ethereumSepolia)
                            Text("Polygon Mumbai").tag(SupportedChain.polygonMumbai)
                            Text("BSC Testnet").tag(SupportedChain.bscTestnet)
                        }
                    }

                    HStack {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                        Text("建议先在测试网练习")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section(header: Text("设置密码")) {
                    SecureField("输入密码（至少8位）", text: $password)
                        .textContentType(.newPassword)

                    SecureField("确认密码", text: $confirmPassword)
                        .textContentType(.newPassword)

                    passwordStrengthView
                }

                Section(header: Text("服务条款")) {
                    Toggle("我已阅读并同意服务条款", isOn: $agreedToTerms)
                        .toggleStyle(SwitchToggleStyle(tint: .blue))

                    VStack(alignment: .leading, spacing: 8) {
                        warningItem("您需要妥善保管助记词")
                        warningItem("ChainlessChain 不会存储您的助记词")
                        warningItem("丢失助记词将无法恢复钱包")
                    }
                    .font(.caption)
                    .foregroundColor(.orange)
                }

                Section {
                    Button(action: createWallet) {
                        if viewModel.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("创建钱包")
                                .frame(maxWidth: .infinity)
                                .bold()
                        }
                    }
                    .disabled(!isFormValid || viewModel.isLoading)
                }
            }
            .navigationTitle("创建新钱包")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
            .sheet(isPresented: $showMnemonicSheet) {
                MnemonicBackupView(mnemonic: createdMnemonic) {
                    dismiss()
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

    private var passwordStrengthView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("密码强度:")
                .font(.caption)
                .foregroundColor(.secondary)

            ProgressView(value: passwordStrength, total: 1.0)
                .tint(passwordStrengthColor)

            Text(passwordStrengthText)
                .font(.caption)
                .foregroundColor(passwordStrengthColor)
        }
    }

    private func warningItem(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
            Text(text)
        }
    }

    // MARK: - 计算属性

    private var isFormValid: Bool {
        password.count >= 8 &&
        password == confirmPassword &&
        agreedToTerms
    }

    private var passwordStrength: Double {
        let length = Double(password.count)
        let hasNumber = password.rangeOfCharacter(from: .decimalDigits) != nil
        let hasLetter = password.rangeOfCharacter(from: .letters) != nil
        let hasSpecial = password.rangeOfCharacter(from: CharacterSet(charactersIn: "!@#$%^&*()_+-=[]{}|;:,.<>?")) != nil

        var strength = min(length / 16.0, 1.0) * 0.4
        if hasNumber { strength += 0.2 }
        if hasLetter { strength += 0.2 }
        if hasSpecial { strength += 0.2 }

        return strength
    }

    private var passwordStrengthColor: Color {
        if passwordStrength < 0.3 { return .red }
        if passwordStrength < 0.6 { return .orange }
        return .green
    }

    private var passwordStrengthText: String {
        if passwordStrength < 0.3 { return "弱" }
        if passwordStrength < 0.6 { return "中等" }
        return "强"
    }

    // MARK: - 操作

    private func createWallet() {
        Task {
            do {
                let mnemonic = try await viewModel.createWalletWithMnemonic(
                    password: password,
                    chainId: selectedChain.rawValue
                )

                createdMnemonic = mnemonic
                showMnemonicSheet = true
            } catch {
                // Error is already surfaced by viewModel state.
            }
        }
    }
}

/// 助记词备份视图
struct MnemonicBackupView: View {
    let mnemonic: String
    let onComplete: () -> Void

    @State private var confirmed = false
    @State private var copiedToClipboard = false

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // 警告信息
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 50))
                        .foregroundColor(.orange)

                    Text("请务必备份助记词")
                        .font(.title2)
                        .bold()

                    Text("助记词是恢复钱包的唯一方式，请妥善保管，不要泄露给任何人")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding(.top)

                // 助记词显示
                VStack(spacing: 12) {
                    Text("您的助记词")
                        .font(.headline)

                    mnemonicGridView
                        .padding()
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(12)
                        .padding(.horizontal)

                    Button(action: copyToClipboard) {
                        Label(
                            copiedToClipboard ? "已复制" : "复制到剪贴板",
                            systemImage: copiedToClipboard ? "checkmark" : "doc.on.doc"
                        )
                        .foregroundColor(.blue)
                    }
                }

                // 确认选项
                VStack(spacing: 16) {
                    Toggle("我已安全备份助记词", isOn: $confirmed)
                        .toggleStyle(SwitchToggleStyle(tint: .blue))
                        .padding(.horizontal)

                    Button(action: onComplete) {
                        Text("完成")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(confirmed ? Color.blue : Color.gray)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                            .padding(.horizontal)
                    }
                    .disabled(!confirmed)
                }

                Spacer()
            }
            .navigationTitle("备份助记词")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var mnemonicGridView: some View {
        let words = mnemonic.split(separator: " ").map(String.init)
        let columns = [
            GridItem(.flexible()),
            GridItem(.flexible()),
            GridItem(.flexible())
        ]

        return LazyVGrid(columns: columns, spacing: 12) {
            ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                HStack {
                    Text("\(index + 1).")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(word)
                        .font(.body)
                        .bold()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color.white)
                .cornerRadius(8)
            }
        }
    }

    private func copyToClipboard() {
        UIPasteboard.general.string = mnemonic
        copiedToClipboard = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copiedToClipboard = false
        }
    }
}

// MARK: - 预览

struct CreateWalletView_Previews: PreviewProvider {
    static var previews: some View {
        CreateWalletView()
    }
}
