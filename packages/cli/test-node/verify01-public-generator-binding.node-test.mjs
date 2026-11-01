import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  loadPublicGeneratorProof,
  verifyPublicGeneratorPairing,
} from "../scripts/verify01-public-generator-binding.mjs";

function fixture() {
  const source = "a".repeat(40);
  const jetSource = "b".repeat(40);
  const proof = {
    source,
    cli: { version: "0.166.138", status: "verified-public" },
    ide: {
      vscode: {
        version: "0.37.174",
        source,
        status: "verified-public-by-official-release-workflow",
        officialWorkflowConclusion: "success",
      },
      jetbrains: {
        version: "0.4.191",
        source: jetSource,
        status: "uploaded-pending-review",
        marketplaceUploaded: true,
        runId: 123,
        tag: "ide-jetbrains-v0.4.191",
      },
    },
  };
  const manifest = {
    versions: { cli: "0.166.138", vscode: "0.37.174", jetbrains: "0.4.191" },
    releaseSourceCommits: {
      cli: source,
      openVsx: source,
      jetbrains: jetSource,
    },
    origin: {
      jetbrains: {
        distribution: "github-actions-artifact",
        repository: "chainlesschain/chainlesschain",
        sourceCommit: jetSource,
        artifactDigest: `sha256:${"c".repeat(64)}`,
        runId: 123,
        artifactId: 456,
        artifactName: "chainlesschain-ide-jetbrains-1",
        tag: "ide-jetbrains-v0.4.191",
        file: "chainlesschain-ide-bridge-0.4.191.zip",
        workflow: ".github/workflows/ide-extensions.yml",
      },
    },
    publicArtifacts: {
      jetbrains: { digest: `sha256:${"d".repeat(64)}`, bytes: 100001 },
    },
  };
  return { manifest, proof };
}

test("uploaded artifact is mixed distribution and remains pending", () => {
  const { manifest, proof } = fixture();
  const binding = verifyPublicGeneratorPairing(manifest, proof);
  assert.equal(binding.distribution, "mixed-public-and-official-artifact");
  assert.equal(binding.jetbrainsMarketplacePending, true);
  assert.equal(binding.jetbrainsStatus, "uploaded-pending-review");
});

test("public statuses do not require a pending artifact", () => {
  for (const status of ["verified-public", "previously-verified-public"]) {
    const { manifest, proof } = fixture();
    delete manifest.origin;
    proof.ide.vscode.status = status;
    proof.ide.jetbrains.status = status;
    assert.equal(
      verifyPublicGeneratorPairing(manifest, proof).distribution,
      "public",
    );
  }
});

test("historical public proof may omit run identity while artifact retains strict binding", () => {
  const { manifest, proof } = fixture();
  proof.ide.jetbrains.status = "verified-public";
  delete proof.ide.jetbrains.runId;
  delete proof.ide.jetbrains.tag;
  const binding = verifyPublicGeneratorPairing(manifest, proof);
  assert.equal(binding.pluginArtifact.runId, 123);
  assert.equal(binding.jetbrainsMarketplacePending, false);
});

test("rejects nonpublic releases, mismatched versions and sources, and unbound pending artifacts", () => {
  const mutations = [
    (m, p) => {
      p.cli.status = "uploaded";
    },
    (m, p) => {
      p.ide.vscode.status = "uploaded-pending-review";
    },
    (m, p) => {
      p.ide.vscode.officialWorkflowConclusion = "failure";
    },
    ...["cli", "vscode", "jetbrains"].map((name) => (m) => {
      m.versions[name] = "0.0.1";
    }),
    ...["cli", "openVsx", "jetbrains"].map((name) => (m) => {
      m.releaseSourceCommits[name] = "e".repeat(40);
    }),
    (m, p) => {
      p.ide.jetbrains.marketplaceUploaded = false;
    },
    (m) => {
      delete m.origin;
    },
    (m) => {
      m.origin.jetbrains.runId++;
    },
    (m) => {
      m.origin.jetbrains.sourceCommit = "e".repeat(40);
    },
    (m) => {
      m.origin.jetbrains.tag = "ide-jetbrains-v0.4.190";
    },
    (m) => {
      m.publicArtifacts.jetbrains.digest = "invalid";
    },
    (m, p) => {
      p.ide.jetbrains.status = "unknown";
    },
  ];
  for (const mutate of mutations) {
    const { manifest, proof } = fixture();
    mutate(manifest, proof);
    assert.throws(
      () => verifyPublicGeneratorPairing(manifest, proof),
      mutate.toString(),
    );
  }
});

test("proof bytes are digest bound and paths cannot traverse or select other documents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-public-proof-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { manifest, proof } = fixture();
  const proofPath =
    "docs/research/cli/evidence/release138-public/publication.json";
  const file = path.join(root, proofPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(proof);
  fs.writeFileSync(file, bytes);
  manifest.publicGeneratorProof = {
    path: proofPath,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
  const result = loadPublicGeneratorProof(manifest, { repositoryRoot: root });
  assert.deepEqual(result.proof, proof);
  assert.equal(result.legacyFallback, false);
  for (const badPath of [
    "../publication.json",
    `../${proofPath}`,
    "docs/research/cli/evidence/release138-public/../publication.json",
    "C:/publication.json",
    proofPath.replaceAll("/", "\\"),
    proofPath.replace("publication", "other"),
  ]) {
    const bad = structuredClone(manifest);
    bad.publicGeneratorProof.path = badPath;
    assert.throws(() =>
      loadPublicGeneratorProof(bad, { repositoryRoot: root }),
    );
  }
  fs.appendFileSync(file, "\n");
  assert.throws(
    () => loadPublicGeneratorProof(manifest, { repositoryRoot: root }),
    /digest mismatch/,
  );
  delete manifest.publicGeneratorProof;
  assert.throws(
    () => loadPublicGeneratorProof(manifest, { repositoryRoot: root }),
    /explicit publication proof/,
  );
});

test("only old CLI136 may load its historical proof without declaration", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-public-proof-legacy-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { manifest, proof } = fixture();
  manifest.versions.cli = proof.cli.version = "0.166.136";
  proof.cli.source = proof.source;
  const file = path.join(
    root,
    "docs/research/cli/evidence/release136-public/publication.json",
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(proof));
  assert.equal(
    loadPublicGeneratorProof(manifest, { repositoryRoot: root }).legacyFallback,
    true,
  );
});
