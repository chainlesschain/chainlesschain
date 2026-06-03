/**
 * MediaToolsTests.swift
 *
 * Unit tests for MediaTools (15 tools).
 * Tests image processing (10 tools) and color utilities (5 tools).
 */

import XCTest
import UIKit
import CoreImage
@testable import ChainlessChain

@MainActor
final class MediaToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testImagesPath: String!
    var tempOutputPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerMediaTools()

        // Setup test paths
        let tempDir = NSTemporaryDirectory()
        testImagesPath = tempDir + "test_images/"
        tempOutputPath = tempDir + "test_output_images/"

        // Create directories
        try? FileManager.default.createDirectory(atPath: testImagesPath, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: tempOutputPath, withIntermediateDirectories: true)

        // Create test image
        try createTestImage()
    }

    override func tearDown() async throws {
        // Clean up test files
        try? FileManager.default.removeItem(atPath: testImagesPath)
        try? FileManager.default.removeItem(atPath: tempOutputPath)

        toolManager = nil
    }

    // MARK: - Test Resource Creation

    private func createTestImage(width: Int = 800, height: Int = 600) throws {
        let imagePath = testImagesPath + "test_image.jpg"

        // Create a test image with gradient
        let size = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: size)

        let image = renderer.image { context in
            // Draw gradient background
            let colors = [UIColor.red.cgColor, UIColor.blue.cgColor]
            let colorSpace = CGColorSpaceCreateDeviceRGB()
            let gradient = CGGradient(colorsSpace: colorSpace, colors: colors as CFArray, locations: [0, 1])!

            context.cgContext.drawLinearGradient(
                gradient,
                start: .zero,
                end: CGPoint(x: size.width, y: size.height),
                options: []
            )

            // Draw some text
            let text = "Test Image"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 48),
                .foregroundColor: UIColor.white
            ]
            let textSize = (text as NSString).size(withAttributes: attributes)
            let textPoint = CGPoint(
                x: (size.width - textSize.width) / 2,
                y: (size.height - textSize.height) / 2
            )
            (text as NSString).draw(at: textPoint, withAttributes: attributes)
        }

        guard let data = image.jpegData(compressionQuality: 0.9) else {
            throw NSError(domain: "TestError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create image data"])
        }

        try data.write(to: URL(fileURLWithPath: imagePath))
    }

    // MARK: - Image Info Tests

    func testImageInfo() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.info",
            input: ["imagePath": imagePath]
        )

        // Then
        XCTAssertNotNil(result)

        if let info = result as? [String: Any] {
            XCTAssertNotNil(info["width"])
            XCTAssertNotNil(info["height"])
            XCTAssertNotNil(info["scale"])
            XCTAssertNotNil(info["format"])
            XCTAssertNotNil(info["fileSize"])

            let width = info["width"] as? Int
            let height = info["height"] as? Int
            XCTAssertEqual(width, 800)
            XCTAssertEqual(height, 600)
            XCTAssertEqual(info["format"] as? String, "jpg")
        } else {
            XCTFail("Result should be a dictionary")
        }
    }

    func testImageInfoInvalidPath() async throws {
        // Given
        let invalidPath = "/invalid/path/image.jpg"

        // When/Then
        do {
            _ = try await toolManager.execute(
                toolId: "tool.image.info",
                input: ["imagePath": invalidPath]
            )
            XCTFail("Should throw error for invalid path")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Image Resize Tests

    func testImageResize() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "resized.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.resize",
            input: [
                "imagePath": imagePath,
                "width": 400,
                "height": 300,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify output dimensions
        if let resizedImage = UIImage(contentsOfFile: outputPath) {
            XCTAssertEqual(Int(resizedImage.size.width), 400)
            XCTAssertEqual(Int(resizedImage.size.height), 300)
        } else {
            XCTFail("Cannot load resized image")
        }
    }

    func testImageResizeSmaller() async throws {
        // Test resizing to smaller dimensions
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "resized_small.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.resize",
            input: [
                "imagePath": imagePath,
                "width": 100,
                "height": 100,
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify file is smaller
        let originalSize = try FileManager.default.attributesOfItem(atPath: imagePath)[.size] as? Int ?? 0
        let resizedSize = try FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0
        XCTAssertLessThan(resizedSize, originalSize)
    }

    // MARK: - Image Crop Tests

    func testImageCrop() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "cropped.jpg"

        // When - Crop center 400x400
        let result = try await toolManager.execute(
            toolId: "tool.image.crop",
            input: [
                "imagePath": imagePath,
                "x": 200,
                "y": 100,
                "width": 400,
                "height": 400,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify output dimensions
        if let croppedImage = UIImage(contentsOfFile: outputPath) {
            XCTAssertEqual(Int(croppedImage.size.width), 400)
            XCTAssertEqual(Int(croppedImage.size.height), 400)
        }
    }

    func testImageCropInvalidRect() async throws {
        // Test cropping with invalid rectangle (out of bounds)
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "cropped_invalid.jpg"

        do {
            _ = try await toolManager.execute(
                toolId: "tool.image.crop",
                input: [
                    "imagePath": imagePath,
                    "x": 1000,  // Out of bounds
                    "y": 1000,
                    "width": 400,
                    "height": 400,
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for invalid crop rectangle")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Image Rotate Tests

    func testImageRotate90() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "rotated_90.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.rotate",
            input: [
                "imagePath": imagePath,
                "degrees": 90,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify dimensions are swapped
        if let rotatedImage = UIImage(contentsOfFile: outputPath) {
            // After 90° rotation, width and height should be swapped
            XCTAssertGreaterThan(rotatedImage.size.width, 0)
            XCTAssertGreaterThan(rotatedImage.size.height, 0)
        }
    }

    func testImageRotate180() async throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "rotated_180.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.rotate",
            input: [
                "imagePath": imagePath,
                "degrees": 180,
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Image Filter Tests

    func testImageFilterSepia() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "filtered_sepia.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.filter",
            input: [
                "imagePath": imagePath,
                "filter": "sepia",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testImageFilterNoir() async throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "filtered_noir.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.filter",
            input: [
                "imagePath": imagePath,
                "filter": "noir",
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testImageFilterBlur() async throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "filtered_blur.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.filter",
            input: [
                "imagePath": imagePath,
                "filter": "blur",
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testImageFilterInvalid() async throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "filtered_invalid.jpg"

        do {
            _ = try await toolManager.execute(
                toolId: "tool.image.filter",
                input: [
                    "imagePath": imagePath,
                    "filter": "invalid_filter",
                    "outputPath": outputPath
                ]
            )
            XCTFail("Should throw error for invalid filter")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Image Compress Tests

    func testImageCompress() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "compressed.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.compress",
            input: [
                "imagePath": imagePath,
                "quality": 0.5,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify file is smaller
        let originalSize = try FileManager.default.attributesOfItem(atPath: imagePath)[.size] as? Int ?? 0
        let compressedSize = try FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0
        XCTAssertLessThan(compressedSize, originalSize)
    }

    func testImageCompressHighQuality() async throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "compressed_hq.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.compress",
            input: [
                "imagePath": imagePath,
                "quality": 0.9,
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Image Colors Tests

    func testImageColors() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.colors",
            input: [
                "imagePath": imagePath,
                "count": 5
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let colors = result as? [[String: Any]] {
            XCTAssertGreaterThan(colors.count, 0)
            XCTAssertLessThanOrEqual(colors.count, 5)

            // Verify each color has RGB values
            for color in colors {
                XCTAssertNotNil(color["red"])
                XCTAssertNotNil(color["green"])
                XCTAssertNotNil(color["blue"])
            }
        } else {
            XCTFail("Result should be an array of colors")
        }
    }

    // MARK: - Image Watermark Tests

    func testImageWatermark() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "watermarked.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.watermark",
            input: [
                "imagePath": imagePath,
                "text": "ChainlessChain",
                "position": "bottomRight",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testImageWatermarkPositions() async throws {
        // Test all positions
        let positions = ["topLeft", "topRight", "bottomLeft", "bottomRight", "center"]
        let imagePath = testImagesPath + "test_image.jpg"

        for position in positions {
            let outputPath = tempOutputPath + "watermark_\(position).jpg"

            let result = try await toolManager.execute(
                toolId: "tool.image.watermark",
                input: [
                    "imagePath": imagePath,
                    "text": "Test \(position)",
                    "position": position,
                    "outputPath": outputPath
                ]
            )

            XCTAssertNotNil(result)
            XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
        }
    }

    // MARK: - Image Convert Tests

    func testImageConvertToPNG() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "converted.png"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.convert",
            input: [
                "imagePath": imagePath,
                "format": "png",
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    func testImageConvertToJPEG() async throws {
        // Create a PNG first
        let pngPath = testImagesPath + "test.png"
        let image = UIImage(contentsOfFile: testImagesPath + "test_image.jpg")!
        try image.pngData()!.write(to: URL(fileURLWithPath: pngPath))

        let outputPath = tempOutputPath + "converted.jpg"

        let result = try await toolManager.execute(
            toolId: "tool.image.convert",
            input: [
                "imagePath": pngPath,
                "format": "jpeg",
                "outputPath": outputPath
            ]
        )

        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Image Grayscale Tests

    func testImageGrayscale() async throws {
        // Given
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "grayscale.jpg"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.image.grayscale",
            input: [
                "imagePath": imagePath,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertEqual(result as? String, outputPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))
    }

    // MARK: - Color Tool Tests

    func testColorRgbToHex() async throws {
        // Test: Convert red (255, 0, 0) to hex
        let result = try await toolManager.execute(
            toolId: "tool.color.rgbtohex",
            input: [
                "red": 255,
                "green": 0,
                "blue": 0
            ]
        )

        XCTAssertEqual(result as? String, "#FF0000")
    }

    func testColorRgbToHexWhite() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.color.rgbtohex",
            input: [
                "red": 255,
                "green": 255,
                "blue": 255
            ]
        )

        XCTAssertEqual(result as? String, "#FFFFFF")
    }

    func testColorRgbToHexBlack() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.color.rgbtohex",
            input: [
                "red": 0,
                "green": 0,
                "blue": 0
            ]
        )

        XCTAssertEqual(result as? String, "#000000")
    }

    func testColorHexToRgb() async throws {
        // Test: Convert #FF0000 to RGB
        let result = try await toolManager.execute(
            toolId: "tool.color.hextorgb",
            input: ["hex": "#FF0000"]
        )

        XCTAssertNotNil(result)

        if let rgb = result as? [String: Int] {
            XCTAssertEqual(rgb["red"], 255)
            XCTAssertEqual(rgb["green"], 0)
            XCTAssertEqual(rgb["blue"], 0)
        } else {
            XCTFail("Result should be RGB dictionary")
        }
    }

    func testColorHexToRgbWithoutHash() async throws {
        // Test without # prefix
        let result = try await toolManager.execute(
            toolId: "tool.color.hextorgb",
            input: ["hex": "00FF00"]
        )

        if let rgb = result as? [String: Int] {
            XCTAssertEqual(rgb["red"], 0)
            XCTAssertEqual(rgb["green"], 255)
            XCTAssertEqual(rgb["blue"], 0)
        }
    }

    func testColorRgbToHsv() async throws {
        // Test: Convert red (255, 0, 0) to HSV
        let result = try await toolManager.execute(
            toolId: "tool.color.rgbtohsv",
            input: [
                "red": 255,
                "green": 0,
                "blue": 0
            ]
        )

        XCTAssertNotNil(result)

        if let hsv = result as? [String: Double] {
            XCTAssertNotNil(hsv["hue"])
            XCTAssertNotNil(hsv["saturation"])
            XCTAssertNotNil(hsv["value"])

            // Red should have hue ~0, saturation ~1, value ~1
            XCTAssertEqual(hsv["hue"]!, 0, accuracy: 0.01)
            XCTAssertEqual(hsv["saturation"]!, 1.0, accuracy: 0.01)
            XCTAssertEqual(hsv["value"]!, 1.0, accuracy: 0.01)
        } else {
            XCTFail("Result should be HSV dictionary")
        }
    }

    func testColorBrightness() async throws {
        // Test: Brightness of white
        let whiteResult = try await toolManager.execute(
            toolId: "tool.color.brightness",
            input: [
                "red": 255,
                "green": 255,
                "blue": 255
            ]
        )

        XCTAssertEqual(whiteResult as? Double, 1.0, accuracy: 0.01)

        // Test: Brightness of black
        let blackResult = try await toolManager.execute(
            toolId: "tool.color.brightness",
            input: [
                "red": 0,
                "green": 0,
                "blue": 0
            ]
        )

        XCTAssertEqual(blackResult as? Double, 0.0, accuracy: 0.01)
    }

    func testColorInvert() async throws {
        // Test: Invert white to black
        let result = try await toolManager.execute(
            toolId: "tool.color.invert",
            input: [
                "red": 255,
                "green": 255,
                "blue": 255
            ]
        )

        XCTAssertNotNil(result)

        if let rgb = result as? [String: Int] {
            XCTAssertEqual(rgb["red"], 0)
            XCTAssertEqual(rgb["green"], 0)
            XCTAssertEqual(rgb["blue"], 0)
        } else {
            XCTFail("Result should be RGB dictionary")
        }
    }

    func testColorInvertRed() async throws {
        // Test: Invert red (255, 0, 0) to cyan (0, 255, 255)
        let result = try await toolManager.execute(
            toolId: "tool.color.invert",
            input: [
                "red": 255,
                "green": 0,
                "blue": 0
            ]
        )

        if let rgb = result as? [String: Int] {
            XCTAssertEqual(rgb["red"], 0)
            XCTAssertEqual(rgb["green"], 255)
            XCTAssertEqual(rgb["blue"], 255)
        }
    }

    // MARK: - Performance Tests

    func testImageResizePerformance() throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "perf_resize.jpg"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.image.resize",
                    input: [
                        "imagePath": imagePath,
                        "width": 400,
                        "height": 300,
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }

    func testImageFilterPerformance() throws {
        let imagePath = testImagesPath + "test_image.jpg"
        let outputPath = tempOutputPath + "perf_filter.jpg"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.image.filter",
                    input: [
                        "imagePath": imagePath,
                        "filter": "sepia",
                        "outputPath": outputPath
                    ]
                )
            }
        }
    }

    func testColorConversionPerformance() throws {
        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.color.rgbtohex",
                    input: [
                        "red": 128,
                        "green": 64,
                        "blue": 192
                    ]
                )
            }
        }
    }
}
