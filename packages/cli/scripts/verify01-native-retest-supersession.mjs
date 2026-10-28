/** Offline evidence for retiring an obsolete, partially dispatched round.
 * The original plan, ledger, failures and missing samples remain unchanged.
 * This permits inheritance of strictly verified deliveries, never completion
 * credit for undispatched work or a reset of financial responsibility.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sorted = (values) => [...values].sort();
const decode = (bytes) =>
  JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
const REPOSITORY = "chainlesschain/chainlesschain";
const WORKFLOW = "verify01-native-task-campaign.yml";

export function verifyNativeRetestSupersession({
  reference,
  context,
  ledger,
  successor,
  read,
}) {
  const root = reference.planPath.slice(0, reference.planPath.lastIndexOf("/"));
  const stem = reference.planPath.slice(
    reference.planPath.lastIndexOf("/") + 1,
    -"-plan.json".length,
  );
  assert.equal(reference.supersessionPath, `${root}/${stem}-supersession.json`);
  const bytes = read(reference.supersessionPath);
  assert.equal(
    hash(bytes),
    reference.supersessionDigest,
    "supersession digest differs",
  );
  const closure = decode(bytes);
  assert.equal(closure.schema, "chainlesschain.native-retest-supersession/v1");
  assert.equal(closure.reason, "PUBLIC_PACKAGE_SET_SUPERSEDED");
  assert.equal(closure.billingReconciled, false);
  assert.equal(closure.liabilitiesPreserved, true);
  for (const key of ["planPath", "planDigest", "ledgerPath", "ledgerDigest"])
    assert.equal(closure[key], reference[key]);
  assert.equal(closure.planDigest, context.planDigest);
  assert.equal(closure.nextPackageSetDigest, successor.packageSetDigest);
  assert.equal(
    ledger.status,
    "IN_PROGRESS",
    "only incomplete rounds need supersession",
  );
  assert.equal(ledger.partialDispatch, true);
  assert.ok(
    ledger.runs.length > 0 &&
      ledger.runs.every((run) => run.status === "COMPLETED"),
    "every dispatched run must have complete verified generation and acceptance",
  );
  const pending = ledger.samples
    .filter((sample) => sample.status === "PENDING_DISPATCH")
    .map((sample) => sample.sampleId);
  assert.ok(pending.length > 0, "supersession must retain undispatched work");
  assert.deepEqual(closure.unrequestedSampleIds, sorted(pending));
  assert.deepEqual(
    closure.localDispatchState,
    sorted(pending).map((sampleId) => ({
      sampleId,
      intent: false,
      request: false,
      resolved: false,
    })),
  );
  assert.ok(
    Number.isFinite(Date.parse(closure.closedAt)),
    "closure timestamp required",
  );

  const readEvidence = (entry) => {
    assert.ok(entry.path.startsWith(`${root}/${stem}/supersession/`));
    assert.match(
      entry.path.slice(`${root}/${stem}/supersession/`.length),
      /^[a-z0-9][a-z0-9.-]*\.json$/u,
    );
    const raw = read(entry.path);
    assert.ok(raw.length <= 8 * 1024 * 1024);
    assert.equal(raw.length, entry.bytes);
    assert.equal(
      hash(raw),
      entry.digest,
      "supersession evidence digest differs",
    );
    assert.ok(
      Number.isFinite(Date.parse(entry.observedAt)) &&
        Date.parse(entry.observedAt) <= Date.parse(closure.closedAt),
    );
    return decode(raw);
  };
  const sources = sorted([
    ...new Set(ledger.runs.map((run) => run.sourceCommit)),
  ]);
  assert.deepEqual(
    closure.runInventories.map((item) => item.sourceCommit).sort(),
    sources,
  );
  for (const inventory of closure.runInventories) {
    assert.equal(
      inventory.url,
      `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?head_sha=${inventory.sourceCommit}&per_page=100`,
    );
    const remote = readEvidence(inventory);
    assert.ok(remote.total_count <= 100);
    assert.equal(
      remote.workflow_runs.length,
      remote.total_count,
      "complete remote inventory required; no truncated page",
    );
    assert.equal(
      new Set(remote.workflow_runs.map((run) => String(run.id))).size,
      remote.total_count,
    );
    assert.deepEqual(
      sorted(remote.workflow_runs.map((run) => String(run.id))),
      sorted(
        ledger.runs
          .filter((run) => run.sourceCommit === inventory.sourceCommit)
          .map((run) => run.runId),
      ),
      "uncollected or unknown remote run blocks supersession",
    );
    for (const run of remote.workflow_runs) {
      assert.equal(run.head_sha, inventory.sourceCommit);
      assert.equal(run.event, "workflow_dispatch");
      assert.equal(run.path, `.github/workflows/${WORKFLOW}`);
      assert.equal(
        run.run_attempt,
        1,
        "rerun responsibility must be reconciled separately",
      );
      assert.equal(run.status, "completed", "live work cannot be superseded");
      assert.ok(
        Number.isFinite(Date.parse(run.updated_at)) &&
          Date.parse(run.updated_at) <= Date.parse(inventory.observedAt),
      );
    }
  }
  const manifest = decode(successor.bytes);
  assert.deepEqual(Object.keys(closure.publicReadbacks).sort(), [
    "cli",
    "jetbrains",
    "vscode",
  ]);
  const endpoints = {
    cli: "https://registry.npmjs.org/chainlesschain/latest",
    vscode: "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest",
    jetbrains:
      "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100",
  };
  for (const [entry, url] of Object.entries(endpoints))
    assert.equal(closure.publicReadbacks[entry].url, url);
  const cli = readEvidence(closure.publicReadbacks.cli);
  assert.equal(cli.version, manifest.versions.cli);
  assert.equal(cli.dist.integrity, manifest.origin.cli.integrity);
  assert.equal(cli.dist.tarball, manifest.origin.cli.tarball);
  const vscode = readEvidence(closure.publicReadbacks.vscode);
  assert.equal(vscode.version, manifest.versions.vscode);
  assert.equal(vscode.files.download, manifest.origin.vscode.download);
  const updates = readEvidence(closure.publicReadbacks.jetbrains);
  const visible = updates.filter(
    (item) =>
      item.approve === true &&
      item.listed === true &&
      item.hidden === false &&
      /^\d+\.\d+\.\d+$/u.test(item.version),
  );
  const matches = visible.filter(
    (item) => item.version === manifest.versions.jetbrains,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, manifest.origin.jetbrains.updateId);
  assert.equal(matches[0].file, manifest.origin.jetbrains.file);
  const versionOrder = (left, right) => {
    const a = left.split(".").map(Number),
      b = right.split(".").map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  };
  assert.ok(
    visible.every(
      (item) => versionOrder(item.version, manifest.versions.jetbrains) <= 0,
    ),
  );
  assert.ok(
    versionOrder(manifest.versions.cli, ledger.versions.cli) > 0,
    "supersession requires a newer public CLI",
  );
  for (const entry of ["vscode", "jetbrains"])
    assert.ok(
      versionOrder(manifest.versions[entry], ledger.versions[entry]) >= 0,
      "IDE versions must not regress",
    );
  return closure;
}
