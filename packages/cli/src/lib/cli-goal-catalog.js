/** Bounded, explicit metadata discovery for native IDE goal pickers. */
import fs from "node:fs";
import path from "node:path";
import { resolveConfigDataRoot } from "./paths.js";
import { goalFileStoreId } from "./goal-store.js";
import { createCliGoalSnapshotReader } from "./cli-goal-source.js";

export const CLI_GOAL_CATALOG_SCHEMA = "chainlesschain.goal-catalog.v1";
const MAX_DIRECTORY_ENTRIES = 2048;
const safeId = (id) =>
  typeof id === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(id) &&
  !id.includes("..");
function fail(code) {
  throw new Error(code);
}
function cursor(storeId, afterId) {
  return Buffer.from(JSON.stringify({ v: 1, storeId, afterId })).toString(
    "base64url",
  );
}
function decodeCursor(value, storeId) {
  if (value === undefined) return "";
  try {
    if (
      typeof value !== "string" ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/u.test(value)
    )
      throw 0;
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      Object.keys(raw).sort().join(",") !== "afterId,storeId,v" ||
      raw.v !== 1 ||
      raw.storeId !== storeId ||
      !safeId(raw.afterId) ||
      cursor(storeId, raw.afterId) !== value
    )
      throw 0;
    return raw.afterId;
  } catch {
    fail("CLI_GOAL_CATALOG_INVALID_CURSOR");
  }
}

/** Each page visits at most limit candidates, including invalid sources.
 * Pages are fresh reads; this does not promise a frozen cross-page snapshot. */
export function readCliGoalCatalog(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = Object.freeze({ ...(options.env || process.env) });
  const root = path.resolve(
    options.root ||
      path.join(resolveConfigDataRoot({ cwd, env }).path, "goals"),
  );
  const storeId = goalFileStoreId(root);
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    fail("CLI_GOAL_CATALOG_INVALID_LIMIT");
  const afterId = decodeCursor(options.after, storeId);
  const result = {
    schema: CLI_GOAL_CATALOG_SCHEMA,
    storeId,
    snapshot: true,
    observedAt: new Date().toISOString(),
    entries: [],
    scannedCount: 0,
    skippedCount: 0,
    invalidNameCount: 0,
    nextCursor: null,
  };
  try {
    fs.lstatSync(root);
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  const source = createCliGoalSnapshotReader(root);
  const directory = fs.opendirSync(root);
  const ids = [];
  try {
    let count = 0;
    for (let entry; (entry = directory.readSync()); ) {
      if (++count > MAX_DIRECTORY_ENTRIES)
        fail("CLI_GOAL_CATALOG_DIRECTORY_LIMIT");
      if (!entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!safeId(id)) {
        result.invalidNameCount++;
        continue;
      }
      if (safeId(id) && id > afterId) ids.push(id);
    }
  } finally {
    directory.closeSync();
  }
  source.checkRoot();
  ids.sort();
  const snapshots = [];
  const page = ids.slice(0, limit);
  result.scannedCount = page.length;
  for (const id of page) {
    try {
      const snapshot = source.read(id);
      const goal = snapshot.goal;
      const title = (goal.title || goal.objective)
        .replace(
          /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
          " ",
        )
        .slice(0, 160);
      result.entries.push({
        id: goal.id,
        title,
        status: goal.status,
        revision: goal.revision,
        controlGeneration: goal.controlGeneration,
      });
      snapshots.push(snapshot);
    } catch {
      result.skippedCount++;
    }
  }
  // A changed valid source aborts the page instead of returning stale metadata.
  for (const snapshot of snapshots) source.revalidate(snapshot);
  source.checkRoot();
  if (ids.length > page.length)
    result.nextCursor = cursor(storeId, page.at(-1));
  return result;
}
