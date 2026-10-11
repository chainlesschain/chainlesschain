import fs from "node:fs";
import os from "node:os";

/** Normalize the trusted OS fixture allocator, never an untrusted store path.
 * Windows runners may expose TEMP through an 8.3 name; fixture descendants
 * should start at the same native path used by production identity checks. */
export function installCanonicalWindowsTestTemp({
  platform = process.platform,
  env = process.env,
  fsApi = fs,
  osApi = os,
} = {}) {
  if (platform !== "win32") return { installed: false };
  const canonicalRoot = (fsApi.realpathSync.native || fsApi.realpathSync)(
    osApi.tmpdir(),
  );
  if (!fsApi.lstatSync(canonicalRoot).isDirectory())
    throw new Error("Windows test temporary root must be a directory");

  const previous = ["TEMP", "TMP", "TMPDIR"].map((key) => ({
    key,
    present: Object.hasOwn(env, key),
    value: env[key],
  }));
  for (const { key } of previous) env[key] = canonicalRoot;
  let restored = false;
  return {
    installed: true,
    canonicalRoot,
    teardown() {
      if (restored) return;
      restored = true;
      for (const { key, present, value } of previous) {
        if (present) env[key] = value;
        else delete env[key];
      }
    },
  };
}
