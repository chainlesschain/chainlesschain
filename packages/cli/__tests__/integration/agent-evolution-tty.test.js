import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as nodePty from "node-pty";
import { afterEach, describe, expect, it } from "vitest";

const roots = [];
const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/agent-evolution-tty-child.mjs",
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
});

function waitForText(state, pattern, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      state.listeners.delete(check);
      reject(new Error(`PTY output did not match ${pattern}:\n${state.text}`));
    }, timeoutMs);
    const check = () => {
      const childError = state.text.match(/CC_TTY_ERROR:(\{[^\r\n]+\})/u);
      if (childError) {
        clearTimeout(deadline);
        state.listeners.delete(check);
        reject(new Error(`PTY child failed: ${childError[1]}`));
        return;
      }
      const match = state.text.match(pattern);
      if (match) {
        clearTimeout(deadline);
        state.listeners.delete(check);
        resolve(match);
      } else if (state.exit) {
        clearTimeout(deadline);
        state.listeners.delete(check);
        reject(
          new Error(
            `PTY child exited with code ${state.exit.exitCode} before ${pattern}:\n${state.text}`,
          ),
        );
      }
    };
    state.listeners.add(check);
    check();
  });
}

describe("Agent evolution real TTY journey", () => {
  it(
    "authenticates a PTY turn, dispatches only its projection, exits and reopens the durable Run",
    async () => {
      const root = fs.mkdtempSync(
        path.join(fs.realpathSync.native(os.tmpdir()), "cc-evolution-tty-"),
      );
      roots.push(root);
      const workspace = path.join(root, "workspace");
      const configDir = path.join(root, "config");
      const resultPath = path.join(root, "result.json");
      fs.mkdirSync(workspace);
      fs.mkdirSync(configDir);
      const state = { text: "", listeners: new Set(), exit: null };
      const child = nodePty.spawn(
        process.execPath,
        [fixture, workspace, resultPath],
        {
          cwd: path.resolve(path.dirname(fixture), "../.."),
          cols: 100,
          rows: 30,
          env: {
            ...process.env,
            NO_COLOR: "1",
            CC_REPL_STREAM: "0",
            CC_PROMPT_SUGGESTIONS: "0",
            CHAINLESSCHAIN_DATA_DIR: configDir,
            CLAUDE_CONFIG_DIR: configDir,
          },
        },
      );
      child.onData((data) => {
        state.text += data;
        for (const listener of [...state.listeners]) listener();
      });
      const exited = new Promise((resolve) =>
        child.onExit((event) => {
          state.exit = event;
          for (const listener of [...state.listeners]) listener();
          resolve(event);
        }),
      );
      try {
        // Windows cold starts may run more than one synchronous ACL preflight;
        // one operation can legitimately consume its configured 60s allowance.
        await waitForText(
          state,
          /CC_TTY_READY/u,
          process.platform === "win32" ? 120_000 : 60_000,
        );
        child.write("Contact alice@example.com\r");
        await waitForText(state, /TTY_DONE/u);
        child.write("/exit\r");
        const exit = await exited;
        const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
        expect(exit.exitCode).toBe(0);
        expect(result).toEqual({
          stdinIsTTY: true,
          stdoutIsTTY: true,
          status: "completed",
          reopenedStatus: "completed",
          evidenceKinds: ["user-prompt", "model-input", "response-completed"],
          encryptedRaw: 3,
          providerCalls: 1,
          providerSawRedaction: true,
        });
        expect(state.text).not.toContain("CC_TTY_ERROR:");
      } finally {
        if (!state.exit) {
          try {
            child.kill();
          } catch {
            // The normal /exit path may have closed the pseudoterminal.
          }
        }
        let shutdownTimer;
        try {
          await Promise.race([
            exited,
            new Promise((_, reject) => {
              shutdownTimer = setTimeout(
                () =>
                  reject(new Error("PTY child did not exit after shutdown")),
                10_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(shutdownTimer);
        }
      }
    },
    process.platform === "win32" ? 210_000 : 130_000,
  );
});
