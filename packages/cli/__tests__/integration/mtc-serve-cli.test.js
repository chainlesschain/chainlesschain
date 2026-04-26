/**
 * Integration test: cc mtc serve daemon picks up landmarks from a
 * filesystem drop-zone, ingests them, and exits cleanly under
 * --exit-after.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");
const REPO_NODE_MODULES = path.resolve(process.cwd(), "../../node_modules");

describe("cc mtc serve — filesystem transport", () => {
  let homeDir;
  let dropZone;
  let cacheDir;
  let env;

  function runCli(args, opts = {}) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env,
      ...opts,
    });
  }

  beforeAll(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-serve-"));
    dropZone = path.join(homeDir, "drop");
    cacheDir = path.join(homeDir, "cache");
    env = { ...process.env, CHAINLESSCHAIN_HOME: homeDir };
  });

  afterAll(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("subscribes + ingests + exits with --exit-after=1", async () => {
    // 1. Seed a DID + build a real Ed25519-signed batch via batch-dids
    const r1 = runCli(["did", "create", "--name", "ServeTest", "--json"]);
    expect(r1.status, `did create: ${r1.stderr}`).toBe(0);

    const batchOut = path.join(homeDir, "batch-out");
    const r2 = runCli([
      "mtc",
      "batch-dids",
      "--namespace",
      "mtc/v1/did/000888",
      "--issuer",
      "mtca:cc:zQ3shServeTest",
      "--out",
      batchOut,
    ]);
    expect(r2.status, `batch-dids: ${r2.stderr}`).toBe(0);

    // 2. Publish that landmark into the filesystem drop-zone using core-mtc
    //    directly (mimics what a producer's `cc mtc publish` would do —
    //    that subcommand isn't shipped yet so we do it inline).
    const landmark = JSON.parse(
      fs.readFileSync(path.join(batchOut, "landmark.json"), "utf-8"),
    );
    const { FilesystemTransport } = require(
      path.join(
        REPO_NODE_MODULES,
        "@chainlesschain/core-mtc/lib/transports/filesystem.js",
      ),
    );
    const producer = new FilesystemTransport({
      dropZone,
      pollIntervalMs: 0,
    });
    await producer.publish(landmark);
    producer.close();

    // 3. Run cc mtc serve --exit-after=1; it should pick up the landmark
    //    that's already in drop-zone and exit cleanly
    const r3 = runCli(
      [
        "mtc",
        "serve",
        "--transport=filesystem",
        "--drop-zone",
        dropZone,
        "--prefix",
        "mtc/v1/did",
        "--cache-dir",
        cacheDir,
        "--exit-after",
        "1",
      ],
      { timeout: 60_000 },
    );

    expect(r3.status, `serve stderr: ${r3.stderr}`).toBe(0);
    expect(r3.stdout + r3.stderr).toMatch(/subscribed: mtc\/v1\/did/);
    expect(r3.stdout + r3.stderr).toMatch(/tree_size=1/);
    expect(r3.stdout + r3.stderr).toMatch(/exit-after 1/);

    // 4. Cache directory should now contain the persisted snapshot
    const cacheFiles = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".json")) cacheFiles.push(full);
      }
    }
    if (fs.existsSync(cacheDir)) walk(cacheDir);
    expect(cacheFiles.length).toBe(1);
  }, 120_000);

  it("rejects --transport=filesystem without --drop-zone", () => {
    const r = runCli([
      "mtc",
      "serve",
      "--transport=filesystem",
      "--exit-after",
      "1",
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/--drop-zone is required/);
  });

  it("rejects unknown transport kind", () => {
    const r = runCli([
      "mtc",
      "serve",
      "--transport=carrier-pigeon",
      "--exit-after",
      "1",
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/Unknown --transport/);
  });
});
