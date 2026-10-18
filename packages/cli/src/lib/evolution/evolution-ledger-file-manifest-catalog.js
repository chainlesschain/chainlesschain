import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";
import {
  createEvolutionManifestStateReader,
  captureEvolutionManifestStateReaderDirectoryBoundary,
} from "./evolution-manifest-state-reader.js";
import { EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA } from "./evolution-ledger-manifest-catalog.js";

export const EVOLUTION_LEDGER_FILE_MANIFEST_CATALOG_SCHEMA =
  "chainlesschain.evolution-ledger-file-manifest-catalog/v2";

const STATE_SCHEMA =
  "chainlesschain.evolution-ledger-file-manifest-catalog-state/v2";
const STATE_KEYS = new Set(["manifests", "schema"]);
const DEFAULT_MAXIMUM_BYTES = 64 * 1024 * 1024;
const DIRECTORY_BOUNDARIES = new WeakMap();

function exactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(fields);
  if (names.length !== keys.size || names.some((name) => !keys.has(name))) {
    throw new Error(`${label} fields are invalid`);
  }
  for (const name of names) {
    if (!("value" in fields[name]))
      throw new Error(`${label}.${name} must be own data`);
  }
  return fields;
}

function syncDirectory(fsImpl, directory) {
  let descriptor;
  try {
    descriptor = fsImpl.openSync(directory, "r");
    fsImpl.fsyncSync(descriptor);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fsImpl.closeSync(descriptor);
  }
}

export function createEvolutionLedgerFileManifestCatalogBackend({
  directoryPath,
  fsImpl = fs,
  lock = withFileLock,
  maximumBytes = DEFAULT_MAXIMUM_BYTES,
  random = () => crypto.randomBytes(16).toString("hex"),
} = {}) {
  if (typeof directoryPath !== "string" || directoryPath.trim() === "") {
    throw new TypeError("manifest catalog directoryPath is required");
  }
  if (typeof lock !== "function" || typeof random !== "function") {
    throw new TypeError("manifest catalog lock and random ports are required");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 4096) {
    throw new TypeError("manifest catalog maximumBytes must be at least 4096");
  }
  const directory = path.resolve(directoryPath);
  const file = path.join(directory, "manifest-catalog.json");
  const secureOptions = { deps: { fs: fsImpl }, failIfUnavailable: true };
  ensurePrivateDirectory(directory, secureOptions);

  const stateReader = createEvolutionManifestStateReader({
    file,
    fsImpl,
    maximumBytes,
    label: "manifest catalog",
  });
  const readBytes = stateReader.read;

  const readState = () => {
    const bytes = readBytes();
    if (bytes === null) return { manifests: [], schema: STATE_SCHEMA };
    let parsed;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error("manifest catalog is not valid UTF-8 JSON");
    }
    const fields = exactRecord(parsed, STATE_KEYS, "manifest catalog state");
    if (
      fields.schema.value !== STATE_SCHEMA ||
      !Array.isArray(fields.manifests.value)
    ) {
      throw new Error("manifest catalog state is invalid");
    }
    if (
      Object.keys(fields.manifests.value).length !==
      fields.manifests.value.length
    ) {
      throw new Error("manifest catalog manifests must be dense");
    }
    return parsed;
  };

  const writeState = (state) => {
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`, "utf8");
    if (bytes.length > maximumBytes)
      throw new Error("manifest catalog exceeds maximumBytes");
    const token = random();
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/u.test(token)) {
      throw new Error("manifest catalog random token is invalid");
    }
    const temporary = `${file}.${token}.tmp`;
    let descriptor;
    try {
      descriptor = fsImpl.openSync(temporary, "wx", 0o600);
      fsImpl.writeFileSync(descriptor, bytes);
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      fsImpl.renameSync(temporary, file);
      ensurePrivateFile(file, secureOptions);
      descriptor = fsImpl.openSync(file, "r+");
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      syncDirectory(fsImpl, directory);
      const readback = readBytes();
      if (readback === null || !readback.equals(bytes)) {
        throw new Error("manifest catalog durable readback differs");
      }
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch {
        // A private incomplete staging file cannot change the committed catalog.
      }
    }
  };

  const backend = Object.freeze({
    descriptor: Object.freeze({
      file,
      localOnly: true,
      schema: EVOLUTION_LEDGER_FILE_MANIFEST_CATALOG_SCHEMA,
    }),
    compareAndAppend(request) {
      stateReader.recheck();
      return lock(
        file,
        () => {
          const state = readState();
          const latest = state.manifests.at(-1) ?? null;
          if (
            (latest?.manifestDigest ?? null) !== request.expectedManifestDigest
          ) {
            return Object.freeze({
              appended: false,
              latest,
              schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
            });
          }
          const next = {
            manifests: [...state.manifests, structuredClone(request.manifest)],
            schema: STATE_SCHEMA,
          };
          writeState(next);
          return Object.freeze({
            appended: true,
            latest: structuredClone(request.manifest),
            schema: EVOLUTION_LEDGER_MANIFEST_CATALOG_APPEND_RESULT_SCHEMA,
          });
        },
        { _fs: fsImpl, failIfUnavailable: true },
      );
    },
    list() {
      return structuredClone(readState().manifests);
    },
    loadLatest() {
      return structuredClone(readState().manifests.at(-1) ?? null);
    },
  });
  DIRECTORY_BOUNDARIES.set(
    backend,
    captureEvolutionManifestStateReaderDirectoryBoundary(stateReader),
  );
  return backend;
}

/** Original local catalog directory only; structural wrappers are not owners. */
export function captureEvolutionLedgerFileManifestCatalogDirectoryBoundary(
  backend,
) {
  if (arguments.length !== 1)
    throw new TypeError("catalog directory capture takes one original backend");
  const boundary = DIRECTORY_BOUNDARIES.get(backend);
  if (!boundary)
    throw new TypeError(
      "an original file manifest catalog backend is required",
    );
  boundary.recheck();
  return boundary;
}
