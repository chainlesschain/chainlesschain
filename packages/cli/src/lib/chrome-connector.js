/**
 * Chrome connector — attach to the USER'S real Chrome over the DevTools
 * protocol (CDP) so page state (DOM / console / network / screenshot) can be
 * captured WITH the user's login sessions, unlike `cc browse fetch/scrape`
 * which cold-launches a blank headless browser.
 *
 * Three layers:
 *   discoverCdp()       GET http://127.0.0.1:<port>/json/version — is a
 *                       debuggable Chrome listening?
 *   launch helpers      find the Chrome executable + build the argv to start
 *                       one with --remote-debugging-port. By default a
 *                       DEDICATED profile dir is used (~/.chainlesschain/
 *                       chrome-profile) — sign in once there and the state
 *                       persists. Reusing the DEFAULT profile is opt-in
 *                       (defaultProfile: true) and requires every Chrome
 *                       window to be closed first (Chrome refuses the debug
 *                       port otherwise).
 *   captureState()      playwright connectOverCDP → pick a tab → observe for
 *                       watchMs (console messages, failed/4xx-5xx network),
 *                       snapshot url/title/DOM (capped), optional screenshot.
 *                       Disconnects without killing the browser.
 *
 * SECURITY: the CDP port is an unauthenticated local control channel for the
 * whole browser — anything on the machine can drive it while it is open.
 * Loopback-only is enforced here; the docs tell users to close the connected
 * Chrome when done. This is the same trade Claude-Code's Chrome connector
 * makes.
 */
import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import http from "http";
import executionBroker from "./process-execution-broker/index.js";
import { redactSecrets } from "./secret-scan.js";
import {
  authorizeBrowserAction,
  authorizeBrowserReplay,
  browserEvidenceDigest,
  createBrowserEvidenceEnvelope,
  describeBrowserAction,
  normalizeBrowserEvidenceBinding,
} from "./browser-evidence.js";

export const DEFAULT_CDP_PORT = 9222;

/** Coerce + bound-check a CDP port (goes into URLs and Chrome argv). */
export function normalizeCdpPort(port) {
  const n = Number(port ?? DEFAULT_CDP_PORT);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid CDP port: ${port}`);
  }
  return n;
}

/**
 * A launch URL must be a real web page. Anything else — and especially a
 * value starting with `--`, which Chrome would parse as a SWITCH (e.g.
 * --renderer-cmd-prefix=… is command execution) — is refused. Today `url`
 * only comes from the local `cc browse chrome launch --url` flag, but this
 * keeps the argv safe if it ever becomes agent- or remote-driven.
 */
export function normalizeLaunchUrl(url) {
  if (url == null || url === "") return null;
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error(`Invalid launch URL: ${url}`);
  }
  if (!["http:", "https:", "about:"].includes(parsed.protocol)) {
    throw new Error(
      `Launch URL must be http(s):// or about: (got ${parsed.protocol})`,
    );
  }
  return String(url); // validated — pass through byte-identical
}
export const DEFAULT_DOM_CAP = 150000;

/** Secret-safe text carried from a browser into transcripts or audit logs. */
export function redactBrowserText(value, cap = 500) {
  if (value == null) return "";
  const text = redactSecrets(String(value));
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Preserve the page origin/path and query KEY names while removing credentials,
 * fragments, and every query value. Query values often contain opaque sessions
 * that a generic secret scanner cannot recognize.
 */
export function redactBrowserUrl(value, cap = 500) {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return redactBrowserText(raw, cap);
    }
    const keys = [...new Set(parsed.searchParams.keys())].slice(0, 64);
    const query =
      keys.length > 0
        ? `?${keys
            .map((key) => `${encodeURIComponent(key)}=[REDACTED]`)
            .join("&")}`
        : "";
    return redactBrowserText(
      `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`,
      cap,
    );
  } catch {
    return redactBrowserText(raw, cap);
  }
}

function redactBrowserDomUrl(value, cap = 1000) {
  const raw = String(value || "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return redactBrowserUrl(raw, cap);
  if (raw.startsWith("//")) {
    const safe = redactBrowserUrl(`https:${raw}`, cap + 6);
    return safe.startsWith("https:")
      ? redactBrowserText(safe.slice(6), cap)
      : redactBrowserText(safe, cap);
  }

  const withoutFragment = raw.split("#", 1)[0];
  const queryIndex = withoutFragment.indexOf("?");
  if (queryIndex < 0) return redactBrowserText(withoutFragment, cap);
  const prefix = withoutFragment.slice(0, queryIndex);
  const keys = [
    ...new Set(
      withoutFragment
        .slice(queryIndex + 1)
        .split(/&(?:amp;)?/i)
        .map((part) => part.split("=", 1)[0].trim())
        .filter(Boolean)
        .slice(0, 64),
    ),
  ];
  const query =
    keys.length > 0
      ? `?${keys
          .map((key) => `${encodeURIComponent(key.slice(0, 128))}=[REDACTED]`)
          .join("&")}`
      : "";
  return redactBrowserText(`${prefix}${query}`, cap);
}

function isSensitiveInputTag(tag) {
  return (
    /\btype\s*=\s*["']?password\b/i.test(tag) ||
    /\b(?:name|id)\s*=\s*["'][^"']*(?:password|passwd|token|secret|api[-_]?key)[^"']*["']/i.test(
      tag,
    )
  );
}

export function browserDomRedactionMetadata(value) {
  const html = String(value || "");
  const inputTags = html.match(/<input\b[^>]*>/gi) || [];
  const sensitiveInputValues = inputTags.filter(
    (tag) =>
      isSensitiveInputTag(tag) && /\bvalue\s*=\s*["'][^"']*["']/i.test(tag),
  ).length;
  const sensitiveTextareaValues = (
    html.match(
      /<textarea\b[^>]*(?:name|id)\s*=\s*["'][^"']*(?:password|passwd|token|secret|api[-_]?key)[^"']*["'][^>]*>[\s\S]*?<\/textarea>/gi,
    ) || []
  ).length;
  let urlQueryValues = 0;
  for (const match of html.matchAll(
    /\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi,
  )) {
    const query = String(match[1]).split("#", 1)[0].split("?", 2)[1] || "";
    urlQueryValues += query
      .split(/&(?:amp;)?/iu)
      .filter((part) => part.trim() !== "").length;
  }
  return Object.freeze({
    applied: true,
    sensitiveFieldValues: sensitiveInputValues + sensitiveTextareaValues,
    urlQueryValues,
    secretPatterns: redactSecrets(html) === html ? 0 : 1,
  });
}

/**
 * Redact secret-shaped text, sensitive form values, and DOM URL query values
 * from the bounded snapshot before it crosses the tool boundary.
 */
export function redactBrowserDom(value, cap = DEFAULT_DOM_CAP) {
  let html = redactSecrets(String(value || ""));
  html = html.replace(/<input\b[^>]*>/gi, (tag) => {
    if (!isSensitiveInputTag(tag)) return tag;
    return tag.replace(/\bvalue\s*=\s*(["'])[^"']*\1/i, 'value="[REDACTED]"');
  });
  html = html.replace(
    /(<textarea\b[^>]*(?:name|id)\s*=\s*["'][^"']*(?:password|passwd|token|secret|api[-_]?key)[^"']*["'][^>]*>)[\s\S]*?(<\/textarea>)/gi,
    "$1[REDACTED]$2",
  );
  html = html.replace(
    /\b(href|src|action)\s*=\s*(["'])([^"']+)\2/gi,
    (_match, attr, quote, url) =>
      `${attr}=${quote}${redactBrowserDomUrl(url, 1000)}${quote}`,
  );
  return html.slice(0, Math.max(0, Number(cap) || 0));
}

function redactScreenshotFailure(error, generatedPath, cap = 300) {
  let message = String(error && error.message ? error.message : error);
  if (generatedPath) {
    message = message.split(String(generatedPath)).join("[SCREENSHOT_PATH]");
  }
  message = message.replace(/https?:\/\/[^\s"'<>]+/giu, (url) =>
    redactBrowserUrl(url, cap),
  );
  return redactBrowserText(message.split("\n")[0], cap);
}

function cleanupFailedScreenshot(generatedPath, deps) {
  if (!generatedPath) return;
  try {
    deps.fs.rmSync(generatedPath, { force: true });
  } catch {
    // Failure cleanup is best-effort; never mask the browser action error.
  }
}

function digestGeneratedFile(generatedPath, deps) {
  if (!generatedPath) return null;
  try {
    return browserEvidenceDigest(deps.fs.readFileSync(generatedPath));
  } catch {
    return null;
  }
}

const _deps = {
  fs,
  spawn: executionBroker.spawn.bind(executionBroker),
  homedir: () => os.homedir(),
  platform: () => process.platform,
  env: () => process.env,
  tmpdir: () => os.tmpdir(),
  httpGet,
  importPlaywright: () => import("playwright"),
};

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: "" });
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
  });
}

/** Is a debuggable Chrome listening on the port? → {ok, browser?, wsUrl?} */
export async function discoverCdp({
  port = DEFAULT_CDP_PORT,
  deps = _deps,
} = {}) {
  const res = await deps.httpGet(
    `http://127.0.0.1:${normalizeCdpPort(port)}/json/version`,
  );
  if (res.status !== 200) return { ok: false, port };
  try {
    const info = JSON.parse(res.body);
    return {
      ok: true,
      port,
      browser: info.Browser || "",
      wsUrl: info.webSocketDebuggerUrl || "",
    };
  } catch {
    return { ok: false, port };
  }
}

/** Well-known Chrome/Edge/Chromium install paths per platform. */
export function chromeCandidates({ deps = _deps } = {}) {
  const env = deps.env();
  const custom = env.CHROME_PATH ? [env.CHROME_PATH] : [];
  if (deps.platform() === "win32") {
    const bases = [
      env["PROGRAMFILES"],
      env["PROGRAMFILES(X86)"],
      env["LOCALAPPDATA"],
    ].filter(Boolean);
    // path.win32, not host path: platform() is injectable, so this branch
    // must build Windows paths even when the host (e.g. Linux CI) is not.
    return [
      ...custom,
      ...bases.map((b) =>
        path.win32.join(b, "Google", "Chrome", "Application", "chrome.exe"),
      ),
      ...bases.map((b) =>
        path.win32.join(b, "Microsoft", "Edge", "Application", "msedge.exe"),
      ),
    ];
  }
  if (deps.platform() === "darwin") {
    return [
      ...custom,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    ...custom,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

/** First existing Chrome-family executable, or null. */
export function findChromeExecutable({ deps = _deps } = {}) {
  for (const candidate of chromeCandidates({ deps })) {
    try {
      if (deps.fs.existsSync(candidate)) return candidate;
    } catch {
      /* inaccessible — keep looking */
    }
  }
  return null;
}

/** The dedicated connector profile dir (login once there; state persists). */
export function connectorProfileDir({ deps = _deps } = {}) {
  return path.join(deps.homedir(), ".chainlesschain", "chrome-profile");
}

/**
 * Argv for launching a debuggable Chrome. Dedicated profile by default;
 * `defaultProfile: true` drops --user-data-dir to reuse the user's real
 * profile (requires ALL Chrome windows closed — callers must check
 * discoverCdp/refusal and say so).
 */
export function buildChromeLaunchArgs({
  port = DEFAULT_CDP_PORT,
  url,
  defaultProfile = false,
  profileDir,
  deps = _deps,
} = {}) {
  const args = [
    `--remote-debugging-port=${normalizeCdpPort(port)}`,
    // No first-run wizards in the dedicated profile.
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (!defaultProfile) {
    args.push(`--user-data-dir=${profileDir || connectorProfileDir({ deps })}`);
  }
  const launchUrl = normalizeLaunchUrl(url);
  if (launchUrl) args.push(launchUrl);
  return args;
}

/** Spawn the (detached) debuggable Chrome. Returns {ok, executable, args, error?}. */
export function launchChrome(opts = {}) {
  const deps = opts.deps || _deps;
  const executable = opts.executable || findChromeExecutable({ deps });
  if (!executable) {
    return {
      ok: false,
      error:
        "no Chrome/Edge executable found — install Chrome or set CHROME_PATH",
    };
  }
  const args = buildChromeLaunchArgs({ ...opts, deps });
  try {
    const child = deps.spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      origin: "chrome-connector:launch",
      policy: "allow",
      scope: "browser",
      shell: false,
    });
    child.unref();
    return { ok: true, executable, args, pid: child.pid };
  } catch (err) {
    return { ok: false, executable, args, error: err.message };
  }
}

/**
 * Attach over CDP, observe the chosen tab for `watchMs`, and return its
 * state: {url, title, tabs, console[], network[], html, htmlTruncated,
 * screenshotPath?}. Console/network are collected FROM ATTACH TIME (CDP has
 * no retroactive console history) — reload or interact during the watch
 * window to capture activity. Disconnects without killing the browser.
 */
export async function captureState({
  port = DEFAULT_CDP_PORT,
  tab = 0,
  watchMs = 3000,
  domCap = DEFAULT_DOM_CAP,
  includeDom = true,
  screenshotPath = null,
  reload = false,
  deps = _deps,
} = {}) {
  let playwright;
  try {
    playwright = await deps.importPlaywright();
  } catch {
    return {
      ok: false,
      error: "playwright is not installed — npm install playwright",
    };
  }
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP(
      `http://127.0.0.1:${normalizeCdpPort(port)}`,
    );
  } catch (err) {
    return {
      ok: false,
      error:
        `cannot attach to CDP on port ${port} (${err.message.split("\n")[0]}) — ` +
        "launch a debuggable Chrome first (cc browse chrome launch)",
    };
  }
  try {
    // Right after connectOverCDP the page targets may not have attached yet
    // (an attach immediately after `chrome launch` reliably hits this) —
    // poll briefly before concluding the browser has no tabs.
    let pages = [];
    for (let i = 0; i < 20; i++) {
      pages = browser.contexts().flatMap((c) => c.pages());
      if (pages.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (pages.length === 0) {
      return { ok: false, error: "the connected Chrome has no open tabs" };
    }
    const index = Math.min(Math.max(0, Number(tab) || 0), pages.length - 1);
    const page = pages[index];

    const consoleEntries = [];
    const networkEntries = [];
    const onConsole = (m) => {
      if (consoleEntries.length < 200) {
        consoleEntries.push({
          type: redactBrowserText(m.type(), 40),
          text: redactBrowserText(m.text(), 500),
        });
      }
    };
    const onRequestFailed = (r) => {
      if (networkEntries.length < 200) {
        networkEntries.push({
          kind: "failed",
          url: redactBrowserUrl(r.url(), 300),
          error: redactBrowserText(r.failure()?.errorText || "", 300),
        });
      }
    };
    const onResponse = (res) => {
      if (res.status() >= 400 && networkEntries.length < 200) {
        networkEntries.push({
          kind: "http-error",
          url: redactBrowserUrl(res.url(), 300),
          status: res.status(),
        });
      }
    };
    const canObserve =
      typeof page.on === "function" && typeof page.off === "function";
    if (canObserve) {
      page.on("console", onConsole);
      page.on("requestfailed", onRequestFailed);
      page.on("response", onResponse);
    }
    try {
      if (reload) {
        await page
          .reload({ waitUntil: "domcontentloaded", timeout: watchMs + 15000 })
          .catch(() => {});
      }
      await page.waitForTimeout(Math.max(0, Number(watchMs) || 0));

      const state = {
        ok: true,
        observationCaptureAvailable: canObserve,
        port,
        tab: index,
        url: redactBrowserUrl(page.url()),
        title: redactBrowserText(await page.title().catch(() => ""), 500),
        tabs: pages.map((p, i) => ({
          index: i,
          url: redactBrowserUrl(p.url()),
        })),
        console: consoleEntries,
        network: networkEntries,
      };
      if (includeDom) {
        let htmlCaptureSucceeded = true;
        const html = await page.content().catch(() => {
          htmlCaptureSucceeded = false;
          return "";
        });
        state.html = redactBrowserDom(html, domCap);
        state.htmlCaptureSucceeded = htmlCaptureSucceeded;
        state.htmlRedaction = browserDomRedactionMetadata(html);
        state.htmlSourceChars = html.length;
        state.htmlDigest = browserEvidenceDigest(state.html);
        state.htmlTruncated = html.length > domCap;
      }
      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath }).catch((err) => {
          cleanupFailedScreenshot(screenshotPath, deps);
          state.screenshotError = redactScreenshotFailure(
            err,
            screenshotPath,
            300,
          );
        });
        if (!state.screenshotError) {
          state.screenshotPath = screenshotPath;
          state.screenshotRef = path.basename(screenshotPath);
          state.screenshotSha256 = digestGeneratedFile(screenshotPath, deps);
        }
      }
      return state;
    } finally {
      if (canObserve) {
        page.off("console", onConsole);
        page.off("requestfailed", onRequestFailed);
        page.off("response", onResponse);
      }
    }
  } finally {
    // connectOverCDP close() disconnects the client; the browser lives on.
    await browser.close().catch(() => {});
  }
}

// ─── Browser Action mode (gap-analysis #6) ────────────────────────────────
//
// captureState/browser_state stay the read-only DEFAULT. performActions is
// the explicit, approval-gated capability that DRIVES the connected browser:
// click / type / press / navigate / waitForSelector / screenshot /
// assertText. Every executed step is appended to an audit JSONL under
// ~/.chainlesschain/browser-actions/<date>.jsonl (CC_BROWSER_ACTIONS_DIR
// overrides the dir for tests). Screenshot paths are ALWAYS generated
// internally — a caller-supplied path is refused (same invariant as
// browser_state: an action tool must not double as an arbitrary-file writer).

export const SUPPORTED_BROWSER_ACTIONS = Object.freeze([
  "click",
  "type",
  "press",
  "navigate",
  "waitForSelector",
  "screenshot",
  "assertText",
  "upload",
  "download",
]);
export const MAX_BROWSER_ACTIONS = 30;
export const DEFAULT_ACTION_TIMEOUT_MS = 10000;
export const MAX_ACTION_TIMEOUT_MS = 30000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Audit log directory (CC_BROWSER_ACTIONS_DIR override for tests). */
export function browserActionsDir({ deps = _deps } = {}) {
  const env = deps.env();
  if (env.CC_BROWSER_ACTIONS_DIR) return env.CC_BROWSER_ACTIONS_DIR;
  return path.join(deps.homedir(), ".chainlesschain", "browser-actions");
}

/**
 * Resolve an optional caller CDP endpoint to a PORT, enforcing the connector's
 * loopback-only contract: only http:// against 127.0.0.1 / localhost / [::1]
 * is accepted. performActions then connects to `http://127.0.0.1:<port>` —
 * the caller string is never used as the connection target verbatim, so a
 * crafted endpoint cannot widen the trust boundary the prior security fix
 * established.
 */
export function resolveLoopbackCdpPort(
  cdpUrl,
  fallbackPort = DEFAULT_CDP_PORT,
) {
  if (cdpUrl == null || cdpUrl === "") return normalizeCdpPort(fallbackPort);
  let parsed;
  try {
    parsed = new URL(String(cdpUrl));
  } catch {
    throw new Error(`Invalid CDP endpoint: ${cdpUrl}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(
      `CDP endpoint must be http:// on loopback (got ${parsed.protocol})`,
    );
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `CDP endpoint must be loopback-only (127.0.0.1 / localhost) — refusing host "${parsed.hostname}"`,
    );
  }
  return normalizeCdpPort(parsed.port || DEFAULT_CDP_PORT);
}

function truncateForAudit(value, cap = 200) {
  return redactBrowserText(value, cap);
}

/**
 * Validate + normalize the caller's action list BEFORE anything connects.
 * Throws on the first invalid action — performActions turns that into
 * {ok:false, error} without touching the browser. Screenshot paths are
 * generated here (deps.tmpdir), and any caller-supplied path key is refused.
 */
export function normalizeBrowserActions(actions, { deps = _deps } = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("actions must be a non-empty array of action objects");
  }
  if (actions.length > MAX_BROWSER_ACTIONS) {
    throw new Error(
      `too many actions (${actions.length}) — max ${MAX_BROWSER_ACTIONS} per call`,
    );
  }
  const requireSelector = (raw, type) => {
    const sel = raw.selector;
    if (typeof sel !== "string" || sel.trim() === "" || sel.length > 1000) {
      throw new Error(`${type} requires a non-empty "selector" string`);
    }
    return sel;
  };
  return actions.map((raw, i) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`action[${i}] must be an object with a "type"`);
    }
    const type = String(raw.type || "");
    if (!SUPPORTED_BROWSER_ACTIONS.includes(type)) {
      throw new Error(
        `action[${i}] has unsupported type "${type}". Supported: ${SUPPORTED_BROWSER_ACTIONS.join(", ")}`,
      );
    }
    switch (type) {
      case "click":
        return { type, selector: requireSelector(raw, "click") };
      case "type": {
        if (typeof raw.text !== "string") {
          throw new Error(`type requires a "text" string`);
        }
        return { type, selector: requireSelector(raw, "type"), text: raw.text };
      }
      case "press": {
        if (
          typeof raw.key !== "string" ||
          raw.key.trim() === "" ||
          raw.key.length > 50
        ) {
          throw new Error(`press requires a non-empty "key" string`);
        }
        return { type, key: raw.key };
      }
      case "navigate": {
        let parsed;
        try {
          parsed = new URL(String(raw.url || ""));
        } catch {
          throw new Error(`navigate has an invalid "url": ${raw.url}`);
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error(
            `navigate url must be http(s):// (got ${parsed.protocol})`,
          );
        }
        if (parsed.username || parsed.password) {
          throw new Error("navigate url must not contain embedded credentials");
        }
        return { type, url: String(raw.url) };
      }
      case "waitForSelector": {
        const t = Number(raw.timeoutMs ?? raw.timeout_ms ?? 5000);
        const timeoutMs = Math.min(
          Math.max(Number.isFinite(t) ? Math.trunc(t) : 5000, 1),
          MAX_ACTION_TIMEOUT_MS,
        );
        return {
          type,
          selector: requireSelector(raw, "waitForSelector"),
          timeoutMs,
        };
      }
      case "screenshot": {
        // The path is GENERATED — never caller-supplied. Refuse loudly so a
        // model (or user) learns the invariant instead of being silently
        // second-guessed.
        for (const k of ["path", "file", "output", "screenshotPath"]) {
          if (raw[k] != null) {
            throw new Error(
              `screenshot path is generated internally — remove "${k}"`,
            );
          }
        }
        return {
          type,
          screenshotPath: path.join(
            deps.tmpdir(),
            `cc-browser-act-${crypto.randomBytes(16).toString("hex")}-${i}.png`,
          ),
        };
      }
      case "assertText": {
        if (typeof raw.expected !== "string" || raw.expected === "") {
          throw new Error(`assertText requires a non-empty "expected" string`);
        }
        return {
          type,
          selector: requireSelector(raw, "assertText"),
          expected: raw.expected,
        };
      }
      case "upload": {
        for (const key of ["path", "file", "files", "inputFiles"]) {
          if (raw[key] != null) {
            throw new Error(
              `upload accepts only a managed session artifact_id; remove "${key}"`,
            );
          }
        }
        const artifactId = String(raw.artifactId ?? raw.artifact_id ?? "");
        if (!/^art_[A-Za-z0-9_]+$/u.test(artifactId)) {
          throw new Error("upload requires a managed artifact_id");
        }
        return {
          type,
          selector: requireSelector(raw, "upload"),
          artifactId,
        };
      }
      case "download": {
        for (const key of ["path", "file", "output", "downloadPath"]) {
          if (raw[key] != null) {
            throw new Error(
              `download path is generated internally — remove "${key}"`,
            );
          }
        }
        return {
          type,
          selector: requireSelector(raw, "download"),
          downloadPath: path.join(
            deps.tmpdir(),
            `cc-browser-download-${crypto.randomBytes(16).toString("hex")}-${i}.bin`,
          ),
        };
      }
      /* c8 ignore next 2 -- unreachable: type already validated above */
      default:
        throw new Error(`unsupported action type "${type}"`);
    }
  });
}

/** One JSONL row per EXECUTED step (explicit utf-8, best-effort). */
function appendActionAudit(entry, deps) {
  const dir = browserActionsDir({ deps });
  deps.fs.mkdirSync(dir, { recursive: true });
  const date = entry.ts.slice(0, 10);
  deps.fs.appendFileSync(
    path.join(dir, `${date}.jsonl`),
    JSON.stringify(entry) + "\n",
    "utf-8",
  );
}

/**
 * Does the dedicated connector profile own the CDP port we are attaching to?
 * Chrome writes DevToolsActivePort (first line = port) into the user-data-dir
 * it was launched with; if the file under ~/.chainlesschain/chrome-profile is
 * missing or names a different port, we are driving some OTHER profile —
 * possibly the user's real logged-in browser — and the result carries a
 * profileWarning.
 */
function connectorProfileOwnsPort(port, deps) {
  try {
    const marker = path.join(
      connectorProfileDir({ deps }),
      "DevToolsActivePort",
    );
    if (!deps.fs.existsSync(marker)) return false;
    const firstLine = String(deps.fs.readFileSync(marker, "utf-8"))
      .split(/\r?\n/)[0]
      .trim();
    return Number(firstLine) === Number(port);
  } catch {
    return false;
  }
}

async function runOneAction(
  page,
  act,
  timeoutMs,
  { resolveUploadArtifact = null } = {},
) {
  switch (act.type) {
    case "click":
      await page.click(act.selector, { timeout: timeoutMs });
      return { detail: `clicked ${act.selector}` };
    case "type":
      await page.fill(act.selector, act.text, { timeout: timeoutMs });
      return { detail: `typed ${act.text.length} chars into ${act.selector}` };
    case "press":
      await page.keyboard.press(act.key);
      return { detail: `pressed ${act.key}` };
    case "navigate":
      await page.goto(act.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      return { detail: `navigated to ${act.url}` };
    case "waitForSelector":
      await page.waitForSelector(act.selector, { timeout: act.timeoutMs });
      return { detail: `selector appeared: ${act.selector}` };
    case "screenshot":
      await page.screenshot({ path: act.screenshotPath });
      return { detail: "screenshot captured" };
    case "assertText": {
      const text = await page.textContent(act.selector, {
        timeout: timeoutMs,
      });
      if (text == null) {
        throw new Error(`assertText: no element matches ${act.selector}`);
      }
      if (!text.includes(act.expected)) {
        throw new Error(
          `assertText FAILED: expected text was not found in ${act.selector}`,
        );
      }
      return {
        detail: `assertText passed: ${act.selector}`,
      };
    }
    case "upload": {
      if (typeof resolveUploadArtifact !== "function") {
        throw new Error("upload artifact authority is unavailable");
      }
      const resolved = await resolveUploadArtifact(act.artifactId);
      try {
        if (
          !resolved ||
          typeof resolved.path !== "string" ||
          !resolved.metadata?.id ||
          !resolved.metadata?.sha256
        ) {
          throw new Error(
            "upload artifact authority returned an invalid record",
          );
        }
        const uploadDigest = String(resolved.metadata.sha256)
          .replace(/^sha256:/u, "")
          .toLowerCase();
        if (
          resolved.metadata.id !== act.artifactId ||
          !/^[a-f0-9]{64}$/u.test(uploadDigest) ||
          !Number.isFinite(Number(resolved.metadata.size)) ||
          Number(resolved.metadata.size) < 0
        ) {
          throw new Error(
            "upload artifact authority returned mismatched metadata",
          );
        }
        try {
          await page.setInputFiles(act.selector, resolved.path, {
            timeout: timeoutMs,
          });
        } catch {
          throw new Error("upload failed for the managed session artifact");
        }
        return {
          detail: `uploaded managed artifact ${resolved.metadata.id}`,
          uploadArtifact: {
            id: resolved.metadata.id,
            sha256: `sha256:${uploadDigest}`,
            size: Number(resolved.metadata.size),
          },
        };
      } finally {
        await resolved?.cleanup?.();
      }
    }
    case "download": {
      if (typeof page.waitForEvent !== "function") {
        throw new Error("download capture is unavailable in this browser");
      }
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: timeoutMs }),
        page.click(act.selector, { timeout: timeoutMs }),
      ]);
      await download.saveAs(act.downloadPath);
      return {
        detail: "download captured",
        suggestedName: redactBrowserText(download.suggestedFilename?.(), 200),
      };
    }
    /* c8 ignore next 2 -- unreachable: normalizeBrowserActions validated type */
    default:
      throw new Error(`unsupported action type "${act.type}"`);
  }
}

/**
 * Execute an ordered list of explicit browser actions against the connected
 * Chrome. Fail-fast on the first failed step unless `continueOnError`. Each
 * step result is {ok, action, detail, durationMs}; the overall result adds
 * final page url/title, `executed` count, optional `profileWarning` (attached
 * browser is NOT the dedicated connector profile) and `auditError` (audit
 * write failed — actions themselves are never aborted for audit IO).
 */
export async function performActions(
  actions,
  {
    port = DEFAULT_CDP_PORT,
    cdpUrl = null,
    tab = 0,
    continueOnError = false,
    sessionId = null,
    actionTimeoutMs = DEFAULT_ACTION_TIMEOUT_MS,
    evidenceBinding = null,
    originGrants = null,
    expectedGrantRevisions = null,
    replaySourceEnvelope = null,
    replayAllowSideEffects = false,
    replayAllowCredentials = false,
    resolveUploadArtifact = null,
    evidenceDomCap = 40000,
    deps = _deps,
  } = {},
) {
  let normalized;
  let resolvedPort;
  let replay = null;
  try {
    resolvedPort = resolveLoopbackCdpPort(cdpUrl, port);
    normalized = normalizeBrowserActions(actions, { deps });
    if (evidenceBinding) {
      const normalizedBinding =
        normalizeBrowserEvidenceBinding(evidenceBinding);
      if (!sessionId || String(sessionId) !== normalizedBinding.session.id) {
        throw new Error(
          "browser evidence binding is not bound to the active session",
        );
      }
    }
    if (replaySourceEnvelope) {
      replay = authorizeBrowserReplay({
        sourceEnvelope: replaySourceEnvelope,
        binding: evidenceBinding,
        actions: normalized,
        allowSideEffects: replayAllowSideEffects,
        allowCredentials: replayAllowCredentials,
      });
    }
    if (
      (originGrants || expectedGrantRevisions || replaySourceEnvelope) &&
      !evidenceBinding
    ) {
      throw new Error("browser evidence authority requires an exact binding");
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const stepTimeout = Math.min(
    Math.max(Number(actionTimeoutMs) || DEFAULT_ACTION_TIMEOUT_MS, 1),
    MAX_ACTION_TIMEOUT_MS,
  );

  let playwright;
  try {
    playwright = await deps.importPlaywright();
  } catch {
    return {
      ok: false,
      error: "playwright is not installed — npm install playwright",
    };
  }
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP(
      `http://127.0.0.1:${resolvedPort}`,
    );
  } catch (err) {
    return {
      ok: false,
      error:
        `cannot attach to CDP on port ${resolvedPort} (${err.message.split("\n")[0]}) — ` +
        "launch a debuggable Chrome first (cc browse chrome launch)",
    };
  }
  try {
    // Same post-connect target-attach race as captureState: poll briefly.
    let pages = [];
    for (let i = 0; i < 20; i++) {
      pages = browser.contexts().flatMap((c) => c.pages());
      if (pages.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (pages.length === 0) {
      return { ok: false, error: "the connected Chrome has no open tabs" };
    }
    const index = Math.min(Math.max(0, Number(tab) || 0), pages.length - 1);
    const page = pages[index];

    const result = { ok: false, port: resolvedPort, tab: index, steps: [] };
    if (!connectorProfileOwnsPort(resolvedPort, deps)) {
      result.profileWarning =
        "the attached Chrome does not appear to be running the dedicated connector profile " +
        "(~/.chainlesschain/chrome-profile) — actions run in that browser's REAL session";
    }

    const consoleEntries = [];
    const networkEntries = [];
    const onConsole = (message) => {
      if (consoleEntries.length < 200) {
        consoleEntries.push({
          type: redactBrowserText(message.type(), 40),
          text: redactBrowserText(message.text(), 500),
        });
      }
    };
    const onRequestFailed = (request) => {
      if (networkEntries.length < 200) {
        networkEntries.push({
          kind: "failed",
          url: redactBrowserUrl(request.url(), 300),
          error: redactBrowserText(request.failure()?.errorText || "", 300),
        });
      }
    };
    const onResponse = (response) => {
      if (response.status() >= 400 && networkEntries.length < 200) {
        networkEntries.push({
          kind: "http-error",
          url: redactBrowserUrl(response.url(), 300),
          status: response.status(),
        });
      }
    };
    const canObserve =
      typeof page.on === "function" && typeof page.off === "function";
    if (canObserve) {
      page.on("console", onConsole);
      page.on("requestfailed", onRequestFailed);
      page.on("response", onResponse);
    }

    try {
      let auditError = null;
      const authorities = [];
      for (const act of normalized) {
        const started = Date.now();
        const step = { ok: false, action: act.type, detail: "", durationMs: 0 };
        const pageBefore = redactBrowserUrl(page.url());
        let authority = null;
        try {
          if (evidenceBinding) {
            authority = authorizeBrowserAction({
              binding: evidenceBinding,
              grants: originGrants,
              expectedGrantRevisions,
              action: act,
              currentUrl: page.url(),
            });
          }
          const outcome = await runOneAction(page, act, stepTimeout, {
            resolveUploadArtifact,
          });
          step.detail =
            act.type === "navigate"
              ? `navigated to ${redactBrowserUrl(act.url)}`
              : redactBrowserText(outcome.detail, 500);
          step.ok = true;
          if (outcome.uploadArtifact) {
            step.uploadArtifact = outcome.uploadArtifact;
          }
          if (act.screenshotPath) {
            step.screenshotPath = act.screenshotPath;
            step.screenshotRef = path.basename(act.screenshotPath);
            step.screenshotSha256 = digestGeneratedFile(
              act.screenshotPath,
              deps,
            );
            if (evidenceBinding && !step.screenshotSha256) {
              throw new Error("browser evidence screenshot digest is missing");
            }
          }
          if (act.downloadPath) {
            step.downloadPath = act.downloadPath;
            step.downloadRef = path.basename(act.downloadPath);
            step.downloadSha256 = digestGeneratedFile(act.downloadPath, deps);
            if (evidenceBinding && !step.downloadSha256) {
              throw new Error("browser evidence download digest is missing");
            }
            step.downloadSuggestedName =
              outcome.suggestedName || "download.bin";
          }
        } catch (err) {
          cleanupFailedScreenshot(act.screenshotPath, deps);
          cleanupFailedScreenshot(act.downloadPath, deps);
          step.ok = false;
          delete step.screenshotPath;
          delete step.screenshotRef;
          delete step.screenshotSha256;
          delete step.downloadPath;
          delete step.downloadRef;
          delete step.downloadSha256;
          delete step.downloadSuggestedName;
          delete step.uploadArtifact;
          step.detail =
            act.type === "navigate"
              ? `navigation failed for ${redactBrowserUrl(act.url, 400)}`
              : redactScreenshotFailure(
                  err,
                  act.screenshotPath || act.downloadPath,
                  500,
                );
        }
        step.durationMs = Date.now() - started;
        const pageAfter = redactBrowserUrl(page.url());
        result.steps.push(step);
        authorities.push(authority);
        try {
          const entry = {
            ts: new Date(started).toISOString(),
            action: act.type,
            ok: step.ok,
            durationMs: step.durationMs,
            pageBefore,
            pageAfter,
            result: step.detail,
          };
          if (sessionId) {
            entry.sessionId = redactBrowserText(sessionId, 160);
          }
          if (act.selector) entry.selector = truncateForAudit(act.selector);
          if (act.url) entry.url = redactBrowserUrl(act.url);
          if (act.key) entry.key = truncateForAudit(act.key, 50);
          if (act.artifactId) entry.uploadArtifactId = act.artifactId;
          if (step.ok && act.screenshotPath) {
            entry.screenshotRef = path.basename(act.screenshotPath);
            entry.screenshotSha256 = step.screenshotSha256;
          }
          if (step.ok && act.downloadPath) {
            entry.downloadRef = path.basename(act.downloadPath);
            entry.downloadSha256 = step.downloadSha256;
          }
          if (authority) {
            entry.originGrant = {
              grantId: authority.grantId,
              revision: authority.revision,
              origin: authority.origin,
              scope: authority.scope,
            };
          }
          appendActionAudit(entry, deps);
        } catch (err) {
          auditError = redactBrowserText(err.message, 300);
        }
        if (!step.ok && !continueOnError) break;
      }

      result.executed = result.steps.length;
      result.ok =
        result.steps.length === normalized.length &&
        result.steps.every((s) => s.ok);
      if (auditError) result.auditError = auditError;
      result.url = redactBrowserUrl(page.url());
      result.title = redactBrowserText(await page.title().catch(() => ""), 500);
      result.console = consoleEntries;
      result.network = networkEntries;
      if (evidenceBinding && result.steps.length > 0) {
        let domCaptureSucceeded = true;
        const sourceHtml = await page.content().catch(() => {
          domCaptureSucceeded = false;
          return "";
        });
        const normalizedCap = Math.min(
          Math.max(0, Number(evidenceDomCap) || 40000),
          DEFAULT_DOM_CAP,
        );
        const safeHtml = redactBrowserDom(sourceHtml, normalizedCap);
        const evidenceActions = result.steps.map((step, actionIndex) =>
          describeBrowserAction(
            normalized[actionIndex],
            step,
            authorities[actionIndex],
            actionIndex,
          ),
        );
        result.evidence = createBrowserEvidenceEnvelope({
          binding: evidenceBinding,
          originPermissions: authorities.filter(Boolean),
          actions: evidenceActions,
          consoleEntries,
          networkEntries,
          pageUrl: page.url(),
          pageTitle: result.title,
          domSnapshot: {
            html: safeHtml,
            sourceChars: sourceHtml.length,
            cap: normalizedCap,
            truncated: sourceHtml.length > normalizedCap,
            captureSucceeded: domCaptureSucceeded,
            redaction: browserDomRedactionMetadata(sourceHtml),
          },
          screenshots: result.steps
            .map((step, actionIndex) => ({
              actionIndex,
              digest: step.screenshotSha256,
            }))
            .filter((row) => row.digest),
          downloads: result.steps
            .map((step, actionIndex) => ({
              actionIndex,
              digest: step.downloadSha256,
              suggestedName: step.downloadSuggestedName,
            }))
            .filter((row) => row.digest),
          replay,
          observationCaptureAvailable: canObserve,
        });
        if (!domCaptureSucceeded || !canObserve) {
          result.ok = false;
          result.evidenceIncomplete = true;
          result.retrySafe = false;
          result.recovery =
            "Browser actions may have completed, but observation evidence capture was incomplete; do not retry side effects automatically.";
        }
      }
      return result;
    } catch (error) {
      for (const step of result.steps || []) {
        cleanupFailedScreenshot(step.screenshotPath, deps);
        cleanupFailedScreenshot(step.downloadPath, deps);
      }
      throw error;
    } finally {
      if (canObserve) {
        page.off("console", onConsole);
        page.off("requestfailed", onRequestFailed);
        page.off("response", onResponse);
      }
    }
  } finally {
    // connectOverCDP close() disconnects the client; the browser lives on.
    await browser.close().catch(() => {});
  }
}

export { _deps };
