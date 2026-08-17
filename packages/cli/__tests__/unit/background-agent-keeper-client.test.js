import net from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectBackgroundAgentKeeper } from "../../src/lib/background-agent-keeper-client.js";
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
} from "../../src/lib/background-agent-keeper-protocol.js";
import { createNdjsonReader } from "../../src/lib/background-session-transport.js";

const resources = [];

function responsePayload(message) {
  const payload = { ...message };
  delete payload.type;
  delete payload.protocolVersion;
  return payload;
}

function fixtureIdentity() {
  const suffix = randomBytes(8).toString("hex");
  const directory = mkdtempSync(join(tmpdir(), "cc-keeper-client-"));
  return {
    directory,
    id: `keeper-client-${suffix}`,
    workerGeneration: `worker-${suffix}`,
    token: randomBytes(32).toString("hex"),
    workerPid: process.pid,
  };
}

async function startFixtureKeeper({ retireDelayMs = 0, replyToRetire = true }) {
  const identity = fixtureIdentity();
  const pipePath = backgroundAgentKeeperPipePath(
    identity.id,
    identity.directory,
  );
  prepareBackgroundAgentKeeperPipePath(pipePath);
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on(
      "data",
      createNdjsonReader((message) => {
        if (message.type === BACKGROUND_AGENT_KEEPER_HELLO) {
          socket.write(
            `${JSON.stringify(
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_READY,
                {
                  id: identity.id,
                  workerGeneration: identity.workerGeneration,
                  keeperPid: process.pid,
                },
              ),
            )}\n`,
          );
          return;
        }
        if (message.type === BACKGROUND_AGENT_KEEPER_ARM) {
          socket.write(
            `${JSON.stringify(
              createBackgroundAgentKeeperMessage(
                BACKGROUND_AGENT_KEEPER_ARMED,
                responsePayload(message),
              ),
            )}\n`,
          );
          return;
        }
        if (message.type === BACKGROUND_AGENT_KEEPER_RETIRE && replyToRetire) {
          setTimeout(() => {
            if (socket.destroyed) return;
            socket.write(
              `${JSON.stringify(
                createBackgroundAgentKeeperMessage(
                  BACKGROUND_AGENT_KEEPER_RETIRED,
                  responsePayload(message),
                ),
              )}\n`,
            );
          }, retireDelayMs);
        }
      }),
    );
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(pipePath, () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const resource = {
    directory: identity.directory,
    pipePath,
    server,
    sockets,
    clients: [],
  };
  resources.push(resource);
  return { identity, pipePath, resource };
}

function turnFor(identity) {
  return {
    id: identity.id,
    workerGeneration: identity.workerGeneration,
    turnLaunchToken: "turn-token-1",
    attempt: 1,
    agentPid: 4321,
    agentStartedAt: 1_000,
    agentRuntimePid: 5432,
    agentRuntimeStartedAt: 1_001,
  };
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const client of resource.clients) client.close();
    for (const socket of resource.sockets) socket.destroy();
    await new Promise((resolvePromise) =>
      resource.server.close(resolvePromise),
    );
    cleanupBackgroundAgentKeeperPipeDirectory(resource.pipePath);
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe("background agent keeper client deadlines", () => {
  it("uses the independent RETIRE timeout after the shorter ARM deadline", async () => {
    const { identity, pipePath, resource } = await startFixtureKeeper({
      retireDelayMs: 300,
    });
    const client = await connectBackgroundAgentKeeper({
      ...identity,
      pipePath,
      requestTimeoutMs: 200,
      retireTimeoutMs: 1_000,
    });
    resource.clients.push(client);
    const turn = turnFor(identity);

    await client.arm(turn);
    await expect(client.retire(turn)).resolves.toBe(true);
    expect(client.activeTurn()).toBeNull();
  });

  it("keeps the turn armed when RETIRE times out", async () => {
    const { identity, pipePath, resource } = await startFixtureKeeper({
      replyToRetire: false,
    });
    const client = await connectBackgroundAgentKeeper({
      ...identity,
      pipePath,
      requestTimeoutMs: 500,
      retireTimeoutMs: 30,
    });
    resource.clients.push(client);
    const turn = turnFor(identity);

    await client.arm(turn);
    await expect(client.retire(turn)).rejects.toThrow(
      /keeper-retire after 30ms/u,
    );
    expect(client.activeTurn()).toEqual(turn);
  });
});
