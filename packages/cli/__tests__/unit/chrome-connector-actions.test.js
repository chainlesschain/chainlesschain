/**
 * Browser Action mode (gap-analysis #6) — performActions drives the connected
 * Chrome with EXPLICIT steps, unlike the read-only captureState/browser_state
 * default. These tests exercise the pure validation layer and the execution
 * loop with an injected fake playwright (same _deps seam as the connector's
 * other tests): scheme rejection, internally-generated screenshot paths,
 * fail-fast vs continueOnError, assertText, loopback-only cdpUrl, the
 * connector-profile warning, and the per-step audit JSONL.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MAX_ACTION_TIMEOUT_MS,
  MAX_BROWSER_ACTIONS,
  browserActionsDir,
  normalizeBrowserActions,
  performActions,
  resolveLoopbackCdpPort,
} from "../../src/lib/chrome-connector.js";

let auditDir;
let fakeHome;

beforeEach(() => {
  auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-act-audit-"));
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-act-home-"));
});
afterEach(() => {
  for (const dir of [auditDir, fakeHome]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function fakePage(overrides = {}) {
  const calls = [];
  return {
    calls,
    url: () => "http://localhost:3000/after",
    title: async () => "After",
    click: async (sel) => calls.push(["click", sel]),
    fill: async (sel, text) => calls.push(["fill", sel, text]),
    keyboard: { press: async (k) => calls.push(["press", k]) },
    goto: async (u) => calls.push(["goto", u]),
    waitForSelector: async (sel) => calls.push(["wait", sel]),
    screenshot: async ({ path: p }) => calls.push(["screenshot", p]),
    textContent: async () => "hello world",
    ...overrides,
  };
}

function fakeDeps({ page = fakePage(), connectCalls = [] } = {}) {
  return {
    fs,
    spawn: () => ({ unref: () => {}, pid: 1 }),
    homedir: () => fakeHome,
    platform: () => "win32",
    env: () => ({ CC_BROWSER_ACTIONS_DIR: auditDir }),
    tmpdir: () => os.tmpdir(),
    httpGet: async () => ({ status: 0, body: "" }),
    importPlaywright: async () => ({
      chromium: {
        connectOverCDP: async (endpoint) => {
          connectCalls.push(endpoint);
          return {
            contexts: () => [{ pages: () => [page] }],
            close: async () => {},
          };
        },
      },
    }),
    _connectCalls: connectCalls,
    _page: page,
  };
}

function readAuditLines() {
  const files = fs.readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  return fs
    .readFileSync(path.join(auditDir, files[0]), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("normalizeBrowserActions (pure validation)", () => {
  it("rejects unknown types, empty lists, and oversize lists", () => {
    expect(() => normalizeBrowserActions([])).toThrow(/non-empty array/);
    expect(() => normalizeBrowserActions([{ type: "evaluate" }])).toThrow(
      /unsupported type/,
    );
    const many = Array.from({ length: MAX_BROWSER_ACTIONS + 1 }, () => ({
      type: "press",
      key: "Enter",
    }));
    expect(() => normalizeBrowserActions(many)).toThrow(/too many actions/);
  });

  it("caps waitForSelector timeout at MAX_ACTION_TIMEOUT_MS", () => {
    const [act] = normalizeBrowserActions([
      { type: "waitForSelector", selector: "#x", timeout_ms: 999999 },
    ]);
    expect(act.timeoutMs).toBe(MAX_ACTION_TIMEOUT_MS);
  });
});

describe("resolveLoopbackCdpPort", () => {
  it("accepts only http:// against loopback hosts", () => {
    expect(resolveLoopbackCdpPort("http://127.0.0.1:9333")).toBe(9333);
    expect(resolveLoopbackCdpPort("http://localhost:9222")).toBe(9222);
    expect(resolveLoopbackCdpPort(null, 9444)).toBe(9444);
    expect(() => resolveLoopbackCdpPort("http://192.168.1.50:9222")).toThrow(
      /loopback-only/,
    );
    expect(() => resolveLoopbackCdpPort("https://127.0.0.1:9222")).toThrow(
      /must be http/,
    );
    expect(() => resolveLoopbackCdpPort("ws://127.0.0.1:9222")).toThrow(
      /must be http/,
    );
  });
});

describe("performActions", () => {
  it("executes a click and reports per-step outcome + final page state", async () => {
    const deps = fakeDeps();
    const res = await performActions([{ type: "click", selector: "#go" }], {
      deps,
    });
    expect(res.ok).toBe(true);
    expect(res.executed).toBe(1);
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]).toMatchObject({ ok: true, action: "click" });
    expect(res.steps[0].detail).toContain("#go");
    expect(res.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(res.url).toBe("http://localhost:3000/after");
    expect(res.title).toBe("After");
    expect(deps._page.calls).toEqual([["click", "#go"]]);
  });

  it("refuses a javascript: navigate up-front — nothing connects", async () => {
    const deps = fakeDeps();
    const res = await performActions(
      [{ type: "navigate", url: "javascript:alert(1)" }],
      { deps },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/http\(s\)/);
    expect(deps._connectCalls).toHaveLength(0);

    const fileRes = await performActions(
      [{ type: "navigate", url: "file:///etc/passwd" }],
      { deps },
    );
    expect(fileRes.ok).toBe(false);
    expect(deps._connectCalls).toHaveLength(0);
  });

  it("refuses a caller-supplied screenshot path; generates one internally", async () => {
    const deps = fakeDeps();
    const rejected = await performActions(
      [{ type: "screenshot", path: "C:/evil/overwrite.png" }],
      { deps },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/generated internally/);
    expect(deps._connectCalls).toHaveLength(0);

    const res = await performActions([{ type: "screenshot" }], { deps });
    expect(res.ok).toBe(true);
    expect(res.steps[0].screenshotPath).toBeDefined();
    expect(res.steps[0].screenshotPath.startsWith(os.tmpdir())).toBe(true);
    // The fake page received exactly the generated path.
    expect(deps._page.calls).toEqual([
      ["screenshot", res.steps[0].screenshotPath],
    ]);
  });

  it("appends one audit JSONL line per executed step (ts/action/ok/durationMs/sessionId)", async () => {
    const deps = fakeDeps();
    const res = await performActions(
      [
        { type: "press", key: "Enter" },
        { type: "click", selector: "#submit" },
      ],
      { deps, sessionId: "sess-42" },
    );
    expect(res.ok).toBe(true);
    const lines = readAuditLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      action: "press",
      ok: true,
      sessionId: "sess-42",
      key: "Enter",
    });
    expect(typeof lines[0].ts).toBe("string");
    expect(typeof lines[0].durationMs).toBe("number");
    expect(lines[1]).toMatchObject({
      action: "click",
      ok: true,
      selector: "#submit",
    });
  });

  it("truncates long selectors in the audit log", async () => {
    const deps = fakeDeps();
    const longSel = "#" + "x".repeat(400);
    await performActions([{ type: "click", selector: longSel }], { deps });
    const [line] = readAuditLines();
    expect(line.selector.length).toBeLessThanOrEqual(201); // 200 + ellipsis
  });

  it("fails fast by default; continueOnError runs the remaining steps", async () => {
    const failingClick = async () => {
      throw new Error("no node found for selector #missing");
    };
    const actions = [
      { type: "click", selector: "#missing" },
      { type: "press", key: "Enter" },
    ];

    const deps1 = fakeDeps({ page: fakePage({ click: failingClick }) });
    const failFast = await performActions(actions, { deps: deps1 });
    expect(failFast.ok).toBe(false);
    expect(failFast.executed).toBe(1);
    expect(failFast.steps[0].ok).toBe(false);
    expect(failFast.steps[0].detail).toMatch(/no node found/);
    expect(readAuditLines()).toHaveLength(1); // only the executed step

    const deps2 = fakeDeps({ page: fakePage({ click: failingClick }) });
    const cont = await performActions(actions, {
      deps: deps2,
      continueOnError: true,
    });
    expect(cont.ok).toBe(false); // a failed step still fails the batch
    expect(cont.executed).toBe(2);
    expect(cont.steps[0].ok).toBe(false);
    expect(cont.steps[1].ok).toBe(true);
  });

  it("assertText passes on a contained substring and fails the step otherwise", async () => {
    const deps = fakeDeps(); // textContent → "hello world"
    const pass = await performActions(
      [{ type: "assertText", selector: "h1", expected: "hello" }],
      { deps },
    );
    expect(pass.ok).toBe(true);
    expect(pass.steps[0].detail).toMatch(/assertText passed/);

    const fail = await performActions(
      [{ type: "assertText", selector: "h1", expected: "goodbye" }],
      { deps: fakeDeps() },
    );
    expect(fail.ok).toBe(false);
    expect(fail.steps[0].ok).toBe(false);
    expect(fail.steps[0].detail).toMatch(/assertText FAILED/);
  });

  it("cdpUrl is loopback-only and resolves the connect port", async () => {
    const deps = fakeDeps();
    const refused = await performActions([{ type: "press", key: "Tab" }], {
      deps,
      cdpUrl: "http://evil.example:9222",
    });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/loopback-only/);
    expect(deps._connectCalls).toHaveLength(0);

    const ok = await performActions([{ type: "press", key: "Tab" }], {
      deps,
      cdpUrl: "http://localhost:9333",
    });
    expect(ok.ok).toBe(true);
    // Connection target is rebuilt against 127.0.0.1 — never the raw string.
    expect(deps._connectCalls).toEqual(["http://127.0.0.1:9333"]);
  });

  it("warns when the attached Chrome is not the dedicated connector profile", async () => {
    const deps = fakeDeps();
    const warned = await performActions([{ type: "press", key: "Tab" }], {
      deps,
    });
    expect(warned.profileWarning).toMatch(/connector profile/);

    // Chrome writes DevToolsActivePort into the profile it was launched with;
    // when the connector profile owns the attached port there is no warning.
    const profileDir = path.join(fakeHome, ".chainlesschain", "chrome-profile");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, "DevToolsActivePort"),
      "9222\n/devtools/browser/abc",
      "utf-8",
    );
    const clean = await performActions([{ type: "press", key: "Tab" }], {
      deps: fakeDeps(),
    });
    expect(clean.profileWarning).toBeUndefined();
  });

  it("surfaces attach/import failures as {ok:false, error}", async () => {
    const deps = fakeDeps();
    deps.importPlaywright = async () => {
      throw new Error("Cannot find package 'playwright'");
    };
    const noPw = await performActions([{ type: "press", key: "Tab" }], {
      deps,
    });
    expect(noPw.ok).toBe(false);
    expect(noPw.error).toMatch(/playwright is not installed/);

    const deps2 = fakeDeps();
    deps2.importPlaywright = async () => ({
      chromium: {
        connectOverCDP: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:9222");
        },
      },
    });
    const noChrome = await performActions([{ type: "press", key: "Tab" }], {
      deps: deps2,
    });
    expect(noChrome.ok).toBe(false);
    expect(noChrome.error).toMatch(/cc browse chrome launch/);
  });

  it("browserActionsDir honors CC_BROWSER_ACTIONS_DIR and falls back to the home dir", () => {
    expect(browserActionsDir({ deps: fakeDeps() })).toBe(auditDir);
    const noEnv = fakeDeps();
    noEnv.env = () => ({});
    expect(browserActionsDir({ deps: noEnv })).toBe(
      path.join(fakeHome, ".chainlesschain", "browser-actions"),
    );
  });
});
