//
//  OfficePlugin.swift
//  ChainlessChain
//
//  Office插件
//  处理Office文档（Word、Excel、PDF等）
//
//  Created by ChainlessChain on 2026-02-11.
//

import Foundation
import CoreCommon

// MARK: - Office Plugin

/// Office插件处理器
public class OfficePlugin {
    public static let shared = OfficePlugin()

    // 支持的文件类型
    private let supportedExtensions = [
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "txt", "rtf", "csv"
    ]

    private init() {
        Logger.shared.info("[OfficePlugin] 初始化完成")
    }

    // MARK: - Public Methods

    /// 读取文档
    public func readDocument(at path: String) async throws -> DocumentContent {
        Logger.shared.info("[OfficePlugin] 读取文档: \(path)")

        let url = URL(fileURLWithPath: path)
        let ext = url.pathExtension.lowercased()

        guard supportedExtensions.contains(ext) else {
            throw PluginError.executionFailed("不支持的文件类型: \(ext)")
        }

        switch ext {
        case "txt", "csv":
            return try await readTextDocument(url)
        case "pdf":
            return try await readPDFDocument(url)
        case "docx", "doc":
            return try await readWordDocument(url)
        case "xlsx", "xls":
            return try await readExcelDocument(url)
        default:
            throw PluginError.executionFailed("文件类型暂不支持: \(ext)")
        }
    }

    /// 转换为PDF
    public func convertToPdf(from path: String, to outputPath: String) async throws -> String {
        Logger.shared.info("[OfficePlugin] 转换PDF: \(path)")

        let url = URL(fileURLWithPath: path)
        let ext = url.pathExtension.lowercased()

        // 读取源文件
        let content = try await readDocument(at: path)

        // 生成PDF
        let pdfData = try generatePDF(from: content)

        // 保存PDF
        let outputURL = URL(fileURLWithPath: outputPath)
        try pdfData.write(to: outputURL)

        Logger.shared.info("[OfficePlugin] PDF转换完成: \(outputPath)")

        return outputPath
    }

    /// 提取数据
    public func extractData(from path: String, options: ExtractionOptions = ExtractionOptions()) async throws -> ExtractedData {
        Logger.shared.info("[OfficePlugin] 提取数据: \(path)")

        let content = try await readDocument(at: path)

        var extractedData = ExtractedData()

        // 提取文本
        if options.includeText {
            extractedData.text = content.text
        }

        // 提取表格
        if options.includeTables {
            extractedData.tables = content.tables
        }

        // 提取图片
        if options.includeImages {
            extractedData.images = content.images
        }

        // 提取元数据
        if options.includeMetadata {
            extractedData.metadata = content.metadata
        }

        return extractedData
    }

    /// 合并文档
    public func mergeDocuments(paths: [String], outputPath: String) async throws -> String {
        Logger.shared.info("[OfficePlugin] 合并文档: \(paths.count) 个文件")

        var mergedContent = ""

        for path in paths {
            let content = try await readDocument(at: path)
            mergedContent += content.text + "\n\n---\n\n"
        }

        // 保存合并结果
        let outputURL = URL(fileURLWithPath: outputPath)
        try mergedContent.write(to: outputURL, atomically: true, encoding: .utf8)

        return outputPath
    }

    /// 获取文档信息
    public func getDocumentInfo(at path: String) async throws -> DocumentInfo {
        let url = URL(fileURLWithPath: path)

        guard FileManager.default.fileExists(atPath: path) else {
            throw PluginError.notFound(path)
        }

        let attributes = try FileManager.default.attributesOfItem(atPath: path)

        return DocumentInfo(
            name: url.lastPathComponent,
            path: path,
            size: attributes[.size] as? Int ?? 0,
            createdAt: attributes[.creationDate] as? Date,
            modifiedAt: attributes[.modificationDate] as? Date,
            type: url.pathExtension,
            isReadable: FileManager.default.isReadableFile(atPath: path),
            isWritable: FileManager.default.isWritableFile(atPath: path)
        )
    }

    // MARK: - Private Methods

    private func readTextDocument(_ url: URL) async throws -> DocumentContent {
        let text = try String(contentsOf: url, encoding: .utf8)

        return DocumentContent(
            text: text,
            format: url.pathExtension,
            pageCount: 1,
            wordCount: text.components(separatedBy: .whitespacesAndNewlines).count,
            characterCount: text.count
        )
    }

    private func readPDFDocument(_ url: URL) async throws -> DocumentContent {
        // 简化实现：实际应该使用PDFKit
        guard let document = try? Data(contentsOf: url) else {
            throw PluginError.loadFailed("无法读取PDF文件")
        }

        // 使用PDFKit提取文本
        // 这里简化处理
        return DocumentContent(
            text: "PDF内容提取需要PDFKit支持",
            format: "pdf",
            pageCount: 1,
            wordCount: 0,
            characterCount: 0,
            metadata: ["size": document.count]
        )
    }

    private func readWordDocument(_ url: URL) async throws -> DocumentContent {
        // 简化实现：实际应该使用专门的Word解析库
        // docx 是一个zip文件，包含XML内容

        guard let data = try? Data(contentsOf: url) else {
            throw PluginError.loadFailed("无法读取Word文件")
        }

        return DocumentContent(
            text: "Word文档解析需要专门的库支持",
            format: url.pathExtension,
            pageCount: 1,
            wordCount: 0,
            characterCount: 0,
            metadata: ["size": data.count]
        )
    }

    private func readExcelDocument(_ url: URL) async throws -> DocumentContent {
        // 简化实现：实际应该使用专门的Excel解析库

        guard let data = try? Data(contentsOf: url) else {
            throw PluginError.loadFailed("无法读取Excel文件")
        }

        // CSV文件可以直接解析
        if url.pathExtension.lowercased() == "csv" {
            let text = try String(contentsOf: url, encoding: .utf8)
            let rows = text.components(separatedBy: .newlines)
            let tables = [rows.map { $0.components(separatedBy: ",") }]

            return DocumentContent(
                text: text,
                format: "csv",
                pageCount: 1,
                wordCount: 0,
                characterCount: text.count,
                tables: tables
            )
        }

        return DocumentContent(
            text: "Excel文档解析需要专门的库支持",
            format: url.pathExtension,
            pageCount: 1,
            wordCount: 0,
            characterCount: 0,
            metadata: ["size": data.count]
        )
    }

    private func generatePDF(from content: DocumentContent) throws -> Data {
        // 简化实现：使用UIKit创建PDF
        let pageRect = CGRect(x: 0, y: 0, width: 612, height: 792) // US Letter

        let renderer = UIGraphicsPDFRenderer(bounds: pageRect)

        let pdfData = renderer.pdfData { context in
            context.beginPage()

            let textRect = pageRect.insetBy(dx: 50, dy: 50)

            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.alignment = .left
            paragraphStyle.lineBreakMode = .byWordWrapping

            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 12),
                .paragraphStyle: paragraphStyle
            ]

            content.text.draw(in: textRect, withAttributes: attributes)
        }

        return pdfData
    }
}

// MARK: - Supporting Types

/// 文档内容
public struct DocumentContent {
    public var text: String
    public var format: String
    public var pageCount: Int
    public var wordCount: Int
    public var characterCount: Int
    public var tables: [[[String]]] = []
    public var images: [Data] = []
    public var metadata: [String: Any] = [:]
}

/// 文档信息
public struct DocumentInfo {
    public let name: String
    public let path: String
    public let size: Int
    public let createdAt: Date?
    public let modifiedAt: Date?
    public let type: String
    public let isReadable: Bool
    public let isWritable: Bool

    public var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }
}

/// 提取选项
public struct ExtractionOptions {
    public var includeText: Bool = true
    public var includeTables: Bool = true
    public var includeImages: Bool = false
    public var includeMetadata: Bool = true

    public init(
        includeText: Bool = true,
        includeTables: Bool = true,
        includeImages: Bool = false,
        includeMetadata: Bool = true
    ) {
        self.includeText = includeText
        self.includeTables = includeTables
        self.includeImages = includeImages
        self.includeMetadata = includeMetadata
    }
}

/// 提取的数据
public struct ExtractedData {
    public var text: String = ""
    public var tables: [[[String]]] = []
    public var images: [Data] = []
    public var metadata: [String: Any] = [:]
}
