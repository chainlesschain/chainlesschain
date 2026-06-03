/**
 * Screenshot Diff - Visual comparison for browser automation
 *
 * @module browser/diagnostics/screenshot-diff
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Diff status
 */
const DiffStatus = {
  PASSED: 'passed',
  FAILED: 'failed',
  WARNING: 'warning'
};

/**
 * Screenshot Diff Engine
 * Compares screenshots for visual regression testing
 */
class ScreenshotDiff {
  constructor(options = {}) {
    this.options = {
      threshold: options.threshold || 0.95,       // Match threshold (0-1)
      antialiasing: options.antialiasing !== false, // Ignore antialiasing
      ignoreColors: options.ignoreColors || false, // Compare grayscale
      diffColor: options.diffColor || { r: 255, g: 0, b: 255 }, // Diff highlight color
      ...options
    };

    this.sharp = null;
    this.pixelmatch = null;
  }

  /**
   * Initialize dependencies
   */
  async _ensureDependencies() {
    if (!this.sharp) {
      try {
        this.sharp = require('sharp');
      } catch (error) {
        logger.warn('[ScreenshotDiff] Sharp not available, using fallback');
      }
    }

    if (!this.pixelmatch) {
      try {
        this.pixelmatch = require('pixelmatch');
      } catch (error) {
        logger.warn('[ScreenshotDiff] Pixelmatch not available, using basic comparison');
      }
    }
  }

  /**
   * Compare two screenshots
   * @param {Buffer} baseline - Baseline screenshot
   * @param {Buffer} current - Current screenshot
   * @param {Object} options - Compare options
   * @returns {Promise<Object>} Comparison result
   */
  async compare(baseline, current, options = {}) {
    await this._ensureDependencies();

    const {
      threshold = this.options.threshold,
      ignoreRegions = [],  // Array of { x, y, width, height } to ignore
      generateDiff = true
    } = options;

    try {
      const startTime = Date.now();

      // Use pixelmatch if available
      if (this.pixelmatch && this.sharp) {
        return this._pixelmatchCompare(baseline, current, {
          threshold,
          ignoreRegions,
          generateDiff
        });
      }

      // Fallback to basic comparison
      return this._basicCompare(baseline, current, { threshold });

    } catch (error) {
      logger.error('[ScreenshotDiff] Comparison failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Compare using pixelmatch (high quality)
   * @private
   */
  async _pixelmatchCompare(baseline, current, options) {
    const { threshold, ignoreRegions, generateDiff } = options;

    // Load images
    const baselineImage = this.sharp(baseline);
    const currentImage = this.sharp(current);

    const baselineMeta = await baselineImage.metadata();
    const currentMeta = await currentImage.metadata();

    // Check dimensions
    if (baselineMeta.width !== currentMeta.width ||
        baselineMeta.height !== currentMeta.height) {
      return {
        status: DiffStatus.FAILED,
        matched: false,
        reason: 'dimension_mismatch',
        baseline: { width: baselineMeta.width, height: baselineMeta.height },
        current: { width: currentMeta.width, height: currentMeta.height },
        matchPercentage: 0
      };
    }

    const width = baselineMeta.width;
    const height = baselineMeta.height;

    // Get raw pixel data
    const baselineRaw = await baselineImage.raw().toBuffer();
    const currentRaw = await currentImage.raw().toBuffer();

    // Create diff buffer
    const diffBuffer = generateDiff ? Buffer.alloc(width * height * 4) : null;

    // Apply ignore regions by copying baseline pixels to current
    if (ignoreRegions.length > 0) {
      for (const region of ignoreRegions) {
        for (let y = region.y; y < region.y + region.height && y < height; y++) {
          for (let x = region.x; x < region.x + region.width && x < width; x++) {
            const idx = (y * width + x) * 4;
            currentRaw[idx] = baselineRaw[idx];
            currentRaw[idx + 1] = baselineRaw[idx + 1];
            currentRaw[idx + 2] = baselineRaw[idx + 2];
            currentRaw[idx + 3] = baselineRaw[idx + 3];
          }
        }
      }
    }

    // Run pixelmatch
    const diffPixels = this.pixelmatch(
      baselineRaw,
      currentRaw,
      diffBuffer,
      width,
      height,
      {
        threshold: 0.1,
        includeAA: !this.options.antialiasing,
        diffColor: this.options.diffColor
      }
    );

    const totalPixels = width * height;
    const matchedPixels = totalPixels - diffPixels;
    const matchPercentage = (matchedPixels / totalPixels) * 100;
    const passed = matchPercentage / 100 >= threshold;

    // Generate diff image
    let diffImage = null;
    if (generateDiff && diffBuffer) {
      diffImage = await this.sharp(diffBuffer, {
        raw: { width, height, channels: 4 }
      }).png().toBuffer();
    }

    const result = {
      status: passed ? DiffStatus.PASSED : DiffStatus.FAILED,
      matched: passed,
      matchPercentage: Math.round(matchPercentage * 100) / 100,
      diffPixels,
      totalPixels,
      threshold: threshold * 100,
      dimensions: { width, height },
      diffImage: diffImage ? diffImage.toString('base64') : null
    };

    logger.info('[ScreenshotDiff] Comparison completed', {
      matched: result.matched,
      matchPercentage: result.matchPercentage,
      diffPixels: result.diffPixels
    });

    return result;
  }

  /**
   * Basic comparison (fallback)
   * @private
   */
  async _basicCompare(baseline, current, options) {
    const { threshold } = options;

    // Simple buffer comparison
    const baselineHash = this._hashBuffer(baseline);
    const currentHash = this._hashBuffer(current);

    const matched = baselineHash === currentHash;

    return {
      status: matched ? DiffStatus.PASSED : DiffStatus.FAILED,
      matched,
      matchPercentage: matched ? 100 : 0,
      method: 'basic_hash',
      threshold: threshold * 100
    };
  }

  /**
   * Hash buffer for quick comparison
   * @private
   */
  _hashBuffer(buffer) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * Create baseline from screenshot
   * @param {Buffer} screenshot - Screenshot buffer
   * @param {Object} options - Options
   * @returns {Promise<Object>} Baseline data
   */
  async createBaseline(screenshot, options = {}) {
    await this._ensureDependencies();

    const { name, description, thumbnail = true } = options;

    let metadata = {};
    let thumbnailBuffer = null;

    if (this.sharp) {
      const image = this.sharp(screenshot);
      metadata = await image.metadata();

      if (thumbnail) {
        thumbnailBuffer = await image
          .resize(200, 150, { fit: 'inside' })
          .jpeg({ quality: 70 })
          .toBuffer();
      }
    }

    const hash = this._hashBuffer(screenshot);

    return {
      name: name || `Baseline ${Date.now()}`,
      description,
      screenshot,
      thumbnail: thumbnailBuffer,
      width: metadata.width,
      height: metadata.height,
      hash,
      createdAt: Date.now()
    };
  }

  /**
   * Compare with baseline from storage
   * @param {Buffer} current - Current screenshot
   * @param {Object} baseline - Baseline data
   * @param {Object} options - Compare options
   * @returns {Promise<Object>} Comparison result
   */
  async compareWithBaseline(current, baseline, options = {}) {
    if (!baseline.screenshot) {
      throw new Error('Baseline missing screenshot data');
    }

    // Quick hash comparison first
    const currentHash = this._hashBuffer(current);
    if (currentHash === baseline.hash) {
      return {
        status: DiffStatus.PASSED,
        matched: true,
        matchPercentage: 100,
        method: 'hash_match'
      };
    }

    // Full pixel comparison
    return this.compare(baseline.screenshot, current, options);
  }

  /**
   * Compare page with baseline
   * @param {Page} page - Playwright page
   * @param {Object} baseline - Baseline data
   * @param {Object} options - Compare options
   * @returns {Promise<Object>} Comparison result
   */
  async comparePage(page, baseline, options = {}) {
    const { element, fullPage = false } = options;

    let screenshot;

    if (element) {
      const locator = page.locator(element);
      screenshot = await locator.screenshot({ type: 'png' });
    } else {
      screenshot = await page.screenshot({ type: 'png', fullPage });
    }

    return this.compareWithBaseline(screenshot, baseline, options);
  }

  /**
   * Get comparison report
   * @param {Array} results - Array of comparison results
   * @returns {Object} Summary report
   */
  getReport(results) {
    const passed = results.filter(r => r.status === DiffStatus.PASSED).length;
    const failed = results.filter(r => r.status === DiffStatus.FAILED).length;
    const warnings = results.filter(r => r.status === DiffStatus.WARNING).length;

    const avgMatch = results.length > 0
      ? results.reduce((sum, r) => sum + (r.matchPercentage || 0), 0) / results.length
      : 0;

    return {
      total: results.length,
      passed,
      failed,
      warnings,
      passRate: results.length > 0 ? (passed / results.length * 100).toFixed(1) : 0,
      averageMatchPercentage: avgMatch.toFixed(2),
      status: failed > 0 ? DiffStatus.FAILED :
              warnings > 0 ? DiffStatus.WARNING : DiffStatus.PASSED
    };
  }
}

module.exports = {
  ScreenshotDiff,
  DiffStatus
};
