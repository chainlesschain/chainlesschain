//
//  NFTDetailView.swift
//  ChainlessChain
//
//  NFT详情视图
//  显示NFT完整信息和转移功能
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// NFT详情视图
struct NFTDetailView: View {
    let wallet: Wallet
    let nft: NFT

    @Environment(\.dismiss) var dismiss
    @State private var showTransfer = false
    @State private var showDeleteConfirm = false
    @State private var imageData: Data?
    @State private var isLoadingImage = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // NFT图片
                    NFTImageCard(nft: nft, imageData: $imageData, isLoadingImage: $isLoadingImage)

                    // 基本信息
                    VStack(alignment: .leading, spacing: 16) {
                        // 名称
                        Text(nft.displayName)
                            .font(.title)
                            .fontWeight(.bold)

                        // 集合
                        if let collection = nft.collectionName {
                            HStack {
                                Text(collection)
                                    .font(.headline)
                                    .foregroundColor(.blue)

                                if let symbol = nft.collectionSymbol {
                                    Text("(\(symbol))")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        // 描述
                        if let description = nft.description {
                            Text(description)
                                .font(.body)
                                .foregroundColor(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()

                    // NFT信息
                    VStack(spacing: 0) {
                        DetailRow(label: "Token ID", value: nft.tokenId)
                        Divider().padding(.leading)

                        DetailRow(label: "标准", value: nft.standard.displayName)
                        Divider().padding(.leading)

                        DetailRow(label: "网络", value: nft.chain?.name ?? "未知")
                        Divider().padding(.leading)

                        CopyableRow(
                            label: "合约地址",
                            value: nft.contractAddress,
                            displayValue: formatAddress(nft.contractAddress),
                            onCopy: {
                                UIPasteboard.general.string = nft.contractAddress
                            }
                        )

                        if nft.isERC1155 {
                            Divider().padding(.leading)
                            DetailRow(label: "数量", value: nft.balance)
                        }
                    }
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    // 属性
                    if !nft.attributes.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("属性")
                                .font(.headline)
                                .padding(.horizontal)

                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: 12) {
                                ForEach(nft.attributes) { attribute in
                                    AttributeCard(attribute: attribute)
                                }
                            }
                            .padding(.horizontal)
                        }
                    }

                    // 操作按钮
                    VStack(spacing: 12) {
                        Button(action: {
                            showTransfer = true
                        }) {
                            Label("转移NFT", systemImage: "arrow.right.circle.fill")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }

                        Button(role: .destructive, action: {
                            showDeleteConfirm = true
                        }) {
                            Label("删除NFT", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.red.opacity(0.1))
                                .foregroundColor(.red)
                                .cornerRadius(12)
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("NFT详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                Task {
                    await loadImage()
                }
            }
            .sheet(isPresented: $showTransfer) {
                if nft.isERC721 {
                    TransferNFTView(wallet: wallet, nft: nft)
                } else {
                    TransferNFT1155View(wallet: wallet, nft: nft)
                }
            }
            .alert("删除NFT", isPresented: $showDeleteConfirm) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    Task {
                        await deleteNFT()
                    }
                }
            } message: {
                Text("确定要删除 \(nft.displayName) 吗？删除后可重新添加。")
            }
        }
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        let start = address.prefix(6)
        let end = address.suffix(4)
        return "\(start)...\(end)"
    }

    private func loadImage() async {
        if let data = nft.imageData {
            imageData = data
            return
        }

        guard let imageUrl = nft.imageUrl else { return }

        isLoadingImage = true
        defer { isLoadingImage = false }

        do {
            imageData = try await NFTManager.shared.fetchImage(from: imageUrl)
        } catch {
            Logger.shared.error("加载NFT图片失败: \(error)")
        }
    }

    private func deleteNFT() async {
        do {
            try await NFTManager.shared.deleteNFT(nft)
            dismiss()
        } catch {
            Logger.shared.error("删除NFT失败: \(error)")
        }
    }
}

/// NFT图片卡片
struct NFTImageCard: View {
    let nft: NFT
    @Binding var imageData: Data?
    @Binding var isLoadingImage: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.gray.opacity(0.2))
                .aspectRatio(1, contentMode: .fit)

            if let data = imageData, let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            } else if isLoadingImage {
                ProgressView("加载图片...")
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "photo")
                        .font(.system(size: 60))
                        .foregroundColor(.gray)

                    Text("暂无图片")
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
            }

            // ERC-1155数量徽章
            if nft.isERC1155 && nft.balanceInt > 1 {
                VStack {
                    HStack {
                        Spacer()
                        Text("x\(nft.balance)")
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.blue)
                            .cornerRadius(12)
                            .padding()
                    }
                    Spacer()
                }
            }
        }
        .padding()
    }
}

/// 属性卡片
struct AttributeCard: View {
    let attribute: NFTAttribute

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(attribute.traitType)
                .font(.caption)
                .foregroundColor(.secondary)

            Text(attribute.value)
                .font(.body)
                .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(8)
    }
}

/// 转移NFT视图（ERC-721）
struct TransferNFTView: View {
    let wallet: Wallet
    let nft: NFT

    @Environment(\.dismiss) var dismiss
    @StateObject private var nftManager = NFTManager.shared
    @StateObject private var gasManager = GasManager.shared

    @State private var toAddress = ""
    @State private var selectedGasSpeed: GasSpeed = .standard
    @State private var gasPriceEstimate: GasPriceEstimate?

    @State private var isTransferring = false
    @State private var showPasswordInput = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var txHash: String?

    var isValidAddress: Bool {
        toAddress.starts(with: "0x") && toAddress.count == 42
    }

    var canProceed: Bool {
        isValidAddress && gasPriceEstimate != nil
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var body: some View {
        NavigationView {
            Form {
                // NFT信息
                Section(header: Text("NFT")) {
                    HStack {
                        Text(nft.displayName)
                            .font(.headline)

                        Spacer()

                        Text("#\(nft.tokenId)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // 接收地址
                Section(header: Text("接收方")) {
                    TextField("0x...", text: $toAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))

                    if !toAddress.isEmpty && !isValidAddress {
                        Label("请输入有效的地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Gas设置
                if let gasEstimate = gasPriceEstimate {
                    Section(header: Text("Gas费用")) {
                        GasSpeedSelector(
                            selectedSpeed: $selectedGasSpeed,
                            gasPriceEstimate: gasEstimate,
                            onChange: {}
                        )
                    }
                }

                // 转移按钮
                Section {
                    Button(action: {
                        showPasswordInput = true
                    }) {
                        HStack {
                            Spacer()

                            if isTransferring {
                                ProgressView()
                                Text("转移中...")
                            } else {
                                Text("确认转移")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canProceed || isTransferring)
                }
            }
            .navigationTitle("转移NFT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isTransferring)
                }
            }
            .onAppear {
                Task {
                    await estimateGasPrice()
                }
            }
            .sheet(isPresented: $showPasswordInput) {
                PasswordInputSheet(wallet: wallet) { password in
                    await transferNFT(password: password)
                }
            }
            .alert("转移成功", isPresented: $showSuccess) {
                Button("完成", role: .cancel) {
                    dismiss()
                }
            } message: {
                if let hash = txHash {
                    Text("交易已提交\n\(hash)")
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

    private func estimateGasPrice() async {
        do {
            gasPriceEstimate = try await gasManager.getGasPriceEstimate(chain: chain)
        } catch {
            Logger.shared.error("Gas估算失败: \(error)")
        }
    }

    private func transferNFT(password: String) async {
        isTransferring = true
        defer { isTransferring = false }

        do {
            _ = try await WalletManager.shared.unlockWallet(walletId: wallet.id, password: password)

            let record = try await nftManager.transferNFT(
                wallet: wallet,
                nft: nft,
                to: toAddress,
                gasPrice: gasPriceEstimate?.toWei(speed: selectedGasSpeed)
            )

            txHash = record.hash
            showSuccess = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

/// 转移NFT视图（ERC-1155）
struct TransferNFT1155View: View {
    let wallet: Wallet
    let nft: NFT

    @Environment(\.dismiss) var dismiss
    @StateObject private var nftManager = NFTManager.shared
    @StateObject private var gasManager = GasManager.shared

    @State private var toAddress = ""
    @State private var amount = ""
    @State private var selectedGasSpeed: GasSpeed = .standard
    @State private var gasPriceEstimate: GasPriceEstimate?

    @State private var isTransferring = false
    @State private var showPasswordInput = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var showSuccess = false
    @State private var txHash: String?

    var isValidAddress: Bool {
        toAddress.starts(with: "0x") && toAddress.count == 42
    }

    var isValidAmount: Bool {
        guard let amountInt = Int(amount) else { return false }
        return amountInt > 0 && amountInt <= nft.balanceInt
    }

    var canProceed: Bool {
        isValidAddress && isValidAmount && gasPriceEstimate != nil
    }

    var chain: SupportedChain {
        wallet.chain ?? .ethereumMainnet
    }

    var body: some View {
        NavigationView {
            Form {
                // NFT信息
                Section(header: Text("NFT")) {
                    HStack {
                        Text(nft.displayName)
                            .font(.headline)

                        Spacer()

                        Text("可用: \(nft.balance)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // 接收地址
                Section(header: Text("接收方")) {
                    TextField("0x...", text: $toAddress)
                        .textContentType(.none)
                        .autocapitalization(.none)
                        .font(.system(.body, design: .monospaced))

                    if !toAddress.isEmpty && !isValidAddress {
                        Label("请输入有效的地址", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // 数量
                Section(header: Text("数量")) {
                    HStack {
                        TextField("0", text: $amount)
                            .keyboardType(.numberPad)
                            .font(.title2)
                            .fontWeight(.medium)

                        Button("全部") {
                            amount = nft.balance
                        }
                        .font(.caption)
                    }

                    if !amount.isEmpty && !isValidAmount {
                        Label("数量无效或超出余额", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                // Gas设置
                if let gasEstimate = gasPriceEstimate {
                    Section(header: Text("Gas费用")) {
                        GasSpeedSelector(
                            selectedSpeed: $selectedGasSpeed,
                            gasPriceEstimate: gasEstimate,
                            onChange: {}
                        )
                    }
                }

                // 转移按钮
                Section {
                    Button(action: {
                        showPasswordInput = true
                    }) {
                        HStack {
                            Spacer()

                            if isTransferring {
                                ProgressView()
                                Text("转移中...")
                            } else {
                                Text("确认转移")
                                    .fontWeight(.semibold)
                            }

                            Spacer()
                        }
                    }
                    .disabled(!canProceed || isTransferring)
                }
            }
            .navigationTitle("转移NFT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isTransferring)
                }
            }
            .onAppear {
                Task {
                    await estimateGasPrice()
                }
            }
            .sheet(isPresented: $showPasswordInput) {
                PasswordInputSheet(wallet: wallet) { password in
                    await transferNFT(password: password)
                }
            }
            .alert("转移成功", isPresented: $showSuccess) {
                Button("完成", role: .cancel) {
                    dismiss()
                }
            } message: {
                if let hash = txHash {
                    Text("交易已提交\n\(hash)")
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

    private func estimateGasPrice() async {
        do {
            gasPriceEstimate = try await gasManager.getGasPriceEstimate(chain: chain)
        } catch {
            Logger.shared.error("Gas估算失败: \(error)")
        }
    }

    private func transferNFT(password: String) async {
        isTransferring = true
        defer { isTransferring = false }

        do {
            _ = try await WalletManager.shared.unlockWallet(walletId: wallet.id, password: password)

            let record = try await nftManager.transferNFT1155(
                wallet: wallet,
                nft: nft,
                to: toAddress,
                amount: amount,
                gasPrice: gasPriceEstimate?.toWei(speed: selectedGasSpeed)
            )

            txHash = record.hash
            showSuccess = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - 预览

#if DEBUG
struct NFTDetailView_Previews: PreviewProvider {
    static var previews: some View {
        NFTDetailView(wallet: .preview, nft: .preview)

        TransferNFTView(wallet: .preview, nft: .preview)
            .previewDisplayName("转移ERC-721")

        TransferNFT1155View(wallet: .preview, nft: .previewERC1155)
            .previewDisplayName("转移ERC-1155")
    }
}
#endif
