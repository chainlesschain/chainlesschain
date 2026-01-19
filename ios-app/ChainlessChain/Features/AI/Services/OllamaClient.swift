import Foundation

/// Ollama API Client
class OllamaClient: LLMClient {
    private let baseURL: String
    private let model: String
    private let timeout: TimeInterval
    private let session: URLSession

    init(config: LLMManager.LLMConfig) {
        self.baseURL = config.baseURL
        self.model = config.model
        self.timeout = config.timeout

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        self.session = URLSession(configuration: configuration)
    }

    func checkStatus() async throws -> ServiceStatus {
        guard let url = URL(string: "\(baseURL)/api/tags") else {
            return ServiceStatus(available: false, models: [], error: "Invalid URL")
        }

        do {
            let (data, _) = try await session.data(from: url)
            let response = try JSONDecoder().decode(TagsResponse.self, from: data)

            let models = response.models.map { $0.name }
            return ServiceStatus(available: true, models: models, error: nil)
        } catch {
            return ServiceStatus(available: false, models: [], error: error.localizedDescription)
        }
    }

    func chat(messages: [LLMMessage], options: ChatOptions) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw LLMError.networkError("Invalid URL")
        }

        let requestBody = ChatRequest(
            model: options.model ?? model,
            messages: messages,
            stream: false,
            options: OllamaOptions(
                temperature: options.temperature,
                top_p: options.topP
            )
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw LLMError.apiError("HTTP error: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }

        let chatResponse = try JSONDecoder().decode(ChatResponse.self, from: data)

        return LLMResponse(
            text: chatResponse.message.content,
            model: chatResponse.model,
            tokens: chatResponse.eval_count ?? 0,
            usage: nil,
            timestamp: Date()
        )
    }

    func chatStream(
        messages: [LLMMessage],
        options: ChatOptions,
        onChunk: @escaping (String) -> Void
    ) async throws -> LLMResponse {
        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw LLMError.networkError("Invalid URL")
        }

        let requestBody = ChatRequest(
            model: options.model ?? model,
            messages: messages,
            stream: true,
            options: OllamaOptions(
                temperature: options.temperature,
                top_p: options.topP
            )
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (asyncBytes, response) = try await session.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw LLMError.apiError("HTTP error: \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }

        var fullText = ""
        var lastModel: String?
        var totalTokens = 0

        for try await line in asyncBytes.lines {
            guard !line.isEmpty else { continue }

            if let data = line.data(using: .utf8),
               let chunk = try? JSONDecoder().decode(ChatResponse.self, from: data) {

                if let content = chunk.message.content, !content.isEmpty {
                    fullText += content
                    onChunk(content)
                }

                lastModel = chunk.model
                if let evalCount = chunk.eval_count {
                    totalTokens = evalCount
                }

                if chunk.done {
                    break
                }
            }
        }

        return LLMResponse(
            text: fullText,
            model: lastModel,
            tokens: totalTokens,
            usage: nil,
            timestamp: Date()
        )
    }

    // MARK: - Request/Response Types

    private struct TagsResponse: Codable {
        let models: [ModelInfo]

        struct ModelInfo: Codable {
            let name: String
            let size: Int64?
            let modified_at: String?
        }
    }

    private struct ChatRequest: Codable {
        let model: String
        let messages: [LLMMessage]
        let stream: Bool
        let options: OllamaOptions?
    }

    private struct OllamaOptions: Codable {
        let temperature: Double
        let top_p: Double
    }

    private struct ChatResponse: Codable {
        let model: String
        let message: MessageContent
        let done: Bool
        let eval_count: Int?

        struct MessageContent: Codable {
            let role: String?
            let content: String?
        }
    }
}
