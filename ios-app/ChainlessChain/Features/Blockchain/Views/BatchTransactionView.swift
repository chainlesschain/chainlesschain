//
//  BatchTransactionView.swift
//  ChainlessChain
//
//  批量交易视图
//  支持批量发送代币/NFT
//
//  Created by ChainlessChain on 2026-02-11.
//

import SwiftUI
import Combine

/// 批量交易视图
struct BatchTransactionView: View {
    @EnvironmentObject var walletViewModel: WalletViewModel
    @StateObject private var viewModel = BatchTransactionViewModel()
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 交易类型选择
                transactionTypePicker

                // 主内容
                ScrollView {
                    VStack(spacing: 20) {
                        // 发送方信息
                        senderInfoCard

                        // 接收方列表
                        recipientsList

                        // 添加接收方按钮
                        addRecipientButton

                        // 批量导入
                        importSection

                        // 费用摘要
                        if !viewModel.recipients.isEmpty {
                            feeSummaryCard
                        }
                    }
                    .padding()
                }

                // 发送按钮
                sendButton
            }
            .navigationTitle("批量交易")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: {
                            viewModel.clearAll()
                        }) {
                            Label("清空全部", systemImage: "trash")
                        }

                        Button(action: {
                            viewModel.showImportSheet = true
                        }) {
                            Label("导入CSV", systemImage: "doc.text")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $viewModel.showImportSheet) {
                CSVImportSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $viewModel.showAddRecipient) {
                AddRecipientSheet(viewModel: viewModel)
            }
            .alert("错误", isPresented: $viewModel.showError) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage)
            }
            .alert("确认发送", isPresented: $viewModel.showConfirmation) {
                Button("取消", role: .cancel) {}
                Button("确认发送") {
                    Task {
                        await viewModel.executeBatchTransaction()
                    }
                }
            } message: {
                Text("确定要发送 \(viewModel.recipients.count) 笔交易吗？\n总金额: \(viewModel.totalAmountFormatted)\n预估Gas: \(viewModel.estimatedGasFormatted)")
            }
        }
        .onAppear {
            viewModel.setWallet(walletViewModel.currentWallet)
            viewModel.setChain(walletViewModel.currentChain)
        }
    }

    // MARK: - 交易类型选择器

    private var transactionTypePicker: some View {
        Picker("交易类型", selection: $viewModel.transactionType) {
            ForEach(BatchTransactionType.allCases, id: \.self) { type in
                Text(type.displayName).tag(type)
            }
        }
        .pickerStyle(.segmented)
        .padding()
        .background(Color(.systemBackground))
    }

    // MARK: - 发送方信息

    private var senderInfoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("发送方")
                .font(.headline)

            HStack {
                Image(systemName: "wallet.pass")
                    .foregroundColor(.blue)

                VStack(alignment: .leading, spacing: 4) {
                    Text(viewModel.currentWallet?.name ?? "未选择钱包")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    if let wallet = viewModel.currentWallet {
                        Text(formatAddress(wallet.address))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                if let balance = viewModel.balance {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(balance)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Text(viewModel.currentChain.symbol)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // 代币选择（如果是代币转账）
            if viewModel.transactionType == .token {
                Divider()

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
                    HStack {
                        Text("代币:")
                            .foregroundColor(.secondary)

                        Text(viewModel.selectedToken?.symbol ?? "选择代币")
                            .fontWeight(.medium)

                        Image(systemName: "chevron.down")
                            .font(.caption)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - 接收方列表

    private var recipientsList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("接收方 (\(viewModel.recipients.count))")
                    .font(.headline)

                Spacer()

                if viewModel.recipients.count > 1 {
                    Button(action: {
                        viewModel.toggleSelectAll()
                    }) {
                        Text(viewModel.isAllSelected ? "取消全选" : "全选")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }
            }

            if viewModel.recipients.isEmpty {
                emptyRecipientsView
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(viewModel.recipients) { recipient in
                        RecipientRow(
                            recipient: recipient,
                            transactionType: viewModel.transactionType,
                            isSelected: viewModel.selectedRecipients.contains(recipient.id),
                            onToggle: {
                                viewModel.toggleRecipient(recipient.id)
                            },
                            onEdit: {
                                viewModel.editRecipient(recipient)
                            },
                            onDelete: {
                                viewModel.removeRecipient(recipient.id)
                            }
                        )
                    }
                }
            }
        }
    }

    private var emptyRecipientsView: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2.slash")
                .font(.system(size: 40))
                .foregroundColor(.gray)

            Text("暂无接收方")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Text("点击下方按钮添加接收方，或导入CSV文件")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 30)
        .frame(maxWidth: .infinity)
    }

    // MARK: - 添加接收方按钮

    private var addRecipientButton: some View {
        Button(action: {
            viewModel.showAddRecipient = true
        }) {
            HStack {
                Image(systemName: "plus.circle.fill")
                Text("添加接收方")
            }
            .font(.subheadline)
            .fontWeight(.medium)
            .foregroundColor(.blue)
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.blue.opacity(0.1))
            .cornerRadius(12)
        }
    }

    // MARK: - 导入区域

    private var importSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("批量导入")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                Button(action: {
                    viewModel.showImportSheet = true
                }) {
                    HStack {
                        Image(systemName: "doc.text")
                        Text("导入CSV")
                    }
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }

                Button(action: {
                    viewModel.pasteFromClipboard()
                }) {
                    HStack {
                        Image(systemName: "doc.on.clipboard")
                        Text("粘贴")
                    }
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }

                Button(action: {
                    viewModel.downloadTemplate()
                }) {
                    HStack {
                        Image(systemName: "arrow.down.doc")
                        Text("模板")
                    }
                    .font(.caption)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(8)
                }
            }
        }
    }

    // MARK: - 费用摘要

    private var feeSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("费用摘要")
                .font(.headline)

            VStack(spacing: 8) {
                HStack {
                    Text("交易数量")
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("\(viewModel.recipients.count)")
                }

                HStack {
                    Text("总金额")
                        .foregroundColor(.secondary)
                    Spacer()
                    Text(viewModel.totalAmountFormatted)
                        .fontWeight(.medium)
                }

                Divider()

                HStack {
                    Text("预估Gas费")
                        .foregroundColor(.secondary)
                    Spacer()
                    if viewModel.isEstimatingGas {
                        ProgressView()
                            .scaleEffect(0.8)
                    } else {
                        Text(viewModel.estimatedGasFormatted)
                    }
                }

                HStack {
                    Text("总支出")
                        .fontWeight(.semibold)
                    Spacer()
                    Text(viewModel.totalCostFormatted)
                        .fontWeight(.bold)
                        .foregroundColor(.blue)
                }
            }
            .font(.subheadline)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - 发送按钮

    private var sendButton: some View {
        VStack(spacing: 0) {
            Divider()

            Button(action: {
                viewModel.showConfirmation = true
            }) {
                HStack {
                    if viewModel.isSending {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "paperplane.fill")
                        Text("发送 \(viewModel.recipients.count) 笔交易")
                    }
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(viewModel.canSend ? Color.blue : Color.gray)
                .cornerRadius(12)
            }
            .disabled(!viewModel.canSend || viewModel.isSending)
            .padding()
        }
        .background(Color(.systemBackground))
    }

    // MARK: - 辅助方法

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

// MARK: - 交易类型

enum BatchTransactionType: CaseIterable {
    case native
    case token
    case nft

    var displayName: String {
        switch self {
        case .native: return "原生代币"
        case .token: return "ERC-20"
        case .nft: return "NFT"
        }
    }
}

// MARK: - 接收方模型

struct BatchRecipient: Identifiable {
    let id: String
    var address: String
    var amount: String
    var tokenId: String?  // 用于NFT
    var note: String?

    var isValid: Bool {
        address.hasPrefix("0x") && address.count == 42 && !amount.isEmpty
    }
}

// MARK: - 接收方行

struct RecipientRow: View {
    let recipient: BatchRecipient
    let transactionType: BatchTransactionType
    let isSelected: Bool
    let onToggle: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // 选择框
            Button(action: onToggle) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .blue : .gray)
            }

            // 接收方信息
            VStack(alignment: .leading, spacing: 4) {
                Text(formatAddress(recipient.address))
                    .font(.subheadline)
                    .fontWeight(.medium)

                if let note = recipient.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // 金额/TokenId
            VStack(alignment: .trailing, spacing: 2) {
                if transactionType == .nft {
                    if let tokenId = recipient.tokenId {
                        Text("Token #\(tokenId)")
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                } else {
                    Text(recipient.amount)
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
            }

            // 操作按钮
            Menu {
                Button(action: onEdit) {
                    Label("编辑", systemImage: "pencil")
                }

                Button(role: .destructive, action: onDelete) {
                    Label("删除", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .foregroundColor(.gray)
                    .padding(8)
            }
        }
        .padding()
        .background(recipient.isValid ? Color(.secondarySystemBackground) : Color.red.opacity(0.1))
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(recipient.isValid ? Color.clear : Color.red.opacity(0.3), lineWidth: 1)
        )
    }

    private func formatAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(8))...\(address.suffix(6))"
    }
}

// MARK: - 添加接收方Sheet

struct AddRecipientSheet: View {
    @ObservedObject var viewModel: BatchTransactionViewModel
    @Environment(\.dismiss) var dismiss

    @State private var address = ""
    @State private var amount = ""
    @State private var tokenId = ""
    @State private var note = ""

    var body: some View {
        NavigationView {
            Form {
                Section("接收地址") {
                    TextField("0x...", text: $address)
                        .autocapitalization(.none)

                    if !address.isEmpty && !isValidAddress {
                        Text("无效的地址格式")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                if viewModel.transactionType == .nft {
                    Section("Token ID") {
                        TextField("Token ID", text: $tokenId)
                            .keyboardType(.numberPad)
                    }
                } else {
                    Section("金额") {
                        TextField("0.0", text: $amount)
                            .keyboardType(.decimalPad)
                    }
                }

                Section("备注（可选）") {
                    TextField("添加备注", text: $note)
                }
            }
            .navigationTitle("添加接收方")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("添加") {
                        addRecipient()
                        dismiss()
                    }
                    .disabled(!canAdd)
                }
            }
        }
    }

    private var isValidAddress: Bool {
        address.hasPrefix("0x") && address.count == 42
    }

    private var canAdd: Bool {
        isValidAddress && (viewModel.transactionType == .nft ? !tokenId.isEmpty : !amount.isEmpty)
    }

    private func addRecipient() {
        let recipient = BatchRecipient(
            id: UUID().uuidString,
            address: address,
            amount: amount,
            tokenId: viewModel.transactionType == .nft ? tokenId : nil,
            note: note.isEmpty ? nil : note
        )
        viewModel.addRecipient(recipient)
    }
}

// MARK: - CSV导入Sheet

struct CSVImportSheet: View {
    @ObservedObject var viewModel: BatchTransactionViewModel
    @Environment(\.dismiss) var dismiss

    @State private var csvContent = ""
    @State private var parseError: String?

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                Text("CSV格式: 地址,金额,备注(可选)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                TextEditor(text: $csvContent)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 200)
                    .padding(8)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)

                if let error = parseError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }

                // 示例
                VStack(alignment: .leading, spacing: 8) {
                    Text("示例:")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("""
                    0x1234...5678,1.5,备注1
                    0xabcd...efgh,2.0,备注2
                    """)
                    .font(.caption)
                    .fontDesign(.monospaced)
                    .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer()
            }
            .padding()
            .navigationTitle("导入CSV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("导入") {
                        parseAndImport()
                    }
                    .disabled(csvContent.isEmpty)
                }
            }
        }
    }

    private func parseAndImport() {
        parseError = nil

        let lines = csvContent.components(separatedBy: .newlines)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        var recipients: [BatchRecipient] = []

        for (index, line) in lines.enumerated() {
            let parts = line.components(separatedBy: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }

            guard parts.count >= 2 else {
                parseError = "第 \(index + 1) 行格式错误"
                return
            }

            let address = parts[0]
            let amount = parts[1]
            let note = parts.count > 2 ? parts[2] : nil

            guard address.hasPrefix("0x") && address.count == 42 else {
                parseError = "第 \(index + 1) 行地址无效"
                return
            }

            recipients.append(BatchRecipient(
                id: UUID().uuidString,
                address: address,
                amount: amount,
                note: note
            ))
        }

        viewModel.importRecipients(recipients)
        dismiss()
    }
}

// MARK: - ViewModel

@MainActor
class BatchTransactionViewModel: ObservableObject {
    @Published var currentWallet: Wallet?
    @Published var currentChain: SupportedChain = .ethereumMainnet
    @Published var balance: String?

    @Published var transactionType: BatchTransactionType = .native
    @Published var selectedToken: Token?
    @Published var availableTokens: [Token] = []

    @Published var recipients: [BatchRecipient] = []
    @Published var selectedRecipients: Set<String> = []

    @Published var estimatedGas: Decimal?
    @Published var isEstimatingGas = false
    @Published var isSending = false

    @Published var showAddRecipient = false
    @Published var showImportSheet = false
    @Published var showConfirmation = false
    @Published var showError = false
    @Published var errorMessage = ""

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Computed Properties

    var isAllSelected: Bool {
        selectedRecipients.count == recipients.count && !recipients.isEmpty
    }

    var canSend: Bool {
        !recipients.isEmpty && recipients.allSatisfy { $0.isValid }
    }

    var totalAmount: Decimal {
        recipients.compactMap { Decimal(string: $0.amount) }.reduce(0, +)
    }

    var totalAmountFormatted: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 6
        let symbol = selectedToken?.symbol ?? currentChain.symbol
        return "\(formatter.string(from: totalAmount as NSDecimalNumber) ?? "0") \(symbol)"
    }

    var estimatedGasFormatted: String {
        guard let gas = estimatedGas else { return "计算中..." }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 6
        return "\(formatter.string(from: gas as NSDecimalNumber) ?? "0") \(currentChain.symbol)"
    }

    var totalCostFormatted: String {
        let gas = estimatedGas ?? 0
        let total = totalAmount + gas
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 6
        return "\(formatter.string(from: total as NSDecimalNumber) ?? "0") \(currentChain.symbol)"
    }

    // MARK: - Public Methods

    func setWallet(_ wallet: Wallet?) {
        currentWallet = wallet
        loadBalance()
    }

    func setChain(_ chain: SupportedChain) {
        currentChain = chain
        loadBalance()
    }

    func addRecipient(_ recipient: BatchRecipient) {
        recipients.append(recipient)
        estimateGas()
    }

    func removeRecipient(_ id: String) {
        recipients.removeAll { $0.id == id }
        selectedRecipients.remove(id)
        estimateGas()
    }

    func editRecipient(_ recipient: BatchRecipient) {
        // TODO: 实现编辑功能
    }

    func toggleRecipient(_ id: String) {
        if selectedRecipients.contains(id) {
            selectedRecipients.remove(id)
        } else {
            selectedRecipients.insert(id)
        }
    }

    func toggleSelectAll() {
        if isAllSelected {
            selectedRecipients.removeAll()
        } else {
            selectedRecipients = Set(recipients.map { $0.id })
        }
    }

    func importRecipients(_ newRecipients: [BatchRecipient]) {
        recipients.append(contentsOf: newRecipients)
        estimateGas()
    }

    func clearAll() {
        recipients.removeAll()
        selectedRecipients.removeAll()
        estimatedGas = nil
    }

    func pasteFromClipboard() {
        guard let content = UIPasteboard.general.string else { return }

        let lines = content.components(separatedBy: .newlines)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

        var newRecipients: [BatchRecipient] = []

        for line in lines {
            let parts = line.components(separatedBy: [",", "\t", " "])
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }

            guard parts.count >= 2,
                  parts[0].hasPrefix("0x"),
                  parts[0].count == 42 else {
                continue
            }

            newRecipients.append(BatchRecipient(
                id: UUID().uuidString,
                address: parts[0],
                amount: parts[1],
                note: parts.count > 2 ? parts[2] : nil
            ))
        }

        if !newRecipients.isEmpty {
            importRecipients(newRecipients)
        }
    }

    func downloadTemplate() {
        // TODO: 实现模板下载
        Logger.shared.info("[BatchTransaction] 下载模板")
    }

    func executeBatchTransaction() async {
        guard canSend else { return }

        isSending = true
        defer { isSending = false }

        do {
            // TODO: 实现批量交易逻辑
            // 1. 对于原生代币：可以使用multicall或逐个发送
            // 2. 对于ERC-20：使用批量转账合约
            // 3. 对于NFT：使用批量转账合约

            try await Task.sleep(nanoseconds: 2_000_000_000)

            Logger.shared.info("[BatchTransaction] 批量交易完成")

        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    // MARK: - Private Methods

    private func loadBalance() {
        // TODO: 加载余额
        balance = "10.5"
    }

    private func estimateGas() {
        guard !recipients.isEmpty else {
            estimatedGas = nil
            return
        }

        isEstimatingGas = true

        // 模拟估算
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)

            let gasPerTx: Decimal = 0.002
            estimatedGas = gasPerTx * Decimal(recipients.count)
            isEstimatingGas = false
        }
    }
}

// MARK: - 预览

#if DEBUG
struct BatchTransactionView_Previews: PreviewProvider {
    static var previews: some View {
        BatchTransactionView()
            .environmentObject(WalletViewModel())
    }
}
#endif
