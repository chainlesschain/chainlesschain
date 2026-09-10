import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { ensurePrivateDirectory, ensurePrivateFile } from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";
import { readBoundedDescriptor } from "./bounded-descriptor-read.js";
import { EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA } from "./evolution-ledger-manifest-head-store.js";

export const EVOLUTION_LEDGER_FILE_MANIFEST_HEAD_BACKEND_SCHEMA =
  "chainlesschain.evolution-ledger-file-manifest-head-backend/v2";

const STATE_SCHEMA =
  "chainlesschain.evolution-ledger-file-manifest-head-state/v2";
const STATE_KEYS = new Set(["head", "schema"]);
const DEFAULT_MAXIMUM_BYTES = 256 * 1024;

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

function requiredDirectory(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("manifest head directoryPath is required");
  }
  return path.resolve(value);
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

function headDigest(value) {
  if (value === null) return null;
  const field = Object.getOwnPropertyDescriptor(value, "headDigest");
  if (
    !field ||
    !("value" in field) ||
    typeof field.value !== "string"
  ) {
    throw new Error("manifest head record has no own headDigest");
  }
  return field.value;
}

export function createEvolutionLedgerFileManifestHeadBackend({
  directoryPath,
  fsImpl = fs,
  lock = withFileLock,
  maximumBytes = DEFAULT_MAXIMUM_BYTES,
  random = () => crypto.randomBytes(16).toString("hex"),
  crashHook = null,
} = {}) {
  const directory = requiredDirectory(directoryPath);
  if (
    typeof lock !== "function" ||
    typeof random !== "function" ||
    (crashHook !== null && typeof crashHook !== "function")
  ) {
    throw new TypeError(
      "manifest head lock, random, and crashHook ports are invalid",
    );
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 4096) {
    throw new TypeError("manifest head maximumBytes must be at least 4096");
  }
  const file = path.join(directory, "manifest-head.json");
  const secureOptions = { deps: { fs: fsImpl }, failIfUnavailable: true };
  ensurePrivateDirectory(directory, secureOptions);

  const invokeCrashHook = (phase, details) => {
    if (crashHook !== null) crashHook(phase, Object.freeze(details));
  };

  const readBytes = () => {
    if (!fsImpl.existsSync(file)) return null;
    const stat = fsImpl.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error("manifest head file identity is invalid");
    }
    if (stat.size > maximumBytes)
      throw new Error("manifest head exceeds maximumBytes");
    let descriptor;
    try {
      descriptor = fsImpl.openSync(
        file,
        fsImpl.constants.O_RDONLY | (fsImpl.constants.O_NOFOLLOW || 0),
      );
      const opened = fsImpl.fstatSync(descriptor);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size !== stat.size) {
        throw new Error("manifest head changed while opening");
      }
      const bytes = readBoundedDescriptor(
        fsImpl,
        descriptor,
        stat.size,
        maximumBytes,
      );
      const after = fsImpl.lstatSync(file);
      if (
        after.isSymbolicLink() ||
        after.nlink !== 1 ||
        after.size !== stat.size
      ) {
        throw new Error("manifest head changed while reading");
      }
      return bytes;
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
    }
  };

  const readState = () => {
    const bytes = readBytes();
    if (bytes === null) return { head: null, schema: STATE_SCHEMA };
    let parsed;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error("manifest head is not valid UTF-8 JSON");
    }
    const fields = exactRecord(parsed, STATE_KEYS, "manifest head state");
    if (fields.schema.value !== STATE_SCHEMA) {
      throw new Error("manifest head state schema is invalid");
    }
    const head = fields.head.value;
    if (
      head !== null &&
      (!head ||
        typeof head !== "object" ||
        Array.isArray(head) ||
        utilTypes.isProxy(head))
    ) {
      throw new Error("manifest head state record is invalid");
    }
    headDigest(head);
    return parsed;
  };

  const writeState = (state) => {
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`, "utf8");
    if (bytes.length > maximumBytes)
      throw new Error("manifest head exceeds maximumBytes");
    const token = random();
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/u.test(token)) {
      throw new Error("manifest head random token is invalid");
    }
    const temporary = `${file}.${token}.tmp`;
    let descriptor;
    try {
      descriptor = fsImpl.openSync(temporary, "wx", 0o600);
      fsImpl.writeFileSync(descriptor, bytes);
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      invokeCrashHook("after-stage", { file, temporary });
      fsImpl.renameSync(temporary, file);
      ensurePrivateFile(file, secureOptions);
      descriptor = fsImpl.openSync(file, "r+");
      fsImpl.fsyncSync(descriptor);
      fsImpl.closeSync(descriptor);
      descriptor = undefined;
      syncDirectory(fsImpl, directory);
      invokeCrashHook("after-rename", { file });
      const readback = readBytes();
      if (readback === null || !readback.equals(bytes)) {
        throw new Error("manifest head durable readback differs");
      }
    } finally {
      if (descriptor !== undefined) fsImpl.closeSync(descriptor);
      try {
        if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      } catch {
        // A private incomplete staging file cannot change the committed head.
      }
    }
  };

  return Object.freeze({
    descriptor: Object.freeze({
      file,
      localOnly: true,
      schema: EVOLUTION_LEDGER_FILE_MANIFEST_HEAD_BACKEND_SCHEMA,
    }),
    load() {
      return structuredClone(readState().head);
    },
    compareAndSet(request) {
      return lock(
        file,
        () => {
          const state = readState();
          const current = state.head;
          if (headDigest(current) !== request.expectedHeadDigest) {
            return Object.freeze({
              committed: false,
              head: structuredClone(current),
              schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
            });
          }
          const next = structuredClone(request.nextHead);
          writeState({ head: next, schema: STATE_SCHEMA });
          return Object.freeze({
            committed: true,
            head: structuredClone(next),
            schema: EVOLUTION_LEDGER_MANIFEST_HEAD_CAS_RESULT_SCHEMA,
          });
        },
        { _fs: fsImpl, failIfUnavailable: true },
      );
    },
  });
}
