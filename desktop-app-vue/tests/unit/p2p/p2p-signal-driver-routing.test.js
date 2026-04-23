import { describe, it, expect } from "vitest";

const P2PManager = (await import("../../../src/main/p2p/p2p-manager.js"))
  .default;

describe("P2PManager Signal Driver Routing", () => {
  function createManager(config = {}) {
    const manager = new P2PManager({
      dataPath: "C:/tmp/p2p-test",
      ...config,
    });

    manager.peerId = {
      toString: () => "peer-alice",
    };

    return manager;
  }

  it("should prefer database-backed p2p.signal.driver config", () => {
    const manager = createManager({
      signal: { driver: "legacy" },
    });

    manager.p2pConfig = {
      signal: { driver: "official" },
    };

    expect(manager.resolveSignalDriverName()).toBe("official");
    expect(manager.buildSignalManagerConfig(7)).toEqual({
      userId: "peer-alice",
      deviceId: 7,
      dataPath: "C:/tmp/p2p-test",
      signal: {
        driver: "official",
      },
    });
  });

  it("should fall back to constructor config when database config is missing", () => {
    const manager = createManager({
      signal: { driver: "official" },
    });

    expect(manager.resolveSignalDriverName()).toBe("official");
    expect(manager.buildSignalManagerConfig(3).signal.driver).toBe("official");
  });

  it("should fall back to legacy for unsupported signal driver values", () => {
    const manager = createManager();

    manager.p2pConfig = {
      signal: { driver: "unknown-driver" },
    };

    expect(manager.resolveSignalDriverName()).toBe("legacy");
    expect(manager.buildSignalManagerConfig(1).signal.driver).toBe("legacy");
  });
});
