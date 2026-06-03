import Foundation

/// AI 扩展 typed RPC wrapper — Phase 6.4 (25 method)。
///
/// 镜像桌面 `ai-handler.js` Phase 6.4 commit 1+2+3 新增 25 method
/// (老 5 + Phase 5 fix 7 + Phase 6.4 25 = 37 method 总)。本 actor 仅 wrap 后 25：
///
/// - **Conversations 高级 5**: updateConversation / archiveConversation /
///   unarchiveConversation / searchConversations / exportConversation
/// - **Prompt templates 3**: getPromptTemplates / savePromptTemplate / deletePromptTemplate
/// - **RAG 5**: ragSearchAdvanced / ragIndex / ragDelete / ragListDocuments / ragStats
/// - **Multimodal 4**: generateImage / ocrImage / transcribeAudio / textToSpeech
/// - **Code helpers 4**: generateCode / explainCode / refactorCode / fixCode
/// - **Agents 4**: listAgents / getAgent / runAgent / stopAgent
///
/// 复用 invokeAndDecode helper 模板（Extension/Knowledge 同模式 — method ≥ 10 时统一）。
/// 与 `AIChatCommands` (Phase 5) 并列 — chat / streaming / conversation lifecycle 在那边。
///
/// **wire 协议**：namespace = `ai`（与 AIChatCommands 同），桌面 commandRouter
/// 走同一 `ai-handler.js` handler。
public actor AIExtendedCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - Conversations 高级 5

    /// 改 conversation 元信息（title / model / systemPrompt 任一可改）。
    public func updateConversation(
        pcPeerId: String, conversationId: String,
        title: String? = nil, model: String? = nil, systemPrompt: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ConversationActionResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.updateConversation: conversationId empty")
        }
        if title == nil && model == nil && systemPrompt == nil {
            throw RemoteSkillError.invalidArgument(
                "ai.updateConversation: at least one of title/model/systemPrompt required"
            )
        }
        var params: [String: Any] = ["conversationId": conversationId]
        if let t = title { params["title"] = t }
        if let m = model { params["model"] = m }
        if let s = systemPrompt { params["systemPrompt"] = s }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.updateConversation",
            params: params, mobileDid: mobileDid,
            decoder: ConversationActionResponse.decode
        )
    }

    /// 归档 conversation (archived=1)。
    public func archiveConversation(
        pcPeerId: String, conversationId: String, mobileDid: String? = nil
    ) async throws -> ConversationActionResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.archiveConversation: conversationId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.archiveConversation",
            params: ["conversationId": conversationId],
            mobileDid: mobileDid, decoder: ConversationActionResponse.decode
        )
    }

    public func unarchiveConversation(
        pcPeerId: String, conversationId: String, mobileDid: String? = nil
    ) async throws -> ConversationActionResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.unarchiveConversation: conversationId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.unarchiveConversation",
            params: ["conversationId": conversationId],
            mobileDid: mobileDid, decoder: ConversationActionResponse.decode
        )
    }

    /// 双路搜 (title LIKE + messages.content LIKE)。archived 默认 false。
    public func searchConversations(
        pcPeerId: String, query: String,
        limit: Int = 20, archived: Bool = false,
        mobileDid: String? = nil
    ) async throws -> SearchConversationsResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.searchConversations: query empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.searchConversations",
            params: ["query": query, "limit": limit, "archived": archived],
            mobileDid: mobileDid, decoder: SearchConversationsResponse.decode
        )
    }

    /// 导出对话完整历史。format: markdown (default) / json。
    public func exportConversation(
        pcPeerId: String, conversationId: String, format: String = "markdown",
        mobileDid: String? = nil
    ) async throws -> ExportConversationResponse {
        guard !conversationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.exportConversation: conversationId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.exportConversation",
            params: ["conversationId": conversationId, "format": format],
            mobileDid: mobileDid, decoder: ExportConversationResponse.decode
        )
    }

    // MARK: - Prompt templates 3

    public func getPromptTemplates(
        pcPeerId: String, category: String? = nil, limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> PromptTemplatesResponse {
        var params: [String: Any] = ["limit": limit]
        if let c = category { params["category"] = c }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.getPromptTemplates",
            params: params, mobileDid: mobileDid,
            decoder: PromptTemplatesResponse.decode
        )
    }

    /// 创建或更新 prompt template (id 传则 upsert，缺省 auto-id)。
    public func savePromptTemplate(
        pcPeerId: String, name: String, template: String,
        id: String? = nil, description: String? = nil,
        variables: [String] = [], category: String? = nil,
        mobileDid: String? = nil
    ) async throws -> SavePromptTemplateResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.savePromptTemplate: name empty")
        }
        guard !template.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.savePromptTemplate: template empty")
        }
        var params: [String: Any] = [
            "name": name, "template": template, "variables": variables,
        ]
        if let i = id { params["id"] = i }
        if let d = description { params["description"] = d }
        if let c = category { params["category"] = c }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.savePromptTemplate",
            params: params, mobileDid: mobileDid,
            decoder: SavePromptTemplateResponse.decode
        )
    }

    public func deletePromptTemplate(
        pcPeerId: String, templateId: String, mobileDid: String? = nil
    ) async throws -> DeletePromptTemplateResponse {
        guard !templateId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.deletePromptTemplate: templateId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.deletePromptTemplate",
            params: ["templateId": templateId],
            mobileDid: mobileDid, decoder: DeletePromptTemplateResponse.decode
        )
    }

    // MARK: - RAG 5

    public func ragSearchAdvanced(
        pcPeerId: String, query: String, topK: Int = 5,
        filters: [String: String]? = nil, scoreThreshold: Double = 0.0,
        namespace: String? = nil, mobileDid: String? = nil
    ) async throws -> RAGSearchResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.ragSearchAdvanced: query empty")
        }
        var params: [String: Any] = [
            "query": query, "topK": topK, "scoreThreshold": scoreThreshold,
        ]
        if let f = filters { params["filters"] = f }
        if let n = namespace { params["namespace"] = n }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ragSearchAdvanced",
            params: params, mobileDid: mobileDid,
            decoder: RAGSearchResponse.decode
        )
    }

    public func ragIndex(
        pcPeerId: String, text: String,
        docId: String? = nil, metadata: [String: String]? = nil,
        mobileDid: String? = nil
    ) async throws -> RAGIndexResponse {
        guard !text.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.ragIndex: text empty")
        }
        var params: [String: Any] = ["text": text]
        if let id = docId { params["docId"] = id }
        if let m = metadata { params["metadata"] = m }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ragIndex",
            params: params, mobileDid: mobileDid,
            decoder: RAGIndexResponse.decode
        )
    }

    public func ragDelete(
        pcPeerId: String, docId: String, mobileDid: String? = nil
    ) async throws -> RAGDeleteResponse {
        guard !docId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.ragDelete: docId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ragDelete",
            params: ["docId": docId],
            mobileDid: mobileDid, decoder: RAGDeleteResponse.decode
        )
    }

    public func ragListDocuments(
        pcPeerId: String, limit: Int = 50, offset: Int = 0,
        namespace: String? = nil, mobileDid: String? = nil
    ) async throws -> RAGDocumentsResponse {
        var params: [String: Any] = ["limit": limit, "offset": offset]
        if let n = namespace { params["namespace"] = n }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ragListDocuments",
            params: params, mobileDid: mobileDid,
            decoder: RAGDocumentsResponse.decode
        )
    }

    public func ragStats(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> RAGStatsResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ragStats",
            params: [:], mobileDid: mobileDid,
            decoder: RAGStatsResponse.decode
        )
    }

    // MARK: - Multimodal 4

    public func generateImage(
        pcPeerId: String, prompt: String,
        model: String? = nil, size: String? = nil, n: Int = 1,
        mobileDid: String? = nil
    ) async throws -> GenerateImageResponse {
        guard !prompt.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.generateImage: prompt empty")
        }
        // 与桌面同 clamp [1, 10]
        let clampedN = max(1, min(10, n))
        var params: [String: Any] = ["prompt": prompt, "n": clampedN]
        if let m = model { params["model"] = m }
        if let s = size { params["size"] = s }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.generateImage",
            params: params, mobileDid: mobileDid,
            decoder: GenerateImageResponse.decode
        )
    }

    /// OCR — imageData base64 或 imagePath 二选一。
    public func ocrImage(
        pcPeerId: String, imageData: String? = nil, imagePath: String? = nil,
        language: String = "auto", mobileDid: String? = nil
    ) async throws -> OCRResponse {
        guard imageData != nil || imagePath != nil else {
            throw RemoteSkillError.invalidArgument("ai.ocrImage: imageData or imagePath required")
        }
        var params: [String: Any] = ["language": language]
        if let d = imageData { params["imageData"] = d }
        if let p = imagePath { params["imagePath"] = p }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.ocrImage",
            params: params, mobileDid: mobileDid,
            decoder: OCRResponse.decode
        )
    }

    public func transcribeAudio(
        pcPeerId: String, audioData: String? = nil, audioPath: String? = nil,
        language: String = "auto", model: String? = nil,
        mobileDid: String? = nil
    ) async throws -> TranscriptionResponse {
        guard audioData != nil || audioPath != nil else {
            throw RemoteSkillError.invalidArgument("ai.transcribeAudio: audioData or audioPath required")
        }
        var params: [String: Any] = ["language": language]
        if let d = audioData { params["audioData"] = d }
        if let p = audioPath { params["audioPath"] = p }
        if let m = model { params["model"] = m }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.transcribeAudio",
            params: params, mobileDid: mobileDid,
            decoder: TranscriptionResponse.decode
        )
    }

    public func textToSpeech(
        pcPeerId: String, text: String,
        voice: String = "default", speed: Double = 1.0, format: String = "mp3",
        mobileDid: String? = nil
    ) async throws -> TTSResponse {
        guard !text.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.textToSpeech: text empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.textToSpeech",
            params: ["text": text, "voice": voice, "speed": speed, "format": format],
            mobileDid: mobileDid, decoder: TTSResponse.decode
        )
    }

    // MARK: - Code helpers 4

    public func generateCode(
        pcPeerId: String, prompt: String,
        language: String? = nil, framework: String? = nil,
        mobileDid: String? = nil
    ) async throws -> GenerateCodeResponse {
        guard !prompt.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.generateCode: prompt empty")
        }
        var params: [String: Any] = ["prompt": prompt]
        if let l = language { params["language"] = l }
        if let f = framework { params["framework"] = f }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.generateCode",
            params: params, mobileDid: mobileDid,
            decoder: GenerateCodeResponse.decode
        )
    }

    public func explainCode(
        pcPeerId: String, code: String, language: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ExplainCodeResponse {
        guard !code.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.explainCode: code empty")
        }
        var params: [String: Any] = ["code": code]
        if let l = language { params["language"] = l }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.explainCode",
            params: params, mobileDid: mobileDid,
            decoder: ExplainCodeResponse.decode
        )
    }

    public func refactorCode(
        pcPeerId: String, code: String,
        language: String? = nil, instructions: String? = nil,
        mobileDid: String? = nil
    ) async throws -> RefactorCodeResponse {
        guard !code.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.refactorCode: code empty")
        }
        var params: [String: Any] = ["code": code]
        if let l = language { params["language"] = l }
        if let i = instructions { params["instructions"] = i }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.refactorCode",
            params: params, mobileDid: mobileDid,
            decoder: RefactorCodeResponse.decode
        )
    }

    public func fixCode(
        pcPeerId: String, code: String, error: String,
        language: String? = nil, mobileDid: String? = nil
    ) async throws -> FixCodeResponse {
        guard !code.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.fixCode: code empty")
        }
        guard !error.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.fixCode: error empty")
        }
        var params: [String: Any] = ["code": code, "error": error]
        if let l = language { params["language"] = l }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.fixCode",
            params: params, mobileDid: mobileDid,
            decoder: FixCodeResponse.decode
        )
    }

    // MARK: - Agents 4

    public func listAgents(
        pcPeerId: String, mobileDid: String? = nil
    ) async throws -> AgentsResponse {
        try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.listAgents",
            params: [:], mobileDid: mobileDid,
            decoder: AgentsResponse.decode
        )
    }

    public func getAgent(
        pcPeerId: String, agentId: String, mobileDid: String? = nil
    ) async throws -> GetAgentResponse {
        guard !agentId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.getAgent: agentId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.getAgent",
            params: ["agentId": agentId],
            mobileDid: mobileDid, decoder: GetAgentResponse.decode
        )
    }

    /// 跑 agent，input 允许空字符串但禁 null（与桌面对齐）。返 runId 让 caller 后续可 stop。
    public func runAgent(
        pcPeerId: String, agentId: String, input: String,
        options: [String: String]? = nil, mobileDid: String? = nil
    ) async throws -> RunAgentResponse {
        guard !agentId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.runAgent: agentId empty")
        }
        var params: [String: Any] = ["agentId": agentId, "input": input]
        if let o = options { params["options"] = o }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.runAgent",
            params: params, mobileDid: mobileDid,
            decoder: RunAgentResponse.decode
        )
    }

    /// runId 或 agentId 任一可用（桌面会 fallback）。
    public func stopAgent(
        pcPeerId: String, runId: String? = nil, agentId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> StopAgentResponse {
        guard runId != nil || agentId != nil else {
            throw RemoteSkillError.invalidArgument("ai.stopAgent: runId or agentId required")
        }
        var params: [String: Any] = [:]
        if let r = runId { params["runId"] = r }
        if let a = agentId { params["agentId"] = a }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.stopAgent",
            params: params, mobileDid: mobileDid,
            decoder: StopAgentResponse.decode
        )
    }

    // MARK: - Agent streaming (v0.3)
    //
    // 复用 AIChat 的 StreamStartResponse / StreamChunkResponse 模型 — 桌面端
    // activeStreams Map 是 streamId-agnostic，chat / agent 共用一套协议。

    /// 启动 agent 流式运行，返 `streamId`。后续调 [getAgentStreamChunk] 轮询拉
    /// 增量 chunks；调 [cancelAgentStream] 取消（与 chat stream 共用桌面 store）。
    public func runAgentStream(
        pcPeerId: String, agentId: String, input: String,
        options: [String: String]? = nil, mobileDid: String? = nil
    ) async throws -> StreamStartResponse {
        guard !agentId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.runAgentStream: agentId empty")
        }
        var params: [String: Any] = ["agentId": agentId, "input": input]
        if let o = options { params["options"] = o }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.runAgentStream",
            params: params, mobileDid: mobileDid,
            decoder: StreamStartResponse.decode
        )
    }

    /// 轮询 agent stream chunks（method 名与 chat 用的 `ai.getStreamChunk` 同 —
    /// 桌面 activeStreams 不区分来源）。
    public func getAgentStreamChunk(
        pcPeerId: String, streamId: String, sinceChunk: Int = 0,
        mobileDid: String? = nil
    ) async throws -> StreamChunkResponse {
        guard !streamId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.getStreamChunk streamId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.getStreamChunk",
            params: ["streamId": streamId, "sinceChunk": sinceChunk],
            mobileDid: mobileDid, decoder: StreamChunkResponse.decode
        )
    }

    public func cancelAgentStream(
        pcPeerId: String, streamId: String, mobileDid: String? = nil
    ) async throws -> CancelStreamResponse {
        guard !streamId.isEmpty else {
            throw RemoteSkillError.invalidArgument("ai.cancelStream streamId empty")
        }
        return try await invokeAndDecode(
            pcPeerId: pcPeerId, method: "ai.cancelStream",
            params: ["streamId": streamId],
            mobileDid: mobileDid, decoder: CancelStreamResponse.decode
        )
    }

    // MARK: - 内部

    private func invokeAndDecode<T>(
        pcPeerId: String, method: String,
        params: [String: Any], mobileDid: String?,
        decoder: (String) throws -> T
    ) async throws -> T {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId, method: method,
            params: params, mobileDid: mobileDid
        )
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
