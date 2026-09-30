import "../helpers/test-model-egress.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentLoop, executeTool } from "../../src/runtime/agent-core.js";
import { WSSessionManager } from "../../src/gateways/ws/ws-session-gateway.js";
import { WSAgentHandler } from "../../src/gateways/ws/ws-agent-handler.js";
import { ChainlessChainWSServer } from "../../src/gateways/ws/ws-server.js";
import Database from "better-sqlite3";
import { getSession as getDbSession } from "../../src/lib/session-manager.js";

let root;
let manager;
let db;
const handlers = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ws-policy-"));
  manager = new WSSessionManager({ defaultProjectRoot: root });
  db = null;
});

afterEach(() => {
  for (const handler of handlers.splice(0)) handler.destroy();
  for (const sessionId of [...manager.sessions.keys()])
    manager.closeSession(sessionId);
  db?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function sessionAt(projectRoot = root, policy = null) {
  const { sessionId } = manager.createSession({
    projectRoot,
    hostManagedToolPolicy: policy,
    enabledToolNames: ["write_file"],
  });
  return manager.getSession(sessionId);
}

function handlerFor(session, target, beforeTool = () => {}) {
  let calls = 0;
  const interaction = {
    emit: vi.fn(),
    rejectAllPending: vi.fn(),
    askInput: vi.fn(async () => false),
  };
  const chatFn = vi.fn(async () => {
    if (++calls === 1) {
      await beforeTool();
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "ws-write",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: target,
                  content: "positive control",
                }),
              },
            },
          ],
        },
        usage: {},
      };
    }
    return { message: { role: "assistant", content: "finished" }, usage: {} };
  });
  const handler = new WSAgentHandler({
    session,
    interaction,
    agentLoop: (messages, options) =>
      agentLoop(messages, {
        ...options,
        chatFn,
        runnableProviderFallback: false,
      }),
  });
  handlers.push(handler);
  return { handler, interaction, chatFn };
}

describe("WS policy authority through the real agent loop", () => {
  it.each([
    "{invalid",
    "false",
    "0",
    '""',
    JSON.stringify({ hostManagedToolPolicy: { tools: false } }),
    JSON.stringify({
      hostManagedToolPolicy: { tools: { run_shell: { allowed: "false" } } },
    }),
  ])(
    "refuses a corrupt authority record through the real SQLite loader (%#)",
    (metadata) => {
      db = new Database(path.join(root, "sessions.db"));
      manager = new WSSessionManager({ db, defaultProjectRoot: root });
      const session = sessionAt(root, {
        tools: { run_shell: { allowed: false } },
      });
      manager.closeSession(session.id);
      db.prepare("UPDATE llm_sessions SET metadata = ? WHERE id = ?").run(
        metadata,
        session.id,
      );
      expect(manager.resumeSession(session.id)).toBeNull();
      expect(manager.getSession(session.id)).toBeNull();
      if (metadata === "{invalid")
        expect(getDbSession(db, session.id).metadata).toEqual({});
    },
  );

  it("rejects a zero-row policy save and blocks the old in-memory execution context", async () => {
    db = new Database(path.join(root, "sessions.db"));
    manager = new WSSessionManager({ db, defaultProjectRoot: root });
    const session = sessionAt();
    db.prepare("DELETE FROM llm_sessions WHERE id = ?").run(session.id);
    expect(() =>
      manager.updateSessionPolicy(session.id, {
        tools: { run_shell: { allowed: false } },
      }),
    ).toThrow();
    const result = await executeTool(
      "run_shell",
      { command: "echo forbidden" },
      {
        cwd: root,
        hostManagedToolPolicyAuthority: session.hostManagedToolPolicyAuthority,
      },
    );
    expect(result.policy).toMatchObject({
      decision: "blocked",
      via: "host-policy-authority",
      code: "CC_HOST_TOOL_POLICY_AUTHORITY_UNAVAILABLE",
    });
  });

  it("recovers a persisted deny with a new owner identity", () => {
    db = new Database(path.join(root, "sessions.db"));
    manager = new WSSessionManager({ db, defaultProjectRoot: root });
    const session = sessionAt();
    manager.updateSessionPolicy(session.id, {
      tools: { write_file: { allowed: false } },
    });
    const previous = session.hostManagedToolPolicyAuthority.getSnapshot();
    manager.closeSession(session.id);
    const resumed = manager.resumeSession(session.id);
    expect(resumed.hostManagedToolPolicyAuthority.getSnapshot().policy).toEqual(
      previous.policy,
    );
    expect(
      resumed.hostManagedToolPolicyAuthority.getSnapshot().ownerId,
    ).not.toBe(previous.ownerId);
  });

  it("reads a host update made after the loop starts and leaves another session's authority intact", async () => {
    const initial = { tools: { write_file: { allowed: true } } };
    const session = sessionAt(root, initial);
    const target = path.join(root, "denied.txt");
    const { handler, chatFn } = handlerFor(session, target, () => {
      manager.updateSessionPolicy(session.id, {
        tools: { write_file: { allowed: false, reason: "host deny" } },
      });
    });
    await handler.handleMessage("write the test file", "host-denied");
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(target)).toBe(false);
    expect(
      session.messages
        .filter((m) => m.role === "tool")
        .map((m) => m.content)
        .join("\n"),
    ).toContain("Host Policy");

    const other = sessionAt(root, initial);
    const control = path.join(root, "control.txt");
    const positive = handlerFor(other, control);
    await positive.handler.handleMessage("write the control", "positive");
    expect(fs.readFileSync(control, "utf8")).toBe("positive control");
    expect(other.hostManagedToolPolicyAuthority.getSnapshot().revision).toBe(0);
  }, 60000);

  it("enforces a deny saved by the existing WS permission panel before a real write", async () => {
    const server = new ChainlessChainWSServer({ projectRoot: root });
    server._send = vi.fn();
    await server._handlePermissionRulesSet(
      "rule",
      {},
      { decision: "deny", rule: "Write", scope: "project" },
    );
    expect(server._send.mock.calls.at(-1)[1]).toMatchObject({
      type: "permission-rule-updated",
      added: true,
    });
    const session = sessionAt();
    const target = path.join(root, "settings-denied.txt");
    const { handler, chatFn } = handlerFor(session, target);
    await handler.handleMessage("attempt write", "settings-denied");
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(target)).toBe(false);
    expect(
      session.messages
        .filter((m) => m.role === "tool")
        .map((m) => m.content)
        .join("\n"),
    ).toContain("denied by settings rule: Write");
  }, 60000);

  it("loads policy from each session's project root, including a separately rooted workspace", async () => {
    const deniedRoot = path.join(root, "workspace-a");
    const allowedRoot = path.join(root, "workspace-b");
    fs.mkdirSync(path.join(deniedRoot, ".claude"), { recursive: true });
    fs.mkdirSync(allowedRoot);
    fs.writeFileSync(
      path.join(deniedRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["Write"] } }),
    );
    const denied = sessionAt(deniedRoot);
    const allowed = sessionAt(allowedRoot);
    const deniedTarget = path.join(deniedRoot, "denied.txt");
    const allowedTarget = path.join(allowedRoot, "allowed.txt");
    await handlerFor(denied, deniedTarget).handler.handleMessage(
      "write",
      "project-a",
    );
    await handlerFor(allowed, allowedTarget).handler.handleMessage(
      "write",
      "project-b",
    );
    expect(fs.existsSync(deniedTarget)).toBe(false);
    expect(fs.readFileSync(allowedTarget, "utf8")).toBe("positive control");
  }, 60000);

  it("does not let a settings allow or an approval gate override the current host deny", async () => {
    const session = sessionAt(root, {
      tools: { run_shell: { allowed: false } },
    });
    const evaluate = vi.fn(async () => ({ decision: "allow" }));
    const result = await executeTool(
      "run_shell",
      { command: "echo forbidden" },
      {
        cwd: root,
        hostManagedToolPolicy: { tools: { run_shell: { allowed: true } } },
        hostManagedToolPolicyAuthority: session.hostManagedToolPolicyAuthority,
        permissionRules: { allow: ["Bash"], ask: [], deny: [] },
        approvalGate: { evaluate },
      },
    );
    expect(result.error).toContain("Host Policy");
    expect(evaluate).not.toHaveBeenCalled();
  });
});
