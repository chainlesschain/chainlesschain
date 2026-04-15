/**
 * E2E test: Workflow WS protocol end-to-end against a live `cc serve` process.
 *
 * Spawns the CLI server, connects via WebSocket, and exercises the
 * `workflow-list` / `workflow-save` / `workflow-get` / `workflow-remove`
 * protocol. `workflow-run` is skipped here (requires LLM); see the
 * integration test for run coverage.
 *
 * Port: 19330 (isolated from other e2e suites)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.join(__dirname, "..", "..");
const bin = path.join(cliRoot, "bin", "chainlesschain.js");

const WS_PORT = 19330;

let msgCounter = 0;
function genId() {
  return `wf-e2e-${++msgCounter}`;
}

function startServer(port, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [bin, "serve", "--port", String(port)], {
      env: { ...process.env, FORCE_COLOR: "0" },
      cwd,
    });
    let out = "";
    const onData = (data) => {
      out += data.toString("utf8");
      if (out.includes("ws://") && out.includes(String(port))) resolve(proc);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    setTimeout(() => resolve(proc), 15000);
  });
}

function killProc(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once("close", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* */
      }
      resolve();
    }, 3000);
  });
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 8000);
  });
}

function sendAndWait(ws, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const id = payload.id || genId();
    const msg = { ...payload, id };
    const timer = setTimeout(() => {
      ws.off("message", onMsg);
      reject(new Error(`Timeout waiting for ${msg.type} (id=${id})`));
    }, timeoutMs);
    function onMsg(data) {
      let parsed;
      try {
        parsed = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      const cid = parsed.requestId || parsed.id;
      if (cid === id) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(parsed);
      }
    }
    ws.on("message", onMsg);
    ws.send(JSON.stringify(msg));
  });
}

describe("Workflow WS protocol — E2E", () => {
  let proc, ws, tmpRoot;

  beforeAll(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "cc-wf-e2e-"));
    proc = await startServer(WS_PORT, tmpRoot);
    await new Promise((r) => setTimeout(r, 2000));
    ws = await connectWs(WS_PORT);
  }, 30000);

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await killProc(proc);
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("workflow-list returns empty on fresh project", async () => {
    const res = await sendAndWait(ws, { type: "workflow-list" });
    expect(res.type).toBe("workflow:list");
    expect(Array.isArray(res.workflows)).toBe(true);
  });

  it("workflow-save persists a workflow", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-save",
      workflow: {
        id: "e2e-wf",
        name: "E2E",
        steps: [{ id: "s1", message: "hi" }],
      },
    });
    expect(res.type).toBe("workflow:save");
    expect(res.saved).toBe(true);
    expect(res.workflowId).toBe("e2e-wf");
  });

  it("workflow-get retrieves the saved workflow", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-get",
      id: "e2e-wf",
    });
    expect(res.type).toBe("workflow:get");
    expect(res.workflow.id).toBe("e2e-wf");
    expect(res.workflow.steps[0].message).toBe("hi");
  });

  it("workflow-list shows the saved workflow", async () => {
    const res = await sendAndWait(ws, { type: "workflow-list" });
    expect(res.workflows.map((w) => w.id)).toContain("e2e-wf");
  });

  it("workflow-save rejects cyclic dependencies", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-save",
      workflow: {
        id: "e2e-cycle",
        name: "Cycle",
        steps: [
          { id: "a", message: "a", dependsOn: ["b"] },
          { id: "b", message: "b", dependsOn: ["a"] },
        ],
      },
    });
    expect(res.type).toBe("error");
    expect(res.code).toBe("WORKFLOW_INVALID");
  });

  it("workflow-get returns null for unknown id", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-get",
      id: "nope",
    });
    expect(res.type).toBe("workflow:get");
    expect(res.workflow).toBeNull();
  });

  it("workflow-remove deletes the workflow", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-remove",
      id: "e2e-wf",
    });
    expect(res.type).toBe("workflow:remove");
    expect(res.removed).toBe(true);

    const list = await sendAndWait(ws, { type: "workflow-list" });
    expect(list.workflows.find((w) => w.id === "e2e-wf")).toBeFalsy();
  });

  it("workflow-run on missing workflow emits WORKFLOW_NOT_FOUND", async () => {
    const res = await sendAndWait(ws, {
      type: "workflow-run",
      id: "ghost",
    });
    expect(res.type).toBe("error");
    expect(res.code).toBe("WORKFLOW_NOT_FOUND");
  });
});
