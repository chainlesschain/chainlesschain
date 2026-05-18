import Foundation
import SwiftUI

/// Phase 6.4 — `AIExtendedView` 的 @MainActor ViewModel。
///
/// **v0.1**：3 sub-tab (Templates / Code / RAG)。
/// **v0.2** (本版)：+2 sub-tab (Multimodal / Agents)，total 5 sub-tab，picker 从
///   segmented 切到 horizontal scroll（HIG 5-tab 软上限 + Phase 4.5 同模式）。
@MainActor
public final class RemoteAIExtendedViewModel: ObservableObject {

    public enum SubTab: String, CaseIterable, Identifiable {
        case templates
        case code
        case rag
        case multimodal     // v0.2 — generateImage / ocrImage / transcribeAudio / textToSpeech
        case agents         // v0.2 — list / get / run / stop
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .templates: return "模板"
            case .code: return "代码"
            case .rag: return "RAG"
            case .multimodal: return "多模态"
            case .agents: return "Agents"
            }
        }
        public var icon: String {
            switch self {
            case .templates: return "doc.text"
            case .code: return "chevron.left.forwardslash.chevron.right"
            case .rag: return "magnifyingglass.circle"
            case .multimodal: return "photo.on.rectangle.angled"
            case .agents: return "person.3.sequence"
            }
        }
    }

    // Templates 状态
    @Published public var templates: [PromptTemplate] = []
    @Published public var templatesLoading: Bool = false

    // Code 状态
    @Published public var codeInput: String = ""
    @Published public var codeLanguage: String = "Swift"
    @Published public var codeResult: String = ""
    @Published public var codeMode: CodeMode = .explain
    @Published public var codeLoading: Bool = false

    public enum CodeMode: String, CaseIterable, Identifiable {
        case explain, generate, refactor
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .explain: return "解释"
            case .generate: return "生成"
            case .refactor: return "重构"
            }
        }
    }

    // RAG 状态
    @Published public var ragQuery: String = ""
    @Published public var ragResults: [RAGSearchResult] = []
    @Published public var ragStats: RAGStatsResponse?
    @Published public var ragLoading: Bool = false

    @Published public var errorMessage: String?

    private let commands: AIExtendedCommands
    private let pcPeerIdProvider: @Sendable () async -> String?

    public init(commands: AIExtendedCommands, pcPeerIdProvider: @escaping @Sendable () async -> String?) {
        self.commands = commands
        self.pcPeerIdProvider = pcPeerIdProvider
    }

    // MARK: - Templates

    public func loadTemplates() async {
        templatesLoading = true
        errorMessage = nil
        defer { templatesLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.getPromptTemplates(pcPeerId: pc, limit: 100)
            self.templates = r.templates
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    public func saveTemplate(name: String, template: String, variables: [String], category: String?) async {
        guard let pc = await pcPeerIdProvider() else { return }
        do {
            _ = try await commands.savePromptTemplate(
                pcPeerId: pc, name: name, template: template,
                variables: variables, category: category
            )
            await loadTemplates()
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    public func deleteTemplate(_ tpl: PromptTemplate) async {
        guard let pc = await pcPeerIdProvider() else { return }
        do {
            _ = try await commands.deletePromptTemplate(pcPeerId: pc, templateId: tpl.id)
            templates.removeAll { $0.id == tpl.id }
        } catch {
            self.errorMessage = String(describing: error)
        }
    }

    // MARK: - Code

    public func runCode() async {
        let input = codeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else {
            codeResult = "请输入内容"; return
        }
        codeLoading = true; errorMessage = nil
        defer { codeLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            switch codeMode {
            case .explain:
                let r = try await commands.explainCode(
                    pcPeerId: pc, code: input, language: codeLanguage
                )
                self.codeResult = r.explanation
            case .generate:
                let r = try await commands.generateCode(
                    pcPeerId: pc, prompt: input, language: codeLanguage
                )
                self.codeResult = r.code
            case .refactor:
                let r = try await commands.refactorCode(
                    pcPeerId: pc, code: input, language: codeLanguage,
                    instructions: "Improve readability and maintainability"
                )
                self.codeResult = r.refactoredCode
            }
        } catch {
            self.errorMessage = String(describing: error)
            self.codeResult = ""
        }
    }

    // MARK: - RAG

    public func loadRagStats() async {
        guard let pc = await pcPeerIdProvider() else { return }
        do {
            let r = try await commands.ragStats(pcPeerId: pc)
            self.ragStats = r
        } catch {
            // stats 静默失败 — 不阻断 search
        }
    }

    public func searchRag() async {
        let q = ragQuery.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { ragResults = []; return }
        ragLoading = true; errorMessage = nil
        defer { ragLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.ragSearchAdvanced(
                pcPeerId: pc, query: q, topK: 10
            )
            self.ragResults = r.results
        } catch {
            self.errorMessage = String(describing: error)
            self.ragResults = []
        }
    }

    // MARK: - Multimodal (v0.2)

    public enum MultimodalMode: String, CaseIterable, Identifiable {
        case generateImage, ocrImage, textToSpeech, transcribeAudio
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .generateImage: return "生图"
            case .ocrImage: return "OCR"
            case .textToSpeech: return "TTS"
            case .transcribeAudio: return "语音转文字"
            }
        }
        public var icon: String {
            switch self {
            case .generateImage: return "wand.and.stars"
            case .ocrImage: return "text.viewfinder"
            case .textToSpeech: return "speaker.wave.2"
            case .transcribeAudio: return "waveform"
            }
        }
    }

    @Published public var multimodalMode: MultimodalMode = .generateImage
    @Published public var multimodalLoading: Bool = false

    // generateImage
    @Published public var imagePrompt: String = ""
    @Published public var generatedImages: [GeneratedImage] = []

    // ocrImage
    @Published public var ocrImageBase64: String?       // 用户选完后填
    @Published public var ocrLanguage: String = "auto"
    @Published public var ocrResult: OCRResponse?

    // textToSpeech
    @Published public var ttsInput: String = ""
    @Published public var ttsVoice: String = "default"
    @Published public var ttsResult: TTSResponse?

    // transcribeAudio
    @Published public var audioBase64: String?
    @Published public var audioFilename: String?
    @Published public var transcribeLanguage: String = "auto"
    @Published public var transcribeResult: TranscriptionResponse?

    public func runGenerateImage() async {
        let p = imagePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !p.isEmpty else { return }
        multimodalLoading = true; errorMessage = nil
        defer { multimodalLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.generateImage(pcPeerId: pc, prompt: p, n: 1)
            self.generatedImages = r.images
        } catch {
            self.errorMessage = String(describing: error)
            self.generatedImages = []
        }
    }

    public func runOcrImage() async {
        guard let b64 = ocrImageBase64, !b64.isEmpty else {
            errorMessage = "请先选择图片"; return
        }
        multimodalLoading = true; errorMessage = nil
        defer { multimodalLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.ocrImage(
                pcPeerId: pc, imageData: b64, language: ocrLanguage
            )
            self.ocrResult = r
        } catch {
            self.errorMessage = String(describing: error)
            self.ocrResult = nil
        }
    }

    public func runTextToSpeech() async {
        let t = ttsInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        multimodalLoading = true; errorMessage = nil
        defer { multimodalLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.textToSpeech(
                pcPeerId: pc, text: t, voice: ttsVoice
            )
            self.ttsResult = r
        } catch {
            self.errorMessage = String(describing: error)
            self.ttsResult = nil
        }
    }

    public func runTranscribeAudio() async {
        guard let b64 = audioBase64, !b64.isEmpty else {
            errorMessage = "请先选择音频文件"; return
        }
        multimodalLoading = true; errorMessage = nil
        defer { multimodalLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.transcribeAudio(
                pcPeerId: pc, audioData: b64, language: transcribeLanguage
            )
            self.transcribeResult = r
        } catch {
            self.errorMessage = String(describing: error)
            self.transcribeResult = nil
        }
    }

    // MARK: - Agents (v0.2)

    @Published public var agents: [AgentInfo] = []
    @Published public var agentsAvailable: Bool = false
    @Published public var agentsLoading: Bool = false
    @Published public var selectedAgent: AgentInfo?
    @Published public var agentInput: String = ""
    @Published public var agentRun: RunAgentResponse?
    @Published public var agentRunning: Bool = false

    // v0.3 streaming
    @Published public var agentStreamEnabled: Bool = true   // 默认开
    @Published public var agentStreamOutput: String = ""
    @Published public var agentStreamId: String?
    @Published public var agentStreamComplete: Bool = false
    @Published public var agentStreamError: String?
    private var agentStreamTask: Task<Void, Never>?
    /// 测试 hook — 调小 polling 间隔。生产 250ms ≈ 4Hz UI 更新。
    public var agentStreamPollIntervalNs: UInt64 = 250_000_000

    public func loadAgents() async {
        agentsLoading = true; errorMessage = nil
        defer { agentsLoading = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.listAgents(pcPeerId: pc)
            self.agents = r.agents
            self.agentsAvailable = r.available
        } catch {
            self.errorMessage = String(describing: error)
            self.agents = []
            self.agentsAvailable = false
        }
    }

    public func runSelectedAgent() async {
        guard let a = selectedAgent else {
            errorMessage = "请先选择 agent"; return
        }
        // v0.3：streaming 模式走分支
        if agentStreamEnabled {
            await runSelectedAgentStream(agent: a)
            return
        }
        agentRunning = true; errorMessage = nil
        defer { agentRunning = false }
        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }
        do {
            let r = try await commands.runAgent(
                pcPeerId: pc, agentId: a.id, input: agentInput
            )
            self.agentRun = r
        } catch {
            self.errorMessage = String(describing: error)
            self.agentRun = nil
        }
    }

    /// v0.3 — 流式跑 agent：runAgentStream → 后台轮询 getAgentStreamChunk
    /// 累积 chunks 到 `agentStreamOutput`，直到 isComplete=true 退出。
    /// 用户调 [stopCurrentAgentRun] 时 cancel 任务 + 调 cancelAgentStream。
    private func runSelectedAgentStream(agent: AgentInfo) async {
        agentRunning = true; errorMessage = nil
        agentStreamOutput = ""
        agentStreamComplete = false
        agentStreamError = nil
        agentStreamId = nil
        agentRun = nil
        defer { agentRunning = false }

        guard let pc = await pcPeerIdProvider() else {
            errorMessage = "未配对桌面"; return
        }

        let startResp: StreamStartResponse
        do {
            startResp = try await commands.runAgentStream(
                pcPeerId: pc, agentId: agent.id, input: agentInput
            )
        } catch {
            self.errorMessage = String(describing: error)
            return
        }
        let streamId = startResp.streamId
        self.agentStreamId = streamId
        // 占位 agentRun 让 UI 显示 status/Stop 按钮
        self.agentRun = RunAgentResponse(
            agentId: agent.id, runId: streamId, status: "streaming"
        )

        agentStreamTask = Task { [weak self] in
            guard let self = self else { return }
            var sinceChunk = 0
            let pollInterval = await self.agentStreamPollIntervalNs
            while !Task.isCancelled {
                let resp: StreamChunkResponse
                do {
                    resp = try await self.commands.getAgentStreamChunk(
                        pcPeerId: pc, streamId: streamId, sinceChunk: sinceChunk
                    )
                } catch {
                    await MainActor.run {
                        self.agentStreamError = String(describing: error)
                        self.agentStreamComplete = true
                    }
                    return
                }
                // 累积新 chunks
                if !resp.chunks.isEmpty {
                    let added = resp.chunks.joined()
                    await MainActor.run {
                        self.agentStreamOutput += added
                    }
                    sinceChunk = resp.nextChunkIdx
                }
                if resp.isComplete {
                    await MainActor.run {
                        self.agentStreamComplete = true
                        if let err = resp.error, !err.isEmpty {
                            self.agentStreamError = err
                        }
                        // 同步 agentRun.status 用于 UI 颜色
                        if let cur = self.agentRun {
                            self.agentRun = RunAgentResponse(
                                agentId: cur.agentId,
                                runId: cur.runId,
                                status: resp.error != nil ? "failed" : "complete",
                                output: self.agentStreamOutput
                            )
                        }
                    }
                    return
                }
                try? await Task.sleep(nanoseconds: pollInterval)
            }
        }
    }

    public func stopCurrentAgentRun() async {
        guard let run = agentRun else { return }
        guard let pc = await pcPeerIdProvider() else { return }

        // v0.3 streaming 模式：先 cancel 任务 + 调 cancelAgentStream
        if let streamId = agentStreamId, !agentStreamComplete {
            agentStreamTask?.cancel()
            agentStreamTask = nil
            do {
                _ = try await commands.cancelAgentStream(pcPeerId: pc, streamId: streamId)
            } catch {
                // 忽略 cancel 错误 — 用户意图是停
            }
            self.agentStreamComplete = true
            if let cur = agentRun {
                self.agentRun = RunAgentResponse(
                    agentId: cur.agentId, runId: cur.runId,
                    status: "stopped", output: agentStreamOutput
                )
            }
            return
        }

        do {
            _ = try await commands.stopAgent(
                pcPeerId: pc,
                runId: run.runId,
                agentId: run.runId == nil ? run.agentId : nil
            )
            self.agentRun = nil
        } catch {
            self.errorMessage = String(describing: error)
        }
    }
}
