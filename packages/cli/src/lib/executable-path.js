import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, extname, join } from "node:path";

/** Resolve command presence from PATH without launching a child process. */
export function isExecutableOnPath(
  command,
  { env = process.env, platform = process.platform, access = accessSync } = {},
) {
  const pathDelimiter = platform === "win32" ? ";" : delimiter;
  const paths = String(env.PATH || env.Path || env.path || "")
    .split(pathDelimiter)
    .map((entry) => entry.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  const extensions =
    platform === "win32" && !extname(command)
      ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const directory of paths) {
    for (const extension of extensions) {
      try {
        access(
          join(directory, `${command}${extension}`),
          platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return true;
      } catch {
        // Continue through the remaining PATH candidates.
      }
    }
  }
  return false;
}
