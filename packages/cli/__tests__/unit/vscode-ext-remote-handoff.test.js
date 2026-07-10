import { describe, expect, it } from "vitest";

import {
  buildHandoffArgs,
  buildRemoteControlStartArgs,
  buildRemoteControlStatusArgs,
  buildRemoteControlStopArgs,
  extractFirstJsonObject,
  formatHandoffNote,
  formatPairingNote,
  parseBackgroundState,
  parseRemoteControlStatus,
  runHandoff,
} from "../../../vscode-extension/src/chat/remote-handoff.js";
import { SLASH_COMMANDS } from "../../../vscode-extension/src/chat/slash-commands.js";

describe("remote/cloud session handoff (VS Code)", () => {
  it("builds the background handoff argv (detached resume of the panel session)", () => {
    expect(buildHandoffArgs("panel-1", "Continue.")).toEqual([
      "agent",
      "--bg",
      "--resume",
      "panel-1",
      "-p",
      "Continue.",
      "--output-format",
      "json",
    ]);
  });

  it("parses the launcher state out of noisy stdout", () => {
    const out = [
      "some log line",
      JSON.stringify({ id: "bg-1", sessionId: "panel-1", status: "running" }),
      "",
    ].join("\n");
    expect(parseBackgroundState(out)).toMatchObject({
      id: "bg-1",
      sessionId: "panel-1",
    });
    expect(parseBackgroundState("no json here")).toBeNull();
    // A JSON object without an id is not a launcher state.
    expect(parseBackgroundState('{"ok":true}')).toBeNull();
  });

  it("runs the handoff through the CLI and reports failures", async () => {
    let seen;
    const ok = await runHandoff({
      sessionId: "panel-1",
      prompt: "Continue.",
      deps: {
        execFile: (cmd, args, opts, cb) => {
          seen = args;
          cb(null, JSON.stringify({ id: "bg-9", sessionId: "panel-1" }));
        },
      },
    });
    expect(ok).toMatchObject({ ok: true, state: { id: "bg-9" } });
    expect(seen).toContain("--resume");
    const failed = await runHandoff({
      sessionId: "panel-1",
      prompt: "x",
      deps: {
        execFile: (cmd, args, opts, cb) => cb(new Error("spawn ENOENT"), ""),
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("ENOENT");
    expect((await runHandoff({ sessionId: "", prompt: "x" })).ok).toBe(false);
    expect((await runHandoff({ sessionId: "s", prompt: "  " })).ok).toBe(false);
  });

  it("formats a transcript note pointing at the continuation surfaces", () => {
    const note = formatHandoffNote({ id: "bg-1" });
    expect(note).toContain("bg-1");
    expect(note).toContain("cc attach bg-1");
    expect(note).toContain("web panel");
    expect(formatHandoffNote(null)).toBeNull();
  });
});

describe("remote-control host wrappers (VS Code)", () => {
  it("builds start/status/stop argv", () => {
    expect(buildRemoteControlStartArgs()).toEqual([
      "remote-control",
      "start",
      "--json",
    ]);
    expect(buildRemoteControlStatusArgs()).toEqual([
      "remote-control",
      "status",
      "--json",
      "--prune",
    ]);
    expect(buildRemoteControlStopArgs(18800)).toEqual([
      "remote-control",
      "stop",
      "--port",
      "18800",
      "--json",
    ]);
  });

  it("extracts the pretty-printed pairing JSON from an accumulating buffer", () => {
    const payload = {
      mode: "direct",
      port: 18800,
      pairingUri: "chainlesschain://remote-session/x?t={not-a-brace}",
      pairing: { token: 'we"ird{tok}en', expiresAt: 1760000000000 },
    };
    const pretty = JSON.stringify(payload, null, 2);
    // Nothing yet on a partial buffer…
    expect(extractFirstJsonObject(pretty.slice(0, 40))).toBeNull();
    // …the full object parses even with braces/quotes inside strings…
    expect(extractFirstJsonObject(pretty)).toMatchObject({ port: 18800 });
    // …and trailing serve-loop output after the object is ignored.
    expect(
      extractFirstJsonObject(pretty + "\nserving…\n{ garbage"),
    ).toMatchObject({ mode: "direct" });
    expect(extractFirstJsonObject("no braces")).toBeNull();
  });

  it("parses status --json and filters invalid records", () => {
    const rows = parseRemoteControlStatus(
      JSON.stringify([
        { port: 18800, pid: 1, alive: true, mode: "direct" },
        { invalid: true, stateFile: "x" },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].port).toBe(18800);
    expect(parseRemoteControlStatus("nope")).toEqual([]);
  });

  it("formats a pairing note with mode, port and expiry", () => {
    const note = formatPairingNote({
      mode: "relay",
      port: 18800,
      pairingUri: "chainlesschain://remote-session/abc",
      pairing: { expiresAt: 1760000000000 },
    });
    expect(note).toContain("relay (E2EE)");
    expect(note).toContain("chainlesschain://remote-session/abc");
    expect(note).toContain("2025"); // ISO expiry rendered
    expect(formatPairingNote({})).toBeNull();
  });
});

describe("slash menu", () => {
  it("advertises /handoff", () => {
    expect(SLASH_COMMANDS.some(([cmd]) => cmd === "/handoff")).toBe(true);
  });
});
