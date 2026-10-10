import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectJobRecovery,
  inspectUnassignedCleanup,
  RECOVERY_SCHEMA,
} from "../scripts/lib/windows-job-recovery-evidence.mjs";

const id = "24711641-68ec-425e-ac36-418ae8e42a2a";
function fixture() {
  return {
    schema: RECOVERY_SCHEMA,
    executionId: id,
    status: "NOT_ADMITTED",
    nonElevated: true,
    completed: true,
    cleanupConfirmed: true,
    finalJobEmpty: true,
    originalOwnerCleanupConfirmed: true,
    unassignedFailureInjected: false,
    custodianRestartTested: false,
    wfpTested: false,
    events: [
      { name: "assigned-before-resume", ownerInJob: true, jobActive: 1 },
      {
        name: "live-tree",
        jobActive: 3,
        socketChallenges: 3,
        handlesJobVerified: true,
      },
      {
        name: "negative-identities",
        wrongJobRejected: true,
        staleIdentityRejected: true,
        ownerInWrongJob: false,
        wrongJobActive: 0,
        jobActive: 3,
        socketChallenges: 3,
      },
      {
        name: "owner-crashed",
        originalOwnerHandleSignaled: true,
        ownerSocketClosed: true,
        ownerSocketTerminal: "eof",
        jobActive: 2,
        descendantSocketChallenges: 2,
        cleanupConfirmed: false,
      },
      { name: "termination-issued", sameRetainedJob: true },
      {
        name: "cleanup-fence",
        jobActive: 0,
        originalOwnerHandleSignaled: true,
        retainedMemberHandlesSignaled: 3,
        descendantSocketsClosed: 2,
        descendantSocketTerminals: ["eof", "reset"],
      },
    ],
  };
}
test("a complete diagnostic stays untrusted and cannot admit a durable backend", () => {
  const result = inspectJobRecovery(fixture(), id);
  assert.equal(result.diagnosticCompleted, true);
  assert.equal(result.trusted, false);
  assert.equal(result.status, "NOT_ADMITTED");
  assert.equal(result.durableServiceRecovery, "not-tested");
  assert.equal(result.wfpRevocation, "not-tested");
});
test("a previous execution cannot supply a current receipt", () => {
  assert.equal(
    inspectJobRecovery(fixture(), "24711641-68ec-425e-ac36-418ae8e42a2b")
      .diagnosticCompleted,
    false,
  );
});
for (const [name, mutate] of [
  [
    "owner exit is not cleanup",
    (v) => {
      v.events[3].cleanupConfirmed = true;
    },
  ],
  [
    "PID absence cannot replace a retained handle",
    (v) => {
      delete v.events[5].originalOwnerHandleSignaled;
      v.events[5].ownerPidMissing = true;
    },
  ],
  [
    "a timeout cannot replace an empty Job",
    (v) => {
      delete v.events[5].jobActive;
      v.events[5].timeoutElapsed = true;
    },
  ],
  [
    "deleting a journal cannot confirm cleanup",
    (v) => {
      delete v.cleanupConfirmed;
      v.journalRemoved = true;
    },
  ],
  [
    "a nonempty Job remains unconfirmed",
    (v) => {
      v.events[5].jobActive = 1;
    },
  ],
  [
    "closed sockets alone cannot replace process handles",
    (v) => {
      v.events[5].retainedMemberHandlesSignaled = 0;
    },
  ],
  [
    "process termination alone cannot prove socket observation",
    (v) => {
      v.events[5].descendantSocketsClosed = 0;
    },
  ],
  [
    "socket timeouts are not terminal connection evidence",
    (v) => {
      v.events[5].descendantSocketTerminals[0] = "timeout";
    },
  ],
  [
    "a wrong Job must be a real nonmember",
    (v) => {
      v.events[2].ownerInWrongJob = true;
    },
  ],
  [
    "stale identity must leave all fixture sockets alive",
    (v) => {
      v.events[2].socketChallenges = 2;
    },
  ],
  [
    "custodian restart claims are rejected",
    (v) => {
      v.custodianRestartTested = true;
    },
  ],
  [
    "WFP claims are rejected",
    (v) => {
      v.wfpTested = true;
    },
  ],
  [
    "failed native cleanup cannot be hidden by complete events",
    (v) => {
      v.cleanupError = "query failed";
    },
  ],
  [
    "owner cleanup failure cannot be hidden by an empty Job",
    (v) => {
      v.originalOwnerCleanupConfirmed = false;
    },
  ],
  [
    "event reordering is rejected",
    (v) => {
      [v.events[3], v.events[4]] = [v.events[4], v.events[3]];
    },
  ],
  [
    "duplicate events are rejected",
    (v) => {
      v.events.push(v.events[5]);
    },
  ],
])
  test(name, () => {
    const value = fixture();
    mutate(value);
    assert.equal(inspectJobRecovery(value, id).diagnosticCompleted, false);
  });
test("malformed evidence remains unconfirmed", () => {
  for (const value of [null, {}, { events: [null] }, fixture()]) {
    assert.equal(
      inspectJobRecovery(value, undefined).diagnosticCompleted,
      false,
    );
  }
});
test("an unassigned suspended owner requires independent original HANDLE cleanup", () => {
  const value = {
    ...fixture(),
    events: [],
    completed: false,
    unassignedFailureInjected: true,
    originalOwnerFallbackAttempted: true,
    error: "Injected failure before Job assignment and resume",
  };
  assert.equal(inspectUnassignedCleanup(value, id), true);
  assert.equal(inspectJobRecovery(value, id).diagnosticCompleted, false);
  for (const field of [
    "originalOwnerCleanupConfirmed",
    "originalOwnerFallbackAttempted",
    "finalJobEmpty",
  ])
    assert.equal(
      inspectUnassignedCleanup({ ...value, [field]: false }, id),
      false,
    );
  assert.equal(
    inspectUnassignedCleanup(value, "24711641-68ec-425e-ac36-418ae8e42a2b"),
    false,
  );
});
