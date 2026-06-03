import Foundation
import UIKit
import PDFKit
import CoreCommon

/// 文档导出管理器
/// 负责将项目文件导出为不同格式
/// Reference: desktop-app-vue/src/main/project/project-export-ipc.js
@MainActor
class DocumentExportManager: ObservableObject {
    // MARK: - Singleton

    static let shared = DocumentExportManager()

    // MARK: - Dependencies

    private let projectManager = ProjectManager.shared
    private let llmManager = LLMManager.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var isExporting = false
    @Published var exportProgress: Double = 0
    @Published var error: String?

    // MARK: - Types

    /// 导出格式
    enum ExportFormat: String, CaseIterable {
        case pdf = "pdf"
        case html = "html"
        case markdown = "markdown"
        case plainText = "txt"

        var displayName: String {
            switch self {
            case .pdf: return "PDF 文档"
            case .html: return "HTML 网页"
            case .markdown: return "Markdown"
            case .plainText: return "纯文本"
            }
        }

        var fileExtension: String {
            return rawValue
        }

        var mimeType: String {
            switch self {
            case .pdf: return "application/pdf"
            case .html: return "text/html"
            case .markdown: return "text/markdown"
            case .plainText: return "text/plain"
            }
        }
    }

    /// 导出结果
    struct ExportResult {
        let success: Bool
        let fileName: String
        let data: Data
        let format: ExportFormat
        let fileSize: Int64
    }

    /// 导出选项
    struct ExportOptions {
        var includeMetadata: Bool = true
        var includeTableOfContents: Bool = true
        var pageSize: PageSize = .a4
        var margin: CGFloat = 20
        var fontSize: CGFloat = 12
        var title: String?
        var author: String?

        enum PageSize {
            case a4
            case letter
            case legal

            var size: CGSize {
                switch self {
                case .a4: return CGSize(width: 595, height: 842)  // 72 DPI
                case .letter: return CGSize(width: 612, height: 792)
                case .legal: return CGSize(width: 612, height: 1008)
                }
            }
        }
    }

    private init() {}

    // MARK: - Export Methods

    /// 导出文档
    /// Reference: desktop-app-vue/src/main/project/project-export-ipc.js (project:exportDocument)
    func exportDocument(
        file: ProjectFileEntity,
        format: ExportFormat,
        options: ExportOptions = ExportOptions()
    ) async throws -> ExportResult {
        isExporting = true
        exportProgress = 0
        error = nil

        defer {
            isExporting = false
            exportProgress = 1.0
        }

        guard let content = file.content, !content.isEmpty else {
            throw DocumentExportError.emptyContent
        }

        logger.info("[DocumentExport] Exporting \(file.name) to \(format.displayName)", category: "Export")

        let data: Data
        let fileName: String

        switch format {
        case .pdf:
            exportProgress = 0.3
            data = try await exportToPDF(content: content, options: options)
            fileName = file.name.replacingOccurrences(of: ".\(file.type)", with: ".pdf")

        case .html:
            exportProgress = 0.3
            data = try exportToHTML(content: content, title: options.title ?? file.name, options: options)
            fileName = file.name.replacingOccurrences(of: ".\(file.type)", with: ".html")

        case .markdown:
            exportProgress = 0.3
            data = try exportToMarkdown(content: content, options: options)
            fileName = file.name.replacingOccurrences(of: ".\(file.type)", with: ".md")

        case .plainText:
            exportProgress = 0.3
            data = try exportToPlainText(content: content)
            fileName = file.name.replacingOccurrences(of: ".\(file.type)", with: ".txt")
        }

        exportProgress = 0.9

        logger.info("[DocumentExport] Export completed: \(fileName) (\(data.count) bytes)", category: "Export")

        return ExportResult(
            success: true,
            fileName: fileName,
            data: data,
            format: format,
            fileSize: Int64(data.count)
        )
    }

    /// 批量导出项目文件
    func exportProjectDocuments(
        projectId: String,
        format: ExportFormat,
        fileIds: [String]? = nil
    ) async throws -> [ExportResult] {
        let files: [ProjectFileEntity]

        if let ids = fileIds {
            files = try ids.compactMap { id in
                try ProjectRepository.shared.getProjectFile(id: id)
            }
        } else {
            files = try ProjectRepository.shared.getProjectFiles(projectId: projectId)
        }

        var results: [ExportResult] = []
        let totalFiles = files.filter { !$0.isDirectory && $0.content != nil }.count

        for (index, file) in files.enumerated() where !file.isDirectory && file.content != nil {
            exportProgress = Double(index) / Double(totalFiles)

            do {
                let result = try await exportDocument(file: file, format: format)
                results.append(result)
            } catch {
                logger.error("[DocumentExport] Failed to export \(file.name)", error: error, category: "Export")
            }
        }

        return results
    }

    // MARK: - Format-Specific Export

    /// 导出为 PDF
    private func exportToPDF(content: String, options: ExportOptions) async throws -> Data {
        // Check if content is Markdown and convert to HTML first
        let htmlContent: String
        if isMarkdown(content) {
            htmlContent = convertMarkdownToHTML(content, options: options)
        } else {
            htmlContent = wrapInHTML(content, options: options)
        }

        // Create PDF from HTML using UIKit
        return try await withCheckedThrowingContinuation { continuation in
            let printFormatter = UIMarkupTextPrintFormatter(markupText: htmlContent)

            let renderer = UIPrintPageRenderer()
            renderer.addPrintFormatter(printFormatter, startingAtPageAt: 0)

            let pageSize = options.pageSize.size
            let margin = options.margin

            let printableRect = CGRect(
                x: margin,
                y: margin,
                width: pageSize.width - margin * 2,
                height: pageSize.height - margin * 2
            )
            let paperRect = CGRect(origin: .zero, size: pageSize)

            renderer.setValue(NSValue(cgRect: paperRect), forKey: "paperRect")
            renderer.setValue(NSValue(cgRect: printableRect), forKey: "printableRect")

            let pdfData = NSMutableData()

            UIGraphicsBeginPDFContextToData(pdfData, paperRect, nil)

            for pageIndex in 0..<renderer.numberOfPages {
                UIGraphicsBeginPDFPage()
                renderer.drawPage(at: pageIndex, in: UIGraphicsGetPDFContextBounds())
            }

            UIGraphicsEndPDFContext()

            continuation.resume(returning: pdfData as Data)
        }
    }

    /// 导出为 HTML
    private func exportToHTML(content: String, title: String, options: ExportOptions) throws -> Data {
        let htmlContent: String

        if isMarkdown(content) {
            htmlContent = convertMarkdownToHTML(content, options: options)
        } else {
            htmlContent = wrapInHTML(content, options: options)
        }

        // Add full HTML document structure
        let fullHTML = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>\(escapeHTML(title))</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    color: #333;
                }
                h1, h2, h3 { color: #2c3e50; }
                code {
                    background: #f4f4f4;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-family: monospace;
                }
                pre {
                    background: #f4f4f4;
                    padding: 15px;
                    border-radius: 5px;
                    overflow-x: auto;
                }
                blockquote {
                    border-left: 4px solid #ddd;
                    margin: 0;
                    padding-left: 15px;
                    color: #666;
                }
                table {
                    border-collapse: collapse;
                    width: 100%;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th { background: #f4f4f4; }
                \(options.includeMetadata ? """
                .metadata {
                    color: #666;
                    font-size: 0.9em;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                    margin-bottom: 20px;
                }
                """ : "")
            </style>
        </head>
        <body>
            \(options.includeMetadata ? """
            <div class="metadata">
                <p>导出时间: \(Date().formatted())</p>
                \(options.author != nil ? "<p>作者: \(options.author!)</p>" : "")
            </div>
            """ : "")
            \(htmlContent)
        </body>
        </html>
        """

        guard let data = fullHTML.data(using: .utf8) else {
            throw DocumentExportError.encodingFailed
        }

        return data
    }

    /// 导出为 Markdown
    private func exportToMarkdown(content: String, options: ExportOptions) throws -> Data {
        var markdown = content

        // Add metadata header if requested
        if options.includeMetadata {
            let header = """
            ---
            title: \(options.title ?? "Untitled")
            author: \(options.author ?? "Unknown")
            date: \(Date().formatted())
            ---

            """
            markdown = header + markdown
        }

        guard let data = markdown.data(using: .utf8) else {
            throw DocumentExportError.encodingFailed
        }

        return data
    }

    /// 导出为纯文本
    private func exportToPlainText(content: String) throws -> Data {
        // Strip HTML/Markdown formatting if present
        var plainText = content

        // Remove HTML tags
        plainText = plainText.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)

        // Remove Markdown formatting
        plainText = plainText.replacingOccurrences(of: "\\*\\*(.+?)\\*\\*", with: "$1", options: .regularExpression)
        plainText = plainText.replacingOccurrences(of: "\\*(.+?)\\*", with: "$1", options: .regularExpression)
        plainText = plainText.replacingOccurrences(of: "`(.+?)`", with: "$1", options: .regularExpression)
        plainText = plainText.replacingOccurrences(of: "^#{1,6}\\s*", with: "", options: .regularExpression)

        guard let data = plainText.data(using: .utf8) else {
            throw DocumentExportError.encodingFailed
        }

        return data
    }

    // MARK: - AI-Powered Export

    /// 生成播客脚本
    /// Reference: desktop-app-vue/src/main/project/project-export-ipc.js (project:generatePodcastScript)
    func generatePodcastScript(from content: String) async throws -> String {
        isExporting = true
        defer { isExporting = false }

        let prompt = """
        请将以下文章内容转换为适合播客朗读的口语化脚本：

        \(content)

        要求：
        1. 使用第一人称，自然流畅
        2. 增加过渡语和互动语言
        3. 适合音频传播
        4. 保持原文核心内容
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.7,
            "maxTokens": 3000
        ])

        return result["content"] as? String ?? ""
    }

    /// 生成 PPT 大纲
    /// Reference: desktop-app-vue/src/main/project/project-export-ipc.js (project:generatePPT)
    func generatePPTOutline(from content: String) async throws -> PPTOutline {
        isExporting = true
        defer { isExporting = false }

        let prompt = """
        请将以下内容转换为 PPT 演示文稿大纲，以 JSON 格式返回：

        \(content)

        返回格式：
        ```json
        {
          "title": "演示文稿标题",
          "slides": [
            {
              "title": "幻灯片标题",
              "bullets": ["要点1", "要点2", "要点3"],
              "notes": "演讲备注"
            }
          ]
        }
        ```

        要求：
        1. 每个幻灯片不超过5个要点
        2. 标题简洁明了
        3. 内容层次分明
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 2000
        ])

        let responseContent = result["content"] as? String ?? ""

        // Parse JSON from response
        guard let jsonMatch = responseContent.range(of: #"\{[\s\S]*\}"#, options: .regularExpression),
              let data = String(responseContent[jsonMatch]).data(using: .utf8) else {
            throw DocumentExportError.parseFailed
        }

        return try JSONDecoder().decode(PPTOutline.self, from: data)
    }

    // MARK: - Helper Methods

    private func isMarkdown(_ content: String) -> Bool {
        // Check for common Markdown patterns
        let patterns = [
            "^#{1,6}\\s",      // Headers
            "^\\*\\s|^-\\s",   // Lists
            "\\[.+\\]\\(.+\\)", // Links
            "```",             // Code blocks
            "\\*\\*.+\\*\\*"   // Bold
        ]

        for pattern in patterns {
            if content.range(of: pattern, options: .regularExpression) != nil {
                return true
            }
        }

        return false
    }

    private func convertMarkdownToHTML(_ markdown: String, options: ExportOptions) -> String {
        var html = markdown

        // Convert headers
        html = html.replacingOccurrences(of: "^######\\s*(.+)$", with: "<h6>$1</h6>", options: .regularExpression)
        html = html.replacingOccurrences(of: "^#####\\s*(.+)$", with: "<h5>$1</h5>", options: .regularExpression)
        html = html.replacingOccurrences(of: "^####\\s*(.+)$", with: "<h4>$1</h4>", options: .regularExpression)
        html = html.replacingOccurrences(of: "^###\\s*(.+)$", with: "<h3>$1</h3>", options: .regularExpression)
        html = html.replacingOccurrences(of: "^##\\s*(.+)$", with: "<h2>$1</h2>", options: .regularExpression)
        html = html.replacingOccurrences(of: "^#\\s*(.+)$", with: "<h1>$1</h1>", options: .regularExpression)

        // Convert bold and italic
        html = html.replacingOccurrences(of: "\\*\\*(.+?)\\*\\*", with: "<strong>$1</strong>", options: .regularExpression)
        html = html.replacingOccurrences(of: "\\*(.+?)\\*", with: "<em>$1</em>", options: .regularExpression)

        // Convert inline code
        html = html.replacingOccurrences(of: "`([^`]+)`", with: "<code>$1</code>", options: .regularExpression)

        // Convert code blocks
        html = html.replacingOccurrences(of: "```([\\s\\S]*?)```", with: "<pre><code>$1</code></pre>", options: .regularExpression)

        // Convert links
        html = html.replacingOccurrences(of: "\\[(.+?)\\]\\((.+?)\\)", with: "<a href=\"$2\">$1</a>", options: .regularExpression)

        // Convert line breaks to paragraphs
        let paragraphs = html.components(separatedBy: "\n\n")
        html = paragraphs.map { "<p>\($0)</p>" }.joined(separator: "\n")

        return html
    }

    private func wrapInHTML(_ content: String, options: ExportOptions) -> String {
        // Escape HTML entities and wrap in paragraphs
        let escaped = escapeHTML(content)
        let paragraphs = escaped.components(separatedBy: "\n\n")
        return paragraphs.map { "<p>\($0)</p>" }.joined(separator: "\n")
    }

    private func escapeHTML(_ string: String) -> String {
        return string
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}

// MARK: - Supporting Types

/// PPT 大纲结构
struct PPTOutline: Codable {
    let title: String
    let slides: [PPTSlide]

    struct PPTSlide: Codable {
        let title: String
        let bullets: [String]
        let notes: String?
    }
}

// MARK: - Errors

enum DocumentExportError: LocalizedError {
    case emptyContent
    case encodingFailed
    case parseFailed
    case unsupportedFormat
    case exportFailed(String)

    var errorDescription: String? {
        switch self {
        case .emptyContent:
            return "文件内容为空"
        case .encodingFailed:
            return "编码转换失败"
        case .parseFailed:
            return "解析失败"
        case .unsupportedFormat:
            return "不支持的格式"
        case .exportFailed(let message):
            return "导出失败: \(message)"
        }
    }
}
