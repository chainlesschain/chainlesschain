/**
 * Structural contract tests for autonomous-ipc.
 *
 * autonomous-ipc.js forwards real-time agent events from a shared runner
 * into renderer webContents via ipcMain.handle and webContents.send. A
 * full behavioural test would need mocking of both ipcMain and BrowserWindow
 * under Vitest's jsdom environment, plus injection of the runner singleton.
 * These tests lock down the 18-channel contract so accidental deletion of
 * a handler registration is caught by CI. Behavioural coverage is a
 * follow-up (tracked in the project audit, section 1).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_PATH = resolve(
  __dirname,
  "../../../../src/main/ai-engine/autonomous/autonomous-ipc.js",
);

const EXPECTED_CHANNELS = [
  "agent:submit-goal",
  "agent:pause-goal",
  "agent:resume-goal",
  "agent:cancel-goal",
  "agent:provide-input",
  "agent:get-goal-status",
  "agent:get-active-goals",
  "agent:get-goal-history",
  "agent:get-goal-logs",
  "agent:get-goal-steps",
  "agent:retry-goal",
  "agent:export-goal",
  "agent:batch-cancel",
  "agent:clear-history",
  "agent:get-queue-status",
  "agent:get-stats",
  "agent:get-config",
  "agent:update-config",
];

describe("autonomous-ipc (structural)", () => {
  it("source file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("declares all 18 expected channels in source", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    for (const channel of EXPECTED_CHANNELS) {
      expect(src).toContain(`"${channel}"`);
    }
  });

  it("registers exactly 18 ipcMain.handle calls", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    const matches = src.match(/ipcMain\.handle\(/g);
    expect(matches).toHaveLength(EXPECTED_CHANNELS.length);
  });

  it("wires renderer notifications via webContents.send", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    expect(src).toContain("webContents");
  });
});
