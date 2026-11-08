import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
function identity(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}
function check(base, row) {
  const file = path.resolve(base, row.path);
  if (!file.startsWith(base + path.sep)) throw new Error("Evidence path escaped its root");
  const actual = identity(file);
  if (actual.bytes !== row.bytes || actual.sha256 !== row.sha256) throw new Error("Identity mismatch: " + row.path);
}
for (const artifact of manifest.artifacts) check(directory, artifact);
const state = JSON.parse(fs.readFileSync(path.join(directory, "real-smoke-state.json"), "utf8").replace(/^\uFEFF/, ""));
if (state.smokeExitCode !== 0 || state.launcherExitCode !== 0 || state.sourceIdentityMatch !== true) throw new Error("Smoke did not succeed");
for (const source of manifest.executablesMatchedToSmoke) {
  for (const collection of [state.sourceBefore, state.sourceAfter]) {
    const measured = collection.find((item) => item.path === source.path);
    if (!measured || measured.sha256 !== source.sha256 || measured.bytes !== source.bytes) throw new Error("Smoke/source identity mismatch");
  }
}
if (process.argv.includes("--check-current-sources")) {
  for (const source of manifest.currentSources) check(repository, source);
}
console.log(JSON.stringify({ verified: true, artifacts: manifest.artifacts.length,
  executableSourceMatches: manifest.executablesMatchedToSmoke.length,
  currentSourcesChecked: process.argv.includes("--check-current-sources"),
  realSmokePassed: true, fullQualityAccepted: false, performanceAccepted: false }));
