import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const hash = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
export function event(config, type, details = {}) {
  fs.appendFileSync(
    path.join(config.output, `${config.id}.jsonl`),
    `${JSON.stringify({
      type,
      at: Date.now(),
      pid: process.pid,
      ...details,
    })}\n`,
  );
}
export function snapshot(config) {
  const files = {};
  for (const [label, file] of Object.entries(config.paths)) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        files[label] = { path: file, kind: "not-regular" };
        continue;
      }
      const bytes = fs.readFileSync(file);
      const sha256 = hash(bytes);
      const record = {
        path: file,
        size: bytes.length,
        sha256,
        mtimeMs: stat.mtimeMs,
      };
      if (file.endsWith(".json") || label.includes("JOURNAL")) {
        try {
          record.json = JSON.parse(bytes.toString("utf8"));
        } catch {}
      }
      files[label] = record;
      if (bytes.length <= 2_000_000) {
        const blob = path.join(config.output, "blobs", sha256);
        if (!fs.existsSync(blob)) fs.writeFileSync(blob, bytes);
      }
    } catch (error) {
      files[label] = { path: file, error: error.code };
    }
  }
  return files;
}
export function describeCall(command, args) {
  const candidate = args?.find(
    (value) =>
      typeof value === "string" && /cc-pack-apply-[^/\\]+\.cmd$/i.test(value),
  );
  if (candidate && fs.existsSync(candidate)) {
    const script = fs.readFileSync(candidate, "utf8");
    const paths = { SIDECAR: candidate };
    for (const match of script.matchAll(/^set "([A-Z_]+)=([^\r\n]*)"\r?$/gm)) {
      if (
        match[2] &&
        path.isAbsolute(match[2]) &&
        match[1] !== "CC_SYSTEM_ROOT"
      )
        paths[match[1]] = match[2];
    }
    return { kind: "sidecar", paths };
  }
  const helper = args?.find(
    (value) => typeof value === "string" && /[\\/]schedule\.mjs$/i.test(value),
  );
  if (helper && fs.existsSync(helper)) {
    const directory = path.dirname(helper);
    const target = path.join(directory, "current.exe");
    return {
      kind: "schedule-helper",
      paths: {
        HELPER: helper,
        TARGET_EXE: target,
        NEW_EXE: `${target}.new`,
        LOCK_FILE: `${target}.update.lock`,
        RESULT_FILE: `${target}.update-result.json`,
        JOURNAL_FILE: `${target}.update-transaction.json`,
        JOURNAL_RETIRED: `${target}.update-transaction.json.last`,
        LINEAGE_FILE: `${target}.update-lineage.json`,
        BACKUP_EXE: `${target}.previous`,
        PLAN: path.join(directory, "plan.json"),
      },
    };
  }
  return null;
}
