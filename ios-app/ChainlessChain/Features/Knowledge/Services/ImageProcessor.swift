import UIKit
import CoreImage
import CoreImage.CIFilterBuiltins

/// Image Processor - Handles image compression, thumbnail generation, and format conversion
/// Reference: desktop-app-vue/src/main/image/image-processor.js
@MainActor
class ImageProcessor: ObservableObject {
    static let shared = ImageProcessor()

    // Configuration
    private let maxWidth: CGFloat = 1920
    private let maxHeight: CGFloat = 1080
    private let quality: CGFloat = 0.85
    private let thumbnailWidth: CGFloat = 200
    private let thumbnailHeight: CGFloat = 200
    private let largeFileThreshold: Int = 10 * 1024 * 1024 // 10MB

    // Supported formats
    private let supportedFormats = ["jpg", "jpeg", "png", "gif", "bmp", "heic", "heif"]

    // Statistics
    @Published var statistics = ProcessingStatistics()

    struct ProcessingStatistics {
        var imagesProcessed: Int = 0
        var totalOriginalSize: Int64 = 0
        var totalCompressedSize: Int64 = 0
        var averageCompressionRatio: Double = 0
    }

    struct ImageMetadata {
        let width: CGFloat
        let height: CGFloat
        let size: Int64
        let format: String
        let hasAlpha: Bool
        let orientation: UIImage.Orientation
    }

    struct ProcessingResult {
        let success: Bool
        let originalSize: Int64
        let compressedSize: Int64
        let originalWidth: CGFloat
        let originalHeight: CGFloat
        let compressedWidth: CGFloat
        let compressedHeight: CGFloat
        let compressionRatio: Double
        let outputPath: URL
        let processingMode: ProcessingMode
    }

    enum ProcessingMode {
        case direct
        case streaming
    }

    private init() {}

    // MARK: - Format Support

    /// Check if file is a supported image format
    func isSupportedImage(url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return supportedFormats.contains(ext)
    }

    // MARK: - Metadata

    /// Get image metadata
    func getMetadata(from image: UIImage) -> ImageMetadata? {
        guard let cgImage = image.cgImage else { return nil }

        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let hasAlpha = cgImage.alphaInfo != .none

        // Estimate size (rough calculation)
        let bytesPerPixel = hasAlpha ? 4 : 3
        let estimatedSize = Int64(width * height * CGFloat(bytesPerPixel))

        return ImageMetadata(
            width: width,
            height: height,
            size: estimatedSize,
            format: "unknown",
            hasAlpha: hasAlpha,
            orientation: image.imageOrientation
        )
    }

    /// Get metadata from file
    func getMetadata(from url: URL) async throws -> ImageMetadata {
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any] else {
            throw ImageProcessorError.invalidImage
        }

        let width = properties[kCGImagePropertyPixelWidth as String] as? CGFloat ?? 0
        let height = properties[kCGImagePropertyPixelHeight as String] as? CGFloat ?? 0
        let hasAlpha = properties[kCGImagePropertyHasAlpha as String] as? Bool ?? false

        // Get file size
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let fileSize = attributes[.size] as? Int64 ?? 0

        // Get format
        let format = url.pathExtension.lowercased()

        return ImageMetadata(
            width: width,
            height: height,
            size: fileSize,
            format: format,
            hasAlpha: hasAlpha,
            orientation: .up
        )
    }

    // MARK: - Compression

    /// Compress image
    func compress(
        image: UIImage,
        outputURL: URL,
        maxWidth: CGFloat? = nil,
        maxHeight: CGFloat? = nil,
        quality: CGFloat? = nil
    ) async throws -> ProcessingResult {
        let targetMaxWidth = maxWidth ?? self.maxWidth
        let targetMaxHeight = maxHeight ?? self.maxHeight
        let targetQuality = quality ?? self.quality

        // Get original metadata
        guard let originalMetadata = getMetadata(from: image) else {
            throw ImageProcessorError.invalidImage
        }

        // Resize if needed
        let resizedImage: UIImage
        if originalMetadata.width > targetMaxWidth || originalMetadata.height > targetMaxHeight {
            resizedImage = try await resize(
                image: image,
                maxWidth: targetMaxWidth,
                maxHeight: targetMaxHeight
            )
        } else {
            resizedImage = image
        }

        // Compress to JPEG
        guard let compressedData = resizedImage.jpegData(compressionQuality: targetQuality) else {
            throw ImageProcessorError.compressionFailed
        }

        // Write to file
        try compressedData.write(to: outputURL)

        // Get compressed metadata
        let compressedSize = Int64(compressedData.count)
        let compressedWidth = resizedImage.size.width
        let compressedHeight = resizedImage.size.height

        // Calculate compression ratio
        let compressionRatio = originalMetadata.size > 0 ?
            Double(1.0 - Double(compressedSize) / Double(originalMetadata.size)) * 100.0 : 0

        // Update statistics
        statistics.imagesProcessed += 1
        statistics.totalOriginalSize += originalMetadata.size
        statistics.totalCompressedSize += compressedSize
        statistics.averageCompressionRatio = Double(statistics.totalOriginalSize - statistics.totalCompressedSize) /
            Double(statistics.totalOriginalSize) * 100.0

        AppLogger.log("[ImageProcessor] Compressed image: \(compressionRatio)% reduction")

        return ProcessingResult(
            success: true,
            originalSize: originalMetadata.size,
            compressedSize: compressedSize,
            originalWidth: originalMetadata.width,
            originalHeight: originalMetadata.height,
            compressedWidth: compressedWidth,
            compressedHeight: compressedHeight,
            compressionRatio: compressionRatio,
            outputPath: outputURL,
            processingMode: .direct
        )
    }

    /// Compress image from file
    func compress(
        inputURL: URL,
        outputURL: URL,
        maxWidth: CGFloat? = nil,
        maxHeight: CGFloat? = nil,
        quality: CGFloat? = nil
    ) async throws -> ProcessingResult {
        // Check file size
        let attributes = try FileManager.default.attributesOfItem(atPath: inputURL.path)
        let fileSize = attributes[.size] as? Int64 ?? 0
        let isLargeFile = fileSize > largeFileThreshold

        if isLargeFile {
            AppLogger.log("[ImageProcessor] Large file detected: \(fileSize / 1024 / 1024)MB, using optimized mode")
        }

        // Load image
        guard let image = UIImage(contentsOfFile: inputURL.path) else {
            throw ImageProcessorError.invalidImage
        }

        return try await compress(
            image: image,
            outputURL: outputURL,
            maxWidth: maxWidth,
            maxHeight: maxHeight,
            quality: quality
        )
    }

    // MARK: - Thumbnail Generation

    /// Generate thumbnail
    func generateThumbnail(
        from image: UIImage,
        outputURL: URL,
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        fit: ThumbnailFit = .cover
    ) async throws -> ProcessingResult {
        let targetWidth = width ?? thumbnailWidth
        let targetHeight = height ?? thumbnailHeight

        // Create thumbnail
        let thumbnailImage = try await createThumbnail(
            from: image,
            width: targetWidth,
            height: targetHeight,
            fit: fit
        )

        // Compress to JPEG
        guard let thumbnailData = thumbnailImage.jpegData(compressionQuality: 0.8) else {
            throw ImageProcessorError.compressionFailed
        }

        // Write to file
        try thumbnailData.write(to: outputURL)

        let thumbnailSize = Int64(thumbnailData.count)

        AppLogger.log("[ImageProcessor] Generated thumbnail: \(targetWidth)x\(targetHeight)")

        return ProcessingResult(
            success: true,
            originalSize: 0,
            compressedSize: thumbnailSize,
            originalWidth: image.size.width,
            originalHeight: image.size.height,
            compressedWidth: targetWidth,
            compressedHeight: targetHeight,
            compressionRatio: 0,
            outputPath: outputURL,
            processingMode: .direct
        )
    }

    /// Generate thumbnail from file
    func generateThumbnail(
        from inputURL: URL,
        outputURL: URL,
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        fit: ThumbnailFit = .cover
    ) async throws -> ProcessingResult {
        guard let image = UIImage(contentsOfFile: inputURL.path) else {
            throw ImageProcessorError.invalidImage
        }

        return try await generateThumbnail(
            from: image,
            outputURL: outputURL,
            width: width,
            height: height,
            fit: fit
        )
    }

    // MARK: - Image Manipulation

    /// Resize image
    private func resize(
        image: UIImage,
        maxWidth: CGFloat,
        maxHeight: CGFloat
    ) async throws -> UIImage {
        let size = image.size
        let widthRatio = maxWidth / size.width
        let heightRatio = maxHeight / size.height
        let ratio = min(widthRatio, heightRatio)

        let newSize = CGSize(
            width: size.width * ratio,
            height: size.height * ratio
        )

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                UIGraphicsBeginImageContextWithOptions(newSize, false, 1.0)
                image.draw(in: CGRect(origin: .zero, size: newSize))
                let resizedImage = UIGraphicsGetImageFromCurrentImageContext()
                UIGraphicsEndImageContext()

                if let resizedImage = resizedImage {
                    continuation.resume(returning: resizedImage)
                } else {
                    continuation.resume(throwing: ImageProcessorError.resizeFailed)
                }
            }
        }
    }

    /// Create thumbnail with fit mode
    private func createThumbnail(
        from image: UIImage,
        width: CGFloat,
        height: CGFloat,
        fit: ThumbnailFit
    ) async throws -> UIImage {
        let size = image.size
        let targetSize = CGSize(width: width, height: height)

        let rect: CGRect
        switch fit {
        case .cover:
            // Fill the entire thumbnail, cropping if necessary
            let widthRatio = width / size.width
            let heightRatio = height / size.height
            let ratio = max(widthRatio, heightRatio)

            let scaledSize = CGSize(
                width: size.width * ratio,
                height: size.height * ratio
            )

            let x = (width - scaledSize.width) / 2
            let y = (height - scaledSize.height) / 2

            rect = CGRect(
                x: x,
                y: y,
                width: scaledSize.width,
                height: scaledSize.height
            )

        case .contain:
            // Fit entire image within thumbnail
            let widthRatio = width / size.width
            let heightRatio = height / size.height
            let ratio = min(widthRatio, heightRatio)

            let scaledSize = CGSize(
                width: size.width * ratio,
                height: size.height * ratio
            )

            let x = (width - scaledSize.width) / 2
            let y = (height - scaledSize.height) / 2

            rect = CGRect(
                x: x,
                y: y,
                width: scaledSize.width,
                height: scaledSize.height
            )
        }

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                UIGraphicsBeginImageContextWithOptions(targetSize, false, 1.0)
                image.draw(in: rect)
                let thumbnail = UIGraphicsGetImageFromCurrentImageContext()
                UIGraphicsEndImageContext()

                if let thumbnail = thumbnail {
                    continuation.resume(returning: thumbnail)
                } else {
                    continuation.resume(throwing: ImageProcessorError.thumbnailGenerationFailed)
                }
            }
        }
    }

    // MARK: - Format Conversion

    /// Convert image to JPEG
    func convertToJPEG(image: UIImage, quality: CGFloat = 0.85) -> Data? {
        return image.jpegData(compressionQuality: quality)
    }

    /// Convert image to PNG
    func convertToPNG(image: UIImage) -> Data? {
        return image.pngData()
    }

    // MARK: - Batch Processing

    /// Process multiple images
    func batchProcess(
        images: [UIImage],
        outputDirectory: URL,
        options: ProcessingOptions = ProcessingOptions()
    ) async throws -> [ProcessingResult] {
        var results: [ProcessingResult] = []

        for (index, image) in images.enumerated() {
            let outputURL = outputDirectory.appendingPathComponent("image_\(index).jpg")

            do {
                let result = try await compress(
                    image: image,
                    outputURL: outputURL,
                    maxWidth: options.maxWidth,
                    maxHeight: options.maxHeight,
                    quality: options.quality
                )
                results.append(result)
            } catch {
                AppLogger.error("[ImageProcessor] Failed to process image \(index): \(error)")
                throw error
            }
        }

        return results
    }

    // MARK: - Statistics

    func getStatistics() -> ProcessingStatistics {
        return statistics
    }

    func resetStatistics() {
        statistics = ProcessingStatistics()
    }
}

// MARK: - Supporting Types

enum ThumbnailFit {
    case cover  // Fill entire thumbnail, crop if needed
    case contain  // Fit entire image within thumbnail
}

struct ProcessingOptions {
    var maxWidth: CGFloat?
    var maxHeight: CGFloat?
    var quality: CGFloat?
    var generateThumbnail: Bool = false
    var thumbnailWidth: CGFloat?
    var thumbnailHeight: CGFloat?
}

enum ImageProcessorError: LocalizedError {
    case invalidImage
    case compressionFailed
    case resizeFailed
    case thumbnailGenerationFailed
    case unsupportedFormat

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            return "Invalid image"
        case .compressionFailed:
            return "Image compression failed"
        case .resizeFailed:
            return "Image resize failed"
        case .thumbnailGenerationFailed:
            return "Thumbnail generation failed"
        case .unsupportedFormat:
            return "Unsupported image format"
        }
    }
}

// MARK: - Logger

private struct AppLogger {
    static func log(_ message: String) {
        print(message)
    }

    static func error(_ message: String) {
        print("❌ \(message)")
    }
}
