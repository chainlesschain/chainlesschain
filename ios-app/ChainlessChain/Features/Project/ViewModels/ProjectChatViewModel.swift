import Foundation
import Combine
import CoreCommon

/// 项目聊天视图模型
/// 管理项目上下文中的AI对话
@MainActor
class ProjectChatViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var messages: [ChatMessage] = []
    @Published var inputText: String = ""
    @Published var isLoading: Bool = false
    @Published var error: String?
    @Published var selectedQuickAction: QuickAction?

    // MARK: - Dependencies

    private let projectAIManager = ProjectAIManager.shared
    private let projectManager = ProjectManager.shared
    private let logger = Logger.shared
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Project Context

    let projectId: String
    var currentFile: ProjectFileEntity?

    // MARK: - Types

    struct ChatMessage: Identifiable, Equatable {
        let id: String
        let role: MessageRole
        let content: String
        let timestamp: Date
        var isStreaming: Bool
        var fileOperations: [FileOperation]

        enum MessageRole: String {
            case user
            case assistant
            case system
        }

        struct FileOperation: Equatable {
            let type: OperationType
            let path: String
            let description: String

            enum OperationType: String {
                case create
                case update
                case delete
            }
        }

        static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
            lhs.id == rhs.id
        }
    }

    enum QuickAction: String, CaseIterable, Identifiable {
        case createFile = "create_file"
        case explainCode = "explain_code"
        case refactorCode = "refactor_code"
        case generateTests = "generate_tests"
        case fixBug = "fix_bug"
        case summarize = "summarize"
        case translate = "translate"
        case expand = "expand"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .createFile: return "创建文件"
            case .explainCode: return "解释代码"
            case .refactorCode: return "重构代码"
            case .generateTests: return "生成测试"
            case .fixBug: return "修复Bug"
            case .summarize: return "生成摘要"
            case .translate: return "翻译"
            case .expand: return "扩写"
            }
        }

        var icon: String {
            switch self {
            case .createFile: return "doc.badge.plus"
            case .explainCode: return "questionmark.circle"
            case .refactorCode: return "arrow.triangle.2.circlepath"
            case .generateTests: return "checkmark.shield"
            case .fixBug: return "ladybug"
            case .summarize: return "text.alignleft"
            case .translate: return "globe"
            case .expand: return "text.append"
            }
        }

        var prompt: String {
            switch self {
            case .createFile: return "请帮我创建一个新文件："
            case .explainCode: return "请解释这段代码的功能："
            case .refactorCode: return "请重构这段代码，提高可读性和性能："
            case .generateTests: return "请为这段代码生成单元测试："
            case .fixBug: return "请帮我修复这个Bug："
            case .summarize: return "请为以下内容生成摘要："
            case .translate: return "请翻译以下内容："
            case .expand: return "请扩展以下内容："
            }
        }
    }

    // MARK: - Initialization

    init(projectId: String) {
        self.projectId = projectId
        loadConversationHistory()
        setupBindings()
    }

    // MARK: - Public Methods

    /// 发送消息
    func sendMessage() async {
        let message = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }

        inputText = ""
        isLoading = true
        error = nil

        // Add user message
        let userMessage = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: message,
            timestamp: Date(),
            isStreaming: false,
            fileOperations: []
        )
        messages.append(userMessage)

        // Add placeholder for assistant response
        let placeholderId = UUID().uuidString
        let placeholder = ChatMessage(
            id: placeholderId,
            role: .assistant,
            content: "",
            timestamp: Date(),
            isStreaming: true,
            fileOperations: []
        )
        messages.append(placeholder)

        do {
            let response = try await projectAIManager.chat(
                projectId: projectId,
                userMessage: message,
                contextMode: currentFile != nil ? .file : .project,
                currentFile: currentFile
            )

            // Update placeholder with actual response
            if let index = messages.firstIndex(where: { $0.id == placeholderId }) {
                let fileOps = response.fileOperations.map { op in
                    ChatMessage.FileOperation(
                        type: ChatMessage.FileOperation.OperationType(rawValue: op.type) ?? .create,
                        path: op.path,
                        description: "\(op.type): \(op.path)"
                    )
                }

                messages[index] = ChatMessage(
                    id: placeholderId,
                    role: .assistant,
                    content: response.content,
                    timestamp: Date(),
                    isStreaming: false,
                    fileOperations: fileOps
                )
            }

            logger.info("Chat response received, tokens: \(response.tokens)", category: "ProjectChat")

        } catch {
            // Remove placeholder on error
            messages.removeAll { $0.id == placeholderId }
            self.error = error.localizedDescription
            logger.error("Chat failed", error: error, category: "ProjectChat")
        }

        isLoading = false
    }

    /// 使用快捷操作发送消息
    func sendQuickAction(_ action: QuickAction, context: String = "") {
        let prompt: String
        if context.isEmpty {
            if let file = currentFile, let content = file.content {
                prompt = "\(action.prompt)\n\n```\n\(content)\n```"
            } else {
                prompt = action.prompt
            }
        } else {
            prompt = "\(action.prompt)\n\n\(context)"
        }

        inputText = prompt
        Task {
            await sendMessage()
        }
    }

    /// 清空对话历史
    func clearHistory() {
        messages.removeAll()
        projectAIManager.clearConversation()
        logger.info("Chat history cleared", category: "ProjectChat")
    }

    /// 重新生成最后一条回复
    func regenerateLastResponse() async {
        guard let lastUserMessage = messages.last(where: { $0.role == .user }) else { return }

        // Remove last assistant message
        if let lastAssistantIndex = messages.lastIndex(where: { $0.role == .assistant }) {
            messages.remove(at: lastAssistantIndex)
        }

        // Resend user message
        inputText = lastUserMessage.content
        // Also remove the last user message as sendMessage will re-add it
        if let lastUserIndex = messages.lastIndex(where: { $0.role == .user }) {
            messages.remove(at: lastUserIndex)
        }

        await sendMessage()
    }

    /// 复制消息内容
    func copyMessage(_ message: ChatMessage) {
        UIPasteboard.general.string = message.content
    }

    // MARK: - Private Methods

    private func loadConversationHistory() {
        // Load from ProjectAIManager's conversation history
        messages = projectAIManager.conversationHistory.map { msg in
            ChatMessage(
                id: msg.id,
                role: ChatMessage.MessageRole(rawValue: msg.role) ?? .assistant,
                content: msg.content,
                timestamp: msg.timestamp,
                isStreaming: false,
                fileOperations: []
            )
        }
    }

    private func setupBindings() {
        // Observe ProjectAIManager's isProcessing state
        projectAIManager.$isProcessing
            .receive(on: DispatchQueue.main)
            .sink { [weak self] processing in
                self?.isLoading = processing
            }
            .store(in: &cancellables)

        // Observe ProjectAIManager's error
        projectAIManager.$error
            .receive(on: DispatchQueue.main)
            .sink { [weak self] error in
                self?.error = error
            }
            .store(in: &cancellables)
    }
}

// MARK: - ProjectAIManager Extension

extension ProjectAIManager {
    func clearConversation() {
        conversationHistory.removeAll()
        currentConversationId = nil
    }
}
