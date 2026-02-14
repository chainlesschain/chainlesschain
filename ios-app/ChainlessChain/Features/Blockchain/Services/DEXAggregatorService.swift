import Foundation

/// DEXAggregatorService - 1inch Swap API v6.0 integration
/// Provides real DEX quotes and swap transaction data
class DEXAggregatorService {
    static let shared = DEXAggregatorService()

    private let baseURL = "https://api.1inch.dev/swap/v6.0"
    private let apiKey: String

    private init() {
        // Load API key from configuration
        self.apiKey = UserDefaults.standard.string(forKey: "1inch_api_key") ?? ""
    }

    // MARK: - Quote

    /// Get a swap quote from 1inch
    /// - Parameters:
    ///   - chainId: Chain ID (1 = Ethereum, 137 = Polygon, etc.)
    ///   - fromToken: Source token address (use 0xEeeee...eE for native token)
    ///   - toToken: Destination token address
    ///   - amount: Amount in smallest unit (wei for ETH)
    /// - Returns: Quote with estimated output and gas
    func getQuote(
        chainId: Int,
        fromToken: String,
        toToken: String,
        amount: String
    ) async throws -> SwapQuote {
        let url = "\(baseURL)/\(chainId)/quote"
        var components = URLComponents(string: url)!
        components.queryItems = [
            URLQueryItem(name: "src", value: fromToken),
            URLQueryItem(name: "dst", value: toToken),
            URLQueryItem(name: "amount", value: amount),
        ]

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DEXError.networkError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            throw DEXError.apiError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        let quoteResponse = try JSONDecoder().decode(QuoteResponse.self, from: data)

        return SwapQuote(
            fromToken: fromToken,
            toToken: toToken,
            fromAmount: amount,
            toAmount: quoteResponse.dstAmount,
            estimatedGas: quoteResponse.gas,
            protocols: quoteResponse.protocols?.map { routes in
                routes.flatMap { steps in
                    steps.map { step in
                        SwapQuote.Protocol(
                            name: step.name,
                            part: step.part
                        )
                    }
                }
            } ?? []
        )
    }

    // MARK: - Swap Transaction

    /// Get swap transaction data from 1inch
    /// - Parameters:
    ///   - chainId: Chain ID
    ///   - fromToken: Source token address
    ///   - toToken: Destination token address
    ///   - amount: Amount in smallest unit
    ///   - fromAddress: Wallet address executing the swap
    ///   - slippage: Slippage tolerance in percent (e.g., 1.0 = 1%)
    /// - Returns: Transaction data ready to be signed and sent
    func getSwapTransaction(
        chainId: Int,
        fromToken: String,
        toToken: String,
        amount: String,
        fromAddress: String,
        slippage: Double = 1.0
    ) async throws -> SwapTransaction {
        let url = "\(baseURL)/\(chainId)/swap"
        var components = URLComponents(string: url)!
        components.queryItems = [
            URLQueryItem(name: "src", value: fromToken),
            URLQueryItem(name: "dst", value: toToken),
            URLQueryItem(name: "amount", value: amount),
            URLQueryItem(name: "from", value: fromAddress),
            URLQueryItem(name: "slippage", value: String(slippage)),
        ]

        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw DEXError.networkError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            throw DEXError.apiError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        let swapResponse = try JSONDecoder().decode(SwapResponse.self, from: data)

        return SwapTransaction(
            from: swapResponse.tx.from,
            to: swapResponse.tx.to,
            data: swapResponse.tx.data,
            value: swapResponse.tx.value,
            gas: swapResponse.tx.gas,
            gasPrice: swapResponse.tx.gasPrice,
            fromAmount: amount,
            toAmount: swapResponse.dstAmount
        )
    }
}

// MARK: - Models

struct SwapQuote {
    let fromToken: String
    let toToken: String
    let fromAmount: String
    let toAmount: String
    let estimatedGas: Int
    let protocols: [[Protocol]]

    struct Protocol {
        let name: String
        let part: Double
    }
}

struct SwapTransaction {
    let from: String
    let to: String
    let data: String
    let value: String
    let gas: Int
    let gasPrice: String
    let fromAmount: String
    let toAmount: String
}

// MARK: - API Response Models

private struct QuoteResponse: Codable {
    let dstAmount: String
    let gas: Int
    let protocols: [[[ProtocolStep]]]?

    struct ProtocolStep: Codable {
        let name: String
        let part: Double
    }
}

private struct SwapResponse: Codable {
    let dstAmount: String
    let tx: TxData

    struct TxData: Codable {
        let from: String
        let to: String
        let data: String
        let value: String
        let gas: Int
        let gasPrice: String
    }
}

// MARK: - Errors

enum DEXError: LocalizedError {
    case networkError(String)
    case apiError(statusCode: Int, message: String)
    case insufficientBalance
    case invalidToken

    var errorDescription: String? {
        switch self {
        case .networkError(let msg):
            return "网络错误: \(msg)"
        case .apiError(let code, let msg):
            return "API 错误 (\(code)): \(msg)"
        case .insufficientBalance:
            return "余额不足"
        case .invalidToken:
            return "无效的代币地址"
        }
    }
}
