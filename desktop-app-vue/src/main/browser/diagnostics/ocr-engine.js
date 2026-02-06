/**
 * OCR Engine - Text recognition for browser automation
 *
 * @module browser/diagnostics/ocr-engine
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Supported languages
 */
const OCRLanguage = {
  ENGLISH: 'eng',
  CHINESE_SIMPLIFIED: 'chi_sim',
  CHINESE_TRADITIONAL: 'chi_tra',
  JAPANESE: 'jpn',
  KOREAN: 'kor',
  SPANISH: 'spa',
  FRENCH: 'fra',
  GERMAN: 'deu',
  PORTUGUESE: 'por',
  RUSSIAN: 'rus'
};

/**
 * OCR Engine using Tesseract.js
 */
class OCREngine {
  constructor(options = {}) {
    this.options = {
      lang: options.lang || OCRLanguage.ENGLISH,
      cacheResults: options.cacheResults !== false,
      ...options
    };

    this.tesseract = null;
    this.worker = null;
    this.cache = new Map();
    this.initialized = false;
  }

  /**
   * Initialize Tesseract worker
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Dynamic import of Tesseract.js
      const Tesseract = require('tesseract.js');
      this.tesseract = Tesseract;

      // Create worker
      this.worker = await Tesseract.createWorker(this.options.lang, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug('[OCREngine] Progress', { progress: Math.round(m.progress * 100) });
          }
        }
      });

      this.initialized = true;
      logger.info('[OCREngine] Initialized', { lang: this.options.lang });

    } catch (error) {
      logger.error('[OCREngine] Failed to initialize', { error: error.message });
      throw new Error(`OCR initialization failed: ${error.message}`);
    }
  }

  /**
   * Recognize text in image
   * @param {Buffer|string} image - Image buffer or base64 string
   * @param {Object} options - Recognition options
   * @returns {Promise<Object>} Recognition result
   */
  async recognize(image, options = {}) {
    await this.initialize();

    const {
      rectangle,   // { left, top, width, height } - region to scan
      lang,        // Override language
      psm = 3,     // Page segmentation mode
      oem = 1      // OCR Engine mode
    } = options;

    try {
      const startTime = Date.now();

      // Check cache
      const cacheKey = this._getCacheKey(image, options);
      if (this.options.cacheResults && this.cache.has(cacheKey)) {
        logger.debug('[OCREngine] Cache hit');
        return this.cache.get(cacheKey);
      }

      // Change language if needed
      if (lang && lang !== this.options.lang) {
        await this.worker.reinitialize(lang);
        this.options.lang = lang;
      }

      // Set parameters
      await this.worker.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_ocr_engine_mode: oem
      });

      // Recognize
      let result;
      if (rectangle) {
        result = await this.worker.recognize(image, { rectangle });
      } else {
        result = await this.worker.recognize(image);
      }

      const processingTime = Date.now() - startTime;

      const output = {
        text: result.data.text.trim(),
        confidence: result.data.confidence,
        words: result.data.words?.map(w => ({
          text: w.text,
          confidence: w.confidence,
          bbox: w.bbox
        })) || [],
        lines: result.data.lines?.map(l => ({
          text: l.text,
          confidence: l.confidence,
          bbox: l.bbox
        })) || [],
        blocks: result.data.blocks?.map(b => ({
          text: b.text,
          confidence: b.confidence,
          bbox: b.bbox,
          paragraphs: b.paragraphs?.length || 0
        })) || [],
        processingTime,
        language: this.options.lang
      };

      // Cache result
      if (this.options.cacheResults) {
        this.cache.set(cacheKey, output);
        // Limit cache size
        if (this.cache.size > 100) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
      }

      logger.info('[OCREngine] Recognition completed', {
        textLength: output.text.length,
        confidence: output.confidence,
        processingTime
      });

      return output;

    } catch (error) {
      logger.error('[OCREngine] Recognition failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Recognize text from browser page
   * @param {Page} page - Playwright page
   * @param {Object} options - Options
   * @returns {Promise<Object>} Recognition result
   */
  async recognizeFromPage(page, options = {}) {
    const { element, fullPage = false, ...ocrOptions } = options;

    try {
      let screenshotOptions = {
        type: 'png'
      };

      if (element) {
        // Screenshot specific element
        const locator = page.locator(element);
        const screenshot = await locator.screenshot();
        return this.recognize(screenshot, ocrOptions);
      }

      if (fullPage) {
        screenshotOptions.fullPage = true;
      }

      const screenshot = await page.screenshot(screenshotOptions);
      return this.recognize(screenshot, ocrOptions);

    } catch (error) {
      logger.error('[OCREngine] Page recognition failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Find text location on page
   * @param {Page} page - Playwright page
   * @param {string} searchText - Text to find
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Found location
   */
  async findTextOnPage(page, searchText, options = {}) {
    const { caseSensitive = false } = options;

    const result = await this.recognizeFromPage(page, options);

    const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
    const found = [];

    for (const word of result.words) {
      const wordText = caseSensitive ? word.text : word.text.toLowerCase();
      if (wordText.includes(searchLower)) {
        found.push({
          text: word.text,
          bbox: word.bbox,
          confidence: word.confidence,
          center: {
            x: word.bbox.x0 + (word.bbox.x1 - word.bbox.x0) / 2,
            y: word.bbox.y0 + (word.bbox.y1 - word.bbox.y0) / 2
          }
        });
      }
    }

    // Also check lines for multi-word matches
    for (const line of result.lines) {
      const lineText = caseSensitive ? line.text : line.text.toLowerCase();
      if (lineText.includes(searchLower) && searchText.includes(' ')) {
        found.push({
          text: line.text,
          bbox: line.bbox,
          confidence: line.confidence,
          center: {
            x: line.bbox.x0 + (line.bbox.x1 - line.bbox.x0) / 2,
            y: line.bbox.y0 + (line.bbox.y1 - line.bbox.y0) / 2
          },
          type: 'line'
        });
      }
    }

    return {
      searchText,
      found: found.length > 0,
      matches: found,
      totalMatches: found.length
    };
  }

  /**
   * Extract structured data from page
   * @param {Page} page - Playwright page
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Extracted data
   */
  async extractStructuredData(page, options = {}) {
    const { patterns = [] } = options;

    const result = await this.recognizeFromPage(page, options);

    const extracted = {
      text: result.text,
      patterns: {}
    };

    // Apply regex patterns
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex, pattern.flags || 'g');
      const matches = result.text.match(regex);
      extracted.patterns[pattern.name] = matches || [];
    }

    // Common patterns
    const commonPatterns = {
      emails: result.text.match(/[\w.-]+@[\w.-]+\.\w+/g) || [],
      phones: result.text.match(/[\d\s\-\+\(\)]{10,}/g) || [],
      urls: result.text.match(/https?:\/\/[^\s]+/g) || [],
      dates: result.text.match(/\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/g) || [],
      numbers: result.text.match(/\$?[\d,]+\.?\d*/g) || []
    };

    return {
      ...extracted,
      common: commonPatterns
    };
  }

  /**
   * Set language for recognition
   * @param {string} lang - Language code
   * @returns {Promise<void>}
   */
  async setLanguage(lang) {
    await this.initialize();
    await this.worker.reinitialize(lang);
    this.options.lang = lang;
    logger.info('[OCREngine] Language changed', { lang });
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('[OCREngine] Cache cleared');
  }

  /**
   * Terminate worker
   * @returns {Promise<void>}
   */
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      logger.info('[OCREngine] Worker terminated');
    }
  }

  /**
   * Generate cache key
   * @private
   */
  _getCacheKey(image, options) {
    const crypto = require('crypto');
    const imageHash = crypto.createHash('md5')
      .update(Buffer.isBuffer(image) ? image : Buffer.from(image, 'base64'))
      .digest('hex')
      .substring(0, 16);

    return `${imageHash}-${JSON.stringify(options)}`;
  }
}

module.exports = {
  OCREngine,
  OCRLanguage
};
