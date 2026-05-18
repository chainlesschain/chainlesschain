import Foundation
import SwiftUI

/// Phase 6.4 — `AIExtendedView` 的 @MainActor ViewModel。
///
/// 3 sub-tab (Templates / Code / RAG) 独立状态 + 错误 / loading。Multimodal (image/
/// audio) 和 Agents 留 v0.2 单独 view（multimodal 需 image picker / audio recorder
/// infrastructure，agents 需 agent metadata 设计）。
@MainActor
public final class RemoteAIExtendedViewModel: ObservableObject {

    public enum SubTab: String, CaseIterable, Identifiable {
        case templates
        case code
        case rag
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .templates: return "模板"
            case .code: return "代码"
            case .rag: return "RAG"
            }
        }
        public var icon: String {
            switch self {
            case .templates: return "doc.text"
            case .code: return "chevron.left.forwardslash.chevron.right"
            case .rag: return "magnifyingglass.circle"
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
}
