import Foundation
import XCTest
@testable import EvolutionModelEgress

/// Compiles and invokes the app's real clients, including inherited providers.
/// No provider implementation or Evolution error is duplicated in this suite.
final class EvolutionModelEgressTests: XCTestCase {
    @MainActor
    func testEveryProviderDeniesChatAndStreamWithoutTransport() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ModelEgressTransportProbe.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let config = LLMManager.LLMConfig(
            provider: .openai,
            apiKey: "test-only-key",
            baseURL: "https://model-egress.invalid/v1",
            model: "test-only-model",
            timeout: 1
        )
        let clients: [(String, LLMClient)] = [
            ("OpenAI", OpenAIClient(config: config, session: session)),
            ("Ollama", OllamaClient(config: config, session: session)),
            ("Anthropic", AnthropicClient(config: config, session: session)),
            ("DeepSeek", DeepSeekClient(config: config, session: session)),
            ("Volcengine", VolcengineClient(config: config, session: session)),
            ("Custom", CustomClient(config: config, session: session))
        ]

        // Positive control: the harmless models probe must reach our transport.
        // This prevents a broken interceptor from making zero-call checks pass.
        ModelEgressTransportProbe.reset()
        _ = try await clients[0].1.checkStatus()
        XCTAssertEqual(ModelEgressTransportProbe.requestCount, 1)
        ModelEgressTransportProbe.reset()

        let messages = [LLMMessage(role: "user", content: "private user content")]
        for (name, client) in clients {
            await assertIngressDenied("\(name) chat") {
                try await client.chat(messages: messages, options: .default)
            }
            var emittedChunk = false
            await assertIngressDenied("\(name) stream") {
                try await client.chatStream(messages: messages, options: .default) { _ in
                    emittedChunk = true
                }
            }
            XCTAssertFalse(emittedChunk, "\(name) must not emit content after denial")
            XCTAssertEqual(ModelEgressTransportProbe.requestCount, 0, "\(name) reached transport")
        }
    }

    @MainActor
    func testEmbeddingDeniesBeforeInitializationOrFallback() async {
        await assertIngressDenied("manager embedding") {
            try await LLMManager.shared.generateEmbedding("private embedding content")
        }
    }

    @MainActor
    private func assertIngressDenied<T>(
        _ label: String,
        file: StaticString = #filePath,
        line: UInt = #line,
        operation: () async throws -> T
    ) async {
        do {
            _ = try await operation()
            XCTFail("\(label) must fail closed", file: file, line: line)
        } catch LLMError.evolutionIngressRequired {
            XCTAssertTrue(
                LLMError.evolutionIngressRequired.localizedDescription.hasPrefix("CC_AGENT_EVOLUTION_INGRESS_FAILED"),
                file: file,
                line: line
            )
        } catch {
            XCTFail("\(label) returned a non-terminal error: \(error)", file: file, line: line)
        }
    }
}

/// Intercepts every URL scheme in the injected session; no real provider runs.
private final class ModelEgressTransportProbe: URLProtocol {
    private static let lock = NSLock()
    private static var count = 0

    static var requestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        count = 0
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.count += 1
        Self.lock.unlock()
        client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
    }

    override func stopLoading() {}
}
