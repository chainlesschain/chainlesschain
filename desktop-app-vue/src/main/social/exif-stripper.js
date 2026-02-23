/**
 * EXIF Stripper
 *
 * Strips EXIF metadata from photos for privacy protection and
 * provides image processing utilities.
 *
 * Features:
 * - Strip all EXIF/GPS/privacy-sensitive metadata
 * - Read EXIF data before stripping
 * - Photo compression with quality control
 * - Thumbnail generation at configurable sizes
 *
 * Uses the `sharp` library for high-performance image processing.
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const fs = require("fs");

/**
 * Default thumbnail size in pixels
 */
const DEFAULT_THUMBNAIL_SIZE = 256;

/**
 * Default compression quality (1-100)
 */
const DEFAULT_QUALITY = 85;

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tiff",
  ".tif",
  ".bmp",
  ".heic",
  ".heif",
  ".avif",
]);

/**
 * EXIF Stripper class
 */
class ExifStripper {
  constructor() {
    this.sharp = null;
    this.initialized = false;
  }

  /**
   * Initialize EXIF stripper (lazy-load sharp)
   */
  async initialize() {
    logger.info("[ExifStripper] Initializing EXIF stripper...");

    try {
      this.sharp = require("sharp");
      this.initialized = true;
      logger.info("[ExifStripper] EXIF stripper initialized successfully");
    } catch (error) {
      logger.error(
        "[ExifStripper] Failed to load sharp library:",
        error.message,
      );
      logger.warn(
        "[ExifStripper] Image processing will be unavailable. Install sharp: npm install sharp",
      );
      this.initialized = false;
    }
  }

  /**
   * Ensure sharp is loaded
   */
  ensureSharp() {
    if (!this.sharp) {
      try {
        this.sharp = require("sharp");
      } catch (error) {
        throw new Error(
          "sharp library is not available. Install it with: npm install sharp",
        );
      }
    }
  }

  /**
   * Check if a file is a supported image format
   * @param {string} filePath - File path
   * @returns {boolean} Whether the format is supported
   */
  isSupportedFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_FORMATS.has(ext);
  }

  /**
   * Strip EXIF and all metadata from an image
   * Removes GPS, camera info, timestamps, and other privacy-sensitive data.
   *
   * @param {string} inputPath - Input image path
   * @param {string} outputPath - Output image path (can be same as input)
   * @returns {Object} Result with metadata about the operation
   */
  async stripExif(inputPath, outputPath) {
    try {
      this.ensureSharp();

      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      if (!this.isSupportedFormat(inputPath)) {
        throw new Error(
          `Unsupported image format: ${path.extname(inputPath)}`,
        );
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Get original file size
      const originalStats = fs.statSync(inputPath);
      const originalSize = originalStats.size;

      // Process image: strip all metadata using rotate() trick
      // sharp's rotate() without arguments auto-rotates based on EXIF orientation,
      // and combined with withMetadata: false removes all metadata
      const outputExt = path.extname(outputPath).toLowerCase();
      let pipeline = this.sharp(inputPath).rotate(); // auto-orient from EXIF, then strip

      // Output in appropriate format
      if (outputExt === ".png") {
        pipeline = pipeline.png();
      } else if (outputExt === ".webp") {
        pipeline = pipeline.webp({ quality: DEFAULT_QUALITY });
      } else if (outputExt === ".gif") {
        pipeline = pipeline.gif();
      } else {
        // Default to JPEG
        pipeline = pipeline.jpeg({ quality: DEFAULT_QUALITY });
      }

      // Write without metadata
      await pipeline.withMetadata(false).toFile(outputPath);

      const outputStats = fs.statSync(outputPath);

      const result = {
        success: true,
        inputPath,
        outputPath,
        originalSize,
        strippedSize: outputStats.size,
        sizeSaved: originalSize - outputStats.size,
      };

      logger.info(
        "[ExifStripper] EXIF stripped:",
        path.basename(inputPath),
        "saved",
        result.sizeSaved,
        "bytes",
      );

      return result;
    } catch (error) {
      logger.error("[ExifStripper] Failed to strip EXIF:", error);
      throw error;
    }
  }

  /**
   * Get EXIF metadata from an image
   * @param {string} filePath - Image file path
   * @returns {Object} EXIF metadata
   */
  async getExifData(filePath) {
    try {
      this.ensureSharp();

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const metadata = await this.sharp(filePath).metadata();

      // Extract relevant EXIF fields
      const exifData = {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
        // EXIF specific data
        exif: null,
        icc: null,
        iptc: null,
        xmp: null,
      };

      // Parse EXIF buffer if available
      if (metadata.exif) {
        try {
          exifData.exif = this.parseExifBuffer(metadata.exif);
        } catch (parseError) {
          logger.warn("[ExifStripper] Failed to parse EXIF data:", parseError.message);
          exifData.exif = { raw: true, size: metadata.exif.length };
        }
      }

      if (metadata.icc) {
        exifData.icc = { present: true, size: metadata.icc.length };
      }

      if (metadata.iptc) {
        exifData.iptc = { present: true, size: metadata.iptc.length };
      }

      if (metadata.xmp) {
        exifData.xmp = { present: true, size: metadata.xmp.length };
      }

      logger.info(
        "[ExifStripper] EXIF data read:",
        path.basename(filePath),
        metadata.width,
        "x",
        metadata.height,
      );

      return exifData;
    } catch (error) {
      logger.error("[ExifStripper] Failed to get EXIF data:", error);
      throw error;
    }
  }

  /**
   * Parse EXIF buffer into a readable object
   * @param {Buffer} exifBuffer - Raw EXIF buffer
   * @returns {Object} Parsed EXIF data
   */
  parseExifBuffer(exifBuffer) {
    // Basic EXIF parsing - extract common tags
    const result = {
      present: true,
      size: exifBuffer.length,
    };

    // Check for common privacy-sensitive EXIF tags
    const bufferStr = exifBuffer.toString("latin1");

    if (bufferStr.includes("GPS")) {
      result.hasGPS = true;
    }

    if (bufferStr.includes("DateTime")) {
      result.hasDateTime = true;
    }

    if (bufferStr.includes("Make") || bufferStr.includes("Model")) {
      result.hasCameraInfo = true;
    }

    if (bufferStr.includes("Software")) {
      result.hasSoftwareInfo = true;
    }

    return result;
  }

  /**
   * Compress a photo with quality control
   * @param {string} inputPath - Input image path
   * @param {string} outputPath - Output image path
   * @param {number} quality - Compression quality (1-100)
   * @returns {Object} Compression result
   */
  async compressPhoto(inputPath, outputPath, quality = DEFAULT_QUALITY) {
    try {
      this.ensureSharp();

      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      // Clamp quality to valid range
      const clampedQuality = Math.max(1, Math.min(100, Math.round(quality)));

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const originalStats = fs.statSync(inputPath);
      const originalSize = originalStats.size;

      const outputExt = path.extname(outputPath).toLowerCase();
      let pipeline = this.sharp(inputPath).rotate();

      if (outputExt === ".png") {
        // PNG uses compressionLevel instead of quality
        const compressionLevel = Math.round(9 - (clampedQuality / 100) * 9);
        pipeline = pipeline.png({ compressionLevel });
      } else if (outputExt === ".webp") {
        pipeline = pipeline.webp({ quality: clampedQuality });
      } else {
        pipeline = pipeline.jpeg({
          quality: clampedQuality,
          mozjpeg: true,
        });
      }

      await pipeline.withMetadata(false).toFile(outputPath);

      const outputStats = fs.statSync(outputPath);

      const result = {
        success: true,
        inputPath,
        outputPath,
        originalSize,
        compressedSize: outputStats.size,
        quality: clampedQuality,
        compressionRatio: (
          ((originalSize - outputStats.size) / originalSize) *
          100
        ).toFixed(1),
      };

      logger.info(
        "[ExifStripper] Photo compressed:",
        path.basename(inputPath),
        "quality:",
        clampedQuality,
        "ratio:",
        result.compressionRatio + "%",
      );

      return result;
    } catch (error) {
      logger.error("[ExifStripper] Failed to compress photo:", error);
      throw error;
    }
  }

  /**
   * Generate a thumbnail from an image
   * @param {string} inputPath - Input image path
   * @param {string} outputPath - Output thumbnail path
   * @param {number} size - Maximum dimension (width or height) in pixels
   * @returns {Object} Thumbnail generation result
   */
  async generateThumbnail(
    inputPath,
    outputPath,
    size = DEFAULT_THUMBNAIL_SIZE,
  ) {
    try {
      this.ensureSharp();

      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      const thumbnailSize = Math.max(16, Math.min(2048, Math.round(size)));

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Get original dimensions
      const metadata = await this.sharp(inputPath).metadata();

      const outputExt = path.extname(outputPath).toLowerCase();
      let pipeline = this.sharp(inputPath)
        .rotate()
        .resize(thumbnailSize, thumbnailSize, {
          fit: "inside",
          withoutEnlargement: true,
        });

      if (outputExt === ".png") {
        pipeline = pipeline.png({ compressionLevel: 6 });
      } else if (outputExt === ".webp") {
        pipeline = pipeline.webp({ quality: 80 });
      } else {
        pipeline = pipeline.jpeg({ quality: 80 });
      }

      await pipeline.withMetadata(false).toFile(outputPath);

      const outputStats = fs.statSync(outputPath);
      const thumbMetadata = await this.sharp(outputPath).metadata();

      const result = {
        success: true,
        inputPath,
        outputPath,
        originalWidth: metadata.width,
        originalHeight: metadata.height,
        thumbnailWidth: thumbMetadata.width,
        thumbnailHeight: thumbMetadata.height,
        thumbnailSize: outputStats.size,
        maxDimension: thumbnailSize,
      };

      logger.info(
        "[ExifStripper] Thumbnail generated:",
        path.basename(inputPath),
        thumbMetadata.width,
        "x",
        thumbMetadata.height,
      );

      return result;
    } catch (error) {
      logger.error("[ExifStripper] Failed to generate thumbnail:", error);
      throw error;
    }
  }

  /**
   * Process a photo for album upload: strip EXIF, compress, and generate thumbnail
   * @param {string} inputPath - Input image path
   * @param {string} outputDir - Output directory
   * @param {Object} options - Processing options
   * @param {number} options.quality - Compression quality
   * @param {number} options.thumbnailSize - Thumbnail size
   * @returns {Object} Processing result with paths
   */
  async processForAlbum(inputPath, outputDir, options = {}) {
    try {
      const quality = options.quality || DEFAULT_QUALITY;
      const thumbnailSize = options.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;

      const ext = path.extname(inputPath);
      const basename = path.basename(inputPath, ext);
      const timestamp = Date.now();
      const photoName = `${basename}_${timestamp}`;

      // Ensure output directories exist
      const photosDir = path.join(outputDir, "photos");
      const thumbsDir = path.join(outputDir, "thumbnails");

      if (!fs.existsSync(photosDir)) {
        fs.mkdirSync(photosDir, { recursive: true });
      }
      if (!fs.existsSync(thumbsDir)) {
        fs.mkdirSync(thumbsDir, { recursive: true });
      }

      const photoOutput = path.join(photosDir, `${photoName}.jpg`);
      const thumbOutput = path.join(thumbsDir, `${photoName}_thumb.jpg`);

      // Get original metadata before stripping
      const originalMetadata = await this.getExifData(inputPath);

      // Strip EXIF and compress
      const compressResult = await this.compressPhoto(
        inputPath,
        photoOutput,
        quality,
      );

      // Generate thumbnail
      const thumbResult = await this.generateThumbnail(
        inputPath,
        thumbOutput,
        thumbnailSize,
      );

      return {
        success: true,
        filePath: photoOutput,
        thumbnailPath: thumbOutput,
        width: originalMetadata.width,
        height: originalMetadata.height,
        fileSize: compressResult.compressedSize,
        mimeType: "image/jpeg",
        originalMetadata,
        compressionRatio: compressResult.compressionRatio,
      };
    } catch (error) {
      logger.error("[ExifStripper] Failed to process photo for album:", error);
      throw error;
    }
  }

  /**
   * Close EXIF stripper
   */
  async close() {
    logger.info("[ExifStripper] Closing EXIF stripper");
    this.sharp = null;
    this.initialized = false;
  }
}

module.exports = {
  ExifStripper,
  DEFAULT_THUMBNAIL_SIZE,
  DEFAULT_QUALITY,
  SUPPORTED_FORMATS,
};
