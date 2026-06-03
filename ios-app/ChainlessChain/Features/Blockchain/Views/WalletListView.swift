import SwiftUI

/// 钱包列表视图
struct WalletListView: View {
    @StateObject private var viewModel = WalletViewModel()
    @State private var showCreateWallet = false
    @State private var showImportSheet = false
    @State private var selectedWallet: Wallet?

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.wallets.isEmpty {
                    emptyStateView
                } else {
                    walletListContent
                }

                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black.opacity(0.2))
                }
            }
            .navigationTitle("我的钱包")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showCreateWallet = true }) {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { Task { await viewModel.refreshBalances() } }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $showCreateWallet) {
                CreateWalletView()
            }
            .sheet(item: $selectedWallet) { wallet in
                WalletDetailView(wallet: wallet)
            }
            .alert("错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {
                    viewModel.clearError()
                }
            } message: {
                Text(viewModel.errorMessage ?? "未知错误")
            }
        }
    }

    // MARK: - 子视图

    private var walletListContent: some View {
        List {
            Section(header: Text("钱包列表")) {
                ForEach(viewModel.wallets) { wallet in
                    WalletRowView(
                        wallet: wallet,
                        balance: viewModel.getBalance(for: wallet.id)
                    )
                    .onTapGesture {
                        selectedWallet = wallet
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            Task {
                                await viewModel.deleteWallet(wallet)
                            }
                        } label: {
                            Label("删除", systemImage: "trash")
                        }

                        if !wallet.isDefault {
                            Button {
                                Task {
                                    await viewModel.setDefaultWallet(wallet)
                                }
                            } label: {
                                Label("设为默认", systemImage: "star")
                            }
                            .tint(.orange)
                        }
                    }
                }
            }

            Section(header: Text("网络信息")) {
                if let current = viewModel.currentWallet,
                   let config = current.networkConfig {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("当前网络:")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(config.name)
                                .bold()
                        }

                        HStack {
                            Text("链ID:")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text("\(config.chainId)")
                        }

                        HStack {
                            Text("原生币:")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(config.symbol)
                        }
                    }
                    .font(.subheadline)
                }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "wallet.pass")
                .font(.system(size: 80))
                .foregroundColor(.gray)

            Text("还没有钱包")
                .font(.title2)
                .bold()

            Text("创建或导入钱包开始使用")
                .foregroundColor(.secondary)

            VStack(spacing: 12) {
                Button(action: { showCreateWallet = true }) {
                    Label("创建新钱包", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }

                Button(action: { showImportSheet = true }) {
                    Label("导入钱包", systemImage: "arrow.down.circle")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
            }
            .padding(.horizontal, 40)
        }
        .sheet(isPresented: $showImportSheet) {
            ImportWalletView()
        }
    }
}

/// 钱包行视图
struct WalletRowView: View {
    let wallet: Wallet
    let balance: WalletBalance?

    var body: some View {
        HStack(spacing: 12) {
            // 钱包图标
            ZStack {
                Circle()
                    .fill(wallet.isDefault ? Color.orange.opacity(0.2) : Color.blue.opacity(0.2))
                    .frame(width: 44, height: 44)

                Image(systemName: wallet.isDefault ? "star.fill" : "wallet.pass.fill")
                    .foregroundColor(wallet.isDefault ? .orange : .blue)
            }

            // 钱包信息
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(wallet.formattedAddress)
                        .font(.headline)

                    if wallet.isDefault {
                        Text("默认")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.2))
                            .foregroundColor(.orange)
                            .cornerRadius(4)
                    }
                }

                HStack {
                    Image(systemName: "link.circle.fill")
                        .font(.caption)
                    Text(wallet.chain?.name ?? "未知网络")
                        .font(.caption)
                }
                .foregroundColor(.secondary)
            }

            Spacer()

            // 余额
            VStack(alignment: .trailing, spacing: 4) {
                if let balance = balance {
                    Text(balance.displayBalance)
                        .font(.headline)
                    Text(balance.symbol)
                        .font(.caption)
                        .foregroundColor(.secondary)
                } else {
                    ProgressView()
                }
            }
        }
        .padding(.vertical, 8)
    }
}

// MARK: - 预览

struct WalletListView_Previews: PreviewProvider {
    static var previews: some View {
        WalletListView()
    }
}
