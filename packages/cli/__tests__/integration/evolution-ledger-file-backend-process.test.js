import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runBackendProcess } from "../helpers/evolution-ledger-process.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("EvolutionLedger file backend process restart", () => {
  it("reopens across OS processes and rejects local reincarnation behind the witness", async () => {
    const root = fs.mkdtempSync(
      path.join(
        fs.realpathSync.native(os.tmpdir()),
        "cc-ledger-process-restart-",
      ),
    );
    roots.push(root);
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });

    const first = await runBackendProcess(root);
    const second = await runBackendProcess(root);
    expect(first).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        verification: { sequence: 0, eventCount: 0 },
        witness: { generation: 1, status: "committed" },
      },
    });
    expect(second).toMatchObject({
      code: 0,
      signal: null,
      result: {
        ok: true,
        verification: {
          ledgerId: first.result.verification.ledgerId,
          epoch: first.result.verification.epoch,
          witnessDigest: first.result.verification.witnessDigest,
        },
        witness: {
          witnessDigest: first.result.witness.witnessDigest,
        },
      },
    });
    expect(second.result.pid).not.toBe(first.result.pid);

    const eventRoot = path.resolve(root, "events");
    const authorityRoot = path.resolve(root, "authority");
    expect(eventRoot.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
    expect(authorityRoot.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(
      true,
    );
    fs.rmSync(eventRoot, { recursive: true, force: true });
    fs.rmSync(authorityRoot, { recursive: true, force: true });

    const reincarnation = await runBackendProcess(root);
    expect(reincarnation).toMatchObject({
      code: 2,
      signal: null,
      result: {
        ok: false,
        code: "CC_EVOLUTION_LEDGER_CORRUPT",
      },
    });
  }, 30_000);
});
