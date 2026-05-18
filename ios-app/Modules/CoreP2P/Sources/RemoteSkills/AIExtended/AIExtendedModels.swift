import Foundation

/// AI 扩展 typed RPC 响应模型 — Phase 6.4 (~25 method)。
///
/// 镜像桌面 `ai-handler.js` 25 method 全套返回结构 (Phase 6.4 commit 1+2+3)。
///
/// 不复用 AIChatModels 里的 [Conversation] / [ChatMessage]（那些是 Phase 5 chat
/// 专用），本文件 6 个分组独立的响应类型。

// MARK: - 公共复用

/// `ai.archiveConversation` / `ai.unarchiveConversation` / `ai.updateConversation`
/// 通用响应（字段差异在 archived / message 二选一）。
public struct ConversationActionResponse: Sendable, Equatable {
    public let conversationId: String
    public let archived: Bool?
    public let message: String?

    public init(conversationId: String, archived: Bool? = nil, message: String? = nil) {
        self.conversationId = conversationId; self.archived = archived; self.message = message
    }

    public static func decode(_ json: String) throws -> ConversationActionResponse {
        let d = try parseDict(json)
        return ConversationActionResponse(
            conversationId: (d["conversationId"] as? String) ?? "",
            archived: d["archived"] as? Bool,
            message: d["message"] as? String
        )
    }
}

// MARK: - Conversations 高级

public struct ConversationSummary: Sendable, Equatable {
    public let id: String
    public let title: String
    public let model: String?
    public let messageCount: Int
    public let lastMessageAt: Int64?
    public let createdAt: Int64?
    public let archived: Bool

    public init(id: String, title: String, model: String? = nil, messageCount: Int = 0,
                lastMessageAt: Int64? = nil, createdAt: Int64? = nil, archived: Bool = false) {
        self.id = id; self.title = title; self.model = model
        self.messageCount = messageCount; self.lastMessageAt = lastMessageAt
        self.createdAt = createdAt; self.archived = archived
    }

    internal static func from(_ d: [String: Any]) -> ConversationSummary {
        ConversationSummary(
            id: (d["id"] as? String) ?? "",
            title: (d["title"] as? String) ?? "",
            model: d["model"] as? String,
            messageCount: (d["messageCount"] as? Int) ?? 0,
            lastMessageAt: pickInt64(d["lastMessageAt"]),
            createdAt: pickInt64(d["createdAt"]),
            archived: (d["archived"] as? Bool) ?? false
        )
    }
}

/// `ai.searchConversations` 响应。
public struct SearchConversationsResponse: Sendable, Equatable {
    public let query: String
    public let conversations: [ConversationSummary]
    public let total: Int

    public init(query: String, conversations: [ConversationSummary], total: Int) {
        self.query = query; self.conversations = conversations; self.total = total
    }

    public static func decode(_ json: String) throws -> SearchConversationsResponse {
        let d = try parseDict(json)
        let arr = (d["conversations"] as? [[String: Any]]) ?? []
        return SearchConversationsResponse(
            query: (d["query"] as? String) ?? "",
            conversations: arr.map { ConversationSummary.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `ai.exportConversation` 响应。
public struct ExportConversationResponse: Sendable, Equatable {
    public let conversationId: String
    public let format: String
    public let mime: String
    public let content: String
    public let messageCount: Int

    public init(conversationId: String, format: String, mime: String,
                content: String, messageCount: Int = 0) {
        self.conversationId = conversationId; self.format = format
        self.mime = mime; self.content = content; self.messageCount = messageCount
    }

    public static func decode(_ json: String) throws -> ExportConversationResponse {
        let d = try parseDict(json)
        return ExportConversationResponse(
            conversationId: (d["conversationId"] as? String) ?? "",
            format: (d["format"] as? String) ?? "markdown",
            mime: (d["mime"] as? String) ?? "text/markdown",
            content: (d["content"] as? String) ?? "",
            messageCount: (d["messageCount"] as? Int) ?? 0
        )
    }
}

// MARK: - Prompt templates

public struct PromptTemplate: Sendable, Equatable {
    public let id: String
    public let name: String
    public let description: String?
    public let template: String
    public let variables: [String]
    public let category: String?
    public let createdAt: Int64?
    public let updatedAt: Int64?

    public init(id: String, name: String, template: String,
                description: String? = nil, variables: [String] = [],
                category: String? = nil, createdAt: Int64? = nil, updatedAt: Int64? = nil) {
        self.id = id; self.name = name; self.description = description
        self.template = template; self.variables = variables; self.category = category
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    internal static func from(_ d: [String: Any]) -> PromptTemplate {
        PromptTemplate(
            id: (d["id"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            template: (d["template"] as? String) ?? "",
            description: d["description"] as? String,
            variables: (d["variables"] as? [String]) ?? [],
            category: d["category"] as? String,
            createdAt: pickInt64(d["createdAt"]),
            updatedAt: pickInt64(d["updatedAt"])
        )
    }
}

public struct PromptTemplatesResponse: Sendable, Equatable {
    public let templates: [PromptTemplate]
    public let total: Int

    public init(templates: [PromptTemplate], total: Int) {
        self.templates = templates; self.total = total
    }

    public static func decode(_ json: String) throws -> PromptTemplatesResponse {
        let d = try parseDict(json)
        let arr = (d["templates"] as? [[String: Any]]) ?? []
        return PromptTemplatesResponse(
            templates: arr.map { PromptTemplate.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct SavePromptTemplateResponse: Sendable, Equatable {
    public let templateId: String
    public let name: String
    public let message: String

    public init(templateId: String, name: String, message: String) {
        self.templateId = templateId; self.name = name; self.message = message
    }

    public static func decode(_ json: String) throws -> SavePromptTemplateResponse {
        let d = try parseDict(json)
        return SavePromptTemplateResponse(
            templateId: (d["templateId"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

public struct DeletePromptTemplateResponse: Sendable, Equatable {
    public let templateId: String
    public let deleted: Bool

    public init(templateId: String, deleted: Bool) {
        self.templateId = templateId; self.deleted = deleted
    }

    public static func decode(_ json: String) throws -> DeletePromptTemplateResponse {
        let d = try parseDict(json)
        return DeletePromptTemplateResponse(
            templateId: (d["templateId"] as? String) ?? "",
            deleted: (d["deleted"] as? Bool) ?? false
        )
    }
}

// MARK: - RAG

public struct RAGSearchResult: Sendable, Equatable {
    public let id: String?
    public let text: String?
    public let score: Double?
    public let metadata: [String: String]    // 简化：只取 String value，复杂结构调方需自解

    public init(id: String? = nil, text: String? = nil, score: Double? = nil,
                metadata: [String: String] = [:]) {
        self.id = id; self.text = text; self.score = score; self.metadata = metadata
    }

    internal static func from(_ d: [String: Any]) -> RAGSearchResult {
        var meta: [String: String] = [:]
        if let raw = d["metadata"] as? [String: Any] {
            for (k, v) in raw {
                if let s = v as? String { meta[k] = s }
                else if let n = v as? Int { meta[k] = String(n) }
                else if let n = v as? Double { meta[k] = String(n) }
                else if let b = v as? Bool { meta[k] = String(b) }
            }
        }
        return RAGSearchResult(
            id: d["id"] as? String,
            text: d["text"] as? String,
            score: d["score"] as? Double,
            metadata: meta
        )
    }
}

public struct RAGSearchResponse: Sendable, Equatable {
    public let query: String
    public let results: [RAGSearchResult]
    public let total: Int

    public init(query: String, results: [RAGSearchResult], total: Int) {
        self.query = query; self.results = results; self.total = total
    }

    public static func decode(_ json: String) throws -> RAGSearchResponse {
        let d = try parseDict(json)
        let arr = (d["results"] as? [[String: Any]]) ?? []
        return RAGSearchResponse(
            query: (d["query"] as? String) ?? "",
            results: arr.map { RAGSearchResult.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct RAGIndexResponse: Sendable, Equatable {
    public let docId: String
    public let indexed: Bool

    public init(docId: String, indexed: Bool) {
        self.docId = docId; self.indexed = indexed
    }

    public static func decode(_ json: String) throws -> RAGIndexResponse {
        let d = try parseDict(json)
        return RAGIndexResponse(
            docId: (d["docId"] as? String) ?? "",
            indexed: (d["indexed"] as? Bool) ?? false
        )
    }
}

public struct RAGDeleteResponse: Sendable, Equatable {
    public let docId: String
    public let deleted: Bool

    public init(docId: String, deleted: Bool) {
        self.docId = docId; self.deleted = deleted
    }

    public static func decode(_ json: String) throws -> RAGDeleteResponse {
        let d = try parseDict(json)
        return RAGDeleteResponse(
            docId: (d["docId"] as? String) ?? "",
            deleted: (d["deleted"] as? Bool) ?? false
        )
    }
}

public struct RAGDocument: Sendable, Equatable {
    public let id: String
    public let text: String?

    public init(id: String, text: String? = nil) {
        self.id = id; self.text = text
    }

    internal static func from(_ d: [String: Any]) -> RAGDocument {
        RAGDocument(id: (d["id"] as? String) ?? "", text: d["text"] as? String)
    }
}

public struct RAGDocumentsResponse: Sendable, Equatable {
    public let documents: [RAGDocument]
    public let total: Int

    public init(documents: [RAGDocument], total: Int) {
        self.documents = documents; self.total = total
    }

    public static func decode(_ json: String) throws -> RAGDocumentsResponse {
        let d = try parseDict(json)
        let arr = (d["documents"] as? [[String: Any]]) ?? []
        return RAGDocumentsResponse(
            documents: arr.map { RAGDocument.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct RAGStatsResponse: Sendable, Equatable {
    public let available: Bool
    public let totalDocs: Int
    public let totalVectors: Int

    public init(available: Bool, totalDocs: Int = 0, totalVectors: Int = 0) {
        self.available = available; self.totalDocs = totalDocs; self.totalVectors = totalVectors
    }

    public static func decode(_ json: String) throws -> RAGStatsResponse {
        let d = try parseDict(json)
        return RAGStatsResponse(
            available: (d["available"] as? Bool) ?? false,
            totalDocs: (d["totalDocs"] as? Int) ?? 0,
            totalVectors: (d["totalVectors"] as? Int) ?? 0
        )
    }
}

// MARK: - Multimodal

public struct GeneratedImage: Sendable, Equatable {
    public let url: String?
    public let data: String?         // base64 if data URL or inline

    public init(url: String? = nil, data: String? = nil) {
        self.url = url; self.data = data
    }

    internal static func from(_ d: [String: Any]) -> GeneratedImage {
        GeneratedImage(url: d["url"] as? String, data: d["data"] as? String)
    }
}

public struct GenerateImageResponse: Sendable, Equatable {
    public let prompt: String
    public let model: String?
    public let images: [GeneratedImage]

    public init(prompt: String, model: String? = nil, images: [GeneratedImage]) {
        self.prompt = prompt; self.model = model; self.images = images
    }

    public static func decode(_ json: String) throws -> GenerateImageResponse {
        let d = try parseDict(json)
        let arr = (d["images"] as? [[String: Any]]) ?? []
        return GenerateImageResponse(
            prompt: (d["prompt"] as? String) ?? "",
            model: d["model"] as? String,
            images: arr.map { GeneratedImage.from($0) }
        )
    }
}

public struct OCRResponse: Sendable, Equatable {
    public let text: String
    public let confidence: Double
    public let language: String

    public init(text: String, confidence: Double, language: String) {
        self.text = text; self.confidence = confidence; self.language = language
    }

    public static func decode(_ json: String) throws -> OCRResponse {
        let d = try parseDict(json)
        return OCRResponse(
            text: (d["text"] as? String) ?? "",
            confidence: (d["confidence"] as? Double) ?? 0.0,
            language: (d["language"] as? String) ?? "auto"
        )
    }
}

public struct TranscriptionResponse: Sendable, Equatable {
    public let text: String
    public let language: String
    public let duration: Double?

    public init(text: String, language: String, duration: Double? = nil) {
        self.text = text; self.language = language; self.duration = duration
    }

    public static func decode(_ json: String) throws -> TranscriptionResponse {
        let d = try parseDict(json)
        return TranscriptionResponse(
            text: (d["text"] as? String) ?? "",
            language: (d["language"] as? String) ?? "auto",
            duration: d["duration"] as? Double
        )
    }
}

public struct TTSResponse: Sendable, Equatable {
    public let audioData: String        // base64
    public let format: String
    public let voice: String
    public let duration: Double?

    public init(audioData: String, format: String, voice: String, duration: Double? = nil) {
        self.audioData = audioData; self.format = format
        self.voice = voice; self.duration = duration
    }

    public static func decode(_ json: String) throws -> TTSResponse {
        let d = try parseDict(json)
        return TTSResponse(
            audioData: (d["audioData"] as? String) ?? "",
            format: (d["format"] as? String) ?? "mp3",
            voice: (d["voice"] as? String) ?? "default",
            duration: d["duration"] as? Double
        )
    }
}

// MARK: - Code helpers

public struct GenerateCodeResponse: Sendable, Equatable {
    public let code: String
    public let language: String?
    public let framework: String?

    public init(code: String, language: String? = nil, framework: String? = nil) {
        self.code = code; self.language = language; self.framework = framework
    }

    public static func decode(_ json: String) throws -> GenerateCodeResponse {
        let d = try parseDict(json)
        return GenerateCodeResponse(
            code: (d["code"] as? String) ?? "",
            language: d["language"] as? String,
            framework: d["framework"] as? String
        )
    }
}

public struct ExplainCodeResponse: Sendable, Equatable {
    public let explanation: String
    public let language: String?

    public init(explanation: String, language: String? = nil) {
        self.explanation = explanation; self.language = language
    }

    public static func decode(_ json: String) throws -> ExplainCodeResponse {
        let d = try parseDict(json)
        return ExplainCodeResponse(
            explanation: (d["explanation"] as? String) ?? "",
            language: d["language"] as? String
        )
    }
}

public struct RefactorCodeResponse: Sendable, Equatable {
    public let refactoredCode: String
    public let language: String?
    public let instructions: String?

    public init(refactoredCode: String, language: String? = nil, instructions: String? = nil) {
        self.refactoredCode = refactoredCode; self.language = language; self.instructions = instructions
    }

    public static func decode(_ json: String) throws -> RefactorCodeResponse {
        let d = try parseDict(json)
        return RefactorCodeResponse(
            refactoredCode: (d["refactoredCode"] as? String) ?? "",
            language: d["language"] as? String,
            instructions: d["instructions"] as? String
        )
    }
}

public struct FixCodeResponse: Sendable, Equatable {
    public let fixedCode: String
    public let language: String?
    public let error: String?

    public init(fixedCode: String, language: String? = nil, error: String? = nil) {
        self.fixedCode = fixedCode; self.language = language; self.error = error
    }

    public static func decode(_ json: String) throws -> FixCodeResponse {
        let d = try parseDict(json)
        return FixCodeResponse(
            fixedCode: (d["fixedCode"] as? String) ?? "",
            language: d["language"] as? String,
            error: d["error"] as? String
        )
    }
}

// MARK: - Agents

public struct AgentInfo: Sendable, Equatable {
    public let id: String
    public let name: String?
    public let description: String?

    public init(id: String, name: String? = nil, description: String? = nil) {
        self.id = id; self.name = name; self.description = description
    }

    internal static func from(_ d: [String: Any]) -> AgentInfo {
        AgentInfo(
            id: (d["id"] as? String) ?? "",
            name: d["name"] as? String,
            description: d["description"] as? String
        )
    }
}

public struct AgentsResponse: Sendable, Equatable {
    public let agents: [AgentInfo]
    public let total: Int
    public let available: Bool

    public init(agents: [AgentInfo], total: Int, available: Bool) {
        self.agents = agents; self.total = total; self.available = available
    }

    public static func decode(_ json: String) throws -> AgentsResponse {
        let d = try parseDict(json)
        let arr = (d["agents"] as? [[String: Any]]) ?? []
        return AgentsResponse(
            agents: arr.map { AgentInfo.from($0) },
            total: (d["total"] as? Int) ?? arr.count,
            available: (d["available"] as? Bool) ?? false
        )
    }
}

public struct GetAgentResponse: Sendable, Equatable {
    public let agent: AgentInfo

    public init(agent: AgentInfo) { self.agent = agent }

    public static func decode(_ json: String) throws -> GetAgentResponse {
        let d = try parseDict(json)
        let agent = (d["agent"] as? [String: Any]) ?? [:]
        return GetAgentResponse(agent: AgentInfo.from(agent))
    }
}

public struct RunAgentResponse: Sendable, Equatable {
    public let agentId: String
    public let runId: String?
    public let status: String
    public let output: String?

    public init(agentId: String, runId: String? = nil, status: String, output: String? = nil) {
        self.agentId = agentId; self.runId = runId; self.status = status; self.output = output
    }

    public static func decode(_ json: String) throws -> RunAgentResponse {
        let d = try parseDict(json)
        return RunAgentResponse(
            agentId: (d["agentId"] as? String) ?? "",
            runId: d["runId"] as? String,
            status: (d["status"] as? String) ?? "unknown",
            output: d["output"] as? String
        )
    }
}

public struct StopAgentResponse: Sendable, Equatable {
    public let runId: String?
    public let agentId: String?
    public let stopped: Bool

    public init(runId: String? = nil, agentId: String? = nil, stopped: Bool) {
        self.runId = runId; self.agentId = agentId; self.stopped = stopped
    }

    public static func decode(_ json: String) throws -> StopAgentResponse {
        let d = try parseDict(json)
        return StopAgentResponse(
            runId: d["runId"] as? String,
            agentId: d["agentId"] as? String,
            stopped: (d["stopped"] as? Bool) ?? false
        )
    }
}
