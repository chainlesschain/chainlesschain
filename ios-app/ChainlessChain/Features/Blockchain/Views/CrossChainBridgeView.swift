//
//  CrossChainBridgeView.swift
//  ChainlessChain
//
//  跨链桥主界面
//  支持14条链的资产跨链转移
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 跨链桥主视图
struct CrossChainBridgeView: View {
    @EnvironmentObject var walletViewModel: WalletViewModel
    @StateObject private var viewModel = CrossChainBridgeViewModel()
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 钱包信息卡片
                    walletInfoCard

                    // 链对选择器
                    chainPairSelector

                    // 金额输入
                    amountInputSection

                    // 费用估算
                    if viewModel.feeEstimate != nil {
                        feeEstimateCard
                    }

                    // 桥接按钮
                    bridgeButton

                    // 最近桥接记录
                    recentBridgesSection
                }
                .padding()
            }
            .navigationTitle("跨链桥")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink(destination: BridgeHistoryView()) {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                }
            }
            .alert("桥接错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage)
            }
            .sheet(isPresented: $viewModel.showConfirmation) {
                BridgeConfirmationSheet(
                    viewModel: viewModel,
                    onConfirm: {
                        Task {
                            await viewModel.executeBridge()
                        }
                    }
                )
            }
        }
        .onAppear {
            viewModel.setWallet(walletViewModel.currentWallet)
        }
    }

    // MARK: - 钱包信息卡片

    private var walletInfoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "wallet.pass")
                    .font(.title2)
                    .foregroundColor(.blue)

                VStack(alignment: .leading, spacing: 4) {
                    Text("当前钱包")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(viewModel.currentWallet?.name ?? "未选择钱包")
                        .font(.headline)
                }

                Spacer()

                if let wallet = viewModel.currentWallet {
                    Text(formatAddress(wallet.address))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(6)
                }
            }

            // 余额显示
            if let balance = viewModel.sourceChainBalance {
                HStack {
                    Text("可用余额:")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("\(balance) \(viewModel.fromChain.symbol)")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 链对选择器

    private var chainPairSelector: some View {
        VStack(spacing: 16) {
            // 源链选择
            ChainSelectorButton(
                title: "从",
                chain: viewModel.fromChain,
                onTap: { viewModel.showFromChainPicker = true }
            )

            // 交换按钮
            Button(action: {
                viewModel.swapChains()
            }) {
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: "arrow.up.arrow.down")
                        .font(.title3)
                        .foregroundColor(.blue)
                }
            }
            .disabled(viewModel.isLoading)

            // 目标链选择
            ChainSelectorButton(
                title: "到",
                chain: viewModel.toChain,
                onTap: { viewModel.showToChainPicker = true }
            )
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
        .sheet(isPresented: $viewModel.showFromChainPicker) {
            BridgeChainPickerView(
                selectedChain: $viewModel.fromChain,
                excludedChain: viewModel.toChain,
                title: "选择源链"
            )
        }
        .sheet(isPresented: $viewModel.showToChainPicker) {
            BridgeChainPickerView(
                selectedChain: $viewModel.toChain,
                excludedChain: viewModel.fromChain,
                title: "选择目标链"
            )
        }
    }

    // MARK: - 金额输入

    private var amountInputSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("转移金额")
                .font(.headline)

            HStack {
                TextField("0.0", text: $viewModel.amountInput)
                    .keyboardType(.decimalPad)
                    .font(.title2)
                    .fontWeight(.medium)
                    .onChange(of: viewModel.amountInput) { _, _ in
                        viewModel.validateAndEstimateFee()
                    }

                Spacer()

                // 代币选择器
                Menu {
                    ForEach(viewModel.availableTokens, id: \.address) { token in
                        Button(action: {
                            viewModel.selectedToken = token
                        }) {
                            HStack {
                                Text(token.symbol)
                                if token.address == viewModel.selectedToken?.address {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(viewModel.selectedToken?.symbol ?? viewModel.fromChain.symbol)
                            .fontWeight(.medium)

                        Image(systemName: "chevron.down")
                            .font(.caption)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }
            }

            // 快捷金额按钮
            HStack(spacing: 12) {
                ForEach(["25%", "50%", "75%", "MAX"], id: \.self) { percent in
                    Button(action: {
                        viewModel.setAmountByPercent(percent)
                    }) {
                        Text(percent)
                            .font(.caption)
                            .fontWeight(.medium)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.blue.opacity(0.1))
                            .foregroundColor(.blue)
                            .cornerRadius(6)
                    }
                }
            }

            // 验证提示
            if let error = viewModel.amountValidationError {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 费用估算卡片

    private var feeEstimateCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("费用估算")
                    .font(.headline)

                Spacer()

                if viewModel.isEstimatingFee {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            if let fee = viewModel.feeEstimate {
                VStack(spacing: 8) {
                    FeeRow(title: "源链Gas费", value: fee.sourceTxFee, symbol: viewModel.fromChain.symbol)
                    FeeRow(title: "桥接费用", value: fee.bridgeFee, symbol: viewModel.fromChain.symbol)

                    Divider()

                    HStack {
                        Text("总费用")
                            .font(.subheadline)
                            .fontWeight(.semibold)

                        Spacer()

                        Text("\(fee.totalFeeDisplay) \(viewModel.fromChain.symbol)")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                    }

                    // 预计时间
                    HStack {
                        Image(systemName: "clock")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("预计完成时间: \(fee.estimatedTimeDisplay)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 桥接按钮

    private var bridgeButton: some View {
        Button(action: {
            viewModel.showConfirmation = true
        }) {
            HStack {
                if viewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "arrow.left.arrow.right")
                    Text("开始桥接")
                }
            }
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding()
            .background(viewModel.canBridge ? Color.blue : Color.gray)
            .cornerRadius(12)
        }
        .disabled(!viewModel.canBridge || viewModel.isLoading)
    }

    // MARK: - 最近桥接记录

    private var recentBridgesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("最近桥接")
                    .font(.headline)

                Spacer()

                NavigationLink(destination: BridgeHistoryView()) {
                    Text("查看全部")
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }

            if viewModel.recentBridges.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "arrow.left.arrow.right.circle")
                            .font(.largeTitle)
                            .foregroundColor(.gray)
                        Text("暂无桥接记录")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 20)
                    Spacer()
                }
            } else {
                ForEach(viewModel.recentBridges.prefix(3)) { record in
                    NavigationLink(destination: BridgeTransactionView(bridgeRecord: record)) {
                        BridgeRecordRow(record: record)
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }

    // MARK: - 辅助方法

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

// MARK: - 链选择按钮

struct ChainSelectorButton: View {
    let title: String
    let chain: SupportedChain
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 8) {
                        ChainIcon(chain: chain)

                        Text(chain.name)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color.gray.opacity(0.05))
            .cornerRadius(10)
        }
    }
}

// MARK: - 费用行

struct FeeRow: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        HStack {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()

            Text("\(WeiConverter.weiToEther(value)) \(symbol)")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - 桥接记录行

struct BridgeRecordRow: View {
    let record: BridgeRecord

    var statusColor: Color {
        switch record.status {
        case .completed: return .green
        case .failed, .cancelled: return .red
        case .pending, .locking, .locked, .minting: return .orange
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            // 状态指示器
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)

            // 桥接信息
            VStack(alignment: .leading, spacing: 4) {
                Text("\(record.fromChainName) → \(record.toChainName)")
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(record.amountDisplay)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // 状态和时间
            VStack(alignment: .trailing, spacing: 4) {
                Text(record.status.displayName)
                    .font(.caption)
                    .foregroundColor(statusColor)

                Text(formatDate(record.createdAt))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - 桥接确认Sheet

struct BridgeConfirmationSheet: View {
    @ObservedObject var viewModel: CrossChainBridgeViewModel
    let onConfirm: () -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // 桥接摘要
                VStack(spacing: 16) {
                    // 链对显示
                    HStack(spacing: 20) {
                        VStack {
                            ChainIcon(chain: viewModel.fromChain)
                            Text(viewModel.fromChain.name)
                                .font(.caption)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)

                        Image(systemName: "arrow.right")
                            .font(.title2)
                            .foregroundColor(.blue)

                        VStack {
                            ChainIcon(chain: viewModel.toChain)
                            Text(viewModel.toChain.name)
                                .font(.caption)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .padding()
                    .background(Color.gray.opacity(0.05))
                    .cornerRadius(12)

                    // 金额
                    VStack(spacing: 4) {
                        Text("转移金额")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Text("\(viewModel.amountInput) \(viewModel.selectedToken?.symbol ?? viewModel.fromChain.symbol)")
                            .font(.title)
                            .fontWeight(.bold)
                    }

                    // 费用摘要
                    if let fee = viewModel.feeEstimate {
                        VStack(spacing: 8) {
                            Divider()

                            HStack {
                                Text("总费用")
                                Spacer()
                                Text("\(fee.totalFeeDisplay) \(viewModel.fromChain.symbol)")
                                    .fontWeight(.medium)
                            }
                            .font(.subheadline)

                            HStack {
                                Text("预计时间")
                                Spacer()
                                Text(fee.estimatedTimeDisplay)
                            }
                            .font(.caption)
                            .foregroundColor(.secondary)
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)

                // 安全提示
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "exclamationmark.shield")
                        .foregroundColor(.orange)

                    Text("跨链转移通常需要几分钟到几小时不等。请确保目标地址正确，转移后无法撤销。")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color.orange.opacity(0.1))
                .cornerRadius(8)

                Spacer()

                // 操作按钮
                VStack(spacing: 12) {
                    Button(action: {
                        dismiss()
                        onConfirm()
                    }) {
                        Text("确认桥接")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                    }

                    Button(action: {
                        dismiss()
                    }) {
                        Text("取消")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding()
            .navigationTitle("确认桥接")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - 链选择器视图

struct BridgeChainPickerView: View {
    @Binding var selectedChain: SupportedChain
    let excludedChain: SupportedChain
    let title: String
    @Environment(\.dismiss) var dismiss
    @State private var searchText = ""

    var filteredChains: [SupportedChain] {
        let chains = SupportedChain.allCases.filter { $0 != excludedChain }
        if searchText.isEmpty {
            return chains
        }
        return chains.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationView {
            List {
                Section {
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(.gray)
                        TextField("搜索链...", text: $searchText)
                    }
                }

                ForEach(filteredChains, id: \.rawValue) { chain in
                    Button(action: {
                        selectedChain = chain
                        dismiss()
                    }) {
                        HStack {
                            ChainIcon(chain: chain)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(chain.name)
                                    .foregroundColor(.primary)

                                Text(chain.symbol)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            if chain == selectedChain {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - ViewModel

@MainActor
class CrossChainBridgeViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var currentWallet: Wallet?
    @Published var fromChain: SupportedChain = .ethereumMainnet
    @Published var toChain: SupportedChain = .polygonMainnet
    @Published var amountInput: String = ""
    @Published var selectedToken: Token?
    @Published var availableTokens: [Token] = []

    @Published var sourceChainBalance: String?
    @Published var feeEstimate: BridgeFeeEstimate?
    @Published var amountValidationError: String?

    @Published var showFromChainPicker = false
    @Published var showToChainPicker = false
    @Published var showConfirmation = false
    @Published var showError = false
    @Published var errorMessage = ""

    @Published var isLoading = false
    @Published var isEstimatingFee = false

    @Published var recentBridges: [BridgeRecord] = []

    // MARK: - Private Properties

    private let bridgeManager = BridgeManager.shared
    private let securityManager = BridgeSecurityManager.shared
    private var cancellables = Set<AnyCancellable>()
    private var estimateFeeTask: Task<Void, Never>?

    // MARK: - Computed Properties

    var canBridge: Bool {
        guard currentWallet != nil,
              !amountInput.isEmpty,
              amountValidationError == nil,
              feeEstimate != nil else {
            return false
        }

        guard let amount = Decimal(string: amountInput), amount > 0 else {
            return false
        }

        return true
    }

    // MARK: - Initialization

    init() {
        setupSubscriptions()
        loadRecentBridges()
    }

    // MARK: - Public Methods

    func setWallet(_ wallet: Wallet?) {
        currentWallet = wallet
        if wallet != nil {
            loadBalance()
            loadAvailableTokens()
        }
    }

    func swapChains() {
        let temp = fromChain
        fromChain = toChain
        toChain = temp

        loadBalance()
        validateAndEstimateFee()
    }

    func setAmountByPercent(_ percent: String) {
        guard let balance = sourceChainBalance,
              let balanceDecimal = Decimal(string: balance) else {
            return
        }

        let percentage: Decimal
        switch percent {
        case "25%": percentage = 0.25
        case "50%": percentage = 0.5
        case "75%": percentage = 0.75
        case "MAX": percentage = 1.0
        default: return
        }

        let amount = balanceDecimal * percentage
        amountInput = "\(amount)"
        validateAndEstimateFee()
    }

    func validateAndEstimateFee() {
        // 取消之前的估算任务
        estimateFeeTask?.cancel()

        // 验证金额
        amountValidationError = nil

        guard !amountInput.isEmpty else {
            feeEstimate = nil
            return
        }

        guard let amount = Decimal(string: amountInput) else {
            amountValidationError = "请输入有效的金额"
            feeEstimate = nil
            return
        }

        if amount <= 0 {
            amountValidationError = "金额必须大于0"
            feeEstimate = nil
            return
        }

        if let balance = sourceChainBalance,
           let balanceDecimal = Decimal(string: balance),
           amount > balanceDecimal {
            amountValidationError = "余额不足"
        }

        // 估算费用（带防抖）
        estimateFeeTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5秒防抖

            guard !Task.isCancelled else { return }

            await estimateFee()
        }
    }

    func executeBridge() async {
        guard let wallet = currentWallet else {
            showError(message: "请选择钱包")
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            // 将金额转换为Wei
            let amountWei = WeiConverter.etherToWei(amountInput)
            let tokenAddress = selectedToken?.address ?? "0x0000000000000000000000000000000000000000"

            // 执行桥接
            let record = try await bridgeManager.bridgeAsset(
                wallet: wallet,
                tokenAddress: tokenAddress,
                amount: amountWei,
                fromChain: fromChain,
                toChain: toChain,
                recipientAddress: wallet.address,
                protocol: .native
            )

            // 添加到最近记录
            recentBridges.insert(record, at: 0)

            // 重置表单
            amountInput = ""
            feeEstimate = nil

            Logger.shared.info("[CrossChainBridge] 桥接已创建: \(record.id)")

        } catch {
            showError(message: error.localizedDescription)
        }
    }

    // MARK: - Private Methods

    private func setupSubscriptions() {
        // 监听桥接完成事件
        bridgeManager.bridgeCompleted
            .receive(on: DispatchQueue.main)
            .sink { [weak self] record in
                self?.updateBridgeRecord(record)
            }
            .store(in: &cancellables)

        // 监听桥接更新事件
        bridgeManager.bridgeUpdated
            .receive(on: DispatchQueue.main)
            .sink { [weak self] record in
                self?.updateBridgeRecord(record)
            }
            .store(in: &cancellables)
    }

    private func loadBalance() {
        Task {
            guard let wallet = currentWallet else { return }

            // 这里应该调用BalanceService获取实际余额
            // 暂时使用模拟数据
            sourceChainBalance = "1.5"
        }
    }

    private func loadAvailableTokens() {
        // 加载可用代币列表
        // 暂时使用空列表，只支持原生代币
        availableTokens = []
    }

    private func loadRecentBridges() {
        Task {
            do {
                recentBridges = try await bridgeManager.getBridgeHistory(limit: 10)
            } catch {
                Logger.shared.error("[CrossChainBridge] 加载桥接历史失败: \(error)")
            }
        }
    }

    private func estimateFee() async {
        isEstimatingFee = true
        defer { isEstimatingFee = false }

        do {
            let amountWei = WeiConverter.etherToWei(amountInput)
            let tokenAddress = selectedToken?.address ?? "0x0000000000000000000000000000000000000000"

            feeEstimate = try await bridgeManager.estimateBridgeFee(
                tokenAddress: tokenAddress,
                amount: amountWei,
                fromChain: fromChain,
                toChain: toChain
            )
        } catch {
            Logger.shared.error("[CrossChainBridge] 费用估算失败: \(error)")
            feeEstimate = nil
        }
    }

    private func updateBridgeRecord(_ record: BridgeRecord) {
        if let index = recentBridges.firstIndex(where: { $0.id == record.id }) {
            recentBridges[index] = record
        }
    }

    private func showError(message: String) {
        errorMessage = message
        showError = true
    }
}

// MARK: - Wei转换工具

struct WeiConverter {
    static func etherToWei(_ ether: String) -> String {
        guard let decimal = Decimal(string: ether) else { return "0" }
        let wei = decimal * pow(10, 18)
        return "\(wei)"
    }

    static func weiToEther(_ wei: String) -> String {
        guard let decimal = Decimal(string: wei), decimal > 0 else { return "0" }
        let ether = decimal / pow(10, 18)

        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 6
        formatter.minimumFractionDigits = 0

        return formatter.string(from: ether as NSDecimalNumber) ?? "0"
    }
}

// MARK: - 预览

#if DEBUG
struct CrossChainBridgeView_Previews: PreviewProvider {
    static var previews: some View {
        CrossChainBridgeView()
            .environmentObject(WalletViewModel())
    }
}
#endif
