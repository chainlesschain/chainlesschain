import { describe, it, expect, vi } from "vitest";
import {
  messageText,
  lastAssistantText,
  lastCodeBlock,
  clipboardCommands,
  copyToClipboard,
} from "../../src/repl/clipboard-copy.js";

describe("messageText", () => {
  it("returns a string content unchanged", () => {
    expect(messageText("hello")).toBe("hello");
  });
  it("joins text parts of content-array", () => {
    expect(
      messageText([
        { type: "text", text: "a" },
        { type: "image", source: {} },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });
  it("returns empty for null/other", () => {
    expect(messageText(null)).toBe("");
    expect(messageText(42)).toBe("");
  });
});

describe("lastAssistantText", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "first reply" },
    { role: "user", content: "again" },
    { role: "assistant", content: "second reply" },
  ];
  it("returns the most recent assistant text", () => {
    expect(lastAssistantText(msgs)).toBe("second reply");
  });
  it("skips empty/whitespace assistant messages", () => {
    expect(
      lastAssistantText([
        { role: "assistant", content: "real" },
        { role: "assistant", content: "   " },
      ]),
    ).toBe("real");
  });
  it("returns null when there is no assistant message", () => {
    expect(lastAssistantText([{ role: "user", content: "x" }])).toBeNull();
    expect(lastAssistantText(null)).toBeNull();
  });
});

describe("lastCodeBlock", () => {
  it("extracts the last fenced block body (sans language + trailing newline)", () => {
    const text = "intro\n```js\nconst a = 1;\n```\nmid\n```\nplain block\n```\nend";
    expect(lastCodeBlock(text)).toBe("plain block");
  });
  it("returns null when there is no fenced block", () => {
    expect(lastCodeBlock("just prose, no fences")).toBeNull();
    expect(lastCodeBlock("")).toBeNull();
  });
});

describe("clipboardCommands", () => {
  it("win32 → powershell then clip", () => {
    const cmds = clipboardCommands("win32");
    expect(cmds.map((c) => c.cmd)).toEqual(["powershell", "clip"]);
    expect(cmds[0].args.join(" ")).toMatch(/Set-Clipboard/);
  });
  it("darwin → pbcopy", () => {
    expect(clipboardCommands("darwin").map((c) => c.cmd)).toEqual(["pbcopy"]);
  });
  it("linux → wl-copy, xclip, xsel", () => {
    expect(clipboardCommands("linux").map((c) => c.cmd)).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ]);
  });
});

describe("copyToClipboard", () => {
  it("succeeds on the first working tool and reports it", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const res = copyToClipboard("payload", { platform: "darwin", spawnSync });
    expect(res).toEqual({ ok: true, tool: "pbcopy" });
    expect(spawnSync).toHaveBeenCalledWith(
      "pbcopy",
      [],
      expect.objectContaining({ input: "payload", encoding: "utf-8" }),
    );
  });

  it("falls through to the next candidate when the first is missing", () => {
    const spawnSync = vi.fn((cmd) =>
      cmd === "wl-copy"
        ? { error: new Error("ENOENT") }
        : cmd === "xclip"
          ? { status: 0 }
          : { status: 1 },
    );
    const res = copyToClipboard("p", { platform: "linux", spawnSync });
    expect(res).toEqual({ ok: true, tool: "xclip" });
  });

  it("reports failure when every candidate fails", () => {
    const spawnSync = vi.fn(() => ({ error: new Error("ENOENT") }));
    const res = copyToClipboard("p", { platform: "linux", spawnSync });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT/);
  });
});
