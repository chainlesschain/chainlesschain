import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { atomicWriteJson } from "../diagnostics/bounded-atomic-json.mjs";

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "cc-atomic-publication-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const destination = path.join(root, "report.json");
  fs.writeFileSync(destination, '{"old":true}\n');
  return { root, destination };
}
for (const code of ["EPERM", "EACCES", "EBUSY"])
  test(`Windows transient ${code} retains old bytes until atomic replacement succeeds`, (t) => {
    const f = fixture(t),
      delays = [],
      events = [];
    let tries = 0,
      sameTemp;
    const receipt = atomicWriteJson(
      f.destination,
      { next: true },
      {
        platform: "win32",
        sleep: (ms) => delays.push(ms),
        onRetry: (event) => events.push(event),
        io: {
          ...fs,
          renameSync(temporary, target) {
            tries++;
            sameTemp ??= temporary;
            assert.equal(temporary, sameTemp);
            assert.deepEqual(JSON.parse(fs.readFileSync(temporary, "utf8")), {
              next: true,
            });
            assert.equal(fs.readFileSync(target, "utf8"), '{"old":true}\n');
            if (tries <= 2)
              throw Object.assign(new Error("temporary read lock"), { code });
            fs.renameSync(temporary, target);
          },
        },
      },
    );
    assert.equal(receipt.attempts, 3);
    assert.deepEqual(delays, [20, 40]);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.code === code));
    assert.deepEqual(JSON.parse(fs.readFileSync(f.destination, "utf8")), {
      next: true,
    });
    assert.equal(fs.existsSync(sameTemp), false);
  });
test("permanent Windows failure is bounded and retains every failed publication", (t) => {
  const f = fixture(t),
    delays = [],
    temps = new Set();
  const original = Object.assign(new Error("persistent access refusal"), {
    code: "EPERM",
  });
  const options = {
    platform: "win32",
    sleep: (ms) => delays.push(ms),
    onRetry: () => {},
    io: {
      ...fs,
      renameSync(temporary) {
        temps.add(temporary);
        throw original;
      },
    },
  };
  for (const next of [1, 2])
    assert.throws(
      () => atomicWriteJson(f.destination, { next }, options),
      (error) => {
        assert.equal(error, original);
        assert.equal(error.publicationFailure.attempts, 6);
        assert.deepEqual(
          JSON.parse(
            fs.readFileSync(error.publicationFailure.temporary, "utf8"),
          ),
          { next },
        );
        return true;
      },
    );
  assert.equal(temps.size, 2);
  assert.equal(
    delays.reduce((a, b) => a + b, 0),
    1240,
  );
  assert.equal(fs.readFileSync(f.destination, "utf8"), '{"old":true}\n');
});
for (const [platform, code] of [
  ["linux", "EPERM"],
  ["darwin", "EBUSY"],
  ["win32", "ENOSPC"],
  ["win32", "ENOENT"],
])
  test(`${platform} ${code} refuses immediately without masking the OS error`, (t) => {
    const f = fixture(t);
    let tries = 0;
    assert.throws(
      () =>
        atomicWriteJson(
          f.destination,
          { next: true },
          {
            platform,
            sleep: () => {
              throw new Error("must not retry");
            },
            onRetry: () => {
              throw new Error("must not retry");
            },
            io: {
              ...fs,
              renameSync() {
                tries++;
                throw Object.assign(new Error("publication failed"), { code });
              },
            },
          },
        ),
      (error) => error.code === code && error.publicationFailure.attempts === 1,
    );
    assert.equal(tries, 1);
    assert.equal(fs.readFileSync(f.destination, "utf8"), '{"old":true}\n');
  });

if (process.platform === "win32")
  test(
    "a real Windows reader denying delete releases before the bounded replace retry",
    { timeout: 60_000 },
    async (t) => {
      const f = fixture(t);
      const releaseRequest = path.join(f.root, "release-reader");
      const released = path.join(f.root, "reader-released");
      const command =
        '$file=[System.IO.File]::Open($env:CC_ATOMIC_TEST_TARGET,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); try { [Console]::WriteLine("locked"); [Console]::Out.Flush(); while (-not [System.IO.File]::Exists($env:CC_ATOMIC_TEST_RELEASE_REQUEST)) { [System.Threading.Thread]::Sleep(10) } } finally { $file.Dispose(); [System.IO.File]::WriteAllText($env:CC_ATOMIC_TEST_RELEASED,"released") }';
      const executable = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const child = spawn(
        executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            SystemRoot: process.env.SystemRoot,
            CC_ATOMIC_TEST_TARGET: f.destination,
            CC_ATOMIC_TEST_RELEASE_REQUEST: releaseRequest,
            CC_ATOMIC_TEST_RELEASED: released,
          },
        },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      const exited = once(child, "exit");
      const [ready] = await Promise.race([
        once(child.stdout, "data", { signal: AbortSignal.timeout(15_000) }),
        exited.then(() => {
          throw new Error("reader exited before locking");
        }),
      ]);
      assert.match(ready.toString(), /locked/u);
      const events = [];
      const receipt = atomicWriteJson(
        f.destination,
        { afterLock: true },
        {
          onRetry: (event) => {
            events.push(event);
            if (events.length !== 1) return;
            fs.writeFileSync(releaseRequest, "release");
            const deadline = Date.now() + 15_000;
            while (!fs.existsSync(released) && Date.now() < deadline)
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            assert.ok(
              fs.existsSync(released),
              "reader did not release the file",
            );
          },
        },
      );
      assert.ok(receipt.attempts > 1 && receipt.attempts <= 6);
      assert.ok(events.length > 0);
      assert.ok(
        events.every((event) =>
          ["EPERM", "EACCES", "EBUSY"].includes(event.code),
        ),
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(f.destination, "utf8")), {
        afterLock: true,
      });
      await exited;
    },
  );
