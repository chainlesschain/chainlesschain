/**
 * settings-loader — merge of `.claude/settings.json` permission files.
 *
 * Covers precedence (user < project < local < --settings < env), the union
 * semantics (a higher layer accretes rules but a lower-layer deny is never
 * dropped), source-file provenance, env kill-switch, and fail-open on a
 * malformed JSON file. The `_deps.fs` seam is replaced with an in-memory map
 * (vi.mock cannot intercept CJS require — see cli-dev rules).
 */
import { describe, expect, it, beforeEach } from "vitest";
import loader from "../../src/lib/settings-loader.cjs";

const { loadSettings, addRule, _deps } = loader;
const isWin = process.platform === "win32";
const HOME = isWin ? "C:\\home\\u" : "/home/u";
const CWD = isWin ? "C:\\proj" : "/proj";
const sep = isWin ? "\\" : "/";
const j = (...p) => p.join(sep);

const userFile = j(HOME, ".claude", "settings.json");
const projFile = j(CWD, ".claude", "settings.json");
const localFile = j(CWD, ".claude", "settings.local.json");

let files;

function setFile(path, obj) {
  files[path] = JSON.stringify(obj);
}

beforeEach(() => {
  files = {};
  _deps.homedir = () => HOME;
  _deps.fs = {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
    writeFileSync: (p, content) => {
      files[p] = String(content);
    },
    mkdirSync: () => {},
  };
});

describe("loadSettings — precedence & union", () => {
  it("unions allow rules across user/project/local", () => {
    setFile(userFile, { permissions: { allow: ["Read"] } });
    setFile(projFile, { permissions: { allow: ["Bash(npm run test:*)"] } });
    setFile(localFile, { permissions: { allow: ["Bash(git status:*)"] } });
    const { rules, files: contributed } = loadSettings({ cwd: CWD, env: {} });
    expect(rules.allow).toEqual([
      "Read",
      "Bash(npm run test:*)",
      "Bash(git status:*)",
    ]);
    expect(contributed).toContain(userFile);
    expect(contributed).toContain(localFile);
  });

  it("a lower-layer deny survives even if a higher layer allows the same", () => {
    setFile(userFile, { permissions: { deny: ["Bash(rm:*)"] } });
    setFile(localFile, { permissions: { allow: ["Bash(rm:*)"] } });
    const { rules } = loadSettings({ cwd: CWD, env: {} });
    expect(rules.deny).toContain("Bash(rm:*)");
    expect(rules.allow).toContain("Bash(rm:*)");
    // engine precedence (deny>allow) resolves the overlap, not the loader
  });

  it("de-dupes identical rules from multiple files", () => {
    setFile(userFile, { permissions: { allow: ["Read"] } });
    setFile(projFile, { permissions: { allow: ["Read"] } });
    const { rules } = loadSettings({ cwd: CWD, env: {} });
    expect(rules.allow).toEqual(["Read"]);
  });

  it("records the first source file for each rule", () => {
    setFile(userFile, { permissions: { deny: ["Bash(rm:*)"] } });
    const { sources } = loadSettings({ cwd: CWD, env: {} });
    expect(sources["deny:Bash(rm:*)"]).toBe(userFile);
  });
});

describe("loadSettings — explicit --settings file", () => {
  it("merges an explicit settings file at highest file precedence", () => {
    const extra = j(CWD, "ci-perms.json");
    setFile(extra, { permissions: { deny: ["Bash"] } });
    const { rules } = loadSettings({
      cwd: CWD,
      env: {},
      settingsFile: "ci-perms.json",
    });
    expect(rules.deny).toEqual(["Bash"]);
  });
});

describe("loadSettings — env kill-switch", () => {
  it("env vars accrete and are labelled <env>", () => {
    const {
      rules,
      sources,
      files: contributed,
    } = loadSettings({
      cwd: CWD,
      env: { CC_PERMISSIONS_DENY: "Bash(curl:*), Bash(wget:*)" },
    });
    expect(rules.deny).toEqual(["Bash(curl:*)", "Bash(wget:*)"]);
    expect(sources["deny:Bash(curl:*)"]).toBe("<env>");
    expect(contributed).toContain("<env>");
  });
});

describe("loadSettings — robustness", () => {
  it("fails open (skips) a malformed JSON file with a warning", () => {
    files[projFile] = "{ this is not json";
    let warned = "";
    const { rules } = loadSettings({
      cwd: CWD,
      env: {},
      onWarn: (m) => (warned = m),
    });
    expect(rules.allow).toEqual([]);
    expect(warned).toMatch(/malformed/);
  });

  it("returns empty rules when no settings files exist", () => {
    const { rules, files: contributed } = loadSettings({ cwd: CWD, env: {} });
    expect(rules).toEqual({ allow: [], ask: [], deny: [] });
    expect(contributed).toEqual([]);
  });

  it("ignores a non-object permissions field", () => {
    setFile(projFile, { permissions: "nope" });
    const { rules } = loadSettings({ cwd: CWD, env: {} });
    expect(rules).toEqual({ allow: [], ask: [], deny: [] });
  });
});

describe("addRule (shared writer for cc permissions add + REPL always-allow)", () => {
  it("creates settings.local.json and appends an allow rule (scope: local)", () => {
    const { file, added } = addRule({
      cwd: CWD,
      kind: "allow",
      rule: "Bash(git push:*)",
      scope: "local",
    });
    expect(added).toBe(true);
    expect(file).toBe(localFile);
    expect(JSON.parse(files[localFile]).permissions.allow).toEqual([
      "Bash(git push:*)",
    ]);
  });

  it("is idempotent (added=false when the rule already exists)", () => {
    setFile(localFile, { permissions: { allow: ["Read"] } });
    const { added } = addRule({
      cwd: CWD,
      kind: "allow",
      rule: "Read",
      scope: "local",
    });
    expect(added).toBe(false);
    expect(JSON.parse(files[localFile]).permissions.allow).toEqual(["Read"]);
  });

  it("writes to the project file by default and the user file for scope:user", () => {
    addRule({ cwd: CWD, kind: "deny", rule: "Bash(rm:*)" });
    expect(JSON.parse(files[projFile]).permissions.deny).toEqual([
      "Bash(rm:*)",
    ]);
    addRule({ cwd: CWD, kind: "allow", rule: "Read", scope: "user" });
    expect(JSON.parse(files[userFile]).permissions.allow).toEqual(["Read"]);
  });

  it("rejects an invalid kind", () => {
    expect(() => addRule({ cwd: CWD, kind: "maybe", rule: "Read" })).toThrow(
      /allow \| ask \| deny/,
    );
  });

  it("refuses to clobber a malformed target file", () => {
    files[localFile] = "{ not json";
    expect(() =>
      addRule({ cwd: CWD, kind: "allow", rule: "Read", scope: "local" }),
    ).toThrow(/malformed/);
  });
});

describe("readBooleanSetting — layered top-level boolean", () => {
  const { readBooleanSetting } = loader;

  it("returns undefined when no layer sets it", () => {
    setFile(userFile, { permissions: { allow: ["Read"] } });
    expect(
      readBooleanSetting("respondToBashCommands", { cwd: CWD }),
    ).toBeUndefined();
  });

  it("reads a boolean from a single layer", () => {
    setFile(userFile, { respondToBashCommands: false });
    expect(readBooleanSetting("respondToBashCommands", { cwd: CWD })).toBe(
      false,
    );
  });

  it("closest (local) layer wins over a lower layer", () => {
    setFile(userFile, { respondToBashCommands: true });
    setFile(localFile, { respondToBashCommands: false });
    expect(readBooleanSetting("respondToBashCommands", { cwd: CWD })).toBe(
      false,
    );
  });

  it("ignores non-boolean values", () => {
    setFile(userFile, { respondToBashCommands: "yes" });
    expect(
      readBooleanSetting("respondToBashCommands", { cwd: CWD }),
    ).toBeUndefined();
  });
});
