import Foundation
import CoreCommon
import Vision
import CoreImage
import CoreGraphics

#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
typealias PlatformImage = NSImage
#endif

// MARK: - VisionTools
/// Vision and image processing tools
/// Provides OCR, image analysis, and processing capabilities
///
/// Features:
/// - OCR text recognition (VNRecognizeTextRequest)
/// - Image classification
/// - Face detection
/// - Barcode/QR code detection
/// - Image filtering and manipulation
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Vision Result Types

/// OCR result
struct OCRResult: Codable {
    let text: String
    let confidence: Float
    let boundingBoxes: [BoundingBox]
    let language: String?

    struct BoundingBox: Codable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let text: String
    }
}

/// Image classification result
struct ClassificationResult: Codable {
    let label: String
    let confidence: Float
}

/// Face detection result
struct FaceDetectionResult: Codable {
    let faceCount: Int
    let faces: [DetectedFace]

    struct DetectedFace: Codable {
        let boundingBox: CGRect
        let landmarks: FaceLandmarks?
        let quality: Float?
    }

    struct FaceLandmarks: Codable {
        let leftEye: CGPoint?
        let rightEye: CGPoint?
        let nose: CGPoint?
        let mouth: CGPoint?
    }
}

/// Barcode detection result
struct BarcodeResult: Codable {
    let barcodes: [DetectedBarcode]

    struct DetectedBarcode: Codable {
        let payload: String
        let symbology: String
        let boundingBox: CGRect
    }
}

/// Image analysis result
struct ImageAnalysisResult: Codable {
    let width: Int
    let height: Int
    let colorSpace: String?
    let hasAlpha: Bool
    let dominantColors: [String]?
    let brightness: Float?
    let contrast: Float?
}

/// Image filter type
enum ImageFilter: String, Codable {
    case grayscale
    case sepia
    case blur
    case sharpen
    case invert
    case brightness
    case contrast
    case saturation
    case vignette
    case edges
}

// MARK: - Vision Tools Handler

/// Vision and image processing tools handler
@MainActor
class VisionToolsHandler: ObservableObject {
    // MARK: - Properties

    private let logger = Logger.shared
    private let ciContext = CIContext()

    // MARK: - Singleton

    static let shared = VisionToolsHandler()

    // MARK: - OCR

    /// Recognize text in image
    /// - Parameters:
    ///   - imagePath: Path to image file
    ///   - languages: Preferred languages (optional)
    ///   - recognitionLevel: Recognition level (accurate or fast)
    /// - Returns: OCR result
    func recognizeText(
        imagePath: String,
        languages: [String]? = nil,
        recognitionLevel: VNRequestTextRecognitionLevel = .accurate
    ) async throws -> OCRResult {
        logger.info("[VisionTools] Recognizing text in: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(returning: OCRResult(text: "", confidence: 0, boundingBoxes: [], language: nil))
                    return
                }

                var fullText = ""
                var boundingBoxes: [OCRResult.BoundingBox] = []
                var totalConfidence: Float = 0

                for observation in observations {
                    if let candidate = observation.topCandidates(1).first {
                        fullText += candidate.string + "\n"
                        totalConfidence += candidate.confidence

                        let box = observation.boundingBox
                        boundingBoxes.append(OCRResult.BoundingBox(
                            x: box.origin.x,
                            y: box.origin.y,
                            width: box.width,
                            height: box.height,
                            text: candidate.string
                        ))
                    }
                }

                let avgConfidence = observations.isEmpty ? 0 : totalConfidence / Float(observations.count)

                continuation.resume(returning: OCRResult(
                    text: fullText.trimmingCharacters(in: .whitespacesAndNewlines),
                    confidence: avgConfidence,
                    boundingBoxes: boundingBoxes,
                    language: nil
                ))
            }

            request.recognitionLevel = recognitionLevel
            if let languages = languages {
                request.recognitionLanguages = languages
            }
            request.usesLanguageCorrection = true

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Image Classification

    /// Classify image content
    /// - Parameter imagePath: Path to image file
    /// - Returns: Classification results
    func classifyImage(imagePath: String) async throws -> [ClassificationResult] {
        logger.info("[VisionTools] Classifying image: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNClassifyImageRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNClassificationObservation] else {
                    continuation.resume(returning: [])
                    return
                }

                let results = observations.prefix(10).map { obs in
                    ClassificationResult(label: obs.identifier, confidence: obs.confidence)
                }

                continuation.resume(returning: Array(results))
            }

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Face Detection

    /// Detect faces in image
    /// - Parameters:
    ///   - imagePath: Path to image file
    ///   - detectLandmarks: Whether to detect facial landmarks
    /// - Returns: Face detection result
    func detectFaces(imagePath: String, detectLandmarks: Bool = false) async throws -> FaceDetectionResult {
        logger.info("[VisionTools] Detecting faces in: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNDetectFaceRectanglesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNFaceObservation] else {
                    continuation.resume(returning: FaceDetectionResult(faceCount: 0, faces: []))
                    return
                }

                let faces = observations.map { obs in
                    FaceDetectionResult.DetectedFace(
                        boundingBox: obs.boundingBox,
                        landmarks: nil,  // Landmarks require separate request
                        quality: nil
                    )
                }

                continuation.resume(returning: FaceDetectionResult(
                    faceCount: faces.count,
                    faces: faces
                ))
            }

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Barcode Detection

    /// Detect barcodes and QR codes
    /// - Parameter imagePath: Path to image file
    /// - Returns: Barcode detection result
    func detectBarcodes(imagePath: String) async throws -> BarcodeResult {
        logger.info("[VisionTools] Detecting barcodes in: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNDetectBarcodesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let observations = request.results as? [VNBarcodeObservation] else {
                    continuation.resume(returning: BarcodeResult(barcodes: []))
                    return
                }

                let barcodes = observations.compactMap { obs -> BarcodeResult.DetectedBarcode? in
                    guard let payload = obs.payloadStringValue else { return nil }
                    return BarcodeResult.DetectedBarcode(
                        payload: payload,
                        symbology: obs.symbology.rawValue,
                        boundingBox: obs.boundingBox
                    )
                }

                continuation.resume(returning: BarcodeResult(barcodes: barcodes))
            }

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Image Analysis

    /// Analyze image properties
    /// - Parameter imagePath: Path to image file
    /// - Returns: Image analysis result
    func analyzeImage(imagePath: String) async throws -> ImageAnalysisResult {
        logger.info("[VisionTools] Analyzing image: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        let width = cgImage.width
        let height = cgImage.height
        let colorSpace = cgImage.colorSpace?.name as String? ?? "Unknown"
        let hasAlpha = cgImage.alphaInfo != .none && cgImage.alphaInfo != .noneSkipFirst && cgImage.alphaInfo != .noneSkipLast

        // Calculate brightness (simple average)
        let brightness = await calculateBrightness(cgImage)

        return ImageAnalysisResult(
            width: width,
            height: height,
            colorSpace: colorSpace,
            hasAlpha: hasAlpha,
            dominantColors: nil,  // Would require more complex analysis
            brightness: brightness,
            contrast: nil
        )
    }

    // MARK: - Image Filtering

    /// Apply filter to image
    /// - Parameters:
    ///   - imagePath: Input image path
    ///   - filter: Filter type
    ///   - outputPath: Output image path
    ///   - intensity: Filter intensity (0-1)
    /// - Returns: Output file path
    func applyFilter(
        imagePath: String,
        filter: ImageFilter,
        outputPath: String,
        intensity: Float = 0.5
    ) async throws -> String {
        logger.info("[VisionTools] Applying \(filter.rawValue) filter to: \(imagePath)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        let ciImage = CIImage(cgImage: cgImage)
        var outputImage: CIImage?

        switch filter {
        case .grayscale:
            let filter = CIFilter(name: "CIPhotoEffectMono")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            outputImage = filter?.outputImage

        case .sepia:
            let filter = CIFilter(name: "CISepiaTone")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity, forKey: kCIInputIntensityKey)
            outputImage = filter?.outputImage

        case .blur:
            let filter = CIFilter(name: "CIGaussianBlur")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity * 20, forKey: kCIInputRadiusKey)
            outputImage = filter?.outputImage

        case .sharpen:
            let filter = CIFilter(name: "CISharpenLuminance")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity * 2, forKey: kCIInputSharpnessKey)
            outputImage = filter?.outputImage

        case .invert:
            let filter = CIFilter(name: "CIColorInvert")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            outputImage = filter?.outputImage

        case .brightness:
            let filter = CIFilter(name: "CIColorControls")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity - 0.5, forKey: kCIInputBrightnessKey)
            outputImage = filter?.outputImage

        case .contrast:
            let filter = CIFilter(name: "CIColorControls")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(1.0 + intensity, forKey: kCIInputContrastKey)
            outputImage = filter?.outputImage

        case .saturation:
            let filter = CIFilter(name: "CIColorControls")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity * 2, forKey: kCIInputSaturationKey)
            outputImage = filter?.outputImage

        case .vignette:
            let filter = CIFilter(name: "CIVignette")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity * 2, forKey: kCIInputIntensityKey)
            filter?.setValue(intensity * 50, forKey: kCIInputRadiusKey)
            outputImage = filter?.outputImage

        case .edges:
            let filter = CIFilter(name: "CIEdges")
            filter?.setValue(ciImage, forKey: kCIInputImageKey)
            filter?.setValue(intensity * 10, forKey: kCIInputIntensityKey)
            outputImage = filter?.outputImage
        }

        guard let output = outputImage,
              let resultCGImage = ciContext.createCGImage(output, from: output.extent) else {
            throw VisionToolError.filterFailed
        }

        // Save output image
        try saveImage(resultCGImage, to: outputPath)

        return outputPath
    }

    /// Resize image
    /// - Parameters:
    ///   - imagePath: Input image path
    ///   - width: Target width
    ///   - height: Target height
    ///   - outputPath: Output image path
    /// - Returns: Output file path
    func resizeImage(
        imagePath: String,
        width: Int,
        height: Int,
        outputPath: String
    ) async throws -> String {
        logger.info("[VisionTools] Resizing image to \(width)x\(height)")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        let ciImage = CIImage(cgImage: cgImage)
        let scaleX = CGFloat(width) / ciImage.extent.width
        let scaleY = CGFloat(height) / ciImage.extent.height

        let transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
        let scaledImage = ciImage.transformed(by: transform)

        guard let resultCGImage = ciContext.createCGImage(scaledImage, from: scaledImage.extent) else {
            throw VisionToolError.filterFailed
        }

        try saveImage(resultCGImage, to: outputPath)

        return outputPath
    }

    /// Crop image
    /// - Parameters:
    ///   - imagePath: Input image path
    ///   - rect: Crop rectangle
    ///   - outputPath: Output image path
    /// - Returns: Output file path
    func cropImage(
        imagePath: String,
        rect: CGRect,
        outputPath: String
    ) async throws -> String {
        logger.info("[VisionTools] Cropping image")

        guard let image = loadImage(from: imagePath),
              let cgImage = getCGImage(from: image) else {
            throw VisionToolError.imageLoadFailed
        }

        guard let croppedImage = cgImage.cropping(to: rect) else {
            throw VisionToolError.cropFailed
        }

        try saveImage(croppedImage, to: outputPath)

        return outputPath
    }

    // MARK: - Private Helpers

    private func loadImage(from path: String) -> PlatformImage? {
        #if canImport(UIKit)
        return UIImage(contentsOfFile: path)
        #elseif canImport(AppKit)
        return NSImage(contentsOfFile: path)
        #endif
    }

    private func getCGImage(from image: PlatformImage) -> CGImage? {
        #if canImport(UIKit)
        return image.cgImage
        #elseif canImport(AppKit)
        return image.cgImage(forProposedRect: nil, context: nil, hints: nil)
        #endif
    }

    private func saveImage(_ cgImage: CGImage, to path: String) throws {
        let url = URL(fileURLWithPath: path)
        let fileExtension = url.pathExtension.lowercased()

        #if canImport(UIKit)
        let uiImage = UIImage(cgImage: cgImage)
        let data: Data?

        switch fileExtension {
        case "png":
            data = uiImage.pngData()
        case "jpg", "jpeg":
            data = uiImage.jpegData(compressionQuality: 0.9)
        default:
            data = uiImage.pngData()
        }

        guard let imageData = data else {
            throw VisionToolError.saveFailed
        }

        try imageData.write(to: url)

        #elseif canImport(AppKit)
        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        let data: Data?

        switch fileExtension {
        case "png":
            data = bitmapRep.representation(using: .png, properties: [:])
        case "jpg", "jpeg":
            data = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])
        default:
            data = bitmapRep.representation(using: .png, properties: [:])
        }

        guard let imageData = data else {
            throw VisionToolError.saveFailed
        }

        try imageData.write(to: url)
        #endif
    }

    private func calculateBrightness(_ cgImage: CGImage) async -> Float {
        // Simplified brightness calculation
        let width = cgImage.width
        let height = cgImage.height

        guard let data = cgImage.dataProvider?.data,
              let bytes = CFDataGetBytePtr(data) else {
            return 0.5
        }

        let bytesPerPixel = cgImage.bitsPerPixel / 8
        let bytesPerRow = cgImage.bytesPerRow

        var totalBrightness: Float = 0
        let sampleStep = max(1, width * height / 10000)  // Sample ~10000 pixels max

        for i in stride(from: 0, to: width * height, by: sampleStep) {
            let x = i % width
            let y = i / width
            let offset = y * bytesPerRow + x * bytesPerPixel

            let r = Float(bytes[offset])
            let g = Float(bytes[offset + 1])
            let b = Float(bytes[offset + 2])

            // Perceived brightness formula
            let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            totalBrightness += brightness
        }

        let samples = (width * height + sampleStep - 1) / sampleStep
        return totalBrightness / Float(samples)
    }
}

// MARK: - Errors

/// Vision tool errors
enum VisionToolError: LocalizedError {
    case imageLoadFailed
    case filterFailed
    case cropFailed
    case saveFailed
    case recognitionFailed(String)

    var errorDescription: String? {
        switch self {
        case .imageLoadFailed:
            return "Failed to load image"
        case .filterFailed:
            return "Failed to apply filter"
        case .cropFailed:
            return "Failed to crop image"
        case .saveFailed:
            return "Failed to save image"
        case .recognitionFailed(let msg):
            return "Recognition failed: \(msg)"
        }
    }
}

// MARK: - Tool Registration

extension VisionToolsHandler {
    /// Get all vision tools for registration
    func getTools() -> [Tool] {
        return [
            Tool(
                name: "ocr_recognize",
                description: "Recognize text in images using OCR",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Image file path", required: true),
                    ToolParameter(name: "languages", type: .array, description: "Preferred languages", required: false)
                ]
            ),
            Tool(
                name: "image_classify",
                description: "Classify image content",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Image file path", required: true)
                ]
            ),
            Tool(
                name: "face_detect",
                description: "Detect faces in image",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Image file path", required: true),
                    ToolParameter(name: "detectLandmarks", type: .boolean, description: "Detect facial landmarks", required: false)
                ]
            ),
            Tool(
                name: "barcode_detect",
                description: "Detect barcodes and QR codes",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Image file path", required: true)
                ]
            ),
            Tool(
                name: "image_filter",
                description: "Apply filter to image",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Input image path", required: true),
                    ToolParameter(name: "filter", type: .string, description: "Filter type", required: true),
                    ToolParameter(name: "outputPath", type: .string, description: "Output image path", required: true),
                    ToolParameter(name: "intensity", type: .number, description: "Filter intensity (0-1)", required: false)
                ]
            ),
            Tool(
                name: "image_resize",
                description: "Resize image",
                parameters: [
                    ToolParameter(name: "imagePath", type: .string, description: "Input image path", required: true),
                    ToolParameter(name: "width", type: .number, description: "Target width", required: true),
                    ToolParameter(name: "height", type: .number, description: "Target height", required: true),
                    ToolParameter(name: "outputPath", type: .string, description: "Output image path", required: true)
                ]
            )
        ]
    }
}
