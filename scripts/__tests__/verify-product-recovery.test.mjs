import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  auditOriginal,
  auditRecoveryAndroid,
  latestAndroidProducer,
  extractVerifiedZip,
  hashFile,
  verifyAndroidReceipt,
  verifyCliEvidence,
  verifyPublicPrerequisites,
  verifyReleaseIdentity,
  missingDraftAssets,
  findProductRelease,
  RECOVERY,
  PRODUCERS,
  SOURCE_GATES,
  ORIGINAL_ARTIFACTS,
} from "../ci/verify-product-recovery.mjs";

const NOW = Date.parse("2026-10-08T04:00:00Z");
const CONTROLLER = "c".repeat(40);

test("draft discovery follows all list pages after the published-only tag endpoint returns 404", async () => {
  const draft = {
    id: 123,
    tag_name: RECOVERY.version,
    draft: true,
    assets: [],
  };
  const seen = [];
  const result = await findProductRelease(async (endpoint, allow404) => {
    seen.push(endpoint);
    if (endpoint.startsWith("releases/tags/")) {
      assert.equal(allow404, true);
      return null;
    }
    if (endpoint.endsWith("page=1"))
      return Array.from({ length: 100 }, (_, id) => ({
        id,
        tag_name: "other",
      }));
    if (endpoint.endsWith("page=2")) return [draft];
    if (endpoint === "releases/123") return draft;
    throw new Error(endpoint);
  });
  assert.deepEqual(result, draft);
  assert.equal(seen.length, 4);
});

test("draft discovery refuses duplicates or an identity changed between listing and readback", async () => {
  const draft = { id: 123, tag_name: RECOVERY.version };
  await assert.rejects(
    findProductRelease(async (endpoint) =>
      endpoint.startsWith("releases/tags/")
        ? null
        : [draft, { ...draft, id: 124 }],
    ),
    /Ambiguous product drafts/,
  );
  await assert.rejects(
    findProductRelease(async (endpoint) =>
      endpoint.startsWith("releases/tags/")
        ? null
        : endpoint.includes("per_page=")
          ? [draft]
          : { ...draft, tag_name: "other" },
    ),
  );
});

test("published release discovery never needs draft fallback", async () => {
  const release = { id: 123, tag_name: RECOVERY.version, draft: false };
  assert.equal(
    await findProductRelease(async (endpoint) => {
      assert.equal(endpoint, `releases/tags/${RECOVERY.version}`);
      return release;
    }),
    release,
  );
});
const step = (name, conclusion = "success") => ({
  name,
  status: "completed",
  conclusion,
});
function job(
  name,
  id,
  runId = RECOVERY.originalRunId,
  headSha = RECOVERY.sourceSha,
) {
  return {
    name,
    id,
    run_id: runId,
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    started_at: "2026-10-08T02:00:00Z",
    completed_at: "2026-10-08T03:30:00Z",
    steps: [],
  };
}
function artifact(name, id, run) {
  return {
    id,
    name,
    expired: false,
    expires_at: "2026-10-15T00:00:00Z",
    size_in_bytes: 999,
    digest: `sha256:${"d".repeat(64)}`,
    created_at: "2026-10-08T03:00:00Z",
    workflow_run: { id: run.id, head_sha: run.head_sha, repository_id: 42 },
  };
}
function fixture() {
  const run = {
    id: RECOVERY.originalRunId,
    repository: { id: 42, full_name: RECOVERY.repository },
    head_sha: RECOVERY.sourceSha,
    path: ".github/workflows/release.yml",
    event: "workflow_dispatch",
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
  };
  const jobs = PRODUCERS.map(([name, id, , requiredStep]) => ({
    ...job(name, id),
    steps: [step(requiredStep)],
  }));
  jobs.push({
    ...job(
      "Verify public workspace dependencies (no publishing)",
      113124014902,
    ),
    steps: [step("Fetch every exact public workspace package")],
  });
  jobs.push({
    ...job("build-android", 113124142622),
    conclusion: "failure",
    steps: [
      step("Build release APK"),
      step("Build App Bundle"),
      step("Verify cc bundle packed into APKs (hard gate)", "failure"),
    ],
  });
  return {
    run,
    jobs,
    artifacts: PRODUCERS.map(([, , name]) => {
      const [id, size, digest] = ORIGINAL_ARTIFACTS[name];
      return {
        ...artifact(name, id, run),
        size_in_bytes: size,
        digest: `sha256:${digest}`,
      };
    }),
    gates: SOURCE_GATES.map(([id, workflow]) => ({
      id,
      path: workflow,
      head_sha: RECOVERY.sourceSha,
      repository: run.repository,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
    })),
  };
}
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "product-recovery-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("only the known failed release can supply four successful producers and CLI authority", () => {
  const result = auditOriginal(fixture(), NOW);
  assert.equal(result.artifacts.length, 5);
  assert.equal(result.sourceSha, RECOVERY.sourceSha);
  assert.equal(result.sourceGates.length, 6);
  assert.ok(
    result.artifacts.every(
      (a) =>
        a.runId === RECOVERY.originalRunId &&
        a.workflowHeadSha === RECOVERY.sourceSha,
    ),
  );
});

for (const [label, edit, pattern] of [
  [
    "foreign repository",
    (x) => (x.run.repository.full_name = "attacker/fork"),
    /Foreign repository/,
  ],
  [
    "different source",
    (x) => (x.run.head_sha = CONTROLLER),
    /Wrong original source/,
  ],
  [
    "different workflow",
    (x) => (x.run.path = ".github/workflows/untrusted.yml"),
    /Wrong original workflow/,
  ],
  [
    "PR producer",
    (x) => (x.run.event = "pull_request"),
    /Wrong original event/,
  ],
  ["another attempt", (x) => (x.run.run_attempt = 2), /retried/],
  [
    "failed source CI",
    (x) => (x.gates[2].conclusion = "failure"),
    /Source gate failed/,
  ],
  [
    "stale source CI",
    (x) => (x.gates[0].head_sha = CONTROLLER),
    /Stale source gate/,
  ],
  [
    "failed desktop producer",
    (x) => (x.jobs[0].conclusion = "failure"),
    /not successful/,
  ],
  [
    "unsigned iOS fallback",
    (x) => (x.jobs[3].steps[0].conclusion = "skipped"),
    /failed or skipped/,
  ],
  [
    "unrelated Android failure",
    (x) => (x.jobs.at(-1).steps[0].conclusion = "failure"),
    /failed or skipped/,
  ],
  ["expired artifact", (x) => (x.artifacts[0].expired = true), /expired/],
  [
    "elapsed artifact expiry",
    (x) => (x.artifacts[0].expires_at = "2020-01-01T00:00:00Z"),
    /expiry elapsed/,
  ],
  [
    "missing immutable digest",
    (x) => delete x.artifacts[0].digest,
    /no immutable digest/,
  ],
  [
    "replaced immutable artifact",
    (x) => x.artifacts[0].id++,
    /artifact ID changed/,
  ],
  [
    "substituted immutable digest",
    (x) => (x.artifacts[0].digest = `sha256:${"0".repeat(64)}`),
    /artifact digest changed/,
  ],
  [
    "artifact from another run",
    (x) => x.artifacts[0].workflow_run.id++,
    /foreign run/,
  ],
  [
    "artifact predates producer",
    (x) => (x.artifacts[0].created_at = "2026-10-07T00:00:00Z"),
    /outside producer/,
  ],
  [
    "ambiguous artifact name",
    (x) => x.artifacts.push({ ...x.artifacts[0], id: 200 }),
    /exactly one artifact/,
  ],
  [
    "missing original CLI evidence",
    (x) => x.artifacts.pop(),
    /exactly one artifact/,
  ],
]) {
  test(`rejects ${label}`, () => {
    const data = fixture();
    edit(data);
    assert.throws(() => auditOriginal(data, NOW), pattern);
  });
}

test("recovered Android must come from this controller, run attempt and successful verification step", () => {
  const run = {
    ...fixture().run,
    id: 999,
    head_sha: CONTROLLER,
    run_attempt: 2,
    path: ".github/workflows/product-release-recovery.yml",
    status: "in_progress",
    conclusion: null,
  };
  const producer = {
    ...job("Rebuild and verify original Android source", 900, 999, CONTROLLER),
    steps: [
      step("Verify release signatures and pinned CLI bundle"),
      step("Upload verified Android recovery artifact"),
    ],
  };
  const output = artifact("product-recovery-android-999-2", 300, run);
  assert.equal(
    auditRecoveryAndroid(run, [producer], [output], CONTROLLER, 2, NOW).id,
    300,
  );
  assert.throws(() =>
    auditRecoveryAndroid(run, [producer], [output], RECOVERY.sourceSha, 2, NOW),
  );
  assert.throws(() =>
    auditRecoveryAndroid(run, [producer], [output], CONTROLLER, 1, NOW),
  );
  producer.steps[0].conclusion = "skipped";
  assert.throws(
    () => auditRecoveryAndroid(run, [producer], [output], CONTROLLER, 2, NOW),
    /failed or skipped/,
  );
});

test("raw ZIP digest is verified before any extraction and path traversal is refused", (t) => {
  const root = temp(t);
  const python = process.platform === "win32" ? "python" : "python3";
  const zip = path.join(root, "artifact.zip");
  const makeZip = (name) =>
    execFileSync(python, [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr(sys.argv[2],b'payload'); z.close()",
      zip,
      name,
    ]);
  makeZip("artifact.bin");
  const destination = path.join(root, "downloaded");
  assert.throws(
    () => extractVerifiedZip(zip, destination, `sha256:${"0".repeat(64)}`),
    /Raw artifact digest mismatch/,
  );
  assert.equal(fs.existsSync(destination), false);
  extractVerifiedZip(zip, destination, `sha256:${hashFile(zip)}`);
  assert.equal(
    fs.readFileSync(path.join(destination, "artifact.bin"), "utf8"),
    "payload",
  );
  makeZip("../outside.bin");
  assert.throws(
    () =>
      extractVerifiedZip(
        zip,
        path.join(root, "unsafe"),
        `sha256:${hashFile(zip)}`,
      ),
    /Unsafe archive components/,
  );
  assert.equal(fs.existsSync(path.join(root, "outside.bin")), false);
});

test("publisher-only rerun reuses the successful previous Android attempt with its own receipt identity", async () => {
  const run = {
    ...fixture().run,
    id: 999,
    head_sha: CONTROLLER,
    run_attempt: 2,
    path: ".github/workflows/product-release-recovery.yml",
    status: "in_progress",
    conclusion: null,
  };
  const producer = {
    ...job("Rebuild and verify original Android source", 900, 999, CONTROLLER),
    run_attempt: 1,
    steps: [
      step("Verify release signatures and pinned CLI bundle"),
      step("Upload verified Android recovery artifact"),
    ],
  };
  const queried = [];
  const selected = await latestAndroidProducer(999, 2, async (id, attempt) => {
    assert.equal(id, 999);
    queried.push(attempt);
    return attempt === 2
      ? [job("publisher", 902, 999, CONTROLLER)]
      : [producer];
  });
  assert.deepEqual(queried, [2, 1]);
  const verified = auditRecoveryAndroid(
    run,
    selected.jobs,
    [artifact("product-recovery-android-999-1", 300, run)],
    CONTROLLER,
    2,
    NOW,
    selected.producerAttempt,
  );
  assert.equal(verified.producerAttempt, 1);
  assert.equal(verified.workflowHeadSha, CONTROLLER);
});

test("previous attempts cannot import a foreign controller or hide a newer failed Android producer", async () => {
  const run = {
    ...fixture().run,
    id: 999,
    head_sha: CONTROLLER,
    run_attempt: 2,
    path: ".github/workflows/product-release-recovery.yml",
  };
  const producer = {
    ...job(
      "Rebuild and verify original Android source",
      900,
      999,
      RECOVERY.sourceSha,
    ),
    steps: [
      step("Verify release signatures and pinned CLI bundle"),
      step("Upload verified Android recovery artifact"),
    ],
  };
  let selected = await latestAndroidProducer(999, 2, async (_, attempt) =>
    attempt === 1 ? [producer] : [],
  );
  assert.throws(
    () =>
      auditRecoveryAndroid(
        run,
        selected.jobs,
        [artifact("product-recovery-android-999-1", 300, run)],
        CONTROLLER,
        2,
        NOW,
        selected.producerAttempt,
      ),
    /source mismatch/,
  );
  producer.head_sha = CONTROLLER;
  producer.conclusion = "failure";
  selected = await latestAndroidProducer(999, 2, async () => [producer]);
  assert.equal(selected.producerAttempt, 2);
  assert.throws(
    () => auditRecoveryAndroid(run, selected.jobs, [], CONTROLLER, 2, NOW, 2),
    /not successful/,
  );
});

test("Android receipt distinguishes payload source from controller and catches changed bytes", (t) => {
  const directory = temp(t);
  const names = [
    "app-arm64-v8a-release.apk",
    "app-armeabi-v7a-release.apk",
    "app-universal-release.apk",
    "app-release.aab",
  ];
  const assets = names.map((name) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, "signed fixture");
    return { name, size: fs.statSync(file).size, sha256: hashFile(file) };
  });
  const receipt = {
    schema: 1,
    version: RECOVERY.version,
    sourceSha: RECOVERY.sourceSha,
    controllerSha: CONTROLLER,
    runId: 999,
    runAttempt: 1,
    assets,
  };
  verifyAndroidReceipt(receipt, directory, CONTROLLER, 999, 1);
  assert.throws(
    () =>
      verifyAndroidReceipt(
        { ...receipt, sourceSha: CONTROLLER },
        directory,
        CONTROLLER,
        999,
        1,
      ),
    /payload source mismatch/,
  );
  fs.writeFileSync(path.join(directory, names[0]), "changed bytes!");
  assert.throws(
    () => verifyAndroidReceipt(receipt, directory, CONTROLLER, 999, 1),
    /Android bytes changed/,
  );
});

test("consumed CLI attestation must bind the public package to the immutable npm source", (t) => {
  const root = temp(t);
  const write = (name, value) =>
    fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  write("cli-release-gate.json", {
    sha: RECOVERY.npmSha,
    repository: RECOVERY.repository,
    gates: ["cli-ci.yml", "cli-strict-sandbox.yml"].map((workflow) => ({
      workflow,
      sha: RECOVERY.npmSha,
      conclusion: "success",
    })),
  });
  const provenance = {
    package: "chainlesschain",
    version: RECOVERY.cliVersion,
    commit: RECOVERY.npmSha,
    ref: "refs/tags/v-npm-0-166-93",
    repository: `https://github.com/${RECOVERY.repository}`,
    workflow: ".github/workflows/npm-publish.yml",
    sha512: "a".repeat(128),
    audit: { invalid: 0, missing: 0 },
  };
  write("cli-npm-provenance.json", provenance);
  write("product-release-cli-child-install.json", {
    package: "chainlesschain",
    version: RECOVERY.cliVersion,
    cliSource: "immutable-candidate-tarball",
    childrenSource: "https://registry.npmjs.org",
  });
  verifyCliEvidence(root);
  write("cli-npm-provenance.json", { ...provenance, commit: CONTROLLER });
  assert.throws(() => verifyCliEvidence(root));
});

test("public paired releases must be ready, approved and match the consumed CLI archive", (t) => {
  const root = temp(t);
  const write = (name, value) =>
    fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const digest = "a".repeat(128);
  write("product-recovery-provenance.json", {
    cliEvidence: { provenance: { sha512: digest } },
  });
  write("public-cli.json", { version: RECOVERY.cliVersion, sha512: digest });
  write("open-vsx-public.json", {
    channel: "open-vsx",
    version: "0.37.138",
    status: "ready",
    downloadable: true,
    listed: true,
  });
  const jetbrains = {
    channel: "jetbrains",
    version: "0.4.156",
    status: "ready",
    approve: true,
    listed: true,
    hidden: false,
  };
  write("jetbrains-public.json", jetbrains);
  verifyPublicPrerequisites(root);
  write("jetbrains-public.json", { ...jetbrains, approve: false });
  assert.throws(() => verifyPublicPrerequisites(root));
  write("jetbrains-public.json", jetbrains);
  write("public-cli.json", {
    version: RECOVERY.cliVersion,
    sha512: "b".repeat(128),
  });
  assert.throws(() => verifyPublicPrerequisites(root), /CLI archive changed/);
});

test("a new draft binds its target, while publication requires the actual immutable source tag", () => {
  const draft = {
    tag_name: RECOVERY.version,
    target_commitish: RECOVERY.sourceSha,
    prerelease: false,
    draft: true,
    immutable: false,
  };
  verifyReleaseIdentity(draft, null);
  assert.throws(
    () =>
      verifyReleaseIdentity({ ...draft, target_commitish: CONTROLLER }, null),
    /Draft target mismatch/,
  );
  assert.throws(
    () => verifyReleaseIdentity({ ...draft, prerelease: true }, null),
    /must not be a prerelease/,
  );
  const published = { ...draft, draft: false, immutable: true };
  verifyReleaseIdentity(published, RECOVERY.sourceSha, true);
  assert.throws(
    () => verifyReleaseIdentity(published, null, true),
    /tag is missing/,
  );
  assert.throws(
    () => verifyReleaseIdentity(published, CONTROLLER, true),
    /different source/,
  );
  assert.throws(
    () =>
      verifyReleaseIdentity(
        { ...published, immutable: false },
        RECOVERY.sourceSha,
        true,
      ),
    /not immutable/,
  );
});

test("a partial draft resumes only missing uploads without clobbering validated existing bytes", () => {
  const receipt = {
    version: RECOVERY.version,
    sourceSha: RECOVERY.sourceSha,
    assets: [
      { name: "app-release.aab", size: 42, sha256: "a".repeat(64) },
      { name: "ChainlessChain.ipa", size: 51, sha256: "b".repeat(64) },
    ],
  };
  const release = {
    tag_name: RECOVERY.version,
    draft: true,
    assets: [
      {
        name: "app-release.aab",
        size: 42,
        digest: `sha256:${"a".repeat(64)}`,
        state: "uploaded",
      },
    ],
  };
  assert.deepEqual(missingDraftAssets(receipt, release), [
    "ChainlessChain.ipa",
  ]);
  release.assets.push({
    name: "ChainlessChain.ipa",
    size: 51,
    digest: `sha256:${"b".repeat(64)}`,
    state: "uploaded",
  });
  assert.deepEqual(missingDraftAssets(receipt, release), []);
  assert.throws(
    () => missingDraftAssets(receipt, { ...release, draft: false }),
    /Only a draft/,
  );
});

test("draft resume rejects changed bytes, unexpected assets and incomplete server-side uploads", () => {
  const receipt = {
    version: RECOVERY.version,
    sourceSha: RECOVERY.sourceSha,
    assets: [{ name: "app-release.aab", size: 42, sha256: "a".repeat(64) }],
  };
  const asset = {
    name: "app-release.aab",
    size: 42,
    digest: `sha256:${"a".repeat(64)}`,
    state: "uploaded",
  };
  const release = (change) => ({
    tag_name: RECOVERY.version,
    draft: true,
    assets: [{ ...asset, ...change }],
  });
  assert.throws(
    () =>
      missingDraftAssets(
        receipt,
        release({ digest: `sha256:${"b".repeat(64)}` }),
      ),
    /digest mismatch/,
  );
  assert.throws(
    () => missingDraftAssets(receipt, release({ size: 43 })),
    /size mismatch/,
  );
  assert.throws(
    () => missingDraftAssets(receipt, release({ name: "obsolete.apk" })),
    /Unexpected draft asset/,
  );
  assert.throws(
    () => missingDraftAssets(receipt, release({ state: "new" })),
    /Incomplete existing upload/,
  );
});
