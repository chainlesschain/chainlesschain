import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { discoverPluginSkillLayers } from "../../src/lib/plugin-runtime/skills.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;

function installPlugin(scope, name, { withSkill = true, manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  if (withSkill) {
    const skillDir = path.join(dir, "skills", "greet");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: greet\n---\nHello",
      "utf8",
    );
  }
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pskill-"));
});
afterEach(() => {
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("discoverPluginSkillLayers", () => {
  it("returns the skills/ dir for a valid plugin with skills", () => {
    installPlugin("project", "greeter");
    const layers = discoverPluginSkillLayers({ cwd, scopes: ["project"] });
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      name: "greeter",
      scope: "project",
      version: "1.0.0",
    });
    expect(layers[0].path).toBe(
      path.join(
        cwd,
        ".chainlesschain",
        "plugins",
        "greeter",
        "1.0.0",
        "skills",
      ),
    );
  });

  it("skips a plugin with no skills/ directory", () => {
    installPlugin("project", "noskills", { withSkill: false });
    expect(
      discoverPluginSkillLayers({ cwd, scopes: ["project"] }),
    ).toHaveLength(0);
  });

  it("skips a plugin whose manifest failed validation (security)", () => {
    // A traversal in a declared skill path makes manifest.ok=false → nothing loads.
    installPlugin("project", "evil", {
      manifest: { skills: [{ name: "esc", path: "../../../etc" }] },
    });
    expect(
      discoverPluginSkillLayers({ cwd, scopes: ["project"] }),
    ).toHaveLength(0);
  });

  it("applies scope precedence — local overrides project on a name collision", () => {
    installPlugin("project", "shared");
    installPlugin("local", "shared");
    const layers = discoverPluginSkillLayers({
      cwd,
      scopes: ["project", "local"],
    });
    expect(layers).toHaveLength(1);
    expect(layers[0].scope).toBe("local");
  });

  it("returns [] when no plugins are installed", () => {
    expect(
      discoverPluginSkillLayers({ cwd, scopes: ["project", "local"] }),
    ).toEqual([]);
  });
});
