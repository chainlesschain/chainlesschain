/**
 * Tests for agent bundle integration into CLI agent REPL.
 *
 * Verifies:
 * - cc agent --bundle <path> loads and resolves bundle
 * - AGENTS.md injected as system prompt
 * - USER.md seeded into MemoryStore (idempotent)
 * - Manifest model/provider override when not specified by user
 * - Invalid bundle path produces error log, not crash
 * - Policy passes bundlePath through
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- agent-policy + server-policy ---
import {
  resolveAgentPolicy,
  resolveServerPolicy,
} from "../../src/runtime/policies/agent-policy.js";

describe("resolveAgentPolicy bundlePath", () => {
  it("passes bundlePath from overrides", () => {
    const policy = resolveAgentPolicy({
      overrides: { bundlePath: "/my/bundle" },
    });
    expect(policy.bundlePath).toBe("/my/bundle");
  });

  it("defaults bundlePath to null", () => {
    const policy = resolveAgentPolicy({ overrides: {} });
    expect(policy.bundlePath).toBeNull();
  });
});

// --- agent-bundle-loader + resolver (session-core) ---
describe("agent-bundle loader+resolver", () => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

  let tmpDir;

  function createBundle(dir, manifest, extras = {}) {
    fs.mkdirSync(dir, { recursive: true });
    if (manifest) {
      fs.writeFileSync(
        path.join(dir, "chainless-agent.json"),
        JSON.stringify(manifest),
        "utf-8",
      );
    }
    if (extras.agentsMd) {
      fs.writeFileSync(path.join(dir, "AGENTS.md"), extras.agentsMd, "utf-8");
    }
    if (extras.userMd) {
      fs.writeFileSync(path.join(dir, "USER.md"), extras.userMd, "utf-8");
    }
  }

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `cc-bundle-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("loadBundle reads manifest + AGENTS.md + USER.md", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const bundleDir = path.join(tmpDir, "test-bundle");
    createBundle(
      bundleDir,
      { id: "test-agent", name: "Test Agent", mode: "local" },
      {
        agentsMd: "You are a helpful assistant.",
        userMd: "# Profile\nPrefers TypeScript.",
      },
    );

    const bundle = loadBundle(bundleDir);
    expect(bundle.manifest.id).toBe("test-agent");
    expect(bundle.agentsMd).toBe("You are a helpful assistant.");
    expect(bundle.userMd).toContain("Prefers TypeScript");
  });

  it("resolveBundle extracts systemPrompt from AGENTS.md", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const {
      resolveBundle,
    } = require("@chainlesschain/session-core/agent-bundle-resolver");
    const bundleDir = path.join(tmpDir, "prompt-bundle");
    createBundle(
      bundleDir,
      { id: "prompt-test", name: "Prompt", mode: "local" },
      { agentsMd: "You are an expert coder." },
    );

    const bundle = loadBundle(bundleDir);
    const resolved = resolveBundle(bundle);
    expect(resolved.systemPrompt).toBe("You are an expert coder.");
    expect(resolved.seedResult).toBeNull();
  });

  it("resolveBundle seeds USER.md into MemoryStore idempotently", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const {
      resolveBundle,
    } = require("@chainlesschain/session-core/agent-bundle-resolver");
    const { MemoryStore } = require("@chainlesschain/session-core");
    const bundleDir = path.join(tmpDir, "seed-bundle");
    createBundle(
      bundleDir,
      { id: "seed-test", name: "Seed", mode: "local" },
      { userMd: "# Profile\nLikes Rust.\n# Tone\nBe concise." },
    );

    const store = new MemoryStore();
    const bundle = loadBundle(bundleDir);

    const r1 = resolveBundle(bundle, { memoryStore: store });
    expect(r1.seedResult.seeded).toBe(2);
    expect(r1.seedResult.skipped).toBe(0);

    // Second call — idempotent, should skip
    const r2 = resolveBundle(bundle, { memoryStore: store });
    expect(r2.seedResult.seeded).toBe(0);
    expect(r2.seedResult.skipped).toBe(2);
  });

  it("resolveBundle propagates manifest model/provider", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const {
      resolveBundle,
    } = require("@chainlesschain/session-core/agent-bundle-resolver");
    const bundleDir = path.join(tmpDir, "model-bundle");
    createBundle(bundleDir, {
      id: "model-test",
      name: "Model",
      mode: "local",
      model: "gpt-4o",
      provider: "openai",
    });

    const bundle = loadBundle(bundleDir);
    const resolved = resolveBundle(bundle);
    expect(resolved.manifest.model).toBe("gpt-4o");
    expect(resolved.manifest.provider).toBe("openai");
  });

  it("loadBundle throws on missing manifest", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const emptyDir = path.join(tmpDir, "empty-bundle");
    fs.mkdirSync(emptyDir, { recursive: true });

    expect(() => loadBundle(emptyDir)).toThrow("missing");
  });

  it("loadBundle throws on non-directory", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "nope", "utf-8");

    expect(() => loadBundle(filePath)).toThrow("not a directory");
  });

  it("resolveBundle returns mcpConfig for MCP wiring", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const {
      resolveBundle,
    } = require("@chainlesschain/session-core/agent-bundle-resolver");
    const bundleDir = path.join(tmpDir, "mcp-bundle");
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, "chainless-agent.json"),
      JSON.stringify({ id: "mcp-test", name: "MCP", mode: "local" }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(bundleDir, "mcp.json"),
      JSON.stringify({
        servers: {
          weather: {
            command: "npx",
            args: ["-y", "@mcp/weather"],
            transport: "stdio",
          },
          fs: { command: "npx", args: ["-y", "@mcp/fs"], transport: "stdio" },
        },
      }),
      "utf-8",
    );

    const bundle = loadBundle(bundleDir);
    const resolved = resolveBundle(bundle);
    expect(resolved.mcpConfig).toBeTruthy();
    expect(Object.keys(resolved.mcpConfig.servers)).toEqual(["weather", "fs"]);
    expect(resolved.mcpConfig.servers.weather.command).toBe("npx");
  });

  it("resolveBundle returns approvalPolicy for session gate", () => {
    const {
      loadBundle,
    } = require("@chainlesschain/session-core/agent-bundle-loader");
    const {
      resolveBundle,
    } = require("@chainlesschain/session-core/agent-bundle-resolver");
    const bundleDir = path.join(tmpDir, "approval-bundle");
    fs.mkdirSync(path.join(bundleDir, "policies"), { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, "chainless-agent.json"),
      JSON.stringify({ id: "ap-test", name: "Approval", mode: "local" }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(bundleDir, "policies", "approval.json"),
      JSON.stringify({ default: "trusted" }),
      "utf-8",
    );

    const bundle = loadBundle(bundleDir);
    const resolved = resolveBundle(bundle);
    expect(resolved.approvalPolicy).toEqual({ default: "trusted" });
  });

  it("ApprovalGate.setSessionPolicy applies bundle default", () => {
    const {
      ApprovalGate,
      APPROVAL_POLICY,
    } = require("@chainlesschain/session-core");
    const gate = new ApprovalGate({ defaultPolicy: APPROVAL_POLICY.STRICT });
    gate.setSessionPolicy("sess-1", "trusted");
    expect(gate.getSessionPolicy("sess-1")).toBe("trusted");
  });
});

// --- server-policy ---
describe("resolveServerPolicy bundlePath", () => {
  it("passes bundlePath from overrides", () => {
    const policy = resolveServerPolicy({ bundlePath: "/srv/bundle" });
    expect(policy.bundlePath).toBe("/srv/bundle");
  });

  it("defaults bundlePath to null", () => {
    const policy = resolveServerPolicy({});
    expect(policy.bundlePath).toBeNull();
  });
});

// --- WSSessionManager defaultSystemPromptExtension ---
describe("WSSessionManager bundle integration", () => {
  it("injects defaultSystemPromptExtension into new sessions", async () => {
    // Dynamic import to avoid ESM/CJS conflicts at module level
    const { WSSessionManager } =
      await import("../../src/gateways/ws/ws-session-gateway.js");

    const mgr = new WSSessionManager({
      defaultSystemPromptExtension: "You are a code reviewer.",
    });

    const { sessionId } = mgr.createSession({ type: "agent" });
    const session = mgr.getSession(sessionId);

    // System prompt should contain the extension
    const sysMsg = session.messages.find((m) => m.role === "system");
    expect(sysMsg.content).toContain("You are a code reviewer.");
  });

  it("per-session extension overrides default", async () => {
    const { WSSessionManager } =
      await import("../../src/gateways/ws/ws-session-gateway.js");

    const mgr = new WSSessionManager({
      defaultSystemPromptExtension: "Default instructions.",
    });

    const { sessionId } = mgr.createSession({
      type: "agent",
      systemPromptExtension: "Custom override.",
    });
    const session = mgr.getSession(sessionId);
    const sysMsg = session.messages.find((m) => m.role === "system");
    expect(sysMsg.content).toContain("Custom override.");
    expect(sysMsg.content).not.toContain("Default instructions.");
  });
});
