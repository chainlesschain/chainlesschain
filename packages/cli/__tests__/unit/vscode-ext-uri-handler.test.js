/**
 * Deep-link parser for the VS Code extension (vscode://…/open[?prompt=…]).
 * Pure → no host needed.
 */
import { describe, it, expect } from "vitest";
import {
  parseDeepLink,
  SAFE_DEEP_LINK_MODES,
} from "../../../vscode-extension/src/uri-handler.js";

/** Build an `?…` query the way a real URI would encode it. */
function q(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

describe("parseDeepLink", () => {
  it("maps /open (and the bare authority) to the open action", () => {
    expect(parseDeepLink({ path: "/open" })).toEqual({ action: "open" });
    expect(parseDeepLink({ path: "" })).toEqual({ action: "open" });
    expect(parseDeepLink({})).toEqual({ action: "open" });
    // case-insensitive + leading slashes tolerated
    expect(parseDeepLink({ path: "//OPEN" })).toEqual({ action: "open" });
  });

  it("extracts and decodes a prompt query param", () => {
    expect(
      parseDeepLink({ path: "/open", query: "prompt=fix%20the%20bug" }),
    ).toEqual({
      action: "open",
      prompt: "fix the bug",
    });
    // '+' decodes to a space too
    expect(
      parseDeepLink({ path: "/open", query: "prompt=hello+world" }),
    ).toEqual({
      action: "open",
      prompt: "hello world",
    });
  });

  it("ignores other params and a blank/whitespace prompt", () => {
    expect(parseDeepLink({ path: "/open", query: "foo=1&bar=2" })).toEqual({
      action: "open",
    });
    expect(parseDeepLink({ path: "/open", query: "prompt=" })).toEqual({
      action: "open",
    });
    expect(parseDeepLink({ path: "/open", query: "prompt=%20%20" })).toEqual({
      action: "open",
    });
  });

  it("returns null for an unknown action (ignored, never misfires)", () => {
    expect(parseDeepLink({ path: "/settings" })).toBe(null);
    expect(parseDeepLink({ path: "/run", query: "prompt=x" })).toBe(null);
  });

  it("never throws on a malformed percent-escape", () => {
    expect(() =>
      parseDeepLink({ path: "/open", query: "prompt=%E0%A4%A" }),
    ).not.toThrow();
    const r = parseDeepLink({ path: "/open", query: "prompt=%zz" });
    expect(r.action).toBe("open");
    expect(r.prompt).toBe("%zz"); // left as-is when undecodable
  });

  it("picks the FIRST prompt when repeated", () => {
    expect(
      parseDeepLink({ path: "/open", query: "prompt=a&prompt=b" }).prompt,
    ).toBe("a");
  });

  it("resumes a valid session id and rejects a junk/oversized one", () => {
    expect(
      parseDeepLink({ path: "/open", query: "session=panel-1720-a9f" }).session,
    ).toBe("panel-1720-a9f");
    // spaces / path separators / over-128 chars are rejected → no session key
    expect(
      parseDeepLink({ path: "/open", query: q({ session: "../etc/passwd" }) })
        .session,
    ).toBeUndefined();
    expect(
      parseDeepLink({ path: "/open", query: q({ session: "a".repeat(200) }) })
        .session,
    ).toBeUndefined();
  });

  it("carries a file with a 1-based line, dropping a line with no file", () => {
    const r = parseDeepLink({
      path: "/open",
      query: q({ file: "src/app.ts", line: "42" }),
    });
    expect(r.file).toBe("src/app.ts");
    expect(r.line).toBe(42);
    // line alone is meaningless
    expect(
      parseDeepLink({ path: "/open", query: "line=9" }).line,
    ).toBeUndefined();
    // 0 / negative / NaN lines are ignored, file still opens at the top
    for (const bad of ["0", "-3", "abc", ""]) {
      const x = parseDeepLink({
        path: "/open",
        query: q({ file: "a.ts", line: bad }),
      });
      expect(x.file).toBe("a.ts");
      expect(x.line).toBeUndefined();
    }
  });

  it("round-trips Windows drive, spaced, and 中文/emoji paths untouched", () => {
    for (const p of [
      "C:\\Users\\me\\My Project\\src\\index.ts",
      "/home/me/项目/文件.ts",
      "D:\\代码\\a b\\📁\\main.rs",
    ]) {
      expect(parseDeepLink({ path: "/open", query: q({ file: p }) }).file).toBe(
        p,
      );
    }
  });

  it("returns the target workspace verbatim for the host to compare", () => {
    expect(
      parseDeepLink({
        path: "/open",
        query: q({ workspace: "C:\\code\\repo a" }),
      }).workspace,
    ).toBe("C:\\code\\repo a");
  });

  it("accepts safe approval modes but NEVER bypassPermissions", () => {
    expect(parseDeepLink({ path: "/open", query: "mode=default" }).mode).toBe(
      "default",
    );
    expect(
      parseDeepLink({ path: "/open", query: "mode=acceptEdits" }).mode,
    ).toBe("acceptEdits");
    expect(parseDeepLink({ path: "/open", query: "mode=plan" }).mode).toBe(
      "plan",
    );
    // the dangerous one is dropped — an untrusted link can't arm auto-approval
    expect(SAFE_DEEP_LINK_MODES.has("bypassPermissions")).toBe(false);
    expect(
      parseDeepLink({ path: "/open", query: "mode=bypassPermissions" }).mode,
    ).toBeUndefined();
    expect(parseDeepLink({ path: "/open", query: "mode=garbage" }).mode).toBe(
      undefined,
    );
  });

  it("combines prompt + session + file + line + mode in one link", () => {
    const r = parseDeepLink({
      path: "/open",
      query: q({
        prompt: "fix the crash",
        session: "panel-9-x",
        file: "C:\\r\\a.ts",
        line: "7",
        mode: "acceptEdits",
      }),
    });
    expect(r).toEqual({
      action: "open",
      prompt: "fix the crash",
      session: "panel-9-x",
      file: "C:\\r\\a.ts",
      line: 7,
      mode: "acceptEdits",
    });
  });
});
