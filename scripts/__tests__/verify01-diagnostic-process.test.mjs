import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchLogged,
  requireSuccess,
  stopOwned,
  withinDeadline,
  windowsBatchInvocation,
} from "../lib/verify01-diagnostic-process.mjs";

function root(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-diagnostic-process-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("actual child preserves arguments with spaces and drains logs", async (t) => {
  const directory = root(t);
  const logFile = path.join(directory, "child.log");
  const handle = launchLogged(
    process.execPath,
    [
      "-e",
      "console.log(JSON.stringify(process.argv.slice(1)))",
      "a path with spaces",
    ],
    { logFile },
  );
  await requireSuccess(handle, Date.now() + 10000, "echo");
  assert.equal(handle.closed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(logFile, "utf8")), [
    "a path with spaces",
  ]);
});

test("deadline kills an actual long-running child and requires exit acknowledgement", async (t) => {
  const directory = root(t);
  const handle = launchLogged(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { logFile: path.join(directory, "wait.log") },
  );
  t.after(() => stopOwned(handle));
  await assert.rejects(
    requireSuccess(handle, Date.now() + 500, "hanging child"),
    /deadline exceeded/u,
  );
  assert.equal(handle.closed, true);
  assert.throws(() => process.kill(handle.child.pid, 0), { code: "ESRCH" });
});

test("nonzero exit and unavailable executable cannot become success", async (t) => {
  const directory = root(t);
  const failed = launchLogged(process.execPath, ["-e", "process.exit(7)"], {
    logFile: path.join(directory, "failed.log"),
  });
  await assert.rejects(
    requireSuccess(failed, Date.now() + 10000, "failing child"),
    /exited 7/u,
  );
  const missing = launchLogged(path.join(directory, "missing-executable"), [], {
    logFile: path.join(directory, "missing.log"),
  });
  await assert.rejects(
    requireSuccess(missing, Date.now() + 10000, "missing child"),
    { code: "ENOENT" },
  );
});

test("owned cleanup terminates an actual descendant process", async (t) => {
  const directory = root(t);
  const pidFile = path.join(directory, "descendant.pid");
  const program = `const cp=require('node:child_process'); const fs=require('node:fs'); const c=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(process.argv[1],String(c.pid)); setInterval(()=>{},1000);`;
  const handle = launchLogged(process.execPath, ["-e", program, pidFile], {
    logFile: path.join(directory, "tree.log"),
  });
  t.after(() => stopOwned(handle));
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(pidFile)) {
    assert.ok(
      Date.now() < deadline && !handle.closed,
      "descendant did not start",
    );
    await delay(50);
  }
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  process.kill(pid, 0);
  await stopOwned(handle);
  // POSIX may briefly retain an orphan zombie until the OS reaper runs.
  let alive = true;
  while (alive && Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await delay(50);
    } catch (error) {
      assert.equal(error.code, "ESRCH");
      alive = false;
    }
  }
  assert.equal(alive, false, "owned descendant survived cleanup");
});

test("Windows batch quoting rejects expansion and command injection", () => {
  assert.deepEqual(
    windowsBatchInvocation("C:\\with space\\gradlew.bat", [
      "test",
      "-Dpath=C:\\a b",
    ]).args,
    [
      "/d",
      "/s",
      "/c",
      '""C:\\with space\\gradlew.bat" "test" "-Dpath=C:\\a b""',
    ],
  );
  for (const value of [
    "%PATH%",
    "!VAR!",
    "x&whoami",
    "x|y",
    'x"y',
    "x\ny",
    "a^b",
  ])
    assert.throws(
      () => windowsBatchInvocation("gradlew.bat", [value]),
      /Unsafe/u,
    );
});

test(
  "POSIX confirms group disappearance after leader exits and descendant ignores TERM",
  { skip: process.platform === "win32", timeout: 25000 },
  async (t) => {
    const directory = root(t);
    const pidFile = path.join(directory, "orphan.pid");
    const descendant = `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send(process.pid);`;
    const leader = `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e',process.argv[2]],{stdio:['ignore','ignore','ignore','ipc']});c.once('message',pid=>{fs.writeFileSync(process.argv[1],String(pid));c.disconnect();c.unref();process.exit(0)});`;
    const handle = launchLogged(
      process.execPath,
      ["-e", leader, pidFile, descendant],
      {
        logFile: path.join(directory, "departed-leader.log"),
      },
    );
    t.after(() => stopOwned(handle));
    assert.deepEqual(
      await withinDeadline(handle.done, Date.now() + 10000, "leader exit"),
      { code: 0, signal: null },
    );
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    process.kill(pid, 0);
    process.kill(-handle.child.pid, 0);
    await stopOwned(handle, { requireRunningOwner: true });
    assert.throws(() => process.kill(-handle.child.pid, 0), { code: "ESRCH" });
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(handle.cleanupConfirmed, true);
    // A later finally must not signal a numeric group ID after releasing it.
    await stopOwned(handle, { requireRunningOwner: true });
  },
);

test(
  "Windows refuses long-host cleanup after its owner exits with a live descendant",
  { skip: process.platform !== "win32", timeout: 20000 },
  async (t) => {
    const directory = root(t);
    const pidFile = path.join(directory, "orphan.pid");
    const stopFile = path.join(directory, "stop-fixture");
    const descendant = `const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},50);setTimeout(()=>process.exit(0),15000);process.send(process.pid);`;
    const leader = `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e',process.argv[3],process.argv[2]],{windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc']});c.once('message',pid=>{fs.writeFileSync(process.argv[1],String(pid));c.disconnect();c.unref();process.exit(0)});`;
    const handle = launchLogged(
      process.execPath,
      ["-e", leader, pidFile, stopFile, descendant],
      {
        logFile: path.join(directory, "departed-leader.log"),
      },
    );
    try {
      await withinDeadline(handle.done, Date.now() + 10000, "leader exit");
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      process.kill(pid, 0);
      await assert.rejects(stopOwned(handle, { requireRunningOwner: true }), {
        code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED",
      });
      assert.notEqual(handle.cleanupConfirmed, true);
      process.kill(pid, 0); // Refusal is not fabricated cleanup.
      // The test peer has its own cooperative shutdown channel; production
      // cleanup must not infer durable ownership from this recorded PID.
      fs.writeFileSync(stopFile, "stop");
      const deadline = Date.now() + 5000;
      while (true) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          assert.equal(error.code, "ESRCH");
          break;
        }
        assert.ok(
          Date.now() < deadline,
          "fixture did not acknowledge shutdown",
        );
        await delay(50);
      }
    } finally {
      fs.writeFileSync(stopFile, "stop");
    }
  },
);

test(
  "actual Windows batch command handles spaced paths",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = root(t);
    const command = path.join(directory, "with space.cmd");
    fs.writeFileSync(command, "@echo off\r\necho %~1\r\n");
    const logFile = path.join(directory, "batch.log");
    await requireSuccess(
      launchLogged(command, ["hello world"], { logFile }),
      Date.now() + 10000,
      "batch",
    );
    assert.equal(fs.readFileSync(logFile, "utf8").trim(), "hello world");
  },
);
