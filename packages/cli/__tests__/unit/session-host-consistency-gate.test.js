import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeEventHash } from "../../src/harness/transcript-integrity.js";
import { reduceMcpLedgerEvents } from "../../src/lib/mcp-call-ledger-store.js";
import {
  projectFailedSessionHostSnapshot,
  projectSessionHostObservation,
  projectVerifiedSessionHostSnapshot,
  readSessionHostResumeState,
} from "../../src/lib/session-host-snapshot.js";

const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const GATE_SCRIPT = join(
  REPOSITORY_ROOT,
  "packages/cli/scripts/session-host-consistency-gate.mjs",
);
const WORKFLOW = join(
  REPOSITORY_ROOT,
  ".github/workflows/cli-session-host-consistency.yml",
);
const roots = [];

function temporaryDirectory() {
  const root = mkdtempSync(join(tmpdir(), "cc-session-host-test-"));
  roots.push(root);
  return root;
}

function chainedEvents(cores) {
  let previousHash = null;
  return cores.map((core) => {
    const hash = computeEventHash(previousHash, core);
    const event = { ...core, prevHash: previousHash, hash };
    previousHash = hash;
    return event;
  });
}

function runGate(output, overrides = {}, expectedCode = 0) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [GATE_SCRIPT], {
      cwd: REPOSITORY_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CC_SESSION_HOST_CONSISTENCY_EXPECTED_SHA: "",
        CC_SESSION_HOST_CONSISTENCY_OUTPUT: output,
        ...overrides,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === expectedCode) resolvePromise({ stdout, stderr });
      else {
        rejectPromise(
          new Error(
            `session host gate exited ${code ?? signal}\n${stderr}\n${stdout}`,
          ),
        );
      }
    });
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("session host snapshot", () => {
  it("gives independent adapters the same content-free projection", () => {
    const title = "HOST_SNAPSHOT_PRIVATE_TITLE_8f6c";
    const prompt = "HOST_SNAPSHOT_PRIVATE_PROMPT_b01d";
    const answer = "HOST_SNAPSHOT_PRIVATE_ANSWER_e730";
    const events = chainedEvents([
      {
        type: "session_start",
        timestamp: 1,
        data: { title, provider: "fixture", model: "fixture" },
      },
      {
        type: "user_message",
        timestamp: 2,
        data: { role: "user", content: prompt },
      },
      {
        type: "assistant_message",
        timestamp: 3,
        data: { role: "assistant", content: answer },
      },
    ]);

    const canonical = projectVerifiedSessionHostSnapshot("session-1", events);
    const independent = projectSessionHostObservation({
      sessionId: "session-1",
      events: structuredClone(events),
      messages: structuredClone(canonical.messages),
      recovery: reduceMcpLedgerEvents(structuredClone(events), {
        sessionId: "session-1",
        verified: true,
      }),
    });

    expect(independent).toEqual(canonical.snapshot);
    expect(canonical.snapshot).toMatchObject({
      schema: "chainlesschain.session-host-snapshot/v1",
      schemaVersion: 1,
      verified: true,
      head: { hash: events.at(-1).hash, eventCount: 3 },
      messages: [
        { index: 0, role: "user", bytes: expect.any(Number) },
        { index: 1, role: "assistant", bytes: expect.any(Number) },
      ],
    });
    const publicJson = JSON.stringify(canonical.snapshot);
    expect(publicJson).not.toContain(title);
    expect(publicJson).not.toContain(prompt);
    expect(publicJson).not.toContain(answer);
  });

  it("projects read or verification failure without returning raw authority", () => {
    const state = readSessionHostResumeState("broken-session", {
      sessionExists: () => true,
      readVerifiedEvents: () => {
        throw new Error("PRIVATE_TRANSCRIPT_FAILURE_DETAIL_3bca");
      },
    });

    expect(state).toEqual({
      snapshot: projectFailedSessionHostSnapshot("broken-session"),
      messages: null,
      recovery: null,
    });
    expect(state.snapshot).toMatchObject({
      verified: false,
      recoveryAuthority: {
        blockMode: "all",
        reasonCode: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
        remediation: "inspect_transcript",
      },
    });
    expect(JSON.stringify(state)).not.toContain(
      "PRIVATE_TRANSCRIPT_FAILURE_DETAIL",
    );
  });
});

describe("cli session-host consistency gate", () => {
  it("emits content-free same-process host agreement and tamper evidence", async () => {
    const output = join(temporaryDirectory(), "result.json");
    await runGate(output);
    const raw = readFileSync(output, "utf8");
    const result = JSON.parse(raw);

    expect(result).toMatchObject({
      schema: "cc-cli-session-host-consistency-result/v1",
      status: "passed",
      platform: process.platform,
      proofScope:
        "host-adapter-conformance-plus-ws-request-claim-mcp-recovery-and-missing-or-restored-conflict-fencing",
      scenarios: {
        verifiedHostAgreement: {
          pass: true,
          adapterScope: [
            "repl",
            "headless",
            "backgroundAttach",
            "websocket",
            "rebuiltAdapter",
          ],
          messageCount: 3,
          contentFreeControlPlane: true,
          staleHostHistoryReplaced: true,
          hostSystemPromptPreserved: true,
          canonicalSystemSummaryPreserved: true,
          canonicalSystemSummaryContentFree: true,
          websocketRestartRoundTrip: true,
          websocketLegacyDbSystemPrefixSanitized: true,
          terminalState: {
            mcpCalls: { started: 1, outcomeUnknown: 1, total: 1 },
          },
        },
        branchForkProvenance: {
          pass: true,
          forkDurableKinds: ["compact-summary", "fork-lineage"],
          forkCanonicalMessageCount: 4,
          branchMessageCount: 3,
          branchDurableSummaryCount: 1,
          unmarkedSystemsDropped: true,
          unanchoredForkRefused: true,
          refusedForkLeftNoSuccessor: true,
        },
        wsAtomicTurns: {
          pass: true,
          atomicEventCount: 4,
          claimEventCount: 7,
          failedSettlementCount: 2,
          projectedMessageCount: 8,
          modelThrowDidNotPersist: true,
          emptyResponseDidNotPersist: true,
          appendFailureDidNotPersist: true,
          sameRequestExactlyOnce: true,
          casRetried: true,
          concurrentHandlersSerialized: true,
          roleAlternatingAfterRestart: true,
          contentFreeRuntimeBus: true,
        },
        wsCrossProcessClaim: {
          pass: true,
          modelCalls: 1,
          toolCalls: 1,
          durableClaimCount: 1,
          durableSettlementCount: 1,
          competingHandlerReturnedPending: true,
          crashedClaimStayedPending: true,
          crashedClaimWasNotTakenOver: true,
          newRequestIdAllowed: true,
        },
        wsModelPeriodTamper: {
          pass: true,
          modelCalls: 1,
          forgedSettlementRejected: true,
          forgedResponseNotReturned: true,
          retryModelCalls: 0,
          tamperedRetryRefused: true,
        },
        mcpRecoveryHostFence: {
          pass: true,
          staleSettlementRefused: true,
          stalePrewriteRefused: true,
          resumedHostCompleted: true,
          settlementCodes: [
            "CC_MCP_LEDGER_SETTLE_FAILED",
            "CC_MCP_LEDGER_HOST_FENCE_STALE",
          ],
          prewriteCodes: [
            "CC_MCP_LEDGER_PREWRITE_FAILED",
            "CC_MCP_LEDGER_HOST_FENCE_STALE",
          ],
        },
        tamperRefusal: {
          pass: true,
          errorCode: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
          replRefusedBeforeCommit: true,
          headlessRefusedBeforeSideEffects: true,
          streamRefusedBeforeSideEffects: true,
          configWritePrevented: true,
          backgroundRefused: true,
          websocketRefusedBeforeResume: true,
          contentFreeFailureEvidence: true,
        },
        missingTranscriptRefusal: {
          pass: true,
          errorCode: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
          appendRefusedWithoutRecreation: true,
          sessionStartRefusedWithoutRecreation: true,
          survivingAnchorUnchanged: true,
          replRefusedBeforeCommit: true,
          headlessRefusedBeforeSideEffects: true,
          streamRefusedBeforeSideEffects: true,
          configWritePrevented: true,
          backgroundRefused: true,
          websocketRefusedBeforeResume: true,
          contentFreeFailureEvidence: true,
          tombstoneResumeRefusedBeforeSideEffects: true,
          explicitDeleteThenRecreateVerified: true,
        },
        restoredTranscriptConflictRefusal: {
          pass: true,
          errorCode: "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
          parseableStaleJournalFenced: true,
          equalTimestampRiskTieFenced: true,
          replRefusedBeforeCommit: true,
          continueRefusedBeforeSideEffects: true,
          persistOnlyRefusedBeforeSideEffects: true,
          streamRefusedBeforeSideEffects: true,
          configWritePrevented: true,
          backgroundRefused: true,
          websocketRefusedBeforeResume: true,
          contentFreeFailureEvidence: true,
        },
      },
    });
    expect(result.exactSha).toMatch(/^[0-9a-f]{40,64}$/);
    expect(result.scenarios.verifiedHostAgreement.commonRevision).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/same-process/i),
        expect.stringMatching(/general cross-process session lease/i),
        expect.stringMatching(/anti-rollback/i),
        expect.stringMatching(/bounded-resume-IO/i),
        expect.stringMatching(/1GB cold-process.*RSS/i),
        expect.stringMatching(/O\(N\).*writer lock/i),
        expect.stringMatching(/meta\/tombstone witness.*loss/i),
      ]),
    );
    for (const marker of [
      "SESSION_HOST_TITLE_SECRET",
      "SESSION_HOST_USER_SECRET",
      "SESSION_HOST_ASSISTANT_SECRET",
      "SESSION_HOST_COMPACT_SUMMARY_SECRET",
      "SESSION_HOST_STALE_SECRET",
      "SESSION_HOST_SYSTEM_SECRET",
      "SESSION_HOST_RESTART_SYSTEM_SECRET",
      "SESSION_HOST_WS_USER_SECRET",
      "SESSION_HOST_WS_ASSISTANT_SECRET",
      "SESSION_HOST_TAMPER_ORIGINAL",
      "SESSION_HOST_TAMPER_FORGED",
      "SESSION_HOST_TAMPER_STALE",
      "WS_ATOMIC_",
      "WS_CROSS_PROCESS_",
      "WS_CLAIM_CRASH_",
      "WS_MODEL_TAMPER_",
      "SESSION_HOST_STREAM_TAMPER_INPUT",
      "SESSION_HOST_MISSING_ORIGINAL",
      "SESSION_HOST_MISSING_STALE",
      "SESSION_HOST_MISSING_STREAM_INPUT",
      "SESSION_HOST_CONFLICT_ORIGINAL",
      "SESSION_HOST_CONFLICT_STALE",
      "SESSION_HOST_CONFLICT_STREAM_INPUT",
    ]) {
      expect(raw).not.toContain(marker);
    }
  }, 180_000);

  it("fails before host scenarios when exact-SHA provenance mismatches", async () => {
    const output = join(temporaryDirectory(), "provenance-failure.json");
    await runGate(
      output,
      { CC_SESSION_HOST_CONSISTENCY_EXPECTED_SHA: "0".repeat(40) },
      1,
    );
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result).toMatchObject({
      status: "failed",
      expectedSha: "0".repeat(40),
      scenarios: {},
    });
    expect(result.violations.join(" ")).toMatch(/exact SHA|provenance/);
  }, 30_000);

  it("declares a three-platform exact-SHA artifact workflow", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    const workflow = readFileSync(WORKFLOW, "utf8");
    const gateScript = readFileSync(GATE_SCRIPT, "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain("CC_SESSION_HOST_CONSISTENCY_EXPECTED_SHA");
    expect(workflow).toContain("CC_SESSION_HOST_CONSISTENCY_OUTPUT");
    expect(workflow).toContain("actions/upload-artifact@v6");
    expect(workflow).toContain(
      "cli-session-host-consistency-${{ matrix.os }}-${{ env.CC_SESSION_HOST_CONSISTENCY_EXPECTED_SHA }}",
    );
    expect(workflow).toContain(
      "${{ runner.temp }}/cli-session-host-consistency.json",
    );
    for (const sourcePath of [
      "packages/cli/__tests__/unit/ws-runtime-events.test.js",
      "packages/cli/__tests__/integration/ws-bridge-side-effect-resume.test.js",
      "packages/cli/__tests__/unit/headless-runner-resume-roles.test.js",
      "packages/cli/src/commands/checkpoint-restore-recovery.js",
      "packages/cli/src/lib/checkpoint-restore-recovery.js",
      "packages/cli/src/lib/checkpoint-restore-session-recovery.js",
      "packages/cli/src/lib/checkpoint-restore-partial-rollback-controller.js",
      "packages/cli/__tests__/unit/checkpoint-restore-recovery.test.js",
      "packages/cli/__tests__/unit/checkpoint-restore-session-recovery.test.js",
      "packages/cli/__tests__/unit/checkpoint-restore-partial-rollback-controller.test.js",
      "packages/cli/__tests__/unit/checkpoint-restore-recovery-command.test.js",
      "packages/cli/__tests__/unit/mcp-recovery-adjudication-store.test.js",
    ]) {
      expect(workflow.split(sourcePath)).toHaveLength(3);
      expect(gateScript.split(sourcePath)).toHaveLength(2);
    }
  });
});
