import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  p110OwnedProcessRunnerTestOnly,
  runOwnedProcess,
} from "../p1-10-owned-process-runner.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("Windows outer deadline separately budgets supervisor startup and Job cleanup", () => {
  assert.equal(
    p110OwnedProcessRunnerTestOnly.outerTimeoutMs(5_000, "win32", 5_000),
    50_000,
  );
  assert.equal(
    p110OwnedProcessRunnerTestOnly.outerTimeoutMs(5_000, "linux", 5_000),
    5_000,
  );
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForFile(file, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child marker was not written");
}

test(
  "timeout immediately cleans a SIGTERM-ignoring parent and grandchild group",
  { skip: process.platform === "win32" },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-p1-10-tree-"));
    const marker = path.join(directory, "pids.json");
    try {
      const script = [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "process.on('SIGTERM',()=>{});",
        "const code=\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\";",
        "const child=spawn(process.execPath,['-e',code],{stdio:'ignore'});",
        "fs.writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,child:child.pid}));",
        "setInterval(()=>{},1000);",
      ].join("");
      const startedAt = Date.now();
      const promise = runOwnedProcess(
        process.execPath,
        ["-e", script, marker],
        {
          cwd: directory,
          env: { PATH: process.env.PATH },
          timeoutMs: 200,
          maxOutputBytes: 4096,
          platform: process.platform,
          terminationGraceMs: 100,
        },
      );
      await waitForFile(marker);
      const pids = JSON.parse(fs.readFileSync(marker, "utf8"));
      await assert.rejects(promise, /exceeded its fixed timeout/);
      assert.ok(Date.now() - startedAt < 3_000);
      assert.equal(alive(pids.parent), false);
      assert.equal(alive(pids.child), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "nominal parent exit still empties and confirms its lingering descendant group",
  { skip: process.platform === "win32" },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-p1-10-desc-"));
    const marker = path.join(directory, "pids.json");
    try {
      const script = [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "const code=\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\";",
        "const child=spawn(process.execPath,['-e',code],{stdio:'ignore'});",
        "child.unref();",
        "fs.writeFileSync(process.argv[1],JSON.stringify({child:child.pid}));",
      ].join("");
      const result = await runOwnedProcess(
        process.execPath,
        ["-e", script, marker],
        {
          cwd: directory,
          env: { PATH: process.env.PATH },
          timeoutMs: 2_000,
          maxOutputBytes: 4096,
          platform: process.platform,
          terminationGraceMs: 100,
        },
      );
      const pids = JSON.parse(fs.readFileSync(marker, "utf8"));
      assert.equal(result.processGroupEmptied, true);
      assert.equal(result.processTreeTerminated, false);
      assert.equal(alive(pids.child), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "spawn errors preserve their original cause when no PID exists",
  {
    skip: process.platform === "win32",
  },
  async () => {
    await assert.rejects(
      runOwnedProcess(path.join(os.tmpdir(), "missing-p1-10-executable"), [], {
        cwd: os.tmpdir(),
        env: {},
        timeoutMs: 500,
        maxOutputBytes: 1024,
        platform: process.platform,
        terminationGraceMs: 50,
        ...(process.platform === "win32"
          ? {
              windowsSupervisorPath: path.join(
                repoRoot,
                "scripts/p1-10-windows-job-supervisor.ps1",
              ),
            }
          : {}),
      }),
      /ENOENT|not found|cannot find/i,
    );
  },
);

test("Windows supervisor terminates an unassigned suspended process on assign failure", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts/p1-10-windows-job-supervisor.ps1"),
    "utf8",
  );
  for (const contract of [
    "TerminateProcess",
    "bool processCreated",
    "bool jobAssigned",
    "AssignProcessToJobObject",
    "WaitForSingleObject",
    "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
  ]) {
    assert.ok(source.includes(contract), contract);
  }
  assert.match(
    source,
    /if \(processCreated && !jobAssigned[\s\S]*TerminateProcess/u,
  );
});

test(
  "Windows Job Object empties a nominal parent's lingering descendant",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-p1-10-winjob-"),
    );
    const marker = path.join(directory, "pids.json");
    try {
      const script = [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
        "child.unref();",
        "fs.writeFileSync(process.argv[1],JSON.stringify({child:child.pid}));",
      ].join("");
      const result = await runOwnedProcess(
        process.execPath,
        ["-e", script, marker],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
          },
          timeoutMs: 10_000,
          maxOutputBytes: 4096,
          platform: "win32",
          terminationGraceMs: 5_000,
          windowsSupervisorPath: path.join(
            repoRoot,
            "scripts/p1-10-windows-job-supervisor.ps1",
          ),
        },
      );
      const pids = JSON.parse(fs.readFileSync(marker, "utf8"));
      assert.equal(result.containment, "windows-job-object");
      assert.equal(result.processTreeTerminated, true);
      assert.equal(result.processGroupEmptied, true);
      assert.equal(alive(pids.child), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "Windows Job Object timeout propagates failure after terminating its target",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-p1-10-wintimeout-"),
    );
    const marker = path.join(directory, "pid.json");
    try {
      const script = [
        "const fs=require('node:fs');",
        "fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));",
        "setInterval(()=>{},1000);",
      ].join("");
      const promise = runOwnedProcess(
        process.execPath,
        ["-e", script, marker],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
          },
          timeoutMs: 5_000,
          maxOutputBytes: 4096,
          platform: "win32",
          terminationGraceMs: 5_000,
          windowsSupervisorPath: path.join(
            repoRoot,
            "scripts/p1-10-windows-job-supervisor.ps1",
          ),
        },
      );
      const observedError = promise.catch((error) => error);
      await waitForFile(marker, 3_000);
      const pid = JSON.parse(fs.readFileSync(marker, "utf8")).pid;
      const error = await observedError;
      assert.ok(error instanceof Error);
      assert.match(error.message, /failed with code 124/);
      assert.equal(alive(pid), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
