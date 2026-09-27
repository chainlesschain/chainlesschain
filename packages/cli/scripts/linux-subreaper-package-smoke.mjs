#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const [rootFlag, packageRoot, commitFlag, commit, noCompiler, ...extra] =
  process.argv.slice(2);
assert.equal(rootFlag, "--package-root");
assert.equal(commitFlag, "--commit");
assert.match(commit, /^[a-f0-9]{40}$/);
assert.equal(extra.length, 0);
assert.ok(noCompiler === undefined || noCompiler === "--require-no-compiler");
assert.equal(process.platform, "linux");
const compilerPaths = ["/usr/bin", "/bin", "/usr/local/bin"].flatMap((dir) =>
  ["cc", "gcc", "clang"].map((name) => path.join(dir, name)),
);
const observedCompilers = compilerPaths.filter((file) => fs.existsSync(file));
if (noCompiler)
  assert.deepEqual(
    observedCompilers,
    [],
    "no-compiler acceptance requires an image without a compiler",
  );
const moduleRoot = path.join(
  path.resolve(packageRoot),
  "src/lib/process-execution-broker",
);
const { acquireLinuxSubreaperHelper } = await import(
  pathToFileURL(path.join(moduleRoot, "linux-subreaper-helper.js"))
);
const { spawnLinuxSubreaperChild } = await import(
  pathToFileURL(path.join(moduleRoot, "linux-subreaper-process.js"))
);
const { validateLinuxSubreaperArtifact } = await import(
  pathToFileURL(path.join(moduleRoot, "linux-subreaper-artifact.js"))
);
const payload = path.join(
  packageRoot,
  "src/assets/linux-subreaper",
  `linux-${process.arch}`,
);
const manifest = validateLinuxSubreaperArtifact(
  fs.readFileSync(path.join(payload, "manifest.json")),
  fs.readFileSync(path.join(payload, "supervisor")),
  { arch: process.arch, commit },
);
let compilerCalls = 0;
const helper = acquireLinuxSubreaperHelper({
  spawnSync() {
    compilerCalls++;
    throw new Error("runtime compilation is forbidden in packaged smoke");
  },
});
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-packaged-subreaper-smoke-"),
);
const fixture = path.join(root, "tree.cjs");
fs.writeFileSync(
  fixture,
  `
  const {spawn}=require('node:child_process');
  process.on('SIGTERM',()=>{}); setTimeout(()=>process.exit(0),5000);
  if(process.argv[2]==='leaf') process.send({pid:process.pid});
  else {
    const leaf=spawn(process.execPath,[__filename,'leaf'],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
    leaf.once('message',({pid})=>process.stdout.write(JSON.stringify([process.pid,pid])+'\\n'));
  }
`,
);
let child;
let deadline;
try {
  child = spawnLinuxSubreaperChild(
    process.execPath,
    [fixture],
    { helper, cwd: root, env: {}, graceMs: 100 },
    { spawn },
  );
  const errors = [];
  child.on("error", (error) => errors.push(error.code));
  child.stderr.resume();
  let output = "";
  let pids;
  let readyAt;
  let closed = false;
  child.once("close", () => {
    closed = true;
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!pids && output.includes("\n")) {
      pids = JSON.parse(output.trim());
      readyAt = performance.now();
      child.kill("SIGTERM");
      child.kill("SIGTERM");
    }
  });
  const receipt = await Promise.race([
    child.ownedProcessTreeClosed,
    new Promise((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("packaged helper smoke timed out")),
        8000,
      );
    }),
  ]);
  const elapsedAfterReadyMs = performance.now() - readyAt;
  assert.deepEqual(errors, []);
  assert.equal(closed, true);
  assert.equal(pids?.length, 2);
  assert.ok(elapsedAfterReadyMs < 2000);
  assert.equal(receipt.cleanup.confirmed, true);
  assert.equal(receipt.cleanup.reaped, 2);
  assert.equal(receipt.helper.distribution, "packaged-static");
  assert.equal(receipt.helper.imageDigest, manifest.imageDigest);
  assert.equal(receipt.helper.binding, "unlinked-inherited-fd");
  for (const pid of pids) assert.equal(fs.existsSync(`/proc/${pid}`), false);
  assert.equal(compilerCalls, 0);
  process.stdout.write(
    JSON.stringify({
      schema: "chainlesschain.linux-subreaper-package-smoke/v1",
      commit,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      compilerAbsent: observedCompilers.length === 0,
      compilerCalls,
      manifest,
      receipt,
      pids,
      elapsedAfterReadyMs,
    }) + "\n",
  );
} finally {
  clearTimeout(deadline);
  child?.kill("SIGKILL");
  fs.rmSync(root, { recursive: true, force: true });
}
