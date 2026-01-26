import Foundation
import PDFKit
import UIKit

// MARK: - Document Processing Tools (15 tools)
// PDF: 6 tools | Word: 3 tools | Excel: 3 tools | Markdown: 3 tools

public class DocumentProcessingTools {

    // MARK: - PDF Tools (6 tools)

    /// Tool: tool.pdf.info - 获取PDF文档信息
    public static let pdfInfoTool = Tool(
        id: "tool.pdf.info",
        name: "PDF信息查询",
        description: "获取PDF文档的页数、大小、作者、标题等元数据信息",
        category: .utility,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "PDF文件路径", required: true)
        ],
        executor: pdfInfoExecutor
    )

    private static let pdfInfoExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少PDF文件路径")
        }

        let url = URL(fileURLWithPath: path)
        guard let document = PDFDocument(url: url) else {
            return .failure(error: "无法打开PDF文档")
        }

        var info: [String: Any] = [:]
        info["pageCount"] = document.pageCount

        // 获取文档属性
        if let documentAttributes = document.documentAttributes {
            info["title"] = documentAttributes[PDFDocumentAttribute.titleAttribute] as? String ?? ""
            info["author"] = documentAttributes[PDFDocumentAttribute.authorAttribute] as? String ?? ""
            info["subject"] = documentAttributes[PDFDocumentAttribute.subjectAttribute] as? String ?? ""
            info["creator"] = documentAttributes[PDFDocumentAttribute.creatorAttribute] as? String ?? ""
            info["producer"] = documentAttributes[PDFDocumentAttribute.producerAttribute] as? String ?? ""

            if let creationDate = documentAttributes[PDFDocumentAttribute.creationDateAttribute] as? Date {
                info["creationDate"] = ISO8601DateFormatter().string(from: creationDate)
            }
        }

        // 获取文件大小
        if let attributes = try? FileManager.default.attributesOfItem(atPath: path) {
            info["fileSize"] = attributes[.size] as? UInt64 ?? 0
        }

        return .success(data: info)
    }

    /// Tool: tool.pdf.merge - 合并多个PDF文档
    public static let pdfMergeTool = Tool(
        id: "tool.pdf.merge",
        name: "PDF合并",
        description: "将多个PDF文档合并为一个PDF文件",
        category: .utility,
        parameters: [
            ToolParameter(name: "inputPaths", type: .array, description: "输入PDF文件路径数组", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出PDF文件路径", required: true)
        ],
        executor: pdfMergeExecutor
    )

    private static let pdfMergeExecutor: ToolExecutor = { input in
        guard let inputPaths = input.getArray("inputPaths") as? [String] else {
            return .failure(error: "缺少输入PDF文件路径数组")
        }
        guard let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少输出PDF文件路径")
        }

        if inputPaths.isEmpty {
            return .failure(error: "输入文件列表为空")
        }

        let mergedDocument = PDFDocument()
        var currentPageIndex = 0

        for path in inputPaths {
            let url = URL(fileURLWithPath: path)
            guard let document = PDFDocument(url: url) else {
                return .failure(error: "无法打开PDF文档: \(path)")
            }

            for pageIndex in 0..<document.pageCount {
                if let page = document.page(at: pageIndex) {
                    mergedDocument.insert(page, at: currentPageIndex)
                    currentPageIndex += 1
                }
            }
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        guard mergedDocument.write(to: outputURL) else {
            return .failure(error: "无法保存合并后的PDF文档")
        }

        return .success(data: ["outputPath": outputPath, "pageCount": currentPageIndex])
    }

    /// Tool: tool.pdf.split - 拆分PDF文档
    public static let pdfSplitTool = Tool(
        id: "tool.pdf.split",
        name: "PDF拆分",
        description: "将PDF文档按页码范围拆分成多个文件",
        category: .utility,
        parameters: [
            ToolParameter(name: "inputPath", type: .string, description: "输入PDF文件路径", required: true),
            ToolParameter(name: "outputDir", type: .string, description: "输出目录", required: true),
            ToolParameter(name: "ranges", type: .array, description: "页码范围数组，如[[1,3],[4,6]]表示拆分成1-3页和4-6页", required: true)
        ],
        executor: pdfSplitExecutor
    )

    private static let pdfSplitExecutor: ToolExecutor = { input in
        guard let inputPath = input.getString("inputPath") else {
            return .failure(error: "缺少输入PDF文件路径")
        }
        guard let outputDir = input.getString("outputDir") else {
            return .failure(error: "缺少输出目录")
        }
        guard let ranges = input.getArray("ranges") as? [[Int]] else {
            return .failure(error: "缺少页码范围数组")
        }

        let url = URL(fileURLWithPath: inputPath)
        guard let document = PDFDocument(url: url) else {
            return .failure(error: "无法打开PDF文档")
        }

        // 创建输出目录
        try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        var outputFiles: [String] = []

        for (index, range) in ranges.enumerated() {
            guard range.count == 2 else {
                return .failure(error: "无效的页码范围: \(range)")
            }

            let startPage = range[0] - 1 // 0-based index
            let endPage = range[1] - 1

            if startPage < 0 || endPage >= document.pageCount || startPage > endPage {
                return .failure(error: "无效的页码范围: \(range)")
            }

            let newDocument = PDFDocument()
            for pageIndex in startPage...endPage {
                if let page = document.page(at: pageIndex) {
                    newDocument.insert(page, at: newDocument.pageCount)
                }
            }

            let outputPath = "\(outputDir)/split_\(index + 1).pdf"
            let outputURL = URL(fileURLWithPath: outputPath)

            guard newDocument.write(to: outputURL) else {
                return .failure(error: "无法保存拆分后的PDF文档: \(outputPath)")
            }

            outputFiles.append(outputPath)
        }

        return .success(data: ["outputFiles": outputFiles, "count": outputFiles.count])
    }

    /// Tool: tool.pdf.extract - 提取PDF页面
    public static let pdfExtractTool = Tool(
        id: "tool.pdf.extract",
        name: "PDF页面提取",
        description: "从PDF文档中提取指定页面",
        category: .utility,
        parameters: [
            ToolParameter(name: "inputPath", type: .string, description: "输入PDF文件路径", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出PDF文件路径", required: true),
            ToolParameter(name: "pages", type: .array, description: "要提取的页码数组（1-based）", required: true)
        ],
        executor: pdfExtractExecutor
    )

    private static let pdfExtractExecutor: ToolExecutor = { input in
        guard let inputPath = input.getString("inputPath") else {
            return .failure(error: "缺少输入PDF文件路径")
        }
        guard let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少输出PDF文件路径")
        }
        guard let pages = input.getArray("pages") as? [Int] else {
            return .failure(error: "缺少页码数组")
        }

        let url = URL(fileURLWithPath: inputPath)
        guard let document = PDFDocument(url: url) else {
            return .failure(error: "无法打开PDF文档")
        }

        let newDocument = PDFDocument()

        for pageNumber in pages {
            let pageIndex = pageNumber - 1 // 0-based index
            if pageIndex >= 0 && pageIndex < document.pageCount {
                if let page = document.page(at: pageIndex) {
                    newDocument.insert(page, at: newDocument.pageCount)
                }
            }
        }

        if newDocument.pageCount == 0 {
            return .failure(error: "没有有效的页面可提取")
        }

        let outputURL = URL(fileURLWithPath: outputPath)
        guard newDocument.write(to: outputURL) else {
            return .failure(error: "无法保存提取后的PDF文档")
        }

        return .success(data: ["outputPath": outputPath, "pageCount": newDocument.pageCount])
    }

    /// Tool: tool.pdf.totext - 提取PDF文本内容
    public static let pdfToTextTool = Tool(
        id: "tool.pdf.totext",
        name: "PDF文本提取",
        description: "提取PDF文档中的所有文本内容",
        category: .utility,
        parameters: [
            ToolParameter(name: "inputPath", type: .string, description: "输入PDF文件路径", required: true),
            ToolParameter(name: "pageRange", type: .array, description: "页码范围[start,end]，不提供则提取全部", required: false)
        ],
        executor: pdfToTextExecutor
    )

    private static let pdfToTextExecutor: ToolExecutor = { input in
        guard let inputPath = input.getString("inputPath") else {
            return .failure(error: "缺少输入PDF文件路径")
        }

        let url = URL(fileURLWithPath: inputPath)
        guard let document = PDFDocument(url: url) else {
            return .failure(error: "无法打开PDF文档")
        }

        var startPage = 0
        var endPage = document.pageCount - 1

        if let pageRange = input.getArray("pageRange") as? [Int], pageRange.count == 2 {
            startPage = max(0, pageRange[0] - 1)
            endPage = min(document.pageCount - 1, pageRange[1] - 1)
        }

        var fullText = ""

        for pageIndex in startPage...endPage {
            if let page = document.page(at: pageIndex) {
                if let pageText = page.string {
                    fullText += "--- Page \(pageIndex + 1) ---\n"
                    fullText += pageText
                    fullText += "\n\n"
                }
            }
        }

        return .success(data: [
            "text": fullText,
            "pageCount": endPage - startPage + 1,
            "totalLength": fullText.count
        ])
    }

    /// Tool: tool.pdf.toimages - 将PDF页面转换为图片
    public static let pdfToImagesTool = Tool(
        id: "tool.pdf.toimages",
        name: "PDF转图片",
        description: "将PDF文档的每一页转换为图片",
        category: .utility,
        parameters: [
            ToolParameter(name: "inputPath", type: .string, description: "输入PDF文件路径", required: true),
            ToolParameter(name: "outputDir", type: .string, description: "输出图片目录", required: true),
            ToolParameter(name: "dpi", type: .number, description: "图片DPI（默认150）", required: false),
            ToolParameter(name: "format", type: .string, description: "图片格式（png/jpg，默认png）", required: false)
        ],
        executor: pdfToImagesExecutor
    )

    private static let pdfToImagesExecutor: ToolExecutor = { input in
        guard let inputPath = input.getString("inputPath") else {
            return .failure(error: "缺少输入PDF文件路径")
        }
        guard let outputDir = input.getString("outputDir") else {
            return .failure(error: "缺少输出图片目录")
        }

        let dpi = input.getNumber("dpi") ?? 150.0
        let format = input.getString("format") ?? "png"

        let url = URL(fileURLWithPath: inputPath)
        guard let document = PDFDocument(url: url) else {
            return .failure(error: "无法打开PDF文档")
        }

        // 创建输出目录
        try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        var outputFiles: [String] = []
        let scale = CGFloat(dpi / 72.0) // PDF默认72 DPI

        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex) else { continue }

            let pageRect = page.bounds(for: .mediaBox)
            let scaledRect = CGRect(x: 0, y: 0, width: pageRect.width * scale, height: pageRect.height * scale)

            let renderer = UIGraphicsImageRenderer(size: scaledRect.size)
            let image = renderer.image { context in
                UIColor.white.set()
                context.fill(scaledRect)

                context.cgContext.translateBy(x: 0, y: scaledRect.height)
                context.cgContext.scaleBy(x: scale, y: -scale)

                page.draw(with: .mediaBox, to: context.cgContext)
            }

            let outputPath = "\(outputDir)/page_\(pageIndex + 1).\(format)"
            let outputURL = URL(fileURLWithPath: outputPath)

            var imageData: Data?
            if format == "jpg" || format == "jpeg" {
                imageData = image.jpegData(compressionQuality: 0.9)
            } else {
                imageData = image.pngData()
            }

            guard let data = imageData else {
                return .failure(error: "无法生成图片数据")
            }

            do {
                try data.write(to: outputURL)
                outputFiles.append(outputPath)
            } catch {
                return .failure(error: "无法保存图片: \(error.localizedDescription)")
            }
        }

        return .success(data: ["outputFiles": outputFiles, "count": outputFiles.count])
    }

    // MARK: - Markdown Tools (3 tools)

    /// Tool: tool.markdown.tohtml - Markdown转HTML
    public static let markdownToHTMLTool = Tool(
        id: "tool.markdown.tohtml",
        name: "Markdown转HTML",
        description: "将Markdown文本转换为HTML",
        category: .utility,
        parameters: [
            ToolParameter(name: "markdown", type: .string, description: "Markdown文本内容", required: true),
            ToolParameter(name: "style", type: .string, description: "CSS样式（可选）", required: false)
        ],
        executor: markdownToHTMLExecutor
    )

    private static let markdownToHTMLExecutor: ToolExecutor = { input in
        guard let markdown = input.getString("markdown") else {
            return .failure(error: "缺少Markdown文本")
        }

        let style = input.getString("style") ?? ""

        // 简单的Markdown转HTML实现（生产环境建议使用成熟的库如Down）
        var html = markdown

        // 标题
        html = html.replacingOccurrences(of: #"^### (.+)$"#, with: "<h3>$1</h3>", options: .regularExpression)
        html = html.replacingOccurrences(of: #"^## (.+)$"#, with: "<h2>$1</h2>", options: .regularExpression)
        html = html.replacingOccurrences(of: #"^# (.+)$"#, with: "<h1>$1</h1>", options: .regularExpression)

        // 粗体和斜体
        html = html.replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "<strong>$1</strong>", options: .regularExpression)
        html = html.replacingOccurrences(of: #"\*(.+?)\*"#, with: "<em>$1</em>", options: .regularExpression)

        // 代码
        html = html.replacingOccurrences(of: #"`(.+?)`"#, with: "<code>$1</code>", options: .regularExpression)

        // 链接
        html = html.replacingOccurrences(of: #"\[(.+?)\]\((.+?)\)"#, with: "<a href=\"$2\">$1</a>", options: .regularExpression)

        // 段落
        html = html.components(separatedBy: "\n\n").map { "<p>$0</p>" }.joined(separator: "\n")

        let fullHTML = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; padding: 20px; }
                code { background-color: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
                \(style)
            </style>
        </head>
        <body>
            \(html)
        </body>
        </html>
        """

        return .success(data: ["html": fullHTML])
    }

    /// Tool: tool.markdown.parse - 解析Markdown结构
    public static let markdownParseTool = Tool(
        id: "tool.markdown.parse",
        name: "Markdown结构解析",
        description: "解析Markdown文档结构，提取标题、链接、代码块等元素",
        category: .utility,
        parameters: [
            ToolParameter(name: "markdown", type: .string, description: "Markdown文本内容", required: true)
        ],
        executor: markdownParseExecutor
    )

    private static let markdownParseExecutor: ToolExecutor = { input in
        guard let markdown = input.getString("markdown") else {
            return .failure(error: "缺少Markdown文本")
        }

        var result: [String: Any] = [:]

        // 提取标题
        let headingPattern = #"^(#{1,6})\s+(.+)$"#
        let headingRegex = try! NSRegularExpression(pattern: headingPattern, options: .anchorsMatchLines)
        let headingMatches = headingRegex.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))

        var headings: [[String: Any]] = []
        for match in headingMatches {
            if let levelRange = Range(match.range(at: 1), in: markdown),
               let textRange = Range(match.range(at: 2), in: markdown) {
                let level = String(markdown[levelRange]).count
                let text = String(markdown[textRange])
                headings.append(["level": level, "text": text])
            }
        }
        result["headings"] = headings

        // 提取链接
        let linkPattern = #"\[(.+?)\]\((.+?)\)"#
        let linkRegex = try! NSRegularExpression(pattern: linkPattern)
        let linkMatches = linkRegex.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))

        var links: [[String: String]] = []
        for match in linkMatches {
            if let textRange = Range(match.range(at: 1), in: markdown),
               let urlRange = Range(match.range(at: 2), in: markdown) {
                let text = String(markdown[textRange])
                let url = String(markdown[urlRange])
                links.append(["text": text, "url": url])
            }
        }
        result["links"] = links

        // 提取代码块
        let codeBlockPattern = #"```(\w+)?\n([\s\S]+?)```"#
        let codeBlockRegex = try! NSRegularExpression(pattern: codeBlockPattern)
        let codeBlockMatches = codeBlockRegex.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))

        var codeBlocks: [[String: String]] = []
        for match in codeBlockMatches {
            var lang = ""
            if let langRange = Range(match.range(at: 1), in: markdown) {
                lang = String(markdown[langRange])
            }
            if let codeRange = Range(match.range(at: 2), in: markdown) {
                let code = String(markdown[codeRange])
                codeBlocks.append(["language": lang, "code": code])
            }
        }
        result["codeBlocks"] = codeBlocks

        // 统计信息
        let lines = markdown.components(separatedBy: .newlines)
        result["lineCount"] = lines.count
        result["characterCount"] = markdown.count
        result["wordCount"] = markdown.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.count

        return .success(data: result)
    }

    /// Tool: tool.markdown.toc - 生成Markdown目录
    public static let markdownTOCTool = Tool(
        id: "tool.markdown.toc",
        name: "Markdown目录生成",
        description: "根据Markdown文档的标题自动生成目录",
        category: .utility,
        parameters: [
            ToolParameter(name: "markdown", type: .string, description: "Markdown文本内容", required: true),
            ToolParameter(name: "maxLevel", type: .number, description: "最大标题层级（1-6，默认3）", required: false)
        ],
        executor: markdownTOCExecutor
    )

    private static let markdownTOCExecutor: ToolExecutor = { input in
        guard let markdown = input.getString("markdown") else {
            return .failure(error: "缺少Markdown文本")
        }

        let maxLevel = Int(input.getNumber("maxLevel") ?? 3)

        let headingPattern = #"^(#{1,6})\s+(.+)$"#
        let headingRegex = try! NSRegularExpression(pattern: headingPattern, options: .anchorsMatchLines)
        let headingMatches = headingRegex.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))

        var toc = "## 目录\n\n"

        for match in headingMatches {
            if let levelRange = Range(match.range(at: 1), in: markdown),
               let textRange = Range(match.range(at: 2), in: markdown) {
                let level = String(markdown[levelRange]).count

                if level <= maxLevel {
                    let text = String(markdown[textRange])
                    let indent = String(repeating: "  ", count: level - 1)

                    // 生成anchor链接
                    let anchor = text.lowercased()
                        .replacingOccurrences(of: " ", with: "-")
                        .replacingOccurrences(of: "[^a-z0-9-]", with: "", options: .regularExpression)

                    toc += "\(indent)- [\(text)](#\(anchor))\n"
                }
            }
        }

        return .success(data: ["toc": toc])
    }

    // MARK: - CSV Tools (3 tools)

    /// Tool: tool.csv.read - 读取CSV文件
    public static let csvReadTool = Tool(
        id: "tool.csv.read",
        name: "CSV读取",
        description: "读取CSV文件并解析为结构化数据",
        category: .utility,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "CSV文件路径", required: true),
            ToolParameter(name: "delimiter", type: .string, description: "分隔符（默认逗号）", required: false),
            ToolParameter(name: "hasHeader", type: .boolean, description: "是否包含标题行（默认true）", required: false)
        ],
        executor: csvReadExecutor
    )

    private static let csvReadExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少CSV文件路径")
        }

        let delimiter = input.getString("delimiter") ?? ","
        let hasHeader = input.getBoolean("hasHeader") ?? true

        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            return .failure(error: "无法读取CSV文件")
        }

        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }
        if lines.isEmpty {
            return .failure(error: "CSV文件为空")
        }

        var headers: [String] = []
        var rows: [[String: String]] = []
        var startIndex = 0

        if hasHeader {
            headers = lines[0].components(separatedBy: delimiter)
            startIndex = 1
        } else {
            // 使用列索引作为header
            let columnCount = lines[0].components(separatedBy: delimiter).count
            headers = (0..<columnCount).map { "column_\($0)" }
        }

        for i in startIndex..<lines.count {
            let values = lines[i].components(separatedBy: delimiter)
            var row: [String: String] = [:]

            for (index, header) in headers.enumerated() {
                row[header] = index < values.count ? values[index] : ""
            }
            rows.append(row)
        }

        return .success(data: [
            "headers": headers,
            "rows": rows,
            "rowCount": rows.count
        ])
    }

    /// Tool: tool.csv.write - 写入CSV文件
    public static let csvWriteTool = Tool(
        id: "tool.csv.write",
        name: "CSV写入",
        description: "将结构化数据写入CSV文件",
        category: .utility,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "CSV文件路径", required: true),
            ToolParameter(name: "data", type: .array, description: "数据数组（字典数组）", required: true),
            ToolParameter(name: "delimiter", type: .string, description: "分隔符（默认逗号）", required: false)
        ],
        executor: csvWriteExecutor
    )

    private static let csvWriteExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少CSV文件路径")
        }
        guard let data = input.getArray("data") as? [[String: Any]] else {
            return .failure(error: "缺少数据数组")
        }

        let delimiter = input.getString("delimiter") ?? ","

        if data.isEmpty {
            return .failure(error: "数据为空")
        }

        // 提取所有键作为标题
        var headers: [String] = []
        for row in data {
            for key in row.keys where !headers.contains(key) {
                headers.append(key)
            }
        }
        headers.sort()

        var csvContent = headers.joined(separator: delimiter) + "\n"

        for row in data {
            let values = headers.map { String(describing: row[$0] ?? "") }
            csvContent += values.joined(separator: delimiter) + "\n"
        }

        do {
            try csvContent.write(toFile: path, atomically: true, encoding: .utf8)
            return .success(data: ["path": path, "rowCount": data.count])
        } catch {
            return .failure(error: "写入CSV文件失败: \(error.localizedDescription)")
        }
    }

    /// Tool: tool.csv.filter - 过滤CSV数据
    public static let csvFilterTool = Tool(
        id: "tool.csv.filter",
        name: "CSV数据过滤",
        description: "根据条件过滤CSV数据",
        category: .utility,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "CSV文件路径", required: true),
            ToolParameter(name: "column", type: .string, description: "要过滤的列名", required: true),
            ToolParameter(name: "value", type: .string, description: "过滤值", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出文件路径", required: true)
        ],
        executor: csvFilterExecutor
    )

    private static let csvFilterExecutor: ToolExecutor = { input in
        guard let path = input.getString("path"),
              let column = input.getString("column"),
              let value = input.getString("value"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必需参数")
        }

        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
            return .failure(error: "无法读取CSV文件")
        }

        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }
        if lines.isEmpty {
            return .failure(error: "CSV文件为空")
        }

        let headers = lines[0].components(separatedBy: ",")
        guard let columnIndex = headers.firstIndex(of: column) else {
            return .failure(error: "列名不存在: \(column)")
        }

        var filteredLines = [lines[0]] // 保留标题行

        for i in 1..<lines.count {
            let values = lines[i].components(separatedBy: ",")
            if columnIndex < values.count && values[columnIndex].contains(value) {
                filteredLines.append(lines[i])
            }
        }

        let filteredContent = filteredLines.joined(separator: "\n")

        do {
            try filteredContent.write(toFile: outputPath, atomically: true, encoding: .utf8)
            return .success(data: ["outputPath": outputPath, "rowCount": filteredLines.count - 1])
        } catch {
            return .failure(error: "写入文件失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 工具注册

    public static func registerAll() {
        let toolManager = ToolManager.shared

        // PDF工具 (6个)
        toolManager.register(pdfInfoTool)
        toolManager.register(pdfMergeTool)
        toolManager.register(pdfSplitTool)
        toolManager.register(pdfExtractTool)
        toolManager.register(pdfToTextTool)
        toolManager.register(pdfToImagesTool)

        // Markdown工具 (3个)
        toolManager.register(markdownToHTMLTool)
        toolManager.register(markdownParseTool)
        toolManager.register(markdownTOCTool)

        // CSV工具 (3个)
        toolManager.register(csvReadTool)
        toolManager.register(csvWriteTool)
        toolManager.register(csvFilterTool)
    }
}
