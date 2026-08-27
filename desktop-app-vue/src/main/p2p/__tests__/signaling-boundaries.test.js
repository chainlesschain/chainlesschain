const {
  HARD_SIGNALING_LIMITS,
  frameBytes,
  resolveSignalingLimits,
  serializedBytes,
} = require("../signaling-boundaries");

describe("signaling boundary resolution", () => {
  it("uses bounded defaults and accepts safe overrides", () => {
    const limits = resolveSignalingLimits({
      maxConnections: 12,
      messageQueueSize: 7,
    });
    expect(limits.maxConnections).toBe(12);
    expect(limits.maxQueueSize).toBe(7);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("rejects invalid values and values above hard limits", () => {
    expect(() => resolveSignalingLimits({ maxConnections: 0 })).toThrow(
      /positive safe integer/,
    );
    expect(() =>
      resolveSignalingLimits({
        maxConnections: HARD_SIGNALING_LIMITS.maxConnections + 1,
      }),
    ).toThrow(/hard maximum/);
    expect(() =>
      resolveSignalingLimits({
        maxQueueSize: 10,
        maxTotalMessages: 5,
      }),
    ).toThrow(/maxQueueSize/);
    expect(() =>
      resolveSignalingLimits({
        maxMessageBytes: 100,
        maxDeviceInfoBytes: 101,
      }),
    ).toThrow(/maxDeviceInfoBytes/);
  });

  it("counts UTF-8 bytes for frames and serialized values", () => {
    expect(frameBytes(Buffer.from("abc"))).toBe(3);
    expect(frameBytes("链")).toBe(3);
    expect(serializedBytes({ value: "链" })).toBe(
      Buffer.byteLength(JSON.stringify({ value: "链" }), "utf8"),
    );
  });
});
