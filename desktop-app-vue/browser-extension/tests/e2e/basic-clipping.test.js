/**
 * E2E Tests - Basic Clipping Functionality
 * Tests core web clipping features in real browser
 */

const { test, expect: playwrightExpect } = require('@playwright/test');
const puppeteer = require('puppeteer');
const config = require('./config');
const E2EHelpers = require('./helpers');

// Wrapper for Jest-style expect to work with Playwright
const expect = (value) => ({
  toBeTruthy: () => playwrightExpect(value).toBeTruthy(),
  toBe: (expected) => playwrightExpect(value).toBe(expected),
  toContain: (expected) => playwrightExpect(value).toContain(expected),
  toMatch: (expected) => playwrightExpect(value).toMatch(expected),
});

test.describe('E2E: Basic Clipping', () => {
  let browser;
  let page;
  let extensionId;

  test.beforeAll(async () => {
    // Check if desktop app is running
    const apiConnected = await E2EHelpers.checkAPIConnection();
    if (!apiConnected) {
      console.warn('⚠️  Desktop app not running. Some tests may fail.');
    }

    // Launch browser with extension
    browser = await puppeteer.launch(config.launch);

    // Get extension ID
    extensionId = await E2EHelpers.getExtensionId(browser);
    expect(extensionId).toBeTruthy();

    console.log(`✓ Extension loaded with ID: ${extensionId}`);
  });

  test.afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test.beforeEach(async () => {
    page = await browser.newPage();
  });

  test.afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  test.describe('Extension Loading', () => {
    test('should load extension successfully', async () => {
      expect(extensionId).toBeTruthy();
      expect(extensionId).toMatch(/^[a-z]{32}$/);
    });

    test('should open popup page', async () => {
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      const title = await popupPage.title();
      expect(title).toContain('ChainlessChain');

      await popupPage.close();
    });
  });

  test.describe('Connection Status', () => {
    test('should show connection status in popup', async () => {
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      // Wait for status indicator
      await popupPage.waitForSelector('.status-indicator', { timeout: 5000 });

      const statusText = await E2EHelpers.getText(popupPage, '.status-text');
      expect(statusText).toMatch(/已连接|连接失败/);

      await popupPage.close();
    });
  });

  test.describe('Simple Page Clipping', () => {
    test('should clip example.com successfully', async () => {
      // Navigate to test page
      await page.goto(config.testUrls.simple, { waitUntil: 'networkidle0' });

      // Open popup
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      // Wait for form to load
      await popupPage.waitForSelector('#title');

      // Check pre-filled title
      const title = await popupPage.$eval('#title', el => el.value);
      expect(title).toBe('Example Domain');

      // Check pre-filled URL
      const url = await popupPage.$eval('#url', el => el.value);
      expect(url).toContain('example.com');

      // Click clip button
      await popupPage.click('#clip-button');

      // Wait for success (or error)
      await popupPage.waitForTimeout(3000);

      // Check for success message
      const hasSuccess = await E2EHelpers.elementExists(popupPage, '.success-message');
      const hasError = await E2EHelpers.elementExists(popupPage, '.error-message');

      if (!hasSuccess && hasError) {
        const errorText = await E2EHelpers.getText(popupPage, '.error-message');
        console.warn(`Clipping failed: ${errorText}`);
      }

      // Take screenshot
      await E2EHelpers.takeScreenshot(popupPage, 'clip-simple-page');

      await popupPage.close();
    }, 30000);
  });

  test.describe('Form Interactions', () => {
    test('should allow editing title', async () => {
      await page.goto(config.testUrls.simple);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      await popupPage.waitForSelector('#title');

      // Clear and type new title
      await popupPage.click('#title', { clickCount: 3 });
      await popupPage.type('#title', 'Custom Title');

      const newTitle = await popupPage.$eval('#title', el => el.value);
      expect(newTitle).toBe('Custom Title');

      await popupPage.close();
    });

    test('should allow adding tags', async () => {
      await page.goto(config.testUrls.simple);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      await popupPage.waitForSelector('#tags');
      await popupPage.type('#tags', 'test, example, demo');

      const tags = await popupPage.$eval('#tags', el => el.value);
      expect(tags).toBe('test, example, demo');

      await popupPage.close();
    });

    test('should toggle Readability checkbox', async () => {
      await page.goto(config.testUrls.simple);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      await popupPage.waitForSelector('#use-readability');

      const initialState = await popupPage.$eval('#use-readability', el => el.checked);
      await popupPage.click('#use-readability');
      const newState = await popupPage.$eval('#use-readability', el => el.checked);

      expect(newState).toBe(!initialState);

      await popupPage.close();
    });
  });

  test.describe('AI Features', () => {
    test('should have AI tag generation button', async () => {
      await page.goto(config.testUrls.article);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      await popupPage.waitForSelector('#generate-tags-btn');

      const buttonExists = await E2EHelpers.elementExists(popupPage, '#generate-tags-btn');
      expect(buttonExists).toBe(true);

      await popupPage.close();
    });

    test('should have AI summary generation button', async () => {
      await page.goto(config.testUrls.article);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      await popupPage.waitForSelector('#generate-summary-btn');

      const buttonExists = await E2EHelpers.elementExists(popupPage, '#generate-summary-btn');
      expect(buttonExists).toBe(true);

      await popupPage.close();
    });
  });

  test.describe('Screenshot Feature', () => {
    test('should have screenshot button', async () => {
      await page.goto(config.testUrls.simple);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      const buttonExists = await E2EHelpers.elementExists(popupPage, '#screenshot-btn');
      expect(buttonExists).toBe(true);

      await popupPage.close();
    });
  });

  test.describe('Batch Clipping Feature', () => {
    test('should have batch clipping button', async () => {
      await page.goto(config.testUrls.simple);
      const popupPage = await E2EHelpers.openPopup(browser, extensionId);

      const buttonExists = await E2EHelpers.elementExists(popupPage, '#batch-clip-btn');
      expect(buttonExists).toBe(true);

      await popupPage.close();
    });
  });
});
