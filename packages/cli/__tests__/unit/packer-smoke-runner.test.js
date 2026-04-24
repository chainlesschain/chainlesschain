/**
 * Unit tests: src/lib/packer/smoke-runner.js
 *
 * We don't spawn a real packed exe here — that's the job of the e2e test.
 * Instead we write a tiny Node script that mimics the contract the pack
 * entry has with smoke-runner: bind HTTP on CC_PACK_UI_PORT and TCP on
 * CC_PACK_WS_PORT, optionally answer `/` with a status code, optionally
 * crash early. Running smokeTestExe against this script exercises every
 * code path the real exe does.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { smokeTestExe } from "../../src/lib/packer/smoke-runner.js";
import { PackError, EXIT } from "../../src/lib/packer/errors.js";

function writeFakeExe(dir, bodyJs) {
  // On Windows we can't chmod +x a .js; instead we create a tiny .cmd
  // wrapper that re-invokes node on the sibling .js. smoke-runner spawns
  // the file as an executable, so a .cmd gives us the same shape.
  const jsPath = path.join(dir, "fake.js");
  fs.writeFileSync(jsPath, bodyJs, "utf-8");
  if (process.platform === "win32") {
    const cmdPath = path.join(dir, "fake.cmd");
    // `@echo off` suppresses the command echo; `%~dp0` is the script dir.
    fs.writeFileSync(
      cmdPath,
      `@echo off\r\nnode "%~dp0fake.js" %*\r\n`,
      "utf-8",
    );
    return cmdPath;
  }
  const shPath = path.join(dir, "fake.sh");
  fs.writeFileSync(shPath, `#!/bin/sh\nexec node "${jsPath}" "$@"\n`, "utf-8");
  fs.chmodSync(shPath, 0o755);
  return shPath;
}

const goodExeBody = `
const http = require('node:http');
const net = require('node:net');
const uiPort = Number(process.env.CC_PACK_UI_PORT);
const wsPort = Number(process.env.CC_PACK_WS_PORT);
const httpSrv = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('ok');
});
httpSrv.listen(uiPort, '127.0.0.1');
const tcpSrv = net.createServer((sock) => sock.end());
tcpSrv.listen(wsPort, '127.0.0.1');
process.on('SIGTERM', () => { httpSrv.close(); tcpSrv.close(); process.exit(0); });
// Stay alive until killed
setInterval(() => {}, 1000);
`;

const bad500ExeBody = `
const http = require('node:http');
const net = require('node:net');
const uiPort = Number(process.env.CC_PACK_UI_PORT);
const wsPort = Number(process.env.CC_PACK_WS_PORT);
http.createServer((_req, res) => { res.writeHead(500); res.end('sad'); }).listen(uiPort, '127.0.0.1');
net.createServer().listen(wsPort, '127.0.0.1');
setInterval(() => {}, 1000);
`;

const crashExeBody = `
console.error('boom-before-listen');
process.exit(42);
`;

describe("smokeTestExe", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-smoke-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns ok=true when exe binds both ports and answers 200 on /", async () => {
    const exe = writeFakeExe(tmpDir, goodExeBody);
    const res = await smokeTestExe({
      exePath: exe,
      uiPort: 19201,
      wsPort: 19200,
      bootTimeoutMs: 15_000,
      logger: { log: () => {} },
    });
    expect(res.ok).toBe(true);
    expect(res.uiStatus).toBe(200);
    expect(res.wsListening).toBe(true);
  });

  it("throws PackError(EXIT.SMOKE) when exe returns non-2xx", async () => {
    const exe = writeFakeExe(tmpDir, bad500ExeBody);
    let caught;
    try {
      await smokeTestExe({
        exePath: exe,
        uiPort: 19203,
        wsPort: 19202,
        bootTimeoutMs: 15_000,
        logger: { log: () => {} },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PackError);
    expect(caught.exitCode).toBe(EXIT.SMOKE);
    expect(caught.message).toMatch(/returned 500/);
  });

  it("throws PackError(EXIT.SMOKE) when exe dies before listening", async () => {
    const exe = writeFakeExe(tmpDir, crashExeBody);
    let caught;
    try {
      await smokeTestExe({
        exePath: exe,
        uiPort: 19205,
        wsPort: 19204,
        bootTimeoutMs: 15_000,
        logger: { log: () => {} },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PackError);
    expect(caught.exitCode).toBe(EXIT.SMOKE);
    // The watchdog should echo whatever the child sent to stderr,
    // which helps users diagnose a fatal-at-startup regression.
    expect(caught.message).toMatch(/boom-before-listen/);
  });

  it("rejects when exePath is missing", async () => {
    await expect(smokeTestExe({ exePath: "" })).rejects.toBeInstanceOf(
      PackError,
    );
  });
});
