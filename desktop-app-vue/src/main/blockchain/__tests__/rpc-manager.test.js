/**
 * rpc-manager 单元测试 —— getNextProvider 轮询(含跳过 index 0 的回归)、
 * getBestProvider 选最低延迟、跳过不健康节点、空节点抛错、列表收缩安全。
 *
 * 直接填充 this.nodes，不调用 initialize()(不创建 provider/不起定时器)。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// ethers is only used by initialize()/measureLatency, not by the methods under
// test; mock it so requiring the module never depends on the real package.
vi.mock("ethers", () => ({ ethers: { JsonRpcProvider: vi.fn() } }));

const RPCManager = require("../rpc-manager.js");

const setNodes = (mgr, specs) => {
  mgr.nodes = new Map();
  for (const s of specs) {
    mgr.nodes.set(s.url, {
      provider: { id: s.url },
      healthy: s.healthy !== false,
      latency: s.latency ?? 100,
    });
  }
};

describe("RPCManager.getNextProvider", () => {
  it("round-robins starting from the first node (regression: index 0 not skipped)", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [{ url: "a" }, { url: "b" }, { url: "c" }]);
    const seq = Array.from({ length: 5 }, () => mgr.getNextProvider().id);
    expect(seq).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("always returns the only healthy node", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [{ url: "solo" }]);
    expect(mgr.getNextProvider().id).toBe("solo");
    expect(mgr.getNextProvider().id).toBe("solo");
  });

  it("rotates only over healthy nodes", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [{ url: "a" }, { url: "b", healthy: false }, { url: "c" }]);
    const seq = Array.from({ length: 3 }, () => mgr.getNextProvider().id);
    expect(seq).toEqual(["a", "c", "a"]);
  });

  it("throws when no healthy nodes are available", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [{ url: "a", healthy: false }]);
    expect(() => mgr.getNextProvider()).toThrow(/没有可用/);
  });

  it("stays in range after the healthy list shrinks", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [{ url: "a" }, { url: "b" }, { url: "c" }]);
    mgr.getNextProvider(); // a -> index 1
    mgr.getNextProvider(); // b -> index 2
    setNodes(mgr, [{ url: "a" }]); // shrink to one node
    expect(() => mgr.getNextProvider()).not.toThrow();
    expect(mgr.getNextProvider().id).toBe("a");
  });
});

describe("RPCManager.getBestProvider", () => {
  it("picks the lowest-latency healthy node", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, [
      { url: "slow", latency: 300 },
      { url: "fast", latency: 50 },
      { url: "mid", latency: 120 },
    ]);
    expect(mgr.getBestProvider().id).toBe("fast");
  });

  it("throws when no healthy nodes are available", () => {
    const mgr = new RPCManager(1, []);
    setNodes(mgr, []);
    expect(() => mgr.getBestProvider()).toThrow(/没有可用/);
  });
});
