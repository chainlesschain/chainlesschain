/**
 * ChainlessChain Browser Bridge - Content Script
 *
 * Runs in the context of web pages to enable DOM manipulation and data extraction.
 */

/* eslint-disable no-undef */
/* global chrome */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[ChainlessChain Content] Received message:", message.type);

  switch (message.type) {
    case "extractContent":
      sendResponse(extractContent(message.selector));
      break;

    case "extractText":
      sendResponse(extractText(message.selector));
      break;

    case "extractLinks":
      sendResponse(extractLinks());
      break;

    case "extractImages":
      sendResponse(extractImages());
      break;

    case "extractForms":
      sendResponse(extractForms());
      break;

    case "fillForm":
      sendResponse(fillForm(message.data));
      break;

    case "click":
      sendResponse(clickElement(message.selector));
      break;

    case "scrollTo":
      sendResponse(scrollToElement(message.selector, message.options));
      break;

    case "getScrollPosition":
      sendResponse(getScrollPosition());
      break;

    case "waitForElement":
      waitForElement(message.selector, message.timeout).then(sendResponse);
      return true; // Async response

    case "highlightElement":
      sendResponse(highlightElement(message.selector, message.options));
      break;

    case "getPageInfo":
      sendResponse(getPageInfo());
      break;

    // Advanced element interactions
    case "hover":
      sendResponse(hoverElement(message.selector));
      break;

    case "doubleClick":
      sendResponse(doubleClickElement(message.selector));
      break;

    case "rightClick":
      sendResponse(rightClickElement(message.selector));
      break;

    case "type":
      sendResponse(
        typeInElement(message.selector, message.text, message.options),
      );
      break;

    case "selectOption":
      sendResponse(selectOption(message.selector, message.value));
      break;

    case "checkCheckbox":
      sendResponse(setCheckbox(message.selector, message.checked));
      break;

    case "uploadFile":
      sendResponse(uploadFile(message.selector, message.files));
      break;

    case "getComputedStyle":
      sendResponse(getComputedStyleProp(message.selector, message.property));
      break;

    case "queryShadowDom":
      sendResponse(queryShadowDom(message.selectors));
      break;

    case "executeInShadowDom":
      sendResponse(
        executeInShadowDom(
          message.hostSelector,
          message.action,
          message.params,
        ),
      );
      break;

    case "getTableData":
      sendResponse(getTableData(message.selector));
      break;

    case "simulateKeyboard":
      sendResponse(
        simulateKeyboardEvent(
          message.selector,
          message.eventType,
          message.key,
          message.options,
        ),
      );
      break;

    case "waitForNavigation":
      waitForNavigation(message.timeout).then(sendResponse);
      return true; // Async response

    case "getNetworkRequests":
      sendResponse(getNetworkRequests());
      break;

    case "observeMutations":
      observeMutations(message.selector, message.options, message.id).then(
        sendResponse,
      );
      return true; // Async response

    // ==================== Reader Mode & Article Extraction ====================
    case "extractArticle":
      sendResponse(extractArticle(message.options));
      break;

    case "getReadableContent":
      sendResponse(getReadableContent());
      break;

    case "extractMetadata":
      sendResponse(extractMetadata());
      break;

    // ==================== Screenshot Support ====================
    case "prepareScreenshot":
      sendResponse(prepareScreenshot(message.options));
      break;

    case "getVisibleArea":
      sendResponse(getVisibleArea());
      break;

    case "scrollForFullPage":
      scrollForFullPage(message.options).then(sendResponse);
      return true; // Async response

    // ==================== Web Annotation ====================
    case "highlightSelection":
      sendResponse(highlightSelection(message.options));
      break;

    case "addAnnotation":
      sendResponse(addAnnotation(message.options));
      break;

    case "getAnnotations":
      sendResponse(getAnnotations());
      break;

    case "removeAnnotation":
      sendResponse(removeAnnotation(message.annotationId));
      break;

    case "clearAnnotations":
      sendResponse(clearAnnotations());
      break;

    case "exportAnnotations":
      sendResponse(exportAnnotations());
      break;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return false;
});

// ==================== Advanced Element Interactions ====================

/**
 * Hover over element
 */
function hoverElement(selector) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    element.dispatchEvent(
      new MouseEvent("mouseover", {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
      }),
    );

    element.dispatchEvent(
      new MouseEvent("mouseenter", {
        view: window,
        bubbles: false,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
      }),
    );

    element.dispatchEvent(
      new MouseEvent("mousemove", {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
      }),
    );

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Double click element
 */
function doubleClickElement(selector) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    element.dispatchEvent(
      new MouseEvent("dblclick", {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
      }),
    );

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Right click element (context menu)
 */
function rightClickElement(selector) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 2,
      }),
    );

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Type text in element with realistic key events
 */
function typeInElement(selector, text, options = {}) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    element.focus();

    if (options.clear) {
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }

    for (const char of text) {
      // KeyDown
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
        }),
      );

      // KeyPress (deprecated but some sites still use it)
      element.dispatchEvent(
        new KeyboardEvent("keypress", {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
        }),
      );

      // Update value
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        element.value += char;
      } else if (element.isContentEditable) {
        element.textContent += char;
      }

      // Input event
      element.dispatchEvent(new Event("input", { bubbles: true }));

      // KeyUp
      element.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
        }),
      );
    }

    // Change event at the end
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, typed: text.length };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Select option from dropdown
 */
function selectOption(selector, value) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    if (element.tagName !== "SELECT") {
      return { error: "Element is not a SELECT" };
    }

    // Find option by value or text
    let optionFound = false;
    for (const option of element.options) {
      if (option.value === value || option.textContent.trim() === value) {
        element.value = option.value;
        optionFound = true;
        break;
      }
    }

    if (!optionFound) {
      return { error: `Option not found: ${value}` };
    }

    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { success: true, selectedValue: element.value };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Set checkbox/radio state
 */
function setCheckbox(selector, checked) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    if (element.type !== "checkbox" && element.type !== "radio") {
      return { error: "Element is not a checkbox or radio" };
    }

    if (element.checked !== checked) {
      element.checked = checked;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("click", { bubbles: true }));
    }

    return { success: true, checked: element.checked };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Simulate file upload
 */
function uploadFile(selector, files) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    if (element.type !== "file") {
      return { error: "Element is not a file input" };
    }

    // Note: Due to security restrictions, we can only simulate the change event
    // Actual file data must be handled differently
    const dataTransfer = new DataTransfer();

    for (const file of files) {
      const blob = new Blob([file.content || ""], {
        type: file.type || "text/plain",
      });
      const f = new File([blob], file.name, {
        type: file.type || "text/plain",
      });
      dataTransfer.items.add(f);
    }

    element.files = dataTransfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, fileCount: files.length };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get computed style property
 */
function getComputedStyleProp(selector, property) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    const styles = window.getComputedStyle(element);

    if (property) {
      return { value: styles.getPropertyValue(property) };
    }

    // Return all computed styles
    const allStyles = {};
    for (const prop of styles) {
      allStyles[prop] = styles.getPropertyValue(prop);
    }
    return { styles: allStyles };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Shadow DOM Support ====================

/**
 * Query element through shadow DOM
 * @param {string[]} selectors - Array of selectors to traverse through shadow roots
 */
function queryShadowDom(selectors) {
  try {
    let current = document;

    for (let i = 0; i < selectors.length; i++) {
      const selector = selectors[i];
      const element = current.querySelector(selector);

      if (!element) {
        return { error: `Element not found at step ${i}: ${selector}` };
      }

      if (i < selectors.length - 1) {
        // Not the last selector, need to go into shadow root
        if (!element.shadowRoot) {
          return { error: `No shadow root at step ${i}: ${selector}` };
        }
        current = element.shadowRoot;
      } else {
        // Last selector, return element info
        const rect = element.getBoundingClientRect();
        return {
          found: true,
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          textContent: element.textContent?.substring(0, 200),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }
    }

    return { error: "No selectors provided" };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Execute action on element inside shadow DOM
 */
function executeInShadowDom(hostSelector, action, params = {}) {
  try {
    const host = document.querySelector(hostSelector);
    if (!host) {
      return { error: `Shadow host not found: ${hostSelector}` };
    }

    if (!host.shadowRoot) {
      return { error: "Element has no shadow root" };
    }

    const element = host.shadowRoot.querySelector(params.selector);
    if (!element) {
      return { error: `Element not found in shadow DOM: ${params.selector}` };
    }

    switch (action) {
      case "click":
        element.click();
        return { success: true };

      case "getValue":
        return { value: element.value || element.textContent };

      case "setValue":
        element.value = params.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };

      case "getText":
        return { text: element.textContent };

      case "getAttribute":
        return { value: element.getAttribute(params.attribute) };

      default:
        return { error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Table Data Extraction ====================

/**
 * Extract table data as array
 */
function getTableData(selector) {
  try {
    const table = document.querySelector(selector);
    if (!table) {
      return { error: `Table not found: ${selector}` };
    }

    if (table.tagName !== "TABLE") {
      return { error: "Element is not a TABLE" };
    }

    const data = {
      headers: [],
      rows: [],
    };

    // Extract headers
    const headerRow =
      table.querySelector("thead tr") || table.querySelector("tr");
    if (headerRow) {
      const headerCells = headerRow.querySelectorAll("th, td");
      data.headers = Array.from(headerCells).map((cell) =>
        cell.textContent.trim(),
      );
    }

    // Extract rows
    const tbody = table.querySelector("tbody") || table;
    const rows = tbody.querySelectorAll("tr");

    rows.forEach((row, index) => {
      // Skip header row if already processed
      if (index === 0 && !table.querySelector("thead")) {
        return;
      }

      const cells = row.querySelectorAll("td");
      if (cells.length > 0) {
        data.rows.push(
          Array.from(cells).map((cell) => cell.textContent.trim()),
        );
      }
    });

    return {
      headers: data.headers,
      rows: data.rows,
      rowCount: data.rows.length,
      columnCount: data.headers.length,
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Keyboard Simulation ====================

/**
 * Simulate keyboard event
 */
function simulateKeyboardEvent(selector, eventType, key, options = {}) {
  try {
    const element = selector
      ? document.querySelector(selector)
      : document.activeElement;
    if (!element) {
      return { error: `Element not found: ${selector}` };
    }

    const eventInit = {
      key: key,
      code: options.code || `Key${key.toUpperCase()}`,
      keyCode: options.keyCode || key.charCodeAt(0),
      which: options.which || key.charCodeAt(0),
      bubbles: true,
      cancelable: true,
      ctrlKey: options.ctrlKey || false,
      shiftKey: options.shiftKey || false,
      altKey: options.altKey || false,
      metaKey: options.metaKey || false,
    };

    element.dispatchEvent(new KeyboardEvent(eventType, eventInit));
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Navigation & Network ====================

/**
 * Wait for navigation to complete
 */
function waitForNavigation(timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const startUrl = window.location.href;

    const checkNavigation = () => {
      if (window.location.href !== startUrl) {
        resolve({ success: true, url: window.location.href });
        return;
      }

      if (Date.now() - startTime > timeout) {
        resolve({ error: "Navigation timeout" });
        return;
      }

      setTimeout(checkNavigation, 100);
    };

    // Also listen for load event
    const loadHandler = () => {
      window.removeEventListener("load", loadHandler);
      resolve({ success: true, url: window.location.href });
    };
    window.addEventListener("load", loadHandler);

    checkNavigation();
  });
}

// Network request tracking
const networkRequests = [];

/**
 * Get tracked network requests
 */
function getNetworkRequests() {
  return { requests: networkRequests.slice(-100) }; // Last 100 requests
}

// ==================== Mutation Observer ====================

const mutationObservers = new Map();

/**
 * Observe DOM mutations
 */
function observeMutations(selector, options = {}, observerId) {
  return new Promise((resolve) => {
    const element = selector ? document.querySelector(selector) : document.body;
    if (!element) {
      resolve({ error: `Element not found: ${selector}` });
      return;
    }

    const mutations = [];
    const timeout = options.timeout || 10000;

    const observer = new MutationObserver((mutationList) => {
      for (const mutation of mutationList) {
        mutations.push({
          type: mutation.type,
          target: mutation.target.tagName,
          addedNodes: mutation.addedNodes.length,
          removedNodes: mutation.removedNodes.length,
          attributeName: mutation.attributeName,
          oldValue: mutation.oldValue,
        });
      }

      if (options.once || mutations.length >= (options.maxMutations || 100)) {
        observer.disconnect();
        mutationObservers.delete(observerId);
        resolve({ mutations, count: mutations.length });
      }
    });

    observer.observe(element, {
      childList: options.childList !== false,
      attributes: options.attributes !== false,
      characterData: options.characterData || false,
      subtree: options.subtree !== false,
      attributeOldValue: options.attributeOldValue || false,
      characterDataOldValue: options.characterDataOldValue || false,
    });

    if (observerId) {
      mutationObservers.set(observerId, observer);
    }

    // Timeout
    setTimeout(() => {
      observer.disconnect();
      mutationObservers.delete(observerId);
      resolve({ mutations, count: mutations.length, timedOut: true });
    }, timeout);
  });
}

/**
 * Extract content from page
 */
function extractContent(selector) {
  try {
    if (selector) {
      const element = document.querySelector(selector);
      return element
        ? { html: element.outerHTML, text: element.textContent }
        : null;
    }
    return {
      html: document.documentElement.outerHTML,
      text: document.body.textContent,
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract text from selector or entire page
 */
function extractText(selector) {
  try {
    if (selector) {
      const elements = document.querySelectorAll(selector);
      return Array.from(elements).map((el) => el.textContent.trim());
    }
    return document.body.textContent;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract all links from page
 */
function extractLinks() {
  try {
    const links = document.querySelectorAll("a[href]");
    return Array.from(links).map((a) => ({
      text: a.textContent.trim(),
      href: a.href,
      title: a.title,
    }));
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract all images from page
 */
function extractImages() {
  try {
    const images = document.querySelectorAll("img");
    return Array.from(images).map((img) => ({
      src: img.src,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Extract form data
 */
function extractForms() {
  try {
    const forms = document.querySelectorAll("form");
    return Array.from(forms).map((form, index) => {
      const inputs = form.querySelectorAll("input, select, textarea");
      return {
        id: form.id || `form-${index}`,
        action: form.action,
        method: form.method,
        fields: Array.from(inputs).map((input) => ({
          name: input.name,
          type: input.type,
          id: input.id,
          value: input.type !== "password" ? input.value : "",
          placeholder: input.placeholder,
        })),
      };
    });
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Fill form fields
 */
function fillForm(data) {
  try {
    let filled = 0;
    for (const [selector, value] of Object.entries(data)) {
      const element = document.querySelector(selector);
      if (element) {
        if (element.tagName === "SELECT") {
          element.value = value;
        } else if (element.type === "checkbox" || element.type === "radio") {
          element.checked = Boolean(value);
        } else {
          element.value = value;
        }
        // Trigger change event
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
    }
    return { success: true, filled };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Click element
 */
function clickElement(selector) {
  try {
    const element = document.querySelector(selector);
    if (element) {
      element.click();
      return { success: true };
    }
    return { error: `Element not found: ${selector}` };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Scroll to element
 */
function scrollToElement(selector, options = {}) {
  try {
    if (selector) {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({
          behavior: options.smooth !== false ? "smooth" : "auto",
          block: options.block || "center",
        });
        return { success: true };
      }
      return { error: `Element not found: ${selector}` };
    }
    // Scroll to position
    window.scrollTo({
      top: options.top || 0,
      left: options.left || 0,
      behavior: options.smooth !== false ? "smooth" : "auto",
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get scroll position
 */
function getScrollPosition() {
  return {
    x: window.scrollX,
    y: window.scrollY,
    maxX: document.documentElement.scrollWidth - window.innerWidth,
    maxY: document.documentElement.scrollHeight - window.innerHeight,
  };
}

/**
 * Wait for element to appear
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    // Check if already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve({ success: true });
      return;
    }

    // Use MutationObserver
    const observer = new MutationObserver((mutations, obs) => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve({ success: true });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout
    setTimeout(() => {
      observer.disconnect();
      resolve({ error: `Timeout waiting for: ${selector}` });
    }, timeout);
  });
}

/**
 * Highlight element for debugging
 */
function highlightElement(selector, options = {}) {
  try {
    // Remove existing highlights
    document
      .querySelectorAll(".chainlesschain-highlight")
      .forEach((el) => el.remove());

    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) {
      return { error: `No elements found: ${selector}` };
    }

    elements.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const highlight = document.createElement("div");
      highlight.className = "chainlesschain-highlight";
      highlight.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid ${options.color || "#FF5722"};
        background: ${options.background || "rgba(255, 87, 34, 0.1)"};
        pointer-events: none;
        z-index: 999999;
        transition: all 0.3s;
      `;
      document.body.appendChild(highlight);

      // Auto-remove after duration
      if (options.duration !== 0) {
        setTimeout(() => {
          highlight.remove();
        }, options.duration || 3000);
      }
    });

    return { success: true, count: elements.length };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get page information
 */
function getPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    keywords: document.querySelector('meta[name="keywords"]')?.content,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    links: document.querySelectorAll("a").length,
    images: document.querySelectorAll("img").length,
    forms: document.querySelectorAll("form").length,
    scripts: document.querySelectorAll("script").length,
    readyState: document.readyState,
  };
}

// ==================== Reader Mode & Article Extraction ====================

/**
 * Extract article content using Readability-like algorithm
 */
function extractArticle(options = {}) {
  try {
    const article = {
      title: "",
      content: "",
      textContent: "",
      excerpt: "",
      byline: "",
      publishedDate: "",
      siteName: "",
      wordCount: 0,
      readingTime: 0,
    };

    // Extract title
    article.title = getArticleTitle();

    // Extract author/byline
    article.byline = getByline();

    // Extract published date
    article.publishedDate = getPublishedDate();

    // Extract site name
    article.siteName = getSiteName();

    // Find main content
    const mainContent = findMainContent();
    if (mainContent) {
      // Clean the content
      const cleanedContent = cleanContent(mainContent.cloneNode(true));
      article.content = cleanedContent.innerHTML;
      article.textContent = cleanedContent.textContent.trim();

      // Calculate word count and reading time
      const words = article.textContent
        .split(/\s+/)
        .filter((w) => w.length > 0);
      article.wordCount = words.length;
      article.readingTime = Math.ceil(article.wordCount / 200); // 200 words per minute

      // Generate excerpt
      article.excerpt = article.textContent.substring(0, 300).trim() + "...";
    }

    // Extract images if requested
    if (options.includeImages) {
      article.images = extractArticleImages(mainContent);
    }

    return article;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get article title
 */
function getArticleTitle() {
  // Try various selectors for title
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    "h1.title",
    "h1.post-title",
    "h1.entry-title",
    "h1.article-title",
    "article h1",
    ".post h1",
    "h1",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.content || element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return document.title;
}

/**
 * Get author/byline
 */
function getByline() {
  const selectors = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    '[rel="author"]',
    ".author",
    ".byline",
    ".post-author",
    '[itemprop="author"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content = element.content || element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return "";
}

/**
 * Get published date
 */
function getPublishedDate() {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="DC.date"]',
    "time[datetime]",
    "time[pubdate]",
    ".published",
    ".post-date",
    '[itemprop="datePublished"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const content =
        element.content ||
        element.getAttribute("datetime") ||
        element.textContent;
      if (content && content.trim()) {
        return content.trim();
      }
    }
  }

  return "";
}

/**
 * Get site name
 */
function getSiteName() {
  const selectors = [
    'meta[property="og:site_name"]',
    'meta[name="application-name"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.content) {
      return element.content.trim();
    }
  }

  return window.location.hostname;
}

/**
 * Find main content element
 */
function findMainContent() {
  // Content selectors in order of preference
  const contentSelectors = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".article-body",
    ".post-body",
    ".content",
    "#content",
    ".main-content",
    "#main-content",
  ];

  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim().length > 200) {
      return element;
    }
  }

  // Fallback: find element with most text content
  return findLargestTextBlock();
}

/**
 * Find element with largest text content
 */
function findLargestTextBlock() {
  const candidates = document.querySelectorAll("div, section");
  let best = null;
  let bestScore = 0;

  candidates.forEach((element) => {
    // Skip navigation, header, footer, sidebar
    const tag = element.tagName.toLowerCase();
    const id = element.id.toLowerCase();
    const className = element.className.toLowerCase();

    const skipPatterns =
      /nav|header|footer|sidebar|menu|comment|ad|social|share/;
    if (
      skipPatterns.test(tag) ||
      skipPatterns.test(id) ||
      skipPatterns.test(className)
    ) {
      return;
    }

    // Calculate score based on text density
    const text = element.textContent.trim();
    const links = element.querySelectorAll("a").length;
    const paragraphs = element.querySelectorAll("p").length;

    // Penalize link-heavy content
    const linkDensity = links / (text.length || 1);
    if (linkDensity > 0.5) return;

    const score = text.length + paragraphs * 100 - links * 10;

    if (score > bestScore) {
      bestScore = score;
      best = element;
    }
  });

  return best;
}

/**
 * Clean content by removing unwanted elements
 */
function cleanContent(element) {
  // Elements to remove
  const removeSelectors = [
    "script",
    "style",
    "iframe",
    "form",
    "nav",
    "header",
    "footer",
    "aside",
    ".ad",
    ".ads",
    ".advertisement",
    ".social-share",
    ".share-buttons",
    ".comments",
    ".comment",
    ".related",
    ".recommended",
    ".sidebar",
    ".navigation",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
  ];

  removeSelectors.forEach((selector) => {
    element.querySelectorAll(selector).forEach((el) => el.remove());
  });

  // Remove empty elements
  element.querySelectorAll("*").forEach((el) => {
    if (!el.textContent.trim() && !el.querySelector("img")) {
      el.remove();
    }
  });

  return element;
}

/**
 * Extract images from article
 */
function extractArticleImages(container) {
  if (!container) return [];

  const images = container.querySelectorAll("img");
  return Array.from(images)
    .filter((img) => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      // Filter out small images (likely icons/ads)
      return width > 100 && height > 100;
    })
    .map((img) => ({
      src: img.src,
      alt: img.alt,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    }));
}

/**
 * Get readable content (simplified version)
 */
function getReadableContent() {
  const article = extractArticle({ includeImages: true });

  return {
    title: article.title,
    content: article.textContent,
    html: article.content,
    excerpt: article.excerpt,
    byline: article.byline,
    publishedDate: article.publishedDate,
    siteName: article.siteName,
    wordCount: article.wordCount,
    readingTime: article.readingTime,
    images: article.images || [],
    url: window.location.href,
  };
}

/**
 * Extract page metadata
 */
function extractMetadata() {
  const metadata = {
    title: document.title,
    description: "",
    keywords: [],
    author: "",
    publishedDate: "",
    modifiedDate: "",
    siteName: "",
    url: window.location.href,
    canonical: "",
    language: document.documentElement.lang || "",
    ogData: {},
    twitterData: {},
    jsonLd: [],
  };

  // Meta description
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) metadata.description = descMeta.content;

  // Keywords
  const keywordsMeta = document.querySelector('meta[name="keywords"]');
  if (keywordsMeta) {
    metadata.keywords = keywordsMeta.content.split(",").map((k) => k.trim());
  }

  // Author
  metadata.author = getByline();

  // Dates
  metadata.publishedDate = getPublishedDate();
  const modifiedMeta = document.querySelector(
    'meta[property="article:modified_time"]',
  );
  if (modifiedMeta) metadata.modifiedDate = modifiedMeta.content;

  // Site name
  metadata.siteName = getSiteName();

  // Canonical URL
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) metadata.canonical = canonical.href;

  // Open Graph data
  document.querySelectorAll('meta[property^="og:"]').forEach((meta) => {
    const property = meta.getAttribute("property").replace("og:", "");
    metadata.ogData[property] = meta.content;
  });

  // Twitter Card data
  document.querySelectorAll('meta[name^="twitter:"]').forEach((meta) => {
    const name = meta.getAttribute("name").replace("twitter:", "");
    metadata.twitterData[name] = meta.content;
  });

  // JSON-LD structured data
  document
    .querySelectorAll('script[type="application/ld+json"]')
    .forEach((script) => {
      try {
        metadata.jsonLd.push(JSON.parse(script.textContent));
      } catch (e) {
        // Invalid JSON, skip
      }
    });

  return metadata;
}

// ==================== Screenshot Support ====================

/**
 * Prepare page for screenshot
 */
function prepareScreenshot(options = {}) {
  try {
    const result = {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY,
      },
    };

    // Hide fixed/sticky elements if requested
    if (options.hideFixed) {
      const fixedElements = [];
      document.querySelectorAll("*").forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") {
          fixedElements.push({
            element: el,
            originalDisplay: el.style.display,
          });
          el.style.display = "none";
        }
      });
      result.hiddenElements = fixedElements.length;
    }

    // Get element bounds if selector provided
    if (options.selector) {
      const element = document.querySelector(options.selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        result.elementBounds = {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      }
    }

    return result;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get visible area information
 */
function getVisibleArea() {
  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
    },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Scroll through page for full-page screenshot
 */
async function scrollForFullPage(options = {}) {
  const totalHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const scrollStep = options.step || viewportHeight;
  const delay = options.delay || 100;

  const positions = [];
  let currentScroll = 0;

  // Scroll to top first
  window.scrollTo(0, 0);
  await sleep(delay);

  while (currentScroll < totalHeight) {
    positions.push({
      scrollY: currentScroll,
      captureHeight: Math.min(viewportHeight, totalHeight - currentScroll),
    });

    currentScroll += scrollStep;
    window.scrollTo(0, currentScroll);
    await sleep(delay);
  }

  // Return to original position
  window.scrollTo(0, 0);

  return {
    positions,
    totalHeight,
    viewportHeight,
    totalCaptures: positions.length,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Web Annotation System ====================

// Store annotations in memory (will be synced to storage)
let annotations = [];
let annotationIdCounter = 0;

/**
 * Highlight selected text
 */
function highlightSelection(options = {}) {
  try {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return { error: "No text selected" };
    }

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();

    if (!text) {
      return { error: "Selected text is empty" };
    }

    // Create highlight wrapper
    const highlightId = `chainless-highlight-${++annotationIdCounter}`;
    const color = options.color || "#FFEB3B";

    const highlight = document.createElement("mark");
    highlight.id = highlightId;
    highlight.className = "chainlesschain-annotation";
    highlight.style.cssText = `
      background-color: ${color};
      padding: 2px 0;
      border-radius: 2px;
      cursor: pointer;
    `;
    highlight.dataset.annotationId = highlightId;

    // Wrap the selection
    try {
      range.surroundContents(highlight);
    } catch (e) {
      // Handle complex selections that cross element boundaries
      const fragment = range.extractContents();
      highlight.appendChild(fragment);
      range.insertNode(highlight);
    }

    // Clear selection
    selection.removeAllRanges();

    // Create annotation object
    const annotation = {
      id: highlightId,
      type: "highlight",
      text: text,
      color: color,
      note: options.note || "",
      url: window.location.href,
      xpath: getXPath(highlight),
      createdAt: new Date().toISOString(),
      position: {
        top: highlight.getBoundingClientRect().top + window.scrollY,
        left: highlight.getBoundingClientRect().left + window.scrollX,
      },
    };

    annotations.push(annotation);

    // Add click handler for editing
    highlight.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({
        type: "annotationClicked",
        annotation: annotation,
      });
    });

    // Save to storage
    saveAnnotationsToStorage();

    return { success: true, annotation };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Add annotation with note
 */
function addAnnotation(options = {}) {
  try {
    if (!options.text && !options.selector) {
      return { error: "Text or selector required" };
    }

    let targetElement = null;
    let text = options.text || "";

    if (options.selector) {
      targetElement = document.querySelector(options.selector);
      if (!targetElement) {
        return { error: `Element not found: ${options.selector}` };
      }
      text = targetElement.textContent.trim();
    }

    const annotationId = `chainless-annotation-${++annotationIdCounter}`;

    const annotation = {
      id: annotationId,
      type: options.type || "note",
      text: text.substring(0, 500),
      note: options.note || "",
      color: options.color || "#FFEB3B",
      url: window.location.href,
      selector: options.selector || "",
      xpath: targetElement ? getXPath(targetElement) : "",
      tags: options.tags || [],
      createdAt: new Date().toISOString(),
      position: targetElement
        ? {
            top: targetElement.getBoundingClientRect().top + window.scrollY,
            left: targetElement.getBoundingClientRect().left + window.scrollX,
          }
        : null,
    };

    annotations.push(annotation);

    // Add visual indicator if element exists
    if (targetElement && options.showIndicator !== false) {
      const indicator = document.createElement("div");
      indicator.className = "chainlesschain-annotation-indicator";
      indicator.dataset.annotationId = annotationId;
      indicator.style.cssText = `
        position: absolute;
        left: -20px;
        top: 0;
        width: 16px;
        height: 16px;
        background: ${options.color || "#FFEB3B"};
        border-radius: 50%;
        cursor: pointer;
        z-index: 999999;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;

      // Position relative to target
      targetElement.style.position = "relative";
      targetElement.appendChild(indicator);

      indicator.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({
          type: "annotationClicked",
          annotation: annotation,
        });
      });
    }

    saveAnnotationsToStorage();

    return { success: true, annotation };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get all annotations for current page
 */
function getAnnotations() {
  return {
    annotations: annotations.filter((a) => a.url === window.location.href),
    total: annotations.length,
    currentPage: annotations.filter((a) => a.url === window.location.href)
      .length,
  };
}

/**
 * Remove annotation by ID
 */
function removeAnnotation(annotationId) {
  try {
    // Remove from DOM
    const element = document.getElementById(annotationId);
    if (element) {
      // Unwrap highlight
      const parent = element.parentNode;
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
    }

    // Remove indicator
    const indicator = document.querySelector(
      `[data-annotation-id="${annotationId}"]`,
    );
    if (indicator) {
      indicator.remove();
    }

    // Remove from array
    const index = annotations.findIndex((a) => a.id === annotationId);
    if (index > -1) {
      annotations.splice(index, 1);
    }

    saveAnnotationsToStorage();

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Clear all annotations on current page
 */
function clearAnnotations() {
  try {
    // Remove all highlights
    document.querySelectorAll(".chainlesschain-annotation").forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });

    // Remove all indicators
    document
      .querySelectorAll(".chainlesschain-annotation-indicator")
      .forEach((el) => el.remove());

    // Filter out current page annotations
    const currentUrl = window.location.href;
    annotations = annotations.filter((a) => a.url !== currentUrl);

    saveAnnotationsToStorage();

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Export annotations for current page
 */
function exportAnnotations() {
  const pageAnnotations = annotations.filter(
    (a) => a.url === window.location.href,
  );

  return {
    url: window.location.href,
    title: document.title,
    exportedAt: new Date().toISOString(),
    annotations: pageAnnotations,
    count: pageAnnotations.length,
    // Generate markdown summary
    markdown: generateAnnotationsMarkdown(pageAnnotations),
  };
}

/**
 * Generate markdown from annotations
 */
function generateAnnotationsMarkdown(pageAnnotations) {
  let md = `# Annotations: ${document.title}\n\n`;
  md += `**URL:** ${window.location.href}\n`;
  md += `**Exported:** ${new Date().toLocaleString()}\n\n`;
  md += `---\n\n`;

  pageAnnotations.forEach((annotation, index) => {
    md += `## ${index + 1}. ${annotation.type === "highlight" ? "Highlight" : "Note"}\n\n`;
    md += `> ${annotation.text}\n\n`;
    if (annotation.note) {
      md += `**Note:** ${annotation.note}\n\n`;
    }
    if (annotation.tags && annotation.tags.length > 0) {
      md += `**Tags:** ${annotation.tags.join(", ")}\n\n`;
    }
    md += `*Created: ${new Date(annotation.createdAt).toLocaleString()}*\n\n`;
    md += `---\n\n`;
  });

  return md;
}

/**
 * Get XPath for element
 */
function getXPath(element) {
  if (!element) return "";

  const parts = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousSibling;

    while (sibling) {
      if (
        sibling.nodeType === Node.ELEMENT_NODE &&
        sibling.tagName === current.tagName
      ) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = current.tagName.toLowerCase();
    const part = index > 1 ? `${tagName}[${index}]` : tagName;
    parts.unshift(part);

    current = current.parentNode;
  }

  return "/" + parts.join("/");
}

/**
 * Save annotations to chrome storage
 */
function saveAnnotationsToStorage() {
  try {
    chrome.storage.local.set({ annotations: annotations });
  } catch (e) {
    console.error("[ChainlessChain] Failed to save annotations:", e);
  }
}

/**
 * Load annotations from chrome storage
 */
function loadAnnotationsFromStorage() {
  try {
    chrome.storage.local.get(["annotations"], (result) => {
      if (result.annotations) {
        annotations = result.annotations;
        // Restore highlights for current page
        restoreAnnotations();
      }
    });
  } catch (e) {
    console.error("[ChainlessChain] Failed to load annotations:", e);
  }
}

/**
 * Restore annotations on page load
 */
function restoreAnnotations() {
  const pageAnnotations = annotations.filter(
    (a) => a.url === window.location.href,
  );

  pageAnnotations.forEach((annotation) => {
    if (annotation.xpath) {
      try {
        // Try to find element by XPath and re-apply highlight
        // This is a simplified version; full implementation would use text matching
        console.log(
          "[ChainlessChain] Would restore annotation:",
          annotation.id,
        );
      } catch (e) {
        console.error("[ChainlessChain] Failed to restore annotation:", e);
      }
    }
  });
}

// Load annotations when content script loads
loadAnnotationsFromStorage();

// Notify background that content script is ready
chrome.runtime.sendMessage({
  type: "contentScriptReady",
  url: window.location.href,
});

console.log("[ChainlessChain] Content script loaded on:", window.location.href);
