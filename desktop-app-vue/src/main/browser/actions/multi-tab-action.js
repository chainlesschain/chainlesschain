/**
 * Multi-Tab Action - Multi-tab coordination for browser automation
 *
 * @module browser/actions/multi-tab-action
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require('../../utils/logger');

/**
 * Tab action types
 */
const TabAction = {
  SYNC: 'sync',           // Synchronize data between tabs
  PARALLEL: 'parallel',   // Run actions in parallel
  CASCADE: 'cascade',     // Run actions in sequence across tabs
  COMPARE: 'compare',     // Compare content between tabs
  BROADCAST: 'broadcast'  // Send message to all tabs
};

/**
 * Multi-Tab Action Handler
 */
class MultiTabAction {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Execute multi-tab action
   * @param {string} primaryTargetId - Primary tab ID
   * @param {Object} options - Action options
   * @returns {Promise<Object>} Action result
   */
  async execute(primaryTargetId, options = {}) {
    const {
      action = TabAction.SYNC,
      tabs = [],  // Additional tab IDs
      data,
      script,
      selector
    } = options;

    // Get all target tabs
    const allTabs = [primaryTargetId, ...tabs].filter(Boolean);

    try {
      switch (action) {
        case TabAction.SYNC:
          return this._syncTabs(allTabs, data);

        case TabAction.PARALLEL:
          return this._parallelAction(allTabs, script, options);

        case TabAction.CASCADE:
          return this._cascadeAction(allTabs, options.steps);

        case TabAction.COMPARE:
          return this._compareTabs(allTabs, selector);

        case TabAction.BROADCAST:
          return this._broadcastMessage(allTabs, data);

        default:
          throw new Error(`Unknown multi-tab action: ${action}`);
      }

    } catch (error) {
      logger.error('[MultiTabAction] Multi-tab action failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Synchronize data between tabs (e.g., copy localStorage)
   */
  async _syncTabs(tabs, syncOptions = {}) {
    if (tabs.length < 2) {
      throw new Error('Sync requires at least 2 tabs');
    }

    const sourceTab = tabs[0];
    const targetTabs = tabs.slice(1);
    const {
      syncType = 'localStorage',
      keys = null  // null means all keys
    } = syncOptions;

    // Get data from source
    const sourcePage = this.browserEngine.getPage(sourceTab);
    let data;

    switch (syncType) {
      case 'localStorage':
        data = await sourcePage.evaluate((filterKeys) => {
          const result = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!filterKeys || filterKeys.includes(key)) {
              result[key] = localStorage.getItem(key);
            }
          }
          return result;
        }, keys);
        break;

      case 'sessionStorage':
        data = await sourcePage.evaluate((filterKeys) => {
          const result = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!filterKeys || filterKeys.includes(key)) {
              result[key] = sessionStorage.getItem(key);
            }
          }
          return result;
        }, keys);
        break;

      case 'cookies':
        const context = sourcePage.context();
        data = await context.cookies();
        break;

      default:
        throw new Error(`Unknown sync type: ${syncType}`);
    }

    // Apply to target tabs
    const results = [];

    for (const targetId of targetTabs) {
      const targetPage = this.browserEngine.getPage(targetId);

      switch (syncType) {
        case 'localStorage':
          await targetPage.evaluate((items) => {
            for (const [key, value] of Object.entries(items)) {
              localStorage.setItem(key, value);
            }
          }, data);
          break;

        case 'sessionStorage':
          await targetPage.evaluate((items) => {
            for (const [key, value] of Object.entries(items)) {
              sessionStorage.setItem(key, value);
            }
          }, data);
          break;

        case 'cookies':
          const targetContext = targetPage.context();
          await targetContext.addCookies(data);
          break;
      }

      results.push({ tabId: targetId, synced: true });
    }

    return {
      success: true,
      action: TabAction.SYNC,
      syncType,
      source: sourceTab,
      targets: targetTabs,
      itemsCount: Object.keys(data).length,
      results
    };
  }

  /**
   * Run actions in parallel across tabs
   */
  async _parallelAction(tabs, script, options = {}) {
    const { timeout = 30000 } = options;

    const promises = tabs.map(async (tabId) => {
      const page = this.browserEngine.getPage(tabId);

      try {
        const result = await page.evaluate(script);
        return { tabId, success: true, result };
      } catch (error) {
        return { tabId, success: false, error: error.message };
      }
    });

    const results = await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Parallel action timeout')), timeout)
      )
    ]);

    return {
      success: true,
      action: TabAction.PARALLEL,
      tabs: tabs.length,
      results,
      successCount: results.filter(r => r.success).length
    };
  }

  /**
   * Run actions in sequence across tabs (cascade)
   */
  async _cascadeAction(tabs, steps) {
    if (!steps || steps.length === 0) {
      throw new Error('No steps provided for cascade action');
    }

    const results = [];
    let sharedData = {};

    for (let i = 0; i < tabs.length; i++) {
      const tabId = tabs[i];
      const page = this.browserEngine.getPage(tabId);

      // Get step for this tab (or use last step if fewer steps than tabs)
      const step = steps[Math.min(i, steps.length - 1)];

      try {
        // Execute step with shared data context
        const result = await page.evaluate(
          ({ stepScript, shared }) => {
            // Make shared data available
            window.__cascadeData = shared;
            // Run step
            const fn = new Function('sharedData', stepScript);
            return fn(shared);
          },
          { stepScript: step.script, shared: sharedData }
        );

        // Update shared data with result if specified
        if (step.outputKey) {
          sharedData[step.outputKey] = result;
        }

        results.push({ tabId, step: i, success: true, result });

      } catch (error) {
        results.push({ tabId, step: i, success: false, error: error.message });

        // Stop cascade on error unless configured otherwise
        if (step.critical !== false) {
          break;
        }
      }
    }

    return {
      success: results.every(r => r.success),
      action: TabAction.CASCADE,
      stepsExecuted: results.length,
      sharedData,
      results
    };
  }

  /**
   * Compare content between tabs
   */
  async _compareTabs(tabs, selector) {
    if (tabs.length < 2) {
      throw new Error('Compare requires at least 2 tabs');
    }

    const contents = [];

    for (const tabId of tabs) {
      const page = this.browserEngine.getPage(tabId);

      const content = await page.evaluate((sel) => {
        if (sel) {
          const el = document.querySelector(sel);
          return el ? {
            text: el.textContent,
            html: el.innerHTML,
            attributes: Array.from(el.attributes).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {})
          } : null;
        }

        // Compare full page
        return {
          title: document.title,
          url: window.location.href,
          bodyText: document.body.innerText.substring(0, 5000)
        };
      }, selector);

      contents.push({
        tabId,
        url: page.url(),
        content
      });
    }

    // Calculate differences
    const differences = this._findDifferences(contents);

    return {
      success: true,
      action: TabAction.COMPARE,
      tabs: tabs.length,
      selector,
      identical: differences.length === 0,
      differences,
      contents
    };
  }

  /**
   * Broadcast message/data to all tabs
   */
  async _broadcastMessage(tabs, message) {
    const results = [];

    for (const tabId of tabs) {
      const page = this.browserEngine.getPage(tabId);

      try {
        await page.evaluate((msg) => {
          // Dispatch custom event
          window.dispatchEvent(new CustomEvent('browserAutomation:broadcast', {
            detail: msg
          }));

          // Also set on window for direct access
          window.__broadcastMessage = msg;
        }, message);

        results.push({ tabId, delivered: true });

      } catch (error) {
        results.push({ tabId, delivered: false, error: error.message });
      }
    }

    return {
      success: true,
      action: TabAction.BROADCAST,
      message,
      tabs: tabs.length,
      deliveredCount: results.filter(r => r.delivered).length,
      results
    };
  }

  /**
   * Find differences between tab contents
   */
  _findDifferences(contents) {
    const differences = [];
    const base = contents[0];

    for (let i = 1; i < contents.length; i++) {
      const current = contents[i];
      const tabDiffs = [];

      // Compare content properties
      for (const key of Object.keys(base.content || {})) {
        const baseVal = JSON.stringify(base.content[key]);
        const currVal = JSON.stringify(current.content?.[key]);

        if (baseVal !== currVal) {
          tabDiffs.push({
            property: key,
            tab1: base.content[key],
            tab2: current.content?.[key]
          });
        }
      }

      if (tabDiffs.length > 0) {
        differences.push({
          tabs: [base.tabId, current.tabId],
          fields: tabDiffs
        });
      }
    }

    return differences;
  }

  /**
   * Open URL in multiple tabs
   * @param {string} profileName - Browser profile
   * @param {Array<string>} urls - URLs to open
   * @param {Object} options - Open options
   * @returns {Promise<Object>} Open result
   */
  async openMultiple(profileName, urls, options = {}) {
    const { stagger = 500 } = options;
    const tabIds = [];

    for (const url of urls) {
      const result = await this.browserEngine.openTab(profileName, url, options);
      tabIds.push(result.targetId);

      if (stagger > 0 && urls.indexOf(url) < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, stagger));
      }
    }

    return {
      success: true,
      tabIds,
      count: tabIds.length
    };
  }

  /**
   * Close multiple tabs
   * @param {Array<string>} tabIds - Tab IDs to close
   * @returns {Promise<Object>} Close result
   */
  async closeMultiple(tabIds) {
    const results = [];

    for (const tabId of tabIds) {
      try {
        await this.browserEngine.closeTab(tabId);
        results.push({ tabId, closed: true });
      } catch (error) {
        results.push({ tabId, closed: false, error: error.message });
      }
    }

    return {
      success: true,
      closedCount: results.filter(r => r.closed).length,
      results
    };
  }

  /**
   * Wait for all tabs to reach a state
   * @param {Array<string>} tabIds - Tab IDs
   * @param {Object} options - Wait options
   * @returns {Promise<Object>} Wait result
   */
  async waitForAll(tabIds, options = {}) {
    const { state = 'load', timeout = 30000 } = options;

    const promises = tabIds.map(async (tabId) => {
      const page = this.browserEngine.getPage(tabId);
      await page.waitForLoadState(state, { timeout });
      return { tabId, ready: true };
    });

    try {
      const results = await Promise.all(promises);
      return {
        success: true,
        allReady: true,
        results
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = {
  MultiTabAction,
  TabAction
};
