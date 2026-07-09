/**
 * One-shot `cc <cmd> --json` helpers — session listing/resume metadata and
 * workspace checkpoints as SDK contracts. Runs the CLI at a process
 * boundary (never deep-imports CLI internals), so the JSON output of these
 * commands is the stability surface.
 */

import { execFile } from "node:child_process";

import { buildSpawnCommand } from "./agent-session.js";
import type { CheckpointRecord, SessionRecord } from "./protocol.js";

export interface CliRunOptions {
  cliPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** DI seam for tests. */
  execFileImpl?: typeof execFile;
}

export function runCliJson<T>(
  args: string[],
  options: CliRunOptions = {},
): Promise<T> {
  const cliPath = options.cliPath || "cc";
  const { command, args: fullArgs } = buildSpawnCommand(cliPath, args);
  const impl = options.execFileImpl ?? execFile;
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (process.platform === "win32") {
    env.NoDefaultCurrentDirectoryInExePath = "1";
  }
  return new Promise<T>((resolve, reject) => {
    impl(
      command,
      fullArgs,
      {
        cwd: options.cwd,
        env,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `cc ${args.join(" ")} failed: ${error.message}${
                stderr ? `\n${String(stderr).slice(0, 500)}` : ""
              }`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(String(stdout)) as T);
        } catch {
          reject(
            new Error(
              `cc ${args.join(" ")} returned non-JSON output: ${String(
                stdout,
              ).slice(0, 200)}`,
            ),
          );
        }
      },
    );
  });
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["sessions", "checkpoints", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** `cc session list --json` */
export async function listSessions(
  options: CliRunOptions = {},
): Promise<SessionRecord[]> {
  const raw = await runCliJson<unknown>(["session", "list", "--json"], options);
  return asArray<SessionRecord>(raw);
}

/** `cc session show <id> --json` */
export function showSession(
  id: string,
  options: CliRunOptions = {},
): Promise<Record<string, unknown>> {
  return runCliJson(["session", "show", id, "--json"], options);
}

/** `cc checkpoint list --json` */
export async function listCheckpoints(
  options: CliRunOptions = {},
): Promise<CheckpointRecord[]> {
  const raw = await runCliJson<unknown>(
    ["checkpoint", "list", "--json"],
    options,
  );
  return asArray<CheckpointRecord>(raw);
}

/** `cc checkpoint create [paths...] --json` */
export function createCheckpoint(
  paths: string[] = [],
  options: CliRunOptions = {},
): Promise<Record<string, unknown>> {
  return runCliJson(["checkpoint", "create", ...paths, "--json"], options);
}

/** `cc checkpoint show <id> --json` */
export function showCheckpoint(
  id: string,
  options: CliRunOptions = {},
): Promise<Record<string, unknown>> {
  return runCliJson(["checkpoint", "show", id, "--json"], options);
}

/** `cc checkpoint restore <id> --json` — rewinds workspace files. */
export function restoreCheckpoint(
  id: string,
  options: CliRunOptions = {},
): Promise<Record<string, unknown>> {
  return runCliJson(["checkpoint", "restore", id, "--json"], options);
}
