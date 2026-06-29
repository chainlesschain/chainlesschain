/**
 * Security regression: sanitizePairAckPayload guards the remote-peer pair-ack
 * against shell injection. The payload is later passed to the CLI as a shell
 * argument (spawn shell:true on Windows), so a peer who brute-forced the 6-digit
 * pairing code must not be able to inject commands via mobileDid/deviceId/platform.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(),
}));
vi.mock("../../../src/main/web-shell/handlers/manual-pair-listener.js", () => ({
  startManualPairAliasListeners: vi.fn(),
}));

const {
  sanitizePairAckPayload,
} = require("../../../src/main/web-shell/handlers/desktop-pair-handlers.js");

describe("sanitizePairAckPayload — pair-ack shell-injection guard", () => {
  it("accepts a well-formed pair-ack", () => {
    const p = sanitizePairAckPayload({
      pairingCode: "123456",
      mobileDid: "did:chainlesschain:z6MkabC-123",
      deviceInfo: {
        deviceId: "uuid-abc-123",
        name: "My Phone",
        platform: "android",
      },
    });
    expect(p).not.toBeNull();
    expect(p.did).toBe("did:chainlesschain:z6MkabC-123");
    expect(p.deviceInfo.name).toBe("My Phone");
    expect(p.deviceInfo.platform).toBe("android");
  });

  it("drops a pair-ack whose did carries shell metacharacters", () => {
    expect(
      sanitizePairAckPayload({
        pairingCode: "123456",
        mobileDid: 'did:x"&calc&"',
        deviceInfo: { deviceId: "d1", platform: "ios" },
      }),
    ).toBeNull();
  });

  it("drops on unsafe deviceId or platform", () => {
    expect(
      sanitizePairAckPayload({
        mobileDid: "did:x",
        deviceInfo: { deviceId: "a;rm -rf /", platform: "ios" },
      }),
    ).toBeNull();
    expect(
      sanitizePairAckPayload({
        mobileDid: "did:x",
        deviceInfo: { deviceId: "ok", platform: "ios | evil" },
      }),
    ).toBeNull();
  });

  it("strips shell metacharacters from the free-form name but keeps the ack", () => {
    const p = sanitizePairAckPayload({
      pairingCode: "1",
      mobileDid: "did:x",
      deviceInfo: {
        deviceId: "ok",
        name: "Phone & `calc` $(x)",
        platform: "ios",
      },
    });
    expect(p).not.toBeNull();
    expect(p.deviceInfo.name).not.toMatch(/[`$&()|;]/);
    expect(p.deviceInfo.name).toContain("Phone");
  });

  it("preserves unicode / CJK device names", () => {
    const p = sanitizePairAckPayload({
      mobileDid: "did:x",
      deviceInfo: { deviceId: "ok", name: "小明的手机 📱", platform: "ios" },
    });
    expect(p.deviceInfo.name).toContain("小明的手机");
  });
});
