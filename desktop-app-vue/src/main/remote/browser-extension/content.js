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

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
  }

  return false;
});

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

// Notify background that content script is ready
chrome.runtime.sendMessage({
  type: "contentScriptReady",
  url: window.location.href,
});

console.log("[ChainlessChain] Content script loaded on:", window.location.href);
