/**
 * Accessibility command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the full accessibility.* namespace, which spanned two source sections
 * (the basic "Accessibility" section and the Phase 21 "Accessibility" section):
 * getTree, getRole, getARIA, checkContrast, getFocusOrder, getLandmarks,
 * getHeadingStructure, checkAlt, checkLabels, simulate, runAudit.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * in page context via chrome.scripting.executeScript — no CDP, no shared-layer
 * dependency, no module-level state. runAudit composes several of the others.
 *
 * NOTE: background.js defined getAccessibilityTree TWICE (basic + Phase 21);
 * hoisting made the Phase 21 one (with selector="body" default) effective for
 * BOTH accessibility.getTree switch cases. This module keeps that effective
 * definition.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, document, window, Math, parseInt, parseFloat, Object, Promise, Array */

export async function getAccessibilityTree(tabId, selector = "body") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        function buildTree(element, depth = 0) {
          if (depth > 10) return null; // Limit depth
          const computed = window.getComputedStyle(element);
          const isHidden =
            computed.display === "none" || computed.visibility === "hidden";

          const node = {
            tag: element.tagName?.toLowerCase(),
            role:
              element.getAttribute("role") || element.tagName?.toLowerCase(),
            name:
              element.getAttribute("aria-label") ||
              element.getAttribute("alt") ||
              element.textContent?.slice(0, 50),
            id: element.id || null,
            isHidden,
            tabIndex: element.tabIndex,
            children: [],
          };

          if (!isHidden && element.children) {
            for (const child of element.children) {
              const childNode = buildTree(child, depth + 1);
              if (childNode) node.children.push(childNode);
            }
          }
          return node;
        }

        const root = document.querySelector(sel);
        return root ? buildTree(root) : null;
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to build tree" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getElementRole(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }

      return {
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        ariaLabel: element.getAttribute("aria-label"),
        ariaDescribedBy: element.getAttribute("aria-describedby"),
        ariaLive: element.getAttribute("aria-live"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        ariaSelected: element.getAttribute("aria-selected"),
        ariaChecked: element.getAttribute("aria-checked"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        tabIndex: element.tabIndex,
      };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function getARIAProperties(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const elements = document.querySelectorAll(
          sel || "[role], [aria-label], [aria-describedby], [aria-hidden]",
        );
        return Array.from(elements)
          .slice(0, 100)
          .map((el) => ({
            tag: el.tagName?.toLowerCase(),
            selector: el.id
              ? `#${el.id}`
              : el.className
                ? `.${el.className.split(" ")[0]}`
                : el.tagName?.toLowerCase(),
            role: el.getAttribute("role"),
            ariaLabel: el.getAttribute("aria-label"),
            ariaDescribedby: el.getAttribute("aria-describedby"),
            ariaHidden: el.getAttribute("aria-hidden"),
            ariaExpanded: el.getAttribute("aria-expanded"),
            ariaSelected: el.getAttribute("aria-selected"),
            ariaChecked: el.getAttribute("aria-checked"),
            ariaDisabled: el.getAttribute("aria-disabled"),
            ariaLive: el.getAttribute("aria-live"),
            ariaAtomic: el.getAttribute("aria-atomic"),
            ariaRelevant: el.getAttribute("aria-relevant"),
            ariaBusy: el.getAttribute("aria-busy"),
            ariaControls: el.getAttribute("aria-controls"),
            ariaOwns: el.getAttribute("aria-owns"),
          }));
      },
      args: [selector],
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function checkColorContrast(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        function getLuminance(r, g, b) {
          const [rs, gs, bs] = [r, g, b].map((c) => {
            c = c / 255;
            return c <= 0.03928
              ? c / 12.92
              : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function parseColor(color) {
          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match)
            return {
              r: parseInt(match[1]),
              g: parseInt(match[2]),
              b: parseInt(match[3]),
            };
          return null;
        }

        function getContrastRatio(fg, bg) {
          const l1 = getLuminance(fg.r, fg.g, fg.b);
          const l2 = getLuminance(bg.r, bg.g, bg.b);
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        const elements = document.querySelectorAll(
          sel ||
            "p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button",
        );
        const issues = [];

        Array.from(elements)
          .slice(0, 100)
          .forEach((el) => {
            const style = window.getComputedStyle(el);
            const fg = parseColor(style.color);
            const bg = parseColor(style.backgroundColor);

            if (fg && bg) {
              const ratio = getContrastRatio(fg, bg);
              const fontSize = parseFloat(style.fontSize);
              const isBold = parseInt(style.fontWeight) >= 700;
              const isLargeText = fontSize >= 18 || (fontSize >= 14 && isBold);
              const minRatio = isLargeText ? 3 : 4.5;

              if (ratio < minRatio) {
                issues.push({
                  element: el.tagName?.toLowerCase(),
                  text: el.textContent?.slice(0, 30),
                  foreground: style.color,
                  background: style.backgroundColor,
                  ratio: ratio.toFixed(2),
                  required: minRatio,
                  pass: false,
                });
              }
            }
          });

        return { issues, totalChecked: elements.length };
      },
      args: [selector],
    });
    return result[0]?.result || { issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getFocusOrder(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const focusableSelector =
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const elements = document.querySelectorAll(focusableSelector);

        return Array.from(elements).map((el, index) => ({
          order: index + 1,
          tag: el.tagName?.toLowerCase(),
          type: el.type || null,
          tabIndex: el.tabIndex,
          id: el.id || null,
          name: el.name || null,
          text: (el.textContent || el.value || el.placeholder || "")?.slice(
            0,
            30,
          ),
          isVisible: el.offsetParent !== null,
          rect: el.getBoundingClientRect
            ? {
                x: Math.round(el.getBoundingClientRect().x),
                y: Math.round(el.getBoundingClientRect().y),
              }
            : null,
        }));
      },
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getAccessibilityLandmarks(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const landmarks = {
          banner: document.querySelectorAll('header, [role="banner"]'),
          navigation: document.querySelectorAll('nav, [role="navigation"]'),
          main: document.querySelectorAll('main, [role="main"]'),
          complementary: document.querySelectorAll(
            'aside, [role="complementary"]',
          ),
          contentinfo: document.querySelectorAll(
            'footer, [role="contentinfo"]',
          ),
          search: document.querySelectorAll('[role="search"]'),
          form: document.querySelectorAll('form, [role="form"]'),
          region: document.querySelectorAll('[role="region"]'),
        };

        const result = {};
        for (const [type, elements] of Object.entries(landmarks)) {
          result[type] = Array.from(elements).map((el) => ({
            tag: el.tagName?.toLowerCase(),
            role: el.getAttribute("role"),
            ariaLabel: el.getAttribute("aria-label"),
            id: el.id || null,
          }));
        }
        return result;
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getHeadingStructure(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const headings = document.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, [role='heading']",
        );
        const structure = [];
        let previousLevel = 0;
        const issues = [];

        Array.from(headings).forEach((h, index) => {
          const level =
            parseInt(h.tagName?.charAt(1)) ||
            parseInt(h.getAttribute("aria-level")) ||
            0;
          const text = h.textContent?.trim().slice(0, 50);

          // Check for skipped heading levels
          if (level > previousLevel + 1 && previousLevel > 0) {
            issues.push({
              type: "skipped-level",
              message: `Heading level ${level} follows level ${previousLevel}`,
              element: h.tagName?.toLowerCase(),
              text,
            });
          }

          structure.push({
            level,
            tag: h.tagName?.toLowerCase(),
            text,
            id: h.id || null,
            index,
          });

          previousLevel = level;
        });

        // Check for missing h1
        const hasH1 = Array.from(headings).some((h) => h.tagName === "H1");
        if (!hasH1) {
          issues.push({
            type: "missing-h1",
            message: "Page is missing an h1 heading",
          });
        }

        // Check for multiple h1s
        const h1Count = document.querySelectorAll("h1").length;
        if (h1Count > 1) {
          issues.push({
            type: "multiple-h1",
            message: `Page has ${h1Count} h1 headings (should have only one)`,
          });
        }

        return { structure, issues };
      },
    });
    return result[0]?.result || { structure: [], issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function checkAltTexts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const images = document.querySelectorAll("img");
        const issues = [];
        const stats = {
          total: images.length,
          withAlt: 0,
          emptyAlt: 0,
          missingAlt: 0,
        };

        Array.from(images).forEach((img) => {
          const alt = img.getAttribute("alt");
          const src = img.src?.slice(0, 100);

          if (alt === null) {
            stats.missingAlt++;
            issues.push({
              type: "missing",
              src,
              message: "Image is missing alt attribute",
            });
          } else if (alt === "") {
            stats.emptyAlt++;
            // Empty alt is valid for decorative images
          } else {
            stats.withAlt++;
          }
        });

        return { stats, issues };
      },
    });
    return result[0]?.result || { stats: {}, issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function checkFormLabels(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const inputs = document.querySelectorAll("input, select, textarea");
        const issues = [];
        const stats = { total: inputs.length, labeled: 0, unlabeled: 0 };

        Array.from(inputs).forEach((input) => {
          if (
            input.type === "hidden" ||
            input.type === "submit" ||
            input.type === "button"
          )
            return;

          const hasLabel = input.labels?.length > 0;
          const hasAriaLabel = input.getAttribute("aria-label");
          const hasAriaLabelledby = input.getAttribute("aria-labelledby");
          const hasTitle = input.title;
          const hasPlaceholder = input.placeholder;

          const isLabeled =
            hasLabel || hasAriaLabel || hasAriaLabelledby || hasTitle;

          if (isLabeled) {
            stats.labeled++;
          } else {
            stats.unlabeled++;
            issues.push({
              type: "missing-label",
              tag: input.tagName?.toLowerCase(),
              inputType: input.type,
              name: input.name,
              id: input.id,
              placeholder: hasPlaceholder,
            });
          }
        });

        return { stats, issues };
      },
    });
    return result[0]?.result || { stats: {}, issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function simulateAccessibility(tabId, type) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (simType) => {
        // Remove any existing simulation
        const existingStyle = document.getElementById("a11y-simulation");
        if (existingStyle) existingStyle.remove();

        if (simType === "none" || simType === "reset") {
          return { success: true, message: "Simulation cleared" };
        }

        const style = document.createElement("style");
        style.id = "a11y-simulation";

        const simulations = {
          protanopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="p"><feColorMatrix values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0"/></filter></svg>#p\')',
          deuteranopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="d"><feColorMatrix values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0"/></filter></svg>#d\')',
          tritanopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="t"><feColorMatrix values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0"/></filter></svg>#t\')',
          achromatopsia: "grayscale(100%)",
          "low-contrast": "contrast(0.5)",
          "blur-vision": "blur(2px)",
        };

        const filter = simulations[simType];
        if (!filter) return { error: `Unknown simulation type: ${simType}` };

        style.textContent = `html { filter: ${filter}; }`;
        document.head.appendChild(style);

        return { success: true, type: simType };
      },
      args: [type],
    });
    return result[0]?.result || { error: "Failed to apply simulation" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function runAccessibilityAudit(tabId) {
  try {
    const [headings, labels, altTexts, landmarks, focusOrder, contrast] =
      await Promise.all([
        getHeadingStructure(tabId),
        checkFormLabels(tabId),
        checkAltTexts(tabId),
        getAccessibilityLandmarks(tabId),
        getFocusOrder(tabId),
        checkColorContrast(tabId, null),
      ]);

    const issues = [];
    let score = 100;

    // Heading issues
    if (headings.issues?.length > 0) {
      issues.push(
        ...headings.issues.map((i) => ({ category: "headings", ...i })),
      );
      score -= headings.issues.length * 5;
    }

    // Label issues
    if (labels.issues?.length > 0) {
      issues.push(...labels.issues.map((i) => ({ category: "forms", ...i })));
      score -= labels.issues.length * 10;
    }

    // Alt text issues
    if (altTexts.issues?.length > 0) {
      issues.push(
        ...altTexts.issues.map((i) => ({ category: "images", ...i })),
      );
      score -= altTexts.issues.length * 5;
    }

    // Contrast issues
    if (contrast.issues?.length > 0) {
      issues.push(
        ...contrast.issues.map((i) => ({ category: "contrast", ...i })),
      );
      score -= contrast.issues.length * 3;
    }

    // Check for landmarks
    const hasMain = landmarks.main?.length > 0;
    const hasNav = landmarks.navigation?.length > 0;
    if (!hasMain) {
      issues.push({
        category: "landmarks",
        type: "missing-main",
        message: "Page is missing main landmark",
      });
      score -= 10;
    }
    if (!hasNav) {
      issues.push({
        category: "landmarks",
        type: "missing-nav",
        message: "Page is missing navigation landmark",
      });
      score -= 5;
    }

    return {
      score: Math.max(0, score),
      issues,
      summary: {
        headings: headings.structure?.length || 0,
        focusableElements: focusOrder.elements?.length || 0,
        landmarks: Object.values(landmarks).flat().length,
        images: altTexts.stats?.total || 0,
        formFields: labels.stats?.total || 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

export const accessibilityHandlers = {
  "accessibility.getTree": ({ tabId, selector }) =>
    getAccessibilityTree(tabId, selector),
  "accessibility.getRole": ({ tabId, selector }) =>
    getElementRole(tabId, selector),
  "accessibility.getARIA": ({ tabId, selector }) =>
    getARIAProperties(tabId, selector),
  "accessibility.checkContrast": ({ tabId, selector }) =>
    checkColorContrast(tabId, selector),
  "accessibility.getFocusOrder": ({ tabId }) => getFocusOrder(tabId),
  "accessibility.getLandmarks": ({ tabId }) => getAccessibilityLandmarks(tabId),
  "accessibility.getHeadingStructure": ({ tabId }) =>
    getHeadingStructure(tabId),
  "accessibility.checkAlt": ({ tabId }) => checkAltTexts(tabId),
  "accessibility.checkLabels": ({ tabId }) => checkFormLabels(tabId),
  "accessibility.simulate": ({ tabId, type }) =>
    simulateAccessibility(tabId, type),
  "accessibility.runAudit": ({ tabId }) => runAccessibilityAudit(tabId),
};
