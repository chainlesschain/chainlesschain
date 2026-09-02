import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EvolutionEvidenceArtifactAdapter } from "../../src/lib/evolution/evolution-evidence-artifact-adapter.js";
import {
  createAgentEvolutionIngress,
  captureAgentEvolutionIngress,
} from "../../src/lib/evolution/agent-evolution-ingress.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import {
  EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
  EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
  EvolutionRunLedgerAdapter,
} from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import { agentLoop } from "../../src/repl/agent-repl.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, EVENT_TYPES } = evolutionRun;
const NOW = "2026-09-03T00:00:00.000Z";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function backend() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-evolution-run-"),
  );
  roots.push(root);
  const tenantId = "tenant-agent";
  const artifactTenantId = "artifact-tenant-agent";
  const audience = "evolution-runtime";
  const purpose = "evolution-ledger";
  const secret = "test-only-evolution-run-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/evolution-run";
  const policyDigest = hash("evolution-run-policy");
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.parse(NOW),
    }),
    audience,
    tenantId: artifactTenantId,
    now: () => Date.parse(NOW),
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-03T00:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: hash(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const state = {
    events: [],
    loseNextResponse: false,
    verifyCalls: 0,
    onVerifyCall: null,
  };
  const ledger = {
    read: vi.fn(() => structuredClone(state.events)),
    verify: vi.fn(() => {
      state.verifyCalls += 1;
      if (state.onVerifyCall?.call === state.verifyCalls) {
        const action = state.onVerifyCall.action;
        state.onVerifyCall = null;
        action();
      }
      return {
        epoch: "epoch-agent",
        ledgerId: "ledger-agent",
        sequence: state.events.length,
        headDigest: state.events.at(-1)?.eventDigest ?? null,
      };
    }),
    appendDomainEvent: vi.fn((input, options) => {
      const previous = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (previous?.eventDigest ?? null)
      ) {
        const error = new Error("ledger head conflict");
        error.code = "CC_EVOLUTION_LEDGER_HEAD_CONFLICT";
        throw error;
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: hash(input),
      };
      state.events.push(event);
      if (state.loseNextResponse) {
        state.loseNextResponse = false;
        throw new Error("simulated response loss");
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: hash(event),
      };
    }),
  };
  const descriptor = {
    tenantId,
    artifactTenantId,
    runId: "agent-run-1",
    audience,
    purpose,
  };
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose,
  });
  const makeAdapter = () =>
    new EvolutionRunLedgerAdapter({
      descriptor,
      artifactPorts,
      ledger,
      ledgerArtifactResolver: resolver,
      now: () => Date.parse(NOW),
    });
  return { artifactPorts, descriptor, ledger, makeAdapter, state };
}

function event(sequence, type, suffix = String(sequence)) {
  return {
    schema: EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: "tenant-agent",
    runId: "agent-run-1",
    eventId: `event-${suffix}`,
    sequence,
    type,
    subjectId: `subject-${suffix}`,
    payloadDigest: hash(`payload-${suffix}`),
    artifactRef: null,
    keyRef: null,
    data: { marker: suffix },
  };
}

function fakeEvidenceAdapter() {
  let sequence = 0;
  const adapter = Object.create(EvolutionEvidenceArtifactAdapter.prototype);
  Object.defineProperty(adapter, "projectAndPersist", {
    value: vi.fn(async () => {
      sequence += 1;
      const digest = hash(`manifest-${sequence}`);
      return {
        tenantId: "tenant-agent",
        evidenceId: `evidence-${sequence}`,
        manifest: {
          type: "evidence",
          digest,
          ref: { ref: `cc-evolution-artifact:evidence-${sequence}` },
        },
      };
    }),
  });
  return adapter;
}

describe("EvolutionRunLedgerAdapter", () => {
  it("persists a contiguous canonical run and recovers it through a new adapter", () => {
    const fixture = backend();
    const first = fixture.makeAdapter();
    first.appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    first.appendEvent(event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "raw"));
    first.appendEvent(event(3, EVENT_TYPES.RUN_COMPLETED, "complete"));

    const recovered = fixture.makeAdapter().load();
    expect(recovered.events).toHaveLength(3);
    expect(recovered.projection).toMatchObject({
      status: "completed",
      lastSequence: 3,
      eventCount: 3,
    });
    expect(fixture.state.events[1].sourceRefs).toEqual([
      fixture.state.events[0].subjectRef,
    ]);
  });

  it("recovers an exact append after the ledger response is lost", () => {
    const fixture = backend();
    const adapter = fixture.makeAdapter();
    adapter.appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    fixture.state.loseNextResponse = true;

    expect(
      adapter.appendEvent(event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "raw")),
    ).toMatchObject({
      committed: true,
      recovered: true,
      eventId: "event-raw",
    });
    expect(fixture.makeAdapter().load().events).toHaveLength(2);
  });

  it("rejects substituted artifact lineage during restart recovery", () => {
    const fixture = backend();
    const adapter = fixture.makeAdapter();
    adapter.appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    adapter.appendEvent(event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "raw"));
    fixture.state.events[1].sourceRefs = [];

    try {
      fixture.makeAdapter().load();
      throw new Error("expected recovery to fail");
    } catch (error) {
      expect(error.code).toBe(EVOLUTION_RUN_LEDGER_CORRUPT_CODE);
    }

    const metadataFixture = backend();
    metadataFixture
      .makeAdapter()
      .appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    metadataFixture.state.events[0].decision = "prepared";
    try {
      metadataFixture.makeAdapter().load();
      throw new Error("expected domain metadata recovery to fail");
    } catch (error) {
      expect(error.code).toBe(EVOLUTION_RUN_LEDGER_CORRUPT_CODE);
    }
  });

  it("fails closed on sequence races, conflicting duplicates, and post-completion writes", () => {
    const fixture = backend();
    const adapter = fixture.makeAdapter();
    adapter.appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    adapter.appendEvent(event(2, EVENT_TYPES.RUN_COMPLETED, "complete"));

    for (const attempted of [
      event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "other"),
      {
        ...event(2, EVENT_TYPES.RUN_COMPLETED, "complete"),
        payloadDigest: hash("substituted"),
      },
      event(3, EVENT_TYPES.RAW_EVENT_REFERENCED, "late"),
    ]) {
      try {
        adapter.appendEvent(attempted);
        throw new Error("expected append to fail");
      } catch (error) {
        expect(error.code).toBe(EVOLUTION_RUN_LEDGER_CONFLICT_CODE);
      }
    }
  });

  it("does not append a stale lineage when a competing writer wins before CAS", () => {
    const fixture = backend();
    const first = fixture.makeAdapter();
    first.appendEvent(event(1, EVENT_TYPES.RUN_STARTED, "start"));
    const winner = fixture.makeAdapter();
    const loser = fixture.makeAdapter();
    fixture.state.verifyCalls = 0;
    fixture.state.onVerifyCall = {
      call: 2,
      action: () =>
        winner.appendEvent(
          event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "winner"),
        ),
    };

    try {
      loser.appendEvent(event(2, EVENT_TYPES.RAW_EVENT_REFERENCED, "loser"));
      throw new Error("expected stale append to fail");
    } catch (error) {
      expect(error.code).toBe(EVOLUTION_RUN_LEDGER_CONFLICT_CODE);
    }
    expect(
      fixture
        .makeAdapter()
        .load()
        .events.map((item) => item.eventId),
    ).toEqual(["event-start", "event-winner"]);
  });

  it("routes real REPL boundaries through one branded durable ingress", async () => {
    const fixture = backend();
    const evidenceAdapter = fakeEvidenceAdapter();
    let id = 0;
    const sourceEnvelopeAuthority = {
      issue: vi.fn(async ({ kind }) => `signed-source:${kind}`),
    };
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter,
      runAdapter: fixture.makeAdapter(),
      sourceEnvelopeAuthority,
      now: () => new Date(NOW),
      idGenerator: () => `event-${++id}`,
    });
    expect(captureAgentEvolutionIngress(ingress)).toBe(ingress);
    expect(() => captureAgentEvolutionIngress({ ...ingress })).toThrow(
      /branded Agent evolution ingress/,
    );

    async function* coreLoop() {
      yield {
        type: "tool-executing",
        tool: "read_file",
        args: { path: "a.js" },
      };
      yield {
        type: "tool-result",
        tool: "read_file",
        result: { error: "denied" },
      };
      yield { type: "response-complete", content: "done" };
    }

    await agentLoop([{ role: "user", content: "inspect a.js" }], {
      evolutionIngress: ingress,
      _coreLoop: coreLoop,
      writeOut: vi.fn(),
    });

    const recovered = fixture.makeAdapter().load();
    expect(recovered.events.map((item) => item.type)).toEqual([
      EVENT_TYPES.RUN_STARTED,
      EVENT_TYPES.RAW_EVENT_REFERENCED,
      EVENT_TYPES.RAW_EVENT_REFERENCED,
      EVENT_TYPES.RAW_EVENT_REFERENCED,
      EVENT_TYPES.RAW_EVENT_REFERENCED,
    ]);
    expect(
      recovered.events.slice(1).map((item) => item.data.evidenceKind),
    ).toEqual([
      "user-prompt",
      "tool-requested",
      "tool-failed",
      "response-completed",
    ]);
    expect(sourceEnvelopeAuthority.issue).toHaveBeenCalledTimes(4);
    expect(evidenceAdapter.projectAndPersist).toHaveBeenCalledTimes(4);
  });

  it("routes a production headless turn and closes the durable run", async () => {
    const fixture = backend();
    const evidenceAdapter = fakeEvidenceAdapter();
    let id = 0;
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter,
      runAdapter: fixture.makeAdapter(),
      sourceEnvelopeAuthority: {
        issue: vi.fn(async ({ kind }) => `signed-source:${kind}`),
      },
      now: () => new Date(NOW),
      idGenerator: () => `headless-${++id}`,
    });
    const output = [];
    const errors = [];

    const result = await runAgentHeadless(
      {
        prompt: "inspect the workspace",
        outputFormat: "text",
        ephemeral: true,
        evolutionIngress: ingress,
      },
      {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => ({
          setSessionPolicy: vi.fn(),
          setConfirmer: vi.fn(),
          decide: vi.fn(async () => ({ decision: "allow" })),
        }),
        writeOut: (value) => output.push(value),
        writeErr: (value) => errors.push(value),
        now: (() => {
          let value = 1_000;
          return () => (value += 5);
        })(),
        chatFn: vi.fn(async () => ({
          message: { role: "assistant", content: "done" },
          usage: { input_tokens: 3, output_tokens: 1 },
        })),
      },
    );

    expect(result).toMatchObject({ exitCode: 0, result: "done" });
    expect(output.join("")).toContain("done");
    expect(errors.join("")).not.toContain("Error:");
    const recovered = fixture.makeAdapter().load();
    expect(recovered.projection.status).toBe("completed");
    expect(
      recovered.events
        .filter((item) => item.type === EVENT_TYPES.RAW_EVENT_REFERENCED)
        .map((item) => item.data.evidenceKind),
    ).toEqual(["user-prompt", "response-completed", "goal-ended"]);
    expect(recovered.events.at(-1).type).toBe(EVENT_TYPES.RUN_COMPLETED);
  });

  it("fails before model execution when evidence persistence is cross-tenant", async () => {
    const fixture = backend();
    const evidenceAdapter = fakeEvidenceAdapter();
    evidenceAdapter.projectAndPersist.mockResolvedValueOnce({
      tenantId: "tenant-other",
      evidenceId: "evidence-other",
      manifest: {
        type: "evidence",
        digest: hash("other"),
        ref: { ref: "cc-evolution-artifact:evidence-other" },
      },
    });
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter,
      runAdapter: fixture.makeAdapter(),
      sourceEnvelopeAuthority: {
        issue: vi.fn(async () => "signed-source:user-prompt"),
      },
      now: () => new Date(NOW),
    });
    const coreLoop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });

    await expect(
      agentLoop([{ role: "user", content: "secret" }], {
        evolutionIngress: ingress,
        _coreLoop: coreLoop,
        writeOut: vi.fn(),
      }),
    ).rejects.toThrow(/unbound result/);
    expect(coreLoop).not.toHaveBeenCalled();
    expect(fixture.makeAdapter().load().events).toHaveLength(1);
  });

  it("routes every long-lived stream turn into the same run before closing it", async () => {
    const fixture = backend();
    const evidenceAdapter = fakeEvidenceAdapter();
    let id = 0;
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter,
      runAdapter: fixture.makeAdapter(),
      sourceEnvelopeAuthority: {
        issue: vi.fn(async ({ kind }) => `signed-source:${kind}`),
      },
      now: () => new Date(NOW),
      idGenerator: () => `stream-${++id}`,
    });
    async function* input() {
      yield `${JSON.stringify({ type: "user", text: "first" })}\n`;
      yield `${JSON.stringify({ type: "user", text: "second" })}\n`;
    }
    const responses = ["one", "two"];
    const coreLoop = vi.fn(async function* () {
      yield {
        type: "response-complete",
        content: responses.shift(),
      };
      yield { type: "run-ended", reason: "complete" };
    });

    const result = await runAgentHeadlessStream(
      {
        evolutionIngress: ingress,
        expandFileRefs: false,
        ephemeral: true,
      },
      {
        input: input(),
        agentLoop: coreLoop,
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: vi.fn(),
        writeErr: vi.fn(),
      },
    );

    expect(result).toMatchObject({ exitCode: 0, turns: 2 });
    const recovered = fixture.makeAdapter().load();
    expect(recovered.projection.status).toBe("completed");
    expect(
      recovered.events
        .filter((item) => item.type === EVENT_TYPES.RAW_EVENT_REFERENCED)
        .map((item) => item.data.evidenceKind),
    ).toEqual([
      "user-prompt",
      "response-completed",
      "goal-ended",
      "user-prompt",
      "response-completed",
      "goal-ended",
    ]);
  });

  it("admits only a branded tenant-bound ingress through AgentRuntime", async () => {
    const fixture = backend();
    const ingress = createAgentEvolutionIngress({
      evidenceAdapter: fakeEvidenceAdapter(),
      runAdapter: fixture.makeAdapter(),
      sourceEnvelopeAuthority: {
        issue: vi.fn(async ({ kind }) => `signed-source:${kind}`),
      },
      now: () => new Date(NOW),
    });
    const startAgentRepl = vi.fn(async () => "started");
    const runtime = new AgentRuntime({
      kind: "agent",
      policy: { sessionId: "session-agent" },
      deps: { evolutionIngress: ingress, startAgentRepl },
    });

    await expect(runtime.startAgentSession()).resolves.toBe("started");
    expect(startAgentRepl).toHaveBeenCalledWith(
      expect.objectContaining({ evolutionIngress: ingress }),
    );
    expect(fixture.makeAdapter().load()).toMatchObject({
      events: [
        { type: EVENT_TYPES.RUN_STARTED },
        { type: EVENT_TYPES.RUN_COMPLETED },
      ],
      projection: { status: "completed" },
    });
    expect(
      () =>
        new AgentRuntime({
          kind: "agent",
          policy: {},
          deps: { evolutionIngress: { ...ingress } },
        }),
    ).toThrow(/branded Agent evolution ingress/);
  });
});
