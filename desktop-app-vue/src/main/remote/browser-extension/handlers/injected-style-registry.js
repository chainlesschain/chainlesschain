import { utf8ByteLength } from "./heap-snapshot-boundary.js";

const KIB = 1024;
const MIB = KIB * KIB;
const RETRY_AFTER_MS = 1000;

export const DEFAULT_INJECTED_STYLE_LIMITS = Object.freeze({
  maxTabs: 32,
  maxStylesPerTab: 64,
  maxBytesPerStyle: 256 * KIB,
  maxBytesPerTab: 2 * MIB,
  maxTotalBytes: 16 * MIB,
});

export const HARD_INJECTED_STYLE_LIMITS = Object.freeze({
  maxTabs: 256,
  maxStylesPerTab: 512,
  maxBytesPerStyle: MIB,
  maxBytesPerTab: 16 * MIB,
  maxTotalBytes: 128 * MIB,
});

function normalizeLimit(value, fallback, hardLimit) {
  let numericValue;
  try {
    numericValue = Number(value);
  } catch {
    return fallback;
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numericValue), hardLimit);
}

function overloaded(error, scope, limit) {
  return {
    accepted: false,
    error,
    code: "OVERLOADED",
    scope,
    retryAfterMs: RETRY_AFTER_MS,
    limit,
  };
}

export class InjectedStyleRegistry {
  constructor(options = {}) {
    const maxBytesPerStyle = normalizeLimit(
      options.maxBytesPerStyle,
      DEFAULT_INJECTED_STYLE_LIMITS.maxBytesPerStyle,
      HARD_INJECTED_STYLE_LIMITS.maxBytesPerStyle,
    );
    const maxBytesPerTab = Math.max(
      maxBytesPerStyle,
      normalizeLimit(
        options.maxBytesPerTab,
        DEFAULT_INJECTED_STYLE_LIMITS.maxBytesPerTab,
        HARD_INJECTED_STYLE_LIMITS.maxBytesPerTab,
      ),
    );
    this.limits = Object.freeze({
      maxTabs: normalizeLimit(
        options.maxTabs,
        DEFAULT_INJECTED_STYLE_LIMITS.maxTabs,
        HARD_INJECTED_STYLE_LIMITS.maxTabs,
      ),
      maxStylesPerTab: normalizeLimit(
        options.maxStylesPerTab,
        DEFAULT_INJECTED_STYLE_LIMITS.maxStylesPerTab,
        HARD_INJECTED_STYLE_LIMITS.maxStylesPerTab,
      ),
      maxBytesPerStyle,
      maxBytesPerTab,
      maxTotalBytes: Math.max(
        maxBytesPerTab,
        normalizeLimit(
          options.maxTotalBytes,
          DEFAULT_INJECTED_STYLE_LIMITS.maxTotalBytes,
          HARD_INJECTED_STYLE_LIMITS.maxTotalBytes,
        ),
      ),
    });
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.tabs = new Map();
    this.totalBytes = 0;
    this.sequence = 0;
  }

  reserve(tabId, css, origin = "USER") {
    if (typeof css !== "string") {
      return {
        accepted: false,
        error: "Injected CSS must be a string",
        code: "INVALID_ARGUMENT",
      };
    }
    if (origin !== "USER" && origin !== "AUTHOR") {
      return {
        accepted: false,
        error: "CSS origin must be USER or AUTHOR",
        code: "INVALID_ARGUMENT",
      };
    }
    const bytes = utf8ByteLength(css);
    if (bytes > this.limits.maxBytesPerStyle) {
      return overloaded("Injected CSS is too large", "css_style_bytes", {
        maxBytesPerStyle: this.limits.maxBytesPerStyle,
      });
    }

    let state = this.tabs.get(tabId);
    if (!state && this.tabs.size >= this.limits.maxTabs) {
      return overloaded("Injected CSS tab capacity exceeded", "css_tabs", {
        maxTabs: this.limits.maxTabs,
      });
    }
    if (state && state.styles.size >= this.limits.maxStylesPerTab) {
      return overloaded(
        "Injected CSS capacity exceeded for this tab",
        "css_styles_tab",
        {
          maxStylesPerTab: this.limits.maxStylesPerTab,
        },
      );
    }
    if ((state?.retainedBytes || 0) + bytes > this.limits.maxBytesPerTab) {
      return overloaded(
        "Injected CSS bytes exceeded for this tab",
        "css_tab_bytes",
        {
          maxBytesPerTab: this.limits.maxBytesPerTab,
        },
      );
    }
    if (this.totalBytes + bytes > this.limits.maxTotalBytes) {
      return overloaded("Injected CSS global bytes exceeded", "css_bytes", {
        maxTotalBytes: this.limits.maxTotalBytes,
      });
    }

    if (!state) {
      state = { tabId, styles: new Map(), retainedBytes: 0 };
      this.tabs.set(tabId, state);
    }
    const timestamp = this.now();
    this.sequence += 1;
    const cssId = `chainlesschain-css-${timestamp}-${this.sequence}`;
    const reservation = Object.freeze({
      id: Symbol("injected-style-reservation"),
      tabId,
      cssId,
    });
    state.styles.set(cssId, {
      reservation,
      css,
      origin,
      bytes,
      status: "pending",
    });
    state.retainedBytes += bytes;
    this.totalBytes += bytes;
    return { accepted: true, reservation, cssId, bytes };
  }

  markActive(reservation) {
    const style = this.styleForReservation(reservation);
    if (!style || style.status !== "pending") {
      return false;
    }
    style.status = "active";
    return true;
  }

  rollback(reservation) {
    const style = this.styleForReservation(reservation);
    return style ? this.removeStyle(reservation.tabId, style) : false;
  }

  beginRemove(tabId, cssId) {
    const style = this.tabs.get(tabId)?.styles.get(cssId);
    if (!style) {
      return { accepted: false, code: "CSS_STYLE_NOT_FOUND" };
    }
    if (style.status !== "active") {
      return {
        accepted: false,
        error: `Injected CSS is ${style.status}`,
        code: "CSS_STYLE_BUSY",
        retryAfterMs: RETRY_AFTER_MS,
      };
    }
    style.status = "removing";
    return {
      accepted: true,
      removal: Object.freeze({
        reservation: style.reservation,
        tabId,
        cssId,
        css: style.css,
        origin: style.origin,
      }),
    };
  }

  cancelRemove(reservation) {
    const style = this.styleForReservation(reservation);
    if (!style || style.status !== "removing") {
      return false;
    }
    style.status = "active";
    return true;
  }

  completeRemove(reservation) {
    const style = this.styleForReservation(reservation);
    return style ? this.removeStyle(reservation.tabId, style) : false;
  }

  clearTab(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) {
      return false;
    }
    this.totalBytes -= state.retainedBytes;
    this.tabs.delete(tabId);
    return true;
  }

  getStats() {
    return {
      retainedTabs: this.tabs.size,
      retainedStyles: [...this.tabs.values()].reduce(
        (count, state) => count + state.styles.size,
        0,
      ),
      totalBytes: this.totalBytes,
      limits: this.limits,
    };
  }

  getTab(tabId) {
    const state = this.tabs.get(tabId);
    return state
      ? {
          retainedBytes: state.retainedBytes,
          styles: [...state.styles.entries()].map(([cssId, style]) => ({
            cssId,
            origin: style.origin,
            bytes: style.bytes,
            status: style.status,
          })),
        }
      : { retainedBytes: 0, styles: [] };
  }

  styleForReservation(reservation) {
    if (!reservation) {
      return null;
    }
    const style = this.tabs
      .get(reservation.tabId)
      ?.styles.get(reservation.cssId);
    return style?.reservation === reservation ? style : null;
  }

  removeStyle(tabId, style) {
    const state = this.tabs.get(tabId);
    if (!state || !state.styles.delete(style.reservation.cssId)) {
      return false;
    }
    state.retainedBytes -= style.bytes;
    this.totalBytes -= style.bytes;
    if (state.styles.size === 0) {
      this.tabs.delete(tabId);
    }
    return true;
  }
}
