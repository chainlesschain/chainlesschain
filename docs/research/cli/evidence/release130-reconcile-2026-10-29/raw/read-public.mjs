import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = ".work/release130-reconcile";
const evidence = "docs/research/cli/evidence/release130-public";
const sha = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
async function get(url, file, limit = 2 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > limit) throw new Error("Public response exceeds its bound");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  fs.writeFileSync(path.join(root, file), bytes, { flag: "wx" });
  return { bytes, receipt: { url, finalUrl: response.url, status: response.status, bytes: bytes.length, sha256: sha(bytes), file } };
}
const results = await Promise.all([
  get("https://registry.npmjs.org/chainlesschain/0.166.130", "cli-metadata.json"),
  get("https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.168", "open-vsx-metadata.json"),
  get("https://plugins.jetbrains.com/api/plugins/32208/updates?size=100", "jetbrains-updates.json"),
]);
const [cli, vscode, jetbrains] = results.map(result => JSON.parse(result.bytes));
assert.equal(cli.name, "chainlesschain");
assert.equal(cli.version, "0.166.130");
assert.equal(vscode.version, "0.37.168");
const update = jetbrains.find(value => value.id === 1205656);
assert.ok(update && update.version === "0.4.185" && update.approve === true && update.listed === true && update.hidden === false);
const cliEvidence = JSON.parse(fs.readFileSync(path.join(evidence, "cli.json"), "utf8"));
const vsEvidence = JSON.parse(fs.readFileSync(path.join(evidence, "open-vsx.json"), "utf8"));
const jbEvidence = JSON.parse(fs.readFileSync(path.join(evidence, "jetbrains.json"), "utf8"));
const downloads = await Promise.all([
  get(cli.dist.tarball, "chainlesschain-0.166.130.tgz", 32 * 1024 * 1024),
  get(vsEvidence.downloadUrl, "chainlesschain-0.37.168.vsix", 16 * 1024 * 1024),
  get(jbEvidence.downloadUrl, "chainlesschain-0.4.185.zip", 16 * 1024 * 1024),
]);
assert.equal(sha(downloads[0].bytes), cliEvidence.manifest.sha256);
assert.equal(`sha512:${sha(downloads[0].bytes, "sha512")}`, `sha512:${cliEvidence.manifest.sha512}`);
assert.equal(`sha512-${sha(downloads[0].bytes, "sha512", "base64")}`, cli.dist.integrity);
assert.equal(sha(downloads[1].bytes), vsEvidence.registryArchiveSha256);
assert.equal(sha(downloads[2].bytes), jbEvidence.publicSha256);
const runIds = [40746844892, 40746845171, 40798105505, 40799988792, 40800404921, 40800404557];
const runs = [];
for (const id of runIds) {
  const run = spawnSync("gh", ["api", `repos/chainlesschain/chainlesschain/actions/runs/${id}`], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(path.join(root, `run-${id}.json`), run.stdout || "");
  if (run.status !== 0) throw new Error(`Run ${id} read failed: ${run.stderr}`);
  const value = JSON.parse(run.stdout);
  assert.equal(value.head_sha, "f3015e799624b81af564aaaa1b7701c0a5c70e26");
  assert.equal(value.conclusion, "success");
  runs.push({ id, source: value.head_sha, conclusion: value.conclusion, htmlUrl: value.html_url });
}
const receipt = { observedAt: new Date().toISOString(), source: "f3015e799624b81af564aaaa1b7701c0a5c70e26", publicVersions: { cli: cli.version, vscode: vscode.version, jetbrains: update.version }, metadata: results.map(result => result.receipt), downloads: downloads.map(result => result.receipt), npmIntegrityMatches: true, bytesMatchExistingReceipts: true, runs, boundary: "Fresh public bytes and workflow states; original signed provenance and package-entry inspection remain in release130-public evidence." };
fs.writeFileSync(path.join(root, "readback.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ publicVersions: receipt.publicVersions, source: receipt.source, bytesMatch: true, gates: runs.length }));
