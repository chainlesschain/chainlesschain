import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  launchLogged,
  captureOwnedProcessTree,
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
  if (process.platform === "win32") {
    const evidence = JSON.parse(
      fs.readFileSync(`${handle.logFile}.cleanup.json`, "utf8"),
    );
    assert.equal(evidence.confirmed, true);
    assert.ok(evidence.owned.some((entry) => entry.pid === handle.child.pid));
    assert.ok(evidence.owned.some((entry) => entry.pid === pid));
    assert.deepEqual(evidence.remaining, []);
    assert.equal(typeof evidence.taskkill.stdout, "string");
    assert.equal(typeof evidence.taskkill.stderr, "string");
    assert.equal(evidence.taskkill.displayEncoding, "utf8-lossy");
    for (const stream of ["stdout", "stderr"]) {
      assert.equal(
        Buffer.from(evidence.taskkill[`${stream}Base64`], "base64").toString(
          "utf8",
        ),
        evidence.taskkill[stream],
      );
    }
  }
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
  "POSIX transient EPERM probe retains ownership until actual disappearance",
  { skip: process.platform === "win32", timeout: 15000 },
  async (t) => {
    const directory = root(t);
    const handle = launchLogged(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { logFile: path.join(directory, "probe-denied.log") },
    );
    const nativeKill = process.kill;
    let denied = false;
    process.kill = function (pid, signal) {
      if (pid === -handle.child.pid && signal === 0 && !denied) {
        denied = true;
        throw Object.assign(new Error("transient denied group probe"), {
          code: "EPERM",
        });
      }
      return nativeKill.call(process, pid, signal);
    };
    try {
      await stopOwned(handle);
      assert.equal(denied, true);
      assert.equal(handle.cleanupConfirmed, true);
      assert.throws(() => nativeKill(-handle.child.pid, 0), { code: "ESRCH" });
    } finally {
      process.kill = nativeKill;
      if (!handle.closed) handle.child.kill("SIGKILL");
      await handle.done;
    }
  },
);

test(
  "POSIX persistent EPERM probes cannot fabricate cleanup confirmation",
  { skip: process.platform === "win32", timeout: 25000 },
  async (t) => {
    const directory = root(t);
    const readyFile = path.join(directory, "ready");
    const handle = launchLogged(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",
        readyFile,
      ],
      { logFile: path.join(directory, "probe-persistent.log") },
    );
    while (!fs.existsSync(readyFile)) await delay(25);
    const nativeKill = process.kill;
    process.kill = function (pid, signal) {
      if (pid === -handle.child.pid && signal === 0)
        throw Object.assign(new Error("persistent denied group probe"), {
          code: "EPERM",
        });
      return nativeKill.call(process, pid, signal);
    };
    try {
      await assert.rejects(stopOwned(handle), {
        code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED",
      });
      assert.notEqual(handle.cleanupConfirmed, true);
      const evidence = JSON.parse(
        fs.readFileSync(`${handle.logFile}.cleanup.json`, "utf8"),
      );
      assert.equal(evidence.confirmed, false);
      assert.deepEqual(evidence.signals, ["SIGTERM", "SIGKILL"]);
      assert.match(evidence.error, /still exists/u);
      assert.throws(() => nativeKill(-handle.child.pid, 0), { code: "ESRCH" });
    } finally {
      process.kill = nativeKill;
      if (!handle.closed) handle.child.kill("SIGKILL");
      await handle.done;
    }
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
  "Windows refuses failed termination and discovers a descendant born after the initial snapshot",
  { skip: process.platform !== "win32", timeout: 40000 },
  async (t) => {
    const directory = root(t);
    // Use an actual harmless Windows executable to inject a tool failure. The
    // process snapshots and surviving child are real; no output is treated as
    // a substitute for querying the OS.
    fs.copyFileSync(
      path.join(process.env.SystemRoot, "System32", "where.exe"),
      path.join(directory, "taskkill.exe"),
    );
    const logFile = path.join(directory, "survivor.log");
    const pidFile = path.join(directory, "late-child.pid");
    const stopFile = path.join(directory, "stop-fixture");
    const descendant = `const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},50);setTimeout(()=>process.exit(0),30000);`;
    const leader = `const cp=require('node:child_process'),fs=require('node:fs');let started=false;setInterval(()=>{if(fs.existsSync(process.argv[3]))process.exit(0);if(!started&&fs.existsSync(process.argv[1])){started=true;const c=cp.spawn(process.execPath,['-e',process.argv[4],process.argv[3]],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[2],String(c.pid))}},25);setTimeout(()=>process.exit(0),30000);`;
    const handle = launchLogged(
      process.execPath,
      ["-e", leader, `${logFile}.cleanup.json`, pidFile, stopFile, descendant],
      { logFile },
    );
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${directory}${path.delimiter}${originalPath}`;
      await assert.rejects(stopOwned(handle, { requireRunningOwner: true }), {
        code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED",
      });
      process.kill(handle.child.pid, 0);
      const evidence = JSON.parse(
        fs.readFileSync(`${handle.logFile}.cleanup.json`, "utf8"),
      );
      assert.equal(evidence.confirmed, false);
      assert.notEqual(evidence.taskkill.status, 0);
      assert.equal(typeof evidence.taskkill.stderr, "string");
      assert.equal(typeof evidence.taskkill.stdout, "string");
      assert.ok(
        evidence.remaining.some((entry) => entry.pid === handle.child.pid),
      );
      const latePid = Number(fs.readFileSync(pidFile, "utf8"));
      process.kill(latePid, 0);
      assert.ok(evidence.remaining.some((entry) => entry.pid === latePid));
    } finally {
      process.env.PATH = originalPath;
      fs.writeFileSync(stopFile, "stop");
      await withinDeadline(handle.done, Date.now() + 10000, "fixture shutdown");
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

test(
  "graceful request waits for an actual child tree to exit normally",
  { timeout: 30000 },
  async (t) => {
    const directory = root(t);
    const stopFile = path.join(directory, "stop");
    const pidFile = path.join(directory, "child.pid");
    const descendant = `const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},25);`;
    const leader = `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e',process.argv[3],process.argv[1]],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[2],String(c.pid));c.once('exit',()=>process.exit(0));`;
    const handle = launchLogged(
      process.execPath,
      ["-e", leader, stopFile, pidFile, descendant],
      { logFile: path.join(directory, "graceful.log") },
    );
    t.after(() => stopOwned(handle));
    while (!fs.existsSync(pidFile)) await delay(25);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    captureOwnedProcessTree(handle);
    await stopOwned(handle, {
      requireRunningOwner: true,
      gracefulDeadline: Date.now() + 15000,
      gracefulStop: async () => {
        fs.writeFileSync(stopFile, "stop");
      },
    });
    assert.deepEqual(await handle.done, { code: 0, signal: null });
    assert.equal(handle.cleanupConfirmed, true);
    assert.equal(handle.cleanupEvidence.graceful.acknowledged, true);
    const saved = JSON.parse(
      fs.readFileSync(`${handle.logFile}.cleanup.json`, "utf8"),
    );
    assert.equal(saved.confirmed, true);
    assert.equal(saved.graceful.acknowledged, true);
    assert.deepEqual(saved.ownerExit, { code: 0, signal: null });
    if (process.platform !== "win32") {
      assert.equal(saved.groupPid, handle.child.pid);
      assert.deepEqual(saved.signals, []);
    }
    if (process.platform === "win32")
      assert.equal(handle.cleanupEvidence.taskkill, null);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);

test(
  "an acknowledged graceful request is not proof of exit and falls back to termination",
  { timeout: 30000 },
  async (t) => {
    const directory = root(t);
    const handle = launchLogged(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { logFile: path.join(directory, "no-exit.log") },
    );
    t.after(() => stopOwned(handle));
    captureOwnedProcessTree(handle);
    await stopOwned(handle, {
      requireRunningOwner: true,
      gracefulDeadline:
        Date.now() + (process.platform === "win32" ? 6000 : 150),
      gracefulStop: async () => {},
    });
    assert.equal(handle.cleanupEvidence.graceful.acknowledged, true);
    assert.equal(handle.cleanupConfirmed, true);
    assert.notDeepEqual(await handle.done, { code: 0, signal: null });
    if (process.platform === "win32")
      assert.ok(handle.cleanupEvidence.taskkill);
    assert.throws(() => process.kill(handle.child.pid, 0), { code: "ESRCH" });
  },
);

test(
  "Windows identity preparation refuses a departed owner and preserves failure evidence",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = root(t);
    const handle = launchLogged(process.execPath, ["-e", "process.exit(0)"], {
      logFile: path.join(directory, "departed-before-capture.log"),
    });
    await handle.done;
    assert.throws(() => captureOwnedProcessTree(handle), {
      code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED",
    });
    const evidence = JSON.parse(fs.readFileSync(`${handle.logFile}.cleanup.json`, "utf8"));
    assert.equal(evidence.confirmed, false);
    assert.equal(evidence.taskkill, null);
    assert.match(evidence.error, /exited before identity capture/u);
    assert.equal(handle.cleanupConfirmed, undefined);
  },
);

test(
  "a hanging graceful request is bounded and aborted before fallback cleanup",
  { timeout: 30000 },
  async (t) => {
    const directory = root(t);
    const handle = launchLogged(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { logFile: path.join(directory, "hung-request.log") },
    );
    t.after(async () => {
      try {
        await stopOwned(handle);
      } finally {
        // This fixture has no descendants. Reap its own direct child even if
        // OS identity sampling fails; never turn that into cleanup evidence.
        if (!handle.closed) handle.child.kill();
        await withinDeadline(
          handle.done,
          Date.now() + 5000,
          "fixture child exit",
        );
      }
    });
    captureOwnedProcessTree(handle);
    let aborted = false;
    await stopOwned(handle, {
      requireRunningOwner: true,
      gracefulDeadline:
        Date.now() + (process.platform === "win32" ? 6000 : 150),
      gracefulStop: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    });
    assert.equal(aborted, true);
    assert.match(handle.cleanupEvidence.graceful.error, /deadline exceeded/u);
    assert.equal(handle.cleanupConfirmed, true);
    assert.throws(() => process.kill(handle.child.pid, 0), { code: "ESRCH" });
  },
);

test(
  "Windows graceful owner exit cannot confirm a surviving detached descendant",
  { skip: process.platform !== "win32", timeout: 30000 },
  async (t) => {
    const directory = root(t);
    const stopFile = path.join(directory, "stop-child");
    const exitFile = path.join(directory, "exit-owner");
    const pidFile = path.join(directory, "child.pid");
    const descendant = `const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(process.argv[1]))process.exit(0)},25);setTimeout(()=>process.exit(0),25000);`;
    const leader = `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e',process.argv[4],process.argv[1]],{windowsHide:true,detached:true,stdio:'ignore'});fs.writeFileSync(process.argv[3],String(c.pid));setInterval(()=>{if(fs.existsSync(process.argv[2]))process.exit(0)},25);`;
    const handle = launchLogged(
      process.execPath,
      ["-e", leader, stopFile, exitFile, pidFile, descendant],
      { logFile: path.join(directory, "orphan-graceful.log") },
    );
    let pid;
    try {
      while (!fs.existsSync(pidFile)) await delay(25);
      pid = Number(fs.readFileSync(pidFile, "utf8"));
      captureOwnedProcessTree(handle);
      await assert.rejects(
        stopOwned(handle, {
          requireRunningOwner: true,
          gracefulDeadline: Date.now() + 6000,
          gracefulStop: async () => {
            fs.writeFileSync(exitFile, "exit");
          },
        }),
        { code: "CC_DIAGNOSTIC_CLEANUP_UNCONFIRMED" },
      );
      assert.equal(handle.cleanupEvidence.confirmed, false);
      assert.equal(handle.cleanupEvidence.taskkill, null);
      assert.ok(
        handle.cleanupEvidence.remaining.some((entry) => entry.pid === pid),
      );
      process.kill(pid, 0);
    } finally {
      fs.writeFileSync(stopFile, "stop");
      fs.writeFileSync(exitFile, "exit");
      await withinDeadline(
        handle.done,
        Date.now() + 5000,
        "fixture owner exit",
      );
      const deadline = Date.now() + 5000;
      while (pid) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          assert.equal(error.code, "ESRCH");
          break;
        }
        assert.ok(Date.now() < deadline, "fixture descendant did not exit");
        await delay(25);
      }
    }
  },
);
