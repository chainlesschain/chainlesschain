"use strict";

/**
 * Phase 6a (2026-05-25) — SignProvider abstract contract for platforms
 * that require per-request signatures (Toutiao `_signature` / Kuaishou
 * `NS_sig3` / Xhs `X-S` / Douyin `X-Bogus`).
 *
 * Mirror of Android-side `pdh/social/SignProvider.kt`. Same 3-method
 * interface so Node API clients can swap impl without changes:
 *
 *   - `signUrl(rawUrl, purpose)` — Some platforms (Toutiao, Kuaishou)
 *     append `_signature=...` / `NS_sig3=...` to the URL itself; this
 *     returns a NEW URL with sig appended, OR `null` if signing failed.
 *
 *   - `signedHeaders(rawUrl, purpose)` — Other platforms (Xhs) leave
 *     the URL alone and put `X-S` / `X-T` / `X-S-Common` in HTTP
 *     headers; this returns an object of header name → value, possibly
 *     empty when signing failed.
 *
 *   - `shutdown()` — Release the WebContentsView / WebView held by the
 *     bridge implementation. Idempotent.
 *
 * **The two methods are independent** — a bridge for Toutiao implements
 * signUrl (URL mutation), Xhs implements signedHeaders (header set).
 * The base abstract returns null/empty for both so subclasses only
 * implement what they need.
 *
 * **`purpose` string** is platform-defined opaque context the JS in the
 * WebContentsView needs to discriminate which signing function to call.
 * For Xhs we encode as `"<pathWithQuery>|<bodyJsonOrEmpty>"`. For
 * Toutiao we use a string like `"feed"` / `"collection"` to pick the
 * acrawler.js entry point. Subclasses define the schema.
 */

/**
 * Abstract base — direct subclassing in JS uses prototypal extension;
 * the methods here are stubs returning null/empty so subclasses can
 * implement only what their platform needs.
 */
class SignProvider {
  /**
   * Sign a URL by appending platform-specific query params (e.g.
   * Toutiao's `_signature`). Returns a new URL string with sig
   * appended, or `null` if signing failed (bridge cold / JS rotated).
   *
   * The caller (api-client) MUST handle `null` by surfacing a
   * lastErrorCode like -99 ("_signature unavailable") and returning
   * empty result for that endpoint, NOT throwing.
   *
   * @param {URL|string} rawUrl  the unsigned URL
   * @param {string} purpose  opaque context for the bridge's JS
   * @returns {Promise<string|null>}  signed URL or null
   */
  async signUrl(_rawUrl, _purpose) {
    return null;
  }

  /**
   * Sign by returning HTTP headers to merge into the request (e.g.
   * Xhs `X-S` / `X-T` / `X-S-Common`). Returns an object — empty
   * map `{}` when signing failed (NOT null) so callers can spread
   * the result unconditionally.
   *
   * @param {URL|string} rawUrl
   * @param {string} purpose
   * @returns {Promise<{[name: string]: string}>}
   */
  async signedHeaders(_rawUrl, _purpose) {
    return {};
  }

  /**
   * Release WebContentsView and any background resources. Idempotent —
   * the api-client calls this in a `finally` so racing shutdowns
   * must not throw.
   */
  async shutdown() {
    // no-op default
  }
}

module.exports = { SignProvider };
