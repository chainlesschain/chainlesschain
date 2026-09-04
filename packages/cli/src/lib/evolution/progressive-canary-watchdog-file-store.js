import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  createProgressiveCanaryHeartbeatSource,
  createProgressiveCanaryWatchdogIncidentStore,
} from "./progressive-canary-external-watchdog.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_HEARTBEATS = 10_000;

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function safeName(value) {
  return digest(value, "record digest").slice(7);
}

async function assertDirectory(path, label) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`${label} is not a physical directory`);
  return realpath(path);
}

async function readRecord(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size < 2 ||
    info.size > MAX_RECORD_BYTES
  )
    throw new Error(`${label} is not an admissible regular file`);
  const bytes = await readFile(path);
  if (bytes.length !== info.size)
    throw new Error(`${label} changed during readback`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new Error(`${label} is not JSON`, { cause });
  }
  return value;
}

async function writeOnce(path, value, label) {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  if (encoded.length < 2 || encoded.length > MAX_RECORD_BYTES)
    throw new TypeError(`${label} exceeds its size bound`);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(encoded);
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const prior = await readRecord(path, label);
    if (JSON.stringify(prior) !== encoded.toString("utf8"))
      throw new Error(`${label} conflicts with an existing record`);
    return false;
  } finally {
    await handle?.close();
  }
  const readback = await readRecord(path, label);
  if (JSON.stringify(readback) !== encoded.toString("utf8"))
    throw new Error(`${label} durable readback differs`);
  return true;
}

function heartbeatName(receipt) {
  if (!Number.isSafeInteger(receipt?.sequence) || receipt.sequence < 0)
    throw new TypeError("heartbeat sequence is invalid");
  digest(receipt.receiptDigest, "heartbeat receiptDigest");
  return `${String(receipt.sequence).padStart(16, "0")}-${safeName(
    receipt.receiptDigest,
  )}.json`;
}

export async function createProgressiveCanaryWatchdogFileStore({
  rootDir,
  planDigest,
  hostId,
} = {}) {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir))
    throw new TypeError("watchdog rootDir must be absolute");
  digest(planDigest, "planDigest");
  if (typeof hostId !== "string" || hostId.length < 1)
    throw new TypeError("hostId is required");
  const requestedRoot = resolve(rootDir);
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const root = await assertDirectory(requestedRoot, "watchdog root");
  const heartbeatsDir = join(root, "heartbeats");
  const incidentsDir = join(root, "incidents");
  const reservationsDir = join(root, "reservations");
  await mkdir(heartbeatsDir, { recursive: true, mode: 0o700 });
  await mkdir(incidentsDir, { recursive: true, mode: 0o700 });
  await mkdir(reservationsDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    assertDirectory(heartbeatsDir, "heartbeat directory"),
    assertDirectory(incidentsDir, "incident directory"),
    assertDirectory(reservationsDir, "reservation directory"),
  ]);

  async function publishHeartbeat(receipt) {
    if (
      receipt?.planDigest !== planDigest ||
      receipt?.hostId !== hostId ||
      !DIGEST.test(receipt?.receiptDigest ?? "")
    )
      throw new Error("heartbeat belongs to another watchdog store");
    const path = join(heartbeatsDir, heartbeatName(receipt));
    await writeOnce(path, receipt, "heartbeat record");
    return Object.freeze({
      authenticated: true,
      durable: true,
      receiptDigest: receipt.receiptDigest,
    });
  }

  const heartbeatSource = createProgressiveCanaryHeartbeatSource({
    async readLatest(binding) {
      if (binding?.planDigest !== planDigest || binding?.hostId !== hostId)
        throw new Error("heartbeat source binding differs");
      const names = (await readdir(heartbeatsDir)).filter((name) =>
        /^\d{16}-[a-f0-9]{64}\.json$/u.test(name),
      );
      if (names.length > MAX_HEARTBEATS)
        throw new Error("heartbeat store exceeds its bounded history");
      if (names.length === 0)
        return Object.freeze({
          authenticated: false,
          durable: true,
          receipt: null,
        });
      names.sort().reverse();
      const receipt = await readRecord(
        join(heartbeatsDir, names[0]),
        "latest heartbeat",
      );
      if (
        receipt?.planDigest !== planDigest ||
        receipt?.hostId !== hostId ||
        heartbeatName(receipt) !== names[0]
      )
        throw new Error("latest heartbeat filename binding differs");
      if (names.length > 1 && names[1].slice(0, 16) === names[0].slice(0, 16))
        throw new Error("latest heartbeat sequence is equivocated");
      return Object.freeze({
        authenticated: true,
        durable: true,
        receipt,
      });
    },
  });

  const incidentStore = createProgressiveCanaryWatchdogIncidentStore({
    async reserve(binding) {
      if (binding?.planDigest !== planDigest)
        throw new Error("incident reservation belongs to another plan");
      const incidentDigest = digest(binding.incidentDigest, "incidentDigest");
      if (
        !Number.isSafeInteger(binding.observedAt) ||
        binding.observedAt < 0 ||
        !Number.isSafeInteger(binding.leaseDurationMs) ||
        binding.leaseDurationMs < 1_000
      )
        throw new TypeError("incident reservation lease is invalid");
      const path = join(reservationsDir, `${safeName(incidentDigest)}.json`);
      const reservation = {
        planDigest,
        incidentDigest,
        nonce: randomBytes(32).toString("base64url"),
        acquiredAt: binding.observedAt,
        expiresAt: binding.observedAt + binding.leaseDurationMs,
      };
      let acquired = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let handle;
        try {
          handle = await open(path, "wx", 0o600);
          await handle.writeFile(JSON.stringify(reservation));
          await handle.sync();
          acquired = true;
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          const current = await readRecord(path, "incident reservation");
          if (
            current?.planDigest !== planDigest ||
            current?.incidentDigest !== incidentDigest ||
            !Number.isSafeInteger(current.expiresAt)
          )
            throw new Error("incident reservation binding is invalid");
          if (current.expiresAt >= binding.observedAt) break;
          try {
            await unlink(path);
          } catch (unlinkError) {
            if (unlinkError.code !== "ENOENT") throw unlinkError;
          }
        } finally {
          await handle?.close();
        }
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        acquired,
        incidentDigest,
      });
    },
    async load(binding) {
      if (binding?.planDigest !== planDigest)
        throw new Error("incident load belongs to another plan");
      const incidentDigest = digest(binding.incidentDigest, "incidentDigest");
      const value = await readRecord(
        join(incidentsDir, `${safeName(incidentDigest)}.json`),
        "watchdog incident",
      );
      if (
        value &&
        (value.planDigest !== planDigest ||
          value.incidentDigest !== incidentDigest)
      )
        throw new Error("watchdog incident filename binding differs");
      return value;
    },
    async commit(incident) {
      if (
        incident?.planDigest !== planDigest ||
        !DIGEST.test(incident?.incidentDigest ?? "")
      )
        throw new Error("watchdog incident belongs to another plan");
      await writeOnce(
        join(incidentsDir, `${safeName(incident.incidentDigest)}.json`),
        incident,
        "watchdog incident",
      );
      return Object.freeze({
        authenticated: true,
        durable: true,
        incidentDigest: incident.incidentDigest,
      });
    },
  });

  return Object.freeze({
    rootDir: root,
    storeDigest: sha(`${planDigest}\0${hostId}\0${root}`),
    publishHeartbeat,
    heartbeatSource,
    incidentStore,
  });
}
