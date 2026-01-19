import UIKit
import Foundation

/// Image Cache Manager - Handles memory and disk caching of images
/// Provides functionality similar to SDWebImage but using native iOS frameworks
@MainActor
class ImageCacheManager: ObservableObject {
    static let shared = ImageCacheManager()

    // Memory cache
    private let memoryCache = NSCache<NSString, UIImage>()

    // Disk cache directory
    private let diskCacheDirectory: URL

    // Configuration
    private let maxMemoryCacheSize: Int = 100 * 1024 * 1024 // 100MB
    private let maxDiskCacheSize: Int64 = 500 * 1024 * 1024 // 500MB
    private let maxCacheAge: TimeInterval = 7 * 24 * 60 * 60 // 7 days

    // Statistics
    @Published var statistics = CacheStatistics()

    struct CacheStatistics {
        var memoryHits: Int = 0
        var diskHits: Int = 0
        var misses: Int = 0
        var memorySize: Int = 0
        var diskSize: Int64 = 0
        var totalRequests: Int = 0

        var hitRate: Double {
            guard totalRequests > 0 else { return 0 }
            return Double(memoryHits + diskHits) / Double(totalRequests) * 100
        }
    }

    private init() {
        // Set up disk cache directory
        let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        diskCacheDirectory = cacheDir.appendingPathComponent("ImageCache")

        // Configure memory cache
        memoryCache.totalCostLimit = maxMemoryCacheSize
        memoryCache.countLimit = 1000

        // Create disk cache directory
        try? FileManager.default.createDirectory(
            at: diskCacheDirectory,
            withIntermediateDirectories: true
        )

        // Set up memory warning observer
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.clearMemoryCache()
        }
    }

    // MARK: - Cache Operations

    /// Get image from cache
    func getImage(forKey key: String) async -> UIImage? {
        statistics.totalRequests += 1

        // Check memory cache first
        if let cachedImage = memoryCache.object(forKey: key as NSString) {
            statistics.memoryHits += 1
            AppLogger.log("[ImageCache] Memory cache hit: \(key)")
            return cachedImage
        }

        // Check disk cache
        if let diskImage = await loadFromDisk(key: key) {
            statistics.diskHits += 1

            // Store in memory cache for faster access next time
            let cost = estimateImageSize(diskImage)
            memoryCache.setObject(diskImage, forKey: key as NSString, cost: cost)

            AppLogger.log("[ImageCache] Disk cache hit: \(key)")
            return diskImage
        }

        statistics.misses += 1
        AppLogger.log("[ImageCache] Cache miss: \(key)")
        return nil
    }

    /// Store image in cache
    func storeImage(_ image: UIImage, forKey key: String) async {
        // Store in memory cache
        let cost = estimateImageSize(image)
        memoryCache.setObject(image, forKey: key as NSString, cost: cost)
        statistics.memorySize += cost

        // Store in disk cache
        await saveToDisk(image: image, key: key)

        AppLogger.log("[ImageCache] Image cached: \(key)")
    }

    /// Remove image from cache
    func removeImage(forKey key: String) async {
        // Remove from memory
        memoryCache.removeObject(forKey: key as NSString)

        // Remove from disk
        await removeFromDisk(key: key)

        AppLogger.log("[ImageCache] Image removed from cache: \(key)")
    }

    // MARK: - Memory Cache

    /// Clear memory cache
    func clearMemoryCache() {
        memoryCache.removeAllObjects()
        statistics.memorySize = 0
        statistics.memoryHits = 0
        AppLogger.log("[ImageCache] Memory cache cleared")
    }

    // MARK: - Disk Cache

    /// Load image from disk
    private func loadFromDisk(key: String) async -> UIImage? {
        let fileURL = diskCacheURL(forKey: key)

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }

        // Check if file is expired
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            if let modificationDate = attributes[.modificationDate] as? Date {
                let age = Date().timeIntervalSince(modificationDate)
                if age > maxCacheAge {
                    // File is too old, remove it
                    try? FileManager.default.removeItem(at: fileURL)
                    return nil
                }
            }
        } catch {
            return nil
        }

        return UIImage(contentsOfFile: fileURL.path)
    }

    /// Save image to disk
    private func saveToDisk(image: UIImage, key: String) async {
        let fileURL = diskCacheURL(forKey: key)

        guard let imageData = image.jpegData(compressionQuality: 0.9) else {
            return
        }

        do {
            try imageData.write(to: fileURL)

            // Update statistics
            let fileSize = Int64(imageData.count)
            statistics.diskSize += fileSize

            // Check disk cache size and clean up if needed
            await cleanupDiskCacheIfNeeded()

        } catch {
            AppLogger.error("[ImageCache] Failed to save to disk: \(error)")
        }
    }

    /// Remove image from disk
    private func removeFromDisk(key: String) async {
        let fileURL = diskCacheURL(forKey: key)

        do {
            // Get file size before deletion
            let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            let fileSize = attributes[.size] as? Int64 ?? 0

            // Remove file
            try FileManager.default.removeItem(at: fileURL)

            // Update statistics
            statistics.diskSize -= fileSize

        } catch {
            AppLogger.error("[ImageCache] Failed to remove from disk: \(error)")
        }
    }

    /// Get disk cache URL for key
    private func diskCacheURL(forKey key: String) -> URL {
        let filename = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        return diskCacheDirectory.appendingPathComponent(filename)
    }

    /// Clear disk cache
    func clearDiskCache() async {
        do {
            let files = try FileManager.default.contentsOfDirectory(at: diskCacheDirectory, includingPropertiesForKeys: nil)

            for file in files {
                try FileManager.default.removeItem(at: file)
            }

            statistics.diskSize = 0
            statistics.diskHits = 0
            AppLogger.log("[ImageCache] Disk cache cleared")

        } catch {
            AppLogger.error("[ImageCache] Failed to clear disk cache: \(error)")
        }
    }

    /// Cleanup disk cache if size exceeds limit
    private func cleanupDiskCacheIfNeeded() async {
        guard statistics.diskSize > maxDiskCacheSize else {
            return
        }

        AppLogger.log("[ImageCache] Disk cache size exceeded, cleaning up...")

        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: diskCacheDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
            )

            // Sort by modification date (oldest first)
            let sortedFiles = files.sorted { file1, file2 in
                let date1 = (try? file1.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date.distantPast
                let date2 = (try? file2.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date.distantPast
                return date1 < date2
            }

            // Remove oldest files until size is under limit
            var currentSize = statistics.diskSize
            for file in sortedFiles {
                guard currentSize > maxDiskCacheSize else {
                    break
                }

                let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
                let fileSize = attributes[.size] as? Int64 ?? 0

                try FileManager.default.removeItem(at: file)
                currentSize -= fileSize
            }

            statistics.diskSize = currentSize
            AppLogger.log("[ImageCache] Cleanup complete, new size: \(currentSize / 1024 / 1024)MB")

        } catch {
            AppLogger.error("[ImageCache] Cleanup failed: \(error)")
        }
    }

    /// Clean up expired files
    func cleanupExpiredFiles() async {
        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: diskCacheDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]
            )

            var removedSize: Int64 = 0
            var removedCount = 0

            for file in files {
                let resourceValues = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])

                if let modificationDate = resourceValues.contentModificationDate {
                    let age = Date().timeIntervalSince(modificationDate)

                    if age > maxCacheAge {
                        let fileSize = resourceValues.fileSize.map { Int64($0) } ?? 0

                        try FileManager.default.removeItem(at: file)
                        removedSize += fileSize
                        removedCount += 1
                    }
                }
            }

            statistics.diskSize -= removedSize
            AppLogger.log("[ImageCache] Removed \(removedCount) expired files, freed \(removedSize / 1024 / 1024)MB")

        } catch {
            AppLogger.error("[ImageCache] Failed to cleanup expired files: \(error)")
        }
    }

    // MARK: - Utilities

    /// Estimate image size in bytes
    private func estimateImageSize(_ image: UIImage) -> Int {
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        let bytesPerPixel = 4 // RGBA
        return Int(width * height * CGFloat(bytesPerPixel))
    }

    /// Generate cache key from URL
    static func cacheKey(from url: URL) -> String {
        return url.absoluteString
    }

    /// Generate cache key from string
    static func cacheKey(from string: String) -> String {
        return string
    }

    // MARK: - Statistics

    func getStatistics() -> CacheStatistics {
        return statistics
    }

    func resetStatistics() {
        statistics = CacheStatistics()
    }

    /// Calculate current disk cache size
    func calculateDiskCacheSize() async -> Int64 {
        do {
            let files = try FileManager.default.contentsOfDirectory(
                at: diskCacheDirectory,
                includingPropertiesForKeys: [.fileSizeKey]
            )

            var totalSize: Int64 = 0
            for file in files {
                let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
                totalSize += attributes[.size] as? Int64 ?? 0
            }

            statistics.diskSize = totalSize
            return totalSize

        } catch {
            AppLogger.error("[ImageCache] Failed to calculate disk cache size: \(error)")
            return 0
        }
    }

    // MARK: - High-level API

    /// Load image from URL with caching
    func loadImage(from url: URL) async -> UIImage? {
        let key = ImageCacheManager.cacheKey(from: url)

        // Check cache first
        if let cachedImage = await getImage(forKey: key) {
            return cachedImage
        }

        // Download image
        do {
            let (data, _) = try await URLSession.shared.data(from: url)

            guard let image = UIImage(data: data) else {
                return nil
            }

            // Store in cache
            await storeImage(image, forKey: key)

            return image

        } catch {
            AppLogger.error("[ImageCache] Failed to load image from URL: \(error)")
            return nil
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
