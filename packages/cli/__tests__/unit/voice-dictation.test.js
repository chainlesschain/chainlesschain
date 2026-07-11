import { describe, it, expect } from "vitest";
import {
  VOICE_MODES,
  STT_BACKENDS,
  parseVoiceCommand,
  detectVoiceEnvironment,
  resolveSttBackend,
  renderVoiceStatus,
} from "../../src/repl/voice-dictation.js";

describe("parseVoiceCommand", () => {
  it("ignores non-/voice input", () => {
    expect(parseVoiceCommand("hello")).toBe(null);
    expect(parseVoiceCommand("/voicemail")).toBe(null);
  });

  it("parses modes and aliases", () => {
    expect(parseVoiceCommand("/voice")).toEqual({ action: "status" });
    expect(parseVoiceCommand("/voice status").action).toBe("status");
    expect(parseVoiceCommand("/voice hold").action).toBe("hold");
    expect(parseVoiceCommand("/voice ptt").action).toBe("hold");
    expect(parseVoiceCommand("/voice tap").action).toBe("tap");
    expect(parseVoiceCommand("/voice toggle").action).toBe("tap");
    expect(parseVoiceCommand("/voice off").action).toBe("off");
  });

  it("reports a bad option", () => {
    expect(parseVoiceCommand("/voice sing").error).toMatch(/Unknown/);
  });

  it("exposes the mode list", () => {
    expect(VOICE_MODES).toEqual(["off", "hold", "tap"]);
  });
});

describe("detectVoiceEnvironment", () => {
  it("supports a local interactive TTY", () => {
    expect(detectVoiceEnvironment({ env: {}, isTTY: true })).toEqual({
      supported: true,
      reason: "",
    });
  });

  it("degrades over SSH, non-TTY, CI, and CC_NO_VOICE", () => {
    expect(
      detectVoiceEnvironment({ env: { SSH_TTY: "/dev/pts/0" }, isTTY: true })
        .supported,
    ).toBe(false);
    expect(detectVoiceEnvironment({ env: {}, isTTY: false }).supported).toBe(
      false,
    );
    expect(
      detectVoiceEnvironment({ env: { CI: "true" }, isTTY: true }).supported,
    ).toBe(false);
    expect(
      detectVoiceEnvironment({ env: { CC_NO_VOICE: "1" }, isTTY: true }).reason,
    ).toMatch(/CC_NO_VOICE/);
  });
});

describe("resolveSttBackend (local-first priority)", () => {
  it("prefers local Whisper over system and cloud", () => {
    const r = resolveSttBackend({
      available: { "whisper-local": true, "system-stt": true, cloud: true },
      allowCloud: true,
    });
    expect(r.backend.id).toBe("whisper-local");
  });

  it("falls to system STT when local is absent", () => {
    const r = resolveSttBackend({
      available: { "system-stt": true, cloud: true },
      allowCloud: true,
    });
    expect(r.backend.id).toBe("system-stt");
  });

  it("never selects cloud unless opted in", () => {
    const off = resolveSttBackend({
      available: { cloud: true },
      allowCloud: false,
    });
    expect(off.backend).toBeNull();
    const on = resolveSttBackend({
      available: { cloud: true },
      allowCloud: true,
    });
    expect(on.backend.id).toBe("cloud");
  });

  it("honors an explicit eligible preference", () => {
    const r = resolveSttBackend({
      available: { "whisper-local": true, "system-stt": true },
      prefer: "system-stt",
    });
    expect(r.backend.id).toBe("system-stt");
  });

  it("reports no backend with actionable guidance", () => {
    const r = resolveSttBackend({ available: {} });
    expect(r.backend).toBeNull();
    expect(r.reason).toMatch(/no STT backend/);
    expect(STT_BACKENDS).toHaveLength(3);
  });
});

describe("renderVoiceStatus", () => {
  it("shows unavailable when the environment is degraded", () => {
    const s = renderVoiceStatus({
      mode: "hold",
      env: { supported: false, reason: "remote SSH session" },
    });
    expect(s).toMatch(/unavailable/);
    expect(s).toMatch(/SSH/);
  });

  it("describes off and active modes", () => {
    expect(renderVoiceStatus({ mode: "off" })).toMatch(/off/);
    const hold = renderVoiceStatus({
      mode: "hold",
      backend: { label: "local Whisper" },
      env: { supported: true },
    });
    expect(hold).toMatch(/hold/);
    expect(hold).toMatch(/local Whisper/);
  });
});
