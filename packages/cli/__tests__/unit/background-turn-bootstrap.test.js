import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKGROUND_TURN_BOOTSTRAP_ENV,
  BACKGROUND_TURN_BOOTSTRAP_READY,
  BACKGROUND_TURN_BOOTSTRAP_RELEASE,
  createBackgroundTurnBootstrapMessage,
  matchesBackgroundTurnBootstrapMessage,
} from "../../src/lib/background-turn-bootstrap-protocol.js";

const bootstrapUrl = new URL(
  "../../src/workers/background-turn-bootstrap.js",
  import.meta.url,
);

function waitForReady(child, authority) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for turn bootstrap ready")),
      10_000,
    );
    child.on("message", (message) => {
      if (
        matchesBackgroundTurnBootstrapMessage(
          message,
          BACKGROUND_TURN_BOOTSTRAP_READY,
          authority,
        )
      ) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
}

describe("background turn pre-main bootstrap", () => {
  const roots = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function launch() {
    const root = mkdtempSync(join(tmpdir(), "cc-turn-bootstrap-"));
    roots.push(root);
    const marker = join(root, "agent-main-ran.txt");
    const entry = join(root, "entry.mjs");
    writeFileSync(
      entry,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.CC_TEST_TURN_MARKER, "ran");\n`,
    );
    const authority = {
      nonce: "test-nonce",
      workerGeneration: "test-generation",
      attempt: 1,
    };
    const child = spawn(
      process.execPath,
      [`--import=${bootstrapUrl.href}`, entry],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          CC_TEST_TURN_MARKER: marker,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.nonce]: authority.nonce,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.workerGeneration]:
            authority.workerGeneration,
          [BACKGROUND_TURN_BOOTSTRAP_ENV.attempt]: String(authority.attempt),
          [BACKGROUND_TURN_BOOTSTRAP_ENV.testTimeoutMs]: "1000",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    return { authority, child, marker };
  }

  it("does not execute Agent main before a matching durable release", async () => {
    const { authority, child, marker } = launch();
    const ready = await waitForReady(child, authority);
    expect(ready.pid).toBe(child.pid);
    expect(existsSync(marker)).toBe(false);

    const exitPromise = once(child, "exit");
    child.send(
      createBackgroundTurnBootstrapMessage(
        BACKGROUND_TURN_BOOTSTRAP_RELEASE,
        ready,
      ),
    );
    const [code, signal] = await exitPromise;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("exits without Agent work when the worker dies before pid commit", async () => {
    const { authority, child, marker } = launch();
    await waitForReady(child, authority);
    expect(existsSync(marker)).toBe(false);

    const exitPromise = once(child, "exit");
    child.disconnect();
    const [code] = await exitPromise;
    expect(code).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});
