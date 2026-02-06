/**
 * Upload Action - File upload operations for browser automation
 *
 * @module browser/actions/upload-action
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Upload method types
 */
const UploadMethod = {
  INPUT: 'input',         // Standard file input
  DROP: 'drop',           // Drag and drop
  CHOOSER: 'chooser'      // File chooser dialog
};

/**
 * Upload Action Handler
 */
class UploadAction {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Execute file upload action
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async execute(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      files,
      method = UploadMethod.INPUT,
      inputRef,
      dropZoneRef,
      validateFiles = true
    } = options;

    // Validate files exist
    if (validateFiles) {
      await this._validateFiles(files);
    }

    try {
      switch (method) {
        case UploadMethod.INPUT:
          return this._uploadViaInput(page, targetId, files, inputRef);

        case UploadMethod.DROP:
          return this._uploadViaDrop(page, targetId, files, dropZoneRef);

        case UploadMethod.CHOOSER:
          return this._uploadViaChooser(page, files, options.triggerRef);

        default:
          throw new Error(`Unknown upload method: ${method}`);
      }

    } catch (error) {
      logger.error('[UploadAction] Upload failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate files exist
   */
  async _validateFiles(files) {
    if (!files || files.length === 0) {
      throw new Error('No files specified for upload');
    }

    const normalizedFiles = Array.isArray(files) ? files : [files];

    for (const file of normalizedFiles) {
      try {
        await fs.access(file);
      } catch {
        throw new Error(`File not found: ${file}`);
      }
    }

    return normalizedFiles;
  }

  /**
   * Upload via file input element
   */
  async _uploadViaInput(page, targetId, files, inputRef) {
    const normalizedFiles = Array.isArray(files) ? files : [files];

    // Find input element
    let locator;

    if (inputRef) {
      const { ElementLocator } = require('../element-locator');
      const element = this.browserEngine.findElement(targetId, inputRef);

      if (!element) {
        throw new Error(`Input element ${inputRef} not found`);
      }

      locator = await ElementLocator.locate(page, element);
    } else {
      // Try to find file input automatically
      locator = page.locator('input[type="file"]').first();
    }

    // Set files
    await locator.setInputFiles(normalizedFiles);

    return {
      success: true,
      method: UploadMethod.INPUT,
      files: normalizedFiles.map(f => path.basename(f)),
      count: normalizedFiles.length
    };
  }

  /**
   * Upload via drag and drop
   */
  async _uploadViaDrop(page, targetId, files, dropZoneRef) {
    const normalizedFiles = Array.isArray(files) ? files : [files];

    // Get drop zone element
    let dropZone;

    if (dropZoneRef) {
      const { ElementLocator } = require('../element-locator');
      const element = this.browserEngine.findElement(targetId, dropZoneRef);

      if (!element) {
        throw new Error(`Drop zone ${dropZoneRef} not found`);
      }

      dropZone = await ElementLocator.locate(page, element);
    } else {
      // Try to find common drop zone patterns
      dropZone = page.locator('[data-dropzone], .dropzone, .upload-area, .drop-area').first();
    }

    // Read file data
    const fileData = await Promise.all(
      normalizedFiles.map(async (filePath) => {
        const buffer = await fs.readFile(filePath);
        const name = path.basename(filePath);
        const type = this._getMimeType(name);

        return { name, type, buffer };
      })
    );

    // Create DataTransfer and drop
    await dropZone.evaluate(async (el, filesData) => {
      const dt = new DataTransfer();

      for (const { name, type, buffer } of filesData) {
        const file = new File([new Uint8Array(buffer)], name, { type });
        dt.items.add(file);
      }

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt
      });

      el.dispatchEvent(dropEvent);
    }, fileData.map(f => ({
      name: f.name,
      type: f.type,
      buffer: Array.from(f.buffer)
    })));

    return {
      success: true,
      method: UploadMethod.DROP,
      files: normalizedFiles.map(f => path.basename(f)),
      count: normalizedFiles.length
    };
  }

  /**
   * Upload via file chooser dialog
   */
  async _uploadViaChooser(page, files, triggerRef) {
    const normalizedFiles = Array.isArray(files) ? files : [files];

    // Set up file chooser listener
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });

    // Trigger file chooser (e.g., click upload button)
    if (triggerRef) {
      const { ElementLocator } = require('../element-locator');
      const element = this.browserEngine.findElement(page._targetId, triggerRef);

      if (element) {
        const locator = await ElementLocator.locate(page, element);
        await locator.click();
      }
    }

    // Wait for and handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(normalizedFiles);

    return {
      success: true,
      method: UploadMethod.CHOOSER,
      files: normalizedFiles.map(f => path.basename(f)),
      count: normalizedFiles.length
    };
  }

  /**
   * Get MIME type from file extension
   */
  _getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Wait for upload to complete
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Completion result
   */
  async waitForUploadComplete(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      successSelector,
      progressSelector,
      timeout = 60000,
      pollInterval = 500
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for success indicator
      if (successSelector) {
        const success = await page.locator(successSelector).count() > 0;
        if (success) {
          return { success: true, completed: true };
        }
      }

      // Check progress if available
      if (progressSelector) {
        const progress = await page.locator(progressSelector).textContent().catch(() => null);
        if (progress) {
          logger.debug('[UploadAction] Upload progress', { progress });
        }
      }

      await page.waitForTimeout(pollInterval);
    }

    throw new Error('Upload did not complete within timeout');
  }

  /**
   * Get file info for upload preview
   * @param {Array<string>} files - File paths
   * @returns {Promise<Array>} File info
   */
  async getFileInfo(files) {
    const normalizedFiles = Array.isArray(files) ? files : [files];

    return Promise.all(
      normalizedFiles.map(async (filePath) => {
        const stats = await fs.stat(filePath);
        const name = path.basename(filePath);

        return {
          name,
          path: filePath,
          size: stats.size,
          sizeFormatted: this._formatFileSize(stats.size),
          type: this._getMimeType(name),
          lastModified: stats.mtime
        };
      })
    );
  }

  /**
   * Format file size for display
   */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = {
  UploadAction,
  UploadMethod
};
