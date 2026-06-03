//
//  ChainSelectorView.swift
//  ChainlessChain
//
//  多链选择器视图
//  支持切换不同的区块链网络
//
//  Created by ChainlessChain on 2026-01-26.
//

import SwiftUI

/// 多链选择器视图
struct ChainSelectorView: View {
    @EnvironmentObject var walletViewModel: WalletViewModel
    @Environment(\.dismiss) var dismiss

    @State private var selectedChain: SupportedChain
    @State private var searchText = ""

    init(currentChain: SupportedChain = .ethereumMainnet) {
        _selectedChain = State(initialValue: currentChain)
    }

    var filteredChains: [SupportedChain] {
        if searchText.isEmpty {
            return SupportedChain.allCases
        }
        return SupportedChain.allCases.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
        }
    }

    /// 按类别分组
    var chainsByCategory: [String: [SupportedChain]] {
        Dictionary(grouping: filteredChains) { chain in
            if chain.isTestnet {
                return "测试网"
            } else {
                return "主网"
            }
        }
    }

    var body: some View {
        NavigationView {
            List {
                // 搜索栏
                Section {
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(.gray)
                        TextField("搜索链...", text: $searchText)
                    }
                }

                // 主网分组
                if let mainnets = chainsByCategory["主网"], !mainnets.isEmpty {
                    Section(header: Text("主网")) {
                        ForEach(mainnets, id: \.rawValue) { chain in
                            ChainRow(
                                chain: chain,
                                isSelected: chain == selectedChain
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedChain = chain
                            }
                        }
                    }
                }

                // 测试网分组
                if let testnets = chainsByCategory["测试网"], !testnets.isEmpty {
                    Section(header: Text("测试网")) {
                        ForEach(testnets, id: \.rawValue) { chain in
                            ChainRow(
                                chain: chain,
                                isSelected: chain == selectedChain
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedChain = chain
                            }
                        }
                    }
                }
            }
            .navigationTitle("选择网络")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("确定") {
                        switchChain()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private func switchChain() {
        Task {
            if let wallet = walletViewModel.currentWallet {
                await walletViewModel.switchChain(for: wallet, to: selectedChain)
            }
            dismiss()
        }
    }
}

/// 链行视图
struct ChainRow: View {
    let chain: SupportedChain
    let isSelected: Bool

    var body: View {
        HStack(spacing: 12) {
            // 链图标
            ChainIcon(chain: chain)

            // 链信息
            VStack(alignment: .leading, spacing: 4) {
                Text(chain.name)
                    .font(.body)
                    .fontWeight(isSelected ? .semibold : .regular)

                HStack(spacing: 8) {
                    Text(chain.symbol)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if chain.isTestnet {
                        Text("测试网")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.2))
                            .foregroundColor(.orange)
                            .cornerRadius(4)
                    }
                }
            }

            Spacer()

            // 选中指示器
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.blue)
                    .font(.title3)
            }
        }
        .padding(.vertical, 4)
    }
}

/// 链图标
struct ChainIcon: View {
    let chain: SupportedChain

    var iconColor: Color {
        switch chain {
        case .ethereumMainnet, .ethereumSepolia:
            return .blue
        case .polygonMainnet, .polygonMumbai:
            return .purple
        case .bscMainnet, .bscTestnet:
            return .yellow
        case .arbitrumOne, .arbitrumSepolia:
            return .cyan
        case .optimismMainnet, .optimismSepolia:
            return .red
        case .avalancheCChain, .avalancheFuji:
            return .red
        case .baseMainnet, .baseSepolia:
            return .blue
        case .hardhatLocal:
            return .gray
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(iconColor.opacity(0.2))
                .frame(width: 40, height: 40)

            Text(String(chain.symbol.prefix(1)))
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(iconColor)
        }
    }
}

/// 紧凑的链切换器（用于工具栏）
struct CompactChainSwitcher: View {
    @EnvironmentObject var walletViewModel: WalletViewModel
    @State private var showChainSelector = false

    var currentChain: SupportedChain {
        walletViewModel.currentChain
    }

    var body: some View {
        Button(action: {
            showChainSelector = true
        }) {
            HStack(spacing: 6) {
                ChainIcon(chain: currentChain)
                    .scaleEffect(0.6)

                Text(currentChain.symbol)
                    .font(.caption)
                    .fontWeight(.medium)

                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.gray.opacity(0.1))
            .cornerRadius(8)
        }
        .sheet(isPresented: $showChainSelector) {
            ChainSelectorView(currentChain: currentChain)
                .environmentObject(walletViewModel)
        }
    }
}

// MARK: - 预览

#if DEBUG
struct ChainSelectorView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ChainSelectorView(currentChain: .ethereumMainnet)
                .environmentObject(WalletViewModel())

            NavigationView {
                List {
                    ForEach(SupportedChain.allCases, id: \.rawValue) { chain in
                        ChainRow(chain: chain, isSelected: chain == .ethereumMainnet)
                    }
                }
            }
            .previewDisplayName("链列表")

            CompactChainSwitcher()
                .environmentObject(WalletViewModel())
                .previewLayout(.sizeThatFits)
                .padding()
                .previewDisplayName("紧凑切换器")
        }
    }
}
#endif
