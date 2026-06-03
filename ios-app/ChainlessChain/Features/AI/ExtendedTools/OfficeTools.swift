import Foundation
import CoreCommon
import PDFKit
import UniformTypeIdentifiers

// MARK: - OfficeTools
/// Office document processing tools for Word, Excel, PDF
/// Provides document generation, conversion, and manipulation
///
/// Features:
/// - PDF generation and reading
/// - CSV/Excel data processing
/// - Markdown to document conversion
/// - Table creation and formatting
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Document Types

/// Document generation options
struct DocumentOptions: Codable {
    var title: String?
    var author: String?
    var pageMargins: PageMargins?
    var fontSize: Int?
    var fontName: String?

    struct PageMargins: Codable {
        var top: Int = 72      // Points (1 inch = 72 points)
        var bottom: Int = 72
        var left: Int = 72
        var right: Int = 72
    }
}

/// Table data structure
struct TableData: Codable {
    let headers: [String]
    let rows: [[String]]
}

/// Spreadsheet sheet configuration
struct SheetConfig: Codable {
    let name: String
    let headers: [String]?
    let data: [[AnyCodableValue]]
    let columnWidths: [Int]?
}

/// Office tool result
struct OfficeToolResult: Codable {
    let success: Bool
    let filePath: String?
    let fileSize: Int?
    let pageCount: Int?
    let sheetCount: Int?
    let rowCount: Int?
    let error: String?
}

// MARK: - Office Tools Handler

/// Office document tools handler
@MainActor
class OfficeToolsHandler: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private let fileManager = FileManager.default

    // MARK: - Singleton

    static let shared = OfficeToolsHandler()

    // MARK: - PDF Tools

    /// Generate PDF from Markdown content
    /// - Parameters:
    ///   - title: Document title
    ///   - content: Markdown content
    ///   - outputPath: Output file path
    ///   - options: Document options
    /// - Returns: Tool result
    func generatePDF(
        title: String,
        content: String,
        outputPath: String,
        options: DocumentOptions = DocumentOptions()
    ) async throws -> OfficeToolResult {
        logger.info("[OfficeTools] Generating PDF: \(title)")

        // Parse markdown to attributed string
        let attributedContent = parseMarkdownToAttributedString(content, options: options)

        // Create PDF context
        let pageWidth: CGFloat = 612   // US Letter width in points
        let pageHeight: CGFloat = 792  // US Letter height in points
        let margins = options.pageMargins ?? DocumentOptions.PageMargins()

        let contentRect = CGRect(
            x: CGFloat(margins.left),
            y: CGFloat(margins.bottom),
            width: pageWidth - CGFloat(margins.left + margins.right),
            height: pageHeight - CGFloat(margins.top + margins.bottom)
        )

        // Create PDF data
        let pdfData = NSMutableData()

        guard let consumer = CGDataConsumer(data: pdfData as CFMutableData),
              let pdfContext = CGContext(consumer: consumer, mediaBox: nil, nil) else {
            throw OfficeToolError.pdfGenerationFailed("Failed to create PDF context")
        }

        // Calculate pages
        let titleHeight: CGFloat = 50
        let lineHeight: CGFloat = CGFloat(options.fontSize ?? 12) * 1.5
        let availableHeight = contentRect.height - titleHeight

        let lines = content.components(separatedBy: .newlines)
        let linesPerPage = Int(availableHeight / lineHeight)
        let totalPages = max(1, (lines.count + linesPerPage - 1) / linesPerPage)

        for pageNum in 0..<totalPages {
            var pageRect = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
            pdfContext.beginPage(mediaBox: &pageRect)

            // Draw title on first page
            if pageNum == 0 {
                drawTitle(title, in: pdfContext, at: CGPoint(x: contentRect.minX, y: pageHeight - CGFloat(margins.top) - 30), options: options)
            }

            // Draw content
            let startLine = pageNum * linesPerPage
            let endLine = min(startLine + linesPerPage, lines.count)
            let pageLines = Array(lines[startLine..<endLine])

            var yPosition = pageHeight - CGFloat(margins.top) - (pageNum == 0 ? titleHeight + 20 : 20)

            for line in pageLines {
                drawText(line, in: pdfContext, at: CGPoint(x: contentRect.minX, y: yPosition), options: options)
                yPosition -= lineHeight
            }

            pdfContext.endPage()
        }

        pdfContext.closePDF()

        // Write to file
        let url = URL(fileURLWithPath: outputPath)
        try createDirectoryIfNeeded(for: url)
        try pdfData.write(to: url)

        let fileSize = try fileManager.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0

        return OfficeToolResult(
            success: true,
            filePath: outputPath,
            fileSize: fileSize,
            pageCount: totalPages,
            sheetCount: nil,
            rowCount: nil,
            error: nil
        )
    }

    /// Read PDF content
    /// - Parameter filePath: PDF file path
    /// - Returns: Extracted text content
    func readPDF(filePath: String) async throws -> String {
        logger.info("[OfficeTools] Reading PDF: \(filePath)")

        let url = URL(fileURLWithPath: filePath)
        guard let document = PDFDocument(url: url) else {
            throw OfficeToolError.fileReadFailed("Failed to open PDF")
        }

        var content = ""

        for i in 0..<document.pageCount {
            if let page = document.page(at: i),
               let pageContent = page.string {
                content += pageContent + "\n\n"
            }
        }

        return content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Get PDF metadata
    /// - Parameter filePath: PDF file path
    /// - Returns: PDF metadata dictionary
    func getPDFMetadata(filePath: String) async throws -> [String: Any] {
        let url = URL(fileURLWithPath: filePath)
        guard let document = PDFDocument(url: url) else {
            throw OfficeToolError.fileReadFailed("Failed to open PDF")
        }

        var metadata: [String: Any] = [
            "pageCount": document.pageCount,
            "isEncrypted": document.isEncrypted,
            "isLocked": document.isLocked
        ]

        if let attrs = document.documentAttributes {
            if let title = attrs[PDFDocumentAttribute.titleAttribute] as? String {
                metadata["title"] = title
            }
            if let author = attrs[PDFDocumentAttribute.authorAttribute] as? String {
                metadata["author"] = author
            }
            if let subject = attrs[PDFDocumentAttribute.subjectAttribute] as? String {
                metadata["subject"] = subject
            }
            if let creator = attrs[PDFDocumentAttribute.creatorAttribute] as? String {
                metadata["creator"] = creator
            }
        }

        return metadata
    }

    // MARK: - CSV/Excel Tools

    /// Generate CSV file from data
    /// - Parameters:
    ///   - sheets: Sheet configurations (only first sheet used for CSV)
    ///   - outputPath: Output file path
    /// - Returns: Tool result
    func generateCSV(
        sheets: [SheetConfig],
        outputPath: String
    ) async throws -> OfficeToolResult {
        guard let sheet = sheets.first else {
            throw OfficeToolError.invalidInput("No sheet data provided")
        }

        logger.info("[OfficeTools] Generating CSV: \(sheet.name)")

        var csvContent = ""
        var totalRows = 0

        // Add headers
        if let headers = sheet.headers {
            csvContent += headers.map { escapeCSVField($0) }.joined(separator: ",") + "\n"
        }

        // Add data rows
        for row in sheet.data {
            let rowValues = row.map { value -> String in
                if let str = value.value as? String {
                    return escapeCSVField(str)
                } else if let num = value.value as? Double {
                    return String(num)
                } else if let num = value.value as? Int {
                    return String(num)
                } else if let bool = value.value as? Bool {
                    return bool ? "true" : "false"
                } else {
                    return ""
                }
            }
            csvContent += rowValues.joined(separator: ",") + "\n"
            totalRows += 1
        }

        // Write to file
        let url = URL(fileURLWithPath: outputPath)
        try createDirectoryIfNeeded(for: url)
        try csvContent.write(to: url, atomically: true, encoding: .utf8)

        let fileSize = try fileManager.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0

        return OfficeToolResult(
            success: true,
            filePath: outputPath,
            fileSize: fileSize,
            pageCount: nil,
            sheetCount: 1,
            rowCount: totalRows,
            error: nil
        )
    }

    /// Read CSV file
    /// - Parameter filePath: CSV file path
    /// - Returns: Parsed table data
    func readCSV(filePath: String) async throws -> TableData {
        logger.info("[OfficeTools] Reading CSV: \(filePath)")

        let url = URL(fileURLWithPath: filePath)
        let content = try String(contentsOf: url, encoding: .utf8)

        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }

        guard !lines.isEmpty else {
            throw OfficeToolError.fileReadFailed("CSV file is empty")
        }

        let headers = parseCSVLine(lines[0])
        let rows = lines.dropFirst().map { parseCSVLine($0) }

        return TableData(headers: headers, rows: rows)
    }

    /// Parse CSV with statistics
    /// - Parameter filePath: CSV file path
    /// - Returns: CSV statistics
    func analyzeCSV(filePath: String) async throws -> [String: Any] {
        let tableData = try await readCSV(filePath: filePath)

        var stats: [String: Any] = [
            "rowCount": tableData.rows.count,
            "columnCount": tableData.headers.count,
            "headers": tableData.headers
        ]

        // Calculate column statistics
        var columnStats: [[String: Any]] = []

        for (i, header) in tableData.headers.enumerated() {
            let values = tableData.rows.compactMap { row -> String? in
                guard i < row.count else { return nil }
                return row[i]
            }

            let numericValues = values.compactMap { Double($0) }

            var colStat: [String: Any] = [
                "name": header,
                "uniqueCount": Set(values).count,
                "emptyCount": values.filter { $0.isEmpty }.count
            ]

            if !numericValues.isEmpty {
                colStat["isNumeric"] = true
                colStat["min"] = numericValues.min()
                colStat["max"] = numericValues.max()
                colStat["mean"] = numericValues.reduce(0, +) / Double(numericValues.count)
            } else {
                colStat["isNumeric"] = false
            }

            columnStats.append(colStat)
        }

        stats["columns"] = columnStats

        return stats
    }

    // MARK: - Table Tools

    /// Create markdown table
    /// - Parameter tableData: Table data
    /// - Returns: Markdown formatted table
    func createMarkdownTable(tableData: TableData) -> String {
        var markdown = ""

        // Headers
        markdown += "| " + tableData.headers.joined(separator: " | ") + " |\n"

        // Separator
        markdown += "|" + tableData.headers.map { _ in "---" }.joined(separator: "|") + "|\n"

        // Rows
        for row in tableData.rows {
            markdown += "| " + row.joined(separator: " | ") + " |\n"
        }

        return markdown
    }

    /// Create HTML table
    /// - Parameters:
    ///   - tableData: Table data
    ///   - styled: Apply default styling
    /// - Returns: HTML formatted table
    func createHTMLTable(tableData: TableData, styled: Bool = true) -> String {
        var html = ""

        if styled {
            html += "<style>\n"
            html += "table { border-collapse: collapse; width: 100%; }\n"
            html += "th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }\n"
            html += "th { background-color: #f4f4f4; }\n"
            html += "tr:nth-child(even) { background-color: #f9f9f9; }\n"
            html += "</style>\n"
        }

        html += "<table>\n<thead>\n<tr>\n"

        for header in tableData.headers {
            html += "  <th>\(escapeHTML(header))</th>\n"
        }

        html += "</tr>\n</thead>\n<tbody>\n"

        for row in tableData.rows {
            html += "<tr>\n"
            for cell in row {
                html += "  <td>\(escapeHTML(cell))</td>\n"
            }
            html += "</tr>\n"
        }

        html += "</tbody>\n</table>"

        return html
    }

    // MARK: - Excel Formula Tools

    /// Build Excel formula
    /// - Parameters:
    ///   - formulaType: Type of formula
    ///   - range: Cell range
    ///   - condition: Optional condition
    ///   - customFormula: Custom formula string
    /// - Returns: Formula string and description
    func buildExcelFormula(
        formulaType: ExcelFormulaType,
        range: String,
        condition: String? = nil,
        customFormula: String? = nil
    ) -> (formula: String, description: String) {
        switch formulaType {
        case .sum:
            return ("=SUM(\(range))", "Sum formula: Calculate total of values in \(range)")
        case .average:
            return ("=AVERAGE(\(range))", "Average formula: Calculate mean of values in \(range)")
        case .count:
            return ("=COUNT(\(range))", "Count formula: Count numeric values in \(range)")
        case .countIf:
            let cond = condition ?? ">0"
            return ("=COUNTIF(\(range),\"\(cond)\")", "Conditional count: Count cells matching '\(cond)' in \(range)")
        case .sumIf:
            let cond = condition ?? ">0"
            return ("=SUMIF(\(range),\"\(cond)\")", "Conditional sum: Sum cells matching '\(cond)' in \(range)")
        case .vlookup:
            return ("=VLOOKUP(\(range),A:B,2,FALSE)", "Vertical lookup: Find value in \(range)")
        case .ifCondition:
            let cond = condition ?? ">0"
            return ("=IF(\(range)\(cond),\"Yes\",\"No\")", "IF formula: Check if \(range)\(cond)")
        case .concatenate:
            return ("=CONCATENATE(\(range))", "Concatenate: Join text in \(range)")
        case .custom:
            return (customFormula ?? "", "Custom formula")
        }
    }

    // MARK: - Markdown Conversion

    /// Convert Markdown to plain text
    /// - Parameter markdown: Markdown content
    /// - Returns: Plain text
    func markdownToPlainText(_ markdown: String) -> String {
        var text = markdown

        // Remove headers
        text = text.replacingOccurrences(of: "#{1,6}\\s+", with: "", options: .regularExpression)

        // Remove bold/italic
        text = text.replacingOccurrences(of: "\\*{1,2}(.+?)\\*{1,2}", with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: "_{1,2}(.+?)_{1,2}", with: "$1", options: .regularExpression)

        // Remove links
        text = text.replacingOccurrences(of: "\\[(.+?)\\]\\(.+?\\)", with: "$1", options: .regularExpression)

        // Remove code blocks
        text = text.replacingOccurrences(of: "```[\\s\\S]*?```", with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: "`(.+?)`", with: "$1", options: .regularExpression)

        // Remove bullet points
        text = text.replacingOccurrences(of: "^[\\*\\-\\+]\\s+", with: "• ", options: .regularExpression)

        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Private Helpers

    private func parseMarkdownToAttributedString(_ markdown: String, options: DocumentOptions) -> NSAttributedString {
        let fontSize = CGFloat(options.fontSize ?? 12)
        let fontName = options.fontName ?? "Helvetica"

        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont(name: fontName, size: fontSize) ?? NSFont.systemFont(ofSize: fontSize)
        ]

        return NSAttributedString(string: markdownToPlainText(markdown), attributes: attributes)
    }

    private func drawTitle(_ title: String, in context: CGContext, at point: CGPoint, options: DocumentOptions) {
        let fontSize = CGFloat((options.fontSize ?? 12) + 8)
        let font = CTFontCreateWithName((options.fontName ?? "Helvetica-Bold") as CFString, fontSize, nil)

        let attributes: [NSAttributedString.Key: Any] = [
            .font: font
        ]

        let attrString = NSAttributedString(string: title, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attrString)

        context.textPosition = point
        CTLineDraw(line, context)
    }

    private func drawText(_ text: String, in context: CGContext, at point: CGPoint, options: DocumentOptions) {
        let fontSize = CGFloat(options.fontSize ?? 12)
        let font = CTFontCreateWithName((options.fontName ?? "Helvetica") as CFString, fontSize, nil)

        let attributes: [NSAttributedString.Key: Any] = [
            .font: font
        ]

        let attrString = NSAttributedString(string: text, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attrString)

        context.textPosition = point
        CTLineDraw(line, context)
    }

    private func escapeCSVField(_ field: String) -> String {
        var escaped = field
        if escaped.contains("\"") {
            escaped = escaped.replacingOccurrences(of: "\"", with: "\"\"")
        }
        if escaped.contains(",") || escaped.contains("\n") || escaped.contains("\"") {
            escaped = "\"\(escaped)\""
        }
        return escaped
    }

    private func parseCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        var currentField = ""
        var inQuotes = false

        for char in line {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                fields.append(currentField)
                currentField = ""
            } else {
                currentField.append(char)
            }
        }

        fields.append(currentField)
        return fields
    }

    private func escapeHTML(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private func createDirectoryIfNeeded(for url: URL) throws {
        let directory = url.deletingLastPathComponent()
        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }
}

// MARK: - Supporting Types

/// Excel formula types
enum ExcelFormulaType: String, Codable {
    case sum = "SUM"
    case average = "AVERAGE"
    case count = "COUNT"
    case countIf = "COUNTIF"
    case sumIf = "SUMIF"
    case vlookup = "VLOOKUP"
    case ifCondition = "IF"
    case concatenate = "CONCATENATE"
    case custom = "CUSTOM"
}

/// Office tool errors
enum OfficeToolError: LocalizedError {
    case pdfGenerationFailed(String)
    case fileReadFailed(String)
    case invalidInput(String)
    case unsupportedFormat(String)

    var errorDescription: String? {
        switch self {
        case .pdfGenerationFailed(let msg):
            return "PDF generation failed: \(msg)"
        case .fileReadFailed(let msg):
            return "File read failed: \(msg)"
        case .invalidInput(let msg):
            return "Invalid input: \(msg)"
        case .unsupportedFormat(let msg):
            return "Unsupported format: \(msg)"
        }
    }
}

// MARK: - Tool Registration

extension OfficeToolsHandler {
    /// Get all office tools for registration
    func getTools() -> [Tool] {
        return [
            Tool(
                name: "pdf_generator",
                description: "Generate PDF documents from Markdown content",
                parameters: [
                    ToolParameter(name: "title", type: .string, description: "Document title", required: true),
                    ToolParameter(name: "content", type: .string, description: "Markdown content", required: true),
                    ToolParameter(name: "outputPath", type: .string, description: "Output file path", required: true)
                ]
            ),
            Tool(
                name: "pdf_reader",
                description: "Read and extract text from PDF files",
                parameters: [
                    ToolParameter(name: "filePath", type: .string, description: "PDF file path", required: true)
                ]
            ),
            Tool(
                name: "csv_generator",
                description: "Generate CSV files from structured data",
                parameters: [
                    ToolParameter(name: "headers", type: .array, description: "Column headers", required: true),
                    ToolParameter(name: "data", type: .array, description: "Data rows", required: true),
                    ToolParameter(name: "outputPath", type: .string, description: "Output file path", required: true)
                ]
            ),
            Tool(
                name: "csv_reader",
                description: "Read and parse CSV files",
                parameters: [
                    ToolParameter(name: "filePath", type: .string, description: "CSV file path", required: true)
                ]
            ),
            Tool(
                name: "excel_formula_builder",
                description: "Build Excel formulas",
                parameters: [
                    ToolParameter(name: "formulaType", type: .string, description: "Formula type (SUM, AVERAGE, etc.)", required: true),
                    ToolParameter(name: "range", type: .string, description: "Cell range", required: true),
                    ToolParameter(name: "condition", type: .string, description: "Optional condition", required: false)
                ]
            ),
            Tool(
                name: "markdown_table",
                description: "Create Markdown table from data",
                parameters: [
                    ToolParameter(name: "headers", type: .array, description: "Column headers", required: true),
                    ToolParameter(name: "rows", type: .array, description: "Data rows", required: true)
                ]
            )
        ]
    }
}
