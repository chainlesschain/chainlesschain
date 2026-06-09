/**
 * output-styles — `/output-style` persona loader (Claude-Code parity).
 *
 * Covers built-ins, file discovery + frontmatter, file-shadows-builtin,
 * settings.json `outputStyle` default, resolve precedence, and the
 * composeSystemPrompt outputStyle append. `_deps.fs/homedir` is stubbed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  discoverOutputStyles,
  getOutputStyle,
  resolveOutputStyle,
  settingsDefaultOutputStyle,
  _deps,
} from "../../src/lib/output-styles.js";
import { composeSystemPrompt } from "../../src/runtime/system-prompt.js";

const isWin = process.platform === "win32";
const HOME = isWin ? "C:\\home\\u" : "/home/u";
const CWD = isWin ? "C:\\proj" : "/proj";
const sep = isWin ? "\\" : "/";
const j = (...p) => p.join(sep);

let files; // path → content string
let dirs; // dir → [filenames]

beforeEach(() => {
  files = {};
  dirs = {};
  _deps.homedir = () => HOME;
  _deps.fs = {
    existsSync: (p) => p in files,
    readFileSync: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
    readdirSync: (dir) =>
      (dirs[dir] || []).map((name) => ({
        name,
        isFile: () => true,
        isDirectory: () => false,
      })),
  };
});

function addStyleFile(dir, filename, content) {
  dirs[dir] = dirs[dir] || [];
  dirs[dir].push(filename);
  files[j(dir, filename)] = content;
}

describe("built-ins", () => {
  it("ships default / explanatory / learning", () => {
    const names = discoverOutputStyles(CWD).map((s) => s.name).sort();
    expect(names).toContain("default");
    expect(names).toContain("explanatory");
    expect(names).toContain("learning");
  });
  it("getOutputStyle is case-insensitive", () => {
    expect(getOutputStyle("Explanatory", CWD).name).toBe("explanatory");
  });
});

describe("file discovery", () => {
  it("loads a project style file with frontmatter", () => {
    addStyleFile(
      j(CWD, ".claude", "output-styles"),
      "pirate.md",
      "---\nname: pirate\ndescription: Talk like a pirate\n---\nArr, respond in pirate voice.",
    );
    const s = getOutputStyle("pirate", CWD);
    expect(s).toMatchObject({
      name: "pirate",
      description: "Talk like a pirate",
      scope: "project",
      builtin: false,
    });
    expect(s.body).toBe("Arr, respond in pirate voice.");
  });

  it("a file shadows a same-named built-in", () => {
    addStyleFile(
      j(CWD, ".claude", "output-styles"),
      "explanatory.md",
      "---\nname: explanatory\n---\nCUSTOM explanatory body.",
    );
    expect(getOutputStyle("explanatory", CWD).body).toBe(
      "CUSTOM explanatory body.",
    );
  });
});

describe("settings.json default + resolve", () => {
  it("reads outputStyle from settings.json (last layer wins)", () => {
    files[j(CWD, ".claude", "settings.json")] = JSON.stringify({
      outputStyle: "learning",
    });
    expect(settingsDefaultOutputStyle(CWD)).toBe("learning");
  });

  it("explicit name beats the settings default", () => {
    files[j(CWD, ".claude", "settings.json")] = JSON.stringify({
      outputStyle: "learning",
    });
    expect(resolveOutputStyle("explanatory", CWD).name).toBe("explanatory");
  });

  it("falls back to settings default when no explicit name", () => {
    files[j(CWD, ".claude", "settings.json")] = JSON.stringify({
      outputStyle: "learning",
    });
    expect(resolveOutputStyle(null, CWD).name).toBe("learning");
  });

  it("returns null when nothing is configured", () => {
    expect(resolveOutputStyle(null, CWD)).toBeNull();
  });

  it("flags a missing style name", () => {
    expect(resolveOutputStyle("nope", CWD)).toMatchObject({
      missing: true,
      body: "",
    });
  });
});

describe("composeSystemPrompt outputStyle", () => {
  it("appends the style after base + appendSystemPrompt", () => {
    const out = composeSystemPrompt("BASE", {
      appendSystemPrompt: "APPEND",
      outputStyle: "STYLE",
    });
    expect(out).toBe("BASE\n\nAPPEND\n\nSTYLE");
  });
  it("no outputStyle leaves the prompt unchanged", () => {
    expect(composeSystemPrompt("BASE", {})).toBe("BASE");
  });
});
