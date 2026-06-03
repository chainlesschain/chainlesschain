/**
 * Puppeteer Configuration for E2E Testing
 * Tests browser extension in real Chrome environment
 */

const path = require('path');

module.exports = {
  // Launch options for Puppeteer
  launch: {
    headless: false, // Extension requires non-headless mode
    args: [
      `--disable-extensions-except=${path.join(__dirname, '../build/chrome')}`,
      `--load-extension=${path.join(__dirname, '../build/chrome')}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security', // For testing purposes
    ],
    defaultViewport: {
      width: 1280,
      height: 720
    },
    slowMo: 50 // Slow down by 50ms for visibility
  },

  // Test configuration
  testTimeout: 30000,
  extensionPath: path.join(__dirname, '../build/chrome'),

  // Test URLs
  testUrls: {
    simple: 'https://example.com',
    article: 'https://react.dev/learn',
    complex: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript'
  },

  // Desktop app API
  apiBaseUrl: 'http://localhost:23456/api'
};
