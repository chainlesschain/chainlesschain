/**
 * Accessibility Utilities
 * 无障碍性工具集 - 提升应用的可访问性 (WCAG 2.1 AA)
 *
 * Features:
 * - ARIA attribute management
 * - Keyboard navigation helpers
 * - Focus management
 * - Screen reader announcements
 * - Color contrast checking
 * - Reduced motion detection
 */

class AccessibilityManager {
  constructor(options = {}) {
    // Configuration
    this.options = {
      enableAnnouncements: options.enableAnnouncements !== false,
      enableFocusTrap: options.enableFocusTrap !== false,
      enableKeyboardNav: options.enableKeyboardNav !== false,
      debug: options.debug || false,
    };

    // State
    this.announcerElement = null;
    this.focusHistory = [];
    this.activeFocusTrap = null;

    // Initialize
    this.init();

    if (this.options.debug) {
      console.log("[AccessibilityManager] Initialized");
    }
  }

  /**
   * Initialize accessibility features
   */
  init() {
    if (this.options.enableAnnouncements) {
      this.createAnnouncer();
    }

    // Listen for keyboard navigation
    if (this.options.enableKeyboardNav) {
      this.setupKeyboardNavigation();
    }
  }

  /**
   * Create live region for screen reader announcements
   */
  createAnnouncer() {
    if (this.announcerElement) {return;}

    // 确保 document.body 存在
    if (!document.body) {
      // 延迟到 DOM 加载完成后再创建
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () =>
          this.createAnnouncer(),
        );
      }
      return;
    }

    this.announcerElement = document.createElement("div");
    this.announcerElement.setAttribute("aria-live", "polite");
    this.announcerElement.setAttribute("aria-atomic", "true");
    this.announcerElement.setAttribute("class", "sr-only");
    this.announcerElement.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;

    document.body.appendChild(this.announcerElement);

    if (this.options.debug) {
      console.log("[AccessibilityManager] Created announcer element");
    }
  }

  /**
   * Announce message to screen readers
   * @param {string} message - Message to announce
   * @param {string} priority - 'polite' or 'assertive'
   */
  announce(message, priority = "polite") {
    if (!this.options.enableAnnouncements || !this.announcerElement) {
      return;
    }

    this.announcerElement.setAttribute("aria-live", priority);

    // Clear previous message
    this.announcerElement.textContent = "";

    // Set new message after a brief delay
    setTimeout(() => {
      this.announcerElement.textContent = message;

      if (this.options.debug) {
        console.log(
          `[AccessibilityManager] Announced: "${message}" (${priority})`,
        );
      }
    }, 100);
  }

  /**
   * Focus management
   */

  /**
   * Focus an element with error handling
   * @param {HTMLElement|string} element - Element or selector
   * @param {Object} options - Focus options
   */
  focus(element, options = {}) {
    const el =
      typeof element === "string" ? document.querySelector(element) : element;

    if (!el) {
      console.warn("[AccessibilityManager] Element not found for focusing");
      return false;
    }

    // Save focus history
    if (options.saveFocus !== false) {
      this.focusHistory.push(document.activeElement);
    }

    try {
      el.focus(options.focusOptions || {});

      if (this.options.debug) {
        console.log("[AccessibilityManager] Focused element:", el);
      }

      return true;
    } catch (error) {
      console.error("[AccessibilityManager] Focus error:", error);
      return false;
    }
  }

  /**
   * Restore previous focus
   */
  restoreFocus() {
    if (this.focusHistory.length === 0) {
      return false;
    }

    const previousElement = this.focusHistory.pop();

    if (previousElement && previousElement.focus) {
      previousElement.focus();

      if (this.options.debug) {
        console.log(
          "[AccessibilityManager] Restored focus to:",
          previousElement,
        );
      }

      return true;
    }

    return false;
  }

  /**
   * Focus trap (for modals, dialogs)
   * @param {HTMLElement} container - Container element
   */
  trapFocus(container) {
    if (!this.options.enableFocusTrap) {return;}

    const focusableElements = this.getFocusableElements(container);

    if (focusableElements.length === 0) {
      console.warn("[AccessibilityManager] No focusable elements in container");
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (event) => {
      if (event.key !== "Tab") {return;}

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    // Focus first element
    firstElement.focus();

    // Store trap for cleanup
    this.activeFocusTrap = {
      container,
      handleKeyDown,
    };

    if (this.options.debug) {
      console.log("[AccessibilityManager] Focus trap activated");
    }
  }

  /**
   * Release focus trap
   */
  releaseFocusTrap() {
    if (!this.activeFocusTrap) {return;}

    const { container, handleKeyDown } = this.activeFocusTrap;

    container.removeEventListener("keydown", handleKeyDown);

    this.activeFocusTrap = null;

    if (this.options.debug) {
      console.log("[AccessibilityManager] Focus trap released");
    }
  }

  /**
   * Get all focusable elements within a container
   * @param {HTMLElement} container - Container element
   * @returns {Array} Array of focusable elements
   */
  getFocusableElements(container) {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(", ");

    return Array.from(container.querySelectorAll(selector)).filter((el) => {
      return el.offsetParent !== null && !el.hasAttribute("aria-hidden");
    });
  }

  /**
   * Keyboard navigation
   */

  /**
   * Setup global keyboard navigation
   */
  setupKeyboardNavigation() {
    document.addEventListener("keydown", (event) => {
      // Skip navigation key (usually /)
      if (event.key === "/" && !this.isInputElement(event.target)) {
        event.preventDefault();
        this.announce("Search navigation activated", "polite");
      }

      // Help key (usually ?)
      if (
        event.key === "?" &&
        event.shiftKey &&
        !this.isInputElement(event.target)
      ) {
        event.preventDefault();
        this.showKeyboardShortcuts();
      }
    });

    if (this.options.debug) {
      console.log("[AccessibilityManager] Keyboard navigation setup complete");
    }
  }

  /**
   * Check if element is an input element
   */
  isInputElement(element) {
    const tagName = element.tagName.toLowerCase();
    return (
      ["input", "textarea", "select"].includes(tagName) ||
      element.isContentEditable
    );
  }

  /**
   * Show keyboard shortcuts dialog
   */
  showKeyboardShortcuts() {
    window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));

    if (this.options.debug) {
      console.log("[AccessibilityManager] Keyboard shortcuts dialog triggered");
    }
  }

  /**
   * ARIA helpers
   */

  /**
   * Set ARIA attributes on an element
   * @param {HTMLElement} element - Target element
   * @param {Object} attributes - ARIA attributes
   */
  setAria(element, attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      const ariaKey = key.startsWith("aria-") ? key : `aria-${key}`;
      element.setAttribute(ariaKey, value);
    });

    if (this.options.debug) {
      console.log("[AccessibilityManager] Set ARIA attributes:", attributes);
    }
  }

  /**
   * Create accessible button
   * @param {Object} config - Button configuration
   * @returns {HTMLButtonElement}
   */
  createAccessibleButton(config) {
    const { text, ariaLabel, onClick, className } = config;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.className = className || "";

    if (ariaLabel) {
      button.setAttribute("aria-label", ariaLabel);
    }

    if (onClick) {
      button.addEventListener("click", onClick);
    }

    return button;
  }

  /**
   * Color contrast checking
   */

  /**
   * Check if color contrast meets WCAG AA standard
   * @param {string} foreground - Foreground color (hex)
   * @param {string} background - Background color (hex)
   * @returns {Object} Contrast ratio and pass/fail status
   */
  checkContrast(foreground, background) {
    const fgLuminance = this.getLuminance(foreground);
    const bgLuminance = this.getLuminance(background);

    const lighter = Math.max(fgLuminance, bgLuminance);
    const darker = Math.min(fgLuminance, bgLuminance);

    const ratio = (lighter + 0.05) / (darker + 0.05);

    return {
      ratio: ratio.toFixed(2),
      AA: ratio >= 4.5, // WCAG AA normal text
      AALarge: ratio >= 3, // WCAG AA large text
      AAA: ratio >= 7, // WCAG AAA normal text
      AAALarge: ratio >= 4.5, // WCAG AAA large text
    };
  }

  /**
   * Get relative luminance of a color
   * @param {string} hex - Hex color code
   * @returns {number} Luminance value
   */
  getLuminance(hex) {
    const rgb = this.hexToRgb(hex);

    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
      const sRGB = val / 255;

      return sRGB <= 0.03928
        ? sRGB / 12.92
        : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Convert hex color to RGB
   * @param {string} hex - Hex color code
   * @returns {Object} RGB values
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  /**
   * Utility functions
   */

  /**
   * Check if reduced motion is preferred
   * @returns {boolean}
   */
  prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Check if high contrast is preferred
   * @returns {boolean}
   */
  prefersHighContrast() {
    return window.matchMedia("(prefers-contrast: high)").matches;
  }

  /**
   * Get current color scheme preference
   * @returns {string} 'light' or 'dark'
   */
  getColorSchemePreference() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    if (this.announcerElement) {
      this.announcerElement.remove();
      this.announcerElement = null;
    }

    this.releaseFocusTrap();
    this.focusHistory = [];

    if (this.options.debug) {
      console.log("[AccessibilityManager] Destroyed");
    }
  }
}

// Singleton instance
let managerInstance = null;

/**
 * Get or create accessibility manager instance
 */
export function getAccessibilityManager(options) {
  if (!managerInstance) {
    managerInstance = new AccessibilityManager(options);
  }
  return managerInstance;
}

/**
 * Convenience functions
 */
export function announce(message, priority) {
  const manager = getAccessibilityManager();
  return manager.announce(message, priority);
}

export function checkContrast(fg, bg) {
  const manager = getAccessibilityManager();
  return manager.checkContrast(fg, bg);
}

export function trapFocus(container) {
  const manager = getAccessibilityManager();
  return manager.trapFocus(container);
}

export function releaseFocusTrap() {
  const manager = getAccessibilityManager();
  return manager.releaseFocusTrap();
}

export default AccessibilityManager;
