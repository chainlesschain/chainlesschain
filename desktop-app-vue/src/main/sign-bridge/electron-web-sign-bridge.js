"use strict";

/**
 * Phase 6a (2026-05-25) — Abstract base for "run platform signing JS in
 * a hidden Electron WebContentsView" providers.
 *
 * Node + Electron port of `android-app/.../pdh/social/WebSignBridge.kt`.
 * Same lifecycle (warmUp → signUrl/signedHeaders → shutdown), same
 * cookie injection model, same JS-eval ↔ Promise bridging, same
 * mutex-serialized eval. Subclasses implement [homepageUrl],
 * [cookieDomain], [buildSignScript].
 *
 * **Why a hidden WebContentsView and not pure-Node md5 / md5+xor**:
 *  - acrawler.js / mssdk.js / NS_sig3 / xhs.js all rotate their
 *    function names + algos every 4-8 weeks. A pure-Node port would
 *    break monthly. Running the platform's own JS means we ride
 *    whatever the live site uses today.
 *  - The JS reads navigator/window state that we'd otherwise fake
 *    (Battery API, AudioContext fingerprint, Canvas 2D draw). The
 *    WebContentsView provides all of those for free.
 *
 * **Memory**: a hidden WebContentsView holds ~30-50MB. Caller MUST call
 * [shutdown] at end of snapshot (try/finally pattern from collector).
 * Re-warming costs ~3-5s next call; cheaper than keeping alive forever
 * and leaking across renderer reloads.
 *
 * **Concurrency**: all JS eval serialized via internal Mutex so racing
 * signUrl calls don't trip the platform SDK's per-host state machine.
 *
 * **WebContentsView vs BrowserView**: Electron 32+ deprecated
 * BrowserView in favor of WebContentsView. Project on Electron 39 —
 * use WebContentsView directly.
 *
 * Test seam: callers can inject `opts._electron` (mocked module with
 * WebContentsView + session APIs) for JVM-equivalent unit testing
 * without spawning a real Chromium process.
 */

class ElectronWebSignBridge {
  /**
   * @param {{
   *   electron?: any,        // injected for tests; defaults to require("electron")
   *   warmUpTimeoutMs?: number,
   *   evalTimeoutMs?: number,
   *   onWarn?: (msg: string) => void,
   * }} [opts]
   */
  constructor(opts = {}) {
    // Honor explicit `electron: null` from tests; only auto-require when
    // the caller didn't specify (so tests can simulate "no electron in
    // context" without depending on resolution behavior).
    this._electron = "electron" in opts ? opts.electron : tryRequireElectron();
    this._warmUpTimeoutMs = opts.warmUpTimeoutMs || 15_000;
    this._evalTimeoutMs = opts.evalTimeoutMs || 5_000;
    this._onWarn = opts.onWarn || (() => {});
    /** @type {any|null} the WebContentsView instance, or null when cold/shutdown */
    this._view = null;
    /** Mutex implemented via promise chain (single-slot). */
    this._evalChain = Promise.resolve();
    /** Set true once warmUp completed; reset on shutdown. */
    this._warm = false;
  }

  /**
   * Subclass MUST override — the platform homepage where the signing JS
   * lives. E.g. `"https://www.xiaohongshu.com/explore"`.
   */
  get homepageUrl() {
    throw new Error(
      "ElectronWebSignBridge: subclass must override homepageUrl getter",
    );
  }

  /**
   * Subclass MUST override — the cookie domain to inject the captured
   * cookie under. E.g. `".xiaohongshu.com"` (leading dot enables
   * cross-subdomain match).
   */
  get cookieDomain() {
    throw new Error(
      "ElectronWebSignBridge: subclass must override cookieDomain getter",
    );
  }

  /**
   * Extra delay after `did-finish-load` before we accept signing calls.
   * Many anti-bot SDKs init via async XHR / setTimeout chained after
   * `onPageFinished` — we wait this long to let them settle.
   * Default 2000ms; Xhs needs 2500ms (verified). Subclass override.
   */
  get postLoadDelayMs() {
    return 2000;
  }

  /**
   * Build the JS expression the WebContentsView's `executeJavaScript`
   * will run. MUST evaluate to a string (URL with sig appended, or a
   * JSON-encoded headers object) or `null`. Subclasses define the
   * candidate function names + how to call them.
   *
   * @param {string} rawUrl
   * @param {string} purpose  opaque per-platform context
   * @returns {string}  the JS expression
   */
  buildSignScript(_rawUrl, _purpose) {
    throw new Error(
      "ElectronWebSignBridge: subclass must override buildSignScript()",
    );
  }

  /**
   * Lazy warm-up. First call creates the WebContentsView, injects
   * cookies, navigates to homepage, waits for did-finish-load +
   * postLoadDelayMs. Subsequent calls fast-path.
   *
   * @param {string} cookie  full Cookie header (as captured)
   * @returns {Promise<void>}  resolves when bridge is ready
   * @throws  on timeout / WebContentsView creation failure
   */
  async warmUp(cookie) {
    if (this._warm) {
      return;
    }
    if (!this._electron) {
      throw new Error(
        "ElectronWebSignBridge.warmUp: electron module not available (only desktop main process supports this bridge)",
      );
    }
    const { WebContentsView, session } = this._electron;
    if (!WebContentsView) {
      throw new Error(
        "ElectronWebSignBridge.warmUp: WebContentsView not exported by electron — need Electron 32+",
      );
    }

    // 1. Inject the captured cookie into the default session BEFORE
    //    navigating, so the platform sees the user as logged in.
    await this._injectCookies(session, cookie);

    // 2. Create the WebContentsView (hidden — never added to a window).
    this._view = new WebContentsView({
      webPreferences: {
        // Strict isolation — we don't share state with renderer windows.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Required for some platforms' anti-bot JS that probes for
        // standard browser globals.
        webSecurity: true,
      },
    });

    // 3. Navigate + wait for load + grace period.
    const webContents = this._view.webContents;
    const loaded = new Promise((resolve, reject) => {
      let settled = false;
      const onLoad = () => {
        if (settled) {
          return;
        }
        settled = true;
        webContents.off("did-fail-load", onFail);
        resolve();
      };
      const onFail = (_e, errorCode, errorDesc) => {
        if (settled) {
          return;
        }
        settled = true;
        webContents.off("did-finish-load", onLoad);
        reject(new Error(`did-fail-load: code=${errorCode} ${errorDesc}`));
      };
      webContents.once("did-finish-load", onLoad);
      webContents.once("did-fail-load", onFail);
    });

    await webContents.loadURL(this.homepageUrl);
    await withTimeout(loaded, this._warmUpTimeoutMs, "warmUp did-finish-load");

    // 4. Grace period after load — anti-bot SDKs init async XHRs.
    await new Promise((r) => setTimeout(r, this.postLoadDelayMs));

    this._warm = true;
  }

  /**
   * Inject every `name=value` pair from the captured cookie into
   * Electron's default session under [cookieDomain], so the WebContentsView
   * sees the user as logged-in. Uses session.cookies.set per pair.
   */
  async _injectCookies(session, cookieHeader) {
    if (!session || !session.defaultSession) {
      return;
    }
    if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
      return;
    }
    const cookies = parseCookieHeader(cookieHeader);
    for (const { name, value } of cookies) {
      try {
        await session.defaultSession.cookies.set({
          url: this._cookieScheme() + this.cookieDomain.replace(/^\./, ""),
          name,
          value,
          domain: this.cookieDomain,
          path: "/",
          secure: true,
          httpOnly: false,
          sameSite: "no_restriction",
        });
      } catch (e) {
        // Some platforms (Xhs) reject HttpOnly cookies via cookies.set;
        // we just warn and continue — most cookies will succeed.
        this._onWarn(
          `cookie set failed for ${name}: ${e && e.message ? e.message : String(e)}`,
        );
      }
    }
  }

  /** URL scheme for the cookie-set URL — https://. */
  _cookieScheme() {
    return "https://";
  }

  /**
   * Run buildSignScript via executeJavaScript, serialized through the
   * eval mutex. Returns the raw string result (or null on failure /
   * timeout). Subclass-facing — use this in `signUrl` / `signedHeaders`
   * implementations.
   */
  async _eval(rawUrl, purpose) {
    const script = this.buildSignScript(String(rawUrl), purpose);
    return await this._evalRaw(script);
  }

  /**
   * Run an arbitrary JS expression in the bridge's WebContentsView through
   * the same eval mutex as `_eval`. Subclasses use this for probe scripts
   * that bypass [buildSignScript] (e.g. presence checks for candidate
   * signing globals — see [probe]).
   *
   * @param {string} script  raw JS to executeJavaScript
   * @returns {Promise<string|null>}  stringified result or null
   */
  async _evalRaw(script) {
    if (!this._warm || !this._view) {
      this._onWarn("eval before warmUp — call warmUp(cookie) first");
      return null;
    }
    // Mutex via promise chain: next eval waits for previous.
    const prevChain = this._evalChain;
    let release;
    const nextChain = new Promise((r) => (release = r));
    this._evalChain = prevChain.then(() => nextChain);
    await prevChain;
    try {
      const evalPromise = this._view.webContents.executeJavaScript(
        script,
        false,
      );
      const result = await withTimeout(
        evalPromise,
        this._evalTimeoutMs,
        "executeJavaScript",
      );
      return result == null ? null : String(result);
    } catch (e) {
      this._onWarn(
        `executeJavaScript threw: ${e && e.message ? e.message : String(e)}`,
      );
      return null;
    } finally {
      release();
    }
  }

  /**
   * Phase 6e — dry-run "what's loaded?" introspection.
   *
   * Runs [probeScript] (subclass-defined) in the WebContentsView and
   * returns a `{candidates: {name: bool}, anyPresent: bool}` report.
   * Lets the bridge-doctor surface "acrawler.js global rotated" /
   * "NS_sig3 absent" BEFORE the user sees a 0-event sync.
   *
   * No-op fallback (no probeScript getter overridden): returns
   * `{candidates: {}, anyPresent: false}`.
   */
  async probe() {
    const script = this.probeScript;
    if (!script) {
      return { candidates: {}, anyPresent: false };
    }
    const result = await this._evalRaw(script);
    if (!result) {
      return {
        candidates: {},
        anyPresent: false,
        error: "probe returned null (warmUp failed / eval timeout)",
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      return {
        candidates: {},
        anyPresent: false,
        error: "probe result not JSON: " + e.message,
      };
    }
    if (!parsed || typeof parsed !== "object") {
      return { candidates: {}, anyPresent: false };
    }
    const candidates = {};
    for (const k of Object.keys(parsed)) {
      candidates[k] = Boolean(parsed[k]);
    }
    return {
      candidates,
      anyPresent: Object.values(candidates).some((v) => v === true),
    };
  }

  /**
   * Subclass override. Should return a JS expression that evaluates to a
   * JSON-stringified object `{candidateName: bool, ...}` indicating which
   * signing globals are present in the bridge's WebContentsView.
   *
   * Default null → [probe] degrades to empty report.
   */
  get probeScript() {
    return null;
  }

  /**
   * Default signUrl — subclasses that need URL-mutation override.
   * Headers-only bridges (Xhs) can leave this as null.
   */
  async signUrl(_rawUrl, _purpose) {
    return null;
  }

  /**
   * Default signedHeaders — subclasses that need headers override.
   */
  async signedHeaders(_rawUrl, _purpose) {
    return {};
  }

  /**
   * Tear down the WebContentsView. Idempotent.
   */
  async shutdown() {
    if (!this._view) {
      return;
    }
    try {
      // WebContentsView.webContents.destroy() — Electron 32+
      if (
        this._view.webContents &&
        typeof this._view.webContents.destroy === "function"
      ) {
        this._view.webContents.destroy();
      }
    } catch (e) {
      this._onWarn(`shutdown threw: ${e && e.message ? e.message : String(e)}`);
    } finally {
      this._view = null;
      this._warm = false;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function tryRequireElectron() {
  try {
    // eslint-disable-next-line global-require
    return require("electron");
  } catch (_e) {
    // Not in Electron context (cli / tests) — null. Caller will throw on
    // warmUp() if it actually needs to spawn a WebContentsView.
    return null;
  }
}

/**
 * Parse a `name1=value1; name2=value2` Cookie header into an array of
 * {name, value} objects. Whitespace around `; ` is tolerated. Empty /
 * malformed pairs are skipped.
 *
 * Exposed for unit testing.
 */
function parseCookieHeader(header) {
  if (typeof header !== "string") {
    return [];
  }
  const out = [];
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const name = trimmed.substring(0, eq).trim();
    const value = trimmed.substring(eq + 1).trim();
    if (!name) {
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

/** Wrap a Promise with a timeout that rejects on tag. */
function withTimeout(promise, ms, tag) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${tag} timeout after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

module.exports = {
  ElectronWebSignBridge,
  // Exposed for unit testing without spawning Electron
  _internals: {
    parseCookieHeader,
    withTimeout,
    tryRequireElectron,
  },
};
