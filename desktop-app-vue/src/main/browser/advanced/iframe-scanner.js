/**
 * iframe Scanner - Scan and interact with iframe content
 *
 * @module browser/advanced/iframe-scanner
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * iframe Scanner
 * Handles same-origin and cross-origin iframes
 */
class IframeScanner {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Scan page including iframe content
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Scan options
   * @returns {Promise<Object>} Scan result
   */
  async scan(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      maxDepth = 3,
      includeCrossOrigin = false,
      scanContent = true
    } = options;

    try {
      // First, get iframe metadata from main page
      const iframeInfo = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));

        return iframes.map((iframe, index) => {
          const rect = iframe.getBoundingClientRect();
          let isCrossOrigin = false;

          try {
            // Try to access iframe content
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            isCrossOrigin = !doc;
          } catch (e) {
            isCrossOrigin = true;
          }

          return {
            index,
            id: iframe.id || null,
            name: iframe.name || null,
            src: iframe.src || null,
            srcdoc: !!iframe.srcdoc,
            isCrossOrigin,
            position: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            attributes: {
              sandbox: iframe.getAttribute('sandbox'),
              allow: iframe.getAttribute('allow'),
              loading: iframe.getAttribute('loading')
            },
            visible: rect.width > 0 && rect.height > 0
          };
        });
      });

      // Scan iframe content for same-origin iframes
      const iframeContents = [];

      if (scanContent) {
        for (const iframe of iframeInfo.filter(f => !f.isCrossOrigin && f.visible)) {
          try {
            const frame = page.frameLocator(`iframe[src="${iframe.src}"]`);
            const content = await this._scanFrame(frame, 0, maxDepth);
            iframeContents.push({
              iframeIndex: iframe.index,
              src: iframe.src,
              elements: content.elements,
              elementCount: content.elements.length
            });
          } catch (e) {
            logger.warn('[IframeScanner] Failed to scan iframe', {
              src: iframe.src,
              error: e.message
            });
          }
        }
      }

      // Handle cross-origin iframes if requested
      const crossOriginFrames = iframeInfo.filter(f => f.isCrossOrigin);
      if (includeCrossOrigin && crossOriginFrames.length > 0) {
        logger.info('[IframeScanner] Cross-origin iframes detected', {
          count: crossOriginFrames.length
        });
      }

      const result = {
        totalIframes: iframeInfo.length,
        sameOriginCount: iframeInfo.filter(f => !f.isCrossOrigin).length,
        crossOriginCount: crossOriginFrames.length,
        iframes: iframeInfo,
        scannedContent: iframeContents,
        totalElementsInIframes: iframeContents.reduce((sum, c) => sum + c.elementCount, 0)
      };

      logger.info('[IframeScanner] Scan completed', {
        targetId,
        totalIframes: result.totalIframes,
        scannedIframes: iframeContents.length
      });

      return result;

    } catch (error) {
      logger.error('[IframeScanner] Scan failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Scan content within a frame
   */
  async _scanFrame(frameLocator, depth, maxDepth) {
    if (depth >= maxDepth) {
      return { elements: [], truncated: true };
    }

    try {
      const elements = await frameLocator.locator('body').evaluate((body) => {
        const results = [];
        let refCounter = 0;

        function scan(element) {
          const rect = element.getBoundingClientRect();
          const styles = window.getComputedStyle(element);

          if (rect.width === 0 || rect.height === 0 ||
              styles.visibility === 'hidden' || styles.display === 'none') {
            return;
          }

          const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(
            element.tagName.toLowerCase()
          ) || element.getAttribute('onclick') || element.getAttribute('role') === 'button';

          if (isInteractive) {
            results.push({
              ref: `iframe-e${refCounter++}`,
              tag: element.tagName.toLowerCase(),
              label: element.getAttribute('aria-label') ||
                     element.textContent?.trim().substring(0, 50) || '',
              position: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }

          for (const child of element.children) {
            scan(child);
          }
        }

        scan(body);
        return results;
      });

      return { elements, truncated: false };

    } catch (error) {
      return { elements: [], error: error.message };
    }
  }

  /**
   * Get frame locator by various identifiers
   * @param {string} targetId - Browser tab ID
   * @param {Object} identifier - Frame identifier
   * @returns {FrameLocator}
   */
  getFrameLocator(targetId, identifier) {
    const page = this.browserEngine.getPage(targetId);
    const { index, name, src, selector } = identifier;

    if (selector) {
      return page.frameLocator(selector);
    }

    if (name) {
      return page.frameLocator(`iframe[name="${name}"]`);
    }

    if (src) {
      return page.frameLocator(`iframe[src="${src}"]`);
    }

    if (typeof index === 'number') {
      return page.frameLocator(`iframe:nth-of-type(${index + 1})`);
    }

    throw new Error('No valid iframe identifier provided');
  }

  /**
   * Execute action within iframe
   * @param {string} targetId - Browser tab ID
   * @param {Object} iframeId - iframe identifier
   * @param {string} action - Action type
   * @param {string} selector - Element selector within iframe
   * @param {Object} options - Action options
   * @returns {Promise<Object>} Action result
   */
  async actInFrame(targetId, iframeId, action, selector, options = {}) {
    const frame = this.getFrameLocator(targetId, iframeId);
    const locator = frame.locator(selector);

    switch (action) {
      case 'click':
        await locator.click(options);
        return { success: true, action: 'click', selector };

      case 'type':
        await locator.fill(options.text);
        return { success: true, action: 'type', selector, text: options.text };

      case 'select':
        await locator.selectOption(options.value);
        return { success: true, action: 'select', selector, value: options.value };

      case 'hover':
        await locator.hover();
        return { success: true, action: 'hover', selector };

      case 'getText': {
        const text = await locator.textContent();
        return { success: true, action: 'getText', selector, text };
      }

      case 'getAttribute': {
        const value = await locator.getAttribute(options.attribute);
        return { success: true, action: 'getAttribute', selector, value };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Wait for iframe to load
   * @param {string} targetId - Browser tab ID
   * @param {Object} iframeId - iframe identifier
   * @param {Object} options - Wait options
   * @returns {Promise<boolean>}
   */
  async waitForFrame(targetId, iframeId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const { timeout = 30000, state = 'attached' } = options;

    let selector;
    if (iframeId.selector) {
      selector = iframeId.selector;
    } else if (iframeId.name) {
      selector = `iframe[name="${iframeId.name}"]`;
    } else if (iframeId.src) {
      selector = `iframe[src="${iframeId.src}"]`;
    }

    if (!selector) {
      throw new Error('Cannot determine iframe selector');
    }

    await page.waitForSelector(selector, { state, timeout });

    // Additional wait for frame content
    const frame = this.getFrameLocator(targetId, iframeId);
    await frame.locator('body').waitFor({ state: 'attached', timeout });

    return true;
  }

  /**
   * Get nested iframes (iframes within iframes)
   * @param {string} targetId - Browser tab ID
   * @param {number} maxDepth - Maximum nesting depth
   * @returns {Promise<Object>} Nested iframe structure
   */
  async getNestedIframes(targetId, maxDepth = 3) {
    const page = this.browserEngine.getPage(targetId);

    async function scanFrameLevel(frameLocator, depth, path = []) {
      if (depth >= maxDepth) {
        return { truncated: true, path };
      }

      try {
        const iframeCount = await frameLocator.locator('iframe').count();
        const children = [];

        for (let i = 0; i < iframeCount; i++) {
          const childFrame = frameLocator.frameLocator(`iframe:nth-of-type(${i + 1})`);
          const childPath = [...path, i];

          const src = await frameLocator.locator(`iframe:nth-of-type(${i + 1})`)
            .getAttribute('src').catch(() => null);

          const nested = await scanFrameLevel(childFrame, depth + 1, childPath);

          children.push({
            index: i,
            src,
            path: childPath,
            children: nested.children || [],
            truncated: nested.truncated
          });
        }

        return { children, truncated: false };

      } catch (error) {
        return { error: error.message, path };
      }
    }

    const result = await scanFrameLevel(page, 0);

    return {
      rootIframes: await page.locator('iframe').count(),
      nested: result.children || [],
      maxDepthReached: result.truncated
    };
  }
}

module.exports = { IframeScanner };
