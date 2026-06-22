/**
 * signaling-peer-registry 单元测试 —— 注册/重连、按类型过滤、本地 host 计数
 * (大小写一致性回归)、注销、连接映射、统计、clear。
 *
 * 不调用 initialize()，因此不会启动 stale-check 定时器。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SignalingPeerRegistry = require("../signaling-peer-registry.js");

let reg;
beforeEach(() => {
  reg = new SignalingPeerRegistry();
});

const sock = (connectionId) => ({ connectionId, readyState: 1 });

describe("SignalingPeerRegistry register/unregister", () => {
  it("registers a peer and looks it up", () => {
    const res = reg.register("p1", sock("c1"), { name: "A" }, "mobile");
    expect(res).toMatchObject({ success: true, isReconnect: false });
    expect(reg.getPeer("p1")).toMatchObject({ deviceType: "mobile" });
    expect(reg.getPeerByConnectionId("c1")).toMatchObject({
      deviceType: "mobile",
    });
  });

  it("flags a reconnect and surfaces the previous connection", () => {
    reg.register("p1", sock("c1"), {}, "mobile");
    const res = reg.register("p1", sock("c2"), {}, "mobile");
    expect(res.isReconnect).toBe(true);
    expect(res.previousConnection).toBeTruthy();
    expect(reg.getStats().duplicateRegistrations).toBe(1);
  });

  it("unregisters a peer and clears its connection mapping", () => {
    reg.register("p1", sock("c1"), {}, "mobile");
    const removed = reg.unregister("p1");
    expect(removed).toBeTruthy();
    expect(reg.getPeer("p1")).toBeNull();
    expect(reg.getPeerByConnectionId("c1")).toBeNull();
    expect(reg.unregister("missing")).toBeNull();
  });

  it("unregisterByConnectionId removes the mapped peer", () => {
    reg.register("p1", sock("c1"), {}, "desktop");
    expect(reg.unregisterByConnectionId("c1")).toBeTruthy();
    expect(reg.getPeer("p1")).toBeNull();
    expect(reg.unregisterByConnectionId("nope")).toBeNull();
  });
});

describe("SignalingPeerRegistry getPeersByType", () => {
  it("filters by exact device type", () => {
    reg.register("m1", sock("c1"), {}, "mobile");
    reg.register("d1", sock("c2"), {}, "desktop");
    expect(reg.getPeersByType("mobile").map((p) => p.peerId)).toEqual(["m1"]);
    expect(reg.getPeersByType("desktop").map((p) => p.peerId)).toEqual(["d1"]);
  });
});

describe("SignalingPeerRegistry stats / local host (regression)", () => {
  it("counts a default registerLocal host under desktopCount (lowercase match)", () => {
    // Bug: registerLocal defaulted to 'DESKTOP' (uppercase) while getStats
    // counts getPeersByType('desktop'), so the local host was never counted.
    reg.registerLocal("host", { name: "host" });
    expect(reg.getPeer("host").deviceType).toBe("desktop");
    expect(reg.getStats().desktopCount).toBe(1);
  });

  it("reports mobile/desktop counts and current peer total", () => {
    reg.register("m1", sock("c1"), {}, "mobile");
    reg.register("d1", sock("c2"), {}, "desktop");
    reg.registerLocal("host");
    const stats = reg.getStats();
    expect(stats.mobileCount).toBe(1);
    expect(stats.desktopCount).toBe(2); // d1 + local host
    expect(stats.currentPeers).toBe(3);
    expect(stats.totalRegistrations).toBe(3);
  });
});

describe("SignalingPeerRegistry reachability / clear", () => {
  it("treats a local peer as online without a socket", () => {
    reg.registerLocal("host");
    expect(reg.isOnline("host")).toBe(true);
    expect(reg.isOnline("missing")).toBe(false);
  });

  it("clear empties the registry", () => {
    reg.register("p1", sock("c1"), {}, "mobile");
    reg.clear();
    expect(reg.getStats().currentPeers).toBe(0);
    expect(reg.getAllPeerIds()).toEqual([]);
  });
});
