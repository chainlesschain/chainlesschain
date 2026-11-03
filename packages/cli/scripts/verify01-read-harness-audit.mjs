/** Offline source-bound counterexamples; no provider, credentials or model calls. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ReadFileLoopGuard } from "../src/lib/read-file-loop-guard.js";
import { buildReadFilePage } from "../src/lib/read-file-page.js";
import { canProjectHostToolExcerpt } from "../src/lib/tool-result-preview.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const frozenCommit = "e2a91bf54332ff3d252c40ecc25c5887e0f0430d";
const directory = path.join(
  root,
  "docs/research/cli/verify01-openai-140-frozen-four-20261103/harness-audit-20261104",
);
const hash = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
async function frozenModule(relative) {
  const bytes = execFileSync("git", ["show", `${frozenCommit}:${relative}`], {
    cwd: root,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  // Only the pinned repository source is executable. Dependency specifiers
  // resolve to the normal local modules; this is an isolated class replay.
  const source = bytes
    .toString("utf8")
    .replace(
      /from "(\.\.?\/[^"\n]+)"/gu,
      (_match, specifier) =>
        `from ${JSON.stringify(pathToFileURL(path.resolve(root, path.dirname(relative), specifier)).href)}`,
    );
  return {
    module: await import(
      "data:text/javascript;base64," + Buffer.from(source).toString("base64")
    ),
    digest: hash(bytes),
  };
}
const legacy = await frozenModule(
  "packages/cli/src/lib/read-file-loop-guard.js",
);
const legacyPreview = await frozenModule(
  "packages/cli/src/lib/tool-result-preview.js",
);
const document = Array.from(
  { length: 40 },
  (_, i) => `line ${i + 1}: ${"x".repeat(50)}`,
).join("\n");
const visible = (page) => ({ role: "tool", content: JSON.stringify(page) });
function fixture(Guard) {
  const guard = new Guard();
  const read = (args) => {
    const request = { path: "/work/report.md", ...args };
    const info = { filePath: request.path, fileVersion: "v1", maxChars: 10000 };
    return guard.read(
      request,
      info,
      (options) => buildReadFilePage(document, options, info),
      () => {
        throw new Error("Unexpected continuation");
      },
    );
  };
  return { guard, read };
}
function exhaustedRecovery(Guard) {
  const { guard, read } = fixture(Guard);
  guard.observeVisibleMessages([]);
  const initial = read({ offset: 1, limit: 80 });
  guard.observeVisibleMessages([visible(initial)]);
  for (const offset of [1, 2, 3]) {
    const page = read({ offset, limit: 1 });
    assert.notEqual(page.contentOmitted, true);
    guard.observeVisibleMessages([visible(initial), visible(page)]);
  }
  guard.observeVisibleMessages([
    { role: "user", content: "Continue after compaction." },
  ]);
  const blocked = read({ offset: 4, limit: 1 });
  assert.equal(blocked.contentOmitted, true);
  return {
    hintOffered: Boolean(blocked.recoveryRead),
    prescribedReadAlsoOmitted: blocked.recoveryRead
      ? read(blocked.recoveryRead).contentOmitted === true
      : null,
    directsToSearch: blocked.hint.includes("search_files"),
  };
}
function repeatedRecovery(Guard) {
  const { guard, read } = fixture(Guard);
  guard.observeVisibleMessages([]);
  const initial = read({ offset: 1, limit: 1 });
  guard.observeVisibleMessages([visible(initial)]);
  const review = read({ offset: 1, limit: 1 });
  guard.observeVisibleMessages([visible(initial), visible(review)]);
  const blocked = read({ offset: 1, limit: 1 });
  assert.ok(blocked.recoveryRead);
  const recovered = read(blocked.recoveryRead);
  assert.equal(recovered.content, document);
  guard.observeVisibleMessages([visible(initial), visible(recovered)]);
  const full = read({ offset: 1, limit: 80 });
  guard.observeVisibleMessages([visible(recovered), visible(full)]);
  const again = read({ offset: 1, limit: 80 });
  return {
    firstRecoveryReturnedSource: true,
    exhaustedHintOffered: Boolean(again.recoveryRead),
    exhaustedPrescribedReadAlsoOmitted: again.recoveryRead
      ? read(again.recoveryRead).contentOmitted === true
      : null,
  };
}
const guardCases = {
  frozen: {
    exhausted: exhaustedRecovery(legacy.module.ReadFileLoopGuard),
    repeated: repeatedRecovery(legacy.module.ReadFileLoopGuard),
  },
  current: {
    exhausted: exhaustedRecovery(ReadFileLoopGuard),
    repeated: repeatedRecovery(ReadFileLoopGuard),
  },
};
assert.equal(guardCases.frozen.exhausted.prescribedReadAlsoOmitted, true);
assert.equal(
  guardCases.frozen.repeated.exhaustedPrescribedReadAlsoOmitted,
  true,
);
assert.equal(guardCases.current.exhausted.hintOffered, false);
assert.equal(guardCases.current.repeated.exhaustedHintOffered, false);
const candidates = [];
for (const sampleId of ["first-run-darwin-vscode", "verify-08"]) {
  const file = path.join(
    root,
    "docs/research/cli/verify01-openai-140-frozen-four-20261103/public-802c51a9f2/candidates",
    sampleId,
    "repair137-verify-08.test.js.txt",
  );
  const bytes = fs.readFileSync(file),
    source = bytes.toString("utf8");
  const before = legacyPreview.module.canProjectHostToolExcerpt(
    source,
    "read_file",
  );
  const after = canProjectHostToolExcerpt(source, "read_file");
  assert.equal(before, false);
  assert.equal(after, true);
  candidates.push({
    sampleId,
    digest: hash(bytes),
    chars: source.length,
    frozenHostProjectable: before,
    repairedHostProjectable: after,
    candidateChanged: false,
    taskAcceptanceEstablished: false,
  });
}
const sourceDigests = Object.fromEntries(
  [
    "packages/cli/src/lib/tool-result-preview.js",
    "packages/cli/src/lib/read-file-loop-guard.js",
    "packages/cli/src/lib/evolution/evidence-json-text.js",
  ].map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
);
const result = {
  schema: 1,
  checkedAt: new Date().toISOString(),
  frozenCommit,
  externalModelRequests: 0,
  frozenGuardDigest: legacy.digest,
  frozenPreviewDigest: legacyPreview.digest,
  sourceDigests,
  guardCases,
  candidates,
  scope:
    "Isolated source-bound local class and host-projection replay; not a live task retest or release gate.",
};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(directory, "offline-reproduction.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    frozenImpossibleRecoveryCases: 2,
    currentRecoveryCasesPassed: 2,
    frozenCandidatesOmitted: 2,
    repairedCandidatesProjectable: 2,
    externalModelRequests: 0,
  }),
);
