import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const script = path.join(
  repository,
  "packages/cli/scripts/review-model-catalog.mjs",
);
const reviewPath = path.join(
  repository,
  "packages/cli/__tests__/fixtures/model-catalog-review-2026-10-05.json",
);
const sha = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function capture(t, args = [], snapshots = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-model-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "result.json");
  const flags = [];
  for (const [name, bytes] of Object.entries(snapshots)) {
    const file = path.join(root, name);
    fs.writeFileSync(file, bytes);
    flags.push(`--${name}`, file);
  }
  const result = spawnSync(
    process.execPath,
    [script, "--output", output, ...flags, ...args],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.ifError(result.error);
  return {
    ...result,
    root,
    output,
    evidence: fs.existsSync(output)
      ? JSON.parse(fs.readFileSync(output, "utf8"))
      : null,
  };
}

test("local review binds source and fixture bytes without claiming upstream/account validation", (t) => {
  const result = capture(t, ["--expected-sha", sha]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.evidence.source.commit, sha);
  assert.equal(result.evidence.source.installedProductVerified, false);
  assert.equal(
    result.evidence.inputs.review.digest,
    hash(fs.readFileSync(reviewPath)),
  );
  assert.equal(result.evidence.upstreamSnapshotsComplete, false);
  assert.equal(result.evidence.reviewCompleted, true);
  for (const field of [
    "providerAssessed",
    "billingVerified",
    "productionAttested",
  ])
    assert.equal(result.evidence[field], false);
  for (const file of result.evidence.source.files)
    assert.equal(
      file.digest,
      hash(fs.readFileSync(path.join(repository, file.path))),
    );
});

test("drift remains a failed gate while preserving the original BOM/CRLF byte binding", (t) => {
  const codex = Buffer.from("\uFEFF<h2>Codex CLI 0.160.1</h2>\r\n");
  const claude = Buffer.from("## 2.1.289\r\n");
  const result = capture(t, ["--fail-on-drift"], { codex, claude });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.evidence.reviewCompleted, true);
  assert.equal(result.evidence.upstreamSnapshotsComplete, true);
  assert.equal(result.evidence.inputs.codex.digest, hash(codex));
  assert.equal(result.evidence.result.reviewRequired, true);
  assert.equal(result.evidence.result.automaticEnablement, false);
});

test("partial upstream capture is explicitly incomplete", (t) => {
  const result = capture(t, [], { codex: "<h2>Codex CLI 0.160.0</h2>" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.evidence.upstreamSnapshotsComplete, false);
  assert.equal(result.evidence.result.upstream.length, 1);
});

test("stable official GitHub JSON drift preserves raw bytes and completes review without enabling models", (t) => {
  const codex = Buffer.from(
    JSON.stringify({
      tag_name: "rust-v0.160.1",
      html_url: "https://github.com/openai/codex/releases/tag/rust-v0.160.1",
      draft: false,
      prerelease: false,
      published_at: "2026-10-09T00:00:00Z",
    }) + "\r\n",
  );
  const result = capture(t, ["--fail-on-drift"], {
    codex,
    claude: '<Update label="2.1.295">notes</Update>',
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.evidence.reviewCompleted, true);
  assert.equal(result.evidence.upstreamSnapshotsComplete, true);
  assert.equal(result.evidence.inputs.codex.digest, hash(codex));
  assert.equal(result.evidence.inputs.codex.bytes, codex.length);
  assert.equal(result.evidence.result.upstream[0].observedVersion, "0.160.1");
  assert.equal(result.evidence.result.automaticEnablement, false);
});

test("wrong-repository release JSON remains a saved failed observation", (t) => {
  const codex = JSON.stringify({
    tag_name: "rust-v0.160.1",
    html_url: "https://github.com/other/codex/releases/tag/rust-v0.160.1",
    draft: false,
    prerelease: false,
  });
  const result = capture(t, ["--fail-on-drift"], { codex });
  assert.equal(result.status, 1);
  assert.equal(result.evidence.reviewCompleted, false);
  assert.equal(result.evidence.result, null);
  assert.equal(result.evidence.inputs.codex.digest, hash(codex));
});

test("an upstream error page retains its bytes but cannot become completed review evidence", (t) => {
  const result = capture(t, [], { codex: "Rate limit exceeded" });
  assert.equal(result.status, 1);
  assert.equal(result.evidence.reviewCompleted, false);
  assert.equal(result.evidence.result, null);
  assert.match(result.evidence.error, /Cannot identify/);
  assert.equal(
    result.evidence.inputs.codex.digest,
    hash("Rate limit exceeded"),
  );
});

test("a changed source pin fails before writing evidence", (t) => {
  const result = capture(t, ["--expected-sha", "0".repeat(40)]);
  assert.equal(result.status, 1);
  assert.equal(result.evidence, null);
  assert.match(result.stderr, /source differs/);
});

test("oversized upstream data is rejected instead of partially hashed", (t) => {
  const result = capture(t, [], {
    claude: Buffer.alloc(16 * 1024 * 1024 + 1, 32),
  });
  assert.equal(result.status, 1);
  assert.equal(result.evidence, null);
  assert.match(result.stderr, /16 MiB/);
});

test("report output cannot overwrite an existing evidence file", (t) => {
  const first = capture(t);
  const original = fs.readFileSync(first.output);
  const repeated = spawnSync(
    process.execPath,
    [script, "--output", first.output],
    { encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /EEXIST/);
  assert.deepEqual(fs.readFileSync(first.output), original);
});
