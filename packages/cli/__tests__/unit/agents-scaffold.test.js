/**
 * scaffoldAgent (lib/agents.js) — the shared scaffold used by `cc agents new`
 * and the REPL `/agents new`. Tested with an in-memory fs (injected deps).
 */
import { describe, it, expect } from "vitest";
import path from "path";
import { scaffoldAgent } from "../../src/lib/agents.js";

function memFs(existing = {}) {
  const files = { ...existing };
  return {
    files,
    deps: {
      fs: {
        existsSync: (p) =>
          Object.prototype.hasOwnProperty.call(files, path.resolve(p)),
        mkdirSync: () => {},
        writeFileSync: (p, content) => {
          files[path.resolve(p)] = content;
        },
      },
      path,
    },
  };
}

const CWD = path.resolve("/proj");
const HOME = path.resolve("/home/u");

describe("scaffoldAgent", () => {
  it("rejects an empty name", () => {
    const { deps } = memFs();
    expect(scaffoldAgent({ name: "  ", cwd: CWD, deps }).ok).toBe(false);
  });

  it("creates a project agent under .chainlesschain/agents by default", () => {
    const { files, deps } = memFs();
    const res = scaffoldAgent({
      name: "mybot",
      description: "does things",
      cwd: CWD,
      deps,
    });
    expect(res.ok).toBe(true);
    expect(res.name).toBe("mybot");
    const expected = path.join(CWD, ".chainlesschain", "agents", "mybot.md");
    expect(res.file).toBe(expected);
    expect(files[path.resolve(expected)]).toMatch(/name: mybot/);
    expect(files[path.resolve(expected)]).toMatch(/description: does things/);
    // no --tools → commented hint line
    expect(files[path.resolve(expected)]).toMatch(/# tools:/);
  });

  it("honors --claude and --personal locations", () => {
    const claude = scaffoldAgent({
      name: "a",
      cwd: CWD,
      location: "claude",
      deps: memFs().deps,
    });
    expect(claude.file).toBe(path.join(CWD, ".claude", "agents", "a.md"));
    const personal = scaffoldAgent({
      name: "a",
      cwd: CWD,
      location: "personal",
      home: HOME,
      deps: memFs().deps,
    });
    expect(personal.file).toBe(path.join(HOME, ".claude", "agents", "a.md"));
  });

  it("maps a colon name to a nested path but keeps the colon in frontmatter", () => {
    const { files, deps } = memFs();
    const res = scaffoldAgent({ name: "review:security", cwd: CWD, deps });
    expect(res.ok).toBe(true);
    expect(res.name).toBe("review:security");
    const expected = path.join(
      CWD,
      ".chainlesschain",
      "agents",
      "review",
      "security.md",
    );
    expect(res.file).toBe(expected);
    expect(files[path.resolve(expected)]).toMatch(/name: review:security/);
  });

  it("writes a tools line when --tools is given", () => {
    const { files, deps } = memFs();
    const res = scaffoldAgent({
      name: "b",
      tools: "read_file,git",
      cwd: CWD,
      deps,
    });
    expect(files[path.resolve(res.file)]).toMatch(/^tools: read_file,git$/m);
  });

  it("refuses to overwrite an existing file", () => {
    const target = path.resolve(
      path.join(CWD, ".chainlesschain", "agents", "dup.md"),
    );
    const { deps } = memFs({ [target]: "existing" });
    const res = scaffoldAgent({ name: "dup", cwd: CWD, deps });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/already exists/);
  });
});
