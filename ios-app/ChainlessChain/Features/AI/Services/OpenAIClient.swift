import Foundation

/// OpenAI-compatible API Client (supports OpenAI, DeepSeek, Volcengine, Custom)
class OpenAIClient: LLMClient {
    private let apiKey: String?
    private let baseURL: String
    private let model: String
    private let timeout: TimeInterval
    private let session: URLSession

    init(config: LLMManager.LLMConfig) {
        self.apiKey = config.apiKey
        self.baseURL = config.baseURL
        self.model = config.model
        self.timeout = config.timeout

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        self.session = URLSession(configuration: configuration)
    }

    func checkStatus() async throws -> ServiceStatus {
        guard let url = URL(string: "\(baseURL)/models") else {
            return ServiceStatus(available: false, models: [], error: "Invalid URL")
        }

        var request = URLRequest(url: url)
        if let apiKey = apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, _) = try await session.data(for: request)
            let response = try JSONDecoder().decode(ModelsResponse.self, from: data)

            let models = response.data.map { $0.id }
            return ServiceStatus(available: true, models: models, error: nil)
        } catch {
            return ServiceStatus(available: false, models: [], error: error.localizedDescription)
        }
    }

    func chat(messages: [LLMMessage], options: ChatOptions) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/chat/completions") else {
            throw LLMError.networkError("Invalid URL")
        }

        let requestBody = ChatCompletionRequest(
            model: options.model ?? model,
            messages: messages,
            temperature: options.temperature,
            top_p: options.topP,
            max_tokens: options.maxTokens,
            stream: false
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey = apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            // Try to parse error message
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                throw LLMError.apiError(errorResponse.error.message)
            }
            throw LLMError.apiError("HTTP error: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }

        let chatResponse = try JSONDecoder().decode(ChatCompletionResponse.self, from: data)

        guard let choice = chatResponse.choices.first else {
            throw LLMError.invalidResponse
        }

        return LLMResponse(
            text: choice.message.content,
            model: chatResponse.model,
            tokens: chatResponse.usage.total_tokens,
            usage: LLMResponse.TokenUsage(
                promptTokens: chatResponse.usage.prompt_tokens,
                completionTokens: chatResponse.usage.completion_tokens,
                totalTokens: chatResponse.usage.total_tokens
            ),
            timestamp: Date()
        )
    }

    func chatStream(
        messages: [LLMMessage],
        options: ChatOptions,
        onChunk: @escaping (String) -> Void
    ) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/chat/completions") else {
            throw LLMError.networkError("Invalid URL")
        }

        let requestBody = ChatCompletionRequest(
            model: options.model ?? model,
            messages: messages,
            temperature: options.temperature,
            top_p: options.topP,
            max_tokens: options.maxTokens,
            stream: true
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey = apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (asyncBytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw LLMError.apiError("HTTP error: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }

        var fullText = ""
        var lastModel: String?

        for try await line in asyncBytes.lines {
            guard line.hasPrefix("data: ") else { continue }

            let data = line.dropFirst(6) // Remove "data: " prefix

            if data == "[DONE]" {
                break
            }

            guard let jsonData = data.data(using: .utf8),
                  let chunk = try? JSONDecoder().decode(ChatCompletionChunk.self, from: jsonData) else {
                continue
            }

            if let delta = chunk.choices.first?.delta,
               let content = delta.content {
                fullText += content
                onChunk(content)
            }

            lastModel = chunk.model
        }

        return LLMResponse(
            text: fullText,
            model: lastModel,
            tokens: 0, // Streaming doesn't provide token count
            usage: nil,
            timestamp: Date()
        )
    }

    // MARK: - Request/Response Types

    private struct ModelsResponse: Codable {
        let data: [ModelInfo]

        struct ModelInfo: Codable {
            let id: String
            let created: Int?
            let owned_by: String?
        }
    }

    private struct ChatCompletionRequest: Codable {
        let model: String
        let messages: [LLMMessage]
        let temperature: Double
        let top_p: Double
        let max_tokens: Int?
        let stream: Bool
    }

    private struct ChatCompletionResponse: Codable {
        let id: String
        let model: String
        let choices: [Choice]
        let usage: Usage

        struct Choice: Codable {
            let message: Message
            let finish_reason: String?

            struct Message: Codable {
                let role: String
                let content: String
            }
        }

        struct Usage: Codable {
            let prompt_tokens: Int
            let completion_tokens: Int
            let total_tokens: Int
        }
    }

    private struct ChatCompletionChunk: Codable {
        let id: String
        let model: String
        let choices: [ChunkChoice]

        struct ChunkChoice: Codable {
            let delta: Delta
            let finish_reason: String?

            struct Delta: Codable {
                let role: String?
                let content: String?
            }
        }
    }

    private struct ErrorResponse: Codable {
        let error: ErrorDetail

        struct ErrorDetail: Codable {
            let message: String
            let type: String?
            let code: String?
        }
    }
}

/// DeepSeek Client (uses OpenAI-compatible API)
class DeepSeekClient: OpenAIClient {
    init(config: LLMManager.LLMConfig) {
        var deepseekConfig = config
        if deepseekConfig.baseURL == "http://localhost:11434" {
            deepseekConfig.baseURL = "https://api.deepseek.com/v1"
        }
        if deepseekConfig.model == "qwen2:7b" {
            deepseekConfig.model = "deepseek-chat"
        }
        super.init(config: deepseekConfig)
    }
}

/// Volcengine Client (uses OpenAI-compatible API)
class VolcengineClient: OpenAIClient {
    init(config: LLMManager.LLMConfig) {
        var volcengineConfig = config
        if volcengineConfig.baseURL == "http://localhost:11434" {
            volcengineConfig.baseURL = "https://ark.cn-beijing.volces.com/api/v3"
        }
        if volcengineConfig.model == "qwen2:7b" {
            volcengineConfig.model = "doubao-pro-32k"
        }
        super.init(config: volcengineConfig)
    }
}

/// Custom Client (uses OpenAI-compatible API)
class CustomClient: OpenAIClient {}
