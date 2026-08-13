import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSessionObservability } from "../../src/commands/session-observability.js";
import { createDeliveryFlow } from "../../src/lib/delivery-coordinator.js";
import { createVerifiedSessionObservabilityProjection } from "../../src/lib/causal-observability.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const HASH = "c".repeat(64);
const DIGEST = `sha256:${"d".repeat(64)}`;
const NOW = "2026-08-12T00:00:00.000Z";
const SCOPE = { workspaceId: "workspace-a", teamId: null, policyId: null };

let temporary = null;
afterEach(() => {
  vi.restoreAllMocks();
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  temporary = null;
});

function state(
  eventCount,
  {
    flowId,
    scope = SCOPE,
    sessionId = "session-a",
    headHash = HASH,
    changedFiles = ["src/a.js"],
  } = {},
) {
  return createDeliveryFlow(
    {
      ...(flowId ? { flowId } : {}),
      commitSha: HEAD,
      diff: {
        baseCommitSha: BASE,
        headCommitSha: HEAD,
        digest: DIGEST,
        changedFiles,
      },
      environment: {
        os: "linux",
        arch: "x64",
        runtime: "node",
        runtimeVersion: "22.12.0",
        dependencyDigest: DIGEST,
      },
      requiredGates: [{ id: "cli", always: true, matrix: ["linux"] }],
      analysis: {
        confidence: 1,
        dependencyGraphComplete: true,
        languageServicesComplete: true,
        testHistoryComplete: true,
        classifications: [
          ...changedFiles.map((changedFile) => ({
            path: changedFile,
            language: "javascript",
            ecosystem: "npm",
            confidence: 1,
          })),
        ],
      },
      unverified: [],
      sideEffects: [],
      causality: {
        scope,
        sessions: [{ sessionId, headHash, eventCount }],
      },
    },
    { now: NOW },
  );
}

describe("session observability command", () => {
  it("reads a verified delivery, projects its verified session and exports private JSON", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const events = [
      { type: "session_start", data: { observabilityScope: SCOPE } },
      {
        type: "token_usage",
        data: {
          provider: "ollama",
          model: "local",
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    ];
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(events.length)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        schema: "chainlesschain.causal-observability-request",
        version: 1,
        deliveryStates: ["delivery.json"],
        budgets: { maxTokens: 1 },
      }),
    );
    const output = path.join(temporary, "report.json");
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { output, json: true, strictBudget: true },
      {
        loadConfig: () => ({}),
        ensurePrivateFile: () => {},
        now: () => NOW,
        readVerifiedProjection: (sessionId, factory) => {
          const projection = factory();
          for (const event of events) projection.accept(event);
          return projection.finish({
            headHash: HASH,
            eventCount: events.length,
          });
        },
      },
    );
    expect(code).toBe(2);
    expect(stdout).not.toHaveBeenCalled();
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(report).toMatchObject({
      totals: { totalTokens: 15 },
      budget: { status: "exceeded" },
    });
  });

  it("resolves relative delivery paths from the canonical request directory through an alias", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-alias-"));
    const canonicalRoot = path.join(temporary, "canonical");
    const canonicalRequestDir = path.join(canonicalRoot, "requests");
    const aliasRoot = path.join(temporary, "alias-root");
    const requestAlias = path.join(aliasRoot, "request-alias");
    fs.mkdirSync(canonicalRequestDir, { recursive: true });
    fs.mkdirSync(aliasRoot, { recursive: true });

    fs.writeFileSync(
      path.join(canonicalRoot, "delivery.json"),
      JSON.stringify(state(1, { flowId: "delivery-canonical" })),
    );
    // This valid but different authority is where lexical alias/.. resolution
    // lands. Reading it would silently produce a plausible report, so the test
    // distinguishes wrong authority from a simple file-not-found failure.
    fs.writeFileSync(
      path.join(aliasRoot, "delivery.json"),
      JSON.stringify(state(1, { flowId: "delivery-lexical-alias" })),
    );
    fs.writeFileSync(
      path.join(canonicalRequestDir, "request.json"),
      JSON.stringify({ deliveryStates: ["../delivery.json"] }),
    );
    fs.symlinkSync(
      canonicalRequestDir,
      requestAlias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(requestAlias, "request.json"),
      {},
      {
        loadConfig: () => ({}),
        now: () => NOW,
        readVerifiedProjection: (_sessionId, factory) => {
          const projection = factory();
          projection.accept({
            type: "session_start",
            data: { observabilityScope: SCOPE },
          });
          return projection.finish({ headHash: HASH, eventCount: 1 });
        },
      },
    );

    expect(code).toBe(0);
    const report = JSON.parse(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(report.deliveries.map((delivery) => delivery.id)).toEqual([
      "delivery-canonical",
    ]);
    expect(JSON.stringify(report)).not.toContain("delivery-lexical-alias");
  });

  it("fails before export when verified session authority is stale", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(2)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({ deliveryStates: ["delivery.json"] }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      {},
      {
        loadConfig: () => ({}),
        readVerifiedProjection: (_sessionId, factory) => {
          const events = [
            { type: "session_start", data: { observabilityScope: SCOPE } },
          ];
          const projection = factory();
          for (const event of events) projection.accept(event);
          return projection.finish({ headHash: "e".repeat(64), eventCount: 1 });
        },
      },
    );
    expect(code).toBe(1);
    expect(stderr.mock.calls.join(" ")).toContain("authority binding changed");
  });

  it("refuses to overwrite an existing report", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const events = [
      { type: "session_start", data: { observabilityScope: SCOPE } },
    ];
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(events.length)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({ deliveryStates: ["delivery.json"] }),
    );
    const output = path.join(temporary, "report.json");
    fs.writeFileSync(output, "existing-authoritative-report\n");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { output, json: true },
      {
        loadConfig: () => ({}),
        ensurePrivateFile: () => {},
        now: () => NOW,
        readVerifiedProjection: (_sessionId, factory) => {
          const projection = factory();
          for (const event of events) projection.accept(event);
          return projection.finish({
            headHash: HASH,
            eventCount: events.length,
          });
        },
      },
    );

    expect(code).toBe(1);
    expect(fs.readFileSync(output, "utf8")).toBe(
      "existing-authoritative-report\n",
    );
    expect(stderr.mock.calls.join(" ")).toMatch(/already exists|refus/i);
  });

  it("returns strict-budget exit 2 when USD cannot be priced", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const events = [
      { type: "session_start", data: { observabilityScope: SCOPE } },
      {
        type: "token_usage",
        data: {
          provider: "unknown-provider",
          model: "unknown-model",
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    ];
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(events.length)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        deliveryStates: ["delivery.json"],
        budgets: { maxUsd: 100 },
      }),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { strictBudget: true },
      {
        loadConfig: () => ({}),
        now: () => NOW,
        readVerifiedProjection: (_sessionId, factory) => {
          const projection = factory();
          for (const event of events) projection.accept(event);
          return projection.finish({
            headHash: HASH,
            eventCount: events.length,
          });
        },
      },
    );

    expect(code).toBe(2);
    const report = JSON.parse(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(report.budget).toMatchObject({ status: "unknown" });
    expect(report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "usd-budget-usage-unknown",
        status: "unknown",
        unpricedTokens: 15,
      }),
    );
  });

  it("fails before export when verified session scope does not match delivery authority", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(1)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({ deliveryStates: ["delivery.json"] }),
    );
    const output = path.join(temporary, "report.json");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { output, json: true },
      {
        loadConfig: () => ({}),
        ensurePrivateFile: () => {},
        readVerifiedProjection: (_sessionId, factory) => {
          const projection = factory();
          projection.accept({
            type: "session_start",
            data: {
              observabilityScope: {
                ...SCOPE,
                workspaceId: "workspace-other",
              },
            },
          });
          return projection.finish({ headHash: HASH, eventCount: 1 });
        },
      },
    );

    expect(code).toBe(1);
    expect(fs.existsSync(output)).toBe(false);
    expect(stderr.mock.calls.join(" ")).toContain("scope mismatch");
  });

  it("filters deliveries before reading sessions so excluded damage cannot block the report", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const otherScope = { ...SCOPE, workspaceId: "workspace-b" };
    fs.writeFileSync(
      path.join(temporary, "selected.json"),
      JSON.stringify(
        state(1, {
          flowId: "delivery-selected",
          scope: SCOPE,
          sessionId: "session-a",
        }),
      ),
    );
    fs.writeFileSync(
      path.join(temporary, "excluded.json"),
      JSON.stringify(
        state(1, {
          flowId: "delivery-excluded",
          scope: otherScope,
          sessionId: "session-b",
          headHash: "e".repeat(64),
          changedFiles: ["src/b.js"],
        }),
      ),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        deliveryStates: ["selected.json", "excluded.json"],
      }),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const reads = [];

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { workspace: "workspace-a" },
      {
        loadConfig: () => ({}),
        now: () => NOW,
        readVerifiedProjection: (sessionId, factory) => {
          reads.push(sessionId);
          if (sessionId === "session-b") {
            throw new Error("damaged excluded session must not be read");
          }
          const projection = factory();
          projection.accept({
            type: "session_start",
            data: { observabilityScope: SCOPE },
          });
          return projection.finish({ headHash: HASH, eventCount: 1 });
        },
      },
    );

    expect(code).toBe(0);
    expect(reads).toEqual(["session-a"]);
    const report = JSON.parse(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(report.authority.completeness).toBe("complete");
    expect(report.totals).toMatchObject({ deliveries: 1, sessions: 1 });
    expect(report.deliveries.map((delivery) => delivery.id)).toEqual([
      "delivery-selected",
    ]);
  });

  it("returns strict exit 2 and no_data without reading sessions when no delivery matches", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(1)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({ deliveryStates: ["delivery.json"] }),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { workspace: "workspace-missing", strictBudget: true },
      {
        loadConfig: () => ({}),
        now: () => NOW,
        readVerifiedProjection: () => {
          throw new Error("an unmatched session must not be read");
        },
      },
    );

    expect(code).toBe(2);
    const report = JSON.parse(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(report.authority.completeness).toBe("no_data");
    expect(report.totals).toMatchObject({ deliveries: 0, sessions: 0 });
    expect(report.budget.status).toBe("unknown");
    expect(report.budget.alerts).toContainEqual(
      expect.objectContaining({
        code: "causal-selection-empty",
        status: "unknown",
      }),
    );
  });

  it("deduplicates identical delivery authorities before reading sessions", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const duplicate = state(1, { flowId: "delivery-duplicate" });
    fs.writeFileSync(
      path.join(temporary, "delivery-a.json"),
      JSON.stringify(duplicate),
    );
    fs.writeFileSync(
      path.join(temporary, "delivery-b.json"),
      JSON.stringify(duplicate),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        deliveryStates: ["delivery-a.json", "delivery-b.json"],
      }),
    );
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const reads = [];

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      {},
      {
        loadConfig: () => ({}),
        now: () => NOW,
        readVerifiedProjection: (sessionId, factory) => {
          reads.push(sessionId);
          const projection = factory();
          projection.accept({
            type: "session_start",
            data: { observabilityScope: SCOPE },
          });
          return projection.finish({ headHash: HASH, eventCount: 1 });
        },
      },
    );

    expect(code).toBe(0);
    expect(reads).toEqual(["session-a"]);
    const report = JSON.parse(
      stdout.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(report.totals.deliveries).toBe(1);
    expect(report.deliveries).toHaveLength(1);
  });

  it("rejects conflicting state digests for one delivery before reading sessions", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    fs.writeFileSync(
      path.join(temporary, "delivery-a.json"),
      JSON.stringify(
        state(1, {
          flowId: "delivery-conflict",
          changedFiles: ["src/a.js"],
        }),
      ),
    );
    fs.writeFileSync(
      path.join(temporary, "delivery-b.json"),
      JSON.stringify(
        state(1, {
          flowId: "delivery-conflict",
          changedFiles: ["src/b.js"],
        }),
      ),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        deliveryStates: ["delivery-a.json", "delivery-b.json"],
      }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const readVerifiedProjection = vi.fn();

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      {},
      {
        loadConfig: () => ({}),
        readVerifiedProjection,
      },
    );

    expect(code).toBe(1);
    expect(readVerifiedProjection).not.toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).toMatch(/conflict|digest|flow/i);
  });

  it.each([
    ["workspace", "--workspace", ""],
    ["team", "--team", "   "],
    ["policy", "--policy", "\t"],
  ])("rejects a blank %s CLI filter", (option, flag, value) => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    fs.writeFileSync(
      path.join(temporary, "delivery.json"),
      JSON.stringify(state(1)),
    );
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({ deliveryStates: ["delivery.json"] }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const readVerifiedProjection = vi.fn();

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      { [option]: value },
      { loadConfig: () => ({}), readVerifiedProjection },
    );

    expect(code).toBe(1);
    expect(readVerifiedProjection).not.toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).toContain(
      `${flag} must be a non-empty string`,
    );
  });

  it("registers observability under session and exposes its safety options in help", async () => {
    const { registerSessionCommand } =
      await import("../../src/commands/session.js");
    const program = new Command().name("cc");
    registerSessionCommand(program);

    const session = program.commands.find(
      (command) => command.name() === "session",
    );
    expect(session).toBeDefined();
    expect(session.helpInformation()).toContain(
      "observability [options] <request>",
    );

    const observability = session.commands.find(
      (command) => command.name() === "observability",
    );
    expect(observability).toBeDefined();
    const help = observability.helpInformation();
    expect(help).toContain("verified token/USD");
    expect(help).toContain("--workspace <id>");
    expect(help).toContain("--team <id>");
    expect(help).toContain("--policy <id>");
    expect(help).toContain("--strict-budget");
    expect(help).toContain("--output <path>");
  });

  it("projects the session without retaining raw event content", () => {
    const projection =
      createVerifiedSessionObservabilityProjection("session-a");
    projection.accept({
      type: "session_start",
      data: { observabilityScope: SCOPE },
    });
    projection.accept({
      type: "tool_call",
      data: {
        tool: "read_file",
        args: { secret: "do-not-export" },
        duration_ms: 1,
      },
    });
    const projected = projection.finish({ headHash: HASH, eventCount: 2 });
    expect(JSON.stringify(projected)).not.toContain("do-not-export");
  });

  it("enforces cumulative session limits immediately after each projection", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    for (const [index, sessionId] of [
      "session-a",
      "session-b",
      "session-c",
    ].entries()) {
      fs.writeFileSync(
        path.join(temporary, `delivery-${index}.json`),
        JSON.stringify(
          state(1, {
            flowId: `delivery-${index}`,
            sessionId,
            changedFiles: [`src/${index}.js`],
          }),
        ),
      );
    }
    fs.writeFileSync(
      path.join(temporary, "request.json"),
      JSON.stringify({
        deliveryStates: [
          "delivery-0.json",
          "delivery-1.json",
          "delivery-2.json",
        ],
      }),
    );
    const reads = [];
    let acceptedSessions = 0;
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      path.join(temporary, "request.json"),
      {},
      {
        loadConfig: () => ({}),
        createCausalObservabilityLimitTracker: () => ({
          acceptDelivery: () => {},
          acceptSession: () => {
            acceptedSessions += 1;
            if (acceptedSessions === 2) throw new Error("cumulative row limit");
          },
        }),
        readVerifiedProjection: (sessionId, factory) => {
          reads.push(sessionId);
          const projection = factory();
          projection.accept({
            type: "session_start",
            data: { observabilityScope: SCOPE },
          });
          return projection.finish({ headHash: HASH, eventCount: 1 });
        },
      },
    );

    expect(code).toBe(1);
    expect(reads).toEqual(["session-a", "session-b"]);
    expect(stderr.mock.calls.join(" ")).toContain("cumulative row limit");
  });

  it("uses a bounded descriptor read if an input grows after its initial stat", () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-causal-cli-"));
    const requestPath = path.join(temporary, "request.json");
    fs.writeFileSync(requestPath, "{}\n");
    const growingFs = {
      ...fs,
      constants: fs.constants,
      readFileSync: () => {
        throw new Error("unbounded readFileSync must not be used");
      },
      readSync: (_descriptor, buffer, offset, length) => {
        buffer.fill(0x20, offset, offset + length);
        return length;
      },
    };
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const code = runSessionObservability(
      requestPath,
      {},
      {
        fs: growingFs,
        withTrustedFileParentSync: (_runtimeFs, filePath, callback) =>
          callback({
            canonicalPath: path.resolve(filePath),
            parentDevice: fs.lstatSync(path.dirname(filePath), { bigint: true })
              .dev,
          }),
      },
    );

    expect(code).toBe(1);
    expect(stderr.mock.calls.join(" ")).toContain("16777216-byte limit");
  });
});
