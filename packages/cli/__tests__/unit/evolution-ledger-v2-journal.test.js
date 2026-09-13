import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  createLedgerV2FixtureBackend,
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "../fixtures/evolution-ledger-v2-store.js";
import { isEvolutionLedgerV2Journal } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";
import {
  EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
  EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
} from "../../src/lib/evolution/evolution-ledger.js";

const roots = [];
function root() {
  const directory = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-v2-journal-"),
  );
  roots.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of roots.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
const helper = fileURLToPath(
  new URL(
    "../integration/helpers/evolution-ledger-v2-reopen.mjs",
    import.meta.url,
  ),
);
function child(directory, mode) {
  return spawnSync(process.execPath, [helper, directory, mode], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}
function markers(events) {
  return events.filter((event) =>
    [
      EVOLUTION_LEDGER_V2_MIGRATION_INTENT,
      EVOLUTION_LEDGER_V2_CUTOVER_COMPLETED,
    ].includes(event.type),
  );
}

describe("production v2 ledger payload journal and cutover", () => {
  it("recovers complete payloads from a fresh manifest process without opening the offline v1 WAL", () => {
    const directory = root();
    const value = openLedgerV2Fixture(directory);
    value.journal.appendDomainEvent(
      v2FixtureDomainEvent(value, "standalone-payload"),
    );
    const expected = value.journal.read();
    fs.writeFileSync(
      path.join(directory, "manifest-request.json"),
      JSON.stringify({
        authority: value.journal.getAuthority(),
        descriptor: value.descriptor,
      }),
    );
    // Only this test's exact temporary WAL path is moved; v2 authorities and
    // retained bytes are untouched. A journal reopen would now fail closed.
    fs.renameSync(
      path.join(directory, "events"),
      path.join(directory, "offline-events"),
    );
    const reopened = child(directory, "manifest-only");
    expect(reopened.status, reopened.stderr).toBe(0);
    expect(JSON.parse(reopened.stdout)).toEqual(expected);
  });

  it("migrates and reopens existing slash-bearing tenant, artifact and audience scopes", () => {
    const directory = root();
    const scope = {
      tenantId: "tenant/compat",
      artifactTenantId: "artifacts/compat",
      audience: "evolution/runtime",
    };
    const v1 = openEvolutionDurableStore(directory, scope);
    v1.backend.ledger.appendDomainEvent(
      v2FixtureDomainEvent(v1, "slash-event"),
    );
    const migrated = openLedgerV2Fixture(directory, scope);
    const reopened = child(directory, "read-slash");
    expect(reopened.status, reopened.stderr).toBe(0);
    expect(JSON.parse(reopened.stdout).events).toEqual(migrated.journal.read());
  });

  it("migrates signed v1 payloads once, finalizes one live batch once, and recovers the exact bytes in a fresh process", () => {
    const directory = root();
    const v1 = openEvolutionDurableStore(directory);
    const oldReceipt = v1.backend.ledger.appendDomainEvent(
      v2FixtureDomainEvent(v1, "historic-one"),
    );
    const historic = v1.backend.ledger.read();
    const value = openLedgerV2Fixture(directory);
    expect(isEvolutionLedgerV2Journal(value.backend.ledger)).toBe(true);
    expect(value.journal.read().slice(0, historic.length)).toEqual(historic);
    expect(markers(value.journal.read())).toHaveLength(2);
    expect(value.journal.verifyReceipt(oldReceipt).valid).toBe(true);
    const before = { ...value.manifest.counts };
    const finalized = value.journal.finalizeDomainEventBatch([
      v2FixtureDomainEvent(value, "live-one"),
      v2FixtureDomainEvent(value, "live-two"),
    ]);
    for (const field of ["retain", "catalog", "head", "witness"])
      expect(value.manifest.counts[field] - before[field]).toBe(1);
    expect(
      finalized.checkpoint.sequenceEnd - finalized.checkpoint.sequenceStart,
    ).toBe(1);
    expect(finalized.checkpoint.manifest.eventDigests).toEqual(
      finalized.receipt.eventDigests,
    );
    expect(finalized.checkpoint.witness.anchorDigest).toBe(
      finalized.checkpoint.manifest.manifestDigest,
    );
    expect(finalized.checkpoint.witness.headDigest).toBe(
      finalized.checkpoint.head.headDigest,
    );
    expect(finalized.checkpoint.witnessDigest).toBe(
      finalized.checkpoint.witness.witnessDigest,
    );
    const complete = value.journal.read();
    const retained = fs
      .readdirSync(value.manifest.segmentDirectory)
      .map((name) =>
        JSON.parse(
          fs.readFileSync(
            path.join(value.manifest.segmentDirectory, name),
            "utf8",
          ),
        ),
      );
    const payloads = retained.map((record) =>
      JSON.parse(Buffer.from(record.bytes, "base64").toString("utf8")),
    );
    expect(
      payloads
        .flatMap((payload) => payload.events)
        .sort((a, b) => a.sequence - b.sequence),
    ).toEqual(complete);
    const reopened = child(directory, "read");
    expect(reopened.status, reopened.stderr).toBe(0);
    const readback = JSON.parse(reopened.stdout);
    expect(readback.events).toEqual(complete);
    expect(readback.checkpoint.witness.witnessDigest).toBe(
      finalized.checkpoint.witnessDigest,
    );
    expect(openLedgerV2Fixture(directory).manifest.counts.retain).toBe(0);
    expect(() =>
      v1.backend.ledger.appendDomainEvent(
        v2FixtureDomainEvent(v1, "direct-v1"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_V2_REQUIRED" }),
    );
    expect(() => openEvolutionDurableStore(directory)).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_V2_REQUIRED" }),
    );
  });

  it.each(["crash-intent", "crash-completed"])(
    "recovers %s after signed WAL witness publication without duplicating migration records",
    (mode) => {
      const directory = root();
      const v1 = openEvolutionDurableStore(directory);
      v1.backend.ledger.appendDomainEvent(v2FixtureDomainEvent(v1, "history"));
      const crashed = child(directory, mode);
      expect(crashed.status, crashed.stderr).toBe(73);
      const recovered = child(directory, "read");
      expect(recovered.status, recovered.stderr).toBe(0);
      const data = JSON.parse(recovered.stdout);
      expect(
        data.events.filter((event) => event.eventId === "history"),
      ).toHaveLength(1);
      expect(markers(data.events)).toHaveLength(2);
      expect(data.events).toHaveLength(3);
      const again = child(directory, "read");
      expect(again.status, again.stderr).toBe(0);
      expect(JSON.parse(again.stdout)).toEqual(data);
    },
  );

  it.each(["after-retain", "after-catalog", "after-head", "after-witness"])(
    "resumes migration idempotently after %s loses its acknowledgement",
    (phase) => {
      const directory = root();
      let armed = true;
      expect(() =>
        openLedgerV2Fixture(directory, {
          fault(observed) {
            if (armed && observed === phase) {
              armed = false;
              throw new Error("injected lost acknowledgement");
            }
          },
        }),
      ).toThrow();
      const value = openLedgerV2Fixture(directory);
      expect(markers(value.journal.read())).toHaveLength(2);
      expect(value.journal.read()).toEqual(value.manifest.backend.readEvents());
      expect(openLedgerV2Fixture(directory).manifest.counts.retain).toBe(0);
    },
  );

  it("reports a partially witnessed v1 batch as unknown and recovers only the authenticated prefix without duplicates", () => {
    const directory = root();
    let armed = false;
    const value = openLedgerV2Fixture(directory, {
      crashHook(phase) {
        if (armed && phase === "after-witness") {
          armed = false;
          throw new Error("v1 first event acknowledgement lost");
        }
      },
    });
    const initial = value.manifest.backend.read().head.sequence;
    const inputs = [
      v2FixtureDomainEvent(value, "partial-one"),
      v2FixtureDomainEvent(value, "partial-two"),
    ];
    armed = true;
    expect(() => value.journal.finalizeDomainEventBatch(inputs)).toThrowError(
      expect.objectContaining({
        code: "CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN",
        commitState: "unknown",
        cause: expect.objectContaining({
          code: "CC_EVOLUTION_LEDGER_COMMIT_UNKNOWN",
          commitState: "unknown",
        }),
      }),
    );
    expect(value.manifest.backend.read().head.sequence).toBe(initial);
    const reopened = child(directory, "read");
    expect(reopened.status, reopened.stderr).toBe(0);
    const recovered = JSON.parse(reopened.stdout);
    expect(
      recovered.events.filter((event) => event.eventId === "partial-one"),
    ).toHaveLength(1);
    expect(
      recovered.events.filter((event) => event.eventId === "partial-two"),
    ).toHaveLength(0);
    expect(recovered.checkpoint.head.sequence).toBe(initial + 1);
    expect(openLedgerV2Fixture(directory).manifest.counts.retain).toBe(0);
  });

  it.each([
    ["crash-live-wal", 73, 1],
    ["crash-live-manifest", 74, 2],
  ])("recovers a killed process at %s", (mode, exit, count) => {
    const directory = root();
    const initial = openLedgerV2Fixture(directory).journal.read().length;
    const crashed = child(directory, mode);
    expect(crashed.status, crashed.stderr).toBe(exit);
    const reopened = child(directory, "read");
    expect(reopened.status, reopened.stderr).toBe(0);
    const recovered = JSON.parse(reopened.stdout);
    expect(recovered.events.length).toBe(initial + count);
    expect(new Set(recovered.events.map((event) => event.eventId)).size).toBe(
      recovered.events.length,
    );
    expect(recovered.checkpoint.head.sequence).toBe(initial + count);
  });

  it("fails closed on structural authorities, oversized batches, rebinding, and completed-backend rollback", () => {
    const directory = root();
    expect(() =>
      openEvolutionDurableStore(directory, {
        createManifestBackend: () => ({ readEvents: () => [] }),
      }),
    ).toThrow(/branded/u);
    const value = openLedgerV2Fixture(directory);
    const before = value.journal.read();
    const input = v2FixtureDomainEvent(value, "oversized");
    expect(() =>
      value.journal.appendDomainEventBatch(Array(9).fill(input)),
    ).toThrow(/one manifest/u);
    expect(value.journal.read()).toEqual(before);
    expect(() =>
      openLedgerV2Fixture(directory, { authorityRevision: 2 }),
    ).toThrow();
    expect(() =>
      openEvolutionDurableStore(directory, {
        createManifestBackend: (request) =>
          createLedgerV2FixtureBackend(
            path.join(directory, "replacement"),
            request,
          ).backend,
      }),
    ).toThrow(/rolled back/u);
  });

  it("refuses tampered payload bytes even when v1 WAL and signed manifest files remain intact", () => {
    const directory = root();
    const value = openLedgerV2Fixture(directory);
    value.journal.appendDomainEvent(
      v2FixtureDomainEvent(value, "protected-payload"),
    );
    const file = path.join(
      value.manifest.segmentDirectory,
      fs.readdirSync(value.manifest.segmentDirectory)[0],
    );
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const bytes = Buffer.from(record.bytes, "base64");
    bytes[10] ^= 1;
    fs.writeFileSync(
      file,
      JSON.stringify({ ...record, bytes: bytes.toString("base64") }),
    );
    expect(() => value.journal.read()).toThrow();
    expect(() => openLedgerV2Fixture(directory)).toThrow();
  });
});
