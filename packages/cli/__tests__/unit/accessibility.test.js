/**
 * `cc agent --ax-screen-reader` — screen-reader friendly output switches.
 * The flag (or ambient CC_SCREEN_READER) forces mono/no-ANSI rendering and
 * kills the in-place repainting status line via the existing CC_STATUSLINE=0
 * switch. The REPL consumes CC_SCREEN_READER to force the mono theme.
 */
import { describe, it, expect } from "vitest";
import {
  applyScreenReaderMode,
  screenReaderRequested,
  screenReaderActive,
  SCREEN_READER_SWITCHES,
} from "../../src/lib/accessibility.js";

describe("applyScreenReaderMode", () => {
  it("sets CC_SCREEN_READER=1 and kills the status line on the given env", () => {
    const env = {};
    const applied = applyScreenReaderMode(env);
    expect(env).toEqual({ ...SCREEN_READER_SWITCHES });
    expect(env.CC_SCREEN_READER).toBe("1");
    expect(env.CC_STATUSLINE).toBe("0");
    expect(applied.sort()).toEqual(Object.keys(SCREEN_READER_SWITCHES).sort());
  });
});

describe("screenReaderRequested / screenReaderActive", () => {
  it("true for the explicit --ax-screen-reader flag", () => {
    expect(screenReaderRequested({ axScreenReader: true }, {})).toBe(true);
  });
  it("true for ambient CC_SCREEN_READER (1/true/yes/on)", () => {
    for (const v of ["1", "true", "YES", "on"]) {
      expect(screenReaderRequested({}, { CC_SCREEN_READER: v })).toBe(true);
      expect(screenReaderActive({ CC_SCREEN_READER: v })).toBe(true);
    }
  });
  it("false with no flag and no/false env", () => {
    expect(screenReaderRequested({}, {})).toBe(false);
    expect(screenReaderActive({})).toBe(false);
    expect(screenReaderActive({ CC_SCREEN_READER: "0" })).toBe(false);
    expect(screenReaderActive({ CC_SCREEN_READER: "off" })).toBe(false);
  });
});
