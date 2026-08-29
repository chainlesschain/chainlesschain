import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settingsHooks from "../../src/lib/settings-hooks.cjs";
import hookEventBus from "../../src/lib/hook-event-bus.cjs";
import { HookEvents, HookPriority } from "../../src/lib/hook-manager.js";
import {
  HOOK_EVENT_CONTRACTS,
  HOOK_EVENT_TYPES,
} from "../../src/lib/hook-runtime-contract.js";
import {
  HooksV2Runtime,
  VALID_HOOK_EVENTS,
} from "../../src/lib/hooks-v2-runtime.js";
import {
  approveHookAuthority,
  assessHookTrust,
} from "../../src/lib/hook-trust.js";
import { HookAuditStore } from "../../src/lib/hook-audit-store.js";

function digest(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

describe("canonical Hook runtime convergence", () => {
  let directory;
  let priorTrustStore;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hook-runtime-"));
    fs.mkdirSync(path.join(directory, ".git"));
    priorTrustStore = process.env.CC_WORKSPACE_TRUST_STORE;
    process.env.CC_WORKSPACE_TRUST_STORE = path.join(
      directory,
      "workspace-trust.json",
    );
  });

  afterEach(() => {
    if (priorTrustStore == null) {
      delete process.env.CC_WORKSPACE_TRUST_STORE;
    } else {
      process.env.CC_WORKSPACE_TRUST_STORE = priorTrustStore;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("projects one typed event registry into every legacy surface", () => {
    const expected = Object.values(HOOK_EVENT_TYPES);
    expect(Object.values(HookEvents)).toEqual(expected);
    expect(settingsHooks.HOOK_EVENTS).toEqual(expected);
    expect(Object.values(hookEventBus.HOOK_EVENT_TYPES)).toEqual(expected);
    expect([...VALID_HOOK_EVENTS]).toEqual(expected);
    expect(Object.keys(HOOK_EVENT_CONTRACTS)).toEqual(expected);
    expect(HOOK_EVENT_CONTRACTS.PreToolUse.decisionCapable).toBe(true);
    expect(HOOK_EVENT_CONTRACTS.PostToolUse.decisionCapable).toBe(false);
    expect(HOOK_EVENT_TYPES.PlanModeEnter).toBe("PlanModeEnter");
  });

  it("finishes a higher-priority group before starting a lower one", async () => {
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
    });
    const timeline = [];
    runtime.registerHook({
      id: "low",
      event: "PostToolUse",
      type: "js",
      priority: HookPriority.LOW,
      handler: () => timeline.push("low"),
    });
    runtime.registerHook({
      id: "high",
      event: "PostToolUse",
      type: "js",
      priority: HookPriority.HIGH,
      handler: async () => {
        timeline.push("high:start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        timeline.push("high:end");
      },
    });

    const outcome = await runtime.emitEvent("PostToolUse", {});
    expect(outcome.success).toBe(true);
    expect(timeline).toEqual(["high:start", "high:end", "low"]);
  });

  it("runs equal-priority Hooks in parallel", async () => {
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
    });
    let started = 0;
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const handler = async () => {
      started += 1;
      if (started === 2) release();
      await barrier;
    };
    runtime.registerHook({
      id: "same-a",
      event: "PostToolUse",
      type: "js",
      priority: HookPriority.NORMAL,
      timeoutMs: 200,
      handler,
    });
    runtime.registerHook({
      id: "same-b",
      event: "PostToolUse",
      type: "js",
      priority: HookPriority.NORMAL,
      timeoutMs: 200,
      handler,
    });

    const outcome = await runtime.emitEvent("PostToolUse", {});
    expect(outcome.success).toBe(true);
    expect(started).toBe(2);
  });

  it("applies the canonical timeout to programmatic JavaScript Hooks", async () => {
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
    });
    runtime.registerHook({
      id: "slow-js",
      event: "PreToolUse",
      type: "js",
      timeoutMs: 10,
      handler: () => new Promise(() => {}),
    });

    const outcome = await runtime.emitEvent("PreToolUse", {});
    expect(outcome).toMatchObject({ blocked: true, decision: "block" });
    expect(outcome.results[0]).toMatchObject({
      status: "error",
      errorCode: "CC_HOOK_BUDGET_EXCEEDED",
    });
  });

  it("keeps async Hook results observe-only at decision gates", async () => {
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
    });
    const settled = new Promise((resolve) => {
      runtime.once("hook:async-settled", resolve);
    });
    runtime.registerHook({
      id: "async-block",
      event: "PreToolUse",
      type: "js",
      executionMode: "async",
      handler: () => ({ decision: "block", reason: "too late" }),
    });

    const outcome = await runtime.emitEvent("PreToolUse", {});
    expect(outcome).toMatchObject({
      blocked: false,
      decision: "continue",
    });
    expect(outcome.results[0]).toMatchObject({
      status: "queued",
      decision: "continue",
      deferred: true,
    });
    const record = await settled;
    expect(record.decision).toBe("continue");
  });

  it("requires explicit content-bound trust and reapproval after a change", async () => {
    const sourceFile = path.join(directory, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    const original = JSON.stringify({ hooks: { PreToolUse: [] } });
    fs.writeFileSync(sourceFile, original);
    const authority = {
      kind: "settings",
      scope: "project",
      sourceFile,
      subject: sourceFile,
      digest: digest(original),
      requiresConsent: true,
    };
    const handler = vi.fn(() => ({ decision: "allow" }));
    const definition = {
      id: "project-hook",
      event: "PreToolUse",
      type: "js",
      authority,
      handler,
    };
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
    });
    runtime.registerHook(definition);

    expect(
      assessHookTrust(definition, { workspaceRoot: directory }),
    ).toMatchObject({
      trusted: false,
      status: "first-use",
    });
    const first = await runtime.emitEvent("PreToolUse", {});
    expect(first).toMatchObject({ blocked: true, decision: "block" });
    expect(handler).not.toHaveBeenCalled();

    approveHookAuthority(authority, { workspaceRoot: directory });
    expect(
      assessHookTrust(definition, { workspaceRoot: directory }),
    ).toMatchObject({
      trusted: true,
      status: "trusted",
    });
    const approved = await runtime.emitEvent("PreToolUse", {});
    expect(approved).toMatchObject({ blocked: false, decision: "allow" });
    expect(handler).toHaveBeenCalledTimes(1);

    fs.writeFileSync(
      sourceFile,
      JSON.stringify({ hooks: { PreToolUse: [{}] } }),
    );
    expect(
      assessHookTrust(definition, { workspaceRoot: directory }),
    ).toMatchObject({
      trusted: false,
      status: "changed",
    });
    const changed = await runtime.emitEvent("PreToolUse", {});
    expect(changed).toMatchObject({ blocked: true, decision: "block" });
    expect(changed.results[0].errorCode).toBe("CC_HOOK_REAPPROVAL_REQUIRED");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("persists a bounded, redacted, tamper-evident audit chain", () => {
    const filePath = path.join(directory, "hook-audit.json");
    const store = new HookAuditStore({ filePath, maxRecords: 100 });
    for (let index = 0; index < 101; index += 1) {
      store.append({
        phase: "hook-result",
        event: "PreToolUse",
        hookId: `hook-${index}`,
        status: "success",
        secret: "must-not-be-persisted",
      });
    }
    expect(store.list({ limit: 1000 })).toHaveLength(100);
    expect(store.verify()).toMatchObject({ ok: true, length: 100 });
    expect(fs.readFileSync(filePath, "utf8")).not.toContain(
      "must-not-be-persisted",
    );

    const tampered = JSON.parse(fs.readFileSync(filePath, "utf8"));
    tampered.records[0].record.status = "forged";
    fs.writeFileSync(filePath, JSON.stringify(tampered));
    expect(store.verify()).toMatchObject({ ok: false, brokenAt: 0 });
  });

  it("fails closed at a decision gate when mandatory audit is unavailable", async () => {
    const failure = Object.assign(new Error("disk unavailable"), {
      code: "CC_HOOK_AUDIT_WRITE_FAILED",
    });
    const runtime = new HooksV2Runtime(directory, {
      workspaceRoot: directory,
      requireAudit: true,
      auditStore: {
        append: () => {
          throw failure;
        },
      },
    });

    await expect(runtime.emitEvent("PreToolUse", {})).rejects.toMatchObject({
      code: "CC_HOOK_AUDIT_WRITE_FAILED",
    });
    await expect(runtime.emitEvent("PostToolUse", {})).resolves.toMatchObject({
      blocked: false,
      decision: "continue",
    });
  });
});
