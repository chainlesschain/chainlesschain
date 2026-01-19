import Foundation
import UIKit

/// Image Storage Manager - Handles image file storage, retrieval, and management
/// Reference: desktop-app-vue/src/main/image/image-storage.js
@MainActor
class ImageStorageManager: ObservableObject {
    static let shared = ImageStorageManager()

    // Storage directories
    private let storageDir = "images"
    private let thumbnailDir = "images/thumbnails"

    // Paths
    private var storageBasePath: URL
    private var thumbnailBasePath: URL

    // Configuration
    private let useUUID = true
    private let autoCreateDir = true

    // Statistics
    @Published var statistics = StorageStatistics()

    struct StorageStatistics {
        var totalImages: Int = 0
        var totalSize: Int64 = 0
        var thumbnailsGenerated: Int = 0
    }

    struct ImageRecord: Codable, Identifiable {
        let id: String
        let filename: String
        let originalFilename: String
        let path: String
        let thumbnailPath: String?
        let size: Int64
        let width: CGFloat?
        let height: CGFloat?
        let format: String
        let ocrText: String?
        let ocrConfidence: Double?
        let knowledgeId: String?
        let createdAt: Date
        let updatedAt: Date
    }

    private init() {
        // Get documents directory
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

        storageBasePath = documentsPath.appendingPathComponent(storageDir)
        thumbnailBasePath = documentsPath.appendingPathComponent(thumbnailDir)
    }

    // MARK: - Initialization

    /// Initialize storage directories
    func initialize() async throws {
        if autoCreateDir {
            try FileManager.default.createDirectory(
                at: storageBasePath,
                withIntermediateDirectories: true
            )

            try FileManager.default.createDirectory(
                at: thumbnailBasePath,
                withIntermediateDirectories: true
            )

            AppLogger.log("[ImageStorage] Storage directories created: \(storageBasePath.path)")
        }

        // Load statistics
        await updateStatistics()
    }

    // MARK: - File Management

    /// Generate unique filename
    private func generateFilename(originalFilename: String) -> String {
        let ext = (originalFilename as NSString).pathExtension

        if useUUID {
            return "\(UUID().uuidString).\(ext)"
        } else {
            let timestamp = Date().timeIntervalSince1970
            let random = Int.random(in: 0..<10000)
            return "img_\(Int(timestamp))_\(random).\(ext)"
        }
    }

    /// Save image
    func saveImage(
        image: UIImage,
        originalFilename: String,
        metadata: ImageMetadata? = nil
    ) async throws -> ImageRecord {
        // Generate filename
        let newFilename = generateFilename(originalFilename: originalFilename)
        let destPath = storageBasePath.appendingPathComponent(newFilename)

        // Convert to JPEG and save
        guard let imageData = image.jpegData(compressionQuality: 0.9) else {
            throw ImageStorageError.saveFailed
        }

        try imageData.write(to: destPath)

        // Get file size
        let attributes = try FileManager.default.attributesOfItem(atPath: destPath.path)
        let fileSize = attributes[.size] as? Int64 ?? 0

        // Create record
        let imageRecord = ImageRecord(
            id: metadata?.id ?? UUID().uuidString,
            filename: newFilename,
            originalFilename: originalFilename,
            path: destPath.path,
            thumbnailPath: metadata?.thumbnailPath,
            size: fileSize,
            width: metadata?.width ?? image.size.width,
            height: metadata?.height ?? image.size.height,
            format: (originalFilename as NSString).pathExtension,
            ocrText: metadata?.ocrText,
            ocrConfidence: metadata?.ocrConfidence,
            knowledgeId: metadata?.knowledgeId,
            createdAt: Date(),
            updatedAt: Date()
        )

        // Save to database (would integrate with CoreData or SQLite)
        try await saveImageRecord(imageRecord)

        // Update statistics
        statistics.totalImages += 1
        statistics.totalSize += fileSize

        AppLogger.log("[ImageStorage] Image saved: \(newFilename)")

        return imageRecord
    }

    /// Save image from file
    func saveImage(
        from sourceURL: URL,
        metadata: ImageMetadata? = nil
    ) async throws -> ImageRecord {
        // Generate filename
        let originalFilename = sourceURL.lastPathComponent
        let newFilename = generateFilename(originalFilename: originalFilename)
        let destPath = storageBasePath.appendingPathComponent(newFilename)

        // Copy file
        try FileManager.default.copyItem(at: sourceURL, to: destPath)

        // Get file size
        let attributes = try FileManager.default.attributesOfItem(atPath: destPath.path)
        let fileSize = attributes[.size] as? Int64 ?? 0

        // Load image to get dimensions
        let image = UIImage(contentsOfFile: destPath.path)

        // Create record
        let imageRecord = ImageRecord(
            id: metadata?.id ?? UUID().uuidString,
            filename: newFilename,
            originalFilename: originalFilename,
            path: destPath.path,
            thumbnailPath: metadata?.thumbnailPath,
            size: fileSize,
            width: metadata?.width ?? image?.size.width,
            height: metadata?.height ?? image?.size.height,
            format: sourceURL.pathExtension,
            ocrText: metadata?.ocrText,
            ocrConfidence: metadata?.ocrConfidence,
            knowledgeId: metadata?.knowledgeId,
            createdAt: Date(),
            updatedAt: Date()
        )

        // Save to database
        try await saveImageRecord(imageRecord)

        // Update statistics
        statistics.totalImages += 1
        statistics.totalSize += fileSize

        AppLogger.log("[ImageStorage] Image saved from file: \(newFilename)")

        return imageRecord
    }

    /// Save thumbnail
    func saveThumbnail(
        imageId: String,
        thumbnail: UIImage
    ) async throws -> String {
        let thumbnailFilename = "\(imageId)_thumb.jpg"
        let thumbnailPath = thumbnailBasePath.appendingPathComponent(thumbnailFilename)

        // Convert to JPEG and save
        guard let thumbnailData = thumbnail.jpegData(compressionQuality: 0.8) else {
            throw ImageStorageError.saveFailed
        }

        try thumbnailData.write(to: thumbnailPath)

        // Update record in database
        try await updateThumbnailPath(imageId: imageId, thumbnailPath: thumbnailPath.path)

        // Update statistics
        statistics.thumbnailsGenerated += 1

        AppLogger.log("[ImageStorage] Thumbnail saved: \(thumbnailFilename)")

        return thumbnailPath.path
    }

    // MARK: - Retrieval

    /// Get image by ID
    func getImage(id: String) async throws -> UIImage? {
        guard let record = try await getImageRecord(id: id) else {
            return nil
        }

        return UIImage(contentsOfFile: record.path)
    }

    /// Get thumbnail by image ID
    func getThumbnail(imageId: String) async throws -> UIImage? {
        guard let record = try await getImageRecord(id: imageId),
              let thumbnailPath = record.thumbnailPath else {
            return nil
        }

        return UIImage(contentsOfFile: thumbnailPath)
    }

    /// Get all images
    func getAllImages() async throws -> [ImageRecord] {
        // This would query the database
        // For now, return empty array
        return []
    }

    /// Get images by knowledge ID
    func getImages(forKnowledgeId knowledgeId: String) async throws -> [ImageRecord] {
        // This would query the database
        return []
    }

    // MARK: - Deletion

    /// Delete image
    func deleteImage(id: String) async throws {
        guard let record = try await getImageRecord(id: id) else {
            throw ImageStorageError.imageNotFound
        }

        // Delete file
        let fileURL = URL(fileURLWithPath: record.path)
        try FileManager.default.removeItem(at: fileURL)

        // Delete thumbnail if exists
        if let thumbnailPath = record.thumbnailPath {
            let thumbnailURL = URL(fileURLWithPath: thumbnailPath)
            try? FileManager.default.removeItem(at: thumbnailURL)
        }

        // Delete from database
        try await deleteImageRecord(id: id)

        // Update statistics
        statistics.totalImages -= 1
        statistics.totalSize -= record.size

        AppLogger.log("[ImageStorage] Image deleted: \(id)")
    }

    /// Delete all images for knowledge item
    func deleteImages(forKnowledgeId knowledgeId: String) async throws {
        let images = try await getImages(forKnowledgeId: knowledgeId)

        for image in images {
            try await deleteImage(id: image.id)
        }
    }

    // MARK: - Database Operations (Placeholder)

    private func saveImageRecord(_ record: ImageRecord) async throws {
        // This would save to CoreData or SQLite
        // For now, just log
        AppLogger.log("[ImageStorage] Saving record to database: \(record.id)")
    }

    private func getImageRecord(id: String) async throws -> ImageRecord? {
        // This would query the database
        return nil
    }

    private func updateThumbnailPath(imageId: String, thumbnailPath: String) async throws {
        // This would update the database
        AppLogger.log("[ImageStorage] Updating thumbnail path: \(imageId)")
    }

    private func deleteImageRecord(id: String) async throws {
        // This would delete from database
        AppLogger.log("[ImageStorage] Deleting record from database: \(id)")
    }

    // MARK: - Statistics

    private func updateStatistics() async {
        // Count files in storage directory
        do {
            let files = try FileManager.default.contentsOfDirectory(at: storageBasePath, includingPropertiesForKeys: [.fileSizeKey])

            var totalSize: Int64 = 0
            for file in files {
                let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
                totalSize += attributes[.size] as? Int64 ?? 0
            }

            statistics.totalImages = files.count
            statistics.totalSize = totalSize

            // Count thumbnails
            let thumbnails = try FileManager.default.contentsOfDirectory(at: thumbnailBasePath, includingPropertiesForKeys: nil)
            statistics.thumbnailsGenerated = thumbnails.count

        } catch {
            AppLogger.error("[ImageStorage] Failed to update statistics: \(error)")
        }
    }

    func getStatistics() -> StorageStatistics {
        return statistics
    }

    // MARK: - Cleanup

    /// Clean up orphaned files
    func cleanup() async throws {
        // This would remove files not referenced in database
        AppLogger.log("[ImageStorage] Cleanup started")

        // Get all files
        let files = try FileManager.default.contentsOfDirectory(at: storageBasePath, includingPropertiesForKeys: nil)

        // Check each file against database
        // Delete if not found in database
        // (Implementation would depend on database structure)

        AppLogger.log("[ImageStorage] Cleanup complete")
    }

    /// Get storage size
    func getStorageSize() async throws -> Int64 {
        var totalSize: Int64 = 0

        let files = try FileManager.default.contentsOfDirectory(at: storageBasePath, includingPropertiesForKeys: [.fileSizeKey])

        for file in files {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            totalSize += attributes[.size] as? Int64 ?? 0
        }

        return totalSize
    }
}

// MARK: - Supporting Types

struct ImageMetadata {
    let id: String?
    let width: CGFloat?
    let height: CGFloat?
    let thumbnailPath: String?
    let ocrText: String?
    let ocrConfidence: Double?
    let knowledgeId: String?
}

enum ImageStorageError: LocalizedError {
    case saveFailed
    case imageNotFound
    case deleteFailed
    case invalidPath

    var errorDescription: String? {
        switch self {
        case .saveFailed:
            return "Failed to save image"
        case .imageNotFound:
            return "Image not found"
        case .deleteFailed:
            return "Failed to delete image"
        case .invalidPath:
            return "Invalid file path"
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
