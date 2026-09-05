import {
  openWorkbenchRollbackStore,
  NOW,
} from "../../fixtures/evolution-workbench-rollback.js";
import {
  buildEvolutionWorkbenchRollbackRequest,
  buildEvolutionWorkbenchRollbackReceipt,
} from "../../../src/lib/evolution/evolution-workbench-version-control.js";
import { filterEvolutionWorkbenchProjection } from "../../../src/lib/evolution/evolution-workbench-projection.js";

const [root, mode, phase] = process.argv.slice(2);
let rollbackStarted = false;
async function killAtCheckpoint() {
  await new Promise((resolve) =>
    process.stdout.write(
      JSON.stringify({ pid: process.pid, checkpoint: phase }),
      resolve,
    ),
  );
  process.kill(process.pid, "SIGKILL");
}
const h = await openWorkbenchRollbackStore(root, {
  seed: mode === "seed",
  now: () =>
    mode === "seed" || ["prepared", "after-lease"].includes(phase)
      ? NOW
      : NOW + 700_000,
  onTransition: async (point, transaction) => {
    if (
      mode === "seed" &&
      rollbackStarted &&
      phase === "after-lease" &&
      point === "after-lease"
    )
      await killAtCheckpoint();
    if (
      mode === "seed" &&
      phase === "after-pointer" &&
      point === "after-pointer" &&
      transaction.intent.operation === "rollback"
    )
      await killAtCheckpoint();
  },
});
let resumed = [];
if (mode === "seed") {
  const authorization = await h.adapter.authorizeHumanRollback({
    plan: h.plan,
  });
  const request = buildEvolutionWorkbenchRollbackRequest(
    h.plan,
    authorization.receiptDigest,
  );
  if (phase !== "prepared") {
    rollbackStarted = true;
    const applied = await h.adapter.applyRollback(request);
    if (phase === "committed") {
      const active = await h.adapter.readActiveState({
        tenantId: h.descriptor.tenantId,
        skillName: h.descriptor.skillName,
      });
      await h.adapter.commitRollback({
        receipt: buildEvolutionWorkbenchRollbackReceipt(
          h.plan,
          request,
          applied.receiptDigest,
          active,
        ),
      });
    }
  }
  await killAtCheckpoint();
} else if (mode === "resume") {
  resumed = await h.adapter.resume();
} else if (mode !== "inspect") throw new Error("unknown test mode");

if (mode !== "seed") {
  const events = h.backend.ledger.read();
  const count = (type) => events.filter((event) => event.type === type).length;
  const active = h.release.readActive();
  const projection = await h.reviewBridge.loadCurrentProjection();
  const visible = filterEvolutionWorkbenchProjection(projection);
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      sequence: h.backend.ledger.verify().sequence,
      prepared: count("evolution.workbench.rollback.prepared"),
      committed: count("evolution.workbench.rollback.committed"),
      releaseFinalizations: count("skill.release.finalize"),
      asks: h.asks.length,
      mutations: h.mutationRequests.length,
      resumed: resumed.length,
      receiptDigests: resumed.map((receipt) => receipt.receiptDigest),
      revision: active.state.revision,
      contentDigest: active.release.contentDigest,
      dependencyLockDigest: active.release.dependencyLockDigest,
      baselineContentDigest: h.release.baseline.contentDigest,
      baselineLockDigest: h.release.baseline.dependencyLockDigest,
      baselineReleaseDigest: h.release.baseline.releaseDigest,
      candidateReleaseDigest: h.release.candidateRelease.releaseDigest,
      workbenchActiveReleaseDigest: visible.governance.activeReleaseId,
      workbenchLastKnownGoodReleaseDigest:
        visible.governance.lastKnownGoodReleaseId,
      historicalRunActiveReleaseDigest: projection.run.activeReleaseId,
      registryOperationCount: projection.registry.operations.length,
    }),
  );
}
