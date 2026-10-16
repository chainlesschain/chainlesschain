import "../helpers/test-model-egress.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { SessionBudgetSidecarStore } from "../../src/lib/session-budget-runtime.js";
import { resolveSessionBudgetRootOptions } from "../../src/lib/session-budget-production-root.js";
import {
  readVerifiedEvents,
  startSession,
} from "../../src/harness/jsonl-session-store.js";

const temporaryDirectories = [];
const previousHome = process.env.CHAINLESSCHAIN_HOME;
const diagnostics = [];

function isolatedSession() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-stream-budget-"));
  temporaryDirectories.push(directory);
  process.env.CHAINLESSCHAIN_HOME = path.join(directory, "home");
  const store = new SessionBudgetSidecarStore({
    resolvePath: (sessionId) => path.join(directory, `${sessionId}.json`),
    allowUnsupportedPlatformForTests: true,
  });
  return {
    directory,
    store,
    sessionId: `stream-budget-${crypto.randomUUID()}`,
  };
}

function streamDeps(store, loop) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => null,
    resolveAgentMcp: async () => null,
    writeOut: (value) => diagnostics.push(value),
    writeErr: (value) => diagnostics.push(value),
    input: (async function* () {
      yield '{"text":"hello"}\n';
    })(),
    agentLoop: loop,
    sessionBudgetStore: store,
    sessionBudgetRegistry: new Map(),
  };
}

async function run(sessionId, store, root, loop) {
  return runAgentHeadlessStream(
    {
      sessionId,
      expandFileRefs: false,
      ...(root ? { sessionBudgetRoot: root } : {}),
    },
    streamDeps(store, loop),
  );
}

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("stream session budget declaration", () => {
  it("persists the root in verified JSONL and inherits it when resume omits flags", async () => {
    const { store, sessionId } = isolatedSession();
    const root = resolveSessionBudgetRootOptions({ sessionMaxTurns: 1 });
    const firstLoop = vi.fn(async function* (_messages, options) {
      expect(options.sessionBudget.consumeTurn({ id: "first-turn" }).ok).toBe(
        true,
      );
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    });
    const firstResult = await run(sessionId, store, root, firstLoop);
    expect(firstResult.exitCode, diagnostics.join("")).toBe(0);
    expect(firstLoop).toHaveBeenCalledOnce();
    expect(readVerifiedEvents(sessionId)[0]).toMatchObject({
      type: "session_start",
      data: { sessionBudgetRoot: root },
    });

    const resumedLoop = vi.fn(async function* (_messages, options) {
      expect(options.sessionBudget).toBeTruthy();
      expect(options.sessionBudget.consumeTurn({ id: "second-turn" }).ok).toBe(
        false,
      );
      yield { type: "response-complete", content: "blocked" };
      yield { type: "run-ended", reason: "complete" };
    });
    await run(sessionId, store, null, resumedLoop);
    expect(resumedLoop).toHaveBeenCalledOnce();
  });

  it("refuses changed flags, missing sidecar, and a legacy session before the loop", async () => {
    const { directory, store, sessionId } = isolatedSession();
    const root = resolveSessionBudgetRootOptions({ sessionMaxTurns: 2 });
    const loop = vi.fn(async function* () {
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    });
    await run(sessionId, store, root, loop);
    loop.mockClear();

    await expect(
      run(
        sessionId,
        store,
        resolveSessionBudgetRootOptions({ sessionMaxTurns: 3 }),
        loop,
      ),
    ).rejects.toMatchObject({ code: "CC_SESSION_BUDGET_CONFIG_MISMATCH" });
    expect(loop).not.toHaveBeenCalled();

    fs.rmSync(path.join(directory, `${sessionId}.json`));
    await expect(run(sessionId, store, null, loop)).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_SIDECAR_REQUIRED",
    });
    expect(loop).not.toHaveBeenCalled();

    const legacyId = `stream-legacy-${crypto.randomUUID()}`;
    startSession(legacyId, { title: "legacy" });
    await expect(run(legacyId, store, root, loop)).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_JSONL_REQUIRED",
    });
    expect(loop).not.toHaveBeenCalled();
  });

  it("refuses an injected existing session without a verified reader", async () => {
    const { store, sessionId } = isolatedSession();
    const loop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });
    const deps = {
      ...streamDeps(store, loop),
      sessionExists: () => true,
    };
    await expect(
      runAgentHeadlessStream({ sessionId, expandFileRefs: false }, deps),
    ).rejects.toMatchObject({ code: "CC_SESSION_BUDGET_JSONL_REQUIRED" });
    expect(loop).not.toHaveBeenCalled();
  });
});
