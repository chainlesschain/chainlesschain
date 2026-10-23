import fs from "node:fs";
import path from "node:path";

import { ArtifactStore } from "../artifact-store.js";
import {
  EvolutionArtifactPorts,
  captureEvolutionArtifactStoreDirectoryBoundary,
  captureEvolutionLedgerBatchReadWindow,
} from "./evolution-artifact-ports.js";

export const EVOLUTION_TYPED_EVIDENCE_LAYOUT = "typed-evidence-v1";
export const EVOLUTION_EVIDENCE_STORAGE_TYPES = Object.freeze([
  "source-evidence",
  "model-projection",
  "trusted-projection",
  "receipt",
  "evidence",
]);

export function validateEvidenceStorageLayout(value) {
  if (value !== "legacy" && value !== EVOLUTION_TYPED_EVIDENCE_LAYOUT)
    throw new TypeError("Unsupported Evidence storage layout");
  return value;
}

// Callers must supply events freshly authenticated by the genuine Run adapter.
// A later event, projection, or sidecar is never a layout authority.
export function evidenceStorageLayoutForRun(events, emptyLayout = "legacy") {
  validateEvidenceStorageLayout(emptyLayout);
  if (events.length === 0) return emptyLayout;
  const data = events[0].data;
  if (!data || !Object.hasOwn(data, "evidenceStorageLayout")) return "legacy";
  if (data.evidenceStorageLayout !== EVOLUTION_TYPED_EVIDENCE_LAYOUT)
    throw new TypeError("Unsupported authenticated Evidence storage layout");
  return EVOLUTION_TYPED_EVIDENCE_LAYOUT;
}

function physicalStore(directory) {
  return [
    directory,
    path.join(directory, "files"),
    path.join(directory, "index.jsonl"),
  ].map((location, index) => {
    const stat = fs.lstatSync(location, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (index < 2 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
    )
      throw new Error(
        "Typed Evidence store must retain physical directories and a single-link index",
      );
    return {
      location,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeNs: stat.birthtimeNs,
    };
  });
}

/** Separate genuine stores; no change to artifact locators or ledger authority. */
export function createTypedEvidenceArtifactPorts({
  rootDir,
  tenantId,
  audience,
  artifactAuthority,
  now,
  existingRun,
}) {
  const directories = EVOLUTION_EVIDENCE_STORAGE_TYPES.map((type) =>
    path.join(rootDir, type),
  );
  // Preflight every shard before any constructor can recreate a missing one.
  const before = existingRun ? directories.map(physicalStore) : null;
  const result = {};
  const identities = new Set();
  for (const [index, type] of EVOLUTION_EVIDENCE_STORAGE_TYPES.entries()) {
    const port = new EvolutionArtifactPorts({
      tenantId,
      audience,
      artifactStore: new ArtifactStore({ dir: directories[index], now }),
      allowedTypes: [type],
      envelopeSigner: artifactAuthority.envelopeSigner,
      envelopeVerifier: artifactAuthority.envelopeVerifier,
      currentAuthorityResolver: artifactAuthority.currentAuthorityResolver,
      now,
    });
    const boundary = captureEvolutionArtifactStoreDirectoryBoundary(port);
    const after = physicalStore(directories[index]);
    for (const [entryIndex, entry] of after.entries()) {
      const previous = before?.[index][entryIndex];
      if (
        previous &&
        ["dev", "ino", "birthtimeNs"].some(
          (key) => previous[key] !== entry[key],
        )
      )
        throw new Error("Typed Evidence store identity changed during reopen");
      const identity = `${entry.dev}:${entry.ino}`;
      if (identities.has(identity))
        throw new Error("Typed Evidence stores must be distinct");
      identities.add(identity);
    }
    boundary.recheck();
    // Authenticate bounded index structure through the original port reader.
    // Payloads and current authority remain freshly checked on actual reads.
    captureEvolutionLedgerBatchReadWindow(
      port.createEvolutionLedgerArtifactResolver({
        purpose: "evidence-projection",
      }),
    )(() => undefined);
    result[type] = port;
  }
  return Object.freeze(result);
}
