import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { adapterArgv } from "./verify01-native-task-adapter.mjs";

function run(t, body, capture = {}, preload = "", reviewChanges = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-stderr-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, "cli.cjs");
  const adapter = path.join(root, "adapter.cjs");
  const captureDir = path.join(root, "diagnostics");
  fs.writeFileSync(cli, body);
  fs.writeFileSync(
    adapter,
    preload +
      adapterArgv(
        cli,
        capture === null ? undefined : { captureDir, ...capture },
        { reviewChanges },
      ),
  );
  const result = spawnSync(
    process.execPath,
    [adapter, "agent", "--test-arg", "kept"],
    {
      input: "real stdin\n",
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, VOLCENGINE_API_KEY: "cross-chunk-secret-value" },
    },
  );
  assert.ifError(result.error);
  const files = fs.existsSync(captureDir) ? fs.readdirSync(captureDir) : [];
  const metaFile = files.find((name) => name.endsWith(".json"));
  const textFile = files.find((name) => name.endsWith(".txt"));
  const bytes = textFile
    ? fs.readFileSync(path.join(captureDir, textFile))
    : Buffer.alloc(0);
  const metadata = metaFile
    ? JSON.parse(fs.readFileSync(path.join(captureDir, metaFile), "utf8"))
    : null;
  if (metadata) {
    assert.equal(metadata.bytesStored, bytes.length);
    assert.equal(
      metadata.redactedDigest,
      "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    );
    assert.ok(!JSON.stringify(metadata).includes("cross-chunk-secret-value"));
  }
  return { ...result, metadata, text: bytes.toString("utf8") };
}

const echo = `const fs=require('node:fs');process.stdout.write(JSON.stringify({args:process.argv.slice(2),stdin:fs.readFileSync(0,'utf8'),worklog:process.env.CC_TASK_WORKLOG}));process.exitCode=7;`;

test("review opt-in survives both plain and stderr capture wrappers without changing limits", (t) => {
  for (const capture of [null, {}]) {
    const plain = run(t, echo, capture);
    const reviewed = run(t, echo, capture, "", true);
    const baseline = JSON.parse(plain.stdout);
    const output = JSON.parse(reviewed.stdout);
    assert.equal(reviewed.status, plain.status);
    assert.ok(!baseline.args.includes("--review-changes"));
    assert.deepEqual(
      output.args.filter((arg) => arg !== "--review-changes"),
      baseline.args,
    );
    assert.equal(
      output.args.filter((arg) => arg === "--review-changes").length,
      1,
    );
    assert.equal(output.stdin, baseline.stdin);
    assert.equal(output.worklog, "0");
  }
  assert.throws(() =>
    adapterArgv("unused", undefined, { reviewChanges: "true" }),
  );
});

test("optional capture preserves stdout, stdin, tool arguments and nonzero exit", (t) => {
  const plain = run(t, echo, null);
  const observed = run(t, echo);
  assert.equal(observed.stdout, plain.stdout);
  assert.equal(observed.status, 7);
  assert.equal(plain.status, 7);
  assert.equal(plain.metadata, null);
  const output = JSON.parse(observed.stdout);
  assert.equal(output.stdin, "real stdin\n");
  assert.equal(output.worklog, "0");
  assert.deepEqual(output.args.slice(0, 3), ["agent", "--test-arg", "kept"]);
  assert.equal(output.args.at(-1), "20");
  assert.equal(observed.metadata.childExitCode, 7);
});

test("stderr forwarding stays byte exact while split secrets and UTF-8 are captured safely", (t) => {
  const body = `const b=Buffer.from('开始 cross-chunk-secret-value 结束\\nlast cross-chunk-secret-value');let i=0;const timer=setInterval(()=>{if(i<b.length)process.stderr.write(b.subarray(i,i+=1));else clearInterval(timer);},1);process.exitCode=9;`;
  const result = run(t, body);
  assert.equal(result.status, 9);
  assert.equal(
    result.stderr,
    "开始 cross-chunk-secret-value 结束\nlast cross-chunk-secret-value",
  );
  assert.equal(result.text, "开始 [REDACTED] 结束\nlast [REDACTED]");
  assert.equal(result.metadata.bytesObserved, Buffer.byteLength(result.stderr));
  assert.equal(result.metadata.raw, false);
  assert.deepEqual(result.metadata.captureErrors, []);
});

test("byte cap keeps whole UTF-8 lines and continues forwarding all stderr", (t) => {
  const result = run(
    t,
    "process.stderr.write('中文\\n'.repeat(10000));process.exitCode=3",
    { maxBytes: 15 },
  );
  assert.equal(result.status, 3);
  assert.equal(result.stderr, "中文\n".repeat(10000));
  assert.equal(result.text, "中文\n".repeat(2));
  assert.equal(result.metadata.truncated, true);
  assert.equal(result.metadata.bytesObserved, 70000);
});

test("overlong unfinished line is omitted entirely, including partial secrets", (t) => {
  const result = run(
    t,
    "process.stderr.write('cross-chunk-secret-value'.repeat(1000));process.exitCode=4",
    { maxLineBytes: 16 },
  );
  assert.equal(result.status, 4);
  assert.equal(result.stderr, "cross-chunk-secret-value".repeat(1000));
  assert.equal(result.text, "");
  assert.equal(result.metadata.omittedLines, 1);
  assert.equal(result.metadata.truncated, true);
});

test("diagnostic write failure is recorded without changing CLI stderr/stdout/exit", (t) => {
  const preload = `const fs=require('node:fs'),originalWrite=fs.writeSync;let failed=false;fs.writeSync=(...args)=>{if(failed)return originalWrite(...args);failed=true;const e=new Error('sensitive details');e.code='ENOSPC';throw e;};`;
  const result = run(
    t,
    "process.stderr.write('observed\\n');process.stdout.write('answer');process.exitCode=12",
    {},
    preload,
  );
  assert.equal(result.status, 12);
  assert.equal(result.stdout, "answer");
  assert.equal(result.stderr, "observed\n");
  assert.equal(result.text, "");
  assert.deepEqual(result.metadata.captureErrors, [
    { stage: "write", code: "ENOSPC" },
  ]);
});

test("unwritable diagnostic location cannot turn CLI failure into success", (t) => {
  const result = run(t, "process.stderr.write('failure');process.exitCode=13", {
    captureDir: process.execPath,
  });
  assert.equal(result.status, 13);
  assert.equal(result.stderr, "failure");
  assert.equal(result.metadata, null);
});

test("overlong lines do not suppress subsequent bounded diagnostics", (t) => {
  const result = run(t, "process.stderr.write('x'.repeat(100)+'\\n原因\\n')", {
    maxLineBytes: 16,
  });
  assert.equal(result.status, 0);
  assert.equal(result.text, "原因\n");
  assert.equal(result.metadata.omittedLines, 1);
  assert.equal(result.metadata.truncated, true);
});

test("partial UTF-8 diagnostic write is discarded on failure", (t) => {
  const preload = `const fs=require('node:fs'),originalWrite=fs.writeSync;let calls=0;fs.writeSync=(...args)=>{calls++;if(calls===1){args[3]=1;return originalWrite(...args);}if(calls===2){const e=new Error('write failed');e.code='ENOSPC';throw e;}return originalWrite(...args);};`;
  const result = run(
    t,
    "process.stderr.write('中文\\n');process.exitCode=15",
    {},
    preload,
  );
  assert.equal(result.status, 15);
  assert.equal(result.stderr, "中文\n");
  assert.equal(result.text, "");
  assert.deepEqual(result.metadata.captureErrors, [
    { stage: "write", code: "ENOSPC" },
  ]);
});
