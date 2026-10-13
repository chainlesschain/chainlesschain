import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RETRY_DELAYS_MS = Object.freeze([20, 40, 80, 160, 320]);
const TRANSIENT_WINDOWS_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const sleepSync = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

// A reader/antivirus may temporarily deny Windows replacement. Retry the same
// fully written temp with a fixed 620ms sleep budget, preserving the old target.
// Never unlink the destination or overwrite a failed temp from another write.
export function atomicWriteJson(
  filePath,
  value,
  {
    platform = process.platform,
    io = fs,
    sleep = sleepSync,
    onRetry = (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  } = {},
) {
  const resolved = path.resolve(filePath);
  io.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.${randomUUID()}.tmp`;
  io.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    encoding: "utf8",
    mode: 0o600,
  });
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      io.renameSync(temporary, resolved);
      return { attempts, temporary, destination: resolved };
    } catch (error) {
      const delayMs = RETRY_DELAYS_MS[attempts - 1];
      if (
        platform !== "win32" ||
        !TRANSIENT_WINDOWS_ERRORS.has(error.code) ||
        delayMs === undefined
      ) {
        error.publicationFailure = {
          attempts,
          temporary,
          destination: resolved,
          code: error.code || null,
        };
        throw error;
      }
      onRetry({
        schema: "chainlesschain.atomic-json-publication-retry/v1",
        destination: resolved,
        temporary,
        attempt: attempts,
        code: error.code,
        delayMs,
      });
      sleep(delayMs);
    }
  }
}
