/** Read-only public package verification; never sends model inference requests. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { listZipEntries, readZipEntry } from "../../vscode-extension/scripts/verify-vsix.mjs";

net.setDefaultAutoSelectFamilyAttemptTimeout(10000);
const directory = "docs/research/cli/verify01-openai-140-frozen-four-20261103";
const plan = JSON.parse(fs.readFileSync(`${directory}/retest-plan.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(plan.packageSetPath, "utf8"));
const resolution = JSON.parse(fs.readFileSync(plan.packageResolutionPath, "utf8"));
const hash = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
assert.deepEqual(resolution.originalPackageDigests, manifest.publicArtifacts);
for (const record of Object.values(resolution.officialRuns)) {
  assert.equal(record.head_sha, plan.projectSource);
  assert.equal(record.conclusion, "success");
}
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { "cache-control": "no-cache" } });
      assert.equal(response.ok, true, `Public distribution GET failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}
const json = async (url) => JSON.parse((await get(url)).toString("utf8"));
const [cli, vscode, jetbrains] = await Promise.all([
  json("https://registry.npmjs.org/chainlesschain/latest"),
  json("https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest"),
  json("https://plugins.jetbrains.com/api/updates/1211021"),
]);
assert.equal(cli.version, plan.versions.cli);
assert.equal(vscode.version, plan.versions.vscode);
assert.equal(jetbrains.version, plan.versions.jetbrains);
assert.equal(jetbrains.approve, true);
assert.equal(jetbrains.listed, true);
const [cliBytes, vscodeBytes, jetbrainsBytes] = await Promise.all([
  get(cli.dist.tarball), get(vscode.files.download),
  get(`https://plugins.jetbrains.com/files/${jetbrains.file}`),
]);
assert.equal(hash(cliBytes), manifest.publicArtifacts.cli.digest);
assert.equal(hash(vscodeBytes), manifest.publicArtifacts.vscode.digest);
const token = process.env.GH_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true }).trim();
const official = execFileSync("gh", ["api", `repos/chainlesschain/chainlesschain/actions/artifacts/${manifest.origin.jetbrains.artifactId}/zip`], {
  windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, GH_TOKEN: token, GH_DEBUG: "" },
});
assert.equal(hash(official), manifest.origin.jetbrains.artifactDigest);
const entries = listZipEntries(official);
const match = [...entries].filter(([name]) => name.endsWith(manifest.origin.jetbrains.file));
assert.equal(match.length, 1);
const original = readZipEntry(official, match[0][1]);
assert.equal(hash(original), manifest.publicArtifacts.jetbrains.digest);
function contents(bytes) {
  return [...listZipEntries(bytes)].filter(([name]) => !name.endsWith("/")).map(([name, entry]) => ({ name, digest: hash(readZipEntry(bytes, entry)) })).sort((a, b) => a.name.localeCompare(b.name));
}
assert.deepEqual(contents(jetbrainsBytes), contents(original));
const proof = {
  schema: 1, checkedAt: new Date().toISOString(), projectSource: plan.projectSource,
  versions: plan.versions, modelRequests: 0,
  cli: { version: cli.version, digest: hash(cliBytes), latest: true, matchesOfficialArchive: true },
  vscode: { version: vscode.version, digest: hash(vscodeBytes), latest: true, matchesOfficialArchive: true },
  jetbrains: { version: jetbrains.version, updateId: jetbrains.id, approved: true, listed: true, publiclyDownloadable: true, digest: hash(jetbrainsBytes), officialArtifactDigest: hash(original), matchesOfficialPayload: true },
};
fs.writeFileSync(`${directory}/public-readback.json`, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify(proof));
