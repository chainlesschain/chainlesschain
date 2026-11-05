import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const yaml = require("yaml");
const workflow = yaml.parse(
  fs.readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  ),
);
const steps = workflow.jobs["verify-cli-release"].steps;
const restoreName = "Restore exact product source before IDE verification";
const restore = steps.find((step) => step.name === restoreName);
const script = restore?.run.match(/^node <<'NODE'\n([\s\S]+)\nNODE\s*$/)?.[1];

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-product-checkout-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const emptyConfig = path.join(directory, "empty-global-config");
  fs.writeFileSync(emptyConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Product checkout test",
    GIT_AUTHOR_EMAIL: "product-test@example.invalid",
    GIT_COMMITTER_NAME: "Product checkout test",
    GIT_COMMITTER_EMAIL: "product-test@example.invalid",
  };
  const git = (...args) =>
    execFileSync("git", ["-c", "core.longpaths=true", ...args], {
      cwd: directory,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  const file = path.join(directory, "ide.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ recommendedCliVersion: "0.166.121" }),
  );
  git("add", "ide.json");
  git(
    "commit",
    "--quiet",
    "-m",
    "published CLI source with earlier IDE pairing",
  );
  const cliSha = git("rev-parse", "HEAD");
  fs.writeFileSync(
    file,
    JSON.stringify({ recommendedCliVersion: "0.166.123" }),
  );
  git("add", "ide.json");
  git(
    "commit",
    "--quiet",
    "-m",
    "product source consuming newly released IDEs",
  );
  const productSha = git("rev-parse", "HEAD");
  git("checkout", "--detach", cliSha);
  return { directory, env, git, file, cliSha, productSha };
}

test("restores product identity between the CLI exact-SHA gate and IDE prerequisite checks", () => {
  assert.ok(script, "restore step must execute the tested inline Node program");
  const gate = steps.findIndex(
    (step) =>
      step.name === "Verify registry, tag, provenance, and exact-SHA gates",
  );
  const restoreIndex = steps.findIndex((step) => step.name === restoreName);
  const ide = steps.findIndex(
    (step) =>
      step.name ===
      "Require public paired IDE releases before mobile and PC builds",
  );
  assert.ok(gate >= 0 && gate < restoreIndex && restoreIndex < ide);
  assert.match(steps[gate].run, /git checkout --detach "\$TAG_SHA"/);
  assert.match(steps[gate].run, /GITHUB_SHA="\$TAG_SHA"/);
  assert.match(
    steps[gate].run,
    /git diff --quiet "\$TAG_SHA" "\$GITHUB_SHA" -- packages\/cli /,
  );
  assert.doesNotMatch(steps[gate].run, /:\(exclude\)|:!/);
  assert.deepEqual(workflow.jobs["publish-deps"].needs, ["verify-cli-release"]);
  for (const platform of ["windows", "macos", "linux", "android", "ios"])
    assert.deepEqual(workflow.jobs[`build-${platform}`].needs, [
      "publish-deps",
    ]);
});

test("real detached checkout reads the product IDE pairing after verifying the earlier CLI source", (t) => {
  const f = fixture(t);
  assert.equal(
    JSON.parse(fs.readFileSync(f.file, "utf8")).recommendedCliVersion,
    "0.166.121",
  );
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: f.directory,
    env: { ...f.env, GITHUB_SHA: f.productSha },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git("rev-parse", "HEAD"), f.productSha);
  assert.equal(
    JSON.parse(fs.readFileSync(f.file, "utf8")).recommendedCliVersion,
    "0.166.123",
  );
});

for (const rejected of ["main", "--help", "f".repeat(40)]) {
  test(`rejects an invalid or missing immutable product source: ${rejected}`, (t) => {
    const f = fixture(t);
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: f.directory,
      env: { ...f.env, GITHUB_SHA: rejected },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(f.git("rev-parse", "HEAD"), f.cliSha);
    assert.equal(
      JSON.parse(fs.readFileSync(f.file, "utf8")).recommendedCliVersion,
      "0.166.121",
    );
  });
}
