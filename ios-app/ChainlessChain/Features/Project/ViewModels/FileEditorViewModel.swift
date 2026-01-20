import Foundation
import Combine
import CoreCommon

/// 文件编辑器视图模型
/// 管理文件编辑、保存、预览等功能
@MainActor
class FileEditorViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var content: String = ""
    @Published var originalContent: String = ""
    @Published var isLoading: Bool = false
    @Published var isSaving: Bool = false
    @Published var error: String?
    @Published var lastSavedAt: Date?
    @Published var isPreviewMode: Bool = false
    @Published var wordCount: Int = 0
    @Published var lineCount: Int = 0

    // MARK: - File Info

    @Published var file: ProjectFileEntity?
    @Published var fileType: FileType = .text

    // MARK: - Auto-save

    private var autoSaveTimer: Timer?
    private let autoSaveInterval: TimeInterval = 30

    // MARK: - Dependencies

    private let projectManager = ProjectManager.shared
    private let logger = Logger.shared
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Types

    enum FileType: String {
        case markdown
        case code
        case text
        case json
        case image
        case pdf
        case unsupported

        var isEditable: Bool {
            switch self {
            case .markdown, .code, .text, .json:
                return true
            default:
                return false
            }
        }

        var hasPreview: Bool {
            switch self {
            case .markdown, .image, .pdf:
                return true
            default:
                return false
            }
        }
    }

    // MARK: - Computed Properties

    var hasUnsavedChanges: Bool {
        content != originalContent
    }

    var fileName: String {
        file?.name ?? "未命名"
    }

    var filePath: String {
        file?.path ?? ""
    }

    // MARK: - Initialization

    init() {
        setupBindings()
    }

    // MARK: - Public Methods

    /// 加载文件
    func loadFile(_ file: ProjectFileEntity) {
        self.file = file
        self.fileType = determineFileType(file)

        guard fileType.isEditable else {
            logger.info("File type \(fileType) is not editable", category: "FileEditor")
            return
        }

        isLoading = true
        error = nil

        // Load content
        if let fileContent = file.content {
            content = fileContent
            originalContent = fileContent
            updateStats()
        } else {
            // Try to load from storage
            do {
                if let loadedFile = try projectManager.getFile(fileId: file.id) {
                    content = loadedFile.content ?? ""
                    originalContent = content
                    updateStats()
                }
            } catch {
                self.error = "无法加载文件: \(error.localizedDescription)"
                logger.error("Failed to load file", error: error, category: "FileEditor")
            }
        }

        isLoading = false
        startAutoSave()
    }

    /// 保存文件
    func save() async {
        guard let file = file, hasUnsavedChanges else { return }

        isSaving = true
        error = nil

        do {
            try projectManager.updateFileContent(fileId: file.id, content: content)
            originalContent = content
            lastSavedAt = Date()
            logger.info("File saved: \(file.name)", category: "FileEditor")
        } catch {
            self.error = "保存失败: \(error.localizedDescription)"
            logger.error("Failed to save file", error: error, category: "FileEditor")
        }

        isSaving = false
    }

    /// 撤销更改
    func revertChanges() {
        content = originalContent
        updateStats()
    }

    /// 切换预览模式
    func togglePreview() {
        isPreviewMode.toggle()
    }

    /// 插入文本
    func insertText(_ text: String, at position: Int? = nil) {
        if let pos = position, pos <= content.count {
            let index = content.index(content.startIndex, offsetBy: pos)
            content.insert(contentsOf: text, at: index)
        } else {
            content.append(text)
        }
        updateStats()
    }

    /// 查找替换
    func findAndReplace(find: String, replace: String, all: Bool = false) -> Int {
        guard !find.isEmpty else { return 0 }

        if all {
            let original = content
            content = content.replacingOccurrences(of: find, with: replace)
            let count = (original.components(separatedBy: find).count - 1)
            updateStats()
            return count
        } else {
            if let range = content.range(of: find) {
                content.replaceSubrange(range, with: replace)
                updateStats()
                return 1
            }
            return 0
        }
    }

    /// 清空文件
    func clear() {
        content = ""
        updateStats()
    }

    // MARK: - Markdown Helpers

    /// 插入Markdown格式
    func insertMarkdown(_ format: MarkdownFormat) {
        let insertion: String
        switch format {
        case .bold:
            insertion = "**粗体文本**"
        case .italic:
            insertion = "*斜体文本*"
        case .heading1:
            insertion = "\n# 标题1\n"
        case .heading2:
            insertion = "\n## 标题2\n"
        case .heading3:
            insertion = "\n### 标题3\n"
        case .bulletList:
            insertion = "\n- 列表项\n"
        case .numberedList:
            insertion = "\n1. 列表项\n"
        case .link:
            insertion = "[链接文本](https://)"
        case .image:
            insertion = "![图片描述](图片URL)"
        case .code:
            insertion = "`代码`"
        case .codeBlock:
            insertion = "\n```\n代码块\n```\n"
        case .quote:
            insertion = "\n> 引用文本\n"
        case .horizontalRule:
            insertion = "\n---\n"
        case .table:
            insertion = "\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 内容 | 内容 | 内容 |\n"
        case .checkbox:
            insertion = "\n- [ ] 待办事项\n"
        }
        insertText(insertion)
    }

    enum MarkdownFormat {
        case bold
        case italic
        case heading1
        case heading2
        case heading3
        case bulletList
        case numberedList
        case link
        case image
        case code
        case codeBlock
        case quote
        case horizontalRule
        case table
        case checkbox
    }

    // MARK: - Private Methods

    private func setupBindings() {
        // Update stats when content changes
        $content
            .debounce(for: .milliseconds(500), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.updateStats()
            }
            .store(in: &cancellables)
    }

    private func startAutoSave() {
        autoSaveTimer?.invalidate()
        autoSaveTimer = Timer.scheduledTimer(withTimeInterval: autoSaveInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self, self.hasUnsavedChanges else { return }
                await self.save()
            }
        }
    }

    private func stopAutoSave() {
        autoSaveTimer?.invalidate()
        autoSaveTimer = nil
    }

    private func updateStats() {
        // Word count (approximation for mixed content)
        let words = content.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        wordCount = words.count

        // Line count
        lineCount = content.components(separatedBy: .newlines).count
    }

    private func determineFileType(_ file: ProjectFileEntity) -> FileType {
        let ext = (file.name as NSString).pathExtension.lowercased()

        switch ext {
        case "md", "markdown":
            return .markdown
        case "swift", "kt", "java", "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs",
             "c", "cpp", "h", "hpp", "html", "css", "scss", "sass", "less",
             "vue", "svelte", "sql", "sh", "bash", "zsh", "xml", "yaml", "yml":
            return .code
        case "json":
            return .json
        case "txt":
            return .text
        case "png", "jpg", "jpeg", "gif", "webp", "svg":
            return .image
        case "pdf":
            return .pdf
        default:
            // Check if it's text-like content
            if let content = file.content, !content.isEmpty {
                return .text
            }
            return .unsupported
        }
    }

    deinit {
        autoSaveTimer?.invalidate()
    }
}

// MARK: - ProjectManager Extension

extension ProjectManager {
    func getFile(fileId: String) throws -> ProjectFileEntity? {
        try repository.getFile(id: fileId)
    }

    func updateFileContent(fileId: String, content: String) throws {
        guard var file = try repository.getFile(id: fileId) else {
            throw ProjectError.fileNotFound
        }
        file.content = content
        file.size = Int64(content.utf8.count)
        file.updatedAt = Date()
        try repository.updateFile(file)
    }
}
