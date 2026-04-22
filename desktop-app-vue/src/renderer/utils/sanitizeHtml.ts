/**
 * Shared HTML sanitization helpers.
 *
 * Use `safeHtml()` whenever untrusted or semi-trusted HTML needs to be
 * rendered via `v-html`. The renderer bundles DOMPurify (see
 * package.json "dompurify"), which strips `<script>`, inline event
 * handlers, `javascript:` URLs, and other XSS vectors while preserving
 * structural markdown tags.
 *
 * `escapeHtml()` returns a plain-text-safe string for cases where the
 * input should render literally (e.g. search-result previews that
 * accept arbitrary user queries).
 */

import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";

export interface SafeHtmlOptions {
  /** Extra tags to allow beyond DOMPurify's default whitelist. */
  allowedTags?: string[];
  /** Extra attributes to allow beyond DOMPurify's default whitelist. */
  allowedAttrs?: string[];
  /** If true, strip all tags and return text only (use sparingly). */
  textOnly?: boolean;
}

export function safeHtml(
  html: string | null | undefined,
  options: SafeHtmlOptions = {},
): string {
  if (html == null) return "";
  const input = String(html);
  // DOMPurify's overload with RETURN_TRUSTED_TYPE returns TrustedHTML; we
  // explicitly opt out to keep a plain string for v-html consumers.
  const config: DOMPurifyConfig = { RETURN_TRUSTED_TYPE: false };
  if (options.textOnly) {
    config.ALLOWED_TAGS = [];
    config.ALLOWED_ATTR = [];
  } else {
    if (options.allowedTags) config.ADD_TAGS = options.allowedTags;
    if (options.allowedAttrs) config.ADD_ATTR = options.allowedAttrs;
  }
  return DOMPurify.sanitize(input, config) as unknown as string;
}

export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape a string so it can be used inside a regular expression.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
