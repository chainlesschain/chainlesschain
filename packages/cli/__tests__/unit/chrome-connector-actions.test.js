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
  browserDomRedactionMetadata,
  browserActionsDir,
  normalizeBrowserActions,
  performActions,
  redactBrowserDom,
  redactBrowserUrl,
  resolveLoopbackCdpPort,
} from "../../src/lib/chrome-connector.js";
import {
  issueBrowserOriginGrant,
  verifyBrowserEvidenceEnvelope,
} from "../../src/lib/browser-evidence.js";

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

describe("browser observation redaction", () => {
  it("removes URL credentials/query values and sensitive DOM values", () => {
    expect(
      redactBrowserUrl(
        "https://alice:password@example.com/account?token=opaque-session&view=full#private",
      ),
    ).toBe("https://example.com/account?token=[REDACTED]&view=[REDACTED]");

    const dom = redactBrowserDom(
      '<input name="api_token" value="opaque-session">' +
        '<a href="https://example.com/download?ticket=opaque-ticket">go</a>' +
        "<p>Bearer abcdefghijklmnop</p>",
    );
    expect(dom).not.toContain("opaque-session");
    expect(dom).not.toContain("opaque-ticket");
    expect(dom).not.toContain("abcdefghijklmnop");
    expect(dom).toContain('value="[REDACTED]"');
    expect(dom).toContain("ticket=[REDACTED]");
    expect(
      browserDomRedactionMetadata(
        '<input name="api_token" value="opaque-session">' +
          '<a href="https://example.com/download?ticket=opaque-ticket">go</a>' +
          "<p>Bearer abcdefghijklmnop</p>",
      ),
    ).toEqual({
      applied: true,
      sensitiveFieldValues: 1,
      urlQueryValues: 1,
      secretPatterns: 1,
    });
  });

  it("redacts a sensitive input before applying the DOM cap", () => {
    const secret = "opaque-not-pattern-sensitive-value";
    const html = `<input type="password" value="${secret}">`;
    const capped = redactBrowserDom(html, html.indexOf(secret) + 12);

    expect(capped).not.toContain(secret);
    expect(capped).not.toContain(secret.slice(0, 8));
    expect(capped).toContain("[REDACTED]");
  });

  it("redacts query values from relative DOM URLs", () => {
    const secret = "plain-value-123456789";
    const dom = redactBrowserDom(
      `<a href="/download?ticket=${secret}&view=full#private">go</a>`,
    );

    expect(dom).not.toContain(secret);
    expect(dom).not.toContain("full");
    expect(dom).not.toContain("private");
    expect(dom).toContain("/download?ticket=[REDACTED]&view=[REDACTED]");
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
    const [audit] = readAuditLines();
    expect(audit.screenshotRef).toBe(res.steps[0].screenshotRef);
    expect(audit.screenshotRef).not.toContain(os.tmpdir());
    expect(audit.result).toBe("screenshot captured");
    expect(JSON.stringify(audit)).not.toContain(res.steps[0].screenshotPath);
  });

  it("cleans a partial screenshot and redacts its generated path when the action fails", async () => {
    let generatedPath;
    const page = fakePage({
      screenshot: async ({ path: p }) => {
        generatedPath = p;
        fs.writeFileSync(p, "partial-png");
        throw new Error(`failed while writing ${p}`);
      },
    });
    const res = await performActions([{ type: "screenshot" }], {
      deps: fakeDeps({ page }),
    });
    const [audit] = readAuditLines();

    expect(res.ok).toBe(false);
    expect(res.steps[0].screenshotPath).toBeUndefined();
    expect(res.steps[0].screenshotRef).toBeUndefined();
    expect(res.steps[0].detail).toContain("[SCREENSHOT_PATH]");
    expect(JSON.stringify(res)).not.toContain(generatedPath);
    expect(audit.screenshotRef).toBeUndefined();
    expect(audit.result).toContain("[SCREENSHOT_PATH]");
    expect(JSON.stringify(audit)).not.toContain(generatedPath);
    expect(fs.existsSync(generatedPath)).toBe(false);
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
      pageBefore: "http://localhost:3000/after",
      pageAfter: "http://localhost:3000/after",
      result: "pressed Enter",
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

  it("redacts navigation URLs and result detail before output and audit", async () => {
    const deps = fakeDeps();
    expect(() =>
      normalizeBrowserActions([
        {
          type: "navigate",
          url: "https://alice:password@example.com/path",
        },
      ]),
    ).toThrow(/embedded credentials/u);
    const secretUrl = "https://example.com/path?token=opaque-session#private";
    const res = await performActions([{ type: "navigate", url: secretUrl }], {
      deps,
    });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res)).not.toContain("opaque-session");
    expect(res.steps[0].detail).toContain("token=[REDACTED]");

    const [line] = readAuditLines();
    expect(line.url).toBe("https://example.com/path?token=[REDACTED]");
    expect(line.result).not.toContain("opaque-session");
    expect(line.pageBefore).toBe("http://localhost:3000/after");
    expect(line.pageAfter).toBe("http://localhost:3000/after");
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

describe("managed transfer and canonical evidence actions", () => {
  const binding = {
    sessionId: "browser-action-session",
    sessionRevision: 3,
    diff: {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      digest: `sha256:${"c".repeat(64)}`,
    },
    testRun: { id: "chrome-connector-actions", attempt: 1 },
  };

  function originGrant(scopes) {
    return issueBrowserOriginGrant({
      grantId: "grant-localhost-3000",
      binding,
      origin: "http://localhost:3000",
      revision: 5,
      scopes,
      credentialBoundary: "session-bound",
      issuedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2099-08-21T00:00:00.000Z",
    });
  }

  it("uploads only a resolved managed session artifact and never accepts a caller path", async () => {
    expect(() =>
      normalizeBrowserActions([
        { type: "upload", selector: "#file", path: "C:/secret.txt" },
      ]),
    ).toThrow(/managed session artifact_id/u);

    const calls = [];
    const page = fakePage({
      setInputFiles: async (selector, filePath) =>
        calls.push([selector, filePath]),
    });
    let cleaned = false;
    const result = await performActions(
      [{ type: "upload", selector: "#file", artifact_id: "art_upload_1" }],
      {
        deps: fakeDeps({ page }),
        resolveUploadArtifact: async () => ({
          path: "C:/managed/upload.txt",
          metadata: {
            id: "art_upload_1",
            sha256: "d".repeat(64),
            size: 12,
          },
          cleanup: () => {
            cleaned = true;
          },
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.steps[0].uploadArtifact).toEqual({
      id: "art_upload_1",
      sha256: `sha256:${"d".repeat(64)}`,
      size: 12,
    });
    expect(calls).toEqual([["#file", "C:/managed/upload.txt"]]);
    expect(cleaned).toBe(true);

    let rejectedCleaned = false;
    const rejected = await performActions(
      [{ type: "upload", selector: "#file", artifact_id: "art_upload_1" }],
      {
        deps: fakeDeps({ page }),
        resolveUploadArtifact: async () => ({
          path: "C:/managed/upload.txt",
          metadata: {
            id: "art_wrong_authority",
            sha256: "d".repeat(64),
            size: 12,
          },
          cleanup: () => {
            rejectedCleaned = true;
          },
        }),
      },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.steps[0].detail).toMatch(/mismatched metadata/u);
    expect(rejectedCleaned).toBe(true);
  });

  it("captures downloads only at generated paths with a content digest", async () => {
    let savedPath;
    const page = fakePage({
      waitForEvent: async (event) => {
        expect(event).toBe("download");
        return {
          saveAs: async (filePath) => {
            savedPath = filePath;
            fs.writeFileSync(filePath, "safe-download");
          },
          suggestedFilename: () => "report.txt",
        };
      },
    });
    const result = await performActions(
      [{ type: "download", selector: "#download" }],
      { deps: fakeDeps({ page }) },
    );

    expect(result.ok).toBe(true);
    expect(savedPath.startsWith(os.tmpdir())).toBe(true);
    expect(result.steps[0]).toMatchObject({
      downloadPath: savedPath,
      downloadSuggestedName: "report.txt",
    });
    expect(result.steps[0].downloadSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    fs.rmSync(savedPath, { force: true });
  });

  it("binds real action observations and DOM/screenshot digests into an envelope", async () => {
    const handlers = {};
    const page = fakePage({
      on: (event, handler) => {
        handlers[event] = handler;
      },
      off: () => {},
      content: async () =>
        '<html><input type="password" value="opaque-password"></html>',
      screenshot: async ({ path: filePath }) => {
        fs.writeFileSync(filePath, "png-one");
        handlers.console?.({
          type: () => "error",
          text: () => "Bearer abcdefghijklmnop",
        });
        handlers.response?.({
          status: () => 500,
          url: () => "http://localhost:3000/api?token=opaque-token",
        });
      },
    });
    const localGrant = originGrant(["observe"]);
    const result = await performActions([{ type: "screenshot" }], {
      deps: fakeDeps({ page }),
      sessionId: binding.sessionId,
      evidenceBinding: binding,
      originGrants: [localGrant],
      expectedGrantRevisions: { [localGrant.origin]: 5 },
    });

    expect(result.ok).toBe(true);
    expect(result.evidence.actions[0]).toMatchObject({
      type: "screenshot",
      sideEffect: "none",
      authority: { origin: "http://localhost:3000", revision: 5 },
    });
    expect(result.evidence.domSnapshot.contentRetained).toBe(false);
    expect(result.evidence.domSnapshot.redaction).toMatchObject({
      applied: true,
      sensitiveFieldValues: 1,
    });
    expect(result.evidence.screenshots[0].digest).toBe(
      result.steps[0].screenshotSha256,
    );
    expect(JSON.stringify(result.evidence)).not.toContain("opaque-password");
    expect(JSON.stringify(result.evidence)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(result.evidence)).not.toContain("opaque-token");
    expect(verifyBrowserEvidenceEnvelope(result.evidence)).toBeTruthy();
    fs.rmSync(result.steps[0].screenshotPath, { force: true });

    const sessionMismatch = await performActions([{ type: "screenshot" }], {
      deps: fakeDeps({ page }),
      sessionId: "different-session",
      evidenceBinding: binding,
      originGrants: [localGrant],
      expectedGrantRevisions: { [localGrant.origin]: 5 },
    });
    expect(sessionMismatch).toMatchObject({
      ok: false,
      error: expect.stringMatching(/active session/u),
    });

    const replay = await performActions([{ type: "screenshot" }], {
      deps: fakeDeps({ page }),
      sessionId: binding.sessionId,
      evidenceBinding: binding,
      originGrants: [localGrant],
      expectedGrantRevisions: { [localGrant.origin]: 5 },
      replaySourceEnvelope: result.evidence,
    });
    expect(replay.ok).toBe(true);
    expect(replay.evidence.replay).toMatchObject({
      sourceEnvelopeDigest: result.evidence.envelopeDigest,
      sideEffectBoundary: "deny",
      credentialBoundary: "deny",
    });
    fs.rmSync(replay.steps[0].screenshotPath, { force: true });
  });
});
