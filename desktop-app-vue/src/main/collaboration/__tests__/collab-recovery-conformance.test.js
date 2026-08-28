import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { DatabaseSync } = require("node:sqlite");
const Y = require("yjs");
const YjsCollabManager = require("../yjs-collab-manager");
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

function createMemoryDatabase() {
  const rows = [];
  let nextId = 1;
  const sqlite = {
    prepare(sql) {
      if (sql.includes("COUNT(*)")) {
        return {
          get(documentId) {
            const selected = rows.filter(
              (row) => row.knowledge_id === documentId,
            );
            return {
              update_count: selected.length,
              total_bytes: selected.reduce(
                (total, row) => total + row.update_data.byteLength,
                0,
              ),
            };
          },
        };
      }
      if (sql.includes("SELECT update_data")) {
        return {
          all(documentId, limit) {
            return rows
              .filter((row) => row.knowledge_id === documentId)
              .sort((left, right) => left.id - right.id)
              .slice(0, limit)
              .map((row) => ({ update_data: row.update_data }));
          },
        };
      }
      if (sql.includes("INSERT INTO knowledge_yjs_updates")) {
        return {
          run(documentId, update, createdAt) {
            rows.push({
              id: nextId++,
              knowledge_id: documentId,
              update_data: Buffer.from(update),
              created_at: createdAt,
            });
            return { lastInsertRowid: nextId - 1 };
          },
        };
      }
      return { get: () => null, all: () => [], run: () => ({}) };
    },
  };
  return { rows, getDatabase: () => sqlite };
}

function captureUpdate(ydoc, mutate) {
  let captured;
  const handler = (update) => {
    captured = new Uint8Array(update);
  };
  ydoc.on("update", handler);
  mutate();
  ydoc.off("update", handler);
  return captured;
}

function terminateAfterReady(fixturePath, databasePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath, databasePath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let ready = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`crash writer timed out: ${stderr}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!ready && stdout.includes("YJS_CRASH_WRITER_READY")) {
        ready = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(
          new Error(
            `crash writer exited before ready (${code}/${signal}): ${stderr}`,
          ),
        );
        return;
      }
      resolve({ code, signal });
    });
  });
}

describe("Yjs crash/restart conformance", () => {
  let temporaryDirectory;

  afterEach(() => {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("replays committed state after an externally terminated writer", async () => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "cc-yjs-crash-"));
    const databasePath = path.join(temporaryDirectory, "collab.sqlite");
    const fixturePath = path.join(
      testDirectory,
      "fixtures",
      "yjs-crash-writer.mjs",
    );

    await terminateAfterReady(fixturePath, databasePath);

    let sqlite = new DatabaseSync(databasePath);
    let manager = new YjsCollabManager(null, {
      getDatabase: () => sqlite,
    });
    const recovered = manager.getDocument("crash-doc");
    expect(recovered.getMap("state").get("beforeCrash")).toBe("durable");
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM knowledge_yjs_updates WHERE knowledge_id = ?",
        )
        .get("crash-doc").count,
    ).toBe(1);

    recovered.getMap("state").set("afterRestart", "also-durable");
    manager.destroy();
    sqlite.close();

    sqlite = new DatabaseSync(databasePath);
    manager = new YjsCollabManager(null, { getDatabase: () => sqlite });
    const reopened = manager.getDocument("crash-doc");
    expect(reopened.getMap("state").toJSON()).toEqual({
      beforeCrash: "durable",
      afterRestart: "also-durable",
    });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM knowledge_yjs_updates WHERE knowledge_id = ?",
        )
        .get("crash-doc").count,
    ).toBe(2);
    manager.destroy();
    sqlite.close();
  });
});

describe("Yjs multi-peer conformance", () => {
  it("fences late data and close events from a replaced peer connection", () => {
    const database = createMemoryDatabase();
    const manager = new YjsCollabManager(null, database, {
      boundaries: { maxPeersPerDocument: 1 },
    });
    manager.getDocument("doc-a");
    const oldConnection = manager._retainDocumentPeer("doc-a", "peer-1");
    const newConnection = manager._retainDocumentPeer("doc-a", "peer-1");
    const source = new Y.Doc();
    source.getMap("state").set("remote", true);
    const update = Y.encodeStateAsUpdate(source);

    expect(
      manager._applyPeerUpdate("doc-a", "peer-1", oldConnection, update),
    ).toBe(false);
    expect(manager._releaseDocumentPeer("doc-a", "peer-1", oldConnection)).toBe(
      false,
    );
    expect(manager.documentPeers.get("doc-a").has("peer-1")).toBe(true);
    expect(() => manager._retainDocumentPeer("doc-a", "peer-2")).toThrowError(
      expect.objectContaining({ code: "ERR_COLLAB_PEER_CAPACITY" }),
    );

    expect(
      manager._applyPeerUpdate("doc-a", "peer-1", newConnection, update),
    ).toBe(true);
    expect(manager.getDocument("doc-a").getMap("state").get("remote")).toBe(
      true,
    );
    expect(manager._releaseDocumentPeer("doc-a", "peer-1", newConnection)).toBe(
      true,
    );
    expect(manager.documentPeers.has("doc-a")).toBe(false);
    manager.destroy();
  });

  it("persists remote updates and converges after duplicate reordered delivery", () => {
    const stores = [
      createMemoryDatabase(),
      createMemoryDatabase(),
      createMemoryDatabase(),
    ];
    const managers = stores.map(
      (database) => new YjsCollabManager(null, database),
    );
    const documents = managers.map((manager) => manager.getDocument("doc-a"));
    const updates = documents.map((document, index) =>
      captureUpdate(document, () => {
        document.getMap("state").set(`peer${index + 1}`, index + 1);
      }),
    );

    for (const index of [2, 0, 1, 2]) {
      managers[0].applyUpdate("doc-a", updates[index], "network");
    }
    for (const index of [0, 2, 1, 0]) {
      managers[1].applyUpdate("doc-a", updates[index], "network");
    }
    for (const index of [1, 0, 2, 1]) {
      managers[2].applyUpdate("doc-a", updates[index], "network");
    }

    for (const document of documents) {
      expect(document.getMap("state").toJSON()).toEqual({
        peer1: 1,
        peer2: 2,
        peer3: 3,
      });
    }

    managers[2].destroy();
    const reopened = new YjsCollabManager(null, stores[2]);
    expect(reopened.getDocument("doc-a").getMap("state").toJSON()).toEqual({
      peer1: 1,
      peer2: 2,
      peer3: 3,
    });
    expect(stores[2].rows).toHaveLength(3);

    managers[0].destroy();
    managers[1].destroy();
    reopened.destroy();
  });
});
