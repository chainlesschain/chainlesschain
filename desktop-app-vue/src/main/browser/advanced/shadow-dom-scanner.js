/**
 * Shadow DOM Scanner - Traverse and interact with Shadow DOM elements
 *
 * @module browser/advanced/shadow-dom-scanner
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { logger } = require("../../utils/logger");

/**
 * Shadow DOM Scanner
 * Recursively scans through Shadow DOM boundaries
 */
class ShadowDOMScanner {
  constructor(browserEngine) {
    this.browserEngine = browserEngine;
  }

  /**
   * Scan page including Shadow DOM elements
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Scan options
   * @returns {Promise<Object>} Scan result with flattened elements
   */
  async scan(targetId, options = {}) {
    const page = this.browserEngine.getPage(targetId);
    const {
      maxDepth = 10,
      includeHidden = false,
      rootSelector = "body",
    } = options;

    try {
      const result = await page.evaluate(
        ({ rootSel, maxDepth, includeHidden }) => {
          const elements = [];
          let refCounter = 0;

          function scanElement(element, depth, shadowPath = []) {
            if (depth > maxDepth) {
              return;
            }

            // Process current element
            const rect = element.getBoundingClientRect();
            const styles = window.getComputedStyle(element);
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              styles.visibility !== "hidden" &&
              styles.display !== "none";

            if (!includeHidden && !isVisible) {
              return;
            }

            const refId = `e${refCounter++}`;

            // Build selector path including shadow boundaries
            const selectorPath = [...shadowPath];
            if (element.id) {
              selectorPath.push(`#${element.id}`);
            } else {
              const index = Array.from(
                element.parentElement?.children || [],
              ).indexOf(element);
              selectorPath.push(
                `${element.tagName.toLowerCase()}:nth-child(${index + 1})`,
              );
            }

            elements.push({
              ref: refId,
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role") || inferRole(element),
              label: getAccessibleName(element),
              selector: buildSelector(element),
              shadowPath: shadowPath.length > 0 ? shadowPath : null,
              inShadow: shadowPath.length > 0,
              position: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              attributes: getAttributes(element),
              clickable: isClickable(element),
              visible: isVisible,
            });

            // Scan children
            for (const child of element.children) {
              scanElement(child, depth, shadowPath);
            }

            // Scan shadow root if present
            if (element.shadowRoot) {
              const newShadowPath = [
                ...shadowPath,
                buildSelector(element) + "::shadow",
              ];
              for (const shadowChild of element.shadowRoot.children) {
                scanElement(shadowChild, depth + 1, newShadowPath);
              }
            }
          }

          function inferRole(el) {
            const tagRoles = {
              button: "button",
              a: "link",
              input:
                el.type === "checkbox"
                  ? "checkbox"
                  : el.type === "radio"
                    ? "radio"
                    : el.type === "submit"
                      ? "button"
                      : "textbox",
              select: "combobox",
              textarea: "textbox",
              nav: "navigation",
              main: "main",
              header: "banner",
              footer: "contentinfo",
              aside: "complementary",
              article: "article",
              section: "region",
              form: "form",
              table: "table",
              img: "img",
            };
            return tagRoles[el.tagName.toLowerCase()] || "";
          }

          function getAccessibleName(el) {
            return (
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              el.getAttribute("placeholder") ||
              el.getAttribute("alt") ||
              (el.tagName.toLowerCase() === "img"
                ? ""
                : el.textContent?.trim().substring(0, 100)) ||
              ""
            );
          }

          function buildSelector(el) {
            if (el.id) {
              return `#${el.id}`;
            }

            const parts = [];
            let current = el;

            while (current && current !== document.body) {
              let selector = current.tagName.toLowerCase();

              if (current.id) {
                parts.unshift(`#${current.id}`);
                break;
              }

              const siblings = Array.from(
                current.parentElement?.children || [],
              ).filter((s) => s.tagName === current.tagName);

              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
              }

              parts.unshift(selector);
              current = current.parentElement;
            }

            return parts.join(" > ");
          }

          function getAttributes(el) {
            const result = {};
            const keep = [
              "id",
              "class",
              "name",
              "type",
              "href",
              "src",
              "value",
              "placeholder",
              "data-testid",
              "data-id",
            ];

            for (const attr of el.attributes) {
              if (keep.includes(attr.name) || attr.name.startsWith("aria-")) {
                result[attr.name] = attr.value;
              }
            }
            return result;
          }

          function isClickable(el) {
            const clickableTags = [
              "a",
              "button",
              "input",
              "select",
              "textarea",
            ];
            return (
              clickableTags.includes(el.tagName.toLowerCase()) ||
              el.getAttribute("role") === "button" ||
              el.getAttribute("onclick") !== null ||
              el.getAttribute("tabindex") !== null ||
              el.getAttribute("contenteditable") === "true"
            );
          }

          // Start scan
          const root = document.querySelector(rootSel) || document.body;
          scanElement(root, 0);

          // Count shadow hosts
          const shadowHosts = elements.filter((e) => e.inShadow).length;

          return {
            elements,
            totalCount: elements.length,
            shadowElementsCount: shadowHosts,
            maxDepthReached: elements.some(
              (e) => (e.shadowPath?.length || 0) >= maxDepth,
            ),
          };
        },
        { rootSel: rootSelector, maxDepth, includeHidden },
      );

      logger.info("[ShadowDOMScanner] Scan completed", {
        targetId,
        totalElements: result.totalCount,
        shadowElements: result.shadowElementsCount,
      });

      return result;
    } catch (error) {
      logger.error("[ShadowDOMScanner] Scan failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Find element within Shadow DOM
   * @param {string} targetId - Browser tab ID
   * @param {string} ref - Element reference
   * @param {Array} shadowPath - Path through shadow boundaries
   * @returns {Promise<Object>} Element locator
   */
  async findInShadow(targetId, ref, shadowPath = []) {
    const page = this.browserEngine.getPage(targetId);

    if (!shadowPath || shadowPath.length === 0) {
      // Regular element lookup
      return page.locator(ref);
    }

    // Navigate through shadow boundaries
    let locator = page.locator(shadowPath[0].replace("::shadow", ""));

    for (let i = 1; i < shadowPath.length; i++) {
      const path = shadowPath[i];
      if (path.endsWith("::shadow")) {
        // Access shadow root
        const selector = path.replace("::shadow", "");
        locator = locator.locator(selector);
      } else {
        locator = locator.locator(path);
      }
    }

    return locator.locator(ref);
  }

  /**
   * Get all shadow hosts on the page
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<Array>} Shadow host elements
   */
  async getShadowHosts(targetId) {
    const page = this.browserEngine.getPage(targetId);

    return page.evaluate(() => {
      const hosts = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null,
        false,
      );

      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          const rect = node.getBoundingClientRect();
          hosts.push({
            tag: node.tagName.toLowerCase(),
            id: node.id || null,
            className: node.className || null,
            position: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            shadowChildCount: node.shadowRoot.children.length,
          });
        }
      }

      return hosts;
    });
  }

  /**
   * Check if element is inside Shadow DOM
   * @param {string} targetId - Browser tab ID
   * @param {string} selector - Element selector
   * @returns {Promise<boolean>}
   */
  async isInShadowDOM(targetId, selector) {
    const page = this.browserEngine.getPage(targetId);

    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) {
        return false;
      }

      let current = el;
      while (current) {
        if (current.getRootNode() instanceof ShadowRoot) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }, selector);
  }
}

module.exports = { ShadowDOMScanner };
