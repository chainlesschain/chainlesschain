import Foundation
import PDFKit
import UniformTypeIdentifiers

/// 文档引擎
///
/// 负责处理各种文档格式（PDF、Word、Excel、PPT、Markdown等）
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/document-engine.js
public class DocumentEngine: BaseAIEngine {

    public static let shared = DocumentEngine()

    // 支持的文档类型
    public enum DocumentType: String {
        case pdf = "pdf"
        case word = "word"
        case excel = "excel"
        case powerpoint = "ppt"
        case markdown = "md"
        case text = "txt"
        case rtf = "rtf"
        case html = "html"
    }

    private init() {
        super.init(
            type: .document,
            name: "文档引擎",
            description: "处理PDF、Word、Excel、PPT、Markdown等文档格式"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "extract_text",
                name: "文本提取",
                description: "从PDF、Word等文档中提取文本"
            ),
            AIEngineCapability(
                id: "create_document",
                name: "创建文档",
                description: "创建新的文档文件"
            ),
            AIEngineCapability(
                id: "convert_format",
                name: "格式转换",
                description: "在不同文档格式间转换"
            ),
            AIEngineCapability(
                id: "parse_structure",
                name: "结构解析",
                description: "解析文档结构（标题、段落、表格等）"
            ),
            AIEngineCapability(
                id: "ocr",
                name: "OCR识别",
                description: "从图片中识别文字"
            ),
            AIEngineCapability(
                id: "summarize",
                name: "文档摘要",
                description: "生成文档摘要"
            ),
            AIEngineCapability(
                id: "translate",
                name: "文档翻译",
                description: "翻译文档内容"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 注册文档处理相关的技能和工具
        Logger.shared.info("文档引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("文档引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "extract_text":
            return try await extractText(parameters: parameters)

        case "create_pdf":
            return try await createPDF(parameters: parameters)

        case "parse_structure":
            return try await parseStructure(parameters: parameters)

        case "ocr":
            return try await performOCR(parameters: parameters)

        case "summarize":
            return try await summarizeDocument(parameters: parameters)

        case "translate":
            return try await translateDocument(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - PDF处理

    /// 从PDF提取文本
    private func extractText(parameters: [String: Any]) async throws -> [String: Any] {
        guard let filePath = parameters["filePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少filePath参数")
        }

        let fileURL = URL(fileURLWithPath: filePath)

        guard let pdfDocument = PDFDocument(url: fileURL) else {
            throw AIEngineError.executionFailed("无法打开PDF文件")
        }

        var extractedText = ""
        let pageCount = pdfDocument.pageCount

        // 提取所有页面的文本
        for pageIndex in 0..<pageCount {
            if let page = pdfDocument.page(at: pageIndex),
               let pageText = page.string {
                extractedText += pageText + "\n\n"
            }
        }

        return [
            "text": extractedText,
            "pageCount": pageCount,
            "filePath": filePath
        ]
    }

    /// 创建PDF文档
    private func createPDF(parameters: [String: Any]) async throws -> [String: Any] {
        guard let outputPath = parameters["outputPath"] as? String,
              let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少outputPath或content参数")
        }

        // 创建PDF上下文
        let outputURL = URL(fileURLWithPath: outputPath)
        let pageSize = CGSize(width: 612, height: 792) // 8.5 x 11 inches
        let pageRect = CGRect(origin: .zero, size: pageSize)

        guard let pdfContext = CGContext(outputURL as CFURL, mediaBox: &pageRect.cgRect, nil) else {
            throw AIEngineError.executionFailed("无法创建PDF上下文")
        }

        // 开始PDF页面
        pdfContext.beginPDFPage(nil)

        // 绘制文本
        let textAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 12),
            .foregroundColor: UIColor.black
        ]

        let attributedText = NSAttributedString(string: content, attributes: textAttributes)
        let textRect = CGRect(x: 50, y: 50, width: pageSize.width - 100, height: pageSize.height - 100)

        attributedText.draw(in: textRect)

        // 结束PDF页面
        pdfContext.endPDFPage()
        pdfContext.closePDF()

        return [
            "success": true,
            "outputPath": outputPath,
            "pageCount": 1
        ]
    }

    /// 解析文档结构
    private func parseStructure(parameters: [String: Any]) async throws -> [String: Any] {
        guard let filePath = parameters["filePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少filePath参数")
        }

        // 提取文本
        let extractResult = try await extractText(parameters: ["filePath": filePath])
        guard let text = extractResult["text"] as? String else {
            throw AIEngineError.executionFailed("文本提取失败")
        }

        // 使用LLM分析文档结构
        let structurePrompt = """
        请分析以下文档内容，提取文档结构：

        \(text)

        请返回JSON格式的结构，包括：
        - 标题层级
        - 主要段落
        - 关键词
        - 主题分类
        """

        let structureJSON = try await generateWithLLM(
            prompt: structurePrompt,
            systemPrompt: "你是一个文档结构分析专家，擅长提取文档的层次结构。"
        )

        return [
            "structure": structureJSON,
            "filePath": filePath
        ]
    }

    // MARK: - OCR处理

    /// 执行OCR识别
    private func performOCR(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        // TODO: 集成Vision框架进行OCR
        // 这里返回模拟数据
        return [
            "text": "OCR识别功能待实现（需要集成Vision框架）",
            "confidence": 0.0,
            "imagePath": imagePath
        ]
    }

    // MARK: - AI增强功能

    /// 文档摘要生成
    private func summarizeDocument(parameters: [String: Any]) async throws -> [String: Any] {
        guard let filePath = parameters["filePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少filePath参数")
        }

        // 提取文本
        let extractResult = try await extractText(parameters: ["filePath": filePath])
        guard let text = extractResult["text"] as? String else {
            throw AIEngineError.executionFailed("文本提取失败")
        }

        let maxLength = parameters["maxLength"] as? Int ?? 500

        // 使用LLM生成摘要
        let summaryPrompt = """
        请为以下文档生成简洁的摘要（不超过\(maxLength)字）：

        \(text)
        """

        let summary = try await generateWithLLM(
            prompt: summaryPrompt,
            systemPrompt: "你是一个专业的文档摘要生成助手。"
        )

        return [
            "summary": summary,
            "originalLength": text.count,
            "summaryLength": summary.count,
            "filePath": filePath
        ]
    }

    /// 文档翻译
    private func translateDocument(parameters: [String: Any]) async throws -> [String: Any] {
        guard let filePath = parameters["filePath"] as? String,
              let targetLanguage = parameters["targetLanguage"] as? String else {
            throw AIEngineError.invalidParameters("缺少filePath或targetLanguage参数")
        }

        // 提取文本
        let extractResult = try await extractText(parameters: ["filePath": filePath])
        guard let text = extractResult["text"] as? String else {
            throw AIEngineError.executionFailed("文本提取失败")
        }

        // 使用LLM翻译
        let translatePrompt = """
        请将以下文档翻译成\(targetLanguage)：

        \(text)
        """

        let translatedText = try await generateWithLLM(
            prompt: translatePrompt,
            systemPrompt: "你是一个专业的翻译助手，擅长保持原文的格式和语气。"
        )

        return [
            "translatedText": translatedText,
            "sourceLanguage": "auto",
            "targetLanguage": targetLanguage,
            "filePath": filePath
        ]
    }

    // MARK: - 辅助方法

    /// 检测文档类型
    public func detectDocumentType(filePath: String) -> DocumentType? {
        let fileURL = URL(fileURLWithPath: filePath)
        let fileExtension = fileURL.pathExtension.lowercased()

        switch fileExtension {
        case "pdf":
            return .pdf
        case "doc", "docx":
            return .word
        case "xls", "xlsx":
            return .excel
        case "ppt", "pptx":
            return .powerpoint
        case "md", "markdown":
            return .markdown
        case "txt":
            return .text
        case "rtf":
            return .rtf
        case "html", "htm":
            return .html
        default:
            return nil
        }
    }
}

// MARK: - CGRect Extension

private extension CGRect {
    var cgRect: CGRect {
        return self
    }
}
