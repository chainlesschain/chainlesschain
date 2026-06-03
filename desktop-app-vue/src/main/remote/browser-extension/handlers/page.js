/**
 * Page command handlers for the ChainlessChain Browser Bridge.
 *
 * Groups several page-level capabilities that were scattered across background.js:
 *  - Page Operations: content, execute script, screenshot, print, PDF, device
 *    emulation, geolocation override
 *  - CSS Injection: inject / remove user stylesheets (keeps injectedStyles state)
 *  - Reader Mode (Phase 26): article extract / readable content / metadata
 *  - Web Annotation (Phase 27): highlight / add / get / remove / clear / export
 *
 * page.executeScript and page.screenshot delegate to the shared primitives in
 * _shared.js. devicePresets + injectedStyles are module-level state that moves
 * with these handlers (verified no external refs).
 *
 * NOT included (left in background.js, entangled with other domains):
 *  - page.getConsole -> getConsoleLogs (shares consoleLogs Map with the console
 *    capture domain)
 *  - page.setViewport -> setViewport (a duplicated/hoisting-shadowed function
 *    shared with the viewport domain's viewport.set)
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, navigator, Date, JSON */

import { captureScreenshot, executeScript } from "./_shared.js";

// ---------- Page Operations ----------

export async function getPageContent(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        return el ? el.outerHTML : null;
      }
      return document.documentElement.outerHTML;
    },
    args: [selector],
  });
  return { content: results[0]?.result };
}

export async function printPage(tabId, _options = {}) {
  // Note: chrome.tabs.print() requires user interaction
  // This will open the print dialog
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.print();
    },
  });
  return { success: true, note: "Print dialog opened" };
}

export async function saveToPdf(tabId, options = {}) {
  // Note: PDF saving requires debugger API
  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.printToPDF",
      {
        landscape: options.landscape || false,
        displayHeaderFooter: options.displayHeaderFooter || false,
        printBackground: options.printBackground !== false,
        scale: options.scale || 1,
        paperWidth: options.paperWidth || 8.5,
        paperHeight: options.paperHeight || 11,
        marginTop: options.marginTop || 0.4,
        marginBottom: options.marginBottom || 0.4,
        marginLeft: options.marginLeft || 0.4,
        marginRight: options.marginRight || 0.4,
      },
    );

    await chrome.debugger.detach({ tabId });

    return {
      success: true,
      data: result.data, // Base64 encoded PDF
    };
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_e) {
      // Ignore detach errors
    }
    return { error: error.message };
  }
}

const devicePresets = {
  "iPhone SE": { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  "iPhone 12": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  "iPhone 14 Pro Max": {
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
  },
  iPad: { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  "iPad Pro": { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true },
  "Pixel 5": { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true },
  "Samsung Galaxy S21": {
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    mobile: true,
  },
};

export async function emulateDevice(tabId, device) {
  const preset = devicePresets[device];
  if (!preset) {
    return {
      error: `Unknown device: ${device}`,
      availableDevices: Object.keys(devicePresets),
    };
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      preset,
    );

    return { success: true, device, ...preset };
  } catch (error) {
    return { error: error.message };
  }
}

export async function setGeolocation(
  tabId,
  latitude,
  longitude,
  accuracy = 100,
) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (lat, lng, acc) => {
      // Override geolocation
      const mockPosition = {
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };

      navigator.geolocation.getCurrentPosition = (success) => {
        success(mockPosition);
      };

      navigator.geolocation.watchPosition = (success) => {
        success(mockPosition);
        return 1;
      };

      return { success: true };
    },
    args: [latitude, longitude, accuracy],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ---------- CSS Injection ----------

const injectedStyles = new Map();

export async function injectCSS(tabId, css, options = {}) {
  try {
    const cssId = `chainlesschain-css-${Date.now()}`;

    await chrome.scripting.insertCSS({
      target: { tabId },
      css: css,
      origin: options.origin || "USER",
    });

    const tabStyles = injectedStyles.get(tabId) || [];
    tabStyles.push({ id: cssId, css });
    injectedStyles.set(tabId, tabStyles);

    return { success: true, cssId };
  } catch (error) {
    return { error: error.message };
  }
}

export async function removeInjectedCSS(tabId, cssId) {
  try {
    const tabStyles = injectedStyles.get(tabId) || [];
    const style = tabStyles.find((s) => s.id === cssId);

    if (style) {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: style.css,
      });

      injectedStyles.set(
        tabId,
        tabStyles.filter((s) => s.id !== cssId),
      );
    }

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Reader Mode & Article Extraction (Phase 26) ----------

/**
 * Extract article content from the page using Readability-like algorithm
 */
export async function extractArticle(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "extractArticle",
    });
    return response;
  } catch (error) {
    // Fallback: use scripting API
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Simple article extraction fallback
        const article =
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.querySelector("main") ||
          document.body;

        const title =
          document.querySelector("h1")?.textContent || document.title;

        const content = article ? article.innerText : document.body.innerText;

        return {
          success: true,
          article: {
            title: title.trim(),
            content: content.substring(0, 50000), // Limit content size
            textContent: content.substring(0, 50000),
            length: content.length,
            siteName: window.location.hostname,
            url: window.location.href,
          },
        };
      },
    });
    return results[0]?.result || { error: "Failed to extract article" };
  }
}

/**
 * Get readable content with formatting options
 */
export async function getReadableContent(tabId, options = {}) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "getReadableContent",
      options,
    });
    return response;
  } catch (error) {
    // Fallback: extract basic content
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        const article =
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.querySelector("main");

        if (!article) {
          return { error: "No readable content found" };
        }

        // Clean up the content
        const clone = article.cloneNode(true);

        // Remove unwanted elements
        const removeSelectors = [
          "script",
          "style",
          "nav",
          "aside",
          "footer",
          "header",
          ".ad",
          ".advertisement",
          ".social-share",
          ".comments",
        ];
        removeSelectors.forEach((sel) => {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        });

        const includeImages = opts?.includeImages !== false;
        const images = [];

        if (includeImages) {
          clone.querySelectorAll("img").forEach((img) => {
            if (img.src && img.naturalWidth > 100) {
              images.push({
                src: img.src,
                alt: img.alt,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }
          });
        }

        return {
          success: true,
          content: {
            html: clone.innerHTML,
            text: clone.innerText,
            images,
            wordCount: clone.innerText.split(/\s+/).length,
          },
        };
      },
      args: [options],
    });
    return results[0]?.result || { error: "Failed to get readable content" };
  }
}

/**
 * Extract article metadata (author, date, description, etc.)
 */
export async function extractArticleMetadata(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "extractMetadata",
    });
    return response;
  } catch (error) {
    // Fallback: extract basic metadata
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const getMeta = (name) => {
          const meta =
            document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="${name}"]`) ||
            document.querySelector(`meta[property="og:${name}"]`);
          return meta?.content || null;
        };

        return {
          success: true,
          metadata: {
            title: document.title,
            description: getMeta("description"),
            author: getMeta("author"),
            publishedTime:
              getMeta("article:published_time") || getMeta("datePublished"),
            modifiedTime:
              getMeta("article:modified_time") || getMeta("dateModified"),
            siteName: getMeta("og:site_name") || window.location.hostname,
            url: window.location.href,
            image: getMeta("og:image"),
            type: getMeta("og:type"),
            keywords: getMeta("keywords"),
            language: document.documentElement.lang,
          },
        };
      },
    });
    return results[0]?.result || { error: "Failed to extract metadata" };
  }
}

// ---------- Web Annotation (Phase 27) ----------

/**
 * Highlight the current text selection
 */
export async function highlightSelection(tabId, options = {}) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "highlightSelection",
      options,
    });
    return response;
  } catch (error) {
    // Fallback: use scripting API
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          return { error: "No text selected" };
        }

        const range = selection.getRangeAt(0);
        const highlight = document.createElement("mark");
        highlight.style.backgroundColor = opts?.color || "#ffff00";
        highlight.style.padding = "2px";
        highlight.dataset.annotationId = `ann-${Date.now()}`;

        try {
          range.surroundContents(highlight);
          selection.removeAllRanges();
          return {
            success: true,
            annotationId: highlight.dataset.annotationId,
            text: highlight.textContent,
          };
        } catch (e) {
          return { error: "Cannot highlight across element boundaries" };
        }
      },
      args: [options],
    });
    return results[0]?.result || { error: "Failed to highlight selection" };
  }
}

/**
 * Add an annotation to the page
 */
export async function addAnnotation(tabId, annotation) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "addAnnotation",
      annotation,
    });
    return response;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get all annotations on the page
 */
export async function getAnnotations(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "getAnnotations",
    });
    return response;
  } catch (error) {
    // Fallback: get annotations from DOM
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const marks = document.querySelectorAll("mark[data-annotation-id]");
        const annotations = [];
        marks.forEach((mark) => {
          annotations.push({
            id: mark.dataset.annotationId,
            text: mark.textContent,
            color: mark.style.backgroundColor,
            note: mark.dataset.note || null,
          });
        });
        return { success: true, annotations };
      },
    });
    return results[0]?.result || { annotations: [] };
  }
}

/**
 * Remove a specific annotation
 */
export async function removeAnnotation(tabId, annotationId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "removeAnnotation",
      annotationId,
    });
    return response;
  } catch (error) {
    // Fallback: remove from DOM directly
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (annId) => {
        const mark = document.querySelector(
          `mark[data-annotation-id="${annId}"]`,
        );
        if (!mark) {
          return { error: "Annotation not found" };
        }
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        return { success: true };
      },
      args: [annotationId],
    });
    return results[0]?.result || { error: "Failed to remove annotation" };
  }
}

/**
 * Clear all annotations on the page
 */
export async function clearAnnotations(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "clearAnnotations",
    });
    return response;
  } catch (error) {
    // Fallback: clear from DOM directly
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const marks = document.querySelectorAll("mark[data-annotation-id]");
        let removed = 0;
        marks.forEach((mark) => {
          const parent = mark.parentNode;
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          parent.removeChild(mark);
          removed++;
        });
        return { success: true, removed };
      },
    });
    return results[0]?.result || { error: "Failed to clear annotations" };
  }
}

/**
 * Export all annotations in specified format (json, markdown, html)
 */
export async function exportAnnotations(tabId, format = "json") {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "exportAnnotations",
      format,
    });
    return response;
  } catch (error) {
    // Fallback: export basic format
    const annotations = await getAnnotations(tabId);
    if (annotations.error) {
      return annotations;
    }

    const pageTitle =
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.title,
        })
      )[0]?.result || "Untitled";

    const pageUrl =
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.location.href,
        })
      )[0]?.result || "";

    if (format === "markdown") {
      let md = `# Annotations: ${pageTitle}\n\n`;
      md += `Source: ${pageUrl}\n\n`;
      md += `Exported: ${new Date().toISOString()}\n\n---\n\n`;
      annotations.annotations.forEach((ann, i) => {
        md += `## ${i + 1}. Highlight\n\n`;
        md += `> ${ann.text}\n\n`;
        if (ann.note) {
          md += `**Note:** ${ann.note}\n\n`;
        }
      });
      return { success: true, format: "markdown", content: md };
    } else if (format === "html") {
      let html = `<!DOCTYPE html>
<html><head><title>Annotations: ${pageTitle}</title>
<style>
body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.highlight { background: #ffff00; padding: 2px 4px; }
.note { color: #666; font-style: italic; }
</style></head><body>
<h1>Annotations: ${pageTitle}</h1>
<p>Source: <a href="${pageUrl}">${pageUrl}</a></p>
<hr>`;
      annotations.annotations.forEach((ann) => {
        html += `<div class="annotation">
<p><span class="highlight">${ann.text}</span></p>
${ann.note ? `<p class="note">${ann.note}</p>` : ""}
</div>`;
      });
      html += "</body></html>";
      return { success: true, format: "html", content: html };
    }

    // Default: JSON
    return {
      success: true,
      format: "json",
      content: JSON.stringify(
        {
          title: pageTitle,
          url: pageUrl,
          exportedAt: new Date().toISOString(),
          annotations: annotations.annotations,
        },
        null,
        2,
      ),
    };
  }
}

export const pageHandlers = {
  // Page Operations
  "page.getContent": ({ tabId, selector }) => getPageContent(tabId, selector),
  "page.executeScript": ({ tabId, script }) => executeScript(tabId, script),
  "page.screenshot": ({ tabId, options }) => captureScreenshot(tabId, options),
  "page.print": ({ tabId, options }) => printPage(tabId, options),
  "page.pdf": ({ tabId, options }) => saveToPdf(tabId, options),
  "page.emulateDevice": ({ tabId, device }) => emulateDevice(tabId, device),
  "page.setGeolocation": ({ tabId, latitude, longitude, accuracy }) =>
    setGeolocation(tabId, latitude, longitude, accuracy),
  // CSS Injection
  "css.inject": ({ tabId, css, options }) => injectCSS(tabId, css, options),
  "css.remove": ({ tabId, cssId }) => removeInjectedCSS(tabId, cssId),
  // Reader Mode
  "article.extract": ({ tabId }) => extractArticle(tabId),
  "article.getReadable": ({ tabId, options }) =>
    getReadableContent(tabId, options),
  "article.getMetadata": ({ tabId }) => extractArticleMetadata(tabId),
  // Web Annotation
  "annotation.highlight": ({ tabId, options }) =>
    highlightSelection(tabId, options),
  "annotation.add": ({ tabId, annotation }) => addAnnotation(tabId, annotation),
  "annotation.getAll": ({ tabId }) => getAnnotations(tabId),
  "annotation.remove": ({ tabId, annotationId }) =>
    removeAnnotation(tabId, annotationId),
  "annotation.clear": ({ tabId }) => clearAnnotations(tabId),
  "annotation.export": ({ tabId, format }) => exportAnnotations(tabId, format),
};
