/**
 * browser_act agent tool (gap-analysis #6 — the explicit, approval-gated
 * ACTION side of the Chrome connector; browser_state stays the read-only
 * default). Covers: contract registration, HIGH-risk policy metadata (and
 * that browser_state stays LOW), evaluateToolPolicy approval semantics,
 * ApprovalGate gating inside executeTool, dispatch with a faked playwright
 * via the chrome-connector _deps seam, error surfacing, and formatToolArgs.
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
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import { issueBrowserOriginGrant } from "../../src/lib/browser-evidence.js";
import { ApprovalGate, APPROVAL_POLICY } from "@chainlesschain/session-core";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  TOOL_POLICY_METADATA,
  evaluateToolPolicy,
} = require("../../src/runtime/coding-agent-policy.cjs");

function fakePage() {
  const calls = [];
  return {
    calls,
    url: () => "http://localhost:5173/done",
    title: async () => "Done",
    click: async (sel) => calls.push(["click", sel]),
    fill: async (sel, text) => calls.push(["fill", sel, text]),
    keyboard: { press: async (k) => calls.push(["press", k]) },
    goto: async (u) => calls.push(["goto", u]),
    waitForSelector: async (sel) => calls.push(["wait", sel]),
    screenshot: async ({ path: p }) => {
      calls.push(["screenshot", p]);
      fs.writeFileSync(p, "fake-png");
    },
    setInputFiles: async (selector, filePath) =>
      calls.push(["upload", selector, filePath]),
    waitForEvent: async () => ({
      saveAs: async (filePath) => fs.writeFileSync(filePath, "downloaded"),
      suggestedFilename: () => "download.txt",
    }),
    on: () => {},
    off: () => {},
    content: async () => "<html><body>safe</body></html>",
    textContent: async () => "hello world",
  };
}

function fakePlaywright(page, { failConnect = false, connectCalls = [] } = {}) {
  return {
    chromium: {
      connectOverCDP: async (endpoint) => {
        connectCalls.push(endpoint);
        if (failConnect) throw new Error("ECONNREFUSED 127.0.0.1:9222");
        return {
          contexts: () => [{ pages: () => [page] }],
          close: async () => {},
        };
      },
    },
  };
}

describe("browser_act contract + policy", () => {
  it("is registered in AGENT_TOOLS with the action schema", () => {
    const tool = AGENT_TOOLS.find((t) => t.function?.name === "browser_act");
    expect(tool).toBeDefined();
    const props = tool.function.parameters.properties;
    for (const key of [
      "actions",
      "cdp_url",
      "port",
      "tab",
      "continue_on_error",
    ]) {
      expect(props[key], `schema property ${key}`).toBeDefined();
    }
    expect(tool.function.parameters.required).toEqual(["actions"]);
    const itemProps = props.actions.items.properties;
    expect(itemProps.type.enum).toEqual([
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
    expect(itemProps.artifact_id).toBeDefined();
    // Screenshot paths are generated internally — the schema must not offer
    // any path-like knob (an agent-chosen path would turn an action tool into
    // an arbitrary-file writer).
    expect(itemProps.path).toBeUndefined();
    expect(itemProps.file).toBeUndefined();
    expect(itemProps.output).toBeUndefined();
  });

  it("is HIGH risk, approval-gated, and NOT plan-mode-safe", () => {
    const policy = TOOL_POLICY_METADATA.browser_act;
    expect(policy).toBeDefined();
    expect(policy.riskLevel).toBe("high");
    expect(policy.requiresConfirmation).toBe(true);
    expect(policy.requiresPlanApproval).toBe(true);
    expect(policy.approvalFlow).toBe("policy");
    expect(policy.availableInPlanMode).toBe(false);
    expect(policy.planModeBehavior).toBe("blocked");
    expect(policy.isReadOnly).toBe(false);
  });

  it("browser_state stays LOW/read-only — read-only remains the default", () => {
    const policy = TOOL_POLICY_METADATA.browser_state;
    expect(policy.riskLevel).toBe("low");
    expect(policy.isReadOnly).toBe(true);
    expect(policy.availableInPlanMode).toBe(true);
  });

  it("evaluateToolPolicy forces plan approval + explicit confirmation", () => {
    const unplanned = evaluateToolPolicy({ toolName: "browser_act" });
    expect(unplanned.allowed).toBe(false);
    expect(unplanned.decision).toBe("require_plan");

    const unconfirmed = evaluateToolPolicy({
      toolName: "browser_act",
      planModeState: "approved",
      confirmed: false,
    });
    expect(unconfirmed.allowed).toBe(false);
    expect(unconfirmed.decision).toBe("require_confirmation");

    const confirmed = evaluateToolPolicy({
      toolName: "browser_act",
      planModeState: "approved",
      confirmed: true,
    });
    expect(confirmed.allowed).toBe(true);
  });
});

describe("browser_act dispatch (faked playwright via _deps)", () => {
  let savedImporter;
  let savedAuditDir;
  let savedArtifactsDir;
  let auditDir;
  let artifactsDir;

  beforeEach(() => {
    savedImporter = chromeDeps.importPlaywright;
    savedAuditDir = process.env.CC_BROWSER_ACTIONS_DIR;
    savedArtifactsDir = process.env.CC_ARTIFACTS_DIR;
    auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-act-tool-"));
    artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-act-artifacts-"));
    process.env.CC_BROWSER_ACTIONS_DIR = auditDir;
    process.env.CC_ARTIFACTS_DIR = artifactsDir;
  });
  afterEach(() => {
    chromeDeps.importPlaywright = savedImporter;
    if (savedAuditDir === undefined) {
      delete process.env.CC_BROWSER_ACTIONS_DIR;
    } else {
      process.env.CC_BROWSER_ACTIONS_DIR = savedAuditDir;
    }
    if (savedArtifactsDir === undefined) {
      delete process.env.CC_ARTIFACTS_DIR;
    } else {
      process.env.CC_ARTIFACTS_DIR = savedArtifactsDir;
    }
    try {
      fs.rmSync(auditDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    try {
      fs.rmSync(artifactsDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("executes actions and returns per-step outcomes + final page state", async () => {
    const page = fakePage();
    chromeDeps.importPlaywright = async () => fakePlaywright(page);
    const res = await executeTool(
      "browser_act",
      {
        actions: [
          { type: "click", selector: "#go" },
          { type: "press", key: "Enter" },
        ],
      },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.steps).toHaveLength(2);
    expect(res.steps.map((s) => s.action)).toEqual(["click", "press"]);
    expect(res.url).toBe("http://localhost:5173/done");
    expect(res.title).toBe("Done");
    expect(page.calls).toEqual([
      ["click", "#go"],
      ["press", "Enter"],
    ]);
    // Audit trail landed in the (env-overridden) actions dir.
    const files = fs.readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
  });

  it("an ApprovalGate non-allow blocks before anything touches the browser", async () => {
    const connectCalls = [];
    chromeDeps.importPlaywright = async () =>
      fakePlaywright(fakePage(), { connectCalls });
    let seen;
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "click", selector: "#go" }] },
      {
        approvalGate: {
          decide: async (ctx) => {
            seen = ctx;
            return { decision: "deny", via: "policy", policy: "strict" };
          },
        },
      },
    );
    expect(res.error).toMatch(/\[ApprovalGate\] browser_act denied/);
    expect(res.approval).toMatchObject({ decision: "deny", riskLevel: "high" });
    expect(seen.riskLevel).toBe("high");
    expect(seen.tool).toBe("browser_act");
    expect(connectCalls).toHaveLength(0);
  });

  it("fails closed before browser dispatch when durable remote approval has no browser lease support", async () => {
    const connectCalls = [];
    chromeDeps.importPlaywright = async () =>
      fakePlaywright(fakePage(), { connectCalls });
    const approvalGate = new ApprovalGate({
      defaultPolicy: APPROVAL_POLICY.STRICT,
      confirm: async () => ({
        approved: false,
        via: "lease-unavailable",
      }),
      consumeAuthorization: async () => true,
    });

    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "click", selector: "#must-not-run" }] },
      { approvalGate },
    );

    expect(res.error).toMatch(/\[ApprovalGate\] browser_act denied/);
    expect(res.approval).toMatchObject({
      decision: "deny",
      via: "lease-unavailable",
    });
    expect(connectCalls).toHaveLength(0);
  });

  it("an ApprovalGate allow lets the actions run", async () => {
    chromeDeps.importPlaywright = async () => fakePlaywright(fakePage());
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "press", key: "Tab" }] },
      {
        approvalGate: {
          decide: async () => ({ decision: "allow", via: "policy" }),
        },
      },
    );
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it("promotes action screenshots to artifacts without returning host paths", async () => {
    const page = fakePage();
    chromeDeps.importPlaywright = async () => fakePlaywright(page);
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "screenshot" }] },
      { sessionId: "sess-browser-act" },
    );

    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.steps[0].screenshotPath).toBeUndefined();
    expect(res.steps[0].screenshotRef).toMatch(/^art_/);
    expect(res.steps[0].screenshotArtifact).toMatchObject({
      id: res.steps[0].screenshotRef,
      kind: "screenshot",
      sessionId: "sess-browser-act",
    });
    expect(res.steps[0].screenshotArtifact.sourcePath).toBeUndefined();
    expect(res.steps[0].detail).toContain(res.steps[0].screenshotRef);
    const tempPath = page.calls.find((call) => call[0] === "screenshot")[1];
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(
      fs.existsSync(
        path.join(artifactsDir, "files", res.steps[0].screenshotArtifact.file),
      ),
    ).toBe(true);
  });

  it("does not expose host paths or dangling refs when screenshot publication fails", async () => {
    const page = fakePage();
    chromeDeps.importPlaywright = async () => fakePlaywright(page);
    const blockedStore = path.join(artifactsDir, "not-a-directory");
    fs.writeFileSync(blockedStore, "blocked");
    process.env.CC_ARTIFACTS_DIR = blockedStore;

    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "screenshot" }] },
      { sessionId: "sess-browser-act-failure" },
    );
    const tempPath = page.calls.find((call) => call[0] === "screenshot")[1];
    const json = JSON.stringify(res);

    expect(res.error).toBeUndefined();
    expect(res.steps[0].screenshotPath).toBeUndefined();
    expect(res.steps[0].screenshotRef).toBeUndefined();
    expect(res.steps[0].screenshotArtifact).toBeUndefined();
    expect(res.steps[0].screenshotArtifactError).toMatch(
      /^browser screenshot artifact publication failed/,
    );
    expect(res.steps[0].detail).toBe(res.steps[0].screenshotArtifactError);
    expect(json).not.toContain(tempPath);
    expect(json).not.toContain(blockedStore);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it("promotes upload/download and immutable canonical evidence under one session authority", async () => {
    const sessionId = "sess-browser-transfer-evidence";
    const uploadSource = path.join(auditDir, "upload.txt");
    fs.writeFileSync(uploadSource, "safe upload body", "utf8");
    const uploadArtifact = new ArtifactStore().publish({
      filePath: uploadSource,
      title: "Browser upload",
      kind: "data",
      sessionId,
    });
    const binding = {
      sessionId,
      sessionRevision: 4,
      diff: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        digest: `sha256:${"c".repeat(64)}`,
      },
      testRun: { id: "browser-transfer-tool", attempt: 1 },
    };
    const grant = issueBrowserOriginGrant({
      grantId: "grant-localhost-5173",
      binding,
      origin: "http://localhost:5173",
      revision: 6,
      scopes: ["upload", "download", "observe"],
      credentialBoundary: "session-bound",
      issuedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2099-08-21T00:00:00.000Z",
    });
    const page = fakePage();
    chromeDeps.importPlaywright = async () => fakePlaywright(page);

    const result = await executeTool(
      "browser_act",
      {
        actions: [
          {
            type: "upload",
            selector: "#upload",
            artifact_id: uploadArtifact.id,
          },
          { type: "download", selector: "#download" },
          { type: "screenshot" },
        ],
      },
      {
        sessionId,
        browserEvidenceBinding: binding,
        browserOriginGrants: [grant],
        browserExpectedGrantRevisions: { [grant.origin]: 6 },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.steps[0].uploadArtifact).toMatchObject({
      id: uploadArtifact.id,
      sha256: `sha256:${uploadArtifact.sha256}`,
    });
    expect(result.steps[1].downloadArtifact).toMatchObject({
      kind: "data",
      sessionId,
    });
    expect(result.steps[2].screenshotArtifact).toMatchObject({
      kind: "screenshot",
      sessionId,
    });
    expect(result.evidence).toMatchObject({
      binding: { session: { id: sessionId, revision: 4 } },
    });
    expect(result.evidenceArtifact).toMatchObject({
      kind: "data",
      sessionId,
      immutable: true,
      recordDigest: result.evidence.envelopeDigest,
    });
    const uploadCall = page.calls.find((call) => call[0] === "upload");
    expect(uploadCall).toBeDefined();
    expect(fs.existsSync(uploadCall[2])).toBe(false);
    expect(JSON.stringify(result)).not.toContain(uploadCall[2]);
  });

  it("fails closed without retrying when canonical evidence cannot be published", async () => {
    const sessionId = "sess-browser-evidence-publication-failure";
    const binding = {
      sessionId,
      sessionRevision: 1,
      diff: {
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        digest: `sha256:${"c".repeat(64)}`,
      },
      testRun: { id: "browser-evidence-publication-failure", attempt: 1 },
    };
    const grant = issueBrowserOriginGrant({
      grantId: "grant-evidence-publication-failure",
      binding,
      origin: "http://localhost:5173",
      revision: 1,
      scopes: ["observe"],
      issuedAt: "2026-08-21T00:00:00.000Z",
      expiresAt: "2099-08-21T00:00:00.000Z",
    });
    const blockedStore = path.join(artifactsDir, "not-a-directory");
    fs.writeFileSync(blockedStore, "blocked");
    process.env.CC_ARTIFACTS_DIR = blockedStore;
    chromeDeps.importPlaywright = async () => fakePlaywright(fakePage());

    const result = await executeTool(
      "browser_act",
      { actions: [{ type: "screenshot" }] },
      {
        sessionId,
        browserEvidenceBinding: binding,
        browserOriginGrants: [grant],
        browserExpectedGrantRevisions: { [grant.origin]: 1 },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.evidencePublicationFailed).toBe(true);
    expect(result.retrySafe).toBe(false);
    expect(result.evidenceArtifact).toBeUndefined();
    expect(result.evidenceArtifactError).toMatch(
      /^browser evidence artifact publication failed/u,
    );
    expect(result.recovery).toMatch(/do not retry side effects/u);
  });

  it("surfaces validation failures (javascript: navigate) as a tool error", async () => {
    const connectCalls = [];
    chromeDeps.importPlaywright = async () =>
      fakePlaywright(fakePage(), { connectCalls });
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "navigate", url: "javascript:alert(1)" }] },
      {},
    );
    expect(res.error).toMatch(/browser_act failed/);
    expect(res.error).toMatch(/http\(s\)/);
    expect(connectCalls).toHaveLength(0);
  });

  it("surfaces a clean error when Chrome is not attachable", async () => {
    chromeDeps.importPlaywright = async () =>
      fakePlaywright(fakePage(), { failConnect: true });
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "press", key: "Tab" }] },
      {},
    );
    expect(res.error).toMatch(/browser_act failed/);
    expect(res.error).toMatch(/cc browse chrome launch/);
  });

  it("a step-level failure returns per-step outcomes (not a bare error)", async () => {
    const page = fakePage();
    page.click = async () => {
      throw new Error("no node found for selector #missing");
    };
    chromeDeps.importPlaywright = async () => fakePlaywright(page);
    const res = await executeTool(
      "browser_act",
      { actions: [{ type: "click", selector: "#missing" }] },
      {},
    );
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(false);
    expect(res.steps[0].ok).toBe(false);
    expect(res.steps[0].detail).toMatch(/no node found/);
  });
});

describe("browser_act formatToolArgs", () => {
  it("summarizes the action kinds and target tab/port", () => {
    expect(
      formatToolArgs("browser_act", {
        actions: [{ type: "click" }, { type: "press" }],
      }),
    ).toBe("2 action(s): click,press tab=0 port=9222");
    expect(
      formatToolArgs("browser_act", {
        actions: [
          { type: "navigate" },
          { type: "waitForSelector" },
          { type: "type" },
          { type: "click" },
          { type: "assertText" },
        ],
        tab: 1,
        port: 9333,
      }),
    ).toBe(
      "5 action(s): navigate,waitForSelector,type,click,… tab=1 port=9333",
    );
  });
});
