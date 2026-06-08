"use strict";

import { describe, it, expect } from "vitest";

const { collectWeChatV4, _internals } = require("../../lib/adapters/wechat-pc/v4-sidecar");

// Fake SidecarSupervisor: scripted per python exe (command[0]).
function makeFactory(behaviorByPython, calls) {
  return (command, _cwd) => {
    const py = command[0];
    calls.push(py);
    const behavior = behaviorByPython[py] || { throwOn: "start", error: new Error("ENOENT spawn " + py) };
    return {
      async start() {
        if (behavior.throwOn === "start") throw behavior.error;
      },
      async invoke(_method, _params, _opts) {
        if (behavior.throwOn === "invoke") throw behavior.error;
        return behavior.result;
      },
      async stop() {},
    };
  };
}

describe("collectWeChatV4 — python fallback + error routing", () => {
  it("falls through to the next python when the first lacks cryptography", async () => {
    const calls = [];
    const result = await collectWeChatV4({
      pythonExe: "python", // tried first
      _supervisorFactory: makeFactory(
        {
          python: { throwOn: "invoke", error: new Error("ModuleNotFoundError: No module named 'cryptography'") },
          python3: { throwOn: null, result: { account: "wxid_x", messages: [{ text: "ok" }] } },
        },
        calls,
      ),
    });
    expect(result.account).toBe("wxid_x");
    expect(calls[0]).toBe("python");
    expect(calls).toContain("python3");
  });

  it("surfaces a WeChat data error immediately (no fallback)", async () => {
    const calls = [];
    await expect(
      collectWeChatV4({
        pythonExe: "python",
        _supervisorFactory: makeFactory(
          { python: { throwOn: "invoke", error: new Error("KEY_NOT_FOUND: key not found in Weixin.exe memory") } },
          calls,
        ),
      }),
    ).rejects.toThrow(/KEY_NOT_FOUND/);
    expect(calls).toEqual(["python"]); // did NOT try other pythons
  });

  it("throws SIDECAR_UNAVAILABLE when no python works", async () => {
    const calls = [];
    await expect(
      collectWeChatV4({
        _supervisorFactory: makeFactory({}, calls), // all spawn-fail
      }),
    ).rejects.toThrow(/SIDECAR_UNAVAILABLE|could not run/);
  });

  it("pythonCandidates dedupes + honors explicit/env order", () => {
    const list = _internals.pythonCandidates("my-python");
    expect(list[0]).toBe("my-python");
    expect(new Set(list).size).toBe(list.length);
  });
});
