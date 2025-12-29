/**
 * Common utilities for the extension
 */

/**
 * Detect current browser
 */
export function detectBrowser() {
  // Check for Firefox
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) {
    return 'firefox';
  }

  // Check for Chrome/Edge
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('edg/')) {
      return 'edge';
    }
    return 'chrome';
  }

  // Check for Safari
  if (typeof safari !== 'undefined' && safari.extension) {
    return 'safari';
  }

  return 'unknown';
}

/**
 * Get the appropriate browser adapter
 */
export async function getBrowserAdapter() {
  const browser = detectBrowser();

  switch (browser) {
    case 'firefox':
      return (await import('../adapters/firefox-adapter.js')).default;
    case 'safari':
      return (await import('../adapters/safari-adapter.js')).default;
    case 'chrome':
    case 'edge':
    default:
      return (await import('../adapters/chrome-adapter.js')).default;
  }
}

/**
 * Simple tag suggestion based on keywords
 */
export function suggestTags(page) {
  const tags = [];

  // From domain
  if (page.domain) {
    const domainParts = page.domain.split('.');
    if (domainParts.length >= 2) {
      const siteName = domainParts[domainParts.length - 2];
      tags.push(siteName);
    }
  }

  // From title keywords
  if (page.title) {
    const keywords = ['教程', '指南', '文档', '博客', '新闻', '技术', '开发', 'Tutorial', 'Guide', 'Documentation'];
    for (const keyword of keywords) {
      if (page.title.toLowerCase().includes(keyword.toLowerCase())) {
        tags.push(keyword);
        break;
      }
    }
  }

  // Limit to 3 tags
  return [...new Set(tags)].slice(0, 3);
}

/**
 * Format date for display
 */
export function formatDate(isoString) {
  if (!isoString) return new Date().toLocaleDateString('zh-CN');

  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    return new Date().toLocaleDateString('zh-CN');
  }
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
