#!/usr/bin/env node
/** Operator-only download of an exact tested JetBrains build, before model work. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = "chainlesschain/chainlesschain";
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function nativePluginArtifactBinding(manifest) {
  const origin = manifest?.origin?.jetbrains;
  if (origin?.distribution === undefined) return null;
  assert.equal(origin.distribution, "github-actions-artifact");
  assert.equal(origin.repository, repository);
  assert.match(origin.sourceCommit ?? "", /^[a-f0-9]{40}$/u);
  assert.match(origin.artifactDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
  for (const field of ["runId", "artifactId"])
    assert.ok(Number.isSafeInteger(origin[field]) && origin[field] > 0);
  assert.match(
    origin.artifactName ?? "",
    /^chainlesschain-ide-jetbrains-[1-9]\d*$/u,
  );
  assert.equal(origin.tag, `ide-jetbrains-v${manifest.versions.jetbrains}`);
  assert.equal(
    origin.file,
    `chainlesschain-ide-bridge-${manifest.versions.jetbrains}.zip`,
  );
  assert.equal(origin.workflow, ".github/workflows/ide-extensions.yml");
  const payload = manifest.publicArtifacts?.jetbrains;
  assert.match(payload?.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.ok(
    Number.isSafeInteger(payload.bytes) &&
      payload.bytes > 100000 &&
      payload.bytes < 128 * 1024 * 1024,
  );
  return {
    ...origin,
    payloadDigest: payload.digest,
    payloadBytes: payload.bytes,
  };
}

export function verifyNativePluginArtifactMetadata(binding, run, artifact) {
  assert.equal(run.id, binding.runId);
  assert.equal(run.head_sha, binding.sourceCommit);
  assert.equal(run.head_branch, binding.tag);
  assert.equal(run.path, binding.workflow);
  assert.equal(run.event, "push");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.equal(run.repository.full_name, repository);
  assert.equal(artifact.id, binding.artifactId);
  assert.equal(artifact.name, binding.artifactName);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.digest, binding.artifactDigest);
  assert.equal(artifact.workflow_run.id, binding.runId);
  assert.equal(artifact.workflow_run.head_sha, binding.sourceCommit);
  assert.equal(artifact.workflow_run.repository_id, run.repository.id);
  return true;
}

export function readNativePluginArtifact(manifest, archive) {
  const binding = nativePluginArtifactBinding(manifest);
  if (!binding) {
    assert.ok(
      !archive,
      "an artifact path requires an explicit package-set binding",
    );
    return null;
  }
  assert.ok(
    archive && path.isAbsolute(archive),
    "bound plugin artifact path required",
  );
  const stat = fs.lstatSync(archive);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, binding.payloadBytes);
  const bytes = fs.readFileSync(archive);
  assert.equal(
    hash(bytes),
    binding.payloadDigest,
    "plugin build payload digest mismatch",
  );
  return { binding, bytes };
}

async function download(manifestFile, outputDirectory) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const binding = nativePluginArtifactBinding(manifest);
  if (!binding) return;
  const execute = (args, options) =>
    new Promise((resolve, reject) => {
      execFile("gh", args, options, (error, stdout) => {
        if (error) reject(new Error("GitHub artifact read/download failed"));
        else resolve({ stdout });
      });
    });
  const options = {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
  };
  const api = async (route) => {
    const { stdout } = await execute(
      ["api", `repos/${repository}/${route}`],
      options,
    );
    return JSON.parse(stdout);
  };
  const [run, artifact] = await Promise.all([
    api(`actions/runs/${binding.runId}`),
    api(`actions/artifacts/${binding.artifactId}`),
  ]);
  verifyNativePluginArtifactMetadata(binding, run, artifact);
  fs.mkdirSync(outputDirectory, { recursive: true });
  await execute(
    [
      "run",
      "download",
      String(binding.runId),
      "--repo",
      repository,
      "--name",
      binding.artifactName,
      "--dir",
      outputDirectory,
    ],
    options,
  );
  const archive = path.resolve(outputDirectory, binding.file);
  readNativePluginArtifact(manifest, archive);
  fs.writeFileSync(
    path.join(outputDirectory, "provenance.json"),
    JSON.stringify(
      {
        binding,
        verifiedAt: new Date().toISOString(),
        gateConclusion: run.conclusion,
        marketplaceApprovalClaimed: false,
      },
      null,
      2,
    ) + "\n",
  );
  if (process.env.GITHUB_ENV) {
    assert.ok(!/[\r\n]/u.test(archive));
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `CC_VERIFY01_JETBRAINS_ARCHIVE=${archive}\n`,
    );
  }
  console.log(
    JSON.stringify({
      channel: "github-actions-artifact",
      runId: binding.runId,
      artifactId: binding.artifactId,
      sourceCommit: binding.sourceCommit,
      digest: binding.payloadDigest,
      bytes: binding.payloadBytes,
      marketplaceApprovalClaimed: false,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(
    process.argv.length,
    4,
    "package-set file and output directory required",
  );
  await download(process.argv[2], process.argv[3]);
}
