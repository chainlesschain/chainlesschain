/**
 * E2E Test Helpers
 * Utility functions for Puppeteer tests
 */

const config = require('./config');

class E2EHelpers {
  /**
   * Wait for extension to load
   */
  static async waitForExtension(page, timeout = 5000) {
    await page.waitForTimeout(timeout);
  }

  /**
   * Get extension ID from chrome://extensions
   */
  static async getExtensionId(browser) {
    const extensionsPage = await browser.newPage();
    await extensionsPage.goto('chrome://extensions');

    const extensionId = await extensionsPage.evaluate(() => {
      const extensions = document.querySelector('extensions-manager')
        ?.shadowRoot?.querySelector('extensions-item-list')
        ?.shadowRoot?.querySelectorAll('extensions-item');

      for (const ext of extensions || []) {
        const name = ext.shadowRoot?.querySelector('#name')?.textContent;
        if (name?.includes('ChainlessChain')) {
          return ext.id;
        }
      }
      return null;
    });

    await extensionsPage.close();
    return extensionId;
  }

  /**
   * Open extension popup
   */
  static async openPopup(browser, extensionId) {
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const popupPage = await browser.newPage();
    await popupPage.goto(popupUrl);
    await popupPage.waitForSelector('body');
    return popupPage;
  }

  /**
   * Check API connection
   */
  static async checkAPIConnection() {
    try {
      const response = await fetch(`${config.apiBaseUrl}/ping`, {
        method: 'POST'
      });
      const data = await response.json();
      return data.success === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fill clip form
   */
  static async fillClipForm(page, data) {
    if (data.title) {
      await page.type('#title', data.title);
    }

    if (data.tags) {
      await page.type('#tags', data.tags);
    }

    if (data.type) {
      await page.select('#type', data.type);
    }

    if (data.useReadability !== undefined) {
      const checkbox = await page.$('#use-readability');
      const isChecked = await page.evaluate(el => el.checked, checkbox);
      if (isChecked !== data.useReadability) {
        await checkbox.click();
      }
    }

    if (data.autoIndex !== undefined) {
      const checkbox = await page.$('#auto-index');
      const isChecked = await page.evaluate(el => el.checked, checkbox);
      if (isChecked !== data.autoIndex) {
        await checkbox.click();
      }
    }
  }

  /**
   * Click button and wait for response
   */
  static async clickAndWait(page, selector, waitTime = 1000) {
    await page.click(selector);
    await page.waitForTimeout(waitTime);
  }

  /**
   * Get element text
   */
  static async getText(page, selector) {
    return await page.$eval(selector, el => el.textContent);
  }

  /**
   * Check if element exists
   */
  static async elementExists(page, selector) {
    return (await page.$(selector)) !== null;
  }

  /**
   * Wait for success message
   */
  static async waitForSuccess(page, timeout = 5000) {
    try {
      await page.waitForSelector('.success-message, .toast-success', {
        timeout
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Take screenshot
   */
  static async takeScreenshot(page, name) {
    const screenshotPath = `tests/e2e/screenshots/${name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  /**
   * Get console logs
   */
  static setupConsoleCapture(page) {
    const logs = [];
    page.on('console', msg => {
      logs.push({
        type: msg.type(),
        text: msg.text()
      });
    });
    return logs;
  }

  /**
   * Get network requests
   */
  static setupNetworkCapture(page) {
    const requests = [];
    page.on('request', request => {
      requests.push({
        url: request.url(),
        method: request.method()
      });
    });
    return requests;
  }
}

module.exports = E2EHelpers;
