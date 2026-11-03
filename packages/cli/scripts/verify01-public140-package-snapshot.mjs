/** Public package readback and authenticated model catalog GET; no inference. */
import fs from "node:fs";
import net from "node:net";
import {
  PUBLIC140_FULL_ID,
  PUBLIC140_FULL_BUDGETS,
  PUBLIC140_MODEL_METADATA,
} from "./verify01-volcengine-public140-full.mjs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  listZipEntries,
  readZipEntry,
} from "../../vscode-extension/scripts/verify-vsix.mjs";
import { loadPublicGeneratorProof } from "./verify01-public-generator-binding.mjs";
import { verifyNativePluginArtifactMetadata } from "./verify01-native-plugin-artifact.mjs";

net.setDefaultAutoSelectFamilyAttemptTimeout(10000);
const root = process.cwd();
const cliSource = "e2a91bf54332ff3d252c40ecc25c5887e0f0430d";
const jetSource = "e2a91bf54332ff3d252c40ecc25c5887e0f0430d";
const work = path.join(
  process.env.RUNNER_TEMP,
  "verify01-public140-original-packages",
);
fs.mkdirSync(work, { recursive: true });
const sha = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const run = (file, args) =>
  execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const api = (route) =>
  JSON.parse(run("gh", ["api", `repos/chainlesschain/chainlesschain${route}`]));
async function readOnlyFetch(url, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(90000),
      });
    } catch {
      if (attempt === 2)
        throw new Error(
          "Read-only metadata or distribution GET failed after three network attempts",
        );
    }
  }
}
async function bytes(url) {
  assert.equal(new URL(url).protocol, "https:");
  const response = await readOnlyFetch(url, {
    signal: AbortSignal.timeout(90000),
    headers: { "cache-control": "no-cache" },
  });
  assert.equal(
    response.ok,
    true,
    `public package fetch failed: ${response.status}`,
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.ok(buffer.length > 0 && buffer.length < 64 * 1024 * 1024);
  return buffer;
}
const json = async (url) => JSON.parse((await bytes(url)).toString("utf8"));
async function officialArtifact(id, name, source, tag, workflow) {
  const metadata = api(`/actions/runs/${id}`);
  assert.equal(metadata.head_sha, source);
  assert.equal(metadata.head_branch, tag);
  assert.equal(metadata.path, workflow);
  assert.equal(metadata.event, "push");
  assert.equal(metadata.status, "completed");
  assert.equal(metadata.conclusion, "success");
  const matches = api(
    `/actions/runs/${id}/artifacts?per_page=100`,
  ).artifacts.filter((a) => a.name === name);
  assert.equal(matches.length, 1);
  const artifact = matches[0];
  assert.equal(artifact.expired, false);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(artifact.workflow_run.id, id);
  assert.equal(artifact.workflow_run.head_sha, source);
  const directory = path.join(work, name);
  fs.mkdirSync(directory, { recursive: true });
  const zip = execFileSync(
    "gh",
    [
      "api",
      `repos/chainlesschain/chainlesschain/actions/artifacts/${artifact.id}/zip`,
    ],
    {
      cwd: root,
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  assert.equal(sha(zip), artifact.digest);
  assert.equal(zip.length, artifact.size_in_bytes);
  let expanded = 0;
  for (const [relative, entry] of listZipEntries(zip)) {
    if (relative.endsWith("/")) continue;
    assert.ok(
      !/[\\:\r\n]/u.test(relative) &&
        relative.split("/").every((p) => p && p !== "." && p !== ".."),
    );
    const target = path.resolve(directory, relative);
    assert.ok(target.startsWith(directory + path.sep));
    const payload = readZipEntry(zip, entry);
    expanded += payload.length;
    assert.ok(expanded < 256 * 1024 * 1024);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload);
  }
  return { run: metadata, artifact, directory };
}
function findFile(directory, name) {
  const result = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) {
      const match = findFile(full, name);
      if (match) result.push(match);
    } else if (item.name === name) result.push(full);
  }
  assert.ok(result.length <= 1, `ambiguous official artifact file ${name}`);
  return result[0];
}
function zipContent(buffer) {
  return sha(
    Buffer.from(
      JSON.stringify(
        [...listZipEntries(buffer)]
          .filter(([name]) => !name.endsWith("/"))
          .map(([name, entry]) => ({
            name,
            digest: sha(readZipEntry(buffer, entry)),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    ),
  );
}

const [npm, latest, vscode] = await Promise.all([
  json("https://registry.npmjs.org/chainlesschain/0.166.140"),
  json("https://registry.npmjs.org/chainlesschain/latest"),
  json("https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.176"),
]);
assert.equal(npm.version, "0.166.140");
assert.equal(
  latest.version,
  npm.version,
  "Public generator changed; review target before paid dispatch",
);
assert.equal(vscode.version, "0.37.176");
assert.equal(vscode.downloadable, true);
const [cliBytes, vscodeBytes] = await Promise.all([
  bytes(npm.dist.tarball),
  bytes(vscode.files.download),
]);
assert.equal(
  "sha512-" + createHash("sha512").update(cliBytes).digest("base64"),
  npm.dist.integrity,
);
const npmProof = await officialArtifact(
  41610020835,
  "chainlesschain-npm-readback-" + cliSource,
  cliSource,
  "v-npm-0-166-140",
  ".github/workflows/npm-publish.yml",
);
const cliManifest = JSON.parse(
  fs.readFileSync(
    findFile(npmProof.directory, "chainlesschain-release.json"),
    "utf8",
  ),
);
assert.equal(cliManifest.version, npm.version);
assert.equal(cliManifest.commit, cliSource);
assert.equal(cliManifest.bytes, cliBytes.length);
assert.equal("sha256:" + cliManifest.sha256, sha(cliBytes));
assert.equal(
  cliManifest.sha512,
  createHash("sha512").update(cliBytes).digest("hex"),
);
const vscodeProof = await officialArtifact(
  41614441062,
  "chainlesschain-ide-vscode-candidate",
  cliSource,
  "ide-vscode-v0.37.176",
  ".github/workflows/ide-extensions.yml",
);
const originalVsix = fs.readFileSync(
  findFile(vscodeProof.directory, "chainlesschain-ide.vsix"),
);
const vsixManifest = JSON.parse(
  fs.readFileSync(findFile(vscodeProof.directory, "manifest.json"), "utf8"),
);
assert.equal(vsixManifest.commit, cliSource);
assert.equal(vsixManifest.version, vscode.version);
assert.equal(sha(originalVsix), "sha256:" + vsixManifest.sha256);
assert.equal(
  zipContent(originalVsix),
  zipContent(vscodeBytes),
  "Registry VSIX contents differ from official release",
);
assert.equal(
  JSON.parse(
    readZipEntry(
      vscodeBytes,
      listZipEntries(vscodeBytes).get("extension/package.json"),
    ).toString("utf8"),
  ).version,
  vscode.version,
);
const jet = await officialArtifact(
  41614441190,
  "chainlesschain-ide-jetbrains-2",
  jetSource,
  "ide-jetbrains-v0.4.193",
  ".github/workflows/ide-extensions.yml",
);
const pluginFile = "chainlesschain-ide-bridge-0.4.193.zip";
const jetBytes = fs.readFileSync(findFile(jet.directory, pluginFile));

const evidenceRoot = "docs/research/cli/verify01-volcengine-140-full-20261103";
const manifestPath =
  "docs/research/cli/verify01-package-sets/2026-11-03-volcengine-public140-full45.json";
assert.ok(
  !fs.existsSync(manifestPath),
  "Snapshot already frozen; reconcile it instead of overwriting",
);
fs.mkdirSync(evidenceRoot, { recursive: true });
// Authenticated GET only; this preflight never calls chat/completions.
const key = process.env.VOLCENGINE_API_KEY?.trim();
assert.ok(key, "Dedicated complete Volcengine credential is required");
const catalogResponse = await readOnlyFetch(
  "https://ark.cn-beijing.volces.com/api/v3/models",
  {
    signal: AbortSignal.timeout(45000),
    headers: { Authorization: "Bearer " + key },
  },
);
assert.equal(
  catalogResponse.status,
  200,
  "Volcengine catalog authentication failed",
);
const catalog = await catalogResponse.json();
const model = catalog.data?.find((r) => r.id === "deepseek-v4-flash-ga-260731");
assert.ok(model);
assert.equal(model.token_limits?.max_output_token_length, 393216);
fs.writeFileSync(
  PUBLIC140_MODEL_METADATA,
  JSON.stringify(model, null, 2) + "\n",
);
const jobs = api(`/actions/runs/${jet.run.id}/jobs?per_page=100`).jobs;
assert.ok(
  jobs.some((j) =>
    j.steps?.some(
      (s) =>
        /publish.*jetbrains|jetbrains.*publish/iu.test(s.name) &&
        s.conclusion === "success",
    ),
  ),
  "JetBrains upload success must be observed, not inferred from a ZIP",
);
const updates = await json(
  "https://plugins.jetbrains.com/api/plugins/32208/updates?size=8",
);
const publicJet = updates.find(
  (r) => r.version === "0.4.193" && r.approve === true && r.listed === true,
);
if (publicJet) {
  const registry = await bytes(
    "https://plugins.jetbrains.com/plugin/download?updateId=" + publicJet.id,
  );
  assert.equal(zipContent(registry), zipContent(jetBytes));
}
const proofPath =
  "docs/research/cli/evidence/release140-public/publication.json";
const proof = {
  schema: 1,
  checkedAt: new Date().toISOString(),
  source: cliSource,
  cli: {
    version: npm.version,
    status: "verified-public",
    source: cliSource,
    method: "GitHub Actions OIDC Trusted Publishing",
    runId: npmProof.run.id,
    tag: npmProof.run.head_branch,
    publicRegistryBytesVerified: true,
    sha256: sha(cliBytes).slice(7),
    officialWorkflowConclusion: npmProof.run.conclusion,
  },
  ide: {
    vscode: {
      version: vscode.version,
      status: "verified-public",
      source: cliSource,
      runId: vscodeProof.run.id,
      officialWorkflowConclusion: vscodeProof.run.conclusion,
    },
    jetbrains: {
      version: "0.4.193",
      status: publicJet ? "verified-public" : "uploaded-pending-review",
      source: jetSource,
      runId: jet.run.id,
      tag: jet.run.head_branch,
      marketplaceUploaded: true,
      marketplaceListingClaimed: Boolean(publicJet),
      publicAvailabilityVerified: Boolean(publicJet),
    },
  },
  modelGenerationRequests: 0,
};
fs.mkdirSync(path.dirname(proofPath), { recursive: true });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + "\n");
const manifest = {
  schema: "chainlesschain.native-package-set/v1",
  resolvedAt: new Date().toISOString(),
  versions: {
    cli: npm.version,
    vscode: vscode.version,
    jetbrains: "0.4.193",
    vscodeHost: "1.132.0",
    jetbrainsHost: "2025.2",
  },
  releaseSourceCommit: cliSource,
  releaseSourceCommits: {
    cli: cliSource,
    openVsx: cliSource,
    jetbrains: jetSource,
  },
  publicGeneratorProof: {
    path: proofPath,
    digest: sha(fs.readFileSync(proofPath)),
  },
  diagnosticExecution: { contextWindowTokens: 32768 },
  origin: {
    cli: {
      url: "https://registry.npmjs.org/chainlesschain/0.166.140",
      integrity: cliManifest.sha512,
      tarball: npm.dist.tarball,
    },
    vscode: {
      url: "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.176",
      download: vscode.files.download,
    },
    jetbrains: {
      distribution: "github-actions-artifact",
      repository: "chainlesschain/chainlesschain",
      sourceCommit: jetSource,
      runId: jet.run.id,
      artifactId: jet.artifact.id,
      artifactName: jet.artifact.name,
      artifactDigest: jet.artifact.digest,
      tag: jet.run.head_branch,
      file: pluginFile,
      workflow: jet.run.path,
      marketplaceStatus: publicJet
        ? "approved-public-payload-verified"
        : "uploaded-awaiting-approval",
    },
  },
  publicArtifacts: {
    cli: { digest: sha(cliBytes), bytes: cliBytes.length },
    vscode: { digest: sha(vscodeBytes), bytes: vscodeBytes.length },
    jetbrains: { digest: sha(jetBytes), bytes: jetBytes.length },
  },
  volcengineFullRound: {
    id: PUBLIC140_FULL_ID,
    projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
    model: "deepseek-v4-flash-ga-260731",
    taskCount: 36,
    firstRunCount: 9,
    repeatPreviouslyAccepted: true,
    historicalScoresUnchanged: true,
    formalSample: false,
    reviewChanges: true,
    outputPolicy: "model-maximum",
    ...PUBLIC140_FULL_BUDGETS,
    modelMetadata: {
      path: PUBLIC140_MODEL_METADATA,
      digest: sha(fs.readFileSync(PUBLIC140_MODEL_METADATA)),
    },
  },
  authorization:
    "User explicitly requests a full retest of all 36+9 tasks with the latest CLI and IDE plugins. Repeat previously accepted IDs in this new round while retaining historical cumulative successes. Bind public CLI/VS Code bytes and the official JetBrains release artifact. Original task project, model and independent review/acceptance retained. No model inference during this package preflight.",
};
const { binding } = loadPublicGeneratorProof(manifest, {
  repositoryRoot: root,
});
verifyNativePluginArtifactMetadata(
  binding.pluginArtifact,
  jet.run,
  jet.artifact,
);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const report = {
  schema: 1,
  checkedAt: new Date().toISOString(),
  manifestPath,
  manifestDigest: sha(fs.readFileSync(manifestPath)),
  versions: manifest.versions,
  releaseSource: cliSource,
  distribution: binding.distribution,
  jetbrainsPublicListed: Boolean(publicJet),
  modelGenerationRequests: 0,
  artifacts: {
    npm: npmProof.artifact,
    vscode: vscodeProof.artifact,
    jetbrains: jet.artifact,
  },
  originalPackageDigests: manifest.publicArtifacts,
  officialRuns: {
    npm: npmProof.run,
    vscode: vscodeProof.run,
    jetbrains: jet.run,
  },
  publication: proof,
};
fs.writeFileSync(
  path.join(evidenceRoot, "package-resolution.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    manifestPath,
    versions: manifest.versions,
    distribution: binding.distribution,
    jetbrainsPublicListed: Boolean(publicJet),
    allOriginalPackageBytesVerified: true,
    modelGenerationRequests: 0,
  }),
);
