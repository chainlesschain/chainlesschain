/**
 * Unit tests: src/lib/packer/pkg-config-generator.js
 *
 * Verifies the synthesized package.json shape (assets / scripts / targets /
 * outputPath / compress) and the pack-entry.js bootstrap script.
 *
 * The generator never invokes pkg — it only writes files — so all assertions
 * are filesystem-readable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generatePkgConfig } from "../../src/lib/packer/pkg-config-generator.js";
import { artifactFixture } from "./linux-subreaper-artifact-fixture.js";

const subreaperSource = fs.readFileSync(
  new URL(
    "../../src/lib/process-execution-broker/linux-subreaper-supervisor.c",
    import.meta.url,
  ),
);

describe("generatePkgConfig", () => {
  let cliRoot;
  let tempDir;
  let distDir;
  let templatesDir;

  beforeEach(() => {
    cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cli-"));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tmp-"));
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dist-"));
    templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-tpl-"));

    // Minimal real package.json so the generator can read version
    fs.writeFileSync(
      path.join(cliRoot, "package.json"),
      JSON.stringify({ name: "chainlesschain", version: "0.156.6" }),
    );
    fs.mkdirSync(path.join(cliRoot, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(cliRoot, "bin", "chainlesschain.js"),
      "// fake bin",
    );
    const capsuleLib = path.join(cliRoot, "src", "lib");
    fs.mkdirSync(capsuleLib, { recursive: true });
    fs.writeFileSync(
      path.join(capsuleLib, "mcp-stdio-capsule-builder-worker.cjs"),
      "// pinned worker source",
    );
    fs.writeFileSync(
      path.join(capsuleLib, "mcp-stdio-immutable-vfs-resolver.cjs"),
      "// pinned resolver source",
    );
    const esbuildWasmRoot = path.join(cliRoot, "node_modules", "esbuild-wasm");
    fs.mkdirSync(path.join(esbuildWasmRoot, "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(esbuildWasmRoot, "package.json"),
      JSON.stringify({ name: "esbuild-wasm", version: "0.28.1" }),
    );
    fs.writeFileSync(
      path.join(esbuildWasmRoot, "lib", "browser.js"),
      "// pinned browser API",
    );
    fs.writeFileSync(
      path.join(esbuildWasmRoot, "esbuild.wasm"),
      Buffer.from([0, 97, 115, 109]),
    );
  });

  afterEach(() => {
    for (const d of [cliRoot, tempDir, distDir, templatesDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  function callGenerator(extraOpts = {}) {
    return generatePkgConfig({
      cliRoot,
      tempDir,
      distDir,
      prebuildsDir: null,
      templatesDir,
      targets: ["node20-win-x64"],
      outputPath: path.join(tempDir, "out", "myapp"),
      compress: true,
      ...extraOpts,
    });
  }

  function assetPaths(result, config) {
    return config.pkg.assets.map((asset) =>
      path.resolve(result.pkgConfigDir, asset).replace(/\\/g, "/"),
    );
  }

  it("emits relative scripts/assets compatible with pkg's path.join walker", () => {
    const result = callGenerator();
    const config = JSON.parse(fs.readFileSync(result.pkgConfigFile, "utf8"));
    for (const pattern of [...config.pkg.scripts, ...config.pkg.assets]) {
      expect(path.isAbsolute(pattern)).toBe(false);
      expect(path.win32.isAbsolute(pattern)).toBe(false);
      expect(path.join(result.pkgConfigDir, pattern)).toBe(
        path.resolve(result.pkgConfigDir, pattern),
      );
    }
  });

  it("rejects an asset that cannot be expressed relative to the config drive", () => {
    const relative = vi
      .spyOn(path, "relative")
      .mockReturnValueOnce("D:\\other-drive\\asset");
    try {
      expect(() => callGenerator()).toThrow(/same filesystem drive/);
    } finally {
      relative.mockRestore();
    }
  });

  function stageLinuxHelper(arch = "x64") {
    const broker = path.join(cliRoot, "src/lib/process-execution-broker");
    fs.mkdirSync(broker, { recursive: true });
    fs.writeFileSync(
      path.join(broker, "linux-subreaper-supervisor.c"),
      subreaperSource,
    );
    const directory = path.join(
      cliRoot,
      `src/assets/linux-subreaper/linux-${arch}`,
    );
    fs.mkdirSync(directory, { recursive: true });
    const fixture = artifactFixture(arch);
    fs.writeFileSync(
      path.join(directory, "manifest.json"),
      JSON.stringify(fixture.manifest),
    );
    fs.writeFileSync(path.join(directory, "supervisor"), fixture.image);
    return directory;
  }

  it("embeds validated source and only the requested Linux helper architectures", () => {
    stageLinuxHelper("x64");
    stageLinuxHelper("arm64");
    const result = callGenerator({
      targets: ["node22-linux-x64", "node22-linux-arm64", "node22-alpine-x64"],
    });
    const config = JSON.parse(fs.readFileSync(result.pkgConfigFile, "utf8"));
    const helpers = config.pkg.assets.filter((asset) =>
      /linux-subreaper/.test(asset),
    );
    expect(helpers).toHaveLength(5);
    expect(
      helpers.some((asset) => asset.endsWith("linux-subreaper-supervisor.c")),
    ).toBe(true);
    for (const arch of ["x64", "arm64"])
      for (const name of ["supervisor", "manifest.json"])
        expect(
          helpers.some((asset) => asset.endsWith(`linux-${arch}/${name}`)),
        ).toBe(true);
  });

  it.each(["missing", "missing-arch", "image", "manifest", "source"])(
    "refuses a Linux standalone build with %s helper input",
    (kind) => {
      const directory = stageLinuxHelper();
      if (kind === "missing") fs.unlinkSync(path.join(directory, "supervisor"));
      if (kind === "image")
        fs.appendFileSync(path.join(directory, "supervisor"), "changed");
      if (kind === "manifest")
        fs.writeFileSync(path.join(directory, "manifest.json"), "{}");
      if (kind === "source")
        fs.appendFileSync(
          path.join(
            cliRoot,
            "src/lib/process-execution-broker/linux-subreaper-supervisor.c",
          ),
          "changed",
        );
      const targets = [
        kind === "missing-arch" ? "node22-linux-arm64" : "node22-linux-x64",
      ];
      expect(() => callGenerator({ targets })).toThrow(
        /require valid precompiled process supervision assets/,
      );
    },
  );

  it.each(["linux-x64", "alpine-x64", "linux", "node22-linux", "host"])(
    "requires helper assets for pkg target alias %s on its resolved host",
    (target) => {
      const linuxTarget = target !== "host" || process.platform === "linux";
      if (linuxTarget) {
        expect(() => callGenerator({ targets: [target] })).toThrow(
          /require valid precompiled process supervision assets/,
        );
      }
      stageLinuxHelper("x64");
      stageLinuxHelper("arm64");
      const result = callGenerator({ targets: [target] });
      const config = JSON.parse(fs.readFileSync(result.pkgConfigFile, "utf8"));
      const helpers = config.pkg.assets.filter((asset) =>
        /linux-subreaper/.test(asset),
      );
      expect(helpers).toHaveLength(linuxTarget ? 3 : 0);
      if (linuxTarget) {
        const arch = target.endsWith("-x64") ? "x64" : process.arch;
        expect(
          helpers.some((asset) => asset.endsWith(`linux-${arch}/supervisor`)),
        ).toBe(true);
      }
    },
  );

  it("generates Linux assets after the real CLI process guard is installed", () => {
    stageLinuxHelper("x64");
    const guard = new URL(
      "../../src/lib/process-execution-broker/patch-child-process.js",
      import.meta.url,
    ).href;
    const generator = new URL(
      "../../src/lib/packer/pkg-config-generator.js",
      import.meta.url,
    ).href;
    const ctx = {
      cliRoot,
      tempDir,
      distDir,
      templatesDir,
      prebuildsDir: null,
      targets: ["linux-x64"],
      outputPath: path.join(tempDir, "out"),
      compress: true,
    };
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      await import(${JSON.stringify(guard)});
      const childProcess = (await import('node:child_process')).default;
      assert.throws(() => childProcess.spawnSync('ldd'), /policy_prompt/);
      // Expose pkg-fetch's Linux-only import probe even on Windows CI. Path
      // operations retain the real host implementation selected at startup.
      Object.defineProperty(process, 'platform', {value:'linux'});
      const {generatePkgConfig} = await import(${JSON.stringify(generator)});
      generatePkgConfig(${JSON.stringify(ctx)});
    `,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    expect(child.status, child.stderr || child.stdout).toBe(0);
  });

  it("refuses unsupported Linux architectures instead of omitting supervision", () => {
    expect(() => callGenerator({ targets: ["node22-linux-armv7"] })).toThrow(
      /Unsupported standalone Linux process supervision architecture: armv7/,
    );
  });

  it("refuses an empty target list instead of pkg's implicit host fallback", () => {
    expect(() => callGenerator({ targets: [] })).toThrow(
      /require at least one explicit pkg target/,
    );
  });

  it("creates pkg-config dir, package.json, and pack-entry.js", () => {
    const r = callGenerator();
    expect(fs.existsSync(r.pkgConfigDir)).toBe(true);
    expect(fs.existsSync(r.pkgConfigFile)).toBe(true);
    expect(fs.existsSync(r.entryScript)).toBe(true);
    expect(path.basename(r.pkgConfigFile)).toBe("package.json");
    expect(path.basename(r.entryScript)).toBe("pack-entry.js");
  });

  it("synthesized package.json inherits version from real CLI package", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.name).toBe("chainlesschain-pack");
    expect(synth.version).toBe("0.156.6");
    expect(synth.bin).toBe("pack-entry.js");
  });

  it("includes targets, outputPath, compress in pkg block", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.pkg.targets).toEqual(["node20-win-x64"]);
    expect(synth.pkg.compress).toBe("GZip");
    expect(typeof synth.pkg.outputPath).toBe("string");
  });

  it("compress=false yields None", () => {
    const r = callGenerator({ compress: false });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    expect(synth.pkg.compress).toBe("None");
  });

  it("assets always include distDir + templatesDir", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = assetPaths(r, synth).join("|");
    expect(assetStr).toContain(distDir.replace(/\\/g, "/"));
    expect(assetStr).toContain(templatesDir.replace(/\\/g, "/"));
  });

  it("embeds Windows helpers and only the fixed recovery installer script", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const brokerRoot = path
      .join(cliRoot, "src", "lib", "process-execution-broker")
      .replace(/\\/g, "/");
    const recoveryInstaller = path
      .join(cliRoot, "install", "install.ps1")
      .replace(/\\/g, "/");
    expect(assetPaths(r, synth)).toEqual(
      expect.arrayContaining([
        `${brokerRoot}/windows-sandbox-helper.dll`,
        `${brokerRoot}/windows-sandbox-helper.exe`,
        `${brokerRoot}/windows-sandbox.cs`,
        recoveryInstaller,
      ]),
    );
    expect(
      assetPaths(r, synth).filter((asset) => /\.ps1(?:$|[*])/i.test(asset)),
    ).toEqual([recoveryInstaller]);
  });

  it("embeds the raw macOS launcher contract inputs required at module load", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const brokerRoot = path
      .join(cliRoot, "src", "lib", "process-execution-broker")
      .replace(/\\/g, "/");
    expect(assetPaths(r, synth)).toEqual(
      expect.arrayContaining([
        `${brokerRoot}/macos-mcp-launcher.c`,
        `${brokerRoot}/macos-mcp-launcher-protocol.json`,
      ]),
    );
  });

  it("embeds every raw capsule asset under one canonical identity", () => {
    const aliasParent = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-posix-cli-alias-"),
    );
    const lexicalCliRoot = path.join(aliasParent, "var", "folders", "cli");
    fs.mkdirSync(path.dirname(lexicalCliRoot), { recursive: true });
    fs.symlinkSync(
      cliRoot,
      lexicalCliRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    try {
      const r = callGenerator({ cliRoot: lexicalCliRoot });
      const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
      const canonicalCliRoot = fs.realpathSync.native(lexicalCliRoot);
      const canonicalBuilderRoot = fs.realpathSync.native(
        path.join(lexicalCliRoot, "node_modules", "esbuild-wasm"),
      );
      const expected = [
        path.join(canonicalBuilderRoot, "package.json"),
        path.join(canonicalBuilderRoot, "lib", "browser.js"),
        path.join(canonicalBuilderRoot, "esbuild.wasm"),
        path.join(
          canonicalCliRoot,
          "src",
          "lib",
          "mcp-stdio-capsule-builder-worker.cjs",
        ),
        path.join(
          canonicalCliRoot,
          "src",
          "lib",
          "mcp-stdio-immutable-vfs-resolver.cjs",
        ),
      ].map((asset) => asset.replace(/\\/g, "/"));
      expect(assetPaths(r, synth)).toEqual(expect.arrayContaining(expected));
    } finally {
      try {
        fs.unlinkSync(lexicalCliRoot);
      } catch {
        fs.rmSync(lexicalCliRoot, { recursive: true, force: true });
      }
      fs.rmSync(aliasParent, { recursive: true, force: true });
    }
  });

  it("assets include prebuildsDir when provided", () => {
    const prebuildsDir = path.join(tempDir, "prebuilds");
    fs.mkdirSync(prebuildsDir);
    const r = callGenerator({ prebuildsDir });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = assetPaths(r, synth).join("|");
    expect(assetStr).toContain(prebuildsDir.replace(/\\/g, "/"));
  });

  it("assets exclude prebuildsDir when null", () => {
    const r = callGenerator({ prebuildsDir: null });
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const assetStr = synth.pkg.assets.join("|");
    expect(assetStr).not.toContain("prebuilds");
  });

  it("scripts glob covers cli src + bin", () => {
    const r = callGenerator();
    const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
    const scripts = synth.pkg.scripts.join("|");
    expect(scripts).toContain("/src/**/*.js");
    expect(scripts).toContain("/bin/**/*.js");
  });

  it("pack-entry.js sets CC_PACK_MODE=1", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain("CC_PACK_MODE");
    expect(entry).toContain("'1'");
  });

  it("pack-entry.js statically imports the lazy CLI bootstrap without top-level-await index.js", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    // The eager compatibility index uses top-level await, which pkg's CJS
    // bootstrap cannot require on Node 22.
    expect(entry).toMatch(/import\s+\{\s*ensureUtf8\s*\}\s+from/);
    expect(entry).toMatch(/import\s+\{\s*runCli\s*\}\s+from/);
    expect(entry).toContain("runCli(process.argv).catch(_handleFatal)");
    expect(entry).not.toContain("src/index.js");
    expect(entry).not.toMatch(/\bimport\(/);
  });

  it("pack-entry.js defaults to `ui` when no subcommand is given (double-click friendliness)", () => {
    const r = callGenerator();
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    // CLI-only: BAKED.projectMode is absent, _entryCmd falls back to literal 'ui'
    expect(entry).toContain("BAKED.projectMode ? BAKED.projectEntry : 'ui'");
    expect(entry).toContain("_entryCmd.split");
    expect(entry).toContain("uncaughtException");
  });

  it("pack-entry.js bakes runtime defaults (token/ports/host) and honors env overrides", () => {
    const r = callGenerator({
      runtime: {
        token: "auto",
        bindHost: "0.0.0.0",
        wsPort: 29000,
        uiPort: 29010,
      },
    });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    // Defaults serialize into the frozen BAKED constant.
    expect(entry).toContain('"tokenMode":"auto"');
    expect(entry).toContain('"host":"0.0.0.0"');
    expect(entry).toContain('"wsPort":"29000"');
    expect(entry).toContain('"uiPort":"29010"');
    // Env-var overrides are honored before the frozen default.
    expect(entry).toContain("CC_PACK_UI_PORT");
    expect(entry).toContain("CC_PACK_WS_PORT");
    expect(entry).toContain("CC_PACK_HOST");
    expect(entry).toContain("CC_PACK_TOKEN");
    // Only inject a flag the user didn't already pass on the command line.
    expect(entry).toContain("_hasFlag('-p', '--port')");
    expect(entry).toContain("_hasFlag('--token')");
    // 'auto' token mode must generate a fresh random token each run.
    expect(entry).toContain("crypto.randomBytes(16)");
  });

  it("pack-entry.js token='' (empty) disables token injection entirely", () => {
    const r = callGenerator({ runtime: { token: "" } });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain('"tokenMode":""');
    // The literal empty string is falsy, so the `&& BAKED.tokenMode` guard
    // in the entry skips `--token` injection — no-auth mode intentionally.
    expect(entry).toContain("&& BAKED.tokenMode");
  });

  it("pack-entry.js token='<literal>' hardcodes the baked value", () => {
    const r = callGenerator({ runtime: { token: "hunter2" } });
    const entry = fs.readFileSync(r.entryScript, "utf-8");
    expect(entry).toContain('"tokenMode":"hunter2"');
  });

  describe("project mode", () => {
    const FAKE_SHA =
      "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd";
    let projectDir;

    beforeEach(() => {
      projectDir = path.join(tempDir, "project");
      const ccDir = path.join(projectDir, ".chainlesschain");
      fs.mkdirSync(ccDir, { recursive: true });
      fs.writeFileSync(
        path.join(ccDir, "config.json"),
        JSON.stringify({
          name: "my-medical-agent",
          pack: {
            entry: "chat",
            autoPersona: "medical-persona",
            allowedSubcommands: ["chat", "agent"],
          },
        }),
        "utf-8",
      );
    });

    function callProjectGenerator(extraOpts = {}) {
      return callGenerator({
        project: {
          projectDir,
          projectName: "my-medical-agent",
          configSha: FAKE_SHA,
        },
        ...extraOpts,
      });
    }

    it("BAKED includes projectMode/projectName/projectEntry/projectConfigSha", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectMode":true');
      expect(entry).toContain('"projectName":"my-medical-agent"');
      expect(entry).toContain('"projectEntry":"chat"');
      expect(entry).toContain(`"projectConfigSha":"${FAKE_SHA}"`);
    });

    it("reads projectEntry from config.pack.entry when ctx.projectEntry is omitted", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectEntry":"chat"');
    });

    it("ctx.projectEntry overrides config.pack.entry", () => {
      const r = callProjectGenerator({ projectEntry: "agent" });
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectEntry":"agent"');
    });

    it("defaults to ui entry when config has no pack.entry field", () => {
      const ccDir = path.join(projectDir, ".chainlesschain");
      fs.writeFileSync(
        path.join(ccDir, "config.json"),
        JSON.stringify({ name: "bare-agent" }),
        "utf-8",
      );
      const r = callGenerator({
        project: { projectDir, projectName: "bare-agent", configSha: FAKE_SHA },
      });
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectEntry":"ui"');
    });

    it("entry script sets CC_PROJECT_ROOT and has materialization block", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain("CC_PROJECT_ROOT");
      expect(entry).not.toContain("process.chdir");
      expect(entry).toContain(".chainlesschain-projects");
      expect(entry).toContain("copyRecursiveMerge");
    });

    it("entry script checks .pack-version marker before re-materializing", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain(".pack-version");
      expect(entry).toContain("_needsMaterialize");
      expect(entry).toContain("BAKED.projectConfigSha");
    });

    it("forceRefreshOnLaunch=true bakes the flag as true", () => {
      const r = callProjectGenerator({ forceRefreshOnLaunch: true });
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"forceRefreshOnLaunch":true');
    });

    it("CC_PROJECT_ALLOWED_SUBCOMMANDS is set from projectAllowedSubcommands", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain("CC_PROJECT_ALLOWED_SUBCOMMANDS");
      expect(entry).toContain(".join(',')");
    });

    it("CC_PACK_AUTO_PERSONA is set from config.pack.autoPersona (Phase 3b)", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectAutoPersona":"medical-persona"');
      expect(entry).toContain("CC_PACK_AUTO_PERSONA");
      // Guarded by `if (BAKED.projectAutoPersona)` — null/empty values
      // must not overwrite an already-set env var.
      expect(entry).toContain("if (BAKED.projectAutoPersona)");
    });

    it("projectAutoPersona is null in BAKED when config omits it", () => {
      const ccDir = path.join(projectDir, ".chainlesschain");
      fs.writeFileSync(
        path.join(ccDir, "config.json"),
        JSON.stringify({ name: "bare", pack: { entry: "ui" } }),
        "utf-8",
      );
      const r = callGenerator({
        project: { projectDir, projectName: "bare", configSha: FAKE_SHA },
      });
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain('"projectAutoPersona":null');
    });

    it("assets include project dir glob", () => {
      const r = callProjectGenerator();
      const synth = JSON.parse(fs.readFileSync(r.pkgConfigFile, "utf-8"));
      const assetStr = assetPaths(r, synth).join("|");
      expect(assetStr).toContain(projectDir.replace(/\\/g, "/"));
    });

    it("projectMeta is returned with the correct shape", () => {
      const r = callProjectGenerator();
      expect(r.projectMeta).not.toBeNull();
      expect(r.projectMeta.projectMode).toBe(true);
      expect(r.projectMeta.projectName).toBe("my-medical-agent");
      expect(r.projectMeta.projectEntry).toBe("chat");
      expect(r.projectMeta.projectConfigSha).toBe(FAKE_SHA);
      expect(r.projectMeta.projectAllowedSubcommands).toEqual([
        "chat",
        "agent",
      ]);
    });

    it("CLI-only mode returns null projectMeta", () => {
      const r = callGenerator();
      expect(r.projectMeta).toBeNull();
    });

    it("entry uses BAKED.projectEntry (not hardcoded ui) when projectMode is set", () => {
      const r = callProjectGenerator({ projectEntry: "agent" });
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Project mode path: pushes parts of BAKED.projectEntry
      expect(entry).toContain("BAKED.projectMode ? BAKED.projectEntry : 'ui'");
    });

    // ── Phase 3c: doc/code drift fixes (2026-05-20) ─────────────────────
    it("user-data dir suffix uses SHA-16 not SHA-8 (per design §4.3)", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // SHA-16 = 64-bit entropy; prior SHA-8 was 32-bit which is too narrow
      expect(entry).toContain("BAKED.projectConfigSha.slice(0, 16)");
      expect(entry).not.toContain("projectConfigSha.slice(0, 8)");
    });

    it("user-data dir prefers %APPDATA% on Windows (per design §9)", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // process.platform=='win32' && APPDATA → use APPDATA; else fall back to ~
      expect(entry).toContain("process.platform === 'win32'");
      expect(entry).toContain("process.env.APPDATA");
      expect(entry).toContain("os.homedir()");
    });

    it("materializes under a .materialize.lock guard (per design §7.2)", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Lock-file path + 'wx' acquire + best-effort unlink cleanup
      expect(entry).toContain(".materialize.lock");
      expect(entry).toContain("fs.openSync(_lockFile, 'wx')");
      expect(entry).toContain("fs.unlinkSync(_lockFile)");
      // Materialize body must be gated by both _needsMaterialize AND lock-acquired
      expect(entry).toContain("if (_needsMaterialize && _lockFd !== null)");
    });

    it("config.json is deep-merged on existing user-data (per design §4.4)", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // _deepMerge helper present + special-cased for top-level config.json
      expect(entry).toContain("function _deepMerge(");
      expect(entry).toContain("_rel === 'config.json'");
      // Merge order: bundled is base, user values win
      expect(entry).toContain("_deepMerge(_newCfg, _userCfg)");
      // Non-config files still get the "skip + warn" behavior
      expect(entry).toContain("Keeping existing file (user-modified)");
    });

    it("copyRecursiveMerge passes rootSrc for config.json relpath detection", () => {
      const r = callProjectGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain(
        "function copyRecursiveMerge(src, dest, rootSrc)",
      );
      expect(entry).toContain("if (rootSrc === undefined) rootSrc = src");
      expect(entry).toContain("copyRecursiveMerge(sp, dp, rootSrc)");
    });
  });

  // ── Phase 3f: .env sidecar + --version --json (2026-05-20) ────────────────
  describe("Phase 3f — .env sidecar", () => {
    it("entry includes _loadDotenv helper", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      expect(entry).toContain("function _loadDotenv(filePath)");
      // BOM strip + comment skip + KEY=VALUE parsing
      expect(entry).toContain("replace(/^\\uFEFF/");
      expect(entry).toContain("line.startsWith('#')");
      expect(entry).toContain("line.indexOf('=')");
    });

    it("entry strips matching single/double quotes from .env values", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Both quote styles, length >= 2 guard so `'` alone doesn't slice to ''
      expect(entry).toContain("val.length >= 2");
      expect(entry).toContain("val.startsWith('\"')");
      expect(entry).toContain('val.startsWith("\'")');
      expect(entry).toContain("val.slice(1, -1)");
    });

    it("entry applies .env in priority order (exePath then userDataDir)", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // exePath/.env reads from path.dirname(process.execPath)
      expect(entry).toContain(
        "_loadDotenv(path.join(path.dirname(process.execPath), '.env'))",
      );
      // userDataDir/.env keyed off CC_PROJECT_ROOT (set in project mode block)
      expect(entry).toContain("process.env.CC_PROJECT_ROOT");
      expect(entry).toContain(
        "_loadDotenv(path.join(process.env.CC_PROJECT_ROOT, '.env'))",
      );
    });

    it("entry does not overwrite explicit shell-set env vars", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Snapshot original keys; gate every assignment on !_origEnvKeys.has(k)
      expect(entry).toContain(
        "const _origEnvKeys = new Set(Object.keys(process.env))",
      );
      expect(entry).toContain("if (!_origEnvKeys.has(_k)) process.env[_k]");
    });

    it("entry applies userDataDir .env after exePath so userDataDir wins", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // The two for-loops must be ordered: _exeEnv first, _userEnv second
      const exeIdx = entry.indexOf("Object.keys(_exeEnv)");
      const userIdx = entry.indexOf("Object.keys(_userEnv)");
      expect(exeIdx).toBeGreaterThan(0);
      expect(userIdx).toBeGreaterThan(exeIdx);
    });
  });

  describe("Phase 3f — --version --json short-circuit", () => {
    it("entry intercepts --version --json before commander.parse", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Combo guard: BOTH --version and --json must be set
      expect(entry).toContain(
        "_hasFlag('-v', '--version') && _hasFlag('--json')",
      );
      // Emit cli version field at minimum
      expect(entry).toContain("cli: BAKED.packedCliVersion");
      // Exit cleanly so commander doesn't run
      expect(entry).toContain("process.exit(0)");
    });

    it("entry --version --json includes project block only in project mode", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // Guarded by BAKED.projectMode — CLI-only artifacts omit the project key
      expect(entry).toContain("if (BAKED.projectMode) {");
      expect(entry).toContain(
        "_vOut.project = { name: BAKED.projectName, sha: BAKED.projectConfigSha }",
      );
    });

    it("entry --version --json short-circuit runs after .env load", () => {
      // So that BAKED.packedCliVersion can be overridden via env if needed.
      // (Currently not — but the ordering is deliberate to keep the option
      // open without another runtime-block migration.)
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      const envIdx = entry.indexOf("Object.keys(_userEnv)");
      const versionIdx = entry.indexOf(
        "_hasFlag('-v', '--version') && _hasFlag('--json')",
      );
      expect(envIdx).toBeGreaterThan(0);
      expect(versionIdx).toBeGreaterThan(envIdx);
    });

    it("entry plain --version (without --json) is unchanged — still hits commander", () => {
      const r = callGenerator();
      const entry = fs.readFileSync(r.entryScript, "utf-8");
      // The _shortCircuits flag still detects -v/-V/--version + -h/--help,
      // and the if(!_hasSub && !_shortCircuits) gate is preserved.
      expect(entry).toContain("_hasFlag('-v', '--version', '-h', '--help')");
      expect(entry).toContain("if (!_hasSub && !_shortCircuits)");
    });
  });
});
