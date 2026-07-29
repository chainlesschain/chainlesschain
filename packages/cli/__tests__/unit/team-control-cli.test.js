import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import {
  computeTeamAdjudicationEvidenceDigest,
  TeamAdjudicationStore,
} from "../../src/lib/agent-team/team-adjudication.js";
import {
  computeTeamControlAdjudicationDigest,
  computeTeamControlAttemptDigest,
  TeamControlStore,
} from "../../src/lib/agent-team/team-control-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");
const STATE_ID = "team_state_cli_test";

function writePrivateJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows does not expose POSIX mode semantics.
  }
}

function runCli(cwd, args, { env = process.env } = {}) {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [BIN, ...args], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout || ""}${error.stderr || ""}`,
      error,
    };
  }
}

describe(
  "cc team durable control and adjudication commands",
  { timeout: 60_000 },
  () => {
    let directory;
    let statePath;

    beforeEach(() => {
      directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-team-control-cli-"),
      );
      statePath = path.join(directory, "team-state.json");
    });

    afterEach(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    function baseSnapshot(registry, overrides = {}) {
      return {
        version: 6,
        stateId: STATE_ID,
        collaborationRunId: "team-cli-test",
        adjudicationRunId: "team-cli-test",
        controlCursor: null,
        adjudicationCursor: null,
        registry: registry.snapshot(),
        ...overrides,
      };
    }

    function pendingRegistry() {
      const registry = new TaskLeaseRegistry({
        groupId: "cli-test",
        now: () => 1_000,
        leaseEpoch: "cli-test-epoch",
      });
      expect(
        registry.addTask({
          key: "publish",
          title: "Publish package",
        }).ok,
      ).toBe(true);
      return registry;
    }

    function adjudicationFixture() {
      const registry = pendingRegistry();
      expect(
        registry.requireAdjudication("publish", {
          reason: "prior side effect outcome is unknown",
          evidenceDigest: "sha256:unknown-side-effect",
          now: 1_100,
        }).ok,
      ).toBe(true);
      writePrivateJson(statePath, baseSnapshot(registry));

      const binding = {
        taskKey: "publish",
        registryDigest: computeTeamAdjudicationEvidenceDigest({
          taskKey: "publish",
          registry: registry.snapshot(),
        }),
        sideEffectDigest: computeTeamAdjudicationEvidenceDigest({
          operation: "npm-publish",
          outcome: "unknown",
        }),
      };
      const store = new TeamAdjudicationStore({
        statePath,
        collaborationRunId: "team-cli-test",
        now: () => 1_200,
      });
      const opened = store.openCase(binding);
      expect(
        registry.bindAdjudicationCase("publish", {
          caseId: opened.case.caseId,
          registryDigest: binding.registryDigest,
          sideEffectDigest: binding.sideEffectDigest,
        }).ok,
      ).toBe(true);
      const snapshot = baseSnapshot(registry, {
        adjudicationCursor: opened.cursor,
      });
      writePrivateJson(statePath, snapshot);
      return {
        registry,
        store,
        binding,
        opened,
        snapshot,
        expectedAdjudicationDigest: computeTeamControlAdjudicationDigest({
          caseId: opened.case.caseId,
          evidenceDigest: binding.sideEffectDigest,
        }),
      };
    }

    function adjudicationAuthorityArgs(fixture) {
      return [
        "--expected-state-id",
        fixture.snapshot.stateId,
        "--expected-adjudication-digest",
        fixture.expectedAdjudicationDigest,
      ];
    }

    function decideAndClaim({ store, binding, opened }, decision = "retry") {
      const decided = store.decideCase(
        {
          ...binding,
          decision,
          authority: "cli-operator",
          reasonDigest: computeTeamAdjudicationEvidenceDigest({
            reason: `${decision} after verification`,
          }),
          expectedRevision: opened.case.revision,
        },
        { anchor: opened.cursor },
      );
      const claimed = store.claimDecision(
        {
          ...binding,
          decisionDigest: decided.case.decision.decisionDigest,
          consumer: "team-state:team_state_cli_test:publish",
          expectedRevision: decided.case.revision,
        },
        { anchor: decided.cursor },
      );
      return { decided, claimed };
    }

    it("rejects v5 adjudication listing and accepts a bound v6 list", () => {
      const registry = pendingRegistry();
      writePrivateJson(statePath, {
        version: 5,
        registry: registry.snapshot(),
      });
      const rejected = runCli(directory, [
        "team",
        "adjudications",
        "--state",
        statePath,
        "--json",
      ]);
      expect(rejected.ok).toBe(false);
      expect(rejected.output).toMatch(/Resume the v5 state once/);

      const fixture = adjudicationFixture();
      const listed = runCli(directory, [
        "team",
        "adjudications",
        "--state",
        statePath,
        "--json",
      ]);
      expect(listed.ok).toBe(true);
      expect(JSON.parse(listed.output)).toMatchObject({
        collaborationRunId: "team-cli-test",
        cases: [
          {
            caseId: fixture.opened.case.caseId,
            taskKey: "publish",
            status: "pending",
          },
        ],
      });
    });

    it("makes interrupt requests idempotent and rejects stale authority or terminal tasks", () => {
      const registry = pendingRegistry();
      const lease = registry.acquire("publish", { holder: "worker-1" });
      expect(lease.ok).toBe(true);
      const attemptDigest = computeTeamControlAttemptDigest({
        holder: lease.lease.holder,
        leaseId: lease.lease.leaseId,
        fencingToken: lease.lease.fencingToken ?? lease.lease.leaseId,
      });
      writePrivateJson(statePath, baseSnapshot(registry));
      const args = [
        "team",
        "interrupt",
        "--state",
        statePath,
        "--task",
        "publish",
        "--expected-state-id",
        STATE_ID,
        "--expected-attempt-digest",
        attemptDigest,
        "--request-id",
        "tctl_takeover-1",
        "--actor",
        "operator:a",
        "--reason",
        "manual inspection",
        "--json",
      ];
      const first = runCli(directory, args);
      const duplicate = runCli(directory, args);
      expect(first.ok, first.output).toBe(true);
      expect(JSON.parse(first.output)).toMatchObject({
        ok: true,
        request: { requestId: "tctl_takeover-1", taskKey: "publish" },
      });
      expect(duplicate.ok).toBe(true);
      expect(JSON.parse(duplicate.output)).toMatchObject({
        ok: true,
        idempotent: true,
        request: { requestId: "tctl_takeover-1" },
      });

      const conflict = runCli(directory, [
        "team",
        "interrupt",
        "--state",
        statePath,
        "--task",
        "publish",
        "--expected-state-id",
        STATE_ID,
        "--expected-attempt-digest",
        attemptDigest,
        "--request-id",
        "tctl_takeover-1",
        "--actor",
        "operator:a",
        "--reason",
        "different reason",
        "--json",
      ]);
      expect(conflict.ok).toBe(false);
      expect(conflict.output).toMatch(/already bound to different input/);

      const staleAttempt = runCli(directory, [
        "team",
        "interrupt",
        "--state",
        statePath,
        "--task",
        "publish",
        "--expected-state-id",
        STATE_ID,
        "--expected-attempt-digest",
        `sha256:${"0".repeat(64)}`,
        "--request-id",
        "tctl_takeover-stale-attempt",
      ]);
      expect(staleAttempt.ok).toBe(false);
      expect(staleAttempt.output).toMatch(/task attempt changed/i);

      const stale = JSON.parse(fs.readFileSync(statePath, "utf8"));
      stale.stateId = "team_state_replaced";
      writePrivateJson(statePath, stale);
      const staleResult = runCli(directory, [
        "team",
        "interrupt",
        "--state",
        statePath,
        "--task",
        "publish",
        "--expected-state-id",
        STATE_ID,
        "--expected-attempt-digest",
        attemptDigest,
        "--request-id",
        "tctl_takeover-2",
      ]);
      expect(staleResult.ok).toBe(false);
      expect(staleResult.output).toMatch(
        /(state authority changed|authority binding mismatch|mismatched team control store)/i,
      );

      const terminalRegistry = pendingRegistry();
      const terminalLease = terminalRegistry.acquire("publish", {
        holder: "worker-1",
      });
      expect(terminalLease.ok).toBe(true);
      const terminalAttemptDigest = computeTeamControlAttemptDigest({
        holder: terminalLease.lease.holder,
        leaseId: terminalLease.lease.leaseId,
        fencingToken:
          terminalLease.lease.fencingToken ?? terminalLease.lease.leaseId,
      });
      expect(
        terminalRegistry.complete("publish", {
          holder: "worker-1",
          leaseId: terminalLease.lease.leaseId,
          result: { ok: true },
        }).ok,
      ).toBe(true);
      fs.rmSync(`${statePath}.control.json`, { force: true });
      writePrivateJson(
        statePath,
        baseSnapshot(terminalRegistry, { stateId: "team_state_terminal" }),
      );
      const terminal = runCli(directory, [
        "team",
        "interrupt",
        "--state",
        statePath,
        "--task",
        "publish",
        "--expected-state-id",
        "team_state_terminal",
        "--expected-attempt-digest",
        terminalAttemptDigest,
      ]);
      expect(terminal.ok).toBe(false);
      expect(terminal.output).toMatch(/not in progress \(completed\)/);
    });

    it.each(["retry", "accept", "cancel"])(
      "applies and idempotently replays a %s decision",
      (decision) => {
        const fixture = adjudicationFixture();
        const args = [
          "team",
          "adjudicate",
          "--state",
          statePath,
          "--task",
          "publish",
          "--decision",
          decision,
          ...adjudicationAuthorityArgs(fixture),
          "--reason",
          `${decision} after verification`,
          "--json",
        ];
        const first = runCli(directory, args);
        expect(first.ok, first.output).toBe(true);
        expect(JSON.parse(first.output)).toMatchObject({
          ok: true,
          decision,
          task: {
            key: "publish",
            status:
              decision === "retry"
                ? "pending"
                : decision === "accept"
                  ? "completed"
                  : "cancelled",
            metadata: {
              adjudication: {
                required: false,
                decision: { action: decision },
              },
            },
          },
          case: { status: "applied" },
        });
        expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);

        const duplicate = runCli(directory, args);
        expect(duplicate.ok, duplicate.output).toBe(true);
        expect(JSON.parse(duplicate.output)).toMatchObject({
          ok: true,
          idempotent: true,
          case: { status: "applied" },
        });
        expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
      },
    );

    it("rejects an adjudication decision pinned to a stale case digest", () => {
      const fixture = adjudicationFixture();
      const rejected = runCli(directory, [
        "team",
        "adjudicate",
        "--state",
        statePath,
        "--task",
        "publish",
        "--decision",
        "cancel",
        "--expected-state-id",
        fixture.snapshot.stateId,
        "--expected-adjudication-digest",
        `sha256:${"0".repeat(64)}`,
        "--reason",
        "stale case probe",
        "--json",
      ]);
      expect(rejected.ok).toBe(false);
      expect(rejected.output).toMatch(/adjudication authority changed/i);
      expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
      expect(fixture.store.getCase(fixture.binding)).toMatchObject({
        status: "pending",
      });
    });

    it("finishes retry idempotently after claim and state persist but before case.apply", () => {
      const fixture = adjudicationFixture();
      const { claimed } = decideAndClaim(fixture);
      const claimId = claimed.case.claim.claimId;
      const registry = TaskLeaseRegistry.restore(fixture.snapshot.registry);
      expect(
        registry.resolveAdjudication("publish", {
          decision: "retry",
          decisionId: claimId,
          actor: "cli-operator",
          reason: "retry after verification",
          evidenceDigest: "sha256:unknown-side-effect",
        }).ok,
      ).toBe(true);
      writePrivateJson(statePath, {
        ...fixture.snapshot,
        registry: registry.snapshot(),
        adjudicationCursor: claimed.cursor,
      });

      const recovered = runCli(directory, [
        "team",
        "adjudicate",
        "--state",
        statePath,
        "--task",
        "publish",
        "--decision",
        "retry",
        ...adjudicationAuthorityArgs(fixture),
        "--reason",
        "retry after verification",
        "--json",
      ]);
      expect(recovered.ok, recovered.output).toBe(true);
      expect(JSON.parse(recovered.output)).toMatchObject({
        ok: true,
        decision: "retry",
        task: {
          status: "pending",
          metadata: {
            adjudication: {
              required: false,
              decision: { id: claimId, action: "retry" },
            },
          },
        },
        case: {
          status: "applied",
          claim: { claimId },
          recovery: { state: "complete" },
        },
      });
      expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
    });

    it("forbids retry replay after claim when the state outcome was not persisted", () => {
      const fixture = adjudicationFixture();
      decideAndClaim(fixture);

      const rejected = runCli(directory, [
        "team",
        "adjudicate",
        "--state",
        statePath,
        "--task",
        "publish",
        "--decision",
        "retry",
        ...adjudicationAuthorityArgs(fixture),
        "--reason",
        "retry after verification",
        "--json",
      ]);
      expect(rejected.ok).toBe(false);
      expect(rejected.output).toMatch(
        /outcome is unknown; automatic replay is forbidden/,
      );
      const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
      expect(
        TaskLeaseRegistry.restore(snapshot.registry).getTask("publish"),
      ).toMatchObject({
        status: "cancelled",
        metadata: { adjudication: { required: true, decision: null } },
      });
      expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
    });

    it("fails closed on an adjudication cursor rollback and releases the run lock", () => {
      const fixture = adjudicationFixture();
      const tampered = {
        ...fixture.opened.cursor,
        headDigest: `sha256:${"0".repeat(64)}`,
      };
      writePrivateJson(statePath, {
        ...fixture.snapshot,
        adjudicationCursor: tampered,
      });

      const listed = runCli(directory, [
        "team",
        "adjudications",
        "--state",
        statePath,
        "--json",
      ]);
      expect(listed.ok).toBe(false);
      expect(listed.output).toMatch(/recovery (anchor|cursor)/i);

      const adjudicated = runCli(directory, [
        "team",
        "adjudicate",
        "--state",
        statePath,
        "--task",
        "publish",
        "--decision",
        "cancel",
        ...adjudicationAuthorityArgs(fixture),
        "--reason",
        "tamper check",
      ]);
      expect(adjudicated.ok).toBe(false);
      expect(adjudicated.output).toMatch(/recovery (anchor|cursor)/i);
      expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
    });

    it("fails closed on a control cursor rollback during resume and releases the run lock", () => {
      const graphPath = path.join(directory, "tasks.json");
      writePrivateJson(graphPath, {
        tasks: [{ key: "publish", title: "Publish package" }],
      });
      const collaborationRuns = path.join(directory, "collaboration-runs");
      const environment = {
        ...process.env,
        CC_COLLABORATION_RUNS_DIR: collaborationRuns,
      };
      const initial = runCli(
        directory,
        ["team", "run", "--tasks", graphPath, "--state", statePath, "--json"],
        { env: environment },
      );
      expect(initial.ok, initial.output).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const control = new TeamControlStore({
        statePath,
        stateId: snapshot.stateId,
      });
      control.requestInterrupt({
        requestId: "tctl_after-completion",
        taskKey: "publish",
        holder: "finished-worker",
        leaseId: "finished-lease",
        fencingToken: "finished-lease",
        actor: "operator:a",
        reason: "cursor rollback probe",
      });
      const cursor = control.cursor();
      writePrivateJson(statePath, {
        ...snapshot,
        controlCursor: {
          ...cursor,
          headDigest: `sha256:${"0".repeat(64)}`,
        },
      });

      const resumed = runCli(
        directory,
        [
          "team",
          "run",
          "--tasks",
          graphPath,
          "--resume",
          "--state",
          statePath,
          "--json",
        ],
        { env: environment },
      );
      expect(resumed.ok).toBe(false);
      expect(resumed.output).toMatch(/control.*(rollback|anchor|cursor)/i);
      expect(fs.existsSync(`${statePath}.run-lock`)).toBe(false);
    });
  },
);
