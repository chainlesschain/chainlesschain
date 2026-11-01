/** Account-free CI preparation. Never reads a model key or dispatches generation. */
import fs from "node:fs";
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

const root = process.cwd();
const cliSource = "e42ea07b6da7ab2c3eb709002448b32d5fedf535";
const jetSource = "ef13d5238e2b3e4c4571e48e820d0eb31a3107b2";
const work = path.join(
  process.env.RUNNER_TEMP,
  "verify01-public138-original-packages",
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
async function bytes(url) {
  assert.equal(new URL(url).protocol, "https:");
  const response = await fetch(url, {
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
  run("gh", [
    "run",
    "download",
    String(id),
    "--repo",
    "chainlesschain/chainlesschain",
    "--name",
    name,
    "--dir",
    directory,
  ]);
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
  json("https://registry.npmjs.org/chainlesschain/0.166.138"),
  json("https://registry.npmjs.org/chainlesschain/latest"),
  json("https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.174"),
]);
assert.equal(npm.version, "0.166.138");
assert.equal(
  latest.version,
  npm.version,
  "Public generator changed; review target before paid dispatch",
);
assert.equal(vscode.version, "0.37.174");
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
  41313099948,
  "chainlesschain-npm-readback-" + cliSource,
  cliSource,
  "v-npm-0-166-138",
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
  41316653600,
  "chainlesschain-ide-vscode-candidate",
  cliSource,
  "ide-vscode-v0.37.174",
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
  41327724484,
  "chainlesschain-ide-jetbrains-1",
  jetSource,
  "ide-jetbrains-v0.4.191",
  ".github/workflows/ide-extensions.yml",
);
const pluginFile = "chainlesschain-ide-bridge-0.4.191.zip";
const jetBytes = fs.readFileSync(findFile(jet.directory, pluginFile));
const proofPath =
  "docs/research/cli/evidence/release138-public/publication.json";
const manifest = {
  schema: "chainlesschain.native-package-set/v1",
  resolvedAt: new Date().toISOString(),
  versions: {
    cli: npm.version,
    vscode: vscode.version,
    jetbrains: "0.4.191",
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
    digest: sha(fs.readFileSync(path.join(root, proofPath))),
  },
  diagnosticExecution: { contextWindowTokens: 32768 },
  origin: {
    cli: {
      url: "https://registry.npmjs.org/chainlesschain/0.166.138",
      integrity: cliManifest.sha512,
      tarball: npm.dist.tarball,
    },
    vscode: {
      url: "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.174",
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
      marketplaceStatus: "uploaded-awaiting-approval",
    },
  },
  publicArtifacts: {
    cli: { digest: sha(cliBytes), bytes: cliBytes.length },
    vscode: { digest: sha(vscodeBytes), bytes: vscodeBytes.length },
    jetbrains: { digest: sha(jetBytes), bytes: jetBytes.length },
  },
  authorization:
    "User explicitly authorizes immediate validation using available packages without waiting for JetBrains review. Preserve previous accepted samples and independent acceptance; no paid call in this preflight.",
};
const { binding } = loadPublicGeneratorProof(manifest, {
  repositoryRoot: root,
});
verifyNativePluginArtifactMetadata(
  binding.pluginArtifact,
  jet.run,
  jet.artifact,
);
const manifestPath =
  "docs/research/cli/verify01-package-sets/2026-11-02-openai-138.json";
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const report = {
  schema: 1,
  checkedAt: new Date().toISOString(),
  executionSource: process.env.GITHUB_SHA,
  manifestPath,
  manifestDigest: sha(fs.readFileSync(manifestPath)),
  versions: manifest.versions,
  sourceCommits: manifest.releaseSourceCommits,
  distribution: binding.distribution,
  cliMatchesOfficialNpmReadback: true,
  vscodeMatchesOfficialPayload: true,
  vscodeArchiveByteIdentical: sha(originalVsix) === sha(vscodeBytes),
  jetbrainsOriginalOfficialArtifact: true,
  marketplaceApprovalClaimed: false,
  modelRequests: 0,
  artifacts: {
    npm: npmProof.artifact,
    vscode: vscodeProof.artifact,
    jetbrains: jet.artifact,
  },
};
const reportPath =
  "docs/research/cli/verify01-openai-138/package-resolution.json";
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    manifestPath,
    versions: manifest.versions,
    distribution: binding.distribution,
    packageBytesVerified: true,
    modelRequests: 0,
  }),
);
