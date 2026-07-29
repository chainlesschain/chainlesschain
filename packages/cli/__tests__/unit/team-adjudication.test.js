import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeTeamAdjudicationEvidenceDigest,
  TEAM_ADJUDICATION_ACTIONS,
  TEAM_ADJUDICATION_ERROR_CODES,
  TeamAdjudicationStore,
} from "../../src/lib/agent-team/team-adjudication.js";

function thrownCode(action) {
  try {
    action();
  } catch (error) {
    return error.code;
  }
  throw new Error("Expected action to throw");
}

describe("TeamAdjudicationStore", () => {
  let directory;
  let statePath;
  let filePath;
  let now;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-adjudication-"));
    statePath = path.join(directory, "team-state.json");
    filePath = `${statePath}.adjudication.json`;
    fs.writeFileSync(statePath, "{}\n", { mode: 0o600 });
    now = 1_000;
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function store(options = {}) {
    return new TeamAdjudicationStore({
      statePath,
      collaborationRunId: "team-1000-test",
      now: () => now,
      ...options,
    });
  }

  function binding(suffix = "1") {
    return {
      taskKey: `publish-${suffix}`,
      registryDigest: computeTeamAdjudicationEvidenceDigest({
        revision: Number(suffix) || 1,
        status: "cancelled",
      }),
      sideEffectDigest: computeTeamAdjudicationEvidenceDigest({
        operation: "npm-publish",
        state: "unknown",
        attempt: Number(suffix) || 1,
      }),
    };
  }

  function openCase(target = store(), caseBinding = binding()) {
    return target.openCase(caseBinding);
  }

  function decide(target, opened, decision = "retry", overrides = {}) {
    return target.decideCase({
      ...binding(),
      decision,
      authority: "operator:local-user",
      reasonDigest: computeTeamAdjudicationEvidenceDigest({
        reason: `${decision} confirmed`,
      }),
      expectedRevision: opened.case.revision,
      ...overrides,
    });
  }

  it("binds the canonical state/run/evidence and persists a private log", () => {
    const target = store();
    const opened = openCase(target);

    expect(opened).toMatchObject({
      duplicate: false,
      case: {
        ...binding(),
        status: "pending",
        revision: 1,
        recovery: {
          state: "adjudication_required",
          action: null,
          replaySafe: false,
        },
      },
      cursor: {
        version: 1,
        collaborationRunId: "team-1000-test",
        lastSequence: 1,
      },
    });
    expect(opened.case.caseId).toMatch(/^tadj_[a-f0-9]{64}$/);
    expect(opened.cursor.statePathDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(opened.cursor.headDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(document.statePath).toBe(fs.realpathSync.native(statePath));
    expect(document.collaborationRunId).toBe("team-1000-test");
    expect(document.events).toHaveLength(1);
    expect(document.events[0]).toMatchObject({
      sequence: 1,
      type: "case.open",
      previousDigest: null,
      taskKey: "publish-1",
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }

    expect(store().getCase(binding())).toEqual(opened.case);
    expect(store().openCase(binding())).toMatchObject({
      duplicate: true,
      case: opened.case,
    });
  });

  it.each([
    ["retry", TEAM_ADJUDICATION_ACTIONS.retry],
    ["accept", TEAM_ADJUDICATION_ACTIONS.accept],
    ["cancel", TEAM_ADJUDICATION_ACTIONS.cancel],
  ])(
    "records, claims once, and applies the %s decision across restarts",
    (decisionValue, expectedAction) => {
      const firstProcess = store();
      const opened = openCase(firstProcess);
      now += 1;
      const decided = decide(firstProcess, opened, decisionValue);

      expect(decided.case).toMatchObject({
        status: "authorized",
        revision: 2,
        decision: {
          value: decisionValue,
          authority: "operator:local-user",
        },
        recovery: {
          state: "decision_ready",
          action: expectedAction,
          replaySafe: false,
        },
      });

      const secondProcess = store();
      now += 1;
      const claimed = secondProcess.claimDecision({
        ...binding(),
        decisionDigest: decided.case.decision.decisionDigest,
        consumer: "team-coordinator:resume-1",
        expectedRevision: 2,
      });
      expect(claimed).toMatchObject({
        duplicate: false,
        authorization: {
          caseId: opened.case.caseId,
          action: expectedAction,
          decisionDigest: decided.case.decision.decisionDigest,
        },
        case: { status: "claimed", revision: 3 },
      });

      const duplicateClaim = store().claimDecision({
        ...binding(),
        decisionDigest: decided.case.decision.decisionDigest,
        consumer: "team-coordinator:resume-1",
        expectedRevision: 2,
      });
      expect(duplicateClaim).toMatchObject({
        duplicate: true,
        authorization: null,
        case: { status: "claimed", revision: 3 },
      });

      now += 1;
      const outcomeDigest = computeTeamAdjudicationEvidenceDigest({
        registryRevision: 9,
        appliedDecision: decisionValue,
      });
      const applied = store().completeCase({
        ...binding(),
        claimDigest: claimed.authorization.claimDigest,
        outcomeDigest,
        expectedRevision: 3,
      });
      expect(applied).toMatchObject({
        duplicate: false,
        case: {
          status: "applied",
          revision: 4,
          application: { outcomeDigest },
          recovery: { state: "complete", action: null, replaySafe: false },
        },
      });
      expect(store().read().cursor.lastSequence).toBe(4);
    },
  );

  it("keeps exact decision and application retries idempotent but rejects conflicts", () => {
    const target = store();
    const opened = openCase(target);
    const input = {
      ...binding(),
      decision: "retry",
      authority: "operator:local-user",
      reasonDigest: computeTeamAdjudicationEvidenceDigest("inspected ledger"),
      expectedRevision: 1,
    };
    const decided = target.decideCase(input);
    expect(target.decideCase(input)).toMatchObject({
      duplicate: true,
      case: { revision: 2, decision: { value: "retry" } },
    });
    expect(
      thrownCode(() =>
        target.decideCase({
          ...input,
          decision: "accept",
        }),
      ),
    ).toBe(TEAM_ADJUDICATION_ERROR_CODES.CONFLICT);

    const claim = target.claimDecision({
      ...binding(),
      decisionDigest: decided.case.decision.decisionDigest,
      consumer: "coordinator-a",
      expectedRevision: 2,
    });
    expect(
      thrownCode(() =>
        target.claimDecision({
          ...binding(),
          decisionDigest: decided.case.decision.decisionDigest,
          consumer: "coordinator-b",
          expectedRevision: 2,
        }),
      ),
    ).toBe(TEAM_ADJUDICATION_ERROR_CODES.ALREADY_CLAIMED);

    const applyInput = {
      ...binding(),
      claimDigest: claim.authorization.claimDigest,
      outcomeDigest: computeTeamAdjudicationEvidenceDigest("retry-finished"),
      expectedRevision: 3,
    };
    expect(target.completeCase(applyInput).duplicate).toBe(false);
    expect(target.completeCase(applyInput).duplicate).toBe(true);
    expect(
      thrownCode(() =>
        target.completeCase({
          ...applyInput,
          outcomeDigest: computeTeamAdjudicationEvidenceDigest("different"),
        }),
      ),
    ).toBe(TEAM_ADJUDICATION_ERROR_CODES.CONFLICT);

    expect(opened.cursor.lastSequence).toBe(1);
    expect(target.read().cursor.lastSequence).toBe(4);
  });

  it("reports fail-closed retry recovery and replay-safe local settlement recovery", () => {
    const retryStore = store();
    const retryOpened = openCase(retryStore);
    const retryDecision = decide(retryStore, retryOpened, "retry");
    retryStore.claimDecision({
      ...binding(),
      decisionDigest: retryDecision.case.decision.decisionDigest,
      consumer: "coordinator-before-crash",
      expectedRevision: 2,
    });

    expect(store().getCase(binding()).recovery).toEqual({
      state: "retry_outcome_unknown",
      action: null,
      replaySafe: false,
    });

    const secondStatePath = path.join(directory, "team-state-accept.json");
    fs.writeFileSync(secondStatePath, "{}\n", { mode: 0o600 });
    const acceptStore = new TeamAdjudicationStore({
      statePath: secondStatePath,
      collaborationRunId: "team-1001-accept",
    });
    const acceptBinding = binding("2");
    const acceptOpened = acceptStore.openCase(acceptBinding);
    const acceptDecision = acceptStore.decideCase({
      ...acceptBinding,
      decision: "accept",
      authority: "operator:local-user",
      expectedRevision: acceptOpened.case.revision,
    });
    acceptStore.claimDecision({
      ...acceptBinding,
      decisionDigest: acceptDecision.case.decision.decisionDigest,
      consumer: "coordinator-before-crash",
      expectedRevision: 2,
    });
    expect(acceptStore.getCase(acceptBinding).recovery).toEqual({
      state: "settlement_recovery_required",
      action: TEAM_ADJUDICATION_ACTIONS.accept,
      replaySafe: true,
    });
  });

  it("allows a new evidence branch only after an applied retry", () => {
    const target = store();
    const firstBinding = binding("1");
    const nextBinding = {
      ...firstBinding,
      registryDigest: computeTeamAdjudicationEvidenceDigest({
        revision: 2,
        status: "cancelled",
      }),
      sideEffectDigest: computeTeamAdjudicationEvidenceDigest({
        operation: "npm-publish",
        state: "unknown",
        attempt: 2,
      }),
    };
    const first = target.openCase(firstBinding);
    expect(thrownCode(() => target.openCase(nextBinding))).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.CONFLICT,
    );

    const decision = target.decideCase({
      ...firstBinding,
      decision: "retry",
      authority: "operator",
      expectedRevision: first.case.revision,
    });
    const claim = target.claimDecision({
      ...firstBinding,
      decisionDigest: decision.case.decision.decisionDigest,
      consumer: "coordinator",
      expectedRevision: 2,
    });
    target.completeCase({
      ...firstBinding,
      claimDigest: claim.authorization.claimDigest,
      outcomeDigest: computeTeamAdjudicationEvidenceDigest("new attempt"),
      expectedRevision: 3,
    });

    const next = target.openCase(nextBinding);
    expect(next.case.taskKey).toBe("publish-1");
    expect(next.case.caseId).not.toBe(first.case.caseId);
  });

  it("rejects tampering, sequence forks, and a valid alternate branch via an anchor", () => {
    const target = store();
    const opened = openCase(target);
    const pendingDocument = fs.readFileSync(filePath);
    const pendingCursor = opened.cursor;
    const retry = decide(target, opened, "retry");
    const retryDocument = fs.readFileSync(filePath);

    const tampered = JSON.parse(retryDocument.toString("utf8"));
    tampered.events[1].authority = "attacker";
    fs.writeFileSync(filePath, `${JSON.stringify(tampered)}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(filePath, 0o600);
    expect(thrownCode(() => store().read())).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
    );

    fs.writeFileSync(filePath, retryDocument, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    const forked = JSON.parse(retryDocument.toString("utf8"));
    forked.events.push({ ...forked.events[1] });
    fs.writeFileSync(filePath, `${JSON.stringify(forked)}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(filePath, 0o600);
    expect(thrownCode(() => store().read())).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.CORRUPT,
    );

    // Restore the valid pending prefix and make a separately valid accept
    // branch. Its own chain verifies, but it cannot satisfy the retry cursor.
    fs.writeFileSync(filePath, pendingDocument, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    const alternate = store().decideCase({
      ...binding(),
      decision: "accept",
      authority: "operator:alternate",
      expectedRevision: 1,
    });
    expect(alternate.case.decision.value).toBe("accept");
    expect(store().read({ anchor: pendingCursor }).cases).toHaveLength(1);
    expect(thrownCode(() => store().read({ anchor: retry.cursor }))).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.ROLLBACK,
    );
  });

  it("preserves the last valid state when an atomic replacement fails", () => {
    const healthy = store();
    const opened = openCase(healthy);
    const failingFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        if (destination === filePath) {
          const error = new Error("simulated rename failure");
          error.code = "EIO";
          throw error;
        }
        return fs.renameSync(source, destination);
      },
    };
    const failing = store({ _fs: failingFs });

    expect(
      thrownCode(() =>
        failing.decideCase({
          ...binding(),
          decision: "cancel",
          authority: "operator",
          expectedRevision: 1,
        }),
      ),
    ).toBe(TEAM_ADJUDICATION_ERROR_CODES.WRITE_FAILED);
    expect(healthy.getCase(binding())).toEqual(opened.case);
    expect(
      fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects symlink and hard-link authority paths", () => {
    const hardLinkedState = path.join(directory, "hard-linked-state.json");
    fs.linkSync(statePath, hardLinkedState);
    expect(
      thrownCode(
        () =>
          new TeamAdjudicationStore({
            statePath: hardLinkedState,
            collaborationRunId: "team-1000-test",
          }),
      ),
    ).toBe(TEAM_ADJUDICATION_ERROR_CODES.UNSAFE_PATH);
    fs.rmSync(hardLinkedState);

    const stateTarget = path.join(directory, "state-target.json");
    const stateAlias = path.join(directory, "state-alias.json");
    fs.writeFileSync(stateTarget, "{}\n", { mode: 0o600 });
    let fileSymlinkAvailable = true;
    try {
      fs.symlinkSync(stateTarget, stateAlias, "file");
    } catch (error) {
      if (process.platform !== "win32" || error?.code !== "EPERM") throw error;
      fileSymlinkAvailable = false;
    }
    if (fileSymlinkAvailable) {
      expect(
        thrownCode(
          () =>
            new TeamAdjudicationStore({
              statePath: stateAlias,
              collaborationRunId: "team-1000-test",
            }),
        ),
      ).toBe(TEAM_ADJUDICATION_ERROR_CODES.UNSAFE_PATH);
    }

    const target = store();
    openCase(target);
    const adjudicationAlias = path.join(directory, "adjudication-alias.json");
    fs.linkSync(filePath, adjudicationAlias);
    expect(thrownCode(() => target.read())).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.UNSAFE_PATH,
    );
  });

  it("requires a strict lock and fails closed when it is unavailable", () => {
    let observedOptions = null;
    const target = store({
      _lock: (_target, _body, options) => {
        observedOptions = options;
        const error = new Error("busy");
        error.code = "STATE_LOCK_UNAVAILABLE";
        throw error;
      },
    });
    expect(thrownCode(() => target.read())).toBe(
      TEAM_ADJUDICATION_ERROR_CODES.LOCK_UNAVAILABLE,
    );
    expect(observedOptions).toMatchObject({ failIfUnavailable: true });
  });

  it("serializes conflicting decisions from independent processes", async () => {
    const opened = openCase();
    const moduleUrl = new URL(
      "../../src/lib/agent-team/team-adjudication.js",
      import.meta.url,
    ).href;
    const childCode = `
      const [moduleUrl, encoded] = process.argv.slice(1);
      const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      const { TeamAdjudicationStore } = await import(moduleUrl);
      process.stdout.write("READY\\n");
      await new Promise((resolve) => process.stdin.once("data", resolve));
      try {
        const target = new TeamAdjudicationStore(input.store);
        const value = target.decideCase(input.decision);
        process.stdout.write("RESULT:" + JSON.stringify({
          ok: true,
          decision: value.case.decision.value,
        }) + "\\n");
      } catch (error) {
        process.stdout.write("RESULT:" + JSON.stringify({
          ok: false,
          code: error.code,
        }) + "\\n");
      }
    `;

    function launch(decisionValue) {
      const encoded = Buffer.from(
        JSON.stringify({
          store: {
            statePath,
            collaborationRunId: "team-1000-test",
            lockTimeoutMs: 10_000,
          },
          decision: {
            ...binding(),
            decision: decisionValue,
            authority: `operator:${decisionValue}`,
            expectedRevision: opened.case.revision,
          },
        }),
        "utf8",
      ).toString("base64url");
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", childCode, moduleUrl, encoded],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      let readyResolve;
      let readyReject;
      let readySeen = false;
      const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (!readySeen && stdout.includes("READY\n")) {
          readySeen = true;
          readyResolve();
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const result = new Promise((resolve) => {
        child.once("error", (error) => {
          if (!readySeen) readyReject(error);
          resolve({ fatal: error.message });
        });
        child.once("close", (code) => {
          if (!readySeen) {
            readyReject(
              new Error(`adjudication child exited ${code}: ${stderr}`),
            );
          }
          if (code !== 0) {
            resolve({
              fatal: `adjudication child exited ${code}: ${stderr}`,
            });
            return;
          }
          const line = stdout
            .split(/\r?\n/)
            .find((item) => item.startsWith("RESULT:"));
          if (!line) {
            resolve({ fatal: `missing child result: ${stdout} ${stderr}` });
            return;
          }
          resolve(JSON.parse(line.slice("RESULT:".length)));
        });
      });
      return { child, ready, result };
    }

    const retry = launch("retry");
    const cancel = launch("cancel");
    await Promise.all([retry.ready, cancel.ready]);
    retry.child.stdin.end("go\n");
    cancel.child.stdin.end("go\n");
    const results = await Promise.all([retry.result, cancel.result]);

    expect(results.some((result) => result.fatal)).toBe(false);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        code: TEAM_ADJUDICATION_ERROR_CODES.CONFLICT,
      }),
    ]);
    expect(store().read()).toMatchObject({
      cases: [{ status: "authorized", revision: 2 }],
      cursor: { lastSequence: 2 },
    });
  });
});
