import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({ v4: () => "generated-mesh-id" }));

const { MeshSocial, CONNECTION_TYPES } = require("../mesh-social");
const {
  MeshSocialBoundaryError,
  createMeshSocialBoundaries,
} = require("../mesh-social-boundaries");
const {
  getSocialStartupDisposition,
} = require("../../bootstrap/social-startup-policy");

const managers = [];

async function createManager(options = {}) {
  const manager = new MeshSocial(options);
  managers.push(manager);
  await manager.initialize();
  return manager;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
});

describe("mesh social boundaries", () => {
  it("rejects unknown, invalid, and inconsistent boundary configuration", () => {
    expect(() => createMeshSocialBoundaries({ typo: 1 })).toThrowError(
      expect.objectContaining({ code: "ERR_MESH_BOUNDARY_CONFIG" }),
    );
    expect(() => createMeshSocialBoundaries({ maxPeers: 0 })).toThrow(
      /positive integer/i,
    );
    expect(() =>
      createMeshSocialBoundaries({ maxDataBytes: 11, maxSyncBytes: 10 }),
    ).toThrow(/must not exceed/i);
  });

  it("retains a bounded, transactional, cloned peer snapshot", async () => {
    const manager = await createManager({ boundaries: { maxPeers: 1 } });
    const metadata = { nested: { trusted: true } };

    manager.registerPeer("peer-1", { alias: "One", metadata });
    metadata.nested.trusted = false;
    expect((await manager.getNearbyPeers())[0].metadata.nested.trusted).toBe(
      true,
    );

    expect(() => manager.registerPeer("peer-2")).toThrowError(
      expect.objectContaining({ code: "ERR_MESH_PEER_CAPACITY" }),
    );
    expect(() => manager.registerPeer("peer-1", null)).toThrowError(
      expect.objectContaining({ code: "ERR_MESH_PEER_INVALID" }),
    );
    expect(() =>
      manager.registerPeer("peer-1", { connectionType: "carrier-pigeon" }),
    ).toThrowError(
      expect.objectContaining({ code: "ERR_MESH_CONNECTION_TYPE" }),
    );

    expect(manager.peers.size).toBe(1);
    expect(manager.peers.get("peer-1").alias).toBe("One");
    manager.registerPeer("peer-1", { alias: "Updated" });
    expect(manager.peers.get("peer-1").alias).toBe("Updated");
  });

  it("validates and clones direct and broadcast payloads", async () => {
    const manager = await createManager({
      boundaries: { maxDataBytes: 64, maxSyncBytes: 128 },
    });
    manager.registerPeer("peer-1");
    const outgoing = [];
    manager.on("mesh:message", (event) => outgoing.push(event));
    const payload = { nested: { value: "original" } };

    await manager.sendViaMesh("peer-1", payload);
    payload.nested.value = "mutated";
    await manager.broadcastMesh({ ok: true });

    expect(outgoing[0].message.data).toEqual({
      nested: { value: "original" },
    });
    expect(outgoing[1].recipients).toEqual(["peer-1"]);
    await expect(
      manager.broadcastMesh({ value: "x".repeat(100) }),
    ).rejects.toMatchObject({ code: "ERR_MESH_DATA_TOO_LARGE" });
    await expect(manager.sendViaMesh("peer-1", null)).rejects.toMatchObject({
      code: "ERR_MESH_DATA_INVALID",
    });
  });

  it("bounds the offline sync queue by entries and serialized bytes", async () => {
    const manager = await createManager({
      boundaries: {
        maxSyncEntries: 2,
        maxSyncBytes: 20,
        maxDataBytes: 20,
      },
    });
    manager.setConnectionType(CONNECTION_TYPES.NONE);
    const payload = { value: "1234" };

    await manager.syncWhenOnline(payload);
    payload.value = "changed";
    expect(manager.syncQueue[0].data).toEqual({ value: "1234" });
    await expect(
      manager.syncWhenOnline({ value: "5678" }),
    ).rejects.toMatchObject({ code: "ERR_MESH_SYNC_CAPACITY" });

    expect(manager.syncQueue).toHaveLength(1);
    expect(manager._syncQueueBytes).toBe(Buffer.byteLength('{"value":"1234"}'));
  });

  it("expires stale peers using the injected clock", async () => {
    let now = 1_000;
    const manager = await createManager({
      now: () => now,
      boundaries: { peerTtlMs: 10 },
    });
    manager.registerPeer("peer-1");
    now = 1_011;

    manager._cleanupStalePeers();

    expect(manager.peers.size).toBe(0);
  });

  it("owns one discovery timer and fences all work after destroy", async () => {
    vi.useFakeTimers();
    const manager = await createManager();
    await manager.initialize();
    await manager.startDiscovery();
    const timer = manager._discoveryInterval;
    await manager.startDiscovery();
    expect(manager._discoveryInterval).toBe(timer);

    await manager.destroy();
    await manager.destroy();

    expect(manager._discoveryInterval).toBeNull();
    expect(manager.initialized).toBe(false);
    expect(() => manager.registerPeer("peer-after-close")).toThrowError(
      MeshSocialBoundaryError,
    );
    await expect(manager.startDiscovery()).rejects.toMatchObject({
      code: "ERR_MESH_DESTROYED",
    });
  });

  it("keeps the simulated transport dormant until a real adapter owns it", () => {
    expect(getSocialStartupDisposition("meshSocial")).toBe("dormant");
  });
});
