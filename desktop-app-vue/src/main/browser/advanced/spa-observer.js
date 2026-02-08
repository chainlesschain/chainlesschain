/**
 * SPA Observer - Monitor Single Page Application DOM changes
 *
 * @module browser/advanced/spa-observer
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger");

/**
 * SPA DOM change types
 */
const ChangeType = {
  ROUTE: "route", // URL/route change
  CONTENT: "content", // Content area update
  MODAL: "modal", // Modal/dialog appeared
  LOADING: "loading", // Loading state change
  ELEMENT_ADDED: "added", // New element added
  ELEMENT_REMOVED: "removed", // Element removed
};

/**
 * SPA Observer
 * Monitors DOM changes in Single Page Applications
 */
class SPAObserver extends EventEmitter {
  constructor(browserEngine) {
    super();
    this.browserEngine = browserEngine;
    this.observers = new Map(); // targetId => observer info
  }

  /**
   * Start observing DOM changes
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Observer options
   * @returns {Promise<Object>} Observer info
   */
  async startObserving(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      rootSelector = "body",
      subtree = true,
      childList = true,
      attributes = false,
      characterData = false,
      watchSelectors = [], // Specific selectors to watch
      debounceMs = 100,
    } = options;

    // Stop existing observer if any
    if (this.observers.has(targetId)) {
      await this.stopObserving(targetId);
    }

    try {
      // Set up observer in page context
      await page.evaluate(
        ({ rootSel, config, watchSels, debounce }) => {
          // Store changes for batched reporting
          window.__spaChanges = [];
          window.__lastUrl = window.location.href;

          // Debounce function
          let debounceTimer = null;
          function reportChanges() {
            if (debounceTimer) {
              clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
              if (window.__spaChanges.length > 0) {
                window.dispatchEvent(
                  new CustomEvent("spa:changes", {
                    detail: window.__spaChanges.splice(0),
                  }),
                );
              }
            }, debounce);
          }

          // URL change detector
          function checkUrlChange() {
            if (window.location.href !== window.__lastUrl) {
              window.__spaChanges.push({
                type: "route",
                from: window.__lastUrl,
                to: window.location.href,
                timestamp: Date.now(),
              });
              window.__lastUrl = window.location.href;
              reportChanges();
            }
          }

          // Set up URL watchers
          const originalPushState = history.pushState;
          const originalReplaceState = history.replaceState;

          history.pushState = function (...args) {
            originalPushState.apply(this, args);
            checkUrlChange();
          };

          history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            checkUrlChange();
          };

          window.addEventListener("popstate", checkUrlChange);
          window.addEventListener("hashchange", checkUrlChange);

          // Loading state detector
          function isLoading(el) {
            return (
              el.classList.contains("loading") ||
              el.classList.contains("spinner") ||
              el.getAttribute("aria-busy") === "true" ||
              el.querySelector('.loading, .spinner, [aria-busy="true"]') !==
                null
            );
          }

          // MutationObserver callback
          function handleMutations(mutations) {
            for (const mutation of mutations) {
              // Added nodes
              for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                  continue;
                }

                // Check for modal/dialog
                if (
                  node.matches?.(
                    '[role="dialog"], [role="alertdialog"], .modal, .dialog',
                  )
                ) {
                  window.__spaChanges.push({
                    type: "modal",
                    action: "opened",
                    element: {
                      tag: node.tagName.toLowerCase(),
                      id: node.id,
                      className: node.className,
                    },
                    timestamp: Date.now(),
                  });
                }

                // Check watched selectors
                for (const sel of watchSels) {
                  if (node.matches?.(sel) || node.querySelector?.(sel)) {
                    window.__spaChanges.push({
                      type: "added",
                      selector: sel,
                      timestamp: Date.now(),
                    });
                  }
                }

                // Check loading state
                if (isLoading(node)) {
                  window.__spaChanges.push({
                    type: "loading",
                    state: "started",
                    timestamp: Date.now(),
                  });
                }
              }

              // Removed nodes
              for (const node of mutation.removedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) {
                  continue;
                }

                // Check for modal/dialog closed
                if (
                  node.matches?.(
                    '[role="dialog"], [role="alertdialog"], .modal, .dialog',
                  )
                ) {
                  window.__spaChanges.push({
                    type: "modal",
                    action: "closed",
                    timestamp: Date.now(),
                  });
                }

                // Check loading state ended
                if (isLoading(node)) {
                  window.__spaChanges.push({
                    type: "loading",
                    state: "ended",
                    timestamp: Date.now(),
                  });
                }

                // Check watched selectors
                for (const sel of watchSels) {
                  if (node.matches?.(sel)) {
                    window.__spaChanges.push({
                      type: "removed",
                      selector: sel,
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            }

            if (window.__spaChanges.length > 0) {
              reportChanges();
            }
          }

          // Create and start observer
          const root = document.querySelector(rootSel) || document.body;
          window.__spaObserver = new MutationObserver(handleMutations);
          window.__spaObserver.observe(root, config);

          return true;
        },
        {
          rootSel: rootSelector,
          config: { subtree, childList, attributes, characterData },
          watchSels: watchSelectors,
          debounce: debounceMs,
        },
      );

      // Set up event listener for changes
      await page.exposeFunction("__reportSPAChanges", (changes) => {
        this.emit("changes", { targetId, changes });
      });

      await page.evaluate(() => {
        window.addEventListener("spa:changes", (e) => {
          window.__reportSPAChanges(e.detail);
        });
      });

      this.observers.set(targetId, {
        started: Date.now(),
        options,
      });

      logger.info("[SPAObserver] Started observing", { targetId });

      return {
        success: true,
        targetId,
        observing: true,
      };
    } catch (error) {
      logger.error("[SPAObserver] Failed to start observing", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Stop observing DOM changes
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<Object>}
   */
  async stopObserving(targetId) {
    const page = this.browserEngine.getPage(targetId);

    try {
      await page.evaluate(() => {
        if (window.__spaObserver) {
          window.__spaObserver.disconnect();
          window.__spaObserver = null;
        }
        window.__spaChanges = [];
      });

      this.observers.delete(targetId);

      logger.info("[SPAObserver] Stopped observing", { targetId });

      return { success: true, targetId };
    } catch (error) {
      logger.error("[SPAObserver] Failed to stop observing", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Wait for DOM to stabilize (no changes for duration)
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Stability result
   */
  async waitForStableDOM(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      stableFor = 500, // No changes for this duration
      timeout = 30000, // Max wait time
      pollInterval = 100, // Check interval
    } = options;

    const startTime = Date.now();

    return page.evaluate(
      ({ stableFor, timeout, pollInterval }) => {
        return new Promise((resolve, reject) => {
          let lastChangeTime = Date.now();
          let resolved = false;

          const observer = new MutationObserver(() => {
            lastChangeTime = Date.now();
          });

          observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
          });

          const checkStability = () => {
            if (resolved) {
              return;
            }

            const elapsed = Date.now() - lastChangeTime;
            const totalElapsed = Date.now() - (Date.now() - timeout);

            if (elapsed >= stableFor) {
              resolved = true;
              observer.disconnect();
              resolve({
                stable: true,
                waitedMs: Date.now() - lastChangeTime + elapsed,
              });
            } else if (Date.now() - (Date.now() - timeout) >= timeout) {
              resolved = true;
              observer.disconnect();
              resolve({
                stable: false,
                timeout: true,
                waitedMs: timeout,
              });
            } else {
              setTimeout(checkStability, pollInterval);
            }
          };

          setTimeout(checkStability, pollInterval);
        });
      },
      { stableFor, timeout, pollInterval },
    );
  }

  /**
   * Wait for specific element to appear
   * @param {string} targetId - Browser tab ID
   * @param {string} selector - Element selector
   * @param {Object} options - Wait options
   * @returns {Promise<Object>}
   */
  async waitForElement(targetId, selector, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const { timeout = 30000, visible = true, hidden = false } = options;

    try {
      if (hidden) {
        await page.waitForSelector(selector, { state: "hidden", timeout });
      } else if (visible) {
        await page.waitForSelector(selector, { state: "visible", timeout });
      } else {
        await page.waitForSelector(selector, { state: "attached", timeout });
      }

      return { found: true, selector };
    } catch (error) {
      if (error.message.includes("Timeout")) {
        return { found: false, selector, timeout: true };
      }
      throw error;
    }
  }

  /**
   * Wait for navigation (route change)
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Wait options
   * @returns {Promise<Object>}
   */
  async waitForNavigation(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const { timeout = 30000, urlPattern } = options;

    const startUrl = page.url();

    try {
      await page.waitForFunction(
        ({ startUrl, pattern }) => {
          const currentUrl = window.location.href;
          if (currentUrl === startUrl) {
            return false;
          }
          if (pattern) {
            const regex = new RegExp(pattern);
            return regex.test(currentUrl);
          }
          return true;
        },
        { startUrl, pattern: urlPattern },
        { timeout },
      );

      return {
        navigated: true,
        from: startUrl,
        to: page.url(),
      };
    } catch (error) {
      return {
        navigated: false,
        timeout: true,
        currentUrl: page.url(),
      };
    }
  }

  /**
   * Wait for loading state to complete
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Wait options
   * @returns {Promise<Object>}
   */
  async waitForLoading(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      timeout = 30000,
      loadingSelector = '.loading, .spinner, [aria-busy="true"]',
    } = options;

    try {
      // Wait for loading indicator to disappear
      await page.waitForSelector(loadingSelector, { state: "hidden", timeout });

      return { loaded: true };
    } catch (error) {
      // If selector never appeared, consider it loaded
      const hasLoading = (await page.locator(loadingSelector).count()) > 0;
      return {
        loaded: !hasLoading,
        timeout: hasLoading,
      };
    }
  }

  /**
   * Get current observation status
   * @param {string} targetId - Browser tab ID
   * @returns {Object|null}
   */
  getStatus(targetId) {
    return this.observers.get(targetId) || null;
  }

  /**
   * Check if currently observing
   * @param {string} targetId - Browser tab ID
   * @returns {boolean}
   */
  isObserving(targetId) {
    return this.observers.has(targetId);
  }
}

module.exports = {
  SPAObserver,
  ChangeType,
};
