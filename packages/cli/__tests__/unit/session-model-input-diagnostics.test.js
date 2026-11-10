import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
const root = mkdtempSync(join(tmpdir(), "cc-model-input-journal-"));
const workspace = mkdtempSync(join(tmpdir(), "cc-model-input-workspace-"));
vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => join(root, "home"),
  getSessionStoreDir: () => join(root, "home", "sessions"),
  getClaudeProjectStorageDir: () => null,
  getStatePath: () => join(root, "home", "state"),
  getMachineSecurityAnchorDir: () => join(root, "security"),
}));
const { startSession, appendEvent, appendCompactEvent, readEvents } =
  await import("../../src/harness/jsonl-session-store.js");
const { createPersistedModelInputObserver, readSessionModelInputDiagnostics } =
  await import("../../src/lib/session-model-input-diagnostics.js");
const { registerSessionShowSubcommand } =
  await import("../../src/commands/session-show.js");
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});
function event() {
  return {
    schema: "chainlesschain.model-input-diagnostic/v1",
    requestId: randomUUID(),
    usageCallId: "mdl-" + randomUUID(),
    phase: "body-prepared",
    attempt: 1,
    stage: "fetch-body",
    bodyCovered: true,
    bodyDigest: "a".repeat(64),
    bytes: 42,
    billingVerified: true,
    providerAcceptanceVerified: true,
    rawBody: "private-source",
    authorization: "secret-key",
  };
}
describe("durable model input summaries", () => {
  it("persists only allowlisted summaries and queries them after compaction without replay", async () => {
    const id = "diagnostic-query";
    startSession(id, { provider: "test", model: "test" });
    const observer = createPersistedModelInputObserver({
      append: (type, data) => appendEvent(id, type, data),
    });
    const first = event();
    await observer(first);
    await observer(event());
    appendCompactEvent(id, {
      messages: [{ role: "assistant", content: "summary" }],
    });
    const before = readEvents(id);
    const program = new Command();
    registerSessionShowSubcommand(program.command("session"), program);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(
        ["session", "show", id, "--json", "--model-inputs", "--limit", "1"],
        { from: "user" },
      );
      const report = JSON.parse(output.mock.calls.at(-1)[0]);
      expect(report).toMatchObject({
        total: 2,
        truncated: true,
        billingVerified: false,
      });
      expect(report.records).toHaveLength(1);
      expect(report.records[0].eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(report.records[0].diagnostic).toMatchObject({
        billingVerified: false,
        providerAcceptanceVerified: false,
      });
      expect(JSON.stringify(report)).not.toMatch(
        /private-source|secret-key|rawBody|authorization/,
      );
      expect(readEvents(id)).toEqual(before);
      expect(
        readSessionModelInputDiagnostics(id).records[0].diagnostic.requestId,
      ).toBe(first.requestId);
    } finally {
      output.mockRestore();
    }
  });

  it("keeps asynchronous append failure marked and prevents later observers", async () => {
    const observe = vi.fn();
    const observer = createPersistedModelInputObserver({
      append: async () => {
        throw Error("private storage path");
      },
      observe,
    });
    await expect(observer(event())).rejects.toMatchObject({
      runtimeLedgerPersistence: true,
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it("refuses invalid diagnostics before writes and never trusts a tampered journal", async () => {
    const append = vi.fn();
    await expect(
      createPersistedModelInputObserver({ append })({
        ...event(),
        stage: "secret-url",
      }),
    ).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
    const id = "diagnostic-tampered";
    startSession(id, { provider: "test" });
    await createPersistedModelInputObserver({
      append: (type, data) => appendEvent(id, type, data),
    })(event());
    appendFileSync(
      join(root, "home", "sessions", id + ".jsonl"),
      '{"type":"model_input_diagnostic","data":{}}\n',
    );
    expect(() => readSessionModelInputDiagnostics(id)).toThrow();
  });
});

it("persists diagnostics from the headless host's real loop options", async () => {
  const { runAgentHeadless } = await import("../helpers/test-model-egress.js");
  const id = "diagnostic-headless";
  const emitted = event();
  const result = await runAgentHeadless(
    {
      sessionId: id,
      persistSession: true,
      cwd: workspace,
      settingsHooks: {},
      prompt: "hello",
      outputFormat: "stream-json",
    },
    {
      executeHooksV2Event: async () => ({
        success: true,
        blocked: false,
        decision: "continue",
        results: [],
      }),
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => ({
        setSessionPolicy() {},
        setConfirmer() {},
        decide: async () => ({ decision: "allow" }),
      }),
      writeOut() {},
      writeErr() {},
      agentLoop: async function* (_, options) {
        expect(typeof options.onModelInputDiagnostic).toBe("function");
        await options.onModelInputDiagnostic(emitted);
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
    },
  );
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  expect(
    readSessionModelInputDiagnostics(id).records[0].diagnostic.requestId,
  ).toBe(emitted.requestId);
});

it("reads stream-input model diagnostics from the real canonical journal after exit", async () => {
  await import("../helpers/test-model-egress.js");
  const { runAgentHeadlessStream } =
    await import("../../src/runtime/headless-stream.js");
  const {
    withModelInputDiagnostics,
    recordLogicalModelInput,
    recordModelInputBody,
  } = await import("../../src/lib/model-input-diagnostics.js");
  const id = "diagnostic-stream-journal";
  const physicalBody = JSON.stringify({
    messages: [{ role: "user", content: "synthetic-private-input" }],
    max_tokens: 37,
  });
  const result = await runAgentHeadlessStream(
    {
      sessionId: id,
      cwd: workspace,
      settingsHooks: {},
      useRegisteredMcp: false,
      expandFileRefs: false,
    },
    {
      input: (async function* () {
        yield JSON.stringify({ text: "synthetic-private-input" }) + "\n";
      })(),
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut() {},
      writeErr() {},
      agentLoop: async function* (_, options) {
        await withModelInputDiagnostics(options, async () => {
          await recordLogicalModelInput({
            messages: [{ role: "user", content: "synthetic-private-input" }],
            tools: [],
          });
          await recordModelInputBody(physicalBody, "fetch-body");
        });
        yield { type: "response-complete", content: "done" };
        yield { type: "run-ended", reason: "complete" };
      },
    },
  );
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  const before = readEvents(id);
  const report = readSessionModelInputDiagnostics(id);
  const { createHash } = await import("node:crypto");
  expect(report.total).toBe(2);
  expect(report.records.map((x) => x.diagnostic.phase)).toEqual([
    "logical-input",
    "body-prepared",
  ]);
  expect(report.records[0].diagnostic.requestId).toBe(
    report.records[1].diagnostic.requestId,
  );
  expect(report.records[1].diagnostic.bodyDigest).toBe(
    createHash("sha256").update(physicalBody).digest("hex"),
  );
  expect(JSON.stringify(report)).not.toContain("synthetic-private-input");
  expect(readEvents(id)).toEqual(before);
});

it("persists diagnostics from the REPL wrapper into its session ledger", async () => {
  const { agentLoop } = await import("../../src/repl/agent-repl.js");
  const id = "diagnostic-repl";
  startSession(id, { provider: "test", model: "test" });
  const emitted = event();
  await agentLoop([{ role: "user", content: "hello" }], {
    evolutionIngress: null,
    sessionId: id,
    persistUsageTelemetry: true,
    provider: "test",
    model: "test",
    _coreLoop: async function* (_, options) {
      expect(typeof options.onModelInputDiagnostic).toBe("function");
      await options.onModelInputDiagnostic(emitted);
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    },
  });
  expect(
    readSessionModelInputDiagnostics(id).records[0].diagnostic.requestId,
  ).toBe(emitted.requestId);
});

it("rejects accessor, proxy and coercible identities before persisting any callback data", async () => {
  const append = vi.fn();
  const observer = createPersistedModelInputObserver({ append });
  for (const key of ["requestId", "usageCallId"]) {
    const malicious = {
      toString: () =>
        key === "requestId" ? randomUUID() : "mdl-" + randomUUID(),
      toJSON: () => ({ rawBody: "secret-source" }),
    };
    await expect(observer({ ...event(), [key]: malicious })).rejects.toThrow();
  }
  const accessor = event();
  Object.defineProperty(accessor, "requestId", { get: () => randomUUID() });
  await expect(observer(accessor)).rejects.toThrow();
  await expect(observer(new Proxy(event(), {}))).rejects.toThrow();
  const inherited = [];
  Object.setPrototypeOf(inherited, {
    get requestId() {
      throw Error("must not execute inherited getter");
    },
  });
  await expect(observer(inherited)).rejects.toThrow(
    "Invalid model input diagnostic",
  );
  expect(append).not.toHaveBeenCalled();
});

it("persists source exclusions and projection counters while old records stay readable", async () => {
  const { withModelInputDiagnostics, recordLogicalModelInput } =
    await import("../../src/lib/model-input-diagnostics.js");
  const id = "source-attribution-session";
  startSession(id, { provider: "test", model: "test" });
  await withModelInputDiagnostics(
    {
      onModelInputDiagnostic: createPersistedModelInputObserver({
        append: (type, data) => appendEvent(id, type, data),
      }),
    },
    () =>
      recordLogicalModelInput({
        messages: [{ role: "user", content: "private-source" }],
        tools: [],
        plan: {
          digest: "a".repeat(64),
          selected: [],
          selectedItemIds: [],
          dropped: [
            {
              digest: "b".repeat(64),
              itemId: "private/path",
              reason: "scope_denied",
            },
          ],
        },
        receipt: {
          manifestDigest: "c".repeat(64),
          projectionDigest: "d".repeat(64),
          rulesetDigest: "e".repeat(64),
          redactionCount: 2,
          injectionCount: 1,
        },
      }),
  );
  const summary = readSessionModelInputDiagnostics(id).records[0].diagnostic;
  expect(summary.planning.sources).toEqual([
    {
      ordinal: 0,
      digest: "b".repeat(64),
      kind: "unknown",
      disposition: "excluded",
      reason: "scope_denied",
    },
  ]);
  expect(summary.projection).toMatchObject({
    redactionCount: 2,
    injectionCount: 1,
  });
  expect(JSON.stringify(summary)).not.toMatch(/private|itemId/);
});
