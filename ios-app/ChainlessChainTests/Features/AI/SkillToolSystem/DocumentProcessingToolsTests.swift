/**
 * DocumentProcessingToolsTests.swift
 *
 * Unit tests for DocumentProcessingTools (12 tools).
 * Tests PDF tools (6), Markdown tools (3), and CSV tools (3).
 */

import XCTest
import PDFKit
@testable import ChainlessChain

@MainActor
final class DocumentProcessingToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testDocumentsPath: String!
    var tempOutputPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerDocumentProcessingTools()

        // Setup test paths
        let tempDir = NSTemporaryDirectory()
        testDocumentsPath = tempDir + "test_documents/"
        tempOutputPath = tempDir + "test_output_documents/"

        // Create directories
        try? FileManager.default.createDirectory(atPath: testDocumentsPath, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: tempOutputPath, withIntermediateDirectories: true)

        // Create test documents
        try createTestPDF()
        try createTestMarkdown()
        try createTestCSV()
    }

    override func tearDown() async throws {
        // Clean up test files
        try? FileManager.default.removeItem(atPath: testDocumentsPath)
        try? FileManager.default.removeItem(atPath: tempOutputPath)

        toolManager = nil
    }

    // MARK: - Test Resource Creation

    private func createTestPDF() throws {
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputURL = URL(fileURLWithPath: pdfPath)

        // Create a simple PDF with 3 pages
        let document = PDFDocument()

        for i in 1...3 {
            let pageRect = CGRect(x: 0, y: 0, width: 612, height: 792)  // Letter size
            let renderer = UIGraphicsImageRenderer(size: pageRect.size)

            let pageImage = renderer.image { context in
                // Draw white background
                UIColor.white.setFill()
                context.fill(pageRect)

                // Draw page number
                let text = "Page \(i)"
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 24),
                    .foregroundColor: UIColor.black
                ]
                let textSize = (text as NSString).size(withAttributes: attributes)
                let textPoint = CGPoint(
                    x: (pageRect.width - textSize.width) / 2,
                    y: (pageRect.height - textSize.height) / 2
                )
                (text as NSString).draw(at: textPoint, withAttributes: attributes)
            }

            if let pdfPage = PDFPage(image: pageImage) {
                document.insert(pdfPage, at: document.pageCount)
            }
        }

        // Save PDF
        document.write(to: outputURL)
    }

    private func createTestMarkdown() throws {
        let markdownPath = testDocumentsPath + "test.md"
        let content = """
        # Test Document

        This is a test markdown document.

        ## Section 1

        This is section 1 with some **bold** and *italic* text.

        ### Subsection 1.1

        - Item 1
        - Item 2
        - Item 3

        ## Section 2

        This is section 2 with a [link](https://example.com).

        ```swift
        let code = "Hello, World!"
        print(code)
        ```

        ## Section 3

        | Column 1 | Column 2 |
        |----------|----------|
        | Value 1  | Value 2  |
        """

        try content.write(toFile: markdownPath, atomically: true, encoding: .utf8)
    }

    private func createTestCSV() throws {
        let csvPath = testDocumentsPath + "test.csv"
        let content = """
        Name,Age,City
        Alice,30,New York
        Bob,25,Los Angeles
        Charlie,35,Chicago
        Diana,28,Houston
        """

        try content.write(toFile: csvPath, atomically: true, encoding: .utf8)
    }

    // MARK: - PDF Info Tests

    func testPDFInfo() async throws {
        // Given
        let pdfPath = testDocumentsPath + "test.pdf"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.pdf.info",
            input: ["path": pdfPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["pageCount"])
            XCTAssertNotNil(info["fileSize"])

            let pageCount = info["pageCount"] as? Int
            XCTAssertEqual(pageCount, 3)

            let fileSize = info["fileSize"] as? UInt64
            XCTAssertNotNil(fileSize)
            XCTAssertGreaterThan(fileSize ?? 0, 0)
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testPDFInfoInvalidPath() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.pdf.info",
                input: ["path": "/invalid/path.pdf"]
            )
            XCTFail("Should throw error for invalid path")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - PDF Merge Tests

    func testPDFMerge() async throws {
        // Given
        let pdf1Path = testDocumentsPath + "test.pdf"
        let pdf2Path = testDocumentsPath + "test_copy.pdf"
        let outputPath = tempOutputPath + "merged.pdf"

        // Create a copy for merging
        try FileManager.default.copyItem(atPath: pdf1Path, toPath: pdf2Path)

        // When
        let result = try await toolManager.execute(
            toolId: "tool.pdf.merge",
            input: [
                "inputPaths": [pdf1Path, pdf2Path],
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify merged document has 6 pages (3 + 3)
        let outputURL = URL(fileURLWithPath: outputPath)
        if let mergedDoc = PDFDocument(url: outputURL) {
            XCTAssertEqual(mergedDoc.pageCount, 6)
        } else {
            XCTFail("Cannot open merged PDF")
        }
    }

    func testPDFMergeEmptyArray() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.pdf.merge",
                input: [
                    "inputPaths": [],
                    "outputPath": tempOutputPath + "merged.pdf"
                ]
            )
            XCTFail("Should throw error for empty input array")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - PDF Split Tests

    func testPDFSplit() async throws {
        // Given
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputPath = tempOutputPath + "split.pdf"

        // When - Split pages 1-2
        let result = try await toolManager.execute(
            toolId: "tool.pdf.split",
            input: [
                "path": pdfPath,
                "startPage": 0,
                "endPage": 1,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify split document has 2 pages
        let outputURL = URL(fileURLWithPath: outputPath)
        if let splitDoc = PDFDocument(url: outputURL) {
            XCTAssertEqual(splitDoc.pageCount, 2)
        }
    }

    func testPDFSplitInvalidRange() async throws {
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputPath = tempOutputPath + "split_invalid.pdf"

        do {
            _ = try await toolManager.execute(
                toolId: "tool.pdf.split",
                input: [
                    "path": pdfPath,
                    "startPage": 5,  // Out of range
                    "endPage": 10,
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for invalid page range")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - PDF Extract Tests

    func testPDFExtract() async throws {
        // Given
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputPath = tempOutputPath + "extracted.pdf"

        // When - Extract page 2 (index 1)
        let result = try await toolManager.execute(
            toolId: "tool.pdf.extract",
            input: [
                "path": pdfPath,
                "pages": [1],
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify extracted document has 1 page
        let outputURL = URL(fileURLWithPath: outputPath)
        if let extractedDoc = PDFDocument(url: outputURL) {
            XCTAssertEqual(extractedDoc.pageCount, 1)
        }
    }

    func testPDFExtractMultiplePages() async throws {
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputPath = tempOutputPath + "extracted_multi.pdf"

        let result = try await toolManager.execute(
            toolId: "tool.pdf.extract",
            input: [
                "path": pdfPath,
                "pages": [0, 2],  // Pages 1 and 3
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)

        let outputURL = URL(fileURLWithPath: outputPath)
        if let extractedDoc = PDFDocument(url: outputURL) {
            XCTAssertEqual(extractedDoc.pageCount, 2)
        }
    }

    // MARK: - PDF To Text Tests

    func testPDFToText() async throws {
        // Given
        let pdfPath = testDocumentsPath + "test.pdf"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.pdf.totext",
            input: ["path": pdfPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let text = result as? String {
            XCTAssertFalse(text.isEmpty)
            // Should contain "Page 1", "Page 2", "Page 3"
            XCTAssertTrue(text.contains("Page"))
        } else {
            XCTFail("Result should be a string")
        }
    }

    // MARK: - PDF To Images Tests

    func testPDFToImages() async throws {
        // Given
        let pdfPath = testDocumentsPath + "test.pdf"
        let outputDir = tempOutputPath + "images/"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.pdf.toimages",
            input: [
                "path": pdfPath,
                "outputDir": outputDir,
                "dpi": 150
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let imagePaths = result as? [String] {
            XCTAssertEqual(imagePaths.count, 3)  // 3 pages = 3 images

            // Verify images exist
            for imagePath in imagePaths {
                XCTAssertTrue(FileManager.default.fileExists(atPath: imagePath))
            }
        } else {
            XCTFail("Result should be an array of image paths")
        }
    }

    // MARK: - Markdown To HTML Tests

    func testMarkdownToHTML() async throws {
        // Given
        let markdownPath = testDocumentsPath + "test.md"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.markdown.tohtml",
            input: ["path": markdownPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let html = result as? String {
            XCTAssertFalse(html.isEmpty)
            // Should contain HTML tags
            XCTAssertTrue(html.contains("<h1>"))
            XCTAssertTrue(html.contains("<h2>"))
            XCTAssertTrue(html.contains("Test Document"))
        } else {
            XCTFail("Result should be an HTML string")
        }
    }

    func testMarkdownToHTMLWithCSS() async throws {
        let markdownPath = testDocumentsPath + "test.md"
        let css = "body { font-family: Arial; }"

        let result = try await toolManager.execute(
            toolId: "tool.markdown.tohtml",
            input: [
                "path": markdownPath,
                "css": css
            ]
        )

        if let html = result as? String {
            XCTAssertTrue(html.contains(css))
        }
    }

    // MARK: - Markdown Parse Tests

    func testMarkdownParse() async throws {
        // Given
        let markdownPath = testDocumentsPath + "test.md"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.markdown.parse",
            input: ["path": markdownPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let structure = result as? [String: Any] {
            XCTAssertNotNil(structure["headings"])
            XCTAssertNotNil(structure["links"])
            XCTAssertNotNil(structure["codeBlocks"])

            // Verify headings
            if let headings = structure["headings"] as? [[String: Any]] {
                XCTAssertGreaterThan(headings.count, 0)
            }

            // Verify links
            if let links = structure["links"] as? [[String: String]] {
                XCTAssertGreaterThan(links.count, 0)
            }
        } else {
            XCTFail("Result should be a structure dictionary")
        }
    }

    // MARK: - Markdown TOC Tests

    func testMarkdownTOC() async throws {
        // Given
        let markdownPath = testDocumentsPath + "test.md"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.markdown.toc",
            input: ["path": markdownPath]
        )

        // Then
        XCTAssertNotNil(result)

        if let toc = result as? String {
            XCTAssertFalse(toc.isEmpty)
            // Should contain links to sections
            XCTAssertTrue(toc.contains("Section 1"))
            XCTAssertTrue(toc.contains("Section 2"))
            XCTAssertTrue(toc.contains("Section 3"))
        } else {
            XCTFail("Result should be a TOC string")
        }
    }

    // MARK: - CSV Read Tests

    func testCSVRead() async throws {
        // Given
        let csvPath = testDocumentsPath + "test.csv"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.csv.read",
            input: [
                "path": csvPath,
                "delimiter": ","
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let data = result as? [[String: String]] {
            XCTAssertEqual(data.count, 4)  // 4 data rows

            // Verify first row
            let firstRow = data[0]
            XCTAssertEqual(firstRow["Name"], "Alice")
            XCTAssertEqual(firstRow["Age"], "30")
            XCTAssertEqual(firstRow["City"], "New York")
        } else {
            XCTFail("Result should be an array of dictionaries")
        }
    }

    func testCSVReadWithHeader() async throws {
        let csvPath = testDocumentsPath + "test.csv"

        let result = try await toolManager.execute(
            toolId: "tool.csv.read",
            input: [
                "path": csvPath,
                "delimiter": ",",
                "hasHeader": true
            ]
        )

        if let data = result as? [[String: String]] {
            XCTAssertEqual(data.count, 4)
            XCTAssertNotNil(data[0]["Name"])
        }
    }

    // MARK: - CSV Write Tests

    func testCSVWrite() async throws {
        // Given
        let outputPath = tempOutputPath + "output.csv"
        let data = [
            ["Name": "Alice", "Age": "30"],
            ["Name": "Bob", "Age": "25"]
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.csv.write",
            input: [
                "path": outputPath,
                "data": data,
                "delimiter": ","
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify content
        let content = try String(contentsOfFile: outputPath, encoding: .utf8)
        XCTAssertTrue(content.contains("Alice"))
        XCTAssertTrue(content.contains("Bob"))
    }

    // MARK: - CSV Filter Tests

    func testCSVFilter() async throws {
        // Given
        let csvPath = testDocumentsPath + "test.csv"
        let outputPath = tempOutputPath + "filtered.csv"

        // When - Filter Age > 28
        let result = try await toolManager.execute(
            toolId: "tool.csv.filter",
            input: [
                "path": csvPath,
                "column": "Age",
                "operator": "gt",
                "value": "28",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify filtered data
        let filteredContent = try String(contentsOfFile: outputPath, encoding: .utf8)
        XCTAssertTrue(filteredContent.contains("Alice"))  // Age 30
        XCTAssertTrue(filteredContent.contains("Charlie"))  // Age 35
        XCTAssertFalse(filteredContent.contains("Bob"))  // Age 25
    }

    func testCSVFilterEquals() async throws {
        let csvPath = testDocumentsPath + "test.csv"
        let outputPath = tempOutputPath + "filtered_eq.csv"

        let result = try await toolManager.execute(
            toolId: "tool.csv.filter",
            input: [
                "path": csvPath,
                "column": "City",
                "operator": "eq",
                "value": "Chicago",
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)

        let filteredContent = try String(contentsOfFile: outputPath, encoding: .utf8)
        XCTAssertTrue(filteredContent.contains("Charlie"))
        XCTAssertFalse(filteredContent.contains("Alice"))
    }

    // MARK: - Performance Tests

    func testPDFMergePerformance() throws {
        let pdf1Path = testDocumentsPath + "test.pdf"
        let pdf2Path = testDocumentsPath + "test_copy.pdf"
        let outputPath = tempOutputPath + "perf_merged.pdf"

        try? FileManager.default.copyItem(atPath: pdf1Path, toPath: pdf2Path)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.pdf.merge",
                    input: [
                        "inputPaths": [pdf1Path, pdf2Path],
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }

    func testMarkdownToHTMLPerformance() throws {
        let markdownPath = testDocumentsPath + "test.md"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.markdown.tohtml",
                    input: ["path": markdownPath]
                )
            }
        }
    }

    func testCSVReadPerformance() throws {
        let csvPath = testDocumentsPath + "test.csv"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.csv.read",
                    input: [
                        "path": csvPath,
                        "delimiter": ","
                    ]
                )
            }
        }
    }
}
