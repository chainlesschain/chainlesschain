import Foundation
import CoreCommon

/// Gas管理器
/// 负责Gas价格估算、Gas限制计算、多级Gas定价
@MainActor
public class GasManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = GasManager()

    // MARK: - Properties

    private let rpcClient: BlockchainRPCClient
    private let chainManager: ChainManager

    /// Gas价格倍数配置
    private let gasPriceMultipliers: [GasSpeed: Decimal] = [
        .slow: 0.8,         // 慢速：基础价格的80%
        .standard: 1.0,     // 标准：基础价格
        .fast: 1.2          // 快速：基础价格的120%
    ]

    /// Gas限制安全系数
    private let gasLimitSafetyFactor: Decimal = 1.2  // 120%

    /// 默认Gas限制（基础转账）
    private let defaultGasLimit = "21000"

    // MARK: - Initialization

    private init() {
        self.rpcClient = BlockchainRPCClient.shared
        self.chainManager = ChainManager.shared

        Logger.shared.info("[GasManager] Gas管理器已初始化")
    }

    // MARK: - Gas Price Estimation

    /// 获取Gas价格估算（三个档位）
    public func getGasPriceEstimate(chain: SupportedChain? = nil) async throws -> GasPriceEstimate {
        let activeChain = chain ?? chainManager.activeChain
        let config = NetworkConfig.config(for: activeChain)

        // 获取基础Gas价格
        let basePriceWei = try await rpcClient.getGasPrice(rpcUrl: config.rpcUrl)

        guard let basePriceDecimal = parseWeiValue(basePriceWei) else {
            throw GasError.invalidGasPrice
        }

        // 转换为Gwei
        let basePriceGwei = weiToGwei(basePriceDecimal)

        // 计算三个档位的价格
        let slowGwei = basePriceGwei * (gasPriceMultipliers[.slow] ?? 0.8)
        let standardGwei = basePriceGwei * (gasPriceMultipliers[.standard] ?? 1.0)
        let fastGwei = basePriceGwei * (gasPriceMultipliers[.fast] ?? 1.2)

        return GasPriceEstimate(
            slow: formatGwei(slowGwei),
            standard: formatGwei(standardGwei),
            fast: formatGwei(fastGwei)
        )
    }

    /// 获取指定速度的Gas价格（Wei）
    public func getGasPrice(speed: GasSpeed, chain: SupportedChain? = nil) async throws -> String {
        let estimate = try await getGasPriceEstimate(chain: chain)
        return estimate.toWei(speed: speed)
    }

    // MARK: - Gas Limit Estimation

    /// 估算Gas限制
    public func estimateGasLimit(
        from: String,
        to: String,
        value: String,
        data: String? = nil,
        chain: SupportedChain? = nil
    ) async throws -> String {
        let activeChain = chain ?? chainManager.activeChain
        let config = NetworkConfig.config(for: activeChain)

        // 简单转账使用默认Gas限制
        if data == nil && value != "0" {
            return defaultGasLimit
        }

        // 合约调用需要估算
        do {
            let estimatedGasHex = try await rpcClient.estimateGas(
                rpcUrl: config.rpcUrl,
                from: from,
                to: to,
                value: value,
                data: data
            )

            guard let estimatedGas = parseHexValue(estimatedGasHex) else {
                throw GasError.gasEstimationFailed
            }

            // 添加安全系数
            let safeGasLimit = estimatedGas * gasLimitSafetyFactor
            return String(describing: safeGasLimit.rounded())

        } catch {
            Logger.shared.error("[GasManager] Gas估算失败: \(error)")

            // 回退到默认值或根据交易类型推断
            if data != nil {
                // 合约调用使用更高的默认值
                return "200000"
            } else {
                return defaultGasLimit
            }
        }
    }

    // MARK: - Gas Cost Calculation

    /// 计算交易费用估算
    public func estimateTransactionCost(
        from: String,
        to: String,
        value: String,
        data: String? = nil,
        speed: GasSpeed = .standard,
        chain: SupportedChain? = nil
    ) async throws -> GasEstimate {
        // 估算Gas限制
        let gasLimit = try await estimateGasLimit(
            from: from,
            to: to,
            value: value,
            data: data,
            chain: chain
        )

        // 获取Gas价格估算
        let gasPriceEstimate = try await getGasPriceEstimate(chain: chain)

        // 计算估算成本（Wei）
        let gasPriceWei = gasPriceEstimate.toWei(speed: speed)

        guard let gasLimitDecimal = Decimal(string: gasLimit),
              let gasPriceDecimal = parseWeiValue(gasPriceWei) else {
            throw GasError.invalidCalculation
        }

        let estimatedCostWei = gasLimitDecimal * gasPriceDecimal

        return GasEstimate(
            gasLimit: gasLimit,
            gasPrice: gasPriceEstimate,
            estimatedCost: String(describing: estimatedCostWei.rounded())
        )
    }

    /// 计算实际交易费用（基于收据）
    public func calculateActualFee(gasUsed: String, gasPrice: String) -> String? {
        guard let gasUsedDecimal = Decimal(string: gasUsed),
              let gasPriceDecimal = Decimal(string: gasPrice) else {
            return nil
        }

        let feeWei = gasUsedDecimal * gasPriceDecimal
        return String(describing: feeWei.rounded())
    }

    // MARK: - Gas Recommendations

    /// 获取推荐的Gas配置
    public func getRecommendedGasConfig(
        from: String,
        to: String,
        value: String,
        data: String? = nil,
        speed: GasSpeed = .standard,
        chain: SupportedChain? = nil
    ) async throws -> (gasLimit: String, gasPrice: String) {
        let gasLimit = try await estimateGasLimit(
            from: from,
            to: to,
            value: value,
            data: data,
            chain: chain
        )

        let gasPrice = try await getGasPrice(speed: speed, chain: chain)

        return (gasLimit, gasPrice)
    }

    /// 检查余额是否足够支付Gas
    public func canAffordGas(
        balance: String,
        value: String,
        gasLimit: String,
        gasPrice: String
    ) -> Bool {
        guard let balanceDecimal = Decimal(string: balance),
              let valueDecimal = Decimal(string: value),
              let gasLimitDecimal = Decimal(string: gasLimit),
              let gasPriceDecimal = Decimal(string: gasPrice) else {
            return false
        }

        let totalGasCost = gasLimitDecimal * gasPriceDecimal
        let totalRequired = valueDecimal + totalGasCost

        return balanceDecimal >= totalRequired
    }

    /// 计算最大可发送金额（扣除Gas费用）
    public func calculateMaxSendAmount(
        balance: String,
        gasLimit: String,
        gasPrice: String
    ) -> String {
        guard let balanceDecimal = Decimal(string: balance),
              let gasLimitDecimal = Decimal(string: gasLimit),
              let gasPriceDecimal = Decimal(string: gasPrice) else {
            return "0"
        }

        let totalGasCost = gasLimitDecimal * gasPriceDecimal
        let maxSend = max(0, balanceDecimal - totalGasCost)

        return String(describing: maxSend.rounded())
    }

    // MARK: - EIP-1559 Support (for compatible chains)

    /// 估算EIP-1559 Gas费用
    /// 注意：目前返回传统Gas估算，未来支持EIP-1559
    public func estimateEIP1559Gas(chain: SupportedChain? = nil) async throws -> EIP1559GasEstimate {
        // TODO: 实现完整的EIP-1559支持
        // 目前使用传统Gas价格估算

        let gasPriceEstimate = try await getGasPriceEstimate(chain: chain)

        // 将传统Gas价格映射到EIP-1559参数
        // maxFeePerGas = fast price
        // maxPriorityFeePerGas = (fast - standard) as tip

        guard let standardGwei = Decimal(string: gasPriceEstimate.standard),
              let fastGwei = Decimal(string: gasPriceEstimate.fast) else {
            throw GasError.invalidGasPrice
        }

        let baseFeeGwei = standardGwei
        let priorityFeeGwei = max(1, fastGwei - standardGwei)

        return EIP1559GasEstimate(
            baseFeePerGas: formatGwei(baseFeeGwei),
            maxPriorityFeePerGas: formatGwei(priorityFeeGwei),
            maxFeePerGas: formatGwei(fastGwei)
        )
    }

    // MARK: - Utility Methods

    /// 解析Wei值
    private func parseWeiValue(_ weiHex: String) -> Decimal? {
        let hex = weiHex.hasPrefix("0x") ? String(weiHex.dropFirst(2)) : weiHex
        guard let value = UInt64(hex, radix: 16) else {
            return nil
        }
        return Decimal(value)
    }

    /// 解析十六进制值
    private func parseHexValue(_ hex: String) -> Decimal? {
        let cleanHex = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        guard let value = UInt64(cleanHex, radix: 16) else {
            return nil
        }
        return Decimal(value)
    }

    /// Wei转Gwei
    private func weiToGwei(_ wei: Decimal) -> Decimal {
        return wei / Decimal(sign: .plus, exponent: 9, significand: 1)
    }

    /// Gwei转Wei
    private func gweiToWei(_ gwei: Decimal) -> Decimal {
        return gwei * Decimal(sign: .plus, exponent: 9, significand: 1)
    }

    /// 格式化Gwei值
    private func formatGwei(_ gwei: Decimal) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter.string(from: gwei as NSDecimalNumber) ?? "0"
    }

    // MARK: - Gas Optimization

    /// 获取历史Gas价格趋势（用于优化建议）
    /// 注意：需要外部数据源支持，暂未实现
    public func getGasPriceTrend(chain: SupportedChain? = nil) async throws -> GasPriceTrend {
        // TODO: 实现历史Gas价格分析
        // 可以通过区块浏览器API或专门的Gas追踪服务获取

        return GasPriceTrend(
            currentGwei: "0",
            averageGwei: "0",
            trend: .stable,
            recommendation: "当前Gas价格处于正常水平"
        )
    }

    /// 判断是否是发送交易的好时机
    public func isGoodTimeToSend(chain: SupportedChain? = nil) async throws -> Bool {
        // TODO: 基于历史数据和当前价格判断
        // 目前总是返回true

        return true
    }
}

// MARK: - Supporting Models

/// EIP-1559 Gas估算
public struct EIP1559GasEstimate {
    /// 基础费用（Gwei）
    public let baseFeePerGas: String

    /// 优先费用（Gwei）
    public let maxPriorityFeePerGas: String

    /// 最大费用（Gwei）
    public let maxFeePerGas: String

    /// 计算总成本（Wei）
    public func totalCost(gasLimit: String) -> String? {
        guard let gasLimitDecimal = Decimal(string: gasLimit),
              let maxFeeGwei = Decimal(string: maxFeePerGas) else {
            return nil
        }

        // maxFeePerGas * gasLimit (转换为Wei)
        let maxFeeWei = maxFeeGwei * Decimal(sign: .plus, exponent: 9, significand: 1)
        let totalCostWei = maxFeeWei * gasLimitDecimal

        return String(describing: totalCostWei.rounded())
    }
}

/// Gas价格趋势
public struct GasPriceTrend {
    /// 当前价格（Gwei）
    public let currentGwei: String

    /// 平均价格（Gwei）
    public let averageGwei: String

    /// 趋势
    public let trend: Trend

    /// 建议
    public let recommendation: String

    public enum Trend: String {
        case rising = "上涨"
        case falling = "下降"
        case stable = "稳定"
    }
}

// MARK: - Errors

public enum GasError: Error, LocalizedError {
    case invalidGasPrice
    case gasEstimationFailed
    case invalidCalculation
    case insufficientBalance

    public var errorDescription: String? {
        switch self {
        case .invalidGasPrice:
            return "无效的Gas价格"
        case .gasEstimationFailed:
            return "Gas估算失败"
        case .invalidCalculation:
            return "Gas计算错误"
        case .insufficientBalance:
            return "余额不足以支付Gas费用"
        }
    }
}
