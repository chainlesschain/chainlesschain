"use strict";

import { describe, it, expect, vi } from "vitest";

const { FridaKeyProvider } = require("../../lib/adapters/wechat/key-providers/frida-key-provider");

/** Helper that builds a mock frida binding with a scripted message timeline. */
function makeMockFrida({ onAttachThrow, onCreateScriptThrow, onLoadThrow, messages = [], deviceId = "device" }) {
  const ops = {
    unloadCalled: 0,
    detachCalled: 0,
    loadCalled: 0,
    messageHandler: null,
  };
  const script = {
    message: {
      connect: (handler) => { ops.messageHandler = handler; },
    },
    load: vi.fn(async () => {
      ops.loadCalled++;
      if (onLoadThrow) throw onLoadThrow;
      // Replay the scripted messages on next tick so .connect handler is
      // wired before the first send fires.
      setTimeout(() => {
        for (const m of messages) {
          if (ops.messageHandler) ops.messageHandler({ type: "send", payload: m });
        }
      }, 0);
    }),
    unload: vi.fn(async () => { ops.unloadCalled++; }),
  };
  const session = {
    createScript: vi.fn(async () => {
      if (onCreateScriptThrow) throw onCreateScriptThrow;
      return script;
    }),
    detach: vi.fn(async () => { ops.detachCalled++; }),
  };
  const device = {
    attach: vi.fn(async (pkg) => {
      if (onAttachThrow) throw onAttachThrow;
      device._attachedTo = pkg;
      return session;
    }),
  };
  const frida = {
    getDevice: vi.fn(async (id) => {
      device._id = id;
      return device;
    }),
    getUsbDevice: vi.fn(async () => device),
  };
  return { frida, device, session, script, ops };
}

describe("FridaKeyProvider — construction", () => {
  it("defaults packageName to com.tencent.mm", () => {
    const p = new FridaKeyProvider({});
    expect(p._packageName).toBe("com.tencent.mm");
  });

  it("name is frida", () => {
    const p = new FridaKeyProvider({});
    expect(p.name).toBe("frida");
  });

  it("getKey throws FRIDA_BINDING_MISSING when frida not available", async () => {
    const p = new FridaKeyProvider({});
    try {
      await p.getKey();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.code).toBe("FRIDA_BINDING_MISSING");
    }
  });
});

describe("FridaKeyProvider — happy path", () => {
  it("captures key hex and detaches", async () => {
    const keyHex = "00112233445566778899aabbccddeeff" +
                   "ffeeddccbbaa99887766554433221100";
    const { frida, ops } = makeMockFrida({
      messages: [
        { kind: "hooked", symbol: "sqlite3_key", module: "libwcdb.so" },
        { kind: "key", hex: keyHex.toUpperCase(), source: "sqlite3_key" },
      ],
    });
    const p = new FridaKeyProvider({ frida, deviceId: "Z1", agentLoader: () => "/* mock agent */" });
    const k = await p.getKey();
    expect(k).toBe(keyHex); // lowercased
    expect(ops.unloadCalled).toBe(1);
    expect(ops.detachCalled).toBe(1);
    const tel = p.getLastTelemetry();
    expect(tel.keySource).toBe("sqlite3_key");
    expect(tel.hooked).toHaveLength(1);
    expect(tel.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses USB device when no deviceId provided", async () => {
    const { frida } = makeMockFrida({
      messages: [{ kind: "key", hex: "aa" + "00".repeat(31), source: "sqlite3_key" }],
    });
    const p = new FridaKeyProvider({ frida, agentLoader: () => "/* mock */" });
    await p.getKey();
    expect(frida.getUsbDevice).toHaveBeenCalled();
    expect(frida.getDevice).not.toHaveBeenCalled();
  });
});

describe("FridaKeyProvider — error paths", () => {
  it("WECHAT_NOT_RUNNING when attach reports process not found", async () => {
    const { frida } = makeMockFrida({
      onAttachThrow: new Error("unable to find process with name 'com.tencent.mm'"),
    });
    const p = new FridaKeyProvider({ frida, deviceId: "Z1", agentLoader: () => "" });
    await expect(p.getKey()).rejects.toMatchObject({ code: "WECHAT_NOT_RUNNING" });
  });

  it("FRIDA_ATTACH_FAILED on generic attach error", async () => {
    const { frida } = makeMockFrida({
      onAttachThrow: new Error("permission denied"),
    });
    const p = new FridaKeyProvider({ frida, deviceId: "Z1", agentLoader: () => "" });
    await expect(p.getKey()).rejects.toMatchObject({ code: "FRIDA_ATTACH_FAILED" });
  });

  it("FRIDA_ATTACH_FAILED + session cleanup when createScript throws", async () => {
    const { frida, ops } = makeMockFrida({
      onCreateScriptThrow: new Error("syntax error in agent"),
    });
    const p = new FridaKeyProvider({ frida, deviceId: "Z1", agentLoader: () => "BAD" });
    await expect(p.getKey()).rejects.toMatchObject({ code: "FRIDA_ATTACH_FAILED" });
    // Even though createScript threw, the session was already attached;
    // implementation cleans it up in the catch path.
    expect(ops.detachCalled).toBe(1);
  });

  it("WCDB_KEY_TIMEOUT when no key event in time", async () => {
    const { frida, ops } = makeMockFrida({
      messages: [{ kind: "hooked", symbol: "sqlite3_key", module: "libwcdb.so" }],
    });
    const p = new FridaKeyProvider({
      frida,
      deviceId: "Z1",
      timeoutMs: 50,
      agentLoader: () => "",
    });
    await expect(p.getKey()).rejects.toMatchObject({ code: "WCDB_KEY_TIMEOUT" });
    expect(ops.unloadCalled).toBe(1);
    expect(ops.detachCalled).toBe(1);
  });

  it("non-fatal hook errors are recorded but don't reject", async () => {
    const keyHex = "ee" + "00".repeat(31);
    const { frida } = makeMockFrida({
      messages: [
        { kind: "error", message: "Interceptor.attach failed for WCDBKeyDerive: not found" },
        { kind: "hooked", symbol: "sqlite3_key", module: "libwcdb.so" },
        { kind: "key", hex: keyHex, source: "sqlite3_key" },
      ],
    });
    const p = new FridaKeyProvider({ frida, deviceId: "Z1", agentLoader: () => "" });
    const k = await p.getKey();
    expect(k).toBe(keyHex);
    expect(p.getLastTelemetry().errors).toContain("Interceptor.attach failed for WCDBKeyDerive: not found");
  });
});

describe("FridaKeyProvider — logger DI", () => {
  it("logger receives frida-message events", async () => {
    const events = [];
    const { frida } = makeMockFrida({
      messages: [
        { kind: "hooked", symbol: "sqlite3_key", module: "libwcdb.so" },
        { kind: "key", hex: "ff" + "00".repeat(31), source: "sqlite3_key" },
      ],
    });
    const p = new FridaKeyProvider({
      frida,
      deviceId: "Z1",
      agentLoader: () => "",
      logger: (e) => events.push(e),
    });
    await p.getKey();
    expect(events.some((e) => e.kind === "frida-message" && e.evt.kind === "hooked")).toBe(true);
    expect(events.some((e) => e.kind === "frida-message" && e.evt.kind === "key")).toBe(true);
  });
});
