import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function authority(label, secret) {
  if (!secret) throw new Error(`${label} test secret is unavailable`);
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://process-test/${label}`,
    trustPolicyDigest: digest(`${label}-process-policy`),
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

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -40_000;
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

try {
  const root = path.resolve(process.argv[2]);
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "events"),
    authorityRootDir: path.join(root, "authority"),
    witnessFilePath: path.join(root, "witness", "checkpoint.json"),
    witnessId: "witness-process-restart",
    ledgerAuthority: authority(
      "ledger-restart",
      process.env.CC_TEST_LEDGER_SECRET,
    ),
    witnessAuthority: authority(
      "witness-restart",
      process.env.CC_TEST_WITNESS_SECRET,
    ),
    artifactResolver: () => {
      throw new Error("empty restart ledger must not resolve artifacts");
    },
    fsImpl: durableFilesystem(),
    secure: false,
    clock: () => Date.parse("2026-09-02T00:00:00.000Z"),
  });
  const verification = backend.ledger.verify();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      pid: process.pid,
      verification,
      witness: backend.witness.read(),
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      pid: process.pid,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    })}\n`,
  );
  process.exitCode = 2;
}
