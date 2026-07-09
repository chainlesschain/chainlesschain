import { beforeEach, describe, expect, it } from "vitest";
import settingsLoader from "../../src/lib/settings-loader.cjs";
import {
  autoModeDefaultsDocument,
  createAutoModeApprovalGate,
  loadAutoModeConfig,
  resolveAutoModeDecisions,
} from "../../src/lib/auto-mode-config.js";

const { _deps } = settingsLoader;
const isWin = process.platform === "win32";
const HOME = isWin ? "C:\\home\\u" : "/home/u";
const CWD = isWin ? "C:\\proj" : "/proj";
const sep = isWin ? "\\" : "/";
const j = (...p) => p.join(sep);

const userFile = j(HOME, ".claude", "settings.json");
const projFile = j(CWD, ".claude", "settings.json");
const localFile = j(CWD, ".claude", "settings.local.json");
const managedFile = j(HOME, "managed-settings.json");

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

describe("auto-mode defaults", () => {
  it("documents the current trusted-policy mapping", () => {
    const defaults = autoModeDefaultsDocument();
    expect(defaults.mode).toBe("auto");
    expect(defaults.sessionPolicy).toBe("trusted");
    expect(defaults.settings.classifyAllShell).toBe(false);
    expect(defaults.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match: { riskLevel: "high" },
          decision: "ask",
          nonInteractiveDecision: "deny",
        }),
      ]),
    );
  });
});

describe("loadAutoModeConfig", () => {
  it("returns defaults when no settings file contributes autoMode", () => {
    const config = loadAutoModeConfig({ cwd: CWD, env: {} });
    expect(config.effective).toEqual({ classifyAllShell: false });
    expect(config.files).toEqual([]);
    expect(config.managedFile).toBe(null);
  });

  it("merges autoMode from user/project/local with closer scalar wins", () => {
    setFile(userFile, { autoMode: { classifyAllShell: false } });
    setFile(projFile, { autoMode: { explainDenials: true } });
    setFile(localFile, { autoMode: { classifyAllShell: true } });

    const config = loadAutoModeConfig({ cwd: CWD, env: {} });

    expect(config.effective).toEqual({
      classifyAllShell: true,
      explainDenials: true,
    });
    expect(config.files).toEqual([userFile, projFile, localFile]);
  });

  it("applies managed autoMode last", () => {
    setFile(localFile, { autoMode: { classifyAllShell: false } });
    setFile(managedFile, { autoMode: { classifyAllShell: true } });

    const config = loadAutoModeConfig({
      cwd: CWD,
      env: {},
      managedSettingsFile: managedFile,
    });

    expect(config.effective.classifyAllShell).toBe(true);
    expect(config.managedFile).toBe(managedFile);
    expect(config.files).toEqual([localFile, managedFile]);
  });
});

describe("resolveAutoModeDecisions", () => {
  it("mirrors the trusted policy when no decisions are configured", () => {
    const resolved = resolveAutoModeDecisions({ classifyAllShell: true });
    expect(resolved.customized).toBe(false);
    expect(resolved.map.low.decision).toBe("allow");
    expect(resolved.map.medium.decision).toBe("allow");
    expect(resolved.map.high.decision).toBe("ask");
    expect(resolved.map.high.source).toBe("default");
  });

  it("applies object-form overrides with reasons", () => {
    const resolved = resolveAutoModeDecisions({
      decisions: {
        medium: "ask",
        high: { decision: "deny", reason: "no dangerous shell unattended" },
      },
    });
    expect(resolved.customized).toBe(true);
    expect(resolved.map.medium).toMatchObject({
      decision: "ask",
      source: "settings",
    });
    expect(resolved.map.high).toMatchObject({
      decision: "deny",
      reason: "no dangerous shell unattended",
      source: "settings",
    });
    expect(resolved.map.low.decision).toBe("allow");
  });

  it("applies array-form overrides (defaults-document shape)", () => {
    const resolved = resolveAutoModeDecisions({
      decisions: [
        { match: { riskLevel: "medium" }, decision: "confirm" },
        { match: { riskLevel: "high" }, decision: "deny" },
      ],
    });
    expect(resolved.customized).toBe(true);
    expect(resolved.map.medium.decision).toBe("ask"); // confirm → ask alias
    expect(resolved.map.high.decision).toBe("deny");
  });

  it("ignores invalid risk levels and decision values", () => {
    const resolved = resolveAutoModeDecisions({
      decisions: { medium: "yolo", extreme: "deny", high: 42 },
    });
    expect(resolved.customized).toBe(false);
    expect(resolved.map.medium.decision).toBe("allow");
    expect(resolved.map.high.decision).toBe("ask");
  });

  it("does not report customized when overrides match the defaults", () => {
    const resolved = resolveAutoModeDecisions({
      decisions: { medium: "allow", high: "ask" },
    });
    expect(resolved.customized).toBe(false);
  });
});

describe("createAutoModeApprovalGate", () => {
  function makeInner() {
    return {
      calls: [],
      setSessionPolicy(...args) {
        this.calls.push(["setSessionPolicy", ...args]);
      },
      setConfirmer(...args) {
        this.calls.push(["setConfirmer", ...args]);
      },
      async decide() {
        throw new Error("inner decide must not be called by the wrapper");
      },
    };
  }

  it("allows / denies straight from the configured map", async () => {
    const resolved = resolveAutoModeDecisions({
      decisions: { medium: "deny" },
    });
    const gate = createAutoModeApprovalGate(makeInner(), resolved);

    const low = await gate.decide({ riskLevel: "low", tool: "run_shell" });
    expect(low).toMatchObject({ decision: "allow", via: "auto-mode-config" });

    const medium = await gate.decide({ riskLevel: "medium" });
    expect(medium).toMatchObject({
      decision: "deny",
      via: "auto-mode-config",
      rule: { riskLevel: "medium", decision: "deny", source: "settings" },
    });
    expect(typeof medium.reason).toBe("string");
  });

  it("routes ask through the confirmer and fails closed without one", async () => {
    const resolved = resolveAutoModeDecisions({
      decisions: { medium: "ask" },
    });
    const gate = createAutoModeApprovalGate(makeInner(), resolved);

    const noConfirmer = await gate.decide({ riskLevel: "medium" });
    expect(noConfirmer).toMatchObject({
      decision: "deny",
      via: "no-confirmer",
    });

    gate.setConfirmer(async () => true);
    const approved = await gate.decide({ riskLevel: "medium" });
    expect(approved).toMatchObject({ decision: "allow", via: "user-confirm" });

    gate.setConfirmer(async () => false);
    const denied = await gate.decide({ riskLevel: "medium" });
    expect(denied).toMatchObject({ decision: "deny", via: "user-deny" });

    gate.setConfirmer(async () => {
      throw new Error("boom");
    });
    const errored = await gate.decide({ riskLevel: "medium" });
    expect(errored).toMatchObject({ decision: "deny", via: "confirm-error" });
  });

  it("forwards session-policy and confirmer wiring to the inner gate", () => {
    const inner = makeInner();
    const gate = createAutoModeApprovalGate(
      inner,
      resolveAutoModeDecisions({ decisions: { high: "deny" } }),
    );
    gate.setSessionPolicy("s1", "trusted");
    const confirmer = async () => false;
    gate.setConfirmer(confirmer);
    expect(inner.calls).toEqual([
      ["setSessionPolicy", "s1", "trusted"],
      ["setConfirmer", confirmer],
    ]);
    expect(gate.hasConfirmer()).toBe(true);
  });

  it("delegates untouched to the inner gate while isActive() is false", async () => {
    const inner = {
      setConfirmer() {},
      async decide(ctx) {
        return {
          decision: "allow",
          via: "inner-gate",
          riskLevel: ctx.riskLevel,
        };
      },
    };
    let active = false;
    const gate = createAutoModeApprovalGate(
      inner,
      resolveAutoModeDecisions({ decisions: { medium: "deny" } }),
      { isActive: () => active },
    );

    // Inactive (e.g. REPL tier is strict/trusted): inner gate decides.
    const inactive = await gate.decide({ riskLevel: "medium" });
    expect(inactive).toMatchObject({ decision: "allow", via: "inner-gate" });

    // Mode switched to auto mid-session: the configured map bites.
    active = true;
    const activeResult = await gate.decide({ riskLevel: "medium" });
    expect(activeResult).toMatchObject({
      decision: "deny",
      via: "auto-mode-config",
    });
  });

  it("treats unknown risk levels as low", async () => {
    const gate = createAutoModeApprovalGate(
      makeInner(),
      resolveAutoModeDecisions({ decisions: { high: "deny" } }),
    );
    const result = await gate.decide({ riskLevel: "weird" });
    expect(result).toMatchObject({ decision: "allow", riskLevel: "low" });
  });
});
