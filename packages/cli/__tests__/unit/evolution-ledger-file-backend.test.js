import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_LEDGER_FILE_BACKEND_SCHEMA,
  captureEvolutionLedgerFileBackend,
  createEvolutionLedgerFileBackend,
} from "../../src/lib/evolution/evolution-ledger-file-backend.js";

const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -30_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function authority(label) {
  const secret = `test-only-${label}-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const value = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: {
      sign: ({ message }) => ({ ...trust, value: value(message) }),
    },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === value(message),
    },
  };
}

describe("createEvolutionLedgerFileBackend", () => {
  let root;
  let options;

  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-evolution-file-backend-"),
    );
    fs.mkdirSync(path.join(root, "witness"), { mode: 0o700 });
    options = {
      rootDir: path.join(root, "events"),
      authorityRootDir: path.join(root, "authority"),
      witnessFilePath: path.join(root, "witness", "checkpoint.json"),
      witnessId: "witness-file-backend-test",
      ledgerAuthority: authority("ledger-file-backend"),
      witnessAuthority: authority("witness-file-backend"),
      artifactResolver: () => {
        throw new Error("empty ledger must not resolve artifacts");
      },
      clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
      fsImpl: durableFilesystem(),
      secure: false,
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reopens one ledger through an independently signed durable witness", () => {
    const first = createEvolutionLedgerFileBackend(options);
    const firstState = first.ledger.verify();
    expect(first).toMatchObject({
      schema: EVOLUTION_LEDGER_FILE_BACKEND_SCHEMA,
      descriptor: {
        witnessId: options.witnessId,
        ledgerTrust: options.ledgerAuthority.trust,
        witnessTrust: options.witnessAuthority.trust,
      },
    });
    expect(firstState).toMatchObject({ sequence: 0, eventCount: 0 });
    expect(first.descriptor).not.toHaveProperty("signer");
    expect(first.descriptor).not.toHaveProperty("verifier");
    expect(captureEvolutionLedgerFileBackend(first)).toBe(first);

    const reopened = createEvolutionLedgerFileBackend(options);
    expect(reopened.ledger.verify()).toEqual(firstState);
    expect(reopened.witness.read()).toEqual(first.witness.read());
  });

  it("rejects shared authority roots and overlapping witness storage", () => {
    expect(() =>
      createEvolutionLedgerFileBackend({
        ...options,
        witnessAuthority: options.ledgerAuthority,
      }),
    ).toThrow(/independent trust/u);
    expect(() =>
      createEvolutionLedgerFileBackend({
        ...options,
        witnessFilePath: path.join(options.authorityRootDir, "witness.json"),
      }),
    ).toThrow(/independent and non-overlapping/u);
    expect(() => captureEvolutionLedgerFileBackend({})).toThrow(/branded/u);
  });
});
