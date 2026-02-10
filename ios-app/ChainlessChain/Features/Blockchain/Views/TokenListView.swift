//
//  TokenListView.swift
//  ChainlessChain
//
//  代币列表视图
//  显示钱包的所有ERC-20代币及余额
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 代币列表视图
struct TokenListView: View {
    let wallet: Wallet

    @StateObject private var tokenManager = TokenManager.shared
    @State private var tokensWithBalance: [TokenWithBalance] = []
    @State private var isLoading = false
    @State private var showAddToken = false
    @State private var selectedToken: TokenWithBalance?
    @State private var errorMessage: String?
    @State private var showError = false

    var hasTokens: Bool {
        !tokensWithBalance.isEmpty
    }

    var body: some View {
        List {
            // 代币列表
            if hasTokens {
                Section(header: HStack {
                    Text("代币")
                    Spacer()
                    if isLoading {
                        ProgressView()
                            .scaleEffect(0.8)
                    }
                }) {
                    ForEach(tokensWithBalance) { tokenWithBalance in
                        TokenRow(tokenWithBalance: tokenWithBalance)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedToken = tokenWithBalance
                            }
                    }
                }
            } else if !isLoading {
                Section {
                    EmptyTokensView()
                }
            }

            // 添加代币按钮
            Section {
                Button(action: {
                    showAddToken = true
                }) {
                    Label("添加代币", systemImage: "plus.circle.fill")
                }
            }
        }
        .navigationTitle("代币")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: {
                    Task {
                        await refreshBalances()
                    }
                }) {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading)
            }
        }
        .refreshable {
            await refreshBalances()
        }
        .onAppear {
            Task {
                await loadTokens()
            }
        }
        .sheet(isPresented: $showAddToken) {
            AddTokenView(wallet: wallet) {
                Task {
                    await loadTokens()
                }
            }
        }
        .sheet(item: $selectedToken) { tokenWithBalance in
            TokenDetailView(wallet: wallet, tokenWithBalance: tokenWithBalance)
        }
        .alert("错误", isPresented: $showError) {
            Button("确定", role: .cancel) {}
        } message: {
            if let error = errorMessage {
                Text(error)
            }
        }
    }

    /// 加载代币列表
    private func loadTokens() async {
        isLoading = true
        defer { isLoading = false }

        do {
            tokensWithBalance = try await tokenManager.getWalletBalances(wallet: wallet)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    /// 刷新余额
    private func refreshBalances() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let tokens = tokenManager.getTokens(for: wallet.chain)
            try await tokenManager.refreshBalances(wallet: wallet, tokens: tokens)
            await loadTokens()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

/// 代币行视图
struct TokenRow: View {
    let tokenWithBalance: TokenWithBalance

    var token: Token {
        tokenWithBalance.token
    }

    var balance: String {
        tokenWithBalance.displayBalance
    }

    var balanceUSD: String? {
        tokenWithBalance.displayBalanceUSD
    }

    var body: some View {
        HStack(spacing: 12) {
            // 代币图标
            TokenIcon(token: token)

            // 代币信息
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(token.symbol)
                        .font(.headline)

                    if token.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }

                Text(token.name)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 余额
            VStack(alignment: .trailing, spacing: 4) {
                Text(balance)
                    .font(.body)
                    .fontWeight(.medium)

                if let usd = balanceUSD {
                    Text(usd)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// 代币图标
struct TokenIcon: View {
    let token: Token

    var backgroundColor: Color {
        // 根据symbol首字母生成颜色
        let colors: [Color] = [.blue, .green, .orange, .purple, .red, .pink, .cyan]
        let index = token.symbol.first?.asciiValue ?? 0
        return colors[Int(index) % colors.count]
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(backgroundColor.opacity(0.2))
                .frame(width: 40, height: 40)

            if let logoUrl = token.logoUrl, let url = URL(string: logoUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .scaleEffect(0.7)
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        Text(String(token.symbol.prefix(1)))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(backgroundColor)
                    @unknown default:
                        Text(String(token.symbol.prefix(1)))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(backgroundColor)
                    }
                }
                .frame(width: 28, height: 28)
                .clipShape(Circle())
            } else {
                Text(String(token.symbol.prefix(1)))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(backgroundColor)
            }
        }
    }
}

/// 空代币视图
struct EmptyTokensView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "dollarsign.circle")
                .font(.system(size: 60))
                .foregroundColor(.gray)

            Text("暂无代币")
                .font(.headline)
                .foregroundColor(.secondary)

            Text("点击"添加代币"开始添加ERC-20代币")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

// MARK: - 预览

#if DEBUG
struct TokenListView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            TokenListView(wallet: .preview)
        }

        TokenRow(tokenWithBalance: .preview)
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("代币行")

        EmptyTokensView()
            .previewLayout(.sizeThatFits)
            .padding()
            .previewDisplayName("空状态")
    }
}
#endif
