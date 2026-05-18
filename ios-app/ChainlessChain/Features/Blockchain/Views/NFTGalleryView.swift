//
//  NFTGalleryView.swift
//  ChainlessChain
//
//  NFT画廊视图
//  网格展示钱包的所有NFT
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// NFT画廊视图
struct NFTGalleryView: View {
    let wallet: Wallet

    @StateObject private var nftManager = NFTManager.shared
    @State private var nfts: [NFT] = []
    @State private var isLoading = false
    @State private var showAddNFT = false
    @State private var selectedNFT: NFT?
    @State private var errorMessage: String?
    @State private var showError = false

    // 网格布局
    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var hasNFTs: Bool {
        !nfts.isEmpty
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    if hasNFTs {
                        // NFT网格
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(nfts) { nft in
                                NFTGridItem(nft: nft)
                                    .onTapGesture {
                                        selectedNFT = nft
                                    }
                            }
                        }
                        .padding()
                    } else if !isLoading {
                        // 空状态
                        EmptyNFTView()
                    }

                    if isLoading {
                        ProgressView("加载中...")
                            .padding()
                    }
                }
            }
            .navigationTitle("我的NFT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            showAddNFT = true
                        }) {
                            Label("添加NFT", systemImage: "plus")
                        }

                        Button(action: {
                            Task {
                                await refreshNFTs()
                            }
                        }) {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .refreshable {
                await refreshNFTs()
            }
            .onAppear {
                Task {
                    await loadNFTs()
                }
            }
            .sheet(isPresented: $showAddNFT) {
                AddNFTView(wallet: wallet) {
                    Task {
                        await loadNFTs()
                    }
                }
            }
            .sheet(item: $selectedNFT) { nft in
                NFTDetailView(wallet: wallet, nft: nft)
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

    /// 加载NFT列表
    private func loadNFTs() async {
        isLoading = true
        defer { isLoading = false }

        do {
            nfts = try await nftManager.getWalletNFTs(wallet: wallet)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    /// 刷新NFT
    private func refreshNFTs() async {
        isLoading = true
        defer { isLoading = false }

        do {
            nfts = try await nftManager.getWalletNFTs(wallet: wallet, refresh: true)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

/// NFT网格项
struct NFTGridItem: View {
    let nft: NFT

    @State private var imageData: Data?
    @State private var isLoadingImage = false

    var body: some View {
        VStack(spacing: 8) {
            // NFT图片
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.gray.opacity(0.2))
                    .aspectRatio(1, contentMode: .fit)

                if let data = imageData, let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else if isLoadingImage {
                    ProgressView()
                } else {
                    VStack {
                        Image(systemName: "photo")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)

                        Text(nft.displayName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .padding(.horizontal, 8)
                    }
                }

                // ERC-1155徽章
                if nft.isERC1155 {
                    VStack {
                        HStack {
                            Spacer()
                            Text("x\(nft.balance)")
                                .font(.caption2)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue)
                                .cornerRadius(8)
                                .padding(8)
                        }
                        Spacer()
                    }
                }
            }

            // NFT信息
            VStack(alignment: .leading, spacing: 4) {
                Text(nft.displayName)
                    .font(.headline)
                    .lineLimit(1)

                if let collection = nft.collectionName {
                    Text(collection)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                HStack {
                    Text(nft.standard.displayName)
                        .font(.caption2)
                        .foregroundColor(.blue)

                    Spacer()

                    Text("#\(nft.tokenId)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            Task {
                await loadImage()
            }
        }
    }

    /// 加载图片
    private func loadImage() async {
        // 优先使用缓存的图片数据
        if let data = nft.imageData {
            imageData = data
            return
        }

        // 从URL加载
        guard let imageUrl = nft.imageUrl else { return }

        isLoadingImage = true
        defer { isLoadingImage = false }

        do {
            imageData = try await NFTManager.shared.fetchImage(from: imageUrl)
        } catch {
            Logger.shared.error("加载NFT图片失败: \(error)")
        }
    }
}

/// 空NFT视图
struct EmptyNFTView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无NFT")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("点击右上角菜单添加您的NFT")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
    }
}

// MARK: - 预览

#if DEBUG
struct NFTGalleryView_Previews: PreviewProvider {
    static var previews: some View {
        NFTGalleryView(wallet: .preview)

        NFTGridItem(nft: .preview)
            .frame(width: 180)
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("NFT网格项")

        EmptyNFTView()
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("空状态")
    }
}
#endif
