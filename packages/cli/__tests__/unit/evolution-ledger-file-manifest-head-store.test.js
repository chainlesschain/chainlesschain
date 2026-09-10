import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createEvolutionLedgerFileManifestHeadBackend } from "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js";
import {
  EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA,
  createEvolutionLedgerManifestAuthority,
} from "../../src/lib/evolution/evolution-ledger-manifest-chain.js";
import {
  EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE,
  createEvolutionLedgerManifestHeadStore,
} from "../../src/lib/evolution/evolution-ledger-manifest-head-store.js";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function descriptor() {
  return {
    epoch: "epoch-file-head",
    ledgerId: "ledger-file-head",
    maximumEventsPerSegment: 16,
    tenantId: "tenant-file-head",
  };
}

function authority() {
  return createEvolutionLedgerManifestAuthority({
    descriptor: {
      algorithm: "test-signature",
      authorityId: "file-head-authority",
      revision: 1,
    },
    sign: () => "test-signature",
    verify: ({ signature }) => signature === "test-signature",
  });
}

function head(sequence, previousHeadDigest = null) {
  const core = {
    authorityAlgorithm: "test-signature",
    authorityId: "file-head-authority",
    authorityRevision: 1,
    epoch: "epoch-file-head",
    eventDigest: sha256(`event-${sequence}`),
    issuedAt: "2026-09-10T00:00:00.000Z",
    ledgerId: "ledger-file-head",
    manifestDigest: sha256(`manifest-${sequence}`),
    manifestSequence: sequence,
    previousHeadDigest,
    schema: EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA,
    sequence,
    tenantId: "tenant-file-head",
  };
  return Object.freeze({
    ...core,
    headDigest: sha256(
      Buffer.concat([
        Buffer.from("ledger-manifest-head\0", "utf8"),
        Buffer.from(canonical(core), "utf8"),
      ]),
    ),
    signature: "test-signature",
  });
}

function temporaryRoot() {
  return fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-file-manifest-head-"),
  );
}

function store(directory, options = {}) {
  const backend = createEvolutionLedgerFileManifestHeadBackend({
    directoryPath: directory,
    ...options,
  });
  return {
    backend,
    store: createEvolutionLedgerManifestHeadStore({
      authority: authority(),
      compareAndSet: backend.compareAndSet,
      descriptor: descriptor(),
      load: backend.load,
    }),
  };
}

function capturedError(operation) {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to fail");
}

describe("Evolution Ledger file manifest head backend", () => {
  it("durably commits, reopens, and rejects a stale CAS", () => {
    const root = temporaryRoot();
    try {
      const first = store(root);
      const firstHead = head(1);
      expect(
        first.store.commit({ expectedHeadDigest: null, nextHead: firstHead }),
      ).toMatchObject({ committed: true, head: firstHead });
      expect(first.backend.descriptor.localOnly).toBe(true);

      const reopened = store(root);
      expect(reopened.store.read()).toEqual(firstHead);
      const staleProposal = head(2, null);
      expect(
        reopened.store.commit({
          expectedHeadDigest: null,
          nextHead: staleProposal,
        }),
      ).toMatchObject({ committed: false, conflict: true, head: firstHead });
      expect(reopened.store.read()).toEqual(firstHead);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not commit when interrupted before rename", () => {
    const root = temporaryRoot();
    try {
      const value = store(root, {
        crashHook(phase) {
          if (phase === "after-stage") throw new Error("forced before rename");
        },
      });
      expect(
        capturedError(() =>
          value.store.commit({ expectedHeadDigest: null, nextHead: head(1) }),
        ).code,
      ).toBe(EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE);
      expect(store(root).store.read()).toBeNull();
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it("reports commit unknown after rename and exposes the committed head on reopen", () => {
    const root = temporaryRoot();
    try {
      const expected = head(1);
      const value = store(root, {
        crashHook(phase) {
          if (phase === "after-rename") throw new Error("lost acknowledgement");
        },
      });
      expect(
        capturedError(() =>
          value.store.commit({ expectedHeadDigest: null, nextHead: expected }),
        ).code,
      ).toBe(EVOLUTION_LEDGER_MANIFEST_HEAD_STORE_COMMIT_UNKNOWN_CODE);
      expect(store(root).store.read()).toEqual(expected);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects hard-linked and malformed state files", () => {
    const root = temporaryRoot();
    try {
      const value = store(root);
      value.store.commit({ expectedHeadDigest: null, nextHead: head(1) });
      fs.linkSync(
        value.backend.descriptor.file,
        path.join(root, "manifest-head-alias.json"),
      );
      expect(capturedError(() => value.store.read()).cause?.message).toMatch(
        /file identity is invalid/u,
      );
      fs.unlinkSync(path.join(root, "manifest-head-alias.json"));
      fs.writeFileSync(value.backend.descriptor.file, "{not-json}\n");
      expect(capturedError(() => value.store.read()).cause?.message).toMatch(
        /not valid UTF-8 JSON/u,
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});
