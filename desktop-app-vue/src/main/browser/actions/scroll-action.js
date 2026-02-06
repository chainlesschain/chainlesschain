/**
 * Scroll Action - Advanced scroll operations for browser automation
 *
 * @module browser/actions/scroll-action
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Scroll direction types
 */
const ScrollDirection = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  TOP: 'top',
  BOTTOM: 'bottom'
};

/**
 * Scroll behavior types
 */
const ScrollBehavior = {
  SMOOTH: 'smooth',
  AUTO: 'auto',
  INSTANT: 'instant'
};

/**
 * Scroll Action Handler
 */
class ScrollAction {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Execute scroll action
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Scroll options
   * @returns {Promise<Object>} Scroll result
   */
  async execute(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      direction = ScrollDirection.DOWN,
      distance = 300,
      element,
      behavior = ScrollBehavior.SMOOTH,
      percentage,
      toPosition
    } = options;

    try {
      // Scroll element into view
      if (element) {
        return this._scrollToElement(page, targetId, element, options);
      }

      // Scroll to specific position
      if (toPosition) {
        return this._scrollToPosition(page, toPosition, behavior);
      }

      // Scroll by percentage
      if (percentage !== undefined) {
        return this._scrollByPercentage(page, percentage, behavior);
      }

      // Scroll by direction and distance
      return this._scrollByDirection(page, direction, distance, behavior);

    } catch (error) {
      logger.error('[ScrollAction] Scroll failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Scroll element into view
   */
  async _scrollToElement(page, targetId, elementRef, options) {
    const { ElementLocator } = require('../element-locator');
    const element = this.browserEngine.findElement(targetId, elementRef);

    if (!element) {
      throw new Error(`Element ${elementRef} not found`);
    }

    const locator = await ElementLocator.locate(page, element);
    await locator.scrollIntoViewIfNeeded();

    // Optional: center element
    if (options.center) {
      await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, element.selector);
    }

    return {
      success: true,
      scrolledTo: elementRef,
      position: await this._getScrollPosition(page)
    };
  }

  /**
   * Scroll to specific position
   */
  async _scrollToPosition(page, position, behavior) {
    const { x = 0, y = 0 } = position;

    await page.evaluate(({ x, y, behavior }) => {
      window.scrollTo({ left: x, top: y, behavior });
    }, { x, y, behavior });

    return {
      success: true,
      scrolledTo: { x, y },
      position: await this._getScrollPosition(page)
    };
  }

  /**
   * Scroll by percentage of page
   */
  async _scrollByPercentage(page, percentage, behavior) {
    const scrollTarget = await page.evaluate((pct) => {
      const maxScroll = document.body.scrollHeight - window.innerHeight;
      return Math.round(maxScroll * (pct / 100));
    }, percentage);

    await page.evaluate(({ y, behavior }) => {
      window.scrollTo({ top: y, behavior });
    }, { y: scrollTarget, behavior });

    return {
      success: true,
      scrolledToPercentage: percentage,
      position: await this._getScrollPosition(page)
    };
  }

  /**
   * Scroll by direction and distance
   */
  async _scrollByDirection(page, direction, distance, behavior) {
    let x = 0, y = 0;

    switch (direction) {
      case ScrollDirection.DOWN:
        y = distance;
        break;
      case ScrollDirection.UP:
        y = -distance;
        break;
      case ScrollDirection.RIGHT:
        x = distance;
        break;
      case ScrollDirection.LEFT:
        x = -distance;
        break;
      case ScrollDirection.BOTTOM:
        await page.evaluate(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        });
        return {
          success: true,
          scrolledTo: 'bottom',
          position: await this._getScrollPosition(page)
        };
      case ScrollDirection.TOP:
        await page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        return {
          success: true,
          scrolledTo: 'top',
          position: await this._getScrollPosition(page)
        };
    }

    await page.evaluate(({ x, y, behavior }) => {
      window.scrollBy({ left: x, top: y, behavior });
    }, { x, y, behavior });

    return {
      success: true,
      scrolled: { x, y },
      direction,
      position: await this._getScrollPosition(page)
    };
  }

  /**
   * Get current scroll position
   */
  async _getScrollPosition(page) {
    return page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      maxX: document.body.scrollWidth - window.innerWidth,
      maxY: document.body.scrollHeight - window.innerHeight,
      percentageY: Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100)
    }));
  }

  /**
   * Infinite scroll helper - scroll and wait for content
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Scroll options
   * @returns {Promise<Object>} Scroll result
   */
  async infiniteScroll(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      maxScrolls = 10,
      scrollDelay = 1000,
      waitForSelector,
      stopWhenNoNewContent = true
    } = options;

    let scrollCount = 0;
    let previousHeight = 0;
    let newContentLoaded = true;

    while (scrollCount < maxScrolls && newContentLoaded) {
      previousHeight = await page.evaluate(() => document.body.scrollHeight);

      // Scroll to bottom
      await page.evaluate(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });

      // Wait for new content
      await page.waitForTimeout(scrollDelay);

      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: 5000 });
        } catch {
          // Selector not found, might be end of content
        }
      }

      // Check if new content loaded
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      newContentLoaded = !stopWhenNoNewContent || newHeight > previousHeight;

      scrollCount++;
    }

    return {
      success: true,
      scrollCount,
      reachedEnd: !newContentLoaded,
      position: await this._getScrollPosition(page)
    };
  }

  /**
   * Scroll within an element (container scroll)
   * @param {string} targetId - Browser tab ID
   * @param {string} containerRef - Container element reference
   * @param {Object} options - Scroll options
   * @returns {Promise<Object>} Scroll result
   */
  async scrollWithinElement(targetId, containerRef, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const { direction = 'down', distance = 200 } = options;

    const element = this.browserEngine.findElement(targetId, containerRef);
    if (!element) {
      throw new Error(`Container ${containerRef} not found`);
    }

    let x = 0, y = 0;
    switch (direction) {
      case 'down': y = distance; break;
      case 'up': y = -distance; break;
      case 'right': x = distance; break;
      case 'left': x = -distance; break;
    }

    await page.evaluate(({ selector, x, y }) => {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollBy({ left: x, top: y, behavior: 'smooth' });
      }
    }, { selector: element.selector, x, y });

    return {
      success: true,
      container: containerRef,
      scrolled: { x, y }
    };
  }
}

module.exports = {
  ScrollAction,
  ScrollDirection,
  ScrollBehavior
};
