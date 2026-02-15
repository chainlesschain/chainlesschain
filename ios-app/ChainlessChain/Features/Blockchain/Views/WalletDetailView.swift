import SwiftUI

/// 钱包详情视图
struct WalletDetailView: View {
    let wallet: Wallet

    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = WalletViewModel()

    @State private var showQRCode = false
    @State private var showDeleteAlert = false
    @State private var copiedAddress = false

    var body: some View {
        NavigationView {
            List {
                // 钱包信息
                walletInfoSection

                // 余额
                balanceSection

                // 操作
                actionsSection

                // 网络信息
                networkSection

                // 危险操作
                dangerSection
            }
            .navigationTitle("钱包详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .sheet(isPresented: $showQRCode) {
                AddressQRCodeView(address: wallet.address)
            }
            .alert("删除钱包", isPresented: $showDeleteAlert) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    Task {
                        await viewModel.deleteWallet(wallet)
                        dismiss()
                    }
                }
            } message: {
                Text("确定要删除此钱包吗？此操作无法撤销，请确保您已备份助记词。")
            }
        }
    }

    // MARK: - 子视图

    private var walletInfoSection: some View {
        Section(header: Text("钱包信息")) {
            VStack(alignment: .center, spacing: 16) {
                // 钱包图标
                ZStack {
                    Circle()
                        .fill(wallet.isDefault ? Color.orange.opacity(0.2) : Color.blue.opacity(0.2))
                        .frame(width: 80, height: 80)

                    Image(systemName: wallet.isDefault ? "star.fill" : "wallet.pass.fill")
                        .font(.system(size: 40))
                        .foregroundColor(wallet.isDefault ? .orange : .blue)
                }

                // 地址
                VStack(spacing: 8) {
                    Text("钱包地址")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(wallet.address)
                        .font(.system(.body, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)

                    HStack(spacing: 16) {
                        Button(action: copyAddress) {
                            Label(
                                copiedAddress ? "已复制" : "复制",
                                systemImage: copiedAddress ? "checkmark" : "doc.on.doc"
                            )
                            .font(.caption)
                        }

                        Button(action: { showQRCode = true }) {
                            Label("二维码", systemImage: "qrcode")
                                .font(.caption)
                        }
                    }
                }

                // 标签
                if wallet.isDefault {
                    Text("默认钱包")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(Color.orange.opacity(0.2))
                        .foregroundColor(.orange)
                        .cornerRadius(8)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    private var balanceSection: some View {
        Section(header: Text("余额")) {
            if let balance = viewModel.getBalance(for: wallet.id) {
                VStack(spacing: 12) {
                    HStack {
                        Text(balance.symbol)
                            .font(.headline)
                        Spacer()
                        Text(balance.displayBalance)
                            .font(.system(.title2, design: .monospaced))
                            .bold()
                    }

                    // TODO: 添加法币估值
                    // HStack {
                    //     Text("≈ $0.00 USD")
                    //         .font(.subheadline)
                    //         .foregroundColor(.secondary)
                    //     Spacer()
                    // }
                }
            } else {
                HStack {
                    ProgressView()
                    Text("加载中...")
                        .foregroundColor(.secondary)
                }
            }

            Button(action: refreshBalance) {
                Label("刷新余额", systemImage: "arrow.clockwise")
            }
        }
    }

    private var actionsSection: some View {
        Section(header: Text("操作")) {
            Button(action: {}) {
                Label("发送", systemImage: "arrow.up.right")
            }

            Button(action: {}) {
                Label("接收", systemImage: "arrow.down.left")
            }

            Button(action: {}) {
                Label("交易历史", systemImage: "clock.arrow.circlepath")
            }

            if !wallet.isDefault {
                Button(action: setAsDefault) {
                    Label("设为默认钱包", systemImage: "star")
                }
            }
        }
    }

    private var networkSection: some View {
        Section(header: Text("网络信息")) {
            if let config = wallet.networkConfig {
                LabeledContent("网络名称", value: config.name)
                LabeledContent("链ID", value: "\(config.chainId)")
                LabeledContent("原生币", value: config.symbol)
                LabeledContent("类型", value: wallet.chain?.isTestnet == true ? "测试网" : "主网")

                if let explorerUrl = config.blockExplorerUrls.first {
                    Button(action: {
                        if let url = URL(string: explorerUrl) {
                            UIApplication.shared.open(url)
                        }
                    }) {
                        Label("在区块链浏览器中查看", systemImage: "safari")
                    }
                }
            }
        }
    }

    private var dangerSection: some View {
        Section(header: Text("危险操作")) {
            Button(role: .destructive, action: { showDeleteAlert = true }) {
                Label("删除钱包", systemImage: "trash")
            }
        }
    }

    // MARK: - 操作

    private func copyAddress() {
        UIPasteboard.general.string = wallet.address
        copiedAddress = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copiedAddress = false
        }
    }

    private func refreshBalance() {
        Task {
            await viewModel.loadBalance(for: wallet)
        }
    }

    private func setAsDefault() {
        Task {
            await viewModel.setDefaultWallet(wallet)
        }
    }
}

/// 地址二维码视图
struct AddressQRCodeView: View {
    let address: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Text("扫描接收")
                    .font(.title2)
                    .bold()

                // QR码显示
                if let qrImage = generateQRCode(from: address) {
                    Image(uiImage: qrImage)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 250, height: 250)
                        .cornerRadius(12)
                } else {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.2))
                        .frame(width: 250, height: 250)
                        .overlay(
                            Text("生成QR码失败")
                                .foregroundColor(.secondary)
                        )
                        .cornerRadius(12)
                }

                Text(address)
                    .font(.system(.caption, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Button(action: {
                    UIPasteboard.general.string = address
                }) {
                    Label("复制地址", systemImage: "doc.on.doc")
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                        .padding(.horizontal)
                }
            }
            .padding()
            .navigationTitle("接收地址")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }

    /// 生成QR码图片
    /// - Parameter string: 要编码的字符串（通常是钱包地址）
    /// - Returns: QR码 UIImage，如果生成失败则返回 nil
    private func generateQRCode(from string: String) -> UIImage? {
        // 创建 QR 码生成器滤镜
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
            return nil
        }

        // 将字符串转换为 Data
        let data = Data(string.utf8)
        filter.setValue(data, forKey: "inputMessage")

        // 设置纠错级别（H = 最高，约 30% 的码字可以被修复）
        filter.setValue("H", forKey: "inputCorrectionLevel")

        // 获取生成的 CIImage
        guard let ciImage = filter.outputImage else {
            return nil
        }

        // QR码默认生成的尺寸很小，需要放大
        let transform = CGAffineTransform(scaleX: 10, y: 10)
        let scaledCIImage = ciImage.transformed(by: transform)

        // 将 CIImage 转换为 UIImage
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledCIImage, from: scaledCIImage.extent) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }
}

// MARK: - 预览

struct WalletDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let wallet = Wallet(
            id: UUID().uuidString,
            address: "0x1234567890123456789012345678901234567890",
            walletType: .internal,
            provider: .builtin,
            derivationPath: "m/44'/60'/0'/0/0",
            chainId: 1,
            isDefault: true,
            createdAt: Date()
        )

        WalletDetailView(wallet: wallet)
    }
}
