import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { sameFileStatIdentity } from "./secure-file-identity.js";
import { withFileLock } from "./with-file-lock.js";

export const ARTIFACT_ACCESS_EVENT_SCHEMA = "cc-artifact-content-access/v1";
export const ARTIFACT_ACCESS_LEDGER_SCHEMA =
  "cc-artifact-content-access-ledger/v1";

export const ARTIFACT_ACCESS_CLIENTS = Object.freeze([
  "cli",
  "vscode",
  "jetbrains",
  "websocket",
  "web",
]);
export const ARTIFACT_ACCESS_ACTIONS = Object.freeze([
  "open",
  "preview",
  "download",
  "copy-path",
  "reveal",
  "open-external",
]);

const ACCESS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_LEDGER_EVENTS = 100_000;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "artifactAccessLedger"), "utf8")
    .digest("hex")}`;
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has an invalid schema`);
  }
  return value;
}

function normalizeOptionalDigest(value, label) {
  if (value === null) return null;
  const normalized = String(value || "");
  if (!SHA256_RE.test(normalized)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function normalizeOptionalId(value, label) {
  if (value === null) return null;
  const normalized = String(value || "");
  if (!ACCESS_ID_RE.test(normalized)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

export function normalizeArtifactAccessEvent(input, previous = null) {
  const value = exactObject(
    input,
    [
      "schema",
      "sequence",
      "previousEventDigest",
      "accessId",
      "artifactId",
      "artifactSha256",
      "recordDigest",
      "artifactSessionId",
      "client",
      "action",
      "authorizedAt",
      "authorization",
      "eventDigest",
    ],
    "artifact access event",
  );
  const sequence = Number(value.sequence);
  const accessId = String(value.accessId || "");
  const artifactId = String(value.artifactId || "");
  const artifactSha256 = String(value.artifactSha256 || "");
  const client = String(value.client || "");
  const action = String(value.action || "");
  const authorizedAt = String(value.authorizedAt || "");
  const previousEventDigest = normalizeOptionalDigest(
    value.previousEventDigest,
    "artifact access predecessor digest",
  );
  const recordDigest = normalizeOptionalDigest(
    value.recordDigest,
    "artifact record digest",
  );
  const artifactSessionId = normalizeOptionalId(
    value.artifactSessionId,
    "artifact session id",
  );
  if (
    value.schema !== ARTIFACT_ACCESS_EVENT_SCHEMA ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !ACCESS_ID_RE.test(accessId) ||
    !ARTIFACT_ID_RE.test(artifactId) ||
    !SHA256_RE.test(artifactSha256) ||
    !ARTIFACT_ACCESS_CLIENTS.includes(client) ||
    !ARTIFACT_ACCESS_ACTIONS.includes(action) ||
    !Number.isFinite(Date.parse(authorizedAt)) ||
    value.authorization !== "current-artifact-index-and-byte-readback" ||
    !SHA256_RE.test(String(value.eventDigest || ""))
  ) {
    throw new TypeError("artifact access event is invalid");
  }
  if (
    sequence !== (previous?.sequence || 0) + 1 ||
    previousEventDigest !== (previous?.eventDigest || null)
  ) {
    throw new Error("artifact access event chain is invalid");
  }
  const material = {
    schema: value.schema,
    sequence,
    previousEventDigest,
    accessId,
    artifactId,
    artifactSha256,
    recordDigest,
    artifactSessionId,
    client,
    action,
    authorizedAt,
    authorization: value.authorization,
  };
  if (
    value.eventDigest !==
    digest("chainlesschain.artifact.content-access-event.v1\0", material)
  ) {
    throw new Error("artifact access event digest is invalid");
  }
  return Object.freeze({ ...material, eventDigest: value.eventDigest });
}

function ledgerPath(store) {
  return path.join(path.resolve(store.dir), "content-access.jsonl");
}

function readLedgerBytes(filePath, runtimeFs) {
  let before;
  try {
    before = runtimeFs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    Number(before.nlink) !== 1 ||
    Number(before.size) > MAX_LEDGER_BYTES
  ) {
    throw new Error("artifact access ledger identity is invalid");
  }
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      filePath,
      runtimeFs.constants.O_RDONLY |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
    );
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      !sameFileStatIdentity(before, opened)
    ) {
      throw new Error("artifact access ledger handle is invalid");
    }
    const bytes = runtimeFs.readFileSync(descriptor);
    const after = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      bytes.length > MAX_LEDGER_BYTES ||
      Number(after.size) !== bytes.length ||
      !sameFileStatIdentity(opened, after)
    ) {
      throw new Error("artifact access ledger changed while reading");
    }
    return bytes;
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

function parseLedger(bytes) {
  if (bytes.length === 0) return [];
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("artifact access ledger is not strict UTF-8");
  }
  if (!text.endsWith("\n")) {
    throw new Error("artifact access ledger has a truncated tail");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length > MAX_LEDGER_EVENTS) {
    throw new Error("artifact access ledger exceeds its event limit");
  }
  const events = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("artifact access ledger contains invalid JSON");
    }
    events.push(normalizeArtifactAccessEvent(parsed, events.at(-1) || null));
  }
  return events;
}

export function readArtifactAccessLedger(store, options = {}) {
  if (!store?.dir || typeof store.list !== "function") {
    throw new TypeError("artifact access ledger requires an ArtifactStore");
  }
  const runtimeFs = options.fs || fs;
  const events = parseLedger(readLedgerBytes(ledgerPath(store), runtimeFs));
  return Object.freeze({
    schema: ARTIFACT_ACCESS_LEDGER_SCHEMA,
    eventCount: events.length,
    headDigest: events.at(-1)?.eventDigest || null,
    events: Object.freeze(events),
  });
}

function normalizeAccessRequest(input = {}) {
  const accessId = String(
    input.accessId || `access_${randomUUID().replaceAll("-", "")}`,
  );
  const artifactId = String(input.artifactId || "");
  const client = String(input.client || "");
  const action = String(input.action || "");
  if (
    !ACCESS_ID_RE.test(accessId) ||
    !ARTIFACT_ID_RE.test(artifactId) ||
    !ARTIFACT_ACCESS_CLIENTS.includes(client) ||
    !ARTIFACT_ACCESS_ACTIONS.includes(action)
  ) {
    throw new TypeError("artifact content access request is invalid");
  }
  return Object.freeze({ accessId, artifactId, client, action });
}

function readCurrentArtifact(store, artifactId, runtimeFs = fs) {
  const matches = store.list().filter((entry) => entry.id === artifactId);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0 ? "artifact not found" : "artifact id is ambiguous",
    );
  }
  const entry = matches[0];
  if (
    !entry.file ||
    entry.file !== path.basename(entry.file) ||
    entry.file.includes("..")
  ) {
    throw new Error("artifact index row has an unsafe stored filename");
  }
  const storedPath = store.storedPath(entry);
  const filesRoot = path.resolve(store.dir, "files");
  if (
    path.resolve(storedPath) !== path.join(filesRoot, entry.file) ||
    !path.resolve(storedPath).startsWith(`${filesRoot}${path.sep}`)
  ) {
    throw new Error("artifact stored path escapes the managed files directory");
  }
  const storedStat = runtimeFs.lstatSync(storedPath, { bigint: true });
  if (
    storedStat.isSymbolicLink() ||
    !storedStat.isFile() ||
    Number(storedStat.nlink) !== 1 ||
    Number(storedStat.size) !== Number(entry.size)
  ) {
    throw new Error("artifact stored byte identity is invalid");
  }
  const integrity = store.verifyIntegrity(entry);
  if (
    integrity.ok !== true ||
    integrity.actualSha256 !== entry.sha256 ||
    !/^[a-f0-9]{64}$/u.test(String(entry.sha256 || "")) ||
    (entry.recordDigest != null &&
      !SHA256_RE.test(String(entry.recordDigest))) ||
    (entry.sessionId != null && !ACCESS_ID_RE.test(String(entry.sessionId)))
  ) {
    throw new Error("artifact current byte readback failed");
  }
  return Object.freeze({ entry, storedPath, integrity });
}

function appendEvent(filePath, event, expectedSize, runtimeFs) {
  let descriptor = null;
  try {
    descriptor = runtimeFs.openSync(
      filePath,
      runtimeFs.constants.O_WRONLY |
        runtimeFs.constants.O_APPEND |
        runtimeFs.constants.O_CREAT |
        Number(runtimeFs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      Number(opened.size) !== expectedSize
    ) {
      throw new Error("artifact access ledger changed before append");
    }
    runtimeFs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
    runtimeFs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) runtimeFs.closeSync(descriptor);
  }
}

export function authorizeArtifactContentAccess(
  store,
  input = {},
  options = {},
) {
  if (!store?.dir || typeof store.verifyIntegrity !== "function") {
    throw new TypeError("artifact content access requires an ArtifactStore");
  }
  const request = normalizeAccessRequest(input);
  const runtimeFs = options.fs || fs;
  const filePath = ledgerPath(store);
  runtimeFs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  return (options.withFileLock || withFileLock)(
    filePath,
    () => {
      const ledgerBytes = readLedgerBytes(filePath, runtimeFs);
      const events = parseLedger(ledgerBytes);
      const prior = events.find((event) => event.accessId === request.accessId);
      if (prior) {
        if (
          prior.artifactId !== request.artifactId ||
          prior.client !== request.client ||
          prior.action !== request.action
        ) {
          throw new Error(
            "artifact access id is already bound to other inputs",
          );
        }
        const current = readCurrentArtifact(
          store,
          request.artifactId,
          runtimeFs,
        );
        if (
          prior.artifactSha256 !== `sha256:${current.entry.sha256}` ||
          prior.recordDigest !== (current.entry.recordDigest || null) ||
          prior.artifactSessionId !== (current.entry.sessionId || null)
        ) {
          throw new Error("artifact changed after access authorization");
        }
        return Object.freeze({
          access: prior,
          recorded: false,
          storedPath: current.storedPath,
          integrity: Object.freeze({ ...current.integrity }),
        });
      }
      const current = readCurrentArtifact(store, request.artifactId, runtimeFs);
      const previous = events.at(-1) || null;
      const material = {
        schema: ARTIFACT_ACCESS_EVENT_SCHEMA,
        sequence: (previous?.sequence || 0) + 1,
        previousEventDigest: previous?.eventDigest || null,
        accessId: request.accessId,
        artifactId: request.artifactId,
        artifactSha256: `sha256:${current.entry.sha256}`,
        recordDigest: current.entry.recordDigest || null,
        artifactSessionId: current.entry.sessionId || null,
        client: request.client,
        action: request.action,
        authorizedAt: new Date(
          typeof options.now === "function" ? options.now() : Date.now(),
        ).toISOString(),
        authorization: "current-artifact-index-and-byte-readback",
      };
      const candidateEvent = {
        ...material,
        eventDigest: digest(
          "chainlesschain.artifact.content-access-event.v1\0",
          material,
        ),
      };
      const event = normalizeArtifactAccessEvent(candidateEvent, previous);
      appendEvent(filePath, event, ledgerBytes.length, runtimeFs);
      return Object.freeze({
        access: event,
        recorded: true,
        storedPath: current.storedPath,
        integrity: Object.freeze({ ...current.integrity }),
      });
    },
    {
      failIfUnavailable: true,
      timeoutMs: 30_000,
      retryMs: 1,
      maxRetryMs: 8,
      retryJitterMs: 4,
    },
  );
}
