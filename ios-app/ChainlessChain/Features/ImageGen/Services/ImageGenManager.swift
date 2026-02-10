import Foundation
import UIKit
import Combine

// MARK: - ImageGenManager
/// Central manager for image generation
/// Ported from PC: image-gen/image-gen-manager.js
///
/// Features:
/// - Multi-provider support
/// - Request queue management
/// - Progress tracking
/// - History and caching
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Image Gen Manager Delegate

protocol ImageGenManagerDelegate: AnyObject {
    func imageGenManager(_ manager: ImageGenManager, didStartRequest requestId: String)
    func imageGenManager(_ manager: ImageGenManager, didUpdateProgress progress: ImageGenProgress)
    func imageGenManager(_ manager: ImageGenManager, didComplete result: ImageGenResult)
    func imageGenManager(_ manager: ImageGenManager, didFail error: ImageGenError, requestId: String)
}

// MARK: - Image Gen Manager

@MainActor
class ImageGenManager: ObservableObject {

    // MARK: - Singleton

    static let shared = ImageGenManager()

    // MARK: - Properties

    private let logger = Logger.shared

    /// Configuration
    @Published var configuration: ImageGenConfiguration

    /// Current state
    @Published private(set) var state: ImageGenState = .idle

    /// Active requests
    @Published private(set) var activeRequests: [String: ImageGenRequest] = [:]

    /// Generation history
    @Published private(set) var history: [ImageGenHistoryEntry] = []

    /// Statistics
    @Published private(set) var statistics = ImageGenStatistics()

    /// API clients
    private var openAIClient: OpenAIImageClient?
    private var stabilityClient: StabilityAIClient?
    private var replicateClient: ReplicateClient?

    /// API keys
    private var apiKeys: [ImageGenProvider: String] = [:]

    /// Delegate
    weak var delegate: ImageGenManagerDelegate?

    /// Event publishers
    let requestStarted = PassthroughSubject<String, Never>()
    let progressUpdated = PassthroughSubject<ImageGenProgress, Never>()
    let generationCompleted = PassthroughSubject<ImageGenResult, Never>()
    let generationFailed = PassthroughSubject<(String, ImageGenError), Never>()

    /// Cache
    private var imageCache: [String: GeneratedImage] = [:]
    private let maxCacheSize = 50

    /// Cancellation tokens
    private var cancellationTokens: [String: Bool] = [:]

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.configuration = ImageGenConfiguration()
        loadHistory()
    }

    // MARK: - Configuration

    /// Configure API key for provider
    func configureAPIKey(_ key: String, for provider: ImageGenProvider) {
        apiKeys[provider] = key

        // Initialize appropriate client
        switch provider {
        case .openai:
            openAIClient = OpenAIImageClient(apiKey: key)
        case .stability:
            stabilityClient = StabilityAIClient(apiKey: key)
        case .replicate:
            replicateClient = ReplicateClient(apiKey: key)
        default:
            break
        }

        logger.info("[ImageGenManager] API key configured for \(provider.displayName)")
    }

    /// Update configuration
    func updateConfiguration(_ config: ImageGenConfiguration) {
        self.configuration = config
    }

    // MARK: - Generation

    /// Generate images from prompt
    func generate(_ request: ImageGenRequest) async throws -> ImageGenResult {
        logger.info("[ImageGenManager] Starting generation: \(request.prompt.prefix(50))...")

        // Check API key
        guard apiKeys[configuration.provider] != nil else {
            throw ImageGenError.noAPIKey
        }

        // Track request
        activeRequests[request.id] = request
        cancellationTokens[request.id] = false
        state = .generating

        requestStarted.send(request.id)
        delegate?.imageGenManager(self, didStartRequest: request.id)

        do {
            // Generate based on provider
            let result = try await generateWithProvider(request)

            // Update state
            activeRequests.removeValue(forKey: request.id)
            cancellationTokens.removeValue(forKey: request.id)
            state = .completed

            // Update statistics
            if let duration = result.durationSeconds {
                statistics.recordSuccess(imageCount: result.images.count, duration: duration)
            }

            // Save to history
            let historyEntry = ImageGenHistoryEntry(request: request, result: result)
            history.insert(historyEntry, at: 0)
            if history.count > 100 {
                history = Array(history.prefix(100))
            }
            saveHistory()

            // Cache images
            if configuration.cacheGeneratedImages {
                for image in result.images {
                    cacheImage(image)
                }
            }

            generationCompleted.send(result)
            delegate?.imageGenManager(self, didComplete: result)

            logger.info("[ImageGenManager] Generation completed: \(result.images.count) images")

            return result

        } catch let error as ImageGenError {
            handleError(error, requestId: request.id)
            throw error
        } catch {
            let genError = ImageGenError.generationFailed(error.localizedDescription)
            handleError(genError, requestId: request.id)
            throw genError
        }
    }

    /// Generate based on current provider
    private func generateWithProvider(_ request: ImageGenRequest) async throws -> ImageGenResult {
        switch configuration.provider {
        case .openai:
            return try await generateWithOpenAI(request)
        case .stability:
            return try await generateWithStability(request)
        case .replicate:
            return try await generateWithReplicate(request)
        case .midjourney:
            throw ImageGenError.modelUnavailable(.mj5)
        case .huggingface:
            return try await generateWithHuggingFace(request)
        }
    }

    // MARK: - OpenAI DALL-E

    private func generateWithOpenAI(_ request: ImageGenRequest) async throws -> ImageGenResult {
        guard let client = openAIClient else {
            throw ImageGenError.noAPIKey
        }

        // Check cancellation
        guard cancellationTokens[request.id] != true else {
            throw ImageGenError.cancelled
        }

        // Report progress
        reportProgress(request.id, state: .generating, progress: 0.1, message: "Sending to DALL-E...")

        let images = try await client.generate(request)

        reportProgress(request.id, state: .postProcessing, progress: 0.9, message: "Processing results...")

        var result = ImageGenResult(
            requestId: request.id,
            images: images,
            state: .completed
        )
        result.complete()

        return result
    }

    // MARK: - Stability AI

    private func generateWithStability(_ request: ImageGenRequest) async throws -> ImageGenResult {
        guard let client = stabilityClient else {
            throw ImageGenError.noAPIKey
        }

        guard cancellationTokens[request.id] != true else {
            throw ImageGenError.cancelled
        }

        reportProgress(request.id, state: .generating, progress: 0.1, message: "Sending to Stable Diffusion...")

        let images = try await client.generate(request)

        var result = ImageGenResult(
            requestId: request.id,
            images: images,
            state: .completed
        )
        result.complete()

        return result
    }

    // MARK: - Replicate

    private func generateWithReplicate(_ request: ImageGenRequest) async throws -> ImageGenResult {
        guard let client = replicateClient else {
            throw ImageGenError.noAPIKey
        }

        guard cancellationTokens[request.id] != true else {
            throw ImageGenError.cancelled
        }

        reportProgress(request.id, state: .generating, progress: 0.1, message: "Sending to Replicate...")

        let images = try await client.generate(request)

        var result = ImageGenResult(
            requestId: request.id,
            images: images,
            state: .completed
        )
        result.complete()

        return result
    }

    // MARK: - HuggingFace

    private func generateWithHuggingFace(_ request: ImageGenRequest) async throws -> ImageGenResult {
        // HuggingFace Inference API
        guard let apiKey = apiKeys[.huggingface] else {
            throw ImageGenError.noAPIKey
        }

        guard cancellationTokens[request.id] != true else {
            throw ImageGenError.cancelled
        }

        reportProgress(request.id, state: .generating, progress: 0.1, message: "Sending to HuggingFace...")

        let modelId = "stabilityai/stable-diffusion-2-1"
        let url = URL(string: "https://api-inference.huggingface.co/models/\(modelId)")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "inputs": request.prompt,
            "parameters": [
                "negative_prompt": request.negativePrompt ?? "",
                "num_inference_steps": request.steps ?? 30,
                "guidance_scale": request.guidanceScale ?? 7.5
            ]
        ]
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ImageGenError.networkError("Invalid response")
        }

        if httpResponse.statusCode == 503 {
            throw ImageGenError.modelUnavailable(request.model)
        }

        guard httpResponse.statusCode == 200 else {
            throw ImageGenError.generationFailed("HTTP \(httpResponse.statusCode)")
        }

        let generatedImage = GeneratedImage(
            requestId: request.id,
            imageData: data,
            model: request.model,
            size: request.size,
            seed: request.seed
        )

        var result = ImageGenResult(
            requestId: request.id,
            images: [generatedImage],
            state: .completed
        )
        result.complete()

        return result
    }

    // MARK: - Image Variations

    /// Generate variations of an image
    func generateVariations(_ variationRequest: ImageVariationRequest) async throws -> ImageGenResult {
        logger.info("[ImageGenManager] Generating \(variationRequest.numberOfVariations) variations")

        guard apiKeys[configuration.provider] != nil else {
            throw ImageGenError.noAPIKey
        }

        // For OpenAI, use the variations endpoint
        if configuration.provider == .openai, let client = openAIClient {
            return try await client.generateVariations(variationRequest)
        }

        // For other providers, use img2img
        let request = ImageGenRequest(
            prompt: "variation",
            model: variationRequest.model,
            size: variationRequest.size,
            numberOfImages: variationRequest.numberOfVariations,
            sourceImage: variationRequest.sourceImage
        )

        return try await generate(request)
    }

    // MARK: - Image Editing (Inpainting)

    /// Edit image with mask
    func editImage(image: Data, mask: Data, prompt: String) async throws -> ImageGenResult {
        logger.info("[ImageGenManager] Editing image: \(prompt.prefix(50))...")

        let request = ImageGenRequest(
            prompt: prompt,
            sourceImage: image,
            maskImage: mask
        )

        return try await generate(request)
    }

    // MARK: - Prompt Enhancement

    /// Enhance prompt for better results
    func enhancePrompt(_ prompt: String) async throws -> EnhancedPrompt {
        logger.info("[ImageGenManager] Enhancing prompt: \(prompt.prefix(50))...")

        // Use LLM to enhance prompt
        // This is a simplified local implementation
        var enhancedText = prompt

        // Add quality modifiers if not present
        let qualityModifiers = ["highly detailed", "professional", "8k", "masterpiece"]
        var hasQuality = false
        for modifier in qualityModifiers {
            if prompt.lowercased().contains(modifier) {
                hasQuality = true
                break
            }
        }
        if !hasQuality {
            enhancedText = "\(prompt), highly detailed, professional quality"
        }

        // Add lighting if not specified
        if !prompt.lowercased().contains("lighting") && !prompt.lowercased().contains("light") {
            enhancedText += ", beautiful lighting"
        }

        // Common negative prompt
        let negativePrompt = "blurry, low quality, distorted, ugly, bad anatomy, disfigured, poorly drawn, extra limbs"

        return EnhancedPrompt(
            originalPrompt: prompt,
            enhancedPrompt: enhancedText,
            style: nil,
            techniques: ["quality enhancement", "lighting"],
            negativePrompt: negativePrompt
        )
    }

    // MARK: - Cancellation

    /// Cancel generation
    func cancel(requestId: String) {
        logger.info("[ImageGenManager] Cancelling request: \(requestId)")

        cancellationTokens[requestId] = true
        activeRequests.removeValue(forKey: requestId)

        if activeRequests.isEmpty {
            state = .idle
        }
    }

    /// Cancel all active requests
    func cancelAll() {
        for requestId in activeRequests.keys {
            cancel(requestId: requestId)
        }
    }

    // MARK: - Progress Reporting

    private func reportProgress(
        _ requestId: String,
        state: ImageGenState,
        progress: Float,
        step: Int? = nil,
        totalSteps: Int? = nil,
        message: String? = nil,
        previewImage: Data? = nil
    ) {
        let progressUpdate = ImageGenProgress(
            requestId: requestId,
            state: state,
            progress: progress,
            step: step,
            totalSteps: totalSteps,
            message: message,
            previewImage: previewImage
        )

        progressUpdated.send(progressUpdate)
        delegate?.imageGenManager(self, didUpdateProgress: progressUpdate)
    }

    // MARK: - Error Handling

    private func handleError(_ error: ImageGenError, requestId: String) {
        logger.error("[ImageGenManager] Generation failed: \(error.localizedDescription ?? "unknown")")

        activeRequests.removeValue(forKey: requestId)
        cancellationTokens.removeValue(forKey: requestId)
        state = .failed

        statistics.recordFailure()

        generationFailed.send((requestId, error))
        delegate?.imageGenManager(self, didFail: error, requestId: requestId)
    }

    // MARK: - Caching

    private func cacheImage(_ image: GeneratedImage) {
        imageCache[image.id] = image

        // Evict oldest if cache is full
        if imageCache.count > maxCacheSize {
            let oldest = imageCache.values.sorted { $0.createdAt < $1.createdAt }.first
            if let oldestId = oldest?.id {
                imageCache.removeValue(forKey: oldestId)
            }
        }
    }

    /// Get cached image
    func getCachedImage(id: String) -> GeneratedImage? {
        return imageCache[id]
    }

    /// Clear cache
    func clearCache() {
        imageCache.removeAll()
    }

    // MARK: - History

    private func loadHistory() {
        // Load from UserDefaults or file
        if let data = UserDefaults.standard.data(forKey: "imageGenHistory"),
           let savedHistory = try? JSONDecoder().decode([ImageGenHistoryEntry].self, from: data) {
            history = savedHistory
        }
    }

    private func saveHistory() {
        if let data = try? JSONEncoder().encode(history) {
            UserDefaults.standard.set(data, forKey: "imageGenHistory")
        }
    }

    /// Clear history
    func clearHistory() {
        history.removeAll()
        saveHistory()
    }

    /// Get history entry
    func getHistoryEntry(id: String) -> ImageGenHistoryEntry? {
        return history.first { $0.id == id }
    }
}

// MARK: - OpenAI Image Client

class OpenAIImageClient {
    private let apiKey: String
    private let baseURL = "https://api.openai.com/v1"

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func generate(_ request: ImageGenRequest) async throws -> [GeneratedImage] {
        let url = URL(string: "\(baseURL)/images/generations")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "prompt": request.prompt,
            "model": request.model.rawValue,
            "n": request.numberOfImages,
            "size": request.size.rawValue,
            "quality": request.quality.rawValue,
            "style": request.style.rawValue,
            "response_format": "b64_json"
        ]

        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ImageGenError.networkError("Invalid response")
        }

        if httpResponse.statusCode == 429 {
            throw ImageGenError.rateLimited
        }

        if httpResponse.statusCode == 400 {
            // Check for content policy violation
            if let errorData = try? JSONDecoder().decode(OpenAIErrorResponse.self, from: data),
               errorData.error.code == "content_policy_violation" {
                throw ImageGenError.contentBlocked
            }
        }

        guard httpResponse.statusCode == 200 else {
            throw ImageGenError.generationFailed("HTTP \(httpResponse.statusCode)")
        }

        let imageResponse = try JSONDecoder().decode(OpenAIImageResponse.self, from: data)

        return imageResponse.data.compactMap { imageData -> GeneratedImage? in
            guard let b64Data = Data(base64Encoded: imageData.b64_json ?? "") else { return nil }

            return GeneratedImage(
                requestId: request.id,
                imageData: b64Data,
                revisedPrompt: imageData.revised_prompt,
                model: request.model,
                size: request.size,
                seed: nil
            )
        }
    }

    func generateVariations(_ request: ImageVariationRequest) async throws -> ImageGenResult {
        let url = URL(string: "\(baseURL)/images/variations")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        // Multipart form data
        let boundary = UUID().uuidString
        urlRequest.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Image file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"image.png\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/png\r\n\r\n".data(using: .utf8)!)
        body.append(request.sourceImage)
        body.append("\r\n".data(using: .utf8)!)

        // Number of variations
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"n\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(request.numberOfVariations)\r\n".data(using: .utf8)!)

        // Size
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"size\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(request.size.rawValue)\r\n".data(using: .utf8)!)

        // Response format
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"response_format\"\r\n\r\n".data(using: .utf8)!)
        body.append("b64_json\r\n".data(using: .utf8)!)

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        urlRequest.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw ImageGenError.generationFailed("Variation generation failed")
        }

        let imageResponse = try JSONDecoder().decode(OpenAIImageResponse.self, from: data)

        let images = imageResponse.data.compactMap { imageData -> GeneratedImage? in
            guard let b64Data = Data(base64Encoded: imageData.b64_json ?? "") else { return nil }

            return GeneratedImage(
                requestId: UUID().uuidString,
                imageData: b64Data,
                model: request.model,
                size: request.size
            )
        }

        var result = ImageGenResult(
            requestId: UUID().uuidString,
            images: images,
            state: .completed
        )
        result.complete()

        return result
    }
}

// MARK: - OpenAI Response Types

struct OpenAIImageResponse: Codable {
    let data: [OpenAIImageData]
}

struct OpenAIImageData: Codable {
    let b64_json: String?
    let url: String?
    let revised_prompt: String?
}

struct OpenAIErrorResponse: Codable {
    let error: OpenAIError
}

struct OpenAIError: Codable {
    let message: String
    let type: String
    let code: String?
}

// MARK: - Stability AI Client

class StabilityAIClient {
    private let apiKey: String
    private let baseURL = "https://api.stability.ai/v1"

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func generate(_ request: ImageGenRequest) async throws -> [GeneratedImage] {
        let engineId = mapModelToEngine(request.model)
        let url = URL(string: "\(baseURL)/generation/\(engineId)/text-to-image")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(apiKey, forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")

        let body: [String: Any] = [
            "text_prompts": [
                ["text": request.prompt, "weight": 1.0],
                ["text": request.negativePrompt ?? "", "weight": -1.0]
            ],
            "cfg_scale": request.guidanceScale ?? 7.0,
            "height": Int(request.size.cgSize.height),
            "width": Int(request.size.cgSize.width),
            "samples": request.numberOfImages,
            "steps": request.steps ?? 30
        ]

        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw ImageGenError.generationFailed("Stability AI generation failed")
        }

        let stabilityResponse = try JSONDecoder().decode(StabilityImageResponse.self, from: data)

        return stabilityResponse.artifacts.compactMap { artifact -> GeneratedImage? in
            guard let imageData = Data(base64Encoded: artifact.base64) else { return nil }

            return GeneratedImage(
                requestId: request.id,
                imageData: imageData,
                model: request.model,
                size: request.size,
                seed: artifact.seed
            )
        }
    }

    private func mapModelToEngine(_ model: ImageGenModel) -> String {
        switch model {
        case .sdxl: return "stable-diffusion-xl-1024-v1-0"
        case .sd15: return "stable-diffusion-v1-5"
        case .sd21: return "stable-diffusion-512-v2-1"
        default: return "stable-diffusion-xl-1024-v1-0"
        }
    }
}

struct StabilityImageResponse: Codable {
    let artifacts: [StabilityArtifact]
}

struct StabilityArtifact: Codable {
    let base64: String
    let seed: Int
    let finishReason: String?
}

// MARK: - Replicate Client

class ReplicateClient {
    private let apiKey: String
    private let baseURL = "https://api.replicate.com/v1"

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func generate(_ request: ImageGenRequest) async throws -> [GeneratedImage] {
        // Start prediction
        let url = URL(string: "\(baseURL)/predictions")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let modelVersion = mapModelToVersion(request.model)

        let body: [String: Any] = [
            "version": modelVersion,
            "input": [
                "prompt": request.prompt,
                "negative_prompt": request.negativePrompt ?? "",
                "width": Int(request.size.cgSize.width),
                "height": Int(request.size.cgSize.height),
                "num_outputs": request.numberOfImages,
                "num_inference_steps": request.steps ?? 30,
                "guidance_scale": request.guidanceScale ?? 7.5
            ]
        ]

        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 201 else {
            throw ImageGenError.generationFailed("Replicate prediction failed")
        }

        let prediction = try JSONDecoder().decode(ReplicatePrediction.self, from: data)

        // Poll for completion
        return try await pollPrediction(prediction.id, requestId: request.id, model: request.model, size: request.size)
    }

    private func pollPrediction(_ predictionId: String, requestId: String, model: ImageGenModel, size: ImageSize) async throws -> [GeneratedImage] {
        let url = URL(string: "\(baseURL)/predictions/\(predictionId)")!

        for _ in 0..<120 { // 2 minutes max
            var urlRequest = URLRequest(url: url)
            urlRequest.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: urlRequest)
            let prediction = try JSONDecoder().decode(ReplicatePrediction.self, from: data)

            switch prediction.status {
            case "succeeded":
                guard let outputs = prediction.output else {
                    throw ImageGenError.generationFailed("No output")
                }

                var images: [GeneratedImage] = []
                for outputUrl in outputs {
                    if let imageUrl = URL(string: outputUrl),
                       let imageData = try? Data(contentsOf: imageUrl) {
                        images.append(GeneratedImage(
                            requestId: requestId,
                            imageData: imageData,
                            model: model,
                            size: size
                        ))
                    }
                }
                return images

            case "failed":
                throw ImageGenError.generationFailed(prediction.error ?? "Unknown error")

            case "canceled":
                throw ImageGenError.cancelled

            default:
                try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            }
        }

        throw ImageGenError.timeout
    }

    private func mapModelToVersion(_ model: ImageGenModel) -> String {
        switch model {
        case .sdxl: return "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b"
        case .flux: return "f7a10b6e25b86b6e6f8e6f8e6f8e6f8e6f8e6f8e6f8e6f8e6f8e6f8e6f8e6f8e"
        default: return "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b"
        }
    }
}

struct ReplicatePrediction: Codable {
    let id: String
    let status: String
    let output: [String]?
    let error: String?
}
