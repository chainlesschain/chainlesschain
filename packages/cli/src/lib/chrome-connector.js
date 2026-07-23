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
import os from "os";
import path from "path";
import http from "http";
import executionBroker from "./process-execution-broker/index.js";

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
        consoleEntries.push({ type: m.type(), text: m.text().slice(0, 500) });
      }
    };
    const onRequestFailed = (r) => {
      if (networkEntries.length < 200) {
        networkEntries.push({
          kind: "failed",
          url: r.url().slice(0, 300),
          error: r.failure()?.errorText || "",
        });
      }
    };
    const onResponse = (res) => {
      if (res.status() >= 400 && networkEntries.length < 200) {
        networkEntries.push({
          kind: "http-error",
          url: res.url().slice(0, 300),
          status: res.status(),
        });
      }
    };
    page.on("console", onConsole);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);
    try {
      if (reload) {
        await page
          .reload({ waitUntil: "domcontentloaded", timeout: watchMs + 15000 })
          .catch(() => {});
      }
      await page.waitForTimeout(Math.max(0, Number(watchMs) || 0));

      const state = {
        ok: true,
        port,
        tab: index,
        url: page.url(),
        title: await page.title().catch(() => ""),
        tabs: pages.map((p, i) => ({ index: i, url: p.url() })),
        console: consoleEntries,
        network: networkEntries,
      };
      if (includeDom) {
        const html = await page.content().catch(() => "");
        state.html = html.slice(0, domCap);
        state.htmlTruncated = html.length > domCap;
      }
      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath }).catch((err) => {
          state.screenshotError = err.message.split("\n")[0];
        });
        if (!state.screenshotError) state.screenshotPath = screenshotPath;
      }
      return state;
    } finally {
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
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
  const s = String(value);
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
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
        return { type, url: String(raw.url) };
      }
      case "waitForSelector": {
        const t = Number(raw.timeoutMs ?? raw.timeout_ms ?? 5000);
        const timeoutMs = Math.min(
          Math.max(Number.isFinite(t) ? t : 5000, 1),
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
            `cc-browser-act-${Date.now()}-${i}.png`,
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

async function runOneAction(page, act, timeoutMs) {
  switch (act.type) {
    case "click":
      await page.click(act.selector, { timeout: timeoutMs });
      return `clicked ${act.selector}`;
    case "type":
      await page.fill(act.selector, act.text, { timeout: timeoutMs });
      return `typed ${act.text.length} chars into ${act.selector}`;
    case "press":
      await page.keyboard.press(act.key);
      return `pressed ${act.key}`;
    case "navigate":
      await page.goto(act.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      return `navigated to ${act.url}`;
    case "waitForSelector":
      await page.waitForSelector(act.selector, { timeout: act.timeoutMs });
      return `selector appeared: ${act.selector}`;
    case "screenshot":
      await page.screenshot({ path: act.screenshotPath });
      return `screenshot saved: ${act.screenshotPath}`;
    case "assertText": {
      const text = await page.textContent(act.selector, {
        timeout: timeoutMs,
      });
      if (text == null) {
        throw new Error(`assertText: no element matches ${act.selector}`);
      }
      if (!text.includes(act.expected)) {
        throw new Error(
          `assertText FAILED: "${truncateForAudit(act.expected, 80)}" not found in ${act.selector} (got: ${truncateForAudit(text.trim(), 120)})`,
        );
      }
      return `assertText passed: ${act.selector} contains "${truncateForAudit(act.expected, 80)}"`;
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
    deps = _deps,
  } = {},
) {
  let normalized;
  let resolvedPort;
  try {
    resolvedPort = resolveLoopbackCdpPort(cdpUrl, port);
    normalized = normalizeBrowserActions(actions, { deps });
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

    let auditError = null;
    for (const act of normalized) {
      const started = Date.now();
      const step = { ok: false, action: act.type, detail: "", durationMs: 0 };
      try {
        step.detail = await runOneAction(page, act, stepTimeout);
        step.ok = true;
        if (act.screenshotPath) step.screenshotPath = act.screenshotPath;
      } catch (err) {
        step.detail = String(err && err.message ? err.message : err).split(
          "\n",
        )[0];
      }
      step.durationMs = Date.now() - started;
      result.steps.push(step);
      try {
        const entry = {
          ts: new Date(started).toISOString(),
          action: act.type,
          ok: step.ok,
          durationMs: step.durationMs,
        };
        if (sessionId) entry.sessionId = String(sessionId);
        if (act.selector) entry.selector = truncateForAudit(act.selector);
        if (act.url) entry.url = truncateForAudit(act.url);
        if (act.key) entry.key = truncateForAudit(act.key, 50);
        appendActionAudit(entry, deps);
      } catch (err) {
        auditError = err.message;
      }
      if (!step.ok && !continueOnError) break;
    }

    result.executed = result.steps.length;
    result.ok =
      result.steps.length === normalized.length &&
      result.steps.every((s) => s.ok);
    if (auditError) result.auditError = auditError;
    result.url = page.url();
    result.title = await page.title().catch(() => "");
    return result;
  } finally {
    // connectOverCDP close() disconnects the client; the browser lives on.
    await browser.close().catch(() => {});
  }
}

export { _deps };
