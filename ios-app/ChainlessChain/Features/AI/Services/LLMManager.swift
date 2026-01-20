import Foundation
import Combine
import CoreCommon

/// LLM Provider types
enum LLMProvider: String, Codable {
    case ollama
    case openai
    case anthropic
    case deepseek
    case volcengine
    case custom
}

/// LLM Message structure
struct LLMMessage: Codable {
    let role: String  // "user", "assistant", "system"
    let content: String

    init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

/// LLM Response structure
struct LLMResponse {
    let text: String
    let model: String?
    let tokens: Int
    let usage: TokenUsage?
    let timestamp: Date

    struct TokenUsage: Codable {
        let promptTokens: Int
        let completionTokens: Int
        let totalTokens: Int

        enum CodingKeys: String, CodingKey {
            case promptTokens = "prompt_tokens"
            case completionTokens = "completion_tokens"
            case totalTokens = "total_tokens"
        }
    }
}

/// LLM Manager - Unified interface for multiple LLM providers
@MainActor
class LLMManager: ObservableObject {
    // MARK: - Singleton
    static let shared = LLMManager()

    // MARK: - Published Properties
    @Published var isInitialized = false
    @Published var currentProvider: LLMProvider = .ollama
    @Published var availableModels: [String] = []

    // MARK: - Private Properties
    private var client: LLMClient?
    private var conversationContext: [String: [LLMMessage]] = [:]
    private var conversationAccessOrder: [String] = []  // LRU tracking
    private var config: LLMConfig
    private let logger = Logger.shared

    // MARK: - Context Limits
    private let maxConversations = 50
    private let maxMessagesPerConversation = 100

    // MARK: - Configuration
    struct LLMConfig {
        var provider: LLMProvider
        var apiKey: String?
        var baseURL: String
        var model: String
        var timeout: TimeInterval

        static var `default`: LLMConfig {
            LLMConfig(
                provider: .ollama,
                apiKey: nil,
                baseURL: "http://localhost:11434",
                model: "qwen2:7b",
                timeout: 120
            )
        }
    }

    // MARK: - Initialization
    private init() {
        self.config = .default
        loadConfig()
    }

    /// Initialize the LLM manager with current configuration
    func initialize() async throws {
        logger.debug("[LLMManager] Initializing with provider: \(config.provider)")

        // Create appropriate client based on provider
        switch config.provider {
        case .ollama:
            client = OllamaClient(config: config)
        case .openai:
            client = OpenAIClient(config: config)
        case .anthropic:
            client = AnthropicClient(config: config)
        case .deepseek:
            client = DeepSeekClient(config: config)
        case .volcengine:
            client = VolcengineClient(config: config)
        case .custom:
            client = CustomClient(config: config)
        }

        // Check service status
        let status = try await client?.checkStatus()
        isInitialized = status?.available == true
        availableModels = status?.models ?? []

        logger.debug("[LLMManager] Initialized: \(isInitialized)")
        logger.debug("[LLMManager] Available models: \(availableModels.count)")
    }

    /// Switch to a different provider
    func switchProvider(_ provider: LLMProvider, apiKey: String? = nil, baseURL: String? = nil, model: String? = nil) async throws {
        logger.debug("[LLMManager] Switching provider to: \(provider)")

        config.provider = provider
        if let apiKey = apiKey {
            config.apiKey = apiKey
        }
        if let baseURL = baseURL {
            config.baseURL = baseURL
        }
        if let model = model {
            config.model = model
        }

        currentProvider = provider
        saveConfig()

        try await initialize()
    }

    // MARK: - Chat Methods

    /// Send a chat message (non-streaming)
    func chat(messages: [LLMMessage], options: ChatOptions = .default) async throws -> LLMResponse {
        guard isInitialized, let client = client else {
            throw LLMError.notInitialized
        }

        return try await client.chat(messages: messages, options: options)
    }

    /// Send a chat message (streaming)
    func chatStream(
        messages: [LLMMessage],
        options: ChatOptions = .default,
        onChunk: @escaping (String) -> Void
    ) async throws -> LLMResponse {
        guard isInitialized, let client = client else {
            throw LLMError.notInitialized
        }

        return try await client.chatStream(messages: messages, options: options, onChunk: onChunk)
    }

    /// Send a simple query with conversation context
    func query(
        prompt: String,
        conversationId: String? = nil,
        systemPrompt: String? = nil,
        options: ChatOptions = .default
    ) async throws -> LLMResponse {
        var messages: [LLMMessage] = []

        // Add conversation history if exists
        if let conversationId = conversationId,
           let context = conversationContext[conversationId] {
            messages.append(contentsOf: context)
        }

        // Add system prompt if provided
        if let systemPrompt = systemPrompt {
            messages.insert(LLMMessage(role: "system", content: systemPrompt), at: 0)
        }

        // Add user message
        messages.append(LLMMessage(role: "user", content: prompt))

        let response = try await chat(messages: messages, options: options)

        // Update conversation context
        if let conversationId = conversationId {
            updateConversationContext(
                conversationId: conversationId,
                userMessage: prompt,
                assistantMessage: response.text
            )
        }

        return response
    }

    /// Send a streaming query with conversation context
    func queryStream(
        prompt: String,
        conversationId: String? = nil,
        systemPrompt: String? = nil,
        options: ChatOptions = .default,
        onChunk: @escaping (String) -> Void
    ) async throws -> LLMResponse {
        var messages: [LLMMessage] = []

        // Add conversation history if exists
        if let conversationId = conversationId,
           let context = conversationContext[conversationId] {
            messages.append(contentsOf: context)
        }

        // Add system prompt if provided
        if let systemPrompt = systemPrompt {
            messages.insert(LLMMessage(role: "system", content: systemPrompt), at: 0)
        }

        // Add user message
        messages.append(LLMMessage(role: "user", content: prompt))

        let response = try await chatStream(messages: messages, options: options, onChunk: onChunk)

        // Update conversation context
        if let conversationId = conversationId {
            updateConversationContext(
                conversationId: conversationId,
                userMessage: prompt,
                assistantMessage: response.text
            )
        }

        return response
    }

    // MARK: - Context Management

    /// Update conversation context with bounds checking
    private func updateConversationContext(conversationId: String, userMessage: String, assistantMessage: String) {
        // Update LRU order
        if let index = conversationAccessOrder.firstIndex(of: conversationId) {
            conversationAccessOrder.remove(at: index)
        }
        conversationAccessOrder.append(conversationId)

        // Initialize if needed
        if conversationContext[conversationId] == nil {
            conversationContext[conversationId] = []
        }

        // Add new messages
        conversationContext[conversationId]?.append(LLMMessage(role: "user", content: userMessage))
        conversationContext[conversationId]?.append(LLMMessage(role: "assistant", content: assistantMessage))

        // Trim messages if over limit (keep most recent)
        if let count = conversationContext[conversationId]?.count, count > maxMessagesPerConversation {
            let excess = count - maxMessagesPerConversation
            conversationContext[conversationId]?.removeFirst(excess)
            logger.debug("[LLMManager] Trimmed \(excess) old messages from conversation: \(conversationId)")
        }

        // Prune oldest conversations if over limit
        pruneConversationsIfNeeded()
    }

    /// Remove oldest conversations when limit exceeded
    private func pruneConversationsIfNeeded() {
        guard conversationContext.count > maxConversations else { return }

        let toRemove = conversationContext.count - maxConversations
        let conversationsToRemove = Array(conversationAccessOrder.prefix(toRemove))

        for conversationId in conversationsToRemove {
            conversationContext.removeValue(forKey: conversationId)
            if let index = conversationAccessOrder.firstIndex(of: conversationId) {
                conversationAccessOrder.remove(at: index)
            }
        }

        logger.debug("[LLMManager] Pruned \(toRemove) old conversations, remaining: \(conversationContext.count)")
    }

    /// Clear conversation context
    func clearContext(conversationId: String? = nil) {
        if let conversationId = conversationId {
            conversationContext.removeValue(forKey: conversationId)
            if let index = conversationAccessOrder.firstIndex(of: conversationId) {
                conversationAccessOrder.remove(at: index)
            }
        } else {
            conversationContext.removeAll()
            conversationAccessOrder.removeAll()
        }
    }

    /// Get conversation context
    func getContext(conversationId: String) -> [LLMMessage]? {
        return conversationContext[conversationId]
    }

    // MARK: - Embeddings

    /// Generate text embedding vector
    /// - Parameter text: Text to embed
    /// - Returns: Embedding vector (array of floats)
    func generateEmbedding(_ text: String) async throws -> [Float] {
        guard isInitialized, let client = client else {
            throw LLMError.notInitialized
        }

        // Check if client supports embeddings
        if let embeddingClient = client as? EmbeddingCapable {
            return try await embeddingClient.generateEmbedding(text)
        }

        // Fallback: Use Ollama's embedding endpoint if available
        if config.provider == .ollama {
            return try await generateOllamaEmbedding(text)
        }

        // If no embedding support, throw error
        throw LLMError.embeddingsNotSupported
    }

    /// Generate embedding using Ollama's embedding endpoint
    private func generateOllamaEmbedding(_ text: String) async throws -> [Float] {
        guard let url = URL(string: "\(config.baseURL)/api/embeddings") else {
            throw LLMError.invalidConfiguration("Invalid embeddings URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = config.timeout

        let body: [String: Any] = [
            "model": config.model,
            "prompt": text
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw LLMError.networkError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            throw LLMError.apiError(httpResponse.statusCode, "Embedding generation failed")
        }

        struct EmbeddingResponse: Codable {
            let embedding: [Float]
        }

        let embeddingResponse = try JSONDecoder().decode(EmbeddingResponse.self, from: data)
        return embeddingResponse.embedding
    }

    // MARK: - Status Check

    /// Check LLM service status
    func checkStatus() async throws -> ServiceStatus {
        guard let client = client else {
            return ServiceStatus(available: false, models: [], error: "Client not initialized")
        }

        return try await client.checkStatus()
    }

    // MARK: - Configuration Persistence

    private func loadConfig() {
        if let data = UserDefaults.standard.data(forKey: "llm_config"),
           let savedConfig = try? JSONDecoder().decode(SavedConfig.self, from: data) {
            config.provider = savedConfig.provider
            config.apiKey = savedConfig.apiKey
            config.baseURL = savedConfig.baseURL
            config.model = savedConfig.model
            currentProvider = savedConfig.provider
        }
    }

    private func saveConfig() {
        let savedConfig = SavedConfig(
            provider: config.provider,
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            model: config.model
        )

        if let data = try? JSONEncoder().encode(savedConfig) {
            UserDefaults.standard.set(data, forKey: "llm_config")
        }
    }

    private struct SavedConfig: Codable {
        let provider: LLMProvider
        let apiKey: String?
        let baseURL: String
        let model: String
    }
}

// MARK: - Supporting Types

/// Chat options for LLM requests
struct ChatOptions {
    var temperature: Double
    var topP: Double
    var maxTokens: Int?
    var model: String?

    static var `default`: ChatOptions {
        ChatOptions(temperature: 0.7, topP: 0.9, maxTokens: nil, model: nil)
    }
}

/// Service status structure
struct ServiceStatus {
    let available: Bool
    let models: [String]
    let error: String?
}

/// LLM Errors
enum LLMError: LocalizedError {
    case notInitialized
    case networkError(String)
    case apiError(Int, String)
    case invalidResponse
    case timeout
    case embeddingsNotSupported

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "LLM service not initialized"
        case .networkError(let message):
            return "Network error: \(message)"
        case .apiError(let code, let message):
            return "API error (\(code)): \(message)"
        case .invalidResponse:
            return "Invalid response from LLM service"
        case .timeout:
            return "Request timeout"
        case .embeddingsNotSupported:
            return "Embeddings not supported by current provider"
        }
    }
}

// MARK: - LLM Client Protocol

protocol LLMClient {
    func checkStatus() async throws -> ServiceStatus
    func chat(messages: [LLMMessage], options: ChatOptions) async throws -> LLMResponse
    func chatStream(messages: [LLMMessage], options: ChatOptions, onChunk: @escaping (String) -> Void) async throws -> LLMResponse
}

/// Protocol for LLM clients that support embeddings
protocol EmbeddingCapable {
    func generateEmbedding(_ text: String) async throws -> [Float]
}
