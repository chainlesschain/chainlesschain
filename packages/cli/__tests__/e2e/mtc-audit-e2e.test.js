/**
 * E2E test: MTC audit double-track + marketplace publisher
 *
 * Goes beyond unit / integration by:
 *   1. Spawning the real CLI for every step (multiple distinct processes)
 *   2. Verifying landmark/envelope files cryptographically with core-mtc
 *      directly — proves the on-disk artifacts are spec-compliant and
 *      independently verifiable, not just internally self-consistent.
 *   3. Tampering with envelopes to assert verification fails (negative path).
 *   4. Driving the marketplace publisher daemon across two processes and
 *      asserting the second invocation correctly detects no-delta.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import mtcLib from "@chainlesschain/core-mtc";

const { LandmarkCache, verify, ed25519, jcs, sha256, encodeHashStr } = mtcLib;

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, { allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (!allowFail && result.status !== 0) {
    throw new Error(
      `cc ${args.join(" ")} failed (exit ${result.status})\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
  return result;
}

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("E2E: cc audit mtc — full crypto chain across processes", () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cc-mtc-audit-e2e-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("end-to-end with independent core-mtc verification of envelopes", () => {
    // Process 1: enable
    run([
      "audit",
      "mtc",
      "enable",
      "--config-dir",
      home,
      "--namespace",
      "mtc/v1/audit/e2e",
      "--issuer",
      "mtca:cc:e2e-test",
      "--interval",
      "60",
    ]);

    // Processes 2-4: emit three audit events
    const eventIds = [];
    for (const op of ["login", "data-export", "logout"]) {
      const r = run([
        "audit",
        "mtc",
        "emit",
        "--type",
        "auth",
        "--operation",
        op,
        "--actor",
        "alice",
        "--config-dir",
        home,
        "--json",
      ]);
      eventIds.push(extractJson(r.stdout).event_id);
    }

    // Process 5: reconcile (close batch)
    const recR = run([
      "audit",
      "mtc",
      "reconcile",
      "--config-dir",
      home,
      "--json",
    ]);
    const rec = extractJson(recR.stdout);
    expect(rec.skipped).toBe(false);
    expect(rec.batchId).toBe("000001");
    expect(rec.treeSize).toBe(3);

    // Independent verification: read landmark + envelopes from disk and
    // verify them with core-mtc directly (no CLI involved).
    const landmark = JSON.parse(
      readFileSync(join(rec.batchDir, "landmark.json"), "utf-8"),
    );
    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
    });
    cache.ingest(landmark);

    for (const id of eventIds) {
      const envPath = join(rec.batchDir, `envelope-${id}.json`);
      expect(existsSync(envPath)).toBe(true);
      const envelope = JSON.parse(readFileSync(envPath, "utf-8"));

      const result = verify(envelope, cache);
      expect(result.ok, `verify ${id}: ${result.code}`).toBe(true);
      expect(result.leaf.subject).toBe(id);
      expect(result.leaf.kind).toBe("audit-event");

      // Realtime Ed25519 signature on the leaf (track 1) is also independently
      // verifiable: the leaf's content_hash is what was signed at emit time,
      // and the trust anchor in the landmark publishes the matching pubkey.
      expect(result.leaf.realtime_sig.alg).toBe("Ed25519");
      expect(result.leaf.realtime_sig.sig).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    // Negative path: tampering with the envelope must break verification.
    const firstEnv = JSON.parse(
      readFileSync(join(rec.batchDir, `envelope-${eventIds[0]}.json`), "utf-8"),
    );
    firstEnv.leaf.subject = "did:cc:tampered";
    const tamperResult = verify(firstEnv, cache);
    expect(tamperResult.ok).toBe(false);

    // Process 6: reconcile-check via CLI returns the same batch info we
    // verified directly.
    const checkR = run([
      "audit",
      "mtc",
      "reconcile-check",
      eventIds[0],
      "--config-dir",
      home,
      "--json",
    ]);
    const check = extractJson(checkR.stdout);
    expect(check.found).toBe(true);
    expect(check.batchId).toBe("000001");
    expect(check.treeHeadId).toBe(rec.treeHeadId);
    // Heavy multi-process flow: 6 sequential CLI cold-starts (enable + 3 emit +
    // reconcile + reconcile-check), each ~3s standalone but far slower under the
    // singleFork e2e load — allow ample headroom over the 60s global timeout.
  }, 120000);

  it("disabled emit fails fast (no staging file written)", () => {
    // No `enable` call — config defaults to enabled=false
    const r = run(
      [
        "audit",
        "mtc",
        "emit",
        "--type",
        "auth",
        "--operation",
        "should-not-land",
        "--config-dir",
        home,
      ],
      { allowFail: true },
    );
    expect(r.status).not.toBe(0);

    // Confirm staging dir is empty (or absent)
    const stagingPath = join(home, "audit-mtc", "staging");
    if (existsSync(stagingPath)) {
      expect(readdirSync(stagingPath)).toHaveLength(0);
    }
  });

  it("status snapshot shows config + zero state on a fresh dir", () => {
    const r = run(["audit", "mtc", "status", "--config-dir", home, "--json"]);
    const s = extractJson(r.stdout);
    expect(s.config.enabled).toBe(false);
    expect(s.config.batch_interval_seconds).toBe(3600);
    expect(s.staging.count).toBe(0);
    expect(s.batches.count).toBe(0);
  });
});

describe("E2E: cc mtc publish-skills — daemon delta-detection across processes", () => {
  let home;
  let outDir;
  let stateFile;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cc-mtc-publish-e2e-"));
    outDir = join(home, "out");
    stateFile = join(home, "state.json");
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("publishes once, then a fresh process detects no delta and skips", () => {
    const args = [
      "mtc",
      "publish-skills",
      "--namespace-prefix",
      "mtc/v1/skill",
      "--issuer",
      "mtca:cc:e2e-publisher",
      "--out",
      outDir,
      "--state-file",
      stateFile,
      "--once",
      "--json",
    ];

    // First process
    const r1 = run(args);
    const result1 = extractJson(r1.stdout);
    if (
      result1.iteration === "skipped" &&
      result1.reason === "no skills discovered"
    ) {
      // Environment has no skill packs — publisher has nothing to do.
      // Still validates the command path runs cleanly across processes.
      const r2 = run(args);
      const result2 = extractJson(r2.stdout);
      expect(result2.iteration).toBe("skipped");
      return;
    }

    expect(result1.iteration).toBe("published");
    expect(result1.seq).toBe("000001");
    expect(existsSync(stateFile)).toBe(true);

    // Cryptographic verification of the produced landmark (independent path)
    const landmark = JSON.parse(readFileSync(result1.landmark_path, "utf-8"));
    const cache = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
    });
    cache.ingest(landmark);
    for (const envPath of result1.envelope_paths) {
      const envelope = JSON.parse(readFileSync(envPath, "utf-8"));
      const result = verify(envelope, cache);
      expect(result.ok, `envelope ${envPath}: ${result.code}`).toBe(true);
    }

    // Second, fully independent process
    const r2 = run(args);
    const result2 = extractJson(r2.stdout);
    expect(result2.iteration).toBe("skipped");
    expect(result2.reason).toBe("fingerprint unchanged");
    expect(result2.last_seq).toBe(1);
  });

  it("survives an externally-corrupted state file (atomic write recovery)", () => {
    const args = [
      "mtc",
      "publish-skills",
      "--namespace-prefix",
      "mtc/v1/skill",
      "--issuer",
      "mtca:cc:e2e-publisher",
      "--out",
      outDir,
      "--state-file",
      stateFile,
      "--once",
      "--json",
    ];

    // Publish once (or skip if no skills available)
    const first = run(args);
    const firstResult = extractJson(first.stdout);
    if (firstResult.iteration === "skipped") return;

    // Externally corrupt the state file (simulate a botched write from a
    // prior buggy version that didn't use atomic rename)
    writeFileSync(stateFile, "{ this is not valid", "utf-8");

    // Next run must surface the corruption rather than silently reset to seq 0
    const r = run(args, { allowFail: true });
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/state|JSON|parse/i);
  });
});

describe("E2E: lifted assembleBatch — cc mtc batch and audit produce equivalent verifiable output", () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cc-mtc-equiv-e2e-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("both code paths produce envelopes that core-mtc verifies under the same protocol", () => {
    // Path A: cc mtc batch (file input)
    const leavesPath = join(home, "leaves.json");
    writeFileSync(
      leavesPath,
      JSON.stringify(
        Array.from({ length: 4 }, (_, i) => ({
          kind: "did-document",
          content_hash: encodeHashStr(
            sha256(jcs({ i, ts: "2026-05-01T00:00:00Z" })),
          ),
          issued_at: "2026-05-01T00:00:00Z",
          subject: `did:cc:zQ3eqv${i}`,
          metadata: { version: "1.0.0" },
        })),
        null,
        2,
      ),
      "utf-8",
    );
    const outA = join(home, "out-a");
    run([
      "mtc",
      "batch",
      leavesPath,
      "--namespace",
      "mtc/v1/did/000001",
      "--issuer",
      "mtca:cc:equiv-test",
      "--out",
      outA,
      "--json",
    ]);
    const landmarkA = JSON.parse(
      readFileSync(join(outA, "landmark.json"), "utf-8"),
    );
    const envA = JSON.parse(
      readFileSync(join(outA, "envelope-000000.json"), "utf-8"),
    );
    const cacheA = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmarkA),
    });
    cacheA.ingest(landmarkA);
    expect(verify(envA, cacheA).ok).toBe(true);

    // Path B: cc audit mtc (DB-backed leaves but the same assembleBatch underneath)
    run([
      "audit",
      "mtc",
      "enable",
      "--config-dir",
      home,
      "--namespace",
      "mtc/v1/audit/equiv",
      "--issuer",
      "mtca:cc:equiv-test",
    ]);
    run([
      "audit",
      "mtc",
      "emit",
      "--type",
      "x",
      "--operation",
      "y",
      "--config-dir",
      home,
    ]);
    const recR = run([
      "audit",
      "mtc",
      "reconcile",
      "--config-dir",
      home,
      "--json",
    ]);
    const rec = extractJson(recR.stdout);
    const landmarkB = JSON.parse(
      readFileSync(join(rec.batchDir, "landmark.json"), "utf-8"),
    );
    const envFile = readdirSync(rec.batchDir).find((n) =>
      n.startsWith("envelope-"),
    );
    const envB = JSON.parse(readFileSync(join(rec.batchDir, envFile), "utf-8"));
    const cacheB = new LandmarkCache({
      signatureVerifier: ed25519.makeVerifierFromLandmark(landmarkB),
    });
    cacheB.ingest(landmarkB);
    expect(verify(envB, cacheB).ok).toBe(true);

    // Both produced envelopes share identical schema / protocol shape
    expect(envA.schema).toBe(envB.schema);
    expect(envA.inclusion_proof).toBeTruthy();
    expect(envB.inclusion_proof).toBeTruthy();
    expect(landmarkA.schema).toBe(landmarkB.schema);
  });
});
