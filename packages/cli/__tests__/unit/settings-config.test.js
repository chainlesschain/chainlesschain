/**
 * settings-loader.loadSettingsConfig — the native-config override half of
 * `--settings`: model + env from the same .claude/settings.json files
 * (user < project < local < --settings, last-write-wins). The `_deps.fs` /
 * `_deps.homedir` seams are replaced with an in-memory map (vi.mock can't
 * intercept CJS require — see cli-dev rules).
 */
import { describe, expect, it, beforeEach } from "vitest";
import loader from "../../src/lib/settings-loader.cjs";

const { loadSettingsConfig, _deps } = loader;
const isWin = process.platform === "win32";
const HOME = isWin ? "C:\\home\\u" : "/home/u";
const CWD = isWin ? "C:\\proj" : "/proj";
const sep = isWin ? "\\" : "/";
const j = (...p) => p.join(sep);

const userFile = j(HOME, ".claude", "settings.json");
const projFile = j(CWD, ".claude", "settings.json");
const overrideFile = j(CWD, "override.json");
const managedFile = j(HOME, "managed-settings.json");

let files;
const setFile = (p, obj) => {
  files[p] = JSON.stringify(obj);
};

beforeEach(() => {
  files = {};
  _deps.homedir = () => HOME;
  _deps.fs = {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
  };
});

describe("loadSettingsConfig", () => {
  it("returns empty defaults when no settings files exist", () => {
    expect(loadSettingsConfig({ cwd: CWD })).toEqual({
      model: null,
      env: {},
      sandbox: null,
      files: [],
    });
  });

  it("extracts model + env from a project settings file", () => {
    setFile(projFile, {
      model: "claude-sonnet-4-6",
      env: { OLLAMA_HOST: "http://x:11434" },
    });
    const r = loadSettingsConfig({ cwd: CWD });
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.env).toEqual({ OLLAMA_HOST: "http://x:11434" });
    expect(r.files).toEqual([projFile]);
  });

  it("explicit --settings file wins over project (last-write-wins)", () => {
    setFile(projFile, { model: "proj-model", env: { A: "1" } });
    setFile(overrideFile, { model: "override-model", env: { B: "2" } });
    const r = loadSettingsConfig({ cwd: CWD, settingsFile: "override.json" });
    expect(r.model).toBe("override-model");
    expect(r.env).toEqual({ A: "1", B: "2" }); // env accretes; per-key last wins
  });

  it("merges env per-key with later files winning", () => {
    setFile(userFile, { env: { A: "user", B: "user" } });
    setFile(projFile, { env: { B: "proj" } });
    const r = loadSettingsConfig({ cwd: CWD });
    expect(r.env).toEqual({ A: "user", B: "proj" });
  });

  it("managed settings override explicit user-controlled config", () => {
    setFile(overrideFile, { model: "user-model", env: { REGION: "user" } });
    setFile(managedFile, {
      model: "managed-model",
      env: { REGION: "managed", AUDIT: "1" },
    });
    const r = loadSettingsConfig({
      cwd: CWD,
      settingsFile: "override.json",
      managedSettingsFile: managedFile,
    });
    expect(r.model).toBe("managed-model");
    expect(r.env).toEqual({ REGION: "managed", AUDIT: "1" });
    expect(r.files.at(-1)).toBe(managedFile);
  });

  it("ignores non-string model, non-object env, and non-string env values", () => {
    setFile(projFile, { model: 42, env: { A: 1, B: "ok", C: null } });
    const r = loadSettingsConfig({ cwd: CWD });
    expect(r.model).toBeNull();
    expect(r.env).toEqual({ B: "ok" });
  });
});
