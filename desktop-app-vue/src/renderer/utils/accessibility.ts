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

import { logger } from "@/utils/logger";

// ==================== 类型定义 ====================

/**
 * 可访问性管理器配置选项
 */
export interface AccessibilityOptions {
  enableAnnouncements?: boolean;
  enableFocusTrap?: boolean;
  enableKeyboardNav?: boolean;
  debug?: boolean;
}

/**
 * 聚焦选项
 */
export interface AccessibilityFocusOptions {
  saveFocus?: boolean;
  focusOptions?: globalThis.FocusOptions;
}

/**
 * 按钮配置
 */
export interface AccessibleButtonConfig {
  text: string;
  ariaLabel?: string;
  onClick?: ((event: MouseEvent) => void) | null;
  className?: string;
}

/**
 * 对比度检查结果
 */
export interface ContrastResult {
  ratio: string;
  AA: boolean;
  AALarge: boolean;
  AAA: boolean;
  AAALarge: boolean;
}

/**
 * RGB 颜色值
 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * 焦点陷阱状态
 */
interface FocusTrapState {
  container: HTMLElement;
  handleKeyDown: (event: KeyboardEvent) => void;
  previousElement: HTMLElement | null;
}

const MAX_FOCUS_HISTORY = 32;

// ==================== 类实现 ====================

class AccessibilityManager {
  private options: Required<AccessibilityOptions>;
  private announcerElement: HTMLDivElement | null;
  private focusHistory: Element[];
  private activeFocusTrap: FocusTrapState | null;
  private keyboardNavigationHandler: ((event: KeyboardEvent) => void) | null;
  private domReadyHandler: (() => void) | null;
  private announcementTimer: ReturnType<typeof setTimeout> | null;
  private destroyed: boolean;

  constructor(options: AccessibilityOptions = {}) {
    this.options = {
      enableAnnouncements: options.enableAnnouncements !== false,
      enableFocusTrap: options.enableFocusTrap !== false,
      enableKeyboardNav: options.enableKeyboardNav !== false,
      debug: options.debug || false,
    };

    this.announcerElement = null;
    this.focusHistory = [];
    this.activeFocusTrap = null;
    this.keyboardNavigationHandler = null;
    this.domReadyHandler = null;
    this.announcementTimer = null;
    this.destroyed = false;

    this.init();

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Initialized");
    }
  }

  /**
   * Initialize accessibility features
   */
  private init(): void {
    if (this.options.enableAnnouncements) {
      this.createAnnouncer();
    }

    if (this.options.enableKeyboardNav) {
      this.setupKeyboardNavigation();
    }
  }

  /**
   * Create live region for screen reader announcements
   */
  private createAnnouncer(): void {
    if (this.destroyed || this.announcerElement) return;

    if (!document.body) {
      if (document.readyState === "loading" && !this.domReadyHandler) {
        this.domReadyHandler = () => {
          this.domReadyHandler = null;
          this.createAnnouncer();
        };
        document.addEventListener("DOMContentLoaded", this.domReadyHandler, {
          once: true,
        });
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
      logger.info("[AccessibilityManager] Created announcer element");
    }
  }

  /**
   * Announce message to screen readers
   */
  announce(message: string, priority: "polite" | "assertive" = "polite"): void {
    if (!this.options.enableAnnouncements || !this.announcerElement) {
      return;
    }

    this.announcerElement.setAttribute("aria-live", priority);
    this.announcerElement.textContent = "";

    if (this.announcementTimer) clearTimeout(this.announcementTimer);
    this.announcementTimer = setTimeout(() => {
      this.announcementTimer = null;
      if (this.announcerElement) {
        this.announcerElement.textContent = message;

        if (this.options.debug) {
          logger.info(
            `[AccessibilityManager] Announced: "${message}" (${priority})`,
          );
        }
      }
    }, 100);
  }

  /**
   * Focus an element with error handling
   */
  focus(
    element: HTMLElement | string,
    options: AccessibilityFocusOptions = {},
  ): boolean {
    const el =
      typeof element === "string"
        ? document.querySelector<HTMLElement>(element)
        : element;

    if (!el) {
      logger.warn("[AccessibilityManager] Element not found for focusing");
      return false;
    }

    const previousElement =
      options.saveFocus !== false &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.isConnected &&
      document.activeElement !== el
        ? document.activeElement
        : null;

    try {
      el.focus(options.focusOptions || {});
      if (document.activeElement !== el) return false;

      if (previousElement) {
        this.focusHistory.push(previousElement);
        if (this.focusHistory.length > MAX_FOCUS_HISTORY) {
          this.focusHistory.splice(
            0,
            this.focusHistory.length - MAX_FOCUS_HISTORY,
          );
        }
      }

      if (this.options.debug) {
        logger.info("[AccessibilityManager] Focused element:", el);
      }

      return true;
    } catch (error) {
      logger.error("[AccessibilityManager] Focus error:", error);
      return false;
    }
  }

  /**
   * Restore previous focus
   */
  restoreFocus(): boolean {
    while (this.focusHistory.length > 0) {
      const previousElement = this.focusHistory.pop();
      if (
        !(previousElement instanceof HTMLElement) ||
        !previousElement.isConnected
      ) {
        continue;
      }
      try {
        previousElement.focus();
        if (document.activeElement !== previousElement) continue;
        if (this.options.debug) {
          logger.info(
            "[AccessibilityManager] Restored focus to:",
            previousElement,
          );
        }
        return true;
      } catch (error) {
        logger.error("[AccessibilityManager] Focus restore error:", error);
      }
    }
    return false;
  }

  /**
   * Focus trap (for modals, dialogs)
   */
  trapFocus(container: HTMLElement): void {
    if (!this.options.enableFocusTrap) return;

    this.releaseFocusTrap();

    const focusableElements = this.getFocusableElements(container);

    if (focusableElements.length === 0) {
      logger.warn("[AccessibilityManager] No focusable elements in container");
      return;
    }

    const firstElement = focusableElements[0];
    const previousElement =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.isConnected
        ? document.activeElement
        : null;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;

      const currentElements = this.getFocusableElements(container);
      if (currentElements.length === 0) return;
      const currentFirst = currentElements[0];
      const currentLast = currentElements[currentElements.length - 1];
      const activeElement = document.activeElement;

      if (!container.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? currentLast : currentFirst).focus();
        return;
      }

      if (event.shiftKey) {
        if (activeElement === currentFirst) {
          event.preventDefault();
          currentLast.focus();
        }
      } else {
        if (activeElement === currentLast) {
          event.preventDefault();
          currentFirst.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    firstElement.focus();

    this.activeFocusTrap = {
      container,
      handleKeyDown,
      previousElement,
    };

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Focus trap activated");
    }
  }

  /**
   * Release focus trap
   */
  releaseFocusTrap(): void {
    if (!this.activeFocusTrap) return;

    const { container, handleKeyDown, previousElement } = this.activeFocusTrap;

    container.removeEventListener("keydown", handleKeyDown);

    this.activeFocusTrap = null;

    if (previousElement?.isConnected) {
      try {
        previousElement.focus();
      } catch (error) {
        logger.error("[AccessibilityManager] Focus trap restore error:", error);
      }
    }

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Focus trap released");
    }
  }

  /**
   * Get all focusable elements within a container
   */
  getFocusableElements(container: HTMLElement): HTMLElement[] {
    const selector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[contenteditable]:not([contenteditable="false"])',
      "audio[controls]",
      "video[controls]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(", ");

    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => {
        const style = window.getComputedStyle(el);
        return (
          el.isConnected &&
          el.tabIndex >= 0 &&
          !el.matches(":disabled") &&
          !el.hidden &&
          !el.closest('[inert], [aria-hidden="true"]') &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      },
    );
  }

  /**
   * Setup global keyboard navigation
   */
  private setupKeyboardNavigation(): void {
    if (this.keyboardNavigationHandler) return;
    this.keyboardNavigationHandler = (event) => {
      if (event.key === "/" && !this.isInputElement(event.target)) {
        event.preventDefault();
        this.announce("Search navigation activated", "polite");
      }

      if (
        event.key === "?" &&
        event.shiftKey &&
        !this.isInputElement(event.target)
      ) {
        event.preventDefault();
        this.showKeyboardShortcuts();
      }
    };
    document.addEventListener("keydown", this.keyboardNavigationHandler);

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Keyboard navigation setup complete");
    }
  }

  /**
   * Check if element is an input element
   */
  private isInputElement(element: EventTarget | null): boolean {
    if (!(element instanceof HTMLElement)) return false;

    const tagName = element.tagName.toLowerCase();
    return (
      ["input", "textarea", "select"].includes(tagName) ||
      element.isContentEditable
    );
  }

  /**
   * Show keyboard shortcuts dialog
   */
  private showKeyboardShortcuts(): void {
    window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Keyboard shortcuts dialog triggered");
    }
  }

  /**
   * Set ARIA attributes on an element
   */
  setAria(element: HTMLElement, attributes: Record<string, string>): void {
    Object.entries(attributes).forEach(([key, value]) => {
      const ariaKey = key.startsWith("aria-") ? key : `aria-${key}`;
      element.setAttribute(ariaKey, value);
    });

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Set ARIA attributes:", attributes);
    }
  }

  /**
   * Create accessible button
   */
  createAccessibleButton(config: AccessibleButtonConfig): HTMLButtonElement {
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
   * Check if color contrast meets WCAG AA standard
   */
  checkContrast(foreground: string, background: string): ContrastResult {
    const fgLuminance = this.getLuminance(foreground);
    const bgLuminance = this.getLuminance(background);

    const lighter = Math.max(fgLuminance, bgLuminance);
    const darker = Math.min(fgLuminance, bgLuminance);

    const ratio = (lighter + 0.05) / (darker + 0.05);

    return {
      ratio: ratio.toFixed(2),
      AA: ratio >= 4.5,
      AALarge: ratio >= 3,
      AAA: ratio >= 7,
      AAALarge: ratio >= 4.5,
    };
  }

  /**
   * Get relative luminance of a color
   */
  private getLuminance(hex: string): number {
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
   */
  private hexToRgb(hex: string): RGBColor {
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
   * Check if reduced motion is preferred
   */
  prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Check if high contrast is preferred
   */
  prefersHighContrast(): boolean {
    return window.matchMedia("(prefers-contrast: high)").matches;
  }

  /**
   * Get current color scheme preference
   */
  getColorSchemePreference(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.destroyed = true;

    if (this.domReadyHandler) {
      document.removeEventListener("DOMContentLoaded", this.domReadyHandler);
      this.domReadyHandler = null;
    }

    if (this.announcementTimer) {
      clearTimeout(this.announcementTimer);
      this.announcementTimer = null;
    }

    if (this.announcerElement) {
      this.announcerElement.remove();
      this.announcerElement = null;
    }

    this.releaseFocusTrap();
    this.focusHistory = [];

    if (this.keyboardNavigationHandler) {
      document.removeEventListener("keydown", this.keyboardNavigationHandler);
      this.keyboardNavigationHandler = null;
    }

    if (managerInstance === this) {
      managerInstance = null;
    }

    if (this.options.debug) {
      logger.info("[AccessibilityManager] Destroyed");
    }
  }
}

// Singleton instance
let managerInstance: AccessibilityManager | null = null;

/**
 * Get or create accessibility manager instance
 */
export function getAccessibilityManager(
  options?: AccessibilityOptions,
): AccessibilityManager {
  if (!managerInstance) {
    managerInstance = new AccessibilityManager(options);
  }
  return managerInstance;
}

/**
 * Convenience functions
 */
export function announce(
  message: string,
  priority?: "polite" | "assertive",
): void {
  const manager = getAccessibilityManager();
  return manager.announce(message, priority);
}

export function checkContrast(fg: string, bg: string): ContrastResult {
  const manager = getAccessibilityManager();
  return manager.checkContrast(fg, bg);
}

export function trapFocus(container: HTMLElement): void {
  const manager = getAccessibilityManager();
  return manager.trapFocus(container);
}

export function releaseFocusTrap(): void {
  const manager = getAccessibilityManager();
  return manager.releaseFocusTrap();
}

export default AccessibilityManager;
