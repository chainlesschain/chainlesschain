import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { createClient } = require("../lib/private-storage-windows-client.cjs");
const clients = [];
function fixture() {
  const client = createClient({
    workerPath: fileURLToPath(
      new URL("./fixtures/private-storage-worker.cjs", import.meta.url),
    ),
    environment: process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {},
  });
  clients.push(client);
  return client;
}
function run(client, target, timeoutMs = 5000) {
  return client.run(
    { operation: "inspect", targets: [target], timeoutMs },
    timeoutMs,
  );
}
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});
describe("bounded persistent Windows ACL transport", () => {
  it.each([4242, 8_640_000_000_000_000])(
    "uses monotonic deadlines when the application wall clock is %s",
    (now) => {
      const wallClock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const client = fixture();
        expect(JSON.parse(run(client, "fresh").stdout).target).toBe("fresh");
        const start = process.hrtime.bigint();
        expect(run(client, "hang", 150)).toMatchObject({
          error: { code: "ETIMEDOUT" },
        });
        expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(
          1500,
        );
      } finally {
        wallClock.mockRestore();
      }
    },
  );

  it("does not retain the host's disposable project working directory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-acl-cwd-"));
    const clientPath = require.resolve(
      "../lib/private-storage-windows-client.cjs",
    );
    const workerPath = fileURLToPath(
      new URL("./fixtures/private-storage-worker.cjs", import.meta.url),
    );
    const script = `const {createClient}=require(${JSON.stringify(clientPath)}); const fs=require("node:fs"); const directory=process.cwd(); const client=createClient({workerPath:${JSON.stringify(workerPath)}}); const request={operation:"inspect",targets:["cwd"],timeoutMs:5000}; const first=JSON.parse(client.run(request,5000).stdout); process.chdir(require("node:os").tmpdir()); fs.rmdirSync(directory); const second=JSON.parse(client.run(request,5000).stdout); if(first.pid!==second.pid) throw Error("child was not reused"); client.close();`;
    try {
      const host = spawnSync(process.execPath, ["-e", script], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      expect(host.stderr).toBe("");
      expect(host.status).toBe(0);
      expect(fs.existsSync(directory)).toBe(false);
    } finally {
      if (fs.existsSync(directory)) fs.rmdirSync(directory);
    }
  });

  it("reuses the isolated process while returning fresh request-specific results", () => {
    const client = fixture();
    const first = JSON.parse(run(client, "first").stdout);
    const second = JSON.parse(run(client, "second").stdout);
    expect(second).toEqual({
      target: "second",
      pid: first.pid,
      nodeOptions: null,
    });
  });

  it("hard-kills a blocked child at its deadline and starts a new process", async () => {
    const client = fixture();
    const first = JSON.parse(run(client, "first").stdout);
    const start = performance.now();
    expect(run(client, "hang", 150)).toMatchObject({
      status: null,
      error: { code: "ETIMEDOUT" },
    });
    expect(performance.now() - start).toBeLessThan(1500);
    await expect
      .poll(() => {
        try {
          process.kill(first.pid, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    const next = JSON.parse(run(client, "next").stdout);
    expect(next.target).toBe("next");
    expect(next.pid).not.toBe(first.pid);
  });

  it.each(["stale", "trailing", "stderr", "overflow", "exit"])(
    "fails closed for %s without replay and replaces the process",
    (target) => {
      const client = fixture();
      const first = JSON.parse(run(client, "first").stdout);
      const failed = run(client, target);
      expect(failed.status).toBeNull();
      expect(failed.error).toBeDefined();
      expect(JSON.stringify(failed)).not.toContain("sensitive");
      const next = JSON.parse(run(client, "next").stdout);
      expect(next.pid).not.toBe(first.pid);
      expect(next.target).toBe("next");
    },
  );

  it("cancels during cold startup without admitting a late response", () => {
    const client = fixture();
    expect(run(client, "hang", 1)).toMatchObject({
      status: null,
      error: { code: "ETIMEDOUT" },
    });
    expect(JSON.parse(run(client, "fresh").stdout).target).toBe("fresh");
  });

  it("discards a child after a native failure so leaked native resources cannot cross requests", () => {
    const client = fixture();
    const first = JSON.parse(run(client, "first").stdout);
    expect(run(client, "native-failure").status).toBe(4);
    expect(JSON.parse(run(client, "next").stdout).pid).not.toBe(first.pid);
  });

  it("rejects oversized input and requests after close", () => {
    const client = fixture();
    expect(run(client, "x".repeat(4 * 1024 * 1024))).toMatchObject({
      error: { code: "E2BIG" },
    });
    client.close();
    expect(run(client, "next")).toMatchObject({
      error: { code: "ACL_CLIENT_CLOSED" },
    });
  });

  it("allows its host to exit and closes the idle child when its private pipe closes", async () => {
    const clientPath = require.resolve(
      "../lib/private-storage-windows-client.cjs",
    );
    const workerPath = fileURLToPath(
      new URL("./fixtures/private-storage-worker.cjs", import.meta.url),
    );
    const script = `const {createClient}=require(${JSON.stringify(clientPath)}); const client=createClient({workerPath:${JSON.stringify(workerPath)}}); process.stdout.write(client.run({operation:"inspect",targets:["idle"],timeoutMs:5000},5000).stdout);`;
    const host = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    expect(host.status).toBe(0);
    const { pid } = JSON.parse(host.stdout);
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  });

  it.skipIf(process.platform !== "win32")(
    "rereads live ACLs after an external permission change in the same worker",
    () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-acl-reuse-"));
      const target = path.join(directory, "private.txt");
      const client = createClient({
        environment: { SystemRoot: process.env.SystemRoot },
      });
      clients.push(client);
      const request = (operation, targets) =>
        client.run({ operation, targets, timeoutMs: 15000 }, 15000);
      try {
        expect(request("repair", [directory]).status).toBe(0);
        fs.writeFileSync(target, "test");
        expect(request("repair", [target]).status).toBe(0);
        expect(JSON.parse(request("inspect", [target]).stdout)[0].ok).toBe(
          true,
        );
        const changed = spawnSync(
          "icacls.exe",
          [target, "/grant", "*S-1-1-0:(R)"],
          { windowsHide: true, encoding: "utf8" },
        );
        expect(changed.status).toBe(0);
        expect(JSON.parse(request("inspect", [target]).stdout)[0].ok).toBe(
          false,
        );
        expect(request("repair", [target]).status).toBe(0);
        expect(JSON.parse(request("inspect", [target]).stdout)[0].ok).toBe(
          true,
        );
      } finally {
        client.close();
        if (fs.existsSync(target)) fs.unlinkSync(target);
        fs.rmdirSync(directory);
      }
    },
  );
});
