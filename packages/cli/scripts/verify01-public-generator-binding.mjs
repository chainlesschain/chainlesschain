/** Offline publication proof binding; artifact download verification stays separate. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { nativePluginArtifactBinding } from "./verify01-native-plugin-artifact.mjs";

const publicStatuses = ["verified-public", "previously-verified-public"];
const legacyPath =
  "docs/research/cli/evidence/release136-public/publication.json";
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function verifyPublicGeneratorPairing(manifest, proof) {
  const cli = proof?.cli;
  const vscode = proof?.ide?.vscode;
  const jetbrains = proof?.ide?.jetbrains;
  assert.equal(cli?.status, "verified-public", "CLI must be verified public");
  assert.ok(
    publicStatuses.includes(vscode?.status) ||
      (vscode?.status === "verified-public-by-official-release-workflow" &&
        vscode.officialWorkflowConclusion === "success"),
    "VS Code must have successful public release evidence",
  );
  for (const [name, record, sourceKey, source] of [
    ["cli", cli, "cli", cli?.source ?? proof?.source],
    ["vscode", vscode, "openVsx", vscode?.source],
    ["jetbrains", jetbrains, "jetbrains", jetbrains?.source],
  ]) {
    assert.match(record?.version ?? "", /^\d+\.\d+\.\d+$/u);
    assert.equal(
      record.version,
      manifest?.versions?.[name],
      `${name} version mismatch`,
    );
    assert.match(source ?? "", /^[a-f0-9]{40}$/u);
    assert.equal(
      source,
      manifest?.releaseSourceCommits?.[sourceKey],
      `${name} source mismatch`,
    );
  }
  const artifact = nativePluginArtifactBinding(manifest);
  const pending = jetbrains.status === "uploaded-pending-review";
  assert.ok(
    pending || publicStatuses.includes(jetbrains.status),
    "JetBrains release status is not supported",
  );
  if (pending) {
    assert.equal(jetbrains.marketplaceUploaded, true);
    assert.ok(
      artifact,
      "pending JetBrains release requires an official artifact binding",
    );
  }
  if (artifact) {
    assert.equal(artifact.sourceCommit, jetbrains.source);
    if (pending || jetbrains.runId !== undefined)
      assert.equal(artifact.runId, jetbrains.runId);
    if (pending || jetbrains.tag !== undefined)
      assert.equal(artifact.tag, jetbrains.tag);
    assert.equal(artifact.tag, `ide-jetbrains-v${jetbrains.version}`);
  }
  return {
    distribution: artifact ? "mixed-public-and-official-artifact" : "public",
    cliStatus: cli.status,
    vscodeStatus: vscode.status,
    jetbrainsStatus: jetbrains.status,
    jetbrainsMarketplacePending: pending,
    pluginArtifact: artifact,
  };
}

export function loadPublicGeneratorProof(manifest, { repositoryRoot }) {
  const declaration = manifest?.publicGeneratorProof;
  if (declaration === undefined) {
    assert.equal(
      manifest?.versions?.cli,
      "0.166.136",
      "explicit publication proof required",
    );
  } else {
    assert.ok(declaration && typeof declaration === "object");
    assert.match(declaration.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
  }
  const proofPath = declaration === undefined ? legacyPath : declaration.path;
  assert.match(
    proofPath ?? "",
    /^docs\/research\/cli\/evidence\/release[1-9]\d*-public\/publication\.json$/u,
  );
  const root = fs.realpathSync(repositoryRoot);
  const file = fs.realpathSync(path.resolve(root, proofPath));
  const relative = path.relative(root, file);
  assert.ok(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    "publication proof escapes repository",
  );
  const bytes = fs.readFileSync(file);
  const proofDigest = digest(bytes);
  if (declaration !== undefined)
    assert.equal(
      proofDigest,
      declaration.digest,
      "publication proof digest mismatch",
    );
  const proof = JSON.parse(bytes.toString("utf8"));
  const binding = verifyPublicGeneratorPairing(manifest, proof);
  return {
    proof,
    binding,
    proofPath,
    proofDigest,
    legacyFallback: declaration === undefined,
  };
}
