import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentIPCBus, _deps as ipcDeps } from "../src/lib/agent-ipc-bus.js";
import { connectBackgroundAgentKeeper } from "../src/lib/background-agent-keeper-client.js";
import {
  BACKGROUND_AGENT_KEEPER_ARM,
  BACKGROUND_AGENT_KEEPER_ARMED,
  BACKGROUND_AGENT_KEEPER_HELLO,
  BACKGROUND_AGENT_KEEPER_READY,
  BACKGROUND_AGENT_KEEPER_RETIRE,
  BACKGROUND_AGENT_KEEPER_RETIRED,
  backgroundAgentKeeperPipePath,
  cleanupBackgroundAgentKeeperPipeDirectory,
  createBackgroundAgentKeeperMessage,
  prepareBackgroundAgentKeeperPipePath,
} from "../src/lib/background-agent-keeper-protocol.js";
import { createNdjsonReader } from "../src/lib/background-session-transport.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-descendant-control",
      transport: {
        createFetch: () => () => {
          throw new Error("Unexpected model transport call");
        },
      },
    },
    operation,
  );

function unreadable() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Caller payload inspected before budget refusal");
      },
      ownKeys() {
        throw new Error("Caller payload enumerated before budget refusal");
      },
    },
  );
}

test("direct IPC spawn rejects before options or broker access", async () => {
  const oldSpawn = ipcDeps.spawn;
  let spawns = 0;
  ipcDeps.spawn = () => {
    spawns++;
    throw new Error("Unexpected child process");
  };
  try {
    const bus = new AgentIPCBus();
    await scoped(async () => {
      await assert.rejects(
        bus.spawnAgentProcess(unreadable(), unreadable(), unreadable()),
        {
          code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
          noReplay: true,
        },
      );
    });
    assert.equal(spawns, 0);
  } finally {
    ipcDeps.spawn = oldSpawn;
  }
});

test("direct keeper connect rejects before configuration or socket access", async () => {
  const originalConnect = net.createConnection;
  let connections = 0;
  net.createConnection = () => {
    connections++;
    throw new Error("Unexpected keeper connection");
  };
  try {
    await scoped(async () => {
      await assert.rejects(connectBackgroundAgentKeeper(unreadable()), {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
    });
    assert.equal(connections, 0);
  } finally {
    net.createConnection = originalConnect;
  }
});

test("preconnected keeper cannot arm from live or closed scope; retire remains available", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cc-budget-keeper-"));
  const id = `keeper-${randomUUID()}`;
  const workerGeneration = `worker-${randomUUID()}`;
  const pipePath = backgroundAgentKeeperPipePath(id, directory);
  prepareBackgroundAgentKeeperPipePath(pipePath);
  const messages = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on(
      "data",
      createNdjsonReader((message) => {
        messages.push(message);
        if (message.type === BACKGROUND_AGENT_KEEPER_HELLO) {
          socket.write(
            `${JSON.stringify(
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_READY,
                { id, workerGeneration, keeperPid: process.pid },
              ),
            )}\n`,
          );
        } else if (
          message.type === BACKGROUND_AGENT_KEEPER_ARM ||
          message.type === BACKGROUND_AGENT_KEEPER_RETIRE
        ) {
          const payload = { ...message };
          delete payload.type;
          delete payload.protocolVersion;
          socket.write(
            `${JSON.stringify(
              createBackgroundAgentKeeperMessage(
                message.type === BACKGROUND_AGENT_KEEPER_ARM
                  ? BACKGROUND_AGENT_KEEPER_ARMED
                  : BACKGROUND_AGENT_KEEPER_RETIRED,
                payload,
              ),
            )}\n`,
          );
        }
      }),
    );
  });
  let client;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipePath, resolve);
    });
    client = await connectBackgroundAgentKeeper({
      id,
      workerGeneration,
      pipePath,
      workerPid: process.pid,
      token: randomBytes(32).toString("hex"),
    });
    await scoped(async () => {
      await assert.rejects(client.arm(unreadable()), {
        code: "CC_BUDGET_DESCENDANT_NOT_COVERED",
        noReplay: true,
      });
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let deferred;
    await scoped(async () => {
      deferred = gate.then(() => client.arm(unreadable()));
    });
    release();
    await assert.rejects(deferred, {
      code: "CC_BUDGET_SCOPE_CLOSED",
      noReplay: true,
    });
    assert.equal(
      messages.filter((message) => message.type === BACKGROUND_AGENT_KEEPER_ARM)
        .length,
      0,
    );
    const turn = {
      id,
      workerGeneration,
      turnLaunchToken: "turn-token-1",
      attempt: 1,
      agentPid: 4321,
      agentStartedAt: 1_000,
      agentRuntimePid: 5432,
      agentRuntimeStartedAt: 1_001,
    };
    await client.arm(turn);
    assert.deepEqual(client.activeTurn(), turn);
    await scoped(() => client.retire(turn));
    assert.equal(client.activeTurn(), null);
    assert.equal(
      messages.filter((message) => message.type === BACKGROUND_AGENT_KEEPER_ARM)
        .length,
      1,
    );
    assert.equal(
      messages.filter(
        (message) => message.type === BACKGROUND_AGENT_KEEPER_RETIRE,
      ).length,
      1,
    );
  } finally {
    client?.close();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    cleanupBackgroundAgentKeeperPipeDirectory(pipePath);
    rmSync(directory, { recursive: true, force: true });
  }
});
