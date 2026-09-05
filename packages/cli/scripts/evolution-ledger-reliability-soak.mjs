import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackendProcess } from "../__tests__/helpers/evolution-ledger-process.js";

// Repository-only reliability exercise. Signing keys and artifact resolution
// are test authorities; the ledger, witness files and OS processes are real.
export async function runEvolutionLedgerReliabilitySoak({
  events = 1000,
  onProgress = () => {},
} = {}) {
  if (!Number.isSafeInteger(events) || events < 1 || events > 10_000) {
    throw new TypeError("events must be an integer between 1 and 10000");
  }
  if (typeof onProgress !== "function")
    throw new TypeError("onProgress must be a function");
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(
    path.join(temporaryRoot, "cc-ledger-reliability-soak-"),
  );
  try {
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    const seeded = await runBackendProcess(root, {
      mode: "seed",
      count: events,
      onProgress,
    });
    assert.equal(seeded.code, 0, JSON.stringify(seeded));
    assert.equal(seeded.signal, null);
    assert.equal(seeded.result.ok, true);
    assert.equal(seeded.result.verification.sequence, events);
    assert.equal(seeded.result.verification.eventCount, events);
    onProgress("checking fresh-process snapshot readback");
    const reopened = await runBackendProcess(root, { count: events });
    assert.equal(reopened.code, 0, JSON.stringify(reopened));
    assert.equal(reopened.signal, null);
    assert.equal(reopened.result.ok, true);
    assert.notEqual(reopened.result.pid, seeded.result.pid);
    assert.equal(reopened.result.verification.sequence, events);
    assert.equal(reopened.result.verification.eventCount, events);
    assert.equal(
      reopened.result.verification.headDigest,
      seeded.result.verification.headDigest,
    );
    assert.deepEqual(
      reopened.result.samples,
      [1, Math.ceil(events / 2), events].map(
        (sequence) => `long-event-${sequence}`,
      ),
    );
    assert.equal(
      reopened.result.verificationCounts["ledger-restart:domain-event"] ?? 0,
      0,
    );
    assert.ok(
      reopened.result.verificationCounts["ledger-restart:state-snapshot"] > 0,
    );
    assert.ok(
      reopened.result.maxRssKiB < 512 * 1024,
      "reopen RSS exceeded 512 MiB",
    );
    assert.ok(reopened.result.elapsedMs < 60_000, "reopen exceeded 60 seconds");

    onProgress("checking old segment corruption behind the signed snapshot");
    const segmentRoot = path.join(root, "events", "segments-v1");
    const segmentPath = path.join(
      segmentRoot,
      fs.readdirSync(segmentRoot).sort()[0],
    );
    const segmentBytes = fs.readFileSync(segmentPath);
    fs.appendFileSync(segmentPath, "\n");
    const corruptSegment = await runBackendProcess(root, { count: events });
    assert.equal(corruptSegment.code, 2);
    assert.equal(corruptSegment.result.ok, false);
    assert.equal(corruptSegment.result.code, "CC_EVOLUTION_LEDGER_CORRUPT");
    fs.writeFileSync(segmentPath, segmentBytes);

    onProgress("checking witness authentication after restoring the segment");
    const witnessPath = path.join(root, "witness", "checkpoint.json");
    const witness = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
    witness.current.signature.value = "invalid-signature";
    fs.writeFileSync(witnessPath, JSON.stringify(witness));
    const corruptWitness = await runBackendProcess(root, { count: events });
    assert.equal(corruptWitness.code, 2);
    assert.equal(corruptWitness.result.ok, false);
    assert.match(corruptWitness.result.code, /^CC_EVOLUTION_LEDGER_/u);

    return Object.freeze({
      status: "passed",
      events,
      seedPid: seeded.result.pid,
      reopenPid: reopened.result.pid,
      seedMs: seeded.result.elapsedMs,
      seedVerificationCounts: seeded.result.verificationCounts,
      reopenMs: reopened.result.elapsedMs,
      reopenVerificationCounts: reopened.result.verificationCounts,
      reopenMaxRssKiB: reopened.result.maxRssKiB,
      childHeapLimitMiB: 256,
      segmentCorruptionRejected: true,
      witnessCorruptionRejected: true,
      productionAuthority: false,
    });
  } finally {
    // Only the newly created test directory can be cleaned up.
    assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runEvolutionLedgerFaultCampaign({
  rounds = 100,
  onProgress = () => {},
} = {}) {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000)
    throw new TypeError("fault rounds must be between 1 and 1000");
  if (typeof onProgress !== "function")
    throw new TypeError("onProgress must be a function");
  const phases = [
    "after-segment-link",
    "after-segment",
    "after-anchor-link",
    "after-anchor",
    "after-witness",
    "after-head",
  ];
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const phaseCounts = Object.fromEntries(phases.map((phase) => [phase, 0]));
  const startedAt = performance.now();
  for (let round = 0; round < rounds; round += 1) {
    const phase = phases[round % phases.length];
    const committed = ["after-witness", "after-head"].includes(phase);
    const root = fs.mkdtempSync(
      path.join(temporaryRoot, "cc-ledger-fault-campaign-"),
    );
    try {
      fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
      const seed = await runBackendProcess(root, { mode: "seed", count: 1 });
      assert.equal(seed.code, 0, JSON.stringify(seed));
      const crashed = await runBackendProcess(root, {
        mode: `crash:${phase}`,
        count: 1,
      });
      assert.equal(crashed.code, 86, JSON.stringify(crashed));
      assert.equal(crashed.result.ok, false);
      assert.equal(crashed.result.forcedExit, true);
      assert.equal(crashed.result.phase, phase);
      const count = committed ? 2 : 1;
      const recovered = await runBackendProcess(root, { count });
      assert.equal(recovered.code, 0, JSON.stringify(recovered));
      assert.equal(recovered.result.ok, true);
      assert.notEqual(recovered.result.pid, crashed.result.pid);
      assert.equal(recovered.result.verification.sequence, count);
      assert.equal(recovered.result.verification.eventCount, count);
      assert.equal(recovered.result.witness.sequence, count);
      assert.deepEqual(
        recovered.result.samples,
        [1, Math.ceil(count / 2), count].map((index) => `long-event-${index}`),
      );
      if (!committed)
        assert.equal(
          recovered.result.verification.headDigest,
          seed.result.verification.headDigest,
        );
      else
        assert.notEqual(
          recovered.result.verification.headDigest,
          seed.result.verification.headDigest,
        );
      const replay = await runBackendProcess(root, { count });
      assert.equal(replay.code, 0, JSON.stringify(replay));
      assert.equal(replay.result.verification.sequence, count);
      assert.equal(replay.result.verification.eventCount, count);
      assert.equal(
        replay.result.verification.headDigest,
        recovered.result.verification.headDigest,
      );
      assert.equal(
        replay.result.verification.witnessDigest,
        recovered.result.verification.witnessDigest,
      );
      phaseCounts[phase] += 1;
      onProgress(`recovered ${round + 1}/${rounds}: ${phase}`);
    } finally {
      assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    status: "passed",
    rounds,
    phaseCounts,
    elapsedMs: performance.now() - startedAt,
    falseSuccessReceipts: 0,
    productionAuthority: false,
    powerLossVerified: false,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === "--help") {
      console.log(
        "Usage: npm run test:evolution-ledger-reliability-soak -- [--events 1000 | --fault-rounds 100]\nTest-only authorities; real ledger/witness files and separate bounded-heap processes. Large runs may take tens of minutes. Forced process exit is not power-loss acceptance.",
      );
    } else {
      if (
        args.length !== 0 &&
        (args.length !== 2 ||
          !["--events", "--fault-rounds"].includes(args[0]) ||
          !/^[1-9]\d*$/.test(args[1]))
      )
        throw new Error(
          "expected --events <1..10000> or --fault-rounds <1..1000>",
        );
      const onProgress = (message) => console.error(message);
      const report =
        args[0] === "--fault-rounds"
          ? await runEvolutionLedgerFaultCampaign({
              rounds: Number(args[1]),
              onProgress,
            })
          : await runEvolutionLedgerReliabilitySoak({
              events: args.length === 0 ? 1000 : Number(args[1]),
              onProgress,
            });
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}
