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
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";

export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_DOM_CAP = 150000;

const _deps = {
  fs,
  spawn,
  homedir: () => os.homedir(),
  platform: () => process.platform,
  env: () => process.env,
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
  const res = await deps.httpGet(`http://127.0.0.1:${port}/json/version`);
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
    return [
      ...custom,
      ...bases.map((b) =>
        path.join(b, "Google", "Chrome", "Application", "chrome.exe"),
      ),
      ...bases.map((b) =>
        path.join(b, "Microsoft", "Edge", "Application", "msedge.exe"),
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
    `--remote-debugging-port=${port}`,
    // No first-run wizards in the dedicated profile.
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (!defaultProfile) {
    args.push(`--user-data-dir=${profileDir || connectorProfileDir({ deps })}`);
  }
  if (url) args.push(String(url));
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
      `http://127.0.0.1:${port}`,
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

export { _deps };
