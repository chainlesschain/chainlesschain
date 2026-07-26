/**
 * browser_state agent tool (IDE gap-analysis P1 #8 — first-class agent entry
 * to the Chrome CDP connector). Covers: contract registration, policy
 * metadata, dispatch through executeTool with a faked playwright (via the
 * chrome-connector _deps seam), error surfacing, and formatToolArgs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AGENT_TOOLS,
  executeTool,
  formatToolArgs,
} from "../../src/runtime/agent-core.js";
import { _deps as chromeDeps } from "../../src/lib/chrome-connector.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  TOOL_POLICY_METADATA,
} = require("../../src/runtime/coding-agent-policy.cjs");

function fakePage({ url = "http://localhost:5173/", title = "App" } = {}) {
  return {
    url: () => url,
    title: async () => title,
    on: () => {},
    off: () => {},
    waitForTimeout: async () => {},
    reload: async () => {},
    content: async () => "<html><body>hello</body></html>",
    screenshot: async () => {},
  };
}

function fakePlaywright(pages, { failConnect = false } = {}) {
  return {
    chromium: {
      connectOverCDP: async () => {
        if (failConnect) throw new Error("ECONNREFUSED 127.0.0.1:9222");
        return {
          contexts: () => [{ pages: () => pages }],
          close: async () => {},
        };
      },
    },
  };
}

describe("browser_state contract + policy", () => {
  it("is registered in AGENT_TOOLS with the observation schema", () => {
    const tool = AGENT_TOOLS.find((t) => t.function?.name === "browser_state");
    expect(tool).toBeDefined();
    const props = tool.function.parameters.properties;
    for (const key of [
      "port",
      "tab",
      "reload",
      "watch_ms",
      "include_dom",
      "dom_cap",
      "screenshot",
    ]) {
      expect(props[key], `schema property ${key}`).toBeDefined();
    }
    // Screenshot is a boolean (temp-file capture), never a caller-chosen path
    // — an agent-controlled path would make a "read" tool able to overwrite
    // arbitrary files.
    expect(props.screenshot.type).toBe("boolean");
    expect(props.screenshot_path).toBeUndefined();
  });

  it("is read-only and available in plan mode", () => {
    const policy = TOOL_POLICY_METADATA.browser_state;
    expect(policy).toBeDefined();
    expect(policy.isReadOnly).toBe(true);
    expect(policy.availableInPlanMode).toBe(true);
    expect(policy.planModeBehavior).toBe("allow");
    expect(policy.requiresConfirmation).toBe(false);
  });
});

describe("browser_state dispatch (faked playwright via _deps)", () => {
  let savedImporter;
  let savedArtifactsDir;
  let artifactsDir;

  beforeEach(() => {
    savedImporter = chromeDeps.importPlaywright;
    savedArtifactsDir = process.env.CC_ARTIFACTS_DIR;
    artifactsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-state-artifacts-"),
    );
    process.env.CC_ARTIFACTS_DIR = artifactsDir;
  });
  afterEach(() => {
    chromeDeps.importPlaywright = savedImporter;
    if (savedArtifactsDir === undefined) {
      delete process.env.CC_ARTIFACTS_DIR;
    } else {
      process.env.CC_ARTIFACTS_DIR = savedArtifactsDir;
    }
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  });

  it("returns page state through executeTool", async () => {
    chromeDeps.importPlaywright = async () =>
      fakePlaywright([fakePage(), fakePage({ url: "http://x/2" })]);
    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, include_dom: true },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.url).toBe("http://localhost:5173/");
    expect(res.title).toBe("App");
    expect(res.tabs).toHaveLength(2);
    expect(res.html).toContain("hello");
  });

  it("caps the DOM at dom_cap and flags truncation", async () => {
    const page = fakePage();
    page.content = async () => "x".repeat(500);
    chromeDeps.importPlaywright = async () => fakePlaywright([page]);
    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, dom_cap: 100 },
      {},
    );
    expect(res.html).toHaveLength(100);
    expect(res.htmlTruncated).toBe(true);
  });

  it("redacts URL, console, network, title, and DOM secrets", async () => {
    const handlers = {};
    const page = fakePage({
      url: "https://alice:password@example.com/app?token=opaque-session#private",
      title: "Bearer abcdefghijklmnop",
    });
    page.on = (event, handler) => {
      handlers[event] = handler;
    };
    page.off = () => {};
    page.waitForTimeout = async () => {
      handlers.console?.({
        type: () => "error",
        text: () => "Bearer abcdefghijklmnop",
      });
      handlers.requestfailed?.({
        url: () => "https://api.example.com/data?auth=opaque-network",
        failure: () => ({ errorText: "Bearer abcdefghijklmnop" }),
      });
      handlers.response?.({
        status: () => 500,
        url: () => "https://api.example.com/fail?ticket=opaque-ticket",
      });
    };
    page.content = async () =>
      '<input type="password" value="opaque-password">' +
      '<a href="https://example.com/go?session=opaque-dom">go</a>';
    chromeDeps.importPlaywright = async () => fakePlaywright([page]);

    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, include_dom: true },
      {},
    );
    const json = JSON.stringify(res);
    for (const secret of [
      "password@example",
      "opaque-session",
      "abcdefghijklmnop",
      "opaque-network",
      "opaque-ticket",
      "opaque-password",
      "opaque-dom",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(res.url).toBe("https://example.com/app?token=[REDACTED]");
    expect(res.title).toBe("Bearer [REDACTED]");
    expect(res.console[0].text).toBe("Bearer [REDACTED]");
    expect(res.network[0].url).toContain("auth=[REDACTED]");
    expect(res.network[1].url).toContain("ticket=[REDACTED]");
    expect(res.html).toContain('value="[REDACTED]"');
    expect(res.html).toContain("session=[REDACTED]");
  });

  it("promotes a screenshot to a session artifact without returning its temp path", async () => {
    let capturedPath;
    const page = fakePage();
    page.screenshot = async ({ path: p }) => {
      capturedPath = p;
      fs.writeFileSync(p, "fake-png");
    };
    chromeDeps.importPlaywright = async () => fakePlaywright([page]);
    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, screenshot: true, include_dom: false },
      { sessionId: "sess-browser-state" },
    );
    expect(capturedPath.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(capturedPath)).toBe(false);
    expect(res.screenshotPath).toBeUndefined();
    expect(res.screenshotRef).toMatch(/^art_/);
    expect(res.screenshotArtifact).toMatchObject({
      id: res.screenshotRef,
      kind: "screenshot",
      mime: "image/png",
      sessionId: "sess-browser-state",
    });
    expect(res.screenshotArtifact.sourcePath).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(artifactsDir, "files", res.screenshotArtifact.file),
      ),
    ).toBe(true);
    expect(res.html).toBeUndefined();
  });

  it("does not expose host paths when screenshot artifact publication fails", async () => {
    let capturedPath;
    const page = fakePage();
    page.screenshot = async ({ path: p }) => {
      capturedPath = p;
      fs.writeFileSync(p, "fake-png");
    };
    chromeDeps.importPlaywright = async () => fakePlaywright([page]);
    const blockedStore = path.join(artifactsDir, "not-a-directory");
    fs.writeFileSync(blockedStore, "blocked");
    process.env.CC_ARTIFACTS_DIR = blockedStore;

    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, screenshot: true, include_dom: false },
      { sessionId: "sess-browser-state-failure" },
    );
    const json = JSON.stringify(res);

    expect(res.screenshotPath).toBeUndefined();
    expect(res.screenshotRef).toBeUndefined();
    expect(res.screenshotArtifact).toBeUndefined();
    expect(res.screenshotArtifactError).toMatch(
      /^browser screenshot artifact publication failed/,
    );
    expect(json).not.toContain(capturedPath);
    expect(json).not.toContain(blockedStore);
    expect(fs.existsSync(capturedPath)).toBe(false);
  });

  it("cleans a partial screenshot and redacts its generated path when capture fails", async () => {
    let capturedPath;
    const page = fakePage();
    page.screenshot = async ({ path: p }) => {
      capturedPath = p;
      fs.writeFileSync(p, "partial-png");
      throw new Error(`failed while writing ${p}`);
    };
    chromeDeps.importPlaywright = async () => fakePlaywright([page]);

    const res = await executeTool(
      "browser_state",
      { watch_ms: 0, screenshot: true, include_dom: false },
      { sessionId: "sess-browser-state-capture-failure" },
    );
    const json = JSON.stringify(res);

    expect(res.ok).toBe(true);
    expect(res.screenshotError).toContain("[SCREENSHOT_PATH]");
    expect(res.screenshotPath).toBeUndefined();
    expect(res.screenshotRef).toBeUndefined();
    expect(res.screenshotArtifact).toBeUndefined();
    expect(json).not.toContain(capturedPath);
    expect(fs.existsSync(capturedPath)).toBe(false);
  });

  it("surfaces a clean error when Chrome is not attachable", async () => {
    chromeDeps.importPlaywright = async () =>
      fakePlaywright([], { failConnect: true });
    const res = await executeTool("browser_state", {}, {});
    expect(res.error).toMatch(/browser_state failed/);
    expect(res.error).toMatch(/cc browse chrome launch/);
  });

  it("surfaces a clean error when playwright is missing", async () => {
    chromeDeps.importPlaywright = async () => {
      throw new Error("Cannot find package 'playwright'");
    };
    const res = await executeTool("browser_state", {}, {});
    expect(res.error).toMatch(/browser_state failed/);
    expect(res.error).toMatch(/playwright is not installed/);
  });
});

describe("browser_state formatToolArgs", () => {
  it("renders tab/port and the reload marker", () => {
    expect(formatToolArgs("browser_state", {})).toBe("tab=0 port=9222");
    expect(
      formatToolArgs("browser_state", { tab: 2, port: 9333, reload: true }),
    ).toBe("tab=2 port=9333 reload");
  });
});
