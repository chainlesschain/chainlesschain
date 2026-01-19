import Foundation

/// Anthropic (Claude) API Client
class AnthropicClient: LLMClient {
    private let apiKey: String?
    private let baseURL: String
    private let model: String
    private let timeout: TimeInterval
    private let anthropicVersion: String
    private let maxTokens: Int
    private let session: URLSession

    init(config: LLMManager.LLMConfig) {
        self.apiKey = config.apiKey
        self.baseURL = config.baseURL == "http://localhost:11434" ? "https://api.anthropic.com/v1" : config.baseURL
        self.model = config.model == "qwen2:7b" ? "claude-3-5-sonnet-20241022" : config.model
        self.timeout = config.timeout
        self.anthropicVersion = "2023-06-01"
        self.maxTokens = 4096

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        self.session = URLSession(configuration: configuration)
    }

    func checkStatus() async throws -> ServiceStatus {
        // Anthropic doesn't have a models endpoint, return predefined models
        let models = [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307"
        ]

        return ServiceStatus(available: apiKey != nil, models: models, error: apiKey == nil ? "API key required" : nil)
    }

    func chat(messages: [LLMMessage], options: ChatOptions) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/messages") else {
            throw LLMError.networkError("Invalid URL")
        }

        // Convert messages to Anthropic format
        let (system, anthropicMessages) = convertMessages(messages)

        let requestBody = MessagesRequest(
            model: options.model ?? model,
            max_tokens: options.maxTokens ?? maxTokens,
            temperature: options.temperature,
            top_p: options.topP,
            system: system,
            messages: anthropicMessages,
            stream: false
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anthropicVersion, forHTTPHeaderField: "anthropic-version")
        if let apiKey = apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
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

        let messagesResponse = try JSONDecoder().decode(MessagesResponse.self, from: data)

        // Extract text from content blocks
        let text = messagesResponse.content.compactMap { block in
            if case .text(let textBlock) = block {
                return textBlock.text
            }
            return nil
        }.joined()

        return LLMResponse(
            text: text,
            model: messagesResponse.model,
            tokens: messagesResponse.usage.input_tokens + messagesResponse.usage.output_tokens,
            usage: LLMResponse.TokenUsage(
                promptTokens: messagesResponse.usage.input_tokens,
                completionTokens: messagesResponse.usage.output_tokens,
                totalTokens: messagesResponse.usage.input_tokens + messagesResponse.usage.output_tokens
            ),
            timestamp: Date()
        )
    }

    func chatStream(
        messages: [LLMMessage],
        options: ChatOptions,
        onChunk: @escaping (String) -> Void
    ) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/messages") else {
            throw LLMError.networkError("Invalid URL")
        }

        // Convert messages to Anthropic format
        let (system, anthropicMessages) = convertMessages(messages)

        let requestBody = MessagesRequest(
            model: options.model ?? model,
            max_tokens: options.maxTokens ?? maxTokens,
            temperature: options.temperature,
            top_p: options.topP,
            system: system,
            messages: anthropicMessages,
            stream: true
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anthropicVersion, forHTTPHeaderField: "anthropic-version")
        if let apiKey = apiKey {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        }
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (asyncBytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw LLMError.apiError("HTTP error: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }

        var fullText = ""
        var lastModel: String?
        var inputTokens = 0
        var outputTokens = 0

        for try await line in asyncBytes.lines {
            guard line.hasPrefix("data: ") else { continue }

            let data = line.dropFirst(6) // Remove "data: " prefix

            guard let jsonData = data.data(using: .utf8),
                  let event = try? JSONDecoder().decode(StreamEvent.self, from: jsonData) else {
                continue
            }

            switch event.type {
            case "content_block_delta":
                if let delta = event.delta,
                   case .textDelta(let textDelta) = delta {
                    fullText += textDelta.text
                    onChunk(textDelta.text)
                }

            case "message_start":
                if let message = event.message {
                    lastModel = message.model
                    inputTokens = message.usage.input_tokens
                }

            case "message_delta":
                if let usage = event.usage {
                    outputTokens = usage.output_tokens
                }

            case "message_stop":
                break

            default:
                break
            }
        }

        return LLMResponse(
            text: fullText,
            model: lastModel,
            tokens: inputTokens + outputTokens,
            usage: LLMResponse.TokenUsage(
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens
            ),
            timestamp: Date()
        )
    }

    // MARK: - Helper Methods

    private func convertMessages(_ messages: [LLMMessage]) -> (String?, [AnthropicMessage]) {
        var system: String?
        var anthropicMessages: [AnthropicMessage] = []

        for message in messages {
            if message.role == "system" {
                system = message.content
            } else {
                anthropicMessages.append(AnthropicMessage(
                    role: message.role,
                    content: [.text(TextContent(text: message.content))]
                ))
            }
        }

        return (system, anthropicMessages)
    }

    // MARK: - Request/Response Types

    private struct MessagesRequest: Codable {
        let model: String
        let max_tokens: Int
        let temperature: Double?
        let top_p: Double?
        let system: String?
        let messages: [AnthropicMessage]
        let stream: Bool
    }

    private struct AnthropicMessage: Codable {
        let role: String
        let content: [ContentBlock]
    }

    private enum ContentBlock: Codable {
        case text(TextContent)

        enum CodingKeys: String, CodingKey {
            case type, text
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let type = try container.decode(String.self, forKey: .type)

            switch type {
            case "text":
                let text = try container.decode(String.self, forKey: .text)
                self = .text(TextContent(text: text))
            default:
                throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown content type")
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)

            switch self {
            case .text(let textContent):
                try container.encode("text", forKey: .type)
                try container.encode(textContent.text, forKey: .text)
            }
        }
    }

    private struct TextContent: Codable {
        let text: String
    }

    private struct MessagesResponse: Codable {
        let id: String
        let type: String
        let role: String
        let content: [ContentBlock]
        let model: String
        let stop_reason: String?
        let usage: Usage

        struct Usage: Codable {
            let input_tokens: Int
            let output_tokens: Int
        }
    }

    private struct StreamEvent: Codable {
        let type: String
        let message: MessageInfo?
        let delta: Delta?
        let usage: UsageInfo?

        struct MessageInfo: Codable {
            let model: String
            let usage: UsageInfo
        }

        struct UsageInfo: Codable {
            let input_tokens: Int
            let output_tokens: Int
        }

        enum Delta: Codable {
            case textDelta(TextDelta)

            struct TextDelta: Codable {
                let text: String
            }

            enum CodingKeys: String, CodingKey {
                case type, text
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                let type = try container.decode(String.self, forKey: .type)

                switch type {
                case "text_delta":
                    let text = try container.decode(String.self, forKey: .text)
                    self = .textDelta(TextDelta(text: text))
                default:
                    throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown delta type")
                }
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)

                switch self {
                case .textDelta(let textDelta):
                    try container.encode("text_delta", forKey: .type)
                    try container.encode(textDelta.text, forKey: .text)
                }
            }
        }
    }

    private struct ErrorResponse: Codable {
        let error: ErrorDetail

        struct ErrorDetail: Codable {
            let message: String
            let type: String
        }
    }
}
